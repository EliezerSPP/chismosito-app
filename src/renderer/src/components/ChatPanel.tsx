import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle,
  CloudUpload,
  Eraser,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Square
} from 'lucide-react'
import type {
  ChatFilter,
  ChatMessage,
  ChatScope,
  ChatSource,
  ChatThread
} from '@shared/types'
import { useAppStore } from '../store'
import { ChatFilterBar } from './ChatFilterBar'
import { ConfirmDialog } from './ConfirmDialog'
import { subscribeChat } from '../lib/chat'
import { errorMessage } from '../lib/errors'
import { cn } from '../lib/cn'

interface ChatPanelProps {
  threadId: string | null
  scope: ChatScope
  title?: string
  subtitle?: string
  disabledReason?: string | null
  folders?: string[]
  showFilters?: boolean
  className?: string
  onSeek?: (seconds: number) => void
  onActivity?: () => void
  emptyPrompts?: string[]
}

const NOTE_PROMPTS = [
  '¿Qué se decidió sobre los próximos pasos?',
  '¿Qué tareas quedaron pendientes y quién las toma?',
  'Resume lo que se dijo sobre el tema principal.'
]

const LIBRARY_PROMPTS = [
  '¿Qué tareas me asignaron esta semana?',
  '¿Qué decisiones se tomaron este mes?',
  '¿Qué se habló de presupuesto en las últimas reuniones?',
  'Resume los pendientes de la carpeta Producto.'
]

export function ChatPanel({
  threadId,
  scope,
  title,
  subtitle,
  disabledReason,
  folders = [],
  showFilters,
  className,
  onSeek,
  onActivity,
  emptyPrompts
}: ChatPanelProps): React.JSX.Element {
  const llmConfigured = useAppStore((state) => Boolean(state.env?.llm.configured))
  const drive = useAppStore((state) => state.drive)
  const pushToast = useAppStore((state) => state.pushToast)
  const [thread, setThread] = useState<ChatThread | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyBackup, setBusyBackup] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const stick = useRef(true)
  const activityRef = useRef(onActivity)
  activityRef.current = onActivity

  const reload = useCallback(async (): Promise<void> => {
    if (!threadId) return
    const value = await window.chismosito.chat.get(threadId)
    setThread(value)
  }, [threadId])

  useEffect(() => {
    let cancelled = false
    if (!threadId) {
      setThread(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    setError(null)
    setStreaming(false)
    setStreamText('')
    setStatus(null)
    setRequestId(null)
    setThread(null)
    stick.current = true
    window.chismosito.chat
      .get(threadId)
      .then((value) => {
        if (cancelled) return
        setThread(value)
        if (!value) setLoadError('La conversación no existe')
      })
      .catch((loadFailure) => {
        if (!cancelled) setLoadError(errorMessage(loadFailure))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [threadId])

  useEffect(() => {
    const unsubscribe = subscribeChat((event) => {
      if (!threadId || event.threadId !== threadId) return
      switch (event.type) {
        case 'started':
          setStreaming(true)
          setStreamText('')
          setStatus(null)
          setError(null)
          setRequestId(event.requestId)
          break
        case 'status':
          setStatus(event.label)
          break
        case 'delta':
          setStreamText((previous) => previous + event.text)
          break
        case 'done':
          setThread((previous) =>
            previous
              ? {
                  ...previous,
                  messages: previous.messages.some((message) => message.id === event.message.id)
                    ? previous.messages
                    : [...previous.messages, event.message]
                }
              : previous
          )
          setStreaming(false)
          setStreamText('')
          setStatus(null)
          setRequestId(null)
          activityRef.current?.()
          break
        case 'error':
          setStreaming(false)
          setStreamText('')
          setStatus(null)
          setRequestId(null)
          setError(event.message)
          void reload().catch(() => undefined)
          activityRef.current?.()
          break
      }
    })
    return unsubscribe
  }, [reload, threadId])

  useEffect(() => {
    const element = scrollRef.current
    if (element && stick.current) element.scrollTop = element.scrollHeight
  }, [thread?.messages.length, streamText, status])

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(160, element.scrollHeight)}px`
  }, [text])

  const onScroll = (): void => {
    const element = scrollRef.current
    if (!element) return
    stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120
  }

  const submit = async (content: string): Promise<void> => {
    const value = content.trim()
    if (!value || !thread || !threadId || sending || streaming || disabledReason) return
    const optimisticId = `local-${Date.now()}`
    const optimistic: ChatMessage = {
      id: optimisticId,
      role: 'user',
      content: value,
      createdAt: new Date().toISOString()
    }
    setThread((previous) =>
      previous ? { ...previous, messages: [...previous.messages, optimistic] } : previous
    )
    setText('')
    setError(null)
    setSending(true)
    try {
      const result = await window.chismosito.chat.send({ threadId, message: value })
      setRequestId(result.requestId)
      setThread((previous) =>
        previous
          ? {
              ...previous,
              messages: previous.messages.map((message) =>
                message.id === optimisticId ? result.userMessage : message
              )
            }
          : previous
      )
      activityRef.current?.()
    } catch (sendError) {
      setThread((previous) =>
        previous
          ? {
              ...previous,
              messages: previous.messages.filter((message) => message.id !== optimisticId)
            }
          : previous
      )
      setError(errorMessage(sendError))
    } finally {
      setSending(false)
    }
  }

  const retry = async (): Promise<void> => {
    if (!threadId || sending || streaming) return
    setSending(true)
    setError(null)
    try {
      const result = await window.chismosito.chat.retry(threadId)
      setRequestId(result.requestId)
    } catch (retryError) {
      setError(errorMessage(retryError))
    } finally {
      setSending(false)
    }
  }

  const stop = async (): Promise<void> => {
    if (!requestId) return
    setStatus('Deteniendo…')
    try {
      await window.chismosito.chat.cancel(requestId)
    } catch (cancelError) {
      setError(errorMessage(cancelError))
    }
  }

  const updateFilters = async (next: ChatFilter | null): Promise<void> => {
    if (!thread || !threadId || sending || streaming) return
    const previous = thread.filters
    setThread({ ...thread, filters: next })
    try {
      const updated = await window.chismosito.chat.updateFilters(threadId, next)
      setThread((current) =>
        current ? { ...current, filters: updated.filters } : current
      )
      activityRef.current?.()
    } catch (filterError) {
      setThread((current) => (current ? { ...current, filters: previous } : current))
      pushToast('error', errorMessage(filterError))
    }
  }

  const backup = async (): Promise<void> => {
    if (!threadId || busyBackup) return
    setBusyBackup(true)
    try {
      await window.chismosito.chat.backup(threadId)
    } catch (backupError) {
      pushToast('error', errorMessage(backupError))
    } finally {
      setBusyBackup(false)
    }
  }

  const clearThread = async (): Promise<void> => {
    if (!threadId || busy) return
    try {
      const cleared = await window.chismosito.chat.clear(threadId)
      setThread(cleared)
      setError(null)
      setStreamText('')
      setStatus(null)
      activityRef.current?.()
    } catch (clearError) {
      pushToast('error', errorMessage(clearError))
    }
  }

  const heading = title ?? (scope === 'note' ? 'Preguntas sobre esta reunión' : 'Preguntas sobre tu biblioteca')
  const description =
    subtitle ??
    (scope === 'note'
      ? 'El chat lee el resumen, las acciones y la transcripción de esta grabación.'
      : 'El chat busca en todas tus reuniones y responde con fuentes.')
  const prompts = emptyPrompts ?? (scope === 'note' ? NOTE_PROMPTS : LIBRARY_PROMPTS)
  const busy = sending || streaming

  return (
    <section
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-3xl border border-line bg-surface',
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-3.5 text-accent" />
            {heading}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{description}</p>
        </div>
        {thread && thread.messages.length > 0 ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={busy}
              className="btn-ghost h-8 px-2 text-[11px]"
              title="Limpiar esta conversación"
            >
              <Eraser className="size-3.5" />
              Limpiar
            </button>
            {drive?.connected ? (
              <button
                type="button"
                onClick={() => void backup()}
                disabled={busyBackup}
                className="btn-ghost h-8 px-2 text-[11px]"
                title="Respaldar esta conversación en Google Drive"
              >
                {busyBackup ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="size-3.5" />
                )}
                Respaldar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {showFilters && thread ? (
        <ChatFilterBar
          value={thread.filters}
          folders={folders}
          disabled={busy}
          onChange={(next) => void updateFilters(next)}
        />
      ) : null}

      {disabledReason ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <AlertTriangle className="size-6 text-gold" />
          <p className="max-w-md text-sm leading-relaxed text-muted">{disabledReason}</p>
        </div>
      ) : !llmConfigured ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <Sparkles className="size-6 text-accent" />
          <h3 className="font-serif text-xl">Falta la API key</h3>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            El chat necesita el mismo proveedor de LLM que usa el resumen. Agrega
            tu API key de OpenCode en Ajustes para empezar a preguntar.
          </p>
          <Link to="/settings?section=llm" className="btn-secondary mt-1 text-xs">
            Configurar API key
          </Link>
        </div>
      ) : loading ? (
        <div className="flex-1 space-y-3 p-4">
          <div className="shimmer h-16 rounded-2xl" />
          <div className="shimmer ml-auto h-12 w-2/3 rounded-2xl" />
          <div className="shimmer h-24 rounded-2xl" />
        </div>
      ) : !threadId ? (
        <div className="flex-1 space-y-3 p-4">
          <div className="shimmer h-16 rounded-2xl" />
          <div className="shimmer ml-auto h-12 w-2/3 rounded-2xl" />
          <div className="shimmer h-24 rounded-2xl" />
        </div>
      ) : loadError || !thread ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <AlertTriangle className="size-6 text-gold" />
          <p className="text-sm text-muted">{loadError ?? 'No se pudo abrir la conversación'}</p>
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
          >
            {thread.messages.length === 0 && !streaming ? (
              <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-4 text-center">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                  <Sparkles className="size-5" />
                </div>
                <div>
                  <p className="font-serif text-xl">Pregunta lo que quieras</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted">
                    {scope === 'note'
                      ? 'Busca detalles concretos de esta grabación más allá del resumen.'
                      : 'Cruza información entre reuniones: tareas, decisiones, personas o temas.'}
                  </p>
                </div>
                <div className="flex max-w-md flex-wrap justify-center gap-1.5">
                  {prompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void submit(prompt)}
                      className="chip max-w-full text-left hover:border-accent/40 hover:text-accent"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {thread.messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                scope={scope}
                onSeek={onSeek}
                onRetry={() => void retry()}
              />
            ))}

            {streaming ? (
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                  <Sparkles className="size-3.5" />
                </div>
                <div className="min-w-0 max-w-[88%] rounded-2xl rounded-tl-md border border-line bg-surface2/60 px-4 py-2.5">
                  {streamText ? (
                    <MarkdownContent
                      content={streamText}
                      scope={scope}
                      onSeek={onSeek}
                    />
                  ) : (
                    <p className="flex items-center gap-2 text-xs text-muted">
                      <Loader2 className="size-3.5 animate-spin text-accent" />
                      {status ?? 'Pensando…'}
                    </p>
                  )}
                  {streamText && status ? (
                    <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted">
                      <Loader2 className="size-3 animate-spin" />
                      {status}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="mx-4 mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              <AlertTriangle className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
              <button
                type="button"
                onClick={() => void retry()}
                className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:no-underline"
              >
                <RefreshCw className="size-3" />
                Reintentar
              </button>
            </div>
          ) : null}

          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submit(text)
            }}
            className="border-t border-line p-3"
          >
            <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface2/50 p-1.5">
              <textarea
                ref={textareaRef}
                rows={1}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault()
                    void submit(text)
                  }
                }}
                placeholder={
                  scope === 'note'
                    ? 'Pregunta sobre esta reunión…'
                    : 'Pregunta sobre todas tus reuniones…'
                }
                disabled={busy}
                className="max-h-40 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink placeholder:text-muted/70 focus:outline-none"
              />
              {streaming ? (
                <button
                  type="button"
                  onClick={() => void stop()}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition-opacity hover:opacity-80"
                  aria-label="Detener respuesta"
                  title="Detener respuesta"
                >
                  <Square className="size-3 fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!text.trim() || Boolean(disabledReason) || busy}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Enviar pregunta"
                  title="Enviar (Enter)"
                >
                  {sending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                </button>
              )}
            </div>
            <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-muted">
              Las preguntas y el contenido relevante se envían al proveedor del LLM. El
              historial del chat se guarda solo en este equipo.
            </p>
          </form>
        </>
      )}

      <ConfirmDialog
        open={confirmClear}
        title="¿Limpiar esta conversación?"
        description="Se borrarán los mensajes de este chat. Si el respaldo de conversaciones está activo, la copia en Google Drive se actualizará."
        confirmLabel="Limpiar"
        destructive
        onClose={() => setConfirmClear(false)}
        onConfirm={() => void clearThread()}
      />
    </section>
  )
}

function MessageBubble({
  message,
  scope,
  onSeek,
  onRetry
}: {
  message: ChatMessage
  scope: ChatScope
  onSeek?: (seconds: number) => void
  onRetry: () => void
}): React.JSX.Element {
  const isUser = message.role === 'user'
  return (
    <div className={cn('flex items-start gap-2.5', isUser && 'justify-end')}>
      {!isUser ? (
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Sparkles className="size-3.5" />
        </div>
      ) : null}
      <div
        className={cn(
          'min-w-0 max-w-[88%] rounded-2xl px-4 py-2.5',
          isUser
            ? 'rounded-br-md bg-accent text-white'
            : 'rounded-tl-md border border-line bg-surface2/60'
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
        ) : (
          <MarkdownContent content={message.content} scope={scope} onSeek={onSeek} />
        )}

        {message.error ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{message.error}</span>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:no-underline"
            >
              <RefreshCw className="size-3" />
              Reintentar
            </button>
          </div>
        ) : null}

        {!isUser && message.sources && message.sources.length > 0 ? (
          <SourceChips sources={message.sources} scope={scope} onSeek={onSeek} />
        ) : null}
      </div>
    </div>
  )
}

function SourceChips({
  sources,
  scope,
  onSeek
}: {
  sources: ChatSource[]
  scope: ChatScope
  onSeek?: (seconds: number) => void
}): React.JSX.Element {
  const navigate = useNavigate()
  const unique: ChatSource[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    if (scope === 'note' && source.seconds === undefined) continue
    const key = `${source.notePath}:${source.timestamp ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(source)
  }
  if (unique.length === 0) return <></>

  return (
    <div className="mt-2.5 flex flex-wrap gap-1 border-t border-line/70 pt-2">
      <span className="mr-0.5 py-0.5 text-[10px] uppercase tracking-wider text-muted">
        Fuentes
      </span>
      {unique.slice(0, 8).map((source) => (
        <button
          key={`${source.notePath}:${source.timestamp ?? ''}`}
          type="button"
          onClick={() => {
            if (scope === 'note' && source.seconds !== undefined && onSeek) {
              onSeek(source.seconds)
              return
            }
            navigate(`/note?path=${encodeURIComponent(source.notePath)}`)
          }}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] text-muted transition-colors hover:border-accent/40 hover:text-accent"
          title={source.title}
        >
          {source.timestamp ? (
            <span className="font-mono">{source.timestamp}</span>
          ) : (
            <span className="max-w-[180px] truncate">{source.title}</span>
          )}
        </button>
      ))}
    </div>
  )
}

function MarkdownContent({
  content,
  scope,
  onSeek
}: {
  content: string
  scope: ChatScope
  onSeek?: (seconds: number) => void
}): React.JSX.Element {
  const prepared =
    scope === 'note'
      ? content.replace(/\[(\d{2}):(\d{2}):(\d{2})\]/g, (_match, h, m, s) => {
          const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s)
          return `[${h}:${m}:${s}](chismosito-seek://${seconds})`
        })
      : content

  return (
    <div className="md chat-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('chismosito-seek://')) {
              const seconds = Number(href.replace('chismosito-seek://', ''))
              return (
                <button
                  type="button"
                  onClick={() => onSeek?.(seconds)}
                  className="font-mono text-[0.8em] text-accent underline underline-offset-2 hover:no-underline"
                  title="Ir a este momento del audio"
                >
                  {children}
                </button>
              )
            }
            return (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault()
                  if (href) void window.chismosito.app.openExternal(href).catch(() => undefined)
                }}
              >
                {children}
              </a>
            )
          }
        }}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  )
}
