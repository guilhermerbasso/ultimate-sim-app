import {
  sanitizeContextDebtSourceSnapshot,
  type ContextDebtConfigSnapshot,
  type ContextDebtSourceFamily
} from '../../../shared/context-debt'

export interface ContextDebtRecoverableSnapshot extends ContextDebtConfigSnapshot {
  sourceAvailability: Partial<Record<ContextDebtSourceFamily, boolean>>
}

const SNAPSHOT_KEY_BY_SOURCE: Record<ContextDebtSourceFamily, keyof ContextDebtConfigSnapshot> = {
  alerts: 'alerts',
  overlays: 'overlays',
  sounds: 'sounds',
  haptics: 'haptics',
  zonalHaptics: 'zonalHaptics',
  controls: 'bindings',
  spotter: 'spotter',
  spotter3d: 'spotter3d',
  engineer: 'engineer',
  coach: 'coach'
}

export function recoverContextDebtSource<Snapshot extends ContextDebtRecoverableSnapshot>(
  current: Snapshot | null,
  source: ContextDebtSourceFamily,
  value: unknown
): Snapshot | null {
  if (!current) return current
  const sanitized = sanitizeContextDebtSourceSnapshot(source, value)
  if (sanitized === undefined) return current
  const key = SNAPSHOT_KEY_BY_SOURCE[source]
  return {
    ...current,
    [key]: sanitized,
    sourceAvailability: {
      ...current.sourceAvailability,
      [source]: true
    }
  }
}
