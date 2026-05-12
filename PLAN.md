# План v2 — генерация шуток и начал, обучение, память

> Документ описывает целевую логику. Без кода и точных текстов промптов — это уровнем выше.

---

## Часть 1. Схемы данных

### 1.1 User Profile (новая сущность)

```
user {
  userId            UUID, primary key
  login             уникальный, выбирается при регистрации
  passwordHash      bcrypt

  displayName       никнейм в игре (можно менять)
  gender            male | female | non-binary | not-specified
  ageBand           under-20 | 20-25 | 25-30 | 30-35 | 35-plus | not-specified
  declaredBio       free text, до 300 символов

  createdAt
  lastSeenAt
}
```

Регистрация login + password обязательна для накопления памяти между играми. localStorage оставить как fallback для гостей, но память им не пишется.

### 1.2 User Memory (новая сущность, 1:1 с user)

```
user_memory {
  userId                    FK на user

  confirmedFacts {
    themes: [               что подтверждено declaredBio + voting patterns
      { theme, confidence, mentions, source: "declared" | "derived" }
    ]
    voterPreferences {      что апвоутит как голосующий
      darkPreference
      callbackPreference
      absurdPreference
      ironyPreference
    }
    authorStyle {           как пишет сам
      avgPunchlineLength
      preferredStructures: [...]
    }
  }

  jokeTargets [             про что про него шутят (отдельно от facts!)
    { theme, frequency, lastSeenRound }
  ]

  portrait                  free-form 3-5 предложений, обновляется агентом

  lastUpdatedAt
  updatedAfterRoundsCount   счётчик для batching
}
```

Принципиально: `confirmedFacts` и `jokeTargets` разнесены. Никогда не объединять.
Сейчас в промптах используются только `confirmedFacts` + `portrait`. Остальное копится для будущих фич.

### 1.3 Prompt Starter — расширение существующей

Добавить поля:

- `userQuickFeedback` — `{ up, down, broken }` агрегаты по 3-кнопочному фидбеку
- `adminScore` — 1-5, null если не оценено
- `adminScoredBy`, `adminScoredAt`
- `adminFlags` — `["broken", "narrow", "lazy-pivot", ...]`
- `derivedScore` — авто-расчёт по производным панчлайнам (avg rating всех шуток на этом opening'е)
- `usedAsExampleCount` — для anti-repetition
- `lastUsedAsExampleAt`

### 1.4 Joke Memory — расширение существующей

Добавить:

- `adminScore` 1-10, null если нет
- `adminScoredBy`, `adminScoredAt`
- `usedAsExampleCount`
- `lastUsedAsExampleAt`
- `authorUserId` — связь с user

Существующие `voteShare` и `ratingAverage` остаются, но переосмысливаются (см. Часть 9).

---

## Часть 2. Регистрация и идентификация

1. При первом входе игрок выбирает: войти / регистрация / играть гостем
2. Регистрация: login + password → создаётся `user` + пустая `user_memory`
3. Гость: localStorage UUID, профиль не сохраняется, память не пишется
4. В комнате игрок отображается по `displayName`, но всё хранится по `userId`
5. Logout не нужен в MVP

---

## Часть 3. Flow генерации опенингов

### 3.1 Cold start (первая игра компании)

1. Запросить у каждого игрока `declaredBio` (если ещё нет)
2. На случай недоступности Claude — **10 hand-picked bootstrap openings** в коде (не БД)
3. Иначе — сразу к 3.2

### 3.2 Steady state

1. Собрать контекст:
   - `playerNames` всех игроков комнаты
   - `confirmedFacts` каждого (themes, gender) + `declaredBio`
   - `goldenExamples` — топ-N openings по ранжированию из 3.3
   - `negativeExamples` — opening'и с `adminScore <= 2` ИЛИ `userQuickFeedback.down > up` (флаг "what NOT to write")
   - `excludedOpenings` — уже использованные в этой игре (есть)

2. **Stage 1 — generation:** Claude генерит `needed * 2` кандидатов.
   - Имена и темы каждого игрока (из confirmedFacts)
   - Golden examples — «стремись к этому уровню»
   - Negative examples — «избегай таких паттернов»
   - Excluded — «не повторяй»
   - **Без явного darkness параметра.** Тон задаётся через состав примеров.

3. **Stage 2 — judge:** другой системный промпт оценивает кандидатов по критериям:
   - vivid scene
   - открытый pivot
   - 5+ возможных панчлайнов
   - оригинальность относительно других выбранных
   - персонализация (имя + тема использованы уместно)

   Возвращает топ-`needed`.

4. **Anti-repetition при выборе golden examples:**
   - Применить MMR + штраф за `usedAsExampleCount` (см. Часть 5)
   - После stage 2 проверить semantic similarity новых openings с теми что уже есть в `prompt_starter` (BGE-M3, threshold ~0.85). Слишком похожие — отбросить, перегенерить.

### 3.3 Ранжирование golden openings для few-shot

```
example_score =
    coalesce(adminScore_normalized, derivedScore_normalized)
  + (userQuickFeedback.up - userQuickFeedback.down) * weight
  - usedAsExampleCount * decay
  + recency_bonus
```

`derivedScore` = средний rating всех панчлайнов на этом opening'е, нормализованный к 0-1.

### 3.4 Что добавляется в system prompt opening-генератора

Competitive framing:
> Эти opening'и — основа дуэли. Хороший opening — тот, на который игрок захочет потратить креатив, а не отстреляется банальностью. Скучный setup = скучная дуэль. Цель: вызвать у игрока «о, это можно крутить» немедленно.

(Точный текст пишется в локальной сессии.)

---

## Часть 4. Flow генерации панчлайнов

### 4.1 Контекст бота

Каждый бот в комнате имеет свой **personality preset**. Для 2 ботов — 2 разных system prompt'а:

- Bot 1: циник, короткий, сухой панчлайн
- Bot 2: absurd-сюрреалист, неожиданные образы

Точные тексты — позже, рукой. Стили (`sarcastic | dark | absurd`) рандомом — удалены.

### 4.2 Memory retrieval — что подаётся как few-shot

Алгоритм:

1. Embed текущий opening через BGE-M3
2. **Pre-filter** в Mongo: одним запросом достать candidate set
   - Положительные: `(adminScore >= 7) OR (ratingAverage >= 7 AND ratingCount >= 2)`
   - Отрицательные (отдельный запрос): `(adminScore <= 3) OR (ratingAverage <= 4 AND ratingCount >= 2)`
3. На полученных кандидатах считать cosine similarity к текущему opening'у
4. **MMR-выборка:**
   - Из положительных — 5-6 примеров, MMR с λ≈0.5
   - Из отрицательных — 2-3 примера, MMR
5. **Penalty за переиспользование:** при ранжировании multiply на `1 / (1 + log(1 + usedAsExampleCount))`. После использования — инкремент counter.
6. **Лимит 600 убираем**, пул — все записи. Pre-filter держит запрос быстрым.

### 4.3 Two-stage generation

**Stage 1 — generate (effort=medium, бот-personality system prompt):**

- В user-prompt: opening, имена игроков, краткие profile (gender для грамматики + 1-2 темы из confirmedFacts), positive few-shot (5-6), negative few-shot (2-3) с пометкой «AVOID»
- Возвращает 5 кандидатов разной направленности

**Stage 2 — judge (effort=medium, judge system prompt):**

- «Ты зритель, голосующий за лучшую шутку из двух. Выбери из 5 кандидатов тот, за который реально проголосовал бы»
- Возвращает один winning punchline

### 4.4 System prompt бота — обязательно добавить mandate на победу:

> Это игра на голоса. Твой панчлайн соревнуется с панчлайном другого игрока на тот же setup. Аудитория голосует — твоя задача собрать БОЛЬШЕ голосов. Безопасная шутка = проигрыш. Если выбираешь между «вежливо смешно» и «наглый, рисковый» — выбирай второе. Компания старых друзей, всё дозволено, ничего святого. Не извиняйся, не предупреждай, не модерируй сам себя. Цель — реакция, а не одобрение.

(Точный текст — в локальной сессии. Суть зафиксирована.)

### 4.5 Что удаляем из текущего флоу

- `darknessLevel` — из всех типов, промптов, генерации
- `styleTag` (sarcastic/dark/absurd random) — целиком
- `FALLBACK_PUNCHLINES` — сократить до 3 шт

---

## Часть 5. Память — обновление

### 5.1 Когда

После rating phase раунда, async в фоне (пока scoreboard и переход в следующий раунд). НЕ блокирует UX.

### 5.2 Что делает агент-апдейтер

Для каждого игрока в комнате (параллельные вызовы Claude):

1. Берёт текущий `user_memory.portrait` + последние N апдейтов
2. На вход: все шутки игрока этого раунда + все голоса/rating'и игрока + все шутки про него (по имени в тексте)
3. Возвращает дельты:
   - `confirmedFacts.themes` — что добавить / усилить confidence
   - `voterPreferences` — обновить веса
   - `authorStyle` — обновить статистики
   - `jokeTargets` — добавить темы шуток про него
   - Новый `portrait` (полный текст, перезапись)
4. Сервер мерджит дельты, инкрементит `updatedAfterRoundsCount`

### 5.3 Защита от галлюцинаций

System prompt агента (суть):
> Обновляй только то что явно подтверждено в данных. Не предполагай характер по одной шутке. Confidence растёт медленно — тема становится stable после 3+ упоминаний. Не записывай содержание шуток как факты — для этого есть отдельное поле `jokeTargets`.

### 5.4 Использование памяти на текущем этапе

| Поле | Используется сейчас | На будущее |
|---|---|---|
| `confirmedFacts.themes` | да, в opening generator | — |
| `gender` | да, в bot punchline (грамматика) | — |
| `declaredBio` | да, во всех AI промптах | — |
| `voterPreferences` | нет | audience-aware промпты |
| `authorStyle` | нет | matchmaking bot ↔ human |
| `jokeTargets` | нет | фича callback'ов |
| `portrait` | да, в opening generator как мягкий контекст | — |

---

## Часть 6. In-game UI изменения

### 6.1 Writing phase

- Под каждым из 2 опенингов игрока — 3 кнопки: 👍 / 👎 / 🤢
- Кнопки optional, click = немедленный POST, не блокирует ввод панчлайна
- После клика кнопка остаётся выделенной, можно переключить
- Эти клики идут в `prompt_starter.userQuickFeedback`

### 6.2 Rating phase

Без изменений — уже работает 1-10 на шутки.

### 6.3 Scoreboard

Без изменений в MVP. (Можно потом добавить inline rating опенингов для энтузиастов.)

### 6.4 Регистрация / профиль

- Экран входа: login / register / guest
- В профиле: gender, ageBand, bio — все опциональны, но bio настоятельно рекомендуется

---

## Часть 7. Admin UI

Все страницы под `/admin`, защита уже есть.

### 7.1 Opening review

- Список всех `prompt_starter` с фильтрами (по дате, по `adminScore is null`, по `userQuickFeedback.down > 0`)
- На каждой записи: текст, сводка `userQuickFeedback`, `derivedScore`, список панчлайнов на ней с их рейтингами
- Действия: проставить `adminScore` 1-5, флаги, заметка. Переписывает поверх предыдущего админа.

### 7.2 Joke review

- Аналогично для `joke_memory`
- Поля: opening + punchline + контекст (rating от игроков, voteShare)
- `adminScore` 1-10 (соответствует юзерскому rating'у)

### 7.3 User memory viewer / editor

- Список users
- На каждом: profile, `confirmedFacts` (с возможностью редактировать вручную), `portrait`, `jokeTargets` (read-only)
- Кнопка «force regenerate portrait» — запустить агента вручную

### 7.4 Bootstrap openings

- Список 10 hardcoded fallback openings в отдельной коллекции `bootstrap_openings` (не `prompt_starter`)
- Возможность отредактировать тексты

---

## Часть 8. Что удаляется из текущего кода

1. `darknessLevel` параметр везде (типы, промпты, генерация)
2. `styleTag` (sarcastic / dark / absurd) random выбор — целиком
3. 48 seed prompts из БД — заменяем на 10 hardcoded bootstrap в коде
4. Лимит 600 в `JokeMemoryService.RECENT_POOL_SIZE` — всё извлекаем pre-filter'ом
5. `FALLBACK_PUNCHLINES` — сократить до 3
6. Старый `qualityScore` (60/40) — переделать (см. Часть 9)

---

## Часть 9. Скоринг для retrieval

```
useScore =
    primary_quality        × 0.6
  + competitive_signal     × 0.2
  + freshness              × 0.1
  + diversity_bonus        × 0.1
  − repetition_penalty
```

Где:

- `primary_quality` = `coalesce(adminScore/10, bayesian_user_rating)`.
  Bayesian: `(ratingSum + prior_mean * prior_weight) / (ratingCount + prior_weight)`, `prior_mean=5.5`, `prior_weight=3`.
- `competitive_signal` = Wilson lower bound 95% от `(votesFor, votesAgainst)` — используется ТОЛЬКО когда `ratingCount < 3`. Когда ratings есть — игнорируется (rating даёт более качественный сигнал).
- `freshness` = decay по `createdAt`, half-life ~2 недели
- `diversity_bonus` — считается в MMR, не на записи
- `repetition_penalty` = `1 / (1 + log(1 + usedAsExampleCount))`, multiplier

Применяется и для positive, и для negative pool (negative = инверсия `primary_quality`).

Вес ботовских и людских шуток в памяти **идентичный** — источник не важен, важен сигнал качества (rating + admin).

---

## Часть 10. Промпты — что добавить (тексты пишутся в локальной сессии)

1. **Bot system prompt** — competitive mandate (см. 4.4)
2. **Bot 1 / Bot 2 personality differences** — короткая разница в характере
3. **Opening generator system prompt** — competitive framing (см. 3.4)
4. **Judge system prompts** (2 шт — для openings и punchlines) — критерии оценки
5. **Memory updater system prompt** — guard rails от галлюцинаций (см. 5.3)

---

## Часть 11. Отложенные решения / known limitations

1. **Vector storage:** остаёмся на Mongo с linear scan + pre-filter. Миграция на pgvector / Qdrant — когда упрёмся в latency (ориентировочно 30k+ шуток без vector index).
2. **`voterPreferences`, `authorStyle`, `jokeTargets`** — собираются с первого раунда, используются позже
3. **Bot personality** — детальные тексты пишем после первой игры с базовыми промптами
4. **Style tags** — удалены, но если окажется нужен явный регистр — добавим auto-detected per-opening tag
5. **Audience-aware generation** — отложено, требует накопленный `voterPreferences`
6. **Per-player targeted opening generation** — отложено, требует накопленный `confirmedFacts`

---

## Резюме принципов

- **Цель бота — побеждать в голосовании.** Это явно в промпте.
- **Сигнал качества — rating (1-10), не vote share в дуэли.** Дуэль шумная при малых выборках.
- **Контраст важнее повторения.** Negative few-shot обязателен.
- **Diversity > top-N.** MMR при выборе примеров.
- **Память разделена на confirmed / joke-targets.** Не смешивать.
- **Меньше параметров — меньше шума.** Darkness и style random удалены.
- **Личность бота через personality prompt, не random.** 2 бота — 2 голоса.
