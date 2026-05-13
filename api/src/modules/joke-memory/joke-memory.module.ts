import { Module } from '@nestjs/common'
import { EmbeddingModule } from '../embedding/embedding.module'
import { FinetuneDatasetService } from './finetune-dataset.service'
import { JokeMemoryRepository } from './joke-memory.repository'
import { JokeMemoryService } from './joke-memory.service'

@Module({
  imports: [EmbeddingModule],
  providers: [JokeMemoryRepository, JokeMemoryService, FinetuneDatasetService],
  exports: [JokeMemoryService, JokeMemoryRepository, FinetuneDatasetService]
})
export class JokeMemoryModule {}
