import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AiModule } from './modules/ai/ai.module'
import { GameModule } from './modules/game/game.module'
import { JokeMemoryModule } from './modules/joke-memory/joke-memory.module'
import { PromptStarterModule } from './modules/prompt-starter/prompt-starter.module'

const MONGO_URI: string = process.env.MONGO_URI ?? 'mongodb://mongo:27017/punchme'

@Module({
  imports: [MongooseModule.forRoot(MONGO_URI), JokeMemoryModule, AiModule, PromptStarterModule, GameModule]
})
export class AppModule {}
