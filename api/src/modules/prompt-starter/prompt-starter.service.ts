import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { normalizePromptIdentity } from '../../common/prompt-identity.util'
import { AiService } from '../ai/ai.service'
import { SEED_PROMPTS } from './constants/seed-prompts.constant'
import { PushCompletionInput } from './models/push-completion-input.type'
import { PromptStarterRepository } from './prompt-starter.repository'

const BACKGROUND_GENERATION_COUNT: number = 4

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

  public pushCompletion(input: PushCompletionInput): void {
    void this.repository.pushCompletion(input).catch((error: unknown) => {
      this.logger.warn(`push_completion_failed prompt="${input.promptText.slice(0, 60)}" error=${error instanceof Error ? error.message : String(error)}`)
    })
  }

  public async getGoldenExamples(limit: number): Promise<readonly string[]> {
    const entries = await this.repository.findGolden(limit)
    return entries.map((entry) => entry.text)
  }

  public async getCompletionsForPrompt(promptText: string): Promise<readonly import('./models/prompt-starter-entry.type').PromptCompletion[]> {
    return this.repository.findBestCompletions({ promptText, limit: 20, minVoteShare: 0 })
  }

  public async saveGoldenOpening(input: {
    readonly text: string
    readonly averageCompletionRating: number
    readonly averageVoteShare: number
  }): Promise<void> {
    await this.repository.upsertGolden(input)
    this.logger.log(`golden_opening_saved text="${input.text.slice(0, 60)}" rating=${input.averageCompletionRating.toFixed(1)}`)
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
        await this.repository.upsertMany(unique)
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
    await this.repository.upsertMany([...SEED_PROMPTS])
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
