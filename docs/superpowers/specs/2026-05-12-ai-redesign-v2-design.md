# План v2 — генерация шуток и начал, обучение, память

> Документ описывает целевую логику. Без кода и точных текстов промптов — это уровнем выше.

---

## Часть 1. Схемы данных

### 1.1 User Profile (новая сущность)

```
user {
  userId            UUID, primary key
  login             уникальный, для входа
  passwordHash      bcrypt

  realName          настоящее имя — используется в памяти и в текстах шуток. ОБЯЗАТЕЛЬНО
  displayName       игровой ник — отображается на фронте. ОБЯЗАТЕЛЬНО
  gender            male | female | non-binary | not-specified
  genderInferred    male | female — server fills if gender = not-specified, по эвристике на realName
  ageBand           under-20 | 20-25 | 25-30 | 30-35 | 35-plus | not-specified
  declaredBio       free text, до 300 символов

  createdAt
  lastSeenAt
}
```

Три имени принципиально разнесены: `login` — auth, `realName` — то что подставляется в шутки и хранится в памяти, `displayName` — то что видят другие игроки на фронте. `realName` и `displayName` могут совпадать, могут отличаться (выбор игрока).

Регистрация login + password обязательна — гостевого режима нет (см. Ч.2.1).

### 1.2 User Memory (новая сущность, 1:1 с user)

```
user_memory {
  userId                    FK на user

  confirmedFacts {
    themes: [               что подтверждено declaredBio + voting patterns
      { theme, confidence, mentions, source: "declared" | "derived" }
    ]
    voterPreferences {      что апвоутит как голосующий, диапазон [-1, 1]
      darkPreference          number in [-1, 1]
      callbackPreference      number in [-1, 1]
      absurdPreference        number in [-1, 1]
      ironyPreference         number in [-1, 1]
    }
    authorStyle {           как пишет сам
      avgPunchlineLength
      preferredStructures: [...]
    }
  }

  jokeTargets [             про что про него шутят (отдельно от facts!)
    { theme, frequency, lastSeenRound }
  ]

  portrait                  free-form 3-5 предложений, обновляется агентом

  lastUpdatedAt
  updatedAfterRoundsCount   счётчик для batching
}
```

Принципиально: `confirmedFacts` и `jokeTargets` разнесены. Никогда не объединять.
Сейчас в промптах используются только `confirmedFacts` + `portrait`. Остальное копится для будущих фич.

### 1.3 Prompt Starter — расширение существующей

Добавить поля:

- `userQuickFeedback` — `{ up: number, down: number, broken: number }` агрегаты-счётчики, без хранения userId
- `feedbackScore` — производное от feedback, например `(up - down) / max(1, up + down + broken)`, нормализованное к [-1, 1]
- `adminScore` — 1-5, null если не оценено
- `adminScoredBy`, `adminScoredAt`
- `adminComment` — короткий свободный текст от админа: в чём именно проблема / что сделать лучше. Подаётся ботам как контекст «вот так не надо и почему». `adminFlags` (enum) — отказались, текст информативнее.
- `derivedScore` — авто-расчёт по производным панчлайнам (avg rating всех шуток на этом opening'е)
- `usedAsExampleCount` — для anti-repetition
- `lastUsedAsExampleAt`

### 1.4 Joke Memory — расширение существующей

Добавить:

- `adminScore` 1-10, null если нет
- `adminScoredBy`, `adminScoredAt`
- `adminComment` — короткий текст (как и для opening'ов): почему хорошо / почему плохо. Подаётся ботам в few-shot как контекст
- `usedAsExampleCount`
- `lastUsedAsExampleAt`
- `authorUserId` — связь с user (для bot — null)
- `authorRealName` — snapshot имени на момент игры (на случай если user сменит realName потом)

Существующие `voteShare` и `ratingAverage` остаются, но переосмысливаются (см. Часть 9).

### 1.5 Миграция

Текущие `joke_memory` и `prompt_starters` коллекции **drop полностью** при деплое v2 — данных мало, сигнала меньше шума, mapping старых записей на новую схему (без `authorUserId`, без `adminComment`) не оправдан. Старт с чистой БД + 10 hardcoded bootstrap openings (см. 3.1).

### 1.6 Расширения GameRoom (in-memory)

В RAM-структуре `gameRoom` добавляются (никуда не персистится):

```
gameRoom {
  ...existing fields

  // Claude session IDs
  openingGeneratorSessionId  string | null
  memoryUpdaterSessionId     string | null
  bots: [{ ...existing, sessionId: string | null }]

  // Per-round quick feedback на opening
  // Set<userId> на opening — idempotency: один user может проголосовать один раз.
  // Само значение голоса в БД пишется только агрегатом ({up, down, broken}).
  feedbackVotedUserIds: Map<openingId, Set<userId>>
}
```

---

## Часть 2. Регистрация и идентификация

### 2.1 Экран входа

- Один экран с двумя табами: **login** / **register**
- Регистрация: `login` + `password` + `realName` + `displayName`. `gender`, `ageBand`, `declaredBio` — **полностью опциональны**, никаких рекомендаций. Bio сложно писать кратко и непредвзято, не заставляем
- После успешной регистрации/логина: создаётся (или загружается) `user` + `user_memory`, выдаётся JWT
- **Гостевой режим убран.** Без аккаунта в комнату не попасть

### 2.2 Auth — JWT с long-lived session

- Long-lived JWT (TTL ~30 дней), хранится в `localStorage`
- На каждом HTTP-запросе — `Authorization: Bearer <token>`
- Socket.IO: токен передаётся в `auth` payload при handshake; сервер валидирует в connection middleware и достаёт `userId` из claims
- При просроченном/невалидном токене — клиент чистит `localStorage`, редирект на login
- Refresh-token в MVP не делаем, long-lived JWT достаточно
- Logout — кнопка чистит токен и редирект на login (нужна, но один экран, не сложно)

### 2.3 Поток после логина

1. Клиент получает `{ token, profile }`, сохраняет в `localStorage`
2. Главный экран: **создать комнату** / **войти по коду**
3. Внутри комнаты ник = `displayName` (не редактируется в комнате — меняется только через профиль)
4. Идентификация всегда по `userId`. В БД и в текстах AI-промптов идёт `realName`. На фронте — `displayName`
5. `lastSeenAt` обновляется при каждом socket connect

---

## Часть 3. Flow генерации опенингов

### 3.1 Cold start (первая игра компании)

1. Запросить у каждого игрока `declaredBio` (если ещё нет)
2. На случай недоступности Claude — **10 hand-picked bootstrap openings** в коде (не БД)
3. Иначе — сразу к 3.2

### 3.2 Steady state — одна opening-generator сессия на всю игру

**Раунд 1, первый вызов:**

- `claude -p "..." --output-format json`, без `--resume`. Из ответа достаём `sessionId`, сохраняем в `gameRoom.openingGeneratorSessionId`
- **System prompt:** opening generator + competitive framing (3.4). Без явного darkness — тон задаётся через состав примеров
- **User prompt:**
  - Профили всех игроков: `realName`, `displayName`, `gender`, `declaredBio`, `confirmedFacts.themes`
  - `goldenExamples` — top-N positive по ранжированию из 3.3
  - `negativeExamples` — 1-2 явных провала (`adminScore < 3`) + 1 середняк (`adminScore` 4-5). У каждого подаём opening + `adminComment` если есть
  - Запрос: «сгенери `needed * 3` кандидатов»

**Раунд 2+, resume:**

- `claude --resume <sessionId>`
- Профили и static few-shot **не повторяем** (в контексте сессии)
- Подаём **результаты прошлого раунда**:
  - Для каждого выданного opening — топовые панчлайны (по rating) что игроки на него написали
  - `userQuickFeedback` агрегат на opening (👍/👎/🤢 счётчики)
- Список `excludedOpenings` — всё что уже использовано в этой игре
- Опционально — новые/обновлённые golden examples если что-то добавилось
- Запрос: «сгенери `needed * 3` новых кандидатов, не повторяй excluded, учитывай что зашло/не зашло»

**Stage 2 judge — НЕ делаем сейчас.** Внутренний выбор модели + post-filter ниже достаточны. Если качество просядет — добавим отдельную judge-сессию (см. Часть 11).

**Post-filter (без Claude-вызова):**

- Из выданных `needed * 3` выбираем `needed` через MMR + штраф за `usedAsExampleCount` (см. Часть 9)
- Проверка semantic similarity со **всей историей** `prompt_starter` (BGE-M3, threshold ~0.85). Слишком похожие — отбрасываем. Если осталось меньше `needed` — просим в той же сессии добить

### 3.3 Ранжирование golden openings для few-shot

Используется общая формула `useScore` из Часть 9 (`primary_quality × 0.7 + competitive_signal × 0.2 + diversity_bonus × 0.1 × repetition_penalty`), с поправкой на openings:

- Для opening: `primary_quality = coalesce(adminScore/5, derivedScore_normalized)` (admin score шкала 1-5, см. Ч.1.3)
- `derivedScore` = средний rating всех панчлайнов на этом opening'е, нормализованный к 0-1
- `competitive_signal` для opening получает вклад от `feedbackScore` (`up - down`)
- `freshness` убран (см. Ч.9)

### 3.4 Что добавляется в system prompt opening-генератора

Competitive framing:
> Эти opening'и — основа дуэли. Хороший opening — тот, на который игрок захочет потратить креатив, а не отстреляется банальностью. Скучный setup = скучная дуэль. Цель: вызвать у игрока «о, это можно крутить» немедленно.

(Точный текст пишется в локальной сессии.)

---

## Часть 4. Flow генерации панчлайнов

### 4.0 Сессия Claude — одна на бота на всю игру (КЛЮЧЕВОЕ)

Каждый бот в комнате стартует **одну Claude CLI сессию на всю игру** (`claude --resume <sessionId>`). Все раунды этого бота идут в одной сессии — модель накапливает контекст игроков, видит результаты прошлых раундов, развивает «понимание стола».

**Flow:**

1. **Раунд 1, первый вызов:**
   - `claude -p "..."` с `--output-format json` (или `stream-json`), без `--resume`
   - System prompt: bot mandate + personality
   - User prompt: имена + профили всех игроков (real names, gender, bios, confirmedFacts, portrait), positive/negative few-shot примеры, текущий opening
   - Сохраняем `sessionId` из JSON-ответа в `gameRoom.bots[i].sessionId`

2. **Раунд 1, все следующие openings:** `--resume <sessionId>`, в user-prompt только новый opening + (опционально) дополнительные few-shot если нужны

3. **Между раундами:** в той же сессии посылаем **статистику прошлого раунда** — список всех шуток (opening + punchline + автор), результаты дуэлей (voteShare), рейтинги. Бот сам видит свои шутки и оценки (он в той же сессии, помнит что писал). Пояснение в промпте: «вот статистика прошлого раунда — шутки, дуэли, оценки»

4. **Раунд 2+:** профили игроков **не повторяем** (уже в контексте), few-shot — только новые/обновлённые, статистика прошлого раунда — да

**Lifecycle:**
- Сессия бота живёт ровно от старта до конца игры. Конец игры → сессии удаляются
- В следующей игре те же игроки — новые сессии, но контекст придёт через `user_memory` (агент-обновлятор уже отработал)
- При рестарте сервера посреди игры — game state в RAM теряется → игра умерла независимо от состояния Claude-сессий. Persistent volume для `~/.claude/projects/` не нужен

### 4.1 Контекст бота — personality

Каждый бот в комнате получает **personality preset** случайно из пула пресетов (характеры подбираем позже, циник/absurd — лишь illustrative примеры). Стили (`sarcastic | dark | absurd`) рандомом — удалены. Если бот в комнате один — preset всё равно рандомится из пула.

### 4.2 Memory retrieval — что подаётся как few-shot

Алгоритм:

1. Embed текущий opening через BGE-M3
2. **Pre-filter** в Mongo на raw полях (cheap, без Bayesian):
   - Положительные: `(adminScore >= 7) OR (ratingAverage >= 7 AND ratingCount >= 2)`
   - Отрицательные (отдельный запрос): `(adminScore <= 3) OR (ratingAverage <= 4 AND ratingCount >= 2)`
   - Это intentional — pre-filter дёшево отрубает мусор, финальный rank считается на Bayesian (см. Часть 9)
3. На полученных кандидатах считать cosine similarity к текущему opening'у + финальный `useScore` (Ч.9)
4. **MMR-выборка:**
   - Из положительных — 5-6 примеров, MMR с λ≈0.5. `adminComment` НЕ подаётся в positive few-shot (хорошее объясняет себя)
   - Из отрицательных — 2-3 примера, MMR. `adminComment` подаётся обязательно если есть (контекст «почему плохо»)
5. **Penalty за переиспользование:** при ранжировании multiply на `1 / (1 + log(1 + usedAsExampleCount))`. Инкремент counter — **только после успешной генерации** (не сразу при retrieval).
6. **Лимит 600 убираем**, пул — все записи. Pre-filter держит запрос быстрым.

### 4.3 Single-call generation (поверх сессии)

**Один Claude-вызов на opening** в той же сессии бота — возвращает **один** punchline. Без Stage 2 judge'а: бот сам выбирает что выдать, а персональность из своего system prompt задаёт характер. Меньше latency, меньше cost, меньше точек отказа.

**Failure handling:** один retry внутри runner'а. Если опять упало — `[бот молчит]` маркер (Ч.4.5).

**Judge для punchline'ов — отложен** (см. Часть 11). Если на playtest'ах одна шутка от бота окажется недостаточно хорошей — добавим Stage 2 как отдельный judge-агент.

В few-shot примерах (positive и negative) — если у записи есть `adminComment`, он подаётся вместе с примером в формате:
```
"opening" → "punchline" [score: X] [admin: коммент]
```
Это даёт боту контекст не только «вот хорошо/плохо», но и **почему**.

### 4.4 System prompt бота — обязательно добавить mandate на победу:

> Это игра на голоса. Твой панчлайн соревнуется с панчлайном другого игрока на тот же setup. Аудитория голосует — твоя задача собрать БОЛЬШЕ голосов. Безопасная шутка = проигрыш. Если выбираешь между «вежливо смешно» и «наглый, рисковый» — выбирай второе. Компания старых друзей, всё дозволено, ничего святого. Не извиняйся, не предупреждай, не модерируй сам себя. Цель — реакция, а не одобрение.

(Точный текст — в локальной сессии. Суть зафиксирована.)

### 4.5 Что удаляем из текущего флоу

- `darknessLevel` — из всех типов, промптов, генерации
- `styleTag` (sarcastic/dark/absurd random) — целиком
- `FALLBACK_PUNCHLINES` — **убираем полностью**. При провале бота (Claude не ответил после retry) — в дуэли отображается маркер `«[бот молчит]»`, дуэль идёт, human-противник выигрывает дуэль автоматом. В `joke_memory` ничего не пишется.

---

## Часть 5. Память — обновление

### 5.1 Когда

После rating phase раунда, async в фоне (пока scoreboard и переход в следующий раунд). НЕ блокирует UX.

### 5.2 Memory updater — одна сессия на всю игру на всех игроков

**Одна** Claude-сессия на комнату (`claude --resume <id>`), живёт с начала до конца игры. Знает контекст всех игроков и накопительно работает с их памятью. Параллельные вызовы per-user не нужны — всё в одной сессии последовательно. Concurrency limit поэтому не требуется.

**Раунд 1, первый вызов (после rating phase):**

- System prompt: задача updater'а + guard rails от галлюцинаций (см. 5.4)
- User prompt: профили всех игроков (`realName`, `gender` или `genderInferred`, `ageBand`, `declaredBio`) + их текущие `user_memory` (portrait, confirmedFacts) + полная статистика раунда (шутки, дуэли, рейтинги, голоса по дуэлям). `jokeTargets` не подаётся и не обновляется (Ч.5.3)
- Возвращает structured JSON (`jokeTargetsDelta` отсутствует — Ч.5.3):
```
{
  updates: {
    <userId>: {
      confirmedFactsDelta,
      voterPreferencesDelta,
      authorStyleDelta,
      newPortrait        // полный текст, перезапись
    }
  }
}
```
- Сохраняем `sessionId` в `gameRoom.memoryUpdaterSessionId`

**Раунд 2+, resume:**

- Профили и `user_memory` **НЕ повторяем** (уже в контексте сессии)
- Подаём только статистику нового раунда
- Возвращает дельты для тех users, у кого что-то новое

**Сервер:**

- Получает JSON, валидирует Zod-схемой, мерджит в `user_memory` каждого user
- Инкрементит `updatedAfterRoundsCount` затронутых users
- При невалидном JSON — пропускаем апдейт, логируем, идём дальше (не блокируем UX)

**Lifecycle:** сессия живёт ровно игру. После окончания — закрывается. Следующая игра — новая сессия (контекст придёт через свежее `user_memory`).

### 5.3 jokeTargets — НЕ обновляем в MVP

`jokeTargets` (про что про игрока шутят) — **не обновляем агентом в MVP**. Поле в схеме оставляем (Ч.1.2), но в JSON-ответе memory updater'а его быть не должно. Включим когда понадобится для callback-фичи. Экономия токенов + снижение риска галлюцинаций.

### 5.4 Дедуп при сохранении в joke_memory

При записи новой шутки в `joke_memory`: считаем BGE-M3 embedding пары `(prompt, punchline)`, ищем similar записи с cosine ≥ 0.9. Если такая есть — **новую запись не создаём, а мерджим счётчики в существующую**: `votesFor += newVotesFor`, `votesAgainst += newVotesAgainst`, добавляем новый rating в `ratingSum`/`ratingCount`. Это сохраняет сигнал того, что та же шутка зашла ещё раз, без раздувания pool. Аналогично можно делать для `prompt_starter`, но там частота повторов ниже — пока без обязательства.

### 5.5 Защита от галлюцинаций

System prompt агента (суть):
> Обновляй только то что явно подтверждено в данных. Не предполагай характер по одной шутке. Confidence растёт медленно — тема становится stable после 3+ упоминаний. Не записывай содержание шуток как факты.

### 5.6 Использование памяти на текущем этапе

| Поле | Используется сейчас | На будущее |
|---|---|---|
| `confirmedFacts.themes` | да, в opening generator + bot punchline | — |
| `gender` / `genderInferred` | да, в bot punchline (грамматика) | — |
| `declaredBio` | да, во всех AI-промптах | — |
| `voterPreferences` | нет | audience-aware промпты |
| `authorStyle` | нет | matchmaking bot ↔ human |
| `jokeTargets` | **не обновляем**, не используем | callback-фича |
| `portrait` | да, в opening generator + bot punchline как мягкий контекст | — |

---

## Часть 6. In-game UI изменения

### 6.1 Writing phase — quick feedback на opening

- Рядом с каждым из 2 опенингов игрока (снизу/сбоку) — 3 кнопки: 👍 / 👎 / 🤢
- **1 голос на user на opening**. Кнопки взаимоисключающие — выбор последней снимает предыдущую
- Optional, не блокирует ввод панчлайна. Можно вообще не выбирать
- Состояние хранится **локально** на клиенте до конца writing phase. Юзер может менять выбор сколько угодно раз
- При **переходе из writing в следующую фазу** — клиент шлёт финальное состояние feedback вместе с панчлайнами одним submit'ом
- Сервер валидирует: 1 user × 1 opening = 1 запись feedback. В `gameRoom` (RAM) держит `Set<userId>` per-opening на текущий раунд для idempotency
- После окончания writing phase — кнопки disabled, **переголосование в следующих фазах запрещено**
- Агрегаты на стороне БД (`userQuickFeedback.{up, down, broken}` + `feedbackScore`) обновляются батчем после фазы

### 6.2 Rating phase

Без изменений — уже работает 1-10 на шутки.

### 6.3 Scoreboard

Без изменений в MVP. (Можно потом добавить inline rating опенингов для энтузиастов.)

### 6.4 Регистрация / профиль

- Экран входа: login / register (guest убран)
- **Страница профиля** доступна с главного экрана (кнопка/иконка):
  - Редактирование: `realName`, `displayName`, `gender`, `ageBand`, `declaredBio`
  - `realName` и `displayName` обязательны; остальное опционально, без давления (см. 2.1)
  - Read-only блок: `portrait` (что про тебя написал агент), `confirmedFacts` (для curiosity). Можно скрыть под раскладушкой
- Логин/пароль не меняем в MVP

---

## Часть 7. Admin UI — ОТЛОЖЕНО (post-MVP)

Целиком отложено на потом. Поля `adminScore`, `adminComment`, `adminScoredBy`, `adminScoredAt` пишутся в БД с v2, но проставляются временно вручную через mongosh — для playtests этого хватит. UI можно собрать позже когда накопится разметочный объём и появится время.

Bootstrap openings — в коде (10 hand-picked), не в БД, редактирования через UI не нужно.

---

## Часть 8. Что удаляется из текущего кода

1. `darknessLevel` параметр везде (типы, промпты, генерация)
2. `styleTag` (sarcastic / dark / absurd) random выбор — целиком
3. 48 seed prompts из БД — заменяем на 10 hardcoded bootstrap в коде
4. Лимит 600 в `JokeMemoryService.RECENT_POOL_SIZE` — всё извлекаем pre-filter'ом
5. `FALLBACK_PUNCHLINES` — удалить полностью (см. 4.5)
6. Старый `qualityScore` (60/40) — переделать (см. Часть 9)
7. **Auth: текущая схема `clientToken` (UUID в localStorage) + nickname** — заменяется на JWT-based auth. Глобальный refactor: auth middleware на HTTP + Socket.IO handshake, замена всех `playerId` (in-memory) на `userId` (из JWT claims), removal nickname-from-input flow на displayName-from-profile.

---

## Часть 9. Скоринг для retrieval

```
useScore =
    primary_quality        × 0.7
  + competitive_signal     × 0.2
  + diversity_bonus        × 0.1
  × repetition_penalty
```

Где:

- `primary_quality` = `coalesce(adminScore/10, bayesian_user_rating)`.
  Bayesian: `(ratingSum + prior_mean * prior_weight) / (ratingCount + prior_weight)`, `prior_mean=5.5`, `prior_weight=3`.
- `competitive_signal` = Wilson lower bound 95% от `(votesFor, votesAgainst)` — используется ТОЛЬКО когда `ratingCount < 3`. Когда ratings есть — игнорируется (rating даёт более качественный сигнал).
- `diversity_bonus` — считается в MMR, не на записи
- `repetition_penalty` = `1 / (1 + log(1 + usedAsExampleCount))`, multiplier на финальную сумму
- **Freshness убран** — репутация шутки не должна гаснуть от давности. Анти-репитишен ловится через `usedAsExampleCount`

Применяется и для positive, и для negative pool (negative = инверсия `primary_quality`).

Вес ботовских и людских шуток в памяти **идентичный** — источник не важен, важен сигнал качества (rating + admin).

---

## Часть 10. Промпты — что добавить (тексты пишутся в локальной сессии)

1. **Bot system prompt** — competitive mandate (см. 4.4)
2. **Bot 1 / Bot 2 personality differences** — короткая разница в характере
3. **Opening generator system prompt** — competitive framing (см. 3.4)
4. **Judge system prompts** (2 шт — для openings и punchlines) — критерии оценки
5. **Memory updater system prompt** — guard rails от галлюцинаций (см. 5.3)

---

## Часть 11. Отложенные решения / known limitations

1. **Vector storage:** остаёмся на Mongo с linear scan + pre-filter. Миграция на pgvector / Qdrant — когда упрёмся в latency (ориентировочно 30k+ шуток без vector index).
2. **`voterPreferences`, `authorStyle`, `jokeTargets`** — собираются с первого раунда, используются позже
3. **Bot personality** — детальные тексты пишем после первой игры с базовыми промптами
4. **Style tags** — удалены, но если окажется нужен явный регистр — добавим auto-detected per-opening tag
5. **Audience-aware generation** — отложено, требует накопленный `voterPreferences`
6. **Per-player targeted opening generation** — отложено, требует накопленный `confirmedFacts`
7. **Opening judge как Stage 2** — отложено. Если внутренний выбор opening-generator модели + post-filter дают плохие openings (повторяемость / банальность / слабые pivot'ы) — добавляем отдельную judge-сессию на комнату с критериями: vivid scene, открытый pivot, 5+ возможных панчлайнов, оригинальность, персонализация. Триггер для добавления — субъективное «плохо» на playtests или метрика по `userQuickFeedback.down / up`
8. **Punchline judge как Stage 2** — отложено. Сейчас бот делает один вызов = один punchline (Ч.4.3). Если одна шутка окажется слабой на playtest'ах — добавим judge-агента, который перед выдачей просит бота сгенерить 2 кандидата (через `--fork-session` чтобы избежать race на session.jsonl) и выбирает лучший. Триггер — низкий voteShare ботов на playtest'ах

---

## Часть 12. Lifecycle и edge cases

### 12.1 Prewarm Claude-сессий

Создание Claude-сессии — это вызов `claude -p "<system+initial user prompt>"`, который занимает несколько секунд (загрузка system prompt + initial context + первый ответ). Если делать lazy (при первом нужном panel'е), игрок ждёт лишние секунды на первый ход.

**Prewarm:** на этапе `startGame` (между нажатием «Начать игру» и стартом 1-го раунда) параллельно создаём все нужные сессии (`openingGeneratorSessionId`, `bot[i].sessionId`, `memoryUpdaterSessionId`). К моменту когда раунд начнётся — все сессии готовы, последующие `--resume` дёшевы.

Текущий паттерн `prefetchOpeningsPromise` уже делает это для openings — расширим на остальные сессии.

### 12.2 Auto-submit пустых на истечение таймера

Если игрок не успел написать панчлайны / выставить feedback до истечения writing-фазы — клиент автоматически шлёт submit с тем что есть (включая пустые строки). Пустая шутка пустая — это ошибка игрока, дуэли по ней проигрываются автоматом. На стороне сервера дополнительный auto-submit таймер (на случай если клиент отвалился) — присылает за молчащего пустоту.

### 12.3 Disconnect посреди игры

- **Reconnect:** match по `userId`. `displayName` показывается тот, что был на момент входа в комнату (snapshot, не из live-профиля)
- **Если ливнули все игроки кроме хоста / хост покинул и комната без активных human-игроков:** комната завершается, **memory updater запускается финально** на собранных раундах, потом закрывается
- **Sessions cleanup:** на `endGame` (нормальный финал или forced) — удалить session-файлы из `~/.claude/projects/` для всех sessionId'ов комнаты + закрыть RAM-state

## Часть 13. Архитектура Claude-агентов (Strategy + Composition)

### 13.1 Базовая абстракция

Все Claude-сессии (opening generator, боты, memory updater и любые будущие роли — например punchline/opening judge когда понадобятся) проходят через **один runner** `ClaudeAgentRunner`. Он управляет lifecycle (`start` / `continue` / `end`), parsing (`text` / `json` с Zod), retry policy, логированием latency/tokens — то есть всё, что общее для всех ролей.

```ts
@Injectable()
export class ClaudeAgentRunner {
  start<T>(config: AgentConfig<T>, initialUserPrompt: string): Promise<AgentSession<T>>
  continue<T>(session: AgentSession<T>, userPrompt: string): Promise<AgentResponse<T>>
  end(session: AgentSession<unknown>): Promise<void>
}

export type AgentConfig<T = unknown> = {
  readonly name: string
  readonly systemPrompt: string
  readonly outputFormat: 'text' | 'json'
  readonly schema?: z.ZodType<T>
  readonly retries: number
  readonly timeoutMs: number
}

export type AgentSession<T> = {
  readonly id: string         // Claude session ID
  readonly config: AgentConfig<T>
  readonly createdAt: Date
}

export type AgentResponse<T> = {
  readonly raw: string
  readonly parsed?: T
  readonly latencyMs: number
}
```

### 13.2 Domain-сервисы поверх runner

Каждая роль = отдельный сервис, держит ссылку на runner и domain-specific методы:

```ts
@Injectable() class OpeningGeneratorAgentService {
  startForRoom(room) → AgentSession
  generateForRound(session, roundData) → readonly string[]
}

@Injectable() class BotAgentService {
  startForBot(room, botId, personality) → AgentSession
  generatePunchline(session, opening, fewShot) → string
}

@Injectable() class JudgeAgentService {
  startForRoom(room) → AgentSession
  pickWinner(session, opening, candidates) → string
}

@Injectable() class MemoryUpdaterAgentService {
  startForRoom(room) → AgentSession
  updateAfterRound(session, roundData) → MemoryDeltas
}
```

System prompts и prompt-templates живут в отдельной папке `agents/configs/` — декларативно, рядом друг с другом, удобно читать и итерировать.

### 13.3 Реестр на комнату

Все активные сессии комнаты держим в одной структуре в `gameRoom`:

```ts
type RoomAgents = {
  openingGenerator: AgentSession | null
  memoryUpdater: AgentSession | null
  bots: Map<string, AgentSession>      // botId → session
}
```

На `endGame` (нормальный или forced) — `for-each session: runner.end(session)`. Один централизованный cleanup, который чистит и RAM-state, и session-файлы из `~/.claude/projects/`.

### 13.4 Расширяемость

**Добавить 3-го бота / любую новую роль:**
1. Добавить `AgentConfig` в `agents/configs/` (system prompt + schema + retries)
2. Если роль одиночная (judge-like) — добавить поле в `RoomAgents` или просто инстанцировать в нужный момент
3. Если есть domain-логика (как у бота) — отдельный `Injectable` service с методами `start*` / `do*`

Никакого дублирования инфраструктуры Claude CLI. Тесты domain-сервисов — через mock `ClaudeAgentRunner`.

### 13.5 Что это даёт по сравнению с альтернативами

- **vs inheritance (`abstract class ClaudeAgent`):** не смешиваем domain-логику с инфрой Claude, нет глубоких иерархий
- **vs pure functions:** NestJS-friendly DI, легко мокать в тестах
- **vs «по месту» в game.service:** game.service остаётся тонким — он оркестрирует agents, а не управляет Claude CLI

## Резюме принципов

- **Цель бота — побеждать в голосовании.** Это явно в промпте.
- **Сигнал качества — rating (1-10), не vote share в дуэли.** Дуэль шумная при малых выборках.
- **Контраст важнее повторения.** Negative few-shot обязателен.
- **Diversity > top-N.** MMR при выборе примеров.
- **Память разделена на confirmed / joke-targets.** Не смешивать.
- **Меньше параметров — меньше шума.** Darkness и style random удалены.
- **Личность бота через personality prompt, не random.** 2 бота — 2 голоса.
