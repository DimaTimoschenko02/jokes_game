import { Injectable, Logger } from '@nestjs/common'
import { ClaudeAgentRunnerService } from '../../claude-agent/claude-agent-runner.service'
import { AgentSession } from '../../claude-agent/models/agent-session.type'
import { MEMORY_UPDATER_AGENT_CONFIG } from '../configs/memory-updater-agent.config'
import { RoundStats } from './models/round-stats.type'
import { MemoryUpdaterOutput } from './models/user-memory-delta.type'
import { GroupMemoryDelta } from '../../group-memory/models/group-memory-delta.type'
import { UserMemorySnapshot } from './models/user-memory-snapshot.type'

export type MemoryUpdaterStartResult = {
  readonly session: AgentSession<MemoryUpdaterOutput>
  readonly firstRoundUpdates: MemoryUpdaterOutput
}

@Injectable()
export class MemoryUpdaterAgentService {
  private readonly logger: Logger = new Logger(MemoryUpdaterAgentService.name)

  public constructor(private readonly runner: ClaudeAgentRunnerService) {}

  public async startAfterRoundOne(
    roomCode: string,
    snapshots: readonly UserMemorySnapshot[],
    stats: RoundStats
  ): Promise<MemoryUpdaterStartResult> {
    const userPrompt: string = this.buildFirstRoundPrompt(snapshots, stats)
    const { session, response } = await this.runner.start<MemoryUpdaterOutput>(
      MEMORY_UPDATER_AGENT_CONFIG,
      userPrompt
    )
    const updates: MemoryUpdaterOutput = response.parsed ?? { updates: {} }
    this.logger.log(
      `memory_updater_start room=${roomCode} round=${stats.roundIndex} session=${session.id} users_updated=${Object.keys(updates.updates).length}`
    )
    return { session, firstRoundUpdates: updates }
  }

  public async updateAfterRound(
    session: AgentSession<MemoryUpdaterOutput>,
    stats: RoundStats
  ): Promise<MemoryUpdaterOutput> {
    const userPrompt: string = this.buildNextRoundPrompt(stats)
    const response = await this.runner.continue<MemoryUpdaterOutput>(session, userPrompt)
    const updates: MemoryUpdaterOutput = response.parsed ?? { updates: {} }
    this.logger.log(
      `memory_updater_round session=${session.id} round=${stats.roundIndex} users_updated=${Object.keys(updates.updates).length}`
    )
    return updates
  }

  public async finalizeGroupMemory(
    session: AgentSession<MemoryUpdaterOutput>,
    input: { readonly currentText: string; readonly summaryRequested: boolean }
  ): Promise<GroupMemoryDelta> {
    const userPrompt: string = this.buildGroupFinalizePrompt(input)
    const response = await this.runner.continue<MemoryUpdaterOutput>(session, userPrompt)
    const delta: GroupMemoryDelta = response.parsed?.groupMemoryDelta ?? {}
    this.logger.log(
      `memory_updater_group_finalize session=${session.id} themes=${delta.themesDelta?.length ?? 0} inJokes=${delta.inJokesDelta?.length ?? 0} summary=${delta.newSummaryText ? 'yes' : 'no'}`
    )
    return delta
  }

  private buildGroupFinalizePrompt(input: {
    readonly currentText: string
    readonly summaryRequested: boolean
  }): string {
    const lines: string[] = [
      'Игра завершена. Ты видел все раунды этой игры выше.',
      'Обнови ПАМЯТЬ КОМПАНИИ — общий контекст про этих людей как компанию.',
      '',
      '# Текущая память компании:',
      input.currentText,
      '',
      'Верни JSON: {"updates": {}, "groupMemoryDelta": { ... }}.',
      '- updates оставь пустым объектом {} — память игроков уже обновлена по раундам.',
      '- groupMemoryDelta — только ИЗМЕНЕНИЯ относительно текущей памяти компании выше.'
    ]
    if (input.summaryRequested) {
      lines.push(
        '- Также верни newSummaryText: 4-8 предложений свободного саммари про компанию (то, что не лезет в структурные поля). Не повторяй дословно то, что уже в themes/inJokes/triggers.'
      )
    } else {
      lines.push('- newSummaryText НЕ возвращай в этот раз.')
    }
    return lines.join('\n')
  }

  private buildFirstRoundPrompt(
    snapshots: readonly UserMemorySnapshot[],
    stats: RoundStats
  ): string {
    const lines: string[] = ['# Профили игроков (база, на основе которой обновляешь):', '']
    for (const snapshot of snapshots) {
      lines.push(this.formatSnapshot(snapshot))
      lines.push('')
    }
    lines.push('# Статистика раунда 1:', '')
    lines.push(this.formatRoundStats(stats))
    lines.push('')
    lines.push(
      'Верни JSON-объект `{ "updates": { <userId>: { themesDelta?, voterPreferencesDelta?, authorStyleDelta?, newPortrait? } } }`.',
      'Включай только тех игроков, для которых есть НОВЫЕ наблюдения. Поля внутри дельты тоже включай только изменённые.'
    )
    return lines.join('\n')
  }

  private buildNextRoundPrompt(stats: RoundStats): string {
    const lines: string[] = [`# Статистика раунда ${stats.roundIndex}:`, '']
    lines.push(this.formatRoundStats(stats))
    lines.push('')
    lines.push(
      'Профили игроков и их текущая память — уже в контексте сессии. Верни JSON-дельты только для тех, у кого есть новые наблюдения.'
    )
    return lines.join('\n')
  }

  private formatSnapshot(snapshot: UserMemorySnapshot): string {
    const lines: string[] = [`## ${snapshot.realName} (userId: ${snapshot.userId})`]
    const bits: string[] = [`gender: ${snapshot.gender}`]
    if (snapshot.ageBand) {
      bits.push(`age: ${snapshot.ageBand}`)
    }
    if (snapshot.declaredBio) {
      bits.push(`bio: ${snapshot.declaredBio}`)
    }
    lines.push(`- ${bits.join('; ')}`)
    if (snapshot.themes.length > 0) {
      lines.push(`- themes: ${snapshot.themes.map((t) => `${t.theme}(${t.confidence.toFixed(2)}, m=${t.mentions})`).join(', ')}`)
    }
    lines.push(
      `- voterPreferences: dark=${snapshot.voterPreferences.darkPreference.toFixed(2)}, callback=${snapshot.voterPreferences.callbackPreference.toFixed(2)}, absurd=${snapshot.voterPreferences.absurdPreference.toFixed(2)}, irony=${snapshot.voterPreferences.ironyPreference.toFixed(2)}`
    )
    lines.push(
      `- authorStyle: avgLen=${snapshot.authorStyle.avgPunchlineLength.toFixed(1)}, structures=[${snapshot.authorStyle.preferredStructures.join(', ')}]`
    )
    if (snapshot.portrait) {
      lines.push(`- portrait: ${snapshot.portrait}`)
    }
    return lines.join('\n')
  }

  private formatRoundStats(stats: RoundStats): string {
    const lines: string[] = []
    if (stats.jokes.length > 0) {
      lines.push('### Шутки этого раунда:')
      for (const joke of stats.jokes) {
        const ratingPart: string =
          joke.ratingAverage !== null
            ? ` rating=${joke.ratingAverage.toFixed(2)} (${joke.ratingCount} оценок)`
            : ` (без оценок)`
        lines.push(
          `- "${joke.opening}" → "${joke.punchline}" — автор: ${joke.authorRealName} (${joke.authorUserId ?? 'bot'})${ratingPart}`
        )
      }
      lines.push('')
    }
    if (stats.duels.length > 0) {
      lines.push('### Дуэли этого раунда:')
      for (const duel of stats.duels) {
        lines.push(
          `- opening: "${duel.opening}" — победил: "${duel.winnerPunchline}" (${duel.votesFor} vs ${duel.votesAgainst}); проиграл: "${duel.loserPunchline}". Голосовали: [${duel.votersUserIds.join(', ')}]`
        )
      }
    }
    return lines.join('\n')
  }
}
