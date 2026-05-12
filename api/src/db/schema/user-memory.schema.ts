import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './user.schema'

export type UserMemoryThemeData = {
  readonly theme: string
  readonly confidence: number
  readonly mentions: number
  readonly source: 'declared' | 'derived'
}

export type UserMemoryVoterPreferencesData = {
  readonly darkPreference: number
  readonly callbackPreference: number
  readonly absurdPreference: number
  readonly ironyPreference: number
}

export type UserMemoryAuthorStyleData = {
  readonly avgPunchlineLength: number
  readonly preferredStructures: readonly string[]
}

export const userMemory = pgTable('user_memory', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  themes: jsonb('themes').$type<readonly UserMemoryThemeData[]>().notNull().default([]),
  voterPreferences: jsonb('voter_preferences')
    .$type<UserMemoryVoterPreferencesData>()
    .notNull()
    .default({
      darkPreference: 0.5,
      callbackPreference: 0.5,
      absurdPreference: 0.5,
      ironyPreference: 0.5
    }),
  authorStyle: jsonb('author_style')
    .$type<UserMemoryAuthorStyleData>()
    .notNull()
    .default({ avgPunchlineLength: 0, preferredStructures: [] }),
  portrait: text('portrait'),
  updatedAfterRoundsCount: integer('updated_after_rounds_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export type UserMemoryRow = typeof userMemory.$inferSelect
export type UserMemoryInsert = typeof userMemory.$inferInsert
