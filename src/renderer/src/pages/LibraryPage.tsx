import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2, Mic, Search, X } from 'lucide-react'
import type { NoteMeta } from '@shared/types'
import { useAppStore } from '../store'
import { NoteRow } from '../components/NoteRow'
import { EmptyState } from '../components/EmptyState'
import { dateGroupLabel } from '../lib/format'
import { errorMessage } from '../lib/errors'

export function LibraryPage(): React.JSX.Element {
  const notes = useAppStore((state) => state.notes)
  const jobs = useAppStore((state) => state.jobs)
  const notesLoading = useAppStore((state) => state.notesLoading)
  const notesRevision = useAppStore((state) => state.notesRevision)
  const pushToast = useAppStore((state) => state.pushToast)
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NoteMeta[] | null>(null)
  const [searching, setSearching] = useState(false)
  const folderParam = searchParams.get('folder')

  useEffect(() => {
    const term = query.trim()
    if (!term) {
      setResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = window.setTimeout(() => {
      window.chismosito.notes
        .search(term)
        .then((found) => setResults(found))
        .catch((error) => {
          pushToast('error', errorMessage(error))
          setResults([])
        })
        .finally(() => setSearching(false))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, notesRevision, pushToast])

  const activeJobs = jobs.filter((job) => !['done', 'failed', 'cancelled'].includes(job.stage))

  const title =
    folderParam === '__root__'
      ? 'Sin clasificar'
      : folderParam
        ? folderParam
        : 'Biblioteca'

  const filtered = useMemo(() => {
    let list = query.trim() ? (results ?? []) : notes
    if (folderParam === '__root__') {
      list = list.filter((note) => !note.folder)
    } else if (folderParam) {
      list = list.filter(
        (note) =>
          note.folder.toLowerCase() === folderParam.toLowerCase() ||
          note.folder.toLowerCase().startsWith(`${folderParam.toLowerCase()}/`)
      )
    }
    return list
  }, [notes, query, results, folderParam])

  const groups = useMemo(() => {
    const map = new Map<string, NoteMeta[]>()
    for (const note of filtered) {
      const label = dateGroupLabel(note.date)
      const bucket = map.get(label)
      if (bucket) bucket.push(note)
      else map.set(label, [note])
    }
    return [...map.entries()]
  }, [filtered])

  return (
    <div className="mx-auto w-full max-w-4xl px-7 py-8 lg:px-10 lg:py-10">
      <header className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
              {folderParam ? 'Biblioteca / carpeta' : 'Biblioteca'}
            </p>
            <h1 className="truncate font-serif text-4xl leading-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted">
              {filtered.length} {filtered.length === 1 ? 'nota' : 'notas'}
              {query ? ` para “${query}”` : ''}
              {folderParam ? (
                <>
                  {' · '}
                  <button
                    onClick={() => setSearchParams({})}
                    className="text-accent underline-offset-4 hover:underline"
                  >
                    ver todas
                  </button>
                </>
              ) : null}
            </p>
          </div>
          <Link to="/" className="btn-primary h-9 text-xs">
            <Mic className="size-3.5" />
            Nueva reunión
          </Link>
        </div>

        <div className="relative mt-5">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por título, resumen, carpeta, etiqueta o transcripción…"
            className="field h-11 rounded-2xl pl-11 pr-10"
            aria-label="Buscar notas"
          />
          {searching ? (
            <Loader2 className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" />
          ) : query ? (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted hover:bg-surface2 hover:text-ink"
              aria-label="Limpiar búsqueda"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        {activeJobs.length > 0 ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[11px] text-muted">
            <span className="size-1.5 animate-pulse rounded-full bg-gold" />
            {activeJobs.length} {activeJobs.length === 1 ? 'reunión se está procesando' : 'reuniones se están procesando'}{' '}
            en segundo plano.
            <Link to="/" className="ml-auto font-medium text-accent hover:underline">
              Ver estado
            </Link>
          </div>
        ) : null}
      </header>

      {notesLoading && notes.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="shimmer h-24 rounded-2xl" />
          ))}
        </div>
      ) : searching && filtered.length === 0 ? (
        <div className="space-y-3">
          {[0, 1].map((index) => (
            <div key={index} className="shimmer h-24 rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={query ? 'Sin coincidencias' : folderParam ? 'Esta carpeta está vacía' : 'Aún no hay notas'}
          description={
            query
              ? 'Prueba con otra palabra o limpia la búsqueda.'
              : folderParam
                ? 'Mueve una nota a esta carpeta desde su vista de detalle.'
                : 'Graba tu primera reunión y aparecerá aquí con su resumen y transcripción.'
          }
          action={
            query ? (
              <button onClick={() => setQuery('')} className="btn-secondary mt-1 text-xs">
                Limpiar búsqueda
              </button>
            ) : (
              <Link to="/" className="btn-primary mt-1 text-xs">
                <Mic className="size-3.5" /> Grabar una reunión
              </Link>
            )
          }
        />
      ) : (
        <div className="space-y-7">
          {groups.map(([label, groupNotes]) => (
            <section key={label}>
              <div className="mb-2 flex items-center gap-3 px-1">
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                  {label}
                </h2>
                <span className="h-px flex-1 bg-line" />
                <span className="text-[10px] text-muted">{groupNotes.length}</span>
              </div>
              <div className="divide-y divide-line rounded-2xl border border-line bg-surface px-2">
                {groupNotes.map((note) => (
                  <NoteRow key={note.path} note={note} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
