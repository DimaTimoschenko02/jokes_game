import { Injectable, Logger } from '@nestjs/common'
import { ClaudeAgentRunnerService } from '../../claude-agent/claude-agent-runner.service'
import { AgentSession } from '../../claude-agent/models/agent-session.type'
import { BOT_AGENT_CONFIG } from '../configs/bot-agent.config'

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
  readonly session: AgentSession<never>
}

@Injectable()
export class BotAgentService {
  private readonly logger: Logger = new Logger(BotAgentService.name)

  public constructor(private readonly runner: ClaudeAgentRunnerService) {}

  public async startForBot(
    roomCode: string,
    botId: string,
    players: readonly BotPlayerProfile[],
    groupMemory?: string
  ): Promise<BotStartResult> {
    const initialPrompt: string = this.buildInitialPrompt(players, groupMemory)
    const { session } = await this.runner.start<never>(BOT_AGENT_CONFIG, initialPrompt)
    this.logger.log(`bot_start room=${roomCode} bot=${botId} session=${session.id}`)
    return { session }
  }

  public async generatePunchline(
    session: AgentSession<never>,
    input: BotGenerateInput
  ): Promise<string> {
    const userPrompt: string = this.buildPunchlinePrompt(input)
    const response = await this.runner.continue<never>(session, userPrompt)
    return this.cleanPunchline(response.raw)
  }

  public async pushRoundDigest(
    session: AgentSession<never>,
    digestText: string
  ): Promise<void> {
    const ackPrompt: string = [
      digestText,
      '',
      'Это статистика прошлого раунда. Изучи кратко и подтверди "понял" одним словом.'
    ].join('\n')
    try {
      await this.runner.continue<never>(session, ackPrompt)
    } catch (error) {
      this.logger.warn(`bot_digest_failed session=${session.id} reason="${(error as Error).message}"`)
    }
  }

  private buildInitialPrompt(
    players: readonly BotPlayerProfile[],
    groupMemory?: string
  ): string {
    const profileLines: string[] = players.map((player) => this.formatPlayerProfile(player))
    const lines: string[] = ['За этим столом сегодня играют:', ...profileLines]
    if (groupMemory) {
      lines.push('', groupMemory)
    }
    lines.push(
      '',
      'Это весь состав. Ниже я буду присылать setup\'ы шуток — пиши на каждый ровно ОДНУ строку с твоим лучшим punchline. Без вариантов, без markdown, без кавычек, без объяснений.',
      '',
      'Сейчас подтверди готовность одним словом "готов" и жди setup.'
    )
    return lines.join('\n')
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
    lines.push('', 'Ответ — одна строка с punchline. Без markdown, без кавычек, без объяснений.')
    return lines.join('\n')
  }

  private cleanPunchline(raw: string): string {
    const trimmed: string = raw.trim()
    const withoutQuotes: string = trimmed.replace(/^["«]+|["»]+$/g, '').trim()
    const firstLine: string = withoutQuotes.split('\n')[0] ?? ''
    return firstLine.trim()
  }
}
