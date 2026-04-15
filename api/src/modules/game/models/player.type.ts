export type Player = {
  readonly id: string
  socketId: string | null
  readonly isBot: boolean
  readonly name: string
  readonly bio: string
  connected: boolean
  score: number
}
