/// <reference types="vite/client" />

import type { PreloadAPI } from '../../preload/index'

declare global {
  interface Window {
    api: PreloadAPI
  }
}
