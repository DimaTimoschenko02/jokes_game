import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { ClientPlayer } from './models/client-player.type'
import type { RatingItem } from './models/rating-item.type'
import { useGameClient } from './hooks/use-game-client'

const DEFAULT_ROUNDS: number = 4
const DEFAULT_BOTS: number = 1
const ROOM_CODE_LENGTH: number = 5

const getPlayerNameById = (players: readonly ClientPlayer[], playerId: string): string => {
  const player = players.find((item) => item.id === playerId)
  return player?.name ?? 'Unknown'
}

const buildRatingPayload = (ratings: Record<string, number>): readonly { readonly itemId: string; readonly score: number }[] =>
  Object.entries(ratings).map(([itemId, score]) => ({ itemId, score }))

const getRatingLabel = (value: number): string => (value ? `${value}/10` : 'Rate')

const isOwnJoke = (item: RatingItem, playerId: string | undefined): boolean => item.authorPlayerId === playerId

function App(): ReactElement {
  const [displayName, setDisplayName] = useState<string>('')
  const [roomCodeToJoin, setRoomCodeToJoin] = useState<string>('')
  const [roundCount, setRoundCount] = useState<number>(DEFAULT_ROUNDS)
  const [botCount, setBotCount] = useState<number>(DEFAULT_BOTS)
  const [answers, setAnswers] = useState<[string, string]>(['', ''])
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [ratingFlashItemId, setRatingFlashItemId] = useState<string | null>(null)
  const [answersBtnPulse, setAnswersBtnPulse] = useState<boolean>(false)
  const [ratingsBtnPulse, setRatingsBtnPulse] = useState<boolean>(false)
  const {
    gameState,
    session,
    errorMessage,
    executeLeaveRoom,
    executeCreateRoom,
    executeJoinRoom,
    executeStartGame,
    executeSubmitAnswers,
    executeCastVote,
    executeSubmitRatings
  } = useGameClient()

  const me = useMemo(() => gameState?.players.find((player) => player.id === session?.playerId) ?? null, [gameState, session])
  const myAssignment = useMemo(
    () => gameState?.promptAssignments.find((item) => item.playerId === session?.playerId),
    [gameState?.promptAssignments, session?.playerId]
  )
  const myPromptLabels = useMemo((): readonly [string, string] => {
    if (!gameState || !myAssignment) {
      return ['', '']
    }
    const [firstIndex, secondIndex] = myAssignment.promptIndices
    return [gameState.prompts[firstIndex] ?? '', gameState.prompts[secondIndex] ?? '']
  }, [gameState?.prompts, myAssignment])
  const canStart = Boolean(me?.isHost && gameState?.phase === 'lobby')
  const hasSubmittedAnswers = Boolean(
    session &&
      gameState?.phase === 'writing' &&
      (gameState.writingSubmitters ?? []).includes(session.playerId)
  )
  const hasSubmittedRatings = Boolean(
    session &&
      gameState?.phase === 'rating' &&
      (gameState.ratingSubmitters ?? []).includes(session.playerId)
  )
  const canSubmit = Boolean(
    gameState?.phase === 'writing' && answers[0].trim() && answers[1].trim() && !hasSubmittedAnswers
  )
  const myVoteSide =
    session && gameState?.phase === 'voting' && gameState.currentDuel
      ? gameState.currentDuel.votesByPlayerId[session.playerId]
      : undefined
  const hasVotedCurrentDuel = Boolean(myVoteSide)

  useEffect(() => {
    if (gameState?.phase === 'rating') {
      setRatings({})
    }
  }, [gameState?.phase, gameState?.roundIndex])

  const handleCreateRoom = (): void => {
    executeCreateRoom({
      name: displayName.trim() || 'Host',
      roundCount,
      botCount
    })
  }

  const handleJoinRoom = (): void => {
    executeJoinRoom({
      roomCode: roomCodeToJoin.toUpperCase().slice(0, ROOM_CODE_LENGTH),
      name: displayName.trim() || 'Player'
    })
  }

  const handleSubmit = (): void => {
    if (!session || hasSubmittedAnswers) {
      return
    }
    setAnswersBtnPulse(true)
    window.setTimeout(() => {
      setAnswersBtnPulse(false)
    }, 420)
    executeSubmitAnswers({
      roomCode: session.roomCode,
      answers
    })
  }

  const handleRatingChange = (itemId: string, score: number): void => {
    setRatings((current) => ({ ...current, [itemId]: score }))
    setRatingFlashItemId(itemId)
    window.setTimeout(() => {
      setRatingFlashItemId((current) => (current === itemId ? null : current))
    }, 420)
  }

  const handleSubmitRatings = (): void => {
    if (!session || hasSubmittedRatings) {
      return
    }
    setRatingsBtnPulse(true)
    window.setTimeout(() => {
      setRatingsBtnPulse(false)
    }, 420)
    executeSubmitRatings({
      roomCode: session.roomCode,
      ratings: buildRatingPayload(ratings)
    })
  }

  const handleVote = (side: 'left' | 'right'): void => {
    if (!session || !gameState?.currentDuel) {
      return
    }
    if (hasVotedCurrentDuel) {
      return
    }
    executeCastVote({
      roomCode: session.roomCode,
      duelId: gameState.currentDuel.id,
      side
    })
  }

  if (!gameState || !session) {
    return (
      <main className="layout">
        <section className="panel">
          <h1>PunchMe Party</h1>
          <p className="subtitle">Write better jokes than your friends and the AI bots.</p>
          {errorMessage && <p className="subtitle">{errorMessage}</p>}
          <label className="inputGroup">
            <span>Your name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={30} />
          </label>
          <div className="row">
            <label className="inputGroup">
              <span>Rounds</span>
              <select value={roundCount} onChange={(event) => setRoundCount(Number(event.target.value))}>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
            <label className="inputGroup">
              <span>Bots</span>
              <select value={botCount} onChange={(event) => setBotCount(Number(event.target.value))}>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </label>
          </div>
          <button className="primary" onClick={handleCreateRoom}>
            Create room
          </button>
          <div className="divider" />
          <label className="inputGroup">
            <span>Room code</span>
            <input
              value={roomCodeToJoin}
              onChange={(event) => setRoomCodeToJoin(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              maxLength={ROOM_CODE_LENGTH}
            />
          </label>
          <button className="secondary" onClick={handleJoinRoom}>
            Join room
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="layout">
      <section className="panel">
        <header className="header">
          <div>
            <h1>Room {gameState.roomCode}</h1>
            <p className="subtitle">
              Round {Math.max(gameState.roundIndex, 1)} of {gameState.roundCount}
            </p>
          </div>
          <div className="headerActions">
            <div className="timerWrap" aria-label="Time left in this phase">
              <span className="timerLabel">Time</span>
              {gameState.timerSecondsLeft != null ? (
                <>
                  <span className="timerValue">{gameState.timerSecondsLeft}</span>
                  <span className="timerSuffix">s</span>
                </>
              ) : (
                <span className="timerValue timerValueIdle">—</span>
              )}
            </div>
            <button className="secondary leaveButton" onClick={executeLeaveRoom}>
              Leave room
            </button>
          </div>
        </header>
        {errorMessage && <p className="subtitle">{errorMessage}</p>}

        <ul className="scoreboard">
          {gameState.players.map((player) => (
            <li key={player.id}>
              <span>
                {player.name} {player.isBot ? '🤖' : ''} {player.id === session.playerId ? '(you)' : ''}
              </span>
              <strong>{player.score}</strong>
            </li>
          ))}
        </ul>

        {gameState.phase === 'lobby' && (
          <div className="phaseBlock">
            <p>Waiting for host to start.</p>
            {canStart && (
              <button className="primary" onClick={() => executeStartGame({ roomCode: session.roomCode })}>
                Start game
              </button>
            )}
          </div>
        )}

        {gameState.phase === 'writing' && (
          <div className={`phaseBlock ${hasSubmittedAnswers ? 'phaseSuccess' : ''}`}>
            <h2>Finish both prompts</h2>
            {hasSubmittedAnswers && <p className="confirmBanner">Answers sent — waiting for others</p>}
            <label className="inputGroup">
              <span>{myPromptLabels[0]}</span>
              <textarea
                value={answers[0]}
                disabled={hasSubmittedAnswers}
                onChange={(event) => setAnswers([event.target.value, answers[1]])}
              />
            </label>
            <label className="inputGroup">
              <span>{myPromptLabels[1]}</span>
              <textarea
                value={answers[1]}
                disabled={hasSubmittedAnswers}
                onChange={(event) => setAnswers([answers[0], event.target.value])}
              />
            </label>
            <button
              type="button"
              className={`primary ${hasSubmittedAnswers ? 'btnSuccess' : ''} ${answersBtnPulse ? 'btnPulse' : ''}`}
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {hasSubmittedAnswers ? 'Sent' : 'Submit answers'}
            </button>
          </div>
        )}

        {gameState.phase === 'voting' && gameState.currentDuel && (
          <div className="phaseBlock">
            <p className="subtitle">
              Duel {gameState.duelIndex + 1} of {gameState.duelCount}
            </p>
            <h2>{gameState.currentDuel.prompt}</h2>
            {hasVotedCurrentDuel && myVoteSide && (
              <p className="voteStatus">Your vote: {myVoteSide === 'left' ? 'left option' : 'right option'}</p>
            )}
            <button
              type="button"
              className={`voteOption ${hasVotedCurrentDuel ? 'voteLocked' : ''} ${myVoteSide === 'left' ? 'voteSelected' : ''}`}
              disabled={hasVotedCurrentDuel}
              onClick={() => handleVote('left')}
            >
              <span>{gameState.currentDuel.leftAnswer}</span>
              <small>{getPlayerNameById(gameState.players, gameState.currentDuel.leftPlayerId)}</small>
            </button>
            <button
              type="button"
              className={`voteOption ${hasVotedCurrentDuel ? 'voteLocked' : ''} ${myVoteSide === 'right' ? 'voteSelected' : ''}`}
              disabled={hasVotedCurrentDuel}
              onClick={() => handleVote('right')}
            >
              <span>{gameState.currentDuel.rightAnswer}</span>
              <small>{getPlayerNameById(gameState.players, gameState.currentDuel.rightPlayerId)}</small>
            </button>
          </div>
        )}

        {gameState.phase === 'scoreboard' && (
          <div className="phaseBlock">
            <h2>Round complete</h2>
            <p>Scores updated. Next round starts automatically.</p>
          </div>
        )}

        {gameState.phase === 'rating' && (
          <div className={`phaseBlock ${hasSubmittedRatings ? 'phaseSuccess' : ''}`}>
            <h2>Rate the jokes</h2>
            <p className="subtitle ratingHint">Scoring is optional — submit to skip or send a partial ballot.</p>
            {hasSubmittedRatings && <p className="confirmBanner">Ratings sent</p>}
            {gameState.ratingItems.map((item) => (
              <div
                key={item.id}
                className={`ratingItem ${ratingFlashItemId === item.id ? 'ratingPickFlash' : ''}`}
              >
                <p>{item.prompt}</p>
                <strong>{item.punchline}</strong>
                <small>{getPlayerNameById(gameState.players, item.authorPlayerId)}</small>
                {isOwnJoke(item, session.playerId) ? (
                  <span className="ratingSelf">Your joke</span>
                ) : (
                  <select
                    value={ratings[item.id] ?? ''}
                    disabled={hasSubmittedRatings}
                    onChange={(event) => handleRatingChange(item.id, Number(event.target.value))}
                  >
                    <option value="">{getRatingLabel(ratings[item.id] ?? 0)}</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => (
                      <option key={score} value={score}>
                        {score}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
            <button
              type="button"
              className={`primary ${hasSubmittedRatings ? 'btnSuccess' : ''} ${ratingsBtnPulse ? 'btnPulse' : ''}`}
              disabled={hasSubmittedRatings}
              onClick={handleSubmitRatings}
            >
              {hasSubmittedRatings ? 'Sent' : 'Submit ratings'}
            </button>
          </div>
        )}

        {gameState.phase === 'finished' && (
          <div className="phaseBlock">
            <h2>Game finished</h2>
            <p>Winner: {gameState.players[0]?.name ?? 'No winner'}</p>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
