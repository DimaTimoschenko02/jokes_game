import { Injectable, Logger } from '@nestjs/common'
import { ClaudeAgentRunnerService } from '../../claude-agent/claude-agent-runner.service'
import { AgentSession } from '../../claude-agent/models/agent-session.type'
import { JUDGE_AGENT_CONFIG } from '../configs/judge-agent.config'

const INITIAL_USER_PROMPT: string = [
  'Ты будешь судить punchline-дуэли для этой игры.',
  'Сейчас сообщений нет — жди вызова с opening и двумя кандидатами.',
  'Готов?'
].join('\n')

export type JudgeContext = {
  readonly opening: string
  readonly candidateA: string
  readonly candidateB: string
}

@Injectable()
export class JudgeAgentService {
  private readonly logger: Logger = new Logger(JudgeAgentService.name)

  public constructor(private readonly runner: ClaudeAgentRunnerService) {}

  public async startForRoom(roomCode: string): Promise<AgentSession<never>> {
    const { session } = await this.runner.start<never>(JUDGE_AGENT_CONFIG, INITIAL_USER_PROMPT)
    this.logger.log(`judge_start room=${roomCode} session=${session.id}`)
    return session
  }

  public async pickWinner(
    session: AgentSession<never>,
    context: JudgeContext
  ): Promise<string> {
    const userPrompt: string = this.buildPickWinnerPrompt(context)
    try {
      const response = await this.runner.continue<never>(session, userPrompt)
      const winner: string = this.cleanWinner(response.raw)
      if (winner.length === 0) {
        this.logger.warn(`judge_empty_winner falling_back_to_first`)
        return context.candidateA
      }
      return winner
    } catch (error) {
      this.logger.warn(`judge_failed falling_back_to_first reason="${(error as Error).message}"`)
      return context.candidateA
    }
  }

  private buildPickWinnerPrompt(context: JudgeContext): string {
    return [
      `Opening: "${context.opening}"`,
      '',
      `Кандидат A: "${context.candidateA}"`,
      `Кандидат B: "${context.candidateB}"`,
      '',
      'Выбери победителя. Ответь только его текстом, дословно как он написан.'
    ].join('\n')
  }

  private cleanWinner(raw: string): string {
    const trimmed: string = raw.trim()
    const withoutQuotes: string = trimmed.replace(/^["«]+|["»]+$/g, '').trim()
    const firstLine: string = withoutQuotes.split('\n')[0] ?? ''
    return firstLine.trim()
  }
}
