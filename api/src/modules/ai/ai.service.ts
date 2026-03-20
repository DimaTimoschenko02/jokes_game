import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { JokeMemoryService } from '../joke-memory/joke-memory.service'
import { z } from 'zod'
import { AiBotAnswerInput } from './models/ai-bot-answer-input.type'
import { AiMemoryExample } from './models/ai-memory-example.type'
import { AiMessage } from './models/ai-message.type'
import { OllamaChatResponse } from './models/ollama-chat-response.type'
import {
  BOT_PUNCHLINE_SYSTEM_PROMPT,
  PROMPT_GENERATION_SYSTEM_PROMPT,
  createBotPunchlineUserPrompt,
  createPromptListUserPrompt
} from './prompts/prompt-templates'

const OLLAMA_BASE_URL: string = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
const OLLAMA_MODEL: string =
  process.env.OLLAMA_MODEL ?? 'huihui_ai/qwen2.5-abliterate:3b'
const OLLAMA_TIMEOUT_MS: number = 90000
const MEMORY_EXAMPLES_LIMIT: number = 4
const METRICS_LOG_INTERVAL: number = 20

const botAnswerSchema = z.string().min(1).max(140)

const FALLBACK_PUNCHLINES: readonly string[] = [
  'это был смелый план ровно до первой минуты.',
  'я сделал вид, что именно так и задумал.',
  'соседи теперь аплодируют и боятся.',
  'я получил опыт и счет за ущерб.',
  'главное произнести это уверенно.'
] as const

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger: Logger = new Logger(AiService.name)
  private totalBotRequests: number = 0
  private totalBotLatencyMs: number = 0
  private fallbackResponses: number = 0

  public constructor(private readonly jokeMemoryService: JokeMemoryService) {}

  public onModuleInit(): void {
    void this.probeOllamaOnStartup()
  }

  public async generatePromptList(
    count: number,
    excludedPrompts: readonly string[] = []
  ): Promise<readonly string[]> {
    if (count <= 0) {
      return []
    }
    const content = await this.executeChatRequest({
      messages: [
        { role: 'system', content: PROMPT_GENERATION_SYSTEM_PROMPT },
        { role: 'user', content: createPromptListUserPrompt(count, excludedPrompts) }
      ],
      maxTokens: Math.min(80 * count + 80, 900),
      temperature: 1.05
    })
    return this.parsePromptList(content, count) ?? []
  }

  public async generateBotAnswer(input: AiBotAnswerInput): Promise<string> {
    const startMs = Date.now()
    const memoryExamples = await this.retrieveMemoryExamples(input.prompt)
    const content = await this.executeChatRequest({
      messages: [
        { role: 'system', content: BOT_PUNCHLINE_SYSTEM_PROMPT },
        { role: 'user', content: createBotPunchlineUserPrompt(input.prompt, input.styleTag, memoryExamples) }
      ],
      maxTokens: 80,
      temperature: 1.2
    })
    this.registerLatency(Date.now() - startMs)
    const result = botAnswerSchema.safeParse(this.normalizeText(content, 140))
    if (result.success) {
      return result.data
    }
    this.fallbackResponses += 1
    this.maybeLogMetrics()
    return this.getRandomItem(FALLBACK_PUNCHLINES)
  }

  private async probeOllamaOnStartup(): Promise<void> {
    const url = `${OLLAMA_BASE_URL}/api/tags`
    const abortController = new AbortController()
    const timeoutHandle = setTimeout(() => abortController.abort(), 5000)
    try {
      const response = await fetch(url, { signal: abortController.signal })
      if (!response.ok) {
        this.logger.warn(`ollama_probe http_status=${response.status} url=${OLLAMA_BASE_URL}`)
        return
      }
      const data = (await response.json()) as { models?: readonly { name: string }[] }
      const names = data.models?.map((item) => item.name) ?? []
      const modelListed = names.some((name) => name === OLLAMA_MODEL || name.endsWith(OLLAMA_MODEL))
      this.logger.log(
        `ollama_ready url=${OLLAMA_BASE_URL} chat_model=${OLLAMA_MODEL} tags_count=${names.length}`
      )
      if (names.length > 0 && !modelListed) {
        this.logger.warn(
          `ollama_probe model_not_in_tags chat_model=${OLLAMA_MODEL} hint=set OLLAMA_MODEL to one of loaded names`
        )
      }
    } catch (error: unknown) {
      this.logOllamaProbeFailure(error)
    } finally {
      clearTimeout(timeoutHandle)
    }
  }

  private getFetchErrorCauseSuffix(error: unknown): string {
    if (!(error instanceof Error) || !('cause' in error)) {
      return ''
    }
    const c = (error as Error & { cause?: unknown }).cause
    return c != null ? ` cause=${String(c)}` : ''
  }

  private logOllamaProbeFailure(error: unknown): void {
    const cause = this.getFetchErrorCauseSuffix(error)
    if (error instanceof Error) {
      const kind = error.name === 'AbortError' ? 'timeout_or_abort' : error.name
      this.logger.warn(
        `ollama_probe ${kind} message=${error.message}${cause} url=${OLLAMA_BASE_URL} | ` +
          'hint=Start Ollama (docker compose up ollama), pull models: npm run docker:pull-model. Override: OLLAMA_BASE_URL in .env. Run: npm run check:ollama'
      )
      return
    }
    this.logger.warn(`ollama_probe error=${String(error)} url=${OLLAMA_BASE_URL}`)
  }

  private logOllamaError(context: string, error: unknown): void {
    const cause = this.getFetchErrorCauseSuffix(error)
    if (error instanceof Error) {
      const kind = error.name === 'AbortError' ? 'timeout_or_abort' : error.name
      this.logger.warn(`${context} ${kind} message=${error.message}${cause} url=${OLLAMA_BASE_URL}`)
      return
    }
    this.logger.warn(`${context} error=${String(error)} url=${OLLAMA_BASE_URL}`)
  }

  private async executeChatRequest(input: {
    readonly messages: readonly AiMessage[]
    readonly maxTokens: number
    readonly temperature: number
  }): Promise<string> {
    const abortController = new AbortController()
    const timeoutHandle = setTimeout(() => abortController.abort(), OLLAMA_TIMEOUT_MS)
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          stream: false,
          messages: input.messages,
          options: {
            temperature: input.temperature,
            top_p: 0.95,
            num_predict: input.maxTokens
          }
        })
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        this.logger.warn(
          `ollama_chat http_status=${response.status} model=${OLLAMA_MODEL} body=${detail.slice(0, 200)}`
        )
        return ''
      }
      const json = (await response.json()) as OllamaChatResponse
      const content = this.normalizeText(json.message?.content ?? '', 400)
      if (!content) {
        this.logger.warn(`ollama_chat empty_content model=${OLLAMA_MODEL}`)
        return ''
      }
      return content
    } catch (error: unknown) {
      this.logOllamaError('ollama_chat', error)
      return ''
    } finally {
      clearTimeout(timeoutHandle)
    }
  }

  private parsePromptList(content: string, count: number): readonly string[] | null {
    const listSchema = z.array(z.string().min(5).max(140)).length(count)
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      try {
        const parsed: unknown = JSON.parse(jsonMatch[0])
        const result = listSchema.safeParse(parsed)
        if (result.success) {
          return result.data
        }
      } catch {
        return null
      }
    }
    const lines = content
      .split('\n')
      .map((line: string) => this.normalizeText(line.replace(/^[-*\d.)\s]+/, ''), 140))
      .filter((line: string) => line.length > 0)
    if (lines.length >= count) {
      const result = listSchema.safeParse(lines.slice(0, count))
      return result.success ? result.data : null
    }
    return null
  }

  private getRandomItem(list: readonly string[]): string {
    const index = Math.floor(Math.random() * list.length)
    return list[index]
  }

  private normalizeText(value: string, maxLength: number): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
  }

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
