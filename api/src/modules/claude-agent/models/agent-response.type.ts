export type AgentUsage = {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheCreationTokens: number
}

export type AgentResponse<T = unknown> = {
  readonly raw: string
  readonly parsed?: T
  readonly latencyMs: number
  readonly wallClockMs: number
  readonly costUsd: number
  readonly usage: AgentUsage
}
