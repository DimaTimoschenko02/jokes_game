---
name: drizzle-postgres
description: Работа с Drizzle ORM + PostgreSQL — схема, миграции, repositories, типизация, pgvector. Триггерить при изменении БД, написании репозиториев.
---

# Drizzle + PostgreSQL

## Стек
- `drizzle-orm` + `drizzle-kit` (миграции)
- Драйвер: `postgres` (porsager/postgres) по умолчанию — если проект на node-postgres/pg, адаптируй
- DB в Docker через `docker compose up -d`
- Миграции: `drizzle/0000_*.sql`, генерируется `npx drizzle-kit generate --name=<name>`

## Schema (`src/db/schema.ts`)
- Все таблицы — `pgTable('snake_case', {...})`
- Колонки: camelCase в TS, snake_case в БД (`title: text('title')`)
- Дефолты: `defaultNow()` для timestamps; для array/jsonb — `default()` с raw sql-выражением
- Constraints: `check()`, `uniqueIndex()`, `index()` через 3-й аргумент-функцию `(t) => [...]`
- Enum-подобные поля: `text` + `check` constraint + `as const` массив TS-литералов
- Foreign keys: `uuid('x_id').references(() => other.id, { onDelete: 'cascade' })`

## Миграции
- Генерация: `npm run db:generate` (drizzle-kit)
- Накат: автоматически на `onModuleInit` в `DrizzleModule` через `migrate()`
- Папка `drizzle/` копируется в Docker-образ
- НЕ редактировать сгенерированные SQL — только пересоздавать через generate
- Никогда не дропать миграции в проде. Только новые
- Hand-written SQL vs snapshot drift кусается: после ручных правок схемы regenerate, иначе следующая миграция уедет

## Repositories
- Один файл = один репозиторий = одна сущность
- Инжектится `DRIZZLE` symbol через `@Inject(DRIZZLE)`
- Возвращают domain types, не raw rows. Маппинг row→domain в репозитории
- Команды: `create`, `update`, `delete`. Запросы: `findById`, `findActive`, `listMatched`
- Транзакции: `db.transaction(async (tx) => { ... })`

## Запросы
- `eq`, `and`, `or`, `inArray` из `drizzle-orm` — не raw SQL
- Raw SQL только через тегированный шаблон `sql` с параметрами, не конкатенация
- `.execute()` для INSERT/UPDATE/DELETE без RETURNING; `.returning()` когда нужен объект назад

## Типы
- `InferSelectModel<typeof t>` — ROW из БД; `InferInsertModel<typeof t>` — для INSERT
- Не экспортировать эти типы за пределы repository layer

## pgvector (если проект использует embeddings)
- Расширение `CREATE EXTENSION IF NOT EXISTS vector` — в первой миграции / init
- Колонка `vector(N)` — через `customType` или raw SQL: у Drizzle нет нативного vector-типа
- Запись эмбеддинга — через `::vector` каст в `sql`-теге
- Поиск: операторы `<->` (L2) / `<=>` (cosine) через `sql`-тег
- Сами эмбеддинги (напр. Ollama bge-m3, 1024-dim) — внешний сервис за интерфейсом, не в репозитории

## Запрещено
- Конкатенация SQL — только параметризованные или ORM
- Прямой `postgres()` клиент в сервисах — только через `DRIZZLE` injection
- DB write из контроллеров напрямую
