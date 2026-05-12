export type UserGender = 'male' | 'female' | 'non-binary' | 'not-specified'

export type UserProfile = {
  readonly id: string
  readonly login: string
  readonly realName: string
  readonly displayName: string
  readonly gender: UserGender
  readonly bio: string | null
  readonly createdAt: string
}

export type UserMemoryTheme = {
  readonly theme: string
  readonly confidence: number
  readonly mentions: number
  readonly source: 'declared' | 'derived'
}

export type UserMemoryVoterPreferences = {
  readonly darkPreference: number
  readonly callbackPreference: number
  readonly absurdPreference: number
  readonly ironyPreference: number
}

export type UserMemoryAuthorStyle = {
  readonly avgPunchlineLength: number
  readonly preferredStructures: readonly string[]
}

export type UserMemoryView = {
  readonly themes: readonly UserMemoryTheme[]
  readonly voterPreferences: UserMemoryVoterPreferences
  readonly authorStyle: UserMemoryAuthorStyle
  readonly portrait: string | null
  readonly updatedAfterRoundsCount: number
  readonly updatedAt: string
}

export type AuthResult = {
  readonly token: string
  readonly user: UserProfile
}
