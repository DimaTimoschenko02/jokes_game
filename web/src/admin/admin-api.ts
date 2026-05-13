import { resolveApiBaseUrl } from '../auth/auth-api'

export type YesNoFilter = 'all' | 'yes' | 'no'
export type SourceFilter = 'all' | 'human' | 'bot'

export type PromptListItem = {
  readonly id: string
  readonly text: string
  readonly usedCount: number
  readonly completionsCount: number
  readonly avgVoteShare: number | null
  readonly isGolden: boolean
  readonly feedbackScore: number
  readonly feedbackSum: number
  readonly feedbackCount: number
  readonly adminScore: number | null
  readonly adminComment: string | null
  readonly adminScoredBy: string | null
  readonly adminScoredAt: string | null
  readonly derivedScore: number | null
  readonly usedAsExampleCount: number
  readonly lastUsedAsExampleAt: string | null
}

export type JokeListItem = {
  readonly id: string
  readonly prompt: string
  readonly punchline: string
  readonly source: 'human' | 'bot'
  readonly authorRealName: string | null
  readonly roomCode: string
  readonly roundIndex: number
  readonly votesFor: number
  readonly votesAgainst: number
  readonly voteShare: number
  readonly qualityScore: number
  readonly ratingAverage: number | null
  readonly ratingCount: number | null
  readonly adminScore: number | null
  readonly adminComment: string | null
  readonly adminScoredBy: string | null
  readonly adminScoredAt: string | null
  readonly usedAsExampleCount: number
  readonly createdAt: string
}

export type ListResponse<T> = {
  readonly items: readonly T[]
  readonly total: number
  readonly page: number
  readonly limit: number
}

export type PromptDetail = PromptListItem & {
  readonly completions: readonly {
    readonly punchline: string
    readonly source: 'human' | 'bot'
    readonly votesFor: number
    readonly votesAgainst: number
    readonly voteShare: number
    readonly ratingAverage?: number
    readonly ratingCount?: number
    readonly roomCode: string
    readonly roundIndex: number
    readonly createdAt: string
  }[]
}

export type ListPromptsQuery = {
  readonly page?: number
  readonly limit?: number
  readonly sort?: string
  readonly order?: 'asc' | 'desc'
  readonly search?: string
  readonly hasAdminScore?: YesNoFilter
  readonly isSeed?: YesNoFilter
  readonly isGolden?: YesNoFilter
}

export type ListJokesQuery = {
  readonly page?: number
  readonly limit?: number
  readonly sort?: string
  readonly order?: 'asc' | 'desc'
  readonly search?: string
  readonly source?: SourceFilter
  readonly hasAdminScore?: YesNoFilter
  readonly hasRating?: YesNoFilter
  readonly isSeed?: YesNoFilter
}

const toQueryString = (params: Record<string, string | number | undefined>): string => {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === 'all') {
      continue
    }
    usp.set(k, String(v))
  }
  const str = usp.toString()
  return str.length > 0 ? `?${str}` : ''
}

async function request<T>(
  path: string,
  options: { method: string; body?: unknown; token: string }
): Promise<T> {
  const response = await fetch(`${resolveApiBaseUrl()}${path}`, {
    method: options.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.token}`
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  })
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const errorBody = (await response.json()) as { message?: string | readonly string[] }
      if (Array.isArray(errorBody.message)) {
        message = errorBody.message.join('; ')
      } else if (typeof errorBody.message === 'string') {
        message = errorBody.message
      }
    } catch {
      // ignore
    }
    const error = new Error(message) as Error & { status?: number }
    error.status = response.status
    throw error
  }
  if (response.status === 204) {
    return undefined as unknown as T
  }
  return (await response.json()) as T
}

export const adminApi = {
  listPrompts(token: string, query: ListPromptsQuery): Promise<ListResponse<PromptListItem>> {
    const qs = toQueryString({
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
      search: query.search,
      hasAdminScore: query.hasAdminScore,
      isSeed: query.isSeed,
      isGolden: query.isGolden
    })
    return request(`/api/admin/prompts${qs}`, { method: 'GET', token })
  },
  getPrompt(token: string, id: string): Promise<PromptDetail> {
    return request(`/api/admin/prompts/${id}`, { method: 'GET', token })
  },
  updatePrompt(
    token: string,
    id: string,
    body: {
      text?: string
      adminScore?: number | null
      adminComment?: string | null
      isGolden?: boolean
    }
  ): Promise<{ ok: boolean }> {
    return request(`/api/admin/prompts/${id}`, { method: 'PATCH', body, token })
  },
  deletePrompt(token: string, id: string): Promise<{ ok: boolean }> {
    return request(`/api/admin/prompts/${id}`, { method: 'DELETE', token })
  },
  deleteCompletion(token: string, id: string, index: number): Promise<{ ok: boolean }> {
    return request(`/api/admin/prompts/${id}/completions/${index}`, { method: 'DELETE', token })
  },
  listJokes(token: string, query: ListJokesQuery): Promise<ListResponse<JokeListItem>> {
    const qs = toQueryString({
      page: query.page,
      limit: query.limit,
      sort: query.sort,
      order: query.order,
      search: query.search,
      source: query.source,
      hasAdminScore: query.hasAdminScore,
      hasRating: query.hasRating,
      isSeed: query.isSeed
    })
    return request(`/api/admin/jokes${qs}`, { method: 'GET', token })
  },
  updateJoke(
    token: string,
    id: string,
    body: { adminScore?: number | null; adminComment?: string | null }
  ): Promise<{ ok: boolean }> {
    return request(`/api/admin/jokes/${id}`, { method: 'PATCH', body, token })
  },
  deleteJoke(token: string, id: string): Promise<{ ok: boolean }> {
    return request(`/api/admin/jokes/${id}`, { method: 'DELETE', token })
  }
}
