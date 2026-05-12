export type UserMemoryTheme = {
  readonly theme: string
  readonly confidence: number
  readonly mentions: number
  readonly source: 'declared' | 'derived'
}

export type VoterPreferencesSnapshot = {
  readonly darkPreference: number
  readonly callbackPreference: number
  readonly absurdPreference: number
  readonly ironyPreference: number
}

export type AuthorStyleSnapshot = {
  readonly avgPunchlineLength: number
  readonly preferredStructures: readonly string[]
}

export type UserMemorySnapshot = {
  readonly userId: string
  readonly realName: string
  readonly gender: 'male' | 'female' | 'non-binary' | 'not-specified'
  readonly ageBand?: string
  readonly declaredBio?: string
  readonly portrait?: string
  readonly themes: readonly UserMemoryTheme[]
  readonly voterPreferences: VoterPreferencesSnapshot
  readonly authorStyle: AuthorStyleSnapshot
}
