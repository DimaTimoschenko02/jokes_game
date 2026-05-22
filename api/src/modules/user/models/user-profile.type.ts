export type UserGender = 'male' | 'female' | 'non-binary' | 'not-specified'

export type UserRole = 'admin' | 'user'

export type UserProfile = {
  readonly id: string
  readonly login: string
  readonly realName: string
  readonly displayName: string
  readonly gender: UserGender
  readonly bio: string | null
  readonly role: UserRole
  readonly testAccount: boolean
  readonly createdAt: Date
}
