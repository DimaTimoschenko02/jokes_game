export type AiMessage = {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}
