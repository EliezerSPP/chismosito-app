import { Link } from 'react-router-dom'
import { ChevronRight, Cloud, CloudOff, CloudUpload, Folder, Tag } from 'lucide-react'
import type { NoteMeta } from '@shared/types'
import { DurationBadge, StatusBadge } from './StatusBadge'
import { noteDateLabel } from '../lib/format'
import { cn } from '../lib/cn'

export function DriveIcon({
  status,
  error
}: {
  status: NoteMeta['drive']
  error?: string | null
}): React.JSX.Element | null {
  if (status === 'none') return null
  const title =
    status === 'synced'
      ? 'Respaldada en Google Drive'
      : status === 'pending'
        ? 'Pendiente de respaldar'
        : error || 'Error al respaldar'
  if (status === 'synced') return <Cloud className="size-4 text-olive" aria-label={title} />
  if (status === 'pending') {
    return <CloudUpload className="size-4 animate-pulse text-gold" aria-label={title} />
  }
  return <CloudOff className="size-4 text-red-500" aria-label={title} />
}

export function NoteRow({
  note,
  compact
}: {
  note: NoteMeta
  compact?: boolean
}): React.JSX.Element {
  return (
    <Link
      to={`/note?path=${encodeURIComponent(note.path)}`}
      className={cn(
        'group flex items-start gap-4 rounded-2xl border border-transparent px-4 py-4 transition-colors hover:border-line hover:bg-surface',
        compact && 'py-3'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 truncate font-serif text-[17px] leading-snug text-ink">
            {note.title}
          </h3>
          <StatusBadge status={note.status} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted">
          <span>{noteDateLabel(note.date)}</span>
          <DurationBadge seconds={note.durationSeconds} />
          {note.folder ? (
            <span className="inline-flex items-center gap-1">
              <Folder className="size-3" />
              {note.folder}
            </span>
          ) : null}
          {note.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1">
              <Tag className="size-3" />
              {tag}
            </span>
          ))}
          {note.tags.length > 2 ? <span>+{note.tags.length - 2}</span> : null}
        </div>
        {!compact && note.excerpt ? (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">{note.excerpt}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-1">
        <DriveIcon status={note.drive} error={note.driveError} />
        <ChevronRight className="size-4 text-line transition-colors group-hover:text-muted" />
      </div>
    </Link>
  )
}
