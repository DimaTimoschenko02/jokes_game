import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'
import { JokeMemorySource } from '../models/joke-memory-source.type'

@Schema({ collection: 'joke_memory', timestamps: { createdAt: true, updatedAt: false } })
export class JokeMemoryDocumentModel {
  @Prop({ required: true, maxlength: 140 })
  public prompt!: string

  @Prop({ required: true, maxlength: 140 })
  public punchline!: string

  @Prop({ required: true, maxlength: 180 })
  public promptNormalized!: string

  @Prop({ required: true, maxlength: 340 })
  public fingerprint!: string

  @Prop({ required: false, type: [Number] })
  public promptEmbedding?: number[]

  @Prop({ required: false, maxlength: 80 })
  public embeddingModel?: string

  @Prop({ required: true, min: 0 })
  public votesFor!: number

  @Prop({ required: true, min: 0 })
  public votesAgainst!: number

  @Prop({ required: true, min: 0, max: 1 })
  public voteShare!: number

  @Prop({ required: true, min: 0, max: 1 })
  public qualityScore!: number

  @Prop({ required: false, min: 0, max: 10 })
  public ratingAverage?: number

  @Prop({ required: false, min: 0 })
  public ratingSum?: number

  @Prop({ required: false, min: 0 })
  public ratingCount?: number

  @Prop({ required: false, min: 1, max: 10 })
  public adminScore?: number

  @Prop({ required: false, maxlength: 80 })
  public adminScoredBy?: string

  @Prop({ required: false })
  public adminScoredAt?: Date

  @Prop({ required: false, maxlength: 500 })
  public adminComment?: string

  @Prop({ required: true, default: 0, min: 0 })
  public usedAsExampleCount!: number

  @Prop({ required: false })
  public lastUsedAsExampleAt?: Date

  @Prop({ required: false, maxlength: 64 })
  public authorUserId?: string

  @Prop({ required: false, maxlength: 80 })
  public authorRealName?: string

  @Prop({ required: true, type: String, enum: ['human', 'bot'] })
  public source!: JokeMemorySource

  @Prop({ required: true, maxlength: 8 })
  public roomCode!: string

  @Prop({ required: true, min: 1 })
  public roundIndex!: number

  @Prop({ required: true, default: Date.now })
  public createdAt!: Date
}

export type JokeMemoryDocument = HydratedDocument<JokeMemoryDocumentModel>

export const JokeMemorySchema = SchemaFactory.createForClass(JokeMemoryDocumentModel)

JokeMemorySchema.index({ promptNormalized: 'text', punchline: 'text' })
JokeMemorySchema.index({ qualityScore: -1, createdAt: -1 })
JokeMemorySchema.index({ voteShare: -1, createdAt: -1 })
JokeMemorySchema.index({ fingerprint: 1, createdAt: -1 })
JokeMemorySchema.index({ createdAt: -1 })
JokeMemorySchema.index({ adminScore: -1 })
JokeMemorySchema.index({ ratingAverage: -1, ratingCount: -1 })
JokeMemorySchema.index({ authorUserId: 1, createdAt: -1 })
