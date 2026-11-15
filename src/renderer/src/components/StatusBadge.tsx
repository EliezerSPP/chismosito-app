import type { NoteStatus } from '@shared/types'
import { AlertTriangle, Check, Clock, Loader2, Mic, X } from 'lucide-react'
import { cn } from '../lib/cn'

const STATUS: Record<
  NoteStatus,
  { label: string; className: string; icon: typeof Check; spin?: boolean }
> = {
  complete: {
    label: 'Lista',
    className: 'bg-[color-mix(in_srgb,var(--olive)_16%,transparent)] text-olive',
    icon: Check
  },
  processing: {
    label: 'Procesando',
    className: 'bg-[color-mix(in_srgb,var(--gold)_18%,transparent)] text-gold',
    icon: Loader2,
    spin: true
  },
  recording: {
    label: 'Grabando',
    className: 'bg-accent-soft text-accent',
    icon: Mic
  },
  summary_failed: {
    label: 'Sin resumen',
    className: 'bg-[color-mix(in_srgb,var(--gold)_18%,transparent)] text-gold',
    icon: AlertTriangle
  },
  transcription_failed: {
    label: 'Error de transcripción',
    className: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300',
    icon: AlertTriangle
  },
  cancelled: {
    label: 'Cancelada',
    className: 'bg-surface2 text-muted',
    icon: X
  }
}

export function StatusBadge({
  status,
  className
}: {
  status: NoteStatus
  className?: string
}): React.JSX.Element {
  const config = STATUS[status] ?? STATUS.complete
  const Icon = config.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
        config.className,
        className
      )}
    >
      <Icon className={cn('size-3.5', config.spin && 'animate-spin')} />
      {config.label}
    </span>
  )
}

export function DurationBadge({ seconds }: { seconds: number }): React.JSX.Element | null {
  if (!seconds) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const label = h > 0 ? `${h} h ${m} min` : m > 0 ? `${m} min ${s} s` : `${s} s`
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted">
      <Clock className="size-3" />
      {label}
    </span>
  )
}
