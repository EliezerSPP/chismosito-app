import { app } from 'electron'
import { existsSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { net } from 'electron'
import { spawn } from 'node:child_process'
import {
  CUDA_URL,
  CUDA_ZIP_NAME,
  MODEL_EXPECTED_BYTES,
  MODEL_FILE_NAME,
  MODEL_URL,
  VAD_FILE_NAME
} from '@shared/constants'
import type {
  DownloadKind,
  DownloadProgress,
  WhisperStatus
} from '@shared/types'
import type { SettingsStore } from '../settings'
import { ensureDir, formatBytes } from '../lib/fs'
import { log } from '../lib/logger'

type ProgressListener = (progress: DownloadProgress) => void

const IDLE: DownloadProgress = {
  kind: 'model',
  status: 'idle',
  receivedBytes: 0,
  totalBytes: 0,
  percent: 0
}

export class WhisperManager {
  private progress: DownloadProgress = { ...IDLE }
  private abortController: AbortController | null = null
  private listener: ProgressListener | null = null

  constructor(private readonly settings: SettingsStore) {}

  onProgress(listener: ProgressListener): void {
    this.listener = listener
  }

  private emit(progress: DownloadProgress): void {
    this.progress = progress
    this.listener?.(progress)
  }

  private whisperRoot(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'whisper')
      : join(app.getAppPath(), 'resources', 'whisper')
  }

  private resourcesWhisperDir(): string {
    return join(this.whisperRoot(), 'win32-x64', 'Release')
  }

  cpuCliPath(): string {
    return join(this.resourcesWhisperDir(), 'whisper-cli.exe')
  }

  /** Modelo Silero VAD incluido con la app; se usa para ignorar silencios. */
  vadModelPath(): string {
    return join(this.whisperRoot(), VAD_FILE_NAME)
  }

  hasVad(): boolean {
    return existsSync(this.vadModelPath())
  }

  cudaDir(): string {
    return join(app.getPath('userData'), 'whisper-cuda')
  }

  cudaCliPath(): string | null {
    const direct = join(this.cudaDir(), 'Release', 'whisper-cli.exe')
    if (existsSync(direct)) return direct
    const flat = join(this.cudaDir(), 'whisper-cli.exe')
    if (existsSync(flat)) return flat
    return null
  }

  hasCpu(): boolean {
    return existsSync(this.cpuCliPath())
  }

  hasCuda(): boolean {
    return this.cudaCliPath() !== null
  }

  activeDevice(): 'cpu' | 'cuda' {
    const setting = this.settings.get().whisperDevice
    if (setting === 'cpu') return 'cpu'
    if (setting === 'cuda') return this.hasCuda() ? 'cuda' : 'cpu'
    return this.hasCuda() ? 'cuda' : 'cpu'
  }

  modelPath(): string {
    const custom = this.settings.get().whisperModelPath
    return custom && custom.trim() ? custom.trim() : join(app.getPath('userData'), 'models', MODEL_FILE_NAME)
  }

  async modelInfo(): Promise<WhisperStatus['model']> {
    const path = this.modelPath()
    const custom = this.settings.get().whisperModelPath
    if (!existsSync(path)) {
      return {
        present: false,
        path,
        name: path.split(/[\\/]/).pop() ?? MODEL_FILE_NAME,
        sizeBytes: 0,
        expectedBytes: MODEL_EXPECTED_BYTES,
        source: custom ? 'custom' : 'missing'
      }
    }
    const info = await stat(path)
    return {
      present: true,
      path,
      name: path.split(/[\\/]/).pop() ?? MODEL_FILE_NAME,
      sizeBytes: info.size,
      expectedBytes: custom ? info.size : MODEL_EXPECTED_BYTES,
      source: custom ? 'custom' : 'managed'
    }
  }

  async status(): Promise<WhisperStatus> {
    return {
      cpuBinary: this.hasCpu(),
      cudaBinary: this.hasCuda(),
      activeDevice: this.activeDevice(),
      model: await this.modelInfo()
    }
  }

  downloadProgress(): DownloadProgress {
    return { ...this.progress }
  }

  async downloadModel(): Promise<WhisperStatus> {
    if (this.abortController) throw new Error('Ya hay una descarga en curso')
    const target = this.modelPath()
    if (this.settings.get().whisperModelPath && existsSync(target)) {
      return this.status()
    }
    ensureDir(dirname(target))
    const part = `${target}.part`
    const controller = new AbortController()
    this.abortController = controller

    try {
      let offset = 0
      if (existsSync(part)) offset = (await stat(part)).size
      if (offset >= MODEL_EXPECTED_BYTES) {
        await rename(part, target)
        return this.status()
      }

      this.emit({
        kind: 'model',
        status: 'downloading',
        receivedBytes: offset,
        totalBytes: MODEL_EXPECTED_BYTES,
        percent: Math.floor((offset / MODEL_EXPECTED_BYTES) * 100)
      })

      const headers: Record<string, string> = {}
      if (offset > 0) headers.Range = `bytes=${offset}-`
      const response = await net.fetch(MODEL_URL, {
        headers,
        signal: controller.signal,
        redirect: 'follow'
      })
      if (!response.ok || !response.body) {
        throw new Error(`No se pudo descargar el modelo (HTTP ${response.status})`)
      }
      const resumed = response.status === 206
      if (!resumed && offset > 0) offset = 0
      const contentLength = Number(response.headers.get('content-length') ?? 0)
      const total = contentLength > 0 ? offset + contentLength : MODEL_EXPECTED_BYTES

      let received = offset
      let lastEmit = 0
      const counter = new TransformCounter((bytes) => {
        received += bytes
        const now = Date.now()
        if (now - lastEmit > 200) {
          lastEmit = now
          this.emit({
            kind: 'model',
            status: 'downloading',
            receivedBytes: received,
            totalBytes: total,
            percent: Math.min(100, Math.floor((received / total) * 100))
          })
        }
      })

      const stream = Readable.fromWeb(response.body as never)
      await pipeline(stream, counter, createWriteStream(part, { flags: resumed || offset > 0 ? 'a' : 'w' }))
      await rename(part, target)

      if (!existsSync(target)) throw new Error('El modelo no se guardó correctamente')
      const finalSize = (await stat(target)).size
      if (!this.settings.get().whisperModelPath && finalSize !== MODEL_EXPECTED_BYTES) {
        await rm(target, { force: true })
        throw new Error(
          `Tamaño inesperado del modelo (${formatBytes(finalSize)}). Se esperaban ${formatBytes(
            MODEL_EXPECTED_BYTES
          )}.`
        )
      }

      this.emit({
        kind: 'model',
        status: 'done',
        receivedBytes: finalSize,
        totalBytes: finalSize,
        percent: 100
      })
      log.info('Modelo whisper descargado', target)
      return this.status()
    } catch (error) {
      const aborted = controller.signal.aborted
      this.emit({
        kind: 'model',
        status: aborted ? 'cancelled' : 'error',
        receivedBytes: this.progress.receivedBytes,
        totalBytes: this.progress.totalBytes,
        percent: this.progress.percent,
        message: aborted ? 'Descarga cancelada' : (error as Error).message
      })
      if (!aborted) log.error('Error descargando modelo', error)
      throw error
    } finally {
      this.abortController = null
    }
  }

  async downloadCuda(): Promise<WhisperStatus> {
    if (this.abortController) throw new Error('Ya hay una descarga en curso')
    const controller = new AbortController()
    this.abortController = controller
    const tmpZip = join(app.getPath('temp'), CUDA_ZIP_NAME)
    const dest = this.cudaDir()

    try {
      this.emit({
        kind: 'cuda',
        status: 'downloading',
        receivedBytes: 0,
        totalBytes: 0,
        percent: 0
      })
      const response = await net.fetch(CUDA_URL, {
        signal: controller.signal,
        redirect: 'follow'
      })
      if (!response.ok || !response.body) {
        throw new Error(`No se pudo descargar el paquete CUDA (HTTP ${response.status})`)
      }
      const total = Number(response.headers.get('content-length') ?? 0)
      let received = 0
      let lastEmit = 0
      const counter = new TransformCounter((bytes) => {
        received += bytes
        const now = Date.now()
        if (now - lastEmit > 250) {
          lastEmit = now
          this.emit({
            kind: 'cuda',
            status: 'downloading',
            receivedBytes: received,
            totalBytes: total,
            percent: total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0
          })
        }
      })
      await pipeline(
        Readable.fromWeb(response.body as never),
        counter,
        createWriteStream(tmpZip, { flags: 'w' })
      )

      this.emit({
        kind: 'cuda',
        status: 'extracting',
        receivedBytes: received,
        totalBytes: total || received,
        percent: total ? 100 : 0,
        message: 'Extrayendo paquete CUDA…'
      })
      await rm(dest, { recursive: true, force: true })
      ensureDir(dest)
      await extractZip(tmpZip, dest)
      await rm(tmpZip, { force: true })
      if (!this.hasCuda()) throw new Error('El paquete CUDA no contiene whisper-cli.exe')
      this.emit({
        kind: 'cuda',
        status: 'done',
        receivedBytes: received,
        totalBytes: received,
        percent: 100
      })
      return this.status()
    } catch (error) {
      const aborted = controller.signal.aborted
      this.emit({
        kind: 'cuda',
        status: aborted ? 'cancelled' : 'error',
        receivedBytes: this.progress.receivedBytes,
        totalBytes: this.progress.totalBytes,
        percent: this.progress.percent,
        message: aborted ? 'Descarga cancelada' : (error as Error).message
      })
      if (!aborted) log.error('Error descargando CUDA', error)
      throw error
    } finally {
      this.abortController = null
    }
  }

  cancelDownload(): void {
    this.abortController?.abort()
  }
}

class TransformCounter extends Transform {
  constructor(private readonly onBytes: (bytes: number) => void) {
    super()
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.onBytes(chunk.length)
    this.push(chunk)
    callback()
  }
}

async function extractZip(zipPath: string, destination: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('tar', ['-xf', zipPath, '-C', destination], {
      windowsHide: true
    })
    let errorText = ''
    child.stderr?.on('data', (chunk) => {
      errorText += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`No se pudo extraer el paquete: ${errorText.trim() || `código ${code}`}`))
    })
  })
}

export async function findCudaCli(root: string): Promise<string | null> {
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.shift() as string
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === 'whisper-cli.exe') return full
      if (entry.isDirectory()) queue.push(full)
    }
  }
  return null
}
