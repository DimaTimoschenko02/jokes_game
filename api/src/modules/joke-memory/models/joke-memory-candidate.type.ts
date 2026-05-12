import { JokeMemorySource } from './joke-memory-source.type'

export type JokeMemoryCandidate = {
  readonly id: string
  readonly prompt: string
  readonly punchline: string
  readonly promptEmbedding: readonly number[]
  readonly adminScore?: number
  readonly adminComment?: string
  readonly ratingAverage?: number
  readonly ratingCount?: number
  readonly ratingSum?: number
  readonly votesFor: number
  readonly votesAgainst: number
  readonly usedAsExampleCount: number
  readonly source: JokeMemorySource
}
