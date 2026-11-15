import { DEFAULT_LLM_BASE_URL } from './constants'

/**
 * OpenCode exposes a gateway at https://opencode.ai/inference with
 * provider-specific sub-paths. The OpenAI-compatible base used by the SDK is
 * https://opencode.ai/inference/openai/v1. Accept the short form so the .env
 * stays simple, and leave other OpenAI-compatible providers untouched.
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
