import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { AiService } from '../ai/ai.service'
import { JokeMemoryService } from '../joke-memory/joke-memory.service'
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
import { GameRoom } from './models/game-room.type'
import { PlayerSession } from './models/player-session.type'
import { SocketPlayerLink } from './models/socket-player-link.type'
import {
  buildCircularPromptAssignments,
  createDuelsForPrompts,
  createPlayer,
  createRatingItems,
  createRoomCode,
  createSubmission,
  getAnswerForPromptIndex,
  normalizeAnswer
} from './game.utils'

type BroadcastFn = (roomCode: string, state: ClientGameState) => void

const BOT_STYLES: readonly string[] = ['sarcastic', 'chaotic', 'dark', 'absurd', 'bold'] as const
const LOCAL_FALLBACK_PROMPTS: readonly [string, string] = [
  'Когда я открыл холодильник ночью, он потребовал:',
  'На собеседовании я честно сказал, что:'
]
const EXTENDED_LOCAL_PROMPTS: readonly string[] = [
  ...LOCAL_FALLBACK_PROMPTS,
  'Мой сосед узнал о моём хобби и теперь:',
  'Я подумал, что это шутка, но официант:',
  'В аэропорту меня остановили из-за:',
  'Когда я открыл чат с поддержкой, она первой написала:',
  'Я пообещал себе начать спортзал, и в тот же день:',
  'Мой умный дом внезапно запретил мне:',
  'В такси я сказал "по-быстрому", и водитель:'
]
const LOCAL_FALLBACK_ANSWER: string = 'это звучало лучше в моей голове.'

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
    private readonly jokeMemoryService: JokeMemoryService
  ) {}

  public setBroadcast(fn: BroadcastFn): void {
    this.broadcastState = fn
  }

  public async createRoom(input: {
    readonly socketId: string
    readonly name: string
    readonly roundCount: number
    readonly botCount: number
  }): Promise<PlayerSession> {
    const host = createPlayer({ name: input.name, socketId: input.socketId, isBot: false })
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
      promptAssignments: new Map(),
      submissions: new Map(),
      duels: [],
      duelIndex: 0,
      ratingItems: [],
      ratingSubmissions: new Map(),
      roundVotes: new Map(),
      timerEndsAt: null,
      timerHandle: null
    }
    this.createBots(room)
    this.rooms.set(roomCode, room)
    this.socketLinks.set(input.socketId, { roomCode, playerId: host.id })
    this.emitRoomState(roomCode)
    return { roomCode, playerId: host.id }
  }

  public joinRoom(input: { readonly socketId: string; readonly roomCode: string; readonly name: string }): PlayerSession {
    const room = this.getRoomOrFail(input.roomCode)
    this.ensureLobbyPhase(room)
    const player = createPlayer({ name: input.name, socketId: input.socketId, isBot: false })
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
    this.resetPlayerScores(room)
    room.roundIndex = 0
    await this.startWritingPhase(room.code)
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

  public getState(roomCode: string): ClientGameState {
    const room = this.getRoomOrFail(roomCode)
    return this.toClientState(room)
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
    const bot = createPlayer({ name: `AI Bot ${botCount + 1}`, socketId: null, isBot: true })
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
    this.broadcastState(roomCode, this.toClientState(room))
  }

  private async startWritingPhase(roomCode: string): Promise<void> {
    const room = this.getRoomOrFail(roomCode)
    room.roundIndex += 1
    room.phase = 'writing'
    room.duels = []
    room.duelIndex = 0
    room.ratingItems = []
    room.ratingSubmissions = new Map()
    room.roundVotes = new Map()
    room.submissions = new Map()
    const playerIds = Array.from(room.players.keys())
    const playerCount = playerIds.length
    room.prompts = await this.generateSafePromptList(playerCount)
    room.promptAssignments = buildCircularPromptAssignments(playerIds)
    room.players.forEach((player) => {
      const assignment = room.promptAssignments.get(player.id)
      if (!assignment) {
        return
      }
      room.submissions.set(player.id, createSubmission(player.id, assignment))
    })
    this.emitRoomState(room.code)
    this.generateBotAnswers(room)
    this.setRoomTimer(room, WRITING_PHASE_SECONDS, () => this.startVotingPhase(room.code))
  }

  private generateBotAnswers(room: GameRoom): void {
    room.players.forEach((player) => {
      if (!player.isBot) {
        return
      }
      this.upsertSubmission(room, player.id, [LOCAL_FALLBACK_ANSWER, LOCAL_FALLBACK_ANSWER])
      void this.createBotSubmission(room.code, player.id)
    })
  }

  private async createBotSubmission(roomCode: string, playerId: string): Promise<void> {
    const room = this.rooms.get(roomCode)
    if (!room || room.phase !== 'writing') {
      return
    }
    const delayMs = 1500 + Math.floor(Math.random() * 3500)
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), delayMs)
    })
    const submission = room.submissions.get(playerId)
    if (!submission) {
      return
    }
    const promptOne = room.prompts[submission.assignedPromptIndices[0]]
    const promptTwo = room.prompts[submission.assignedPromptIndices[1]]
    const answers: [string, string] = [
      await this.generateSafeBotAnswer(promptOne),
      await this.generateSafeBotAnswer(promptTwo)
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

  private getBotStyle(): string {
    return BOT_STYLES[Math.floor(Math.random() * BOT_STYLES.length)]
  }

  private async generateSafePromptList(count: number): Promise<readonly string[]> {
    if (count <= 0) {
      return []
    }
    const timeoutPromise = new Promise<readonly string[]>((resolve) => {
      setTimeout(() => resolve(this.buildLocalFallbackPromptList(count)), 4500)
    })
    const aiPromise = this.aiService.generatePromptList(count)
    return Promise.race([aiPromise, timeoutPromise]).catch(() => this.buildLocalFallbackPromptList(count))
  }

  private buildLocalFallbackPromptList(count: number): readonly string[] {
    const result: string[] = []
    for (let index = 0; index < count; index += 1) {
      const base = EXTENDED_LOCAL_PROMPTS[index % EXTENDED_LOCAL_PROMPTS.length]
      const cycle = Math.floor(index / EXTENDED_LOCAL_PROMPTS.length)
      result.push(cycle === 0 ? base : `${base} (${cycle + 1})`)
    }
    return result
  }

  private async generateSafeBotAnswer(prompt: string): Promise<string> {
    const timeoutPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve(LOCAL_FALLBACK_ANSWER), 4500)
    })
    const aiPromise = this.aiService
      .generateBotAnswer({ prompt, styleTag: this.getBotStyle() })
      .then((value) => normalizeAnswer(value))
    return Promise.race([aiPromise, timeoutPromise]).catch(() => LOCAL_FALLBACK_ANSWER)
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
    room.phase = 'voting'
    room.duels = createDuelsForPrompts(room)
    room.duelIndex = 0
    room.ratingItems = createRatingItems(room)
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
    this.emitRoomState(room.code)
    this.setRoomTimer(room, RATING_PHASE_SECONDS, () => this.finishRatingPhase(room.code))
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
    this.persistRoundRatings(room)
    this.startScoreboardPhase(room)
  }

  private startScoreboardPhase(room: GameRoom): void {
    room.phase = 'scoreboard'
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
      this.emitRoomState(room.code)
      return
    }
    void this.startWritingPhase(room.code)
  }

  private toClientState(room: GameRoom): ClientGameState {
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
      currentDuel: this.toClientDuel(room),
      duelIndex: room.phase === 'voting' ? room.duelIndex : 0,
      duelCount: room.phase === 'voting' ? room.duels.length : 0,
      writingSubmitters: this.getWritingSubmitters(room),
      ratingSubmitters: this.getRatingSubmitters(room),
      ratingItems: room.ratingItems,
      timerSecondsLeft: this.getTimerSecondsLeft(room.timerEndsAt)
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

  private toClientDuel(room: GameRoom): ClientDuel | null {
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
    return {
      id: duel.id,
      prompt: room.prompts[duel.promptIndex],
      leftPlayerId: duel.leftPlayerId,
      rightPlayerId: duel.rightPlayerId,
      leftAnswer,
      rightAnswer,
      votesByPlayerId: Object.fromEntries(duel.votes) as Record<string, 'left' | 'right'>
    }
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
    return eligiblePlayers.every((player) => this.hasPlayerRatedAll(room, player.id))
  }

  private hasPlayerRatedAll(room: GameRoom, playerId: string): boolean {
    const required = room.ratingItems.filter((item) => item.authorPlayerId !== playerId)
    const submission = room.ratingSubmissions.get(playerId)
    if (!submission) {
      return false
    }
    return required.every((item) => submission.has(item.id))
  }

  private persistRoundRatings(room: GameRoom): void {
    const ratingsByItem = this.aggregateRatings(room)
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
    if (!player || !item.punchline) {
      return
    }
    const votesFor = votes?.votesFor ?? 0
    const votesAgainst = votes?.votesAgainst ?? 0
    const ratingAverage = ratingStats?.average
    const ratingCount = ratingStats?.count
    this.jokeMemoryService.executeEnqueueRecordJoke({
      prompt: item.prompt,
      punchline: item.punchline,
      votesFor,
      votesAgainst,
      ratingAverage,
      ratingCount,
      source: player.isBot ? 'bot' : 'human',
      roomCode: room.code,
      roundIndex: room.roundIndex
    })
  }
}
