import { AgentConfig } from './agent-config.type'

export type AgentSession<T = unknown> = {
  readonly id: string
  readonly config: AgentConfig<T>
  readonly createdAt: Date
}
