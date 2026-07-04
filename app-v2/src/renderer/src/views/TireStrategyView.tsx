import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import type { TireCornerId, TireStrategySettings, TireStrategyState } from '../../../shared/tire-strategy'
import { TIRE_CHANNELS } from '../../../shared/tire-strategy'
import type { AppViewProps } from '../App'

const CORNERS: Array<[TireCornerId, string]> = [['lf', 'DE'], ['rf', 'DD'], ['lr', 'TE'], ['rr', 'TD']]

const card: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 'var(--radius-sm)',
  padding: 16,
  
}

const label: CSSProperties = { fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', opacity: 0.62 }
const value: CSSProperties = { fontSize: 30, fontWeight: 800, marginTop: 5, fontVariantNumeric: 'tabular-nums' }
const input: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 6,
  padding: '9px 10px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(0,0,0,0.22)',
  color: '#fff'
}
const button: CSSProperties = {
  ...input,
  cursor: 'pointer',
  fontWeight: 800,
  background: 'rgba(var(--accent-rgb),0.18)',
  borderColor: 'rgba(var(--accent-rgb),0.38)'
}

function numberOrUndefined(valueToParse: string): number | undefined {
  const parsed = Number(valueToParse)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function fmtNumber(valueToFormat?: number, digits = 1): string {
  return typeof valueToFormat === 'number' && Number.isFinite(valueToFormat) ? valueToFormat.toFixed(digits) : '—'
}

function fmtPercentPoints(valueToFormat?: number): string {
  return typeof valueToFormat === 'number' && Number.isFinite(valueToFormat) ? fmtNumber(valueToFormat * 100, 2) : '—'
}

function cornerName(corner?: TireCornerId): string {
  return CORNERS.find(([id]) => id === corner)?.[1] ?? '—'
}

function Metric({ title, main, unit, accent }: { title: string; main: string; unit?: string; accent?: string }): ReactElement {
  return (
    <div style={card}>
      <div style={label}>{title}</div>
      <div style={{ ...value, color: accent ?? '#fff' }}>{main} {unit && <small style={{ fontSize: 13, opacity: 0.66 }}>{unit}</small>}</div>
    </div>
  )
}

export default function TireStrategyView(_props: AppViewProps): ReactElement {
  const [tire, setTire] = useState<TireStrategyState | null>(null)
  const [thresholdPct, setThresholdPct] = useState('30')
  const [targetLaps, setTargetLaps] = useState('')
  const [raceMinutes, setRaceMinutes] = useState('')

  const settings = useMemo<TireStrategySettings>(() => ({
    wearThresholdPct: (numberOrUndefined(thresholdPct) ?? 30) / 100,
    targetLaps: numberOrUndefined(targetLaps),
    raceTimeMinutes: numberOrUndefined(raceMinutes)
  }), [raceMinutes, targetLaps, thresholdPct])

  const refresh = useCallback(async (): Promise<void> => {
    const state = await window.ipc.invoke<TireStrategyState>(TIRE_CHANNELS.get, settings)
    setTire(state)
  }, [settings])

  const reset = useCallback(async (): Promise<void> => {
    const state = await window.ipc.invoke<TireStrategyState>(TIRE_CHANNELS.reset)
    setTire(state)
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    const unsubscribe = window.ipc.subscribe<TireStrategyState>(TIRE_CHANNELS.update, setTire)
    return unsubscribe
  }, [])

  const connected = tire?.connected ?? false
  const thresholdLife = (tire?.settings.wearThresholdPct ?? settings.wearThresholdPct) * 100
  const canFinish = tire?.raceLapsRemaining !== undefined && tire?.lapsRemainingOnTyres !== undefined
    ? tire.lapsRemainingOnTyres >= tire.raceLapsRemaining
    : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 12, alignItems: 'end' }}>
        <div>
          <div style={label}>Limite de vida restante (%)</div>
          <input style={input} type="number" min="5" max="90" step="1" value={thresholdPct} onChange={(event) => setThresholdPct(event.target.value)} />
        </div>
        <div>
          <div style={label}>Voltas-alvo</div>
          <input style={input} type="number" min="1" placeholder="Auto" value={targetLaps} onChange={(event) => setTargetLaps(event.target.value)} />
        </div>
        <div>
          <div style={label}>Tempo de corrida (min)</div>
          <input style={input} type="number" min="1" placeholder="Auto" value={raceMinutes} onChange={(event) => setRaceMinutes(event.target.value)} />
        </div>
        <button style={button} type="button" onClick={() => void reset()}>Resetar pneus</button>
        <div style={{ fontSize: 13, opacity: 0.78 }}>
          {connected ? '● telemetria ao vivo' : '○ sem telemetria — use mock na aba Telemetria'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <Metric title="Pior pneu" main={cornerName(tire?.worstCorner)} accent={(tire?.lapsRemainingOnTyres ?? 99) <= 3 ? 'var(--accent-danger)' : 'var(--accent-primary)'} />
        <Metric title="Vida até limite" main={fmtNumber(tire?.lapsRemainingOnTyres, 1)} unit="voltas" accent={canFinish === false ? 'var(--accent-warning)' : 'var(--accent-primary)'} />
        <Metric title="Pit recomendado" main={tire?.recommendedPitLap ? `V${tire.recommendedPitLap}` : '—'} />
        <Metric title="Desgaste médio" main={fmtPercentPoints(tire?.avgWearPerLap)} unit="p.p./volta" />
      </div>

      <section style={card}>
        <div style={label}>Pneus por canto</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 12 }}>
          {CORNERS.map(([corner, cornerLabel]) => {
            const data = tire?.corners[corner]
            const life = data?.wearPct
            const accent = (life ?? 100) <= thresholdLife ? 'var(--accent-danger)' : 'var(--accent-primary)'
            return (
              <div key={corner} style={{ ...card,  }}>
                <div style={{ ...label, display: 'flex', justifyContent: 'space-between' }}><span>{cornerLabel}</span>{data?.estimated && <span>estimado</span>}</div>
                <div style={{ ...value, color: accent }}>{fmtNumber(life, 1)} <small style={{ fontSize: 13, opacity: 0.66 }}>% vida</small></div>
                <div style={{ display: 'grid', gap: 6, marginTop: 10, fontVariantNumeric: 'tabular-nums' }}>
                  <span>Desgaste: <strong>{fmtPercentPoints(data?.wearPerLap)} p.p./volta</strong></span>
                  <span>Até limite: <strong>{fmtNumber(data?.lapsToThreshold, 1)} voltas</strong></span>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section style={card}>
        <div style={label}>Estratégia</div>
        <h3 style={{ margin: '6px 0 12px' }}>{canFinish === true ? 'Pneus seguros até o fim' : canFinish === false ? 'Troca provável necessária' : 'Aguardando dados'}</h3>
        <div style={{ display: 'grid', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
          <div>Limite configurado: <strong>{fmtNumber(thresholdLife, 0)}% de vida restante</strong></div>
          <div>Voltas restantes estimadas: <strong>{fmtNumber(tire?.raceLapsRemaining, 1)}</strong></div>
          <div>Janela sugerida: <strong>{tire?.recommendedPitLap ? `até volta ${tire.recommendedPitLap}` : '—'}</strong></div>
          <div>Fonte: <strong>{tire?.estimated ? 'estimativa por carga' : 'desgaste real por telemetria'}</strong></div>
          {(tire?.notes ?? []).map((note) => <div key={note} style={{ opacity: 0.72 }}>{note}</div>)}
        </div>
      </section>
    </div>
  )
}
