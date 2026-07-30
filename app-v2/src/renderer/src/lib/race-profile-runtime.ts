import { useEffect, useRef } from 'react'
import type { RaceProfile, RaceProfileSuggestion } from '../../../shared/raceprofiles'
import {
  applyRaceProfileSections,
  describeRaceProfileFailure,
  type RaceProfileApplyResult,
  type RaceProfileSection
} from '../../../shared/race-profile-apply'

export { describeRaceProfileFailure }
export type { RaceProfileApplyResult }

// ─── App-level race-profile runtime ───────────────────────────────────────────
//
// Auto-switch used to live inside RaceProfilesView, so a suggestion broadcast on
// `profilesv2:suggest` only ever applied a profile while that specific screen was
// mounted — never during an actual race, which is the only time it matters. The
// subscription now lives here and is mounted ONCE in App.tsx, next to
// useGlobalActionRuntime / useEngineerActionRuntime.
//
// Both the automatic path and the manual "Apply" button go through
// applyRaceProfile(), so there is exactly one transactional apply in the app.

export type RaceProfileToast = (message: string, kind?: 'success' | 'error' | 'info') => void

/** Minimal IPC surface this runtime needs, injectable so it can be driven in tests. */
export type RaceProfileIpc = {
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>
}

function defaultIpc(): RaceProfileIpc {
  return window.ipc as unknown as RaceProfileIpc
}

/**
 * Sections in application order. Every transactional section has a matching getter, so
 * the previous value can be restored if a later section fails. Haptics stays best-effort
 * (it was already `.catch(() => undefined)`) because the subsystem may be absent.
 */
export function raceProfileSections(profile: RaceProfile, ipc: RaceProfileIpc = defaultIpc()): Array<RaceProfileSection<any>> {
  return [
    {
      id: 'oled',
      value: profile.oled,
      read: () => ipc.invoke('oled:getConfig'),
      write: async (value) => {
        await ipc.invoke('oled:setConfig', value)
      }
    },
    {
      id: 'overlays',
      value: profile.overlays,
      read: () => ipc.invoke('overlays:getConfig'),
      write: async (value) => {
        await ipc.invoke('overlays:setConfig', value)
      }
    },
    {
      id: 'alerts',
      value: profile.alerts,
      read: () => ipc.invoke('alerts:getConfig'),
      write: async (value) => {
        await ipc.invoke('alerts:setConfig', value)
      }
    },
    {
      id: 'bindings',
      value: profile.bindings,
      read: () => ipc.invoke('actions:getBindings'),
      write: async (value) => {
        await ipc.invoke('actions:setBindings', value)
      }
    },
    {
      id: 'haptics',
      value: hapticsEffectsPatch(profile),
      bestEffort: true,
      read: () => undefined,
      write: async (value) => {
        await ipc.invoke('haptics:setConfig', { effects: value })
      }
    }
  ]
}

function hapticsEffectsPatch(profile: RaceProfile): Record<string, { intensity: number }> | undefined {
  const gains = profile.hapticsGains
  if (!gains || Object.keys(gains).length === 0) return undefined
  const patch: Record<string, { intensity: number }> = {}
  for (const [id, intensity] of Object.entries(gains)) patch[id] = { intensity: intensity as number }
  return patch
}

export type RaceProfileDeviceApply = {
  connected: boolean
  applyButtonbox: (profileName: string) => Promise<void>
}

/**
 * Apply a race profile as one transaction. The button-box device step runs LAST and
 * only after every app-side section committed, so a device failure can never leave the
 * app half-configured — and if it fails, the app sections are rolled back too.
 */
export async function applyRaceProfile(
  profile: RaceProfile,
  device?: RaceProfileDeviceApply,
  ipc: RaceProfileIpc = defaultIpc()
): Promise<RaceProfileApplyResult> {
  const sections = raceProfileSections(profile, ipc)
  if (profile.buttonboxProfile && device?.connected) {
    sections.push({
      id: 'buttonbox',
      value: profile.buttonboxProfile,
      // The device is written wholesale from a stored profile; there is no readable
      // "previous device profile" to restore, so this section only ever fails forward.
      read: () => undefined,
      write: (value) => device.applyButtonbox(String(value))
    })
  }
  return applyRaceProfileSections(sections)
}

/**
 * Resolve and apply a broadcast suggestion. Extracted from the hook so the whole
 * decision — honour auto-switch, resolve the profile, apply transactionally, surface a
 * failure — is testable without React.
 *
 * The auto-switch flag and the profile list are re-read on every suggestion so the
 * runtime can never act on a stale copy held by a screen that happens to be mounted.
 */
export async function handleRaceProfileSuggestion(
  suggestion: RaceProfileSuggestion | null | undefined,
  options: { ipc?: RaceProfileIpc; device?: RaceProfileDeviceApply; showToast?: RaceProfileToast } = {}
): Promise<RaceProfileApplyResult | null> {
  const ipc = options.ipc ?? defaultIpc()
  if (!suggestion?.profileId) return null
  const enabled = await ipc.invoke<boolean>('profilesv2:getAutoSwitch')
  if (!enabled) return null
  const profiles = await ipc.invoke<RaceProfile[]>('profilesv2:list')
  const profile = (profiles ?? []).find((candidate) => candidate.id === suggestion.profileId)
  if (!profile) return null
  const result = await applyRaceProfile(profile, options.device, ipc)
  if (!result.ok) options.showToast?.(describeRaceProfileFailure(result), 'error')
  return result
}

/**
 * Subscribes to profile suggestions and applies them when auto-switch is on. Mounted at
 * the app shell so it works on every screen.
 */
export function useRaceProfileAutoSwitch(showToast: RaceProfileToast, device?: RaceProfileDeviceApply): void {
  const deviceRef = useRef(device)
  deviceRef.current = device
  const toastRef = useRef(showToast)
  toastRef.current = showToast
  const applying = useRef(false)

  useEffect(() => {
    const unsubscribe = window.ipc.subscribe<RaceProfileSuggestion>('profilesv2:suggest', (suggestion) => {
      void (async () => {
        if (applying.current) return
        applying.current = true
        try {
          await handleRaceProfileSuggestion(suggestion, {
            device: deviceRef.current,
            showToast: (message, kind) => toastRef.current(message, kind)
          })
        } catch {
          // A suggestion that cannot be resolved is not worth interrupting a race for.
        } finally {
          applying.current = false
        }
      })()
    })
    return unsubscribe
  }, [])
}
