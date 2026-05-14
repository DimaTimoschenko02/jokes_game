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
  'Output: JSON-объект формы {"updates": { <userId>: { ...опциональные дельты... } }}. Структура форсируется через JSON Schema, отвечай строго по ней.'
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

export const MEMORY_UPDATER_OUTPUT_SCHEMA: ZodType<MemoryUpdaterOutput> = z.object({
  updates: z.record(z.string().min(1), userMemoryDeltaSchema)
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
