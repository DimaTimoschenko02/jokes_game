# Group Memory — память компании

> Документ описывает целевую логику подпроекта D (общая память компании).
> Уровень: дизайн. Без кода и точных текстов промптов.

---

## 1. Цель и контекст

PunchMe играет одна постоянная компания друзей. Сейчас `user_memory`
накапливается, но **не используется** генераторами (`buildOpeningPlayerProfiles`
/ `buildBotPlayerProfiles` передают только id/name/gender/bio — portrait и themes
не доходят до LLM). Подпроект C (портрет юзера) отложен.

Группа решила, что **общий контекст компании важнее**, чем индивидуальный, и
дешевле в реализации: один пул фактов про всю компанию вместо N портретов.
Group memory — это «что эта компания любит, какие у них клички, инсайды, триггеры,
запретные темы, какие setup'ы у них залетают». Этот блок кормит **и генератор
начал, и генератор панчлайнов ботов**, чтобы шутки были «свои».

Тестовые аккаунты (которые Dima создал для отладки) в память не попадают.

---

## 2. Схема данных

### 2.1 `group_memory` — новая таблица, один глобальный ряд

```
group_memory {
  id                     text PK, всегда 'global' (single-row pattern)

  themes                 jsonb [{ theme, score, mentions, examples[] }]
                         темы, на которые компания заходит / реагирует
  inJokes                jsonb [{ phrase, kind, mentions }]
                         клички, мемы, инсайды компании. kind: nickname | meme | callback
  triggers               jsonb [{ trigger, score, examples[] }]
                         что у компании вызывает смех (приёмы/образы, не темы)
  avoidedThemes          jsonb [{ theme, reason }]
                         что не заходит / отторгает — negative-сигнал
  setupPatterns          jsonb [{ pattern, score }]
                         типы setup'ов начал, которые у компании залетают

  summaryText            text, nullable
                         свободное саммари 4-8 предложений — то, что не лезет в поля.
                         Регенерируется лениво (см. 4.4)

  gamesProcessed         integer, default 0     — счётчик зачтённых игр
  summaryRefreshedAtGame integer, default 0     — на какой игре последний раз делали summary
  memoryEnabled          boolean, default true  — киллсвитч (см. 5)

  updatedAt              timestamptz
}
```

Single-row pattern: таблица всегда содержит ровно один ряд `id = 'global'`,
засевается миграцией. Все операции — над этим рядом.

Почему отдельная таблица, а не key-value: поля типизированы, есть `updatedAt`,
админка читает/пишет напрямую, расширять схему просто.

### 2.2 `users.test_account` — новое поле

```
users.test_account  boolean NOT NULL DEFAULT false
```

Помечает аккаунты, созданные для отладки. Игра с участием хотя бы одного
test-аккаунта **не зачитывается** в group memory (см. 4.5). Проставляется
**разово вручную SQL** после миграции — UI для пометки не делаем.

### 2.3 Миграция `0007`

Одна миграция Drizzle (`npm run db:generate`):

1. `ALTER TABLE users ADD COLUMN test_account boolean NOT NULL DEFAULT false`
2. `CREATE TABLE group_memory (...)` со всеми полями из 2.1
3. `INSERT INTO group_memory (id) VALUES ('global')` — засев пустого ряда
   (массивы `[]`, `summaryText` NULL, счётчики 0, `memoryEnabled` true)

Применяется автоматически на старте API.

---

## 3. Чтение: как group memory попадает в промпты

### 3.1 Рендер блока

Из ряда `group_memory` собирается текстовый блок «Контекст компании»:

- `themes` — top-K по `score` (≈8)
- `inJokes` — top-K по `mentions` (≈10)
- `triggers` — top-K по `score` (≈6)
- `avoidedThemes` — все (их мало, и это важный negative-сигнал)
- `setupPatterns` — top-K по `score` (≈5)
- `summaryText` — целиком, если есть

Top-K — чтобы не раздувать промпт и не тащить шум из хвоста распределения.

### 3.2 Кто получает блок

Блок передаётся **обоим** генераторам, при старте их сессий:

- **`opening-generator`** (`startForRoom` / `buildStartPrompt`) — чтобы начала
  цеплялись за контекст компании.
- **`bot-agent`** (`startForBot` / `buildInitialPrompt`) — чтобы боты писали
  панчлайны «в духе компании». По словам Dima — **здесь приоритет важнее**,
  чем у генератора начал.

Блок — это новое опциональное поле во входных типах обоих агентов
(`StartOpeningGeneratorInput`, параметр `startForBot`). `game.service`
читает group memory один раз на старте игры и прокидывает в оба.

### 3.3 Пустая память

Пока `group_memory` пустой (старт проекта, первые игры) — блок не рендерится
вообще. Накопится за 3-4 живых игры. Backfill из уже накопленных шуток в
`joke_memory` **не делаем** — дорого (LLM-прогон всей истории), а пользы на
старте мало. При желании — отдельная задача позже.

---

## 4. Запись: extended memory-updater

### 4.1 Подход — дельты (Approach A)

LLM возвращает **дельты**, backend мерджит детерминированно. Не «LLM
переписывает весь объект» — так у нас уже работает `user_memory` (см.
`UserMemoryService.applyUpdates`), счётчики и клампы под контролем кода, а не
модели.

### 4.2 Один агент, смешанный — extended memory-updater

Отдельный агент `group-memory-updater` **не заводим**. Расширяем существующий
`memory-updater`:

- Per-round вызовы (`startAfterRoundOne` / `updateAfterRound`) — без изменений,
  возвращают `updates` (user memory). Сессия живёт всю игру и видит все раунды.
- **Finalize-вызов** — новый. После завершения игры (`advanceRound`, ветка
  `phase = 'finished'`) делаем ещё один `continue` на той же сессии: «игра
  закончилась, на основе ВСЕХ раундов верни `groupMemoryDelta`». Сессия уже
  содержит все шутки/дуэли/голоса игры — отдельно их передавать не нужно, но в
  промпт finalize кладётся **текущий снимок** `group_memory` (чтобы модель не
  дублировала уже существующие темы).

Схема выхода агента расширяется до `{ updates?, groupMemoryDelta? }`. Per-round
ответы содержат только `updates`, finalize — только `groupMemoryDelta`.

### 4.3 Форма `groupMemoryDelta`

```
groupMemoryDelta {
  themesDelta?        [{ theme, scoreDelta?, mentionsDelta?, newExamples?[] }]
  inJokesDelta?       [{ phrase, kind?, mentionsDelta? }]
  triggersDelta?      [{ trigger, scoreDelta?, newExamples?[] }]
  avoidedThemesDelta? [{ theme, reason }]
  setupPatternsDelta? [{ pattern, scoreDelta? }]
  newSummaryText?     string   — только когда backend запросил регенерацию
}
```

Merge на backend (по аналогии с `mergeThemes`):
- по ключу (`theme`/`phrase`/`trigger`/`pattern`, lowercase) — если есть, двигаем
  `score`/`mentions` дельтой с клампом; если нет и есть осмысленные поля — добавляем
- `examples` — добавляем `newExamples`, держим хвост ограниченным (напр. 5 на запись)
- `score` клампится в `[0, 1]`, `mentions` — `>= 0`
- сортировка по `score` (или `mentions`)

### 4.4 Частота: структура — каждую игру, summary — раз в 3 игры

- Структурные поля (`themes`, `inJokes`, …) обновляются **каждую зачтённую игру**.
- `summaryText` регенерируется **лениво, раз в 3 игры**. Перед finalize-вызовом
  backend проверяет: `gamesProcessed + 1 - summaryRefreshedAtGame >= 3` →
  если да, в finalize-промпт добавляется требование вернуть `newSummaryText`.
- После применения дельт: `gamesProcessed++`; если summary пришёл —
  `summaryRefreshedAtGame = gamesProcessed`.

Первое summary — после 3-й зачтённой игры.

### 4.5 Когда finalize НЕ вызывается

Игра **не зачитывается** в group memory, если:
- `room.collectData = false` (test-комната), **или**
- среди игроков есть хотя бы один с `test_account = true`.

Helper `countsForGroupMemory(room)`. Флаг `test_account` подгружается при
join'е игрока (из `users`) и носится на `GamePlayer` как `isTestAccount`
(сейчас комната и так грузит gender/bio/realName).

Per-round user-memory updater при этом работает как раньше — `test_account`
влияет **только** на group memory finalize. (Чистка user-memory для
test-аккаунтов — вне scope D, это территория C.)

### 4.6 Конкурентность

`group_memory` — один ряд. Если две игры финишируют одновременно → две
read-modify-write операции. Finalize-merge оборачивается в транзакцию с
`SELECT ... FOR UPDATE` на ряде `'global'`. Для масштаба «друзья играют»
достаточно с запасом.

### 4.7 Деградация

- **Игра отменена** (host вышел до финала — фикс host-exit cancel): `phase`
  не достигает `'finished'`, finalize **не вызывается**. Неполная игра не пишет
  в долговременную память.
- **Finalize упал** (schema fail / timeout / Claude error): `group_memory` не
  обновляется в этой игре, логируем warn, игра уже закончена — игрокам не
  мешает. Следующая игра попробует снова. Не блокирует.
- **Сессия memory-updater не поднялась** (все per-round старты упали):
  finalize пропускаем, log warn.

Finalize-вызов делается **до** `cleanupSessions` (которая завершает сессию).

---

## 5. Киллсвитч `memoryEnabled`

Админ может выключить использование памяти тоглом. `memoryEnabled = false`:
- блок «Контекст компании» **не рендерится** и не уходит в промпты;
- накопление в БД **продолжается** (finalize пишет дельты как обычно).

Смысл: если что-то пойдёт не так с качеством — Dima выключает использование
между играми, не теряя накопленные данные. Память применяется между играми
(в 1-м раунде новой игры блок уже передан на старте сессий генераторов).

---

## 6. Админка

- `GET /api/admin/group-memory` — просмотр текущего ряда `group_memory`.
- `PATCH /api/admin/group-memory` — тогл `memoryEnabled`.
- Новая секция в `AdminView` (web): показывает поля памяти + тогл.

Защищено существующим `AdminGuard`.

---

## 7. Что вне scope D

- C — индивидуальный портрет юзера (отдельный подпроект, после D).
- Backfill group memory из истории `joke_memory`.
- Авто-пометка `test_account` через UI.
- Feedback-loop для bot style (остаётся в Known Limitations).

---

## 8. Сводка решений

| Решение | Выбор |
|---|---|
| Структура памяти | один глобальный ряд `group_memory` |
| Миграция | одна, `0007` (test_account + group_memory + засев) |
| Механика апдейта | дельты, детерминированный merge на backend |
| Агент | extended `memory-updater` (не отдельный), finalize-вызов |
| Частота: структура | каждая зачтённая игра |
| Частота: summary | лениво, раз в 3 игры |
| Потребители | `opening-generator` + `bot-agent` (приоритет — бот) |
| Киллсвитч | `memoryEnabled`, накопление продолжается |
| Исключение тест-игр | `collectData=false` или есть `test_account` игрок |
| Пометка `test_account` | разово вручную SQL |
| Concurrency | транзакция + `SELECT FOR UPDATE` |
