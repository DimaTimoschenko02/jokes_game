import { Injectable, Logger } from '@nestjs/common'
import { normalizePromptIdentity } from '../../common/prompt-identity.util'
import { AiService } from '../ai/ai.service'
import { PushCompletionInput } from './models/push-completion-input.type'
import { PromptStarterRepository } from './prompt-starter.repository'

const BACKGROUND_GENERATION_COUNT: number = 4
const FALLBACK_POOL_SIZE: number = 16

@Injectable()
export class PromptStarterService {
  private readonly logger: Logger = new Logger(PromptStarterService.name)

  public constructor(
    private readonly repository: PromptStarterRepository,
    private readonly aiService: AiService
  ) {}

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
      `select_prompts insufficient_results needed=${input.count} got=${entries.length} falling_back_to_fallback_pool`
    )
    return this.fillFromFallback(entries.map((e) => e.text), input.count, input.excludedTexts)
  }

  public saveHumanOpening(input: { readonly text: string; readonly authorUserId: string }): void {
    void this.repository.upsertHumanOpening(input).catch((error: unknown) => {
      this.logger.warn(
        `save_human_opening_failed text="${input.text.slice(0, 60)}" error=${error instanceof Error ? error.message : String(error)}`
      )
    })
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

  public async getGoldenExamplesDetailed(
    limit: number
  ): Promise<readonly { readonly text: string; readonly score: number }[]> {
    const entries = await this.repository.findGolden(limit)
    this.trackExampleUsage(entries.map((entry) => entry._id))
    return entries.map((entry) => ({
      text: entry.text,
      score: entry.averageCompletionRating ?? 0
    }))
  }

  private trackExampleUsage(ids: readonly string[]): void {
    void this.repository.incrementUsedAsExampleCount(ids).catch((error: unknown) => {
      this.logger.warn(
        `track_example_usage_failed count=${ids.length} reason="${error instanceof Error ? error.message : String(error)}"`
      )
    })
  }

  public async applyQuickFeedback(input: {
    readonly promptText: string
    readonly level: number
  }): Promise<void> {
    await this.repository.applyQuickFeedback(input.promptText, input.level)
  }

  public async getNegativeOpeningExamples(
    limit: number
  ): Promise<readonly { readonly text: string; readonly score: number; readonly adminComment?: string }[]> {
    const rows = await this.repository.findLowRatedOpenings({
      limit,
      maxFeedbackScore: -0.5,
      maxAdminScore: 2,
      minVotes: 2
    })
    this.trackExampleUsage(rows.map((row) => row.id))
    return rows.map(({ text, score, adminComment }) => ({ text, score, adminComment }))
  }

  public async getMediumOpeningExamples(
    limit: number
  ): Promise<readonly { readonly text: string; readonly score: number }[]> {
    const rows = await this.repository.findMediumRatedOpenings({
      limit,
      minFeedbackScore: -0.5,
      maxFeedbackScore: 0.5,
      minVotes: 1
    })
    this.trackExampleUsage(rows.map((row) => row.id))
    return rows.map(({ text, score }) => ({ text, score }))
  }

  public async getCompletionsForPrompt(promptText: string): Promise<readonly import('./models/prompt-starter-entry.type').PromptCompletion[]> {
    return this.repository.findBestCompletions({ promptText, limit: 20, minVoteShare: 0 })
  }

  public async findByText(text: string): Promise<import('./models/prompt-starter-entry.type').PromptStarterEntry | null> {
    return this.repository.findByText(text)
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

  private async fillFromFallback(
    selected: readonly string[],
    needed: number,
    excludedTexts: readonly string[]
  ): Promise<readonly string[]> {
    const result = [...selected]
    const usedIdentities = new Set([
      ...result.map((t) => normalizePromptIdentity(t)),
      ...excludedTexts.map((t) => normalizePromptIdentity(t))
    ])
    const fallbackPool = await this.repository.findRandomFallback(FALLBACK_POOL_SIZE)
    for (const prompt of fallbackPool) {
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
    if (result.length < needed) {
      this.logger.warn(
        `fillFromFallback_insufficient needed=${needed} got=${result.length} fallback_pool=${fallbackPool.length}`
      )
    }
    return result
  }
}
