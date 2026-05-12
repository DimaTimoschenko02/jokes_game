import { forwardRef, Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { UserController } from './user.controller'
import { UserMemoryRepository } from './user-memory.repository'
import { UserMemoryService } from './user-memory.service'
import { UserRepository } from './user.repository'

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [UserController],
  providers: [UserRepository, UserMemoryRepository, UserMemoryService],
  exports: [UserRepository, UserMemoryRepository, UserMemoryService]
})
export class UserModule {}
