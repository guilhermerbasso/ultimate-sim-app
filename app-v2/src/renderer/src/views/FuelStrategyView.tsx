import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import type { FuelStrategySettings, FuelStrategyState } from '../../../shared/fuel'
import type { LapTimingState } from '../../../shared/laptiming'
import { TEAM_FUEL_CHANNELS, type TeamFuelMode, type TeamFuelPeer } from '../../../shared/team-fuel'
import type { AppViewProps } from '../App'

const card: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 'var(--radius-sm)',
  padding: 16,
  
}

const label: CSSProperties = { fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', opacity: 0.62 }
const value: CSSProperties = { fontSize: 30, fontWeight: 800, marginTop: 5, fontVariantNumeric: 'tabular-nums' }
const guidedEmptyState: CSSProperties = {
  ...card,
  borderStyle: 'dashed',
  color: 'var(--text-muted)',
  background: 'var(--surface-sunken)'
}
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

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function fmtNumber(valueToFormat?: number, digits = 1): string {
  return typeof valueToFormat === 'number' && Number.isFinite(valueToFormat) ? valueToFormat.toFixed(digits) : '—'
}

function fmtTime(seconds?: number): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—:--.---'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`
}

function fmtDelta(seconds?: number): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—'
  return `${seconds >= 0 ? '+' : ''}${seconds.toFixed(3)}`
}

function deltaColor(seconds?: number): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'rgba(255,255,255,0.72)'
  return seconds <= 0 ? 'var(--accent-success)' : 'var(--accent-danger)'
}

function fmtAge(ts?: number): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000))
  return seconds <= 1 ? 'agora' : `${seconds}s`
}

function statusLabel(status?: FuelStrategyState['pitWindow']['status']): string {
  switch (status) {
    case 'safe': return 'Seguro até o fim'
    case 'save': return 'Economizar combustível'
    case 'pit-required': return 'Pit necessário'
    case 'critical': return 'Crítico'
    default: return 'Aguardando dados'
  }
}

function Metric({ title, main, unit, accent }: { title: string; main: string; unit?: string; accent?: string }): ReactElement {
  return (
    <div style={card}>
      <div style={label}>{title}</div>
      <div style={{ ...value, color: accent ?? '#fff' }}>{main} {unit && <small style={{ fontSize: 13, opacity: 0.66 }}>{unit}</small>}</div>
    </div>
  )
}

function GuidedEmptyState(): ReactElement {
  return (
    <section style={guidedEmptyState}>
      <div style={label}>Aguardando telemetria</div>
      <p style={{ margin: '6px 0 0', lineHeight: 1.45 }}>
        Conecte ao iRacing ou escolha Demo (mock) para ver dados.
      </p>
    </section>
  )
}

export default function FuelStrategyView(_props: AppViewProps): ReactElement {
  const [fuel, setFuel] = useState<FuelStrategyState | null>(null)
  const [lap, setLap] = useState<LapTimingState | null>(null)
  const [targetLaps, setTargetLaps] = useState('')
  const [raceMinutes, setRaceMinutes] = useState('')
  const [marginLiters, setMarginLiters] = useState('3')
  const [teamRoomKey, setTeamRoomKey] = useState('')
  const [teamDriverName, setTeamDriverName] = useState('')
  const [teamPeers, setTeamPeers] = useState<TeamFuelPeer[]>([])
  const [teamBusy, setTeamBusy] = useState(false)
  const [teamStatus, setTeamStatus] = useState('Parado')

  const settings = useMemo<FuelStrategySettings>(() => ({
    targetLaps: numberOrUndefined(targetLaps),
    raceTimeMinutes: numberOrUndefined(raceMinutes),
    fuelMarginLiters: numberOrUndefined(marginLiters) ?? 0
  }), [marginLiters, raceMinutes, targetLaps])

  const refresh = useCallback(async (): Promise<void> => {
    const [fuelState, lapState] = await Promise.all([
      window.ipc.invoke<FuelStrategyState>('fuel:get', settings),
      window.ipc.invoke<LapTimingState>('lap:get')
    ])
    setFuel(fuelState)
    setLap(lapState)
  }, [settings])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    const unsubscribeLap = window.ipc.subscribe<LapTimingState>('lap:update', setLap)
    return unsubscribeLap
  }, [])

  useEffect(() => {
    const unsubscribeTeam = window.ipc.subscribe<TeamFuelPeer[]>(TEAM_FUEL_CHANNELS.updated, setTeamPeers)
    void window.ipc.invoke<TeamFuelPeer[]>(TEAM_FUEL_CHANNELS.state).then(setTeamPeers).catch(() => undefined)
    return unsubscribeTeam
  }, [])

  const startTeamFuel = useCallback(async (mode: TeamFuelMode): Promise<void> => {
    const roomKey = teamRoomKey.trim()
    if (!roomKey) {
      setTeamStatus('Informe uma room key')
      return
    }
    setTeamBusy(true)
    setTeamStatus(mode === 'host' ? 'Hospedando sala…' : 'Procurando host na LAN…')
    try {
      await window.ipc.invoke(TEAM_FUEL_CHANNELS.start, { mode, roomKey, driverName: teamDriverName.trim() || undefined })
      const peers = await window.ipc.invoke<TeamFuelPeer[]>(TEAM_FUEL_CHANNELS.state)
      setTeamPeers(peers)
      setTeamStatus(mode === 'host' ? 'Host ativo na LAN' : 'Join ativo na LAN')
    } catch (error) {
      setTeamStatus(error instanceof Error ? error.message : 'Falha ao iniciar Team Fuel')
    } finally {
      setTeamBusy(false)
    }
  }, [teamDriverName, teamRoomKey])

  const stopTeamFuel = useCallback(async (): Promise<void> => {
    setTeamBusy(true)
    try {
      await window.ipc.invoke(TEAM_FUEL_CHANNELS.stop)
      setTeamPeers([])
      setTeamStatus('Parado')
    } catch (error) {
      setTeamStatus(error instanceof Error ? error.message : 'Falha ao parar Team Fuel')
    } finally {
      setTeamBusy(false)
    }
  }, [])

  const hasFuelData = fuel?.connected === true
  const hasLapData = lap?.connected === true
  const connected = hasFuelData || hasLapData
  const canFinish = fuel?.pitWindow.canFinish ?? false

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 12, alignItems: 'end' }}>
        <div>
          <div style={label}>Voltas-alvo</div>
          <input style={input} type="number" min="1" placeholder="Auto" value={targetLaps} onChange={(event) => setTargetLaps(event.target.value)} />
        </div>
        <div>
          <div style={label}>Tempo de corrida (min)</div>
          <input style={input} type="number" min="1" placeholder="Auto" value={raceMinutes} onChange={(event) => setRaceMinutes(event.target.value)} />
        </div>
        <div>
          <div style={label}>Margem de combustível (L)</div>
          <input style={input} type="number" min="0" step="0.5" value={marginLiters} onChange={(event) => setMarginLiters(event.target.value)} />
        </div>
        <div style={{ fontSize: 13, opacity: 0.78 }}>
          {connected ? '● telemetria ao vivo' : '○ sem telemetria — use mock na aba Telemetria'}
        </div>
      </div>

      {!connected ? (
        <GuidedEmptyState />
      ) : (
        <>
          {hasFuelData ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                <Metric title="Combustível" main={fmtNumber(fuel?.fuelLiters, 1)} unit="L" />
                <Metric title="Uso médio" main={fmtNumber(fuel?.usedPerLap, 2)} unit="L/volta" />
                <Metric title="Voltas no tanque" main={fmtNumber(fuel?.lapsLeftWithFuel, 1)} unit="voltas" accent={canFinish ? 'var(--accent-success)' : 'var(--accent-warning)'} />
                <Metric title="Fuel-save target" main={fmtNumber(fuel?.saveTarget, 2)} unit="L/volta" accent={(fuel?.saveNeededPerLap ?? 0) > 0 ? 'var(--accent-warning)' : 'var(--accent-success)'} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                <section style={card}>
                  <div style={label}>Estratégia</div>
                  <h3 style={{ margin: '6px 0 12px' }}>{statusLabel(fuel?.pitWindow.status)}</h3>
                  <div style={{ display: 'grid', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
                    <div>Voltas restantes estimadas: <strong>{fmtNumber(fuel?.raceLapsRemaining, 1)}</strong></div>
                    <div>Combustível para terminar: <strong>{fmtNumber(fuel?.fuelToFinish, 1)} L</strong></div>
                    <div>Saldo até o fim: <strong style={{ color: (fuel?.fuelDeltaToFinish ?? 0) >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)' }}>{fmtNumber(fuel?.fuelDeltaToFinish, 1)} L</strong></div>
                    <div>Economia necessária: <strong>{fmtNumber(fuel?.saveNeededPerLap, 2)} L/volta</strong></div>
                    <div>Janela de pit: <strong>{fuel?.pitWindow.latestLap ? `até volta ${fuel.pitWindow.latestLap}` : '—'}</strong></div>
                  </div>
                </section>

                <section style={card}>
                  <div style={label}>Stint planner</div>
                  <h3 style={{ margin: '6px 0 12px' }}>Enduro</h3>
                  <div style={{ display: 'grid', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
                    <div>Ritmo estimado: <strong>{fmtTime(fuel?.stint.estimatedLapTimeSec)}</strong></div>
                    <div>Voltas por stint: <strong>{fuel?.stint.stintLaps ?? '—'}</strong></div>
                    <div>Stints até o fim: <strong>{fuel?.stint.stintsToFinish ?? '—'}</strong></div>
                    <div>Combustível por stint: <strong>{fmtNumber(fuel?.stint.fuelPerStintLiters, 1)} L</strong></div>
                    <div>Histórico: <strong>{fuel?.samples.length ?? 0}</strong> voltas na média móvel</div>
                  </div>
                </section>
              </div>
            </>
          ) : (
            <GuidedEmptyState />
          )}

          {hasLapData ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                <Metric title="Predicted lap" main={fmtTime(lap?.predicted)} />
                <Metric title="Delta melhor" main={fmtDelta(lap?.deltaBest)} accent={deltaColor(lap?.deltaBest)} />
                <Metric title="Delta optimal" main={fmtDelta(lap?.deltaOptimal)} accent={deltaColor(lap?.deltaOptimal)} />
                <Metric title="Delta session-best" main={fmtDelta(lap?.deltaSessionBest)} accent={deltaColor(lap?.deltaSessionBest)} />
              </div>

              <section style={card}>
                <div style={label}>Lap timing / setores</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 12 }}>
                  <div>Atual <strong>{fmtTime(lap?.currentLapTime)}</strong></div>
                  <div>Última <strong>{fmtTime(lap?.lastLap)}</strong></div>
                  <div>Melhor <strong>{fmtTime(lap?.bestLap)}</strong></div>
                  <div>Optimal <strong>{fmtTime(lap?.optimalLap)}</strong></div>
                </div>
                <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                  {(lap?.sectors ?? []).map((sector) => (
                    <div key={sector.index} style={{ display: 'grid', gridTemplateColumns: '70px repeat(4, 1fr)', gap: 8, alignItems: 'center', fontVariantNumeric: 'tabular-nums' }}>
                      <strong>Setor {sector.index}</strong>
                      <span>Atual {fmtTime(sector.current)}</span>
                      <span>Último {fmtTime(sector.last)}</span>
                      <span>Melhor {fmtTime(sector.best)}</span>
                      <span style={{ color: deltaColor(sector.deltaToBest) }}>{fmtDelta(sector.deltaToBest)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : null}
        </>
      )}

      <section style={card}>
        <div style={label}>Team Fuel · LAN</div>
        <h3 style={{ margin: '6px 0 12px' }}>Endurance room</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div>
            <div style={label}>Room key</div>
            <input style={input} type="password" value={teamRoomKey} placeholder="token compartilhado" onChange={(event) => setTeamRoomKey(event.target.value)} />
          </div>
          <div>
            <div style={label}>Driver name</div>
            <input style={input} value={teamDriverName} placeholder="Auto pela telemetria" onChange={(event) => setTeamDriverName(event.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button disabled={teamBusy} onClick={() => void startTeamFuel('host')}>Host</button>
            <button disabled={teamBusy} onClick={() => void startTeamFuel('join')}>Join</button>
            <button disabled={teamBusy} onClick={() => void stopTeamFuel()}>Stop</button>
          </div>
          <div style={{ fontSize: 13, opacity: 0.78 }}>{teamStatus}</div>
        </div>

        <div style={{ overflowX: 'auto', marginTop: 14 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Driver</th>
                <th style={{ textAlign: 'right', padding: '8px 6px' }}>Fuel</th>
                <th style={{ textAlign: 'right', padding: '8px 6px' }}>L/lap</th>
                <th style={{ textAlign: 'right', padding: '8px 6px' }}>Laps left</th>
                <th style={{ textAlign: 'right', padding: '8px 6px' }}>Stint</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Pit</th>
                <th style={{ textAlign: 'right', padding: '8px 6px' }}>Age</th>
              </tr>
            </thead>
            <tbody>
              {teamPeers.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: '12px 6px', color: 'rgba(255,255,255,0.58)' }}>Sem peers — faça host ou join com a mesma room key.</td></tr>
              ) : teamPeers.map((peer) => (
                <tr key={peer.peerId} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <td style={{ padding: '9px 6px' }}><strong>{peer.driverName}</strong>{peer.local ? <span style={{ opacity: 0.58 }}> · você</span> : null}</td>
                  <td style={{ textAlign: 'right', padding: '9px 6px' }}>{fmtNumber(peer.fuelLiters, 1)} L</td>
                  <td style={{ textAlign: 'right', padding: '9px 6px' }}>{fmtNumber(peer.fuelPerLap, 2)}</td>
                  <td style={{ textAlign: 'right', padding: '9px 6px' }}>{fmtNumber(peer.lapsRemaining, 1)}</td>
                  <td style={{ textAlign: 'right', padding: '9px 6px' }}>{peer.stintTargetLaps ?? '—'}</td>
                  <td style={{ padding: '9px 6px' }}>{peer.pitWindow?.latestLap ? `até volta ${peer.pitWindow.latestLap}` : peer.pitWindow?.status ?? '—'}</td>
                  <td style={{ textAlign: 'right', padding: '9px 6px', opacity: 0.7 }}>{fmtAge(peer.ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
