import type { DotoApi } from '../shared/types'

declare global {
  interface Window {
    doto: DotoApi
  }
}
