import { io, Socket } from 'socket.io-client'
import { resolveApiBaseUrl } from '../auth/auth-api'
import type { ClientGameState } from '../models/client-game-state.type'
import type { PlayerSession } from '../models/player-session.type'

export type CreateRoomPayload = {
  readonly roundCount: number
  readonly botCount: number
  readonly testMode?: boolean
}

export type JoinRoomPayload = {
  readonly roomCode: string
}

export type StartGamePayload = {
  readonly roomCode: string
}

export type SubmitAnswersPayload = {
  readonly roomCode: string
  readonly answers: [string, string]
}

export type CastVotePayload = {
  readonly roomCode: string
  readonly duelId: string
  readonly side: 'left' | 'right'
  readonly golden?: boolean
}

export type SubmitRatingsPayload = {
  readonly roomCode: string
  readonly ratings: readonly { readonly itemId: string; readonly score: number }[]
}

export type FeedbackLevel = -1 | -0.5 | 0.5 | 1

export type SubmitOpeningFeedbackPayload = {
  readonly roomCode: string
  readonly items: readonly { readonly promptIndex: number; readonly level: FeedbackLevel }[]
}

type GameSocketHandlers = {
  readonly onState: (state: ClientGameState) => void
  readonly onSession: (session: PlayerSession) => void
  readonly onError: (message: string) => void
  readonly onAuthError: () => void
}

export class GameSocket {
  private readonly socket: Socket

  public constructor(
    handlers: GameSocketHandlers,
    options: { readonly token: string; readonly session: PlayerSession | null }
  ) {
    this.socket = io(resolveApiBaseUrl(), {
      transports: ['websocket'],
      auth: { token: options.token },
      query: options.session ? { roomCode: options.session.roomCode } : undefined
    })
    this.socket.on('gameState', handlers.onState)
    this.socket.on('session', handlers.onSession)
    this.socket.on('connect_error', (error) => {
      const msg: string = (error as Error).message || ''
      if (msg.toLowerCase().includes('auth')) {
        handlers.onAuthError()
      } else {
        handlers.onError(msg || 'Cannot connect to server')
      }
    })
    this.socket.on('exception', (payload: { readonly message?: string } | string) => {
      const message =
        typeof payload === 'string' ? payload : payload.message ?? 'Server rejected request'
      handlers.onError(message)
    })
    this.socket.on('authError', () => handlers.onAuthError())
  }

  public executeCreateRoom(payload: CreateRoomPayload): void {
    this.socket.emit('createRoom', payload)
  }

  public executeJoinRoom(payload: JoinRoomPayload): void {
    this.socket.emit('joinRoom', payload)
  }

  public executeStartGame(payload: StartGamePayload): void {
    this.socket.emit('startGame', payload)
  }

  public executeSubmitAnswers(payload: SubmitAnswersPayload): void {
    this.socket.emit('submitAnswers', payload)
  }

  public executeCastVote(payload: CastVotePayload): void {
    this.socket.emit('castVote', payload)
  }

  public executeSubmitRatings(payload: SubmitRatingsPayload): void {
    this.socket.emit('submitRatings', payload)
  }

  public executeSubmitOpeningFeedback(payload: SubmitOpeningFeedbackPayload): void {
    this.socket.emit('submitOpeningFeedback', payload)
  }

  public executeDisconnect(): void {
    this.socket.disconnect()
  }
}
