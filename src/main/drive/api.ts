import { net } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { DriveAuth } from './auth'
import { log } from '../lib/logger'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

interface DriveFile {
  id: string
  name?: string
  mimeType?: string
  modifiedTime?: string
  parents?: string[]
  trashed?: boolean
}

export class DriveApi {
  constructor(private readonly auth: DriveAuth) {}

  private async requestJson<T>(url: string, init: RequestInit = {}, retry = true): Promise<T> {
    const token = await this.auth.accessToken(!retry)
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    const response = await net.fetch(url, { ...init, headers })
    if (response.status === 401 && retry) {
      return this.requestJson<T>(url, init, false)
    }
    if (!response.ok) {
      throw new Error(await driveError(response))
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  async findFolder(name: string, parentId: string | null): Promise<DriveFile | null> {
    const parentClause = parentId ? ` and '${escapeQuery(parentId)}' in parents` : ''
    const q = `name='${escapeQuery(name)}' and mimeType='${FOLDER_MIME}' and trashed=false${parentClause}`
    const fields = 'files(id,name,mimeType,parents,trashed)'
    const result = await this.requestJson<{ files: DriveFile[] }>(
      `${API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&spaces=drive&pageSize=10`
    )
    return result.files?.[0] ?? null
  }

  async createFolder(name: string, parentId: string | null): Promise<DriveFile> {
    const metadata: Record<string, unknown> = { name, mimeType: FOLDER_MIME }
    if (parentId) metadata.parents = [parentId]
    return this.requestJson<DriveFile>(`${API}/files?fields=id,name,parents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    })
  }

  async ensureFolder(name: string, parentId: string | null): Promise<string> {
    const existing = await this.findFolder(name, parentId)
    if (existing) return existing.id
    const created = await this.createFolder(name, parentId)
    return created.id
  }

  async getFile(fileId: string): Promise<DriveFile> {
    return this.requestJson<DriveFile>(
      `${API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,parents,trashed`
    )
  }

  async uploadFile(options: {
    localPath: string
    relativePath: string
    mimeType: string
    parentId: string
    fileId?: string | null
  }): Promise<DriveFile> {
    const info = await stat(options.localPath)
    if (info.size > 512 * 1024 * 1024) {
      throw new Error('El archivo supera el límite de 512 MB para respaldo')
    }
    const content = await readFile(options.localPath)
    const token = await this.auth.accessToken()
    const metadata = {
      name: basename(options.localPath),
      mimeType: options.mimeType,
      appProperties: { chismositoPath: options.relativePath }
    }

    const initUrl = options.fileId
      ? `${UPLOAD}/files/${encodeURIComponent(options.fileId)}?uploadType=resumable&fields=id,name,modifiedTime,parents`
      : `${UPLOAD}/files?uploadType=resumable&fields=id,name,modifiedTime,parents`
    const initBody = options.fileId
      ? { name: metadata.name, appProperties: metadata.appProperties }
      : { ...metadata, parents: [options.parentId] }

    const initResponse = await net.fetch(initUrl, {
      method: options.fileId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
        'X-Upload-Content-Type': options.mimeType,
        'X-Upload-Content-Length': String(content.byteLength)
      },
      body: JSON.stringify(initBody)
    })
    if (!initResponse.ok) throw new Error(await driveError(initResponse))
    const location = initResponse.headers.get('location')
    if (!location) throw new Error('Google Drive no devolvió la URL de subida')

    const uploadResponse = await net.fetch(location, {
      method: 'PUT',
      headers: {
        'Content-Type': options.mimeType
      },
      body: content as unknown as BodyInit
    })
    if (!uploadResponse.ok) throw new Error(await driveError(uploadResponse))
    return (await uploadResponse.json()) as DriveFile
  }

  async updateFile(
    fileId: string,
    changes: { name?: string; addParents?: string; removeParents?: string }
  ): Promise<DriveFile> {
    const params = new URLSearchParams({ fields: 'id,name,parents' })
    if (changes.addParents) params.set('addParents', changes.addParents)
    if (changes.removeParents) params.set('removeParents', changes.removeParents)
    const body: Record<string, unknown> = {}
    if (changes.name) body.name = changes.name
    return this.requestJson<DriveFile>(`${API}/files/${encodeURIComponent(fileId)}?${params}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  async trash(fileId: string): Promise<void> {
    await this.requestJson<void>(`${API}/files/${encodeURIComponent(fileId)}?fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    })
  }

  async healthCheck(): Promise<void> {
    await this.requestJson<{ user?: { emailAddress?: string } }>(`${API}/about?fields=user`)
  }

  async findFileByPath(relativePath: string, parentId: string | null): Promise<DriveFile | null> {
    const parentClause = parentId ? ` and '${escapeQuery(parentId)}' in parents` : ''
    const q = `appProperties has { key='chismositoPath' and value='${escapeQuery(relativePath)}' } and trashed=false${parentClause}`
    const result = await this.requestJson<{ files: DriveFile[] }>(
      `${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,parents,modifiedTime)&spaces=drive&pageSize=10`
    )
    return result.files?.[0] ?? null
  }
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export async function driveError(response: Response): Promise<string> {
  let detail = ''
  try {
    const body = (await response.json()) as { error?: { message?: string; status?: string } }
    detail = body.error?.message ?? body.error?.status ?? ''
  } catch {
    try {
      detail = await response.text()
    } catch {
      // ignore
    }
  }
  if (response.status === 401) return 'La sesión de Google Drive expiró. Vuelve a conectar Drive.'
  if (response.status === 403 && /quota|storage/i.test(detail)) {
    return 'Google Drive no tiene espacio disponible o la cuenta alcanzó su cuota.'
  }
  if (response.status === 404) return 'El archivo ya no existe en Google Drive.'
  log.warn('Drive API error', response.status, detail)
  return `Google Drive respondió ${response.status}${detail ? `: ${detail}` : ''}`
}
