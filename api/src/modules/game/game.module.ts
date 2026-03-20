import { Module } from '@nestjs/common'
import { AiModule } from '../ai/ai.module'
import { JokeMemoryModule } from '../joke-memory/joke-memory.module'
import { PromptStarterModule } from '../prompt-starter/prompt-starter.module'
import { GameGateway } from './game.gateway'
import { GameService } from './game.service'

@Module({
  imports: [AiModule, JokeMemoryModule, PromptStarterModule],
  providers: [GameService, GameGateway]
})
export class GameModule {}
