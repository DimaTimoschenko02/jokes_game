# AI Model Switch, Timeouts & Prompt-Starters

## Problem

1. **WizardLM-13B** runs on CPU at ~6 tok/s, every AI call exceeds the 4.5–6s timeout. The bot always falls back to a single hardcoded punchline.
2. The model is English-only — it ignores Russian language instructions.
3. Prompt generation is synchronous and blocks game start with the same timeout issue.

## Decision Summary

| Area | Before | After |
|---|---|---|
| Chat model | `hf.co/TheBloke/WizardLM-13B-Uncensored-GGUF:Q4_K_M` (13B, English) | `huihui_ai/qwen2.5-abliterate:1.5b` (1.5B, Russian, uncensored) |
| Bot answer timeout | 4.5s (game.service) / 6s (ai.service) | 90s both |
| Embedding timeout | 6s | 15s |
| Prompt source | AI generation at game start (blocks, always times out) | MongoDB collection with seed data + background AI generation |

## 1. Model Change

### Files changed

- `docker-compose.yml` — `OLLAMA_MODEL` env var on `api` service, and `model-pull` service entrypoint (curl body with model name)
- `ai.service.ts` — default `OLLAMA_MODEL` constant

### Details

Replace `hf.co/TheBloke/WizardLM-13B-Uncensored-GGUF:Q4_K_M` with `huihui_ai/qwen2.5-abliterate:1.5b` everywhere.

Model properties:
- 1.5B parameters, Q4_K_M quantization, ~986 MB
- ~30 tokens/sec on CPU — 80 tokens in ~3 seconds
- Native Russian language support
- Abliterated (safety filters removed) — suitable for adult humor

## 2. Timeout Changes

### Files changed

- `api/src/modules/ai/ai.service.ts` — `OLLAMA_TIMEOUT_MS`: 6000 → 90000
- `api/src/modules/game/game.service.ts` — `generateSafeBotAnswer` timeout: 4500 → 90000
- `api/src/modules/game/game.service.ts` — `generateSafePromptList` timeout: removed (prompts come from DB now)
- `api/src/modules/embedding/embedding.service.ts` — `EMBED_TIMEOUT_MS`: 6000 → 15000

### Rationale

The 90s timeout is a **ceiling for the AI service layer**, providing headroom for cold starts. In practice, the bot's effective deadline is `WRITING_PHASE_SECONDS` (45s) minus the artificial delay (1.5–5s), i.e. ~40–43s. When the phase timer fires, `startVotingPhase` transitions the room and the guard `if (room.phase !== 'writing') return` discards any late bot answer. This is acceptable — the 90s timeout prevents the AI service from holding resources longer than necessary while still allowing the full writing phase for generation.

The embedding timeout is raised to 15s to survive cold model loading.

## 3. Prompt-Starters Collection

### New MongoDB collection: `prompt-starters`

```typescript
interface PromptStarterDocument {
  text: string        // The unfinished joke opening
  usedCount: number   // How many times selected for a match
  createdAt: Date
}
```

Index: `{ usedCount: 1 }` for efficient sorting.

### Seed

On application startup (`OnModuleInit`), if the collection is empty, insert ~15 hardcoded prompts. The seed data consolidates existing `FALLBACK_PROMPTS` (from `ai.service.ts`) and `EXTENDED_LOCAL_PROMPTS` (from `game.service.ts`) into a single constant in the `prompt-starter` module. After migration, these constants are removed from their original locations. `AiService.generatePromptPair`, `createFallbackPromptList`, and `getAlternativePrompt` methods are also removed as they become unused. Each seed prompt starts with `usedCount: 0`.

### Selection algorithm (one MongoDB aggregation)

```javascript
db.promptStarters.aggregate([
  { $match: { text: { $nin: excludedTexts } } },  // filter out already-used this session
  { $sort: { usedCount: 1 } },
  { $limit: playerCount * playerCount },           // N²
  { $sample: { size: playerCount } }               // random N from least-used N²
])
```

After selection: increment `usedCount` for each selected document via `bulkWrite` with `$inc` (atomic increment, tolerant of low-probability concurrent races in a party game context).

Edge cases:
- Fewer than N² documents → `$limit` returns all, `$sample` picks from what exists
- Fewer than N documents → fill remainder from hardcoded fallback list
- `excludedTexts` (prompts used in prior rounds of the same session) are filtered via a `$match` stage with `$nin` on normalized text values, placed before `$sort` in the aggregation pipeline. This avoids fetching excluded documents and ensures the N² window only contains eligible prompts

### Background generation

After each match starts, fire-and-forget:
1. Call `AiService.generatePromptList(10, existingTexts)` with 90s timeout
2. For each result, check uniqueness via `normalizePromptIdentity` against all existing DB entries
3. Insert unique prompts with `usedCount: 0`
4. If AI times out or fails — nothing breaks, DB just doesn't grow this round

### New code

- `api/src/modules/prompt-starter/` — new module
  - `prompt-starter.schema.ts` — Mongoose schema
  - `prompt-starter.repository.ts` — aggregation query, insert, seed
  - `prompt-starter.service.ts` — `selectPrompts(count, excludedTexts)`, `generateAndStoreInBackground(count)`, seed on init
  - `prompt-starter.module.ts` — imports MongooseModule, AiModule; exports service

### Module dependency graph (updated)

`GameModule` → `AiModule` (bot answers) + `PromptStarterModule` (prompt selection)
`PromptStarterModule` → `AiModule` (background generation)
`AiModule` → `JokeMemoryModule` → `EmbeddingModule`

## 4. Game Flow Change

### Before

```
startWritingPhase
  → generateSafePromptList(count, excluded)  // AI call, 4.5s timeout
  → always falls back to EXTENDED_LOCAL_PROMPTS
  → generateBotAnswers (AI, 4.5s timeout → always fallback)
```

### After

```
startWritingPhase
  → promptStarterService.selectPrompts(count, excluded)  // MongoDB, instant
  → fallback to hardcoded list only if DB is empty
  → generateBotAnswers (AI, 90s timeout → usually succeeds with new model)
  → promptStarterService.generateAndStoreInBackground(10)  // fire-and-forget
```

### Files changed

- `api/src/modules/game/game.service.ts` — replace `generateSafePromptList` call with `promptStarterService.selectPrompts`, add background generation call, remove `generateSafePromptList` and `buildLocalFallbackPromptList` methods
- `api/src/modules/game/game.module.ts` — import `PromptStarterModule`

## 5. What stays the same

- `JokeMemoryModule` — unchanged, still stores jokes with ratings for few-shot retrieval
- `EmbeddingService` — unchanged except timeout bump
- Bot answer generation flow — unchanged except timeout bump
- Prompt templates — unchanged (they work, just need a Russian-capable model)
- Frontend — no changes needed
- `usedPromptTexts` tracking per room — stays, used as `excludedTexts` parameter
