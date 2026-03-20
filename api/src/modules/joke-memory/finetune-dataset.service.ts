import { Injectable } from '@nestjs/common'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { customAlphabet } from 'nanoid'
import { FinetuneSample } from './models/finetune-sample.type'
import { ModelVersionRecord } from './models/model-version-record.type'
import { JokeMemoryService } from './joke-memory.service'

const idGenerator = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10)
const EXPORT_DIR = process.env.FINETUNE_EXPORT_DIR ?? 'tmp/finetune'
const VERSION_FILE = process.env.MODEL_VERSION_FILE ?? 'tmp/model-versions.json'

@Injectable()
export class FinetuneDatasetService {
  public constructor(private readonly jokeMemoryService: JokeMemoryService) {}

  public async executePrepareDatasetExport(limit: number): Promise<{ readonly datasetPath: string; readonly sampleCount: number }> {
    const samples = await this.jokeMemoryService.executeBuildFinetuneDataset(limit)
    await fs.mkdir(EXPORT_DIR, { recursive: true })
    const fileName = `dataset-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
    const targetPath = join(EXPORT_DIR, fileName)
    const payload = this.buildJsonl(samples)
    await fs.writeFile(targetPath, payload, 'utf8')
    return { datasetPath: targetPath, sampleCount: samples.length }
  }

  public async executeRegisterModelVersion(input: {
    readonly modelName: string
    readonly adapterPath: string
    readonly metricWinRate: number
    readonly metricFallbackRate: number
  }): Promise<ModelVersionRecord> {
    const versions = await this.readVersions()
    const nextVersion: ModelVersionRecord = {
      versionId: `v-${idGenerator()}`,
      modelName: input.modelName,
      adapterPath: input.adapterPath,
      metricWinRate: input.metricWinRate,
      metricFallbackRate: input.metricFallbackRate,
      createdAt: new Date().toISOString(),
      isActive: true
    }
    const updated = versions.map((row) => ({ ...row, isActive: false }))
    updated.unshift(nextVersion)
    await this.writeVersions(updated)
    return nextVersion
  }

  public async executeRollbackVersion(versionId: string): Promise<ModelVersionRecord | null> {
    const versions = await this.readVersions()
    const target = versions.find((row) => row.versionId === versionId)
    if (!target) {
      return null
    }
    const updated = versions.map((row) => ({ ...row, isActive: row.versionId === versionId }))
    await this.writeVersions(updated)
    return { ...target, isActive: true }
  }

  private buildJsonl(samples: readonly FinetuneSample[]): string {
    return samples
      .map((sample) =>
        JSON.stringify({
          messages: [
            { role: 'system', content: sample.system },
            { role: 'user', content: sample.user },
            { role: 'assistant', content: sample.assistant }
          ],
          weight: sample.weight
        })
      )
      .join('\n')
  }

  private async readVersions(): Promise<readonly ModelVersionRecord[]> {
    try {
      const content = await fs.readFile(VERSION_FILE, 'utf8')
      const parsed = JSON.parse(content) as readonly ModelVersionRecord[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private async writeVersions(versions: readonly ModelVersionRecord[]): Promise<void> {
    await fs.mkdir(dirname(VERSION_FILE), { recursive: true })
    await fs.writeFile(VERSION_FILE, JSON.stringify(versions, null, 2), 'utf8')
  }
}
