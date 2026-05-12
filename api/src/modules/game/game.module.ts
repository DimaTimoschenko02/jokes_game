import { Module } from '@nestjs/common'
import { AgentsModule } from '../agents/agents.module'
import { AiModule } from '../ai/ai.module'
import { AuthModule } from '../auth/auth.module'
import { ClaudeAgentModule } from '../claude-agent/claude-agent.module'
import { JokeMemoryModule } from '../joke-memory/joke-memory.module'
import { PromptStarterModule } from '../prompt-starter/prompt-starter.module'
import { UserModule } from '../user/user.module'
import { GameGateway } from './game.gateway'
import { GameService } from './game.service'

@Module({
  imports: [
    AiModule,
    JokeMemoryModule,
    PromptStarterModule,
    AgentsModule,
    ClaudeAgentModule,
    UserModule,
    AuthModule
  ],
  providers: [GameService, GameGateway]
})
export class GameModule {}
