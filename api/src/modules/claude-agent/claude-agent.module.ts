import { Module } from '@nestjs/common'
import { ClaudeAgentRunnerService } from './claude-agent-runner.service'

@Module({
  providers: [ClaudeAgentRunnerService],
  exports: [ClaudeAgentRunnerService]
})
export class ClaudeAgentModule {}
