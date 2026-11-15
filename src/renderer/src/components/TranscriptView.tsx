import type { TranscriptLine } from '@shared/types'
import { cn } from '../lib/cn'

export function TranscriptView({
  lines,
  onSeek
}: {
  lines: TranscriptLine[]
  onSeek?: (seconds: number) => void
}): React.JSX.Element {
  if (lines.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-sm text-muted">
        Todavía no hay transcripción para esta nota.
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {lines.map((line, index) => {
        const isMe = line.speaker.toLowerCase() === 'yo'
        return (
          <div
            key={`${line.timestamp}-${index}`}
            className="group grid grid-cols-[72px_1fr] gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface2/70"
          >
            <button
              type="button"
              onClick={() => onSeek?.(line.seconds)}
              className="mt-0.5 h-fit rounded-md px-1 py-0.5 text-left font-mono text-[11px] text-muted transition-colors hover:bg-surface hover:text-accent"
              title="Ir a este momento del audio"
            >
              {line.timestamp}
            </button>
            <div className="min-w-0">
              <span
                className={cn(
                  'mr-2 inline-flex rounded-full px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide',
                  isMe ? 'bg-accent-soft text-accent' : 'bg-[color-mix(in_srgb,var(--olive)_16%,transparent)] text-olive'
                )}
              >
                {line.speaker}
              </span>
              <span className="text-sm leading-relaxed text-ink/90">{line.text}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
