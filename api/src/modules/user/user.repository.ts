import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DATABASE } from '../../db/db.module'
import { Db } from '../../db/db.types'
import { UserInsert, users } from '../../db/schema/user.schema'
import { UserGender, UserProfile, UserRole } from './models/user-profile.type'

@Injectable()
export class UserRepository {
  public constructor(@Inject(DATABASE) private readonly db: Db) {}

  public async findByLogin(login: string): Promise<{
    readonly id: string
    readonly login: string
    readonly passwordHash: string
    readonly realName: string
    readonly displayName: string
    readonly gender: UserGender
    readonly bio: string | null
    readonly role: UserRole
    readonly createdAt: Date
  } | null> {
    const rows = await this.db.select().from(users).where(eq(users.login, login)).limit(1)
    const row = rows[0]
    if (!row) {
      return null
    }
    return {
      id: row.id,
      login: row.login,
      passwordHash: row.passwordHash,
      realName: row.realName,
      displayName: row.displayName,
      gender: row.gender,
      bio: row.bio,
      role: row.role,
      createdAt: row.createdAt
    }
  }

  public async findById(id: string): Promise<UserProfile | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1)
    const row = rows[0]
    if (!row) {
      return null
    }
    return this.toProfile(row)
  }

  public async create(input: UserInsert): Promise<UserProfile> {
    const [row] = await this.db.insert(users).values(input).returning()
    return this.toProfile(row)
  }

  public async updateProfile(
    id: string,
    input: { readonly displayName?: string; readonly realName?: string; readonly gender?: UserGender; readonly bio?: string | null }
  ): Promise<UserProfile | null> {
    const [row] = await this.db
      .update(users)
      .set({
        displayName: input.displayName,
        realName: input.realName,
        gender: input.gender,
        bio: input.bio,
        updatedAt: new Date()
      })
      .where(eq(users.id, id))
      .returning()
    return row ? this.toProfile(row) : null
  }

  private toProfile(row: typeof users.$inferSelect): UserProfile {
    return {
      id: row.id,
      login: row.login,
      realName: row.realName,
      displayName: row.displayName,
      gender: row.gender,
      bio: row.bio,
      role: row.role,
      createdAt: row.createdAt
    }
  }
}
