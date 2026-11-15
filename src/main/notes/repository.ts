import { shell } from 'electron'
import { existsSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import dayjs from 'dayjs'
import type {
  DriveSyncState,
  NoteDetail,
  NoteMeta,
  NoteStatus,
  NoteUpdateInput
} from '@shared/types'
import type { SettingsStore } from '../settings'
import { ensureDir, isInside, uniquePath, writeAtomic } from '../lib/fs'
import { log } from '../lib/logger'
import {
  buildNoteMarkdown,
  excerptFromContent,
  extractTranscript,
  numberField,
  parseNote,
  statusField,
  stringField,
  tagsField,
  type ParsedNote,
  type SummaryData
} from './format'

interface CacheEntry {
  mtimeMs: number
  size: number
  meta: NoteMeta
}

export interface NoteWriteResult {
  summary: SummaryData | null
  transcript: string
  llm: string | null
  status: NoteStatus
  title?: string
  topics?: string[]
}

export class NoteRepository {
  private cache = new Map<string, CacheEntry>()
  private contentCache = new Map<string, { mtimeMs: number; size: number; text: string }>()
  private driveStateProvider: (relativePath: string, mtimeMs: number) => {
    state: DriveSyncState
    error: string | null
  } = () => ({ state: 'none', error: null })
  private movedListeners = new Set<(oldPath: string, newPath: string) => void>()
  private deletedListeners = new Set<(path: string) => void>()

  constructor(private readonly settings: SettingsStore) {}

  setDriveStateProvider(
    provider: (relativePath: string, mtimeMs: number) => {
      state: DriveSyncState
      error: string | null
    }
  ): void {
    this.driveStateProvider = provider
    this.cache.clear()
  }

  onMoved(listener: (oldPath: string, newPath: string) => void): () => void {
    this.movedListeners.add(listener)
    return () => this.movedListeners.delete(listener)
  }

  onDeleted(listener: (path: string) => void): () => void {
    this.deletedListeners.add(listener)
    return () => this.deletedListeners.delete(listener)
  }

  invalidate(): void {
    this.cache.clear()
    this.contentCache.clear()
  }

  root(): string {
    return this.settings.get().notesDir
  }

  private resolveNotePath(notePath: string): string {
    const root = resolve(this.root())
    const absolute = resolve(notePath)
    if (!isInside(root, absolute)) throw new Error('Ruta de nota fuera de MeetingNotes')
    return absolute
  }

  private relative(notePath: string): string {
    return relative(this.root(), notePath).split(sep).join('/')
  }

  private folderOf(notePath: string): string {
    const relativePath = this.relative(notePath)
    const folder = dirname(relativePath).split(sep).join('/')
    return folder === '.' ? '' : folder
  }

  private async readParsed(notePath: string): Promise<ParsedNote> {
    return parseNote(await readFile(notePath, 'utf8'))
  }

  private async buildMeta(notePath: string, parsed: ParsedNote): Promise<NoteMeta> {
    const info = await stat(notePath)
    const data = parsed.data
    const relativePath = this.relative(notePath)
    const baseName = basename(notePath, extname(notePath))
    const audioField = stringField(data, 'audio')
    const audioName = audioField || `${baseName}.webm`
    const audioCandidate = join(dirname(notePath), audioName)
    const audioExists = existsSync(audioCandidate) && isInside(this.root(), audioCandidate)

    const titleFromHeading =
      parsed.content.match(/^#\s+(.+)$/m)?.[1]?.replace(/\s+—\s+.*$/, '').trim() ?? ''
    const title = stringField(data, 'title') || titleFromHeading || baseName
    const drive = this.driveStateProvider(relativePath, info.mtimeMs)

    return {
      path: notePath,
      relativePath,
      fileName: basename(notePath),
      baseName,
      title,
      date: stringField(data, 'date') || info.mtime.toISOString(),
      durationSeconds: numberField(data, 'duration_seconds'),
      language: stringField(data, 'language', 'es'),
      audio: audioExists ? audioName : null,
      audioExists,
      folder: this.folderOf(notePath),
      tags: tagsField(data),
      status: statusField(data),
      llm: stringField(data, 'llm') || null,
      excerpt: excerptFromContent(parsed.content),
      mtimeMs: info.mtimeMs,
      sizeBytes: info.size,
      drive: drive.state,
      driveError: drive.error
    }
  }

  private async metaFor(notePath: string): Promise<NoteMeta> {
    const info = await stat(notePath)
    const cached = this.cache.get(notePath)
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      return cached.meta
    }
    const parsed = await this.readParsed(notePath)
    const meta = await this.buildMeta(notePath, parsed)
    this.cache.set(notePath, { mtimeMs: info.mtimeMs, size: info.size, meta })
    return meta
  }

  async list(): Promise<NoteMeta[]> {
    ensureDir(this.root())
    const results: NoteMeta[] = []
    const seen = new Set<string>()

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 6) return
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full, depth + 1)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          try {
            results.push(await this.metaFor(full))
            seen.add(full)
          } catch (error) {
            log.warn('No se pudo leer la nota', full, error)
          }
        }
      }
    }

    await walk(this.root(), 0)
    for (const path of [...this.cache.keys()]) {
      if (!seen.has(path)) this.cache.delete(path)
    }

    return results.sort((a, b) => {
      const aTime = a.date ? new Date(a.date).getTime() : a.mtimeMs
      const bTime = b.date ? new Date(b.date).getTime() : b.mtimeMs
      return bTime - aTime
    })
  }

  async folders(): Promise<string[]> {
    const folders = new Set<string>()
    ensureDir(this.root())

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 4) return
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const full = join(dir, entry.name)
        const rel = relative(this.root(), full).split(sep).join('/')
        folders.add(rel)
        await walk(full, depth + 1)
      }
    }
    await walk(this.root(), 0)
    return [...folders].sort((a, b) => a.localeCompare(b, 'es'))
  }

  async get(notePath: string): Promise<NoteDetail | null> {
    const absolute = this.resolveNotePath(notePath)
    if (!existsSync(absolute)) return null
    const parsed = await this.readParsed(absolute)
    const meta = await this.buildMeta(absolute, parsed)
    return {
      ...meta,
      raw: parsed.raw,
      content: parsed.content,
      transcript: extractTranscript(parsed.content)
    }
  }

  private async searchableContent(notePath: string): Promise<string> {
    const info = await stat(notePath)
    const cached = this.contentCache.get(notePath)
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      return cached.text
    }
    const parsed = await this.readParsed(notePath)
    const text = normalizeSearch(parsed.content)
    this.contentCache.set(notePath, {
      mtimeMs: info.mtimeMs,
      size: info.size,
      text
    })
    return text
  }

  async search(query: string): Promise<NoteMeta[]> {
    const term = normalizeSearch(query)
    const all = await this.list()
    if (!term) return all
    const matches: NoteMeta[] = []
    for (const meta of all) {
      const metadata = normalizeSearch(
        [meta.title, meta.excerpt, meta.folder, meta.tags.join(' '), meta.date ?? ''].join(' ')
      )
      if (metadata.includes(term)) {
        matches.push(meta)
        continue
      }
      if (term.length < 2) continue
      try {
        const content = await this.searchableContent(meta.path)
        if (content.includes(term)) matches.push(meta)
      } catch (error) {
        log.warn('No se pudo buscar dentro de la nota', meta.path, error)
      }
    }
    return matches
  }

  async patchFrontmatter(
    notePath: string,
    patch: Record<string, unknown>
  ): Promise<NoteDetail> {
    const absolute = this.resolveNotePath(notePath)
    const parsed = await this.readParsed(absolute)
    const data = { ...parsed.data, ...patch, updated_at: new Date().toISOString() }
    const { updated_at: _updatedAt, ...serializable } = data
    const content = composeWith(serializable, parsed.content)
    writeAtomic(absolute, content)
    this.cache.delete(absolute)
    const updated = await this.get(absolute)
    if (!updated) throw new Error('No se pudo releer la nota')
    return updated
  }

  async update(input: NoteUpdateInput): Promise<NoteDetail> {
    const absolute = this.resolveNotePath(input.path)
    const parsed = await this.readParsed(absolute)
    let content = parsed.content
    const currentFolder = this.folderOf(absolute)
    const targetFolder = input.folder === undefined ? currentFolder : normalizeFolder(input.folder)

    if (targetFolder !== currentFolder) {
      return this.move(absolute, targetFolder, {
        title: input.title,
        tags: input.tags
      })
    }

    const data: Record<string, unknown> = { ...parsed.data }
    if (input.title !== undefined) {
      data.title = input.title.trim() || data.title
      content = replaceTitle(
        parsed.content,
        String(data.title),
        stringField(data, 'date')
      )
    }
    if (input.tags !== undefined) {
      data.tags = [...new Set(input.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 20)
    }
    data.folder = targetFolder
    data.updated_at = new Date().toISOString()

    const next = composeWith(data, content)
    writeAtomic(absolute, next)
    this.cache.delete(absolute)
    const updated = await this.get(absolute)
    if (!updated) throw new Error('No se pudo releer la nota')
    return updated
  }

  async move(
    notePath: string,
    folder: string | null,
    extra: { title?: string; tags?: string[] } = {}
  ): Promise<NoteDetail> {
    const absolute = this.resolveNotePath(notePath)
    const targetFolder = normalizeFolder(folder ?? '')
    const targetDir = targetFolder ? join(this.root(), targetFolder) : this.root()
    ensureDir(targetDir)

    const parsed = await this.readParsed(absolute)
    const currentBase = basename(absolute, '.md')
    const audioField = stringField(parsed.data, 'audio')
    const audioName = audioField || `${currentBase}.webm`
    const sourceAudio = join(dirname(absolute), audioName)
    const hasAudio = existsSync(sourceAudio)

    let targetBase = currentBase
    let targetMd = join(targetDir, `${targetBase}.md`)
    const collision = (candidate: string): boolean => {
      const stem = basename(candidate, '.md')
      return (
        existsSync(candidate) ||
        (hasAudio && existsSync(join(targetDir, `${stem}${extname(audioName)}`)))
      )
    }
    if (absolute !== targetMd && collision(targetMd)) {
      targetMd = uniquePath(targetMd, collision)
      targetBase = basename(targetMd, '.md')
    }

    const targetAudio = join(targetDir, `${targetBase}${extname(audioName) || '.webm'}`)
    const samePath = resolve(absolute) === resolve(targetMd)

    if (!samePath) {
      if (hasAudio && resolve(sourceAudio) !== resolve(targetAudio)) {
        if (existsSync(targetAudio)) throw new Error('Ya existe un audio con ese nombre en la carpeta destino')
        await rename(sourceAudio, targetAudio).catch(async (error) => {
          if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
            await copyFile(sourceAudio, targetAudio)
            await unlink(sourceAudio)
          } else {
            throw error
          }
        })
      }
      await rename(absolute, targetMd).catch(async (error) => {
        if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
          await copyFile(absolute, targetMd)
          await unlink(absolute)
        } else {
          throw error
        }
      })
    }

    const data: Record<string, unknown> = {
      ...parsed.data,
      folder: targetFolder,
      audio: hasAudio ? basename(targetAudio) : null,
      updated_at: new Date().toISOString()
    }
    if (extra.title !== undefined) data.title = extra.title.trim() || data.title
    if (extra.tags !== undefined) {
      data.tags = [...new Set(extra.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 20)
    }
    const content =
      extra.title !== undefined
        ? replaceTitle(parsed.content, String(data.title), stringField(data, 'date'))
        : parsed.content
    writeAtomic(targetMd, composeWith(data, content))
    this.cache.delete(absolute)
    this.cache.delete(targetMd)

    if (!samePath) {
      for (const listener of this.movedListeners) listener(absolute, targetMd)
    }

    const updated = await this.get(targetMd)
    if (!updated) throw new Error('No se pudo releer la nota movida')
    return updated
  }

  async remove(notePath: string): Promise<void> {
    const absolute = this.resolveNotePath(notePath)
    if (!existsSync(absolute)) return
    const parsed = await this.readParsed(absolute)
    const audioField = stringField(parsed.data, 'audio')
    const audioPath = audioField ? join(dirname(absolute), audioField) : null
    await shell.trashItem(absolute)
    if (audioPath && existsSync(audioPath) && isInside(this.root(), audioPath)) {
      await shell.trashItem(audioPath).catch((error) => log.warn('No se pudo enviar audio a papelera', error))
    }
    this.cache.delete(absolute)
    for (const listener of this.deletedListeners) listener(absolute)
  }

  async reveal(notePath: string): Promise<void> {
    const absolute = this.resolveNotePath(notePath)
    shell.showItemInFolder(absolute)
  }

  async allocate(startedAt: string): Promise<{
    baseName: string
    notePath: string
    audioPath: string
    partPath: string
  }> {
    const root = this.root()
    ensureDir(root)
    const date = dayjs(startedAt)
    const baseName = date.isValid()
      ? date.format('YYYY-MM-DD-HH-mm')
      : dayjs().format('YYYY-MM-DD-HH-mm')

    const exists = (candidate: string): boolean => {
      const stem = basename(candidate, '.md')
      return existsSync(candidate) || existsSync(join(root, `${stem}.webm`))
    }
    const notePath = uniquePath(join(root, `${baseName}.md`), exists)
    const finalBase = basename(notePath, '.md')
    const audioPath = join(root, `${finalBase}.webm`)
    const partPath = `${audioPath}.part`
    return { baseName: finalBase, notePath, audioPath, partPath }
  }

  async createStub(input: {
    notePath: string
    baseName: string
    audioFileName: string | null
    date: string
    durationSeconds: number
    language: string
    title?: string
  }): Promise<void> {
    const title =
      input.title ||
      `Reunión ${dayjs(input.date).isValid() ? dayjs(input.date).format('D MMM YYYY, HH:mm') : ''}`.trim()
    const now = new Date().toISOString()
    const markdown = buildNoteMarkdown({
      title,
      date: input.date,
      durationSeconds: input.durationSeconds,
      language: input.language,
      audio: input.audioFileName,
      folder: '',
      tags: [],
      status: 'processing',
      llm: null,
      summary: null,
      transcript: '',
      createdAt: now,
      updatedAt: now
    })
    writeAtomic(this.resolveNotePath(input.notePath), markdown)
    this.cache.delete(input.notePath)
  }

  async writeResult(notePath: string, result: NoteWriteResult): Promise<void> {
    const absolute = this.resolveNotePath(notePath)
    const parsed = await this.readParsed(absolute)
    const data = parsed.data
    const existingTags = tagsField(data)
    const tags = [...new Set([...existingTags, ...(result.topics ?? [])])]
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 20)

    const now = new Date().toISOString()
    const markdown = buildNoteMarkdown({
      title: result.title || stringField(data, 'title') || 'Reunión',
      date: stringField(data, 'date') || now,
      durationSeconds: numberField(data, 'duration_seconds'),
      language: stringField(data, 'language', 'es'),
      audio: stringField(data, 'audio') || null,
      folder: this.folderOf(absolute),
      tags,
      status: result.status,
      llm: result.llm,
      summary: result.summary,
      transcript: result.transcript,
      createdAt: stringField(data, 'created_at') || now,
      updatedAt: now
    })
    writeAtomic(absolute, markdown)
    this.cache.delete(absolute)
  }

  async setStatus(notePath: string, status: NoteStatus): Promise<void> {
    if (!existsSync(notePath)) return
    const parsed = await this.readParsed(notePath)
    const data = { ...parsed.data, status, updated_at: new Date().toISOString() }
    writeAtomic(notePath, composeWith(data, parsed.content))
    this.cache.delete(notePath)
  }

  async readTranscript(notePath: string): Promise<string | null> {
    if (!existsSync(notePath)) return null
    const parsed = await this.readParsed(notePath)
    const lines = extractTranscript(parsed.content)
    if (lines.length === 0) {
      // A note may contain a plain transcript without speaker labels.
      const marker = parsed.content.indexOf('## Transcripción')
      const tail = marker >= 0 ? parsed.content.slice(marker) : ''
      const plain = tail
        .replace('## Transcripción', '')
        .replace(/_\(.*?\)_/g, '')
        .trim()
      return plain || null
    }
    return lines.map((line) => `${line.timestamp} ${line.speaker}: ${line.text}`).join('\n')
  }

  async readTranscriptMarkdown(notePath: string): Promise<string | null> {
    if (!existsSync(notePath)) return null
    const parsed = await this.readParsed(notePath)
    const lines = extractTranscript(parsed.content)
    if (lines.length > 0) {
      return lines
        .map((line) => `[${line.timestamp}] **${line.speaker}:** ${line.text}`)
        .join('\n')
    }
    const marker = parsed.content.indexOf('## Transcripción')
    const tail = marker >= 0 ? parsed.content.slice(marker) : ''
    const plain = tail
      .replace('## Transcripción', '')
      .replace(/_\(.*?\)_/g, '')
      .trim()
    return plain || null
  }
}

function composeWith(data: Record<string, unknown>, content: string): string {
  const serialized: string[] = ['---']
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    if (value === null) serialized.push(`${key}: null`)
    else if (typeof value === 'string') serialized.push(`${key}: ${JSON.stringify(value)}`)
    else if (typeof value === 'number' || typeof value === 'boolean') {
      serialized.push(`${key}: ${String(value)}`)
    } else if (Array.isArray(value)) {
      serialized.push(`${key}: ${JSON.stringify(value.map((entry) => String(entry)))}`)
    } else {
      serialized.push(`${key}: ${JSON.stringify(value)}`)
    }
  }
  serialized.push('---')
  return `${serialized.join('\n')}\n\n${content.trim()}\n`
}

function replaceTitle(content: string, title: string, isoDate: string): string {
  const dateLabel = dayjs(isoDate).isValid()
    ? dayjs(isoDate).format('D [de] MMMM [de] YYYY, HH:mm')
    : ''
  const heading = dateLabel ? `# ${title} — ${dateLabel}` : `# ${title}`
  if (/^#\s+.+$/m.test(content)) return content.replace(/^#\s+.+$/m, heading)
  return `${heading}\n\n${content}`
}

export function normalizeFolder(folder: string): string {
  return folder
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) =>
      segment
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[<>:"|?*\u0000-\u001f]/g, '-')
        .replace(/^\.+|\.+$/g, '')
        .trim()
    )
    .filter(Boolean)
    .join('/')
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
