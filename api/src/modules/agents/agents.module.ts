import { Module } from '@nestjs/common'
import { ClaudeAgentModule } from '../claude-agent/claude-agent.module'
import { EmbeddingModule } from '../embedding/embedding.module'
import { PromptStarterModule } from '../prompt-starter/prompt-starter.module'
import { BotAgentService } from './bot/bot-agent.service'
import { MemoryUpdaterAgentService } from './memory-updater/memory-updater-agent.service'
import { OpeningGeneratorAgentService } from './opening-generator/opening-generator-agent.service'
import { OpeningSelectionService } from './opening-selection/opening-selection.service'

@Module({
  imports: [ClaudeAgentModule, EmbeddingModule, PromptStarterModule],
  providers: [
    BotAgentService,
    MemoryUpdaterAgentService,
    OpeningGeneratorAgentService,
    OpeningSelectionService
  ],
  exports: [
    BotAgentService,
    MemoryUpdaterAgentService,
    OpeningGeneratorAgentService,
    OpeningSelectionService
  ]
})
export class AgentsModule {}
