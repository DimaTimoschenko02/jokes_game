import { customAlphabet } from 'nanoid'
import { ANSWER_MAX_LENGTH, PLAYER_NAME_MAX_LENGTH } from './constants/game.constants'
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

export const createPlayer = (input: { readonly name: string; readonly socketId: string | null; readonly isBot: boolean; readonly bio?: string }): Player => ({
  id: createId(),
  socketId: input.socketId,
  isBot: input.isBot,
  name: normalizeName(input.name),
  bio: input.bio?.slice(0, 200) ?? '',
  connected: true,
  score: 0
})

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

export const buildCircularPromptAssignments = (playerIds: readonly string[]): Map<string, readonly [number, number]> => {
  const n = playerIds.length
  const shuffled = [...playerIds].sort(() => Math.random() - 0.5)
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
  return {
    id: `${playerId}:${promptIndex}`,
    prompt: room.prompts[promptIndex],
    punchline,
    authorPlayerId: playerId,
    promptIndex
  }
}
