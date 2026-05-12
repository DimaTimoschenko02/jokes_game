import { Inject, Injectable } from '@nestjs/common'
import { desc, eq, sql } from 'drizzle-orm'
import { DATABASE } from '../../db/db.module'
import { jokeMemory } from '../../db/schema/joke-memory.schema'
import { Db } from '../../db/db.types'
import { JokeMemoryEntry } from './models/joke-memory-entry.type'
import { JokeMemoryWriteInput } from './models/joke-memory-write-input.type'

export type JokeMemoryCounterMerge = {
  readonly votesFor: number
  readonly votesAgainst: number
  readonly ratingSum?: number
  readonly ratingCount?: number
}

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
}
