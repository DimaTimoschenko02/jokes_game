import { Injectable } from '@nestjs/common'
import { EmbeddingService } from '../embedding/embedding.service'
import { FinetuneSample } from './models/finetune-sample.type'
import { JokeMemoryEntry } from './models/joke-memory-entry.type'
import { JokeMemoryExample } from './models/joke-memory-example.type'
import { JokeMemoryRecordInput } from './models/joke-memory-record-input.type'
import { JokeMemoryRetrievalInput } from './models/joke-memory-retrieval-input.type'
import { JokeMemoryRepository } from './joke-memory.repository'

const MIN_TEXT_LENGTH: number = 4
const MAX_TEXT_LENGTH: number = 140
const RECENT_POOL_SIZE: number = 600
const RETRIEVAL_DEFAULT_LIMIT: number = 4
const MIN_VOTE_SHARE_DEFAULT: number = 0.5
const MIN_IMPRESSIONS_DEFAULT: number = 2
const VECTOR_SIMILARITY_MIN: number = 0.25

type RecordQueueItem = {
  readonly payload: JokeMemoryRecordInput
}

@Injectable()
export class JokeMemoryService {
  private readonly recordQueue: RecordQueueItem[] = []
  private isProcessingQueue: boolean = false

  public constructor(
    private readonly jokeMemoryRepository: JokeMemoryRepository,
    private readonly embeddingService: EmbeddingService
  ) {}

  public executeEnqueueRecordJoke(input: JokeMemoryRecordInput): void {
    this.recordQueue.push({ payload: input })
    this.processQueueIfNeeded()
  }

  private async executeRecordJoke(input: JokeMemoryRecordInput): Promise<void> {
    const prompt = this.normalizeText(input.prompt)
    const punchline = this.normalizeText(input.punchline)
    if (!this.isValidText(prompt) || !this.isValidText(punchline)) {
      return
    }
    const votesFor = Math.max(0, Math.floor(input.votesFor))
    const votesAgainst = Math.max(0, Math.floor(input.votesAgainst))
    const voteShare = this.calculateVoteShare(votesFor, votesAgainst)
    const ratingAverage = this.normalizeRatingAverage(input.ratingAverage)
    const ratingCount = this.normalizeRatingCount(input.ratingCount)
    const qualityScore = this.calculateQualityScore(votesFor, votesAgainst, ratingAverage, ratingCount)
    const embedding = await this.embeddingService.executeEmbedText({ text: prompt })
    await this.jokeMemoryRepository.createEntry({
      prompt,
      punchline,
      votesFor,
      votesAgainst,
      voteShare,
      qualityScore,
      ratingAverage: ratingAverage ?? undefined,
      ratingCount: ratingCount ?? undefined,
      promptEmbedding: embedding?.vector,
      embeddingModel: embedding?.model,
      source: input.source,
      roomCode: input.roomCode,
      roundIndex: input.roundIndex
    })
  }

  public async executeRetrieveExamples(input: Partial<JokeMemoryRetrievalInput> & { readonly prompt: string }): Promise<readonly JokeMemoryExample[]> {
    const normalizedPrompt = this.normalizeText(input.prompt)
    if (!this.isValidText(normalizedPrompt)) {
      return []
    }
    const queryEmbedding = await this.embeddingService.executeEmbedText({ text: normalizedPrompt })
    const pool = await this.jokeMemoryRepository.findRecent(RECENT_POOL_SIZE)
    const deduped = this.deduplicateByFingerprint(pool)
    const filtered = deduped.filter((entry) =>
      this.isRetrievalCandidate(
        entry,
        input.minVoteShare ?? MIN_VOTE_SHARE_DEFAULT,
        input.minImpressions ?? MIN_IMPRESSIONS_DEFAULT
      )
    )
    const ranked = filtered
      .map((entry) => ({
        entry,
        rank: this.calculateRank(normalizedPrompt, entry, queryEmbedding?.vector ?? null)
      }))
      .filter((row) => row.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, input.limit ?? RETRIEVAL_DEFAULT_LIMIT)
      .map((row) => this.toExample(row.entry))
    return ranked
  }

  public async executeBuildFinetuneDataset(limit: number): Promise<readonly FinetuneSample[]> {
    const rows = await this.jokeMemoryRepository.findRecent(limit)
    return rows
      .filter((row) => row.qualityScore >= 0.45)
      .map((row) => ({
        system: 'You are a witty Russian party game player.',
        user: `Unfinished sentence: "${row.prompt}"`,
        assistant: row.punchline,
        weight: Number(row.qualityScore.toFixed(4))
      }))
  }

  private normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH)
  }

  private isValidText(value: string): boolean {
    return value.length >= MIN_TEXT_LENGTH
  }

  private calculateVoteShare(votesFor: number, votesAgainst: number): number {
    const total = votesFor + votesAgainst
    if (total <= 0) {
      return 0.5
    }
    return votesFor / total
  }

  private calculateQualityScore(
    votesFor: number,
    votesAgainst: number,
    ratingAverage: number | null,
    ratingCount: number | null
  ): number {
    const total = votesFor + votesAgainst
    const smoothed = (votesFor + 1) / (total + 2)
    if (!ratingAverage || !ratingCount || ratingCount <= 0) {
      return Number(smoothed.toFixed(4))
    }
    const ratingNormalized = Math.min(1, Math.max(0, ratingAverage / 10))
    const blended = ratingNormalized * 0.6 + smoothed * 0.4
    return Number(blended.toFixed(4))
  }

  private deduplicateByFingerprint(rows: readonly JokeMemoryEntry[]): readonly JokeMemoryEntry[] {
    const seen = new Set<string>()
    const deduped: JokeMemoryEntry[] = []
    for (const row of rows) {
      const key = `${row.prompt.toLowerCase()}::${row.punchline.toLowerCase()}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      deduped.push(row)
    }
    return deduped
  }

  private isRetrievalCandidate(entry: JokeMemoryEntry, minVoteShare: number, minImpressions: number): boolean {
    const impressions = entry.votesFor + entry.votesAgainst
    return entry.voteShare >= minVoteShare && impressions >= minImpressions
  }

  private calculateRank(prompt: string, entry: JokeMemoryEntry, queryVector: readonly number[] | null): number {
    const lexicalScore = this.calculatePromptSimilarity(prompt, entry.prompt)
    const vectorScore = this.calculateVectorSimilarity(queryVector, entry.promptEmbedding)
    if (lexicalScore <= 0 && vectorScore <= 0) {
      return 0
    }
    const freshnessScore = this.calculateFreshness(entry.createdAt)
    const qualityScore = entry.qualityScore
    const combinedSimilarity = this.combineSimilarityScores(lexicalScore, vectorScore)
    return combinedSimilarity * 0.55 + qualityScore * 0.35 + freshnessScore * 0.1
  }

  private calculatePromptSimilarity(basePrompt: string, candidatePrompt: string): number {
    const leftTokens = this.tokenize(basePrompt)
    const rightTokens = this.tokenize(candidatePrompt)
    if (leftTokens.length === 0 || rightTokens.length === 0) {
      return 0
    }
    const leftSet = new Set<string>(leftTokens)
    const rightSet = new Set<string>(rightTokens)
    let intersection = 0
    leftSet.forEach((token) => {
      if (rightSet.has(token)) {
        intersection += 1
      }
    })
    const unionSize = leftSet.size + rightSet.size - intersection
    if (unionSize <= 0) {
      return 0
    }
    return intersection / unionSize
  }

  private calculateVectorSimilarity(
    queryVector: readonly number[] | null,
    candidateVector?: readonly number[]
  ): number {
    if (!queryVector || !candidateVector || queryVector.length === 0 || candidateVector.length === 0) {
      return 0
    }
    const similarity = this.cosineSimilarity(queryVector, candidateVector)
    return similarity >= VECTOR_SIMILARITY_MIN ? similarity : 0
  }

  private cosineSimilarity(left: readonly number[], right: readonly number[]): number {
    const length = Math.min(left.length, right.length)
    let dot = 0
    let leftNorm = 0
    let rightNorm = 0
    for (let index = 0; index < length; index += 1) {
      const leftValue = left[index]
      const rightValue = right[index]
      dot += leftValue * rightValue
      leftNorm += leftValue * leftValue
      rightNorm += rightValue * rightValue
    }
    if (leftNorm <= 0 || rightNorm <= 0) {
      return 0
    }
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
  }

  private combineSimilarityScores(lexicalScore: number, vectorScore: number): number {
    if (vectorScore <= 0) {
      return lexicalScore
    }
    if (lexicalScore <= 0) {
      return vectorScore
    }
    return Math.max(lexicalScore, vectorScore)
  }

  private normalizeRatingAverage(value: number | undefined): number | null {
    if (value === undefined || value === null) {
      return null
    }
    if (!Number.isFinite(value)) {
      return null
    }
    return Math.min(10, Math.max(1, Number(value)))
  }

  private normalizeRatingCount(value: number | undefined): number | null {
    if (value === undefined || value === null) {
      return null
    }
    if (!Number.isFinite(value)) {
      return null
    }
    return Math.max(0, Math.floor(value))
  }

  private tokenize(value: string): readonly string[] {
    return value
      .toLowerCase()
      .split(/[^a-zа-я0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
  }

  private calculateFreshness(createdAt: Date): number {
    const ageMs = Date.now() - createdAt.getTime()
    const weekMs = 7 * 24 * 60 * 60 * 1000
    const normalized = 1 - Math.min(1, ageMs / weekMs)
    return Number(normalized.toFixed(4))
  }

  private toExample(entry: JokeMemoryEntry): JokeMemoryExample {
    return {
      prompt: entry.prompt,
      punchline: entry.punchline,
      voteShare: entry.voteShare,
      qualityScore: entry.qualityScore,
      source: entry.source,
      createdAt: entry.createdAt
    }
  }

  private processQueueIfNeeded(): void {
    if (this.isProcessingQueue) {
      return
    }
    this.isProcessingQueue = true
    void this.processNextQueueItem()
  }

  private async processNextQueueItem(): Promise<void> {
    const next = this.recordQueue.shift()
    if (!next) {
      this.isProcessingQueue = false
      return
    }
    await this.executeRecordJoke(next.payload)
    setTimeout(() => {
      void this.processNextQueueItem()
    }, 0)
  }
}
