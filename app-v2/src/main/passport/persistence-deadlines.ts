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

/**
 * How long the client waits for a freshly forked persistence process to load
 * its bundle and announce that it is listening.
 *
 * This phase is owned by the host, not by the worker: it is `fork`, `exec` and
 * ESM module evaluation, none of which the worker can influence or report on.
 * Measured over 375 worker starts with the suite running 64 Vitest workers
 * pinned to 4 cores, from process start to module loaded: p50 126ms, p90
 * 1666ms, p99 4225ms, max 8741ms.
 *
 * A budget inside that distribution does not detect a wedged worker, it detects
 * a busy machine - and the client's reaction to it (SIGKILL the process and
 * fork another one) makes the machine busier, so each expiry makes the next one
 * likelier until the restart budget is spent and the circuit opens. A startup
 * that has not reached its own module in this long is genuinely wedged.
 */
export const PASSPORT_WORKER_BRINGUP_DEADLINE_MS = 30_000

/**
 * How long the client waits for `initialize` once the worker has announced that
 * it is loaded and listening.
 *
 * Unlike bring-up, this phase is owned by the worker - opening SQLite, running
 * migrations and recovering any repair journal - so a budget here is a
 * statement about the worker rather than about the host. Measured over 280
 * initializations under the same 16x oversubscription: p50 57ms, p90 246ms,
 * p99 1609ms, max 3176ms.
 */
export const PASSPORT_WORKER_INITIALIZE_DEADLINE_MS = 15_000
