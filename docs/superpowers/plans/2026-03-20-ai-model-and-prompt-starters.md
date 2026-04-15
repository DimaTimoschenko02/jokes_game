# AI Model Switch, Timeouts & Prompt-Starters — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch to a fast Russian-capable uncensored model, fix all timeouts, and replace synchronous prompt generation with a MongoDB-backed prompt-starters system featuring seed data and background AI generation.

**Architecture:** New `PromptStarterModule` with Mongoose schema, repository, and service. GameService delegates prompt selection to this module (instant DB read) and triggers background AI generation after each match start. Bot answer timeout raised to 90s to match the new model's capabilities.

**Tech Stack:** NestJS, Mongoose, MongoDB aggregation ($match/$sort/$limit/$sample), Ollama API

**Spec:** `docs/superpowers/specs/2026-03-20-ai-model-and-prompt-starters-design.md`

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `api/src/modules/prompt-starter/prompt-starter.module.ts` | Module definition, imports MongooseModule + AiModule |
| `api/src/modules/prompt-starter/schemas/prompt-starter.schema.ts` | Mongoose schema for `prompt_starters` collection |
| `api/src/modules/prompt-starter/prompt-starter.repository.ts` | MongoDB aggregation query, bulk insert, bulk usedCount increment |
| `api/src/modules/prompt-starter/prompt-starter.service.ts` | `selectPrompts()`, `generateAndStoreInBackground()`, seed on init |
| `api/src/modules/prompt-starter/constants/seed-prompts.constant.ts` | Hardcoded seed prompt list (~47 items from existing constants) |

### Modified files

| File | What changes |
|---|---|
| `docker-compose.yml` | Model name in `api` env and `model-pull` curl body |
| `api/src/modules/ai/ai.service.ts` | Default `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS`, remove `generatePromptPair`, `createFallbackPromptList`, `getAlternativePrompt`, `FALLBACK_PROMPTS` |
| `api/src/modules/embedding/embedding.service.ts` | `EMBED_TIMEOUT_MS`: 6000 → 15000 |
| `api/src/modules/game/game.service.ts` | Replace `generateSafePromptList` with `promptStarterService.selectPrompts`, remove `EXTENDED_LOCAL_PROMPTS`, `LOCAL_FALLBACK_PROMPTS`, `buildLocalFallbackPromptList`, update bot answer timeout to 90s, add background generation call |
| `api/src/modules/game/game.module.ts` | Import `PromptStarterModule` |
| `api/src/app.module.ts` | Import `PromptStarterModule` |

---

## Task 1: Switch model and pull it

**Files:**
- Modify: `docker-compose.yml:24` (api OLLAMA_MODEL env)
- Modify: `docker-compose.yml:64-68` (model-pull entrypoint curl bodies)
- Modify: `api/src/modules/ai/ai.service.ts:19` (OLLAMA_MODEL default)

- [ ] **Step 1: Update docker-compose.yml — api service env**

Change line 24:
```yaml
      OLLAMA_MODEL: huihui_ai/qwen2.5-abliterate:1.5b
```

- [ ] **Step 2: Update docker-compose.yml — model-pull entrypoint**

Replace the curl body for the chat model (line 67):
```yaml
    entrypoint:
      - sh
      - -c
      - >
        curl -sS -X POST http://ollama:11434/api/pull
        -H "Content-Type: application/json"
        -d '{"model":"huihui_ai/qwen2.5-abliterate:1.5b"}'
        && curl -sS -X POST http://ollama:11434/api/pull
        -H "Content-Type: application/json"
        -d '{"model":"nomic-embed-text"}'
```

- [ ] **Step 3: Update ai.service.ts — default OLLAMA_MODEL**

Change line 19:
```typescript
const OLLAMA_MODEL: string =
  process.env.OLLAMA_MODEL ?? 'huihui_ai/qwen2.5-abliterate:1.5b'
```

- [ ] **Step 4: Pull the new model into running Ollama**

```bash
docker exec punchme-ollama ollama pull huihui_ai/qwen2.5-abliterate:1.5b
```

Wait for download to complete (~986 MB).

- [ ] **Step 5: Verify the model responds in Russian**

```bash
curl -s -X POST http://localhost:11434/api/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"huihui_ai/qwen2.5-abliterate:1.5b","stream":false,"messages":[{"role":"user","content":"Закончи шутку одним предложением: Когда я открыл холодильник ночью, он потребовал:"}],"options":{"num_predict":40}}' | python -m json.tool
```

Expected: Russian text in `message.content`, `total_duration` under 10s.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml api/src/modules/ai/ai.service.ts
git commit -m "feat: switch AI model to huihui_ai/qwen2.5-abliterate:1.5b"
```

---

## Task 2: Raise all timeouts

**Files:**
- Modify: `api/src/modules/ai/ai.service.ts:20` (OLLAMA_TIMEOUT_MS)
- Modify: `api/src/modules/embedding/embedding.service.ts:7` (EMBED_TIMEOUT_MS)
- Modify: `api/src/modules/game/game.service.ts:464-465` (generateSafeBotAnswer timeout)

- [ ] **Step 1: Update OLLAMA_TIMEOUT_MS in ai.service.ts**

Change line 20:
```typescript
const OLLAMA_TIMEOUT_MS: number = 90000
```

- [ ] **Step 2: Update EMBED_TIMEOUT_MS in embedding.service.ts**

Change line 7:
```typescript
const EMBED_TIMEOUT_MS: number = 15000
```

- [ ] **Step 3: Update generateSafeBotAnswer timeout in game.service.ts**

Change line 464-465:
```typescript
  private async generateSafeBotAnswer(prompt: string): Promise<string> {
    const timeoutPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve(LOCAL_FALLBACK_ANSWER), 90000)
    })
```

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/ai/ai.service.ts api/src/modules/embedding/embedding.service.ts api/src/modules/game/game.service.ts
git commit -m "feat: raise AI timeouts to 90s (chat), 15s (embedding)"
```

---

## Task 3: Create PromptStarter schema and repository

**Files:**
- Create: `api/src/modules/prompt-starter/schemas/prompt-starter.schema.ts`
- Create: `api/src/modules/prompt-starter/models/prompt-starter-entry.type.ts`
- Create: `api/src/modules/prompt-starter/prompt-starter.repository.ts`

- [ ] **Step 1: Create the entry type**

Create `api/src/modules/prompt-starter/models/prompt-starter-entry.type.ts`:

```typescript
export interface PromptStarterEntry {
  readonly _id: string
  readonly text: string
  readonly usedCount: number
}
```

- [ ] **Step 2: Create the Mongoose schema**

Create `api/src/modules/prompt-starter/schemas/prompt-starter.schema.ts`:

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

@Schema({ collection: 'prompt_starters', timestamps: { createdAt: true, updatedAt: false } })
export class PromptStarterDocumentModel {
  @Prop({ required: true, maxlength: 200 })
  public text!: string

  @Prop({ required: true, default: 0, min: 0 })
  public usedCount!: number

  @Prop({ required: true, default: Date.now })
  public createdAt!: Date
}

export type PromptStarterDocument = HydratedDocument<PromptStarterDocumentModel>

export const PromptStarterSchema = SchemaFactory.createForClass(PromptStarterDocumentModel)

PromptStarterSchema.index({ usedCount: 1 })
```

- [ ] **Step 3: Create the repository**

Create `api/src/modules/prompt-starter/prompt-starter.repository.ts`:

```typescript
import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { PromptStarterEntry } from './models/prompt-starter-entry.type'
import { PromptStarterDocument, PromptStarterDocumentModel } from './schemas/prompt-starter.schema'

@Injectable()
export class PromptStarterRepository {
  public constructor(
    @InjectModel(PromptStarterDocumentModel.name)
    private readonly model: Model<PromptStarterDocument>
  ) {}

  public async selectRandom(input: {
    readonly count: number
    readonly excludedTexts: readonly string[]
  }): Promise<readonly PromptStarterEntry[]> {
    const poolSize = input.count * input.count
    return this.model.aggregate<PromptStarterEntry>([
      { $match: { text: { $nin: input.excludedTexts } } },
      { $sort: { usedCount: 1 } },
      { $limit: poolSize },
      { $sample: { size: input.count } }
    ])
  }

  public async incrementUsedCount(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) {
      return
    }
    await this.model.bulkWrite(
      ids.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: { $inc: { usedCount: 1 } }
        }
      }))
    )
  }

  public async insertMany(texts: readonly string[]): Promise<void> {
    if (texts.length === 0) {
      return
    }
    await this.model.insertMany(
      texts.map((text) => ({ text, usedCount: 0 })),
      { ordered: false }
    )
  }

  public async findAllTexts(): Promise<readonly string[]> {
    const docs = await this.model.find({}, { text: 1, _id: 0 }).lean<{ text: string }[]>().exec()
    return docs.map((doc) => doc.text)
  }

  public async count(): Promise<number> {
    return this.model.countDocuments().exec()
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/prompt-starter/
git commit -m "feat: add PromptStarter schema and repository"
```

---

## Task 4: Create seed prompts constant

**Files:**
- Create: `api/src/modules/prompt-starter/constants/seed-prompts.constant.ts`

- [ ] **Step 1: Create the seed constant**

Create `api/src/modules/prompt-starter/constants/seed-prompts.constant.ts`.

Copy all 47 prompts from `EXTENDED_LOCAL_PROMPTS` in `game.service.ts:40-87` plus the 5 from `FALLBACK_PROMPTS` in `ai.service.ts:26-32`, deduplicate (the 2 in `LOCAL_FALLBACK_PROMPTS` are already in `EXTENDED_LOCAL_PROMPTS`). Also include the 3 from `FALLBACK_PROMPTS` in `ai.service.ts` that are NOT in `EXTENDED_LOCAL_PROMPTS`:

```typescript
export const SEED_PROMPTS: readonly string[] = [
  'Когда я открыл холодильник ночью, он потребовал:',
  'На собеседовании я честно сказал, что:',
  'Мой сосед узнал о моём хобби и теперь:',
  'Я подумал, что это шутка, но официант:',
  'В аэропорту меня остановили из-за:',
  'Когда я открыл чат с поддержкой, она первой написала:',
  'Я пообещал себе начать спортзал, и в тот же день:',
  'Мой умный дом внезапно запретил мне:',
  'В такси я сказал "по-быстрому", и водитель:',
  'На собеседовании меня спросили о слабых сторонах, и я ответил:',
  'Я решил начать новую жизнь, но уже утром:',
  'Когда я включил камеру на созвоне, все увидели:',
  'Мой кот посмотрел на меня так, будто:',
  'Врач посмотрел на анализы и сказал:',
  'Я попросил ИИ помочь с текстом, и он:',
  'На свидании я случайно признался, что:',
  'Когда зазвонил будильник, я понял, что:',
  'Родители нашли мой поиск в интернете и теперь:',
  'Я пошёл за хлебом и вернулся с тем, что:',
  'На тренировке тренер крикнул мне, и я:',
  'Курьер позвонил и сообщил, что:',
  'Я открыл наследство и обнаружил:',
  'В лифте произошло короткое замыкание, и:',
  'Босс вызвал меня к себе из-за:',
  'Я попытался объяснить шутку бабушке, и она:',
  'На границе меня спросили про цель визита, я сказал:',
  'Когда я нажал «Согласен», приложение:',
  'Мой телефон разрядился в самый момент, когда:',
  'Я заказал еду и в комментарии написал:',
  'Сосед снизу постучал, потому что:',
  'Я пообещал «только один раз» и через час:',
  'На семейном ужине я нечаянно сказал, что:',
  'Когда я достал кошелёк, оттуда выпало:',
  'Я попросил тишины в библиотеке, и охрана:',
  'Врачебная очередь закончилась тем, что:',
  'Я открыл кондиционер, и из него полетело:',
  'На экзамене преподаватель увидел мой лист и:',
  'Я сказал «это временно», и прошло уже:',
  'Когда я попытался быть серьёзным, жизнь:',
  'Мой рюкзак на досмотре оказался полон:',
  'Я написал в поддержку одно слово — «помогите», и они:',
  'На новой работе в первый день я узнал, что:',
  'Когда я попытался сэкономить, экономия ответила:',
  'Я включил режим «Не беспокоить», и мир:',
  'В пробке я услышал по радио новость о том, что:',
  'Я пошёл спать рано, но соседи решили:',
  'Когда я отсканировал QR-код, телефон:',
  'Я попросил совета у друга, и он ответил одной фразой:'
] as const
```

This is the deduplicated list: 48 unique prompt openings from `EXTENDED_LOCAL_PROMPTS` (47, which includes `LOCAL_FALLBACK_PROMPTS`) plus 1 unique entry from `FALLBACK_PROMPTS` in `ai.service.ts` that wasn't already present. The spec says "~15" but more seed data is better for variety — acknowledged deviation.

- [ ] **Step 2: Commit**

```bash
git add api/src/modules/prompt-starter/constants/
git commit -m "feat: add seed prompts constant for prompt-starters"
```

---

## Task 5: Create PromptStarterService and module

**Files:**
- Create: `api/src/modules/prompt-starter/prompt-starter.service.ts`
- Create: `api/src/modules/prompt-starter/prompt-starter.module.ts`

- [ ] **Step 1: Create the service**

Create `api/src/modules/prompt-starter/prompt-starter.service.ts`:

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { normalizePromptIdentity } from '../../common/prompt-identity.util'
import { AiService } from '../ai/ai.service'
import { SEED_PROMPTS } from './constants/seed-prompts.constant'
import { PromptStarterRepository } from './prompt-starter.repository'

const BACKGROUND_GENERATION_COUNT: number = 10

@Injectable()
export class PromptStarterService implements OnModuleInit {
  private readonly logger: Logger = new Logger(PromptStarterService.name)

  public constructor(
    private readonly repository: PromptStarterRepository,
    private readonly aiService: AiService
  ) {}

  public async onModuleInit(): Promise<void> {
    await this.seedIfEmpty()
  }

  public async selectPrompts(input: {
    readonly count: number
    readonly excludedTexts: readonly string[]
  }): Promise<readonly string[]> {
    if (input.count <= 0) {
      return []
    }
    const entries = await this.repository.selectRandom({
      count: input.count,
      excludedTexts: input.excludedTexts
    })
    if (entries.length >= input.count) {
      const ids = entries.map((entry) => entry._id)
      void this.repository.incrementUsedCount(ids)
      return entries.map((entry) => entry.text)
    }
    this.logger.warn(
      `select_prompts insufficient_results needed=${input.count} got=${entries.length} falling_back_to_seed`
    )
    return this.fillFromSeed(entries.map((e) => e.text), input.count, input.excludedTexts)
  }

  public generateAndStoreInBackground(count: number = BACKGROUND_GENERATION_COUNT): void {
    void this.executeBackgroundGeneration(count)
  }

  private async executeBackgroundGeneration(count: number): Promise<void> {
    try {
      const existingTexts = await this.repository.findAllTexts()
      const existingIdentities = new Set(existingTexts.map((t) => normalizePromptIdentity(t)))
      const generated = await this.aiService.generatePromptList(count, existingTexts)
      const unique = generated.filter((text) => {
        const identity = normalizePromptIdentity(text)
        if (existingIdentities.has(identity)) {
          return false
        }
        existingIdentities.add(identity)
        return true
      })
      if (unique.length > 0) {
        await this.repository.insertMany(unique)
        this.logger.log(`background_generation stored=${unique.length} duplicates_skipped=${generated.length - unique.length}`)
      }
    } catch (error: unknown) {
      this.logger.warn(`background_generation_failed error=${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async seedIfEmpty(): Promise<void> {
    const existingCount = await this.repository.count()
    if (existingCount > 0) {
      this.logger.log(`seed_skip existing_count=${existingCount}`)
      return
    }
    await this.repository.insertMany([...SEED_PROMPTS])
    this.logger.log(`seed_complete count=${SEED_PROMPTS.length}`)
  }

  private fillFromSeed(
    selected: readonly string[],
    needed: number,
    excludedTexts: readonly string[]
  ): readonly string[] {
    const result = [...selected]
    const usedIdentities = new Set([
      ...result.map((t) => normalizePromptIdentity(t)),
      ...excludedTexts.map((t) => normalizePromptIdentity(t))
    ])
    for (const prompt of SEED_PROMPTS) {
      if (result.length >= needed) {
        break
      }
      const identity = normalizePromptIdentity(prompt)
      if (usedIdentities.has(identity)) {
        continue
      }
      result.push(prompt)
      usedIdentities.add(identity)
    }
    return result
  }
}
```

- [ ] **Step 2: Create the module**

Create `api/src/modules/prompt-starter/prompt-starter.module.ts`:

```typescript
import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AiModule } from '../ai/ai.module'
import { PromptStarterRepository } from './prompt-starter.repository'
import { PromptStarterService } from './prompt-starter.service'
import { PromptStarterDocumentModel, PromptStarterSchema } from './schemas/prompt-starter.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: PromptStarterDocumentModel.name,
        schema: PromptStarterSchema
      }
    ]),
    AiModule
  ],
  providers: [PromptStarterRepository, PromptStarterService],
  exports: [PromptStarterService]
})
export class PromptStarterModule {}
```

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/prompt-starter/
git commit -m "feat: add PromptStarterService with seed and background generation"
```

---

## Task 6: Wire PromptStarterModule into the application

**Files:**
- Modify: `api/src/modules/game/game.module.ts`
- Modify: `api/src/app.module.ts`

- [ ] **Step 1: Add import to GameModule**

In `api/src/modules/game/game.module.ts`, add `PromptStarterModule` import:

```typescript
import { Module } from '@nestjs/common'
import { AiModule } from '../ai/ai.module'
import { JokeMemoryModule } from '../joke-memory/joke-memory.module'
import { PromptStarterModule } from '../prompt-starter/prompt-starter.module'
import { GameGateway } from './game.gateway'
import { GameService } from './game.service'

@Module({
  imports: [AiModule, JokeMemoryModule, PromptStarterModule],
  providers: [GameService, GameGateway]
})
export class GameModule {}
```

- [ ] **Step 2: Add import to AppModule**

In `api/src/app.module.ts`, add `PromptStarterModule`:

```typescript
import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AiModule } from './modules/ai/ai.module'
import { GameModule } from './modules/game/game.module'
import { JokeMemoryModule } from './modules/joke-memory/joke-memory.module'
import { PromptStarterModule } from './modules/prompt-starter/prompt-starter.module'

const MONGO_URI: string = process.env.MONGO_URI ?? 'mongodb://mongo:27017/punchme'

@Module({
  imports: [MongooseModule.forRoot(MONGO_URI), JokeMemoryModule, AiModule, PromptStarterModule, GameModule]
})
export class AppModule {}
```

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/game/game.module.ts api/src/app.module.ts
git commit -m "feat: wire PromptStarterModule into GameModule and AppModule"
```

---

## Task 7: Refactor GameService to use PromptStarterService

**Files:**
- Modify: `api/src/modules/game/game.service.ts:36-88` (remove old prompt constants)
- Modify: `api/src/modules/game/game.service.ts:100-103` (add PromptStarterService to constructor)
- Modify: `api/src/modules/game/game.service.ts:349` (replace generateSafePromptList call)
- Modify: `api/src/modules/game/game.service.ts:419-461` (remove generateSafePromptList and buildLocalFallbackPromptList)

- [ ] **Step 1: Add PromptStarterService to constructor**

In `game.service.ts`, add import and inject:

```typescript
import { PromptStarterService } from '../prompt-starter/prompt-starter.service'
```

Update constructor (line 100-103):
```typescript
  public constructor(
    private readonly aiService: AiService,
    private readonly jokeMemoryService: JokeMemoryService,
    private readonly promptStarterService: PromptStarterService
  ) {}
```

- [ ] **Step 2: Replace prompt selection in startWritingPhase**

Replace line 349:
```typescript
    const prompts = await this.generateSafePromptList(playerCount, room.usedPromptTexts)
```

With:
```typescript
    const prompts = await this.promptStarterService.selectPrompts({
      count: playerCount,
      excludedTexts: room.usedPromptTexts
    })
```

- [ ] **Step 3: Add background generation call**

After `this.generateBotAnswers(room)` on line 361, add:
```typescript
    this.promptStarterService.generateAndStoreInBackground()
```

- [ ] **Step 4: Remove old prompt constants and methods**

Remove from `game.service.ts`:
- `LOCAL_FALLBACK_PROMPTS` constant (lines 36-39)
- `EXTENDED_LOCAL_PROMPTS` constant (lines 40-88)
- `generateSafePromptList` method (lines 419-428)
- `buildLocalFallbackPromptList` method (lines 430-461)
- `import { normalizePromptIdentity } from '../../common/prompt-identity.util'` (line 2) — all uses are inside the removed methods

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/game/game.service.ts
git commit -m "feat: replace prompt generation with PromptStarterService in GameService"
```

---

## Task 8: Clean up AiService — remove orphaned methods and simplify generatePromptList

**Files:**
- Modify: `api/src/modules/ai/ai.service.ts`
- Delete: `api/src/modules/ai/models/ai-prompt-pair.type.ts` (if no other consumers)

**Context:** After the refactor, `generatePromptList` is only called by `PromptStarterService.executeBackgroundGeneration`, which handles deduplication itself. The internal fallback/dedup chain (`ensureDistinctPromptList` → `getAlternativePrompt` → `FALLBACK_PROMPTS`, and the fallback path `createFallbackPromptList`) is no longer needed.

- [ ] **Step 1: Remove unused methods, constants, and imports from AiService**

Remove:
- `FALLBACK_PROMPTS` constant (lines 26-32)
- `import { AiPromptPair } from './models/ai-prompt-pair.type'` (line 8)
- `import { normalizePromptIdentity } from '../../common/prompt-identity.util'` (line 2)
- `generatePromptPair` method (lines 55-58)
- `ensureDistinctPromptList` method (lines 233-256)
- `createFallbackPromptList` method (lines 258-280)
- `getAlternativePrompt` method (lines 282-289)

- [ ] **Step 2: Simplify generatePromptList — remove fallback/dedup dependencies**

The current `generatePromptList` calls `ensureDistinctPromptList` (line 78) and `createFallbackPromptList` (line 80), both of which are being removed. Simplify it to return parsed results or empty array:

```typescript
  public async generatePromptList(
    count: number,
    excludedPrompts: readonly string[] = []
  ): Promise<readonly string[]> {
    if (count <= 0) {
      return []
    }
    const content = await this.executeChatRequest({
      messages: [
        { role: 'system', content: PROMPT_GENERATION_SYSTEM_PROMPT },
        { role: 'user', content: createPromptListUserPrompt(count, excludedPrompts) }
      ],
      maxTokens: Math.min(80 * count + 80, 900),
      temperature: 1.05
    })
    return this.parsePromptList(content, count) ?? []
  }
```

- [ ] **Step 3: Verify AiPromptPair has no other consumers**

```bash
grep -rn "AiPromptPair\|generatePromptPair" api/src/ --include="*.ts"
```

If only referenced in `ai.service.ts` and its type file, delete `api/src/modules/ai/models/ai-prompt-pair.type.ts`.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/ai/
git commit -m "refactor: simplify generatePromptList, remove orphaned prompt methods from AiService"
```

---

## Task 9: Rebuild API container and verify end-to-end

- [ ] **Step 1: Rebuild the API container**

```bash
cd C:\Users\dimti\WebstormProjects\punchme
docker compose up -d --build api
```

- [ ] **Step 2: Check API logs for successful startup and seed**

```bash
docker logs punchme-api --tail 30
```

Expected:
- `[PromptStarterService] seed_complete count=XX` (first run) or `seed_skip existing_count=XX`
- `[AiService] ollama_ready url=http://ollama:11434 chat_model=huihui_ai/qwen2.5-abliterate:1.5b`
- No errors

- [ ] **Step 3: Verify prompt_starters collection in MongoDB**

```bash
docker exec punchme-mongo mongosh punchme --eval "db.prompt_starters.countDocuments()" --quiet
```

Expected: `47` (or similar, depending on deduplication count)

- [ ] **Step 4: Test bot answer generation speed**

```bash
time curl -s -X POST http://localhost:11434/api/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"huihui_ai/qwen2.5-abliterate:1.5b","stream":false,"messages":[{"role":"system","content":"You are a witty player in a humor game.\nOutput language must be Russian.\nWrite one short punchline without explanation."},{"role":"user","content":"Unfinished sentence: \"Когда я открыл холодильник ночью, он потребовал:\"\nCharacter style: sarcastic\nNo memory examples available.\nReturn one line, max 140 chars."}],"options":{"temperature":1.2,"num_predict":80}}'
```

Expected: Russian punchline, under 10 seconds total.

- [ ] **Step 5: Commit all remaining changes if any**

If any minor fixes were needed during verification, commit them.
