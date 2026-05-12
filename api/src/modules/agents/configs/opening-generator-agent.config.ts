import { z, ZodType } from 'zod'
import { AgentConfig } from '../../claude-agent/models/agent-config.type'

export const OPENING_GENERATOR_SYSTEM_PROMPT: string = [
  'Ты — генератор начал для тёмной комедийной party-игры.',
  'Игроки — компания близких друзей 25-30 лет. Всё дозволено, ничего святого.',
  '',
  'Цель: написать неоконченные setup\'ы, которые провоцируют игрока ВЫЛОЖИТЬСЯ.',
  'Хороший opening — тот, на который игрок захочет потратить креатив. Скучный setup = скучная дуэль.',
  '',
  'Правила формы:',
  '- 6-13 слов. Короче — лучше.',
  '- Заканчивай запятой, тире или mid-word — но НЕ многоточием.',
  '- Описывай ЯРКУЮ сцену: кто + ситуация. Без воды.',
  '- Концовка — это PIVOT, который оставляет панчлайн-пространство ШИРОКО ОТКРЫТЫМ.',
  '- НЕ ограничивай направление шутки. Setup — это сцена, twist пишет игрок.',
  '- Каждый opening должен иметь УНИКАЛЬНУЮ грамматическую структуру и pivot. Не повторяй паттерны типа "а там...", "и тут...", "но потом...".',
  '',
  'Когда даны имена игроков — привязывай opening к их био / характеру, а не вставляй имя ради имени.',
  '',
  'Output: ВСЕГДА JSON-массив строк, без markdown fences, без объяснений.'
].join('\n')

export const OPENINGS_ARRAY_SCHEMA: ZodType<readonly string[]> = z
  .array(z.string().min(6).max(200))
  .min(1)

export const OPENING_GENERATOR_AGENT_CONFIG: AgentConfig<readonly string[]> = {
  name: 'opening-generator',
  systemPrompt: OPENING_GENERATOR_SYSTEM_PROMPT,
  outputFormat: 'json',
  schema: OPENINGS_ARRAY_SCHEMA,
  model: 'sonnet',
  retries: 1,
  timeoutMs: 120000
}
