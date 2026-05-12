# PunchMe — миграция MongoDB → PostgreSQL + pgvector

**Status:** approved → execution
**Date:** 2026-05-12
**Branch:** `dev_v2`
**Driver:** Drizzle ORM
**Replaces:** Mongoose layer (`@nestjs/mongoose` + `mongoose`)

---

## Motivation

Текущая модель данных по сути реляционная (jokes ↔ authors, prompts ↔ feedbacks, embeddings) и используется как vector store без векторного индекса (in-memory cosine из массивов). Mongo тут — слабое звено для обеих половин. Перед M5.3 (retrieval) и M1.1 (auth) переводим хранилище на PG + pgvector, чтобы:

- `ORDER BY embedding <=> $1 LIMIT k` с HNSW вместо `findRecent(600) + JS cosine`.
- Реляционные FK для предстоящих `users` / `user_memory` без денормализации.
- Unique constraint на fingerprint вместо ручного `findByFingerprint` → дедуп на уровне БД.

Время для миграции — сейчас. Прода нет, схемы уже трогаем под v2, retrieval ещё не написан (M5.3 пишем сразу на SQL).

## Scope

### In-scope
1. Заменить storage layer для `joke_memory` и `prompt_starters`.
2. Перевести embeddings в `vector(1024)` (BGE-M3 dim).
3. Drizzle ORM + drizzle-kit миграции.
4. PG + pgvector сервис в docker-compose.
5. Удалить `@nestjs/mongoose`, `mongoose`, `mongodb` dev-deps.
6. Подготовить базу под будущий auth (users / user_memory): таблицы НЕ создаём сейчас, но FK-стратегию закладываем (поля `author_user_id` — `text` сейчас, конвертируем в FK при M1.1).

### Out-of-scope
- Создание `users` / `user_memory` таблиц (это M1.1 auth).
- Перенос **существующих** dev-данных из Mongo. Берём свежую БД с seed (48 промптов).
- ORM-абстракции/repository-паттерны выше уровня "Drizzle queries в repository классе".
- Прод-деплоймент (env переменные обновляем, прод-конфиг — пользователь крутит сам).

## Architecture

### Storage layer

```
api/
├── src/db/
│   ├── schema/
│   │   ├── joke-memory.schema.ts          — pgTable joke_memory
│   │   ├── prompt-starter.schema.ts       — pgTable prompt_starters
│   │   ├── prompt-starter-completion.schema.ts — child table for completions
│   │   └── index.ts                        — re-export all
│   ├── db.module.ts                        — NestJS module exposes `DB` provider
│   ├── db.types.ts                         — Drizzle DB type alias
│   └── db.provider.ts                      — connection factory
├── drizzle.config.ts                       — drizzle-kit config
└── drizzle/                                — generated migration SQL
```

### Repositories

`JokeMemoryRepository` и `PromptStarterRepository` остаются на местах (тот же интерфейс наружу), но внутри:
- Inject `DB` через `@Inject('DB')`.
- Mongoose `Model<X>` → Drizzle query builder.
- Возвращают plain объекты с тем же shape, что и сейчас (типы `JokeMemoryEntry`, `PromptStarterEntry`).

### Embedding storage

`EmbeddingService` не меняется (возвращает `{ vector: number[], model: string }`). Колонка `prompt_embedding vector(1024)` хранит вектор напрямую; запись через Drizzle принимает массив, чтение тоже массив.

## Data Model

### Table `joke_memory`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `prompt` | `text` NOT NULL | maxlength 140 enforced в коде |
| `punchline` | `text` NOT NULL | |
| `prompt_normalized` | `text` NOT NULL | для текстового поиска (если когда-то) |
| `fingerprint` | `text` NOT NULL **UNIQUE** | дедуп на уровне БД, заменяет ручной findByFingerprint |
| `prompt_embedding` | `vector(1024)` | BGE-M3, nullable если embedding не получили |
| `embedding_model` | `text` | |
| `votes_for`, `votes_against` | `integer` NOT NULL DEFAULT 0 | |
| `vote_share` | `real` NOT NULL DEFAULT 0.5 | |
| `quality_score` | `real` NOT NULL DEFAULT 0 | legacy v1 поле, пока сохраняется |
| `rating_average` | `real` | nullable |
| `rating_sum` | `real` | nullable |
| `rating_count` | `integer` | nullable |
| `admin_score` | `smallint` | 1–10 |
| `admin_scored_by` | `text` | |
| `admin_scored_at` | `timestamptz` | |
| `admin_comment` | `text` | maxlength 500 в коде |
| `used_as_example_count` | `integer` NOT NULL DEFAULT 0 | |
| `last_used_as_example_at` | `timestamptz` | |
| `author_user_id` | `text` | переедет в FK при M1.1 |
| `author_real_name` | `text` | snapshot имени на момент шутки |
| `source` | `text` NOT NULL | CHECK in ('human','bot') |
| `room_code` | `text` NOT NULL | |
| `round_index` | `integer` NOT NULL | |
| `created_at` | `timestamptz` NOT NULL DEFAULT now() | |

**Indexes:**
- `UNIQUE (fingerprint)`
- `HNSW (prompt_embedding vector_cosine_ops)` — для retrieval
- `(created_at DESC)`
- `(admin_score DESC)`
- `(rating_average DESC, rating_count DESC)`
- `(author_user_id, created_at DESC)`
- `(source, created_at DESC)`

### Table `prompt_starters`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `text` | `text` NOT NULL **UNIQUE** | |
| `used_count` | `integer` NOT NULL DEFAULT 0 | |
| `is_golden` | `boolean` NOT NULL DEFAULT false | |
| `average_completion_rating` | `real` | |
| `average_vote_share` | `real` | |
| `golden_since` | `timestamptz` | |
| `quick_feedback_up` | `integer` NOT NULL DEFAULT 0 | flat, не jsonb |
| `quick_feedback_down` | `integer` NOT NULL DEFAULT 0 | |
| `quick_feedback_broken` | `integer` NOT NULL DEFAULT 0 | |
| `feedback_score` | `real` NOT NULL DEFAULT 0 | range [-1, 1] enforced в коде |
| `admin_score` | `smallint` | 1–5 |
| `admin_scored_by` | `text` | |
| `admin_scored_at` | `timestamptz` | |
| `admin_comment` | `text` | |
| `derived_score` | `real` | |
| `used_as_example_count` | `integer` NOT NULL DEFAULT 0 | |
| `last_used_as_example_at` | `timestamptz` | |
| `text_embedding` | `vector(1024)` | |
| `embedding_model` | `text` | |
| `created_at` | `timestamptz` NOT NULL DEFAULT now() | |

**Indexes:**
- `UNIQUE (text)`
- `HNSW (text_embedding vector_cosine_ops)` — для опенинг-дедупа в M4.2
- `(used_count ASC)`
- `(is_golden, average_completion_rating DESC)`
- `(admin_score DESC, created_at DESC)`
- `(feedback_score DESC)`
- `(derived_score DESC)`
- `(used_as_example_count ASC)`

### Table `prompt_starter_completions`

Заменяет embedded array `completions[]`. Нормализация осознанная — упрощает `findBestCompletions` и `removeCompletion`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `prompt_starter_id` | `uuid` NOT NULL | FK → `prompt_starters.id` ON DELETE CASCADE |
| `punchline` | `text` NOT NULL | maxlength 200 в коде |
| `source` | `text` NOT NULL | CHECK in ('human','bot') |
| `votes_for`, `votes_against` | `integer` NOT NULL DEFAULT 0 | |
| `vote_share` | `real` NOT NULL DEFAULT 0.5 | |
| `rating_average` | `real` | |
| `rating_count` | `integer` | |
| `room_code` | `text` NOT NULL | |
| `round_index` | `integer` NOT NULL | |
| `created_at` | `timestamptz` NOT NULL DEFAULT now() | |

**Indexes:**
- `(prompt_starter_id, vote_share DESC)`
- `(prompt_starter_id, created_at DESC)`

## API Compatibility

Все публичные методы repository'ев **сохраняют сигнатуры**. Меняется только их реализация. Это значит:

- `JokeMemoryService.executeRecordJoke` остаётся как есть
- `PromptStarterService.selectPrompts`, `pushCompletion`, `getGoldenExamples`, `saveGoldenOpening` — без изменений
- `game.service` / `ai.service` / агенты — нулевые изменения

Единственное добавление: при инсертах в `joke_memory` теперь UNIQUE-конфликт на fingerprint бросает PG-error → ловим в `createEntry`, делаем `mergeCounters` в catch (или используем `ON CONFLICT (fingerprint) DO UPDATE SET votes_for = votes_for + ...`). **Предпочтение: ON CONFLICT** — атомарно, один запрос.

## Migration Strategy

### Drizzle migrations
1. `drizzle.config.ts` указывает на `src/db/schema/*.ts` + папку `drizzle/`.
2. `drizzle-kit generate` создаёт SQL миграции.
3. На старте API: `migrate(db, { migrationsFolder: './drizzle' })` (idempotent, безопасно прогонять каждый раз).
4. **pgvector extension**: первая миграция содержит `CREATE EXTENSION IF NOT EXISTS vector;` руками (drizzle-kit это не делает).

### Data migration
- Существующих данных не переносим (dev-only, новые таблицы, seed на старте).
- `seedIfEmpty()` в `PromptStarterService` продолжает работать — насеет `SEED_PROMPTS` (48 строк).

### Env
- `MONGO_URI` → `DATABASE_URL` (формат: `postgres://user:pass@host:port/db`).
- Default dev: `postgres://punchme:punchme@localhost:5432/punchme`.
- Обновляем: `app.module.ts`, `docker-compose.yml`, `CLAUDE.md`, `ecosystem.config.cjs`.

### Docker compose
- Удалить `mongo` service + `punchme-mongo-data` volume.
- Добавить `postgres` service с image `pgvector/pgvector:pg17`.
  - `POSTGRES_USER=punchme`, `POSTGRES_PASSWORD=punchme`, `POSTGRES_DB=punchme`.
  - Volume `punchme-postgres-data:/var/lib/postgresql/data`.
  - Port `5432:5432`.
- `api` service: `MONGO_URI` → `DATABASE_URL`, `depends_on: postgres` (started).

## Dependencies

### Add
- `drizzle-orm` (^0.36) — query builder + types
- `drizzle-kit` (^0.28, devDep) — migrations CLI
- `postgres` (^3.4) — driver (postgres.js, not `pg`. Лучше типизация, faster)

### Remove
- `@nestjs/mongoose`
- `mongoose`
- `mongodb` (devDep)

## Acceptance Criteria

1. `npm run build` зелёный.
2. `docker compose up postgres` поднимает PG, миграция накатывается, pgvector extension работает (`SELECT '[0]'::vector;`).
3. `npm run dev:api` стартует, seed промптов прогоняется, в БД 48 строк в `prompt_starters`.
4. Smoke test: создать игру, дойти до voting phase, проверить что completion записался (одна строка в `prompt_starter_completions`).
5. Smoke test: jokes сохраняются в `joke_memory` с непустым `prompt_embedding` (`vector_dims(prompt_embedding) = 1024`).
6. Дубликат шутки (тот же fingerprint) увеличивает counters, а не создаёт новую строку (через ON CONFLICT).
7. `npm run docker` (production profile) поднимает полный стек без mongo.
8. Никаких `@nestjs/mongoose` / `mongoose` / `mongodb` импортов в `api/src/**`.

## Risk & Rollback

**Риск:** drizzle-kit на Windows бывает капризный с миграциями. **Митигация:** `drizzle-kit push` (direct push без файлов миграций) — поддерживается в dev; для prod генерируем файлы.

**Риск:** postgres.js плохо дружит с Nest lifecycle. **Митигация:** провайдер с `useFactory` + `onModuleDestroy` для `sql.end()`.

**Rollback:** `git revert` всей серии коммитов. Mongo volume цел (не удаляем на хосте, только из compose).

## Out-of-band Decisions

- **HNSW vs IVFFlat**: HNSW для retrieval (top-k similarity). Лучше recall при малых N, проще тюнить (`m=16, ef_construction=64`).
- **vector dim 1024**: BGE-M3 (`response.embedding.length` подтверждено).
- **Child table vs JSONB для completions**: child table. Запросы (`findBestCompletions`) проще, FK к prompts чище, `removeCompletion(id)` атомарен. JSONB не даёт преимуществ т.к. completions не shared между prompts.
- **postgres.js vs pg**: postgres.js. Полу-автоматическая типизация, native async, нет callback hell.
- **Drizzle vs TypeORM/Prisma**: Drizzle. Лёгкий, без runtime-генерации, без BS вокруг репозиториев, идеален для NestJS-провайдеров.
- **Auth tables**: НЕ создаём в этой миграции. Только в M1.1. `author_user_id` остаётся `text` пока, конвертируется в FK позже.

## Task Decomposition (Ruflo)

Создаются как отдельные tasks в Ruflo, выполняются последовательно:

- **PG.1** Docker compose: pgvector service + удалить mongo
- **PG.2** Зависимости + drizzle config + db module + connection provider
- **PG.3** Drizzle schemas: joke_memory, prompt_starters, prompt_starter_completions
- **PG.4** Migration generation + pgvector extension + boot-time migrate
- **PG.5** Repository: JokeMemoryRepository on Drizzle (ON CONFLICT dedup)
- **PG.6** Repository: PromptStarterRepository on Drizzle (child table queries)
- **PG.7** Modules: drop MongooseModule.forFeature, wire DB provider
- **PG.8** app.module: drop MongooseModule.forRoot, DATABASE_URL env, migrate on boot
- **PG.9** Cleanup: deps remove, env rename, docs (CLAUDE.md, ecosystem.config.cjs)
- **PG.10** Smoke test: start API, run game flow, verify embeddings stored

После PG.10 → продолжаем M5.3 retrieval (теперь на SQL).
