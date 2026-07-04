import { describe, expect, it } from 'vitest'
import {
  applyDecimals,
  composeImageFilter,
  createBlankAdaptiveDashboard,
  reorderElements,
  resolveSlotStyle,
  sortElementsByZ,
  type DashboardElement,
  type DashboardElementStyle
} from './dashboards'
import { isAdaptiveDashboard } from './dashboard-adaptive-preset'

function el(id: string, style: DashboardElementStyle = {}): DashboardElement {
  return { id, type: 'text', x: 0, y: 0, w: 10, h: 10, style }
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
