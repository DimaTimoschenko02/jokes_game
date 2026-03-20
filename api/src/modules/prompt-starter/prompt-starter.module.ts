import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AiModule } from '../ai/ai.module'
import { PromptStarterRepository } from './prompt-starter.repository'
import { PromptStarterService } from './prompt-starter.service'
import { PromptStarterDocumentModel, PromptStarterSchema } from './schemas/prompt-starter.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: PromptStarterDocumentModel.name,
        schema: PromptStarterSchema
      }
    ]),
    AiModule
  ],
  providers: [PromptStarterRepository, PromptStarterService],
  exports: [PromptStarterService]
})
export class PromptStarterModule {}
