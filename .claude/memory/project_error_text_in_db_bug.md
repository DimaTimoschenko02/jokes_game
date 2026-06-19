---
name: error-text-in-db-bug
description: "Bug: тексты ошибок Claude CLI (401, API Error и пр.) сохраняются в БД как нормальные шутки/опенинги. Нужна валидация перед persist."
metadata:
  node_type: memory
  type: project
  originSessionId: b711b77b-838b-4db8-a634-bce03b5fbfc4
---

# Баг: ошибки AI попадают в БД как контент

## Симптом

Когда Claude CLI на проде падает (например 401 Invalid auth credentials, или другие API errors), текст ошибки возвращается как `content` агентского ответа и **сохраняется в БД** наравне с валидными ответами. Пример: `"Failed to authenticate. API Error: 401 ..."` попал в `joke_memory` как панчлайн бота, юзер потом вручную чистил.

Зафиксировано 2026-05-15 во время prod-игры в комнате HXJJR — credentials под `qwe` истекли, все 3 агента (opening-generator, bot, memory-updater) валили 401 несколько раундов подряд.

## Why

Сейчас в коде нет sanity-валидации output'а агентов перед persist. `AiService.claude_response` логирует `content="Failed to authenticate..."` и дальше этот текст идёт в pipeline как обычный response.

## How to apply

При работе над этим — нужно добавить **валидацию AI output на уровне инфраструктуры** (`ClaudeAgentRunnerService` или `AiService`):

1. **Жёсткие фильтры:** ответ помечается как failed если содержит `API Error: 4\d{2}`, `Failed to authenticate`, `authentication_error`, `Invalid authentication`, `rate_limit_error`, или начинается с `Error:`.
2. **Soft sanity check:** длина, форма (если ожидался JSON — пробуем парсить, иначе reject).
3. Failed response **никогда не должен попадать в persistent storage** (`joke_memory`, `prompt_starters`, `user_memory`) — только в логи + fallback path.
4. Текущий fallback в game.service (`falling_back_legacy` → DB seeds) — это правильное поведение для **генерации**. Но для **сохранения после игры** (punchlines в joke_memory, golden updates) — нужен явный guard.

Стоит сделать единое место (например, в `ClaudeAgentRunnerService.invoke`) которое возвращает `{ ok: false, reason }` вместо текста ошибки. Тогда вызывающий код сам решит — реtry, fallback, или ignore.

## Related

- [[v2-status]] — общий статус проекта
- [[prod-server-monitoring]] — про то как credentials живут на проде под qwe (могут истекать → этот баг будет повторяться)
- [[model-quirks]] — реальные грабли с CLI
