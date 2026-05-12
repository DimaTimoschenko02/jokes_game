import { Injectable, Logger } from '@nestjs/common'
import { ClaudeAgentRunnerService } from '../../claude-agent/claude-agent-runner.service'
import { AgentSession } from '../../claude-agent/models/agent-session.type'
import {
  BotPersonality,
  buildBotAgentConfig,
  pickRandomBotPersonality
} from '../configs/bot-agent.config'

export type BotPlayerProfile = {
  readonly userId: string
  readonly realName: string
  readonly displayName: string
  readonly gender: 'male' | 'female' | 'non-binary' | 'not-specified'
  readonly declaredBio?: string
  readonly portrait?: string
  readonly themes?: readonly string[]
}

export type BotFewShotExample = {
  readonly opening: string
  readonly punchline: string
  readonly score: number
  readonly adminComment?: string
}

export type BotGenerateInput = {
  readonly opening: string
  readonly positiveExamples: readonly BotFewShotExample[]
  readonly negativeExamples: readonly BotFewShotExample[]
}

export type BotStartResult = {
  readonly session: AgentSession<readonly string[]>
  readonly personalityName: string
}

@Injectable()
export class BotAgentService {
  private readonly logger: Logger = new Logger(BotAgentService.name)

  public constructor(private readonly runner: ClaudeAgentRunnerService) {}

  public async startForBot(
    roomCode: string,
    botId: string,
    players: readonly BotPlayerProfile[]
  ): Promise<BotStartResult> {
    const personality: BotPersonality = pickRandomBotPersonality()
    const config = buildBotAgentConfig(personality)
    const initialPrompt: string = this.buildInitialPrompt(players)
    const { session } = await this.runner.start<readonly string[]>(config, initialPrompt)
    this.logger.log(
      `bot_start room=${roomCode} bot=${botId} personality=${personality.name} session=${session.id}`
    )
    return { session, personalityName: personality.name }
  }

  public async generateCandidates(
    session: AgentSession<readonly string[]>,
    input: BotGenerateInput
  ): Promise<readonly [string, string]> {
    const userPrompt: string = this.buildPunchlinePrompt(input)
    const response = await this.runner.continue<readonly string[]>(session, userPrompt)
    const candidates = response.parsed
    if (!candidates || candidates.length < 2) {
      throw new Error('Bot did not return 2 candidates')
    }
    return [candidates[0], candidates[1]] as const
  }

  public async pushRoundDigest(
    session: AgentSession<readonly string[]>,
    digestText: string
  ): Promise<void> {
    const ackPrompt: string = [
      digestText,
      '',
      'Это статистика прошлого раунда. Изучи кратко и подтверди "понял" одним словом — JSON-массив из 2 элементов от тебя сейчас не нужен, ответ свободной формой.'
    ].join('\n')
    try {
      await this.runner.continue<readonly string[]>(session, ackPrompt)
    } catch (error) {
      this.logger.warn(`bot_digest_failed session=${session.id} reason="${(error as Error).message}"`)
    }
  }

  private buildInitialPrompt(players: readonly BotPlayerProfile[]): string {
    const profileLines: string[] = players.map((player) => this.formatPlayerProfile(player))
    return [
      'За этим столом сегодня играют:',
      ...profileLines,
      '',
      'Это весь состав. Ниже я буду присылать setup\'ы шуток — пиши на каждый ровно 2 РАЗНЫХ punchline-кандидата (другой угол, другой образ, другая длина).',
      'Каждый ответ — JSON-массив из 2 строк, без markdown fences, без лишнего текста.',
      '',
      'Сейчас подтверди готовность: верни JSON ["готов", "готов"] и жди setup.'
    ].join('\n')
  }

  private formatPlayerProfile(player: BotPlayerProfile): string {
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

  private buildPunchlinePrompt(input: BotGenerateInput): string {
    const lines: string[] = [`Setup: "${input.opening}"`]
    if (input.positiveExamples.length > 0) {
      lines.push('', 'Высоко оценённые примеры из прошлых игр (стремись к такому уровню):')
      for (const example of input.positiveExamples) {
        lines.push(
          `- "${example.opening}" → "${example.punchline}" [score: ${example.score.toFixed(2)}]`
        )
      }
    }
    if (input.negativeExamples.length > 0) {
      lines.push('', 'AVOID — так писать не надо:')
      for (const example of input.negativeExamples) {
        const commentSuffix: string = example.adminComment ? ` [admin: ${example.adminComment}]` : ''
        lines.push(`- "${example.opening}" → "${example.punchline}"${commentSuffix}`)
      }
    }
    lines.push(
      '',
      'Напиши 2 РАЗНЫХ punchline-кандидата. Ответ: JSON-массив строк ровно из 2 элементов. Без markdown, без объяснений.'
    )
    return lines.join('\n')
  }
}
