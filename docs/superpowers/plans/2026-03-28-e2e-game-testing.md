# E2E Game Testing Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Протестировать полный user flow игры с 2 human-игроками и 2 ботами через все 3 раунда, проверив качество AI-ответов, корректность промптов из БД и отсутствие фолбеков.

**Architecture:** Node.js E2E-скрипт подключается двумя Socket.IO клиентами к работающему серверу, имитируя двух живых игроков. Боты управляются сервером. Скрипт проходит все фазы (lobby → writing → voting → rating → scoreboard) × 3 раунда, логируя всё. После — проверка MongoDB на корректность сохранённых completions.

**Tech Stack:** Node.js, socket.io-client, MongoDB driver (для прямых проверок БД)

---

## Фаза 1: Подготовка инфраструктуры

### Task 1: Добавить диагностические логи в AI-сервис

**Зачем:** Нужно видеть в логах полный промпт, отправленный модели, и полный ответ — чтобы понять, переписывает ли бот начало шутки.

**Files:**
- Modify: `api/src/modules/ai/ai.service.ts:68-92` (generateBotAnswer)
- Modify: `api/src/modules/ai/ai.service.ts:149-206` (executeChatRequest)

- [ ] **Step 1: Добавить лог полного user-промпта и полного ответа модели**

В `generateBotAnswer` (строка ~69) — логировать полный input и полный raw output ПЕРЕД нормализацией:

```typescript
// После строки const content = await this.executeChatRequest(...)
this.logger.warn(`[E2E_DEBUG] FULL_PROMPT: "${input.prompt}"`)
this.logger.warn(`[E2E_DEBUG] FULL_USER_MESSAGE: "${createBotPunchlineUserPrompt(input.prompt, input.styleTag, memoryExamples, input.playerNames)}"`)
this.logger.warn(`[E2E_DEBUG] RAW_RESPONSE: "${content}"`)
```

В `executeChatRequest` (строка ~196) — логировать полный content без обрезки:

```typescript
this.logger.warn(`[E2E_DEBUG] ollama_full_content id=${requestId} content="${content}"`)
```

- [ ] **Step 2: Пересобрать API-контейнер**

```bash
docker compose up --build -d api
```

Ожидание: контейнер пересобирается и стартует без ошибок.

---

### Task 2: Создать E2E тест-скрипт

**Files:**
- Create: `api/test/e2e-game-flow.ts`

- [ ] **Step 3: Написать скрипт для E2E-тестирования**

Скрипт должен:
1. Подключить 2 Socket.IO клиента к `ws://localhost:4000`
2. Игрок 1 создаёт комнату (roundCount=3, botCount=2) — итого 4 игрока
3. Игрок 2 присоединяется по roomCode
4. Игрок 1 (хост) стартует игру
5. На каждом раунде (×3):
   - **Writing:** оба игрока отправляют ответы (простые строки типа "тестовый ответ раунд N")
   - **Voting:** оба голосуют за каждую дуэль (left/right рандомно)
   - **Rating:** оба ставят рандомные оценки 1-10
   - **Scoreboard:** ждём перехода
6. Логирует:
   - Все промпты каждого раунда (из gameState.prompts)
   - Все ответы ботов (из gameState в фазе voting — из дуэлей видно leftAnswer/rightAnswer)
   - Совпадение ответов ботов с фолбеками (сравнить со списком)
   - Пересечения промптов между раундами (дубликаты)
   - Для каждого ответа бота — начинается ли он с повтора промпта
7. В конце: подключается к MongoDB и проверяет:
   - Количество completions добавленных за игру
   - Что source правильно выставлен (human/bot)

Структура скрипта:

```typescript
import { io, Socket } from 'socket.io-client'
import { MongoClient } from 'mongodb'

const API_URL = 'http://localhost:4000'
const MONGO_URI = 'mongodb://localhost:27017/punchme'

const KNOWN_FALLBACKS = [
  'это звучало лучше в моей голове.',
  'это был смелый план ровно до первой минуты.',
  'я сделал вид, что именно так и задумал.',
  'соседи теперь аплодируют и боятся.',
  'я получил опыт и счет за ущерб.',
  'главное произнести это уверенно.'
]

interface GameState {
  roomCode: string
  phase: string
  roundIndex: number
  roundCount: number
  players: { id: string; name: string; isBot: boolean; score: number }[]
  prompts: string[]
  promptAssignments: { playerId: string; promptIndices: number[] }[]
  currentDuel: {
    id: string
    prompt: string
    leftAnswer: string
    rightAnswer: string
    leftPlayerId: string
    rightPlayerId: string
    votesByPlayerId: Record<string, string>
  } | null
  duelIndex: number
  duelCount: number
  writingSubmitters: string[]
  ratingSubmitters: string[]
  ratingItems: { id: string; prompt: string; punchline: string; authorPlayerId: string }[]
  timerSecondsLeft: number | null
}

interface Session {
  roomCode: string
  playerId: string
}

// --- Utility helpers ---

function waitForPhase(socket: Socket, phase: string): Promise<GameState> { ... }
function waitForEvent<T>(socket: Socket, event: string): Promise<T> { ... }

// --- Main test flow ---

async function runTest(): Promise<void> {
  const allPrompts: string[][] = []    // prompts per round
  const botAnswers: { round: number; prompt: string; answer: string; isFallback: boolean; repeatsPrompt: boolean }[] = []
  const fallbackCount = { total: 0, fallbacks: 0 }

  // 1. Connect player 1, create room
  // 2. Connect player 2, join room
  // 3. Start game
  // 4. Loop through 3 rounds:
  //    a. Writing phase — submit answers for both players
  //    b. Voting phase — vote on each duel
  //    c. Rating phase — rate items
  //    d. Scoreboard — wait for transition
  // 5. Print report
  // 6. Check MongoDB

  // ... (полная реализация)
}
```

- [ ] **Step 4: Установить зависимости для скрипта**

```bash
cd api && npm install --save-dev socket.io-client mongodb tsx
```

---

## Фаза 2: Запуск тестирования и сбор данных

### Task 3: Запустить E2E-тест

- [ ] **Step 5: Убедиться что все контейнеры работают**

```bash
docker compose ps
```

Ожидание: api, web, mongo, ollama — все Running/Healthy.

- [ ] **Step 6: Запустить E2E-скрипт**

```bash
cd api && npx tsx test/e2e-game-flow.ts
```

Ожидание: скрипт проходит все 3 раунда без зависаний.

- [ ] **Step 7: Параллельно смотреть логи API**

```bash
docker compose logs -f api --tail 200
```

Фокус на `[E2E_DEBUG]` логах — полные промпты и ответы модели.

---

## Фаза 3: Анализ результатов

### Task 4: Проверить качество промптов из БД

**Что проверять:**
- [ ] **Step 8:** Промпты не пустые, длина 5-200 символов
- [ ] **Step 9:** Между раундами нет дубликатов промптов
- [ ] **Step 10:** Промпты берутся из seed_prompts или из AI-сгенерированных (проверить в MongoDB что usedCount увеличился)

### Task 5: Проверить качество AI-ответов ботов

**Что проверять:**
- [ ] **Step 11:** Ответы ботов — НЕ фолбеки (сравнить с KNOWN_FALLBACKS)
- [ ] **Step 12:** Ответы ботов — это ПРОДОЛЖЕНИЯ промпта, а не переписывание. Критерий: ответ НЕ должен содержать начало промпта (первые 20+ символов)
- [ ] **Step 13:** Ответы на русском языке (содержат кириллицу)
- [ ] **Step 14:** Длина ответов в пределах 1-140 символов

### Task 6: Проверить фоновую генерацию промптов

- [ ] **Step 15:** В логах API видно `background_generation stored=N` — AI генерирует новые промпты
- [ ] **Step 16:** Новые промпты сохранились в MongoDB (count увеличился)

### Task 7: Проверить сохранение completions в MongoDB

- [ ] **Step 17:** После игры в коллекции prompt_starters появились completions с правильными полями (source, votesFor, roomCode и тд)
- [ ] **Step 18:** completions.source правильно различает 'human' и 'bot'

---

## Фаза 4: Цикл правок (если обнаружены проблемы)

### Task 8: Исправить проблему переписывания промпта ботом

**Вероятная проблема:** Модель возвращает полное предложение вместо только продолжения.

**Файлы для правки:**
- `api/src/modules/ai/prompts/prompt-templates.ts:28-32` (BOT_PUNCHLINE_SYSTEM_PROMPT)
- `api/src/modules/ai/prompts/prompt-templates.ts:45-61` (createBotPunchlineUserPrompt)
- `api/src/modules/ai/ai.service.ts:82` (постобработка ответа)

**Возможные решения:**
1. Изменить system prompt — явно сказать "write ONLY the continuation, do NOT repeat the sentence beginning"
2. Добавить постобработку — если ответ начинается с текста промпта, обрезать его
3. Оба подхода вместе

- [ ] **Step 19:** Применить исправление промптов
- [ ] **Step 20:** Добавить постобработку (strip prefix) в `generateBotAnswer`
- [ ] **Step 21:** Пересобрать API, перезапустить E2E-тест
- [ ] **Step 22:** Убедиться что проблема решена

### Task 9: Исправить другие найденные проблемы

- [ ] **Step 23:** По результатам тестов — исправить прочие баги (фолбеки, таймауты, и тд.)
- [ ] **Step 24:** Перезапустить E2E-тест для подтверждения
- [ ] **Step 25:** Убрать отладочные `[E2E_DEBUG]` логи из ai.service.ts

---

## Итоговый отчёт

После всех итераций — вывести сводку:

| Метрика | Значение |
|---------|----------|
| Раундов пройдено | 3/3 |
| Промптов из БД | N |
| Дубликатов промптов | 0 |
| Ответов ботов всего | N |
| Из них фолбеков | 0 |
| Переписывают промпт | 0 |
| На русском | N/N |
| Completions в БД | N |
| Фоновая генерация | +N промптов |
