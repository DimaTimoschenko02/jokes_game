import { useCallback, useEffect, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { useAuth } from '../auth/auth-context'
import {
  adminApi,
  type JokeListItem,
  type ListJokesQuery,
  type ListPromptsQuery,
  type PromptDetail,
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

const SCORE_VALUES: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

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
    <main className="layout wide">
      <section className="panel wide">
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
    isGolden: 'all',
    isFallback: 'all'
  })
  const [items, setItems] = useState<readonly PromptListItem[]>([])
  const [total, setTotal] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState<boolean>(false)

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
    isFallback?: boolean
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
      <div className="row" style={{ marginBottom: 8 }}>
        <button type="button" className="primary" onClick={() => setCreating((c) => !c)}>
          {creating ? '× Отмена' : '+ Создать опенинг'}
        </button>
      </div>
      {creating && (
        <CreatePromptForm
          token={token}
          onCreated={async () => {
            setCreating(false)
            await load()
          }}
        />
      )}
      <FilterBar
        query={query}
        onChange={(q) => setQuery({ ...query, ...q, page: 1 })}
        sortOptions={PROMPT_SORT_OPTIONS}
        showSource={false}
        showRating={false}
        showGolden={true}
        showFallback={true}
      />
      {error && <p className="errorText">{error}</p>}
      {loading && <p className="subtitle">Загрузка...</p>}
      <p className="subtitle">{total} всего, страница {query.page ?? 1} из {totalPages}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        {items.map((item) => (
          <PromptRow key={item.id} item={item} token={token} onSave={onSave} onDelete={onDelete} />
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
  readonly isFallback?: YesNoFilter
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
  readonly showFallback?: boolean
}): ReactElement {
  const { query, onChange, sortOptions, showSource, showRating, showGolden, showFallback } = props
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
        {showFallback && (
          <label className="inputGroup" style={{ flex: '1 1 100px' }}>
            <span>Fallback</span>
            <select
              value={query.isFallback ?? 'all'}
              onChange={(e) => onChange({ isFallback: e.target.value as YesNoFilter })}
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

function ScoreScale({
  value,
  onChange
}: {
  readonly value: number | null
  readonly onChange: (next: number | null) => void
}): ReactElement {
  return (
    <div className="scoreScale">
      {SCORE_VALUES.map((n) => (
        <button
          key={n}
          type="button"
          className={value === n ? 'active' : ''}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
      <div className="scoreDivider" />
      <button
        type="button"
        className="clear"
        onClick={() => onChange(null)}
        disabled={value === null}
      >
        Убрать
      </button>
    </div>
  )
}

function Chip({
  children,
  tone
}: {
  readonly children: ReactNode
  readonly tone?: 'golden' | 'positive' | 'negative' | 'muted'
}): ReactElement {
  const cls = tone ? `adminChip ${tone}` : 'adminChip'
  return <span className={cls}>{children}</span>
}

function CreatePromptForm({
  token,
  onCreated
}: {
  readonly token: string
  readonly onCreated: () => Promise<void>
}): ReactElement {
  const [text, setText] = useState<string>('')
  const [adminScore, setAdminScore] = useState<number | null>(null)
  const [adminComment, setAdminComment] = useState<string>('')
  const [isGolden, setIsGolden] = useState<boolean>(false)
  const [isFallback, setIsFallback] = useState<boolean>(false)
  const [saving, setSaving] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      setError('Текст пустой')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await adminApi.createPrompt(token, {
        text: trimmed,
        adminScore,
        adminComment: adminComment.trim().length > 0 ? adminComment : null,
        isGolden,
        isFallback
      })
      setText('')
      setAdminScore(null)
      setAdminComment('')
      setIsGolden(false)
      setIsFallback(false)
      await onCreated()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="phaseBlock" style={{ marginBottom: 12 }}>
      <h3 style={{ margin: '0 0 8px 0' }}>Новый опенинг</h3>
      <p className="subtitle" style={{ marginBottom: 8 }}>
        Чтобы попадал в few-shot для генератора — поставь <b>Golden</b> + admin score ≥ 8.<br />
        Чтобы использовался при падении генератора — поставь <b>Fallback</b>.
      </p>
      <textarea
        value={text}
        placeholder="Текст опенинга (без точки/многоточия в конце)"
        onChange={(e) => setText(e.target.value)}
        style={{ minHeight: 60 }}
      />
      <label className="inputGroup" style={{ marginTop: 8 }}>
        <span>Admin score (1–10, опционально)</span>
        <ScoreScale value={adminScore} onChange={setAdminScore} />
      </label>
      <div className="row" style={{ marginTop: 8, gridTemplateColumns: 'auto auto 1fr' }}>
        <label className="inputGroup" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, width: 'auto' }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={isGolden}
            onChange={(e) => setIsGolden(e.target.checked)}
          />
          <span>Golden (попадает в few-shot)</span>
        </label>
        <label className="inputGroup" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, width: 'auto' }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={isFallback}
            onChange={(e) => setIsFallback(e.target.checked)}
          />
          <span>Fallback (используется когда AI упал)</span>
        </label>
        <div />
      </div>
      <textarea
        value={adminComment}
        placeholder="Комментарий (опционально)"
        onChange={(e) => setAdminComment(e.target.value)}
        style={{ marginTop: 8 }}
      />
      {error && <p className="errorText" style={{ marginTop: 8 }}>{error}</p>}
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="primary" disabled={saving} onClick={submit}>
          {saving ? 'Сохраняю...' : 'Создать'}
        </button>
      </div>
    </div>
  )
}

function PromptRow({
  item,
  token,
  onSave,
  onDelete
}: {
  readonly item: PromptListItem
  readonly token: string
  readonly onSave: (id: string, body: { adminScore?: number | null; adminComment?: string | null; isGolden?: boolean; isFallback?: boolean }) => Promise<void>
  readonly onDelete: (id: string) => Promise<void>
}): ReactElement {
  const [editing, setEditing] = useState<boolean>(false)
  const [adminScore, setAdminScore] = useState<number | null>(item.adminScore ?? null)
  const [adminComment, setAdminComment] = useState<string>(item.adminComment ?? '')
  const [isGolden, setIsGolden] = useState<boolean>(item.isGolden)
  const [isFallback, setIsFallback] = useState<boolean>(item.isFallback)
  const [expanded, setExpanded] = useState<boolean>(false)
  const [detail, setDetail] = useState<PromptDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const onToggleExpand = async (): Promise<void> => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (detail !== null) {
      return
    }
    setLoadingDetail(true)
    setDetailError(null)
    try {
      const d = await adminApi.getPrompt(token, item.id)
      setDetail(d)
    } catch (e) {
      setDetailError((e as Error).message)
    } finally {
      setLoadingDetail(false)
    }
  }

  const feedbackTone: 'positive' | 'negative' | 'muted' =
    item.feedbackCount === 0 ? 'muted' : item.feedbackScore > 0 ? 'positive' : item.feedbackScore < 0 ? 'negative' : 'muted'

  return (
    <div className="phaseBlock">
      <p style={{ fontSize: '1.05em', margin: '0 0 6px 0' }}>{item.text}</p>
      <div className="adminChips">
        {item.isGolden && <Chip tone="golden">★ GOLDEN</Chip>}
        {item.isFallback && <Chip tone="positive">🔄 FALLBACK</Chip>}
        <Chip tone={item.adminScore !== null ? (item.adminScore >= 7 ? 'positive' : item.adminScore <= 3 ? 'negative' : undefined) : 'muted'}>
          admin: <strong>{item.adminScore ?? '—'}</strong>
        </Chip>
        <Chip tone={feedbackTone}>
          feedback: <strong>{item.feedbackScore.toFixed(2)}</strong> ({item.feedbackCount})
        </Chip>
        <Chip>использовано: <strong>{item.usedCount}</strong></Chip>
        <Chip>шуток: <strong>{item.completionsCount}</strong></Chip>
        <Chip>в примерах: <strong>{item.usedAsExampleCount}</strong></Chip>
        {item.avgVoteShare !== null && (
          <Chip>дуэли: <strong>{(item.avgVoteShare * 100).toFixed(0)}%</strong></Chip>
        )}
      </div>
      {item.adminComment && <p className="subtitle" style={{ marginTop: 6 }}>Коммент: {item.adminComment}</p>}
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          <label className="inputGroup">
            <span>Admin score (1–10)</span>
            <ScoreScale value={adminScore} onChange={setAdminScore} />
          </label>
          <div className="row" style={{ gridTemplateColumns: 'auto auto 1fr' }}>
            <label className="inputGroup" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, width: 'auto' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={isGolden}
                onChange={(e) => setIsGolden(e.target.checked)}
              />
              <span>Golden</span>
            </label>
            <label className="inputGroup" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, width: 'auto' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={isFallback}
                onChange={(e) => setIsFallback(e.target.checked)}
              />
              <span>Fallback</span>
            </label>
            <div />
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
                await onSave(item.id, {
                  adminScore,
                  adminComment: adminComment.trim().length > 0 ? adminComment : null,
                  isGolden,
                  isFallback
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
        <div className="row" style={{ marginTop: 10, gridTemplateColumns: 'auto auto auto 1fr' }}>
          <button className="secondary" onClick={() => setEditing(true)}>Edit</button>
          <button className="secondary" onClick={onToggleExpand}>
            {expanded ? '▲ Скрыть шутки' : `▼ Шутки (${item.completionsCount})`}
          </button>
          <button className="secondary" onClick={() => onDelete(item.id)}>Delete</button>
          <div />
        </div>
      )}
      {expanded && (
        <div className="completionsList">
          {loadingDetail && <p className="subtitle">Загрузка...</p>}
          {detailError && <p className="errorText">{detailError}</p>}
          {detail && detail.completions.length === 0 && <p className="subtitle">Нет шуток</p>}
          {detail && detail.completions.length > 0 && detail.completions.map((c, idx) => (
            <div key={idx} className="completionItem">
              <span className="completionText">→ {c.punchline}</span>
              <div className="adminChips">
                <Chip>{c.source === 'bot' ? '🤖 bot' : '👤 человек'}</Chip>
                {c.ratingAverage !== undefined && c.ratingAverage !== null && (
                  <Chip tone={c.ratingAverage >= 7 ? 'positive' : c.ratingAverage <= 4 ? 'negative' : undefined}>
                    rating: <strong>{c.ratingAverage.toFixed(2)}</strong> ({c.ratingCount ?? 0})
                  </Chip>
                )}
                <Chip>дуэли: <strong>{c.votesFor}↑/{c.votesAgainst}↓</strong> ({(c.voteShare * 100).toFixed(0)}%)</Chip>
                <Chip>комната: <strong>{c.roomCode}</strong></Chip>
                <Chip>раунд: <strong>{c.roundIndex + 1}</strong></Chip>
              </div>
            </div>
          ))}
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
  const [adminScore, setAdminScore] = useState<number | null>(item.adminScore ?? null)
  const [adminComment, setAdminComment] = useState<string>(item.adminComment ?? '')

  return (
    <div className="phaseBlock">
      <p className="subtitle">Setup: {item.prompt}</p>
      <p style={{ fontSize: '1.05em', fontWeight: 600, margin: '0 0 6px 0' }}>→ {item.punchline}</p>
      <div className="adminChips">
        <Chip>{item.source === 'bot' ? '🤖 bot' : `👤 ${item.authorRealName ?? '?'}`}</Chip>
        <Chip tone={item.adminScore !== null ? (item.adminScore >= 7 ? 'positive' : item.adminScore <= 3 ? 'negative' : undefined) : 'muted'}>
          admin: <strong>{item.adminScore ?? '—'}</strong>
        </Chip>
        <Chip tone={item.ratingAverage !== null ? (item.ratingAverage >= 7 ? 'positive' : item.ratingAverage <= 4 ? 'negative' : undefined) : 'muted'}>
          rating: <strong>{item.ratingAverage?.toFixed(2) ?? '—'}</strong> ({item.ratingCount ?? 0})
        </Chip>
        <Chip>дуэли: <strong>{item.votesFor}↑/{item.votesAgainst}↓</strong> ({(item.voteShare * 100).toFixed(0)}%)</Chip>
        <Chip>quality: <strong>{item.qualityScore.toFixed(2)}</strong></Chip>
        <Chip>в примерах: <strong>{item.usedAsExampleCount}</strong></Chip>
        <Chip>комната: <strong>{item.roomCode}</strong></Chip>
      </div>
      {item.adminComment && <p className="subtitle" style={{ marginTop: 6 }}>Коммент: {item.adminComment}</p>}
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          <label className="inputGroup">
            <span>Admin score (1–10)</span>
            <ScoreScale value={adminScore} onChange={setAdminScore} />
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
                await onSave(item.id, {
                  adminScore,
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
        <div className="row" style={{ marginTop: 10 }}>
          <button className="secondary" onClick={() => setEditing(true)}>Edit</button>
          <button className="secondary" onClick={() => onDelete(item.id)}>Delete</button>
        </div>
      )}
    </div>
  )
}
