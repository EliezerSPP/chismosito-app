import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Headphones,
  Loader2,
  Mic,
  Settings2,
  Square,
  Volume2
} from 'lucide-react'
import type { AppSettings } from '@shared/types'
import { useAppStore } from '../store'
import { recorder } from '../lib/recorder'
import { errorMessage } from '../lib/errors'
import { dayjs, formatElapsed } from '../lib/format'
import { cn } from '../lib/cn'
import { LevelMeter } from '../components/LevelMeter'
import { SetupChecklist } from '../components/SetupChecklist'
import { JobRow } from '../components/JobRow'
import { NoteRow } from '../components/NoteRow'
import { EmptyState } from '../components/EmptyState'
import { ConfirmDialog } from '../components/ConfirmDialog'

export function RecordPage(): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const whisper = useAppStore((state) => state.whisper)
  const env = useAppStore((state) => state.env)
  const notes = useAppStore((state) => state.notes)
  const jobs = useAppStore((state) => state.jobs)
  const recording = useAppStore((state) => state.recording)
  const setSettings = useAppStore((state) => state.setSettings)
  const pushToast = useAppStore((state) => state.pushToast)
  const navigate = useNavigate()
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  if (!settings) {
    return <PageSkeleton />
  }

  const busy = recording.phase !== 'idle'
  const isRecording = recording.phase === 'recording'
  const activeJobs = jobs.filter((job) => !['done', 'cancelled'].includes(job.stage))
  const recent = notes.slice(0, 3)

  const handleMainAction = async (): Promise<void> => {
    if (isRecording) {
      await recorder.stop()
      return
    }
    if (recording.phase !== 'idle') return
    if (!whisper?.cpuBinary) {
      pushToast('error', 'Falta el ejecutable de whisper.cpp. Reinstala la aplicación.')
      return
    }
    if (!whisper.model.present) {
      pushToast('error', 'Descarga el modelo de transcripción antes de grabar.')
      navigate('/settings?section=transcription')
      return
    }
    const latest = await window.chismosito.settings.get()
    await recorder.start(latest)
  }

  const updateSource = async (key: 'recordMic' | 'recordSystem'): Promise<void> => {
    if (!settings || busy) return
    try {
      const patch: Partial<AppSettings> = { [key]: !settings[key] }
      const next = await window.chismosito.settings.update(patch)
      setSettings(next)
    } catch (error) {
      pushToast('error', errorMessage(error))
    }
  }

  const retryJob = async (id: string): Promise<void> => {
    try {
      await window.chismosito.jobs.retry(id)
      pushToast('info', 'Reintentando el procesamiento…')
    } catch (error) {
      pushToast('error', errorMessage(error))
    }
  }

  const cancelJob = async (id: string): Promise<void> => {
    try {
      await window.chismosito.jobs.cancel(id)
    } catch (error) {
      pushToast('error', errorMessage(error))
    }
  }

  const jobTitle = (notePath: string, meetingDate: string): string => {
    const note = notes.find((entry) => entry.path === notePath)
    if (note) return note.title
    return `Reunión ${dayjs(meetingDate).format('D MMM, HH:mm')}`
  }

  const modelReady = Boolean(whisper?.model.present)
  const llmReady = Boolean(env?.llm.configured)

  return (
    <div className="mx-auto w-full max-w-5xl px-7 py-8 lg:px-10 lg:py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
            Chismosito
          </p>
          <h1 className="font-serif text-4xl leading-tight">Nueva reunión</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Captura tu micrófono y el audio de tu equipo. Al detener, transcribimos localmente y
            preparamos la nota.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {settings.hotkey ? (
            <span className="chip hidden sm:inline-flex" title="Atajo global para iniciar o detener">
              {settings.hotkey.replace('CommandOrControl', 'Ctrl')}
            </span>
          ) : null}
          <Link to="/settings?section=audio" className="btn-secondary h-9 text-xs">
            <Settings2 className="size-3.5" />
            Audio
          </Link>
        </div>
      </header>

      <section
        className={cn(
          'relative overflow-hidden rounded-[32px] border border-line bg-surface',
          isRecording && 'border-accent/30'
        )}
        style={{ boxShadow: 'var(--shadow)' }}
      >
        <div
          className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full opacity-60 blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--accent-soft), transparent 70%)' }}
        />
        <div className="relative grid gap-8 p-7 md:grid-cols-[280px_1fr] md:p-9">
          <div className="flex flex-col items-center justify-center gap-5">
            <div className="flex items-center gap-2 rounded-full border border-line bg-surface2/70 px-3 py-1 text-[11px] text-muted">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  isRecording ? 'animate-pulse bg-accent' : busy ? 'bg-gold' : 'bg-olive'
                )}
              />
              {recording.phase === 'starting'
                ? 'Preparando audio'
                : recording.phase === 'stopping'
                  ? 'Cerrando archivos'
                  : isRecording
                    ? 'Grabando'
                    : 'Listo para grabar'}
            </div>

            <div className="relative flex size-44 items-center justify-center">
              <div className="absolute inset-0 rounded-full border border-dashed border-line" />
              {isRecording ? <div className="recording-pulse absolute inset-5 rounded-full" /> : null}
              <button
                onClick={() => void handleMainAction()}
                disabled={recording.phase === 'starting' || recording.phase === 'stopping'}
                className={cn(
                  'relative z-10 flex size-36 items-center justify-center rounded-full text-white transition-all duration-200',
                  'shadow-[0_18px_40px_rgba(196,87,61,0.28)] hover:scale-[1.02] active:scale-[0.99]',
                  isRecording ? 'bg-ink hover:bg-ink/90' : 'bg-accent hover:bg-accent-strong',
                  (recording.phase === 'starting' || recording.phase === 'stopping') &&
                    'cursor-wait opacity-80'
                )}
                aria-label={isRecording ? 'Detener grabación' : 'Iniciar grabación'}
              >
                {recording.phase === 'starting' || recording.phase === 'stopping' ? (
                  <Loader2 className="size-10 animate-spin" />
                ) : isRecording ? (
                  <Square className="size-9 fill-current" />
                ) : (
                  <Mic className="size-11" />
                )}
              </button>
            </div>

            <div className="text-center">
              <div className="font-serif text-[52px] leading-none tabular-nums">
                {formatElapsed(recording.elapsedSeconds)}
              </div>
              <p className="mt-2 text-[11px] text-muted">
                {isRecording
                  ? 'Habla con naturalidad. Todo se procesa en tu equipo.'
                  : busy
                    ? 'Un momento…'
                    : 'Pulsa el botón para empezar'}
              </p>
            </div>

            {isRecording ? (
              <button
                onClick={() => setConfirmDiscard(true)}
                className="text-[11px] text-muted underline-offset-4 hover:text-ink hover:underline"
              >
                Descartar esta grabación
              </button>
            ) : (
              <p className="flex items-center gap-1.5 text-[11px] text-muted">
                <Headphones className="size-3.5" />
                Usa audífonos para evitar eco
              </p>
            )}
          </div>

          <div className="flex min-w-0 flex-col justify-center gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <LevelMeter
                label="Tú"
                hint={settings.recordMic ? 'micrófono' : 'desactivado'}
                level={recording.micLevel}
                muted={!settings.recordMic}
                tone="accent"
              />
              <LevelMeter
                label="Otros"
                hint={settings.recordSystem ? 'audio del sistema' : 'desactivado'}
                level={recording.systemLevel}
                muted={!settings.recordSystem}
                tone="olive"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <SourceToggle
                active={settings.recordMic}
                disabled={busy}
                icon={<Mic className="size-3.5" />}
                title="Micrófono"
                subtitle="Tu voz"
                onClick={() => void updateSource('recordMic')}
              />
              <SourceToggle
                active={settings.recordSystem}
                disabled={busy}
                icon={<Volume2 className="size-3.5" />}
                title="Audio del sistema"
                subtitle="Llamadas y videos"
                onClick={() => void updateSource('recordSystem')}
              />
            </div>

            <div className="rounded-2xl border border-line bg-surface2/50 px-4 py-3 text-xs leading-relaxed text-muted">
              <p>
                <span className="font-medium text-ink">Yo</span> se transcribe desde tu micrófono;{' '}
                <span className="font-medium text-ink">Otros</span> desde el audio de la
                computadora. Al terminar verás resumen, decisiones y acciones.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className={cn('chip', modelReady ? 'text-olive' : 'text-gold')}>
                {modelReady ? 'Modelo local listo' : 'Modelo pendiente'}
              </span>
              <span className={cn('chip', llmReady ? 'text-olive' : 'text-gold')}>
                {llmReady ? 'Resumen automático listo' : 'Falta API key'}
              </span>
              {!modelReady ? (
                <button
                  onClick={() => navigate('/settings?section=transcription')}
                  className="text-[11px] font-medium text-accent hover:underline"
                >
                  Descargar modelo →
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {recording.error ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-300" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                No se pudo iniciar la grabación
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-red-700/90 dark:text-red-300/90">
                {recording.error}
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-medium">
                <button
                  onClick={() => void window.chismosito.app.openExternal('ms-settings:privacy-microphone')}
                  className="text-red-700 underline hover:no-underline dark:text-red-300"
                >
                  Abrir privacidad del micrófono
                </button>
                <button
                  onClick={() => void window.chismosito.app.openExternal('ms-settings:sound')}
                  className="text-red-700 underline hover:no-underline dark:text-red-300"
                >
                  Abrir configuración de sonido
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-6">
        <SetupChecklist />
      </div>

      {activeJobs.length > 0 ? (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-xl">En proceso</h2>
            <span className="text-[11px] text-muted">
              {activeJobs.length} {activeJobs.length === 1 ? 'trabajo' : 'trabajos'}
            </span>
          </div>
          <div className="space-y-2">
            {activeJobs.slice(0, 5).map((job) => (
              <JobRow
                key={job.id}
                job={job}
                noteTitle={jobTitle(job.notePath, job.meetingDate)}
                onRetry={() => void retryJob(job.id)}
                onCancel={() => void cancelJob(job.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-xl">Recientes</h2>
          <Link
            to="/library"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
          >
            Ver toda la biblioteca <ArrowRight className="size-3" />
          </Link>
        </div>
        {recent.length > 0 ? (
          <div className="divide-y divide-line rounded-2xl border border-line bg-surface px-2">
            {recent.map((note) => (
              <NoteRow key={note.path} note={note} compact />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Tu primera nota empieza aquí"
            description="Graba una reunión y Chismosito guardará el resumen, las decisiones y las acciones junto a la transcripción completa."
          />
        )}
      </section>

      <ConfirmDialog
        open={confirmDiscard}
        title="¿Descartar esta grabación?"
        description="Se perderán el audio y la transcripción de esta reunión. Esta acción no se puede deshacer."
        confirmLabel="Descartar"
        destructive
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => void recorder.cancel()}
      />
    </div>
  )
}

function SourceToggle({
  active,
  disabled,
  icon,
  title,
  subtitle,
  onClick
}: {
  active: boolean
  disabled: boolean
  icon: React.ReactNode
  title: string
  subtitle: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex min-w-[170px] flex-1 items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        active
          ? 'border-accent/40 bg-accent-soft/60 text-accent'
          : 'border-line bg-surface text-muted hover:bg-surface2'
      )}
    >
      <span className={cn('flex size-8 items-center justify-center rounded-full', active ? 'bg-surface' : 'bg-surface2')}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold">{title}</span>
        <span className="block truncate text-[10px] text-muted">{subtitle}</span>
      </span>
      <span
        className={cn(
          'ml-auto flex h-4 w-7 items-center rounded-full p-0.5 transition-colors',
          active ? 'bg-accent' : 'bg-line'
        )}
      >
        <span
          className={cn(
            'size-3 rounded-full bg-white transition-transform',
            active && 'translate-x-3'
          )}
        />
      </span>
    </button>
  )
}

function PageSkeleton(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="shimmer h-8 w-56 rounded-xl" />
      <div className="shimmer mt-4 h-4 w-80 rounded-lg" />
      <div className="shimmer mt-8 h-[320px] rounded-[32px]" />
    </div>
  )
}
