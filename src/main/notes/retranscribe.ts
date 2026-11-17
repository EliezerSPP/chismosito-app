import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { WavSink } from '../audio/sinks'
import { ensureDir } from '../lib/fs'
import { log } from '../lib/logger'

const SAMPLE_RATE = 16_000
const MAX_SAMPLES = SAMPLE_RATE * 3600 * 6

interface Session {
  id: string
  notePath: string
  dir: string
  wavPath: string
  sink: WavSink
  samples: number
}

/**
 * Recibe el audio ya decodificado (16 kHz mono int16) que manda el renderer y
 * lo deja en un WAV temporal para re-transcribir. El renderer decodifica el
 * webm/opus porque el proceso principal no tiene decodificador de Opus y
 * whisper.cpp solo lee WAV/MP3/FLAC.
 */
export class RetranscribeSessions {
  private sessions = new Map<string, Session>()

  begin(notePath: string, samples: number): { id: string } {
    const total = Math.floor(Number(samples))
    if (!Number.isFinite(total) || total < SAMPLE_RATE) {
      throw new Error('Audio demasiado corto para re-transcribir')
    }
    if (total > MAX_SAMPLES) {
      throw new Error('El audio es demasiado largo para re-transcribir (máximo 6 horas)')
    }

    const id = randomUUID()
    const dir = join(app.getPath('userData'), 'tmp', 'retranscribe', id)
    ensureDir(dir)
    const wavPath = join(dir, 'audio.wav')
    const sink = new WavSink(wavPath, SAMPLE_RATE, 1, 16)
    sink.open()
    this.sessions.set(id, { id, notePath, dir, wavPath, sink, samples: total })
    return { id }
  }

  append(id: string, chunk: ArrayBuffer | Uint8Array): void {
    const session = this.sessions.get(id)
    if (!session) throw new Error('La re-transcripción ya no está activa')
    session.sink.append(chunk)
  }

  finish(id: string): { wavPath: string; notePath: string; dir: string } {
    const session = this.sessions.get(id)
    if (!session) throw new Error('La re-transcripción ya no está activa')
    const result = session.sink.finalize()
    this.sessions.delete(id)
    if (!existsSync(session.wavPath) || result.bytes <= 44) {
      throw new Error('No se pudo preparar el audio para re-transcribir')
    }
    return { wavPath: session.wavPath, notePath: session.notePath, dir: session.dir }
  }

  async cancel(id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    await rm(session.dir, { recursive: true, force: true }).catch((error) =>
      log.warn('No se pudo borrar el audio temporal de re-transcripción', error)
    )
  }
}

let instance: RetranscribeSessions | null = null

export function retranscribeSessions(): RetranscribeSessions {
  if (!instance) instance = new RetranscribeSessions()
  return instance
}
