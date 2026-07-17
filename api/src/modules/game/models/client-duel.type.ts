export type ClientDuel = {
  readonly id: string
  readonly prompt: string
  readonly leftPlayerId: string
  readonly rightPlayerId: string
  readonly leftAnswer: string
  readonly rightAnswer: string
  readonly votesByPlayerId: Readonly<Record<string, 'left' | 'right'>>
  readonly goldenVoterIds: readonly string[]
  // Author of the opening (human-openings mode). null = AI opening or not revealed yet.
  readonly openingAuthorPlayerId: string | null
}
