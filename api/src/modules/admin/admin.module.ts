import { forwardRef, Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { JokeMemoryModule } from '../joke-memory/joke-memory.module'
import { PromptStarterModule } from '../prompt-starter/prompt-starter.module'
import { UserModule } from '../user/user.module'
import { AdminController } from './admin.controller'
import { AdminGuard } from './admin.guard'

@Module({
  imports: [PromptStarterModule, JokeMemoryModule, UserModule, forwardRef(() => AuthModule)],
  controllers: [AdminController],
  providers: [AdminGuard]
})
export class AdminModule {}
