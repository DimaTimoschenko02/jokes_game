import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

@Schema({ _id: false })
export class CompletionSubdocument {
  @Prop({ required: true, maxlength: 200 })
  public punchline!: string

  @Prop({ required: true, enum: ['human', 'bot'] })
  public source!: string

  @Prop({ required: true, default: 0, min: 0 })
  public votesFor!: number

  @Prop({ required: true, default: 0, min: 0 })
  public votesAgainst!: number

  @Prop({ required: true, default: 0.5, min: 0, max: 1 })
  public voteShare!: number

  @Prop({ required: false, min: 0, max: 10 })
  public ratingAverage?: number

  @Prop({ required: false, min: 0 })
  public ratingCount?: number

  @Prop({ required: true, maxlength: 8 })
  public roomCode!: string

  @Prop({ required: true, min: 1 })
  public roundIndex!: number

  @Prop({ required: true, default: Date.now })
  public createdAt!: Date
}

export const CompletionSubdocumentSchema = SchemaFactory.createForClass(CompletionSubdocument)

@Schema({ collection: 'prompt_starters', timestamps: { createdAt: true, updatedAt: false } })
export class PromptStarterDocumentModel {
  @Prop({ required: true, maxlength: 200, unique: true })
  public text!: string

  @Prop({ required: true, default: 0, min: 0 })
  public usedCount!: number

  @Prop({ type: [CompletionSubdocumentSchema], default: [] })
  public completions!: CompletionSubdocument[]

  @Prop({ required: false, default: false })
  public isGolden?: boolean

  @Prop({ required: false, min: 0, max: 10 })
  public averageCompletionRating?: number

  @Prop({ required: false, min: 0, max: 1 })
  public averageVoteShare?: number

  @Prop({ required: false })
  public goldenSince?: Date

  @Prop({ required: true, default: Date.now })
  public createdAt!: Date
}

export type PromptStarterDocument = HydratedDocument<PromptStarterDocumentModel>

export const PromptStarterSchema = SchemaFactory.createForClass(PromptStarterDocumentModel)

PromptStarterSchema.index({ usedCount: 1 })
PromptStarterSchema.index({ 'completions.voteShare': -1 })
PromptStarterSchema.index({ isGolden: 1, averageCompletionRating: -1 })
