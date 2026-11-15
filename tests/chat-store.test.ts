import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() }
}))

import { ChatStore } from '../src/main/chat/store'

const dir = mkdtempSync(join(tmpdir(), 'chismosito-chats-'))
const notesRoot = join(dir, 'MeetingNotes')
let counter = 0

function freshStore(): ChatStore {
  counter += 1
  return new ChatStore(join(dir, `chats-${counter}`), () => notesRoot)
}

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('ChatStore', () => {
  it('crea un hilo por nota y conserva los mensajes', async () => {
    const store = freshStore()
    await store.init()
    const notePath = join(notesRoot, 'Producto', '2026-11-14-15-30.md')
    const thread = store.openNote(notePath, 'Planificación Q4')
    expect(thread.notePath).toBe(notePath)
    expect(thread.scope).toBe('note')

    store.append(thread.id, {
      id: 'm1',
      role: 'user',
      content: '¿Qué se dijo del presupuesto?',
      createdAt: new Date().toISOString()
    })
    store.append(thread.id, {
      id: 'm2',
      role: 'assistant',
      content: 'Se aprobó el presupuesto [00:00:20].',
      createdAt: new Date().toISOString()
    })

    const loaded = store.get(thread.id)
    expect(loaded?.messages).toHaveLength(2)
    const list = store.list('note')
    expect(list).toHaveLength(1)
    expect(list[0].messageCount).toBe(2)

    const again = store.openNote(notePath, 'Planificación Q4')
    expect(again.id).toBe(thread.id)
  })

  it('auto-titula las conversaciones globales y persiste filtros', async () => {
    const chatsDir = join(dir, 'persist')
    const store = new ChatStore(chatsDir, () => notesRoot)
    await store.init()
    const thread = store.createLibrary()
    store.append(thread.id, {
      id: 'u1',
      role: 'user',
      content:
        '¿Qué tareas me asignaron esta semana en el proyecto de expansión internacional?',
      createdAt: new Date().toISOString()
    })
    store.updateFilters(thread.id, {
      from: '2026-11-09',
      to: '2026-11-15',
      folder: 'Producto'
    })

    const reloaded = new ChatStore(chatsDir, () => notesRoot)
    await reloaded.init()
    const summary = reloaded.list('library')[0]
    expect(summary.title).toContain('¿Qué tareas')
    expect(summary.title.length).toBeLessThanOrEqual(60)
    expect(summary.filters).toEqual({
      from: '2026-11-09',
      to: '2026-11-15',
      folder: 'Producto'
    })
  })

  it('mueve el hilo cuando la nota cambia de carpeta y lo borra con la nota', async () => {
    const store = freshStore()
    await store.init()
    const oldPath = join(notesRoot, '2026-11-14-15-30.md')
    const newPath = join(notesRoot, 'Producto', '2026-11-14-15-30.md')
    const thread = store.openNote(oldPath, 'Reunión')
    store.append(thread.id, {
      id: 'm1',
      role: 'user',
      content: 'Hola',
      createdAt: new Date().toISOString()
    })

    store.remapNote(oldPath, newPath)
    expect(store.get(thread.id)?.notePath).toBe(newPath)

    store.removeForNote(newPath)
    expect(store.get(thread.id)).toBeNull()
  })

  it('normaliza el orden de un rango de fechas invertido', async () => {
    const store = freshStore()
    await store.init()
    const thread = store.createLibrary()
    store.updateFilters(thread.id, {
      from: '2026-11-20',
      to: '2026-11-10',
      folder: null
    })
    expect(store.get(thread.id)?.filters).toEqual({
      from: '2026-11-10',
      to: '2026-11-20',
      folder: null
    })
  })
})
