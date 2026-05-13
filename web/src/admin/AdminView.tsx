import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { useAuth } from '../auth/auth-context'
import {
  adminApi,
  type JokeListItem,
  type ListJokesQuery,
  type ListPromptsQuery,
  type PromptListItem,
  type SourceFilter,
  type YesNoFilter
} from './admin-api'

type AdminTab = 'prompts' | 'jokes'

const PAGE_SIZE_OPTIONS: readonly number[] = [15, 30, 50, 100]

const PROMPT_SORT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'createdAt', label: 'Дата' },
  { value: 'adminScore', label: 'Admin score' },
  { value: 'feedbackScore', label: 'Юзер рейтинг' },
  { value: 'usedCount', label: 'Использований' },
  { value: 'usedAsExampleCount', label: 'Раз в примерах' },
  { value: 'text', label: 'Текст' }
]

const JOKE_SORT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'createdAt', label: 'Дата' },
  { value: 'adminScore', label: 'Admin score' },
  { value: 'ratingAverage', label: 'Юзер рейтинг' },
  { value: 'voteShare', label: 'Дуэли %' },
  { value: 'qualityScore', label: 'Quality' }
]

const YES_NO_LABELS: Record<YesNoFilter, string> = {
  all: 'Все',
  yes: 'Да',
  no: 'Нет'
}

const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: 'Все',
  human: 'Люди',
  bot: 'Боты'
}

export function AdminView({ onBack }: { readonly onBack: () => void }): ReactElement {
  const { user, token } = useAuth()
  const [tab, setTab] = useState<AdminTab>('prompts')

  if (!user || !token) {
    return (
      <main className="layout">
        <section className="panel">
          <p>Не авторизован</p>
          <button className="secondary" onClick={onBack}>Назад</button>
        </section>
      </main>
    )
  }

  if (user.role !== 'admin') {
    return (
      <main className="layout">
        <section className="panel">
          <p>Доступ только для админа</p>
          <button className="secondary" onClick={onBack}>Назад</button>
        </section>
      </main>
    )
  }

  return (
    <main className="layout">
      <section className="panel">
        <div className="header">
          <h1>Админка</h1>
          <button type="button" className="secondary" onClick={onBack}>← Назад</button>
        </div>
        <div className="row">
          <button
            type="button"
            className={tab === 'prompts' ? 'primary' : 'secondary'}
            onClick={() => setTab('prompts')}
          >
            Опенинги
          </button>
          <button
            type="button"
            className={tab === 'jokes' ? 'primary' : 'secondary'}
            onClick={() => setTab('jokes')}
          >
            Шутки
          </button>
        </div>
        <div className="divider" />
        {tab === 'prompts' ? <PromptsTab token={token} /> : <JokesTab token={token} />}
      </section>
    </main>
  )
}

function PromptsTab({ token }: { readonly token: string }): ReactElement {
  const [query, setQuery] = useState<ListPromptsQuery>({
    page: 1,
    limit: 15,
    sort: 'createdAt',
    order: 'desc',
    search: '',
    hasAdminScore: 'all',
    isSeed: 'all',
    isGolden: 'all'
  })
  const [items, setItems] = useState<readonly PromptListItem[]>([])
  const [total, setTotal] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res = await adminApi.listPrompts(token, query)
      setItems(res.items)
      setTotal(res.total)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [token, query])

  useEffect(() => { void load() }, [load])

  const totalPages: number = Math.max(1, Math.ceil(total / (query.limit ?? 15)))

  const onSave = async (id: string, body: {
    adminScore?: number | null
    adminComment?: string | null
    isGolden?: boolean
  }): Promise<void> => {
    try {
      await adminApi.updatePrompt(token, id, body)
      await load()
    } catch (e) {
      alert(`Ошибка: ${(e as Error).message}`)
    }
  }

  const onDelete = async (id: string): Promise<void> => {
    if (!window.confirm('Удалить опенинг полностью?')) {
      return
    }
    try {
      await adminApi.deletePrompt(token, id)
      await load()
    } catch (e) {
      alert(`Ошибка: ${(e as Error).message}`)
    }
  }

  return (
    <div>
      <FilterBar
        query={query}
        onChange={(q) => setQuery({ ...query, ...q, page: 1 })}
        sortOptions={PROMPT_SORT_OPTIONS}
        showSource={false}
        showRating={false}
        showGolden={true}
      />
      {error && <p className="errorText">{error}</p>}
      {loading && <p className="subtitle">Загрузка...</p>}
      <p className="subtitle">{total} всего, страница {query.page ?? 1} из {totalPages}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        {items.map((item) => (
          <PromptRow key={item.id} item={item} onSave={onSave} onDelete={onDelete} />
        ))}
      </div>
      <Pagination
        page={query.page ?? 1}
        totalPages={totalPages}
        onChange={(p) => setQuery({ ...query, page: p })}
      />
    </div>
  )
}

function JokesTab({ token }: { readonly token: string }): ReactElement {
  const [query, setQuery] = useState<ListJokesQuery>({
    page: 1,
    limit: 15,
    sort: 'createdAt',
    order: 'desc',
    search: '',
    source: 'all',
    hasAdminScore: 'all',
    hasRating: 'all',
    isSeed: 'all'
  })
  const [items, setItems] = useState<readonly JokeListItem[]>([])
  const [total, setTotal] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res = await adminApi.listJokes(token, query)
      setItems(res.items)
      setTotal(res.total)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [token, query])

  useEffect(() => { void load() }, [load])

  const totalPages: number = Math.max(1, Math.ceil(total / (query.limit ?? 15)))

  const onSave = async (id: string, body: { adminScore?: number | null; adminComment?: string | null }): Promise<void> => {
    try {
      await adminApi.updateJoke(token, id, body)
      await load()
    } catch (e) {
      alert(`Ошибка: ${(e as Error).message}`)
    }
  }

  const onDelete = async (id: string): Promise<void> => {
    if (!window.confirm('Удалить шутку полностью?')) {
      return
    }
    try {
      await adminApi.deleteJoke(token, id)
      await load()
    } catch (e) {
      alert(`Ошибка: ${(e as Error).message}`)
    }
  }

  return (
    <div>
      <FilterBar
        query={query as ListPromptsQuery & { source?: SourceFilter; hasRating?: YesNoFilter }}
        onChange={(q) => setQuery({ ...query, ...q, page: 1 })}
        sortOptions={JOKE_SORT_OPTIONS}
        showSource={true}
        showRating={true}
        showGolden={false}
      />
      {error && <p className="errorText">{error}</p>}
      {loading && <p className="subtitle">Загрузка...</p>}
      <p className="subtitle">{total} всего, страница {query.page ?? 1} из {totalPages}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        {items.map((item) => (
          <JokeRow key={item.id} item={item} onSave={onSave} onDelete={onDelete} />
        ))}
      </div>
      <Pagination
        page={query.page ?? 1}
        totalPages={totalPages}
        onChange={(p) => setQuery({ ...query, page: p })}
      />
    </div>
  )
}

type FilterBarQuery = {
  readonly page?: number
  readonly limit?: number
  readonly sort?: string
  readonly order?: 'asc' | 'desc'
  readonly search?: string
  readonly hasAdminScore?: YesNoFilter
  readonly isSeed?: YesNoFilter
  readonly isGolden?: YesNoFilter
  readonly source?: SourceFilter
  readonly hasRating?: YesNoFilter
}

function FilterBar(props: {
  readonly query: FilterBarQuery
  readonly onChange: (q: Partial<FilterBarQuery>) => void
  readonly sortOptions: readonly { value: string; label: string }[]
  readonly showSource: boolean
  readonly showRating: boolean
  readonly showGolden: boolean
}): ReactElement {
  const { query, onChange, sortOptions, showSource, showRating, showGolden } = props
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row">
        <input
          type="text"
          value={query.search ?? ''}
          placeholder="Поиск по тексту..."
          onChange={(e) => onChange({ search: e.target.value })}
          style={{ flex: 1 }}
        />
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <label className="inputGroup" style={{ flex: '1 1 100px' }}>
          <span>На странице</span>
          <select
            value={query.limit ?? 15}
            onChange={(e) => onChange({ limit: Number(e.target.value) })}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="inputGroup" style={{ flex: '1 1 140px' }}>
          <span>Сортировка</span>
          <select
            value={query.sort ?? 'createdAt'}
            onChange={(e) => onChange({ sort: e.target.value })}
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="inputGroup" style={{ flex: '1 1 100px' }}>
          <span>Порядок</span>
          <select
            value={query.order ?? 'desc'}
            onChange={(e) => onChange({ order: e.target.value as 'asc' | 'desc' })}
          >
            <option value="desc">↓ убыв.</option>
            <option value="asc">↑ возр.</option>
          </select>
        </label>
        <label className="inputGroup" style={{ flex: '1 1 120px' }}>
          <span>Оценено</span>
          <select
            value={query.hasAdminScore ?? 'all'}
            onChange={(e) => onChange({ hasAdminScore: e.target.value as YesNoFilter })}
          >
            {(['all', 'yes', 'no'] as YesNoFilter[]).map((v) => (
              <option key={v} value={v}>{YES_NO_LABELS[v]}</option>
            ))}
          </select>
        </label>
        <label className="inputGroup" style={{ flex: '1 1 100px' }}>
          <span>Seed</span>
          <select
            value={query.isSeed ?? 'all'}
            onChange={(e) => onChange({ isSeed: e.target.value as YesNoFilter })}
          >
            {(['all', 'yes', 'no'] as YesNoFilter[]).map((v) => (
              <option key={v} value={v}>{YES_NO_LABELS[v]}</option>
            ))}
          </select>
        </label>
        {showGolden && (
          <label className="inputGroup" style={{ flex: '1 1 100px' }}>
            <span>Golden</span>
            <select
              value={query.isGolden ?? 'all'}
              onChange={(e) => onChange({ isGolden: e.target.value as YesNoFilter })}
            >
              {(['all', 'yes', 'no'] as YesNoFilter[]).map((v) => (
                <option key={v} value={v}>{YES_NO_LABELS[v]}</option>
              ))}
            </select>
          </label>
        )}
        {showSource && (
          <label className="inputGroup" style={{ flex: '1 1 100px' }}>
            <span>Source</span>
            <select
              value={query.source ?? 'all'}
              onChange={(e) => onChange({ source: e.target.value as SourceFilter })}
            >
              {(['all', 'human', 'bot'] as SourceFilter[]).map((v) => (
                <option key={v} value={v}>{SOURCE_LABELS[v]}</option>
              ))}
            </select>
          </label>
        )}
        {showRating && (
          <label className="inputGroup" style={{ flex: '1 1 130px' }}>
            <span>Юзер оценил</span>
            <select
              value={query.hasRating ?? 'all'}
              onChange={(e) => onChange({ hasRating: e.target.value as YesNoFilter })}
            >
              {(['all', 'yes', 'no'] as YesNoFilter[]).map((v) => (
                <option key={v} value={v}>{YES_NO_LABELS[v]}</option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  )
}

function Pagination({
  page,
  totalPages,
  onChange
}: {
  readonly page: number
  readonly totalPages: number
  readonly onChange: (p: number) => void
}): ReactElement {
  return (
    <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
      <button className="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>← Назад</button>
      <span style={{ alignSelf: 'center' }}>{page} / {totalPages}</span>
      <button className="secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Вперёд →</button>
    </div>
  )
}

function PromptRow({
  item,
  onSave,
  onDelete
}: {
  readonly item: PromptListItem
  readonly onSave: (id: string, body: { adminScore?: number | null; adminComment?: string | null; isGolden?: boolean }) => Promise<void>
  readonly onDelete: (id: string) => Promise<void>
}): ReactElement {
  const [editing, setEditing] = useState<boolean>(false)
  const [adminScore, setAdminScore] = useState<string>(item.adminScore?.toString() ?? '')
  const [adminComment, setAdminComment] = useState<string>(item.adminComment ?? '')
  const [isGolden, setIsGolden] = useState<boolean>(item.isGolden)

  return (
    <div className="phaseBlock">
      <p style={{ fontSize: '1.05em', margin: '0 0 6px 0' }}>{item.text}</p>
      <p className="subtitle">
        {item.isGolden && <span style={{ color: '#f59e0b' }}>★ GOLDEN </span>}
        admin: {item.adminScore ?? '—'} | feedback: {item.feedbackScore.toFixed(2)} ({item.feedbackCount} голосов) | использовано: {item.usedCount} | в примерах: {item.usedAsExampleCount}
      </p>
      {item.adminComment && <p className="subtitle">Коммент: {item.adminComment}</p>}
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <div className="row">
            <label className="inputGroup" style={{ flex: 1 }}>
              <span>Admin score (1-10, пусто = убрать)</span>
              <input
                type="number"
                min={1}
                max={10}
                value={adminScore}
                onChange={(e) => setAdminScore(e.target.value)}
              />
            </label>
            <label className="inputGroup" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={isGolden}
                onChange={(e) => setIsGolden(e.target.checked)}
              />
              <span>Golden</span>
            </label>
          </div>
          <textarea
            value={adminComment}
            placeholder="Комментарий (опционально)"
            onChange={(e) => setAdminComment(e.target.value)}
          />
          <div className="row">
            <button
              className="primary"
              onClick={async () => {
                const score: number | null = adminScore.trim().length > 0 ? Number(adminScore) : null
                await onSave(item.id, {
                  adminScore: score,
                  adminComment: adminComment.trim().length > 0 ? adminComment : null,
                  isGolden
                })
                setEditing(false)
              }}
            >
              Сохранить
            </button>
            <button className="secondary" onClick={() => setEditing(false)}>Отмена</button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button className="secondary" onClick={() => setEditing(true)}>Edit</button>
          <button className="secondary" onClick={() => onDelete(item.id)}>Delete</button>
        </div>
      )}
    </div>
  )
}

function JokeRow({
  item,
  onSave,
  onDelete
}: {
  readonly item: JokeListItem
  readonly onSave: (id: string, body: { adminScore?: number | null; adminComment?: string | null }) => Promise<void>
  readonly onDelete: (id: string) => Promise<void>
}): ReactElement {
  const [editing, setEditing] = useState<boolean>(false)
  const [adminScore, setAdminScore] = useState<string>(item.adminScore?.toString() ?? '')
  const [adminComment, setAdminComment] = useState<string>(item.adminComment ?? '')

  return (
    <div className="phaseBlock">
      <p className="subtitle">Setup: {item.prompt}</p>
      <p style={{ fontSize: '1.05em', fontWeight: 600, margin: '0 0 6px 0' }}>→ {item.punchline}</p>
      <p className="subtitle">
        {item.source === 'bot' ? '🤖 bot' : `👤 ${item.authorRealName ?? '?'}`} | admin: {item.adminScore ?? '—'} | rating: {item.ratingAverage?.toFixed(2) ?? '—'} ({item.ratingCount ?? 0}) | дуэли: {item.votesFor}↑/{item.votesAgainst}↓ ({(item.voteShare * 100).toFixed(0)}%) | в примерах: {item.usedAsExampleCount}
      </p>
      {item.adminComment && <p className="subtitle">Коммент: {item.adminComment}</p>}
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <label className="inputGroup">
            <span>Admin score (1-10, пусто = убрать)</span>
            <input
              type="number"
              min={1}
              max={10}
              value={adminScore}
              onChange={(e) => setAdminScore(e.target.value)}
            />
          </label>
          <textarea
            value={adminComment}
            placeholder="Комментарий (опционально)"
            onChange={(e) => setAdminComment(e.target.value)}
          />
          <div className="row">
            <button
              className="primary"
              onClick={async () => {
                const score: number | null = adminScore.trim().length > 0 ? Number(adminScore) : null
                await onSave(item.id, {
                  adminScore: score,
                  adminComment: adminComment.trim().length > 0 ? adminComment : null
                })
                setEditing(false)
              }}
            >
              Сохранить
            </button>
            <button className="secondary" onClick={() => setEditing(false)}>Отмена</button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button className="secondary" onClick={() => setEditing(true)}>Edit</button>
          <button className="secondary" onClick={() => onDelete(item.id)}>Delete</button>
        </div>
      )}
    </div>
  )
}
