import { z, ZodType } from 'zod'
import { AgentConfig } from '../../claude-agent/models/agent-config.type'
import { MemoryUpdaterOutput } from '../memory-updater/models/user-memory-delta.type'

export const MEMORY_UPDATER_SYSTEM_PROMPT: string = [
  'Ты — обновлятор памяти игроков для тёмной комедийной party-игры.',
  'После каждого раунда тебе показывают что произошло: какие шутки, кто как голосовал, какие рейтинги.',
  'Твоя задача — обновить долговременную память каждого игрока строго по фактам, без догадок.',
  '',
  'Что обновляешь:',
  '- themesDelta: темы которые игрок поднимает или на которые реагирует. confidence растёт МЕДЛЕННО — тема становится stable после 3+ упоминаний. Не добавляй тему по одной шутке.',
  '- voterPreferencesDelta — двигай маленькими шагами (±0.05-0.15), только если паттерн голосования игрока в этом раунде явно показывает направление.',
  '- authorStyleDelta — обнови если игрок написал хотя бы 1 шутку в этом раунде. avgPunchlineLength считай как число слов.',
  '- newPortrait — короткое описание игрока на 3-5 предложений (на русском). Обновляй когда есть новое наблюдение. Без диагнозов, без оценочных суждений — описывай поведение, а не личность.',
  '',
  'ПРАВИЛА:',
  '- Не предполагай характер по одной шутке. Только устойчивые паттерны.',
  '- Не записывай содержание шуток как факты о игроке. Шутка — это шутка, не биография.',
  '- Если для игрока в этом раунде нет НИЧЕГО нового — не включай его в updates.',
  '- Дельты — это только ИЗМЕНЕНИЯ. Не возвращай поля которые не меняются.',
  '',
  'Output: JSON-объект формы {"updates": { <userId>: { ...опциональные дельты... } }}. Структура форсируется через JSON Schema, отвечай строго по ней.',
  '',
  'РЕЖИМ FINALIZE (в конце игры): когда тебя просят обновить ПАМЯТЬ КОМПАНИИ — верни {"updates": {}, "groupMemoryDelta": {...}}.',
  'groupMemoryDelta описывает компанию игроков в целом, а не отдельных людей:',
  '- themesDelta: темы, на которые компания заходила в этой игре. scoreDelta двигай малыми шагами (±0.05-0.2).',
  '- inJokesDelta: клички, мемы, инсайды компании (kind: nickname | meme | callback).',
  '- triggersDelta: приёмы/образы, которые вызывали смех (не темы — а КАК шутят).',
  '- avoidedThemesDelta: что не заходило, отторгало — с короткой причиной.',
  '- setupPatternsDelta: типы setup\'ов начал, которые залетали у этой компании.',
  '- newSummaryText: возвращай ТОЛЬКО если тебя явно просят обновить саммари.',
  'Дельты — только ИЗМЕНЕНИЯ относительно показанной текущей памяти компании. Без догадок, строго по фактам игры.'
].join('\n')

const themeDeltaSchema = z.object({
  theme: z.string().min(1).max(100),
  confidenceDelta: z.number().min(-1).max(1).optional(),
  mentionsDelta: z.number().int().optional(),
  source: z.enum(['declared', 'derived']).optional()
})

const voterPreferencesDeltaSchema = z
  .object({
    darkPreference: z.number().min(-1).max(1).optional(),
    callbackPreference: z.number().min(-1).max(1).optional(),
    absurdPreference: z.number().min(-1).max(1).optional(),
    ironyPreference: z.number().min(-1).max(1).optional()
  })
  .strict()

const authorStyleDeltaSchema = z
  .object({
    avgPunchlineLength: z.number().min(0).max(100).optional(),
    preferredStructures: z.array(z.string().min(1).max(80)).max(20).optional()
  })
  .strict()

const userMemoryDeltaSchema = z
  .object({
    themesDelta: z.array(themeDeltaSchema).max(20).optional(),
    voterPreferencesDelta: voterPreferencesDeltaSchema.optional(),
    authorStyleDelta: authorStyleDeltaSchema.optional(),
    newPortrait: z.string().min(1).max(1200).optional()
  })
  .strict()

/**
 * The model keeps returning group delta keys without the `Delta` suffix, mirroring the field
 * names it sees in the rendered current-memory block. A whole game's group memory used to be
 * dropped over that mismatch, so normalize the known aliases before validation.
 */
const GROUP_DELTA_KEY_ALIASES: Readonly<Record<string, string>> = {
  themes: 'themesDelta',
  inJokes: 'inJokesDelta',
  triggers: 'triggersDelta',
  avoidedThemes: 'avoidedThemesDelta',
  setupPatterns: 'setupPatternsDelta',
  summaryText: 'newSummaryText'
}

const normalizeGroupDeltaKeys = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }
  const source = value as Record<string, unknown>
  const normalized: Record<string, unknown> = {}
  // First pass: canonical keys win outright, whatever order they arrived in.
  for (const [key, entry] of Object.entries(source)) {
    if (GROUP_DELTA_KEY_ALIASES[key] === undefined) {
      normalized[key] = entry
    }
  }
  // Second pass: aliases only fill slots the canonical keys left empty.
  for (const [key, entry] of Object.entries(source)) {
    const canonical: string | undefined = GROUP_DELTA_KEY_ALIASES[key]
    if (canonical !== undefined && normalized[canonical] === undefined) {
      normalized[canonical] = entry
    }
  }
  return normalized
}

const groupMemoryDeltaShape = z
  .object({
    themesDelta: z
      .array(
        z.object({
          theme: z.string().min(1).max(100),
          scoreDelta: z.number().min(-1).max(1).optional(),
          mentionsDelta: z.number().int().optional(),
          newExamples: z.array(z.string().min(1).max(300)).max(5).optional()
        })
      )
      .max(20)
      .optional(),
    inJokesDelta: z
      .array(
        z.object({
          phrase: z.string().min(1).max(120),
          kind: z.enum(['nickname', 'meme', 'callback']).optional(),
          mentionsDelta: z.number().int().optional()
        })
      )
      .max(20)
      .optional(),
    triggersDelta: z
      .array(
        z.object({
          trigger: z.string().min(1).max(120),
          scoreDelta: z.number().min(-1).max(1).optional(),
          newExamples: z.array(z.string().min(1).max(300)).max(5).optional()
        })
      )
      .max(20)
      .optional(),
    avoidedThemesDelta: z
      .array(
        z.object({
          theme: z.string().min(1).max(100),
          reason: z.string().min(1).max(200)
        })
      )
      .max(20)
      .optional(),
    setupPatternsDelta: z
      .array(
        z.object({
          pattern: z.string().min(1).max(120),
          scoreDelta: z.number().min(-1).max(1).optional()
        })
      )
      .max(20)
      .optional(),
    newSummaryText: z.string().min(1).max(2000).optional()
  })
  .strict()

const groupMemoryDeltaSchema = z.preprocess(normalizeGroupDeltaKeys, groupMemoryDeltaShape)

export const MEMORY_UPDATER_OUTPUT_SCHEMA: ZodType<MemoryUpdaterOutput> = z.object({
  updates: z.record(z.string().min(1), userMemoryDeltaSchema),
  groupMemoryDelta: groupMemoryDeltaSchema.optional()
})

export const MEMORY_UPDATER_AGENT_CONFIG: AgentConfig<MemoryUpdaterOutput> = {
  name: 'memory-updater',
  systemPrompt: MEMORY_UPDATER_SYSTEM_PROMPT,
  outputFormat: 'json',
  schema: MEMORY_UPDATER_OUTPUT_SCHEMA,
  model: 'sonnet',
  retries: 1,
  timeoutMs: 180000,
  effort: 'low',
  useJsonSchema: true
}
