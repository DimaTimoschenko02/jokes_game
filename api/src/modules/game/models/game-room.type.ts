import { Duel } from './duel.type'
import { GamePhase } from './game-phase.type'
import { Player } from './player.type'
import { RatingItem } from './rating-item.type'
import { Submission } from './submission.type'

export type GameRoom = {
  readonly code: string
  hostPlayerId: string
  players: Map<string, Player>
  roundCount: number
  botCount: number
  phase: GamePhase
  roundIndex: number
  prompts: readonly string[]
  allOpenings: string[]
  usedPromptTexts: string[]
  promptAssignments: Map<string, readonly [number, number]>
  submissions: Map<string, Submission>
  duels: Duel[]
  duelIndex: number
  ratingItems: RatingItem[]
  ratingSubmissions: Map<string, Map<string, number>>
  roundVotes: Map<string, { readonly votesFor: number; readonly votesAgainst: number }>
  timerEndsAt: number | null
  timerHandle: NodeJS.Timeout | null
}
