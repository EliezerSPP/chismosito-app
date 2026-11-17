import { Link } from 'react-router-dom'
import type { Job } from '@shared/types'
import { Loader2, RotateCcw, X } from 'lucide-react'
import { ProgressBar } from './ProgressBar'
import { cn } from '../lib/cn'

const STAGE_LABEL: Record<Job['stage'], string> = {
  queued: 'En cola',
  preparing_audio: 'Preparando el audio',
  transcribing_mic: 'Transcribiendo tu voz',
  transcribing_system: 'Transcribiendo a los demás',
  transcribing_mix: 'Transcribiendo el audio completo',
  merging: 'Uniendo la transcripción',
  summarizing: 'Generando resumen',
  finalizing: 'Guardando nota',
  done: 'Listo',
  failed: 'Error',
  cancelled: 'Cancelado'
}

export function JobRow({
  job,
  noteTitle,
  onRetry,
  onCancel
}: {
  job: Job
  noteTitle: string
  onRetry: () => void
  onCancel: () => void
}): React.JSX.Element {
  const active = !['done', 'failed', 'cancelled'].includes(job.stage)
  const failed = job.stage === 'failed'

  return (
    <div className="soft-card px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
            failed ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-300' : 'bg-accent-soft text-accent'
          )}
        >
          {active ? <Loader2 className="size-4 animate-spin" /> : <span className="text-xs">!</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium text-ink">{noteTitle}</p>
            <span className="text-[11px] text-muted">
              {failed ? STAGE_LABEL.failed : job.message || STAGE_LABEL[job.stage]}
            </span>
          </div>
          {active ? (
            <div className="mt-2 flex items-center gap-2">
              <ProgressBar value={job.progress} className="h-1.5" />
              <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted">
                {Math.round(job.progress)}%
              </span>
            </div>
          ) : null}
          {job.error ? (
            <p className={cn('mt-1.5 line-clamp-2 text-xs', failed ? 'text-red-600 dark:text-red-300' : 'text-muted')}>
              {job.error}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link
              to={`/note?path=${encodeURIComponent(job.notePath)}`}
              className="text-[11px] font-medium text-accent hover:underline"
            >
              Ver nota
            </Link>
            {failed ? (
              <button onClick={onRetry} className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-ink">
                <RotateCcw className="size-3" /> Reintentar
              </button>
            ) : null}
            {active ? (
              <button onClick={onCancel} className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-ink">
                <X className="size-3" /> Cancelar
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
