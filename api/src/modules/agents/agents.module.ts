import { Module } from '@nestjs/common'
import { ClaudeAgentModule } from '../claude-agent/claude-agent.module'
import { BotAgentService } from './bot/bot-agent.service'
import { JudgeAgentService } from './judge/judge-agent.service'
import { OpeningGeneratorAgentService } from './opening-generator/opening-generator-agent.service'

@Module({
  imports: [ClaudeAgentModule],
  providers: [BotAgentService, JudgeAgentService, OpeningGeneratorAgentService],
  exports: [BotAgentService, JudgeAgentService, OpeningGeneratorAgentService]
})
export class AgentsModule {}
