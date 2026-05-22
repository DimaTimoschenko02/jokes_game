import { GroupMemoryDelta } from '../../../group-memory/models/group-memory-delta.type'

export type ThemeDelta = {
  readonly theme: string
  readonly confidenceDelta?: number
  readonly mentionsDelta?: number
  readonly source?: 'declared' | 'derived'
}

export type VoterPreferencesDelta = {
  readonly darkPreference?: number
  readonly callbackPreference?: number
  readonly absurdPreference?: number
  readonly ironyPreference?: number
}

export type AuthorStyleDelta = {
  readonly avgPunchlineLength?: number
  readonly preferredStructures?: readonly string[]
}

export type UserMemoryDelta = {
  readonly themesDelta?: readonly ThemeDelta[]
  readonly voterPreferencesDelta?: VoterPreferencesDelta
  readonly authorStyleDelta?: AuthorStyleDelta
  readonly newPortrait?: string
}

export type MemoryUpdaterOutput = {
  readonly updates: Readonly<Record<string, UserMemoryDelta>>
  readonly groupMemoryDelta?: GroupMemoryDelta
}
