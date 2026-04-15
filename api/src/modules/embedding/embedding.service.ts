import { Injectable, Logger } from '@nestjs/common'
import { EmbeddingResult } from './models/embedding-result.type'
import { OllamaEmbeddingResponse } from './models/ollama-embedding-response.type'

const OLLAMA_BASE_URL: string = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
const OLLAMA_EMBED_MODEL: string = process.env.OLLAMA_EMBED_MODEL ?? 'bge-m3'
const EMBED_TIMEOUT_MS: number = 15000

@Injectable()
export class EmbeddingService {
  private readonly logger: Logger = new Logger(EmbeddingService.name)

  public async executeEmbedText(input: { readonly text: string }): Promise<EmbeddingResult | null> {
    const payload = this.normalizeText(input.text)
    if (!payload) {
      return null
    }
    const response = await this.requestEmbedding(payload)
    if (!response || response.length === 0) {
      return null
    }
    return {
      vector: response,
      model: OLLAMA_EMBED_MODEL
    }
  }

  private normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 400)
  }

  private async requestEmbedding(text: string): Promise<readonly number[] | null> {
    const abortController = new AbortController()
    const timeoutHandle = setTimeout(() => abortController.abort(), EMBED_TIMEOUT_MS)
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text })
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        this.logger.warn(
          `ollama_embed http_status=${response.status} model=${OLLAMA_EMBED_MODEL} body=${detail.slice(0, 200)}`
        )
        return null
      }
      const json = (await response.json()) as OllamaEmbeddingResponse
      if (!json.embedding || json.embedding.length === 0) {
        this.logger.warn(`ollama_embed empty_vector model=${OLLAMA_EMBED_MODEL}`)
        return null
      }
      return json.embedding
    } catch (error: unknown) {
      if (error instanceof Error) {
        const kind = error.name === 'AbortError' ? 'timeout_or_abort' : error.name
        this.logger.warn(
          `ollama_embed ${kind} message=${error.message} model=${OLLAMA_EMBED_MODEL} url=${OLLAMA_BASE_URL}`
        )
      } else {
        this.logger.warn(`ollama_embed error=${String(error)} url=${OLLAMA_BASE_URL}`)
      }
      return null
    } finally {
      clearTimeout(timeoutHandle)
    }
  }
}
