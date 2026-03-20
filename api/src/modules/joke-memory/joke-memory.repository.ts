import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { JokeMemoryEntry } from './models/joke-memory-entry.type'
import { JokeMemoryDocument, JokeMemoryDocumentModel } from './schemas/joke-memory.schema'
import { JokeMemoryWriteInput } from './models/joke-memory-write-input.type'

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
      fingerprint: `${input.prompt.toLowerCase()}::${input.punchline.toLowerCase()}`,
      promptEmbedding: input.promptEmbedding ? Array.from(input.promptEmbedding) : undefined,
      embeddingModel: input.embeddingModel,
      votesFor: input.votesFor,
      votesAgainst: input.votesAgainst,
      voteShare: input.voteShare,
      qualityScore: input.qualityScore,
      ratingAverage: input.ratingAverage,
      ratingCount: input.ratingCount,
      source: input.source,
      roomCode: input.roomCode,
      roundIndex: input.roundIndex
    })
  }

  public async findRecent(limit: number): Promise<readonly JokeMemoryEntry[]> {
    return this.jokeMemoryModel
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<JokeMemoryEntry[]>()
      .exec()
  }
}
