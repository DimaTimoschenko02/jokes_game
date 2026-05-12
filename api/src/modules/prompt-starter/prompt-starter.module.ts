import { Module } from '@nestjs/common'
import { AiModule } from '../ai/ai.module'
import { PromptStarterRepository } from './prompt-starter.repository'
import { PromptStarterService } from './prompt-starter.service'

@Module({
  imports: [AiModule],
  providers: [PromptStarterRepository, PromptStarterService],
  exports: [PromptStarterService, PromptStarterRepository]
})
export class PromptStarterModule {}
