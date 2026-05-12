import { Injectable, Logger } from '@nestjs/common'
import { EmbeddingService } from '../../embedding/embedding.service'
import { selectViaMmr } from '../../joke-memory/scoring.util'
import { PromptStarterRepository } from '../../prompt-starter/prompt-starter.repository'

export type SelectedOpening = {
  readonly text: string
  readonly embedding: readonly number[]
  readonly embeddingModel: string
  readonly maxHistorySimilarity: number
}

export type FilterResult = {
  readonly accepted: readonly SelectedOpening[]
  readonly rejectedAsDuplicates: readonly string[]
  readonly rejectedAsInvalid: readonly string[]
}

const DEFAULT_SIMILARITY_THRESHOLD: number = 0.85
const MIN_TEXT_LENGTH: number = 6

@Injectable()
export class OpeningSelectionService {
  private readonly logger: Logger = new Logger(OpeningSelectionService.name)

  public constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly promptStarterRepository: PromptStarterRepository
  ) {}

  public async filterByHistorySimilarity(
    candidates: readonly string[],
    similarityThreshold: number = DEFAULT_SIMILARITY_THRESHOLD
  ): Promise<FilterResult> {
    const accepted: SelectedOpening[] = []
    const rejectedAsDuplicates: string[] = []
    const rejectedAsInvalid: string[] = []
    const seenTexts: Set<string> = new Set()

    for (const candidate of candidates) {
      const text: string = candidate.trim()
      if (text.length < MIN_TEXT_LENGTH) {
        rejectedAsInvalid.push(candidate)
        continue
      }
      const normalized: string = text.toLowerCase()
      if (seenTexts.has(normalized)) {
        rejectedAsDuplicates.push(text)
        continue
      }
      seenTexts.add(normalized)
    }

    const validTexts: string[] = candidates
      .map((c) => c.trim())
      .filter((text) => text.length >= MIN_TEXT_LENGTH && seenTexts.has(text.toLowerCase()))

    const embeddings = await Promise.all(
      validTexts.map((text) => this.embeddingService.executeEmbedText({ text }))
    )

    const similarities = await Promise.all(
      embeddings.map((embedding) =>
        embedding ? this.promptStarterRepository.findMaxSimilarityToHistory(embedding.vector) : 0
      )
    )

    for (let index = 0; index < validTexts.length; index += 1) {
      const text: string = validTexts[index]
      const embedding = embeddings[index]
      const similarity: number = similarities[index] ?? 0
      if (!embedding) {
        rejectedAsInvalid.push(text)
        continue
      }
      if (similarity >= similarityThreshold) {
        rejectedAsDuplicates.push(text)
        continue
      }
      accepted.push({
        text,
        embedding: embedding.vector,
        embeddingModel: embedding.model,
        maxHistorySimilarity: similarity
      })
    }

    this.logger.log(
      `filter_history candidates=${candidates.length} accepted=${accepted.length} dup=${rejectedAsDuplicates.length} invalid=${rejectedAsInvalid.length} threshold=${similarityThreshold}`
    )
    return { accepted, rejectedAsDuplicates, rejectedAsInvalid }
  }

  public selectDiverse(
    candidates: readonly SelectedOpening[],
    needed: number
  ): readonly SelectedOpening[] {
    if (candidates.length === 0 || needed <= 0) {
      return []
    }
    const scored = candidates.map((candidate) => ({
      candidate,
      embedding: candidate.embedding,
      score: 1 - candidate.maxHistorySimilarity
    }))
    const selected = selectViaMmr(scored, needed)
    return selected.map((item) => item.candidate)
  }

  public async registerSelected(selected: readonly SelectedOpening[]): Promise<void> {
    if (selected.length === 0) {
      return
    }
    await Promise.all(
      selected.map((opening) =>
        this.promptStarterRepository
          .upsertWithEmbedding(opening.text, opening.embedding, opening.embeddingModel)
          .catch((error: unknown) => {
            this.logger.warn(
              `register_selected_failed text="${opening.text.slice(0, 60)}" reason="${error instanceof Error ? error.message : String(error)}"`
            )
          })
      )
    )
  }
}
