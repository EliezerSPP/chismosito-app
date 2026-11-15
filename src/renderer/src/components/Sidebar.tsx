import { Link, useLocation, useSearchParams } from 'react-router-dom'
import {
  Cloud,
  CloudOff,
  Cpu,
  Folder,
  Library,
  MessageSquare,
  Mic,
  Settings,
  Sparkles
} from 'lucide-react'
import { useAppStore } from '../store'
import { Logo } from './Logo'
import { cn } from '../lib/cn'

export function Sidebar(): React.JSX.Element {
  const notes = useAppStore((state) => state.notes)
  const folders = useAppStore((state) => state.folders)
  const whisper = useAppStore((state) => state.whisper)
  const env = useAppStore((state) => state.env)
  const drive = useAppStore((state) => state.drive)
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const activeFolder = searchParams.get('folder')

  const rootCount = notes.filter((note) => !note.folder).length
  const counts = new Map<string, number>()
  for (const note of notes) {
    if (!note.folder) continue
    counts.set(note.folder, (counts.get(note.folder) ?? 0) + 1)
  }

  const libraryActive = location.pathname === '/library'
  const recordActive = location.pathname === '/'
  const askActive = location.pathname === '/ask'

  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-line bg-surface/65 px-4 py-5">
      <Link to="/" className="mb-7 flex items-center gap-3 no-drag">
        <Logo size={38} />
        <div>
          <div className="font-serif text-xl leading-none">Chismosito</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted">
            Notas de reunión
          </div>
        </div>
      </Link>

      <nav className="space-y-1">
        <Link to="/" className={cn('nav-link', recordActive && 'nav-link-active')}>
          <Mic className="size-4" />
          Grabar
        </Link>
        <Link
          to="/library"
          className={cn('nav-link', libraryActive && !activeFolder && 'nav-link-active')}
        >
          <Library className="size-4" />
          Biblioteca
          <span className="ml-auto text-[11px] tabular-nums text-muted">{notes.length}</span>
        </Link>
        <Link to="/ask" className={cn('nav-link', askActive && 'nav-link-active')}>
          <MessageSquare className="size-4" />
          Preguntar
        </Link>
      </nav>

      <div className="mt-7 flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between px-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
            Carpetas
          </span>
          <span className="text-[10px] text-muted">{folders.length}</span>
        </div>
        <div className="min-h-0 space-y-0.5 overflow-y-auto pr-1">
          <Link
            to="/library?folder=__root__"
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-surface2 hover:text-ink',
              libraryActive && activeFolder === '__root__' && 'bg-surface2 text-ink'
            )}
          >
            <Folder className="size-3.5" />
            <span className="truncate">Sin clasificar</span>
            <span className="ml-auto text-[10px] tabular-nums">{rootCount}</span>
          </Link>
          {folders.map((folder) => (
            <Link
              key={folder}
              to={`/library?folder=${encodeURIComponent(folder)}`}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-surface2 hover:text-ink',
                libraryActive && activeFolder === folder && 'bg-surface2 text-ink'
              )}
              title={folder}
            >
              <Folder className="size-3.5" />
              <span className="truncate">{folder}</span>
              <span className="ml-auto text-[10px] tabular-nums">{counts.get(folder) ?? 0}</span>
            </Link>
          ))}
          {folders.length === 0 ? (
            <p className="px-3 py-1.5 text-[11px] leading-relaxed text-muted/80">
              Mueve una nota a una carpeta para organizarla.
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 space-y-2 border-t border-line pt-4">
        <StatusLine
          icon={<Cpu className="size-3.5" />}
          label="Transcripción"
          ok={Boolean(whisper?.model.present)}
          detail={whisper?.model.present ? 'Lista' : 'Falta el modelo'}
        />
        <StatusLine
          icon={<Sparkles className="size-3.5" />}
          label="Resumen"
          ok={Boolean(env?.llm.configured)}
          detail={env?.llm.configured ? 'LLM configurado' : 'Falta API key'}
        />
        <StatusLine
          icon={drive?.connected ? <Cloud className="size-3.5" /> : <CloudOff className="size-3.5" />}
          label="Google Drive"
          ok={Boolean(drive?.connected)}
          detail={drive?.connected ? 'Conectado' : 'Sin conectar'}
          optional
        />
        <Link
          to="/settings"
          className={cn(
            'nav-link mt-1',
            location.pathname === '/settings' && 'nav-link-active'
          )}
        >
          <Settings className="size-4" />
          Ajustes
        </Link>
      </div>
    </aside>
  )
}

function StatusLine({
  icon,
  label,
  ok,
  detail,
  optional
}: {
  icon: React.ReactNode
  label: string
  ok: boolean
  detail: string
  optional?: boolean
}): React.JSX.Element {
  return (
    <Link
      to="/settings"
      className="flex items-center gap-2 rounded-lg px-3 py-1 text-[11px] text-muted transition-colors hover:bg-surface2 hover:text-ink"
      title={`${label}: ${detail}`}
    >
      <span className="text-muted">{icon}</span>
      <span className="truncate">{label}</span>
      <span
        className={cn(
          'ml-auto size-1.5 shrink-0 rounded-full',
          ok ? 'bg-olive' : optional ? 'bg-line' : 'bg-gold'
        )}
      />
    </Link>
  )
}
