---
name: V2 Redesign Complete
description: Full AI redesign on dev_v2 branch — PG+pgvector, JWT auth, persistent Claude sessions per role, user_memory persistence, opening feedback. Awaits smoke test.
type: project
originSessionId: b711b77b-838b-4db8-a634-bce03b5fbfc4
---
## V2 Redesign (2026-05-12, branch dev_v2)

Полный редизайн поверх v1 (которая на Mongo + Ollama-генерация). Сейчас `dev_v2` готов и не сливался в `main` — `main` нетронут на коммите `c42d36e`.

**Главные изменения архитектуры:**

- **Storage**: MongoDB → PostgreSQL + pgvector через Drizzle ORM (`postgres.js` driver, не `pg`). HNSW индексы на embeddings. `joke_memory.fingerprint` UNIQUE, дедуп через `ON CONFLICT DO UPDATE` (атомарно). `prompt_starters` + child-table `prompt_starter_completions` (нормализация embedded array).
- **Auth**: bcrypt(12) + JWT 30 дней в `Authorization: Bearer` для HTTP и в `socket.handshake.auth.token` для Socket.IO. Сокет-middleware рубит невалидные на handshake. `playerId == userId` для людей.
- **AI слой**: рип-аут старой stateless `ai.service.generateBotAnswer` пути (но он жив как fallback). Новые сервисы: `BotAgentService` (одна Claude-сессия на бота на игру, single-call punchline), `OpeningGeneratorAgentService` (одна сессия на игру, generate+generateMore), `MemoryUpdaterAgentService` (одна сессия на игру, обновляет память всех юзеров в одном контексте), `OpeningSelectionService` (BGE-M3 similarity ≥0.85 vs history → drop + MMR).
- **Retrieval**: `executeRetrieveBotExamples` возвращает два пула (positive + negative) через HNSW cosine + Bayesian useScore + MMR diversification. Negative pool тянет `adminComment` для few-shot. Старый `executeRetrieveExamples` живёт пока для legacy ai.service пути.
- **User memory**: `user_memory` JSONB-таблица (themes, voter_preferences, author_style, portrait). `UserMemoryService.applyUpdates` мерджит дельты с clamping. Доступ юзеру через `GET /api/users/me/memory` — Profile-экран на фронте показывает темы (bars), preferences (4 шкалы), author style, portrait.
- **M7.1 feedback**: 3 кнопки (👍 👎 🤢) per opening в writing phase → batch submit → `submitOpeningFeedback` socket event → `prompt_starters.feedback_score` пересчитывается на сервере в одном UPDATE.

**Коммиты на dev_v2 (8):**
- `598e464` spec PG-миграции
- `736461f` PG-миграция (28 файлов)
- `52d8d8c` M5.3 retrieval + M5.4 cleanup + M4.2 opening dedup
- `35ffadd` M6.2+M8.1 game-lifecycle wiring
- `8d29242` auth backend + memory persistence + negative openings + quick feedback
- `2be8e46` фронт: auth flow + Profile с AI-памятью + opening feedback UI

**Why:** v1 уже работала, но (1) Mongo-как-vector-store без HNSW сканировала 600 рядов джойсом, (2) бот был stateless и не помнил контекст игры, (3) не было персонализации под игрока. Решили мигрировать на PG+pgvector до того как написать M5.3 retrieval — чтобы не переписывать дважды.

**How to apply:** В новой сессии, прежде чем менять что-то в v2-коде, верифицировать состояние ветки `dev_v2` и не путать с `main`. Если юзер просит "почему так сделано" — `docs/superpowers/specs/2026-05-12-postgres-pgvector-migration.md` + `2026-05-12-ai-redesign-v2-design.md` зафиксировали решения.

**Default endpoints/ports:**
- PG: `localhost:5433` (не 5432 — у юзера занято `discounts-postgres`)
- DATABASE_URL default: `postgres://punchme:punchme@localhost:5433/punchme`
- API: `:4000`, Web: `:5173`
- JWT_SECRET — env var; default `punchme-dev-secret-change-me` (для dev). Менять при деплое.
