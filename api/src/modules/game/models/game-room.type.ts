import { AgentSession } from '../../claude-agent/models/agent-session.type'
import { MemoryUpdaterOutput } from '../../agents/memory-updater/models/user-memory-delta.type'
import { UserMemorySnapshot } from '../../agents/memory-updater/models/user-memory-snapshot.type'
import { Duel } from './duel.type'
import { GamePhase } from './game-phase.type'
import { Player } from './player.type'
import { RatingItem } from './rating-item.type'
import { Submission } from './submission.type'

export type BotSessionEntry = {
  readonly session: AgentSession<never>
}

export type GameRoomSessions = {
  openingGenerator: AgentSession<readonly string[]> | null
  botSessions: Map<string, BotSessionEntry>
  memoryUpdater: AgentSession<MemoryUpdaterOutput> | null
}

export type GameRoom = {
  readonly code: string
  hostPlayerId: string
  players: Map<string, Player>
  roundCount: number
  botCount: number
  collectData: boolean
  phase: GamePhase
  roundIndex: number
  prompts: readonly string[]
  allOpenings: string[]
  usedPromptTexts: string[]
  promptAssignments: Map<string, readonly [number, number]>
  submissions: Map<string, Submission>
  duels: Duel[]
  duelIndex: number
  votingRevealActive: boolean
  ratingItems: RatingItem[]
  ratingSubmissions: Map<string, Map<string, number>>
  roundVotes: Map<string, { readonly votesFor: number; readonly votesAgainst: number }>
  timerEndsAt: number | null
  timerHandle: NodeJS.Timeout | null
  isStarting: boolean
  prefetchOpeningsPromise: Promise<readonly string[]> | null
  aiStatus: 'idle' | 'generating' | 'ready'
  sessions: GameRoomSessions
  userMemorySnapshots: readonly UserMemorySnapshot[]
  groupMemoryBlock: string | null
  memoryDeltasLog: MemoryUpdaterOutput[]
  memoryUpdaterInFlight: Promise<void> | null
}
