import { Injectable, Logger } from '@nestjs/common'
import { JokeMemoryService } from '../joke-memory/joke-memory.service'
import { z } from 'zod'
import { AiBotAnswerInput } from './models/ai-bot-answer-input.type'
import { AiMemoryExample } from './models/ai-memory-example.type'
import {
  BOT_PUNCHLINE_SYSTEM_PROMPT,
  OPENING_FILTER_SYSTEM_PROMPT,
  OPENING_GENERATION_SYSTEM_PROMPT,
  createBotPunchlineUserPrompt,
  createOpeningFilterUserPrompt,
  createOpeningGenerationUserPrompt
} from './prompts/prompt-templates'
import { spawn } from 'node:child_process'

const CLAUDE_MODEL: string = process.env.CLAUDE_MODEL ?? 'sonnet'
const CLAUDE_EFFORT: string = process.env.CLAUDE_EFFORT ?? 'high'
const CLAUDE_TIMEOUT_MS: number = 60_000
const MEMORY_EXAMPLES_LIMIT: number = 8
const METRICS_LOG_INTERVAL: number = 20
const CANDIDATE_MULTIPLIER: number = 3

interface ClaudeJsonResponse {
  result?: string
  session_id?: string
  [key: string]: unknown
}

const botAnswerSchema = z.string().min(1).max(140)

const FALLBACK_PUNCHLINES: readonly string[] = [
  'это был смелый план ровно до первой минуты.',
  'я сделал вид, что именно так и задумал.',
  'соседи теперь аплодируют и боятся.',
  'я получил опыт и счет за ущерб.',
  'главное произнести это уверенно.'
] as const

@Injectable()
export class AiService {
  private readonly logger: Logger = new Logger(AiService.name)
  private totalBotRequests: number = 0
  private totalBotLatencyMs: number = 0
  private fallbackResponses: number = 0

  public constructor(private readonly jokeMemoryService: JokeMemoryService) {
    this.logger.log(`claude_cli model=${CLAUDE_MODEL} timeout_ms=${CLAUDE_TIMEOUT_MS}`)
  }

  // ── Opening Generation Pipeline ─────────────────────────────────

  public async generateAllOpenings(input: {
    readonly needed: number
    readonly playerNames: readonly string[]
    readonly playerContext: string
    readonly goldenExamples: readonly string[]
  }): Promise<readonly string[]> {
    const candidateCount = input.needed * CANDIDATE_MULTIPLIER
    this.logger.log(`generate_all_openings needed=${input.needed} candidates=${candidateCount}`)

    const candidates = await this.generateOpeningCandidates(
      candidateCount,
      input.playerNames,
      input.playerContext,
      input.goldenExamples
    )

    if (candidates.length === 0) {
      this.logger.warn('generate_all_openings_no_candidates')
      return []
    }

    if (candidates.length <= input.needed) {
      this.logger.log(`generate_all_openings_skip_filter candidates=${candidates.length} needed=${input.needed}`)
      return candidates
    }

    const filtered = await this.filterOpenings(
      candidates,
      input.needed,
      input.goldenExamples,
      input.playerContext
    )

    if (filtered.length >= input.needed) {
      this.logger.log(`generate_all_openings_ok filtered=${filtered.length}`)
      return filtered
    }

    this.logger.warn(`generate_all_openings_partial filtered=${filtered.length} needed=${input.needed} using_candidates_as_fallback`)
    return candidates.slice(0, input.needed)
  }

  private async generateOpeningCandidates(
    count: number,
    playerNames: readonly string[],
    playerContext: string,
    goldenExamples: readonly string[]
  ): Promise<readonly string[]> {
    const content = await this.executeClaudeRequest(
      OPENING_GENERATION_SYSTEM_PROMPT,
      createOpeningGenerationUserPrompt(count, playerNames, playerContext, goldenExamples)
    )
    const result = this.parseStringArray(content)
    this.logger.log(`\n=== CANDIDATES (${result.length}) ===\n${result.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}`)
    return result
  }

  private async filterOpenings(
    candidates: readonly string[],
    needed: number,
    goldenExamples: readonly string[],
    playerContext: string
  ): Promise<readonly string[]> {
    this.logger.log(`filter_openings candidates=${candidates.length} needed=${needed}`)
    const content = await this.executeClaudeRequest(
      OPENING_FILTER_SYSTEM_PROMPT,
      createOpeningFilterUserPrompt(candidates, needed, goldenExamples, playerContext)
    )
    const result = this.parseStringArray(content)
    this.logger.log(`\n=== SELECTED FOR ROUNDS (${result.length}) ===\n${result.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}`)
    return result
  }

  // ── Punchline Generation ────────────────────────────────────────

  public async generateBotAnswer(input: AiBotAnswerInput): Promise<string> {
    const startMs = Date.now()
    const memoryExamples = await this.retrieveMemoryExamples(input.prompt)
    const userMessage = createBotPunchlineUserPrompt(
      input.prompt,
      input.styleTag,
      input.darknessLevel,
      memoryExamples,
      input.playerNames,
      input.playerContext
    )
    const content = await this.executeClaudeRequest(BOT_PUNCHLINE_SYSTEM_PROMPT, userMessage)
    const latencyMs = Date.now() - startMs
    this.registerLatency(latencyMs)
    const cleaned = this.postProcessBotAnswer(content, input.prompt)
    const result = botAnswerSchema.safeParse(cleaned)
    if (result.success) {
      this.logger.log(`\n--- PUNCHLINE ---\n  prompt: "${input.prompt}"\n  raw: "${content.slice(0, 200)}"\n  final: "${result.data}"`)
      return result.data
    }
    this.fallbackResponses += 1
    this.maybeLogMetrics()
    const fallback = this.getRandomItem(FALLBACK_PUNCHLINES)
    this.logger.warn(`generate_bot_answer_fallback latency_ms=${latencyMs} raw="${content.slice(0, 100)}" fallback="${fallback}"`)
    return fallback
  }

  // ── Legacy: prompt list generation (fallback) ───────────────────

  public async generatePromptList(
    count: number,
    excludedPrompts: readonly string[] = [],
    playerNames: readonly string[] = []
  ): Promise<readonly string[]> {
    if (count <= 0) {
      return []
    }
    this.logger.log(`generate_prompt_list count=${count}`)
    const content = await this.executeClaudeRequest(
      OPENING_GENERATION_SYSTEM_PROMPT,
      createOpeningGenerationUserPrompt(count, playerNames, '', [])
    )
    const result = this.parseStringArray(content)
    if (result.length > 0) {
      this.logger.log(`generate_prompt_list_ok parsed=${result.length}`)
    } else {
      this.logger.warn(`generate_prompt_list_fail raw="${content.slice(0, 200)}"`)
    }
    return result
  }

  // ── Claude CLI ──────────────────────────────────────────────────

  private executeClaudeRequest(systemPrompt: string, userMessage: string): Promise<string> {
    const requestId = Math.random().toString(36).slice(2, 8)
    this.logger.log(`claude_request id=${requestId} model=${CLAUDE_MODEL} effort=${CLAUDE_EFFORT}`)
    this.logger.debug(`claude_prompt id=${requestId} system="${systemPrompt.slice(0, 120)}" user="${userMessage.slice(0, 200)}"`)

    return new Promise<string>((resolve) => {
      const args: string[] = [
        '-p',
        '--model', CLAUDE_MODEL,
        '--effort', CLAUDE_EFFORT,
        '--system-prompt', systemPrompt,
        '--output-format', 'json'
      ]

      const startMs = Date.now()
      const proc = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: CLAUDE_TIMEOUT_MS,
        shell: true
      })

      proc.stdin.write(userMessage)
      proc.stdin.end()

      const chunks: Buffer[] = []
      const errChunks: Buffer[] = []

      proc.stdout.on('data', (data: Buffer) => chunks.push(data))
      proc.stderr.on('data', (data: Buffer) => errChunks.push(data))

      proc.on('error', (err) => {
        const elapsedMs = Date.now() - startMs
        this.logger.warn(`claude_spawn_error id=${requestId} elapsed_ms=${elapsedMs} error=${err.message}`)
        resolve('')
      })

      proc.on('close', (code) => {
        const elapsedMs = Date.now() - startMs
        const stdout = Buffer.concat(chunks).toString('utf-8')
        const stderr = Buffer.concat(errChunks).toString('utf-8')

        if (stderr) {
          this.logger.warn(`claude_stderr id=${requestId} stderr="${stderr.slice(0, 200)}"`)
        }

        if (code !== 0 && !stdout.trim()) {
          this.logger.warn(`claude_error id=${requestId} code=${code} elapsed_ms=${elapsedMs}`)
          resolve('')
          return
        }

        const text = this.parseClaudeResponse(stdout)
        this.logger.log(`claude_response id=${requestId} elapsed_ms=${elapsedMs} content="${text.slice(0, 150)}"`)
        resolve(text)
      })
    })
  }

  private parseClaudeResponse(stdout: string): string {
    const trimmed = stdout.trim()
    try {
      const parsed = JSON.parse(trimmed) as ClaudeJsonResponse
      return typeof parsed.result === 'string' ? parsed.result : trimmed
    } catch {
      return trimmed
    }
  }

  // ── Parsing ─────────────────────────────────────────────────────

  private parseStringArray(content: string): readonly string[] {
    const itemSchema = z.string().min(5).max(200)
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const sanitized = jsonMatch[0].replace(/;/g, ',')
      try {
        const parsed: unknown = JSON.parse(sanitized)
        if (Array.isArray(parsed)) {
          return parsed
            .filter((item): item is string => itemSchema.safeParse(item).success)
            .filter((item) => this.isValidPromptText(item))
        }
      } catch {
        /* fall through to line-based parsing */
      }
    }
    return content
      .split('\n')
      .map((line: string) => this.normalizeText(line.replace(/^[-*\d.)\s]+/, ''), 200))
      .filter((line: string) => itemSchema.safeParse(line).success)
      .filter((line: string) => this.isValidPromptText(line))
  }

  private isValidPromptText(text: string): boolean {
    if (/^\[/.test(text) || /\]$/.test(text)) {
      return false
    }
    if (/^["']/.test(text) && /["']$/.test(text)) {
      return false
    }
    if (text.split('"').length > 3) {
      return false
    }
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)) {
      return false
    }
    return true
  }

  // ── Post-processing ─────────────────────────────────────────────

  private postProcessBotAnswer(raw: string, prompt: string): string {
    let text = this.normalizeText(raw, 400)
    text = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u{20000}-\u{2a6df}，。！？：；（）【】]+/gu, '').trim()
    text = text.replace(/^\.{2,}\s*/, '').replace(/\s*\.{2,}$/, '').trim()
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('«') && text.endsWith('»'))) {
      text = text.slice(1, -1).trim()
    }
    text = text.replace(/^[A-Za-zА-ЯЁа-яё0-9_\s]+:\s*/, (match) => {
      return match.length < 30 ? '' : match
    })
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('«') && text.endsWith('»'))) {
      text = text.slice(1, -1).trim()
    }
    const promptLower = prompt.trim().toLowerCase().replace(/[:\s]+$/, '')
    const textLower = text.toLowerCase()
    if (promptLower.length > 10 && textLower.startsWith(promptLower)) {
      text = text.slice(promptLower.length).replace(/^[:\s]+/, '').trim()
    }
    const promptWords = promptLower.split(/\s+/)
    if (promptWords.length >= 3) {
      const prefix3 = promptWords.slice(0, 3).join(' ')
      if (textLower.startsWith(prefix3)) {
        const promptFullLower = prompt.trim().toLowerCase()
        if (textLower.startsWith(promptFullLower)) {
          text = text.slice(promptFullLower.length).replace(/^[:\s]+/, '').trim()
        }
      }
    }
    return this.normalizeText(text, 140)
  }

  // ── Memory retrieval ────────────────────────────────────────────

  private async retrieveMemoryExamples(prompt: string): Promise<readonly AiMemoryExample[]> {
    const entries = await this.jokeMemoryService.executeRetrieveExamples({
      prompt,
      limit: MEMORY_EXAMPLES_LIMIT,
      minVoteShare: 0.52,
      minImpressions: 2
    })
    return entries.map((entry) => ({
      prompt: entry.prompt,
      punchline: entry.punchline,
      voteShare: entry.voteShare
    }))
  }

  // ── Utilities ───────────────────────────────────────────────────

  private getRandomItem(list: readonly string[]): string {
    const index = Math.floor(Math.random() * list.length)
    return list[index]
  }

  private normalizeText(value: string, maxLength: number): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
  }

  private registerLatency(latencyMs: number): void {
    this.totalBotRequests += 1
    this.totalBotLatencyMs += latencyMs
    this.maybeLogMetrics()
  }

  private maybeLogMetrics(): void {
    if (this.totalBotRequests % METRICS_LOG_INTERVAL !== 0) {
      return
    }
    const avgLatencyMs = Math.round(this.totalBotLatencyMs / Math.max(1, this.totalBotRequests))
    const fallbackRate = Number((this.fallbackResponses / Math.max(1, this.totalBotRequests)).toFixed(3))
    this.logger.log(
      `bot_metrics total=${this.totalBotRequests} avg_latency_ms=${avgLatencyMs} fallback_rate=${fallbackRate}`
    )
  }
}
