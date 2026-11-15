import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/constants'
import type { AppEvent, ChismositoApi } from '../shared/types'

const api: ChismositoApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    openPath: (path) => ipcRenderer.invoke(IPC.appOpenPath, path),
    revealPath: (path) => ipcRenderer.invoke(IPC.appRevealPath, path),
    openExternal: (url) => ipcRenderer.invoke(IPC.appOpenExternal, url)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    chooseNotesDir: () => ipcRenderer.invoke(IPC.settingsChooseDir)
  },
  env: {
    status: () => ipcRenderer.invoke(IPC.envStatus)
  },
  recording: {
    start: (input) => ipcRenderer.invoke(IPC.recordingStart, input),
    sendWebmChunk: (id, chunk) => ipcRenderer.send(IPC.recordingWebmChunk, id, chunk),
    sendPcmChunk: (id, track, chunk) =>
      ipcRenderer.send(IPC.recordingPcmChunk, id, track, chunk),
    stop: (input) => ipcRenderer.invoke(IPC.recordingStop, input),
    cancel: (id) => ipcRenderer.invoke(IPC.recordingCancel, id),
    setState: (state) => ipcRenderer.send(IPC.recordingState, state)
  },
  jobs: {
    list: () => ipcRenderer.invoke(IPC.jobsList),
    retry: (id) => ipcRenderer.invoke(IPC.jobsRetry, id),
    cancel: (id) => ipcRenderer.invoke(IPC.jobsCancel, id)
  },
  notes: {
    list: () => ipcRenderer.invoke(IPC.notesList),
    get: (path) => ipcRenderer.invoke(IPC.notesGet, path),
    update: (input) => ipcRenderer.invoke(IPC.notesUpdate, input),
    move: (path, folder) => ipcRenderer.invoke(IPC.notesMove, path, folder),
    remove: (path) => ipcRenderer.invoke(IPC.notesDelete, path),
    folders: () => ipcRenderer.invoke(IPC.notesFolders),
    reveal: (path) => ipcRenderer.invoke(IPC.notesReveal, path),
    resummarize: (path) => ipcRenderer.invoke(IPC.notesResummarize, path),
    search: (query) => ipcRenderer.invoke(IPC.notesSearch, query)
  },
  whisper: {
    status: () => ipcRenderer.invoke(IPC.whisperStatus),
    downloadModel: () => ipcRenderer.invoke(IPC.whisperDownloadModel),
    downloadCuda: () => ipcRenderer.invoke(IPC.whisperDownloadCuda),
    cancelDownload: () => ipcRenderer.invoke(IPC.whisperCancelDownload)
  },
  llm: {
    test: () => ipcRenderer.invoke(IPC.llmTest)
  },
  drive: {
    status: () => ipcRenderer.invoke(IPC.driveStatus),
    connect: () => ipcRenderer.invoke(IPC.driveConnect),
    disconnect: () => ipcRenderer.invoke(IPC.driveDisconnect),
    backupAll: () => ipcRenderer.invoke(IPC.driveBackupAll),
    backupNote: (path) => ipcRenderer.invoke(IPC.driveBackupNote, path)
  },
  onEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AppEvent): void => listener(payload)
    ipcRenderer.on(IPC.event, wrapped)
    return () => ipcRenderer.removeListener(IPC.event, wrapped)
  }
}

contextBridge.exposeInMainWorld('chismosito', api)
