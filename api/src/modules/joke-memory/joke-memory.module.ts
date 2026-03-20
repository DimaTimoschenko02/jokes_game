import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { EmbeddingModule } from '../embedding/embedding.module'
import { FinetuneDatasetService } from './finetune-dataset.service'
import { JokeMemoryRepository } from './joke-memory.repository'
import { JokeMemoryService } from './joke-memory.service'
import { JokeMemoryDocumentModel, JokeMemorySchema } from './schemas/joke-memory.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: JokeMemoryDocumentModel.name,
        schema: JokeMemorySchema
      }
    ]),
    EmbeddingModule
  ],
  providers: [JokeMemoryRepository, JokeMemoryService, FinetuneDatasetService],
  exports: [JokeMemoryService, FinetuneDatasetService]
})
export class JokeMemoryModule {}
