import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.0.0-test',
    getPath: () => 'C:/tmp/chismosito-test',
    getAppPath: () => 'C:/tmp/chismosito-test',
    isPackaged: false
  }
}))

const { friendlyLlmError } = await import('../src/main/llm/summarizer')

describe('friendlyLlmError', () => {
  it('traduce el timeout de AbortSignal.timeout', () => {
    const error = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    expect(friendlyLlmError(error)).toContain('tardó demasiado en responder')
  })

  it('traduce mensajes de timeout aunque no sean instancias de Error', () => {
    expect(friendlyLlmError(new Error('The operation was aborted due to timeout'))).toContain(
      'tardó demasiado en responder'
    )
    expect(friendlyLlmError({ name: 'TimeoutError', message: 'timeout' })).toContain(
      'tardó demasiado en responder'
    )
  })

  it('traduce conexiones interrumpidas', () => {
    expect(friendlyLlmError(new Error('read ECONNRESET'))).toContain('No se pudo conectar')
    expect(friendlyLlmError(new Error('connect ETIMEDOUT'))).toContain('No se pudo conectar')
  })

  it('mantiene los mensajes de key inválida y de modelo bloqueado', () => {
    expect(friendlyLlmError(new Error('La API respondió 401 al pedir los modelos'))).toContain(
      'API key del LLM es inválida'
    )
    expect(friendlyLlmError(new Error('model access is disabled'))).toContain('acceso a este modelo')
  })

  it('deja pasar los mensajes desconocidos', () => {
    expect(friendlyLlmError(new Error('algo raro'))).toBe('algo raro')
  })
})
