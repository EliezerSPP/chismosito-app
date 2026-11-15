import {
  closeSync,
  existsSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync
} from 'node:fs'
import { dirname } from 'node:path'
import { ensureDir } from '../lib/fs'

export class WavSink {
  private fd: number | null = null
  private dataBytes = 0
  private finalized = false

  constructor(
    readonly path: string,
    readonly sampleRate = 16_000,
    readonly channels = 1,
    readonly bitsPerSample = 16
  ) {}

  open(): void {
    ensureDir(dirname(this.path))
    this.fd = openSync(this.path, 'w')
    this.writeHeader(0)
  }

  private writeHeader(dataBytes: number): void {
    if (this.fd === null) throw new Error('WAV no abierto')
    const blockAlign = this.channels * (this.bitsPerSample / 8)
    const byteRate = this.sampleRate * blockAlign
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + dataBytes, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(this.channels, 22)
    header.writeUInt32LE(this.sampleRate, 24)
    header.writeUInt32LE(byteRate, 28)
    header.writeUInt16LE(blockAlign, 32)
    header.writeUInt16LE(this.bitsPerSample, 34)
    header.write('data', 36)
    header.writeUInt32LE(dataBytes, 40)
    writeSync(this.fd, header, 0, header.length, 0)
  }

  append(buffer: ArrayBuffer | Uint8Array): void {
    if (this.fd === null) throw new Error('WAV no abierto')
    if (this.finalized) throw new Error('WAV ya finalizado')
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    if (bytes.byteLength === 0) return
    if (bytes.byteLength % 2 !== 0) {
      throw new Error('Bloque PCM inválido: se esperaban muestras de 16 bits')
    }
    writeSync(this.fd, bytes, 0, bytes.byteLength, 44 + this.dataBytes)
    this.dataBytes += bytes.byteLength
  }

  finalize(): { bytes: number; seconds: number } {
    if (this.fd === null) throw new Error('WAV no abierto')
    if (!this.finalized) {
      this.writeHeader(this.dataBytes)
      closeSync(this.fd)
      this.fd = null
      this.finalized = true
    }
    return {
      bytes: this.dataBytes,
      seconds: this.dataBytes / (this.sampleRate * this.channels * (this.bitsPerSample / 8))
    }
  }

  abort(): void {
    if (this.fd !== null) {
      try {
        closeSync(this.fd)
      } catch {
        // ignore
      }
      this.fd = null
    }
    if (existsSync(this.path)) {
      try {
        unlinkSync(this.path)
      } catch {
        // ignore
      }
    }
  }
}

export class ChunkFileSink {
  private fd: number | null = null
  private bytes = 0
  private finalized = false

  constructor(
    readonly partPath: string,
    readonly finalPath: string
  ) {}

  open(): void {
    ensureDir(dirname(this.partPath))
    if (existsSync(this.partPath)) unlinkSync(this.partPath)
    this.fd = openSync(this.partPath, 'w')
  }

  append(buffer: ArrayBuffer | Uint8Array): void {
    if (this.fd === null) throw new Error('Archivo no abierto')
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    if (bytes.byteLength === 0) return
    writeSync(this.fd, bytes)
    this.bytes += bytes.byteLength
  }

  finalize(): { bytes: number } {
    if (this.finalized) return { bytes: this.bytes }
    if (this.fd !== null) {
      closeSync(this.fd)
      this.fd = null
    }
    this.finalized = true
    if (existsSync(this.partPath)) renameSync(this.partPath, this.finalPath)
    return { bytes: this.bytes }
  }

  abort(): void {
    if (this.fd !== null) {
      try {
        closeSync(this.fd)
      } catch {
        // ignore
      }
      this.fd = null
    }
    if (existsSync(this.partPath)) {
      try {
        unlinkSync(this.partPath)
      } catch {
        // ignore
      }
    }
  }
}
