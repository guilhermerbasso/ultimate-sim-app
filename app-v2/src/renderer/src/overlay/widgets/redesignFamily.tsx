import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { overlayDesignFamily } from '../../../../shared/overlays'
import type { OverlayDesignFamily, OverlayWidgetConfig } from '../../../../shared/overlays'
import { COOL_BLUE, GOOD_GREEN, WARM_AMBER, WARM_ORANGE, WARM_RED, clamp } from './raceControl'

// ─── R16 redesign — shared per-family layout kit ─────────────────────────────
// The R16 race-control / energy / extra / gap widgets render a GENUINELY DISTINCT
// structure per design family (8 of them) instead of a recolor. A *style preset*
// only swaps surface colors; a *design family* swaps the layout + typography
// language. Widgets branch on `familyOf(config)` and compose the primitives here.
//
// COLOR RULE (strict): warm tokens (red/orange/amber) + the resolved preset
// accent carry chrome; cool/green/blue are reserved for genuinely positive "good"
// states (full ERS, P2P ready, dry/clear track, faster delta, pits open). Every
// primitive keeps reading the resolved preset CSS vars (`--overlay-accent`,
// `--overlay-bg`, …) so only the LAYOUT differs by family.

export type Family = OverlayDesignFamily

export const FAMILIES: Family[] = [
  'minimal',
  'neon',
  'glass',
  'broadcast',
  'terminal',
  'bauhaus',
  'analog',
  'heatmap'
]

// Resolve a widget config to its design family (falls back to the default
// preset's family — `minimal` — for unknown / missing presets).
export function familyOf(config: OverlayWidgetConfig | undefined): Family {
  return overlayDesignFamily(config?.stylePreset)
}

// ── small pure helpers shared across the redesigned widgets ──────────────────

// Monospace progress bar, e.g. asciiBar(0.62, 10) -> "######····".
export function asciiBar(fill: number, width = 10, on = '#', off = '·'): string {
  const n = Math.round(clamp(fill) * width)
  return on.repeat(n) + off.repeat(Math.max(0, width - n))
}

// [0,1,…,n-1] — handy for segment / cell / pip maps.
export function range(n: number): number[] {
  return Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => i)
}

// Point on a circle (degrees, 0° = +x axis, growing counter-clockwise on screen
// once we negate y). Used for analog dials / radar geometry.
export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180
  return { x: cx + Math.cos(rad) * r, y: cy - Math.sin(rad) * r }
}

// Cold→hot ramp for genuine temperature/pressure cells in the `heatmap` family:
// COOL (blue/green) = low / in-range = the good state; HOT (amber→red) = high /
// attention. Anchored by the global good=cool / hot=warn rule.
export function heatRamp(t: number): string {
  const v = clamp(t)
  if (v < 0.25) return COOL_BLUE
  if (v < 0.5) return GOOD_GREEN
  if (v < 0.72) return WARM_AMBER
  if (v < 0.88) return WARM_ORANGE
  return WARM_RED
}

function cssVars(extra: Record<string, string | number>): CSSProperties {
  return extra as CSSProperties
}

// ── FamilyShell — per-family outer card chrome ───────────────────────────────
// Wraps a widget's content in the shared `.overlay-card` surface plus a
// `rd5-fam-<family>` modifier so the new CSS can give each family a distinct card
// treatment (terminal scanlines, frosted glass, hard bauhaus block, neon void
// grid, broadcast baseline, analog bezel, heatmap mesh, minimal hairline) while
// still reading the resolved preset vars.
export function FamilyShell({
  family,
  name,
  className,
  style,
  accent,
  children
}: {
  family: Family
  name: string
  className?: string
  style?: CSSProperties
  // Optional tone color exposed to CSS as `--rd5-c` (the live/alert color).
  accent?: string
  children: ReactNode
}): ReactElement {
  const classes = ['overlay-card', 'rd5', `rd5-${name}`, `rd5-fam-${family}`, className].filter(Boolean).join(' ')
  const vars = accent ? cssVars({ '--rd5-c': accent }) : undefined
  return (
    <div className={classes} style={{ ...vars, ...style }}>
      {children}
    </div>
  )
}

// ── FamilyMeter — a labelled value with a 0..1 fill, 8 distinct structures ────
// The backbone shape: a label, a formatted value (+unit) and a `fill` magnitude.
// Each family renders it structurally differently — a hairline bar, a glowing
// segment strip, a frosted pill, a boxed lower-third field, a bracketed mono
// row, a giant block, an analog arc gauge or a cold→hot cell strip.
export interface FamilyMeterProps {
  family: Family
  label: string
  value: string
  unit?: string
  fill: number
  color: string
  // When true the fill itself represents a GOOD state (full charge, dry, …) and
  // the heatmap ramp may key cool; otherwise warm chrome leads.
  good?: boolean
  // Optional status word under / beside the value (e.g. "deploy", "sem ERS").
  sub?: string
  // Not-available: render a calm placeholder instead of an active meter.
  na?: boolean
  className?: string
}

export function FamilyMeter(props: FamilyMeterProps): ReactElement {
  const { family, label, value, unit, fill, color, good, sub, na, className } = props
  const f = clamp(fill)
  const dim = 'rgba(255,247,237,0.30)'
  const tone = na ? dim : color

  if (family === 'terminal') {
    const bar = asciiBar(na ? 0 : f, 12)
    return (
      <FamilyShell family={family} name="meter" className={className} accent={tone}>
        <div className="rd5-tm">
          <div className="rd5-tm-line">
            <span className="rd5-tm-key">{label.toUpperCase()}</span>
            <span className="rd5-tm-br">[</span>
            <span className="rd5-tm-fill" style={{ color: tone }}>{bar}</span>
            <span className="rd5-tm-br">]</span>
            <span className="rd5-tm-val" style={{ color: tone }}>{value}{unit}</span>
          </div>
          {sub && <div className="rd5-tm-sub">{`> ${sub}`}</div>}
        </div>
      </FamilyShell>
    )
  }

  if (family === 'bauhaus') {
    return (
      <FamilyShell family={family} name="meter" className={className} accent={tone}>
        <div className="rd5-bh">
          <div className="rd5-bh-num" style={{ color: tone }}>{value}<i>{unit}</i></div>
          <div className="rd5-bh-side">
            <span className="rd5-bh-lab">{label}</span>
            <span className="rd5-bh-block">
              <span className="rd5-bh-fill" style={{ height: `${(na ? 0 : f) * 100}%`, background: tone }} />
            </span>
          </div>
        </div>
        {sub && <div className="rd5-bh-sub">{sub}</div>}
      </FamilyShell>
    )
  }

  if (family === 'analog') {
    const len = 138.2 // semicircle arc length, r=44
    return (
      <FamilyShell family={family} name="meter" className={className} accent={tone}>
        <svg viewBox="0 0 100 64" className="rd5-an-svg" aria-hidden="true">
          <path d="M 8 54 A 44 44 0 0 1 92 54" fill="none" stroke="rgba(255,247,237,0.16)" strokeWidth="6" strokeLinecap="round" />
          <path
            d="M 8 54 A 44 44 0 0 1 92 54"
            fill="none"
            stroke={tone}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${(na ? 0 : f) * len} ${len}`}
          />
          <text x="50" y="44" textAnchor="middle" className="rd5-an-val" fill="#fdf7f0">{value}{unit}</text>
        </svg>
        <span className="rd5-an-lab">{sub ?? label}</span>
      </FamilyShell>
    )
  }

  if (family === 'heatmap') {
    const cells = 16
    const active = na ? 0 : Math.round(f * cells)
    return (
      <FamilyShell family={family} name="meter" className={className} accent={tone}>
        <div className="rd5-hm-head">
          <span className="rd5-hm-lab">{label}</span>
          <b className="rd5-hm-val" style={{ color: tone }}>{value}{unit}</b>
        </div>
        <div className="rd5-hm-cells">
          {range(cells).map((i) => {
            const on = i < active
            // Good states key the active cells to their semantic tone (cool when
            // good); otherwise ramp cold→hot across the strip.
            const c = !on ? 'rgba(255,247,237,0.10)' : good ? tone : heatRamp((i + 1) / cells)
            return <i key={i} style={{ background: c }} />
          })}
        </div>
        {sub && <span className="rd5-hm-sub">{sub}</span>}
      </FamilyShell>
    )
  }

  if (family === 'broadcast') {
    return (
      <FamilyShell family={family} name="meter" className={className} accent={tone}>
        <div className="rd5-bc-row">
          <span className="rd5-bc-tab">{label}</span>
          <span className="rd5-bc-field" style={{ color: tone }}>{value}<i>{unit}</i></span>
        </div>
        <div className="rd5-bc-meter">
          <span className="rd5-bc-fill" style={{ width: `${(na ? 0 : f) * 100}%`, background: tone }} />
        </div>
        {sub && <div className="rd5-bc-sub">{sub}</div>}
      </FamilyShell>
    )
  }

  if (family === 'neon') {
    const segs = 18
    const active = na ? 0 : Math.round(f * segs)
    return (
      <FamilyShell family={family} name="meter" className={className} accent={tone}>
        <div className="rd5-nz-head">
          <span className="rd5-nz-tag">{label}</span>
          <span className="rd5-nz-val" style={{ color: tone, textShadow: `0 0 16px ${tone}` }}>{value}<i>{unit}</i></span>
        </div>
        <div className="rd5-nz-segs">
          {range(segs).map((i) => (
            <i key={i} className={i < active ? 'on' : ''} style={i < active ? { '--seg': tone } as CSSProperties : undefined} />
          ))}
        </div>
        {sub && <span className="rd5-nz-sub" style={{ color: tone }}>{sub}</span>}
      </FamilyShell>
    )
  }

  if (family === 'glass') {
    return (
      <FamilyShell family={family} name="meter" className={className} accent={tone}>
        <div className="rd5-gl">
          <span className="rd5-gl-lab">{label}</span>
          <span className="rd5-gl-val" style={{ color: na ? undefined : tone }}>{value}<i>{unit}</i></span>
          <div className="rd5-gl-bar"><span style={{ width: `${(na ? 0 : f) * 100}%`, background: tone }} /></div>
          {sub && <span className="rd5-gl-sub">{sub}</span>}
        </div>
      </FamilyShell>
    )
  }

  // minimal (default) — one value per line, hairline track.
  return (
    <FamilyShell family={family} name="meter" className={className} accent={tone}>
      <div className="rd5-mn-top">
        <span className="rd5-mn-lab">{label}</span>
        <span className="rd5-mn-val" style={{ color: na ? dim : tone }}>{value}<i>{unit}</i></span>
      </div>
      <div className="rd5-mn-track"><span className="rd5-mn-fill" style={{ width: `${(na ? 0 : f) * 100}%`, background: tone }} /></div>
      {sub && <span className="rd5-mn-sub">{sub}</span>}
    </FamilyShell>
  )
}

// ── FamilyTag — a compact status tag (label + WORD + optional value), 8 ways ──
// Used by the Pit / Wet / Surface "tag" overlays. Each family frames the status
// word differently: a hairline line, a glowing word, a frosted chip, a TV
// label-tab + field, a bracketed mono row, a giant block, an analog status lamp
// or a coloured status cell. The dot/lamp colour is the only place cool/green
// appears (a confirmed good state).
export interface FamilyTagProps {
  family: Family
  label: string
  word: string
  color: string
  good?: boolean
  value?: string
  unit?: string
  note?: string
  className?: string
}

export function FamilyTag(props: FamilyTagProps): ReactElement {
  const { family, label, word, color, value, unit, note, className } = props
  const hasVal = value !== undefined

  if (family === 'terminal') {
    return (
      <FamilyShell family={family} name="tag" className={className} accent={color}>
        <pre className="rd5-tm-block">{`${label.toUpperCase().padEnd(5)}: [${word}]${hasVal ? `  ${value}${unit ?? ''}` : ''}${note ? `\n> ${note}` : ''}`}</pre>
      </FamilyShell>
    )
  }

  if (family === 'bauhaus') {
    return (
      <FamilyShell family={family} name="tag" className={className} accent={color}>
        {hasVal && <div className="rd5-bh-num rd5-bh-num-sm" style={{ color }}>{value}<i>{unit}</i></div>}
        <span className="rd5-tag-bhword" style={{ background: color }}>{word}</span>
        <span className="rd5-bh-lab">{label}{note ? ` · ${note}` : ''}</span>
      </FamilyShell>
    )
  }

  if (family === 'analog') {
    return (
      <FamilyShell family={family} name="tag" className={className} accent={color}>
        <svg viewBox="0 0 40 40" className="rd5-tag-anlamp" aria-hidden="true">
          <circle cx="20" cy="20" r="18" className="rd5-tag-anbezel" />
          <circle cx="20" cy="20" r="13" className="rd5-tag-anface" />
          <circle cx="20" cy="20" r="8" fill={color} style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
        </svg>
        <div className="rd5-tag-anmeta">
          <span className="rd5-tag-anlab">{label}</span>
          <b className="rd5-tag-anword">{word}{hasVal ? <em> {value}{unit}</em> : null}</b>
          {note && <span className="rd5-tag-annote">{note}</span>}
        </div>
      </FamilyShell>
    )
  }

  if (family === 'heatmap') {
    // A thermal status matrix: every cell carries the status tone (green only on a
    // genuinely good state) so the heatmap encoding is unmistakable even for a
    // scalar status. The value (if any) stays prominent and readable.
    return (
      <FamilyShell family={family} name="tag" className={className} accent={color}>
        <div className="rd5-tag-hmtop">
          <span className="rd5-tag-hmword">{word}</span>
          {hasVal && <b className="rd5-tag-hmval" style={{ color }}>{value}{unit}</b>}
        </div>
        <div className="rd5-tag-hmgrid">
          {range(14).map((i) => (
            <i key={i} style={{ background: color, opacity: 0.5 + (i % 7) * 0.07 }} />
          ))}
        </div>
        <span className="rd5-tag-hmlab">{label}{note ? ` · ${note}` : ''}</span>
      </FamilyShell>
    )
  }

  if (family === 'broadcast') {
    return (
      <FamilyShell family={family} name="tag" className={className} accent={color}>
        <div className="rd5-bc-row">
          <span className="rd5-bc-tab">{label}</span>
          <span className="rd5-tag-bcword" style={{ color }}>{word}</span>
          {hasVal && <span className="rd5-tag-bcval">{value}{unit}</span>}
        </div>
        {note && <span className="rd5-tag-bcnote" style={{ color }}>{note}</span>}
      </FamilyShell>
    )
  }

  if (family === 'neon') {
    return (
      <FamilyShell family={family} name="tag" className={className} accent={color}>
        <div className="rd5-tag-ntop">
          <span className="rd5-tag-nlab">{label}</span>
          <span className="rd5-tag-dot" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
        </div>
        <span className="rd5-tag-nword" style={{ color, textShadow: `0 0 18px ${color}` }}>{word}</span>
        {hasVal && <span className="rd5-tag-nval">{value}{unit}</span>}
        {note && <span className="rd5-tag-nnote" style={{ color }}>{note}</span>}
      </FamilyShell>
    )
  }

  if (family === 'glass') {
    return (
      <FamilyShell family={family} name="tag" className={className} accent={color}>
        <div className="rd5-tag-gltop"><span className="rd5-tag-gllab">{label}</span><span className="rd5-tag-dot" style={{ background: color }} /></div>
        <span className="rd5-tag-glword" style={{ color }}>{word}</span>
        {hasVal && <span className="rd5-tag-glval">{value}{unit}</span>}
        {note && <span className="rd5-tag-glnote">{note}</span>}
      </FamilyShell>
    )
  }

  // minimal
  return (
    <FamilyShell family={family} name="tag" className={className} accent={color}>
      <div className="rd5-tag-mntop">
        <span className="rd5-tag-mnlab">{label}</span>
        <span className="rd5-tag-dot" style={{ background: color }} />
      </div>
      <span className="rd5-tag-mnword" style={{ color }}>{word}{hasVal ? <em className="rd5-tag-mnval"> {value}{unit}</em> : null}</span>
      {note && <span className="rd5-tag-mnnote" style={{ color }}>{note}</span>}
    </FamilyShell>
  )
}

// ── FamilyClock — time-of-day, 8 distinct structures ─────────────────────────
// Shared by the TrackClock (large) and SessionClock (compact). Digital DSEG-style
// readouts for terminal/heatmap, an analog dial for analog, a giant block for
// bauhaus, a boxed TV clock for broadcast, glowing digits for neon, frosted for
// glass and a clean line for minimal. Night swaps the environment cue to a cool
// hue (an environment signal, not a "good" claim); day stays warm chrome.
export interface FamilyClockProps {
  family: Family
  label: string
  time: string
  phase: string
  accent: string
  night: boolean
  // 0..1 fraction through the 24h day (for the analog hour hand).
  fraction: number
  // true = large (TrackClock), false = compact (SessionClock).
  big?: boolean
  glyph?: string
}

export function FamilyClock(props: FamilyClockProps): ReactElement {
  const { family, label, time, phase, accent, night, fraction, big, glyph } = props
  const size = big ? 'rd5-clk-big' : 'rd5-clk-sm'

  if (family === 'analog') {
    const hourDeg = 90 - fraction * 360 // 12h dial: top = midnight/noon
    const hand = polar(50, 50, 30, hourDeg)
    return (
      <FamilyShell family={family} name="clock" className={size} accent={accent}>
        <svg viewBox="0 0 100 100" className="rd5-clk-dial" aria-hidden="true">
          <circle cx="50" cy="50" r="46" className="rd5-clk-bezel" />
          <circle cx="50" cy="50" r="40" className="rd5-clk-face" />
          {range(12).map((i) => {
            const a = i * 30
            const o = polar(50, 50, 40, a)
            const inn = polar(50, 50, 35, a)
            return <line key={i} x1={inn.x} y1={inn.y} x2={o.x} y2={o.y} className="rd5-clk-tick" />
          })}
          <line x1="50" y1="50" x2={hand.x} y2={hand.y} className="rd5-clk-hand" style={{ stroke: accent }} />
          <circle cx="50" cy="50" r="3.5" fill={accent} />
        </svg>
        <div className="rd5-clk-meta"><b>{time}</b><span>{phase}</span></div>
      </FamilyShell>
    )
  }

  if (family === 'terminal') {
    return (
      <FamilyShell family={family} name="clock" className={`${size} rd5-clk-digital`} accent={accent}>
        <div className="rd5-clk-dhead"><span>{label}</span><span>{glyph}</span></div>
        <b className="rd5-clk-seg" style={{ color: accent }}>{time}</b>
        <span className="rd5-clk-phase">{`[${phase}]`}</span>
      </FamilyShell>
    )
  }

  if (family === 'heatmap') {
    // Dominant element: a 24-cell (6×4) thermal matrix of the day, coded cold→hot
    // (cool night hours → hot midday), with the current hour ringed and not-yet
    // reached hours dimmed. The time rides above as a smaller label.
    const hours = 24
    const nowH = Math.min(hours - 1, Math.max(0, Math.floor(clamp(fraction) * hours)))
    return (
      <FamilyShell family={family} name="clock" className={`${size} rd5-clk-hm`} accent={accent}>
        <div className="rd5-clk-hmhead">
          <span className="rd5-clk-hmlab">{label}</span>
          <b className="rd5-clk-hmtime" style={{ color: accent }}>{time}</b>
          <span className="rd5-clk-hmglyph">{glyph}</span>
        </div>
        <div className="rd5-clk-hmgrid">
          {range(hours).map((h) => {
            const heat = clamp(1 - Math.abs(h - 14) / 12)
            return (
              <i
                key={h}
                className={h === nowH ? 'now' : ''}
                style={{ background: heatRamp(heat), opacity: h <= nowH ? 1 : 0.3 }}
              />
            )
          })}
        </div>
        <span className="rd5-clk-hmphase">{phase}</span>
      </FamilyShell>
    )
  }

  if (family === 'bauhaus') {
    const [hh, mm] = time.includes(':') ? time.split(':') : [time, '']
    return (
      <FamilyShell family={family} name="clock" className={size} accent={accent}>
        <div className="rd5-clk-bhrow">
          <span className="rd5-clk-bh" style={{ background: accent }}>{hh}</span>
          <span className="rd5-clk-bh rd5-clk-bh2">{mm}</span>
        </div>
        <span className="rd5-clk-bhlab">{label} · {phase}</span>
      </FamilyShell>
    )
  }

  if (family === 'broadcast') {
    return (
      <FamilyShell family={family} name="clock" className={size} accent={accent}>
        <div className="rd5-clk-bcrow">
          <span className="rd5-clk-bctab">{label}</span>
          <b className="rd5-clk-bcval">{time}</b>
        </div>
        <span className="rd5-clk-bcphase" style={{ color: accent }}>{glyph} {phase}</span>
      </FamilyShell>
    )
  }

  if (family === 'neon') {
    return (
      <FamilyShell family={family} name="clock" className={`${size} ${night ? 'is-night' : ''}`} accent={accent}>
        <span className="rd5-clk-ntag">{label}</span>
        <b className="rd5-clk-nval" style={{ color: accent, textShadow: `0 0 22px ${accent}` }}>{time}</b>
        <span className="rd5-clk-nphase">{glyph} {phase}</span>
      </FamilyShell>
    )
  }

  if (family === 'glass') {
    return (
      <FamilyShell family={family} name="clock" className={size} accent={accent}>
        <div className="rd5-clk-gltop"><span>{label}</span><span style={{ color: accent }}>{glyph}</span></div>
        <b className="rd5-clk-glval">{time}</b>
        <span className="rd5-clk-glphase">{phase}</span>
      </FamilyShell>
    )
  }

  // minimal
  return (
    <FamilyShell family={family} name="clock" className={size} accent={accent}>
      <div className="rd5-clk-mntop">
        <span className="rd5-clk-mnlab">{label}</span>
        <span className="rd5-clk-mnglyph" style={{ color: accent }}>{glyph}</span>
      </div>
      <b className="rd5-clk-mnval">{time}</b>
      <span className="rd5-clk-mnphase">{phase}</span>
    </FamilyShell>
  )
}

// Tiny helper so widgets can keep one-line guards readable.
export function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return String(value)
}
