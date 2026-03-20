import type { ClientDuel } from './client-duel.type'
import type { ClientPlayer } from './client-player.type'
import type { GamePhase } from './game-phase.type'
import type { PlayerPromptAssignment } from './player-prompt-assignment.type'
import type { RatingItem } from './rating-item.type'

export type ClientGameState = {
  readonly roomCode: string
  readonly phase: GamePhase
  readonly roundIndex: number
  readonly roundCount: number
  readonly players: readonly ClientPlayer[]
  readonly prompts: readonly string[]
  readonly promptAssignments: readonly PlayerPromptAssignment[]
  readonly currentDuel: ClientDuel | null
  readonly duelIndex: number
  readonly duelCount: number
  readonly writingSubmitters: readonly string[]
  readonly ratingSubmitters: readonly string[]
  readonly ratingItems: readonly RatingItem[]
  readonly timerSecondsLeft: number | null
}
