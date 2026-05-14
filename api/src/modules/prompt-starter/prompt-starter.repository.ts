import { Inject, Injectable } from '@nestjs/common'
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, notInArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { DATABASE } from '../../db/db.module'
import { promptStarters } from '../../db/schema/prompt-starter.schema'
import {
  promptStarterCompletions,
  type PromptStarterCompletionRow
} from '../../db/schema/prompt-starter-completion.schema'
import { Db } from '../../db/db.types'
import { PromptCompletion, PromptStarterEntry } from './models/prompt-starter-entry.type'
import { PushCompletionInput } from './models/push-completion-input.type'

type PromptStarterColumnRow = typeof promptStarters.$inferSelect

@Injectable()
export class PromptStarterRepository {
  public constructor(@Inject(DATABASE) private readonly db: Db) {}

  public async selectRandom(input: {
    readonly count: number
    readonly excludedTexts: readonly string[]
  }): Promise<readonly PromptStarterEntry[]> {
    if (input.count <= 0) {
      return []
    }
    const poolSize: number = input.count * input.count
    const whereExpr =
      input.excludedTexts.length > 0
        ? notInArray(promptStarters.text, [...input.excludedTexts])
        : undefined

    const candidates = await this.db
      .select()
      .from(promptStarters)
      .where(whereExpr)
      .orderBy(asc(promptStarters.usedCount))
      .limit(poolSize)

    const shuffled = this.shuffle(candidates).slice(0, input.count)
    return shuffled.map((row) => this.toEntry(row, []))
  }

  public async incrementUsedCount(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return
    }
    await this.db
      .update(promptStarters)
      .set({ usedCount: sql`${promptStarters.usedCount} + 1` })
      .where(inArray(promptStarters.id, [...ids]))
  }

  public async upsertMany(texts: readonly string[]): Promise<void> {
    if (texts.length === 0) {
      return
    }
    const values = texts.map((text) => ({ text }))
    await this.db.insert(promptStarters).values(values).onConflictDoNothing({
      target: promptStarters.text
    })
  }

  public async pushCompletion(input: PushCompletionInput): Promise<void> {
    const total: number = input.votesFor + input.votesAgainst
    const voteShare: number = total > 0 ? input.votesFor / total : 0.5

    const upserted = await this.db
      .insert(promptStarters)
      .values({ text: input.promptText })
      .onConflictDoUpdate({
        target: promptStarters.text,
        set: { text: input.promptText }
      })
      .returning({ id: promptStarters.id })

    const promptStarterId: string | undefined = upserted[0]?.id
    if (!promptStarterId) {
      return
    }

    await this.db.insert(promptStarterCompletions).values({
      promptStarterId,
      punchline: input.punchline,
      source: input.source,
      votesFor: input.votesFor,
      votesAgainst: input.votesAgainst,
      voteShare,
      ratingAverage: input.ratingAverage,
      ratingCount: input.ratingCount,
      roomCode: input.roomCode,
      roundIndex: input.roundIndex
    })
  }

  public async findBestCompletions(input: {
    readonly promptText: string
    readonly limit: number
    readonly minVoteShare: number
  }): Promise<readonly PromptCompletion[]> {
    const rows = await this.db
      .select({
        punchline: promptStarterCompletions.punchline,
        source: promptStarterCompletions.source,
        votesFor: promptStarterCompletions.votesFor,
        votesAgainst: promptStarterCompletions.votesAgainst,
        voteShare: promptStarterCompletions.voteShare,
        ratingAverage: promptStarterCompletions.ratingAverage,
        ratingCount: promptStarterCompletions.ratingCount,
        roomCode: promptStarterCompletions.roomCode,
        roundIndex: promptStarterCompletions.roundIndex,
        createdAt: promptStarterCompletions.createdAt
      })
      .from(promptStarterCompletions)
      .innerJoin(promptStarters, eq(promptStarterCompletions.promptStarterId, promptStarters.id))
      .where(
        and(
          eq(promptStarters.text, input.promptText),
          sql`${promptStarterCompletions.voteShare} >= ${input.minVoteShare}`
        )
      )
      .orderBy(desc(promptStarterCompletions.voteShare))
      .limit(input.limit)
    return rows.map((row) => this.toCompletion(row))
  }

  public async findPaginated(input: {
    readonly page: number
    readonly limit: number
    readonly sort: string
    readonly order: 'asc' | 'desc'
    readonly search?: string
    readonly hasAdminScore?: 'yes' | 'no'
    readonly isSeed?: 'yes' | 'no'
    readonly isGolden?: 'yes' | 'no'
  }): Promise<{ readonly items: readonly PromptStarterEntry[]; readonly total: number }> {
    const offset: number = (input.page - 1) * input.limit
    const completionsCountExpr =
      sql<number>`(SELECT COUNT(*)::int FROM ${promptStarterCompletions} WHERE ${promptStarterCompletions.promptStarterId} = ${promptStarters.id})`.as(
        'completions_count'
      )

    const conditions: SQLWrapper[] = []
    if (input.search && input.search.trim().length > 0) {
      conditions.push(ilike(promptStarters.text, `%${input.search.trim()}%`))
    }
    if (input.hasAdminScore === 'yes') {
      conditions.push(isNotNull(promptStarters.adminScore))
    } else if (input.hasAdminScore === 'no') {
      conditions.push(isNull(promptStarters.adminScore))
    }
    if (input.isSeed === 'yes') {
      conditions.push(eq(promptStarters.isSeed, true))
    } else if (input.isSeed === 'no') {
      conditions.push(eq(promptStarters.isSeed, false))
    }
    if (input.isGolden === 'yes') {
      conditions.push(eq(promptStarters.isGolden, true))
    } else if (input.isGolden === 'no') {
      conditions.push(eq(promptStarters.isGolden, false))
    }
    const whereExpr: SQL | undefined = conditions.length > 0 ? and(...conditions) : undefined

    const orderExpr: SQL = this.resolvePaginatedOrder(input.sort, input.order, completionsCountExpr)

    const baseSelect = this.db
      .select({
        row: promptStarters,
        completionsCount: completionsCountExpr
      })
      .from(promptStarters)

    const [rows, totalRows] = await Promise.all([
      baseSelect.where(whereExpr).orderBy(orderExpr).limit(input.limit).offset(offset),
      this.db.select({ value: count() }).from(promptStarters).where(whereExpr)
    ])

    const ids = rows.map((entry) => entry.row.id)
    const completionsByPrompt = await this.loadCompletionsForPrompts(ids)
    const items = rows.map((entry) => this.toEntry(entry.row, completionsByPrompt.get(entry.row.id) ?? []))
    return { items, total: totalRows[0]?.value ?? 0 }
  }

  public async updateAdminFields(
    id: string,
    input: {
      readonly text?: string
      readonly adminScore?: number | null
      readonly adminComment?: string | null
      readonly adminScoredBy?: string
      readonly isGolden?: boolean
    }
  ): Promise<void> {
    const set: Record<string, unknown> = {}
    if (input.text !== undefined) {
      set.text = input.text
    }
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
    if (input.isGolden !== undefined) {
      set.isGolden = input.isGolden
      if (input.isGolden) {
        set.goldenSince = new Date()
      }
    }
    if (Object.keys(set).length === 0) {
      return
    }
    await this.db.update(promptStarters).set(set).where(eq(promptStarters.id, id))
  }

  public async findById(id: string): Promise<PromptStarterEntry | null> {
    const rows = await this.db
      .select()
      .from(promptStarters)
      .where(eq(promptStarters.id, id))
      .limit(1)
    const row = rows[0]
    if (!row) {
      return null
    }
    const completionsByPrompt = await this.loadCompletionsForPrompts([id])
    return this.toEntry(row, completionsByPrompt.get(id) ?? [])
  }

  public async findByText(text: string): Promise<PromptStarterEntry | null> {
    const rows = await this.db
      .select()
      .from(promptStarters)
      .where(eq(promptStarters.text, text))
      .limit(1)
    const row = rows[0]
    if (!row) {
      return null
    }
    const completionsByPrompt = await this.loadCompletionsForPrompts([row.id])
    return this.toEntry(row, completionsByPrompt.get(row.id) ?? [])
  }

  public async updateText(id: string, text: string): Promise<void> {
    await this.db.update(promptStarters).set({ text }).where(eq(promptStarters.id, id))
  }

  public async deleteById(id: string): Promise<void> {
    await this.db.delete(promptStarters).where(eq(promptStarters.id, id))
  }

  public async removeCompletion(id: string, completionIndex: number): Promise<void> {
    if (completionIndex < 0) {
      return
    }
    const rows = await this.db
      .select({ id: promptStarterCompletions.id })
      .from(promptStarterCompletions)
      .where(eq(promptStarterCompletions.promptStarterId, id))
      .orderBy(asc(promptStarterCompletions.createdAt))
      .limit(1)
      .offset(completionIndex)
    const target = rows[0]
    if (!target) {
      return
    }
    await this.db.delete(promptStarterCompletions).where(eq(promptStarterCompletions.id, target.id))
  }

  public async findGolden(limit: number): Promise<readonly PromptStarterEntry[]> {
    const rows = await this.db
      .select()
      .from(promptStarters)
      .where(eq(promptStarters.isGolden, true))
      .orderBy(desc(promptStarters.averageCompletionRating))
      .limit(limit)
    return rows.map((row) => this.toEntry(row, []))
  }

  public async upsertGolden(input: {
    readonly text: string
    readonly averageCompletionRating: number
    readonly averageVoteShare: number
  }): Promise<void> {
    await this.db
      .insert(promptStarters)
      .values({
        text: input.text,
        isGolden: true,
        averageCompletionRating: input.averageCompletionRating,
        averageVoteShare: input.averageVoteShare,
        goldenSince: new Date()
      })
      .onConflictDoUpdate({
        target: promptStarters.text,
        set: {
          isGolden: true,
          averageCompletionRating: input.averageCompletionRating,
          averageVoteShare: input.averageVoteShare,
          goldenSince: new Date()
        }
      })
  }

  public async findAllTexts(): Promise<readonly string[]> {
    const rows = await this.db.select({ text: promptStarters.text }).from(promptStarters)
    return rows.map((row) => row.text)
  }

  public async count(): Promise<number> {
    const rows = await this.db.select({ value: count() }).from(promptStarters)
    return rows[0]?.value ?? 0
  }

  public async applyQuickFeedback(text: string, level: number): Promise<void> {
    await this.db
      .update(promptStarters)
      .set({
        feedbackSum: sql`${promptStarters.feedbackSum} + ${level}`,
        feedbackCount: sql`${promptStarters.feedbackCount} + 1`,
        feedbackScore: sql`(${promptStarters.feedbackSum} + ${level}) / (${promptStarters.feedbackCount} + 1)::real`
      })
      .where(eq(promptStarters.text, text))
  }

  public async findLowRatedOpenings(input: {
    readonly limit: number
    readonly maxFeedbackScore: number
    readonly maxAdminScore: number
    readonly minVotes: number
  }): Promise<readonly { readonly text: string; readonly score: number; readonly adminComment?: string }[]> {
    const rows = await this.db
      .select({
        text: promptStarters.text,
        feedbackScore: promptStarters.feedbackScore,
        adminScore: promptStarters.adminScore,
        adminComment: promptStarters.adminComment
      })
      .from(promptStarters)
      .where(
        sql`(${promptStarters.feedbackScore} <= ${input.maxFeedbackScore} AND ${promptStarters.feedbackCount} >= ${input.minVotes}) OR (${promptStarters.adminScore} <= ${input.maxAdminScore})`
      )
      .orderBy(asc(promptStarters.feedbackScore), asc(promptStarters.adminScore))
      .limit(input.limit)
    return rows.map((row) => ({
      text: row.text,
      score: row.adminScore ?? row.feedbackScore,
      adminComment: row.adminComment ?? undefined
    }))
  }

  public async findMaxSimilarityToHistory(embedding: readonly number[]): Promise<number> {
    if (embedding.length === 0) {
      return 0
    }
    const literal: string = `[${embedding.join(',')}]`
    const rows = await this.db
      .select({
        maxSimilarity: sql<number>`COALESCE(MAX(1 - (${promptStarters.textEmbedding} <=> ${literal}::vector)), 0)`
      })
      .from(promptStarters)
      .where(sql`${promptStarters.textEmbedding} IS NOT NULL`)
    return rows[0]?.maxSimilarity ?? 0
  }

  public async upsertWithEmbedding(
    text: string,
    embedding: readonly number[],
    embeddingModel: string
  ): Promise<void> {
    const vector: number[] = [...embedding]
    await this.db
      .insert(promptStarters)
      .values({ text, textEmbedding: vector, embeddingModel })
      .onConflictDoUpdate({
        target: promptStarters.text,
        set: {
          textEmbedding: sql`COALESCE(${promptStarters.textEmbedding}, EXCLUDED.text_embedding)`,
          embeddingModel: sql`COALESCE(${promptStarters.embeddingModel}, EXCLUDED.embedding_model)`
        }
      })
  }

  private async loadCompletionsForPrompts(
    ids: readonly string[]
  ): Promise<Map<string, PromptCompletion[]>> {
    const result: Map<string, PromptCompletion[]> = new Map()
    if (ids.length === 0) {
      return result
    }
    const rows = await this.db
      .select()
      .from(promptStarterCompletions)
      .where(inArray(promptStarterCompletions.promptStarterId, [...ids]))
      .orderBy(asc(promptStarterCompletions.createdAt))
    for (const row of rows) {
      const list = result.get(row.promptStarterId) ?? []
      list.push(this.toCompletion(row))
      result.set(row.promptStarterId, list)
    }
    return result
  }

  private resolvePaginatedOrder(
    sortField: string,
    order: 'asc' | 'desc',
    completionsCountExpr: SQL.Aliased<number>
  ): SQL {
    const direction = order === 'asc' ? asc : desc
    switch (sortField) {
      case 'completionsCount':
        return direction(completionsCountExpr)
      case 'usedCount':
        return direction(promptStarters.usedCount)
      case 'createdAt':
        return direction(promptStarters.createdAt)
      case 'text':
        return direction(promptStarters.text)
      case 'feedbackScore':
        return direction(promptStarters.feedbackScore)
      case 'adminScore':
        return direction(promptStarters.adminScore)
      case 'derivedScore':
        return direction(promptStarters.derivedScore)
      case 'usedAsExampleCount':
        return direction(promptStarters.usedAsExampleCount)
      default:
        return direction(promptStarters.createdAt)
    }
  }

  private toEntry(
    row: PromptStarterColumnRow,
    completions: readonly PromptCompletion[]
  ): PromptStarterEntry {
    return {
      _id: row.id,
      text: row.text,
      usedCount: row.usedCount,
      completions,
      isGolden: row.isGolden,
      averageCompletionRating: row.averageCompletionRating ?? undefined,
      averageVoteShare: row.averageVoteShare ?? undefined,
      goldenSince: row.goldenSince ?? undefined,
      userQuickFeedback: {
        sum: row.feedbackSum,
        count: row.feedbackCount
      },
      feedbackScore: row.feedbackScore,
      adminScore: row.adminScore ?? undefined,
      adminScoredBy: row.adminScoredBy ?? undefined,
      adminScoredAt: row.adminScoredAt ?? undefined,
      adminComment: row.adminComment ?? undefined,
      derivedScore: row.derivedScore ?? undefined,
      usedAsExampleCount: row.usedAsExampleCount,
      lastUsedAsExampleAt: row.lastUsedAsExampleAt ?? undefined,
      textEmbedding: row.textEmbedding ?? undefined,
      embeddingModel: row.embeddingModel ?? undefined
    }
  }

  private toCompletion(
    row: Pick<
      PromptStarterCompletionRow,
      | 'punchline'
      | 'source'
      | 'votesFor'
      | 'votesAgainst'
      | 'voteShare'
      | 'ratingAverage'
      | 'ratingCount'
      | 'roomCode'
      | 'roundIndex'
      | 'createdAt'
    >
  ): PromptCompletion {
    return {
      punchline: row.punchline,
      source: row.source,
      votesFor: row.votesFor,
      votesAgainst: row.votesAgainst,
      voteShare: row.voteShare,
      ratingAverage: row.ratingAverage ?? undefined,
      ratingCount: row.ratingCount ?? undefined,
      roomCode: row.roomCode,
      roundIndex: row.roundIndex,
      createdAt: row.createdAt
    }
  }

  private shuffle<T>(items: readonly T[]): T[] {
    const result: T[] = [...items]
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1))
      ;[result[index], result[swap]] = [result[swap], result[index]]
    }
    return result
  }
}
