---
name: node-conventions
description: Coding conventions для Node.js/TypeScript проекта — типизация, naming, функции, ESLint/Prettier. Триггерить при написании или ревью TS/JS кода.
---

# Node/TypeScript conventions

## TypeScript
- Явная типизация всего. Никакого `any` — если неизбежно, `unknown` + narrowing
- Interfaces и type aliases в отдельных файлах
- DTOs в `dto/` папке модуля. Shared types в `models/` или `types/`
- `readonly`, `as const` для иммутабельности
- Явные access modifiers (public/private/protected)
- Specific enum types в interfaces, не `string`, когда enum существует
- `_` prefix для intentionally unused params
- No `async` без `await`
- Не деструктурировать Node built-ins (`path.join`, не `const { join } = path`)
- `void` для top-level promise calls (no floating promises)
- Импорт типов через `import type { X }` где возможно

## Функции
- Одна ответственность, до 20 строк
- Early returns
- RO-RO (Receive Object – Return Object) при >3 параметрах
- Boolean: `isX`, `hasX`, `canX`. Side-effects: `createX`, `updateX`, `deleteX`

## Naming
- PascalCase → классы. camelCase → переменные/методы. kebab-case → файлы. UPPERCASE → константы
- Полные слова, без сокращений. Функции с глаголов

## Validation на границах
- Все внешние JSON (HTTP API, env, body) — через **zod** schema
- `safeParse` + явная обработка ошибки, не `parse` в production коде
- Не доверять третьесторонним API: всегда схема перед маппингом

## ESLint/Prettier (когда настроено)
- ESLint 9 flat config + Prettier, zero errors
- Prettier: single quotes, trailing commas all
- `dist/` исключён из линта