export type Duel = {
  readonly id: string
  readonly promptIndex: number
  readonly leftPlayerId: string
  readonly rightPlayerId: string
  votes: Map<string, 'left' | 'right'>
  closed: boolean
}
