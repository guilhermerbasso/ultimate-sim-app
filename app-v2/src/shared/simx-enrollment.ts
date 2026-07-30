// SIM-X hardware enrolment — the fail-closed identity gate for auto-connect.
//
// WHY THIS EXISTS
// ---------------
// Opening the SIM-X serial port is NOT a passive act. `SerialDevice.open()`
// asserts DTR/RTS (which resets an auto-reset AVR board) and
// `SerialManager.connect()` immediately runs a self-test that WRITES rev-light
// and OLED frames. So "auto-identify then connect" means "reset an unidentified
// board and write commands to it".
//
// The previous heuristic picked a port by (a) the last COM path used, or
// (b) the first port whose USB vendor id belongs to Arduino / SparkFun /
// Adafruit — i.e. entire vendors, not a device. On Windows COM numbers are
// reassigned on re-enumeration, and a maker rig commonly has several boards
// from those vendors, so both rules can select a completely unrelated device.
//
// THE RULE: a board is auto-connected ONLY when its stable USB identity
// (vendorId + productId, plus serialNumber when one was recorded) matches an
// enrolment the user created by connecting that board MANUALLY once. Anything
// unknown, incomplete or ambiguous stays in quarantine and is reported — never
// probed. `lastKnownPath` is recorded for diagnostics and is NEVER a selector.
//
// Keep this file dependency-free (shared by main, preload and renderer) and
// pure, so the whole gate is testable without a serial port.

import type { PortInfo } from './ipc'

export const SIMX_ENROLLMENT_FILE = 'simx-enrollment.json'
export const SIMX_ENROLLMENT_VERSION = 1

export interface SimXEnrollment {
  version: typeof SIMX_ENROLLMENT_VERSION
  /** USB vendor id, lowercase hex without the `0x` prefix. Required. */
  vendorId: string
  /** USB product id, lowercase hex without the `0x` prefix. Required. */
  productId: string
  /** USB serial number when the board reports one. Enforced strictly when present. */
  serialNumber?: string
  /** Friendly label captured at enrolment time, for diagnostics only. */
  label?: string
  /** COM path at enrolment time. DIAGNOSTIC ONLY — never used to select a port. */
  lastKnownPath?: string
  enrolledAt: string
}

export type SimXQuarantineReason =
  | 'not-enrolled'
  | 'enrollment-identity-incomplete'
  | 'enrolled-board-absent'
  | 'ambiguous-identity'

export interface SimXAutoConnectAllowed {
  allowed: true
  path: string
}

export interface SimXAutoConnectBlocked {
  allowed: false
  reason: SimXQuarantineReason
  /** Human-readable explanation for the diagnostic log / Hardware Hub. */
  message: string
  /**
   * Ports a HUMAN could choose to enrol. Offered to the UI as a suggestion only;
   * nothing in this list is ever opened, reset or written to automatically.
   */
  candidatePaths: string[]
}

export type SimXAutoConnectDecision = SimXAutoConnectAllowed | SimXAutoConnectBlocked

export function normalizeUsbId(value: unknown): string | undefined {
  const cleaned = cleanText(value)
  return cleaned?.toLowerCase().replace(/^0x/, '')
}

export function cleanText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** A port can only be enrolled when it exposes BOTH USB ids — nothing weaker counts. */
export function isEnrollablePort(port: PortInfo | null | undefined): boolean {
  if (!port) return false
  return Boolean(normalizeUsbId(port.vendorId) && normalizeUsbId(port.productId))
}

/**
 * Build an enrolment record from a port the user deliberately connected.
 * Returns null when the port has no stable USB identity: we refuse to mint an
 * enrolment we could not verify later.
 */
export function buildSimXEnrollment(
  port: PortInfo | null | undefined,
  now: string = new Date().toISOString()
): SimXEnrollment | null {
  const vendorId = normalizeUsbId(port?.vendorId)
  const productId = normalizeUsbId(port?.productId)
  if (!vendorId || !productId) return null
  const enrollment: SimXEnrollment = {
    version: SIMX_ENROLLMENT_VERSION,
    vendorId,
    productId,
    enrolledAt: now
  }
  const serialNumber = cleanText(port?.serialNumber)
  if (serialNumber) enrollment.serialNumber = serialNumber
  const label = cleanText(port?.friendlyName) ?? cleanText(port?.manufacturer)
  if (label) enrollment.label = label
  const lastKnownPath = cleanText(port?.path)
  if (lastKnownPath) enrollment.lastKnownPath = lastKnownPath
  return enrollment
}

export function isSimXEnrollment(value: unknown): value is SimXEnrollment {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SimXEnrollment>
  return Boolean(normalizeUsbId(candidate.vendorId) && normalizeUsbId(candidate.productId))
}

/**
 * Strict identity comparison. A recorded serial number MUST match exactly; a
 * port that reports no serial number can never satisfy an enrolment that has
 * one (two identical boards would otherwise be interchangeable).
 */
export function portMatchesEnrollment(
  enrollment: SimXEnrollment | null | undefined,
  port: PortInfo | null | undefined
): boolean {
  if (!enrollment || !port) return false
  const enrolledVid = normalizeUsbId(enrollment.vendorId)
  const enrolledPid = normalizeUsbId(enrollment.productId)
  if (!enrolledVid || !enrolledPid) return false
  if (normalizeUsbId(port.vendorId) !== enrolledVid) return false
  if (normalizeUsbId(port.productId) !== enrolledPid) return false
  const enrolledSerial = cleanText(enrollment.serialNumber)
  if (!enrolledSerial) return true
  return cleanText(port.serialNumber) === enrolledSerial
}

function quarantineCandidates(ports: readonly PortInfo[]): string[] {
  return ports.filter((port) => port.isSimX === true && port.path).map((port) => port.path)
}

/**
 * Decide whether the SIM-X auto-start may open a port. Pure and deterministic.
 *
 * Fail-closed by construction: every branch except "exactly one enrolled board
 * is present" returns a blocked decision with a reason. There is deliberately
 * NO path-based fallback and NO vendor-heuristic fallback.
 */
export function resolveSimXAutoConnect(
  ports: readonly PortInfo[] | null | undefined,
  enrollment: SimXEnrollment | null | undefined
): SimXAutoConnectDecision {
  const list = Array.isArray(ports) ? ports.filter((port) => Boolean(port?.path)) : []

  if (!enrollment) {
    return {
      allowed: false,
      reason: 'not-enrolled',
      message:
        'No SIM-X board is enrolled. Auto-connect stays in quarantine until you connect the board manually once, which records its USB identity.',
      candidatePaths: quarantineCandidates(list)
    }
  }

  if (!isSimXEnrollment(enrollment)) {
    return {
      allowed: false,
      reason: 'enrollment-identity-incomplete',
      message:
        'The saved SIM-X enrolment has no USB vendor/product id, so the board cannot be identified. Connect the board manually to re-enrol it.',
      candidatePaths: quarantineCandidates(list)
    }
  }

  const matches = list.filter((port) => portMatchesEnrollment(enrollment, port))

  if (matches.length === 0) {
    return {
      allowed: false,
      reason: 'enrolled-board-absent',
      message: `The enrolled SIM-X board (VID ${enrollment.vendorId}/PID ${enrollment.productId}) is not present. No other port is probed.`,
      candidatePaths: quarantineCandidates(list)
    }
  }

  if (matches.length > 1) {
    return {
      allowed: false,
      reason: 'ambiguous-identity',
      message: `${matches.length} boards share the enrolled USB identity (VID ${enrollment.vendorId}/PID ${enrollment.productId}) and no serial number distinguishes them. Auto-connect refuses rather than guess.`,
      candidatePaths: matches.map((port) => port.path)
    }
  }

  return { allowed: true, path: matches[0].path }
}
