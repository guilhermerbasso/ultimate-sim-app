// AC vs ACC identification for the shared `Local\acpmf_*` memory maps.
//
// THE PROBLEM
// Assetto Corsa and Assetto Corsa Competizione publish telemetry through the SAME three
// mapping names — `Local\acpmf_physics`, `Local\acpmf_graphics`, `Local\acpmf_static` —
// because ACC's `SPageFile*` structs are Kunos' AC structs, extended. Through the whole
// static page prefix the two are byte-identical: `smVersion` at 0, `acVersion` at 30,
// `numCars` at 64, `carModel` at 68, `track` at 134, `maxRpm` at 412, `maxFuel` at 416
// are the same offsets in both (compare ACC_LAYOUT.staticInfo in ./acc.ts with the
// ACSPageFileStatic koffi struct in ./ac.ts).
//
// So "the mapping opened" identifies NOTHING. A provider that treats it as identity will
// happily decode the other simulator's memory with its own layout, and because the two
// layouts diverge only later in the graphics page, the result is plausible-looking
// numbers in the wrong slots — worse than no telemetry, because nothing looks broken.
//
// WHAT ACTUALLY DISTINGUISHES THEM
// `SPageFileStatic.smVersion` — the SHARED-MEMORY version string, not the game version.
// ACC's is pinned in ./acc.ts from the published SDK header (v1.8.12) and is already
// used there to reject a non-ACC static page. That gives a POSITIVE test for ACC.
//
// There is deliberately NO positive test for AC here. This codebase has no citable
// ground-truth constant for Assetto Corsa's own `smVersion`, and inventing one — or
// inferring AC from "maxTorque looks populated" / "the page is smaller" — would be a
// heuristic that misfires on any ACC build whose version string we do not yet know,
// silently mismapping a real ACC session. Page size cannot help either: both structs are
// well under Windows' 4 KiB page granularity, so the mapping is rounded to one page in
// both cases and the tail reads as zeros, which are legitimate values for every ACC-only
// field in that range.
//
// THE HONEST OUTCOME
// Three states, not two:
//   absent    — no static page: neither simulator is publishing.
//   acc       — smVersion matches a known ACC shared-memory version. Definitive.
//   ambiguous — a static page exists but its smVersion is not a known ACC one. It is
//               almost certainly Assetto Corsa, and it might be an ACC build newer than
//               this app. We do not flip a coin: auto-detection declines to claim it, and
//               the user answers the question by selecting the simulator explicitly.

export type AcpmfSimId = 'ac' | 'acc'

export type AcpmfIdentity =
  | { kind: 'absent' }
  | { kind: 'acc'; smVersion: string }
  | { kind: 'ambiguous'; smVersion: string }

/** How the current telemetry source reached this provider. */
export type AcpmfSelectionMode = 'auto' | 'explicit'

/** Offset and length of `SPageFileStatic.smVersion` — `wchar_t smVersion[15]` at offset 0. */
export const ACPMF_SM_VERSION_OFFSET = 0
export const ACPMF_SM_VERSION_CODE_UNITS = 15

/**
 * Known ACC shared-memory versions. Extending this list is how support for a newer ACC
 * build is added; until a version appears here it is reported as ambiguous rather than
 * being guessed at in either direction.
 */
export const ACC_KNOWN_SM_VERSIONS: readonly string[] = ['1.8']

/** Read `smVersion` out of a raw `acpmf_static` page. */
export function readAcpmfSmVersion(buffer: Buffer | null | undefined): string | null {
  if (!buffer) return null
  const end = ACPMF_SM_VERSION_OFFSET + ACPMF_SM_VERSION_CODE_UNITS * 2
  if (buffer.length < end) return null
  return normalizeSmVersion(buffer.subarray(ACPMF_SM_VERSION_OFFSET, end).toString('utf16le'))
}

/** Trim a NUL-terminated UTF-16 field to its string content. */
export function normalizeSmVersion(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\0.*$/s, '').trim()
}

/**
 * Classify whatever is publishing to `Local\acpmf_static`.
 *
 * `smVersion` null/empty means the page could not be read at all, which is treated as
 * ABSENT rather than ambiguous: there is no question to ask the user when nothing is
 * publishing.
 */
export function identifyAcpmf(
  smVersion: string | null | undefined,
  accVersions: readonly string[] = ACC_KNOWN_SM_VERSIONS
): AcpmfIdentity {
  const version = normalizeSmVersion(smVersion)
  if (!version) return { kind: 'absent' }
  if (accVersions.includes(version)) return { kind: 'acc', smVersion: version }
  return { kind: 'ambiguous', smVersion: version }
}

/**
 * May `provider` claim the acpmf mappings?
 *
 *   absent     -> nobody claims.
 *   acc        -> only ACC. AC must not decode an ACC session with AC's layout.
 *   ambiguous  -> nobody claims during AUTO detection; whichever provider the user
 *                 selected explicitly claims it, because selecting the source IS the
 *                 answer to "which simulator is this?".
 */
export function acpmfProviderClaims(
  provider: AcpmfSimId,
  identity: AcpmfIdentity,
  selectionMode: AcpmfSelectionMode
): boolean {
  switch (identity.kind) {
    case 'absent':
      return false
    case 'acc':
      return provider === 'acc'
    case 'ambiguous':
      return selectionMode === 'explicit'
  }
}

/**
 * True when the user must be asked which simulator is running. Only meaningful during
 * auto-detection: an explicit selection has already answered the question.
 */
export function acpmfNeedsUserChoice(identity: AcpmfIdentity, selectionMode: AcpmfSelectionMode): boolean {
  return identity.kind === 'ambiguous' && selectionMode === 'auto'
}

/** Stable, user-facing explanation of the current identification state. */
export function describeAcpmfIdentity(identity: AcpmfIdentity): string {
  switch (identity.kind) {
    case 'absent':
      return 'Neither Assetto Corsa nor Assetto Corsa Competizione is publishing shared memory.'
    case 'acc':
      return `Assetto Corsa Competizione detected (shared memory ${identity.smVersion}).`
    case 'ambiguous':
      return `Shared memory version "${identity.smVersion}" is not a supported Assetto Corsa Competizione version. This is most likely Assetto Corsa, but it could also be a newer Competizione build. Select the simulator explicitly in Telemetry so the correct field mapping is used.`
  }
}
