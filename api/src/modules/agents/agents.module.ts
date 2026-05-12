import { Module } from '@nestjs/common'
import { ClaudeAgentModule } from '../claude-agent/claude-agent.module'
import { BotAgentService } from './bot/bot-agent.service'
import { OpeningGeneratorAgentService } from './opening-generator/opening-generator-agent.service'

@Module({
  imports: [ClaudeAgentModule],
  providers: [BotAgentService, OpeningGeneratorAgentService],
  exports: [BotAgentService, OpeningGeneratorAgentService]
})
export class AgentsModule {}
