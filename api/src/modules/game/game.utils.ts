import { customAlphabet } from 'nanoid'
import { ANSWER_MAX_LENGTH, OPENING_MAX_LENGTH, PLAYER_NAME_MAX_LENGTH } from './constants/game.constants'
import { Duel } from './models/duel.type'
import { GameRoom } from './models/game-room.type'
import { Player } from './models/player.type'
import { RatingItem } from './models/rating-item.type'
import { Submission } from './models/submission.type'

const roomCodeGenerator = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 5)
const idGenerator = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12)

export const createId = (): string => idGenerator()

export const createRoomCode = (): string => roomCodeGenerator()

export const normalizeName = (name: string): string =>
  name.replace(/\s+/g, ' ').trim().slice(0, PLAYER_NAME_MAX_LENGTH) || 'Player'

export const normalizeAnswer = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, ANSWER_MAX_LENGTH)

export const normalizeOpening = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, OPENING_MAX_LENGTH)

export const createHumanPlayer = (input: {
  readonly userId: string
  readonly socketId: string | null
  readonly displayName: string
  readonly realName: string
  readonly bio: string | null
  readonly gender: 'male' | 'female' | 'non-binary' | 'not-specified'
  readonly isTestAccount: boolean
}): Player => ({
  id: input.userId,
  socketId: input.socketId,
  isBot: false,
  name: normalizeName(input.displayName),
  realName: normalizeName(input.realName),
  bio: input.bio?.slice(0, 200) ?? '',
  gender: input.gender,
  isTestAccount: input.isTestAccount,
  connected: true,
  score: 0
})

const BOT_NAMES: readonly string[] = ['Ебланыч', 'Зеля']

export const createBotPlayer = (input: { readonly botNumber: number }): Player => {
  const label: string = BOT_NAMES[input.botNumber - 1] ?? `AI Bot ${input.botNumber}`
  return {
    id: createId(),
    socketId: null,
    isBot: true,
    name: label,
    realName: label,
    bio: '',
    gender: 'not-specified',
    isTestAccount: false,
    connected: true,
    score: 0
  }
}

export const buildPlayerContext = (players: Map<string, Player>): string => {
  const lines: string[] = []
  players.forEach((player) => {
    if (player.isBot) {
      return
    }
    if (player.bio) {
      lines.push(`${player.name}: ${player.bio}`)
    } else {
      lines.push(player.name)
    }
  })
  return lines.join('\n')
}

export const createSubmission = (playerId: string, assignedPromptIndices: readonly [number, number]): Submission => ({
  playerId,
  assignedPromptIndices,
  answers: ['', ''],
  submittedAt: null
})

const ASSIGNMENT_SHUFFLE_ATTEMPTS: number = 200

// player[i] receives openings i and (i+1)%n, so an order is author-safe when no
// player lands on a position adjacent to their own opening.
const isAuthorSafeOrder = (
  shuffled: readonly string[],
  openingAuthors: ReadonlyMap<number, string>
): boolean => {
  const n = shuffled.length
  for (let i = 0; i < n; i += 1) {
    if (openingAuthors.get(i) === shuffled[i] || openingAuthors.get((i + 1) % n) === shuffled[i]) {
      return false
    }
  }
  return true
}

export const buildCircularPromptAssignments = (
  playerIds: readonly string[],
  openingAuthors?: ReadonlyMap<number, string>
): Map<string, readonly [number, number]> => {
  const n = playerIds.length
  const needsConstraint = Boolean(openingAuthors && openingAuthors.size > 0)
  let shuffled = [...playerIds].sort(() => Math.random() - 0.5)
  if (needsConstraint && openingAuthors) {
    // n=2 is unsolvable (both players see both openings) — keep the last shuffle.
    for (let attempt = 0; attempt < ASSIGNMENT_SHUFFLE_ATTEMPTS; attempt += 1) {
      if (isAuthorSafeOrder(shuffled, openingAuthors)) {
        break
      }
      shuffled = [...playerIds].sort(() => Math.random() - 0.5)
    }
  }
  const map = new Map<string, readonly [number, number]>()
  for (let i = 0; i < n; i += 1) {
    const playerId = shuffled[i]
    const a = i
    const b = (i + 1) % n
    map.set(playerId, [a, b])
  }
  return map
}

export const getPlayersForPrompt = (
  assignments: ReadonlyMap<string, readonly [number, number]>,
  promptIndex: number
): readonly [string, string] => {
  const found: string[] = []
  assignments.forEach((indices, playerId) => {
    if (indices[0] === promptIndex || indices[1] === promptIndex) {
      found.push(playerId)
    }
  })
  if (found.length !== 2) {
    throw new Error(`Expected exactly 2 players for prompt ${promptIndex}, got ${found.length}`)
  }
  return [found[0], found[1]]
}

export const getAnswerForPromptIndex = (submission: Submission, promptIndex: number): string => {
  const [i0, i1] = submission.assignedPromptIndices
  if (promptIndex === i0) {
    return submission.answers[0]
  }
  if (promptIndex === i1) {
    return submission.answers[1]
  }
  return ''
}

export const createDuelsForPrompts = (room: GameRoom): Duel[] => {
  const n = room.prompts.length
  const order = Array.from({ length: n }, (_, index) => index).sort(() => Math.random() - 0.5)
  const duels: Duel[] = []
  for (const promptIndex of order) {
    const [playerA, playerB] = getPlayersForPrompt(room.promptAssignments, promptIndex)
    const leftFirst = Math.random() < 0.5
    duels.push({
      id: createId(),
      promptIndex,
      leftPlayerId: leftFirst ? playerA : playerB,
      rightPlayerId: leftFirst ? playerB : playerA,
      votes: new Map<string, 'left' | 'right'>(),
      goldenVoters: new Set<string>(),
      closed: false
    })
  }
  return duels
}

export const createRatingItems = (room: GameRoom): RatingItem[] => {
  const items: RatingItem[] = []
  room.players.forEach((player) => {
    const submission = room.submissions.get(player.id)
    if (!submission) {
      return
    }
    items.push(...createPlayerRatingItems(room, player.id, submission))
  })
  return items
}

const createPlayerRatingItems = (room: GameRoom, playerId: string, submission: Submission): RatingItem[] => {
  const first = createRatingItem(room, playerId, submission.answers[0], submission.assignedPromptIndices[0])
  const second = createRatingItem(room, playerId, submission.answers[1], submission.assignedPromptIndices[1])
  return [first, second].filter((item): item is RatingItem => Boolean(item))
}

const createRatingItem = (
  room: GameRoom,
  playerId: string,
  punchline: string,
  promptIndex: number
): RatingItem | null => {
  if (!punchline) {
    return null
  }
  const prompt = room.prompts[promptIndex]
  if (!prompt) {
    return null
  }
  return {
    id: `${playerId}:${promptIndex}`,
    prompt,
    punchline,
    authorPlayerId: playerId,
    promptIndex
  }
}
