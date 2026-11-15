import { afterAll, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  shell: { trashItem: async () => undefined, showItemInFolder: () => undefined }
}))

import { NoteRepository } from '../src/main/notes/repository'
import { buildNoteMarkdown } from '../src/main/notes/format'
import type { SettingsStore } from '../src/main/settings'

const base = mkdtempSync(join(tmpdir(), 'chismosito-folders-'))
let counter = 0

afterAll(() => {
  rmSync(base, { recursive: true, force: true })
})

function makeRepo(): { repo: NoteRepository; root: string } {
  counter += 1
  const root = join(base, `notes-${counter}`)
  mkdirSync(root, { recursive: true })
  const settings = {
    get: () => ({ notesDir: root })
  } as unknown as SettingsStore
  return { repo: new NoteRepository(settings), root }
}

function writeNote(
  root: string,
  folder: string,
  name: string,
  options: { audio?: boolean; suggestedFolder?: string; confidence?: number } = {}
): string {
  const dir = folder ? join(root, folder) : root
  mkdirSync(dir, { recursive: true })
  const audio = options.audio ? `${name}.webm` : null
  const date = '2026-11-14T15:30:00-06:00'
  const markdown = buildNoteMarkdown({
    title: `Nota ${name}`,
    date,
    durationSeconds: 60,
    language: 'es',
    audio,
    folder,
    suggestedFolder: options.suggestedFolder ?? null,
    suggestedFolderConfidence: options.confidence ?? null,
    tags: [],
    status: 'complete',
    llm: 'modelo',
    summary: {
      summary_bullets: ['Resumen'],
      decisions: [],
      action_items: []
    },
    transcript: '[00:00:01] **Yo:** Hola.',
    createdAt: date,
    updatedAt: date
  })
  const notePath = join(dir, `${name}.md`)
  writeFileSync(notePath, markdown, 'utf8')
  if (audio) writeFileSync(join(dir, audio), 'audio de prueba')
  return notePath
}

describe('gestión de carpetas', () => {
  it('crea carpetas anidadas y rechaza duplicados sin distinguir mayúsculas', async () => {
    const { repo, root } = makeRepo()
    await repo.createFolder('Producto/Q4')
    expect(existsSync(join(root, 'Producto', 'Q4'))).toBe(true)
    expect(await repo.folders()).toEqual(['Producto', 'Producto/Q4'])
    await expect(repo.createFolder('producto/q4')).rejects.toThrow(/ya existe/i)
  })

  it('renombra solo el último segmento y actualiza notas, audios y sugerencias', async () => {
    const { repo, root } = makeRepo()
    const notePath = writeNote(root, 'Producto/Q4', '2026-11-14-15-30', {
      audio: true,
      suggestedFolder: 'Producto/Q4',
      confidence: 0.9
    })
    const rootNote = writeNote(root, '', '2026-11-15-10-00', {
      suggestedFolder: 'Producto/Q4',
      confidence: 0.8
    })

    const moves: Array<{ oldPath: string; newPath: string }> = []
    repo.onMoved((oldPath, newPath) => moves.push({ oldPath, newPath }))

    const result = await repo.renameFolder('Producto/Q4', 'Trimestre')
    expect(result.movedNotes).toBe(1)

    const newPath = join(root, 'Producto', 'Trimestre', '2026-11-14-15-30.md')
    expect(existsSync(newPath)).toBe(true)
    expect(existsSync(notePath)).toBe(false)
    expect(existsSync(join(root, 'Producto', 'Trimestre', '2026-11-14-15-30.webm'))).toBe(
      true
    )
    expect((await repo.get(newPath))?.folder).toBe('Producto/Trimestre')
    expect((await repo.get(rootNote))?.suggestedFolder).toBe('Producto/Trimestre')
    expect(moves).toEqual([{ oldPath: notePath, newPath }])

    await expect(repo.renameFolder('Producto/Trimestre', 'Otra/Cosa')).rejects.toThrow(
      /barras/i
    )
  })

  it('elimina una carpeta moviendo todas sus notas a Sin clasificar', async () => {
    const { repo, root } = makeRepo()
    writeNote(root, 'Producto/Q4', '2026-11-14-15-30', { audio: true })
    writeNote(root, 'Producto/Q4', '2026-11-14-16-00', { audio: true })
    const rootNote = writeNote(root, '', '2026-11-15-10-00', {
      suggestedFolder: 'Producto/Q4',
      confidence: 0.8
    })

    const result = await repo.removeFolder('Producto')
    expect(result).toEqual({ movedNotes: 2, removedFolders: 2 })
    expect(existsSync(join(root, 'Producto'))).toBe(false)
    expect(existsSync(join(root, '2026-11-14-15-30.md'))).toBe(true)
    expect(existsSync(join(root, '2026-11-14-16-00.webm'))).toBe(true)
    expect((await repo.get(join(root, '2026-11-14-15-30.md')))?.folder).toBe('')
    expect((await repo.get(rootNote))?.suggestedFolder).toBeNull()
  })

  it('no elimina carpetas con archivos que no son notas ni audios', async () => {
    const { repo, root } = makeRepo()
    await repo.createFolder('Producto')
    writeFileSync(join(root, 'Producto', 'documento.pdf'), 'importante')
    await expect(repo.removeFolder('Producto')).rejects.toThrow(/archivos/i)
    expect(existsSync(join(root, 'Producto', 'documento.pdf'))).toBe(true)
  })

  it('permite renombrar cambiando solo mayúsculas', async () => {
    const { repo, root } = makeRepo()
    await repo.createFolder('Producto')
    await repo.renameFolder('Producto', 'producto')
    const folders = await repo.folders()
    expect(folders).toContain('producto')
    expect(folders).not.toContain('Producto')
    expect(existsSync(join(root, 'producto'))).toBe(true)
  })
})
