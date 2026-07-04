import type { ReactElement } from 'react'
import { numberOrDash } from './format'
import { getGt3Warnings, gt3SeverityClass, GT3_STREAM_SAFE, type Gt3Warning } from './gt3Telemetry'
import { overlayDesignFamily, type OverlayDesignFamily } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import './redesign-radar.css'

export const GT3_ALARM_STREAM_SAFE = GT3_STREAM_SAFE

interface AlarmModel {
  alarm?: Gt3Warning
  idle: boolean
  water?: number
  oil?: number
  waterTone: string
  oilTone: string
  severityClass: string
}

function tempTone(value: number | undefined, warm: number, hot: number): string {
  if (value === undefined) return ''
  return value >= hot ? 'is-hot' : value >= warm ? 'is-warm' : 'is-cool'
}

function buildModel(snapshot: TelemetrySnapshot | null): AlarmModel {
  const [alarm] = getGt3Warnings(snapshot)
  return {
    alarm,
    idle: !alarm,
    water: snapshot?.waterTempC,
    oil: snapshot?.oilTempC,
    waterTone: tempTone(snapshot?.waterTempC, 105, 115),
    oilTone: tempTone(snapshot?.oilTempC, 125, 140),
    severityClass: alarm ? gt3SeverityClass(alarm.severity) : 'is-idle'
  }
}

function rootClass(family: OverlayDesignFamily, variant: string, model: AlarmModel): string {
  return `overlay-card rd3-root rd3-alarm ${variant} rd3-fam-${family} ${model.idle ? 'is-idle' : model.severityClass}`
}

// ─── terminal — ASCII alarm console ───────────────────────────────────────────
function AlarmTerminal({ model, family }: { model: AlarmModel; family: OverlayDesignFamily }): ReactElement {
  const a = model.alarm
  const rows = [
    `> NAME : ${(a?.label ?? 'CLEAR').toUpperCase()}`,
    `> INFO : ${a?.detail ?? 'no active alarm'}`,
    `> TEMP : WATER ${numberOrDash(model.water, 0)}C  OIL ${numberOrDash(model.oil, 0)}C`
  ].join('\n')
  return (
    <div className={rootClass(family, 'rd3-alarm--ascii', model)} aria-hidden={model.idle}>
      <pre className="rd3-alarm-ascii-head">{`!! ALARM !!`}</pre>
      <pre className="rd3-alarm-ascii-body">{rows}</pre>
    </div>
  )
}

// ─── bauhaus — giant flat alarm block ─────────────────────────────────────────
function AlarmBauhaus({ model, family }: { model: AlarmModel; family: OverlayDesignFamily }): ReactElement {
  const a = model.alarm
  return (
    <div className={rootClass(family, 'rd3-alarm--blocks', model)} aria-hidden={model.idle}>
      <div className="rd3-alarm-bh-glyph">⚠</div>
      <div className="rd3-alarm-bh-main">
        <strong>{a?.label ?? 'CLEAR'}</strong>
        <span>{a?.detail ?? 'No active alarm'}</span>
      </div>
      <div className="rd3-alarm-bh-vitals">
        <div className={model.waterTone}>
          <span>H₂O</span>
          <b>{numberOrDash(model.water, 0)}</b>
        </div>
        <div className={model.oilTone}>
          <span>OIL</span>
          <b>{numberOrDash(model.oil, 0)}</b>
        </div>
      </div>
    </div>
  )
}

// ─── analog — warning tell-tale lamp ──────────────────────────────────────────
function AlarmAnalog({ model, family }: { model: AlarmModel; family: OverlayDesignFamily }): ReactElement {
  const a = model.alarm
  return (
    <div className={rootClass(family, 'rd3-alarm--lamp', model)} aria-hidden={model.idle}>
      <svg viewBox="0 0 90 90" className="rd3-alarm-lamp-svg" aria-hidden="true">
        <circle cx="45" cy="45" r="40" className="rd3-alarm-lamp-bezel" />
        <circle cx="45" cy="45" r="32" className="rd3-alarm-lamp-glass" />
        <text x="45" y="58" textAnchor="middle" className="rd3-alarm-lamp-glyph">⚠</text>
      </svg>
      <div className="rd3-alarm-lamp-body">
        <strong>{a?.label ?? 'CLEAR'}</strong>
        <span>{a?.detail ?? 'No active alarm'}</span>
        <div className="rd3-alarm-lamp-vitals">
          <span className={model.waterTone}>Water {numberOrDash(model.water, 0)}°</span>
          <span className={model.oilTone}>Oil {numberOrDash(model.oil, 0)}°</span>
        </div>
      </div>
    </div>
  )
}

// ─── heatmap — vitals + alarm cells ───────────────────────────────────────────
function AlarmHeatmap({ model, family }: { model: AlarmModel; family: OverlayDesignFamily }): ReactElement {
  const a = model.alarm
  return (
    <div className={rootClass(family, 'rd3-alarm--cells', model)} aria-hidden={model.idle}>
      <div className="rd3-alarm-hcell alarm">
        <span>ALARM</span>
        <b>{a?.label ?? 'CLEAR'}</b>
        <small>{a?.detail ?? '—'}</small>
      </div>
      <div className={`rd3-alarm-hcell ${model.waterTone}`}>
        <span>WATER</span>
        <b>{numberOrDash(model.water, 0)}</b>
        <small>°C</small>
      </div>
      <div className={`rd3-alarm-hcell ${model.oilTone}`}>
        <span>OIL</span>
        <b>{numberOrDash(model.oil, 0)}</b>
        <small>°C</small>
      </div>
    </div>
  )
}

// ─── broadcast — boxed alert with label tab + chips ───────────────────────────
function AlarmBroadcast({ model, family }: { model: AlarmModel; family: OverlayDesignFamily }): ReactElement {
  const a = model.alarm
  return (
    <div className={rootClass(family, 'rd3-alarm--boxed', model)} aria-hidden={model.idle}>
      <div className="rd3-alarm-box-bar">
        <span className="rd3-alarm-tab">ALARM</span>
        <span className="rd3-alarm-box-name">{a?.label ?? 'CLEAR'}</span>
      </div>
      <div className="rd3-alarm-box-body">
        <span className="rd3-alarm-box-detail">{a?.detail ?? 'No active alarm'}</span>
        <div className="rd3-alarm-box-chips">
          <span className={model.waterTone}>
            <b>WATER</b> {numberOrDash(model.water, 0)}°
          </span>
          <span className={model.oilTone}>
            <b>OIL</b> {numberOrDash(model.oil, 0)}°
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── minimal / neon / glass — shared alert panel, treatment via family ────────
// Vertical stack (alarm banner over a temps row), all full-width, so the long
// flag labels can never overflow horizontally regardless of the widget's width.
function AlarmPanel({ model, family }: { model: AlarmModel; family: OverlayDesignFamily }): ReactElement {
  const a = model.alarm
  return (
    <div className={rootClass(family, 'rd3-alarm--panel', model)} aria-hidden={model.idle}>
      <div className="rd3-alarm-banner">
        <div className="rd3-alarm-tagline">
          <strong>ALARM</strong>
          <span>⚠</span>
        </div>
        <div className="rd3-alarm-name">{a?.label ?? 'CLEAR'}</div>
        <div className="rd3-alarm-detail">{a?.detail ?? 'No active alarm'}</div>
      </div>
      <div className="rd3-alarm-temps">
        <div className={model.waterTone}>
          <span>Water</span>
          <strong>{numberOrDash(model.water, 0)}°</strong>
        </div>
        <div className={model.oilTone}>
          <span>Oil</span>
          <strong>{numberOrDash(model.oil, 0)}°</strong>
        </div>
      </div>
    </div>
  )
}

export function GT3AlarmWidget({ snapshot, config }: WidgetProps): ReactElement {
  const family = overlayDesignFamily(config.stylePreset)
  const model = buildModel(snapshot)

  switch (family) {
    case 'terminal':
      return <AlarmTerminal model={model} family={family} />
    case 'bauhaus':
      return <AlarmBauhaus model={model} family={family} />
    case 'analog':
      return <AlarmAnalog model={model} family={family} />
    case 'heatmap':
      return <AlarmHeatmap model={model} family={family} />
    case 'broadcast':
      return <AlarmBroadcast model={model} family={family} />
    default:
      return <AlarmPanel model={model} family={family} />
  }
}
