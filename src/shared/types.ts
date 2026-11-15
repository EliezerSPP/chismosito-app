export type ThemeSetting = 'system' | 'light' | 'dark'
export type WhisperDevice = 'auto' | 'cpu' | 'cuda'
export type NoteStatus =
  | 'recording'
  | 'processing'
  | 'complete'
  | 'summary_failed'
  | 'transcription_failed'
  | 'cancelled'

export type JobStage =
  | 'queued'
  | 'transcribing_mic'
  | 'transcribing_system'
  | 'merging'
  | 'summarizing'
  | 'finalizing'
  | 'done'
  | 'failed'
  | 'cancelled'

export type DriveSyncState = 'none' | 'pending' | 'synced' | 'failed'

export interface AppSettings {
  notesDir: string
  userName: string
  language: string
  micDeviceId: string | null
  recordMic: boolean
  recordSystem: boolean
  whisperDevice: WhisperDevice
  whisperThreads: number
  whisperModelPath: string | null
  keepTempWav: boolean
  llmModel: string
  folderSuggestions: boolean
  jevModel: string
  closeToTray: boolean
  launchAtLogin: boolean
  hotkey: string
  autoBackup: boolean
  chatAutoBackup: boolean
  driveFolderName: string
  theme: ThemeSetting
  onboardingDismissed: boolean
}

export interface EnvStatus {
  envPath: string
  llm: {
    configured: boolean
    baseUrl: string
    model: string
    source: 'env' | 'default'
  }
  jev: {
    configured: boolean
    baseUrl: string
    model: string
  }
  google: {
    clientConfigured: boolean
    tokenConfigured: boolean
    folderName: string
  }
  notesDirFromEnv: boolean
}

export interface WhisperModelStatus {
  present: boolean
  path: string
  name: string
  sizeBytes: number
  expectedBytes: number
  source: 'managed' | 'custom' | 'missing'
}

export interface WhisperStatus {
  cpuBinary: boolean
  cudaBinary: boolean
  activeDevice: 'cpu' | 'cuda'
  model: WhisperModelStatus
}

export type DownloadKind = 'model' | 'cuda'
export type DownloadStatus =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'done'
  | 'error'
  | 'cancelled'

export interface DownloadProgress {
  kind: DownloadKind
  status: DownloadStatus
  receivedBytes: number
  totalBytes: number
  percent: number
  message?: string
}

export interface RecordingStartInput {
  hasMic: boolean
  hasSystem: boolean
  startedAt: string
  language: string
}

export interface RecordingStartResult {
  id: string
  baseName: string
  notePath: string
  audioPath: string
  micWavPath: string | null
  systemWavPath: string | null
}

export interface RecordingStopInput {
  id: string
  durationSeconds: number
  micPeak: number
  systemPeak: number
}

export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'stopping'

export interface RecordingStateUpdate {
  phase: RecordingPhase
  recordingId: string | null
  elapsedSeconds: number
}

export interface RecorderSnapshot {
  phase: RecordingPhase
  id: string | null
  elapsedSeconds: number
  micLevel: number
  systemLevel: number
  error: string | null
  warning: string | null
  startedAt: string | null
}

export interface TranscriptLine {
  timestamp: string
  seconds: number
  speaker: string
  text: string
}

export interface NoteMeta {
  path: string
  relativePath: string
  fileName: string
  baseName: string
  title: string
  date: string | null
  durationSeconds: number
  language: string
  audio: string | null
  audioExists: boolean
  folder: string
  suggestedFolder: string | null
  suggestedFolderConfidence: number | null
  tags: string[]
  status: NoteStatus
  llm: string | null
  excerpt: string
  mtimeMs: number
  sizeBytes: number
  drive: DriveSyncState
  driveError: string | null
}

export interface NoteDetail extends NoteMeta {
  raw: string
  content: string
  transcript: TranscriptLine[]
}

export interface NoteUpdateInput {
  path: string
  title?: string
  tags?: string[]
  folder?: string
}

export interface FolderActionResult {
  movedNotes: number
  removedFolders: number
}

export interface Job {
  id: string
  baseName: string
  notePath: string
  audioPath: string
  micWavPath: string | null
  systemWavPath: string | null
  durationSeconds: number
  language: string
  hasMic: boolean
  hasSystem: boolean
  meetingDate: string
  stage: JobStage
  progress: number
  message: string
  error: string | null
  createdAt: string
  updatedAt: string
  transcriptChars: number
}

export interface DriveStatus {
  clientConfigured: boolean
  connected: boolean
  tokenSource: 'env' | 'stored' | 'none'
  folderName: string
  folderId: string | null
  lastBackupAt: string | null
  autoBackup: boolean
  root: string
  chats: {
    count: number
    lastBackupAt: string | null
  }
}

export interface DriveBackupSummary {
  total: number
  uploaded: number
  skipped: number
  failed: number
  errors: string[]
  chats: {
    uploaded: number
    skipped: number
    failed: number
  }
}

export interface DriveProgress {
  active: boolean
  current: string
  completed: number
  total: number
}

export interface LlmTestResult {
  ok: boolean
  model: string
  latencyMs: number
  error?: string
}

export type ChatScope = 'note' | 'library'

export interface ChatFilter {
  from: string | null
  to: string | null
  folder: string | null
}

export interface ChatSource {
  notePath: string
  title: string
  date: string | null
  timestamp?: string
  seconds?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  sources?: ChatSource[]
  error?: string | null
}

export interface ChatThread {
  id: string
  scope: ChatScope
  notePath: string | null
  noteTitle: string | null
  title: string
  messages: ChatMessage[]
  filters: ChatFilter | null
  createdAt: string
  updatedAt: string
}

export interface ChatThreadSummary {
  id: string
  scope: ChatScope
  notePath: string | null
  noteTitle: string | null
  title: string
  messageCount: number
  filters: ChatFilter | null
  updatedAt: string
}

export interface ChatOpenInput {
  scope: ChatScope
  notePath?: string | null
}

export interface ChatSendInput {
  threadId: string
  message: string
}

export interface ChatSendResult {
  requestId: string
  threadId: string
  userMessage: ChatMessage
}

export type ChatStreamEvent =
  | { type: 'started'; requestId: string; threadId: string }
  | { type: 'status'; requestId: string; threadId: string; label: string }
  | { type: 'delta'; requestId: string; threadId: string; text: string }
  | { type: 'done'; requestId: string; threadId: string; message: ChatMessage }
  | { type: 'error'; requestId: string; threadId: string; message: string }

export interface AppInfo {
  version: string
  platform: string
  userData: string
  appPath: string
  envPath: string
  notesDir: string
}

export type AppCommand = 'start-recording' | 'stop-recording' | 'open-settings' | 'open-note'

export type ToastLevel = 'info' | 'success' | 'error'

export type AppEvent =
  | { type: 'jobs'; jobs: Job[] }
  | { type: 'notes-changed' }
  | { type: 'download'; progress: DownloadProgress }
  | { type: 'drive'; status: DriveStatus }
  | { type: 'drive-progress'; progress: DriveProgress }
  | { type: 'command'; command: AppCommand; notePath?: string }
  | { type: 'recording-state'; state: RecordingStateUpdate }
  | { type: 'chat'; event: ChatStreamEvent }
  | { type: 'toast'; level: ToastLevel; message: string }

export interface ChismositoApi {
  app: {
    info(): Promise<AppInfo>
    openPath(path: string): Promise<void>
    revealPath(path: string): Promise<void>
    openExternal(url: string): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
    chooseNotesDir(): Promise<string | null>
  }
  env: {
    status(): Promise<EnvStatus>
  }
  recording: {
    start(input: RecordingStartInput): Promise<RecordingStartResult>
    sendWebmChunk(id: string, chunk: ArrayBuffer): void
    sendPcmChunk(id: string, track: 'mic' | 'system', chunk: ArrayBuffer): void
    stop(input: RecordingStopInput): Promise<Job>
    cancel(id: string): Promise<void>
    setState(state: RecordingStateUpdate): void
  }
  jobs: {
    list(): Promise<Job[]>
    retry(id: string): Promise<void>
    cancel(id: string): Promise<void>
  }
  notes: {
    list(): Promise<NoteMeta[]>
    get(path: string): Promise<NoteDetail | null>
    update(input: NoteUpdateInput): Promise<NoteDetail>
    move(path: string, folder: string | null): Promise<NoteDetail>
    remove(path: string): Promise<void>
    folders(): Promise<string[]>
    clearFolderSuggestion(path: string): Promise<NoteDetail>
    reveal(path: string): Promise<void>
    resummarize(path: string): Promise<void>
    search(query: string): Promise<NoteMeta[]>
  }
  folders: {
    create(path: string): Promise<FolderActionResult>
    rename(path: string, newName: string): Promise<FolderActionResult>
    remove(path: string): Promise<FolderActionResult>
  }
  whisper: {
    status(): Promise<WhisperStatus>
    downloadModel(): Promise<WhisperStatus>
    downloadCuda(): Promise<WhisperStatus>
    cancelDownload(): Promise<void>
  }
  llm: {
    test(): Promise<LlmTestResult>
  }
  jev: {
    test(): Promise<LlmTestResult>
  }
  chat: {
    threads(scope: ChatScope): Promise<ChatThreadSummary[]>
    get(threadId: string): Promise<ChatThread | null>
    open(input: ChatOpenInput): Promise<ChatThread>
    create(): Promise<ChatThread>
    send(input: ChatSendInput): Promise<ChatSendResult>
    retry(threadId: string): Promise<ChatSendResult>
    cancel(requestId: string): Promise<void>
    clear(threadId: string): Promise<ChatThread>
    remove(threadId: string): Promise<void>
    updateFilters(threadId: string, filters: ChatFilter | null): Promise<ChatThreadSummary>
    backup(threadId: string): Promise<void>
  }
  drive: {
    status(): Promise<DriveStatus>
    connect(): Promise<DriveStatus>
    disconnect(): Promise<DriveStatus>
    backupAll(): Promise<DriveBackupSummary>
    backupNote(path: string): Promise<void>
  }
  onEvent(listener: (event: AppEvent) => void): () => void
}
