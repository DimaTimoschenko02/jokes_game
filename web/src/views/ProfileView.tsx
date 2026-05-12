import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { authApi } from '../auth/auth-api'
import { useAuth } from '../auth/auth-context'
import type { UserGender, UserMemoryView, UserProfile } from '../models/user.type'

const GENDER_LABELS: Record<UserGender, string> = {
  male: 'Мужской',
  female: 'Женский',
  'non-binary': 'Небинарный',
  'not-specified': 'Не указан'
}

const PREFERENCE_LABELS: Record<string, string> = {
  darkPreference: 'Тёмный юмор',
  callbackPreference: 'Колбэки/референсы',
  absurdPreference: 'Абсурд',
  ironyPreference: 'Ирония'
}

export function ProfileView({ onBack }: { readonly onBack: () => void }): ReactElement {
  const { user, token, setUser, logout } = useAuth()
  const [memory, setMemory] = useState<UserMemoryView | null>(null)
  const [memoryStatus, setMemoryStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [editing, setEditing] = useState<boolean>(false)
  const [draft, setDraft] = useState<{
    displayName: string
    realName: string
    gender: UserGender
    bio: string
  }>({
    displayName: user?.displayName ?? '',
    realName: user?.realName ?? '',
    gender: user?.gender ?? 'not-specified',
    bio: user?.bio ?? ''
  })
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState<boolean>(false)

  useEffect(() => {
    if (!token) {
      return
    }
    let cancelled = false
    setMemoryStatus('loading')
    void authApi
      .getMyMemory(token)
      .then((view) => {
        if (!cancelled) {
          setMemory(view)
          setMemoryStatus('idle')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMemoryStatus('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const handleSave = async (): Promise<void> => {
    if (!token) return
    setIsSaving(true)
    setSaveError(null)
    try {
      const next: UserProfile = await authApi.updateMe(token, {
        displayName: draft.displayName.trim() || undefined,
        realName: draft.realName.trim() || undefined,
        gender: draft.gender,
        bio: draft.bio.trim() ? draft.bio.trim() : ''
      })
      setUser(next)
      setEditing(false)
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setIsSaving(false)
    }
  }

  if (!user) {
    return <main className="layout"><section className="panel">Загрузка...</section></main>
  }

  return (
    <main className="layout">
      <section className="panel">
        <div className="header">
          <div>
            <h1>Профиль</h1>
            <p className="subtitle">@{user.login}</p>
          </div>
          <div className="headerActions">
            <button type="button" className="secondary" onClick={onBack}>
              Назад
            </button>
            <button type="button" className="secondary" onClick={logout}>
              Выйти
            </button>
          </div>
        </div>

        {!editing && (
          <>
            <div className="profileRow"><span>Имя (в шутках):</span> <strong>{user.realName}</strong></div>
            <div className="profileRow"><span>Никнейм:</span> <strong>{user.displayName}</strong></div>
            <div className="profileRow"><span>Пол:</span> <strong>{GENDER_LABELS[user.gender]}</strong></div>
            <div className="profileRow profileBio">
              <span>О себе:</span>
              <p>{user.bio || <em className="subtitle">не указано</em>}</p>
            </div>
            <button type="button" className="primary" onClick={() => setEditing(true)}>
              Редактировать
            </button>
          </>
        )}

        {editing && (
          <>
            {saveError && <p className="subtitle errorText">{saveError}</p>}
            <label className="inputGroup">
              <span>Имя (в шутках)</span>
              <input
                value={draft.realName}
                onChange={(event) => setDraft({ ...draft, realName: event.target.value })}
                maxLength={80}
              />
            </label>
            <label className="inputGroup">
              <span>Никнейм</span>
              <input
                value={draft.displayName}
                onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                maxLength={80}
              />
            </label>
            <label className="inputGroup">
              <span>Пол</span>
              <select
                value={draft.gender}
                onChange={(event) => setDraft({ ...draft, gender: event.target.value as UserGender })}
              >
                {(Object.keys(GENDER_LABELS) as UserGender[]).map((key) => (
                  <option key={key} value={key}>
                    {GENDER_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            <label className="inputGroup">
              <span>О себе ({draft.bio.length}/500)</span>
              <textarea
                value={draft.bio}
                onChange={(event) => setDraft({ ...draft, bio: event.target.value.slice(0, 500) })}
                rows={3}
              />
            </label>
            <div className="row">
              <button type="button" className="primary" disabled={isSaving} onClick={handleSave}>
                {isSaving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button type="button" className="secondary" disabled={isSaving} onClick={() => setEditing(false)}>
                Отмена
              </button>
            </div>
          </>
        )}

        <div className="divider" />

        <h2>Что AI знает о тебе</h2>
        <p className="subtitle">
          Эта информация обновляется после каждого раунда — на основе твоих шуток, голосов и оценок.
        </p>

        {memoryStatus === 'loading' && <p className="subtitle">Загружаем...</p>}
        {memoryStatus === 'error' && (
          <p className="subtitle errorText">Не удалось загрузить AI-профиль</p>
        )}

        {memory && (
          <>
            <p className="subtitle">
              Обновлений: {memory.updatedAfterRoundsCount}{' '}
              {memory.updatedAfterRoundsCount > 0
                ? `· последнее: ${new Date(memory.updatedAt).toLocaleString('ru-RU')}`
                : ''}
            </p>

            {memory.portrait && (
              <div className="memoryPortrait">
                <h3>Портрет</h3>
                <p>{memory.portrait}</p>
              </div>
            )}

            <h3>Темы</h3>
            {memory.themes.length === 0 ? (
              <p className="subtitle">Ещё нет данных — сыграй пару раундов.</p>
            ) : (
              <ul className="memoryThemes">
                {memory.themes.slice(0, 8).map((theme) => (
                  <li key={theme.theme}>
                    <span className="themeName">{theme.theme}</span>
                    <span className="themeBar">
                      <span
                        className="themeBarFill"
                        style={{ width: `${Math.round(theme.confidence * 100)}%` }}
                      />
                    </span>
                    <span className="themeMeta">
                      {Math.round(theme.confidence * 100)}% · {theme.mentions} упом. · {theme.source}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <h3>Предпочтения как зрителя</h3>
            <ul className="memoryPrefs">
              {(Object.keys(memory.voterPreferences) as (keyof typeof memory.voterPreferences)[]).map(
                (key) => (
                  <li key={key}>
                    <span>{PREFERENCE_LABELS[key] ?? key}</span>
                    <span className="themeBar">
                      <span
                        className="themeBarFill"
                        style={{ width: `${Math.round(memory.voterPreferences[key] * 100)}%` }}
                      />
                    </span>
                    <span className="themeMeta">{Math.round(memory.voterPreferences[key] * 100)}%</span>
                  </li>
                )
              )}
            </ul>

            <h3>Стиль автора</h3>
            <p className="subtitle">
              Средняя длина панчлайна: {memory.authorStyle.avgPunchlineLength.toFixed(1)} симв.
            </p>
            {memory.authorStyle.preferredStructures.length > 0 && (
              <p className="subtitle">
                Любимые приёмы: {memory.authorStyle.preferredStructures.join(', ')}
              </p>
            )}
          </>
        )}
      </section>
    </main>
  )
}
