import { Injectable, Logger } from '@nestjs/common'
import {
  GroupMemoryAvoidedThemeData,
  GroupMemoryInJokeData,
  GroupMemoryRow,
  GroupMemorySetupPatternData,
  GroupMemoryThemeData,
  GroupMemoryTriggerData
} from '../../db/schema/group-memory.schema'
import { GroupMemoryRepository } from './group-memory.repository'
import {
  GroupAvoidedThemeDelta,
  GroupInJokeDelta,
  GroupMemoryDelta,
  GroupSetupPatternDelta,
  GroupThemeDelta,
  GroupTriggerDelta
} from './models/group-memory-delta.type'
import { GroupMemoryWriteFields } from './models/group-memory-write.type'

const SUMMARY_REFRESH_EVERY_GAMES: number = 3
const NEW_ENTRY_DEFAULT_SCORE: number = 0.3
const MAX_THEMES: number = 40
const MAX_IN_JOKES: number = 40
const MAX_TRIGGERS: number = 30
const MAX_AVOIDED: number = 30
const MAX_SETUP_PATTERNS: number = 20
const MAX_EXAMPLES_PER_ENTRY: number = 5
const RENDER_THEMES: number = 8
const RENDER_IN_JOKES: number = 10
const RENDER_TRIGGERS: number = 6
const RENDER_SETUP_PATTERNS: number = 5

export type GroupMemoryFinalizeContext = {
  readonly currentText: string
  readonly summaryRequested: boolean
}

@Injectable()
export class GroupMemoryService {
  private readonly logger: Logger = new Logger(GroupMemoryService.name)

  public constructor(private readonly repository: GroupMemoryRepository) {}

  public async getAdminView(): Promise<GroupMemoryRow> {
    return this.repository.getOrCreateView()
  }

  public async setMemoryEnabled(enabled: boolean): Promise<void> {
    await this.repository.setMemoryEnabled(enabled)
    this.logger.log(`group_memory_enabled_set value=${enabled}`)
  }

  public async getPromptBlock(): Promise<string | null> {
    const row: GroupMemoryRow = await this.repository.getOrCreateView()
    if (!row.memoryEnabled) {
      return null
    }
    return this.renderBlock(row)
  }

  public async getFinalizeContext(): Promise<GroupMemoryFinalizeContext> {
    const row: GroupMemoryRow = await this.repository.getOrCreateView()
    const summaryRequested: boolean =
      row.gamesProcessed + 1 - row.summaryRefreshedAtGame >= SUMMARY_REFRESH_EVERY_GAMES
    return { currentText: this.renderForUpdater(row), summaryRequested }
  }

  public async applyDelta(delta: GroupMemoryDelta): Promise<void> {
    await this.repository.applyMerge((row) => this.mergeAll(row, delta))
    this.logger.log(
      `group_memory_delta_applied themes=${delta.themesDelta?.length ?? 0} inJokes=${delta.inJokesDelta?.length ?? 0} summary=${delta.newSummaryText ? 'yes' : 'no'}`
    )
  }

  private mergeAll(row: GroupMemoryRow, delta: GroupMemoryDelta): GroupMemoryWriteFields {
    const hasSummary: boolean =
      typeof delta.newSummaryText === 'string' && delta.newSummaryText.trim().length > 0
    const nextGamesProcessed: number = row.gamesProcessed + 1
    return {
      themes: this.mergeThemes(row.themes, delta.themesDelta ?? []),
      inJokes: this.mergeInJokes(row.inJokes, delta.inJokesDelta ?? []),
      triggers: this.mergeTriggers(row.triggers, delta.triggersDelta ?? []),
      avoidedThemes: this.mergeAvoidedThemes(row.avoidedThemes, delta.avoidedThemesDelta ?? []),
      setupPatterns: this.mergeSetupPatterns(row.setupPatterns, delta.setupPatternsDelta ?? []),
      summaryText: hasSummary ? (delta.newSummaryText as string).trim() : row.summaryText,
      gamesProcessed: nextGamesProcessed,
      summaryRefreshedAtGame: hasSummary ? nextGamesProcessed : row.summaryRefreshedAtGame
    }
  }

  private mergeThemes(
    current: readonly GroupMemoryThemeData[],
    deltas: readonly GroupThemeDelta[]
  ): readonly GroupMemoryThemeData[] {
    const map: Map<string, GroupMemoryThemeData> = new Map()
    for (const theme of current) {
      map.set(theme.theme.toLowerCase(), theme)
    }
    for (const delta of deltas) {
      const key: string = delta.theme.toLowerCase()
      const existing = map.get(key)
      if (existing) {
        map.set(key, {
          theme: existing.theme,
          score: this.clamp(existing.score + (delta.scoreDelta ?? 0), 0, 1),
          mentions: Math.max(0, existing.mentions + (delta.mentionsDelta ?? 0)),
          examples: this.appendExamples(existing.examples, delta.newExamples)
        })
      } else {
        map.set(key, {
          theme: delta.theme,
          score: this.clamp(delta.scoreDelta ?? NEW_ENTRY_DEFAULT_SCORE, 0, 1),
          mentions: Math.max(1, delta.mentionsDelta ?? 1),
          examples: this.appendExamples([], delta.newExamples)
        })
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_THEMES)
  }

  private mergeInJokes(
    current: readonly GroupMemoryInJokeData[],
    deltas: readonly GroupInJokeDelta[]
  ): readonly GroupMemoryInJokeData[] {
    const map: Map<string, GroupMemoryInJokeData> = new Map()
    for (const joke of current) {
      map.set(joke.phrase.toLowerCase(), joke)
    }
    for (const delta of deltas) {
      const key: string = delta.phrase.toLowerCase()
      const existing = map.get(key)
      if (existing) {
        map.set(key, {
          phrase: existing.phrase,
          kind: delta.kind ?? existing.kind,
          mentions: Math.max(0, existing.mentions + (delta.mentionsDelta ?? 0))
        })
      } else {
        map.set(key, {
          phrase: delta.phrase,
          kind: delta.kind ?? 'callback',
          mentions: Math.max(1, delta.mentionsDelta ?? 1)
        })
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, MAX_IN_JOKES)
  }

  private mergeTriggers(
    current: readonly GroupMemoryTriggerData[],
    deltas: readonly GroupTriggerDelta[]
  ): readonly GroupMemoryTriggerData[] {
    const map: Map<string, GroupMemoryTriggerData> = new Map()
    for (const trigger of current) {
      map.set(trigger.trigger.toLowerCase(), trigger)
    }
    for (const delta of deltas) {
      const key: string = delta.trigger.toLowerCase()
      const existing = map.get(key)
      if (existing) {
        map.set(key, {
          trigger: existing.trigger,
          score: this.clamp(existing.score + (delta.scoreDelta ?? 0), 0, 1),
          examples: this.appendExamples(existing.examples, delta.newExamples)
        })
      } else {
        map.set(key, {
          trigger: delta.trigger,
          score: this.clamp(delta.scoreDelta ?? NEW_ENTRY_DEFAULT_SCORE, 0, 1),
          examples: this.appendExamples([], delta.newExamples)
        })
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_TRIGGERS)
  }

  private mergeAvoidedThemes(
    current: readonly GroupMemoryAvoidedThemeData[],
    deltas: readonly GroupAvoidedThemeDelta[]
  ): readonly GroupMemoryAvoidedThemeData[] {
    const map: Map<string, GroupMemoryAvoidedThemeData> = new Map()
    for (const theme of current) {
      map.set(theme.theme.toLowerCase(), theme)
    }
    for (const delta of deltas) {
      map.set(delta.theme.toLowerCase(), { theme: delta.theme, reason: delta.reason })
    }
    return Array.from(map.values()).slice(0, MAX_AVOIDED)
  }

  private mergeSetupPatterns(
    current: readonly GroupMemorySetupPatternData[],
    deltas: readonly GroupSetupPatternDelta[]
  ): readonly GroupMemorySetupPatternData[] {
    const map: Map<string, GroupMemorySetupPatternData> = new Map()
    for (const pattern of current) {
      map.set(pattern.pattern.toLowerCase(), pattern)
    }
    for (const delta of deltas) {
      const key: string = delta.pattern.toLowerCase()
      const existing = map.get(key)
      if (existing) {
        map.set(key, {
          pattern: existing.pattern,
          score: this.clamp(existing.score + (delta.scoreDelta ?? 0), 0, 1)
        })
      } else {
        map.set(key, {
          pattern: delta.pattern,
          score: this.clamp(delta.scoreDelta ?? NEW_ENTRY_DEFAULT_SCORE, 0, 1)
        })
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SETUP_PATTERNS)
  }

  private appendExamples(
    current: readonly string[],
    incoming: readonly string[] | undefined
  ): readonly string[] {
    const merged: string[] = [...current]
    for (const example of incoming ?? []) {
      const trimmed: string = example.trim()
      if (trimmed.length > 0 && !merged.some((m) => m.toLowerCase() === trimmed.toLowerCase())) {
        merged.push(trimmed)
      }
    }
    return merged.slice(-MAX_EXAMPLES_PER_ENTRY)
  }

  private renderBlock(row: GroupMemoryRow): string | null {
    const parts: string[] = []
    const themes = [...row.themes].sort((a, b) => b.score - a.score).slice(0, RENDER_THEMES)
    if (themes.length > 0) {
      parts.push(`Темы, на которые компания заходит: ${themes.map((t) => t.theme).join(', ')}`)
    }
    const inJokes = [...row.inJokes].sort((a, b) => b.mentions - a.mentions).slice(0, RENDER_IN_JOKES)
    if (inJokes.length > 0) {
      parts.push(`Клички и инсайды компании: ${inJokes.map((j) => j.phrase).join(', ')}`)
    }
    const triggers = [...row.triggers].sort((a, b) => b.score - a.score).slice(0, RENDER_TRIGGERS)
    if (triggers.length > 0) {
      parts.push(`Что у компании заходит (приёмы): ${triggers.map((t) => t.trigger).join(', ')}`)
    }
    if (row.avoidedThemes.length > 0) {
      parts.push(
        `Чего избегать: ${row.avoidedThemes.map((t) => `${t.theme} (${t.reason})`).join('; ')}`
      )
    }
    const setups = [...row.setupPatterns]
      .sort((a, b) => b.score - a.score)
      .slice(0, RENDER_SETUP_PATTERNS)
    if (setups.length > 0) {
      parts.push(`Рабочие типы setup'ов: ${setups.map((s) => s.pattern).join(', ')}`)
    }
    if (row.summaryText && row.summaryText.trim().length > 0) {
      parts.push(`Про компанию: ${row.summaryText.trim()}`)
    }
    if (parts.length === 0) {
      return null
    }
    return ['# Контекст компании (что эти люди любят):', ...parts].join('\n')
  }

  private renderForUpdater(row: GroupMemoryRow): string {
    const lines: string[] = []
    lines.push(
      `themes: ${row.themes.map((t) => `${t.theme}(${t.score.toFixed(2)}, m=${t.mentions})`).join(', ') || '—'}`
    )
    lines.push(
      `inJokes: ${row.inJokes.map((j) => `${j.phrase}[${j.kind}](m=${j.mentions})`).join(', ') || '—'}`
    )
    lines.push(
      `triggers: ${row.triggers.map((t) => `${t.trigger}(${t.score.toFixed(2)})`).join(', ') || '—'}`
    )
    lines.push(
      `avoidedThemes: ${row.avoidedThemes.map((t) => `${t.theme} (${t.reason})`).join('; ') || '—'}`
    )
    lines.push(
      `setupPatterns: ${row.setupPatterns.map((s) => `${s.pattern}(${s.score.toFixed(2)})`).join(', ') || '—'}`
    )
    lines.push(`summaryText: ${row.summaryText && row.summaryText.trim().length > 0 ? row.summaryText.trim() : '—'}`)
    return lines.join('\n')
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
  }
}
