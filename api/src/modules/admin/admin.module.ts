import { Module } from '@nestjs/common'
import { PromptStarterModule } from '../prompt-starter/prompt-starter.module'
import { AdminController } from './admin.controller'

@Module({
  imports: [PromptStarterModule],
  controllers: [AdminController]
})
export class AdminModule {}
