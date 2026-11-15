import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile, unlink } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import type {
  ChatFilter,
  ChatMessage,
  ChatScope,
  ChatThread,
  ChatThreadSummary
} from '@shared/types'
import { ensureDir, writeAtomic } from '../lib/fs'
import { log } from '../lib/logger'

const MAX_MESSAGES = 200
const MAX_LIBRARY_THREADS = 100
const DEFAULT_LIBRARY_TITLE = 'Nueva conversación'

interface ThreadRecord {
  version: 1
  id: string
  scope: ChatScope
  noteRelativePath: string | null
  noteTitle: string | null
  title: string
  messages: ChatMessage[]
  filters: ChatFilter | null
  createdAt: string
  updatedAt: string
}

export interface ChatThreadFile {
  id: string
  scope: ChatScope
  noteRelativePath: string | null
  noteTitle: string | null
  title: string
  filePath: string
  updatedAt: string
}

export interface ChatExport {
  version: 1
  exportedAt: string
  thread: ThreadRecord
}

export class ChatStore {
  private records = new Map<string, ThreadRecord>()

  constructor(
    private readonly chatsDir: string,
    private readonly notesRoot: () => string
  ) {}

  async init(): Promise<void> {
    ensureDir(this.chatsDir)
    const files = await readdir(this.chatsDir).catch(() => [] as string[])
    for (const name of files) {
      if (!name.toLowerCase().endsWith('.json')) continue
      try {
        const raw = JSON.parse(await readFile(join(this.chatsDir, name), 'utf8')) as
          | ChatExport
          | ThreadRecord
        const candidate = 'thread' in raw ? raw.thread : raw
        const record = normalizeRecord(candidate)
        if (!record) continue
        this.records.set(record.id, record)
      } catch (error) {
        log.warn('No se pudo leer una conversación', name, error)
      }
    }
    this.pruneLibraryThreads()
  }

  private filePath(id: string): string {
    return join(this.chatsDir, `${id}.json`)
  }

  private notePathFor(record: ThreadRecord): string | null {
    if (!record.noteRelativePath) return null
    return resolve(join(this.notesRoot(), record.noteRelativePath))
  }

  private relativeNotePath(notePath: string): string {
    const root = resolve(this.notesRoot())
    const absolute = resolve(notePath)
    const rel = relative(root, absolute).split(sep).join('/')
    if (!rel || rel.startsWith('..') || rel.includes(':')) {
      throw new Error('La nota del chat está fuera de MeetingNotes')
    }
    return rel
  }

  private toPublic(record: ThreadRecord): ChatThread {
    return {
      id: record.id,
      scope: record.scope,
      notePath: this.notePathFor(record),
      noteTitle: record.noteTitle,
      title: record.title,
      messages: record.messages,
      filters: record.filters,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }
  }

  private toSummary(record: ThreadRecord): ChatThreadSummary {
    return {
      id: record.id,
      scope: record.scope,
      notePath: this.notePathFor(record),
      noteTitle: record.noteTitle,
      title: record.title,
      messageCount: record.messages.length,
      filters: record.filters,
      updatedAt: record.updatedAt
    }
  }

  private save(record: ThreadRecord): void {
    const payload: ChatExport = {
      version: 1,
      exportedAt: new Date().toISOString(),
      thread: record
    }
    try {
      writeAtomic(this.filePath(record.id), JSON.stringify(payload, null, 2))
    } catch (error) {
      log.error('No se pudo guardar la conversación', record.id, error)
    }
  }

  private touch(record: ThreadRecord): void {
    record.updatedAt = new Date().toISOString()
    if (record.messages.length > MAX_MESSAGES) {
      record.messages = record.messages.slice(-MAX_MESSAGES)
    }
    this.records.set(record.id, record)
    this.save(record)
  }

  private createRecord(input: {
    scope: ChatScope
    noteRelativePath: string | null
    noteTitle: string | null
    title: string
  }): ThreadRecord {
    const now = new Date().toISOString()
    return {
      version: 1,
      id: randomUUID(),
      scope: input.scope,
      noteRelativePath: input.noteRelativePath,
      noteTitle: input.noteTitle,
      title: input.title,
      messages: [],
      filters: null,
      createdAt: now,
      updatedAt: now
    }
  }

  list(scope: ChatScope): ChatThreadSummary[] {
    return [...this.records.values()]
      .filter((record) => record.scope === scope)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((record) => this.toSummary(record))
  }

  get(threadId: string): ChatThread | null {
    const record = this.records.get(threadId)
    return record ? this.toPublic(record) : null
  }

  openNote(notePath: string, noteTitle: string): ChatThread {
    const rel = this.relativeNotePath(notePath)
    let record = [...this.records.values()].find(
      (entry) => entry.scope === 'note' && entry.noteRelativePath === rel
    )
    if (!record) {
      const base = basename(rel, extname(rel))
      record = [...this.records.values()].find(
        (entry) =>
          entry.scope === 'note' &&
          (entry.noteRelativePath === `${base}.md` ||
            entry.noteRelativePath?.endsWith(`/${base}.md`))
      )
      if (record) {
        record.noteRelativePath = rel
        record.noteTitle = noteTitle
        this.touch(record)
      }
    }
    if (record) {
      if (record.noteTitle !== noteTitle) {
        record.noteTitle = noteTitle
        this.touch(record)
      }
      return this.toPublic(record)
    }
    const created = this.createRecord({
      scope: 'note',
      noteRelativePath: rel,
      noteTitle,
      title: noteTitle || basename(rel, extname(rel))
    })
    this.records.set(created.id, created)
    this.save(created)
    return this.toPublic(created)
  }

  createLibrary(): ChatThread {
    const created = this.createRecord({
      scope: 'library',
      noteRelativePath: null,
      noteTitle: null,
      title: DEFAULT_LIBRARY_TITLE
    })
    this.records.set(created.id, created)
    this.save(created)
    this.pruneLibraryThreads()
    return this.toPublic(created)
  }

  append(threadId: string, message: ChatMessage): ChatThread {
    const record = this.records.get(threadId)
    if (!record) throw new Error('La conversación no existe')
    record.messages.push(message)
    if (
      record.scope === 'library' &&
      record.title === DEFAULT_LIBRARY_TITLE &&
      message.role === 'user'
    ) {
      record.title = autoTitle(message.content)
    }
    this.touch(record)
    return this.toPublic(record)
  }

  updateFilters(threadId: string, filters: ChatFilter | null): ChatThreadSummary {
    const record = this.records.get(threadId)
    if (!record) throw new Error('La conversación no existe')
    record.filters = normalizeFilters(filters)
    this.touch(record)
    return this.toSummary(record)
  }

  clear(threadId: string): ChatThread {
    const record = this.records.get(threadId)
    if (!record) throw new Error('La conversación no existe')
    record.messages = []
    record.filters = null
    record.title =
      record.scope === 'library'
        ? DEFAULT_LIBRARY_TITLE
        : record.noteTitle || record.title
    this.touch(record)
    return this.toPublic(record)
  }

  async remove(threadId: string): Promise<void> {
    const record = this.records.get(threadId)
    if (!record) return
    this.records.delete(threadId)
    await unlink(this.filePath(threadId)).catch(() => undefined)
  }

  remapNote(oldPath: string, newPath: string): void {
    const oldRel = relative(resolve(this.notesRoot()), resolve(oldPath)).split(sep).join('/')
    const newRel = relative(resolve(this.notesRoot()), resolve(newPath)).split(sep).join('/')
    if (!oldRel || !newRel) return
    const affected = [...this.records.values()].filter(
      (entry) => entry.scope === 'note' && entry.noteRelativePath === oldRel
    )
    for (const record of affected) {
      const duplicate = [...this.records.values()].find(
        (entry) =>
          entry.id !== record.id &&
          entry.scope === 'note' &&
          entry.noteRelativePath === newRel
      )
      if (duplicate) {
        duplicate.messages = [...record.messages, ...duplicate.messages].slice(-MAX_MESSAGES)
        duplicate.updatedAt =
          record.updatedAt > duplicate.updatedAt ? record.updatedAt : duplicate.updatedAt
        duplicate.noteTitle = record.noteTitle || duplicate.noteTitle
        duplicate.title = duplicate.noteTitle || duplicate.title
        this.records.delete(record.id)
        void unlink(this.filePath(record.id)).catch(() => undefined)
        this.save(duplicate)
        continue
      }
      record.noteRelativePath = newRel
      this.touch(record)
    }
  }

  removeForNote(notePath: string): void {
    const rel = relative(resolve(this.notesRoot()), resolve(notePath)).split(sep).join('/')
    for (const record of [...this.records.values()]) {
      if (record.scope === 'note' && record.noteRelativePath === rel) {
        void this.remove(record.id)
      }
    }
  }

  threadFile(threadId: string): ChatThreadFile | null {
    const record = this.records.get(threadId)
    if (!record) return null
    return {
      id: record.id,
      scope: record.scope,
      noteRelativePath: record.noteRelativePath,
      noteTitle: record.noteTitle,
      title: record.title,
      filePath: this.filePath(record.id),
      updatedAt: record.updatedAt
    }
  }

  allForBackup(): ChatThreadFile[] {
    return [...this.records.values()]
      .filter((record) => record.messages.length > 0)
      .map((record) => ({
        id: record.id,
        scope: record.scope,
        noteRelativePath: record.noteRelativePath,
        noteTitle: record.noteTitle,
        title: record.title,
        filePath: this.filePath(record.id),
        updatedAt: record.updatedAt
      }))
  }

  noteThreadForBackup(notePath: string): ChatThreadFile | null {
    const rel = relative(resolve(this.notesRoot()), resolve(notePath)).split(sep).join('/')
    const record = [...this.records.values()].find(
      (entry) =>
        entry.scope === 'note' &&
        entry.noteRelativePath === rel &&
        entry.messages.length > 0
    )
    return record ? this.threadFile(record.id) : null
  }

  exportThread(threadId: string): ChatExport | null {
    const record = this.records.get(threadId)
    if (!record) return null
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      thread: record
    }
  }

  cloneRecord(threadId: string): ThreadRecord | null {
    const record = this.records.get(threadId)
    return record ? structuredClone(record) : null
  }

  private pruneLibraryThreads(): void {
    const library = [...this.records.values()]
      .filter((record) => record.scope === 'library')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    for (const record of library.slice(MAX_LIBRARY_THREADS)) {
      this.records.delete(record.id)
      if (existsSync(this.filePath(record.id))) {
        void unlink(this.filePath(record.id)).catch(() => undefined)
      }
    }
  }
}

function autoTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return DEFAULT_LIBRARY_TITLE
  return clean.length > 60 ? `${clean.slice(0, 57).trim()}…` : clean
}

function normalizeFilters(filters: ChatFilter | null): ChatFilter | null {
  if (!filters) return null
  const date = (value: string | null): string | null =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
  const from = date(filters.from)
  const to = date(filters.to)
  const folder =
    typeof filters.folder === 'string' ? filters.folder.trim().replace(/\\/g, '/') : null
  if (!from && !to && folder === null) return null
  return {
    from: from && to && from > to ? to : from,
    to: from && to && from > to ? from : to,
    folder
  }
}

function normalizeRecord(raw: unknown): ThreadRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || !value.id) return null
  if (value.scope !== 'note' && value.scope !== 'library') return null
  const messages = Array.isArray(value.messages)
    ? value.messages
        .filter(
          (message): message is ChatMessage =>
            Boolean(message) &&
            typeof message === 'object' &&
            typeof (message as ChatMessage).id === 'string' &&
            ((message as ChatMessage).role === 'user' ||
              (message as ChatMessage).role === 'assistant') &&
            typeof (message as ChatMessage).content === 'string'
        )
        .slice(-MAX_MESSAGES)
    : []
  const noteRelativePath =
    typeof value.noteRelativePath === 'string' ? value.noteRelativePath : null
  const noteTitle = typeof value.noteTitle === 'string' ? value.noteTitle : null
  const now = new Date().toISOString()
  return {
    version: 1,
    id: value.id,
    scope: value.scope,
    noteRelativePath,
    noteTitle,
    title:
      typeof value.title === 'string' && value.title.trim()
        ? value.title.trim()
        : noteTitle || DEFAULT_LIBRARY_TITLE,
    messages,
    filters: normalizeFilters((value.filters ?? null) as ChatFilter | null),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now
  }
}
