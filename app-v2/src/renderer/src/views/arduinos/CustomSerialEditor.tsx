import { type FormEvent, type ReactElement, useEffect, useMemo, useState } from 'react'
import { COMPANION_PRESETS } from '../../../../shared/companion'
import type { ExpressionDef } from '../../../../shared/expr'
import type { SerialDeviceSummary } from '../../../../shared/arduino'
import type { OutputFormat, OutputRoute, OutputSource } from '../../../../shared/outputs'
import type { ResolvedLanguage } from '../../i18n'
import { tt } from '../../i18n'

const CUSTOM_ROUTE_PREFIX = 'arduino:custom:'

interface CustomSerialEditorProps {
  language?: ResolvedLanguage
  routes: OutputRoute[]
  devices: SerialDeviceSummary[]
  expressions: ExpressionDef[]
  busy: boolean
  onSave(route: OutputRoute): void
  onDelete(routeId: string): void
  onToggle(routeId: string, enabled: boolean): void
}

interface State {
  name: string
  deviceId: string
  template: string
  sourceKind: OutputSource['kind']
  telemetryField: string
  exprId: string
  literalValue: string
  decimals: string
}

function isCustomSerialRoute(route: OutputRoute): boolean {
  return route.id.startsWith(CUSTOM_ROUTE_PREFIX) && route.target.kind === 'serial'
}

function nextRouteId(routes: OutputRoute[]): string {
  let n = routes.filter(isCustomSerialRoute).length + 1
  while (routes.some((route) => route.id === `${CUSTOM_ROUTE_PREFIX}${n}`)) n += 1
  return `${CUSTOM_ROUTE_PREFIX}${n}`
}

function buildSource(state: State): OutputSource | null {
  if (state.sourceKind === 'telemetry') return state.telemetryField.trim() ? { kind: 'telemetry', field: state.telemetryField.trim() } : null
  if (state.sourceKind === 'expression') return state.exprId.trim() ? { kind: 'expression', exprId: state.exprId.trim() } : null
  const raw = state.literalValue.trim()
  if (!raw) return null
  const numeric = Number(raw)
  return Number.isFinite(numeric) && /^-?\d+(\.\d+)?$/.test(raw) ? { kind: 'literal', value: numeric } : { kind: 'literal', value: raw }
}

function buildFormat(state: State): OutputFormat | undefined {
  const decimals = Number(state.decimals)
  return Number.isFinite(decimals) && state.decimals.trim() !== '' ? { decimals: Math.max(0, Math.min(20, Math.trunc(decimals))) } : undefined
}

function sourceLabel(source: OutputSource): string {
  if (source.kind === 'telemetry') return `telemetry ? ${source.field}`
  if (source.kind === 'expression') return `expression ? ${source.exprId}`
  return `literal ? ${source.value}`
}

export function CustomSerialEditor({ language, routes, devices, expressions, busy, onSave, onDelete, onToggle }: CustomSerialEditorProps): ReactElement {
  const [state, setState] = useState<State>({
    name: '',
    deviceId: devices[0]?.id ?? '',
    template: COMPANION_PRESETS[0]?.template ?? 'T:${value}',
    sourceKind: 'telemetry',
    telemetryField: 'speedKmh',
    exprId: expressions[0]?.id ?? '',
    literalValue: '',
    decimals: '0'
  })
  const customRoutes = useMemo(() => routes.filter(isCustomSerialRoute), [routes])

  useEffect(() => {
    setState((current) => ({
      ...current,
      deviceId: devices.some((device) => device.id === current.deviceId) ? current.deviceId : devices[0]?.id ?? '',
      exprId: expressions.some((expr) => expr.id === current.exprId) ? current.exprId : expressions[0]?.id ?? ''
    }))
  }, [devices, expressions])

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const source = buildSource(state)
    if (!source || !state.deviceId || !state.template.trim()) return
    const route: OutputRoute = {
      id: nextRouteId(routes),
      name: state.name.trim() || `${tt(language, 'arduinos.tabs.customSerial.label')} ? ${devices.find((d) => d.id === state.deviceId)?.label ?? state.deviceId}`,
      enabled: true,
      source,
      target: { kind: 'serial', deviceId: state.deviceId, template: state.template.trim() },
      format: buildFormat(state),
      updatedAt: new Date().toISOString()
    }
    onSave(route)
    setState((current) => ({ ...current, name: '' }))
  }

  return (
    <>
      <article className="panel-card">
        <span className="panel-label">{tt(language, 'arduinos.customSerial.eyebrow')}</span>
        <h3>{tt(language, 'arduinos.customSerial.title')}</h3>
        <p className="helper-text">{tt(language, 'arduinos.customSerial.help')}</p>
        <form className="config-block" style={{ display: 'grid', gap: 12 }} onSubmit={submit}>
          <label><strong>{tt(language, 'arduinos.outputs.nameOptional')}</strong><input className="command-input" value={state.name} onChange={(event) => setState({ ...state, name: event.target.value })} /></label>
          <label><strong>{tt(language, 'arduinos.outputs.targetDevice')}</strong><select className="command-input" value={state.deviceId} onChange={(event) => setState({ ...state, deviceId: event.target.value })}>{devices.length === 0 && <option value="">? no connected devices ?</option>}{devices.map((device) => <option key={device.id} value={device.id}>{device.label} ({device.id})</option>)}</select></label>
          <label><strong>{tt(language, 'arduinos.outputs.template')}</strong><input className="command-input" value={state.template} placeholder="T:${value}" onChange={(event) => setState({ ...state, template: event.target.value })} /></label>
          <div className="segmented">{(['telemetry', 'expression', 'literal'] as const).map((kind) => <button key={kind} type="button" className={state.sourceKind === kind ? 'segment active' : 'segment'} onClick={() => setState({ ...state, sourceKind: kind })}>{kind}</button>)}</div>
          {state.sourceKind === 'telemetry' && <input className="command-input" value={state.telemetryField} placeholder="speedKmh" onChange={(event) => setState({ ...state, telemetryField: event.target.value })} />}
          {state.sourceKind === 'expression' && <select className="command-input" value={state.exprId} onChange={(event) => setState({ ...state, exprId: event.target.value })}>{expressions.length === 0 && <option value="">{tt(language, 'arduinos.outputs.noExpression')}</option>}{expressions.map((expr) => <option key={expr.id} value={expr.id}>{expr.name} ({expr.id})</option>)}</select>}
          {state.sourceKind === 'literal' && <input className="command-input" value={state.literalValue} onChange={(event) => setState({ ...state, literalValue: event.target.value })} />}
          <label><strong>{tt(language, 'arduinos.outputs.decimals')}</strong><input className="command-input" type="number" value={state.decimals} onChange={(event) => setState({ ...state, decimals: event.target.value })} /></label>
          <button className="primary-action" type="submit" disabled={busy || !state.deviceId || !state.template.trim() || !buildSource(state)}>{tt(language, 'arduinos.outputs.save')}</button>
        </form>
      </article>
      <article className="panel-card">
        <span className="panel-label">{tt(language, 'arduinos.outputs.activeLabel')}</span>
        <h3>{tt(language, 'arduinos.customSerial.saved')}</h3>
        {customRoutes.length === 0 && <p className="empty-state">{tt(language, 'arduinos.outputs.empty')}</p>}
        <ul className="plain-list">
          {customRoutes.map((route) => {
            const target = route.target as Extract<typeof route.target, { kind: 'serial' }>
            return <li className="port-item" key={route.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 8 }}><span><strong>{route.name}</strong><small>{sourceLabel(route.source)} ? <code>{target.template}</code></small></span><div className="action-row compact-row"><button type="button" className={route.enabled ? 'chip-toggle active' : 'chip-toggle'} disabled={busy} onClick={() => onToggle(route.id, !route.enabled)}>{route.enabled ? tt(language, 'arduinos.common.disable') : tt(language, 'arduinos.common.enable')}</button><button type="button" className="ghost-action compact danger" disabled={busy} onClick={() => onDelete(route.id)}>{tt(language, 'arduinos.common.delete')}</button></div></li>
          })}
        </ul>
      </article>
    </>
  )
}
