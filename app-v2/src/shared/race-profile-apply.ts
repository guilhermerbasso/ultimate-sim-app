// Transactional application of a race profile.
//
// Applying a profile touches several independent subsystems (OLED, overlays, alerts,
// button bindings, haptics, button-box device). Applying them one after another with a
// single try/catch means that a failure part-way leaves the app in a state that matches
// NO profile: the OLED page from the new profile, the overlays from the old one, and the
// user with no indication of which half took effect.
//
// This module snapshots every section BEFORE anything is written, applies in order, and
// on failure restores the sections that were already applied, in reverse order. It is
// deliberately transport-free — the caller supplies read/write functions — so the whole
// commit/rollback contract is unit-testable without Electron or IPC.

export type RaceProfileSection<T = unknown> = {
  /** Stable id used in results and in the rollback report. */
  id: string
  /** The value this profile wants applied. `undefined` means "this profile does not set it". */
  value: T | undefined
  /** Current value, captured before anything is written. */
  read: () => Promise<T> | T
  /** Write the profile's value. */
  write: (value: T) => Promise<void> | void
  /**
   * Best-effort sections do not participate in the transaction: their failure is
   * reported but neither aborts the apply nor triggers a rollback, and they are not
   * restored. Use for subsystems that may legitimately be absent (optional hardware).
   */
  bestEffort?: boolean
}

export type RaceProfileApplyResult = {
  ok: boolean
  /** Sections that were written and kept. */
  applied: string[]
  /** Sections the profile does not set. */
  skipped: string[]
  /** Best-effort sections that failed without aborting. */
  degraded: string[]
  /** Set when the transaction aborted. */
  failedSection?: string
  error?: Error
  /** Sections restored to their pre-apply value after the abort. */
  rolledBack?: string[]
  /**
   * Sections whose restore ALSO failed. Non-empty means the app is in a mixed state and
   * the user must be told — silently reporting a clean rollback would be a lie.
   */
  rollbackFailed?: string[]
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Apply the sections of a race profile atomically.
 *
 * 1. Snapshot every participating section. A snapshot failure aborts before ANY write,
 *    so the app is untouched.
 * 2. Write in order.
 * 3. On the first failure, restore the already-written sections in reverse order and
 *    report exactly what was rolled back and what could not be.
 */
export async function applyRaceProfileSections(
  sections: ReadonlyArray<RaceProfileSection<any>>
): Promise<RaceProfileApplyResult> {
  const skipped = sections.filter((section) => section.value === undefined).map((section) => section.id)
  const active = sections.filter((section) => section.value !== undefined)
  const transactional = active.filter((section) => !section.bestEffort)

  const snapshots = new Map<string, unknown>()
  for (const section of transactional) {
    try {
      snapshots.set(section.id, await section.read())
    } catch (error) {
      // Nothing has been written yet, so there is nothing to undo.
      return {
        ok: false,
        applied: [],
        skipped,
        degraded: [],
        failedSection: section.id,
        error: toError(error),
        rolledBack: []
      }
    }
  }

  const applied: string[] = []
  const degraded: string[] = []
  for (const section of active) {
    try {
      await section.write(section.value)
      if (!section.bestEffort) applied.push(section.id)
    } catch (error) {
      if (section.bestEffort) {
        degraded.push(section.id)
        continue
      }
      const rolledBack: string[] = []
      const rollbackFailed: string[] = []
      for (const id of [...applied].reverse()) {
        const target = transactional.find((candidate) => candidate.id === id)
        if (!target) continue
        try {
          await target.write(snapshots.get(id))
          rolledBack.push(id)
        } catch {
          rollbackFailed.push(id)
        }
      }
      return {
        ok: false,
        applied: [],
        skipped,
        degraded,
        failedSection: section.id,
        error: toError(error),
        rolledBack,
        rollbackFailed
      }
    }
  }

  return { ok: true, applied, skipped, degraded }
}

/** Human-readable summary of a failed apply, including whether the rollback was clean. */
export function describeRaceProfileFailure(result: RaceProfileApplyResult): string {
  if (result.ok) return ''
  const reason = result.error?.message ?? 'unknown error'
  const base = `Failed to apply "${result.failedSection ?? 'profile'}": ${reason}`
  if (result.rollbackFailed && result.rollbackFailed.length > 0) {
    return `${base}. Rollback INCOMPLETE — still changed: ${result.rollbackFailed.join(', ')}.`
  }
  if (result.rolledBack && result.rolledBack.length > 0) {
    return `${base}. Previous settings restored.`
  }
  return `${base}. Nothing was changed.`
}
