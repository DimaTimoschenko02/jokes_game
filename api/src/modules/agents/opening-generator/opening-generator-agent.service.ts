import { Injectable, Logger } from '@nestjs/common'
import { ClaudeAgentRunnerService } from '../../claude-agent/claude-agent-runner.service'
import { AgentSession } from '../../claude-agent/models/agent-session.type'
import { OPENING_GENERATOR_AGENT_CONFIG } from '../configs/opening-generator-agent.config'

export type OpeningPlayerProfile = {
  readonly userId: string
  readonly realName: string
  readonly displayName: string
  readonly gender: 'male' | 'female' | 'non-binary' | 'not-specified'
  readonly declaredBio?: string
  readonly themes?: readonly string[]
  readonly portrait?: string
}

export type GoldenOpeningExample = {
  readonly text: string
  readonly score: number
}

export type MediumOpeningExample = {
  readonly text: string
  readonly score: number
}

export type NegativeOpeningExample = {
  readonly text: string
  readonly score: number
  readonly adminComment?: string
}

export type RoundResultForOpening = {
  readonly opening: string
  readonly topPunchlines: readonly string[]
  readonly feedback: { readonly up: number; readonly down: number; readonly broken: number }
}

export type StartOpeningGeneratorInput = {
  readonly players: readonly OpeningPlayerProfile[]
  readonly golden: readonly GoldenOpeningExample[]
  readonly medium: readonly MediumOpeningExample[]
  readonly negative: readonly NegativeOpeningExample[]
  readonly needed: number
}

export type ContinueOpeningGeneratorInput = {
  readonly needed: number
  readonly previousRoundResults: readonly RoundResultForOpening[]
  readonly excludedOpenings: readonly string[]
}

export type OpeningGeneratorStartResult = {
  readonly session: AgentSession<readonly string[]>
  readonly initialOpenings: readonly string[]
}

@Injectable()
export class OpeningGeneratorAgentService {
  private readonly logger: Logger = new Logger(OpeningGeneratorAgentService.name)

  public constructor(private readonly runner: ClaudeAgentRunnerService) {}

  public async startForRoom(
    roomCode: string,
    input: StartOpeningGeneratorInput
  ): Promise<OpeningGeneratorStartResult> {
    const userPrompt: string = this.buildStartPrompt(input)
    const { session, response } = await this.runner.start<readonly string[]>(
      OPENING_GENERATOR_AGENT_CONFIG,
      userPrompt
    )
    const openings: readonly string[] = response.parsed ?? []
    this.logger.log(
      `opening_generator_start room=${roomCode} session=${session.id} returned=${openings.length} requested=${input.needed * 3}`
    )
    return { session, initialOpenings: openings }
  }

  public async generateMore(
    session: AgentSession<readonly string[]>,
    input: ContinueOpeningGeneratorInput
  ): Promise<readonly string[]> {
    const userPrompt: string = this.buildContinuePrompt(input)
    const response = await this.runner.continue<readonly string[]>(session, userPrompt)
    const openings: readonly string[] = response.parsed ?? []
    this.logger.log(
      `opening_generator_more session=${session.id} returned=${openings.length} requested=${input.needed * 3} excluded=${input.excludedOpenings.length}`
    )
    return openings
  }

  private buildStartPrompt(input: StartOpeningGeneratorInput): string {
    const lines: string[] = []
    lines.push('За этим столом сегодня играют:')
    for (const player of input.players) {
      lines.push(this.formatPlayerProfile(player))
    }
    lines.push('')
    if (input.golden.length > 0) {
      lines.push('GOLDEN — opening\'и, которые залетали лучше всего. Пиши в этом духе, повторяй их структуру и тёмность:')
      for (const example of input.golden) {
        lines.push(`- "${example.text}" [score: ${example.score.toFixed(2)}]`)
      }
      lines.push('')
    }
    if (input.medium.length > 0) {
      lines.push('СРЕДНИЕ — приемлемо, но не вау. Целься выше:')
      for (const example of input.medium) {
        lines.push(`- "${example.text}" [score: ${example.score.toFixed(2)}]`)
      }
      lines.push('')
    }
    if (input.negative.length > 0) {
      lines.push('AVOID — так писать не надо:')
      for (const example of input.negative) {
        const commentSuffix: string = example.adminComment ? ` [admin: ${example.adminComment}]` : ''
        lines.push(`- "${example.text}" [score: ${example.score.toFixed(2)}]${commentSuffix}`)
      }
      lines.push('')
    }
    const target: number = input.needed * 3
    lines.push(
      `Сгенери ${target} разных кандидатов opening'ов на сегодня. Разные темы, разные структуры, разные углы.`,
      'Используй имена игроков и их био — привязывай шутки к их характерам, не вставляй имя ради имени.',
      '',
      `Ответ: JSON-массив строк ровно из ${target} элементов, без markdown fences.`
    )
    return lines.join('\n')
  }

  private buildContinuePrompt(input: ContinueOpeningGeneratorInput): string {
    const lines: string[] = []
    if (input.previousRoundResults.length > 0) {
      lines.push('Результаты прошлого раунда:')
      for (const result of input.previousRoundResults) {
        const feedbackBits: string[] = [
          `👍${result.feedback.up}`,
          `👎${result.feedback.down}`,
          `🤢${result.feedback.broken}`
        ]
        lines.push(`- "${result.opening}" [${feedbackBits.join(' ')}]`)
        for (const punchline of result.topPunchlines) {
          lines.push(`   → "${punchline}"`)
        }
      }
      lines.push('')
      lines.push('Анализ перед генерацией:')
      lines.push('1. Среди успешных опенингов прошлого раунда — какой ТИП setup\'а (см. список типов в системном промпте) сработал? ПОВТОРИ этот тип, но с новой темой/персонажем — рабочая формула это актив, а не запрет.')
      lines.push('2. Какие ТЕМЫ зашли? Темы можно держать в той же зоне (секс/война/смерть/абсурд — что лайкнули), меняй СЦЕНУ и УГОЛ, не саму зону.')
      lines.push('3. Если 👎/🤢 — слабым был именно ТОТ конкретный текст. Не копируй его дословно, но связанную тему/тип setup\'а трогать можно — попробуй другую сцену в той же области.')
      lines.push('')
      lines.push('ВАЖНО: golden\'ы и удачные опенинги — это твой ориентир. Не пытайся искусственно «разнообразить» если рабочий стиль уже найден. Лучше 4 опенинга в найденном духе чем 4 разных но средних.')
      lines.push('')
    }
    if (input.excludedOpenings.length > 0) {
      lines.push('УЖЕ ИСПОЛЬЗОВАНЫ в этой игре — НЕ повторяй и не делай семантически близкие:')
      for (const excluded of input.excludedOpenings) {
        lines.push(`- "${excluded}"`)
      }
      lines.push('')
    }
    const target: number = input.needed * 3
    lines.push(
      `Сгенери ${target} НОВЫХ кандидатов. Миксуй типы setup'ов (действие/место/время/открытие/реакция/ирония/объяснение).`,
      `Ответ: JSON-массив строк ровно из ${target} элементов, без markdown fences.`
    )
    return lines.join('\n')
  }

  private formatPlayerProfile(player: OpeningPlayerProfile): string {
    const bits: string[] = [player.realName]
    if (player.displayName !== player.realName) {
      bits.push(`ник: ${player.displayName}`)
    }
    if (player.gender !== 'not-specified') {
      bits.push(`пол: ${player.gender}`)
    }
    if (player.declaredBio) {
      bits.push(`bio: ${player.declaredBio}`)
    }
    if (player.themes && player.themes.length > 0) {
      bits.push(`темы: ${player.themes.join(', ')}`)
    }
    if (player.portrait) {
      bits.push(`портрет: ${player.portrait}`)
    }
    return `- ${bits.join('; ')}`
  }
}
