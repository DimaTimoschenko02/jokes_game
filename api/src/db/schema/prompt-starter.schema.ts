import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector
} from 'drizzle-orm/pg-core'

export const promptStarters = pgTable(
  'prompt_starters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    text: text('text').notNull(),
    source: text('source').notNull().default('ai'),
    authorUserId: text('author_user_id'),
    usedCount: integer('used_count').notNull().default(0),
    isGolden: boolean('is_golden').notNull().default(false),
    averageCompletionRating: real('average_completion_rating'),
    averageVoteShare: real('average_vote_share'),
    goldenSince: timestamp('golden_since', { withTimezone: true }),
    feedbackSum: real('feedback_sum').notNull().default(0),
    feedbackCount: integer('feedback_count').notNull().default(0),
    feedbackScore: real('feedback_score').notNull().default(0),
    adminScore: smallint('admin_score'),
    adminScoredBy: text('admin_scored_by'),
    adminScoredAt: timestamp('admin_scored_at', { withTimezone: true }),
    adminComment: text('admin_comment'),
    isSeed: boolean('is_seed').notNull().default(false),
    isFallback: boolean('is_fallback').notNull().default(false),
    derivedScore: real('derived_score'),
    usedAsExampleCount: integer('used_as_example_count').notNull().default(0),
    lastUsedAsExampleAt: timestamp('last_used_as_example_at', { withTimezone: true }),
    textEmbedding: vector('text_embedding', { dimensions: 1024 }),
    embeddingModel: text('embedding_model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('prompt_starters_text_unique').on(table.text),
    index('prompt_starters_embedding_hnsw_idx').using(
      'hnsw',
      table.textEmbedding.op('vector_cosine_ops')
    ),
    index('prompt_starters_used_count_idx').on(table.usedCount),
    index('prompt_starters_golden_idx').on(table.isGolden, table.averageCompletionRating.desc()),
    index('prompt_starters_admin_idx').on(table.adminScore.desc(), table.createdAt.desc()),
    index('prompt_starters_feedback_idx').on(table.feedbackScore.desc()),
    index('prompt_starters_derived_idx').on(table.derivedScore.desc()),
    index('prompt_starters_used_as_example_idx').on(table.usedAsExampleCount)
  ]
)

export type PromptStarterRow = typeof promptStarters.$inferSelect
export type PromptStarterInsert = typeof promptStarters.$inferInsert
