export const TUTORIAL_SEEN_STORAGE_KEY = 'usa.tutorial.seen.v1'
export const TUTORIAL_AUTO_DISABLED_STORAGE_KEY = 'usa.tutorial.autoDisabled.v1'

function readStringArray(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeStringArray(key: string, value: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...new Set(value)]))
  } catch {
    // Tutorial persistence is non-critical.
  }
}

export function readSeenTutorialIds(): string[] {
  return readStringArray(TUTORIAL_SEEN_STORAGE_KEY)
}

export function isTutorialSeen(viewId: string): boolean {
  return readSeenTutorialIds().includes(viewId)
}

export function markTutorialSeen(viewId: string): void {
  const seen = readSeenTutorialIds()
  if (!seen.includes(viewId)) writeStringArray(TUTORIAL_SEEN_STORAGE_KEY, [...seen, viewId])
}

export function readTutorialAutoDisabled(): boolean {
  try {
    return window.localStorage.getItem(TUTORIAL_AUTO_DISABLED_STORAGE_KEY) === 'true'
  } catch {
    return true
  }
}

export function writeTutorialAutoDisabled(disabled: boolean): void {
  try {
    window.localStorage.setItem(TUTORIAL_AUTO_DISABLED_STORAGE_KEY, disabled ? 'true' : 'false')
  } catch {
    // Tutorial persistence is non-critical.
  }
}
