import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { PromptStarterEntry } from './models/prompt-starter-entry.type'
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

  public async insertMany(texts: readonly string[]): Promise<void> {
    if (texts.length === 0) {
      return
    }
    await this.model.insertMany(
      texts.map((text) => ({ text, usedCount: 0 })),
      { ordered: false }
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
