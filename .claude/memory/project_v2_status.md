---
name: v2-status
description: "Снимок текущего состояния punchme. Что задеплоено, что верифицировано в живой игре, что осталось. Обновлять после каждой игры/сессии работы."
metadata:
  node_type: memory
  type: project
  originSessionId: b711b77b-838b-4db8-a634-bce03b5fbfc4
---

# V2 Status — group memory реализована (ветка feat/group-memory)

## Сессия 2026-07-11 (часть 2) — ВСЁ ЗАДЕПЛОЕНО В ПРОД

- `main` = prod = `2cac0af`. Два деплоя: (1) merge dev→main — group memory + scoring + промпт-аудит; (2) фиксы UX: кнопка «Сыграть ещё раз» (restartGame, host, finished→lobby, состав сохраняется), редактируемые ответы после submit, writing 360→180с, scoreboard-фаза удалена (rating → сразу след. раунд/finished).
- Group memory защищена: getPromptBlock при старте игры в try/catch (не блокирует старт), finalize fire-and-forget. НЕ проверена в живой игре — сегодняшняя игра = плейтест.
- **Откат деплоя:** `git revert` нужного коммита на main + push → автодеплой. Фиксы = `2cac0af`, большой merge = `821b926` (revert -m 1).
- **Следующее: фича human openings** — план утверждён, лежит в `docs/superpowers/plans/2026-07-11-human-openings.md`. ЧИТАТЬ ПЛАН перед реализацией. После неё — баг 3.5 (у некоторых игроков после 1-го раунда нет кнопок голосования; отложен намеренно).

## Сессия 2026-07-11 (часть 1) — аудит бот-шуток + промпт-фиксы (dev, коммит `37e6d60`)

Аудит игры 10 июля (комнаты 45EHK/EQFX4): 26 бот-шуток с admin-оценками, медиана 4-5/10 — **бот стал узким местом** (опенинги 6-8). Сделано:
- **Bot prompt v2:** 4 теста качества из реальных провалов («И ЧТО?» — панчлайн-констатация без события; Бред vs Абсурд; внутренняя логика — «откуда известно?»; одна деталь — вторая разбавляет), калибровка дерзости («размахивал хуем смешнее хот-вилса»), локальная тема ≠ волшебное слово, персональное = чит-код (обе шутки 8-9 были персональными).
- **Bot model:** явный `claude-sonnet-5` (алиас `sonnet` на prod CLI = 4.6!), effort low→high, fallback 'sonnet'.
- **Персоны ботов:** `BOT_PERSONAS` (roaster = тёмный персональщик / absurdist) — блок доклеивается к system prompt, ротация по index+random offset в `prewarmBotSessions`. НЕ проверено в живой игре.
- **Opening prompt:** Тест 7 «обрыв на такт раньше» (главный паттерн admin-комментов 11 июля: хвост типа «его вынесли оттуда за» предопределяет продолжение) + длина ужата до 6-10 слов.
- **Runner:** auth-файлы копируются в isolated HOME при каждом spawn (см. [[model-quirks]]).

Не задеплоено (dev не смержен в main). Плейтест покажет: качество панчлайнов, различимость персон, скорость sonnet-5/high в 45s фазе письма.

## Где код

- **`main` = prod** на коммите `3b4c911` (2026-05-29: cherry-pick reveal-фичи из dev на прод — см. ниже).
  - **2026-05-29:** на прод вынесен **vote reveal** (6с пауза после общего голосования + раскрытие имён авторов) cherry-pick'ом коммитов `1490366` + `c9be5e1` на ветке `fix/voting-reveal-prod` → ff-merge в `main` → деплой success. Вместе с reveal поехали 3 безопасных багфикса из того же коммита `1490366`: zombie session, host-exit cancel, AI output validation. Scoring (`ff2bd1e`) и group memory НЕ выносились — остались на `dev`. ВАЖНО: cherry-pick создал новые хэши (`726f339`,`3b4c911`) — при будущем мерже `dev`→`main` возможен (маловероятный) конфликт в `game.service.ts`/`game.constants.ts`.
  - Был до этого: `ebad56a` (opening prompt v2 + counter fix).
- История последних коммитов:
  - `ebad56a` — opening prompt rewrite с 6 тестами + fix usedAsExampleCount counter
  - `7b47857` — golden examples back to 10 + clarify feedback scale в continue prompt
  - `d6fe25b` — opus/high + medium examples 5/5/5 + soften repetition restrictions
  - `9591462` — UX fixes + golden double-click votes
- Push в `main` → GitHub Actions → `/home/qwe/apps/punchme/deploy.sh` на bestsrv (см. [[prod-server-monitoring]]).
- **Активная ветка `dev`** (не смержена в main) — интеграционная: `feat/group-memory` + voting-scoring.
  - `feat/group-memory`: коммит `1490366` — фиксы #41-45 (zombie session, AI output validation, host-exit cancel, vote reveal); `c69200f..9fce01a` — фича group memory (12 задач). Финальное ревью без Critical/Important.
  - `dev` поверх неё: `e274a24` план + `c9be5e1` reveal 5→6с + `ff2bd1e` раунд-зависимый вес голоса (см. секцию E).
  - Билды api+web зелёные. Гейтит merge в main — ручная верификация group memory (см. секцию D).

## Верифицировано в живой игре (вторая prod-игра, room ANMJS, 3 раунда)

- ✅ **Opus/high работает** на opening-generator. Тайминги: start 218s, resume 1 — 125s, resume 2 — 14s. cost: $0.39 / $0.29 / $0.17 за раунд. Уложилось в timeout 240s впритык.
- ✅ Все 18/18 кандидатов проходят `filter_history` без дублей по embeddings.
- ✅ `golden_injected` стабильно работает: round1=2, round2=1, round3=2 голден-войтов.
- ✅ `items_rated=10/12, 11/12, 12/12` — auto-flush рейтингов держит покрытие.
- ✅ Memory-updater отрабатывает (но контент всё ещё неверный — см. C ниже).
- ⚠️ **Качество опенингов всё ещё не идеал.** По фидбеку юзера 1-й раунд лучше последующих (но НЕ критически как в прошлый раз). Анализ через admin comments выявил 6 паттернов (см. ниже).

## Сделано в этой сессии (коммиты `d6fe25b` → `ebad56a`)

### Opening-generator: модель + примеры + промпт
- **model: sonnet → opus, effort: low → high, timeoutMs 120s → 240s.**
- Few-shot: было 10 golden + 5 negative, стало **10 golden + 5 medium + 5 negative** (medium — новая категория, feedback_score между -0.5 и +0.5).
- В continue prompt разъяснена шкала feedback: 👍0 ≠ плохо (модель раньше воспринимала это как провал и избегала похожих тем).
- Continue prompt: явно подталкивает «повтори рабочий тип setup'а с новой темой» вместо «не повторяй ничего».

### Opening-generator: системный промпт v2 (6 тестов качества)
На основе анализа prod-данных (10 опенингов + 22 шутки с admin-комментариями) выявлены 6 паттернов которых не было в промпте. Каждый теперь оформлен явным тестом с ✗/✓ примерами из реальной БД:

1. **Тест допуска** — продолжение НЕ должно вытекать из setup'а («Тася проиграла спор и обязана» = плохо, продолжение диктуется структурой).
2. **Тест необычности контекста** — бытовуха не годится, сцена должна быть тёмной/абсурдной/специфичной.
3. **Тест функциональности слов** — каждое слово несёт функцию. «тихо гуглил» — «тихо» лишнее.
4. **Бред vs Абсурд** — критическое различие. Бред = «при чём тут X», абсурд = «нихуя себе».
5. **Деталь-катализатор** — одно слово меняющее тон («полиция нашла коллекцию» vs «была коллекция»).
6. **Двусмысленность** — два прочтения которые игрок может развернуть в любую сторону.

Также: **локальная актуальность** (ТЦК, FPV, ВСУ, мобилизация, локальные мемы) поднята с «допустимо» до **«сильный сигнал плюс»** в шапке промпта.

### Counter fix: usedAsExampleCount
**Был баг.** Поле `used_as_example_count` для `prompt_starters` есть в схеме + admin UI + индексе, но **никогда не апдейтилось в коде**. Теперь:
- Добавлен `repository.incrementUsedAsExampleCount(ids)` + апдейт `lastUsedAsExampleAt = NOW()`.
- `findLowRatedOpenings` / `findMediumRatedOpenings` теперь возвращают `id` (для трекинга).
- В сервисе fire-and-forget инкремент через `trackExampleUsage` после каждого `getGoldenExamplesDetailed` / `getMediumOpeningExamples` / `getNegativeOpeningExamples`.

В админке теперь будет видно сколько раз каждый опенинг подавался как пример агенту.

## Известные ранее, всё ещё актуальны

### Все 3 агента (opening-generator, bot, memory-updater)
- Все спавнятся в **isolated HOME** (`$TEMP/punchme-claude-home`). На проде no-op т.к. там нет глобального CLAUDE.md под qwe.
- **bot-agent** = sonnet + effort low (не меняли).
- **opening-generator** = **opus + effort high** (после правок в этой сессии).
- **memory-updater** = sonnet + json-schema + effort low.
- **Opening-generator НЕ использует `--json-schema`** (Anthropic API не принимает array на root).
- Retry для `start` mode генерит новый sessionId на каждой попытке.

### Game flow
- 4-уровневая оценка опенингов (`-1/-0.5/+0.5/+1`) → `feedback_sum + feedback_count`.
- Bot CoT убран. Боты НЕ голосуют в дуэлях.
- Goldens (double-click) → `goldenVoters` Set → `injectGoldenRatings` ставит `rating=10` ДО агрегации.
- Авто-добавление бота при нечётном числе игроков.

### Админка
- `/admin` — JWT + role=admin. `dimon` → admin авто в миграции 0004.
- Full CRUD для prompts и jokes. ScoreScale 1-10 (общий компонент с rating phase).
- Чекбоксы Golden + Fallback в форме создания/редактирования.
- Test rooms: чекбокс в lobby (admin only) → ничего в БД не пишется.
- `used` counter растёт только когда опенинг идёт как fallback (AI не отработал). При нормальной работе AI — `used=0`, это норма.
- `used_as_example_count` теперь апдейтится после правок в этой сессии.

### Curated seeds
- Миграция 0005 — 4 опенинга + 7 шуток с ON CONFLICT DO NOTHING.
- Миграция 0006 — `is_fallback` boolean. Старые 148 SEED_PROMPTS удалены, fallback из БД через `findRandomFallback()`.

## Что дальше — приоритеты (после компакта)

### E. Voting reveal + round-based scoring — СДЕЛАНО (ветка `dev`)

План: `docs/superpowers/plans/2026-05-22-voting-scoring.md`. Реализовано:
- **reveal-пауза 5→6с** (`VOTING_REVEAL_SECONDS`, коммит `c9be5e1`).
- **Раунд-зависимый вес голоса** 100/150/200/300 (`ROUND_VOTE_WEIGHTS`), коммит `ff2bd1e`. `computeDuelPoints` в `game.service.ts`: каждый проголосовавший приносит автору `вес`; вес воздержавшихся (эл. избиратели минус проголосовавшие) делится между авторами пропорционально голосам (`leftAbstainShare = round(pool×leftVotes/votedCount)`, остаток — правому). Дуэль 0:0 → оба автора 0 (пул сгорает). `addScoreToWinners` переименован в `addScore`.
- Пункт «видеть авторов/голоса после своего голоса» — уже был в #41-45, кода не требовал.

**НЕ сделано — ручной плейтест:** проверить прирост score по раундам, распределение воздержавшихся, reveal 6с. Чеклист — в конце плана.

### C. Memory-updater → накопительный портрет
**Симптом:** портрет юзера = пересказ конкретной игры («написал 2 шутки, обе попали в дуэли»). После 10 игр будет невозможно использовать. Числовые предпочтения (darkPreference/ironyPreference) застряли на 0.5.

**Желаемый формат (обсудить финально):**
- Стиль шуток (длина, тон, темы)
- Сильные стороны
- Слабые стороны
- Числовые предпочтения **двигаются** от реальных оценок, не статичный 50%
- Накопительно: каждая игра обновляет delta, не переписывает портрет

**How to apply:** brainstorming с юзером про формат → схема → правка промпта и Zod-схемы в `api/src/modules/agents/configs/memory-updater-agent.config.ts`.

### D. Group memory — СДЕЛАНО (ветка `feat/group-memory`, не смержено)

Реализовано 12 задач по плану `docs/superpowers/plans/2026-05-21-group-memory.md` (спека — `docs/superpowers/specs/2026-05-21-group-memory-design.md`). Финальное ревью (opus) — без Critical/Important.

**Что построено:**
- Таблица `group_memory` (один глобальный ряд `id='global'`, ленивый сид репозиторием) + `users.test_account`. Миграция `0007`.
- Архитектура: НЕ отдельный агент. Расширен `memory-updater` — finalize-вызов в конце игры (`continue` на той же сессии) возвращает `groupMemoryDelta`. Backend мерджит дельты детерминированно (`GroupMemoryService`, транзакция + `FOR UPDATE`).
- Поля: themes / inJokes / triggers / avoidedThemes / setupPatterns + `summaryText`. Структура — каждую игру; `summaryText` — раз в 3 игры (лениво).
- Тест-игры исключены: `collectData=false` или есть игрок с `test_account=true` → finalize не зовётся (`countsForGroupMemory`).
- Блок памяти кормит И opening-generator, И bot-agent (при старте их сессий). Killswitch `memoryEnabled` (админ-тогл, накопление продолжается) + вкладка «Память компании» в админке.

**НЕ сделано — ручное, гейтит merge:**
- Миграция `0007` на реальной БД не гонялась (применится сама при старте API).
- Разовый SQL пометки `test_account` для тест-аккаунтов — нужно подтверждение Dima по списку логинов.
- Боевой плейтест: `group_memory_finalize_ok` в логах, заполнение в админке, проверка killswitch и summary после 3-й игры.

**Граблю поймали:** `0006_fallback_flag.sql` был написан руками без обновления drizzle-снапшота → `generate` для `0007` повторно добавил `is_fallback`; дубль убран из `0007.sql` руками (снапшот 0007 корректен, будущие `generate` самозалечатся).

### B. Качество опенингов (СНИЖЕН ПРИОРИТЕТ)
Существенно улучшено в этой сессии (opus/high + 6 тестов + medium examples). По фидбеку юзера разница между раундами теперь не критична. Возможно после следующей игры всплывут новые паттерны — тогда вернёмся.

### Отложено / запасные направления
- **Effort high → medium** на start opening-generator (одна строка, нужен a/b тест в игре).
- **Prefetch при создании комнаты** — снять 218с с критического пути, проблема в том что bio поздних игроков может не попасть. Требует UI «комната готовится».
- **bot-agent тоже получит «Бред vs Абсурд»** — большая часть плохих шуток это бред, не абсурд.
- **D. Internal error / Timeout** на главной странице без репро.

## Why этот файл

Снимок чтобы при возвращении к проекту сразу видеть актуальную позицию: что задеплоено, что верифицировано, что дальше.

## How to apply

- При возврате к проекту — читать ПЕРВЫМ.
- Если игра прошла — обновлять «Верифицировано» (что подтвердилось, что нет).
- Для мониторинга prod-игр — см. [[prod-server-monitoring]].
- Для общих граблей Claude CLI — см. [[model-quirks]].
- Аудитория и контекст игроков — см. [[audience-context]].
