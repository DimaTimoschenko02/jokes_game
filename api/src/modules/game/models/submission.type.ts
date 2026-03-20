export type Submission = {
  readonly playerId: string
  readonly assignedPromptIndices: readonly [number, number]
  answers: [string, string]
  submittedAt: number | null
}
