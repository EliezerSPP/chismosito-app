import { CalendarDays, Folder, X } from 'lucide-react'
import type { ChatFilter } from '@shared/types'
import { dayjs } from '../lib/format'
import { cn } from '../lib/cn'

interface ChatFilterBarProps {
  value: ChatFilter | null
  folders: string[]
  disabled?: boolean
  onChange: (value: ChatFilter | null) => void
}

function startOfWeek(): ReturnType<typeof dayjs> {
  const today = dayjs()
  const day = today.day()
  const offset = day === 0 ? -6 : 1 - day
  return today.add(offset, 'day').startOf('day')
}

function sameRange(value: ChatFilter | null, from: string, to: string): boolean {
  return Boolean(value && value.from === from && value.to === to && value.folder === null)
}

export function ChatFilterBar({
  value,
  folders,
  disabled,
  onChange
}: ChatFilterBarProps): React.JSX.Element {
  const today = dayjs().format('YYYY-MM-DD')
  const weekStart = startOfWeek().format('YYYY-MM-DD')
  const weekEnd = startOfWeek().add(6, 'day').format('YYYY-MM-DD')
  const monthStart = dayjs().startOf('month').format('YYYY-MM-DD')
  const monthEnd = dayjs().endOf('month').format('YYYY-MM-DD')

  const update = (patch: Partial<ChatFilter>): void => {
    const next: ChatFilter = {
      from: value?.from ?? null,
      to: value?.to ?? null,
      folder: value?.folder ?? null,
      ...patch
    }
    if (next.from && next.to && next.from > next.to) {
      const from = next.to
      next.to = next.from
      next.from = from
    }
    onChange(next.from || next.to || next.folder !== null ? next : null)
  }

  const quick = [
    { label: 'Todas', from: null as string | null, to: null as string | null },
    { label: 'Hoy', from: today, to: today },
    { label: 'Esta semana', from: weekStart, to: weekEnd },
    { label: 'Este mes', from: monthStart, to: monthEnd }
  ]

  const active = Boolean(value)

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface2/40 px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        <CalendarDays className="size-3.5" />
        Filtrar
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {quick.map((option) => {
          const isActive =
            option.from === null && option.to === null
              ? !value || (!value.from && !value.to)
              : option.from && option.to
                ? sameRange(value, option.from, option.to)
                : false
          return (
            <button
              key={option.label}
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange(
                  option.from || option.to
                    ? { from: option.from, to: option.to, folder: value?.folder ?? null }
                    : value?.folder !== null && value?.folder !== undefined
                      ? { from: null, to: null, folder: value.folder }
                      : null
                )
              }
              className={cn('chip h-7 px-2.5 text-[11px] transition-colors', isActive && 'border-accent/40 bg-accent-soft text-accent')}
            >
              {option.label}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        <input
          type="date"
          aria-label="Desde"
          title="Desde"
          disabled={disabled}
          value={value?.from ?? ''}
          onChange={(event) => update({ from: event.target.value || null })}
          className="h-7 rounded-lg border border-line bg-surface px-2 text-[11px] text-ink"
        />
        <span>→</span>
        <input
          type="date"
          aria-label="Hasta"
          title="Hasta"
          disabled={disabled}
          value={value?.to ?? ''}
          onChange={(event) => update({ to: event.target.value || null })}
          className="h-7 rounded-lg border border-line bg-surface px-2 text-[11px] text-ink"
        />
      </div>

      <label className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-[11px] text-muted">
        <Folder className="size-3.5" />
        <select
          aria-label="Carpeta"
          disabled={disabled}
          value={value?.folder ?? '__all__'}
          onChange={(event) => {
            const raw = event.target.value
            update({ folder: raw === '__all__' ? null : raw })
          }}
          className="max-w-[160px] bg-transparent text-[11px] text-ink outline-none"
        >
          <option value="__all__">Todas las carpetas</option>
          <option value="">Sin clasificar</option>
          {folders.map((folder) => (
            <option key={folder} value={folder}>
              {folder}
            </option>
          ))}
        </select>
      </label>

      {active ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-muted transition-colors hover:bg-surface hover:text-ink"
          title="Quitar filtros"
        >
          <X className="size-3.5" />
          Limpiar
        </button>
      ) : null}
    </div>
  )
}
