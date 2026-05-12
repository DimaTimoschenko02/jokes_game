import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthResult, UserProfile } from '../models/user.type'
import { authApi } from './auth-api'

const TOKEN_KEY: string = 'punchme-auth-token'

type AuthState = {
  readonly token: string | null
  readonly user: UserProfile | null
  readonly status: 'loading' | 'ready'
}

type AuthContextValue = AuthState & {
  readonly login: (login: string, password: string) => Promise<void>
  readonly register: (payload: {
    login: string
    password: string
    realName: string
    displayName: string
    gender: 'male' | 'female' | 'non-binary' | 'not-specified'
    bio?: string
  }) => Promise<void>
  readonly logout: () => void
  readonly refreshUser: () => Promise<void>
  readonly setUser: (user: UserProfile) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const readStoredToken = (): string | null => window.localStorage.getItem(TOKEN_KEY)
const storeToken = (token: string | null): void => {
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token)
  } else {
    window.localStorage.removeItem(TOKEN_KEY)
  }
}

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: readStoredToken(),
    user: null,
    status: 'loading'
  })

  useEffect(() => {
    let cancelled: boolean = false
    const bootstrap = async (): Promise<void> => {
      const stored: string | null = readStoredToken()
      if (!stored) {
        if (!cancelled) {
          setState({ token: null, user: null, status: 'ready' })
        }
        return
      }
      try {
        const user = await authApi.getMe(stored)
        if (!cancelled) {
          setState({ token: stored, user, status: 'ready' })
        }
      } catch {
        storeToken(null)
        if (!cancelled) {
          setState({ token: null, user: null, status: 'ready' })
        }
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  const apply = useCallback((result: AuthResult): void => {
    storeToken(result.token)
    setState({ token: result.token, user: result.user, status: 'ready' })
  }, [])

  const value: AuthContextValue = useMemo(
    () => ({
      ...state,
      login: async (login, password): Promise<void> => {
        const result = await authApi.login({ login, password })
        apply(result)
      },
      register: async (payload): Promise<void> => {
        const result = await authApi.register(payload)
        apply(result)
      },
      logout: (): void => {
        storeToken(null)
        setState({ token: null, user: null, status: 'ready' })
      },
      refreshUser: async (): Promise<void> => {
        const token: string | null = state.token
        if (!token) {
          return
        }
        try {
          const user = await authApi.getMe(token)
          setState((prev) => ({ ...prev, user }))
        } catch (error: unknown) {
          const status = (error as { status?: number }).status
          if (status === 401) {
            storeToken(null)
            setState({ token: null, user: null, status: 'ready' })
          }
        }
      },
      setUser: (user): void => {
        setState((prev) => ({ ...prev, user }))
      }
    }),
    [state, apply]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
