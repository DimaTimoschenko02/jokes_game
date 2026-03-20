import { Injectable } from '@nestjs/common'
import { EmbeddingResult } from './models/embedding-result.type'
import { OllamaEmbeddingResponse } from './models/ollama-embedding-response.type'

const OLLAMA_BASE_URL: string = process.env.OLLAMA_BASE_URL ?? 'http://host.docker.internal:11434'
const OLLAMA_EMBED_MODEL: string = process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text'
const EMBED_TIMEOUT_MS: number = 6000

@Injectable()
export class EmbeddingService {
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
        return null
      }
      const json = (await response.json()) as OllamaEmbeddingResponse
      if (!json.embedding || json.embedding.length === 0) {
        return null
      }
      return json.embedding
    } catch {
      return null
    } finally {
      clearTimeout(timeoutHandle)
    }
  }
}
