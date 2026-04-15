export interface PushCompletionInput {
  readonly promptText: string
  readonly punchline: string
  readonly source: 'human' | 'bot'
  readonly votesFor: number
  readonly votesAgainst: number
  readonly ratingAverage?: number
  readonly ratingCount?: number
  readonly roomCode: string
  readonly roundIndex: number
}
