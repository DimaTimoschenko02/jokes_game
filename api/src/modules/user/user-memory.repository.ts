import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DATABASE } from '../../db/db.module'
import { Db } from '../../db/db.types'
import {
  UserMemoryAuthorStyleData,
  UserMemoryThemeData,
  UserMemoryVoterPreferencesData,
  userMemory
} from '../../db/schema/user-memory.schema'
import { UserMemoryView } from './models/user-memory-view.type'

const DEFAULT_VOTER_PREFERENCES: UserMemoryVoterPreferencesData = {
  darkPreference: 0.5,
  callbackPreference: 0.5,
  absurdPreference: 0.5,
  ironyPreference: 0.5
}

const DEFAULT_AUTHOR_STYLE: UserMemoryAuthorStyleData = {
  avgPunchlineLength: 0,
  preferredStructures: []
}

@Injectable()
export class UserMemoryRepository {
  public constructor(@Inject(DATABASE) private readonly db: Db) {}

  public async findByUserId(userId: string): Promise<UserMemoryView | null> {
    const rows = await this.db
      .select()
      .from(userMemory)
      .where(eq(userMemory.userId, userId))
      .limit(1)
    const row = rows[0]
    if (!row) {
      return null
    }
    return this.toView(row)
  }

  public async ensureExists(userId: string): Promise<void> {
    await this.db
      .insert(userMemory)
      .values({ userId })
      .onConflictDoNothing({ target: userMemory.userId })
  }

  public async upsert(input: {
    readonly userId: string
    readonly themes: readonly UserMemoryThemeData[]
    readonly voterPreferences: UserMemoryVoterPreferencesData
    readonly authorStyle: UserMemoryAuthorStyleData
    readonly portrait: string | null
    readonly updatedAfterRoundsCount: number
  }): Promise<void> {
    await this.db
      .insert(userMemory)
      .values({
        userId: input.userId,
        themes: input.themes,
        voterPreferences: input.voterPreferences,
        authorStyle: input.authorStyle,
        portrait: input.portrait,
        updatedAfterRoundsCount: input.updatedAfterRoundsCount,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: userMemory.userId,
        set: {
          themes: input.themes,
          voterPreferences: input.voterPreferences,
          authorStyle: input.authorStyle,
          portrait: input.portrait,
          updatedAfterRoundsCount: input.updatedAfterRoundsCount,
          updatedAt: new Date()
        }
      })
  }

  public buildDefaultView(): UserMemoryView {
    return {
      themes: [],
      voterPreferences: DEFAULT_VOTER_PREFERENCES,
      authorStyle: DEFAULT_AUTHOR_STYLE,
      portrait: null,
      updatedAfterRoundsCount: 0,
      updatedAt: new Date()
    }
  }

  private toView(row: typeof userMemory.$inferSelect): UserMemoryView {
    return {
      themes: row.themes,
      voterPreferences: row.voterPreferences,
      authorStyle: row.authorStyle,
      portrait: row.portrait,
      updatedAfterRoundsCount: row.updatedAfterRoundsCount,
      updatedAt: row.updatedAt
    }
  }
}
