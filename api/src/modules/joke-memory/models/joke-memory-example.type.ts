import { JokeMemorySource } from './joke-memory-source.type'

export type JokeMemoryExample = {
  readonly prompt: string
  readonly punchline: string
  readonly voteShare: number
  readonly qualityScore: number
  readonly source: JokeMemorySource
  readonly createdAt: Date
}
