import { app } from 'electron'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type {
  Job,
  RecordingStartInput,
  RecordingStartResult,
  RecordingStopInput
} from '@shared/types'
import type { NoteRepository } from '../notes/repository'
import type { JobRunner } from '../jobs/runner'
import { ChunkFileSink, WavSink } from './sinks'
import { ensureDir } from '../lib/fs'
import { log } from '../lib/logger'

interface ActiveSession {
  id: string
  baseName: string
  notePath: string
  audioPath: string
  partPath: string
  tmpDir: string
  startedAt: string
  language: string
  hasMic: boolean
  hasSystem: boolean
  webm: ChunkFileSink
  mic: WavSink | null
  system: WavSink | null
  micWavPath: string | null
  systemWavPath: string | null
  webmBytes: number
}

export class RecordingSessionManager {
  private sessions = new Map<string, ActiveSession>()

  constructor(
    private readonly notes: NoteRepository,
    private readonly jobs: JobRunner
  ) {}

  isRecording(id?: string): boolean {
    return id ? this.sessions.has(id) : this.sessions.size > 0
  }

  activeIds(): string[] {
    return [...this.sessions.keys()]
  }

  async start(input: RecordingStartInput): Promise<RecordingStartResult> {
    if (!input.hasMic && !input.hasSystem) {
      throw new Error('Selecciona al menos una fuente de audio')
    }
    if (this.sessions.size > 0) throw new Error('Ya hay una grabación en curso')

    const id = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const allocated = await this.notes.allocate(input.startedAt)
    const tmpDir = join(app.getPath('userData'), 'tmp', 'recordings', id)
    ensureDir(tmpDir)

    const webm = new ChunkFileSink(allocated.partPath, allocated.audioPath)
    const micWavPath = input.hasMic ? join(tmpDir, 'mic.wav') : null
    const systemWavPath = input.hasSystem ? join(tmpDir, 'system.wav') : null
    const mic = micWavPath ? new WavSink(micWavPath) : null
    const system = systemWavPath ? new WavSink(systemWavPath) : null

    try {
      webm.open()
      mic?.open()
      system?.open()
    } catch (error) {
      webm.abort()
      mic?.abort()
      system?.abort()
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }

    const session: ActiveSession = {
      id,
      baseName: allocated.baseName,
      notePath: allocated.notePath,
      audioPath: allocated.audioPath,
      partPath: allocated.partPath,
      tmpDir,
      startedAt: input.startedAt,
      language: input.language,
      hasMic: input.hasMic,
      hasSystem: input.hasSystem,
      webm,
      mic,
      system,
      micWavPath,
      systemWavPath,
      webmBytes: 0
    }
    this.sessions.set(id, session)
    log.info('Grabación iniciada', {
      id,
      notePath: allocated.notePath,
      hasMic: input.hasMic,
      hasSystem: input.hasSystem
    })

    return {
      id,
      baseName: allocated.baseName,
      notePath: allocated.notePath,
      audioPath: allocated.audioPath,
      micWavPath,
      systemWavPath
    }
  }

  sendWebmChunk(id: string, chunk: ArrayBuffer): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.webm.append(chunk)
    session.webmBytes += chunk.byteLength
  }

  sendPcmChunk(id: string, track: 'mic' | 'system', chunk: ArrayBuffer): void {
    const session = this.sessions.get(id)
    if (!session) return
    const sink = track === 'mic' ? session.mic : session.system
    if (!sink) return
    sink.append(chunk)
  }

  async stop(input: RecordingStopInput): Promise<Job> {
    const session = this.sessions.get(input.id)
    if (!session) throw new Error('La grabación ya no está activa')

    const webmResult = session.webm.finalize()
    const micResult = session.mic?.finalize() ?? null
    const systemResult = session.system?.finalize() ?? null
    this.sessions.delete(session.id)

    if (webmResult.bytes === 0 && existsSync(session.audioPath)) {
      await rm(session.audioPath, { force: true }).catch(() => undefined)
    }

    const audioFileName = webmResult.bytes > 0 ? basename(session.audioPath) : null
    const durationSeconds = Math.max(0, Math.round(input.durationSeconds))

    await this.notes.createStub({
      notePath: session.notePath,
      baseName: session.baseName,
      audioFileName,
      date: session.startedAt,
      durationSeconds,
      language: session.language
    })

    const micUsable = Boolean(
      session.micWavPath && micResult && micResult.bytes > 44 && input.micPeak > 0.0002
    )
    const systemUsable = Boolean(
      session.systemWavPath &&
        systemResult &&
        systemResult.bytes > 44 &&
        input.systemPeak > 0.0002
    )

    if (!micUsable && !systemUsable) {
      log.warn('Grabación sin señal detectable', {
        micPeak: input.micPeak,
        systemPeak: input.systemPeak,
        micBytes: micResult?.bytes,
        systemBytes: systemResult?.bytes
      })
    }

    const job = this.jobs.enqueue({
      id: session.id,
      baseName: session.baseName,
      notePath: session.notePath,
      audioPath: session.audioPath,
      micWavPath: micUsable ? session.micWavPath : null,
      systemWavPath: systemUsable ? session.systemWavPath : null,
      durationSeconds,
      language: session.language,
      hasMic: Boolean(micUsable),
      hasSystem: Boolean(systemUsable),
      meetingDate: session.startedAt
    })

    log.info('Grabación detenida', {
      id: session.id,
      durationSeconds,
      webmBytes: webmResult.bytes,
      micSeconds: micResult?.seconds,
      systemSeconds: systemResult?.seconds
    })
    return job
  }

  async cancel(id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    session.webm.abort()
    session.mic?.abort()
    session.system?.abort()
    await rm(session.tmpDir, { recursive: true, force: true }).catch(() => undefined)
    await rm(session.audioPath, { force: true }).catch(() => undefined)
    await rm(session.partPath, { force: true }).catch(() => undefined)
    log.info('Grabación cancelada', id)
  }

  async abortAll(): Promise<void> {
    for (const id of this.activeIds()) {
      await this.cancel(id)
    }
  }
}
