import type { ChatStreamEvent } from '@shared/types'

type Listener = (event: ChatStreamEvent) => void

const listeners = new Set<Listener>()

export function subscribeChat(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishChat(event: ChatStreamEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // Un panel cerrado no debe romper el resto.
    }
  }
}
