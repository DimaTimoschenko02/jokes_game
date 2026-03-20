export type ClientDuel = {
  readonly id: string
  readonly prompt: string
  readonly leftPlayerId: string
  readonly rightPlayerId: string
  readonly leftAnswer: string
  readonly rightAnswer: string
  readonly votesByPlayerId: Readonly<Record<string, 'left' | 'right'>>
}
