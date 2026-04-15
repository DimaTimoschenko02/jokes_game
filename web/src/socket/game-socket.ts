import { io, Socket } from 'socket.io-client'
import type { ClientGameState } from '../models/client-game-state.type'
import type { PlayerSession } from '../models/player-session.type'

export type CreateRoomPayload = {
  readonly name: string
  readonly roundCount: number
  readonly botCount: number
  readonly bio?: string
}

export type JoinRoomPayload = {
  readonly roomCode: string
  readonly name: string
  readonly bio?: string
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
}

export type SubmitRatingsPayload = {
  readonly roomCode: string
  readonly ratings: readonly { readonly itemId: string; readonly score: number }[]
}

type GameSocketHandlers = {
  readonly onState: (state: ClientGameState) => void
  readonly onSession: (session: PlayerSession) => void
  readonly onError: (message: string) => void
}

const getApiUrlFromQuery = (): string | null => {
  const rawValue = window.location.search
  const value = new URLSearchParams(rawValue).get('api')
  return value && value.trim().length > 0 ? value.trim() : null
}

const resolveApiUrl = (): string => {
  const queryApiUrl = getApiUrlFromQuery()
  if (queryApiUrl) {
    return queryApiUrl
  }
  const envApiUrl = import.meta.env.VITE_API_URL
  if (envApiUrl) {
    return envApiUrl
  }
  return window.location.origin
}

export class GameSocket {
  private readonly socket: Socket

  public constructor(handlers: GameSocketHandlers, session: PlayerSession | null) {
    this.socket = io(resolveApiUrl(), {
      transports: ['websocket'],
      query: session ? { roomCode: session.roomCode, playerId: session.playerId } : undefined
    })
    this.socket.on('gameState', handlers.onState)
    this.socket.on('session', handlers.onSession)
    this.socket.on('connect_error', () => handlers.onError('Cannot connect to server'))
    this.socket.on('exception', (payload: { readonly message?: string } | string) => {
      const message =
        typeof payload === 'string' ? payload : payload.message ?? 'Server rejected request'
      handlers.onError(message)
    })
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

  public executeDisconnect(): void {
    this.socket.disconnect()
  }
}
