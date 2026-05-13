import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useAuth } from './auth/auth-context'
import type { ClientPlayer } from './models/client-player.type'
import type { GamePhase } from './models/game-phase.type'
import type { RatingItem } from './models/rating-item.type'
import { useGameClient } from './hooks/use-game-client'
import { AuthView } from './views/AuthView'
import { ProfileView } from './views/ProfileView'
import { AdminView } from './admin/AdminView'

type AppTheme = 'light' | 'gray' | 'dark'
const THEMES: readonly AppTheme[] = ['light', 'gray', 'dark']

const getStoredTheme = (): AppTheme => {
  const stored = localStorage.getItem('punchme-theme')
  return THEMES.includes(stored as AppTheme) ? (stored as AppTheme) : 'light'
}

const applyTheme = (theme: AppTheme): void => {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('punchme-theme', theme)
}

const PHASE_TIMER_SECONDS: Record<GamePhase, number | null> = {
  lobby: null,
  writing: 120,
  voting: 25,
  rating: 30,
  scoreboard: 8,
  finished: null
}

const TIMER_RING_R = 42
const TIMER_RING_C = 2 * Math.PI * TIMER_RING_R

const DEFAULT_ROUNDS: number = 4
const DEFAULT_BOTS: number = 1
const ROOM_CODE_LENGTH: number = 5

type FeedbackLevel = -1 | -0.5 | 0.5 | 1

const FEEDBACK_LEVELS: readonly { readonly level: FeedbackLevel; readonly icon: string; readonly label: string }[] = [
  { level: -1, icon: '👎👎', label: 'Совсем плохо' },
  { level: -0.5, icon: '👎', label: 'Слабо' },
  { level: 0.5, icon: '👍', label: 'Неплохо' },
  { level: 1, icon: '👍👍', label: 'Отлично' }
]

const getPlayerNameById = (players: readonly ClientPlayer[], playerId: string): string => {
  const player = players.find((item) => item.id === playerId)
  return player?.name ?? '???'
}

const buildRatingPayload = (ratings: Record<string, number>): readonly { readonly itemId: string; readonly score: number }[] =>
  Object.entries(ratings)
    .filter(([, score]) => Number.isInteger(score) && score >= 1 && score <= 10)
    .map(([itemId, score]) => ({ itemId, score }))

const getRatingLabel = (value: number): string => (value ? `${value}/10` : 'Оценка')

const isOwnJoke = (item: RatingItem, playerId: string | undefined): boolean => item.authorPlayerId === playerId

const getRoomCodeFromUrl = (): string | null => {
  const params = new URLSearchParams(window.location.search)
  return params.get('room')?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH) ?? null
}

function App(): ReactElement {
  const { user, token, status, logout } = useAuth()
  const [view, setView] = useState<'game' | 'profile' | 'admin'>('game')
  const [theme, setTheme] = useState<AppTheme>(getStoredTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const handleAuthError = useCallback((): void => {
    logout()
  }, [logout])

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
    executeSubmitRatings,
    executeSubmitOpeningFeedback
  } = useGameClient({ token, onAuthError: handleAuthError })

  const [roomCodeToJoin, setRoomCodeToJoin] = useState<string>(getRoomCodeFromUrl() ?? '')
  const [roundCount, setRoundCount] = useState<number>(DEFAULT_ROUNDS)
  const [botCount, setBotCount] = useState<number>(DEFAULT_BOTS)
  const [testMode, setTestMode] = useState<boolean>(false)
  const [answers, setAnswers] = useState<[string, string]>(['', ''])
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [ratingsSubmittedLocally, setRatingsSubmittedLocally] = useState<boolean>(false)
  const [ratingFlashItemId, setRatingFlashItemId] = useState<string | null>(null)
  const [answersBtnPulse, setAnswersBtnPulse] = useState<boolean>(false)
  const [ratingsBtnPulse, setRatingsBtnPulse] = useState<boolean>(false)
  const [linkCopied, setLinkCopied] = useState<boolean>(false)
  const [isStartingGame, setIsStartingGame] = useState<boolean>(false)
  const [localTimer, setLocalTimer] = useState<number | null>(null)
  const [openingFeedback, setOpeningFeedback] = useState<Record<number, FeedbackLevel>>({})
  const [openingFeedbackSent, setOpeningFeedbackSent] = useState<boolean>(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
  const isDuelParticipant = Boolean(
    session &&
      gameState?.currentDuel &&
      (session.playerId === gameState.currentDuel.leftPlayerId ||
        session.playerId === gameState.currentDuel.rightPlayerId)
  )
  const canVoteCurrentDuel = Boolean(
    gameState?.phase === 'voting' && gameState.currentDuel && !isDuelParticipant && !hasVotedCurrentDuel
  )
  const showVoteBreakdown = Boolean(
    gameState?.currentDuel &&
      (isDuelParticipant || hasVotedCurrentDuel) &&
      Object.keys(gameState.currentDuel?.votesByPlayerId ?? {}).length > 0
  )
  const timerTotalSeconds = gameState ? PHASE_TIMER_SECONDS[gameState.phase] : null
  const displaySeconds = localTimer ?? gameState?.timerSecondsLeft ?? null
  const timerFraction =
    timerTotalSeconds != null &&
    displaySeconds != null &&
    timerTotalSeconds > 0
      ? Math.max(0, Math.min(1, displaySeconds / timerTotalSeconds))
      : null

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    const serverSeconds = gameState?.timerSecondsLeft ?? null
    if (serverSeconds == null || serverSeconds <= 0) {
      setLocalTimer(null)
      return
    }
    setLocalTimer(serverSeconds)
    timerRef.current = setInterval(() => {
      setLocalTimer((prev) => {
        if (prev == null || prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [gameState?.timerSecondsLeft, gameState?.phase, gameState?.duelIndex])

  useEffect(() => {
    if (gameState?.phase && gameState.phase !== 'lobby') {
      setIsStartingGame(false)
    }
  }, [gameState?.phase])

  useEffect(() => {
    if (gameState?.phase === 'writing') {
      setAnswers(['', ''])
      setOpeningFeedback({})
      setOpeningFeedbackSent(false)
    }
  }, [gameState?.roundIndex])

  useEffect(() => {
    if (gameState?.phase === 'rating') {
      setRatings({})
      setRatingsSubmittedLocally(false)
    }
  }, [gameState?.phase, gameState?.roundIndex])

  const flushRatings = useCallback((): void => {
    if (!session || ratingsSubmittedLocally) {
      return
    }
    executeSubmitRatings({
      roomCode: session.roomCode,
      ratings: buildRatingPayload(ratings)
    })
    setRatingsSubmittedLocally(true)
  }, [executeSubmitRatings, ratings, ratingsSubmittedLocally, session])

  useEffect(() => {
    if (gameState?.phase && gameState.phase !== 'rating' && gameState.phase !== 'lobby' && !ratingsSubmittedLocally) {
      flushRatings()
    }
  }, [gameState?.phase, flushRatings, ratingsSubmittedLocally])

  useEffect(() => {
    if (
      gameState?.phase === 'rating' &&
      !ratingsSubmittedLocally &&
      localTimer != null &&
      localTimer <= 2
    ) {
      flushRatings()
    }
  }, [localTimer, gameState?.phase, ratingsSubmittedLocally, flushRatings])

  const flushOpeningFeedback = useCallback((): void => {
    if (!session || openingFeedbackSent) {
      return
    }
    const items = Object.entries(openingFeedback).map(([promptIndex, level]) => ({
      promptIndex: Number(promptIndex),
      level
    }))
    if (items.length === 0) {
      return
    }
    executeSubmitOpeningFeedback({ roomCode: session.roomCode, items })
    setOpeningFeedbackSent(true)
  }, [executeSubmitOpeningFeedback, openingFeedback, openingFeedbackSent, session])

  useEffect(() => {
    if (gameState?.phase && gameState.phase !== 'writing' && !openingFeedbackSent) {
      flushOpeningFeedback()
    }
  }, [gameState?.phase, flushOpeningFeedback, openingFeedbackSent])

  const handleCreateRoom = (): void => {
    const isAdmin: boolean = user?.role === 'admin'
    executeCreateRoom({ roundCount, botCount, testMode: isAdmin ? testMode : undefined })
  }

  const handleJoinRoom = (): void => {
    executeJoinRoom({ roomCode: roomCodeToJoin.toUpperCase().slice(0, ROOM_CODE_LENGTH) })
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
    flushOpeningFeedback()
  }

  const handleRatingChange = (itemId: string, score: number): void => {
    setRatings((current) => ({ ...current, [itemId]: score }))
    setRatingFlashItemId(itemId)
    window.setTimeout(() => {
      setRatingFlashItemId((current) => (current === itemId ? null : current))
    }, 420)
  }

  const handleSubmitRatings = (): void => {
    if (!session || hasSubmittedRatings || ratingsSubmittedLocally) {
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
    setRatingsSubmittedLocally(true)
  }

  const handleVote = (side: 'left' | 'right'): void => {
    if (!session || !gameState?.currentDuel) {
      return
    }
    if (isDuelParticipant || hasVotedCurrentDuel) {
      return
    }
    executeCastVote({
      roomCode: session.roomCode,
      duelId: gameState.currentDuel.id,
      side
    })
  }

  const handleCopyRoomLink = useCallback((): void => {
    if (!session) {
      return
    }
    const url = new URL(window.location.href)
    url.searchParams.set('room', session.roomCode)
    void navigator.clipboard.writeText(url.toString()).then(() => {
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 2000)
    })
  }, [session])

  const togglePromptFeedback = (promptIndex: number, level: FeedbackLevel): void => {
    setOpeningFeedback((current) => {
      const next = { ...current }
      if (next[promptIndex] === level) {
        delete next[promptIndex]
      } else {
        next[promptIndex] = level
      }
      return next
    })
  }

  const themeSwitcher = (
    <div className="themeSwitcher">
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          className={`themeBtn themeBtn${t.charAt(0).toUpperCase() + t.slice(1)} ${theme === t ? 'themeBtnActive' : ''}`}
          onClick={() => setTheme(t)}
          title={t === 'light' ? 'Светлая' : t === 'gray' ? 'Серая' : 'Тёмная'}
        />
      ))}
    </div>
  )

  if (status === 'loading') {
    return (
      <main className="layout">
        <section className="panel">
          <p className="subtitle">Загрузка...</p>
        </section>
      </main>
    )
  }

  if (!user || !token) {
    return <AuthView />
  }

  if (view === 'profile') {
    return <ProfileView onBack={() => setView('game')} />
  }

  if (view === 'admin') {
    return <AdminView onBack={() => setView('game')} />
  }

  if (!gameState || !session) {
    const hasRoomFromUrl = Boolean(getRoomCodeFromUrl())
    return (
      <main className="layout">
        <section className="panel">
          <div className="header">
            <div>
              <h1>PunchMe Party</h1>
              <p className="subtitle">Привет, {user.displayName} (@{user.login})</p>
            </div>
            {themeSwitcher}
          </div>
          {errorMessage && <p className="subtitle errorText">{errorMessage}</p>}
          <div className="row">
            <button type="button" className="secondary" onClick={() => setView('profile')}>
              Профиль
            </button>
            {user.role === 'admin' && (
              <button type="button" className="secondary" onClick={() => setView('admin')}>
                Админка
              </button>
            )}
            <button type="button" className="secondary" onClick={logout}>
              Выйти
            </button>
          </div>
          <div className="divider" />
          <div className="row">
            <label className="inputGroup">
              <span>Раунды</span>
              <select value={roundCount} onChange={(event) => setRoundCount(Number(event.target.value))}>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
            <label className="inputGroup">
              <span>Боты</span>
              <select value={botCount} onChange={(event) => setBotCount(Number(event.target.value))}>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </label>
          </div>
          {user?.role === 'admin' && (
            <label className="inputGroup" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={testMode}
                onChange={(event) => setTestMode(event.target.checked)}
              />
              <span>Тестовая комната (не записывать в БД)</span>
            </label>
          )}
          <button className="primary" onClick={handleCreateRoom}>
            Создать комнату
          </button>
          <div className="divider" />
          <label className="inputGroup">
            <span>Код комнаты</span>
            <input
              value={roomCodeToJoin}
              onChange={(event) => setRoomCodeToJoin(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              maxLength={ROOM_CODE_LENGTH}
              placeholder="Введи код..."
            />
          </label>
          <button className="secondary" onClick={handleJoinRoom}>
            {hasRoomFromUrl ? 'Присоединиться по ссылке' : 'Присоединиться'}
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
            <h1>
              Комната {gameState.roomCode}
              {gameState.testMode && <span style={{ marginLeft: 8, fontSize: '0.6em', color: '#f59e0b' }}>TEST</span>}
            </h1>
            <p className="subtitle">
              Раунд {Math.max(gameState.roundIndex, 1)} из {gameState.roundCount}
            </p>
          </div>
          <div className="headerActions">
            {themeSwitcher}
            <div className="timerHud" aria-label="Оставшееся время фазы">
              <svg className="timerRingSvg" viewBox="0 0 100 100" aria-hidden>
                <defs>
                  <linearGradient id="timerRingGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="var(--accent)" />
                    <stop offset="100%" stopColor="var(--accent-end)" />
                  </linearGradient>
                </defs>
                <circle className="timerRingTrack" cx="50" cy="50" r={TIMER_RING_R} />
                {timerFraction != null && displaySeconds != null ? (
                  <circle
                    className="timerRingProgress"
                    cx="50"
                    cy="50"
                    r={TIMER_RING_R}
                    stroke="url(#timerRingGrad)"
                    strokeDasharray={TIMER_RING_C}
                    strokeDashoffset={TIMER_RING_C * (1 - timerFraction)}
                    transform="rotate(-90 50 50)"
                  />
                ) : null}
              </svg>
              <div className="timerHudCenter">
                <span className="timerHudLabel">Осталось</span>
                {displaySeconds != null ? (
                  <span className="timerHudValue">{displaySeconds}</span>
                ) : (
                  <span className="timerHudIdle">&mdash;</span>
                )}
                <span className="timerHudUnit">сек</span>
              </div>
            </div>
            <button className="secondary" onClick={() => setView('profile')}>
              Профиль
            </button>
            <button className="secondary leaveButton" onClick={executeLeaveRoom}>
              Выйти
            </button>
          </div>
        </header>
        {errorMessage && <p className="subtitle errorText">{errorMessage}</p>}

        <ul className="scoreboard">
          {gameState.players.map((player) => (
            <li key={player.id}>
              <span>
                {player.name} {player.isBot ? '🤖' : ''} {player.id === session.playerId ? '(ты)' : ''}
              </span>
              <strong>{player.score}</strong>
            </li>
          ))}
        </ul>

        {gameState.phase === 'lobby' && (
          <div className="phaseBlock">
            <p>Ожидание игроков...</p>
            <button className="secondary copyLinkBtn" onClick={handleCopyRoomLink}>
              {linkCopied ? 'Ссылка скопирована!' : 'Скопировать ссылку на комнату'}
            </button>
            <div className={`aiStatusBadge aiStatus-${gameState.aiStatus}`}>
              {gameState.aiStatus === 'generating' && (
                <>
                  <span className="aiSpinner" aria-hidden />
                  <span>AI готовит начала шуток...</span>
                </>
              )}
              {gameState.aiStatus === 'ready' && (
                <>
                  <span className="aiCheck" aria-hidden>✨</span>
                  <span>Шутки готовы — можно начинать!</span>
                </>
              )}
              {gameState.aiStatus === 'idle' && (
                <span>Ожидание начала генерации...</span>
              )}
            </div>
            {canStart && (
              <button
                className="primary"
                disabled={isStartingGame || gameState.aiStatus === 'generating'}
                onClick={() => {
                  setIsStartingGame(true)
                  executeStartGame({ roomCode: session.roomCode })
                }}
              >
                {isStartingGame ? (
                  <>
                    <span className="aiSpinner aiSpinnerInline" aria-hidden />
                    Запускаем игру...
                  </>
                ) : gameState.aiStatus === 'generating' ? (
                  'Ждём AI...'
                ) : (
                  'Начать игру'
                )}
              </button>
            )}
          </div>
        )}

        {gameState.phase === 'writing' && (
          <div className={`phaseBlock ${hasSubmittedAnswers ? 'phaseSuccess' : ''}`}>
            <h2>Закончи оба предложения</h2>
            {hasSubmittedAnswers && <p className="confirmBanner">Ответы отправлены — ждём остальных</p>}
            {[0, 1].map((slot) => {
              const promptText = myPromptLabels[slot]
              const assignedIndex = myAssignment?.promptIndices[slot]
              const currentLevel = assignedIndex != null ? openingFeedback[assignedIndex] : undefined
              return (
                <div key={slot} className="inputGroup">
                  <div className="promptHeader">
                    <span>{promptText}</span>
                    {assignedIndex != null && (
                      <div
                        className="feedbackButtons"
                        role="group"
                        aria-label="Оценка начала шутки. Нейтрально — просто не нажимай."
                      >
                        {FEEDBACK_LEVELS.map(({ level, icon, label }) => (
                          <button
                            key={level}
                            type="button"
                            className={`feedbackBtn ${currentLevel === level ? 'feedbackBtnActive' : ''}`}
                            disabled={openingFeedbackSent}
                            onClick={() => togglePromptFeedback(assignedIndex, level)}
                            title={label}
                          >
                            {icon}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <textarea
                    value={answers[slot]}
                    disabled={hasSubmittedAnswers}
                    onChange={(event) =>
                      setAnswers(
                        slot === 0 ? [event.target.value, answers[1]] : [answers[0], event.target.value]
                      )
                    }
                    placeholder="Напиши продолжение..."
                  />
                </div>
              )
            })}
            <button
              type="button"
              className={`primary ${hasSubmittedAnswers ? 'btnSuccess' : ''} ${answersBtnPulse ? 'btnPulse' : ''}`}
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {hasSubmittedAnswers ? 'Отправлено' : 'Отправить ответы'}
            </button>
          </div>
        )}

        {gameState.phase === 'voting' && gameState.currentDuel && (
          <div className="phaseBlock">
            <p className="subtitle">
              Дуэль {gameState.duelIndex + 1} из {gameState.duelCount}
            </p>
            {isDuelParticipant ? (
              <p className="subtitle voteHint">Вы участвуете в этой дуэли — голосуют только зрители.</p>
            ) : (
              <p className="subtitle voteHint">Варианты без имён — так объективнее.</p>
            )}
            <h2>{gameState.currentDuel.prompt}</h2>
            {hasVotedCurrentDuel && myVoteSide && !isDuelParticipant && (
              <p className="voteStatus">
                Ваш голос: {myVoteSide === 'left' ? 'вариант A' : 'вариант B'}
              </p>
            )}
            <button
              type="button"
              className={`voteOption ${!canVoteCurrentDuel ? 'voteLocked' : ''} ${myVoteSide === 'left' ? 'voteSelected' : ''}`}
              disabled={!canVoteCurrentDuel}
              onClick={() => handleVote('left')}
            >
              <span className="voteOptionMeta">
                <span className="voteOptionTag">Вариант A</span>
                {isDuelParticipant && session?.playerId === gameState.currentDuel.leftPlayerId ? (
                  <span className="voteSelfMark">Ваш ответ</span>
                ) : null}
              </span>
              <span className="voteOptionBody">{gameState.currentDuel.leftAnswer}</span>
            </button>
            <button
              type="button"
              className={`voteOption ${!canVoteCurrentDuel ? 'voteLocked' : ''} ${myVoteSide === 'right' ? 'voteSelected' : ''}`}
              disabled={!canVoteCurrentDuel}
              onClick={() => handleVote('right')}
            >
              <span className="voteOptionMeta">
                <span className="voteOptionTag">Вариант B</span>
                {isDuelParticipant && session?.playerId === gameState.currentDuel.rightPlayerId ? (
                  <span className="voteSelfMark">Ваш ответ</span>
                ) : null}
              </span>
              <span className="voteOptionBody">{gameState.currentDuel.rightAnswer}</span>
            </button>
            {showVoteBreakdown && gameState.currentDuel ? (
              <div className="voteBreakdown">
                <p className="voteBreakdownTitle">Кто за что голосовал</p>
                <ul className="voteBreakdownList">
                  {Object.entries(gameState.currentDuel.votesByPlayerId).map(([voterId, side]) => (
                    <li key={voterId}>
                      <span>{getPlayerNameById(gameState.players, voterId)}</span>
                      <span className="voteBreakdownSide">{side === 'left' ? 'A' : 'B'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        {gameState.phase === 'scoreboard' && (
          <div className="phaseBlock">
            <h2>Раунд завершён</h2>
            <p>Очки обновлены. Следующий раунд начнётся автоматически.</p>
          </div>
        )}

        {gameState.phase === 'rating' && (
          <div className={`phaseBlock ${hasSubmittedRatings ? 'phaseSuccess' : ''}`}>
            <h2>Оцени шутки</h2>
            <p className="subtitle ratingHint">Оценка необязательна — можно отправить пустую.</p>
            {hasSubmittedRatings && <p className="confirmBanner">Оценки отправлены</p>}
            {gameState.ratingItems.map((item) => (
              <div
                key={item.id}
                className={`ratingItem ${ratingFlashItemId === item.id ? 'ratingPickFlash' : ''}`}
              >
                <p>{item.prompt}</p>
                <strong>{item.punchline}</strong>
                <small>{getPlayerNameById(gameState.players, item.authorPlayerId)}</small>
                {isOwnJoke(item, session.playerId) ? (
                  <span className="ratingSelf">Твоя шутка</span>
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
              {hasSubmittedRatings ? 'Отправлено' : 'Отправить оценки'}
            </button>
          </div>
        )}

        {gameState.phase === 'finished' && (
          <div className="phaseBlock">
            <h2>Игра окончена!</h2>
            <p>Победитель: {gameState.players[0]?.name ?? 'Нет победителя'}</p>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
