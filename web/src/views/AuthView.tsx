import { useState } from 'react'
import type { ReactElement } from 'react'
import { useAuth } from '../auth/auth-context'
import type { UserGender } from '../models/user.type'

const GENDERS: readonly { readonly value: UserGender; readonly label: string }[] = [
  { value: 'male', label: 'Мужской' },
  { value: 'female', label: 'Женский' },
  { value: 'non-binary', label: 'Небинарный' },
  { value: 'not-specified', label: 'Не указан' }
]

export function AuthView(): ReactElement {
  const { login: doLogin, register: doRegister } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [login, setLogin] = useState<string>('')
  const [password, setPassword] = useState<string>('')
  const [realName, setRealName] = useState<string>('')
  const [displayName, setDisplayName] = useState<string>('')
  const [gender, setGender] = useState<UserGender>('not-specified')
  const [bio, setBio] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState<boolean>(false)

  const submit = async (): Promise<void> => {
    setError(null)
    setIsBusy(true)
    try {
      if (mode === 'login') {
        await doLogin(login.trim().toLowerCase(), password)
      } else {
        await doRegister({
          login: login.trim().toLowerCase(),
          password,
          realName: realName.trim(),
          displayName: displayName.trim() || realName.trim(),
          gender,
          bio: bio.trim() || undefined
        })
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось')
    } finally {
      setIsBusy(false)
    }
  }

  const canSubmit: boolean =
    login.trim().length >= 3 &&
    password.length >= 6 &&
    (mode === 'login' || (realName.trim().length > 0 && displayName.trim().length > 0))

  return (
    <main className="layout">
      <section className="panel">
        <div className="header">
          <h1>PunchMe</h1>
        </div>
        <div className="authTabs">
          <button
            type="button"
            className={`secondary ${mode === 'login' ? 'authTabActive' : ''}`}
            onClick={() => setMode('login')}
          >
            Войти
          </button>
          <button
            type="button"
            className={`secondary ${mode === 'register' ? 'authTabActive' : ''}`}
            onClick={() => setMode('register')}
          >
            Зарегистрироваться
          </button>
        </div>

        {error && <p className="subtitle errorText">{error}</p>}

        <label className="inputGroup">
          <span>Логин</span>
          <input
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            maxLength={30}
            placeholder="Минимум 3 символа"
          />
        </label>
        <label className="inputGroup">
          <span>Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            maxLength={100}
            placeholder="Минимум 6 символов"
          />
        </label>

        {mode === 'register' && (
          <>
            <label className="inputGroup">
              <span>Имя (используется в шутках про тебя)</span>
              <input
                value={realName}
                onChange={(event) => setRealName(event.target.value)}
                maxLength={80}
                placeholder="Например: Дима"
              />
            </label>
            <label className="inputGroup">
              <span>Никнейм (показывается другим)</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={80}
                placeholder="Например: dimti"
              />
            </label>
            <label className="inputGroup">
              <span>Пол</span>
              <select value={gender} onChange={(event) => setGender(event.target.value as UserGender)}>
                {GENDERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="inputGroup">
              <span>О себе для AI-шуток ({bio.length}/500)</span>
              <textarea
                value={bio}
                onChange={(event) => setBio(event.target.value.slice(0, 500))}
                rows={3}
                placeholder="Чем провокативнее — тем смешнее шутки про тебя"
              />
            </label>
          </>
        )}

        <button className="primary" disabled={!canSubmit || isBusy} onClick={submit}>
          {isBusy ? 'Подождите...' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
        </button>
      </section>
    </main>
  )
}
