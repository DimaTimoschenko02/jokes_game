import {
  UserMemoryAuthorStyleData,
  UserMemoryThemeData,
  UserMemoryVoterPreferencesData
} from '../../../db/schema/user-memory.schema'

export type UserMemoryView = {
  readonly themes: readonly UserMemoryThemeData[]
  readonly voterPreferences: UserMemoryVoterPreferencesData
  readonly authorStyle: UserMemoryAuthorStyleData
  readonly portrait: string | null
  readonly updatedAfterRoundsCount: number
  readonly updatedAt: Date
}
