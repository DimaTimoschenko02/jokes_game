export type Player = {
  readonly id: string
  socketId: string | null
  readonly isBot: boolean
  readonly name: string
  connected: boolean
  score: number
}
