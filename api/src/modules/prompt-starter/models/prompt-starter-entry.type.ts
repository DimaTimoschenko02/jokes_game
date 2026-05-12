export interface PromptCompletion {
  readonly punchline: string
  readonly source: 'human' | 'bot'
  readonly votesFor: number
  readonly votesAgainst: number
  readonly voteShare: number
  readonly ratingAverage?: number
  readonly ratingCount?: number
  readonly roomCode: string
  readonly roundIndex: number
  readonly createdAt: Date
}

export interface UserQuickFeedbackAggregate {
  readonly up: number
  readonly down: number
  readonly broken: number
}

export interface PromptStarterEntry {
  readonly _id: string
  readonly text: string
  readonly usedCount: number
  readonly completions: readonly PromptCompletion[]
  readonly isGolden?: boolean
  readonly averageCompletionRating?: number
  readonly averageVoteShare?: number
  readonly goldenSince?: Date
  readonly userQuickFeedback: UserQuickFeedbackAggregate
  readonly feedbackScore: number
  readonly adminScore?: number
  readonly adminScoredBy?: string
  readonly adminScoredAt?: Date
  readonly adminComment?: string
  readonly derivedScore?: number
  readonly usedAsExampleCount: number
  readonly lastUsedAsExampleAt?: Date
  readonly textEmbedding?: readonly number[]
  readonly embeddingModel?: string
}
