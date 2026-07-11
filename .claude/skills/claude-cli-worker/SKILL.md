---
name: claude-cli-worker
description: Спавн Claude CLI как воркера/агента/LLM-провайдера под Claude Max OAuth (без Anthropic API key). Гочи Windows, изолированный HOME, JSON-конверт, MCP-инъекция. Триггерить при интеграции claude binary в Node-сервис.
---

# Claude CLI as Worker (Max OAuth)

Паттерн: использовать подписку Claude Max (OAuth, без оплаты API) — спавнить бинарь `claude` как дочерний процесс и общаться через stdin/stdout JSON. Выстрадано в punchme, tg-bot-inbox, tg-bot-v2.

## Три формы использования

1. **One-shot worker** — `claude -p --output-format json`, парсишь конверт, забираешь `result`. Пример: tg-bot-inbox (claude пишет файл в vault, возвращает summary).
2. **Agent-runner** — structured-вызов с Zod-валидируемым JSON-выхлопом, разные модели под роли (opus/high для качества, sonnet/low для дешёвых). Пример: punchme (opening-generator opus, bot/memory sonnet).
3. **LLM-provider** — `--system-prompt`, session resume, контекст через MCP. Пример: tg-bot-v2 (haiku + MCP search_chat).

## Спавн — обязательные гочи

- **Prompt через stdin, не флагом `-p`** для multiline: Windows cross-spawn рубит multiline-аргумент по первому `\n`. Пиши промпт в stdin с `--input-format text`.
- **cross-spawn** вместо node `spawn` — корректный resolution `.cmd`-шима `claude` на Windows.
- **Изолированный временный HOME на каждый спавн**: иначе глобальный `~/.claude/CLAUDE.md` течёт в выхлоп модели (в punchme — прямо в текст шуток). Создай `$TEMP/<proj>-claude-home`, скопируй туда ТОЛЬКО `.credentials.json` + `settings.json`, передай как `HOME` / `USERPROFILE`.
- **Permissions для FS-работы**: `--permission-mode bypassPermissions --add-dir <dir>`.

## JSON-конверт

- Выхлоп `--output-format json`: `{ result, is_error, session_id, ... }`.
- Валидируй `result` через Zod-схему. Не доверяй вслепую.
- **Guard `detectClaudeOutputError`**: CLI на ошибке кладёт error-строку в `result` — отлови её, не персисти как валидный контент.
- **Нет `--json-schema` на root-массиве**: оберни ожидаемый массив в объект (`{ items: [...] }`).
- LLM усекает длинные JSON-ключи (`darkPreference` → `dark`) — дай полный output EXAMPLE в system prompt: пример бьёт инструкцию.

## Надёжность

- **Timeout discipline**: `CLAUDE_TIMEOUT_MS` → SIGTERM → +5s SIGKILL.
- **Retry с НОВЫМ sessionId** на ошибке старта (exit 1 при resume несуществующей сессии).
- **Single-concurrency queue**: сериализуй спавны (in-memory promise queue, max 1) — параллельные `claude` дорого и гонятся. Для single-user не нужен Redis.
- **~45-48k cache_creation токенов на старт сессии** — учитывай в стоимости; reuse session где можно.
- **Stale credentials**: при OAuth-refresh `.credentials.json` в изолированном HOME устаревает — пере-копируй перед спавном или лови auth-ошибку и обновляй.

## MCP-инъекция контекста (вместо prompt-stuffing)

- Подними stdio MCP-сервер с tool'ом (напр. `search_chat`), дай его claude через `--mcp-config` — модель сама делает несколько запросов, а не пихаешь RAG-результаты в промпт.
- Tool с фильтрами (по автору/дате) → точнее и дешевле, чем один большой контекст.

## Архитектура (NestJS)

- Весь спавн — в одном `*.service.ts` (runner) за интерфейсом-портом (`ILlmProvider` / `IClaudeRunner`).
- Конфиг (модель, timeout, paths, HOME-dir) — в `*.config.service.ts`, не хардкод.
- Никаких прямых спавнов из контроллеров / хендлеров бота.
