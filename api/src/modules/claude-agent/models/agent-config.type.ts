import { ZodType } from 'zod'

export type AgentOutputFormat = 'text' | 'json'

export type AgentConfig<T = unknown> = {
  readonly name: string
  readonly systemPrompt: string
  readonly outputFormat: AgentOutputFormat
  readonly schema?: ZodType<T>
  readonly model: string
  readonly retries: number
  readonly timeoutMs: number
}
