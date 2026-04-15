import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ServeStaticModule } from '@nestjs/serve-static'
import { join } from 'path'
import { AdminModule } from './modules/admin/admin.module'
import { AiModule } from './modules/ai/ai.module'
import { GameModule } from './modules/game/game.module'
import { JokeMemoryModule } from './modules/joke-memory/joke-memory.module'
import { PromptStarterModule } from './modules/prompt-starter/prompt-starter.module'

const MONGO_URI: string = process.env.MONGO_URI ?? 'mongodb://localhost:27017/punchme'

@Module({
  imports: [
    MongooseModule.forRoot(MONGO_URI),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/admin',
      serveStaticOptions: { index: ['index.html'] }
    }),
    JokeMemoryModule,
    AiModule,
    PromptStarterModule,
    GameModule,
    AdminModule
  ]
})
export class AppModule {}
