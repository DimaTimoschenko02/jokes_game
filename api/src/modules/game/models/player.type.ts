import { UserGender } from '../../user/models/user-profile.type'

export type Player = {
  readonly id: string
  socketId: string | null
  readonly isBot: boolean
  readonly name: string
  readonly realName: string
  readonly bio: string
  readonly gender: UserGender
  connected: boolean
  score: number
}
