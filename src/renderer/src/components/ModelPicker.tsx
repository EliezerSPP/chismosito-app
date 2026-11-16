import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Pencil, RefreshCw, Search } from 'lucide-react'
import type { LlmModelOption } from '@shared/types'
import { buildModelItems, CUSTOM_MODEL_ID, type ModelPickerItem } from '@shared/models'
import { cn } from '../lib/cn'

interface ModelPickerProps {
  /** Id guardado. Vacío = modelo por defecto del .env. */
  value: string
  defaultLabel: string
  options: LlmModelOption[]
  loading?: boolean
  disabled?: boolean
  onChange: (id: string) => void
  onCustom: () => void
  onRefresh: () => void
}


export function ModelPicker({
  value,
  defaultLabel,
  options,
  loading,
  disabled,
  onChange,
  onCustom,
  onRefresh
}: ModelPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const current = options.find((option) => option.id === value)
  const selectedLabel = value ? (current?.label ?? value) : defaultLabel

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    searchRef.current?.focus()
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setHighlight(0)
    }
  }, [open])

  const items = useMemo<ModelPickerItem[]>(
    () => buildModelItems(options, defaultLabel, query),
    [defaultLabel, options, query]
  )

  const pick = (item: ModelPickerItem): void => {
    setOpen(false)
    if (item.kind === 'custom') {
      onCustom()
      return
    }
    onChange(item.id)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((index) => Math.min(index + 1, items.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = items[highlight]
      if (item) pick(item)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={cn(
            'field flex min-w-0 flex-1 items-center justify-between gap-3 text-left',
            open && 'border-accent/50'
          )}
          onClick={() => setOpen((state) => !state)}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="Elegir modelo"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm text-ink">{selectedLabel}</span>
            <span className="block truncate font-mono text-[10px] text-muted">
              {value || 'LLM_MODEL del .env'}
            </span>
          </span>
          <ChevronDown
            className={cn('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')}
          />
        </button>
        <button
          type="button"
          className="btn-ghost h-9 shrink-0 px-2"
          onClick={onRefresh}
          disabled={loading}
          title="Actualizar la lista desde la API"
          aria-label="Actualizar la lista de modelos"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </button>
      </div>

      {open ? (
        <div className="fade-up absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
          <div className="relative border-b border-line/60 px-3 py-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              className="w-full bg-transparent pl-6 text-sm text-ink placeholder:text-muted/70 focus:outline-none"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setHighlight(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="Buscar modelo…"
              spellCheck={false}
              autoComplete="off"
              aria-label="Buscar modelo"
            />
          </div>

          <ul role="listbox" aria-label="Modelos disponibles" className="max-h-64 overflow-y-auto py-1">
            {items.map((item, index) => {
              const isCustom = item.kind === 'custom'
              const selected = !isCustom && item.id === value
              return (
                <li key={isCustom ? CUSTOM_MODEL_ID : `${item.kind}:${item.id}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => pick(item)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
                      index === highlight ? 'bg-surface2' : 'bg-transparent'
                    )}
                  >
                    {isCustom ? (
                      <Pencil className="size-3.5 shrink-0 text-muted" />
                    ) : (
                      <span className="flex size-3.5 shrink-0 items-center justify-center">
                        {selected ? <Check className="size-3.5 text-accent" /> : null}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{item.label}</span>
                      {item.kind === 'model' && item.label !== item.id ? (
                        <span className="block truncate font-mono text-[10px] text-muted">
                          {item.id}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              )
            })}
            {items.length === 1 && query ? (
              <li className="px-3 py-2 text-xs text-muted">Sin resultados para “{query}”.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
