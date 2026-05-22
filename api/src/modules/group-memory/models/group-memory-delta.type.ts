import { GroupMemoryInJokeKind } from '../../../db/schema/group-memory.schema'

export type GroupThemeDelta = {
  readonly theme: string
  readonly scoreDelta?: number
  readonly mentionsDelta?: number
  readonly newExamples?: readonly string[]
}

export type GroupInJokeDelta = {
  readonly phrase: string
  readonly kind?: GroupMemoryInJokeKind
  readonly mentionsDelta?: number
}

export type GroupTriggerDelta = {
  readonly trigger: string
  readonly scoreDelta?: number
  readonly newExamples?: readonly string[]
}

export type GroupAvoidedThemeDelta = {
  readonly theme: string
  readonly reason: string
}

export type GroupSetupPatternDelta = {
  readonly pattern: string
  readonly scoreDelta?: number
}

export type GroupMemoryDelta = {
  readonly themesDelta?: readonly GroupThemeDelta[]
  readonly inJokesDelta?: readonly GroupInJokeDelta[]
  readonly triggersDelta?: readonly GroupTriggerDelta[]
  readonly avoidedThemesDelta?: readonly GroupAvoidedThemeDelta[]
  readonly setupPatternsDelta?: readonly GroupSetupPatternDelta[]
  readonly newSummaryText?: string
}
