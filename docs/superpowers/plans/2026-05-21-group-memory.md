# Group Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Накапливать общую «память компании» (темы, клички, триггеры, запреты, рабочие setup'ы + текстовое саммари) после каждой игры и кормить ею генератор начал и генератор панчлайнов ботов.

**Architecture:** Один глобальный ряд в новой таблице `group_memory`. Существующий агент `memory-updater` после завершения игры делает дополнительный finalize-вызов на той же сессии и возвращает дельты. Backend мерджит дельты детерминированно в транзакции. Блок памяти рендерится в текст и передаётся обоим генераторам при старте их сессий. Админ-тогл `memoryEnabled` отключает использование, не останавливая накопление.

**Tech Stack:** NestJS 11, Drizzle ORM (PostgreSQL), Zod, Claude CLI agent runner, React 19.

**Спека:** `docs/superpowers/specs/2026-05-21-group-memory-design.md`

> **Тесты:** в проекте нет test-runner'а. Верификация каждой задачи — typecheck через сборку: `npm run build` в `api/` (это `tsc -p tsconfig.json`) и в `web/`. Добавление test-фреймворка вне scope этого плана.

> **Замечание про незакоммиченное:** в рабочем дереве уже есть незакоммиченные правки (фиксы #41-45). Каждый коммит ниже использует явный `git add <конкретные файлы>`, чтобы не смешивать. Не делать `git add -A`.

---

## Phase 1 — База данных

### Task 1: Схема `group_memory` + `users.test_account` + миграция

**Files:**
- Modify: `api/src/db/schema/user.schema.ts`
- Create: `api/src/db/schema/group-memory.schema.ts`
- Modify: `api/src/db/schema/index.ts`
- Generated: `api/drizzle/0007_*.sql` (создаётся `drizzle-kit generate`)

- [ ] **Step 1: Добавить колонку `test_account` в схему `users`**

В `api/src/db/schema/user.schema.ts` заменить строку импорта и добавить поле `testAccount` после `role`.

Импорт (строка 1) — добавить `boolean`:

```ts
import { boolean, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
```

В объявлении таблицы `users`, сразу после строки `role: userRoleEnum('role').notNull().default('user'),`:

```ts
    role: userRoleEnum('role').notNull().default('user'),
    testAccount: boolean('test_account').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
```

- [ ] **Step 2: Создать файл схемы `group-memory.schema.ts`**

Создать `api/src/db/schema/group-memory.schema.ts`:

```ts
import { boolean, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export type GroupMemoryThemeData = {
  readonly theme: string
  readonly score: number
  readonly mentions: number
  readonly examples: readonly string[]
}

export type GroupMemoryInJokeKind = 'nickname' | 'meme' | 'callback'

export type GroupMemoryInJokeData = {
  readonly phrase: string
  readonly kind: GroupMemoryInJokeKind
  readonly mentions: number
}

export type GroupMemoryTriggerData = {
  readonly trigger: string
  readonly score: number
  readonly examples: readonly string[]
}

export type GroupMemoryAvoidedThemeData = {
  readonly theme: string
  readonly reason: string
}

export type GroupMemorySetupPatternData = {
  readonly pattern: string
  readonly score: number
}

export const groupMemory = pgTable('group_memory', {
  id: text('id').primaryKey(),
  themes: jsonb('themes').$type<readonly GroupMemoryThemeData[]>().notNull().default([]),
  inJokes: jsonb('in_jokes').$type<readonly GroupMemoryInJokeData[]>().notNull().default([]),
  triggers: jsonb('triggers').$type<readonly GroupMemoryTriggerData[]>().notNull().default([]),
  avoidedThemes: jsonb('avoided_themes')
    .$type<readonly GroupMemoryAvoidedThemeData[]>()
    .notNull()
    .default([]),
  setupPatterns: jsonb('setup_patterns')
    .$type<readonly GroupMemorySetupPatternData[]>()
    .notNull()
    .default([]),
  summaryText: text('summary_text'),
  gamesProcessed: integer('games_processed').notNull().default(0),
  summaryRefreshedAtGame: integer('summary_refreshed_at_game').notNull().default(0),
  memoryEnabled: boolean('memory_enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export type GroupMemoryRow = typeof groupMemory.$inferSelect
export type GroupMemoryInsert = typeof groupMemory.$inferInsert
```

- [ ] **Step 3: Экспортировать новую схему из barrel-файла**

В `api/src/db/schema/index.ts` добавить строку:

```ts
export * from './joke-memory.schema'
export * from './prompt-starter.schema'
export * from './prompt-starter-completion.schema'
export * from './user.schema'
export * from './user-memory.schema'
export * from './group-memory.schema'
```

- [ ] **Step 4: Сгенерировать миграцию**

Run (из `api/`): `npm run db:generate`

Expected: создан файл `api/drizzle/0007_<random-name>.sql`, содержащий `ALTER TABLE "users" ADD COLUMN "test_account" boolean DEFAULT false NOT NULL;` и `CREATE TABLE "group_memory" (...)`.

- [ ] **Step 5: Проверить содержимое миграции**

Открыть сгенерированный `api/drizzle/0007_*.sql` и убедиться, что есть оба изменения: `ADD COLUMN "test_account"` и `CREATE TABLE "group_memory"`. Глобальный ряд `'global'` миграция НЕ вставляет — он создаётся лениво репозиторием (Task 3).

- [ ] **Step 6: Сборка**

Run (из `api/`): `npm run build`
Expected: PASS, без TS-ошибок.

- [ ] **Step 7: Commit**

```bash
git add api/src/db/schema/user.schema.ts api/src/db/schema/group-memory.schema.ts api/src/db/schema/index.ts api/drizzle/
git commit -m "$(cat <<'EOF'
feat(v2): group_memory table + users.test_account (migration 0007)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Доменный слой group memory

### Task 2: Типы дельт group memory

**Files:**
- Create: `api/src/modules/group-memory/models/group-memory-delta.type.ts`
- Create: `api/src/modules/group-memory/models/group-memory-write.type.ts`

- [ ] **Step 1: Создать тип дельты**

Создать `api/src/modules/group-memory/models/group-memory-delta.type.ts`:

```ts
import { GroupMemoryInJokeKind } from '../../../db/schema/group-memory.schema'

export type GroupThemeDelta = {
  readonly theme: string
  readonly scoreDelta?: number
  readonly mentionsDelta?: number
  readonly newExamples?: readonly string[]
}

export type GroupInJokeDelta = {
  readonly phrase: string
  readonly kind?: GroupMemoryInJokeKind
  readonly mentionsDelta?: number
}

export type GroupTriggerDelta = {
  readonly trigger: string
  readonly scoreDelta?: number
  readonly newExamples?: readonly string[]
}

export type GroupAvoidedThemeDelta = {
  readonly theme: string
  readonly reason: string
}

export type GroupSetupPatternDelta = {
  readonly pattern: string
  readonly scoreDelta?: number
}

export type GroupMemoryDelta = {
  readonly themesDelta?: readonly GroupThemeDelta[]
  readonly inJokesDelta?: readonly GroupInJokeDelta[]
  readonly triggersDelta?: readonly GroupTriggerDelta[]
  readonly avoidedThemesDelta?: readonly GroupAvoidedThemeDelta[]
  readonly setupPatternsDelta?: readonly GroupSetupPatternDelta[]
  readonly newSummaryText?: string
}
```

- [ ] **Step 2: Создать тип записываемых полей**

Создать `api/src/modules/group-memory/models/group-memory-write.type.ts`:

```ts
import {
  GroupMemoryAvoidedThemeData,
  GroupMemoryInJokeData,
  GroupMemorySetupPatternData,
  GroupMemoryThemeData,
  GroupMemoryTriggerData
} from '../../../db/schema/group-memory.schema'

export type GroupMemoryWriteFields = {
  readonly themes: readonly GroupMemoryThemeData[]
  readonly inJokes: readonly GroupMemoryInJokeData[]
  readonly triggers: readonly GroupMemoryTriggerData[]
  readonly avoidedThemes: readonly GroupMemoryAvoidedThemeData[]
  readonly setupPatterns: readonly GroupMemorySetupPatternData[]
  readonly summaryText: string | null
  readonly gamesProcessed: number
  readonly summaryRefreshedAtGame: number
}
```

- [ ] **Step 3: Сборка**

Run (из `api/`): `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/group-memory/models/
git commit -m "$(cat <<'EOF'
feat(v2): group memory delta and write-field types

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `GroupMemoryRepository`

**Files:**
- Create: `api/src/modules/group-memory/group-memory.repository.ts`

- [ ] **Step 1: Создать репозиторий**

Создать `api/src/modules/group-memory/group-memory.repository.ts`. Метод `getOrCreateView` лениво засевает глобальный ряд. `applyMerge` оборачивает read-modify-write в транзакцию с `SELECT ... FOR UPDATE` (защита от гонки при одновременном финале двух игр).

```ts
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
```

- [ ] **Step 2: Сборка**

Run (из `api/`): `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/group-memory/group-memory.repository.ts
git commit -m "$(cat <<'EOF'
feat(v2): GroupMemoryRepository with locked merge transaction

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `GroupMemoryService` — merge + рендер

**Files:**
- Create: `api/src/modules/group-memory/group-memory.service.ts`

- [ ] **Step 1: Создать сервис**

Создать `api/src/modules/group-memory/group-memory.service.ts`. Сервис: чистый детерминированный merge дельт, рендер блока для промптов, контекст для finalize-вызова, тогл киллсвитча.

```ts
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
```

- [ ] **Step 2: Сборка**

Run (из `api/`): `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/group-memory/group-memory.service.ts
git commit -m "$(cat <<'EOF'
feat(v2): GroupMemoryService — deterministic delta merge and prompt rendering

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `GroupMemoryModule`

**Files:**
- Create: `api/src/modules/group-memory/group-memory.module.ts`

- [ ] **Step 1: Создать модуль**

Создать `api/src/modules/group-memory/group-memory.module.ts`. `DATABASE` provider — глобальный (см. `db.module.ts`, используется `@Inject(DATABASE)` без локального импорта в других репозиториях), поэтому отдельно импортировать его не нужно.

```ts
import { Module } from '@nestjs/common'
import { GroupMemoryRepository } from './group-memory.repository'
import { GroupMemoryService } from './group-memory.service'

@Module({
  providers: [GroupMemoryRepository, GroupMemoryService],
  exports: [GroupMemoryService]
})
export class GroupMemoryModule {}
```

- [ ] **Step 2: Сборка**

Run (из `api/`): `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/group-memory/group-memory.module.ts
git commit -m "$(cat <<'EOF'
feat(v2): GroupMemoryModule

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Finalize-вызов memory-updater

### Task 6: Расширить выход memory-updater (`groupMemoryDelta`)

**Files:**
- Modify: `api/src/modules/agents/memory-updater/models/user-memory-delta.type.ts`
- Modify: `api/src/modules/agents/configs/memory-updater-agent.config.ts`

- [ ] **Step 1: Добавить `groupMemoryDelta` в `MemoryUpdaterOutput`**

В `api/src/modules/agents/memory-updater/models/user-memory-delta.type.ts` добавить импорт сверху и расширить `MemoryUpdaterOutput`:

```ts
import { GroupMemoryDelta } from '../../../group-memory/models/group-memory-delta.type'
```

Заменить блок `MemoryUpdaterOutput` (строки 27-29) на:

```ts
export type MemoryUpdaterOutput = {
  readonly updates: Readonly<Record<string, UserMemoryDelta>>
  readonly groupMemoryDelta?: GroupMemoryDelta
}
```

`updates` остаётся обязательным — finalize-вызов вернёт `updates: {}`. Это сохраняет неизменными `UserMemoryService.applyUpdates` и существующие per-round вызовы.

- [ ] **Step 2: Расширить Zod-схему и system prompt**

В `api/src/modules/agents/configs/memory-updater-agent.config.ts`:

(a) В конец массива `MEMORY_UPDATER_SYSTEM_PROMPT` (перед закрывающим `].join('\n')`, после строки про Output) добавить блок про finalize. Заменить последнюю строку массива:

```ts
  'Output: JSON-объект формы {"updates": { <userId>: { ...опциональные дельты... } }}. Структура форсируется через JSON Schema, отвечай строго по ней.',
  '',
  'РЕЖИМ FINALIZE (в конце игры): когда тебя просят обновить ПАМЯТЬ КОМПАНИИ — верни {"updates": {}, "groupMemoryDelta": {...}}.',
  'groupMemoryDelta описывает компанию игроков в целом, а не отдельных людей:',
  '- themesDelta: темы, на которые компания заходила в этой игре. scoreDelta двигай малыми шагами (±0.05-0.2).',
  '- inJokesDelta: клички, мемы, инсайды компании (kind: nickname | meme | callback).',
  '- triggersDelta: приёмы/образы, которые вызывали смех (не темы — а КАК шутят).',
  '- avoidedThemesDelta: что не заходило, отторгало — с короткой причиной.',
  '- setupPatternsDelta: типы setup\'ов начал, которые залетали у этой компании.',
  '- newSummaryText: возвращай ТОЛЬКО если тебя явно просят обновить саммари.',
  'Дельты — только ИЗМЕНЕНИЯ относительно показанной текущей памяти компании. Без догадок, строго по фактам игры.'
].join('\n')
```

(b) Перед `MEMORY_UPDATER_OUTPUT_SCHEMA` добавить схему дельты группы:

```ts
const groupMemoryDeltaSchema = z
  .object({
    themesDelta: z
      .array(
        z.object({
          theme: z.string().min(1).max(100),
          scoreDelta: z.number().min(-1).max(1).optional(),
          mentionsDelta: z.number().int().optional(),
          newExamples: z.array(z.string().min(1).max(300)).max(5).optional()
        })
      )
      .max(20)
      .optional(),
    inJokesDelta: z
      .array(
        z.object({
          phrase: z.string().min(1).max(120),
          kind: z.enum(['nickname', 'meme', 'callback']).optional(),
          mentionsDelta: z.number().int().optional()
        })
      )
      .max(20)
      .optional(),
    triggersDelta: z
      .array(
        z.object({
          trigger: z.string().min(1).max(120),
          scoreDelta: z.number().min(-1).max(1).optional(),
          newExamples: z.array(z.string().min(1).max(300)).max(5).optional()
        })
      )
      .max(20)
      .optional(),
    avoidedThemesDelta: z
      .array(
        z.object({
          theme: z.string().min(1).max(100),
          reason: z.string().min(1).max(200)
        })
      )
      .max(20)
      .optional(),
    setupPatternsDelta: z
      .array(
        z.object({
          pattern: z.string().min(1).max(120),
          scoreDelta: z.number().min(-1).max(1).optional()
        })
      )
      .max(20)
      .optional(),
    newSummaryText: z.string().min(1).max(2000).optional()
  })
  .strict()
```

(c) Заменить `MEMORY_UPDATER_OUTPUT_SCHEMA` на:

```ts
export const MEMORY_UPDATER_OUTPUT_SCHEMA: ZodType<MemoryUpdaterOutput> = z.object({
  updates: z.record(z.string().min(1), userMemoryDeltaSchema),
  groupMemoryDelta: groupMemoryDeltaSchema.optional()
})
```

- [ ] **Step 3: Сборка**

Run (из `api/`): `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/agents/memory-updater/models/user-memory-delta.type.ts api/src/modules/agents/configs/memory-updater-agent.config.ts
git commit -m "$(cat <<'EOF'
feat(v2): extend memory-updater output with groupMemoryDelta + finalize prompt

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `MemoryUpdaterAgentService.finalizeGroupMemory`

**Files:**
- Modify: `api/src/modules/agents/memory-updater/memory-updater-agent.service.ts`

- [ ] **Step 1: Добавить импорты**

В `api/src/modules/agents/memory-updater/memory-updater-agent.service.ts` к импортам (после строки 6, импорт `MemoryUpdaterOutput`) добавить:

```ts
import { GroupMemoryDelta } from '../../group-memory/models/group-memory-delta.type'
```

- [ ] **Step 2: Добавить метод `finalizeGroupMemory`**

В классе `MemoryUpdaterAgentService`, сразу после метода `updateAfterRound` (после строки 48, перед `private buildFirstRoundPrompt`), добавить:

```ts
  public async finalizeGroupMemory(
    session: AgentSession<MemoryUpdaterOutput>,
    input: { readonly currentText: string; readonly summaryRequested: boolean }
  ): Promise<GroupMemoryDelta> {
    const userPrompt: string = this.buildGroupFinalizePrompt(input)
    const response = await this.runner.continue<MemoryUpdaterOutput>(session, userPrompt)
    const delta: GroupMemoryDelta = response.parsed?.groupMemoryDelta ?? {}
    this.logger.log(
      `memory_updater_group_finalize session=${session.id} themes=${delta.themesDelta?.length ?? 0} inJokes=${delta.inJokesDelta?.length ?? 0} summary=${delta.newSummaryText ? 'yes' : 'no'}`
    )
    return delta
  }

  private buildGroupFinalizePrompt(input: {
    readonly currentText: string
    readonly summaryRequested: boolean
  }): string {
    const lines: string[] = [
      'Игра завершена. Ты видел все раунды этой игры выше.',
      'Обнови ПАМЯТЬ КОМПАНИИ — общий контекст про этих людей как компанию.',
      '',
      '# Текущая память компании:',
      input.currentText,
      '',
      'Верни JSON: {"updates": {}, "groupMemoryDelta": { ... }}.',
      '- updates оставь пустым объектом {} — память игроков уже обновлена по раундам.',
      '- groupMemoryDelta — только ИЗМЕНЕНИЯ относительно текущей памяти компании выше.'
    ]
    if (input.summaryRequested) {
      lines.push(
        '- Также верни newSummaryText: 4-8 предложений свободного саммари про компанию (то, что не лезет в структурные поля). Не повторяй дословно то, что уже в themes/inJokes/triggers.'
      )
    } else {
      lines.push('- newSummaryText НЕ возвращай в этот раз.')
    }
    return lines.join('\n')
  }
```

- [ ] **Step 3: Сборка**

Run (из `api/`): `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/agents/memory-updater/memory-updater-agent.service.ts
git commit -m "$(cat <<'EOF'
feat(v2): memory-updater finalizeGroupMemory call

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Интеграция в игру

### Task 8: Протянуть `test_account` через UserProfile → Player

**Files:**
- Modify: `api/src/modules/user/models/user-profile.type.ts`
- Modify: `api/src/modules/user/user.repository.ts:73-84` (метод `toProfile`)
- Modify: `api/src/modules/game/models/player.type.ts`
- Modify: `api/src/modules/game/game.utils.ts:22-39` (`createHumanPlayer`) и `:43-56` (`createBotPlayer`)
- Modify: `api/src/modules/game/game.service.ts` (`createRoom`, `joinRoom`)

- [ ] **Step 1: Добавить `testAccount` в `UserProfile`**

В `api/src/modules/user/models/user-profile.type.ts` добавить поле в `UserProfile` после `role`:

```ts
export type UserProfile = {
  readonly id: string
  readonly login: string
  readonly realName: string
  readonly displayName: string
  readonly gender: UserGender
  readonly bio: string | null
  readonly role: UserRole
  readonly testAccount: boolean
  readonly createdAt: Date
}
```

- [ ] **Step 2: Заполнять `testAccount` в `toProfile`**

В `api/src/modules/user/user.repository.ts` в методе `toProfile` (строки 73-84) добавить поле:

```ts
  private toProfile(row: typeof users.$inferSelect): UserProfile {
    return {
      id: row.id,
      login: row.login,
      realName: row.realName,
      displayName: row.displayName,
      gender: row.gender,
      bio: row.bio,
      role: row.role,
      testAccount: row.testAccount,
      createdAt: row.createdAt
    }
  }
```

- [ ] **Step 3: Добавить `isTestAccount` в `Player`**

В `api/src/modules/game/models/player.type.ts` добавить поле:

```ts
import { UserGender } from '../../user/models/user-profile.type'

export type Player = {
  readonly id: string
  socketId: string | null
  readonly isBot: boolean
  readonly name: string
  readonly realName: string
  readonly bio: string
  readonly gender: UserGender
  readonly isTestAccount: boolean
  connected: boolean
  score: number
}
```

- [ ] **Step 4: Обновить фабрики игроков**

В `api/src/modules/game/game.utils.ts` заменить `createHumanPlayer` (строки 22-39):

```ts
export const createHumanPlayer = (input: {
  readonly userId: string
  readonly socketId: string | null
  readonly displayName: string
  readonly realName: string
  readonly bio: string | null
  readonly gender: 'male' | 'female' | 'non-binary' | 'not-specified'
  readonly isTestAccount: boolean
}): Player => ({
  id: input.userId,
  socketId: input.socketId,
  isBot: false,
  name: normalizeName(input.displayName),
  realName: normalizeName(input.realName),
  bio: input.bio?.slice(0, 200) ?? '',
  gender: input.gender,
  isTestAccount: input.isTestAccount,
  connected: true,
  score: 0
})
```

И в `createBotPlayer` (строки 43-56) добавить `isTestAccount: false` в возвращаемый объект:

```ts
export const createBotPlayer = (input: { readonly botNumber: number }): Player => {
  const label: string = BOT_NAMES[input.botNumber - 1] ?? `AI Bot ${input.botNumber}`
  return {
    id: createId(),
    socketId: null,
    isBot: true,
    name: label,
    realName: label,
    bio: '',
    gender: 'not-specified',
    isTestAccount: false,
    connected: true,
    score: 0
  }
}
```

- [ ] **Step 5: Передать флаг в `createRoom` и `joinRoom`**

В `api/src/modules/game/game.service.ts` в `createRoom` дополнить вызов `createHumanPlayer` (строки 105-112) полем `isTestAccount`:

```ts
    const host = createHumanPlayer({
      userId: input.host.id,
      socketId: input.socketId,
      displayName: input.host.displayName,
      realName: input.host.realName,
      bio: input.host.bio,
      gender: input.host.gender,
      isTestAccount: input.host.testAccount
    })
```

В `joinRoom` найти вызов `createHumanPlayer` (начинается на строке 168) и так же добавить `isTestAccount: input.user.testAccount` в объект-аргумент.

- [ ] **Step 6: Сборка**

Run (из `api/`): `npm run build`
Expected: PASS. Если tsc укажет на другие места, где `UserProfile` или `createHumanPlayer` конструируются вручную (например, тестовые сидеры) — добавить `testAccount`/`isTestAccount` там же.

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/user/models/user-profile.type.ts api/src/modules/user/user.repository.ts api/src/modules/game/models/player.type.ts api/src/modules/game/game.utils.ts api/src/modules/game/game.service.ts
git commit -m "$(cat <<'EOF'
feat(v2): thread test_account flag through UserProfile and Player

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Finalize group memory при завершении игры

**Files:**
- Modify: `api/src/modules/game/models/game-room.type.ts`
- Modify: `api/src/modules/game/game.service.ts` (импорты, конструктор, `createRoom`, `startGame`, `advanceRound`, новые методы)
- Modify: `api/src/modules/game/game.module.ts`

- [ ] **Step 1: Добавить `groupMemoryBlock` в `GameRoom`**

В `api/src/modules/game/models/game-room.type.ts` добавить поле в тип `GameRoom` (после `userMemorySnapshots`):

```ts
  userMemorySnapshots: readonly UserMemorySnapshot[]
  groupMemoryBlock: string | null
  memoryDeltasLog: MemoryUpdaterOutput[]
```

- [ ] **Step 2: Подключить `GroupMemoryService` в `GameService`**

В `api/src/modules/game/game.service.ts` добавить импорт (рядом с импортом `UserMemoryService`, строка 38):

```ts
import { GroupMemoryService } from '../group-memory/group-memory.service'
```

В конструкторе `GameService` (строки 70-80) добавить параметр последним:

```ts
  public constructor(
    private readonly aiService: AiService,
    private readonly jokeMemoryService: JokeMemoryService,
    private readonly promptStarterService: PromptStarterService,
    private readonly botAgent: BotAgentService,
    private readonly openingGeneratorAgent: OpeningGeneratorAgentService,
    private readonly openingSelection: OpeningSelectionService,
    private readonly memoryUpdaterAgent: MemoryUpdaterAgentService,
    private readonly claudeRunner: ClaudeAgentRunnerService,
    private readonly userMemoryService: UserMemoryService,
    private readonly groupMemoryService: GroupMemoryService
  ) {}
```

- [ ] **Step 3: Инициализировать `groupMemoryBlock` в `createRoom`**

В объекте `room` внутри `createRoom` (строки 116-145) добавить поле после `userMemorySnapshots: []`:

```ts
      userMemorySnapshots: [],
      groupMemoryBlock: null,
      memoryDeltasLog: [],
```

- [ ] **Step 4: Загрузить блок памяти при старте игры**

В `api/src/modules/game/game.service.ts` в `startGame` после строки `room.userMemorySnapshots = await this.buildUserMemorySnapshots(room)` (строка 265) добавить:

```ts
      room.userMemorySnapshots = await this.buildUserMemorySnapshots(room)
      room.groupMemoryBlock = await this.groupMemoryService.getPromptBlock()
```

- [ ] **Step 5: Вызвать finalize при завершении игры**

В `advanceRound` заменить ветку game-finished (строки 1164-1173):

```ts
    if (room.roundIndex >= room.roundCount) {
      room.phase = 'finished'
      this.clearRoomTimer(room)
      const totals = Array.from(room.players.values()).map((p) => `${p.name}=${p.score}`).join(' ')
      this.logger.log(`game_finished room=${room.code} rounds=${room.roundCount} final_scores=[${totals}]`)
      this.emitRoomState(room.code)
      this.evaluateAndSaveGoldenOpenings(room)
      void this.finalizeGroupMemoryAndCleanup(room)
      return
    }
```

- [ ] **Step 6: Добавить методы finalize**

В `api/src/modules/game/game.service.ts` сразу после метода `advanceRound` (после строки 1175) добавить три метода:

```ts
  private async finalizeGroupMemoryAndCleanup(room: GameRoom): Promise<void> {
    try {
      await this.finalizeGroupMemory(room)
    } finally {
      await this.cleanupSessions(room)
    }
  }

  private async finalizeGroupMemory(room: GameRoom): Promise<void> {
    if (!this.countsForGroupMemory(room)) {
      this.logger.log(`group_memory_finalize_skip room=${room.code} reason=test_game`)
      return
    }
    if (room.memoryUpdaterInFlight) {
      await room.memoryUpdaterInFlight.catch(() => undefined)
    }
    const session = room.sessions.memoryUpdater
    if (!session) {
      this.logger.warn(`group_memory_finalize_skip room=${room.code} reason=no_session`)
      return
    }
    try {
      const context = await this.groupMemoryService.getFinalizeContext()
      const delta = await this.memoryUpdaterAgent.finalizeGroupMemory(session, context)
      await this.groupMemoryService.applyDelta(delta)
      this.logger.log(
        `group_memory_finalize_ok room=${room.code} summary_requested=${context.summaryRequested}`
      )
    } catch (error: unknown) {
      this.logger.warn(
        `group_memory_finalize_failed room=${room.code} error=${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private countsForGroupMemory(room: GameRoom): boolean {
    if (!room.collectData) {
      return false
    }
    for (const player of room.players.values()) {
      if (!player.isBot && player.isTestAccount) {
        return false
      }
    }
    return true
  }
```

> Примечание: `cleanupSessions` сама в начале ждёт `memoryUpdaterInFlight` — повторный await в `finalizeGroupMemory` безвреден. Finalize выполняется ДО `cleanupSessions`, поэтому сессия memory-updater ещё жива.

- [ ] **Step 7: Импортировать `GroupMemoryModule` в `GameModule`**

В `api/src/modules/game/game.module.ts` добавить импорт модуля и включить его в массив `imports` декоратора `@Module`:

```ts
import { GroupMemoryModule } from '../group-memory/group-memory.module'
```

Добавить `GroupMemoryModule` в массив `imports` (рядом с прочими `*Module`).

- [ ] **Step 8: Сборка**

Run (из `api/`): `npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add api/src/modules/game/models/game-room.type.ts api/src/modules/game/game.service.ts api/src/modules/game/game.module.ts
git commit -m "$(cat <<'EOF'
feat(v2): finalize group memory on game finish (skips test games)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Передать блок памяти в генераторы

**Files:**
- Modify: `api/src/modules/agents/opening-generator/opening-generator-agent.service.ts`
- Modify: `api/src/modules/agents/bot/bot-agent.service.ts`
- Modify: `api/src/modules/game/game.service.ts` (`prewarmBotSessions`, `generateOpeningsViaAgent`)

- [ ] **Step 1: Принять `groupMemory` в opening-generator**

В `api/src/modules/agents/opening-generator/opening-generator-agent.service.ts` добавить поле в `StartOpeningGeneratorInput` (строки 38-44):

```ts
export type StartOpeningGeneratorInput = {
  readonly players: readonly OpeningPlayerProfile[]
  readonly golden: readonly GoldenOpeningExample[]
  readonly medium: readonly MediumOpeningExample[]
  readonly negative: readonly NegativeOpeningExample[]
  readonly groupMemory?: string
  readonly needed: number
}
```

В `buildStartPrompt` после цикла профилей игроков и `lines.push('')` (строка 98) вставить блок памяти перед GOLDEN:

```ts
    lines.push('')
    if (input.groupMemory) {
      lines.push(input.groupMemory)
      lines.push('')
    }
    if (input.golden.length > 0) {
```

- [ ] **Step 2: Принять `groupMemory` в bot-agent**

В `api/src/modules/agents/bot/bot-agent.service.ts` изменить сигнатуру `startForBot` (строки 39-48):

```ts
  public async startForBot(
    roomCode: string,
    botId: string,
    players: readonly BotPlayerProfile[],
    groupMemory?: string
  ): Promise<BotStartResult> {
    const initialPrompt: string = this.buildInitialPrompt(players, groupMemory)
    const { session } = await this.runner.start<never>(BOT_AGENT_CONFIG, initialPrompt)
    this.logger.log(`bot_start room=${roomCode} bot=${botId} session=${session.id}`)
    return { session }
  }
```

Изменить `buildInitialPrompt` (строки 75-85):

```ts
  private buildInitialPrompt(
    players: readonly BotPlayerProfile[],
    groupMemory?: string
  ): string {
    const profileLines: string[] = players.map((player) => this.formatPlayerProfile(player))
    const lines: string[] = ['За этим столом сегодня играют:', ...profileLines]
    if (groupMemory) {
      lines.push('', groupMemory)
    }
    lines.push(
      '',
      'Это весь состав. Ниже я буду присылать setup\'ы шуток — пиши на каждый ровно ОДНУ строку с твоим лучшим punchline. Без вариантов, без markdown, без кавычек, без объяснений.',
      '',
      'Сейчас подтверди готовность одним словом "готов" и жди setup.'
    )
    return lines.join('\n')
  }
```

- [ ] **Step 3: Передать блок из game.service**

В `api/src/modules/game/game.service.ts`:

(a) В `prewarmBotSessions` изменить вызов `startForBot` (строка 286):

```ts
          const result = await this.botAgent.startForBot(
            room.code,
            bot.id,
            profiles,
            room.groupMemoryBlock ?? undefined
          )
```

(b) В `generateOpeningsViaAgent` изменить вызов `startForRoom` (строки 411-417):

```ts
      const result = await this.openingGeneratorAgent.startForRoom(room.code, {
        players,
        golden,
        medium,
        negative,
        groupMemory: room.groupMemoryBlock ?? undefined,
        needed
      })
```

- [ ] **Step 4: Сборка**

Run (из `api/`): `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/agents/opening-generator/opening-generator-agent.service.ts api/src/modules/agents/bot/bot-agent.service.ts api/src/modules/game/game.service.ts
git commit -m "$(cat <<'EOF'
feat(v2): feed group memory block into opening + bot generators

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Админка

### Task 11: Admin endpoints для group memory

**Files:**
- Modify: `api/src/modules/admin/admin.controller.ts`
- Modify: `api/src/modules/admin/admin.module.ts`

- [ ] **Step 1: Импортировать модуль в `AdminModule`**

В `api/src/modules/admin/admin.module.ts` добавить импорт и включить `GroupMemoryModule` в массив `imports`:

```ts
import { forwardRef, Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { GroupMemoryModule } from '../group-memory/group-memory.module'
import { JokeMemoryModule } from '../joke-memory/joke-memory.module'
import { PromptStarterModule } from '../prompt-starter/prompt-starter.module'
import { UserModule } from '../user/user.module'
import { AdminController } from './admin.controller'
import { AdminGuard } from './admin.guard'

@Module({
  imports: [
    PromptStarterModule,
    JokeMemoryModule,
    UserModule,
    GroupMemoryModule,
    forwardRef(() => AuthModule)
  ],
  controllers: [AdminController],
  providers: [AdminGuard]
})
export class AdminModule {}
```

- [ ] **Step 2: Добавить эндпоинты в `AdminController`**

В `api/src/modules/admin/admin.controller.ts`:

(a) Добавить импорт `GroupMemoryService`:

```ts
import { GroupMemoryService } from '../group-memory/group-memory.service'
```

(b) В конструктор `AdminController` (строки 68-71) добавить параметр:

```ts
  public constructor(
    private readonly promptRepository: PromptStarterRepository,
    private readonly jokeRepository: JokeMemoryRepository,
    private readonly groupMemoryService: GroupMemoryService
  ) {}
```

(c) Перед методом `serializePrompt` (перед строкой 333) добавить два эндпоинта:

```ts
  @Get('group-memory')
  @UseGuards(AdminGuard)
  public async getGroupMemory(): Promise<Record<string, unknown>> {
    const row = await this.groupMemoryService.getAdminView()
    return {
      themes: row.themes,
      inJokes: row.inJokes,
      triggers: row.triggers,
      avoidedThemes: row.avoidedThemes,
      setupPatterns: row.setupPatterns,
      summaryText: row.summaryText,
      gamesProcessed: row.gamesProcessed,
      summaryRefreshedAtGame: row.summaryRefreshedAtGame,
      memoryEnabled: row.memoryEnabled,
      updatedAt: row.updatedAt
    }
  }

  @Patch('group-memory')
  @UseGuards(AdminGuard)
  public async updateGroupMemory(
    @Body() body: { memoryEnabled?: boolean }
  ): Promise<{ ok: boolean }> {
    if (typeof body.memoryEnabled === 'boolean') {
      await this.groupMemoryService.setMemoryEnabled(body.memoryEnabled)
    }
    return { ok: true }
  }
```

- [ ] **Step 3: Сборка**

Run (из `api/`): `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/admin/admin.controller.ts api/src/modules/admin/admin.module.ts
git commit -m "$(cat <<'EOF'
feat(v2): admin endpoints for group memory (view + memoryEnabled toggle)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Web — секция Group Memory в админке

**Files:**
- Modify: `web/src/admin/admin-api.ts`
- Modify: `web/src/admin/AdminView.tsx`

- [ ] **Step 1: Добавить тип и методы в `admin-api.ts`**

В `web/src/admin/admin-api.ts` после типа `JokeListItem` (после строки 46) добавить тип:

```ts
export type GroupMemoryView = {
  readonly themes: readonly { theme: string; score: number; mentions: number; examples: readonly string[] }[]
  readonly inJokes: readonly { phrase: string; kind: string; mentions: number }[]
  readonly triggers: readonly { trigger: string; score: number; examples: readonly string[] }[]
  readonly avoidedThemes: readonly { theme: string; reason: string }[]
  readonly setupPatterns: readonly { pattern: string; score: number }[]
  readonly summaryText: string | null
  readonly gamesProcessed: number
  readonly summaryRefreshedAtGame: number
  readonly memoryEnabled: boolean
  readonly updatedAt: string
}
```

В объект `adminApi` (перед закрывающей `}` на строке 212, после `deleteJoke`) добавить методы — не забыть запятую после `deleteJoke`:

```ts
  deleteJoke(token: string, id: string): Promise<{ ok: boolean }> {
    return request(`/api/admin/jokes/${id}`, { method: 'DELETE', token })
  },
  getGroupMemory(token: string): Promise<GroupMemoryView> {
    return request(`/api/admin/group-memory`, { method: 'GET', token })
  },
  updateGroupMemory(token: string, body: { memoryEnabled: boolean }): Promise<{ ok: boolean }> {
    return request(`/api/admin/group-memory`, { method: 'PATCH', body, token })
  }
}
```

- [ ] **Step 2: Добавить таб в `AdminView`**

В `web/src/admin/AdminView.tsx`:

(a) Расширить тип `AdminTab` (строка 16):

```ts
type AdminTab = 'prompts' | 'jokes' | 'group'
```

(b) Добавить импорт `GroupMemoryView` к существующему импорту из `./admin-api` (строки 5-14) — дописать `GroupMemoryView` в список именованных импортов.

(c) В блоке кнопок-табов (после кнопки «Шутки», строка 96) добавить третью кнопку:

```tsx
          <button
            type="button"
            className={tab === 'jokes' ? 'primary' : 'secondary'}
            onClick={() => setTab('jokes')}
          >
            Шутки
          </button>
          <button
            type="button"
            className={tab === 'group' ? 'primary' : 'secondary'}
            onClick={() => setTab('group')}
          >
            Память компании
          </button>
```

(d) Заменить строку рендера контента таба (строка 99):

```tsx
        {tab === 'prompts' && <PromptsTab token={token} />}
        {tab === 'jokes' && <JokesTab token={token} />}
        {tab === 'group' && <GroupMemoryTab token={token} />}
```

- [ ] **Step 3: Добавить компонент `GroupMemoryTab`**

В `web/src/admin/AdminView.tsx` перед функцией `FilterBar` (перед строкой 306, после `JokeRow`) добавить компонент:

```tsx
function GroupMemoryTab({ token }: { readonly token: string }): ReactElement {
  const [data, setData] = useState<GroupMemoryView | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<boolean>(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setData(await adminApi.getGroupMemory(token))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { void load() }, [load])

  const toggleEnabled = async (): Promise<void> => {
    if (!data) {
      return
    }
    setSaving(true)
    try {
      await adminApi.updateGroupMemory(token, { memoryEnabled: !data.memoryEnabled })
      await load()
    } catch (e) {
      alert(`Ошибка: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="subtitle">Загрузка...</p>
  }
  if (error) {
    return <p className="errorText">{error}</p>
  }
  if (!data) {
    return <p className="subtitle">Нет данных</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="phaseBlock">
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <Chip tone={data.memoryEnabled ? 'positive' : 'negative'}>
            {data.memoryEnabled ? 'Память ВКЛючена' : 'Память ВЫКЛючена'}
          </Chip>
          <button type="button" className="secondary" disabled={saving} onClick={toggleEnabled}>
            {data.memoryEnabled ? 'Выключить' : 'Включить'}
          </button>
        </div>
        <p className="subtitle" style={{ marginTop: 6 }}>
          Игр обработано: {data.gamesProcessed} · саммари обновлено на игре {data.summaryRefreshedAtGame}
        </p>
      </div>

      <div className="phaseBlock">
        <h3 style={{ marginTop: 0 }}>Темы</h3>
        <div className="adminChips">
          {data.themes.length === 0 && <span className="subtitle">пусто</span>}
          {data.themes.map((t) => (
            <Chip key={t.theme}>{t.theme} <strong>{t.score.toFixed(2)}</strong> (m{t.mentions})</Chip>
          ))}
        </div>
      </div>

      <div className="phaseBlock">
        <h3 style={{ marginTop: 0 }}>Клички и инсайды</h3>
        <div className="adminChips">
          {data.inJokes.length === 0 && <span className="subtitle">пусто</span>}
          {data.inJokes.map((j) => (
            <Chip key={j.phrase}>{j.phrase} <strong>{j.kind}</strong> (m{j.mentions})</Chip>
          ))}
        </div>
      </div>

      <div className="phaseBlock">
        <h3 style={{ marginTop: 0 }}>Триггеры</h3>
        <div className="adminChips">
          {data.triggers.length === 0 && <span className="subtitle">пусто</span>}
          {data.triggers.map((t) => (
            <Chip key={t.trigger}>{t.trigger} <strong>{t.score.toFixed(2)}</strong></Chip>
          ))}
        </div>
      </div>

      <div className="phaseBlock">
        <h3 style={{ marginTop: 0 }}>Избегать</h3>
        <div className="adminChips">
          {data.avoidedThemes.length === 0 && <span className="subtitle">пусто</span>}
          {data.avoidedThemes.map((t) => (
            <Chip key={t.theme} tone="negative">{t.theme} — {t.reason}</Chip>
          ))}
        </div>
      </div>

      <div className="phaseBlock">
        <h3 style={{ marginTop: 0 }}>Setup-паттерны</h3>
        <div className="adminChips">
          {data.setupPatterns.length === 0 && <span className="subtitle">пусто</span>}
          {data.setupPatterns.map((s) => (
            <Chip key={s.pattern}>{s.pattern} <strong>{s.score.toFixed(2)}</strong></Chip>
          ))}
        </div>
      </div>

      <div className="phaseBlock">
        <h3 style={{ marginTop: 0 }}>Саммари</h3>
        <p className="subtitle">{data.summaryText && data.summaryText.trim().length > 0 ? data.summaryText : 'пусто'}</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Сборка web**

Run (из `web/`): `npm run build`
Expected: PASS, без TS-ошибок.

- [ ] **Step 5: Commit**

```bash
git add web/src/admin/admin-api.ts web/src/admin/AdminView.tsx
git commit -m "$(cat <<'EOF'
feat(v2): admin UI section for group memory

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Финальная ручная проверка (после всех задач)

Это не TDD-шаги — выполняется один раз после Task 12. Test-runner'а в проекте нет, поэтому проверка ручная.

- [ ] **Применить миграцию.** Запустить API (`npm run dev:api` из корня) — `runMigrations` применит `0007` автоматически. В логах не должно быть ошибок миграции. Проверить в `npm run db:studio`, что таблица `group_memory` создана, а у `users` появилась колонка `test_account`.

- [ ] **Пометить тестовые аккаунты (разовый SQL).** Вне scope автоматизации. Через `db:studio` или psql выполнить вручную, подставив реальные логины тест-аккаунтов:
  ```sql
  UPDATE users SET test_account = true WHERE login IN ('<test-login-1>', '<test-login-2>', ...);
  ```
  **Перед выполнением показать Dima список логинов и дождаться подтверждения** (правило: любой DB write — с подтверждением).

- [ ] **Боевая игра.** Сыграть полную игру обычными (не тест) аккаунтами. После финального scoreboard в логах API ожидать `group_memory_finalize_ok`. В админке (таб «Память компании») — увидеть заполнившиеся темы/клички и `Игр обработано: 1`.

- [ ] **Тест-игра исключается.** Сыграть игру, где есть хотя бы один `test_account`-игрок. В логах ожидать `group_memory_finalize_skip ... reason=test_game`, `gamesProcessed` в админке не изменился.

- [ ] **Киллсвитч.** В админке выключить тогл. Начать новую игру — блок «Контекст компании» не должен попадать в промпты (проверить по логам/поведению генератора). Накопление при этом продолжается (`finalize_ok` всё равно логируется).

- [ ] **Саммари.** После 3-й зачтённой игры в `finalize` ожидать `summary_requested=true`, в админке появляется текст саммари.

---

## Self-Review (выполнено автором плана)

**Spec coverage:**
- §2.1 `group_memory` таблица → Task 1. §2.2 `users.test_account` → Task 1. §2.3 миграция 0007 → Task 1.
- §3.1 рендер блока (top-K) → Task 4 (`renderBlock`). §3.2 оба генератора → Task 10. §3.3 пустая память → `renderBlock` возвращает `null` (Task 4).
- §4.1 дельты → Task 2 + Task 4. §4.2 extended memory-updater, finalize → Task 6 + Task 7. §4.3 форма дельты → Task 2 (типы) + Task 6 (zod). §4.4 структура каждую игру / summary раз в 3 → Task 4 (`SUMMARY_REFRESH_EVERY_GAMES`, `getFinalizeContext`, `mergeAll`). §4.5 исключение тест-игр → Task 8 + Task 9 (`countsForGroupMemory`). §4.6 транзакция + FOR UPDATE → Task 3 (`applyMerge`). §4.7 деградация (отмена/фейл/нет сессии) → Task 9 (`finalizeGroupMemory` guard'ы + try/catch).
- §5 киллсвитч `memoryEnabled` → Task 4 (`getPromptBlock` возвращает `null`), накопление продолжается (`getFinalizeContext`/`applyDelta` не смотрят на флаг). Toggle → Task 11.
- §6 админка → Task 11 (endpoints) + Task 12 (UI).
- §7 вне scope — соблюдено (backfill не делается, пометка test_account — ручной SQL в финальной проверке).

**Placeholder scan:** запрещённых заглушек нет — весь код приведён целиком.

**Type consistency:** `GroupMemoryDelta` (Task 2) ↔ `groupMemoryDeltaSchema` (Task 6) ↔ `mergeAll`/merge-функции (Task 4) — имена полей (`themesDelta`, `inJokesDelta`, `triggersDelta`, `avoidedThemesDelta`, `setupPatternsDelta`, `newSummaryText`) совпадают. `GroupMemoryWriteFields` (Task 2) ↔ `applyMerge` `.set({...})` (Task 3) ↔ возврат `mergeAll` (Task 4) — поля совпадают. `finalizeGroupMemory` сигнатура (Task 7) ↔ вызов в game.service (Task 9) — `{ currentText, summaryRequested }` совпадает с `GroupMemoryFinalizeContext` (Task 4). `groupMemory` (опц.) в `StartOpeningGeneratorInput`/`startForBot` (Task 10) ↔ `room.groupMemoryBlock` (Task 9).
