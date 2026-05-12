export type UserGender = 'male' | 'female' | 'non-binary' | 'not-specified'

export type UserProfile = {
  readonly id: string
  readonly login: string
  readonly realName: string
  readonly displayName: string
  readonly gender: UserGender
  readonly bio: string | null
  readonly createdAt: Date
}
