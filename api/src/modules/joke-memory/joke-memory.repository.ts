import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { JokeMemoryEntry } from './models/joke-memory-entry.type'
import { JokeMemoryDocument, JokeMemoryDocumentModel } from './schemas/joke-memory.schema'
import { JokeMemoryWriteInput } from './models/joke-memory-write-input.type'

export type JokeMemoryCounterMerge = {
  readonly votesFor: number
  readonly votesAgainst: number
  readonly ratingSum?: number
  readonly ratingCount?: number
}

@Injectable()
export class JokeMemoryRepository {
  public constructor(
    @InjectModel(JokeMemoryDocumentModel.name)
    private readonly jokeMemoryModel: Model<JokeMemoryDocument>
  ) {}

  public async createEntry(input: JokeMemoryWriteInput): Promise<void> {
    await this.jokeMemoryModel.create({
      prompt: input.prompt,
      punchline: input.punchline,
      promptNormalized: input.prompt.toLowerCase(),
      fingerprint: this.buildFingerprint(input.prompt, input.punchline),
      promptEmbedding: input.promptEmbedding ? Array.from(input.promptEmbedding) : undefined,
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
  }

  public async findByFingerprint(
    prompt: string,
    punchline: string
  ): Promise<JokeMemoryDocument | null> {
    const fingerprint: string = this.buildFingerprint(prompt, punchline)
    return this.jokeMemoryModel.findOne({ fingerprint }).exec()
  }

  public async mergeCounters(
    documentId: string,
    merge: JokeMemoryCounterMerge
  ): Promise<void> {
    const inc: Record<string, number> = {
      votesFor: merge.votesFor,
      votesAgainst: merge.votesAgainst
    }
    if (merge.ratingSum !== undefined) {
      inc.ratingSum = merge.ratingSum
    }
    if (merge.ratingCount !== undefined) {
      inc.ratingCount = merge.ratingCount
    }
    await this.jokeMemoryModel.updateOne({ _id: documentId }, { $inc: inc }).exec()
  }

  public async findRecent(limit: number): Promise<readonly JokeMemoryEntry[]> {
    return this.jokeMemoryModel
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<JokeMemoryEntry[]>()
      .exec()
  }

  private buildFingerprint(prompt: string, punchline: string): string {
    return `${prompt.toLowerCase().trim()}::${punchline.toLowerCase().trim()}`
  }
}
