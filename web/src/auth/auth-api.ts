import type { AuthResult, UserGender, UserMemoryView, UserProfile } from '../models/user.type'

const getApiUrlFromQuery = (): string | null => {
  const value = new URLSearchParams(window.location.search).get('api')
  return value && value.trim().length > 0 ? value.trim() : null
}

export const resolveApiBaseUrl = (): string => {
  const fromQuery = getApiUrlFromQuery()
  if (fromQuery) {
    return fromQuery
  }
  const fromEnv = import.meta.env.VITE_API_URL
  if (fromEnv) {
    return fromEnv
  }
  return window.location.origin
}

const buildUrl = (path: string): string => `${resolveApiBaseUrl()}${path}`

async function request<T>(
  path: string,
  options: { method: string; body?: unknown; token?: string | null }
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`
  }
  const response = await fetch(buildUrl(path), {
    method: options.method,
    headers,
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
      // ignore parse failure
    }
    const error = new Error(message) as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return (await response.json()) as T
}

export type RegisterPayload = {
  readonly login: string
  readonly password: string
  readonly realName: string
  readonly displayName: string
  readonly gender: UserGender
  readonly bio?: string
}

export type LoginPayload = {
  readonly login: string
  readonly password: string
}

export type UpdateMePayload = {
  readonly realName?: string
  readonly displayName?: string
  readonly gender?: UserGender
  readonly bio?: string
}

export const authApi = {
  register: (payload: RegisterPayload): Promise<AuthResult> =>
    request('/api/auth/register', { method: 'POST', body: payload }),
  login: (payload: LoginPayload): Promise<AuthResult> =>
    request('/api/auth/login', { method: 'POST', body: payload }),
  getMe: (token: string): Promise<UserProfile> =>
    request('/api/users/me', { method: 'GET', token }),
  updateMe: (token: string, payload: UpdateMePayload): Promise<UserProfile> =>
    request('/api/users/me', { method: 'PATCH', body: payload, token }),
  getMyMemory: (token: string): Promise<UserMemoryView> =>
    request('/api/users/me/memory', { method: 'GET', token })
}
