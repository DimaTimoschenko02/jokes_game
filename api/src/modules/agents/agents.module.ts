import { Module } from '@nestjs/common'
import { ClaudeAgentModule } from '../claude-agent/claude-agent.module'
import { BotAgentService } from './bot/bot-agent.service'
import { JudgeAgentService } from './judge/judge-agent.service'

@Module({
  imports: [ClaudeAgentModule],
  providers: [BotAgentService, JudgeAgentService],
  exports: [BotAgentService, JudgeAgentService]
})
export class AgentsModule {}
