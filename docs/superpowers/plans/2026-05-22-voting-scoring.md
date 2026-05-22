# Voting Reveal + Round-Based Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Удлинить паузу-reveal после голосования и переделать подсчёт очков на раунд-зависимый вес голоса с пропорциональным распределением очков воздержавшихся.

**Architecture:** Чистая backend-правка в `game.service.ts` + одна константа в `game.constants.ts`. Очки начисляются по-прежнему per-duel в `scoreCurrentDuel`, но теперь голос весит по номеру раунда, а вес воздержавшихся делится между авторами пропорционально голосам.

**Tech Stack:** NestJS 11, TypeScript.

---

## Контекст и исходное состояние

Разведка текущего кода (ветка с фиксами #41-45):

- **Очки сейчас:** `scoreCurrentDuel` (`game.service.ts:932-945`) — оба автора дуэли получают `score += <число голосов за их сторону>`. 1 голос = 1 очко. Номер раунда на очки не влияет. Начисление — per-duel, когда дуэль закрывается (`advanceVoting` → `scoreCurrentDuel`). Голосующие очков не получают, только авторы шуток. `addScoreToWinners` (`game.service.ts:1352-1358`) — собственно инкремент `player.score`.
- **Reveal сейчас:** `VOTING_REVEAL_SECONDS = 5` (`game.constants.ts:8`). После того как все проголосовали в дуэли, `scheduleVotingReveal` ставит таймер на эту паузу перед `advanceVoting`. (Реализовано в #41-45 — пользователь думал, что значение 1.5с; фактически 5с.)
- **Видимость авторов/голосов (пункт 2 запроса) — УЖЕ РЕАЛИЗОВАНО в #41-45.** `filterVotesForViewer` (`game.service.ts:1317-1329`): участники дуэли видят все голоса всегда; остальные — после своего голоса. `App.tsx:699` — `authorRevealed = hasVotedCurrentDuel || isDuelParticipant` показывает имена авторов. Это ровно «два режима» из запроса. Кода НЕ требует — только проверка в плейтесте (см. раздел «Ручная проверка»).
- `roundIndex` — 1-based (первый раунд = 1). `ROUND_COUNT_MIN=2`, `ROUND_COUNT_MAX=4`, `ROUND_COUNT_DEFAULT=4` (`game.constants.ts:1-3`) — раундов всегда 1..4.
- `Duel` тип (`models/duel.type.ts`): `votes: Map<string,'left'|'right'>`, `leftPlayerId`, `rightPlayerId`, `closed`, `promptIndex`.
- Эл. избиратели дуэли: все люди (`!isBot`) кроме двух участников (`canPlayerVote`, `game.service.ts:901-903`). Боты не голосуют.

**Решение пользователя по краевому случаю:** если в дуэли НИКТО не проголосовал (0:0) — очки воздержавшихся НИКТО не получает (пул сгорает, оба автора 0 за эту дуэль).

**База ветки:** обе правки зависят от #41-45 (коммит `1490366` — там появилась `VOTING_REVEAL_SECONDS`). Рекомендуется ветка `feat/voting-scoring` от `1490366`, либо продолжить на `feat/group-memory`. Решить при исполнении.

> **Тесты:** в проекте нет test-runner'а. Верификация — сборка: `npm run build` в `api/` (`tsc -p tsconfig.json`).

---

## Task 1: Удлинить reveal-паузу до 6 секунд

**Files:**
- Modify: `api/src/modules/game/constants/game.constants.ts:8`

- [ ] **Step 1: Поменять значение константы**

In `api/src/modules/game/constants/game.constants.ts` change the line:

```ts
export const VOTING_REVEAL_SECONDS: number = 5
```

to:

```ts
export const VOTING_REVEAL_SECONDS: number = 6
```

- [ ] **Step 2: Сборка**

Run (из `api/`): `npm run build`
Expected: PASS, без TS-ошибок.

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/game/constants/game.constants.ts
git commit -m "$(cat <<'EOF'
feat(v2): extend post-vote reveal pause to 6s

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Раунд-зависимый вес голоса + распределение очков воздержавшихся

**Files:**
- Modify: `api/src/modules/game/constants/game.constants.ts`
- Modify: `api/src/modules/game/game.service.ts`

**Модель начисления (per duel):**
- Вес голоса по раунду: раунд 1 → 100, раунд 2 → 150, раунд 3 → 200, раунд 4 → 300.
- Каждый проголосовавший избиратель приносит `вес` очков автору, за которого голосовал.
- Воздержавшиеся (эл. избиратели, не проголосовавшие): их суммарный вес (`abstainCount × вес`) делится между двумя авторами пропорционально числу прямых голосов.
- Если в дуэли 0 голосов вообще — оба автора получают 0 (пул воздержавшихся сгорает).
- Пример (раунд 4, вес 300): голоса 2:1, один воздержался → его 300 идут как `round(300×2/3)=200` и `300−200=100`. Итог авторам: левый `2×300 + 200 = 800`, правый `1×300 + 100 = 400`.

- [ ] **Step 1: Добавить константу весов**

In `api/src/modules/game/constants/game.constants.ts`, after the line `export const ROUND_COUNT_MIN: number = 2`, add:

```ts
export const ROUND_VOTE_WEIGHTS: readonly number[] = [100, 150, 200, 300]
```

- [ ] **Step 2: Импортировать константу в `game.service.ts`**

In `api/src/modules/game/game.service.ts` there is an import block from `'./constants/game.constants'`. Add `ROUND_VOTE_WEIGHTS` to that import list (place it after `ROUND_COUNT_MIN`):

```ts
import {
  BOT_COUNT_MAX,
  BOT_COUNT_MIN,
  ROUND_COUNT_DEFAULT,
  ROUND_COUNT_MAX,
  ROUND_COUNT_MIN,
  ROUND_VOTE_WEIGHTS,
  RATING_PHASE_SECONDS,
  SCOREBOARD_PHASE_SECONDS,
  VOTING_PHASE_SECONDS,
  VOTING_REVEAL_SECONDS,
  WRITING_PHASE_SECONDS
} from './constants/game.constants'
```

(Match the actual current order of that import block — only ADD the `ROUND_VOTE_WEIGHTS` line, don't reorder the rest.)

- [ ] **Step 3: Переписать `scoreCurrentDuel`**

In `api/src/modules/game/game.service.ts` replace the `scoreCurrentDuel` method (currently `game.service.ts:932-945`):

```ts
  private scoreCurrentDuel(room: GameRoom): void {
    const duel = room.duels[room.duelIndex]
    if (!duel || duel.closed) {
      return
    }
    duel.closed = true
    const leftVotes = this.countVotes(duel.votes, 'left')
    const rightVotes = this.countVotes(duel.votes, 'right')
    this.addScoreToWinners(room, duel.leftPlayerId, leftVotes)
    this.addScoreToWinners(room, duel.rightPlayerId, rightVotes)
    this.trackBotDuelMetrics(room, duel.leftPlayerId, duel.rightPlayerId, leftVotes, rightVotes)
    this.maybeLogBotMetrics()
    this.recordRoundVotes(room, duel.promptIndex, duel.leftPlayerId, duel.rightPlayerId, leftVotes, rightVotes)
  }
```

with:

```ts
  private scoreCurrentDuel(room: GameRoom): void {
    const duel = room.duels[room.duelIndex]
    if (!duel || duel.closed) {
      return
    }
    duel.closed = true
    const leftVotes = this.countVotes(duel.votes, 'left')
    const rightVotes = this.countVotes(duel.votes, 'right')
    const points = this.computeDuelPoints(room, duel, leftVotes, rightVotes)
    this.addScore(room, duel.leftPlayerId, points.left)
    this.addScore(room, duel.rightPlayerId, points.right)
    this.trackBotDuelMetrics(room, duel.leftPlayerId, duel.rightPlayerId, leftVotes, rightVotes)
    this.maybeLogBotMetrics()
    this.recordRoundVotes(room, duel.promptIndex, duel.leftPlayerId, duel.rightPlayerId, leftVotes, rightVotes)
  }
```

(`trackBotDuelMetrics` и `recordRoundVotes` остаются на сырых счётчиках голосов — это аналитика, её менять НЕ нужно.)

- [ ] **Step 4: Добавить методы расчёта очков**

In `api/src/modules/game/game.service.ts`, immediately AFTER the `scoreCurrentDuel` method, add three private methods:

```ts
  private computeDuelPoints(
    room: GameRoom,
    duel: { readonly leftPlayerId: string; readonly rightPlayerId: string },
    leftVotes: number,
    rightVotes: number
  ): { readonly left: number; readonly right: number } {
    const votedCount = leftVotes + rightVotes
    if (votedCount === 0) {
      return { left: 0, right: 0 }
    }
    const weight = this.voteWeightForRound(room.roundIndex)
    const eligibleCount = this.countEligibleVoters(room, duel)
    const abstainCount = Math.max(0, eligibleCount - votedCount)
    const abstainPool = abstainCount * weight
    const leftAbstainShare = Math.round((abstainPool * leftVotes) / votedCount)
    const rightAbstainShare = abstainPool - leftAbstainShare
    return {
      left: leftVotes * weight + leftAbstainShare,
      right: rightVotes * weight + rightAbstainShare
    }
  }

  private countEligibleVoters(
    room: GameRoom,
    duel: { readonly leftPlayerId: string; readonly rightPlayerId: string }
  ): number {
    let count = 0
    for (const player of room.players.values()) {
      if (!player.isBot && this.canPlayerVote(duel, player.id)) {
        count += 1
      }
    }
    return count
  }

  private voteWeightForRound(roundIndex: number): number {
    const maxIndex = ROUND_VOTE_WEIGHTS.length
    const clamped = Math.min(Math.max(roundIndex, 1), maxIndex)
    return ROUND_VOTE_WEIGHTS[clamped - 1]
  }
```

- [ ] **Step 5: Переименовать `addScoreToWinners` → `addScore`**

In `api/src/modules/game/game.service.ts` the method `addScoreToWinners` (currently `game.service.ts:1352-1358`) is now misnamed (both authors score, not just a winner). Rename it. Replace:

```ts
  private addScoreToWinners(room: GameRoom, playerId: string, points: number): void {
    const player = room.players.get(playerId)
    if (!player || points <= 0) {
      return
    }
    player.score += points
  }
```

with:

```ts
  private addScore(room: GameRoom, playerId: string, points: number): void {
    const player = room.players.get(playerId)
    if (!player || points <= 0) {
      return
    }
    player.score += points
  }
```

The only call sites are the two `this.addScore(...)` lines added in Step 3. If `npm run build` reports any other `addScoreToWinners` caller, rename it there too.

- [ ] **Step 6: Сборка**

Run (из `api/`): `npm run build`
Expected: PASS, без TS-ошибок.

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/game/constants/game.constants.ts api/src/modules/game/game.service.ts
git commit -m "$(cat <<'EOF'
feat(v2): round-based vote weights + proportional abstainer scoring

Vote weight scales by round (100/150/200/300). Each cast vote awards
its weight to the chosen author; abstainers' weight pool is split
between the two authors proportionally to direct votes. A duel with
zero votes awards nothing.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Ручная проверка (после обеих задач)

Test-runner'а нет — проверка ручная, в плейтесте.

- [ ] **Пункт 2 (видимость) — уже реализовано в #41-45, проверить что работает.** Зайти голосующим (не участником дуэли): до своего голоса не видно ни имён авторов, ни кто за кого голосовал. После своего голоса — видны имена авторов на обеих карточках И раскладка голосов. Участники дуэли (чьи шутки соревнуются) видят всё с самого начала. Если что-то из этого НЕ работает — это отдельный баг, чинить вне этого плана.
- [ ] **Reveal 6с.** После того как все проголосовали в дуэли — пауза перед переходом к следующей дуэли ~6 секунд, анимация отсчёта доигрывает.
- [ ] **Очки по раундам.** Сыграть ≥2 раунда. В раунде 1 голос даёт 100, в раунде 2 — 150 (видно по приросту `score` на scoreboard). Свериться с логом `scoreboard_phase_start ... totals=[...]`.
- [ ] **Воздержавшиеся.** Намеренно не проголосовать одним игроком в дуэли с ненулевыми голосами — проверить, что его вес ушёл авторам пропорционально (а не пропал).
- [ ] **Дуэль без голосов.** Если реально воспроизводимо — дуэль, где никто не проголосовал: оба автора получают 0 за неё.

---

## Self-Review (выполнено автором плана)

- **Пункт 1** (reveal 5→6) → Task 1. Подтверждено: текущее значение `VOTING_REVEAL_SECONDS=5`, не 1.5.
- **Пункт 2** (видимость авторов/голосов после голоса) → уже реализовано в #41-45 (`filterVotesForViewer`, `authorRevealed`). Кода не требует — в плане раздел ручной проверки.
- **Пункт 3.1** (вес голоса 100/150/200/300 по раундам) → Task 2, `ROUND_VOTE_WEIGHTS` + `voteWeightForRound`. `roundIndex` 1-based, раундов 1..4 — массив покрывает, `voteWeightForRound` дополнительно клампит.
- **Пункт 3.2** (пропорциональное распределение очков воздержавшихся) → Task 2, `computeDuelPoints`. Пример пользователя (раунд 4, голоса 2:1, 1 воздержался → 200/100) проверен арифметически: `abstainPool = 1×300 = 300`, `leftAbstainShare = round(300×2/3) = 200`, `rightAbstainShare = 300−200 = 100`. ✓
- **Краевой случай 0 голосов** → `computeDuelPoints` ранний `return { left: 0, right: 0 }` при `votedCount === 0` — пул сгорает (решение пользователя).
- **Целочисленность:** `rightAbstainShare = abstainPool − leftAbstainShare` гарантирует, что весь пул распределён без потери остатка от округления.
- **Аналитика не сломана:** `trackBotDuelMetrics` и `recordRoundVotes` остаются на сырых счётчиках голосов.
- **Placeholder scan:** заглушек нет, весь код приведён целиком.
- **Type consistency:** `computeDuelPoints` возвращает `{ left, right }` — оба поля используются в `scoreCurrentDuel`. `duel` параметр — структурный тип `{ leftPlayerId, rightPlayerId }`, согласован с `canPlayerVote`/`hasAllVotes` в том же файле. `addScore` — новое имя, оба вызова в `scoreCurrentDuel`.
