import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DATABASE } from '../../db/db.module'
import { Db } from '../../db/db.types'
import { GroupMemoryRow, groupMemory } from '../../db/schema/group-memory.schema'
import { GroupMemoryWriteFields } from './models/group-memory-write.type'

export const GROUP_MEMORY_GLOBAL_ID: string = 'global'

@Injectable()
export class GroupMemoryRepository {
  public constructor(@Inject(DATABASE) private readonly db: Db) {}

  public async getOrCreateView(): Promise<GroupMemoryRow> {
    const existing = await this.db
      .select()
      .from(groupMemory)
      .where(eq(groupMemory.id, GROUP_MEMORY_GLOBAL_ID))
      .limit(1)
    if (existing[0]) {
      return existing[0]
    }
    await this.db
      .insert(groupMemory)
      .values({ id: GROUP_MEMORY_GLOBAL_ID })
      .onConflictDoNothing()
    const created = await this.db
      .select()
      .from(groupMemory)
      .where(eq(groupMemory.id, GROUP_MEMORY_GLOBAL_ID))
      .limit(1)
    return created[0]
  }

  public async applyMerge(
    merge: (current: GroupMemoryRow) => GroupMemoryWriteFields
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(groupMemory)
        .where(eq(groupMemory.id, GROUP_MEMORY_GLOBAL_ID))
        .for('update')
      let current: GroupMemoryRow | undefined = locked[0]
      if (!current) {
        await tx.insert(groupMemory).values({ id: GROUP_MEMORY_GLOBAL_ID }).onConflictDoNothing()
        const reread = await tx
          .select()
          .from(groupMemory)
          .where(eq(groupMemory.id, GROUP_MEMORY_GLOBAL_ID))
          .for('update')
        current = reread[0]
      }
      const next: GroupMemoryWriteFields = merge(current)
      await tx
        .update(groupMemory)
        .set({
          themes: next.themes,
          inJokes: next.inJokes,
          triggers: next.triggers,
          avoidedThemes: next.avoidedThemes,
          setupPatterns: next.setupPatterns,
          summaryText: next.summaryText,
          gamesProcessed: next.gamesProcessed,
          summaryRefreshedAtGame: next.summaryRefreshedAtGame,
          updatedAt: new Date()
        })
        .where(eq(groupMemory.id, GROUP_MEMORY_GLOBAL_ID))
    })
  }

  public async setMemoryEnabled(enabled: boolean): Promise<void> {
    await this.getOrCreateView()
    await this.db
      .update(groupMemory)
      .set({ memoryEnabled: enabled, updatedAt: new Date() })
      .where(eq(groupMemory.id, GROUP_MEMORY_GLOBAL_ID))
  }
}
