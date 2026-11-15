import type { ChismositoApi } from '../shared/types'

declare global {
  interface Window {
    chismosito: ChismositoApi
  }
}

export {}
