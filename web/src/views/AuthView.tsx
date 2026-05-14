import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { useAuth } from '../auth/auth-context'
import type { UserGender } from '../models/user.type'

const GENDERS: readonly { readonly value: UserGender; readonly label: string }[] = [
  { value: 'male', label: 'Мужской' },
  { value: 'female', label: 'Женский' },
  { value: 'non-binary', label: 'Небинарный' },
  { value: 'not-specified', label: 'Не указан' }
]

const LOGIN_MIN: number = 3
const LOGIN_MAX: number = 30
const PASSWORD_MIN: number = 6
const NAME_MAX: number = 80
const LOGIN_PATTERN: RegExp = /^[a-z0-9_.-]+$/i

type FormErrors = {
  readonly login?: string
  readonly password?: string
  readonly realName?: string
  readonly displayName?: string
}

const buildLoginError = (value: string): string | undefined => {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return 'Введи логин'
  }
  if (trimmed.length < LOGIN_MIN) {
    return `Минимум ${LOGIN_MIN} символа (сейчас ${trimmed.length})`
  }
  if (trimmed.length > LOGIN_MAX) {
    return `Максимум ${LOGIN_MAX} символов`
  }
  if (!LOGIN_PATTERN.test(trimmed)) {
    return 'Только латиница, цифры и _ . -'
  }
  return undefined
}

const buildPasswordError = (value: string): string | undefined => {
  if (value.length === 0) {
    return 'Введи пароль'
  }
  if (value.length < PASSWORD_MIN) {
    return `Минимум ${PASSWORD_MIN} символов (сейчас ${value.length})`
  }
  return undefined
}

const buildRequiredNameError = (value: string, label: string): string | undefined => {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return `Введи ${label}`
  }
  if (trimmed.length > NAME_MAX) {
    return `Максимум ${NAME_MAX} символов`
  }
  return undefined
}

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
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitAttempted, setSubmitAttempted] = useState<boolean>(false)

  const errors: FormErrors = useMemo(() => {
    const result: FormErrors = {
      login: buildLoginError(login),
      password: buildPasswordError(password)
    }
    if (mode === 'register') {
      return {
        ...result,
        realName: buildRequiredNameError(realName, 'имя'),
        displayName: buildRequiredNameError(displayName, 'никнейм')
      }
    }
    return result
  }, [login, password, realName, displayName, mode])

  const canSubmit: boolean = !errors.login && !errors.password && !errors.realName && !errors.displayName
  const showError = (field: keyof FormErrors): boolean => Boolean(errors[field]) && (touched[field] || submitAttempted)

  const submit = async (): Promise<void> => {
    setSubmitAttempted(true)
    if (!canSubmit) {
      return
    }
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

  const handleBlur = (field: keyof FormErrors): void => {
    setTouched((current) => ({ ...current, [field]: true }))
  }

  const switchMode = (next: 'login' | 'register'): void => {
    setMode(next)
    setSubmitAttempted(false)
    setTouched({})
    setError(null)
  }

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
            onClick={() => switchMode('login')}
          >
            Войти
          </button>
          <button
            type="button"
            className={`secondary ${mode === 'register' ? 'authTabActive' : ''}`}
            onClick={() => switchMode('register')}
          >
            Зарегистрироваться
          </button>
        </div>

        {error && <p className="subtitle errorText">{error}</p>}

        <label className={`inputGroup ${showError('login') ? 'inputGroupError' : ''}`}>
          <span>Логин</span>
          <input
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            onBlur={() => handleBlur('login')}
            maxLength={LOGIN_MAX}
            placeholder={`Минимум ${LOGIN_MIN} символа`}
          />
          {showError('login') && <small className="fieldError">{errors.login}</small>}
        </label>
        <label className={`inputGroup ${showError('password') ? 'inputGroupError' : ''}`}>
          <span>Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={() => handleBlur('password')}
            maxLength={100}
            placeholder={`Минимум ${PASSWORD_MIN} символов`}
          />
          {showError('password') && <small className="fieldError">{errors.password}</small>}
        </label>

        {mode === 'register' && (
          <>
            <label className={`inputGroup ${showError('realName') ? 'inputGroupError' : ''}`}>
              <span>Имя (используется в шутках про тебя)</span>
              <input
                value={realName}
                onChange={(event) => setRealName(event.target.value)}
                onBlur={() => handleBlur('realName')}
                maxLength={NAME_MAX}
                placeholder="Например: Дима"
              />
              {showError('realName') && <small className="fieldError">{errors.realName}</small>}
            </label>
            <label className={`inputGroup ${showError('displayName') ? 'inputGroupError' : ''}`}>
              <span>Никнейм (показывается другим)</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                onBlur={() => handleBlur('displayName')}
                maxLength={NAME_MAX}
                placeholder="Например: dimti"
              />
              {showError('displayName') && <small className="fieldError">{errors.displayName}</small>}
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

        <button className="primary" disabled={isBusy} onClick={submit}>
          {isBusy ? 'Подождите...' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
        </button>
      </section>
    </main>
  )
}
