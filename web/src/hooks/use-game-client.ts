import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClientGameState } from '../models/client-game-state.type'
import type { PlayerSession } from '../models/player-session.type'
import {
  GameSocket,
  type CastVotePayload,
  type CreateRoomPayload,
  type JoinRoomPayload,
  type RoomLostReason,
  type StartGamePayload,
  type SubmitAnswersPayload,
  type SubmitOpeningFeedbackPayload,
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

export const useGameClient = (input: {
  readonly token: string | null
  readonly onAuthError: () => void
}): {
  readonly gameState: ClientGameState | null
  readonly session: PlayerSession | null
  readonly errorMessage: string | null
  readonly executeLeaveRoom: () => void
  readonly executeCreateRoom: (payload: CreateRoomPayload) => void
  readonly executeJoinRoom: (payload: JoinRoomPayload) => void
  readonly executeStartGame: (payload: StartGamePayload) => void
  readonly executeRestartGame: (payload: StartGamePayload) => void
  readonly executeSubmitAnswers: (payload: SubmitAnswersPayload) => void
  readonly executeCastVote: (payload: CastVotePayload) => void
  readonly executeSubmitRatings: (payload: SubmitRatingsPayload) => void
  readonly executeSubmitOpeningFeedback: (payload: SubmitOpeningFeedbackPayload) => void
} => {
  const [gameState, setGameState] = useState<ClientGameState | null>(null)
  const [session, setSession] = useState<PlayerSession | null>(parseStoredSession)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const socketRef = useRef<GameSocket | null>(null)
  const onAuthErrorRef = useRef(input.onAuthError)
  onAuthErrorRef.current = input.onAuthError

  useEffect(() => {
    socketRef.current?.executeDisconnect()
    if (!input.token) {
      socketRef.current = null
      return
    }
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
        onError: (message) => setErrorMessage(message),
        onAuthError: () => onAuthErrorRef.current(),
        onRoomLost: (reason: RoomLostReason) => {
          window.localStorage.removeItem(SESSION_KEY)
          setSession(null)
          setGameState(null)
          setErrorMessage(
            reason === 'host-left'
              ? 'Хост покинул игру'
              : reason === 'self'
                ? null
                : 'Комната больше не существует'
          )
        }
      },
      { token: input.token, session }
    )
    return () => socketRef.current?.executeDisconnect()
  }, [input.token, session?.roomCode, session?.playerId])

  return useMemo(
    () => ({
      gameState,
      session,
      errorMessage,
      executeLeaveRoom: () => {
        if (session?.roomCode) {
          socketRef.current?.executeLeaveRoom({ roomCode: session.roomCode })
        }
        socketRef.current?.executeDisconnect()
        window.localStorage.removeItem(SESSION_KEY)
        setSession(null)
        setGameState(null)
        setErrorMessage(null)
      },
      executeCreateRoom: (payload: CreateRoomPayload) => socketRef.current?.executeCreateRoom(payload),
      executeJoinRoom: (payload: JoinRoomPayload) => socketRef.current?.executeJoinRoom(payload),
      executeStartGame: (payload: StartGamePayload) => socketRef.current?.executeStartGame(payload),
      executeRestartGame: (payload: StartGamePayload) => socketRef.current?.executeRestartGame(payload),
      executeSubmitAnswers: (payload: SubmitAnswersPayload) => socketRef.current?.executeSubmitAnswers(payload),
      executeCastVote: (payload: CastVotePayload) => socketRef.current?.executeCastVote(payload),
      executeSubmitRatings: (payload: SubmitRatingsPayload) => socketRef.current?.executeSubmitRatings(payload),
      executeSubmitOpeningFeedback: (payload: SubmitOpeningFeedbackPayload) =>
        socketRef.current?.executeSubmitOpeningFeedback(payload)
    }),
    [gameState, session, errorMessage]
  )
}
