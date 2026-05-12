import { Module } from '@nestjs/common'
import { ServeStaticModule } from '@nestjs/serve-static'
import { join } from 'path'
import { DbModule } from './db/db.module'
import { AdminModule } from './modules/admin/admin.module'
import { AgentsModule } from './modules/agents/agents.module'
import { AiModule } from './modules/ai/ai.module'
import { AuthModule } from './modules/auth/auth.module'
import { ClaudeAgentModule } from './modules/claude-agent/claude-agent.module'
import { GameModule } from './modules/game/game.module'
import { JokeMemoryModule } from './modules/joke-memory/joke-memory.module'
import { PromptStarterModule } from './modules/prompt-starter/prompt-starter.module'
import { UserModule } from './modules/user/user.module'

@Module({
  imports: [
    DbModule,
    UserModule,
    AuthModule,
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/admin',
      serveStaticOptions: { index: ['index.html'] }
    }),
    ClaudeAgentModule,
    AgentsModule,
    JokeMemoryModule,
    AiModule,
    PromptStarterModule,
    GameModule,
    AdminModule
  ]
})
export class AppModule {}
