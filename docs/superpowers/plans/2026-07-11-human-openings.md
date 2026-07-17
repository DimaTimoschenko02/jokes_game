# Human Openings — режим «люди пишут начала»

Дата: 2026-07-11. Статус: РЕАЛИЗОВАНО И ЗАДЕПЛОЕНО 2026-07-17 (merge `bad9edb` в main). Откат: `git revert -m 1 bad9edb`.

## Решения (зафиксированы с Dima)

1. **Режим выбирается хостом при создании комнаты** — селект на фронте: `ai` (дефолт, как сейчас) или `human` (люди пишут начала). Никаких изменений поведения в `ai`-режиме.
2. Фаза написания начал — **с первого раунда, каждый раунд** (разгружаем AI-генерацию).
3. Таймер фазы — **60 секунд**. Ожидание: пишут все (играют в Discord, зависший — исключение, не норма).
4. Человеческие начала **сохраняются в `prompt_starters`** с фидбеком 👍👎 и участвуют в golden-цикле — бесплатный датасет.
5. Раздача **рандомная**, боты тоже могут получить человеческие начала. Жёсткое правило: **автор не получает своё начало**.
6. Автор начала **скрыт** до vote reveal, раскрывается вместе с автором панчлайнов.

## Механика раунда (mode=human)

Игроков N (люди H + боты B). Нужно N опенингов на раунд, каждый идёт ровно 2 игрокам (дуэль).

1. Начало раунда → фаза `opening-writing` (60с). Каждый человек пишет ровно 1 начало.
2. Фаза завершается досрочно когда все H отправили, иначе по таймеру.
3. Top-up: AI догенеривает `N − (сколько людей реально отправили)` начал обычным пайплайном (persistent session, few-shot, embedding-дедуп). Не отправил — AI пишет «за него». Все люди зависли → полный AI, режим деградирует в дефолтный без падения.
4. Раздача: перемешиваем пул из N начал, circular assignment `player[i] → openings[i, (i+1)%N]` поверх случайной перестановки игроков/опенингов; **ретраим перестановку пока ни один автор не получает своё начало** (N≥3 всегда разрешимо, ретраи копеечные).
5. Дальше — обычные writing / voting / rating.

## Изменения по слоям

### DB (drizzle, миграция 0008)

- `prompt_starters` + колонки:
  - `source text NOT NULL DEFAULT 'ai'` (`'ai' | 'human'`)
  - `author_user_id text` (nullable, только для human)
- `npm run db:generate` (снапшот!), проверить что не дублирует прошлые колонки (грабля 0006/0007).

### API

- `game.constants.ts`: `OPENING_WRITING_PHASE_SECONDS = 60`.
- `game-phase.type.ts`: + `'opening-writing'`.
- `GameRoom`: + `openingsMode: 'ai' | 'human'`, + `humanOpenings: Map<playerId, string>` (сброс в `restartGame`!), + `openingAuthors: Map<openingIndex, playerId>` (для reveal и «не своё»).
- `CreateRoomDto`: + `openingsMode` (`@IsIn(['ai','human'])`, дефолт `'ai'`). Прокинуть через `createRoom` → `GameRoom`.
- Gateway: + `@SubscribeMessage('submitOpening')` → `SubmitOpeningDto { roomCode, text }`. Валидация: trim, длина 6–200 (границы как у `OPENINGS_ARRAY_SCHEMA`).
- `game.service.ts`:
  - `startWritingPhase` в human-режиме сначала идёт в `startOpeningWritingPhase(room)`: phase='opening-writing', таймер 60с → `finishOpeningWriting`.
  - `submitOpening`: upsert в `humanOpenings` (редактируемо до конца фазы, как ответы), досрочное завершение когда все люди сдали.
  - `finishOpeningWriting`: top-up через `generateOpeningsForRound` (needed = N − submitted; человеческие тексты добавить в exclusion пул + `usedPromptTexts`), собрать пул, раздать с constraint, → writing phase.
  - ВАЖНО: prefetch следующего раунда (`prefetchNextRoundOpenings`) в human-режиме генерит только AI-долю; человеческая часть следующего раунда неизвестна заранее → prefetch генерит запас `N − H` (остальное доберём если люди не сдадут). Если люди сдали больше чем ожидалось — лишние AI-начала просто остаются в exclusion-пуле, не показываются.
  - Reveal: в payload дуэли + `openingAuthorPlayerId` (null для AI). Отдавать клиенту только после закрытия дуэли (как имена авторов панчлайнов).
  - Персист: в конце раунда сохранить человеческие начала в `prompt_starters` (`source='human'`, `author_user_id`), фидбек 👍👎 уже работает по индексам опенингов — проверить что маппинг индексов не ломается.
  - `restartGame`: сбросить `humanOpenings`, `openingAuthors`.
- Golden-цикл: `evaluateAndSaveGoldenOpenings` — человеческие начала проходят на общих основаниях (они уже в prompt_starters, апдейт по тексту).

### Web

- Создание комнаты: сегмент-селект «Начала пишет: ИИ / Игроки» рядом с выбором раундов/ботов; прокинуть `openingsMode` в `CreateRoomPayload`. Показать выбранный режим в лобби всем.
- Новая фаза `opening-writing`: заголовок «Придумай начало шутки», один textarea, подсказка (незаконченное предложение, обрыв на союзе/тире), кнопка Отправить с re-edit как у панчлайнов (dirty-state), таймер 60 в `PHASE_TIMER_SECONDS`.
- Reveal: в блоке дуэли после голосования показать «начало: <имя>» для human-опенингов.
- `GamePhase` client type + `openingsMode` в `ClientGameState`.

### e2e

- `e2e/play-smoke.mjs`: дефолтный режим не трогаем — смоук должен пройти без правок. Добавить опциональный прогон human-режима (env `SMOKE_MODE=human`): detectPhase + `['opening-writing', heading]`, doOpeningWriting() пишет строку «Тестовое начало про X, но».

## Порядок реализации (коммиты)

1. Миграция 0008 + схема + репозиторий prompt-starter (source/author).
2. Types + constants + DTO + `openingsMode` прокидка (API постоянно зелёный, режим ещё не активен).
3. Фаза opening-writing на бэке: submitOpening, finishOpeningWriting, раздача с constraint, top-up. Unit-подобный тест на раздачу (автор ≠ получатель) хотя бы скриптом.
4. Reveal автора + персист + golden-интеграция.
5. Web: селект режима + экран фазы + reveal.
6. e2e human-режим, прогон, деплой отдельным merge в main.

## Rollback

Фича едет **одним merge-коммитом** `dev` → `main`. Откат: `git revert -m 1 <merge-sha>` на main + push → автодеплой. Миграция 0008 остаётся в БД (колонки безвредны для старого кода). В `ai`-режиме поведение не отличается от текущего — «мягкий откат» это просто не выбирать human-режим.

## Открытое (решить по ходу)

- Показывать ли игроку в rating-фазе, что шутка была на его начало (мелкий UX).
- Стоит ли human-началам сразу яркий бейдж в админке (фильтр по source).
