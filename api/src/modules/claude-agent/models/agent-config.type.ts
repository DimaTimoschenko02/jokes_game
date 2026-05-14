import { ZodType } from 'zod'

export type AgentOutputFormat = 'text' | 'json'

export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type AgentConfig<T = unknown> = {
  readonly name: string
  readonly systemPrompt: string
  readonly outputFormat: AgentOutputFormat
  readonly schema?: ZodType<T>
  readonly model: string
  readonly retries: number
  readonly timeoutMs: number
  readonly effort?: AgentEffort
  readonly fallbackModel?: string
  readonly useJsonSchema?: boolean
}
