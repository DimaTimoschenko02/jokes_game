import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

@Schema({ collection: 'prompt_starters', timestamps: { createdAt: true, updatedAt: false } })
export class PromptStarterDocumentModel {
  @Prop({ required: true, maxlength: 200 })
  public text!: string

  @Prop({ required: true, default: 0, min: 0 })
  public usedCount!: number

  @Prop({ required: true, default: Date.now })
  public createdAt!: Date
}

export type PromptStarterDocument = HydratedDocument<PromptStarterDocumentModel>

export const PromptStarterSchema = SchemaFactory.createForClass(PromptStarterDocumentModel)

PromptStarterSchema.index({ usedCount: 1 })
