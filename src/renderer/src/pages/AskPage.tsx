import { useCallback, useEffect, useState } from 'react'
import { MessageSquare, Plus, Trash2 } from 'lucide-react'
import type { ChatThreadSummary } from '@shared/types'
import { useAppStore } from '../store'
import { ChatPanel } from '../components/ChatPanel'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { timeAgo } from '../lib/format'
import { errorMessage } from '../lib/errors'
import { cn } from '../lib/cn'

export function AskPage(): React.JSX.Element {
  const notes = useAppStore((state) => state.notes)
  const folders = useAppStore((state) => state.folders)
  const pushToast = useAppStore((state) => state.pushToast)
  const [threads, setThreads] = useState<ChatThreadSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyNew, setBusyNew] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<ChatThreadSummary[]> => {
    const list = await window.chismosito.chat.threads('library')
    setThreads(list)
    return list
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        let list = await window.chismosito.chat.threads('library')
        if (cancelled) return
        if (list.length === 0) {
          const created = await window.chismosito.chat.create()
          if (cancelled) return
          setActiveId(created.id)
          list = await window.chismosito.chat.threads('library')
          if (cancelled) return
        } else {
          setActiveId(list[0].id)
        }
        setThreads(list)
      } catch (error) {
        if (!cancelled) pushToast('error', errorMessage(error))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pushToast])

  const newThread = async (): Promise<void> => {
    if (busyNew) return
    setBusyNew(true)
    try {
      const created = await window.chismosito.chat.create()
      setActiveId(created.id)
      await refresh()
    } catch (error) {
      pushToast('error', errorMessage(error))
    } finally {
      setBusyNew(false)
    }
  }

  const removeThread = async (threadId: string): Promise<void> => {
    try {
      await window.chismosito.chat.remove(threadId)
      let list = await refresh()
      if (activeId === threadId) {
        if (list.length === 0) {
          const created = await window.chismosito.chat.create()
          setActiveId(created.id)
          list = await window.chismosito.chat.threads('library')
          setThreads(list)
        } else {
          setActiveId(list[0].id)
        }
      }
      pushToast('success', 'Conversación eliminada')
    } catch (error) {
      pushToast('error', errorMessage(error))
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-1px)] w-full max-w-6xl flex-col px-7 py-8 lg:px-10 lg:py-10">
      <header className="mb-5 shrink-0">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
          Biblioteca
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-serif text-4xl leading-tight">Preguntar</h1>
            <p className="mt-1 text-sm text-muted">
              Cruza información entre tus {notes.length} {notes.length === 1 ? 'reunión' : 'reuniones'}:
              tareas, decisiones, personas o temas.
            </p>
          </div>
          <span className="chip">
            <MessageSquare className="size-3" />
            Chat global
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[228px_1fr]">
        <aside className="flex min-h-0 flex-col rounded-2xl border border-line bg-surface/70 p-2">
          <button
            type="button"
            onClick={() => void newThread()}
            disabled={busyNew}
            className="btn-secondary h-9 w-full shrink-0 text-xs"
          >
            <Plus className="size-3.5" />
            Nueva conversación
          </button>

          <div className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
            {loading ? (
              <>
                <div className="shimmer h-12 rounded-xl" />
                <div className="shimmer mt-1 h-12 rounded-xl" />
              </>
            ) : threads.length === 0 ? (
              <p className="px-2 py-3 text-[11px] leading-relaxed text-muted">
                Aún no hay conversaciones.
              </p>
            ) : (
              threads.map((thread) => (
                <div
                  key={thread.id}
                  className={cn(
                    'group flex items-center gap-0.5 rounded-xl transition-colors',
                    activeId === thread.id ? 'bg-surface2' : 'hover:bg-surface2/60'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActiveId(thread.id)}
                    className={cn(
                      'flex min-w-0 flex-1 items-start gap-2 rounded-xl px-2.5 py-2 text-left',
                      activeId === thread.id ? 'text-ink' : 'text-muted'
                    )}
                  >
                    <MessageSquare className="mt-0.5 size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">
                        {thread.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-muted">
                        {timeAgo(thread.updatedAt)} · {thread.messageCount}{' '}
                        {thread.messageCount === 1 ? 'mensaje' : 'mensajes'}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(thread.id)}
                    className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-lg text-muted opacity-0 transition-opacity hover:bg-surface hover:text-red-600 group-hover:opacity-100 dark:hover:text-red-300"
                    aria-label="Eliminar conversación"
                    title="Eliminar conversación"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        <ChatPanel
          threadId={activeId}
          scope="library"
          folders={folders}
          showFilters
          className="min-h-0"
          onActivity={() => void refresh()}
        />
      </div>

      <ConfirmDialog
        open={Boolean(confirmId)}
        title="¿Eliminar esta conversación?"
        description="Se borrará el historial local y su copia en Google Drive si existe. Las notas y grabaciones no se modifican."
        confirmLabel="Eliminar"
        destructive
        onClose={() => setConfirmId(null)}
        onConfirm={() => {
          if (confirmId) void removeThread(confirmId)
        }}
      />
    </div>
  )
}
