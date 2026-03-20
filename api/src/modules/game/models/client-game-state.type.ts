import { ClientDuel } from './client-duel.type'
import { GamePhase } from './game-phase.type'
import { ClientPlayer } from './client-player.type'
import { PlayerPromptAssignment } from './player-prompt-assignment.type'
import { RatingItem } from './rating-item.type'

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
