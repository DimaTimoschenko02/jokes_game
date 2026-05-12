export type RoundJokeStat = {
  readonly opening: string
  readonly punchline: string
  readonly authorUserId: string | null
  readonly authorRealName: string
  readonly ratingAverage: number | null
  readonly ratingCount: number
}

export type RoundDuelStat = {
  readonly opening: string
  readonly winnerUserId: string | null
  readonly winnerPunchline: string
  readonly loserPunchline: string
  readonly votesFor: number
  readonly votesAgainst: number
  readonly votersUserIds: readonly string[]
}

export type RoundStats = {
  readonly roundIndex: number
  readonly jokes: readonly RoundJokeStat[]
  readonly duels: readonly RoundDuelStat[]
}
