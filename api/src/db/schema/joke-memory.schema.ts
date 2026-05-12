import {
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector
} from 'drizzle-orm/pg-core'

export const jokeSourceEnum = pgEnum('joke_source', ['human', 'bot'])

export const jokeMemory = pgTable(
  'joke_memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prompt: text('prompt').notNull(),
    punchline: text('punchline').notNull(),
    promptNormalized: text('prompt_normalized').notNull(),
    fingerprint: text('fingerprint').notNull(),
    promptEmbedding: vector('prompt_embedding', { dimensions: 1024 }),
    embeddingModel: text('embedding_model'),
    votesFor: integer('votes_for').notNull().default(0),
    votesAgainst: integer('votes_against').notNull().default(0),
    voteShare: real('vote_share').notNull().default(0.5),
    qualityScore: real('quality_score').notNull().default(0),
    ratingAverage: real('rating_average'),
    ratingSum: real('rating_sum'),
    ratingCount: integer('rating_count'),
    adminScore: smallint('admin_score'),
    adminScoredBy: text('admin_scored_by'),
    adminScoredAt: timestamp('admin_scored_at', { withTimezone: true }),
    adminComment: text('admin_comment'),
    usedAsExampleCount: integer('used_as_example_count').notNull().default(0),
    lastUsedAsExampleAt: timestamp('last_used_as_example_at', { withTimezone: true }),
    authorUserId: text('author_user_id'),
    authorRealName: text('author_real_name'),
    source: jokeSourceEnum('source').notNull(),
    roomCode: text('room_code').notNull(),
    roundIndex: integer('round_index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('joke_memory_fingerprint_unique').on(table.fingerprint),
    index('joke_memory_embedding_hnsw_idx').using(
      'hnsw',
      table.promptEmbedding.op('vector_cosine_ops')
    ),
    index('joke_memory_created_at_idx').on(table.createdAt.desc()),
    index('joke_memory_admin_score_idx').on(table.adminScore.desc()),
    index('joke_memory_rating_idx').on(table.ratingAverage.desc(), table.ratingCount.desc()),
    index('joke_memory_author_idx').on(table.authorUserId, table.createdAt.desc()),
    index('joke_memory_source_idx').on(table.source, table.createdAt.desc())
  ]
)

export type JokeMemoryRow = typeof jokeMemory.$inferSelect
export type JokeMemoryInsert = typeof jokeMemory.$inferInsert
