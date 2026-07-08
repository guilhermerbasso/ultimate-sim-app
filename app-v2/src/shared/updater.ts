export const UPDATE_CHANNELS = {
  check: 'app:update:check',
  download: 'app:update:download',
  installNow: 'app:update:installNow',
  status: 'app:update:status'
} as const

export type UpdateEventType =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'progress'
  | 'downloaded'
  | 'error'

export type UpdateState =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

export interface UpdaterStatus {
  currentVersion: string
  enabled: boolean
  state: UpdateState
  downloaded: boolean
  updateVersion?: string
  releaseName?: string | null
  progressPercent?: number
  error?: string
}

export interface UpdaterEvent {
  event: UpdateEventType
  status: UpdaterStatus
  message?: string
}

export interface UpdaterIpcResult {
  ok: boolean
  status: UpdaterStatus
  message?: string
}

