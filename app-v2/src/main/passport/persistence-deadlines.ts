export const PASSPORT_APP_PERSISTENCE_DEADLINE_MS = 2_500
export const PASSPORT_SERVICE_DRAIN_DEADLINE_MS = 600
export const PASSPORT_CLIENT_CLOSE_DEADLINE_MS = 900
export const PASSPORT_WORKER_TERMINATION_DEADLINE_MS = 300
export const PASSPORT_SQLITE_BUSY_TIMEOUT_MS = 200

/**
 * How long a persistence connection waits for a contended write lock before
 * failing closed.
 *
 * The default is deliberately short so a wedged writer surfaces quickly rather
 * than stalling a stint. Deployments and tests that legitimately hold the lock
 * for longer than a couple of hundred milliseconds can raise it through
 * `ULTIMATE_SIM_PASSPORT_SQLITE_BUSY_TIMEOUT_MS`; without that seam the only
 * way to exercise lock contention was to race the default, which turns host
 * load into a false failure. Invalid values fall back to the default.
 */
export function resolvePassportSqliteBusyTimeoutMs(
  environment: NodeJS.ProcessEnv = process.env
): number {
  const raw = environment.ULTIMATE_SIM_PASSPORT_SQLITE_BUSY_TIMEOUT_MS
  if (raw === undefined || raw.trim() === '') return PASSPORT_SQLITE_BUSY_TIMEOUT_MS
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : PASSPORT_SQLITE_BUSY_TIMEOUT_MS
}

export const PASSPORT_PERSISTENCE_WORST_CASE_MS =
  PASSPORT_SERVICE_DRAIN_DEADLINE_MS +
  PASSPORT_CLIENT_CLOSE_DEADLINE_MS +
  PASSPORT_WORKER_TERMINATION_DEADLINE_MS +
  PASSPORT_SQLITE_BUSY_TIMEOUT_MS
