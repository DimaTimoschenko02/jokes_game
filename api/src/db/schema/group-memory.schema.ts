import { boolean, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export type GroupMemoryThemeData = {
  readonly theme: string
  readonly score: number
  readonly mentions: number
  readonly examples: readonly string[]
}

export type GroupMemoryInJokeKind = 'nickname' | 'meme' | 'callback'

export type GroupMemoryInJokeData = {
  readonly phrase: string
  readonly kind: GroupMemoryInJokeKind
  readonly mentions: number
}

export type GroupMemoryTriggerData = {
  readonly trigger: string
  readonly score: number
  readonly examples: readonly string[]
}

export type GroupMemoryAvoidedThemeData = {
  readonly theme: string
  readonly reason: string
}

export type GroupMemorySetupPatternData = {
  readonly pattern: string
  readonly score: number
}

export const groupMemory = pgTable('group_memory', {
  id: text('id').primaryKey(),
  themes: jsonb('themes').$type<readonly GroupMemoryThemeData[]>().notNull().default([]),
  inJokes: jsonb('in_jokes').$type<readonly GroupMemoryInJokeData[]>().notNull().default([]),
  triggers: jsonb('triggers').$type<readonly GroupMemoryTriggerData[]>().notNull().default([]),
  avoidedThemes: jsonb('avoided_themes')
    .$type<readonly GroupMemoryAvoidedThemeData[]>()
    .notNull()
    .default([]),
  setupPatterns: jsonb('setup_patterns')
    .$type<readonly GroupMemorySetupPatternData[]>()
    .notNull()
    .default([]),
  summaryText: text('summary_text'),
  gamesProcessed: integer('games_processed').notNull().default(0),
  summaryRefreshedAtGame: integer('summary_refreshed_at_game').notNull().default(0),
  memoryEnabled: boolean('memory_enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export type GroupMemoryRow = typeof groupMemory.$inferSelect
export type GroupMemoryInsert = typeof groupMemory.$inferInsert
