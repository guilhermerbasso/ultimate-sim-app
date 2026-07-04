// ── Reusable SVG <defs> builders ──────────────────────────────────────────────
// Procedural, brand-neutral material / gradient / glow definitions shared by every
// instrument primitive. All ids are namespaced by a per-instance `uid` so multiple
// instruments on one page never collide on filter/gradient/pattern references.
//
// Materials: matte black, a 2×2 carbon-weave <pattern>, and a brushed-metal
// gradient+hatch. Glow: an feGaussianBlur LED/alert bloom that is allowed to
// overflow its source bounds (~10%+ of the LED radius).

import { useId, type ReactElement } from 'react'
import { type InstrumentColors, type MaterialKind } from './tokens'

/** Per-instance, SVG-id-safe unique prefix (strips React useId colons). */
export function useUid(idPrefix?: string): string {
  const auto = useId()
  return (idPrefix ?? auto).replace(/[^a-zA-Z0-9_-]/g, '') || 'inst'
}

// ── Material fills ────────────────────────────────────────────────────────────
export interface MaterialFill {
  /** Value to drop into a `fill=""`/`stroke=""` attribute. */
  fill: string
  /** <defs> children that back the fill (empty fragment for matte). */
  defs: ReactElement | null
}

/**
 * Resolve a material into an SVG paint + its backing <defs> content. Matte returns
 * a flat colour with no defs (the procedural fallback every primitive degrades to).
 */
export function materialFill(kind: MaterialKind, uid: string, colors: InstrumentColors): MaterialFill {
  if (kind === 'carbon') {
    const id = `${uid}-carbon`
    return {
      fill: `url(#${id})`,
      defs: (
        <pattern id={id} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={8} height={8} fill={colors.recess} />
          {/* 2×2 over-under weave: two light tiles on a diagonal, two dark. */}
          <rect x={0} y={0} width={4} height={4} fill="#161616" />
          <rect x={4} y={4} width={4} height={4} fill="#161616" />
          <rect x={4} y={0} width={4} height={4} fill="#0b0b0b" />
          <rect x={0} y={4} width={4} height={4} fill="#0b0b0b" />
          <path d="M0 0h4v4h-4z M4 4h4v4h-4z" fill="#1d1d1d" opacity={0.5} />
        </pattern>
      )
    }
  }
  if (kind === 'brushed') {
    const gid = `${uid}-brushed`
    const hid = `${uid}-brushedhatch`
    return {
      fill: `url(#${gid})`,
      defs: (
        <>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.bezelHi} />
            <stop offset="45%" stopColor={colors.bezel} />
            <stop offset="55%" stopColor={colors.bezel} />
            <stop offset="100%" stopColor={colors.bezelLo} />
          </linearGradient>
          <pattern id={hid} width={3} height={2} patternUnits="userSpaceOnUse">
            <rect width={3} height={2} fill={`url(#${gid})`} />
            <line x1={0} y1={0} x2={3} y2={0} stroke="#ffffff" strokeOpacity={0.04} strokeWidth={0.5} />
          </pattern>
        </>
      )
    }
  }
  // matte
  return { fill: colors.surface, defs: null }
}

// ── LED / alert bloom filter ──────────────────────────────────────────────────
/**
 * A Gaussian-blur bloom whose filter region is enlarged so the glow overflows the
 * source geometry by `overflow` (fraction of bounding box, default ~0.6 → well past
 * an LED's ~10% radius halo). Used for lit LEDs and active telltale/alert lamps.
 */
export function bloomFilter(id: string, stdDev: number, overflow = 0.6): ReactElement {
  const pad = `${-overflow * 50}%`
  const span = `${100 + overflow * 100}%`
  return (
    <filter id={id} x={pad} y={pad} width={span} height={span} colorInterpolationFilters="sRGB">
      <feGaussianBlur stdDeviation={Math.max(0.01, stdDev)} result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  )
}

// ── Radial "on" gradient for a lit LED dome ───────────────────────────────────
export function ledOnGradient(id: string, color: string, core = '#ffffff'): ReactElement {
  return (
    <radialGradient id={id} cx="50%" cy="42%" r="60%">
      <stop offset="0%" stopColor={core} stopOpacity={0.95} />
      <stop offset="35%" stopColor={color} stopOpacity={1} />
      <stop offset="100%" stopColor={color} stopOpacity={0.85} />
    </radialGradient>
  )
}

// ── Radial "off" muscle for an unlit LED dome (diffuse, no glow) ──────────────
export function ledOffGradient(id: string, base = '#0a0a0a'): ReactElement {
  return (
    <radialGradient id={id} cx="50%" cy="40%" r="65%">
      <stop offset="0%" stopColor="#1a1a1a" />
      <stop offset="60%" stopColor={base} />
      <stop offset="100%" stopColor="#040404" />
    </radialGradient>
  )
}

// ── Layered bezel gradient (warm-chrome discipline) ───────────────────────────
export function bezelGradient(id: string, colors: InstrumentColors): ReactElement {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stopColor={colors.bezelHi} />
      <stop offset="30%" stopColor={colors.bezel} />
      <stop offset="70%" stopColor={colors.bezelLo} />
      <stop offset="100%" stopColor="#000000" />
    </linearGradient>
  )
}
