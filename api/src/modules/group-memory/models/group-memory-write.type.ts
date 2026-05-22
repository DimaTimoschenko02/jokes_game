import {
  GroupMemoryAvoidedThemeData,
  GroupMemoryInJokeData,
  GroupMemorySetupPatternData,
  GroupMemoryThemeData,
  GroupMemoryTriggerData
} from '../../../db/schema/group-memory.schema'

export type GroupMemoryWriteFields = {
  readonly themes: readonly GroupMemoryThemeData[]
  readonly inJokes: readonly GroupMemoryInJokeData[]
  readonly triggers: readonly GroupMemoryTriggerData[]
  readonly avoidedThemes: readonly GroupMemoryAvoidedThemeData[]
  readonly setupPatterns: readonly GroupMemorySetupPatternData[]
  readonly summaryText: string | null
  readonly gamesProcessed: number
  readonly summaryRefreshedAtGame: number
}
