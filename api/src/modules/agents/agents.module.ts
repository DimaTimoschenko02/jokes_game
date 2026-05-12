import { Module } from '@nestjs/common'
import { ClaudeAgentModule } from '../claude-agent/claude-agent.module'
import { JudgeAgentService } from './judge/judge-agent.service'

@Module({
  imports: [ClaudeAgentModule],
  providers: [JudgeAgentService],
  exports: [JudgeAgentService]
})
export class AgentsModule {}
