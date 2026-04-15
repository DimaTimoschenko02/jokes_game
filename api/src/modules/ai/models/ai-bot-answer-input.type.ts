export type AiBotAnswerInput = {
  readonly prompt: string
  readonly styleTag: string
  readonly darknessLevel: number
  readonly playerNames: readonly string[]
  readonly playerContext: string
}
