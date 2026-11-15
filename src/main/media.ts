import { protocol } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { isInside } from './lib/fs'
import { log } from './lib/logger'

export function registerMediaProtocol(getRoot: () => string): void {
  protocol.handle('chismosito-media', async (request) => {
    try {
      const url = new URL(request.url)
      const rawPath = url.searchParams.get('path')
      if (!rawPath) return new Response('Falta el parámetro path', { status: 400 })
      const filePath = resolve(rawPath)
      if (!isInside(getRoot(), filePath)) {
        return new Response('Ruta no permitida', { status: 403 })
      }
      const info = await stat(filePath)
      if (!info.isFile()) return new Response('No encontrado', { status: 404 })

      const type = mimeFor(filePath)
      const baseHeaders: Record<string, string> = {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      }

      if (request.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { ...baseHeaders, 'Content-Length': String(info.size) }
        })
      }

      const range = request.headers.get('range')
      if (range) {
        const parsed = /bytes=(\d*)-(\d*)/.exec(range)
        if (parsed) {
          const start = parsed[1] ? Number(parsed[1]) : 0
          let end = parsed[2] ? Number(parsed[2]) : info.size - 1
          if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= info.size) {
            return new Response('Rango inválido', {
              status: 416,
              headers: { 'Content-Range': `bytes */${info.size}` }
            })
          }
          end = Math.min(end, info.size - 1)
          const data = await readFile(filePath)
          const slice = data.subarray(start, end + 1)
          return new Response(slice, {
            status: 206,
            headers: {
              ...baseHeaders,
              'Content-Range': `bytes ${start}-${end}/${info.size}`,
              'Content-Length': String(slice.byteLength)
            }
          })
        }
      }

      const data = await readFile(filePath)
      return new Response(data, {
        status: 200,
        headers: { ...baseHeaders, 'Content-Length': String(data.byteLength) }
      })
    } catch (error) {
      log.warn('No se pudo servir el audio', error)
      return new Response('No encontrado', { status: 404 })
    }
  })
}

function mimeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.webm':
      return 'audio/webm'
    case '.wav':
      return 'audio/wav'
    case '.mp3':
      return 'audio/mpeg'
    case '.ogg':
      return 'audio/ogg'
    case '.md':
      return 'text/markdown; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    default:
      return 'application/octet-stream'
  }
}
