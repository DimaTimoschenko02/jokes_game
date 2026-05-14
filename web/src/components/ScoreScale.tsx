import type { ReactElement } from 'react'

const SCORE_VALUES: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

export type ScoreScaleProps = {
  readonly value: number | null
  readonly onChange: (next: number | null) => void
  readonly disabled?: boolean
  readonly clearLabel?: string
  readonly showClear?: boolean
  readonly compact?: boolean
}

export function ScoreScale({
  value,
  onChange,
  disabled = false,
  clearLabel = 'Убрать',
  showClear = true,
  compact = false
}: ScoreScaleProps): ReactElement {
  return (
    <div className={`scoreScale ${compact ? 'scoreScaleCompact' : ''}`}>
      {SCORE_VALUES.map((n) => (
        <button
          key={n}
          type="button"
          className={value === n ? 'active' : ''}
          disabled={disabled}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
      {showClear && (
        <>
          <div className="scoreDivider" />
          <button
            type="button"
            className="clear"
            disabled={disabled || value === null}
            onClick={() => onChange(null)}
          >
            {clearLabel}
          </button>
        </>
      )}
    </div>
  )
}
