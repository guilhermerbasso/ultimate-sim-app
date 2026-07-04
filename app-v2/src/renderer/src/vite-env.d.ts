/// <reference types="vite/client" />

import type { IpcBridge } from '../../shared/bridge'
import type { ButtonBoxApi } from '../../shared/ipc'

declare global {
  interface Window {
    api: ButtonBoxApi
    ipc: IpcBridge
  }
}

export {}
