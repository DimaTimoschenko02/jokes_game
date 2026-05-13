import { Inject, Injectable } from '@nestjs/common'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
  type SQLWrapper
} from 'drizzle-orm'
import { DATABASE } from '../../db/db.module'
import { jokeMemory } from '../../db/schema/joke-memory.schema'
import { Db } from '../../db/db.types'
import { JokeMemoryCandidate } from './models/joke-memory-candidate.type'
import { JokeMemoryEntry } from './models/joke-memory-entry.type'
import { JokeMemoryWriteInput } from './models/joke-memory-write-input.type'

export type JokeMemoryCounterMerge = {
  readonly votesFor: number
  readonly votesAgainst: number
  readonly ratingSum?: number
  readonly ratingCount?: number
}

export type CandidateFilter = 'positive' | 'negative'

const POSITIVE_ADMIN_SCORE_MIN: number = 7
const NEGATIVE_ADMIN_SCORE_MAX: number = 3
const POSITIVE_RATING_AVG_MIN: number = 7
const NEGATIVE_RATING_AVG_MAX: number = 4
const RATING_COUNT_MIN: number = 2

@Injectable()
export class JokeMemoryRepository {
  public constructor(@Inject(DATABASE) private readonly db: Db) {}

  public async createEntry(input: JokeMemoryWriteInput): Promise<void> {
    const fingerprint: string = this.buildFingerprint(input.prompt, input.punchline)
    await this.db
      .insert(jokeMemory)
      .values({
        prompt: input.prompt,
        punchline: input.punchline,
        promptNormalized: input.prompt.toLowerCase(),
        fingerprint,
        promptEmbedding: input.promptEmbedding ? Array.from(input.promptEmbedding) : null,
        embeddingModel: input.embeddingModel,
        votesFor: input.votesFor,
        votesAgainst: input.votesAgainst,
        voteShare: input.voteShare,
        qualityScore: input.qualityScore,
        ratingAverage: input.ratingAverage,
        ratingSum: input.ratingSum,
        ratingCount: input.ratingCount,
        authorUserId: input.authorUserId,
        authorRealName: input.authorRealName,
        source: input.source,
        roomCode: input.roomCode,
        roundIndex: input.roundIndex
      })
      .onConflictDoUpdate({
        target: jokeMemory.fingerprint,
        set: {
          votesFor: sql`${jokeMemory.votesFor} + EXCLUDED.votes_for`,
          votesAgainst: sql`${jokeMemory.votesAgainst} + EXCLUDED.votes_against`,
          ratingSum: sql`COALESCE(${jokeMemory.ratingSum}, 0) + COALESCE(EXCLUDED.rating_sum, 0)`,
          ratingCount: sql`COALESCE(${jokeMemory.ratingCount}, 0) + COALESCE(EXCLUDED.rating_count, 0)`
        }
      })
  }

  public async findByFingerprint(
    prompt: string,
    punchline: string
  ): Promise<{ readonly id: string } | null> {
    const fingerprint: string = this.buildFingerprint(prompt, punchline)
    const rows = await this.db
      .select({ id: jokeMemory.id })
      .from(jokeMemory)
      .where(eq(jokeMemory.fingerprint, fingerprint))
      .limit(1)
    return rows[0] ?? null
  }

  public async mergeCounters(
    documentId: string,
    merge: JokeMemoryCounterMerge
  ): Promise<void> {
    await this.db
      .update(jokeMemory)
      .set({
        votesFor: sql`${jokeMemory.votesFor} + ${merge.votesFor}`,
        votesAgainst: sql`${jokeMemory.votesAgainst} + ${merge.votesAgainst}`,
        ratingSum:
          merge.ratingSum !== undefined
            ? sql`COALESCE(${jokeMemory.ratingSum}, 0) + ${merge.ratingSum}`
            : jokeMemory.ratingSum,
        ratingCount:
          merge.ratingCount !== undefined
            ? sql`COALESCE(${jokeMemory.ratingCount}, 0) + ${merge.ratingCount}`
            : jokeMemory.ratingCount
      })
      .where(eq(jokeMemory.id, documentId))
  }

  public async findCandidatesForBot(input: {
    readonly queryEmbedding: readonly number[]
    readonly filter: CandidateFilter
    readonly limit: number
  }): Promise<readonly JokeMemoryCandidate[]> {
    const queryVectorLiteral: string = this.toVectorLiteral(input.queryEmbedding)
    const filterExpr = this.buildQualityFilter(input.filter)
    const rows = await this.db
      .select({
        id: jokeMemory.id,
        prompt: jokeMemory.prompt,
        punchline: jokeMemory.punchline,
        promptEmbedding: jokeMemory.promptEmbedding,
        adminScore: jokeMemory.adminScore,
        adminComment: jokeMemory.adminComment,
        ratingAverage: jokeMemory.ratingAverage,
        ratingCount: jokeMemory.ratingCount,
        ratingSum: jokeMemory.ratingSum,
        votesFor: jokeMemory.votesFor,
        votesAgainst: jokeMemory.votesAgainst,
        usedAsExampleCount: jokeMemory.usedAsExampleCount,
        source: jokeMemory.source
      })
      .from(jokeMemory)
      .where(and(isNotNull(jokeMemory.promptEmbedding), filterExpr))
      .orderBy(sql`${jokeMemory.promptEmbedding} <=> ${queryVectorLiteral}::vector`)
      .limit(input.limit)
    return rows
      .filter((row): row is typeof row & { promptEmbedding: number[] } => Array.isArray(row.promptEmbedding))
      .map((row) => ({
        id: row.id,
        prompt: row.prompt,
        punchline: row.punchline,
        promptEmbedding: row.promptEmbedding,
        adminScore: row.adminScore ?? undefined,
        adminComment: row.adminComment ?? undefined,
        ratingAverage: row.ratingAverage ?? undefined,
        ratingCount: row.ratingCount ?? undefined,
        ratingSum: row.ratingSum ?? undefined,
        votesFor: row.votesFor,
        votesAgainst: row.votesAgainst,
        usedAsExampleCount: row.usedAsExampleCount,
        source: row.source
      }))
  }

  public async markUsedAsExamples(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return
    }
    await this.db
      .update(jokeMemory)
      .set({
        usedAsExampleCount: sql`${jokeMemory.usedAsExampleCount} + 1`,
        lastUsedAsExampleAt: new Date()
      })
      .where(inArray(jokeMemory.id, [...ids]))
  }

  public async findRecent(limit: number): Promise<readonly JokeMemoryEntry[]> {
    const rows = await this.db
      .select()
      .from(jokeMemory)
      .orderBy(desc(jokeMemory.createdAt))
      .limit(limit)
    return rows.map((row) => this.toEntry(row))
  }

  private toEntry(row: typeof jokeMemory.$inferSelect): JokeMemoryEntry {
    return {
      prompt: row.prompt,
      punchline: row.punchline,
      promptNormalized: row.promptNormalized,
      fingerprint: row.fingerprint,
      promptEmbedding: row.promptEmbedding ?? undefined,
      embeddingModel: row.embeddingModel ?? undefined,
      votesFor: row.votesFor,
      votesAgainst: row.votesAgainst,
      voteShare: row.voteShare,
      qualityScore: row.qualityScore,
      ratingAverage: row.ratingAverage ?? undefined,
      ratingSum: row.ratingSum ?? undefined,
      ratingCount: row.ratingCount ?? undefined,
      adminScore: row.adminScore ?? undefined,
      adminScoredBy: row.adminScoredBy ?? undefined,
      adminScoredAt: row.adminScoredAt ?? undefined,
      adminComment: row.adminComment ?? undefined,
      usedAsExampleCount: row.usedAsExampleCount,
      lastUsedAsExampleAt: row.lastUsedAsExampleAt ?? undefined,
      authorUserId: row.authorUserId ?? undefined,
      authorRealName: row.authorRealName ?? undefined,
      source: row.source,
      roomCode: row.roomCode,
      roundIndex: row.roundIndex,
      createdAt: row.createdAt
    }
  }

  private buildFingerprint(prompt: string, punchline: string): string {
    return `${prompt.toLowerCase().trim()}::${punchline.toLowerCase().trim()}`
  }

  private buildQualityFilter(filter: CandidateFilter) {
    if (filter === 'positive') {
      return or(
        gte(jokeMemory.adminScore, POSITIVE_ADMIN_SCORE_MIN),
        and(
          gte(jokeMemory.ratingAverage, POSITIVE_RATING_AVG_MIN),
          gte(jokeMemory.ratingCount, RATING_COUNT_MIN)
        )
      )
    }
    return or(
      and(
        isNotNull(jokeMemory.adminScore),
        lte(jokeMemory.adminScore, NEGATIVE_ADMIN_SCORE_MAX)
      ),
      and(
        lte(jokeMemory.ratingAverage, NEGATIVE_RATING_AVG_MAX),
        gte(jokeMemory.ratingCount, RATING_COUNT_MIN)
      )
    )
  }

  private toVectorLiteral(vec: readonly number[]): string {
    return `[${vec.join(',')}]`
  }

  public async findPaginatedForAdmin(input: {
    readonly page: number
    readonly limit: number
    readonly sort: 'createdAt' | 'adminScore' | 'ratingAverage' | 'voteShare' | 'qualityScore'
    readonly order: 'asc' | 'desc'
    readonly search?: string
    readonly source?: 'human' | 'bot'
    readonly hasAdminScore?: 'yes' | 'no'
    readonly hasRating?: 'yes' | 'no'
    readonly isSeed?: 'yes' | 'no'
  }): Promise<{
    readonly items: readonly JokeMemoryEntry[]
    readonly total: number
  }> {
    const offset: number = Math.max(0, (input.page - 1) * input.limit)
    const conditions: SQLWrapper[] = []
    if (input.search && input.search.trim().length > 0) {
      const term: string = `%${input.search.trim()}%`
      const orExpr = or(ilike(jokeMemory.punchline, term), ilike(jokeMemory.prompt, term))
      if (orExpr) {
        conditions.push(orExpr)
      }
    }
    if (input.source === 'human' || input.source === 'bot') {
      conditions.push(eq(jokeMemory.source, input.source))
    }
    if (input.hasAdminScore === 'yes') {
      conditions.push(isNotNull(jokeMemory.adminScore))
    } else if (input.hasAdminScore === 'no') {
      conditions.push(isNull(jokeMemory.adminScore))
    }
    if (input.hasRating === 'yes') {
      conditions.push(gte(jokeMemory.ratingCount, 1))
    } else if (input.hasRating === 'no') {
      conditions.push(or(isNull(jokeMemory.ratingCount), eq(jokeMemory.ratingCount, 0)) as SQLWrapper)
    }
    if (input.isSeed === 'yes') {
      conditions.push(eq(jokeMemory.isSeed, true))
    } else if (input.isSeed === 'no') {
      conditions.push(eq(jokeMemory.isSeed, false))
    }
    const whereExpr: SQL | undefined = conditions.length > 0 ? and(...conditions) : undefined

    const orderDir = input.order === 'asc' ? asc : desc
    let orderExpr: SQL
    switch (input.sort) {
      case 'adminScore':
        orderExpr = orderDir(jokeMemory.adminScore)
        break
      case 'ratingAverage':
        orderExpr = orderDir(jokeMemory.ratingAverage)
        break
      case 'voteShare':
        orderExpr = orderDir(jokeMemory.voteShare)
        break
      case 'qualityScore':
        orderExpr = orderDir(jokeMemory.qualityScore)
        break
      case 'createdAt':
      default:
        orderExpr = orderDir(jokeMemory.createdAt)
        break
    }

    const [rows, totalRows] = await Promise.all([
      this.db.select().from(jokeMemory).where(whereExpr).orderBy(orderExpr).limit(input.limit).offset(offset),
      this.db.select({ value: count() }).from(jokeMemory).where(whereExpr)
    ])
    return {
      items: rows.map((row) => this.toAdminEntry(row)),
      total: totalRows[0]?.value ?? 0
    }
  }

  public async findOneForAdmin(id: string): Promise<JokeMemoryEntry | null> {
    const rows = await this.db.select().from(jokeMemory).where(eq(jokeMemory.id, id)).limit(1)
    const row = rows[0]
    return row ? this.toAdminEntry(row) : null
  }

  public async updateAdminFields(
    id: string,
    input: {
      readonly adminScore?: number | null
      readonly adminComment?: string | null
      readonly adminScoredBy?: string
    }
  ): Promise<void> {
    const set: Record<string, unknown> = {}
    if (input.adminScore !== undefined) {
      set.adminScore = input.adminScore
      set.adminScoredAt = input.adminScore !== null ? new Date() : null
      if (input.adminScoredBy !== undefined) {
        set.adminScoredBy = input.adminScoredBy
      }
    }
    if (input.adminComment !== undefined) {
      set.adminComment = input.adminComment
    }
    if (Object.keys(set).length === 0) {
      return
    }
    await this.db.update(jokeMemory).set(set).where(eq(jokeMemory.id, id))
  }

  public async deleteById(id: string): Promise<void> {
    await this.db.delete(jokeMemory).where(eq(jokeMemory.id, id))
  }

  private toAdminEntry(row: typeof jokeMemory.$inferSelect): JokeMemoryEntry {
    return {
      id: row.id,
      prompt: row.prompt,
      punchline: row.punchline,
      promptNormalized: row.promptNormalized,
      fingerprint: row.fingerprint,
      voteShare: row.voteShare,
      qualityScore: row.qualityScore,
      ratingAverage: row.ratingAverage ?? undefined,
      ratingSum: row.ratingSum ?? undefined,
      ratingCount: row.ratingCount ?? undefined,
      votesFor: row.votesFor,
      votesAgainst: row.votesAgainst,
      adminScore: row.adminScore ?? undefined,
      adminScoredBy: row.adminScoredBy ?? undefined,
      adminScoredAt: row.adminScoredAt ?? undefined,
      adminComment: row.adminComment ?? undefined,
      usedAsExampleCount: row.usedAsExampleCount,
      lastUsedAsExampleAt: row.lastUsedAsExampleAt ?? undefined,
      authorUserId: row.authorUserId ?? undefined,
      authorRealName: row.authorRealName ?? undefined,
      source: row.source,
      roomCode: row.roomCode,
      roundIndex: row.roundIndex,
      createdAt: row.createdAt
    }
  }
}
