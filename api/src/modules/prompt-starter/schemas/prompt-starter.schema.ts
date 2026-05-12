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

@Schema({ _id: false })
export class UserQuickFeedbackSubdocument {
  @Prop({ required: true, default: 0, min: 0 })
  public up!: number

  @Prop({ required: true, default: 0, min: 0 })
  public down!: number

  @Prop({ required: true, default: 0, min: 0 })
  public broken!: number
}

export const UserQuickFeedbackSubdocumentSchema = SchemaFactory.createForClass(
  UserQuickFeedbackSubdocument
)

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

  @Prop({ type: UserQuickFeedbackSubdocumentSchema, default: () => ({ up: 0, down: 0, broken: 0 }) })
  public userQuickFeedback!: UserQuickFeedbackSubdocument

  @Prop({ required: true, default: 0, min: -1, max: 1 })
  public feedbackScore!: number

  @Prop({ required: false, min: 1, max: 5 })
  public adminScore?: number

  @Prop({ required: false, maxlength: 80 })
  public adminScoredBy?: string

  @Prop({ required: false })
  public adminScoredAt?: Date

  @Prop({ required: false, maxlength: 500 })
  public adminComment?: string

  @Prop({ required: false, min: 0, max: 1 })
  public derivedScore?: number

  @Prop({ required: true, default: 0, min: 0 })
  public usedAsExampleCount!: number

  @Prop({ required: false })
  public lastUsedAsExampleAt?: Date

  @Prop({ required: false, type: [Number] })
  public textEmbedding?: number[]

  @Prop({ required: false, maxlength: 80 })
  public embeddingModel?: string

  @Prop({ required: true, default: Date.now })
  public createdAt!: Date
}

export type PromptStarterDocument = HydratedDocument<PromptStarterDocumentModel>

export const PromptStarterSchema = SchemaFactory.createForClass(PromptStarterDocumentModel)

PromptStarterSchema.index({ usedCount: 1 })
PromptStarterSchema.index({ 'completions.voteShare': -1 })
PromptStarterSchema.index({ isGolden: 1, averageCompletionRating: -1 })
PromptStarterSchema.index({ adminScore: -1, createdAt: -1 })
PromptStarterSchema.index({ feedbackScore: -1 })
PromptStarterSchema.index({ derivedScore: -1 })
PromptStarterSchema.index({ usedAsExampleCount: 1 })
