import type { PortInfo } from './ipc'

// Pure helpers for matching a stored generic serial device to a live OS port and
// resolving the COM path to auto-connect on startup. Mirrors the SIM-X resolver
// (shared/simx-autostart.ts) but for kind 'generic' (e.g. the iFlag RGB matrix),
// where the strongest signal is the device's STABLE USB identity rather than a
// remembered single "last port" — Windows freely reassigns COM numbers, so the
// same physical box can come back on a different port.
//
// These functions are the canonical implementation of the USB-identity matching
// used across the app; src/main/serial-devices/store.ts re-exports the public
// ones (serialIdentityMatches / sharesUsbVendorProduct) so existing callers keep
// importing them from there. Kept pure + deterministic for testing.

// Minimal shape needed to resolve a device's live port: its (updatable) connect
// path plus whatever stable USB identity was captured when it was added.
export interface GenericDeviceIdentity {
  path: string
  vendorId?: string
  productId?: string
  serialNumber?: string
}

export function cleanText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function normalizeUsbId(value: unknown): string | undefined {
  const cleaned = cleanText(value)
  return cleaned?.toLowerCase().replace(/^0x/, '')
}

// True when two records describe the SAME physical USB device. Requires
// vendorId+productId on BOTH sides (identity-less entries never collapse). A USB
// serial number is the only reliable per-unit discriminator, so:
//   • both sides expose a serial → match iff the serials are equal. This lets a
//     device move across COM ports (COM18 → COM7…) and stay the same record.
//   • either side LACKS a serial → VID+PID alone is NOT unique. Sim racing is
//     full of serial-less CH340 / Pro-Micro clones that all share one VID:PID
//     (e.g. 1a86:7523), so two of them would otherwise collapse into a single
//     entry and autoReconnect could bind the wrong COM. In that case we also
//     require the COM `path` to agree before declaring a match — keeping such
//     identical boards DISTINCT. The trade-off: a serial-less board can only be
//     re-matched at its known path (it can't be tracked across COM changes).
export function serialIdentityMatches(
  a: { vendorId?: string; productId?: string; serialNumber?: string; path?: string },
  b: { vendorId?: string; productId?: string; serialNumber?: string; path?: string }
): boolean {
  const aVid = normalizeUsbId(a.vendorId)
  const aPid = normalizeUsbId(a.productId)
  const bVid = normalizeUsbId(b.vendorId)
  const bPid = normalizeUsbId(b.productId)
  if (!aVid || !aPid || !bVid || !bPid) return false
  if (aVid !== bVid || aPid !== bPid) return false
  const aSerial = cleanText(a.serialNumber)
  const bSerial = cleanText(b.serialNumber)
  // Both expose a serial: definitive identity, independent of the COM path.
  if (aSerial && bSerial) return aSerial === bSerial
  // Serial-less on at least one side: don't trust VID+PID alone — fall back to
  // requiring COM path equality so identical clones stay separate records.
  const aPath = cleanText(a.path)
  const bPath = cleanText(b.path)
  return aPath !== undefined && aPath === bPath
}

// True when two records share the same USB vendor+product, ignoring serial and
// COM path. Unlike `serialIdentityMatches` this is NOT a device-identity check —
// it only tells you the boards are the same MODEL. Used to decide whether a
// serial-less device is UNAMBIGUOUS among the currently-present ports (exactly
// one share) before it's safe to follow it onto a new COM.
export function sharesUsbVendorProduct(
  a: { vendorId?: string; productId?: string },
  b: { vendorId?: string; productId?: string }
): boolean {
  const aVid = normalizeUsbId(a.vendorId)
  const aPid = normalizeUsbId(a.productId)
  const bVid = normalizeUsbId(b.vendorId)
  const bPid = normalizeUsbId(b.productId)
  return aVid !== undefined && aPid !== undefined && aVid === bVid && aPid === bPid
}

// Pick the live COM path to auto-connect for a stored generic device, or null
// when the device isn't currently present (the caller keeps retrying in the
// background as ports come and go — exactly like resolveSimXPort).
//
// Priority:
//   1. A full USB-identity match (a serial-bearing device recognised even after
//      it moved COM ports, or the same serial-less unit still on its known path).
//   2. A serial-less device whose COM moved: only followed to a new port when
//      EXACTLY ONE present port shares its VID+PID (no identical twin to confuse
//      it with) — otherwise we don't guess.
//   3. The stored `path` itself, but ONLY if that exact port is present right now
//      (covers identity-less adapters and OSes that don't expose USB ids).
//
// Returning null when the port is absent — rather than the stored path blindly —
// lets the controller log "no candidate port yet" and retry instead of firing a
// guaranteed-to-fail "File not found" connect every few seconds.
export function resolveGenericDevicePort(
  config: GenericDeviceIdentity,
  ports: PortInfo[]
): string | null {
  if (!Array.isArray(ports) || ports.length === 0) return null

  const hasIdentity = !!(
    normalizeUsbId(config.vendorId) ||
    normalizeUsbId(config.productId) ||
    cleanText(config.serialNumber)
  )
  if (hasIdentity) {
    const exact = ports.find((port) => serialIdentityMatches(config, port))
    if (exact) return exact.path
    // Serial-less unit whose COM changed: VID+PID isn't unique, so only follow it
    // to a new COM when EXACTLY ONE present port shares its VID+PID.
    if (!cleanText(config.serialNumber)) {
      const sameModel = ports.filter((port) => sharesUsbVendorProduct(config, port))
      if (sameModel.length === 1) return sameModel[0].path
    }
  }

  const byPath = ports.find((port) => port.path === config.path)
  return byPath ? byPath.path : null
}
