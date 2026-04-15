import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { PromptCompletion, PromptStarterEntry } from './models/prompt-starter-entry.type'
import { PushCompletionInput } from './models/push-completion-input.type'
import { PromptStarterDocument, PromptStarterDocumentModel } from './schemas/prompt-starter.schema'

@Injectable()
export class PromptStarterRepository {
  public constructor(
    @InjectModel(PromptStarterDocumentModel.name)
    private readonly model: Model<PromptStarterDocument>
  ) {}

  public async selectRandom(input: {
    readonly count: number
    readonly excludedTexts: readonly string[]
  }): Promise<readonly PromptStarterEntry[]> {
    const poolSize = input.count * input.count
    return this.model.aggregate<PromptStarterEntry>([
      { $match: { text: { $nin: input.excludedTexts } } },
      { $sort: { usedCount: 1 } },
      { $limit: poolSize },
      { $sample: { size: input.count } }
    ])
  }

  public async incrementUsedCount(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return
    }
    await this.model.bulkWrite(
      ids.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: { $inc: { usedCount: 1 } }
        }
      }))
    )
  }

  public async upsertMany(texts: readonly string[]): Promise<void> {
    if (texts.length === 0) {
      return
    }
    await this.model.bulkWrite(
      texts.map((text) => ({
        updateOne: {
          filter: { text },
          update: { $setOnInsert: { text, usedCount: 0, completions: [] } },
          upsert: true
        }
      })),
      { ordered: false }
    )
  }

  public async pushCompletion(input: PushCompletionInput): Promise<void> {
    const total = input.votesFor + input.votesAgainst
    const voteShare = total > 0 ? input.votesFor / total : 0.5
    const completion: PromptCompletion = {
      punchline: input.punchline,
      source: input.source,
      votesFor: input.votesFor,
      votesAgainst: input.votesAgainst,
      voteShare,
      ratingAverage: input.ratingAverage,
      ratingCount: input.ratingCount,
      roomCode: input.roomCode,
      roundIndex: input.roundIndex,
      createdAt: new Date()
    }
    await this.model.updateOne(
      { text: input.promptText },
      {
        $push: { completions: completion },
        $setOnInsert: { text: input.promptText, usedCount: 0 }
      },
      { upsert: true }
    )
  }

  public async findBestCompletions(input: {
    readonly promptText: string
    readonly limit: number
    readonly minVoteShare: number
  }): Promise<readonly PromptCompletion[]> {
    const result = await this.model.aggregate<{ completions: PromptCompletion[] }>([
      { $match: { text: input.promptText } },
      { $unwind: '$completions' },
      { $match: { 'completions.voteShare': { $gte: input.minVoteShare } } },
      { $sort: { 'completions.voteShare': -1 } },
      { $limit: input.limit },
      { $group: { _id: null, completions: { $push: '$completions' } } }
    ])
    return result[0]?.completions ?? []
  }

  public async findPaginated(input: {
    readonly page: number
    readonly limit: number
    readonly sort: string
    readonly order: 'asc' | 'desc'
  }): Promise<{ readonly items: readonly PromptStarterEntry[]; readonly total: number }> {
    const skip = (input.page - 1) * input.limit
    const sortField = input.sort === 'completionsCount'
      ? { completionsCount: input.order === 'asc' ? 1 : -1 } as Record<string, 1 | -1>
      : { [input.sort]: input.order === 'asc' ? 1 : -1 } as Record<string, 1 | -1>

    const [items, total] = await Promise.all([
      this.model.aggregate<PromptStarterEntry>([
        { $addFields: { completionsCount: { $size: '$completions' } } },
        { $sort: sortField },
        { $skip: skip },
        { $limit: input.limit }
      ]),
      this.model.countDocuments().exec()
    ])
    return { items, total }
  }

  public async findById(id: string): Promise<PromptStarterEntry | null> {
    return this.model.findById(id).lean<PromptStarterEntry>().exec()
  }

  public async updateText(id: string, text: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: { text } })
  }

  public async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id })
  }

  public async removeCompletion(id: string, completionIndex: number): Promise<void> {
    const doc = await this.model.findById(id)
    if (!doc || completionIndex < 0 || completionIndex >= doc.completions.length) {
      return
    }
    doc.completions.splice(completionIndex, 1)
    await doc.save()
  }

  public async findGolden(limit: number): Promise<readonly PromptStarterEntry[]> {
    return this.model
      .find({ isGolden: true })
      .sort({ averageCompletionRating: -1 })
      .limit(limit)
      .lean<PromptStarterEntry[]>()
      .exec()
  }

  public async upsertGolden(input: {
    readonly text: string
    readonly averageCompletionRating: number
    readonly averageVoteShare: number
  }): Promise<void> {
    await this.model.updateOne(
      { text: input.text },
      {
        $set: {
          isGolden: true,
          averageCompletionRating: input.averageCompletionRating,
          averageVoteShare: input.averageVoteShare,
          goldenSince: new Date()
        },
        $setOnInsert: { text: input.text, usedCount: 0, completions: [] }
      },
      { upsert: true }
    )
  }

  public async findAllTexts(): Promise<readonly string[]> {
    const docs = await this.model.find({}, { text: 1, _id: 0 }).lean<{ text: string }[]>().exec()
    return docs.map((doc) => doc.text)
  }

  public async count(): Promise<number> {
    return this.model.countDocuments().exec()
  }
}
