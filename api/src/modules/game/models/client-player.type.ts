export type ClientPlayer = {
  readonly id: string
  readonly name: string
  readonly isBot: boolean
  readonly connected: boolean
  readonly score: number
  readonly isHost: boolean
}
