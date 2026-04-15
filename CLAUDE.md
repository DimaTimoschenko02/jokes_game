# PunchMe

Party game для друзей в браузере. Игроки + AI-боты получают начала шуток и пишут панчлайны. Дуэли, голосование, рейтинги.

## Стек

- **Backend:** NestJS 11, Socket.IO, Mongoose (MongoDB), Zod, class-validator
- **Frontend:** React 19, Vite 8, Socket.IO client
- **AI:** Claude CLI (sonnet, effort high) for joke generation; Ollama BGE-M3 for embeddings only
- **Infra:** Docker Compose (mongo, ollama — infra only), local dev via npm scripts
- **Язык:** TypeScript (strict), Russian UI, English code

## Архитектура

```
api/src/modules/
├── game/            — WebSocket gateway + service: rooms, rounds, duels, voting, ratings, bot orchestration
├── ai/              — Claude CLI integration, two-stage opening generation, bot punchlines, prompt templates
├── prompt-starter/  — MongoDB-backed joke openings, golden openings feedback loop, seed data
├── joke-memory/     — Joke storage, quality scoring, few-shot retrieval, finetune export
├── embedding/       — Text embeddings via Ollama (BGE-M3)
├── admin/           — Admin UI + guard

web/src/
├── App.tsx                      — Main UI for all game phases
├── hooks/use-game-client.ts     — Game state, session, socket actions
├── socket/game-socket.ts        — Socket.IO client wrapper
├── models/                      — Shared client types
```

Зависимости: `GameModule` → `AiModule`, `PromptStarterModule`, `JokeMemoryModule` → `EmbeddingModule`.

## Game Flow

1. Хост создаёт комнату, настраивает кол-во ботов (1–2)
2. Игроки входят по коду комнаты. Нечётное число → авто-добавление бота
3. **Writing phase (45s):** Каждый получает 2 незаконченные шутки. N игроков = N промптов, circular assignment: player[i] → prompts[i, (i+1)%N]
4. **Voting phase:** Дуэли по промптам — два автора, остальные голосуют. Участники дуэли не голосуют за свою
5. **Rating phase:** Все оценивают шутки 1–10. Фаза завершается когда все люди проголосовали
6. **Scoreboard** → следующий раунд

## Запуск

### Локальная разработка (основной режим)

```bash
npm run infra          # Поднять MongoDB + Ollama (Docker)
npm run setup          # Первый раз: скачать BGE-M3 модель для embeddings
npm run dev            # API (:4000) + Web (:5173) параллельно
npm run dev:api        # Только API
npm run dev:web        # Только Web
```

API дефолтит на `mongodb://localhost:27017/punchme` и `http://127.0.0.1:11434` (Ollama).
AI генерация через Claude CLI (должен быть установлен и авторизован).

### Docker production

```bash
npm run docker         # Полный стек в Docker (profile: production)
npm run docker:tunnel  # + ngrok tunnel
npm run docker:down    # Остановить всё
```

## Ключевые детали

- Game state server-authoritative. `gameState` emit per socket — скрывает голоса до своего голосования
- `usedPromptTexts` per room — промпты не повторяются между раундами
- At game start: two-stage pipeline — generate ×3 candidates → Claude filters to needed count
- Player bios (localStorage) → passed to all AI prompts for personalization
- Golden openings: best openings saved after game → used as examples in future generations
- Bot punchlines: Claude CLI generates 3 candidates, picks best. Few-shot from joke_memory (BGE-M3 similarity)
- No name placeholders — jokes stored as-is with real player names
- Fallback: if Claude calls fail → seed prompts from DB (48 seeded)

## Ruflo MCP

Ruflo — persistent vector-indexed memory and task tracking across sessions. Full reference: skill `ruflo-workflow`.

### Session lifecycle

**Start** — load context before any work:
```
mcp__ruflo__memory_search(query: "project context recent progress")
mcp__ruflo__memory_search(query: "<topic of current work>")
mcp__ruflo__agentdb_session-start(sessionId: "punchme-YYYY-MM-DD")
```

**End** — save context before session closes:
```
mcp__ruflo__memory_store(key: "project-context", value: { status, lastWorkedOn, pending }, upsert: true)
mcp__ruflo__agentdb_session-end(sessionId: "...", summary: "what was done")
```

### Rules
- NEVER start coding without checking Ruflo memory first
- ALWAYS save session outcomes before ending
- Run `hooks_pretrain` after adding new modules or major refactors
- No auto-hooks in settings.json — all calls are manual

## Cursor rules

Проект также использует Cursor IDE. `.cursor/rules/project-memory.mdc` содержит описание проекта (синхронизировать с этим файлом при изменениях). `.cursor/rules/codewriting.mdc` — стиль кода (дублирует глобальные правила).

## Known Limitations

- Joke memory queue in-memory — теряется при рестарте
- Retrieval сканирует только 600 последних шуток
- Bot style (sarcastic/dark/absurd) выбирается рандомно, без feedback loop
- Fine-tune pipeline есть в коде, но не подключён к триггеру
- Нет negative examples в few-shot
