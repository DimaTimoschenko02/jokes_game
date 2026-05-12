import { JokeMemorySource } from './joke-memory-source.type'

export type JokeMemoryRetrievalEntry = {
  readonly id: string
  readonly prompt: string
  readonly punchline: string
  readonly useScore: number
  readonly source: JokeMemorySource
  readonly adminComment?: string
}

export type JokeMemoryRetrievalResult = {
  readonly positive: readonly JokeMemoryRetrievalEntry[]
  readonly negative: readonly JokeMemoryRetrievalEntry[]
}

export type JokeMemoryBotRetrievalInput = {
  readonly prompt: string
  readonly positiveCount?: number
  readonly negativeCount?: number
}
