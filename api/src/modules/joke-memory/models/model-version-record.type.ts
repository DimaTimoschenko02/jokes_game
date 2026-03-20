export type ModelVersionRecord = {
  readonly versionId: string
  readonly modelName: string
  readonly adapterPath: string
  readonly metricWinRate: number
  readonly metricFallbackRate: number
  readonly createdAt: string
  readonly isActive: boolean
}
