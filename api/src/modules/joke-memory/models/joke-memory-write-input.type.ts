import { JokeMemorySource } from './joke-memory-source.type'

export type JokeMemoryWriteInput = {
  readonly prompt: string
  readonly punchline: string
  readonly votesFor: number
  readonly votesAgainst: number
  readonly voteShare: number
  readonly qualityScore: number
  readonly ratingAverage?: number
  readonly ratingSum?: number
  readonly ratingCount?: number
  readonly promptEmbedding?: readonly number[]
  readonly embeddingModel?: string
  readonly authorUserId?: string
  readonly authorRealName?: string
  readonly source: JokeMemorySource
  readonly roomCode: string
  readonly roundIndex: number
}
