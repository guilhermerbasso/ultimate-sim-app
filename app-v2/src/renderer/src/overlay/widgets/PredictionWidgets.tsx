import type { CSSProperties, ReactElement } from 'react'
import { GOOD_GREEN, WARM_AMBER, WARM_RED, clamp } from './raceControl'
import { FamilyShell, familyOf, range } from './redesignFamily'
import type { Family } from './redesignFamily'
import './redesign-r16.css'
import type { WidgetProps } from './types'
import { BezelRing, DataTile, INSTRUMENT_COLORS, SegmentReadout } from '../../instruments'
import {
  type PredTone,
  type PredView,
  caughtBehindView,
  catchAheadView,
  fuelView,
  paceView,
  tireView,
  usePredictionsSnapshot
} from '../../lib/predictions'

// ─── Prediction overlays (WS-H) ──────────────────────────────────────────────
// Five glanceable overlays that render the WS-G `PredictionsSnapshot` (catch-up
// ahead/behind, fuel-to-the-end margin, tyre wear/cliff, projected pace). Data is
// NEVER recomputed here: each overlay subscribes to the `predictions:snapshot`
// broadcast through the shared `usePredictionsSnapshot()` store and reuses the
// pure view builders in lib/predictions.ts.
//
// Layout reuses the SAME 8-design-family kit as the R16 redesign (FamilyMeter →
// minimal hairline / neon segments / frosted glass / broadcast lower-third /
// terminal ascii / bauhaus block / analog arc / heatmap cells) via familyOf().
//
// COLOUR RULE (strict, shared with the rest of the fleet): warm tokens
// (amber/red) mark a BAD / under-threat state; cool green marks a GOOD state
// (you are closing on the car ahead, fuel surplus, trusted pace). A neutral
// reading inherits the resolved preset accent (warm chrome).

// Map the semantic tone from the view builders to the overlay colour tokens.
function toneColor(tone: PredTone): string {
  switch (tone) {
    case 'good':
      return GOOD_GREEN
    case 'caution':
      return WARM_AMBER
    case 'alert':
      return WARM_RED
    default:
      return 'var(--overlay-accent)'
  }
}

function valueIsNumeric(value: string): boolean {
  return /^\s*[-−+±]?\d/.test(value)
}

function safeId(label: string): string {
  return label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}

function PredReadout({
  label,
  view,
  color,
  height = 38,
  idPrefix
}: {
  label: string
  view: PredView
  color: string
  height?: number
  idPrefix: string
}): ReactElement {
  return (
    <SegmentReadout
      label={label}
      value={view.value || '—'}
      mode={view.has && valueIsNumeric(view.value) ? '7' : undefined}
      unit={view.has ? view.unit : undefined}
      height={height}
      align="center"
      color={view.has ? color : INSTRUMENT_COLORS.textMuted}
      idPrefix={idPrefix}
    />
  )
}

function PredTile({ label, value, idPrefix }: { label: string; value: string; idPrefix: string }): ReactElement {
  return (
    <DataTile
      label={label}
      value={value || '—'}
      width={132}
      height={32}
      material="matte"
      accent={INSTRUMENT_COLORS.chrome}
      idPrefix={idPrefix}
    />
  )
}

// One renderer for all five overlays — the differences are entirely in the data
// the view builder produced (label + view), so every overlay stays consistent.
function PredictionMeter({ config, label, view }: { config: WidgetProps['config']; label: string; view: PredView }): ReactElement {
  const family: Family = familyOf(config)
  const f = clamp(view.fill)
  const dim = 'rgba(255,247,237,0.30)'
  const tone = view.has ? toneColor(view.tone) : dim
  const accent = view.has ? tone : 'var(--overlay-accent)'
  const cls = `pred-meter${view.has ? '' : ' no-data'}`
  const idBase = safeId(label)
  const readout = (height?: number) => (
    <PredReadout label={label} view={view} color={tone} height={height} idPrefix={`pred-${idBase}-${family}`} />
  )
  const subTile = <PredTile label="Status" value={view.sub} idPrefix={`pred-${idBase}-${family}-sub`} />

  if (family === 'terminal') {
    const bar = range(12).map((i) => (i < Math.round((view.has ? f : 0) * 12) ? '#' : '·')).join('')
    return (
      <FamilyShell family={family} name="meter" className={cls} accent={tone}>
        <div className="rd5-tm">
          <div className="rd5-tm-line">
            <span className="rd5-tm-key">{label.toUpperCase()}</span>
            <span className="rd5-tm-br">[</span>
            <span className="rd5-tm-fill" style={{ color: tone }}>{bar}</span>
            <span className="rd5-tm-br">]</span>
          </div>
          {readout(28)}
          {view.sub && <div className="rd5-tm-sub">{`> ${view.sub}`}</div>}
        </div>
      </FamilyShell>
    )
  }

  if (family === 'bauhaus') {
    return (
      <FamilyShell family={family} name="meter" className={cls} accent={tone}>
        <div className="rd5-bh">
          <div className="rd5-bh-num" style={{ color: tone }}>{readout(44)}</div>
          <div className="rd5-bh-side">
            <span className="rd5-bh-lab">{label}</span>
            <span className="rd5-bh-block">
              <span className="rd5-bh-fill" style={{ height: `${(view.has ? f : 0) * 100}%`, background: tone }} />
            </span>
          </div>
        </div>
        {view.sub && <div className="rd5-bh-sub">{view.sub}</div>}
      </FamilyShell>
    )
  }

  if (family === 'analog') {
    const len = 138.2
    return (
      <FamilyShell family={family} name="meter" className={cls} accent={tone}>
        <span style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
          <BezelRing size={92} thickness={7} kind="double" material="carbon" idPrefix={`pred-${idBase}-bezel`} />
          <svg viewBox="0 0 100 64" className="rd5-an-svg" aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
            <path d="M 8 54 A 44 44 0 0 1 92 54" fill="none" stroke="rgba(255,247,237,0.16)" strokeWidth="6" strokeLinecap="round" />
            <path
              d="M 8 54 A 44 44 0 0 1 92 54"
              fill="none"
              stroke={tone}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${(view.has ? f : 0) * len} ${len}`}
            />
          </svg>
          <span style={{ position: 'absolute', left: 8, right: 8, top: 24 }}>{readout(24)}</span>
        </span>
        <span className="rd5-an-lab">{view.sub || label}</span>
      </FamilyShell>
    )
  }

  if (family === 'heatmap') {
    const cells = 16
    const active = view.has ? Math.round(f * cells) : 0
    return (
      <FamilyShell family={family} name="meter" className={cls} accent={tone}>
        <div className="rd5-hm-head">
          <span className="rd5-hm-lab">{label}</span>
          <b className="rd5-hm-val" style={{ color: tone }}>{readout(26)}</b>
        </div>
        <div className="rd5-hm-cells">
          {range(cells).map((i) => {
            const on = i < active
            const c = !on ? 'rgba(255,247,237,0.10)' : view.good ? tone : WARM_AMBER
            return <i key={i} style={{ background: c }} />
          })}
        </div>
        {view.sub && <span className="rd5-hm-sub">{view.sub}</span>}
      </FamilyShell>
    )
  }

  if (family === 'broadcast') {
    return (
      <FamilyShell family={family} name="meter" className={cls} accent={tone}>
        <div className="rd5-bc-row">
          <span className="rd5-bc-tab">{label}</span>
          <span className="rd5-bc-field" style={{ color: tone }}>{readout(32)}</span>
        </div>
        <div className="rd5-bc-meter">
          <span className="rd5-bc-fill" style={{ width: `${(view.has ? f : 0) * 100}%`, background: tone }} />
        </div>
        {view.sub && <div className="rd5-bc-sub">{view.sub}</div>}
      </FamilyShell>
    )
  }

  if (family === 'neon') {
    const segs = 18
    const active = view.has ? Math.round(f * segs) : 0
    return (
      <FamilyShell family={family} name="meter" className={cls} accent={tone}>
        <div className="rd5-nz-head">
          <span className="rd5-nz-tag">{label}</span>
          <span className="rd5-nz-val" style={{ color: tone, textShadow: `0 0 16px ${tone}` }}>{readout(34)}</span>
        </div>
        <div className="rd5-nz-segs">
          {range(segs).map((i) => (
            <i key={i} className={i < active ? 'on' : ''} style={i < active ? { '--seg': tone } as CSSProperties : undefined} />
          ))}
        </div>
        {view.sub && <span className="rd5-nz-sub" style={{ color: tone }}>{view.sub}</span>}
      </FamilyShell>
    )
  }

  if (family === 'glass') {
    return (
      <FamilyShell family={family} name="meter" className={cls} accent={tone}>
        <div className="rd5-gl">
          <span className="rd5-gl-lab">{label}</span>
          <span className="rd5-gl-val" style={{ color: view.has ? tone : undefined }}>{readout(34)}</span>
          <div className="rd5-gl-bar"><span style={{ width: `${(view.has ? f : 0) * 100}%`, background: tone }} /></div>
          {view.sub && <span className="rd5-gl-sub">{view.sub}</span>}
        </div>
      </FamilyShell>
    )
  }

  return (
    <FamilyShell family={family} name="meter" className={cls} accent={accent}>
      <div className="rd5-mn-top">
        <span className="rd5-mn-lab">{label}</span>
        <span className="rd5-mn-val" style={{ color: view.has ? tone : dim }}>{readout(34)}</span>
      </div>
      <div className="rd5-mn-track"><span className="rd5-mn-fill" style={{ width: `${(view.has ? f : 0) * 100}%`, background: tone }} /></div>
      {view.sub && <span className="rd5-mn-sub">{subTile}</span>}
    </FamilyShell>
  )
}

export function CatchAheadWidget({ config }: WidgetProps): ReactElement {
  const snapshot = usePredictionsSnapshot()
  return <PredictionMeter config={config} label="Catch" view={catchAheadView(snapshot?.catchAhead)} />
}

export function CaughtBehindWidget({ config }: WidgetProps): ReactElement {
  const snapshot = usePredictionsSnapshot()
  return <PredictionMeter config={config} label="Threat behind" view={caughtBehindView(snapshot?.caughtBehind)} />
}

export function FuelMarginWidget({ config }: WidgetProps): ReactElement {
  const snapshot = usePredictionsSnapshot()
  return <PredictionMeter config={config} label="Fuel to finish" view={fuelView(snapshot)} />
}

export function TireWearPredWidget({ config }: WidgetProps): ReactElement {
  const snapshot = usePredictionsSnapshot()
  return <PredictionMeter config={config} label="Tire wear" view={tireView(snapshot)} />
}

export function PaceProjectedWidget({ config }: WidgetProps): ReactElement {
  const snapshot = usePredictionsSnapshot()
  return <PredictionMeter config={config} label="Pace projetado" view={paceView(snapshot)} />
}
