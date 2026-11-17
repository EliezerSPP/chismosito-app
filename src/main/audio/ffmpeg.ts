import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import { ensureDir } from '../lib/fs'
import { log } from '../lib/logger'

/**
 * Resuelve la ruta de FFmpeg tanto en desarrollo como en la app empaquetada.
 * En producción el binario vive en `app.asar.unpacked` (ver electron-builder.yml).
 */
export function ffmpegPath(): string {
  const configured = process.env.CHISMOSITO_FFMPEG_PATH?.trim()
  if (configured) {
    if (!existsSync(configured)) throw new Error(`No se encontró FFmpeg en ${configured}`)
    return configured
  }

  if (!ffmpegStatic) {
    throw new Error('FFmpeg no está disponible en esta instalación de Chismosito.')
  }

  const resolved = app.isPackaged
    ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
    : ffmpegStatic

  if (!existsSync(resolved)) {
    throw new Error(`No se encontró FFmpeg en ${resolved}`)
  }
  return resolved
}

export interface WebmToWavOptions {
  signal?: AbortSignal
  sampleRate?: number
  channels?: number
}

/**
 * Decodifica un WebM/Opus a un WAV PCM mono de 16 kHz, el formato que consume
 * whisper.cpp. FFmpeg se ejecuta como proceso separado para no bloquear el
 * proceso principal de Electron.
 */
export async function webmToWav(
  inputPath: string,
  outputPath: string,
  options: WebmToWavOptions = {}
): Promise<void> {
  if (!existsSync(inputPath)) throw new Error('No se encontró el audio a convertir')

  const sampleRate = options.sampleRate ?? 16_000
  const channels = options.channels ?? 1
  ensureDir(dirname(outputPath))

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    String(channels),
    '-ar',
    String(sampleRate),
    '-c:a',
    'pcm_s16le',
    outputPath
  ]
  log.info('ffmpeg', args.join(' '))

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true })
    let stderr = ''
    let killedForAbort = false

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
      if (stderr.length > 16_000) stderr = stderr.slice(-8_000)
    })

    const abort = (): void => {
      if (child.killed || killedForAbort) return
      killedForAbort = true
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true
        }).on('error', () => child.kill())
      } else {
        child.kill('SIGKILL')
      }
    }

    if (options.signal?.aborted) abort()
    options.signal?.addEventListener('abort', abort, { once: true })

    child.on('error', (error) => {
      options.signal?.removeEventListener('abort', abort)
      reject(new Error(`No se pudo ejecutar FFmpeg: ${error.message}`))
    })

    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', abort)
      if (killedForAbort || options.signal?.aborted) {
        reject(new Error('Conversión de audio cancelada'))
        return
      }
      if (code !== 0) {
        const tail = stderr.trim().split(/\r?\n/).slice(-6).join('\n')
        reject(new Error(`FFmpeg terminó con código ${code}${tail ? `:\n${tail}` : ''}`))
        return
      }
      if (!existsSync(outputPath)) {
        reject(new Error('FFmpeg no generó el archivo de audio'))
        return
      }
      resolvePromise()
    })
  })
}

/**
 * Crea un WAV temporal a partir del audio de una nota, ejecuta `run` y limpia
 * siempre el directorio temporal.
 */
export async function withMixWav<T>(
  webmPath: string,
  signal: AbortSignal | undefined,
  run: (wavPath: string) => Promise<T>
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'chismosito-mix-'))
  try {
    const wavPath = join(dir, 'mix.wav')
    await webmToWav(webmPath, wavPath, { signal })
    return await run(wavPath)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
