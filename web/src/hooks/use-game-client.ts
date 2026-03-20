import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClientGameState } from '../models/client-game-state.type'
import type { PlayerSession } from '../models/player-session.type'
import {
  GameSocket,
  type CastVotePayload,
  type CreateRoomPayload,
  type JoinRoomPayload,
  type StartGamePayload,
  type SubmitAnswersPayload,
  type SubmitRatingsPayload
} from '../socket/game-socket'

const SESSION_KEY: string = 'punchme-session'

const parseStoredSession = (): PlayerSession | null => {
  const rawValue = window.localStorage.getItem(SESSION_KEY)
  if (!rawValue) {
    return null
  }
  try {
    const parsed = JSON.parse(rawValue) as PlayerSession
    if (!parsed.roomCode || !parsed.playerId) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export const useGameClient = (): {
  readonly gameState: ClientGameState | null
  readonly session: PlayerSession | null
  readonly errorMessage: string | null
  readonly executeLeaveRoom: () => void
  readonly executeCreateRoom: (payload: CreateRoomPayload) => void
  readonly executeJoinRoom: (payload: JoinRoomPayload) => void
  readonly executeStartGame: (payload: StartGamePayload) => void
  readonly executeSubmitAnswers: (payload: SubmitAnswersPayload) => void
  readonly executeCastVote: (payload: CastVotePayload) => void
  readonly executeSubmitRatings: (payload: SubmitRatingsPayload) => void
} => {
  const [gameState, setGameState] = useState<ClientGameState | null>(null)
  const [session, setSession] = useState<PlayerSession | null>(parseStoredSession)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const socketRef = useRef<GameSocket | null>(null)

  useEffect(() => {
    socketRef.current?.executeDisconnect()
    socketRef.current = new GameSocket(
      {
        onState: (state) => {
          setGameState(state)
          setErrorMessage(null)
        },
        onSession: (incomingSession) => {
          setSession(incomingSession)
          window.localStorage.setItem(SESSION_KEY, JSON.stringify(incomingSession))
          setErrorMessage(null)
        },
        onError: (message) => setErrorMessage(message)
      },
      session
    )
    return () => socketRef.current?.executeDisconnect()
  }, [session?.roomCode, session?.playerId])

  return useMemo(
    () => ({
      gameState,
      session,
      errorMessage,
      executeLeaveRoom: () => {
        socketRef.current?.executeDisconnect()
        window.localStorage.removeItem(SESSION_KEY)
        setSession(null)
        setGameState(null)
        setErrorMessage(null)
      },
      executeCreateRoom: (payload: CreateRoomPayload) => socketRef.current?.executeCreateRoom(payload),
      executeJoinRoom: (payload: JoinRoomPayload) => socketRef.current?.executeJoinRoom(payload),
      executeStartGame: (payload: StartGamePayload) => socketRef.current?.executeStartGame(payload),
      executeSubmitAnswers: (payload: SubmitAnswersPayload) => socketRef.current?.executeSubmitAnswers(payload),
      executeCastVote: (payload: CastVotePayload) => socketRef.current?.executeCastVote(payload),
      executeSubmitRatings: (payload: SubmitRatingsPayload) => socketRef.current?.executeSubmitRatings(payload)
    }),
    [gameState, session, errorMessage]
  )
}
