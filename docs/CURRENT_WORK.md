# Current Work

Слепок состояния проекта для cross-device работы. Обновлять при сменах ветки/приоритета. Что за проект — см. `CLAUDE.md` и `README.md`.

> **Future Claude session / новое устройство:** этот файл — слепок «что мы делаем сейчас, что осталось». Состояние веток ВСЕГДА сверяй через `git log` / `git status` — этот файл может отстать от реальности на 1-2 коммита.

## Ветки

- **`main` = prod** = `origin/main`. HEAD: `2c0f8ea chore(.claude): track canonical skill set`. Уже содержит `3b4c911` (`VOTING_REVEAL_SECONDS=6`) и `726f339` (#41-45 — zombie session, AI output validation, host-exit cancel, vote reveal).
- **`dev` = активная интеграционная ветка** (не смержена в main, не запушена в момент создания этого файла → должна быть на origin). Сидит поверх `feat/group-memory`, добавляет план + voting-scoring. Здесь ведём работу.
- **`feat/group-memory`** — историческая, полностью содержится в `dev`. Можно не трогать, держим как точку отката.
- **`fix/voting-reveal-prod`** — уже в main, пустая, можно удалить.
- **`dev_v2`** — старая, до v2-редизайна. Архив.

## Что в `dev` сделано (поверх main)

### Group memory (D) — 12 задач
Спека: `docs/superpowers/specs/2026-05-21-group-memory-design.md`. План: `docs/superpowers/plans/2026-05-21-group-memory.md`.

- Таблица `group_memory` (один глобальный ряд `id='global'`, ленивый сид) + `users.test_account`. Миграция `0007` — применится сама на старте API.
- НЕ отдельный агент: `memory-updater` расширен finalize-вызовом в конце игры (`continue` на той же сессии), возвращает `groupMemoryDelta`. Backend мерджит детерминированно (`GroupMemoryService`, транзакция + `SELECT ... FOR UPDATE`).
- Поля: themes / inJokes / triggers / avoidedThemes / setupPatterns + `summaryText`. Структура — каждую игру; `summaryText` — лениво раз в 3 игры.
- Тест-игры исключены: `collectData=false` или есть игрок с `test_account=true` → finalize не зовётся.
- Блок памяти кормит И opening-generator, И bot-agent (при старте сессий).
- Killswitch `memoryEnabled` (админ-тогл, накопление продолжается) + вкладка «Память компании» в админке.
- Финальное код-ревью (opus) без Critical/Important. Билды api+web зелёные.

### Voting reveal + scoring (E) — 2 задачи
План: `docs/superpowers/plans/2026-05-22-voting-scoring.md`.

- **reveal-пауза 5→6с** (`VOTING_REVEAL_SECONDS`, коммит `c9be5e1`). ⚠️ **Дубликат с `3b4c911` в main** — то же изменение туда уже попало хотфиксом. При merge `dev → main` будет no-op для этого коммита.
- **Раунд-зависимый вес голоса** 100/150/200/300 (`ROUND_VOTE_WEIGHTS`, коммит `ff2bd1e`). `computeDuelPoints` в `game.service.ts`: каждый проголосовавший приносит автору `вес`; вес воздержавшихся (эл. избиратели минус проголосовавшие) делится между авторами пропорционально голосам — `leftAbstainShare = round(pool×leftVotes/votedCount)`, остаток — правому. Дуэль 0:0 → оба автора 0 (пул сгорает). `addScoreToWinners` переименован в `addScore`.
- Пункт «видеть авторов/голоса после своего голоса» — уже был в #41-45, кода не требовал.

## Что НЕ сделано — гейтит merge `dev → main`

### Ручной плейтест group memory
- Миграция `0007` применится сама на старте API.
- Разовый SQL пометки `test_account` для тест-аккаунтов — нужен список логинов от Dima.
- Боевая игра: `group_memory_finalize_ok` в логах, заполнение во вкладке «Память компании» в админке, проверка killswitch, summary после 3-й игры.

### Ручной плейтест voting-scoring
Чеклист в конце `docs/superpowers/plans/2026-05-22-voting-scoring.md`. Кратко:
- reveal ~6с после голосования (уже работает в prod через `3b4c911`).
- прирост `score` по раундам (100/150/200/300, сверять с логом `scoreboard_phase_start ... totals=[...]`).
- воздержавшиеся: их вес уходит авторам пропорционально, не пропадает.
- дуэль 0:0 → оба автора 0.
- видимость: до своего голоса не видно ни авторов, ни раскладки; после — видно всё; участники дуэли видят сразу.

### После плейтеста
1. Если всё ОК → merge `dev → main` (с `--no-ff` для читаемой истории либо обычным merge — на твоё усмотрение, force-push в main не делать).
2. Push main → GitHub Actions → `deploy.sh` на bestsrv ([prod-server-monitoring]).
3. Удалить `dev`, `feat/group-memory`, `fix/voting-reveal-prod` (последняя уже пустая).

## Следующая работа после E

**C. Memory-updater → накопительный портрет юзера.**
Симптом: портрет = пересказ конкретной игры, не накопительный. Числовые предпочтения (`darkPreference`/`ironyPreference`) застряли на 0.5. Нужен brainstorming с Dima про формат → схема → правка промпта и Zod-схемы в `api/src/modules/agents/configs/memory-updater-agent.config.ts`. Этап «design», не начинать без согласования формата.

## Известные грабли проекта

Все живут в `~/.claude/projects/.../memory/` на host-машине, в репу не синкаются:
- `model_quirks` — Claude CLI косяки (cross-spawn, CLAUDE.md leak, retry, CoT, short field names, ValidationPipe silent drop).
- `audience_context` — игроки 22-25, Украина, 2026 (война, FPV, ВСУ). Применять к ЛЮБОМУ LLM-промпту в проекте.
- `prod_server` — SSH/PM2/логи bestsrv, `punchme.oldgod.online`.

Если работаешь с другого устройства без auto-memory — основное:
- Аудитория промптов: реальные имена игроков, не плейсхолдеры, локальный контекст (война, ВСУ, ТЦК, FPV — родное, не «политическая тема»).
- Claude CLI агенты спавнятся в isolated HOME (`$TEMP/punchme-claude-home`), чтобы не подхватывать глобальный CLAUDE.md.
- AI-output всегда валидируется (Zod), тексты ошибок CLI не пишутся в БД как шутки.
- Боты НЕ голосуют в дуэлях.

## Обновление этого файла

Когда состояние меняется (новая ветка, merge в main, смена приоритета) — обновляй секции «Ветки» и «Что в `dev` сделано» в том же коммите. Не превращай в журнал — это снимок «сейчас», не история.
