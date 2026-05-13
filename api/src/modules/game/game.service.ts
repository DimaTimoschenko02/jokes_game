import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { BotAgentService, BotFewShotExample, BotPlayerProfile } from '../agents/bot/bot-agent.service'
import { MemoryUpdaterAgentService } from '../agents/memory-updater/memory-updater-agent.service'
import { MemoryUpdaterOutput } from '../agents/memory-updater/models/user-memory-delta.type'
import { UserMemorySnapshot } from '../agents/memory-updater/models/user-memory-snapshot.type'
import { RoundDuelStat, RoundJokeStat, RoundStats } from '../agents/memory-updater/models/round-stats.type'
import {
  GoldenOpeningExample,
  NegativeOpeningExample,
  OpeningGeneratorAgentService,
  OpeningPlayerProfile
} from '../agents/opening-generator/opening-generator-agent.service'
import { OpeningSelectionService } from '../agents/opening-selection/opening-selection.service'
import { AiService, BOT_FALLBACK_MARKER } from '../ai/ai.service'
import { ClaudeAgentRunnerService } from '../claude-agent/claude-agent-runner.service'
import { AgentSession } from '../claude-agent/models/agent-session.type'
import { JokeMemoryService } from '../joke-memory/joke-memory.service'
import { PromptStarterService } from '../prompt-starter/prompt-starter.service'
import {
  BOT_COUNT_MAX,
  BOT_COUNT_MIN,
  ROUND_COUNT_DEFAULT,
  ROUND_COUNT_MAX,
  ROUND_COUNT_MIN,
  RATING_PHASE_SECONDS,
  SCOREBOARD_PHASE_SECONDS,
  VOTING_PHASE_SECONDS,
  WRITING_PHASE_SECONDS
} from './constants/game.constants'
import { ClientDuel } from './models/client-duel.type'
import { ClientGameState } from './models/client-game-state.type'
import { ClientPlayer } from './models/client-player.type'
import { GameRoom, GameRoomSessions } from './models/game-room.type'
import { PlayerSession } from './models/player-session.type'
import { SocketPlayerLink } from './models/socket-player-link.type'
import { UserProfile } from '../user/models/user-profile.type'
import { UserMemoryService } from '../user/user-memory.service'
import {
  buildCircularPromptAssignments,
  buildPlayerContext,
  createBotPlayer,
  createDuelsForPrompts,
  createHumanPlayer,
  createRatingItems,
  createRoomCode,
  createSubmission,
  getAnswerForPromptIndex,
  normalizeAnswer
} from './game.utils'

type BroadcastFn = (roomCode: string) => void

const LOCAL_FALLBACK_ANSWER: string = '[NO_ANSWER]'

const isFallbackPunchline = (punchline: string): boolean =>
  punchline === BOT_FALLBACK_MARKER || punchline === LOCAL_FALLBACK_ANSWER

@Injectable()
export class GameService {
  private readonly logger: Logger = new Logger(GameService.name)
  private readonly rooms: Map<string, GameRoom> = new Map<string, GameRoom>()
  private readonly socketLinks: Map<string, SocketPlayerLink> = new Map<string, SocketPlayerLink>()
  private broadcastState: BroadcastFn = () => undefined
  private botDuelWins: number = 0
  private botDuelTotal: number = 0

  public constructor(
    private readonly aiService: AiService,
    private readonly jokeMemoryService: JokeMemoryService,
    private readonly promptStarterService: PromptStarterService,
    private readonly botAgent: BotAgentService,
    private readonly openingGeneratorAgent: OpeningGeneratorAgentService,
    private readonly openingSelection: OpeningSelectionService,
    private readonly memoryUpdaterAgent: MemoryUpdaterAgentService,
    private readonly claudeRunner: ClaudeAgentRunnerService,
    private readonly userMemoryService: UserMemoryService
  ) {}

  private createEmptySessions(): GameRoomSessions {
    return {
      openingGenerator: null,
      botSessions: new Map(),
      memoryUpdater: null
    }
  }

  public setBroadcast(fn: BroadcastFn): void {
    this.broadcastState = fn
  }

  public async createRoom(input: {
    readonly socketId: string
    readonly host: UserProfile
    readonly roundCount: number
    readonly botCount: number
  }): Promise<PlayerSession> {
    const host = createHumanPlayer({
      userId: input.host.id,
      socketId: input.socketId,
      displayName: input.host.displayName,
      realName: input.host.realName,
      bio: input.host.bio,
      gender: input.host.gender
    })
    const roomCode = createRoomCode()
    const room: GameRoom = {
      code: roomCode,
      hostPlayerId: host.id,
      players: new Map([[host.id, host]]),
      roundCount: this.normalizeRoundCount(input.roundCount),
      botCount: this.normalizeBotCount(input.botCount),
      phase: 'lobby',
      roundIndex: 0,
      prompts: [],
      allOpenings: [],
      usedPromptTexts: [],
      promptAssignments: new Map(),
      submissions: new Map(),
      duels: [],
      duelIndex: 0,
      ratingItems: [],
      ratingSubmissions: new Map(),
      roundVotes: new Map(),
      timerEndsAt: null,
      isStarting: false,
      timerHandle: null,
      prefetchOpeningsPromise: null,
      aiStatus: 'idle',
      sessions: this.createEmptySessions(),
      userMemorySnapshots: [],
      memoryDeltasLog: [],
      memoryUpdaterInFlight: null
    }
    this.createBots(room)
    this.rooms.set(roomCode, room)
    this.socketLinks.set(input.socketId, { roomCode, playerId: host.id })
    this.emitRoomState(roomCode)
    return { roomCode, playerId: host.id }
  }

  public joinRoom(input: {
    readonly socketId: string
    readonly roomCode: string
    readonly user: UserProfile
  }): PlayerSession {
    const room = this.getRoomOrFail(input.roomCode)
    const existing = room.players.get(input.user.id)
    if (existing && !existing.isBot) {
      existing.socketId = input.socketId
      existing.connected = true
      this.socketLinks.set(input.socketId, { roomCode: room.code, playerId: existing.id })
      this.emitRoomState(room.code)
      return { roomCode: room.code, playerId: existing.id }
    }
    this.ensureLobbyPhase(room)
    const player = createHumanPlayer({
      userId: input.user.id,
      socketId: input.socketId,
      displayName: input.user.displayName,
      realName: input.user.realName,
      bio: input.user.bio,
      gender: input.user.gender
    })
    room.players.set(player.id, player)
    this.socketLinks.set(input.socketId, { roomCode: room.code, playerId: player.id })
    this.emitRoomState(room.code)
    return { roomCode: room.code, playerId: player.id }
  }

  public reconnectPlayer(input: { readonly socketId: string; readonly roomCode: string; readonly playerId: string }): void {
    const room = this.getRoomOrFail(input.roomCode)
    const player = this.getPlayerOrFail(room, input.playerId)
    player.connected = true
    player.socketId = input.socketId
    this.socketLinks.set(input.socketId, { roomCode: room.code, playerId: player.id })
    this.emitRoomState(room.code)
  }

  public handleDisconnect(socketId: string): void {
    const link = this.socketLinks.get(socketId)
    if (!link) {
      return
    }
    this.socketLinks.delete(socketId)
    const room = this.rooms.get(link.roomCode)
    if (!room) {
      return
    }
    const player = room.players.get(link.playerId)
    if (!player || player.isBot) {
      return
    }
    player.connected = false
    player.socketId = null
    this.reassignHostIfNeeded(room, player.id)
    this.emitRoomState(room.code)
  }

  public async startGame(input: { readonly roomCode: string; readonly playerId: string }): Promise<void> {
    const room = this.getRoomOrFail(input.roomCode)
    this.ensureHost(room, input.playerId)
    this.ensureLobbyPhase(room)
    this.ensureEvenPlayerCount(room)
    if (room.isStarting) {
      this.logger.warn(`start_game_already_in_progress room=${room.code}`)
      return
    }
    room.isStarting = true
    room.aiStatus = 'generating'
    this.emitRoomState(room.code)
    try {
      this.resetPlayerScores(room)
      room.roundIndex = 0
      if (room.prefetchOpeningsPromise) {
        await room.prefetchOpeningsPromise.catch(() => undefined)
      }
      room.userMemorySnapshots = await this.buildUserMemorySnapshots(room)
      await this.prewarmBotSessions(room)
      await this.generateOpeningsForRound(room, 1)
      await this.startWritingPhase(room.code)
    } finally {
      room.isStarting = false
      if (room.aiStatus === 'generating') {
        room.aiStatus = 'idle'
      }
    }
  }

  private async prewarmBotSessions(room: GameRoom): Promise<void> {
    const botPlayers = Array.from(room.players.values()).filter((player) => player.isBot)
    if (botPlayers.length === 0) {
      return
    }
    const profiles = this.buildBotPlayerProfiles(room)
    await Promise.all(
      botPlayers.map(async (bot) => {
        try {
          const result = await this.botAgent.startForBot(room.code, bot.id, profiles)
          room.sessions.botSessions.set(bot.id, {
            session: result.session
          })
        } catch (error: unknown) {
          this.logger.warn(
            `bot_session_start_failed room=${room.code} bot=${bot.id} error=${error instanceof Error ? error.message : String(error)}`
          )
        }
      })
    )
  }

  private buildOpeningPlayerProfiles(room: GameRoom): readonly OpeningPlayerProfile[] {
    return Array.from(room.players.values())
      .filter((player) => !player.isBot)
      .map((player) => ({
        userId: player.id,
        realName: player.realName,
        displayName: player.name,
        gender: player.gender,
        declaredBio: player.bio || undefined
      }))
  }

  private buildBotPlayerProfiles(room: GameRoom): readonly BotPlayerProfile[] {
    return Array.from(room.players.values())
      .filter((player) => !player.isBot)
      .map((player) => ({
        userId: player.id,
        realName: player.realName,
        displayName: player.name,
        gender: player.gender,
        declaredBio: player.bio || undefined
      }))
  }

  private async buildUserMemorySnapshots(room: GameRoom): Promise<readonly UserMemorySnapshot[]> {
    const humans = Array.from(room.players.values()).filter((player) => !player.isBot)
    return Promise.all(
      humans.map((player) =>
        this.userMemoryService.buildSnapshot({
          userId: player.id,
          realName: player.realName,
          gender: player.gender,
          bio: player.bio || null
        })
      )
    )
  }

  private async generateOpeningsForRound(room: GameRoom, roundNumber: number): Promise<void> {
    const playerCount = room.players.size
    const needed = playerCount
    const offset = (roundNumber - 1) * playerCount
    if (room.allOpenings.length >= offset + needed) {
      return
    }

    const canUseAgent: boolean = room.isStarting || room.phase !== 'lobby'
    if (canUseAgent) {
      const agentStart = Date.now()
      try {
        const viaAgent = await this.generateOpeningsViaAgent(room, needed)
        if (viaAgent.length >= needed) {
          room.allOpenings.push(...viaAgent.slice(0, needed))
          this.logger.log(
            `generate_round_openings_via_agent room=${room.code} round=${roundNumber} count=${viaAgent.length} elapsed_ms=${Date.now() - agentStart}`
          )
          return
        }
        this.logger.warn(
          `generate_round_openings_agent_short room=${room.code} round=${roundNumber} got=${viaAgent.length} needed=${needed} falling_back_legacy`
        )
      } catch (error: unknown) {
        this.logger.warn(
          `generate_round_openings_agent_failed room=${room.code} round=${roundNumber} error=${error instanceof Error ? error.message : String(error)} falling_back_legacy`
        )
      }
    }

    const playerNames = this.getHumanPlayerNames(room)
    const playerContext = buildPlayerContext(room.players)
    const goldenExamples = await this.promptStarterService.getGoldenExamples(10)

    const startMs = Date.now()
    this.logger.log(`generate_round_openings_legacy room=${room.code} round=${roundNumber} needed=${needed} already=${room.allOpenings.length} golden_examples=${goldenExamples.length}`)

    const openings = await this.aiService.generateAllOpenings({
      needed,
      playerNames,
      playerContext,
      goldenExamples,
      excludedOpenings: room.allOpenings
    })

    const elapsedMs = Date.now() - startMs

    if (openings.length >= needed) {
      room.allOpenings.push(...openings)
      this.logger.log(`generate_round_openings_ok room=${room.code} round=${roundNumber} count=${openings.length} elapsed_ms=${elapsedMs} source=ai`)
      return
    }

    this.logger.warn(`generate_round_openings_insufficient room=${room.code} round=${roundNumber} got=${openings.length} needed=${needed} elapsed_ms=${elapsedMs} falling_back_to_db`)
    const fallbackPrompts = await this.promptStarterService.selectPrompts({
      count: needed - openings.length,
      excludedTexts: [...room.allOpenings, ...openings]
    })
    room.allOpenings.push(...openings, ...fallbackPrompts)
    this.logger.log(`generate_round_openings_with_fallback room=${room.code} round=${roundNumber} ai=${openings.length} db=${fallbackPrompts.length} elapsed_ms=${elapsedMs}`)
  }

  private async generateOpeningsViaAgent(
    room: GameRoom,
    needed: number
  ): Promise<readonly string[]> {
    let raw: readonly string[]
    if (!room.sessions.openingGenerator) {
      const players = this.buildOpeningPlayerProfiles(room)
      const [golden, negative] = await Promise.all([
        this.promptStarterService.getGoldenExamplesDetailed(10),
        this.promptStarterService.getNegativeOpeningExamples(5) as Promise<readonly NegativeOpeningExample[]>
      ])
      const result = await this.openingGeneratorAgent.startForRoom(room.code, {
        players,
        golden,
        negative,
        needed
      })
      room.sessions.openingGenerator = result.session
      raw = result.initialOpenings
    } else {
      raw = await this.openingGeneratorAgent.generateMore(room.sessions.openingGenerator, {
        needed,
        previousRoundResults: [],
        excludedOpenings: room.allOpenings
      })
    }

    if (raw.length === 0) {
      return []
    }

    const filter = await this.openingSelection.filterByHistorySimilarity(raw)
    const accepted = [...filter.accepted]

    if (accepted.length < needed && room.sessions.openingGenerator) {
      try {
        const more = await this.openingGeneratorAgent.generateMore(room.sessions.openingGenerator, {
          needed,
          previousRoundResults: [],
          excludedOpenings: [
            ...room.allOpenings,
            ...accepted.map((a) => a.text),
            ...filter.rejectedAsDuplicates
          ]
        })
        const filterMore = await this.openingSelection.filterByHistorySimilarity(more)
        accepted.push(...filterMore.accepted)
      } catch (error: unknown) {
        this.logger.warn(
          `opening_agent_retry_failed room=${room.code} error=${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    const diverse = this.openingSelection.selectDiverse(accepted, needed)
    void this.openingSelection.registerSelected(diverse).catch(() => undefined)
    return diverse.map((opening) => opening.text)
  }

  private prefetchNextRoundOpenings(room: GameRoom): void {
    const nextRound = room.roundIndex + 1
    if (nextRound > room.roundCount) {
      return
    }
    if (room.prefetchOpeningsPromise) {
      return
    }
    const playerCount = room.players.size
    const offset = (nextRound - 1) * playerCount
    if (room.allOpenings.length >= offset + playerCount) {
      room.aiStatus = 'ready'
      this.emitRoomState(room.code)
      return
    }
    this.logger.log(`prefetch_round_openings_start room=${room.code} round=${nextRound}`)
    room.aiStatus = 'generating'
    this.emitRoomState(room.code)
    room.prefetchOpeningsPromise = this.generateOpeningsForRound(room, nextRound)
      .then(() => {
        this.logger.log(`prefetch_round_openings_done room=${room.code} round=${nextRound}`)
        room.aiStatus = 'ready'
        this.emitRoomState(room.code)
        return room.allOpenings.slice(offset, offset + playerCount)
      })
      .catch((err) => {
        this.logger.warn(`prefetch_round_openings_failed room=${room.code} round=${nextRound} error=${(err as Error).message}`)
        room.aiStatus = 'idle'
        this.emitRoomState(room.code)
        return []
      })
      .finally(() => {
        room.prefetchOpeningsPromise = null
      }) as Promise<readonly string[]>
  }

  private getHumanPlayerNames(room: GameRoom): readonly string[] {
    return Array.from(room.players.values())
      .filter((player) => !player.isBot)
      .map((player) => player.name)
  }

  public submitAnswers(input: { readonly roomCode: string; readonly playerId: string; readonly answers: [string, string] }): void {
    const room = this.getRoomOrFail(input.roomCode)
    if (room.phase !== 'writing') {
      throw new BadRequestException('Writing phase is over')
    }
    const player = this.getPlayerOrFail(room, input.playerId)
    if (player.isBot) {
      return
    }
    this.upsertSubmission(room, input.playerId, input.answers)
    this.emitRoomState(room.code)
    if (this.hasAllAnswers(room)) {
      this.startVotingPhase(room.code)
    }
  }

  public castVote(input: { readonly roomCode: string; readonly playerId: string; readonly duelId: string; readonly side: 'left' | 'right' }): void {
    const room = this.getRoomOrFail(input.roomCode)
    if (room.phase !== 'voting') {
      throw new BadRequestException('Voting phase is not active')
    }
    const duel = room.duels[room.duelIndex]
    if (!duel || duel.id !== input.duelId || duel.closed) {
      throw new BadRequestException('Duel is not active')
    }
    if (!this.canPlayerVote(duel, input.playerId)) {
      throw new BadRequestException('You cannot vote in this duel')
    }
    duel.votes.set(input.playerId, input.side)
    this.emitRoomState(room.code)
    if (this.hasAllVotes(room, duel)) {
      this.advanceVoting(room.code)
    }
  }

  public getSessionBySocket(socketId: string): PlayerSession | null {
    const link = this.socketLinks.get(socketId)
    if (!link) {
      return null
    }
    return { roomCode: link.roomCode, playerId: link.playerId }
  }

  public getStateForPlayer(roomCode: string, playerId: string): ClientGameState {
    const room = this.getRoomOrFail(roomCode)
    return this.toClientState(room, playerId)
  }

  private createBots(room: GameRoom): void {
    for (let index = 0; index < room.botCount; index += 1) {
      this.createBot(room)
    }
  }

  private ensureEvenPlayerCount(room: GameRoom): void {
    if (room.players.size % 2 === 0) {
      return
    }
    this.createBot(room)
    room.botCount += 1
    this.logger.log(`auto_added_bot room=${room.code} players_total=${room.players.size}`)
    this.emitRoomState(room.code)
  }

  private createBot(room: GameRoom): void {
    const botCount = Array.from(room.players.values()).filter((player) => player.isBot).length
    const bot = createBotPlayer({ botNumber: botCount + 1 })
    room.players.set(bot.id, bot)
  }

  private normalizeRoundCount(value: number): number {
    return Math.max(ROUND_COUNT_MIN, Math.min(ROUND_COUNT_MAX, Math.floor(value || ROUND_COUNT_DEFAULT)))
  }

  private normalizeBotCount(value: number): number {
    return Math.max(BOT_COUNT_MIN, Math.min(BOT_COUNT_MAX, Math.floor(value || BOT_COUNT_MIN)))
  }

  private getRoomOrFail(roomCode: string): GameRoom {
    const room = this.rooms.get(roomCode)
    if (!room) {
      throw new NotFoundException('Room not found')
    }
    return room
  }

  private getPlayerOrFail(room: GameRoom, playerId: string) {
    const player = room.players.get(playerId)
    if (!player) {
      throw new NotFoundException('Player not found')
    }
    return player
  }

  private ensureHost(room: GameRoom, playerId: string): void {
    if (room.hostPlayerId !== playerId) {
      throw new BadRequestException('Only host can perform this action')
    }
  }

  private ensureLobbyPhase(room: GameRoom): void {
    if (room.phase !== 'lobby') {
      throw new BadRequestException('Game already started')
    }
  }

  private resetPlayerScores(room: GameRoom): void {
    room.players.forEach((player) => {
      player.score = 0
    })
  }

  private reassignHostIfNeeded(room: GameRoom, disconnectedPlayerId: string): void {
    if (room.hostPlayerId !== disconnectedPlayerId) {
      return
    }
    const nextHost = Array.from(room.players.values()).find((player) => !player.isBot && player.connected)
    if (nextHost) {
      room.hostPlayerId = nextHost.id
    }
  }

  private clearRoomTimer(room: GameRoom): void {
    if (room.timerHandle) {
      clearTimeout(room.timerHandle)
    }
    room.timerHandle = null
    room.timerEndsAt = null
  }

  private setRoomTimer(room: GameRoom, seconds: number, callback: () => void): void {
    this.clearRoomTimer(room)
    room.timerEndsAt = Date.now() + seconds * 1000
    room.timerHandle = setTimeout(callback, seconds * 1000)
  }

  private emitRoomState(roomCode: string): void {
    const room = this.rooms.get(roomCode)
    if (!room) {
      return
    }
    this.broadcastState(roomCode)
  }

  private async startWritingPhase(roomCode: string): Promise<void> {
    const room = this.getRoomOrFail(roomCode)
    const nextRound = room.roundIndex + 1
    const playerCount = room.players.size
    const expectedOffset = (nextRound - 1) * playerCount
    if (room.allOpenings.length < expectedOffset + playerCount) {
      if (room.prefetchOpeningsPromise) {
        this.logger.log(`writing_phase_awaiting_prefetch room=${room.code} round=${nextRound}`)
        await room.prefetchOpeningsPromise.catch(() => undefined)
      }
      if (room.allOpenings.length < expectedOffset + playerCount) {
        await this.generateOpeningsForRound(room, nextRound)
      }
    }
    room.roundIndex = nextRound
    room.phase = 'writing'
    room.duels = []
    room.duelIndex = 0
    room.ratingItems = []
    room.ratingSubmissions = new Map()
    room.roundVotes = new Map()
    room.submissions = new Map()
    const playerIds = Array.from(room.players.keys())
    const roundOffset = expectedOffset
    const roundOpenings = room.allOpenings.slice(roundOffset, roundOffset + playerCount)
    if (roundOpenings.length < playerCount) {
      this.logger.warn(`writing_phase_insufficient_openings room=${room.code} round=${room.roundIndex} got=${roundOpenings.length} needed=${playerCount}`)
      const fallback = await this.promptStarterService.selectPrompts({
        count: playerCount - roundOpenings.length,
        excludedTexts: room.usedPromptTexts
      })
      roundOpenings.push(...fallback)
    }
    room.prompts = roundOpenings
    room.usedPromptTexts.push(...roundOpenings)
    room.promptAssignments = buildCircularPromptAssignments(playerIds)
    this.logger.log(`writing_phase_start room=${room.code} round=${room.roundIndex}/${room.roundCount} players=${playerCount} bots=${Array.from(room.players.values()).filter((p) => p.isBot).length}`)
    room.players.forEach((player) => {
      const assignment = room.promptAssignments.get(player.id)
      if (!assignment) {
        return
      }
      room.submissions.set(player.id, createSubmission(player.id, assignment))
    })
    this.emitRoomState(room.code)
    this.generateBotAnswers(room)
    this.prefetchNextRoundOpenings(room)
    this.setRoomTimer(room, WRITING_PHASE_SECONDS, () => this.startVotingPhase(room.code))
  }

  private generateBotAnswers(room: GameRoom): void {
    room.players.forEach((player) => {
      if (!player.isBot) {
        return
      }
      void this.createBotSubmission(room.code, player.id)
    })
  }

  private fillMissingBotAnswers(room: GameRoom): void {
    room.players.forEach((player) => {
      if (!player.isBot) {
        return
      }
      const submission = room.submissions.get(player.id)
      if (!submission) {
        return
      }
      if (!submission.answers[0]) {
        submission.answers[0] = LOCAL_FALLBACK_ANSWER
      }
      if (!submission.answers[1]) {
        submission.answers[1] = LOCAL_FALLBACK_ANSWER
      }
    })
  }

  private async createBotSubmission(roomCode: string, playerId: string): Promise<void> {
    const room = this.rooms.get(roomCode)
    if (!room || room.phase !== 'writing') {
      return
    }
    const delayMs = 500 + Math.floor(Math.random() * 1500)
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), delayMs)
    })
    const submission = room.submissions.get(playerId)
    if (!submission) {
      return
    }
    const promptOne = room.prompts[submission.assignedPromptIndices[0]]
    const promptTwo = room.prompts[submission.assignedPromptIndices[1]]
    const playerNames = this.getHumanPlayerNames(room)
    const playerContext = buildPlayerContext(room.players)
    const answers: [string, string] = [
      await this.generateSafeBotAnswer(room, playerId, promptOne, playerNames, playerContext),
      await this.generateSafeBotAnswer(room, playerId, promptTwo, playerNames, playerContext)
    ]
    if (room.phase !== 'writing') {
      return
    }
    this.upsertSubmission(room, playerId, answers)
    this.emitRoomState(room.code)
    if (this.hasAllAnswers(room)) {
      this.startVotingPhase(room.code)
    }
  }

  private async generateSafeBotAnswer(
    room: GameRoom,
    botId: string,
    prompt: string,
    playerNames: readonly string[],
    playerContext: string
  ): Promise<string> {
    const session = room.sessions.botSessions.get(botId)?.session
    if (session) {
      try {
        const punchline = await this.generatePunchlineViaAgent(session, prompt)
        if (punchline) {
          return normalizeAnswer(punchline)
        }
      } catch (error: unknown) {
        this.logger.warn(
          `bot_agent_punchline_failed room=${room.code} bot=${botId} error=${error instanceof Error ? error.message : String(error)} falling_back_legacy`
        )
      }
    }
    const timeoutPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve(LOCAL_FALLBACK_ANSWER), 60_000)
    })
    const aiPromise = this.aiService
      .generateBotAnswer({ prompt, playerNames, playerContext })
      .then((value) => normalizeAnswer(value))
    return Promise.race([aiPromise, timeoutPromise]).catch(() => LOCAL_FALLBACK_ANSWER)
  }

  private async generatePunchlineViaAgent(
    session: AgentSession<never>,
    prompt: string
  ): Promise<string | null> {
    const examples = await this.jokeMemoryService.executeRetrieveBotExamples({ prompt })
    const positive: readonly BotFewShotExample[] = examples.positive.map((entry) => ({
      opening: entry.prompt,
      punchline: entry.punchline,
      score: entry.useScore,
      adminComment: entry.adminComment
    }))
    const negative: readonly BotFewShotExample[] = examples.negative.map((entry) => ({
      opening: entry.prompt,
      punchline: entry.punchline,
      score: entry.useScore,
      adminComment: entry.adminComment
    }))
    const result = await this.botAgent.generatePunchline(session, {
      opening: prompt,
      positiveExamples: positive,
      negativeExamples: negative
    })
    return result || null
  }

  private upsertSubmission(room: GameRoom, playerId: string, answers: [string, string]): void {
    const assignment = room.promptAssignments.get(playerId)
    const existing = room.submissions.get(playerId)
    const current = existing ?? (assignment ? createSubmission(playerId, assignment) : null)
    if (!current) {
      return
    }
    current.answers = [normalizeAnswer(answers[0]), normalizeAnswer(answers[1])]
    current.submittedAt = Date.now()
    room.submissions.set(playerId, current)
  }

  private hasAllAnswers(room: GameRoom): boolean {
    return Array.from(room.submissions.values()).every((submission) => submission.answers[0] && submission.answers[1])
  }

  private startVotingPhase(roomCode: string): void {
    const room = this.rooms.get(roomCode)
    if (!room || room.phase !== 'writing') {
      return
    }
    this.fillMissingBotAnswers(room)
    room.phase = 'voting'
    room.duels = createDuelsForPrompts(room)
    room.duelIndex = 0
    room.ratingItems = createRatingItems(room)
    this.logger.log(`voting_phase_start room=${room.code} round=${room.roundIndex} duels=${room.duels.length} rating_items=${room.ratingItems.length}`)
    this.emitRoomState(room.code)
    this.scheduleBotVote(room)
    this.setRoomTimer(room, VOTING_PHASE_SECONDS, () => this.advanceVoting(room.code))
  }

  private scheduleBotVote(room: GameRoom): void {
    const duel = room.duels[room.duelIndex]
    if (!duel) {
      return
    }
    room.players.forEach((player) => {
      if (!player.isBot) {
        return
      }
      if (!this.canPlayerVote(duel, player.id)) {
        return
      }
      const delayMs = 900 + Math.floor(Math.random() * 1600)
      setTimeout(() => {
        const currentRoom = this.rooms.get(room.code)
        if (!currentRoom || currentRoom.phase !== 'voting') {
          return
        }
        const currentDuel = currentRoom.duels[currentRoom.duelIndex]
        if (!currentDuel || currentDuel.closed || !this.canPlayerVote(currentDuel, player.id)) {
          return
        }
        const side: 'left' | 'right' = Math.random() > 0.5 ? 'left' : 'right'
        currentDuel.votes.set(player.id, side)
        this.emitRoomState(currentRoom.code)
        if (this.hasAllVotes(currentRoom, currentDuel)) {
          this.advanceVoting(currentRoom.code)
        }
      }, delayMs)
    })
  }

  private canPlayerVote(duel: { readonly leftPlayerId: string; readonly rightPlayerId: string }, playerId: string): boolean {
    return playerId !== duel.leftPlayerId && playerId !== duel.rightPlayerId
  }

  private hasAllVotes(room: GameRoom, duel: { readonly votes: Map<string, 'left' | 'right'>; readonly leftPlayerId: string; readonly rightPlayerId: string }): boolean {
    const eligibleVoters = Array.from(room.players.values()).filter((player) => this.canPlayerVote(duel, player.id))
    return eligibleVoters.every((player) => duel.votes.has(player.id))
  }

  private advanceVoting(roomCode: string): void {
    const room = this.rooms.get(roomCode)
    if (!room || room.phase !== 'voting') {
      return
    }
    this.scoreCurrentDuel(room)
    const hasNextDuel = room.duelIndex + 1 < room.duels.length
    if (hasNextDuel) {
      room.duelIndex += 1
      this.emitRoomState(room.code)
      this.scheduleBotVote(room)
      this.setRoomTimer(room, VOTING_PHASE_SECONDS, () => this.advanceVoting(room.code))
      return
    }
    this.startRatingPhase(room)
  }

  private scoreCurrentDuel(room: GameRoom): void {
    const duel = room.duels[room.duelIndex]
    if (!duel || duel.closed) {
      return
    }
    duel.closed = true
    const leftVotes = this.countVotes(duel.votes, 'left')
    const rightVotes = this.countVotes(duel.votes, 'right')
    this.addScoreToWinners(room, duel.leftPlayerId, leftVotes)
    this.addScoreToWinners(room, duel.rightPlayerId, rightVotes)
    this.trackBotDuelMetrics(room, duel.leftPlayerId, duel.rightPlayerId, leftVotes, rightVotes)
    this.maybeLogBotMetrics()
    this.recordRoundVotes(room, duel.promptIndex, duel.leftPlayerId, duel.rightPlayerId, leftVotes, rightVotes)
  }

  private startRatingPhase(room: GameRoom): void {
    room.phase = 'rating'
    room.ratingSubmissions = new Map()
    this.logger.log(`rating_phase_start room=${room.code} round=${room.roundIndex} items=${room.ratingItems.length}`)
    this.emitRoomState(room.code)
    this.setRoomTimer(room, RATING_PHASE_SECONDS, () => this.finishRatingPhase(room.code))
  }

  public submitOpeningFeedback(input: {
    readonly roomCode: string
    readonly playerId: string
    readonly items: readonly { readonly promptIndex: number; readonly level: number }[]
  }): void {
    const room = this.getRoomOrFail(input.roomCode)
    if (room.phase !== 'writing') {
      return
    }
    const player = this.getPlayerOrFail(room, input.playerId)
    if (player.isBot) {
      return
    }
    const allowedLevels: readonly number[] = [-1, -0.5, 0.5, 1]
    for (const item of input.items) {
      if (!allowedLevels.includes(item.level)) {
        continue
      }
      const promptText = room.prompts[item.promptIndex]
      if (!promptText) {
        continue
      }
      void this.promptStarterService
        .applyQuickFeedback({ promptText, level: item.level })
        .catch((error: unknown) => {
          this.logger.warn(
            `opening_feedback_failed room=${room.code} prompt="${promptText.slice(0, 60)}" level=${item.level} error=${error instanceof Error ? error.message : String(error)}`
          )
        })
    }
  }

  public submitRatings(input: {
    readonly roomCode: string
    readonly playerId: string
    readonly ratings: readonly { readonly itemId: string; readonly score: number }[]
  }): void {
    const room = this.getRoomOrFail(input.roomCode)
    if (room.phase !== 'rating') {
      throw new BadRequestException('Rating phase is not active')
    }
    const player = this.getPlayerOrFail(room, input.playerId)
    if (player.isBot) {
      return
    }
    this.applyRatings(room, player.id, input.ratings)
    this.emitRoomState(room.code)
    if (this.hasAllRatings(room)) {
      this.finishRatingPhase(room.code)
    }
  }

  private finishRatingPhase(roomCode: string): void {
    const room = this.rooms.get(roomCode)
    if (!room || room.phase !== 'rating') {
      return
    }
    this.clearRoomTimer(room)
    this.persistRoundRatings(room)
    const updaterPromise: Promise<void> = this.runMemoryUpdater(room)
      .catch((error: unknown) => {
        this.logger.warn(
          `memory_updater_failed room=${room.code} round=${room.roundIndex} error=${error instanceof Error ? error.message : String(error)}`
        )
      })
      .finally(() => {
        if (room.memoryUpdaterInFlight === updaterPromise) {
          room.memoryUpdaterInFlight = null
        }
      })
    room.memoryUpdaterInFlight = updaterPromise
    this.startScoreboardPhase(room)
  }

  private async runMemoryUpdater(room: GameRoom): Promise<void> {
    const stats: RoundStats = this.buildRoundStats(room)
    let updates: MemoryUpdaterOutput
    if (!room.sessions.memoryUpdater) {
      const result = await this.memoryUpdaterAgent.startAfterRoundOne(
        room.code,
        room.userMemorySnapshots,
        stats
      )
      room.sessions.memoryUpdater = result.session
      updates = result.firstRoundUpdates
    } else {
      updates = await this.memoryUpdaterAgent.updateAfterRound(room.sessions.memoryUpdater, stats)
    }
    room.memoryDeltasLog.push(updates)
    this.logger.log(
      `memory_updater_round room=${room.code} round=${room.roundIndex} users_updated=${Object.keys(updates.updates).length}`
    )
    try {
      await this.userMemoryService.applyUpdates(updates)
    } catch (error: unknown) {
      this.logger.warn(
        `memory_updater_persist_failed room=${room.code} round=${room.roundIndex} error=${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private buildRoundStats(room: GameRoom): RoundStats {
    return {
      roundIndex: room.roundIndex,
      jokes: this.buildRoundJokeStats(room),
      duels: this.buildRoundDuelStats(room)
    }
  }

  private buildRoundJokeStats(room: GameRoom): readonly RoundJokeStat[] {
    const ratingsByItem = this.aggregateRatings(room)
    const result: RoundJokeStat[] = []
    for (const item of room.ratingItems) {
      if (!item.prompt || !item.punchline) {
        continue
      }
      const author = room.players.get(item.authorPlayerId)
      if (!author) {
        continue
      }
      const stats = ratingsByItem.get(item.id)
      result.push({
        opening: item.prompt,
        punchline: item.punchline,
        authorUserId: author.isBot ? null : author.id,
        authorRealName: author.name,
        ratingAverage: stats?.average ?? null,
        ratingCount: stats?.count ?? 0
      })
    }
    return result
  }

  private buildRoundDuelStats(room: GameRoom): readonly RoundDuelStat[] {
    const result: RoundDuelStat[] = []
    for (const duel of room.duels) {
      if (!duel.closed) {
        continue
      }
      const leftPlayer = room.players.get(duel.leftPlayerId)
      const rightPlayer = room.players.get(duel.rightPlayerId)
      if (!leftPlayer || !rightPlayer) {
        continue
      }
      const leftSubmission = room.submissions.get(duel.leftPlayerId)
      const rightSubmission = room.submissions.get(duel.rightPlayerId)
      if (!leftSubmission || !rightSubmission) {
        continue
      }
      const leftAnswer = getAnswerForPromptIndex(leftSubmission, duel.promptIndex)
      const rightAnswer = getAnswerForPromptIndex(rightSubmission, duel.promptIndex)
      const leftVotes = this.countVotes(duel.votes, 'left')
      const rightVotes = this.countVotes(duel.votes, 'right')
      const leftWon: boolean = leftVotes >= rightVotes
      const winner = leftWon ? leftPlayer : rightPlayer
      const voters: string[] = []
      duel.votes.forEach((_, voterId) => {
        const player = room.players.get(voterId)
        if (player && !player.isBot) {
          voters.push(voterId)
        }
      })
      result.push({
        opening: room.prompts[duel.promptIndex] ?? '',
        winnerUserId: winner.isBot ? null : winner.id,
        winnerPunchline: leftWon ? leftAnswer : rightAnswer,
        loserPunchline: leftWon ? rightAnswer : leftAnswer,
        votesFor: leftWon ? leftVotes : rightVotes,
        votesAgainst: leftWon ? rightVotes : leftVotes,
        votersUserIds: voters
      })
    }
    return result
  }

  private async cleanupSessions(room: GameRoom): Promise<void> {
    if (room.memoryUpdaterInFlight) {
      await room.memoryUpdaterInFlight.catch(() => undefined)
    }
    const sessions: AgentSession<unknown>[] = []
    if (room.sessions.openingGenerator) {
      sessions.push(room.sessions.openingGenerator)
    }
    if (room.sessions.memoryUpdater) {
      sessions.push(room.sessions.memoryUpdater)
    }
    room.sessions.botSessions.forEach((entry) => {
      sessions.push(entry.session)
    })
    await Promise.all(
      sessions.map((session) =>
        this.claudeRunner.end(session).catch((error: unknown) => {
          this.logger.warn(
            `session_end_failed session=${session.id} error=${error instanceof Error ? error.message : String(error)}`
          )
        })
      )
    )
    room.sessions = this.createEmptySessions()
  }

  private startScoreboardPhase(room: GameRoom): void {
    room.phase = 'scoreboard'
    const totals = Array.from(room.players.values()).map((p) => `${p.name}=${p.score}`).join(' ')
    this.logger.log(`scoreboard_phase_start room=${room.code} round=${room.roundIndex} totals=[${totals}]`)
    this.emitRoomState(room.code)
    this.setRoomTimer(room, SCOREBOARD_PHASE_SECONDS, () => this.advanceRound(room.code))
  }

  private advanceRound(roomCode: string): void {
    const room = this.rooms.get(roomCode)
    if (!room || room.phase !== 'scoreboard') {
      return
    }
    if (room.roundIndex >= room.roundCount) {
      room.phase = 'finished'
      this.clearRoomTimer(room)
      const totals = Array.from(room.players.values()).map((p) => `${p.name}=${p.score}`).join(' ')
      this.logger.log(`game_finished room=${room.code} rounds=${room.roundCount} final_scores=[${totals}]`)
      this.emitRoomState(room.code)
      this.evaluateAndSaveGoldenOpenings(room)
      void this.cleanupSessions(room)
      return
    }
    void this.startWritingPhase(room.code)
  }

  private toClientState(room: GameRoom, viewerPlayerId: string): ClientGameState {
    return {
      roomCode: room.code,
      phase: room.phase,
      roundIndex: room.roundIndex,
      roundCount: room.roundCount,
      players: this.toClientPlayers(room),
      prompts: room.prompts,
      promptAssignments: Array.from(room.promptAssignments.entries()).map(([playerId, promptIndices]) => ({
        playerId,
        promptIndices
      })),
      currentDuel: this.toClientDuel(room, viewerPlayerId),
      duelIndex: room.phase === 'voting' ? room.duelIndex : 0,
      duelCount: room.phase === 'voting' ? room.duels.length : 0,
      writingSubmitters: this.getWritingSubmitters(room),
      ratingSubmitters: this.getRatingSubmitters(room),
      ratingItems: room.ratingItems,
      timerSecondsLeft: this.getTimerSecondsLeft(room.timerEndsAt),
      aiStatus: room.aiStatus
    }
  }

  private getWritingSubmitters(room: GameRoom): readonly string[] {
    if (room.phase !== 'writing') {
      return []
    }
    return Array.from(room.submissions.entries())
      .filter(([, submission]) => Boolean(submission.answers[0]?.trim() && submission.answers[1]?.trim()))
      .map(([playerId]) => playerId)
  }

  private getRatingSubmitters(room: GameRoom): readonly string[] {
    if (room.phase !== 'rating') {
      return []
    }
    return Array.from(room.ratingSubmissions.keys())
  }

  private toClientPlayers(room: GameRoom): readonly ClientPlayer[] {
    return Array.from(room.players.values())
      .map((player) => ({
        id: player.id,
        name: player.name,
        isBot: player.isBot,
        connected: player.connected,
        score: player.score,
        isHost: player.id === room.hostPlayerId
      }))
      .sort((a, b) => b.score - a.score)
  }

  private toClientDuel(room: GameRoom, viewerPlayerId: string): ClientDuel | null {
    if (room.phase !== 'voting') {
      return null
    }
    const duel = room.duels[room.duelIndex]
    if (!duel) {
      return null
    }
    const leftSubmission = room.submissions.get(duel.leftPlayerId)
    const rightSubmission = room.submissions.get(duel.rightPlayerId)
    const leftAnswer = leftSubmission ? getAnswerForPromptIndex(leftSubmission, duel.promptIndex) : ''
    const rightAnswer = rightSubmission ? getAnswerForPromptIndex(rightSubmission, duel.promptIndex) : ''
    const fullVotes = Object.fromEntries(duel.votes) as Record<string, 'left' | 'right'>
    const votesByPlayerId = this.filterVotesForViewer(duel, viewerPlayerId, fullVotes)
    return {
      id: duel.id,
      prompt: room.prompts[duel.promptIndex],
      leftPlayerId: duel.leftPlayerId,
      rightPlayerId: duel.rightPlayerId,
      leftAnswer,
      rightAnswer,
      votesByPlayerId
    }
  }

  private filterVotesForViewer(
    duel: { readonly leftPlayerId: string; readonly rightPlayerId: string },
    viewerPlayerId: string,
    fullVotes: Readonly<Record<string, 'left' | 'right'>>
  ): Readonly<Record<string, 'left' | 'right'>> {
    if (viewerPlayerId === duel.leftPlayerId || viewerPlayerId === duel.rightPlayerId) {
      return fullVotes
    }
    if (fullVotes[viewerPlayerId]) {
      return fullVotes
    }
    return {}
  }

  private getTimerSecondsLeft(timerEndsAt: number | null): number | null {
    if (!timerEndsAt) {
      return null
    }
    const delta = timerEndsAt - Date.now()
    if (delta <= 0) {
      return 0
    }
    return Math.ceil(delta / 1000)
  }

  private countVotes(votes: Map<string, 'left' | 'right'>, side: 'left' | 'right'): number {
    let count = 0
    votes.forEach((value) => {
      if (value === side) {
        count += 1
      }
    })
    return count
  }

  private addScoreToWinners(room: GameRoom, playerId: string, points: number): void {
    const player = room.players.get(playerId)
    if (!player || points <= 0) {
      return
    }
    player.score += points
  }

  private trackBotDuelMetrics(
    room: GameRoom,
    leftPlayerId: string,
    rightPlayerId: string,
    leftVotes: number,
    rightVotes: number
  ): void {
    const leftPlayer = room.players.get(leftPlayerId)
    const rightPlayer = room.players.get(rightPlayerId)
    if (!leftPlayer || !rightPlayer) {
      return
    }
    const leftIsBot = leftPlayer.isBot
    const rightIsBot = rightPlayer.isBot
    if (!leftIsBot && !rightIsBot) {
      return
    }
    this.botDuelTotal += 1
    const botWon = (leftIsBot && leftVotes >= rightVotes) || (rightIsBot && rightVotes >= leftVotes)
    if (botWon) {
      this.botDuelWins += 1
    }
  }

  private maybeLogBotMetrics(): void {
    if (this.botDuelTotal === 0 || this.botDuelTotal % 20 !== 0) {
      return
    }
    const winRate = Number((this.botDuelWins / this.botDuelTotal).toFixed(3))
    this.logger.log(`bot_win_rate duels=${this.botDuelTotal} win_rate=${winRate}`)
  }

  private recordRoundVotes(
    room: GameRoom,
    promptIndex: number,
    leftPlayerId: string,
    rightPlayerId: string,
    leftVotes: number,
    rightVotes: number
  ): void {
    this.setRoundVote(room, leftPlayerId, promptIndex, leftVotes, rightVotes)
    this.setRoundVote(room, rightPlayerId, promptIndex, rightVotes, leftVotes)
  }

  private setRoundVote(
    room: GameRoom,
    playerId: string,
    promptIndex: number,
    votesFor: number,
    votesAgainst: number
  ): void {
    const key = `${playerId}:${promptIndex}`
    room.roundVotes.set(key, { votesFor, votesAgainst })
  }

  private applyRatings(
    room: GameRoom,
    playerId: string,
    ratings: readonly { readonly itemId: string; readonly score: number }[]
  ): void {
    const filtered = this.filterRatings(room, playerId, ratings)
    const map = new Map<string, number>()
    filtered.forEach((rating) => {
      map.set(rating.itemId, rating.score)
    })
    room.ratingSubmissions.set(playerId, map)
    this.logger.log(
      `rating_submit room=${room.code} round=${room.roundIndex} player=${playerId} received=${ratings.length} accepted=${filtered.length}`
    )
  }

  private filterRatings(
    room: GameRoom,
    playerId: string,
    ratings: readonly { readonly itemId: string; readonly score: number }[]
  ): readonly { readonly itemId: string; readonly score: number }[] {
    return ratings.filter((rating) => {
      const item = room.ratingItems.find((entry) => entry.id === rating.itemId)
      if (!item || item.authorPlayerId === playerId) {
        return false
      }
      const score = Math.floor(rating.score)
      return score >= 1 && score <= 10
    })
  }

  private hasAllRatings(room: GameRoom): boolean {
    const eligiblePlayers = Array.from(room.players.values()).filter((player) => !player.isBot)
    return eligiblePlayers.every((player) => this.hasPlayerSubmittedRatings(room, player.id))
  }

  private hasPlayerSubmittedRatings(room: GameRoom, playerId: string): boolean {
    return room.ratingSubmissions.has(playerId)
  }

  private persistRoundRatings(room: GameRoom): void {
    const ratingsByItem = this.aggregateRatings(room)
    const itemsWithRatings: number = Array.from(ratingsByItem.values()).filter((stats) => stats.count > 0).length
    this.logger.log(
      `persist_ratings room=${room.code} round=${room.roundIndex} submissions=${room.ratingSubmissions.size} items=${room.ratingItems.length} items_rated=${itemsWithRatings}`
    )
    room.ratingItems.forEach((item) => {
      const votes = room.roundVotes.get(item.id)
      const ratingStats = ratingsByItem.get(item.id)
      this.enqueueJokeMemory(room, item, votes, ratingStats)
    })
  }

  private aggregateRatings(room: GameRoom): Map<string, { readonly average: number; readonly count: number }> {
    const totals = new Map<string, { sum: number; count: number }>()
    room.ratingSubmissions.forEach((submission) => {
      submission.forEach((score, itemId) => {
        const current = totals.get(itemId) ?? { sum: 0, count: 0 }
        totals.set(itemId, { sum: current.sum + score, count: current.count + 1 })
      })
    })
    const result = new Map<string, { average: number; count: number }>()
    totals.forEach((value, key) => {
      result.set(key, { average: Number((value.sum / value.count).toFixed(2)), count: value.count })
    })
    return result
  }

  private enqueueJokeMemory(
    room: GameRoom,
    item: { readonly id: string; readonly prompt: string; readonly punchline: string; readonly authorPlayerId: string },
    votes: { readonly votesFor: number; readonly votesAgainst: number } | undefined,
    ratingStats: { readonly average: number; readonly count: number } | undefined
  ): void {
    const player = room.players.get(item.authorPlayerId)
    if (!player || !item.punchline || !item.prompt) {
      return
    }
    if (isFallbackPunchline(item.punchline)) {
      this.logger.log(`joke_memory_skip_fallback room=${room.code} round=${room.roundIndex} prompt="${item.prompt.slice(0, 60)}" punchline="${item.punchline.slice(0, 60)}"`)
      return
    }
    const votesFor = votes?.votesFor ?? 0
    const votesAgainst = votes?.votesAgainst ?? 0
    const ratingAverage = ratingStats?.average
    const ratingCount = ratingStats?.count
    const source: 'human' | 'bot' = player.isBot ? 'bot' : 'human'
    this.jokeMemoryService.executeEnqueueRecordJoke({
      prompt: item.prompt,
      punchline: item.punchline,
      votesFor,
      votesAgainst,
      ratingAverage,
      ratingCount,
      source,
      roomCode: room.code,
      roundIndex: room.roundIndex
    })
    this.promptStarterService.pushCompletion({
      promptText: item.prompt,
      punchline: item.punchline,
      source,
      votesFor,
      votesAgainst,
      ratingAverage,
      ratingCount,
      roomCode: room.code,
      roundIndex: room.roundIndex
    })
  }

  private evaluateAndSaveGoldenOpenings(room: GameRoom): void {
    void this.executeGoldenEvaluation(room).catch((error: unknown) => {
      this.logger.warn(`golden_evaluation_failed room=${room.code} error=${error instanceof Error ? error.message : String(error)}`)
    })
  }

  private async executeGoldenEvaluation(room: GameRoom): Promise<void> {
    const openingMetrics = new Map<string, { ratings: number[]; voteShares: number[] }>()

    for (const items of [room.ratingItems]) {
      for (const item of items) {
        if (!item.prompt || !item.punchline) {
          continue
        }
        const existing = openingMetrics.get(item.prompt) ?? { ratings: [], voteShares: [] }
        const votes = room.roundVotes.get(item.id)
        if (votes) {
          const total = votes.votesFor + votes.votesAgainst
          if (total > 0) {
            existing.voteShares.push(votes.votesFor / total)
          }
        }
        openingMetrics.set(item.prompt, existing)
      }
    }

    // Collect ratings from all rounds — ratingItems only has current round
    // Use usedPromptTexts as the source of all openings
    // Rating data is persisted per-round via persistRoundRatings, so we use prompt_starters completions

    let goldenCount = 0
    for (const [prompt, metrics] of openingMetrics) {
      const avgVoteShare = metrics.voteShares.length > 0
        ? metrics.voteShares.reduce((a, b) => a + b, 0) / metrics.voteShares.length
        : 0

      // Use completions from prompt_starters for ratings (already persisted)
      const completions = await this.promptStarterService.getCompletionsForPrompt(prompt)
      const ratingsFromCompletions = completions
        .filter((c) => c.ratingAverage !== undefined && c.ratingAverage !== null)
        .map((c) => c.ratingAverage!)
      const avgRating = ratingsFromCompletions.length > 0
        ? ratingsFromCompletions.reduce((a, b) => a + b, 0) / ratingsFromCompletions.length
        : 0
      const hasHighRating = ratingsFromCompletions.some((r) => r >= 8)
      const completionCount = completions.length

      const isGolden = completionCount >= 2 && hasHighRating && (avgRating >= 7.0 || avgVoteShare >= 0.65)

      if (isGolden) {
        await this.promptStarterService.saveGoldenOpening({
          text: prompt,
          averageCompletionRating: avgRating,
          averageVoteShare: avgVoteShare
        })
        goldenCount += 1
      }
    }

    this.logger.log(`golden_evaluation room=${room.code} evaluated=${openingMetrics.size} golden=${goldenCount}`)
  }
}
