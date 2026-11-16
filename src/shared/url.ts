import { DEFAULT_LLM_BASE_URL } from './constants'

/**
 * OpenCode exposes a gateway at https://opencode.ai/inference with
 * provider-specific sub-paths. El default de Chismosito es OpenCode Go, cuya
 * base compatible con el SDK es https://opencode.ai/inference/go/openai/v1.
 * La raíz del gateway conserva la ruta de pago por uso
 * (/inference/openai/v1) para no romper los .env existentes; Go se pide
 * explícitamente con la sub-ruta /go/. Los demás proveedores no se tocan.
 */
export function normalizeLlmBaseUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '')
  if (!value) return DEFAULT_LLM_BASE_URL
  try {
    const url = new URL(value)
    if (url.hostname.toLowerCase() === 'opencode.ai') {
      let path = url.pathname.replace(/\/+$/, '')
      if (path === '' || path === '/' || path === '/inference') {
        path = '/inference/openai/v1'
      } else if (path === '/inference/go' || path === '/inference/go/openai') {
        path = '/inference/go/openai/v1'
      } else if (path === '/inference/openai') {
        path = '/inference/openai/v1'
      }
      url.pathname = path
      return url.toString().replace(/\/+$/, '')
    }
    return url.toString().replace(/\/+$/, '')
  } catch {
    return value
  }
}
