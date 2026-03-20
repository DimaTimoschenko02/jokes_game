import { AiMemoryExample } from '../models/ai-memory-example.type'

export const PROMPT_GENERATION_SYSTEM_PROMPT: string =
  'You generate funny unfinished prompts for a party game. Response language must be Russian.'

export const PROMPT_GENERATION_USER_PROMPT: string = [
  'Return strict JSON array with exactly 2 strings.',
  'Each string must be an unfinished sentence for joke completion.',
  'No markdown and no explanation.'
].join('\n')

export const createPromptListUserPrompt = (count: number, excludedPrompts: readonly string[]): string => {
  const lines = [
    `Return strict JSON array with exactly ${count} strings.`,
    'Each string must be a distinct unfinished sentence for joke completion.',
    'Strings must be unique and must not repeat the same idea.',
    'No markdown and no explanation.'
  ]
  if (excludedPrompts.length > 0) {
    lines.push(
      'Do not reuse or paraphrase any of these sentences (including same setup or punchline setup):',
      ...excludedPrompts.map((item, index) => `${index + 1}. ${item}`)
    )
  }
  return lines.join('\n')
}

export const BOT_PUNCHLINE_SYSTEM_PROMPT: string = [
  'You are a witty player in a humor game.',
  'Output language must be Russian.',
  'Write one short punchline without explanation.'
].join('\n')

const buildMemorySection = (examples: readonly AiMemoryExample[]): string => {
  if (examples.length === 0) {
    return 'No memory examples available.'
  }
  const rows = examples.map(
    (example, index) =>
      `${index + 1}. Prompt: "${example.prompt}" | Punchline: "${example.punchline}" | VoteShare: ${example.voteShare.toFixed(2)}`
  )
  return ['Examples from highly rated player jokes:', ...rows].join('\n')
}

export const createBotPunchlineUserPrompt = (
  prompt: string,
  styleTag: string,
  examples: readonly AiMemoryExample[]
): string =>
  [
    `Unfinished sentence: "${prompt}"`,
    `Character style: ${styleTag}`,
    buildMemorySection(examples),
    'Return one line, max 140 chars.'
  ].join('\n')
