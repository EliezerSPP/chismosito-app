import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WavSink } from '../src/main/audio/sinks'

let dir: string | null = null

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('WavSink', () => {
  it('writes a valid 16 kHz mono PCM header and appends samples', () => {
    dir = mkdtempSync(join(tmpdir(), 'chismosito-wav-'))
    const path = join(dir, 'test.wav')
    const sink = new WavSink(path)
    sink.open()
    sink.append(new Int16Array([0, 1, -1, 32767, -32768]).buffer)
    const result = sink.finalize()

    const file = readFileSync(path)
    expect(file.toString('ascii', 0, 4)).toBe('RIFF')
    expect(file.toString('ascii', 8, 12)).toBe('WAVE')
    expect(file.readUInt32LE(24)).toBe(16_000)
    expect(file.readUInt16LE(22)).toBe(1)
    expect(file.readUInt16LE(34)).toBe(16)
    expect(file.readUInt32LE(4)).toBe(36 + 10)
    expect(file.readUInt32LE(40)).toBe(10)
    expect(file.length).toBe(44 + 10)
    expect(result.bytes).toBe(10)
    expect(result.seconds).toBeCloseTo(10 / (16_000 * 2))
  })
})
