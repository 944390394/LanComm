import type { Lop2pApi } from './index'

declare global {
  interface Window {
    lop2p: Lop2pApi
  }
}

export {}
