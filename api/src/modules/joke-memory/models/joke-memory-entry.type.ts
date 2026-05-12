import { JokeMemorySource } from './joke-memory-source.type'

export type JokeMemoryEntry = {
  readonly prompt: string
  readonly punchline: string
  readonly promptNormalized: string
  readonly fingerprint: string
  readonly promptEmbedding?: readonly number[]
  readonly embeddingModel?: string
  readonly votesFor: number
  readonly votesAgainst: number
  readonly voteShare: number
  readonly qualityScore: number
  readonly ratingAverage?: number
  readonly ratingSum?: number
  readonly ratingCount?: number
  readonly adminScore?: number
  readonly adminScoredBy?: string
  readonly adminScoredAt?: Date
  readonly adminComment?: string
  readonly usedAsExampleCount: number
  readonly lastUsedAsExampleAt?: Date
  readonly authorUserId?: string
  readonly authorRealName?: string
  readonly source: JokeMemorySource
  readonly roomCode: string
  readonly roundIndex: number
  readonly createdAt: Date
}
