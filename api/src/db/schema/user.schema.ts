import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const userGenderEnum = pgEnum('user_gender', [
  'male',
  'female',
  'non-binary',
  'not-specified'
])

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    login: text('login').notNull(),
    passwordHash: text('password_hash').notNull(),
    realName: text('real_name').notNull(),
    displayName: text('display_name').notNull(),
    gender: userGenderEnum('gender').notNull().default('not-specified'),
    bio: text('bio'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('users_login_unique').on(table.login),
    index('users_created_at_idx').on(table.createdAt.desc())
  ]
)

export type UserRow = typeof users.$inferSelect
export type UserInsert = typeof users.$inferInsert
