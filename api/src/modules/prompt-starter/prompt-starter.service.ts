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
