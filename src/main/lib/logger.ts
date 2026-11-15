import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let logFile: string | null = null

function file(): string {
  if (logFile) return logFile
  const dir = join(app.getPath('userData'), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  logFile = join(dir, 'app.log')
  return logFile
}

function write(level: string, scope: string, args: unknown[]): void {
  const message = args
    .map((arg) => {
      if (arg instanceof Error) return `${arg.message}\n${arg.stack ?? ''}`
      if (typeof arg === 'string') return arg
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
  const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${message}\n`
  try {
    appendFileSync(file(), line, 'utf8')
  } catch {
    // Logging must never crash the app.
  }
  if (level === 'error') console.error(`[${scope}]`, ...args)
  else console.log(`[${scope}]`, ...args)
}

export function createLogger(scope: string) {
  return {
    info: (...args: unknown[]) => write('info', scope, args),
    warn: (...args: unknown[]) => write('warn', scope, args),
    error: (...args: unknown[]) => write('error', scope, args)
  }
}

export const log = createLogger('app')
