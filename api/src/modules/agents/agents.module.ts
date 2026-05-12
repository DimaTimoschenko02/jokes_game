import { Module } from '@nestjs/common'
import { ClaudeAgentModule } from '../claude-agent/claude-agent.module'
import { BotAgentService } from './bot/bot-agent.service'
import { MemoryUpdaterAgentService } from './memory-updater/memory-updater-agent.service'
import { OpeningGeneratorAgentService } from './opening-generator/opening-generator-agent.service'

@Module({
  imports: [ClaudeAgentModule],
  providers: [BotAgentService, MemoryUpdaterAgentService, OpeningGeneratorAgentService],
  exports: [BotAgentService, MemoryUpdaterAgentService, OpeningGeneratorAgentService]
})
export class AgentsModule {}
