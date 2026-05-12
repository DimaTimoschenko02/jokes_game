import { Injectable, Logger } from '@nestjs/common'
import { MemoryUpdaterOutput, UserMemoryDelta } from '../agents/memory-updater/models/user-memory-delta.type'
import { UserMemorySnapshot } from '../agents/memory-updater/models/user-memory-snapshot.type'
import {
  UserMemoryAuthorStyleData,
  UserMemoryThemeData,
  UserMemoryVoterPreferencesData
} from '../../db/schema/user-memory.schema'
import { UserMemoryRepository } from './user-memory.repository'
import { UserMemoryView } from './models/user-memory-view.type'

@Injectable()
export class UserMemoryService {
  private readonly logger: Logger = new Logger(UserMemoryService.name)

  public constructor(private readonly repository: UserMemoryRepository) {}

  public async getOrDefault(userId: string): Promise<UserMemoryView> {
    const existing = await this.repository.findByUserId(userId)
    return existing ?? this.repository.buildDefaultView()
  }

  public async buildSnapshot(input: {
    readonly userId: string
    readonly realName: string
    readonly gender: UserMemorySnapshot['gender']
    readonly bio: string | null
  }): Promise<UserMemorySnapshot> {
    const view = await this.getOrDefault(input.userId)
    return {
      userId: input.userId,
      realName: input.realName,
      gender: input.gender,
      declaredBio: input.bio ?? undefined,
      themes: view.themes,
      voterPreferences: view.voterPreferences,
      authorStyle: view.authorStyle,
      portrait: view.portrait ?? undefined
    }
  }

  public async applyUpdates(output: MemoryUpdaterOutput): Promise<void> {
    const userIds: string[] = Object.keys(output.updates)
    if (userIds.length === 0) {
      return
    }
    await Promise.all(
      userIds.map((userId) => this.applyDeltaForUser(userId, output.updates[userId]))
    )
  }

  private async applyDeltaForUser(userId: string, delta: UserMemoryDelta): Promise<void> {
    const current: UserMemoryView =
      (await this.repository.findByUserId(userId)) ?? this.repository.buildDefaultView()
    const next = {
      userId,
      themes: this.mergeThemes(current.themes, delta.themesDelta ?? []),
      voterPreferences: this.mergeVoterPreferences(
        current.voterPreferences,
        delta.voterPreferencesDelta
      ),
      authorStyle: this.mergeAuthorStyle(current.authorStyle, delta.authorStyleDelta),
      portrait: delta.newPortrait ?? current.portrait,
      updatedAfterRoundsCount: current.updatedAfterRoundsCount + 1
    }
    try {
      await this.repository.upsert(next)
    } catch (error: unknown) {
      this.logger.warn(
        `user_memory_upsert_failed user=${userId} reason="${error instanceof Error ? error.message : String(error)}"`
      )
    }
  }

  private mergeThemes(
    current: readonly UserMemoryThemeData[],
    deltas: NonNullable<UserMemoryDelta['themesDelta']>
  ): readonly UserMemoryThemeData[] {
    const map: Map<string, UserMemoryThemeData> = new Map()
    for (const theme of current) {
      map.set(theme.theme.toLowerCase(), theme)
    }
    for (const delta of deltas) {
      const key: string = delta.theme.toLowerCase()
      const existing = map.get(key)
      if (existing) {
        const confidenceDelta = delta.confidenceDelta ?? 0
        const mentionsDelta = delta.mentionsDelta ?? 0
        map.set(key, {
          theme: existing.theme,
          confidence: this.clamp(existing.confidence + confidenceDelta, 0, 1),
          mentions: Math.max(0, existing.mentions + mentionsDelta),
          source: existing.source
        })
      } else if (delta.source) {
        map.set(key, {
          theme: delta.theme,
          confidence: this.clamp(delta.confidenceDelta ?? 0.5, 0, 1),
          mentions: Math.max(0, delta.mentionsDelta ?? 1),
          source: delta.source
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.confidence - a.confidence)
  }

  private mergeVoterPreferences(
    current: UserMemoryVoterPreferencesData,
    delta: UserMemoryDelta['voterPreferencesDelta']
  ): UserMemoryVoterPreferencesData {
    if (!delta) {
      return current
    }
    return {
      darkPreference: this.clamp(current.darkPreference + (delta.darkPreference ?? 0), 0, 1),
      callbackPreference: this.clamp(
        current.callbackPreference + (delta.callbackPreference ?? 0),
        0,
        1
      ),
      absurdPreference: this.clamp(current.absurdPreference + (delta.absurdPreference ?? 0), 0, 1),
      ironyPreference: this.clamp(current.ironyPreference + (delta.ironyPreference ?? 0), 0, 1)
    }
  }

  private mergeAuthorStyle(
    current: UserMemoryAuthorStyleData,
    delta: UserMemoryDelta['authorStyleDelta']
  ): UserMemoryAuthorStyleData {
    if (!delta) {
      return current
    }
    return {
      avgPunchlineLength: delta.avgPunchlineLength ?? current.avgPunchlineLength,
      preferredStructures: delta.preferredStructures ?? current.preferredStructures
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
  }
}
