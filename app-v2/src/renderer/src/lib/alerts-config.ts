import { useSyncExternalStore } from 'react'
import { DEFAULT_ALERTS_CONFIG, type AlertsConfig } from '../../../shared/alerts'

let currentConfig = DEFAULT_ALERTS_CONFIG
let started = false
const listeners = new Set<() => void>()

function publish(nextConfig: AlertsConfig): void {
  currentConfig = nextConfig
  for (const listener of listeners) listener()
}

function startRuntimeConfig(): void {
  if (started || typeof window === 'undefined') return
  started = true
  window.ipc.subscribe<AlertsConfig>('alerts:config', publish)
  void window.ipc.invoke<AlertsConfig>('alerts:getConfig')
    .then(publish)
    .catch((error) => {
      console.error('[alerts] failed to load runtime config:', error)
    })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  startRuntimeConfig()
  return () => listeners.delete(listener)
}

function getSnapshot(): AlertsConfig {
  return currentConfig
}

export function useAlertsConfig(override?: AlertsConfig): AlertsConfig {
  const sharedConfig = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_ALERTS_CONFIG
  )
  return override ?? sharedConfig
}
