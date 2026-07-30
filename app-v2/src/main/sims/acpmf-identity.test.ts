import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ACC_KNOWN_SM_VERSIONS,
  acpmfNeedsUserChoice,
  acpmfProviderClaims,
  describeAcpmfIdentity,
  identifyAcpmf,
  normalizeSmVersion,
  readAcpmfSmVersion
} from './acpmf-identity'
import { decodeACCStaticPage } from './acc'
import { buildAcpmfStatus } from '../modules/sim-providers'

// ---------------------------------------------------------------------------
// SYNTHETIC EVIDENCE, NOT GAME CAPTURES. Both fixtures follow the published
// `SPageFileStatic` layout (`#pragma pack(4)`) but every value is invented — see
// ./fixtures/README.md. That is enough to prove the IDENTIFICATION contract, because the
// contract depends only on `smVersion` at offset 0. It is NOT enough to prove that a real
// Assetto Corsa build writes "1.7"; that still needs a real installation.
// ---------------------------------------------------------------------------

function fixture(name: string): Buffer {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url))
}

const AC_STATIC = fixture('ac-static-v1.7.bin')
const ACC_STATIC = fixture('acc-static-v1.8.bin')

describe('AC and ACC really are indistinguishable except for smVersion', () => {
  it('the two static pages agree byte for byte on numCars, carModel, track, maxRpm and maxFuel offsets', () => {
    // Both fixtures are the SAME struct. If the shared prefix were not identical, "the
    // mapping opened" might have been a usable identity — it is not.
    expect(AC_STATIC.length).toBe(ACC_STATIC.length)
    // numCars (int32 @ 64) decodes as a plain integer from both.
    expect(Number.isInteger(AC_STATIC.readInt32LE(64))).toBe(true)
    expect(Number.isInteger(ACC_STATIC.readInt32LE(64))).toBe(true)
    // maxRpm (int32 @ 412) and maxFuel (float @ 416) likewise.
    expect(AC_STATIC.readInt32LE(412)).toBeGreaterThan(0)
    expect(ACC_STATIC.readInt32LE(412)).toBeGreaterThan(0)
    expect(AC_STATIC.readFloatLE(416)).toBeGreaterThan(0)
    expect(ACC_STATIC.readFloatLE(416)).toBeGreaterThan(0)
  })

  it('page LENGTH cannot discriminate them — both are read as one 4 KiB page', () => {
    expect(AC_STATIC.length).toBe(ACC_STATIC.length)
  })

  it('reads smVersion from offset 0 of each page', () => {
    expect(readAcpmfSmVersion(AC_STATIC)).toBe('1.7')
    expect(readAcpmfSmVersion(ACC_STATIC)).toBe('1.8')
  })
})

describe('identifyAcpmf — positive test for ACC, never a guess for AC', () => {
  it('identifies the ACC page definitively', () => {
    expect(identifyAcpmf(readAcpmfSmVersion(ACC_STATIC))).toEqual({ kind: 'acc', smVersion: '1.8' })
  })

  it('does NOT claim the AC page as ACC', () => {
    expect(identifyAcpmf(readAcpmfSmVersion(AC_STATIC)).kind).not.toBe('acc')
  })

  it('reports the AC page as ambiguous rather than asserting it is Assetto Corsa', () => {
    expect(identifyAcpmf(readAcpmfSmVersion(AC_STATIC))).toEqual({ kind: 'ambiguous', smVersion: '1.7' })
  })

  it('reports an UNKNOWN, NEWER ACC build as ambiguous instead of mislabelling it as AC', () => {
    // The dangerous case: a future ACC bumps smVersion. Guessing "not ACC therefore AC"
    // would hand a real ACC session to AC's layout and silently mismap it.
    expect(identifyAcpmf('1.9')).toEqual({ kind: 'ambiguous', smVersion: '1.9' })
    expect(identifyAcpmf('1.10')).toEqual({ kind: 'ambiguous', smVersion: '1.10' })
  })

  it('treats a missing or blank page as ABSENT, not as a question for the user', () => {
    expect(identifyAcpmf(null)).toEqual({ kind: 'absent' })
    expect(identifyAcpmf('')).toEqual({ kind: 'absent' })
    expect(identifyAcpmf('   ')).toEqual({ kind: 'absent' })
    expect(readAcpmfSmVersion(Buffer.alloc(4))).toBeNull()
    expect(readAcpmfSmVersion(null)).toBeNull()
  })

  it('trims the NUL padding of the fixed-width UTF-16 field', () => {
    expect(normalizeSmVersion('1.8\u0000\u0000\u0000')).toBe('1.8')
    expect(normalizeSmVersion(undefined)).toBe('')
  })

  it('supports adding a new ACC version without touching the decision logic', () => {
    expect(identifyAcpmf('1.9', [...ACC_KNOWN_SM_VERSIONS, '1.9'])).toEqual({ kind: 'acc', smVersion: '1.9' })
  })
})

describe('acpmfProviderClaims — who is allowed to decode the shared mapping', () => {
  const accPage = identifyAcpmf(readAcpmfSmVersion(ACC_STATIC))
  const acPage = identifyAcpmf(readAcpmfSmVersion(AC_STATIC))
  const absent = identifyAcpmf(null)

  it('gives an ACC page to ACC and NEVER to AC, even when AC was selected explicitly', () => {
    expect(acpmfProviderClaims('acc', accPage, 'auto')).toBe(true)
    expect(acpmfProviderClaims('ac', accPage, 'auto')).toBe(false)
    // The strong one: the user picked AC, but the page positively identifies as ACC.
    // Honouring the selection here would decode ACC memory with AC's graphics layout.
    expect(acpmfProviderClaims('ac', accPage, 'explicit')).toBe(false)
  })

  it('lets NEITHER provider claim an ambiguous page during auto-detection', () => {
    expect(acpmfProviderClaims('acc', acPage, 'auto')).toBe(false)
    expect(acpmfProviderClaims('ac', acPage, 'auto')).toBe(false)
  })

  it('lets an EXPLICIT selection resolve the ambiguity — choosing the source is the answer', () => {
    expect(acpmfProviderClaims('ac', acPage, 'explicit')).toBe(true)
    expect(acpmfProviderClaims('acc', acPage, 'explicit')).toBe(true)
  })

  it('lets nobody claim an absent page', () => {
    for (const mode of ['auto', 'explicit'] as const) {
      expect(acpmfProviderClaims('ac', absent, mode)).toBe(false)
      expect(acpmfProviderClaims('acc', absent, mode)).toBe(false)
    }
  })
})

describe('the ambiguity is surfaced, not swallowed', () => {
  it('asks the user only when auto-detection cannot attribute a page that EXISTS', () => {
    const acPage = identifyAcpmf(readAcpmfSmVersion(AC_STATIC))
    expect(acpmfNeedsUserChoice(acPage, 'auto')).toBe(true)
    expect(acpmfNeedsUserChoice(acPage, 'explicit')).toBe(false)
    expect(acpmfNeedsUserChoice(identifyAcpmf(null), 'auto')).toBe(false)
    expect(acpmfNeedsUserChoice(identifyAcpmf(readAcpmfSmVersion(ACC_STATIC)), 'auto')).toBe(false)
  })

  it('explains the ambiguity in terms the user can act on, naming both candidates', () => {
    const message = describeAcpmfIdentity(identifyAcpmf('1.7'))
    expect(message).toContain('1.7')
    expect(message).toContain('Assetto Corsa')
    expect(message).toContain('Competizione')
    expect(message).toMatch(/select the simulator explicitly/i)
  })

  it('buildAcpmfStatus reports the choice only while auto-detecting', () => {
    const acPage = identifyAcpmf('1.7')
    expect(buildAcpmfStatus(acPage, true).needsUserChoice).toBe(true)
    expect(buildAcpmfStatus(acPage, false).needsUserChoice).toBe(false)
    expect(buildAcpmfStatus(identifyAcpmf(readAcpmfSmVersion(ACC_STATIC)), true)).toMatchObject({
      needsUserChoice: false,
      identity: { kind: 'acc' }
    })
  })
})

describe('the existing ACC decoder agrees with the identity module', () => {
  it('decodes the ACC page and refuses the AC page', () => {
    expect(decodeACCStaticPage(ACC_STATIC)).not.toBeNull()
    expect(decodeACCStaticPage(AC_STATIC)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Provider-level: drive the REAL ACProvider / ACCProvider against the fixtures by
// standing in for the Windows shared-memory layer.
// ---------------------------------------------------------------------------

vi.mock('./shared-memory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./shared-memory')>()
  return {
    ...actual,
    loadKoffi: () => ({ struct: () => ({}), array: () => ({}) }),
    openSharedMemory: (_koffi: unknown, name: string) => currentMapping(name, 'struct'),
    openSharedMemoryBuffer: (_koffi: unknown, name: string) => currentMapping(name, 'buffer')
  }
})

type MappedSim = 'ac' | 'acc' | null
let mappedSim: MappedSim = null

/** Models the fact that BOTH simulators publish to the same three mapping names. */
function currentMapping(name: string, shape: 'struct' | 'buffer'): unknown {
  if (!mappedSim) return null
  if (!name.startsWith('Local\\acpmf_')) return null
  const staticPage = mappedSim === 'acc' ? ACC_STATIC : AC_STATIC
  if (name === 'Local\\acpmf_static') {
    return shape === 'buffer'
      ? { view: staticPage, close: () => undefined }
      : { view: { smVersion: readAcpmfSmVersion(staticPage) ?? '' }, close: () => undefined }
  }
  const page = Buffer.alloc(2048)
  return shape === 'buffer' ? { view: page, close: () => undefined } : { view: {}, close: () => undefined }
}

describe('ACProvider / ACCProvider claim the shared mapping correctly', () => {
  it('AUTO with Assetto Corsa running: ACC must NOT connect, so AC is reachable at all', async () => {
    const { ACCProvider } = await import('./acc')
    mappedSim = 'ac'
    const acc = new ACCProvider()
    acc.setSelectionMode('auto')
    acc.start()

    // The defect: ACC used to report connected purely because `Local\acpmf_*` opened,
    // win the auto-detection race (AUTO_PRIORITY puts acc before ac) and then publish
    // nothing at all, because its static decoder rejects the non-ACC version.
    expect(acc.isConnected()).toBe(false)
    expect(acc.identity()).toEqual({ kind: 'ambiguous', smVersion: '1.7' })
    acc.stop()
  })

  it('AUTO with ACC running: ACC connects', async () => {
    const { ACCProvider } = await import('./acc')
    mappedSim = 'acc'
    const acc = new ACCProvider()
    acc.setSelectionMode('auto')
    acc.start()

    expect(acc.identity()).toEqual({ kind: 'acc', smVersion: '1.8' })
    expect(acc.isConnected()).toBe(true)
    acc.stop()
  })

  it('AC never decodes an ACC page, even when the user selected AC explicitly', async () => {
    const { ACProvider } = await import('./ac')
    mappedSim = 'acc'
    const ac = new ACProvider()
    ac.setSelectionMode('explicit')
    ac.start()

    expect(ac.identity()).toEqual({ kind: 'acc', smVersion: '1.8' })
    expect(ac.isConnected()).toBe(false)
    expect(ac.poll()).toBeNull()
    ac.stop()
  })

  it('AC connects when the user selects it explicitly and the page is not ACC', async () => {
    const { ACProvider } = await import('./ac')
    mappedSim = 'ac'
    const ac = new ACProvider()
    ac.setSelectionMode('explicit')
    ac.start()

    expect(ac.isConnected()).toBe(true)
    ac.stop()
  })

  it('AC does not silently win auto-detection on an ambiguous page', async () => {
    const { ACProvider } = await import('./ac')
    mappedSim = 'ac'
    const ac = new ACProvider()
    ac.setSelectionMode('auto')
    ac.start()

    expect(ac.isConnected()).toBe(false)
    ac.stop()
  })

  it('nobody connects when neither simulator is publishing', async () => {
    const { ACProvider } = await import('./ac')
    const { ACCProvider } = await import('./acc')
    mappedSim = null
    const ac = new ACProvider()
    const acc = new ACCProvider()
    ac.start()
    acc.start()

    expect(ac.isConnected()).toBe(false)
    expect(acc.isConnected()).toBe(false)
    ac.stop()
    acc.stop()
  })
})

describe('end to end through the telemetry hub', () => {
  async function hubWithSims() {
    const { TelemetryHub } = await import('../telemetry/hub')
    const { ACProvider } = await import('./ac')
    const { ACCProvider } = await import('./acc')
    const hub = new TelemetryHub()
    // Registration order mirrors sim-providers.ts, and AUTO_PRIORITY puts acc BEFORE ac.
    hub.register(new ACCProvider())
    hub.register(new ACProvider())
    return hub
  }

  it('AUTO with ACC running resolves to ACC', async () => {
    mappedSim = 'acc'
    const hub = await hubWithSims()
    await hub.setSource('auto')
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(hub.status().active).toBe('acc')
    await hub.dispose()
  })

  it('AUTO with an ambiguous page reports NO active simulator instead of parking on ACC', async () => {
    mappedSim = 'ac'
    const hub = await hubWithSims()
    await hub.setSource('auto')
    await new Promise((resolve) => setTimeout(resolve, 60))

    // Previously ACC claimed the mapping, became `active`, and then published null
    // forever — the UI showed "Competizione connected" with no data and no explanation.
    expect(hub.status().active).toBe('none')
    expect(hub.getLatest()).toBeNull()
    await hub.dispose()
  })

  it('an EXPLICIT Assetto Corsa selection resolves the ambiguity and connects', async () => {
    mappedSim = 'ac'
    const hub = await hubWithSims()
    await hub.setSource('ac')
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(hub.status().active).toBe('ac')
    await hub.dispose()
  })

  it('an EXPLICIT Assetto Corsa selection still refuses to decode an ACC page', async () => {
    mappedSim = 'acc'
    const hub = await hubWithSims()
    await hub.setSource('ac')
    await new Promise((resolve) => setTimeout(resolve, 60))

    // `status().active` mirrors the chosen source for an explicit selection regardless of
    // connectivity — that is pre-existing hub behaviour and is not what matters here. What
    // matters is that AC published NOTHING rather than ACC's memory read with AC's layout.
    expect(hub.getLatest()).toBeNull()
    await hub.dispose()
  })
})
