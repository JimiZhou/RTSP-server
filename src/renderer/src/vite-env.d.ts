/// <reference types="vite/client" />

import type { RTSPDesktopApi } from '../../shared/types'

declare global {
  interface Window {
    rtspApp: RTSPDesktopApi
  }
}

export {}
