---
name: PunchMe — Claude CLI quirks observed in production
description: Грабли с Claude CLI и моделями которые мы поймали в реальных играх. Не теоретические, а реально наступленные.
type: project
originSessionId: b711b77b-838b-4db8-a634-bce03b5fbfc4
---
## Windows cross-spawn truncates multiline args

`spawn` через `cross-spawn` с `-p MULTILINE_STRING` режет на первом `\n` потому что CMD не поддерживает multi-line args нативно. Все системные промпты длинные → user prompt передаётся через **stdin** + флаг `--input-format text`. Stdio `['pipe', 'pipe', 'pipe']`. Это в `claude-agent-runner.service.ts`.

**Why:** баг неочевидный — Claude возвращал «Кажется сообщение оборвалось…» вместо JSON envelope. Целый день ушёл на корень. Без stdin путь весь v2 не запускался.

## --system-prompt НЕ полностью replace в Claude CLI

Тесты показали: даже с `--system-prompt "Ты бот."` запросы потребляют **~45-48k cache_creation_tokens** на старте сессии. Это значит подгружается дефолтный системный контекст Claude Code (роль, tools, environment). `--system-prompt` заменяет **роль**, но не отключает остальное.

Дополнительные флаги (`--tools ""`, `--disable-slash-commands`) НЕ снижают `cache_creation` существенно. Реальный exit — `--bare`, но он требует `ANTHROPIC_API_KEY` (а у нас Max-OAuth, ключа нет).

**Why:** 45k токенов кэша на каждый start — это не катастрофа (кэш переиспользуется на resume), но это базовый цена входа. Bot CoT шутки про программирование оттуда тоже могли тянуться (статистический bias из дефолтной роли).

## CLAUDE.md global utility leak

`~/.claude/CLAUDE.md` подгружается **независимо от cwd**. Подмена `HOME` + `USERPROFILE` env при `spawn` на изолированный temp HOME с пустым `.claude/` (без CLAUDE.md) — единственный реальный фикс. Auth-файлы (`.credentials.json`, `settings.json`) копируются туда из real HOME при первом spawn.

Симптом до фикса: модель напрямую цитировала глобальный CLAUDE.md — «Dima, NestJS бекендер, фриланс, Godot» — в шутках.

## Claude Code retry с тем же sessionId → exit 1

Когда `start` mode упал по AgentParseError (schema fail), Claude CLI **уже** создал session file на диске. Повторный `--session-id <same>` → «session already exists» → exit 1. Фикс: на retry для `start` mode генерить новый `randomUUID()`. Для `resume` mode оставлять тот же id (там как раз файл нужен).

## Sonnet тянет в CoT даже на text-output агентах

Бот: после простого setup'а модель иногда выдаёт 400+ output tokens вместо 20. Размышляет вслух, выдаёт варианты. `cleanPunchline` берёт первую строку — но платим x5-x10. Фикс: в начало системного промпта вынести «Никаких размышлений. Сразу одна строка». Помогло, но не на 100% — иногда всё равно проскакивает.

## Модель сокращает имена JSON-полей если они длинные

Memory-updater имеет zod-схему с полями типа `voterPreferencesDelta.darkPreference`, `authorStyleDelta.avgPunchlineLength`. Модель упорно сокращает: `dark`, `irony`, `avgLen`, `structures`. Только **полный пример выхода в системном промпте** помог — модель копирует пример лучше чем разбирает текст. Также добавили блок «частые ошибки: НЕ пиши `dark`, пиши `darkPreference`».

## ValidationPipe forbidNonWhitelisted silently drops

NestJS Gateway с `whitelist: true, forbidNonWhitelisted: true` ОТБРАСЫВАЕТ запрос **без логов** если payload имеет лишние поля. Это убило 2 раунда расследования rating-bag — фрейм приходил, но handler не вызывался. Фикс: кастомный `exceptionFactory` в ValidationPipe который логирует все failed fields с constraints. Стандартного логирования не хватает.

## Isolated HOME не обновляет credentials при их ротации

Когда credentials в `~/.claude/.credentials.json` обновляются (OAuth refresh, повторный `claude login`), копия в `$TEMP/punchme-claude-home/.claude/.credentials.json` **не обновляется автоматически**. Изолированный HOME создаётся один раз и кешируется — старый токен висит там до перезаписи.

Симптом: после login юзера на проде первая игра падает с 401 во всех агентах, хотя source credentials свежие. В isolated HOME — устаревший токен.

Поймали 2026-05-15: prod credentials под qwe истекли → юзер залогинился → новая игра всё равно падает → выяснилось что `/tmp/punchme-claude-home/.claude/.credentials.json` mtime старше source.

**Срочный фикс на месте:** `cp /home/qwe/.claude/.credentials.json /tmp/punchme-claude-home/.claude/.credentials.json` (или рестарт API — он пересоздаст isolated HOME). 

**Системный фикс (TODO):** при каждом spawn агента — проверять mtime source credentials против isolated копии, если source новее → перекопировать. Либо вообще убрать кеширование isolated HOME и копировать заново каждый раз (стоит миллисекунды).

## Rating phase auto-submit на фронте

Юзеры не нажимали «Отправить оценки» — таймер истекал, бэк переходил в scoreboard с пустой `ratingSubmissions`. Решение: на фронте useEffect ловит `localTimer <= 2` И phase==='rating' → автоматически шлёт собранные оценки. Плюс защита от двойного submit через `ratingsSubmittedLocally` state.

## Why

Документирую чтобы при следующих фиксах не наступать на те же грабли и не тратить часы на расследование известных симптомов.

## How to apply

Если на dev_v2 или новых ветках появляются симптомы — `cache_creation` всплеск, schema fail с короткими именами, retry exit 1, rating пропадает — сначала проверь по этому файлу.
