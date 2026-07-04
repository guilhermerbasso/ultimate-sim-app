import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import {
  activeCornerFlags,
  canSendPitCommands,
  chatMacroNumbers,
  CORNERS,
  CORNER_LABELS,
  FUEL_PRESETS,
  isServiceFlagged,
  PRESSURE_MAX_KPA,
  PRESSURE_MIN_KPA,
  stepFuel,
  stepPressure,
  type Corner,
  type IRacingControlStatus
} from './state'
import { computePitLayout, pitLayoutRowCount, type PitPlacement, type PitSectionId } from './layout'
import './pitpanel.css'

type Json = Record<string, unknown>

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return window.ipc.invoke(channel, ...args).catch(() => undefined)
}

// All command traffic reuses the existing `iracing:command` IPC (Option 1).
function command(type: string, payload?: Json): void {
  void invoke('iracing:command', { type, payload })
}

interface TouchButtonProps {
  label: string
  onPress: () => void
  disabled?: boolean
  active?: boolean
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  wide?: boolean
}

function TouchButton({ label, onPress, disabled, active, variant = 'default', wide }: TouchButtonProps) {
  const className = [
    'pp-btn',
    `pp-btn-${variant}`,
    active ? 'is-active' : '',
    wide ? 'is-wide' : ''
  ].filter(Boolean).join(' ')
  return (
    <button type="button" className={className} disabled={disabled} onClick={onPress}>
      {label}
    </button>
  )
}

function Section({ title, children, className, style }: { title: string; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <section className={className ? `pp-section ${className}` : 'pp-section'} style={style}>
      <h2 className="pp-section-title">{title}</h2>
      <div className="pp-section-body">{children}</div>
    </section>
  )
}

function placementStyle(placement: PitPlacement | undefined): CSSProperties | undefined {
  if (!placement) return undefined
  return {
    gridColumn: `${placement.column} / span ${placement.columnSpan}`,
    gridRow: `${placement.row} / span ${placement.rowSpan}`
  }
}

const DEFAULT_PRESSURE = 165
const COMPOUNDS = ['Soft', 'Medium', 'Hard', 'Wet']

export function PitPanelRoot() {
  const [status, setStatus] = useState<IRacingControlStatus | null>(null)
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null)
  const [fuel, setFuel] = useState<number>(20)
  const [pressures, setPressures] = useState<Record<Corner, number>>({
    lf: DEFAULT_PRESSURE,
    rf: DEFAULT_PRESSURE,
    lr: DEFAULT_PRESSURE,
    rr: DEFAULT_PRESSURE
  })
  const [compound, setCompound] = useState<number>(0)
  const [camGroup, setCamGroup] = useState<number>(1)

  useEffect(() => {
    let alive = true
    const refreshStatus = (): void => {
      void invoke('iracing:status').then((value) => {
        if (alive && value) setStatus(value as IRacingControlStatus)
      })
    }
    refreshStatus()
    const statusTimer = setInterval(refreshStatus, 2000)

    const off = window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', (snap) => setSnapshot(snap))
    void invoke('telemetry:getLatest').then((snap) => {
      if (alive && snap) setSnapshot(snap as TelemetrySnapshot)
    })
    return () => {
      alive = false
      clearInterval(statusTimer)
      off()
    }
  }, [])

  const enabled = useMemo(() => canSendPitCommands(status, snapshot), [status, snapshot])
  const corners = useMemo(() => activeCornerFlags(snapshot), [snapshot])
  const onPitRoad = snapshot?.onPitRoad === true

  // Deterministic, non-overlapping grid placement (see ./layout.ts). Each card is
  // positioned by its rectangle and scrolls internally, so the fuel/chat/replay
  // controls can never collide with a neighbour again.
  const placements = useMemo(() => computePitLayout(3), [])
  const placementById = useMemo(() => {
    const map = new Map<PitSectionId, PitPlacement>()
    for (const placement of placements) map.set(placement.id, placement)
    return map
  }, [placements])
  const gridStyle = useMemo<CSSProperties>(
    () => ({ gridTemplateRows: `repeat(${pitLayoutRowCount(placements)}, minmax(0, 1fr))` }),
    [placements]
  )

  const setPressure = useCallback((corner: Corner, delta: number) => {
    setPressures((prev) => ({ ...prev, [corner]: stepPressure(prev[corner], delta) }))
  }, [])

  const sendTyres = useCallback(
    (selected: Corner[]) => {
      command('pit:tyres', {
        tyres: selected,
        pressures: selected.reduce<Record<string, number>>((acc, corner) => {
          acc[corner] = pressures[corner]
          return acc
        }, {})
      })
    },
    [pressures]
  )

  return (
    <div className="pp-shell">
      <header className="pp-header">
        <div className="pp-title">Pit &amp; Command</div>
        <div className={enabled ? 'pp-conn is-on' : 'pp-conn is-off'}>
          <span className="pp-dot" />
          {enabled ? (onPitRoad ? 'Nos boxes' : 'Na pista') : status?.connected ? 'Aguardando carro' : 'Desconectado'}
        </div>
        <button type="button" className="pp-close" onClick={() => void invoke('app:pitpanel:close')} aria-label="Fechar">
          ✕
        </button>
      </header>

      {!enabled && (
        <div className="pp-gate-banner">
          Comandos de pit ficam ativos apenas com o iRacing conectado e você no carro/pista.
        </div>
      )}

      <div className="pp-grid" style={gridStyle}>
        <Section title="Combustível" className="pp-fuel" style={placementStyle(placementById.get('fuel'))}>
          <div className="pp-fuel-readout">
            <span className="pp-fuel-value">{fuel}</span>
            <span className="pp-fuel-unit">L</span>
          </div>
          <div className="pp-row">
            <TouchButton label="−5" onPress={() => setFuel((f) => stepFuel(f, -5))} disabled={!enabled} />
            <TouchButton label="−1" onPress={() => setFuel((f) => stepFuel(f, -1))} disabled={!enabled} />
            <TouchButton label="+1" onPress={() => setFuel((f) => stepFuel(f, 1))} disabled={!enabled} />
            <TouchButton label="+5" onPress={() => setFuel((f) => stepFuel(f, 5))} disabled={!enabled} />
          </div>
          <div className="pp-row pp-wrap">
            {FUEL_PRESETS.map((preset) => (
              <TouchButton key={preset} label={`${preset}L`} variant="ghost" onPress={() => setFuel(preset)} disabled={!enabled} />
            ))}
          </div>
          <div className="pp-row pp-fuel-cta">
            <TouchButton
              label={fuel === 0 ? 'Manter combustível' : `Abastecer ${fuel}L`}
              variant="primary"
              wide
              active={isServiceFlagged(snapshot, 'fuel')}
              onPress={() => command('pit:fuel', { liters: fuel })}
              disabled={!enabled}
            />
          </div>
        </Section>

        <Section title="Pneus" className="pp-tyres" style={placementStyle(placementById.get('tyres'))}>
          <div className="pp-tyre-grid">
            {CORNERS.map((corner) => (
              <div key={corner} className={corners[corner] ? 'pp-tyre is-queued' : 'pp-tyre'}>
                <div className="pp-tyre-label">{CORNER_LABELS[corner]}</div>
                <div className="pp-tyre-pressure">{pressures[corner]}<small>kPa</small></div>
                <div className="pp-tyre-steppers">
                  <TouchButton label="−" onPress={() => setPressure(corner, -1)} disabled={!enabled} />
                  <TouchButton label="+" onPress={() => setPressure(corner, 1)} disabled={!enabled} />
                </div>
                <TouchButton
                  label="Trocar"
                  variant="primary"
                  active={corners[corner]}
                  onPress={() => sendTyres([corner])}
                  disabled={!enabled}
                />
              </div>
            ))}
          </div>
          <div className="pp-hint">Pressão {PRESSURE_MIN_KPA}–{PRESSURE_MAX_KPA} kPa</div>
          <div className="pp-row pp-wrap">
            <TouchButton label="Trocar 4" variant="primary" onPress={() => sendTyres([...CORNERS])} disabled={!enabled} />
            <TouchButton label="Limpar pneus" variant="danger" onPress={() => command('pit:clearTires')} disabled={!enabled} />
          </div>
          <div className="pp-row pp-wrap pp-compound">
            <span className="pp-compound-label">Composto</span>
            {COMPOUNDS.map((name, index) => (
              <TouchButton
                key={name}
                label={name}
                variant="ghost"
                active={compound === index}
                onPress={() => {
                  setCompound(index)
                  command('pit:tireCompound', { compound: index })
                }}
                disabled={!enabled}
              />
            ))}
          </div>
        </Section>

        <Section title="Serviço" className="pp-service" style={placementStyle(placementById.get('service'))}>
          <div className="pp-row pp-wrap">
            <TouchButton
              label="Fast Repair"
              variant="primary"
              active={isServiceFlagged(snapshot, 'fastrepair')}
              onPress={() => command('pit:fastRepair')}
              disabled={!enabled}
            />
            <TouchButton
              label="Parabrisa"
              active={isServiceFlagged(snapshot, 'windshield')}
              onPress={() => command('pit:windshield')}
              disabled={!enabled}
            />
          </div>
          <div className="pp-row pp-wrap">
            <TouchButton label="Limpar tudo" variant="danger" onPress={() => command('pit:clear')} disabled={!enabled} />
            <TouchButton label="Cancelar comb." onPress={() => command('pit:clearFuel')} disabled={!enabled} />
            <TouchButton label="Cancelar FR" onPress={() => command('pit:clearFR')} disabled={!enabled} />
            <TouchButton label="Cancelar WS" onPress={() => command('pit:clearWS')} disabled={!enabled} />
          </div>
        </Section>

        <Section title="Chat macros" className="pp-chat" style={placementStyle(placementById.get('chat'))}>
          <div className="pp-macro-grid">
            {chatMacroNumbers().map((num) => (
              <TouchButton
                key={num}
                label={String(num)}
                variant="ghost"
                onPress={() => command('chat:macro', { macro: num })}
                disabled={!status?.connected}
              />
            ))}
          </div>
        </Section>

        <Section title="Câmera" className="pp-camera" style={placementStyle(placementById.get('camera'))}>
          <div className="pp-row pp-wrap">
            <TouchButton label="Líder" onPress={() => command('camera:switch', { focus: 'leader', group: camGroup })} disabled={!status?.connected} />
            <TouchButton label="Incidente" onPress={() => command('camera:switch', { focus: 'incident', group: camGroup })} disabled={!status?.connected} />
            <TouchButton label="Saindo box" onPress={() => command('camera:switch', { focus: 'exiting', group: camGroup })} disabled={!status?.connected} />
          </div>
          <div className="pp-row pp-wrap pp-camgroup">
            <span className="pp-compound-label">Grupo</span>
            <TouchButton label="−" onPress={() => setCamGroup((g) => Math.max(1, g - 1))} disabled={!status?.connected} />
            <span className="pp-camgroup-value">{camGroup}</span>
            <TouchButton label="+" onPress={() => setCamGroup((g) => g + 1)} disabled={!status?.connected} />
            <TouchButton label="Aplicar" variant="ghost" onPress={() => command('camera:switch', { focus: 'driver', group: camGroup })} disabled={!status?.connected} />
          </div>
        </Section>

        <Section title="Replay" className="pp-replay" style={placementStyle(placementById.get('replay'))}>
          <div className="pp-row pp-wrap">
            <TouchButton label="⏮ Inc" onPress={() => command('replay:prevIncident')} disabled={!status?.connected} />
            <TouchButton label="⏪ Volta" onPress={() => command('replay:prevLap')} disabled={!status?.connected} />
            <TouchButton label="◀◀" onPress={() => command('replay:rewind', { speed: 4 })} disabled={!status?.connected} />
          </div>
          <div className="pp-row pp-wrap">
            <TouchButton label="⏸" onPress={() => command('replay:pause')} disabled={!status?.connected} />
            <TouchButton label="▶" variant="primary" onPress={() => command('replay:play')} disabled={!status?.connected} />
            <TouchButton label="▶▶" onPress={() => command('replay:ff', { speed: 4 })} disabled={!status?.connected} />
          </div>
          <div className="pp-row pp-wrap">
            <TouchButton label="Volta ⏩" onPress={() => command('replay:nextLap')} disabled={!status?.connected} />
            <TouchButton label="Inc ⏭" onPress={() => command('replay:nextIncident')} disabled={!status?.connected} />
          </div>
        </Section>
      </div>
    </div>
  )
}
