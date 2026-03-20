import { JokeMemorySource } from './joke-memory-source.type'

export type JokeMemoryRecordInput = {
  readonly prompt: string
  readonly punchline: string
  readonly votesFor: number
  readonly votesAgainst: number
  readonly ratingAverage?: number
  readonly ratingCount?: number
  readonly source: JokeMemorySource
  readonly roomCode: string
  readonly roundIndex: number
}
