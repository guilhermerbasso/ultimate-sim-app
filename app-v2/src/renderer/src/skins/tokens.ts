// Two-skin token system (v2.39) — the single source every widget consumes so a
// skin switch is one object swap (fixes "only a few gauges re-skinned"). Concrete
// values triangulated from the 3-model deep research (opus.md §6 / gemini.md §6).
//
// Skins:
//   gt3 — real GT3/LMDh wheel display: dark, carbon, DSEG segmented, top rev-LEDs
//         (incl. blue redline), corner telltales.
//   hud — premium sim HUD: translucent glass, big geometric type, thin lines.
// Brand overlays (stuttgart/bavaria/maranello/generic) change ONLY palette + LED
// behaviour — NO trademarked logos are shipped; the logo is a user-fillable slot.

export type SkinId = 'gt3' | 'hud'
export type BrandId = 'generic' | 'stuttgart' | 'bavaria' | 'maranello'

// Colour tokens are plain strings so both hex (#RRGGBB) and rgba()/hsl() work.
export type ColorToken = string
export type Ms = number

export interface LedZone {
  /** Fill this zone while shiftPct ≤ upTo (0..1). */
  upTo: number
  color: ColorToken
}

export interface LedProfile {
  count: number
  /** Porsche/AiM mirror the fill outward from the centre. */
  mirrored: boolean
  zones: LedZone[]
  redline: { color: ColorToken; blinkMs: Ms }
  pitLimiter: { color: ColorToken; blinkMs: Ms }
  /** Unlit LED opacity — never pure black. */
  offOpacity: number
  bloom: boolean
  shape: 'round' | 'rect' | 'pill'
}

export interface SegmentStyle {
  numeric: string
  alpha: string
  /** Draw the dim "all segments on" ghost backing (real LCD look). */
  ghost: boolean
  ghostOpacity: number
  /** Italic LCD slant in degrees (0 or ~ -6). */
  skewDeg: number
}

export interface Material {
  kind: 'carbon' | 'brushed' | 'glass' | 'flat'
  base: ColorToken
  texture?: { url: string; opacity: number; blend: string }
  border: ColorToken
  borderWidth: number
  radius: number
  /** hud glass only. */
  backdropBlur?: number
  panelAlpha?: number
}

export interface TelltaleColors {
  abs: ColorToken
  tc: ColorToken
  pit: ColorToken
  fuel: ColorToken
  rain: ColorToken
  beamLow: ColorToken
  beamHigh: ColorToken
  flagGreen: ColorToken
  flagWhite: ColorToken
  flagBlue: ColorToken
  flagYellow: ColorToken
  flagRed: ColorToken
  tempWarn: ColorToken
  tempCrit: ColorToken
}

export interface TelltaleSet {
  iconSource: 'game-icons' | 'material-symbols' | 'tabler'
  cellPx: number
  colors: TelltaleColors
  blinkMs: Ms
}

export interface Typography {
  gear: string
  value: string
  label: string
  tabularFigures: true
  /** Legibility floor (design units / px). Below this a field drops/abbreviates. */
  minFontPx: number
}

export interface Palette {
  bg: ColorToken
  surface: ColorToken
  text: ColorToken
  textDim: ColorToken
  accent: ColorToken
  ok: ColorToken
  warn: ColorToken
  crit: ColorToken
  deltaFaster: ColorToken
  deltaSlower: ColorToken
  info: ColorToken
}

export interface LogoSlot {
  /** User-supplied image (data: URL preferred). Never a bundled trademark. */
  url?: string
  region: 'centerTop' | 'idleScreen'
  maxBox: [number, number]
}

export interface Motion {
  easingMs: Ms
  shiftPulse: boolean
}

export interface SkinToken {
  id: SkinId
  brand: BrandId
  palette: Palette
  typography: Typography
  material: Material
  segment: SegmentStyle
  led: LedProfile
  telltale: TelltaleSet
  logoSlot?: LogoSlot
  motion: Motion
}

export const SKIN_IDS: readonly SkinId[] = ['gt3', 'hud']
export const BRAND_IDS: readonly BrandId[] = ['generic', 'stuttgart', 'bavaria', 'maranello']

// ── Base skins ───────────────────────────────────────────────────────────────

export const gt3Base: SkinToken = {
  id: 'gt3',
  brand: 'generic',
  palette: {
    bg: '#050608',
    surface: '#0B0E12',
    text: '#F5F7FA',
    textDim: '#8A93A0',
    accent: '#00E0FF',
    ok: '#16A34A',
    warn: '#F59E0B',
    crit: '#DC2626',
    deltaFaster: '#16A34A',
    deltaSlower: '#DC2626',
    info: '#2563FF'
  },
  typography: {
    gear: 'DSEG7 Classic',
    value: 'DSEG7 Classic',
    label: 'Saira Condensed',
    tabularFigures: true,
    minFontPx: 11
  },
  material: {
    kind: 'carbon',
    base: '#0B0E12',
    texture: { url: '/assets/tex/carbon.png', opacity: 0.18, blend: 'overlay' },
    border: '#1C2128',
    borderWidth: 2,
    radius: 10
  },
  segment: { numeric: 'DSEG7 Classic', alpha: 'DSEG14 Classic', ghost: true, ghostOpacity: 0.07, skewDeg: 0 },
  led: {
    count: 15,
    mirrored: false,
    zones: [
      { upTo: 0.55, color: '#16A34A' },
      { upTo: 0.8, color: '#F59E0B' },
      { upTo: 0.98, color: '#DC2626' }
    ],
    redline: { color: '#2563FF', blinkMs: 100 },
    pitLimiter: { color: '#2563FF', blinkMs: 200 },
    offOpacity: 0.08,
    bloom: true,
    shape: 'rect'
  },
  telltale: {
    iconSource: 'game-icons',
    cellPx: 40,
    blinkMs: 250,
    colors: {
      abs: '#F59E0B',
      tc: '#F59E0B',
      pit: '#2563FF',
      fuel: '#DC2626',
      rain: '#FB923C',
      beamLow: '#16A34A',
      beamHigh: '#2563FF',
      flagGreen: '#16A34A',
      flagWhite: '#FFFFFF',
      flagBlue: '#2563FF',
      flagYellow: '#F59E0B',
      flagRed: '#DC2626',
      tempWarn: '#F59E0B',
      tempCrit: '#DC2626'
    }
  },
  motion: { easingMs: 120, shiftPulse: true }
}

export const hudBase: SkinToken = {
  ...gt3Base,
  id: 'hud',
  brand: 'generic',
  palette: { ...gt3Base.palette, surface: 'rgba(11,14,18,0.72)', accent: '#38BDF8' },
  typography: { gear: 'Teko', value: 'Rajdhani', label: 'Saira Condensed', tabularFigures: true, minFontPx: 12 },
  material: {
    kind: 'glass',
    base: 'rgba(11,14,18,0.72)',
    border: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    radius: 16,
    backdropBlur: 16,
    panelAlpha: 0.72
  },
  segment: { numeric: 'Rajdhani', alpha: 'Rajdhani', ghost: false, ghostOpacity: 0, skewDeg: 0 },
  led: { ...gt3Base.led, shape: 'pill', bloom: true },
  telltale: { ...gt3Base.telltale, iconSource: 'material-symbols', cellPx: 32 },
  motion: { easingMs: 180, shiftPulse: true }
}

// ── Brand overlays (palette + LED behaviour only — no logos) ──────────────────

type BrandOverlay = { palette?: Partial<Palette>; led?: Partial<LedProfile> }

const BRAND_OVERLAYS: Record<Exclude<BrandId, 'generic'>, BrandOverlay> = {
  stuttgart: {
    palette: { accent: '#D5001C' },
    led: {
      count: 10,
      mirrored: true,
      zones: [
        { upTo: 0.5, color: '#16A34A' },
        { upTo: 0.75, color: '#F59E0B' },
        { upTo: 0.97, color: '#DC2626' }
      ]
    }
  },
  bavaria: {
    palette: { accent: '#1C69D4' },
    led: { count: 15, mirrored: false }
  },
  maranello: {
    palette: { accent: '#DC0000', warn: '#F59E0B' },
    led: { count: 10, mirrored: true, shape: 'round' }
  }
}

/**
 * Resolve the effective skin token for a given skin id + brand. Brand overlays
 * are merged onto the base (palette + led shallow-merged so base-skin fields —
 * e.g. the hud pill LED shape — survive). `generic` returns the base unchanged.
 */
export function resolveSkin(id: SkinId = 'gt3', brand: BrandId = 'generic'): SkinToken {
  const base = id === 'hud' ? hudBase : gt3Base
  if (brand === 'generic') return { ...base, brand: 'generic' }
  const overlay = BRAND_OVERLAYS[brand]
  return {
    ...base,
    brand,
    palette: { ...base.palette, ...(overlay.palette ?? {}) },
    led: overlay.led ? { ...base.led, ...overlay.led } : base.led
  }
}

/** Colour for a shift fraction (0..1) against a LED profile's zones. */
export function zoneColor(profile: LedProfile, pct: number): ColorToken {
  const p = Number.isFinite(pct) ? Math.max(0, Math.min(1, pct)) : 0
  for (const z of profile.zones) {
    if (p <= z.upTo) return z.color
  }
  return profile.redline.color
}
