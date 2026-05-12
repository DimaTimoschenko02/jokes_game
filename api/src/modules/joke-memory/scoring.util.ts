const RATING_SCALE_MAX: number = 10
const BAYESIAN_PRIOR_MEAN: number = 5.5
const BAYESIAN_PRIOR_WEIGHT: number = 3
const WILSON_Z_95: number = 1.96
const PRIMARY_QUALITY_WEIGHT: number = 0.7
const COMPETITIVE_SIGNAL_WEIGHT: number = 0.2
const COMPETITIVE_SIGNAL_RATING_THRESHOLD: number = 3

export function calculateBayesianRating(ratingSum: number, ratingCount: number): number {
  const numerator: number = ratingSum + BAYESIAN_PRIOR_MEAN * BAYESIAN_PRIOR_WEIGHT
  const denominator: number = ratingCount + BAYESIAN_PRIOR_WEIGHT
  return numerator / denominator
}

export function calculateWilsonLowerBound(votesFor: number, votesAgainst: number): number {
  const total: number = votesFor + votesAgainst
  if (total <= 0) {
    return 0
  }
  const proportion: number = votesFor / total
  const zSquared: number = WILSON_Z_95 * WILSON_Z_95
  const numerator: number =
    proportion +
    zSquared / (2 * total) -
    WILSON_Z_95 * Math.sqrt((proportion * (1 - proportion) + zSquared / (4 * total)) / total)
  const denominator: number = 1 + zSquared / total
  return numerator / denominator
}

export function calculateRepetitionPenalty(usedAsExampleCount: number): number {
  const safeCount: number = Math.max(0, usedAsExampleCount)
  return 1 / (1 + Math.log(1 + safeCount))
}

export type UseScoreInput = {
  readonly adminScore?: number
  readonly adminScoreMax?: number
  readonly ratingSum?: number
  readonly ratingCount?: number
  readonly votesFor?: number
  readonly votesAgainst?: number
  readonly usedAsExampleCount?: number
}

export function calculatePrimaryQuality(input: UseScoreInput): number {
  if (input.adminScore !== undefined && input.adminScore !== null) {
    const scaleMax: number = input.adminScoreMax ?? RATING_SCALE_MAX
    return Math.min(1, Math.max(0, input.adminScore / scaleMax))
  }
  const ratingCount: number = input.ratingCount ?? 0
  const ratingSum: number = input.ratingSum ?? 0
  const bayesianRating: number = calculateBayesianRating(ratingSum, ratingCount)
  return Math.min(1, Math.max(0, bayesianRating / RATING_SCALE_MAX))
}

export function calculateCompetitiveSignal(input: UseScoreInput): number {
  const ratingCount: number = input.ratingCount ?? 0
  if (ratingCount >= COMPETITIVE_SIGNAL_RATING_THRESHOLD) {
    return 0
  }
  return calculateWilsonLowerBound(input.votesFor ?? 0, input.votesAgainst ?? 0)
}

export function calculateUseScore(input: UseScoreInput): number {
  const primaryQuality: number = calculatePrimaryQuality(input)
  const competitiveSignal: number = calculateCompetitiveSignal(input)
  const repetitionPenalty: number = calculateRepetitionPenalty(input.usedAsExampleCount ?? 0)
  const base: number =
    primaryQuality * PRIMARY_QUALITY_WEIGHT + competitiveSignal * COMPETITIVE_SIGNAL_WEIGHT
  return base * repetitionPenalty
}

export function calculateInvertedUseScore(input: UseScoreInput): number {
  const primaryQuality: number = calculatePrimaryQuality(input)
  const competitiveSignal: number = calculateCompetitiveSignal(input)
  const repetitionPenalty: number = calculateRepetitionPenalty(input.usedAsExampleCount ?? 0)
  const invertedPrimary: number = 1 - primaryQuality
  const invertedCompetitive: number = competitiveSignal > 0 ? 1 - competitiveSignal : 0
  const base: number =
    invertedPrimary * PRIMARY_QUALITY_WEIGHT + invertedCompetitive * COMPETITIVE_SIGNAL_WEIGHT
  return base * repetitionPenalty
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  const length: number = Math.min(left.length, right.length)
  if (length === 0) {
    return 0
  }
  let dot: number = 0
  let leftNorm: number = 0
  let rightNorm: number = 0
  for (let index = 0; index < length; index += 1) {
    const leftValue: number = left[index]
    const rightValue: number = right[index]
    dot += leftValue * rightValue
    leftNorm += leftValue * leftValue
    rightNorm += rightValue * rightValue
  }
  if (leftNorm <= 0 || rightNorm <= 0) {
    return 0
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

export type MmrItem = {
  readonly embedding: readonly number[]
  readonly score: number
}

const MMR_LAMBDA_DEFAULT: number = 0.7

export function selectViaMmr<T extends MmrItem>(
  items: readonly T[],
  count: number,
  lambda: number = MMR_LAMBDA_DEFAULT
): readonly T[] {
  if (count <= 0 || items.length === 0) {
    return []
  }
  const limit: number = Math.min(count, items.length)
  const selectedIndices: number[] = []
  const remaining: Set<number> = new Set(items.map((_, idx) => idx))
  while (selectedIndices.length < limit && remaining.size > 0) {
    let bestIdx: number = -1
    let bestScore: number = -Infinity
    for (const idx of remaining) {
      const candidate: T = items[idx]
      let maxSim: number = 0
      for (const selIdx of selectedIndices) {
        const sim: number = cosineSimilarity(candidate.embedding, items[selIdx].embedding)
        if (sim > maxSim) {
          maxSim = sim
        }
      }
      const mmr: number = lambda * candidate.score - (1 - lambda) * maxSim
      if (mmr > bestScore) {
        bestScore = mmr
        bestIdx = idx
      }
    }
    if (bestIdx === -1) {
      break
    }
    selectedIndices.push(bestIdx)
    remaining.delete(bestIdx)
  }
  return selectedIndices.map((idx) => items[idx])
}
