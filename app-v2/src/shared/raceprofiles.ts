export interface RaceProfileMatch {
  carName?: string
  trackName?: string
}

export interface RaceProfile {
  id: string
  name: string
  match?: RaceProfileMatch
  buttonboxProfile?: string
  oled?: any
  overlays?: any
  alerts?: any
  bindings?: any
  /** Per-effect intensity overrides saved from the haptics config at capture time. */
  hapticsGains?: Partial<Record<string, number>>
}

export interface RaceProfileSuggestion {
  profileId: string
  carName?: string
  trackName?: string
}

const INVALID_RACE_PROFILE_SNAPSHOT = Symbol('invalid-race-profile-snapshot')
const RACE_PROFILE_SNAPSHOT_MAX_DEPTH = 32
const RACE_PROFILE_SNAPSHOT_MAX_NODES = 50_000
const RACE_PROFILE_SNAPSHOT_MAX_ARRAY_ITEMS = 10_000
const RACE_PROFILE_SNAPSHOT_MAX_OBJECT_KEYS = 10_000

interface RaceProfileSnapshotCloneState {
  nodes: number
  stack: WeakSet<object>
}

function isPlainSnapshotObject(value: object): boolean {
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function cloneRaceProfileSnapshot(
  value: unknown,
  state: RaceProfileSnapshotCloneState,
  depth: number
): unknown | typeof INVALID_RACE_PROFILE_SNAPSHOT {
  if (depth > RACE_PROFILE_SNAPSHOT_MAX_DEPTH || ++state.nodes > RACE_PROFILE_SNAPSHOT_MAX_NODES) {
    return INVALID_RACE_PROFILE_SNAPSHOT
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : INVALID_RACE_PROFILE_SNAPSHOT
  }
  if (typeof value !== 'object') return INVALID_RACE_PROFILE_SNAPSHOT
  if (state.stack.has(value)) return INVALID_RACE_PROFILE_SNAPSHOT

  try {
    const symbols = Object.getOwnPropertySymbols(value)
    if (symbols.some((symbol) => Object.getOwnPropertyDescriptor(value, symbol)?.enumerable)) {
      return INVALID_RACE_PROFILE_SNAPSHOT
    }

    state.stack.add(value)
    if (Array.isArray(value)) {
      if (value.length > RACE_PROFILE_SNAPSHOT_MAX_ARRAY_ITEMS) return INVALID_RACE_PROFILE_SNAPSHOT
      const descriptors = Object.getOwnPropertyDescriptors(value)
      const extraKey = Object.keys(descriptors).find((key) => {
        if (key === 'length') return false
        if (!/^(0|[1-9]\d*)$/.test(key)) return descriptors[key].enumerable
        return Number(key) >= value.length
      })
      if (extraKey) return INVALID_RACE_PROFILE_SNAPSHOT

      const clone: unknown[] = []
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)]
        if (!descriptor?.enumerable || !('value' in descriptor)) return INVALID_RACE_PROFILE_SNAPSHOT
        const item = cloneRaceProfileSnapshot(descriptor.value, state, depth + 1)
        if (item === INVALID_RACE_PROFILE_SNAPSHOT) return item
        clone.push(item)
      }
      return clone
    }

    if (!isPlainSnapshotObject(value)) return INVALID_RACE_PROFILE_SNAPSHOT
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Object.keys(descriptors).filter((key) => descriptors[key].enumerable)
    if (keys.length > RACE_PROFILE_SNAPSHOT_MAX_OBJECT_KEYS) return INVALID_RACE_PROFILE_SNAPSHOT

    const clone: Record<string, unknown> = {}
    for (const key of keys) {
      const descriptor = descriptors[key]
      if (!('value' in descriptor)) return INVALID_RACE_PROFILE_SNAPSHOT
      if (descriptor.value === undefined) continue
      const item = cloneRaceProfileSnapshot(descriptor.value, state, depth + 1)
      if (item === INVALID_RACE_PROFILE_SNAPSHOT) return item
      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: true,
        value: item,
        writable: true
      })
    }
    return clone
  } catch {
    return INVALID_RACE_PROFILE_SNAPSHOT
  } finally {
    state.stack.delete(value)
  }
}

export function sanitizeRaceProfileSnapshot(value: unknown): unknown | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!Array.isArray(value) && !isPlainSnapshotObject(value)) return undefined
  const clone = cloneRaceProfileSnapshot(value, { nodes: 0, stack: new WeakSet<object>() }, 0)
  return clone === INVALID_RACE_PROFILE_SNAPSHOT ? undefined : clone
}
