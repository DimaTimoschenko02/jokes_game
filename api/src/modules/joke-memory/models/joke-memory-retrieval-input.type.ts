export type JokeMemoryRetrievalInput = {
  readonly prompt: string
  readonly limit: number
  readonly minVoteShare: number
  readonly minImpressions: number
}
