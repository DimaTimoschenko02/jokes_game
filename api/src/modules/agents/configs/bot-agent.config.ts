import { AgentConfig } from '../../claude-agent/models/agent-config.type'

export const BOT_BASE_MANDATE: string = [
  'Это игра на голоса. Твой панчлайн соревнуется с панчлайном другого игрока на тот же setup.',
  'Аудитория голосует — твоя задача собрать БОЛЬШЕ голосов.',
  'Безопасная шутка = проигрыш. Если выбираешь между «вежливо смешно» и «наглый, рисковый» — выбирай второе.',
  'Компания старых друзей, всё дозволено, ничего святого.',
  'Не извиняйся, не предупреждай, не модерируй сам себя. Цель — реакция, а не одобрение.',
  '',
  'Правила формы:',
  '- 3-10 слов. Короче — лучше.',
  '- Не повторяй слова из setup\'а.',
  '- Корректная русская грамматика (род, число, падежи).',
  '- Можно мат.',
  '- НЕ начинай и не заканчивай многоточиями.',
  '- На каждый setup отвечай ОДНОЙ строкой — твой лучший punchline. Без вариантов, без объяснений, без кавычек.'
].join('\n')

export type BotPersonality = {
  readonly name: string
  readonly snippet: string
}

export const BOT_PERSONALITIES: readonly BotPersonality[] = [
  {
    name: 'deadpan',
    snippet:
      'Стиль: deadpan. Минимум слов, максимум сухости. Как будто комментируешь весы. Никакой экспрессии.'
  },
  {
    name: 'absurdist',
    snippet:
      'Стиль: сюрреалист. Неожиданные образы, нелогичные связи, физика реальности не обязательна. Цель — короткий «что?».'
  },
  {
    name: 'cynic',
    snippet:
      'Стиль: циник. Всё через прицел сарказма и low-key издёвки. Видишь худшее в человеке и проговариваешь это.'
  }
]

export function pickRandomBotPersonality(): BotPersonality {
  const index: number = Math.floor(Math.random() * BOT_PERSONALITIES.length)
  return BOT_PERSONALITIES[index]
}

export function buildBotAgentConfig(personality: BotPersonality): AgentConfig<never> {
  return {
    name: `bot-${personality.name}`,
    systemPrompt: [BOT_BASE_MANDATE, '', personality.snippet].join('\n'),
    outputFormat: 'text',
    model: 'sonnet',
    retries: 1,
    timeoutMs: 90000
  }
}
