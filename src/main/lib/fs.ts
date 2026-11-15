import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

export function writeAtomic(path: string, content: string): void {
  ensureDir(dirname(path))
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, path)
}

export function readText(path: string): string {
  return readFileSync(path, 'utf8')
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

export function slugifyFileName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
    .slice(0, 80)
}

export function safeFolderName(name: string): string | null {
  const cleaned = slugifyFileName(name).replace(/\.+$/g, '').trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return null
  return cleaned
}

export function uniquePath(basePath: string, exists: (candidate: string) => boolean): string {
  if (!exists(basePath)) return basePath
  const ext = basePath.endsWith('.md') ? '.md' : ''
  const stem = ext ? basePath.slice(0, -ext.length) : basePath
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${stem}-${String(i).padStart(2, '0')}${ext}`
    if (!exists(candidate)) return candidate
  }
  throw new Error('No se pudo generar un nombre de archivo único')
}

export function isInside(parent: string, child: string): boolean {
  const normalizedParent = parent.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const normalizedChild = child.replace(/\\/g, '/').toLowerCase()
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`)
}

export function joinRelative(...parts: string[]): string {
  return parts.filter(Boolean).join('/')
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}

export function fileExists(path: string): boolean {
  return existsSync(path)
}

export function parentFolder(path: string): string {
  return dirname(path)
}

export function basenameNoExt(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path
  return name.replace(/\.[^.]+$/, '')
}

export function joinPath(...parts: string[]): string {
  return join(...parts)
}
