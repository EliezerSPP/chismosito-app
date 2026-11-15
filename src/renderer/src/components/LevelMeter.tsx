import { cn } from '../lib/cn'

interface LevelMeterProps {
  label: string
  hint?: string
  level: number
  muted?: boolean
  tone?: 'accent' | 'olive'
}

export function LevelMeter({
  label,
  hint,
  level,
  muted,
  tone = 'accent'
}: LevelMeterProps): React.JSX.Element {
  const segments = 26
  const active = muted ? 0 : Math.round(Math.min(1, Math.max(0, level)) * segments)
  return (
    <div className={cn('rounded-2xl border border-line bg-surface2/70 p-3', muted && 'opacity-45')}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          {label}
        </span>
        <span className="text-[10px] text-muted">{muted ? 'apagado' : hint}</span>
      </div>
      <div className="flex h-5 items-center gap-[3px]" aria-hidden>
        {Array.from({ length: segments }).map((_, index) => {
          const isOn = index < active
          const height = 6 + Math.round(Math.sin((index / segments) * Math.PI) * 10)
          return (
            <span
              key={index}
              className={cn(
                'flex-1 rounded-full transition-all duration-100',
                isOn ? (tone === 'accent' ? 'bg-accent' : 'bg-olive') : 'bg-line'
              )}
              style={{ height }}
            />
          )
        })}
      </div>
    </div>
  )
}
