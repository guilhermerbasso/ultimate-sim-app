import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { App } from 'electron'
import type { PortInfo } from '../../shared/ipc'
import {
  SIMX_ENROLLMENT_FILE,
  buildSimXEnrollment,
  isSimXEnrollment,
  type SimXEnrollment
} from '../../shared/simx-enrollment'

// Persisted SIM-X hardware enrolment.
//
// This file is the ONLY authorisation for auto-connecting (and therefore
// resetting + writing to) a board. It is written exclusively from an explicit
// human action — the `buttonbox:connect` IPC raised by the Connect button — and
// never from the auto-start loop, so the gate can't authorise itself.
//
// Deliberately separate from `simx-primary-identity.json`: that file is a
// best-effort "last primary" hint that may hold a COM path with no USB ids, and
// a path is not an identity.

export function simxEnrollmentPath(app: App): string {
  return join(app.getPath('userData'), SIMX_ENROLLMENT_FILE)
}

// Synchronous on purpose: the auto-start controller re-reads the enrolment on
// every attempt so a mid-session enrolment takes effect immediately, and the
// file is a few hundred bytes.
export function readSimXEnrollment(app: App): SimXEnrollment | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(simxEnrollmentPath(app), 'utf8'))
    if (!isSimXEnrollment(parsed)) return null
    return parsed
  } catch {
    // Missing, unreadable or malformed → treat as NOT enrolled (fail closed).
    return null
  }
}

/**
 * Record the board the user just connected by hand. Returns the stored record,
 * or null when the port exposes no stable USB identity — in that case we keep
 * the previous enrolment (if any) rather than writing one we could not verify.
 */
export function enrollSimXFromPort(app: App, port: PortInfo | null | undefined): SimXEnrollment | null {
  const enrollment = buildSimXEnrollment(port)
  if (!enrollment) return null
  try {
    const target = simxEnrollmentPath(app)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, `${JSON.stringify(enrollment, null, 2)}\n`, 'utf8')
    return enrollment
  } catch (error) {
    console.warn(
      '[simx-enrollment] failed to persist enrolment:',
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}
