import { DEFAULT_LLM_BASE_URL } from './constants'

/**
 * OpenCode exposes a gateway at https://opencode.ai/inference with
 * provider-specific sub-paths. Chismosito usa por defecto OpenCode Go, cuya
 * base compatible con el SDK es https://opencode.ai/inference/go/openai/v1.
 * La raíz del gateway se expande a esa ruta; /inference/openai/v1 (pago por
 * uso) se respeta tal cual. Los demás proveedores no se tocan.
 */
export function normalizeLlmBaseUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '')
  if (!value) return DEFAULT_LLM_BASE_URL
  try {
    const url = new URL(value)
    if (url.hostname.toLowerCase() === 'opencode.ai') {
      let path = url.pathname.replace(/\/+$/, '')
      if (path === '' || path === '/' || path === '/inference') {
        path = '/inference/go/openai/v1'
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
