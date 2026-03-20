import { Injectable, Logger } from '@nestjs/common'
import { JokeMemoryService } from '../joke-memory/joke-memory.service'
import { z } from 'zod'
import { AiBotAnswerInput } from './models/ai-bot-answer-input.type'
import { AiMemoryExample } from './models/ai-memory-example.type'
import { AiMessage } from './models/ai-message.type'
import { AiPromptPair } from './models/ai-prompt-pair.type'
import { OllamaChatResponse } from './models/ollama-chat-response.type'
import {
  BOT_PUNCHLINE_SYSTEM_PROMPT,
  PROMPT_GENERATION_SYSTEM_PROMPT,
  createBotPunchlineUserPrompt,
  createPromptListUserPrompt
} from './prompts/prompt-templates'

const OLLAMA_BASE_URL: string = process.env.OLLAMA_BASE_URL ?? 'http://host.docker.internal:11434'
const OLLAMA_MODEL: string =
  process.env.OLLAMA_MODEL ?? 'hf.co/TheBloke/WizardLM-13B-Uncensored-GGUF:Q4_K_M'
const OLLAMA_TIMEOUT_MS: number = 6000
const MEMORY_EXAMPLES_LIMIT: number = 4
const METRICS_LOG_INTERVAL: number = 20

const botAnswerSchema = z.string().min(1).max(140)

const FALLBACK_PROMPTS: readonly string[] = [
  'Когда я открыл холодильник ночью, он потребовал:',
  'На собеседовании меня спросили о слабых сторонах, и я ответил:',
  'Мой умный дом внезапно запретил мне:',
  'Я решил начать новую жизнь, но уже утром:',
  'В такси я сказал "по-быстрому", и водитель:'
] as const

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

  public constructor(private readonly jokeMemoryService: JokeMemoryService) {}

  public async generatePromptPair(): Promise<AiPromptPair> {
    const list = await this.generatePromptList(2)
    return { first: list[0]!, second: list[1]! }
  }

  public async generatePromptList(count: number): Promise<readonly string[]> {
    if (count <= 0) {
      return []
    }
    const content = await this.executeChatRequest({
      messages: [
        { role: 'system', content: PROMPT_GENERATION_SYSTEM_PROMPT },
        { role: 'user', content: createPromptListUserPrompt(count) }
      ],
      maxTokens: Math.min(80 * count + 80, 900),
      temperature: 1.05
    })
    const parsed = this.parsePromptList(content, count)
    if (parsed) {
      return this.ensureDistinctPromptList(parsed)
    }
    return this.createFallbackPromptList(count)
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
        throw new Error(`Ollama request failed: ${response.status}`)
      }
      const json = (await response.json()) as OllamaChatResponse
      const content = this.normalizeText(json.message?.content ?? '', 400)
      if (!content) {
        throw new Error('Ollama returned empty content')
      }
      return content
    } catch {
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

  private ensureDistinctPromptList(values: readonly string[]): readonly string[] {
    const used = new Set<string>()
    const result: string[] = []
    values.forEach((value) => {
      let next = value
      let identity = this.normalizePromptIdentity(next)
      let guard = 0
      while (used.has(identity) && guard < 24) {
        next = this.getAlternativePrompt(next)
        identity = this.normalizePromptIdentity(next)
        guard += 1
      }
      if (used.has(identity)) {
        next = `${next} (${result.length + 1})`
        identity = this.normalizePromptIdentity(next)
      }
      used.add(identity)
      result.push(next)
    })
    return result
  }

  private createFallbackPromptList(count: number): readonly string[] {
    const result: string[] = []
    for (let index = 0; index < count; index += 1) {
      let candidate = this.getRandomItem(FALLBACK_PROMPTS)
      let guard = 0
      while (
        result.some((item) => this.normalizePromptIdentity(item) === this.normalizePromptIdentity(candidate)) &&
        guard < 40
      ) {
        candidate = this.getRandomItem(FALLBACK_PROMPTS)
        guard += 1
      }
      if (result.some((item) => this.normalizePromptIdentity(item) === this.normalizePromptIdentity(candidate))) {
        candidate = `${candidate} (${index + 1})`
      }
      result.push(candidate)
    }
    return this.ensureDistinctPromptList(result)
  }

  private normalizePromptIdentity(value: string): string {
    return value
      .toLocaleLowerCase('ru-RU')
      .replace(/[!?.:,;'"«»()[\]{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private getAlternativePrompt(current: string): string {
    const currentIdentity = this.normalizePromptIdentity(current)
    const candidates = FALLBACK_PROMPTS.filter((item) => this.normalizePromptIdentity(item) !== currentIdentity)
    if (candidates.length === 0) {
      return `${current} (ещё)`
    }
    return this.getRandomItem(candidates)
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
