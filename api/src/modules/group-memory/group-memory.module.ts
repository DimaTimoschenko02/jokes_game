import { Module } from '@nestjs/common'
import { GroupMemoryRepository } from './group-memory.repository'
import { GroupMemoryService } from './group-memory.service'

@Module({
  providers: [GroupMemoryRepository, GroupMemoryService],
  exports: [GroupMemoryService]
})
export class GroupMemoryModule {}
