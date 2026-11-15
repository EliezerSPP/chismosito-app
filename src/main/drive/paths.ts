const CHAT_ROOT = 'Conversaciones'
const GLOBAL_FOLDER = `${CHAT_ROOT}/Global`

export function normalizeChatRelativePath(noteRelativePath: string): string {
  return noteRelativePath.replace(/\\/g, '/').replace(/^\/+/, '')
}

export function chatKeyForNote(noteRelativePath: string): string {
  return `note:${normalizeChatRelativePath(noteRelativePath)}`
}

export function chatKeyForLibrary(threadId: string): string {
  return `global:${threadId}`
}

export function chatRemotePathForNote(noteRelativePath: string): string {
  const clean = normalizeChatRelativePath(noteRelativePath).replace(/\.md$/i, '')
  return `${CHAT_ROOT}/${clean}.json`
}

export function chatRemotePathForLibrary(threadId: string): string {
  return `${GLOBAL_FOLDER}/${threadId}.json`
}

export function parentRemotePath(remotePath: string): string {
  const index = remotePath.lastIndexOf('/')
  return index >= 0 ? remotePath.slice(0, index) : ''
}

export function remoteFileName(remotePath: string): string {
  const index = remotePath.lastIndexOf('/')
  return index >= 0 ? remotePath.slice(index + 1) : remotePath
}
