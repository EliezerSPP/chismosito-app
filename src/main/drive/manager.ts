import { app } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  DriveBackupSummary,
  DriveProgress,
  DriveStatus,
  NoteDetail,
  NoteMeta
} from '@shared/types'
import type { SettingsStore } from '../settings'
import type { NoteRepository } from '../notes/repository'
import type { ChatStore, ChatThreadFile } from '../chat/store'
import { ensureDir, sha256File, writeAtomic } from '../lib/fs'
import { log } from '../lib/logger'
import { DriveAuth } from './auth'
import { DriveApi } from './api'
import {
  chatKeyForLibrary,
  chatKeyForNote,
  chatRemotePathForLibrary,
  chatRemotePathForNote,
  parentRemotePath,
  remoteFileName
} from './paths'

interface DriveFileState {
  fileId: string
  hash: string
  mtimeMs: number
  uploadedAt: string
}

interface DriveState {
  version: 2
  rootId: string | null
  rootName: string
  folders: Record<string, string>
  files: Record<string, DriveFileState>
  chats: Record<string, DriveFileState>
  errors: Record<string, string>
  chatErrors: Record<string, string>
  lastBackupAt: string | null
  lastChatBackupAt: string | null
}

interface DriveManagerDeps {
  settings: SettingsStore
  notes: NoteRepository
  chats: ChatStore
  emitStatus: (status: DriveStatus) => void
  emitProgress: (progress: DriveProgress) => void
  emitToast: (level: 'info' | 'success' | 'error', message: string) => void
}

export class DriveManager {
  readonly auth = new DriveAuth()
  private readonly api: DriveApi
  private state: DriveState
  private lock: Promise<unknown> = Promise.resolve()
  private rootVerified = false
  private readonly statePath = join(app.getPath('userData'), 'drive-state.json')

  constructor(private readonly deps: DriveManagerDeps) {
    this.api = new DriveApi(this.auth)
    this.state = this.loadState()
  }

  private loadState(): DriveState {
    const empty: DriveState = {
      version: 2,
      rootId: null,
      rootName: '',
      folders: {},
      files: {},
      chats: {},
      errors: {},
      chatErrors: {},
      lastBackupAt: null,
      lastChatBackupAt: null
    }
    try {
      if (!existsSync(this.statePath)) return empty
      const raw = JSON.parse(require('node:fs').readFileSync(this.statePath, 'utf8')) as Partial<DriveState>
      return {
        ...empty,
        ...raw,
        version: 2,
        folders: raw.folders ?? {},
        files: raw.files ?? {},
        chats: raw.chats ?? {},
        errors: raw.errors ?? {},
        chatErrors: raw.chatErrors ?? {}
      }
    } catch (error) {
      log.warn('No se pudo leer drive-state.json', error)
      return empty
    }
  }

  private saveState(): void {
    ensureDir(dirname(this.statePath))
    writeAtomic(this.statePath, JSON.stringify(this.state, null, 2))
  }

  status(): DriveStatus {
    const settings = this.deps.settings.get()
    return {
      clientConfigured: this.auth.clientConfigured(),
      connected: this.auth.connected(),
      tokenSource: this.auth.tokenSource(),
      folderName: settings.driveFolderName,
      folderId: this.state.rootId,
      lastBackupAt: this.state.lastBackupAt,
      autoBackup: settings.autoBackup,
      root: this.deps.notes.root(),
      chats: {
        count: Object.keys(this.state.chats).length,
        lastBackupAt: this.state.lastChatBackupAt
      }
    }
  }

  private emit(): void {
    this.deps.notes.invalidate()
    this.deps.emitStatus(this.status())
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn)
    this.lock = run.catch(() => undefined)
    return run
  }

  noteState(relativePath: string, mtimeMs: number): {
    state: 'none' | 'pending' | 'synced' | 'failed'
    error: string | null
  } {
    const error = this.state.errors[relativePath]
    if (error) return { state: 'failed', error }
    const entry = this.state.files[relativePath]
    if (!entry) return { state: 'none', error: null }
    if (Number.isFinite(mtimeMs) && mtimeMs > entry.mtimeMs + 1) {
      return { state: 'pending', error: null }
    }
    return { state: 'synced', error: null }
  }

  async connect(): Promise<DriveStatus> {
    return this.withLock(async () => {
      await this.auth.connect()
      this.state.rootId = null
      this.rootVerified = false
      await this.ensureRoot(true)
      this.saveState()
      this.emit()
      return this.status()
    })
  }

  disconnect(): DriveStatus {
    this.auth.disconnect()
    this.emit()
    return this.status()
  }

  private rootName(): string {
    return this.deps.settings.get().driveFolderName.trim() || 'Chismosito'
  }

  private async ensureRoot(force = false): Promise<string> {
    const name = this.rootName()
    if (!force && this.state.rootId && this.state.rootName === name) {
      if (!this.rootVerified) {
        try {
          const file = await this.api.getFile(this.state.rootId)
          if (!file.trashed) {
            this.rootVerified = true
            return this.state.rootId
          }
        } catch (error) {
          log.warn('La carpeta raíz de Drive ya no es accesible; se recreará', error)
        }
        this.state.rootId = null
        this.state.folders = {}
        this.rootVerified = false
      } else {
        return this.state.rootId
      }
    }

    const existing = await this.api.findFolder(name, null)
    const folder = existing ?? (await this.api.createFolder(name, null))
    this.state.rootId = folder.id
    this.state.rootName = name
    this.state.folders = {}
    this.rootVerified = true
    this.saveState()
    return folder.id
  }

  private async ensureFolderPath(folder: string): Promise<string> {
    const rootId = await this.ensureRoot()
    const clean = folder
      .split(/[\\/]/)
      .map((part) => part.trim())
      .filter(Boolean)
    let parent = rootId
    let accumulated = ''
    for (const part of clean) {
      accumulated = accumulated ? `${accumulated}/${part}` : part
      const cached = this.state.folders[accumulated]
      if (cached) {
        parent = cached
        continue
      }
      parent = await this.api.ensureFolder(part, parent)
      this.state.folders[accumulated] = parent
      this.saveState()
    }
    return parent
  }

  private async uploadOne(options: {
    localPath: string
    relativePath: string
    folder: string
    mimeType: string
  }): Promise<{ skipped: boolean }> {
    if (!existsSync(options.localPath)) throw new Error('El archivo local ya no existe')
    const info = await stat(options.localPath)
    const hash = await sha256File(options.localPath)
    const existing = this.state.files[options.relativePath]
    if (existing && existing.hash === hash && existing.fileId) {
      return { skipped: true }
    }

    const parentId = await this.ensureFolderPath(options.folder)
    let fileId: string | null = existing?.fileId ?? null
    if (!fileId) {
      const remote = await this.api.findFileByPath(options.relativePath, parentId)
      fileId = remote?.id ?? null
    }

    try {
      const uploaded = await this.api.uploadFile({
        localPath: options.localPath,
        relativePath: options.relativePath,
        mimeType: options.mimeType,
        parentId,
        fileId
      })
      this.state.files[options.relativePath] = {
        fileId: uploaded.id,
        hash,
        mtimeMs: info.mtimeMs,
        uploadedAt: new Date().toISOString()
      }
      delete this.state.errors[options.relativePath]
      this.saveState()
      return { skipped: false }
    } catch (error) {
      const message = (error as Error).message
      if (fileId && /404|no existe/i.test(message)) {
        const uploaded = await this.api.uploadFile({
          localPath: options.localPath,
          relativePath: options.relativePath,
          mimeType: options.mimeType,
          parentId,
          fileId: null
        })
        this.state.files[options.relativePath] = {
          fileId: uploaded.id,
          hash,
          mtimeMs: info.mtimeMs,
          uploadedAt: new Date().toISOString()
        }
        delete this.state.errors[options.relativePath]
        this.saveState()
        return { skipped: false }
      }
      this.state.errors[options.relativePath] = message
      this.saveState()
      throw error
    }
  }

  private async uploadChatFile(thread: ChatThreadFile): Promise<{ skipped: boolean }> {
    if (thread.scope === 'note' && !thread.noteRelativePath) {
      throw new Error('La conversación no está ligada a una nota')
    }
    if (!existsSync(thread.filePath)) throw new Error('La conversación local ya no existe')

    const info = await stat(thread.filePath)
    const hash = await sha256File(thread.filePath)
    const remotePath =
      thread.scope === 'library'
        ? chatRemotePathForLibrary(thread.id)
        : chatRemotePathForNote(thread.noteRelativePath ?? '')
    const key =
      thread.scope === 'library'
        ? chatKeyForLibrary(thread.id)
        : chatKeyForNote(thread.noteRelativePath ?? '')

    const existing = this.state.chats[key]
    if (existing && existing.hash === hash && existing.fileId) {
      return { skipped: true }
    }

    const parentId = await this.ensureFolderPath(parentRemotePath(remotePath))
    let fileId: string | null = existing?.fileId ?? null
    if (!fileId) {
      const remote = await this.api.findFileByPath(remotePath, parentId)
      fileId = remote?.id ?? null
    }

    const upload = async (targetId: string | null): Promise<void> => {
      const uploaded = await this.api.uploadFile({
        localPath: thread.filePath,
        relativePath: remotePath,
        mimeType: 'application/json',
        parentId,
        fileId: targetId,
        name: remoteFileName(remotePath)
      })
      this.state.chats[key] = {
        fileId: uploaded.id,
        hash,
        mtimeMs: info.mtimeMs,
        uploadedAt: new Date().toISOString()
      }
      delete this.state.chatErrors[key]
      this.state.lastChatBackupAt = new Date().toISOString()
      this.saveState()
    }

    try {
      await upload(fileId)
      return { skipped: false }
    } catch (error) {
      const message = (error as Error).message
      if (fileId && /404|no existe/i.test(message)) {
        await upload(null)
        return { skipped: false }
      }
      this.state.chatErrors[key] = message
      this.saveState()
      throw error
    }
  }

  private audioRelativePath(note: NoteMeta, audio: string): string {
    const folder = note.relativePath.includes('/')
      ? note.relativePath.slice(0, note.relativePath.lastIndexOf('/'))
      : ''
    return folder ? `${folder}/${audio}` : audio
  }

  private async backupInternal(note: NoteDetail | NoteMeta): Promise<{
    uploaded: number
    skipped: number
  }> {
    if (note.status === 'processing' || note.status === 'recording') {
      throw new Error('La nota todavía se está procesando')
    }
    if (!this.auth.connected()) {
      throw new Error('Google Drive no está conectado')
    }

    let uploaded = 0
    let skipped = 0
    const noteResult = await this.uploadOne({
      localPath: note.path,
      relativePath: note.relativePath,
      folder: note.folder,
      mimeType: 'text/markdown'
    })
    noteResult.skipped ? (skipped += 1) : (uploaded += 1)

    if (note.audio) {
      const audioPath = resolve(dirname(note.path), note.audio)
      if (existsSync(audioPath)) {
        const audioResult = await this.uploadOne({
          localPath: audioPath,
          relativePath: this.audioRelativePath(note, note.audio),
          folder: note.folder,
          mimeType: 'audio/webm'
        })
        audioResult.skipped ? (skipped += 1) : (uploaded += 1)
      }
    }

    this.state.lastBackupAt = new Date().toISOString()
    this.saveState()
    this.emit()
    return { uploaded, skipped }
  }

  async backupNote(notePath: string): Promise<void> {
    const note = await this.deps.notes.get(notePath)
    if (!note) throw new Error('La nota no existe')
    await this.withLock(async () => {
      await this.backupInternal(note)
      const chatFile = this.deps.chats.noteThreadForBackup(note.path)
      if (chatFile) await this.uploadChatFile(chatFile)
    })
  }

  async backupChat(threadId: string): Promise<void> {
    await this.withLock(async () => {
      if (!this.auth.connected()) throw new Error('Google Drive no está conectado')
      const file = this.deps.chats.threadFile(threadId)
      if (!file) throw new Error('La conversación no existe')
      await this.uploadChatFile(file)
      this.deps.emitStatus(this.status())
    })
  }

  async backupAll(): Promise<DriveBackupSummary> {
    return this.withLock(async () => {
      if (!this.auth.connected()) throw new Error('Google Drive no está conectado')
      const all = await this.deps.notes.list()
      const candidates = all.filter(
        (note) => note.status !== 'processing' && note.status !== 'recording'
      )
      const chatFiles = this.deps.chats.allForBackup()
      const total = candidates.length + chatFiles.length
      const summary: DriveBackupSummary = {
        total,
        uploaded: 0,
        skipped: 0,
        failed: 0,
        errors: [],
        chats: { uploaded: 0, skipped: 0, failed: 0 }
      }
      this.deps.emitProgress({
        active: true,
        current: '',
        completed: 0,
        total
      })

      for (let index = 0; index < candidates.length; index += 1) {
        const note = candidates[index]
        this.deps.emitProgress({
          active: true,
          current: note.title,
          completed: index,
          total
        })
        try {
          const detail = (await this.deps.notes.get(note.path)) ?? note
          const result = await this.backupInternal(detail)
          summary.uploaded += result.uploaded
          summary.skipped += result.skipped
        } catch (error) {
          summary.failed += 1
          summary.errors.push(`${note.title}: ${(error as Error).message}`)
        }
      }

      for (let index = 0; index < chatFiles.length; index += 1) {
        const chat = chatFiles[index]
        const label = chat.title || chat.noteTitle || 'Conversación'
        this.deps.emitProgress({
          active: true,
          current: `Conversación: ${label}`,
          completed: candidates.length + index,
          total
        })
        try {
          const result = await this.uploadChatFile(chat)
          if (result.skipped) summary.chats.skipped += 1
          else summary.chats.uploaded += 1
        } catch (error) {
          summary.chats.failed += 1
          summary.errors.push(`Conversación «${label}»: ${(error as Error).message}`)
        }
      }

      this.deps.emitProgress({
        active: false,
        current: '',
        completed: total,
        total
      })
      this.state.lastBackupAt = new Date().toISOString()
      this.saveState()
      this.emit()
      const chatSummary =
        summary.chats.uploaded + summary.chats.skipped > 0
          ? ` · ${summary.chats.uploaded} conversación(es) subida(s), ${summary.chats.skipped} sin cambios`
          : ''
      if (summary.failed + summary.chats.failed > 0) {
        this.deps.emitToast(
          'error',
          `Respaldo terminado con ${summary.failed + summary.chats.failed} error(es). Revisa los detalles en Ajustes.`
        )
      } else {
        this.deps.emitToast(
          'success',
          `Respaldo completo: ${summary.uploaded} archivo(s) subido(s), ${summary.skipped} sin cambios${chatSummary}.`
        )
      }
      return summary
    })
  }

  handleMove(oldPath: string, newPath: string): void {
    void this.withLock(async () => {
      if (!this.auth.connected()) return
      const oldRel = relative(this.deps.notes.root(), oldPath).split(sep).join('/')
      const newRel = relative(this.deps.notes.root(), newPath).split(sep).join('/')
      const oldFolder = oldRel.includes('/') ? oldRel.slice(0, oldRel.lastIndexOf('/')) : ''
      const newFolder = newRel.includes('/') ? newRel.slice(0, newRel.lastIndexOf('/')) : ''
      const oldBase = basename(oldPath, '.md')
      const newBase = basename(newPath, '.md')
      const oldAudio = oldFolder ? `${oldFolder}/${oldBase}.webm` : `${oldBase}.webm`
      const newAudio = newFolder ? `${newFolder}/${newBase}.webm` : `${newBase}.webm`

      const moves: Array<{ oldKey: string; newKey: string; newName: string }> = [
        { oldKey: oldRel, newKey: newRel, newName: basename(newPath) },
        { oldKey: oldAudio, newKey: newAudio, newName: `${newBase}.webm` }
      ]

      try {
        const newParent = await this.ensureFolderPath(newFolder)
        const oldParent = oldFolder
          ? this.state.folders[oldFolder] ?? (await this.ensureRoot())
          : await this.ensureRoot()
        for (const move of moves) {
          const entry = this.state.files[move.oldKey]
          if (!entry) continue
          await this.api.updateFile(entry.fileId, {
            name: move.newName,
            addParents: newParent,
            removeParents: oldParent
          })
          delete this.state.files[move.oldKey]
          this.state.files[move.newKey] = { ...entry, uploadedAt: new Date().toISOString() }
          delete this.state.errors[move.oldKey]
        }

        const oldChatKey = chatKeyForNote(oldRel)
        const newChatKey = chatKeyForNote(newRel)
        const chatEntry = this.state.chats[oldChatKey]
        if (chatEntry) {
          const oldChatRemote = chatRemotePathForNote(oldRel)
          const newChatRemote = chatRemotePathForNote(newRel)
          const oldChatParent = parentRemotePath(oldChatRemote)
          const newChatParent = await this.ensureFolderPath(parentRemotePath(newChatRemote))
          const oldChatParentId = oldChatParent
            ? this.state.folders[oldChatParent] ?? (await this.ensureRoot())
            : await this.ensureRoot()
          await this.api.updateFile(chatEntry.fileId, {
            name: remoteFileName(newChatRemote),
            addParents: newChatParent,
            removeParents: oldChatParentId
          })
          delete this.state.chats[oldChatKey]
          this.state.chats[newChatKey] = {
            ...chatEntry,
            uploadedAt: new Date().toISOString()
          }
          delete this.state.chatErrors[oldChatKey]
        }

        this.saveState()
      } catch (error) {
        log.warn('No se pudo mover el archivo en Drive', error)
        this.state.errors[newRel] = (error as Error).message
        this.saveState()
      }
      this.emit()
    })
  }

  handleDelete(notePath: string): void {
    void this.withLock(async () => {
      if (!this.auth.connected()) return
      const rel = relative(this.deps.notes.root(), notePath).split(sep).join('/')
      const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
      const base = basename(notePath, '.md')
      const audio = folder ? `${folder}/${base}.webm` : `${base}.webm`
      for (const key of [rel, audio]) {
        const entry = this.state.files[key]
        if (!entry) continue
        try {
          await this.api.trash(entry.fileId)
        } catch (error) {
          log.warn('No se pudo enviar a papelera en Drive', error)
        }
        delete this.state.files[key]
        delete this.state.errors[key]
      }

      const chatKey = chatKeyForNote(rel)
      const chatEntry = this.state.chats[chatKey]
      if (chatEntry) {
        try {
          await this.api.trash(chatEntry.fileId)
        } catch (error) {
          log.warn('No se pudo enviar el chat a papelera en Drive', error)
        }
        delete this.state.chats[chatKey]
        delete this.state.chatErrors[chatKey]
      }

      this.saveState()
      this.emit()
    })
  }

  handleChatDelete(thread: { id: string; scope: 'note' | 'library'; notePath: string | null }): void {
    void this.withLock(async () => {
      if (!this.auth.connected()) return
      let key: string
      if (thread.scope === 'library' || !thread.notePath) {
        key = chatKeyForLibrary(thread.id)
      } else {
        const rel = relative(this.deps.notes.root(), thread.notePath).split(sep).join('/')
        key = chatKeyForNote(rel)
      }
      const entry = this.state.chats[key]
      if (!entry) return
      try {
        await this.api.trash(entry.fileId)
      } catch (error) {
        log.warn('No se pudo enviar el chat a papelera en Drive', error)
      }
      delete this.state.chats[key]
      delete this.state.chatErrors[key]
      this.saveState()
      this.emit()
    })
  }

  autoBackupEnabled(): boolean {
    return this.deps.settings.get().autoBackup && this.auth.connected()
  }

  chatAutoBackupEnabled(): boolean {
    return this.deps.settings.get().chatAutoBackup && this.auth.connected()
  }
}
