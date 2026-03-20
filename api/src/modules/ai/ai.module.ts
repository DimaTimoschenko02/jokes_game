import { Module } from '@nestjs/common'
import { JokeMemoryModule } from '../joke-memory/joke-memory.module'
import { AiService } from './ai.service'

@Module({
  imports: [JokeMemoryModule],
  providers: [AiService],
  exports: [AiService]
})
export class AiModule {}
