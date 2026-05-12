import {
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core'
import { jokeSourceEnum } from './joke-memory.schema'
import { promptStarters } from './prompt-starter.schema'

export const promptStarterCompletions = pgTable(
  'prompt_starter_completions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    promptStarterId: uuid('prompt_starter_id')
      .notNull()
      .references(() => promptStarters.id, { onDelete: 'cascade' }),
    punchline: text('punchline').notNull(),
    source: jokeSourceEnum('source').notNull(),
    votesFor: integer('votes_for').notNull().default(0),
    votesAgainst: integer('votes_against').notNull().default(0),
    voteShare: real('vote_share').notNull().default(0.5),
    ratingAverage: real('rating_average'),
    ratingCount: integer('rating_count'),
    roomCode: text('room_code').notNull(),
    roundIndex: integer('round_index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('completions_by_prompt_vote_share').on(
      table.promptStarterId,
      table.voteShare.desc()
    ),
    index('completions_by_prompt_created').on(
      table.promptStarterId,
      table.createdAt.desc()
    )
  ]
)

export type PromptStarterCompletionRow = typeof promptStarterCompletions.$inferSelect
export type PromptStarterCompletionInsert = typeof promptStarterCompletions.$inferInsert
