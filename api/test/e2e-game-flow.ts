import { io, Socket } from 'socket.io-client'
import { MongoClient } from 'mongodb'

const API_URL = 'http://localhost:4000'
const MONGO_URI = 'mongodb://localhost:27017/punchme'

const KNOWN_FALLBACKS = [
  'это звучало лучше в моей голове.',
  'это был смелый план ровно до первой минуты.',
  'я сделал вид, что именно так и задумал.',
  'соседи теперь аплодируют и боятся.',
  'я получил опыт и счет за ущерб.',
  'главное произнести это уверенно.'
]

interface Player {
  id: string
  name: string
  isBot: boolean
  score: number
}

interface Duel {
  id: string
  prompt: string
  leftAnswer: string
  rightAnswer: string
  leftPlayerId: string
  rightPlayerId: string
  votesByPlayerId: Record<string, string>
}

interface RatingItem {
  id: string
  prompt: string
  punchline: string
  authorPlayerId: string
}

interface GameState {
  roomCode: string
  phase: string
  roundIndex: number
  roundCount: number
  players: Player[]
  prompts: string[]
  promptAssignments: { playerId: string; promptIndices: number[] }[]
  currentDuel: Duel | null
  duelIndex: number
  duelCount: number
  writingSubmitters: string[]
  ratingSubmitters: string[]
  ratingItems: RatingItem[]
  timerSecondsLeft: number | null
}

interface Session {
  roomCode: string
  playerId: string
}

interface BotAnswerRecord {
  round: number
  prompt: string
  answer: string
  isFallback: boolean
  repeatsPrompt: boolean
  isRussian: boolean
  lengthOk: boolean
  botName: string
}

// ---- Helpers ----

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[${ts}] ${msg}`)
}

function err(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23)
  console.error(`[${ts}] ERROR: ${msg}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function hasCyrillic(text: string): boolean {
  return /[а-яёА-ЯЁ]/.test(text)
}

function isFallback(answer: string): boolean {
  const normalized = answer.trim().toLowerCase()
  return KNOWN_FALLBACKS.some((fb) => normalized === fb.toLowerCase())
}

function repeatsPromptStart(prompt: string, answer: string): boolean {
  const promptWords = prompt.trim().toLowerCase().split(/\s+/)
  const answerLower = answer.trim().toLowerCase()
  // Check if answer starts with first 3+ words of prompt
  if (promptWords.length >= 3) {
    const prefix = promptWords.slice(0, 3).join(' ')
    if (answerLower.startsWith(prefix)) {
      return true
    }
  }
  // Check if answer contains a large chunk of the prompt
  if (prompt.length > 15) {
    const promptLower = prompt.trim().toLowerCase().replace(/[:\s]+$/, '')
    if (answerLower.includes(promptLower)) {
      return true
    }
  }
  return false
}

function connectSocket(): Socket {
  return io(API_URL, {
    transports: ['websocket'],
    autoConnect: true,
    forceNew: true
  })
}

function waitForEvent<T>(socket: Socket, event: string, timeoutMs: number = 30000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler)
      reject(new Error(`Timeout waiting for event "${event}" after ${timeoutMs}ms`))
    }, timeoutMs)
    const handler = (data: T): void => {
      clearTimeout(timer)
      resolve(data)
    }
    socket.once(event, handler)
  })
}

function waitForPhase(
  socket: Socket,
  phase: string,
  timeoutMs: number = 120000
): Promise<GameState> {
  return new Promise<GameState>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('gameState', handler)
      reject(new Error(`Timeout waiting for phase "${phase}" after ${timeoutMs}ms`))
    }, timeoutMs)
    const handler = (state: GameState): void => {
      if (state.phase === phase) {
        clearTimeout(timer)
        socket.off('gameState', handler)
        resolve(state)
      }
    }
    socket.on('gameState', handler)
  })
}

function waitForPhaseOrAny(
  socket: Socket,
  phases: string[],
  timeoutMs: number = 120000
): Promise<GameState> {
  return new Promise<GameState>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('gameState', handler)
      reject(new Error(`Timeout waiting for phases [${phases.join(',')}] after ${timeoutMs}ms`))
    }, timeoutMs)
    const handler = (state: GameState): void => {
      if (phases.includes(state.phase)) {
        clearTimeout(timer)
        socket.off('gameState', handler)
        resolve(state)
      }
    }
    socket.on('gameState', handler)
  })
}

function waitForDuelChange(
  socket: Socket,
  currentDuelIndex: number,
  timeoutMs: number = 60000
): Promise<GameState> {
  return new Promise<GameState>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('gameState', handler)
      reject(new Error(`Timeout waiting for duel change from index ${currentDuelIndex}`))
    }, timeoutMs)
    const handler = (state: GameState): void => {
      if (state.phase !== 'voting' || state.duelIndex !== currentDuelIndex) {
        clearTimeout(timer)
        socket.off('gameState', handler)
        resolve(state)
      }
    }
    socket.on('gameState', handler)
  })
}

// ---- Main Test ----

async function runTest(): Promise<void> {
  log('=== E2E Game Flow Test ===')
  log(`API: ${API_URL}`)
  log(`MongoDB: ${MONGO_URI}`)

  // Track data across rounds
  const allPrompts: string[][] = []
  const botAnswers: BotAnswerRecord[] = []
  let completionsBefore = 0

  // Connect to MongoDB to check state before/after
  const mongo = new MongoClient(MONGO_URI)
  await mongo.connect()
  const db = mongo.db('punchme')
  const promptStarters = db.collection('prompt_starters')

  // Count completions before test
  const beforeStats = await promptStarters.aggregate([
    { $unwind: '$completions' },
    { $count: 'total' }
  ]).toArray()
  completionsBefore = beforeStats[0]?.total ?? 0
  log(`Completions in DB before test: ${completionsBefore}`)

  const promptCountBefore = await promptStarters.countDocuments()
  log(`Prompt starters in DB: ${promptCountBefore}`)

  // --- Connect two players ---
  const p1Socket = connectSocket()
  const p2Socket = connectSocket()

  await sleep(500)
  log('Both sockets connected')

  // Player 1 creates room
  const sessionPromise1 = waitForEvent<Session>(p1Socket, 'session')
  p1Socket.emit('createRoom', { name: 'Тестер1', roundCount: 3, botCount: 2 })
  const session1 = await sessionPromise1
  log(`Player 1 created room: ${session1.roomCode} (playerId: ${session1.playerId})`)

  const lobbyState = await waitForEvent<GameState>(p1Socket, 'gameState')
  log(`Room has ${lobbyState.players.length} players: ${lobbyState.players.map((p) => `${p.name}${p.isBot ? '(bot)' : ''}`).join(', ')}`)

  // Player 2 joins
  const p2SessionPromise = waitForEvent<Session>(p2Socket, 'session')
  p2Socket.emit('joinRoom', { roomCode: session1.roomCode, name: 'Тестер2' })
  const session2 = await p2SessionPromise
  log(`Player 2 joined room: ${session2.roomCode} (playerId: ${session2.playerId})`)

  await sleep(300)

  // Start game
  log('Starting game...')
  const writingPromise = waitForPhase(p1Socket, 'writing')
  p1Socket.emit('startGame', { roomCode: session1.roomCode })

  // === ROUND LOOP ===
  for (let round = 1; round <= 3; round++) {
    log(`\n====== ROUND ${round} ======`)

    // --- Writing Phase ---
    const writingState = round === 1
      ? await writingPromise
      : await waitForPhase(p1Socket, 'writing')

    log(`Writing phase started. Round index: ${writingState.roundIndex}`)
    log(`Prompts (${writingState.prompts.length}):`)
    writingState.prompts.forEach((p, i) => log(`  [${i}] "${p}"`))
    allPrompts.push([...writingState.prompts])

    // Get assignments for both players
    const p1Assignment = writingState.promptAssignments.find((a) => a.playerId === session1.playerId)
    const p2Assignment = writingState.promptAssignments.find((a) => a.playerId === session2.playerId)
    log(`P1 assigned prompts: [${p1Assignment?.promptIndices.join(', ')}]`)
    log(`P2 assigned prompts: [${p2Assignment?.promptIndices.join(', ')}]`)

    // Submit human answers
    await sleep(2000) // Let bots start generating

    const p1Answers: [string, string] = [
      `тестовый ответ игрока 1 раунд ${round} шутка A`,
      `тестовый ответ игрока 1 раунд ${round} шутка B`
    ]
    const p2Answers: [string, string] = [
      `тестовый ответ игрока 2 раунд ${round} шутка A`,
      `тестовый ответ игрока 2 раунд ${round} шутка B`
    ]

    p1Socket.emit('submitAnswers', { roomCode: session1.roomCode, answers: p1Answers })
    log('P1 submitted answers')
    await sleep(300)
    p2Socket.emit('submitAnswers', { roomCode: session1.roomCode, answers: p2Answers })
    log('P2 submitted answers')

    // Wait for voting phase (bots might still be generating)
    log('Waiting for voting phase...')
    const votingState = await waitForPhase(p1Socket, 'voting', 180000)
    log(`Voting phase started. Duels: ${votingState.duelCount}`)

    // Register rating listener BEFORE voting loop to not miss the event
    const ratingPromise = waitForPhase(p1Socket, 'rating', 180000)

    // Track latest state via a persistent listener
    let latestState = votingState
    const stateTracker = (state: GameState): void => { latestState = state }
    p1Socket.on('gameState', stateTracker)

    // Collect bot answers from duels
    let currentVotingState = votingState
    for (let duelIdx = 0; duelIdx < votingState.duelCount; duelIdx++) {
      // Get fresh state for this duel from p1's perspective
      if (duelIdx > 0) {
        // Wait for duel to change or phase to change
        const deadline = Date.now() + 60000
        while (Date.now() < deadline) {
          if (latestState.phase !== 'voting' || latestState.duelIndex !== duelIdx - 1) {
            break
          }
          await sleep(300)
        }
        currentVotingState = latestState
        if (currentVotingState.phase !== 'voting') {
          log(`Phase changed to ${currentVotingState.phase} during voting`)
          break
        }
      }

      const duel = currentVotingState.currentDuel
      if (!duel) {
        log(`  Duel ${duelIdx}: no duel data`)
        continue
      }

      log(`  Duel ${duelIdx + 1}/${votingState.duelCount}: prompt="${duel.prompt}"`)
      log(`    Left (${getPlayerName(currentVotingState.players, duel.leftPlayerId)}): "${duel.leftAnswer}"`)
      log(`    Right (${getPlayerName(currentVotingState.players, duel.rightPlayerId)}): "${duel.rightAnswer}"`)

      // Record bot answers
      const leftPlayer = currentVotingState.players.find((p) => p.id === duel.leftPlayerId)
      const rightPlayer = currentVotingState.players.find((p) => p.id === duel.rightPlayerId)

      if (leftPlayer?.isBot) {
        botAnswers.push(analyzeBotAnswer(round, duel.prompt, duel.leftAnswer, leftPlayer.name))
      }
      if (rightPlayer?.isBot) {
        botAnswers.push(analyzeBotAnswer(round, duel.prompt, duel.rightAnswer, rightPlayer.name))
      }

      // Both humans vote (if they can)
      const isP1InDuel = duel.leftPlayerId === session1.playerId || duel.rightPlayerId === session1.playerId
      const isP2InDuel = duel.leftPlayerId === session2.playerId || duel.rightPlayerId === session2.playerId

      if (!isP1InDuel) {
        const side = Math.random() > 0.5 ? 'left' : 'right'
        p1Socket.emit('castVote', { roomCode: session1.roomCode, duelId: duel.id, side })
        log(`    P1 voted: ${side}`)
      }
      await sleep(200)
      if (!isP2InDuel) {
        const side = Math.random() > 0.5 ? 'left' : 'right'
        p2Socket.emit('castVote', { roomCode: session1.roomCode, duelId: duel.id, side })
        log(`    P2 voted: ${side}`)
      }

      // Wait a bit for vote processing and bot votes
      await sleep(2000)
    }

    p1Socket.off('gameState', stateTracker)

    // --- Rating Phase ---
    log('Waiting for rating phase...')
    const ratingState = await ratingPromise
    log(`Rating phase. Items: ${ratingState.ratingItems.length}`)
    ratingState.ratingItems.forEach((item) => {
      const author = getPlayerName(ratingState.players, item.authorPlayerId)
      log(`  "${item.prompt}" → "${item.punchline}" (by ${author})`)
    })

    // Register scoreboard listener before submitting ratings
    const scorePromise = waitForPhaseOrAny(p1Socket, ['scoreboard', 'writing', 'finished'], 60000)

    // Submit ratings for both players
    const p1Ratings = ratingState.ratingItems
      .filter((item) => item.authorPlayerId !== session1.playerId)
      .map((item) => ({ itemId: item.id, score: Math.floor(Math.random() * 10) + 1 }))
    const p2Ratings = ratingState.ratingItems
      .filter((item) => item.authorPlayerId !== session2.playerId)
      .map((item) => ({ itemId: item.id, score: Math.floor(Math.random() * 10) + 1 }))

    p1Socket.emit('submitRatings', { roomCode: session1.roomCode, ratings: p1Ratings })
    log(`P1 submitted ${p1Ratings.length} ratings`)
    await sleep(300)
    p2Socket.emit('submitRatings', { roomCode: session1.roomCode, ratings: p2Ratings })
    log(`P2 submitted ${p2Ratings.length} ratings`)

    // --- Scoreboard ---
    log('Waiting for scoreboard...')
    const scoreState = await scorePromise
    log(`Phase: ${scoreState.phase}`)
    log('Scores:')
    scoreState.players.forEach((p) => {
      log(`  ${p.name}${p.isBot ? ' (bot)' : ''}: ${p.score}`)
    })

    if (scoreState.phase === 'finished') {
      log('Game finished!')
      break
    }

    // If scoreboard, wait for next writing or finished
    if (scoreState.phase === 'scoreboard' && round < 3) {
      await sleep(1000)
    }
  }

  // Wait for final state
  await sleep(3000)

  // === REPORT ===
  log('\n\n========================================')
  log('           E2E TEST REPORT')
  log('========================================\n')

  // 1. Prompt analysis
  log('--- PROMPTS ---')
  const allFlat = allPrompts.flat()
  const uniquePrompts = new Set(allFlat)
  log(`Total prompts across rounds: ${allFlat.length}`)
  log(`Unique prompts: ${uniquePrompts.size}`)
  log(`Duplicates between rounds: ${allFlat.length - uniquePrompts.size}`)

  const emptyPrompts = allFlat.filter((p) => !p || p.length < 5)
  log(`Empty/too-short prompts: ${emptyPrompts.length}`)

  for (let i = 0; i < allPrompts.length; i++) {
    for (let j = i + 1; j < allPrompts.length; j++) {
      const overlap = allPrompts[i].filter((p) => allPrompts[j].includes(p))
      if (overlap.length > 0) {
        log(`  DUPLICATE: rounds ${i + 1} & ${j + 1}: ${overlap.map((p) => `"${p}"`).join(', ')}`)
      }
    }
  }

  // 2. Bot answer analysis
  log('\n--- BOT ANSWERS ---')
  log(`Total bot answers: ${botAnswers.length}`)

  const fallbacks = botAnswers.filter((a) => a.isFallback)
  log(`Fallbacks: ${fallbacks.length}`)
  if (fallbacks.length > 0) {
    fallbacks.forEach((a) => log(`  FALLBACK round=${a.round} bot=${a.botName}: "${a.answer}"`))
  }

  const repeats = botAnswers.filter((a) => a.repeatsPrompt)
  log(`Repeats prompt start: ${repeats.length}`)
  if (repeats.length > 0) {
    repeats.forEach((a) => {
      log(`  REPEATS round=${a.round} bot=${a.botName}:`)
      log(`    prompt: "${a.prompt}"`)
      log(`    answer: "${a.answer}"`)
    })
  }

  const notRussian = botAnswers.filter((a) => !a.isRussian)
  log(`Not Russian: ${notRussian.length}`)
  if (notRussian.length > 0) {
    notRussian.forEach((a) => log(`  NOT_RU round=${a.round}: "${a.answer}"`))
  }

  const badLength = botAnswers.filter((a) => !a.lengthOk)
  log(`Bad length: ${badLength.length}`)

  // All bot answers detail
  log('\nAll bot answers:')
  botAnswers.forEach((a) => {
    const flags = [
      a.isFallback ? 'FALLBACK' : null,
      a.repeatsPrompt ? 'REPEATS' : null,
      !a.isRussian ? 'NOT_RU' : null,
      !a.lengthOk ? 'BAD_LEN' : null
    ].filter(Boolean).join(',')
    log(`  R${a.round} [${a.botName}] ${flags ? `{${flags}} ` : ''}prompt="${a.prompt.slice(0, 50)}..." → "${a.answer}"`)
  })

  // 3. MongoDB check
  log('\n--- MONGODB ---')
  const afterStats = await promptStarters.aggregate([
    { $unwind: '$completions' },
    { $count: 'total' }
  ]).toArray()
  const completionsAfter = afterStats[0]?.total ?? 0
  const newCompletions = completionsAfter - completionsBefore
  log(`Completions before: ${completionsBefore}`)
  log(`Completions after: ${completionsAfter}`)
  log(`New completions added: ${newCompletions}`)

  // Check source field distribution
  const sourceDist = await promptStarters.aggregate([
    { $unwind: '$completions' },
    { $group: { _id: '$completions.source', count: { $sum: 1 } } }
  ]).toArray()
  log(`Source distribution: ${sourceDist.map((s) => `${s._id}=${s.count}`).join(', ')}`)

  const promptCountAfter = await promptStarters.countDocuments()
  log(`Prompt starters before: ${promptCountBefore}, after: ${promptCountAfter}, new: ${promptCountAfter - promptCountBefore}`)

  // Summary table
  log('\n--- SUMMARY ---')
  log(`Rounds completed:     3/3`)
  log(`Prompts from DB:      ${allFlat.length}`)
  log(`Duplicate prompts:    ${allFlat.length - uniquePrompts.size}`)
  log(`Bot answers total:    ${botAnswers.length}`)
  log(`  Fallbacks:          ${fallbacks.length}`)
  log(`  Repeats prompt:     ${repeats.length}`)
  log(`  Not Russian:        ${notRussian.length}`)
  log(`  Bad length:         ${badLength.length}`)
  log(`New completions:      ${newCompletions}`)
  log(`New prompts (AI gen): ${promptCountAfter - promptCountBefore}`)

  const passed = fallbacks.length === 0
    && repeats.length === 0
    && notRussian.length === 0
    && badLength.length === 0
    && (allFlat.length - uniquePrompts.size) === 0
    && newCompletions > 0

  log(`\nOVERALL: ${passed ? 'PASS' : 'FAIL'}`)

  // Cleanup
  p1Socket.disconnect()
  p2Socket.disconnect()
  await mongo.close()
  log('Done.')
}

function getPlayerName(players: Player[], id: string): string {
  return players.find((p) => p.id === id)?.name ?? '???'
}

function analyzeBotAnswer(round: number, prompt: string, answer: string, botName: string): BotAnswerRecord {
  return {
    round,
    prompt,
    answer,
    isFallback: isFallback(answer),
    repeatsPrompt: repeatsPromptStart(prompt, answer),
    isRussian: hasCyrillic(answer),
    lengthOk: answer.length >= 1 && answer.length <= 140,
    botName
  }
}

runTest().catch((error) => {
  err(String(error))
  process.exit(1)
})
