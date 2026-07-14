import { describe, expect, it } from 'vitest'
import { ALL_VARIANTS } from '../renderer/src/views/dashboard/widget-catalog-data'
import {
  applyDecimals,
  composeImageFilter,
  createBlankAdaptiveDashboard,
  dashboardPlaylistValidationError,
  dashboardStorageValidationResult,
  dashboardValidationError,
  isDashboard,
  reorderElements,
  resolveSlotStyle,
  sortElementsByZ,
  type Dashboard,
  type DashboardElement,
  type DashboardElementStyle
} from './dashboards'
import { isAdaptiveDashboard } from './dashboard-adaptive-preset'

function el(id: string, style: DashboardElementStyle = {}): DashboardElement {
  return { id, type: 'text', x: 0, y: 0, w: 10, h: 10, style }
}

function storedDashboard(id = 'stored'): Dashboard {
  return {
    id,
    name: id,
    width: 1024,
    height: 600,
    bg: '#05070a',
    elements: [{ id: 'value', type: 'text', x: 10, y: 10, w: 200, h: 80, style: { text: '42' } }]
  }
}

describe('resolveSlotStyle', () => {
  it('returns the defaults untouched when the style has no slots (back-compat)', () => {
    const defaults = { color: '#fff', fontSize: 20, align: 'left' as const }
    expect(resolveSlotStyle(undefined, 'value', defaults)).toEqual(defaults)
    expect(resolveSlotStyle({}, 'value', defaults)).toEqual(defaults)
  })

  it('returns the defaults when the requested slot is absent', () => {
    const style: DashboardElementStyle = { slots: { label: { fontColor: '#f00' } } }
    expect(resolveSlotStyle(style, 'value', { color: '#abc' })).toEqual({ color: '#abc' })
  })

  it('does not mutate the provided defaults object', () => {
    const defaults = { color: '#fff' }
    resolveSlotStyle({ slots: { value: { fontColor: '#000' } } }, 'value', defaults)
    expect(defaults).toEqual({ color: '#fff' })
  })

  it('maps fontColor -> color and shadow -> textShadow and letterSpacing -> px', () => {
    const style: DashboardElementStyle = {
      slots: {
        value: {
          fontFamily: 'Arial',
          fontSize: 42,
          fontColor: '#112233',
          fontWeight: 800,
          align: 'right',
          letterSpacing: 2,
          textTransform: 'uppercase',
          shadow: '0 0 6px #00BFFF'
        }
      }
    }
    expect(resolveSlotStyle(style, 'value', { color: '#fff', fontSize: 10 })).toEqual({
      fontFamily: 'Arial',
      fontSize: 42,
      color: '#112233',
      fontWeight: 800,
      align: 'right',
      letterSpacing: '2px',
      textTransform: 'uppercase',
      textShadow: '0 0 6px #00BFFF'
    })
  })

  it('treats an empty shadow string as "no shadow" (undefined)', () => {
    const out = resolveSlotStyle({ slots: { value: { shadow: '' } } }, 'value', {})
    expect(out.textShadow).toBeUndefined()
  })

  it('only overrides the fields present in the slot, keeping other defaults', () => {
    const style: DashboardElementStyle = { slots: { value: { fontColor: '#0f0' } } }
    const out = resolveSlotStyle(style, 'value', { color: '#fff', fontSize: 18, fontFamily: 'Mono' })
    expect(out).toEqual({ color: '#0f0', fontSize: 18, fontFamily: 'Mono' })
  })

  it('ignores non-finite / empty overrides so defaults survive', () => {
    const style: DashboardElementStyle = {
      slots: { value: { fontSize: Number.NaN, fontFamily: '', letterSpacing: Number.POSITIVE_INFINITY } }
    }
    const out = resolveSlotStyle(style, 'value', { fontSize: 16, fontFamily: 'Base' })
    expect(out).toEqual({ fontSize: 16, fontFamily: 'Base' })
  })
})

describe('composeImageFilter', () => {
  it('returns an empty string for an absent or filterless style (back-compat)', () => {
    expect(composeImageFilter(undefined)).toBe('')
    expect(composeImageFilter({})).toBe('')
    expect(composeImageFilter({ src: 'data:...', fit: 'cover', opacity: 1 })).toBe('')
  })

  it('omits identity values (brightness/contrast/saturate=1, hueRotate=0)', () => {
    expect(composeImageFilter({ brightness: 1, contrast: 1, saturate: 1, hueRotate: 0 })).toBe('')
  })

  it('composes grayscale and invert', () => {
    expect(composeImageFilter({ filterGrayscale: 1 })).toBe('grayscale(1)')
    expect(composeImageFilter({ invert: 1 })).toBe('invert(1)')
  })

  it('composes a red monochrome (tons de vermelho) from redTint', () => {
    const out = composeImageFilter({ filterGrayscale: 1, redTint: 1 })
    expect(out).toContain('grayscale(1)')
    expect(out).toContain('sepia(')
    expect(out).toContain('saturate(')
    expect(out).toContain('hue-rotate(')
    // grayscale comes before the red-tint expansion
    expect(out.indexOf('grayscale(1)')).toBeLessThan(out.indexOf('sepia('))
  })

  it('emits non-identity brightness/contrast/saturate/hue and blur', () => {
    const out = composeImageFilter({ brightness: 1.2, contrast: 0.8, saturate: 2, hueRotate: 45, blur: 3 })
    expect(out).toContain('brightness(1.2)')
    expect(out).toContain('contrast(0.8)')
    expect(out).toContain('saturate(2)')
    expect(out).toContain('hue-rotate(45deg)')
    expect(out).toContain('blur(3px)')
  })

  it('clamps values to safe ranges', () => {
    expect(composeImageFilter({ filterGrayscale: 5 })).toBe('grayscale(1)')
    expect(composeImageFilter({ invert: -3 })).toBe('')
  })

  it('keeps a deterministic primitive order', () => {
    const out = composeImageFilter({ filterGrayscale: 0.5, filterSepia: 0.5, brightness: 1.1, invert: 0.2, blur: 1 })
    const order = ['grayscale(', 'sepia(', 'brightness(', 'invert(', 'blur(']
    const positions = order.map((p) => out.indexOf(p))
    const sorted = [...positions].sort((a, b) => a - b)
    expect(positions).toEqual(sorted)
  })
})

describe('reorderElements', () => {
  const base = [el('a'), el('b'), el('c'), el('d')]
  const ids = (arr: DashboardElement[]): string[] => arr.map((e) => e.id)

  it('brings an element to the front (end of the array)', () => {
    expect(ids(reorderElements(base, 'b', 'front'))).toEqual(['a', 'c', 'd', 'b'])
  })

  it('sends an element to the back (start of the array)', () => {
    expect(ids(reorderElements(base, 'c', 'back'))).toEqual(['c', 'a', 'b', 'd'])
  })

  it('moves an element one step forward and backward', () => {
    expect(ids(reorderElements(base, 'b', 'forward'))).toEqual(['a', 'c', 'b', 'd'])
    expect(ids(reorderElements(base, 'c', 'backward'))).toEqual(['a', 'c', 'b', 'd'])
  })

  it('is a no-op at the boundaries', () => {
    expect(ids(reorderElements(base, 'a', 'backward'))).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(reorderElements(base, 'd', 'forward'))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns the same reference for an unknown id and never mutates the input', () => {
    const copy = [...base]
    expect(reorderElements(base, 'zzz', 'front')).toBe(base)
    expect(ids(base)).toEqual(ids(copy))
  })
})

describe('sortElementsByZ', () => {
  const ids = (arr: DashboardElement[]): string[] => arr.map((e) => e.id)

  it('preserves array order when no element declares a zIndex (back-compat)', () => {
    const arr = [el('a'), el('b'), el('c')]
    expect(ids(sortElementsByZ(arr))).toEqual(['a', 'b', 'c'])
  })

  it('orders by zIndex ascending so higher z paints last (on top)', () => {
    const arr = [el('a', { zIndex: 5 }), el('b', { zIndex: -1 }), el('c', { zIndex: 0 })]
    expect(ids(sortElementsByZ(arr))).toEqual(['b', 'c', 'a'])
  })

  it('is stable: equal zIndex keeps the original array order', () => {
    const arr = [el('a', { zIndex: 1 }), el('b'), el('c', { zIndex: 1 }), el('d')]
    // b and d default to 0 -> first; a and c are 1 -> after, in original order
    expect(ids(sortElementsByZ(arr))).toEqual(['b', 'd', 'a', 'c'])
  })

  it('does not mutate the input array', () => {
    const arr = [el('a', { zIndex: 2 }), el('b', { zIndex: 1 })]
    const before = ids(arr)
    sortElementsByZ(arr)
    expect(ids(arr)).toEqual(before)
  })
})

describe('applyDecimals (granular "Casas decimais" control)', () => {
  it('keeps the original text when no decimals override is set (back-compat)', () => {
    expect(applyDecimals('123', 123, undefined)).toBe('123')
    expect(applyDecimals('1.5', 1.5, undefined)).toBe('1.5')
  })

  it('reformats a finite numeric value to the requested decimal places', () => {
    expect(applyDecimals('1.23456', 1.23456, 2)).toBe('1.23')
    expect(applyDecimals('42', 42, 1)).toBe('42.0')
    expect(applyDecimals('42', 42, 0)).toBe('42')
  })

  it('falls back to the text when there is no finite numeric (e.g. "—")', () => {
    expect(applyDecimals('—', undefined, 2)).toBe('—')
    expect(applyDecimals('N/A', Number.NaN, 3)).toBe('N/A')
    expect(applyDecimals('∞', Number.POSITIVE_INFINITY, 2)).toBe('∞')
  })

  it('clamps the decimal count into a sane 0..6 range', () => {
    expect(applyDecimals('1', 1, -3)).toBe('1')
    expect(applyDecimals('1', 1, 9)).toBe('1.000000')
  })
})

describe('createBlankAdaptiveDashboard', () => {
  it('is empty (no widgets, no moment frames/rules) but adaptive-enabled', () => {
    const d = createBlankAdaptiveDashboard()
    expect(d.elements).toEqual([])
    expect(d.adaptive?.enabled).toBe(true)
    expect(d.adaptive?.rules).toEqual([])
    expect(d.id).toBe('')
  })

  it('is recognised as adaptive via the durable description marker', () => {
    expect(isAdaptiveDashboard(createBlankAdaptiveDashboard())).toBe(true)
  })

  it('returns a fresh object each call', () => {
    const a = createBlankAdaptiveDashboard()
    const b = createBlankAdaptiveDashboard()
    expect(a).not.toBe(b)
    expect(a.elements).not.toBe(b.elements)
  })
})

describe('dashboard storage schema compatibility', () => {
  it('rejects null-prototype and accessor-backed style arrays without invoking unsafe methods/getters', () => {
    const fields = {
      channels: ['throttle'],
      fields: ['water'],
      tableColumns: ['pos']
    } as const
    for (const [field, values] of Object.entries(fields)) {
      const nullPrototype = [...values]
      Object.setPrototypeOf(nullPrototype, null)
      const withNullPrototype = storedDashboard(`null-array-${field}`)
      ;(withNullPrototype.elements[0].style as Record<string, unknown>)[field] = nullPrototype
      expect(() => dashboardValidationError(withNullPrototype), `${field} null prototype`).not.toThrow()
      expect(dashboardValidationError(withNullPrototype), `${field} null prototype`).toMatch(/standard Array\.prototype/)

      const accessorArray = [...values]
      Object.defineProperty(accessorArray, '0', {
        configurable: true,
        enumerable: true,
        get: () => { throw new Error(`${field} getter must not run`) }
      })
      const withAccessorArray = storedDashboard(`accessor-array-${field}`)
      ;(withAccessorArray.elements[0].style as Record<string, unknown>)[field] = accessorArray
      expect(() => dashboardValidationError(withAccessorArray), `${field} accessor array`).not.toThrow()
      expect(dashboardValidationError(withAccessorArray), `${field} accessor array`).toMatch(/enumerable data value/)

      const withStyleGetter = storedDashboard(`style-getter-${field}`)
      Object.defineProperty(withStyleGetter.elements[0].style, field, {
        configurable: true,
        enumerable: true,
        get: () => { throw new Error(`${field} style getter must not run`) }
      })
      expect(() => dashboardValidationError(withStyleGetter), `${field} style getter`).not.toThrow()
      expect(dashboardValidationError(withStyleGetter), `${field} style getter`).toMatch(/enumerable data value/)
    }
  })

  it('keeps every public validator total for null/custom prototypes and revoked proxies', () => {
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, storedDashboard('null-prototype'))
    expect(() => dashboardValidationError(nullPrototype)).not.toThrow()
    expect(dashboardValidationError(nullPrototype)).toBeNull()

    const customPrototype = Object.assign(Object.create({ inherited: true }) as Record<string, unknown>, storedDashboard('custom-prototype'))
    expect(() => dashboardValidationError(customPrototype)).not.toThrow()
    expect(dashboardValidationError(customPrototype)).toMatch(/plain JSON objects/)

    const revocable = Proxy.revocable({}, {})
    revocable.revoke()
    expect(() => dashboardValidationError(revocable.proxy)).not.toThrow()
    expect(() => dashboardPlaylistValidationError(revocable.proxy)).not.toThrow()
    expect(() => dashboardStorageValidationResult(revocable.proxy)).not.toThrow()
    expect(() => isDashboard(revocable.proxy)).not.toThrow()
    expect(dashboardValidationError(revocable.proxy)).not.toBeNull()
    expect(dashboardPlaylistValidationError(revocable.proxy)).not.toBeNull()
    expect(dashboardStorageValidationResult(revocable.proxy).status).toBe('quarantine')
    expect(isDashboard(revocable.proxy)).toBe(false)
  })

  it('migrates only unambiguous legacy columns and overlay identities through the real catalog registry', () => {
    const hifi = ALL_VARIANTS.find((variant) =>
      variant.type === 'overlaywidget' && variant.widgetId?.startsWith('hifi:') && variant.hifiModuleId)
    expect(hifi).toBeDefined()
    const legacy = storedDashboard('legacy-generated')
    legacy.elements = [
      {
        id: 'legacy-overlay',
        type: 'overlaywidget',
        x: 0,
        y: 0,
        w: 320,
        h: 160,
        binding: hifi!.binding,
        name: hifi!.label,
        style: {}
      },
      {
        id: 'legacy-table',
        type: 'standings',
        x: 0,
        y: 180,
        w: 500,
        h: 300,
        style: { tableColumns: ['pos', 'number', 'name', 'gap', 'last'], tableMaxRows: 12 }
      }
    ]
    legacy.adaptive = {
      rules: [{
        moment: 'yellow',
        frame: {
          elements: [{
            id: 'legacy-frame-overlay',
            type: 'overlaywidget',
            x: 0,
            y: 0,
            w: 320,
            h: 160,
            widgetId: hifi!.widgetId,
            style: {}
          }]
        }
      }]
    }
    const original = structuredClone(legacy)

    const result = dashboardStorageValidationResult(legacy, { identityCatalog: ALL_VARIANTS })
    expect(result.status).toBe('migrated')
    if (result.status !== 'migrated') throw new Error(result.status === 'quarantine' ? result.error : 'Expected migration')
    expect(result.dashboard.elements[0]).toMatchObject({
      widgetId: hifi!.widgetId,
      hifiModuleId: hifi!.hifiModuleId
    })
    expect(result.dashboard.elements[1].style.tableColumns).toEqual(['pos', 'number', 'name', 'gap', 'laps'])
    expect(result.dashboard.adaptive?.rules?.[0].frame?.elements[0].hifiModuleId).toBe(hifi!.hifiModuleId)
    expect(result.migrations.map((migration) => migration.code)).toEqual(expect.arrayContaining([
      'catalog-overlay-identity',
      'table-column-last-to-laps',
      'derive-hifi-module-id'
    ]))
    expect(dashboardValidationError(result.dashboard)).toBeNull()
    expect(legacy).toEqual(original)
  })

  it('preserves valid existing scalar, array, slot, and instrument styles without cloning or normalization', () => {
    const valid = storedDashboard('preserved')
    valid.elements[0].style = {
      background: 'rgba(0,0,0,.5)',
      opacity: 0.75,
      decimals: 4,
      tableColumns: ['pos', 'number', 'name', 'gap', 'laps'],
      channels: ['throttle', 'brake'],
      fields: ['water', 'oil'],
      slots: {
        value: {
          fontFamily: 'DSEG7',
          fontSize: 42,
          fontColor: '#fff',
          fontWeight: 800,
          align: 'right',
          letterSpacing: 2,
          textTransform: 'uppercase',
          shadow: '0 0 4px #fff'
        }
      },
      instrument: {
        template: 'dial',
        bezel: 'chrome',
        material: 'brushed',
        glow: true,
        parts: {
          led: { segments: 16, shape: 'led', bloom: 0.5, flashAt: 0.97, warnAt: 0.6, dangerAt: 0.85 },
          dial: { startAngleDeg: -130, endAngleDeg: 130, majorTicks: 10, minorPerMajor: 4, damp: 0.2 },
          needle: { color: '#f00', width: 2, tail: 6 },
          scale: { showLabels: true, majorLen: 8, minorLen: 4 },
          segment: { mode: '7', ghost: true, digits: 4 },
          tile: { align: 'center', numeric: true }
        }
      }
    }
    const before = structuredClone(valid)
    const result = dashboardStorageValidationResult(valid)
    expect(result.status).toBe('valid')
    if (result.status !== 'valid') throw new Error(result.status === 'quarantine' ? result.error : 'Unexpected migration')
    expect(result.dashboard).toBe(valid)
    expect(result.migrations).toEqual([])
    expect(valid).toEqual(before)
  })

  it('rejects renderer-crash shapes and out-of-range renderer controls', () => {
    const cases: Array<[string, (dashboard: Dashboard) => void]> = [
      ['React child label', (dashboard) => { (dashboard.elements[0].style as Record<string, unknown>).label = { unsafe: true } }],
      ['non-array channels', (dashboard) => { (dashboard.elements[0].style as Record<string, unknown>).channels = { throttle: true } }],
      ['invalid slot scalar', (dashboard) => { (dashboard.elements[0].style as Record<string, unknown>).slots = { value: { fontSize: [] } } }],
      ['unbounded instrument count', (dashboard) => { dashboard.elements[0].style.instrument = { parts: { led: { segments: 1_000_000 } } } }],
      ['non-JSON style value', (dashboard) => { (dashboard.elements[0].style as Record<string, unknown>).future = new Date() }],
      ['invalid opacity', (dashboard) => { dashboard.elements[0].style.opacity = 2 }],
      ['renderer row overflow', (dashboard) => { dashboard.elements[0].style.tableMaxRows = 65 }],
      ['identity on wrong type', (dashboard) => { (dashboard.elements[0] as unknown as Record<string, unknown>).widgetId = 'future:wrong-type' }]
    ]
    for (const [name, mutate] of cases) {
      const dashboard = storedDashboard(`invalid-${name}`)
      mutate(dashboard)
      expect(dashboardValidationError(dashboard), name).not.toBeNull()
    }
  })

  it('exposes the manager integration contract for valid, rewrite-and-load, and per-file quarantine outcomes', () => {
    const valid = storedDashboard('valid-file')
    const migrated = storedDashboard('migrated-file')
    migrated.elements[0].style.tableColumns = ['pos', 'last']
    const invalid = storedDashboard('invalid-file')
    invalid.elements[0].type = 'overlaywidget'
    const results = [valid, migrated, invalid].map((dashboard) => dashboardStorageValidationResult(dashboard))
    const managerAction = (status: typeof results[number]['status']): string =>
      status === 'valid' ? 'load' : status === 'migrated' ? 'rewrite-and-load' : 'quarantine-file'
    expect(results.map((result) => result.status)).toEqual(['valid', 'migrated', 'quarantine'])
    expect(results.map((result) => managerAction(result.status))).toEqual(['load', 'rewrite-and-load', 'quarantine-file'])
    expect(results[0]).toMatchObject({ status: 'valid', dashboard: valid })
    expect(results[1]).toMatchObject({
      status: 'migrated',
      migrations: [expect.objectContaining({ code: 'table-column-last-to-laps' })]
    })
    expect(results[2]).toMatchObject({ status: 'quarantine', error: expect.stringMatching(/requires widgetId/) })
    expect('dashboard' in results[2]).toBe(false)
  })
})
