import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import type { FuelStrategySettings, FuelStrategyState } from '../../../shared/fuel'
import type { LapTimingState } from '../../../shared/laptiming'
import { TEAM_FUEL_CHANNELS, type TeamFuelMode, type TeamFuelPeer } from '../../../shared/team-fuel'
import type { AppViewProps } from '../App'
import { tt, type ResolvedLanguage } from '../i18n'

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

function fmtAge(ts: number | undefined, language: ResolvedLanguage | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000))
  return seconds <= 1 ? tt(language, 'common.now') : `${seconds}s`
}

function statusLabel(status: FuelStrategyState['pitWindow']['status'] | undefined, language: ResolvedLanguage | undefined): string {
  switch (status) {
    case 'safe': return tt(language, 'fuel.status.safe')
    case 'save': return tt(language, 'fuel.status.save')
    case 'pit-required': return tt(language, 'fuel.status.pitRequired')
    case 'critical': return tt(language, 'fuel.status.critical')
    default: return tt(language, 'fuel.status.waiting')
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

function GuidedEmptyState({ language }: { language?: ResolvedLanguage }): ReactElement {
  return (
    <section style={guidedEmptyState}>
      <div style={label}>{tt(language, 'fuel.empty.title')}</div>
      <p style={{ margin: '6px 0 0', lineHeight: 1.45 }}>
        {tt(language, 'fuel.empty.body')}
      </p>
    </section>
  )
}

export default function FuelStrategyView({ language }: AppViewProps): ReactElement {
  const [fuel, setFuel] = useState<FuelStrategyState | null>(null)
  const [lap, setLap] = useState<LapTimingState | null>(null)
  const [targetLaps, setTargetLaps] = useState('')
  const [raceMinutes, setRaceMinutes] = useState('')
  const [marginLiters, setMarginLiters] = useState('3')
  const [teamRoomKey, setTeamRoomKey] = useState('')
  const [teamDriverName, setTeamDriverName] = useState('')
  const [teamPeers, setTeamPeers] = useState<TeamFuelPeer[]>([])
  const [teamBusy, setTeamBusy] = useState(false)
  const [teamStatus, setTeamStatus] = useState(() => tt(language, 'fuel.team.stopped'))

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
      setTeamStatus(tt(language, 'fuel.team.roomKeyRequired'))
      return
    }
    setTeamBusy(true)
    setTeamStatus(mode === 'host' ? tt(language, 'fuel.team.hosting') : tt(language, 'fuel.team.searching'))
    try {
      await window.ipc.invoke(TEAM_FUEL_CHANNELS.start, { mode, roomKey, driverName: teamDriverName.trim() || undefined })
      const peers = await window.ipc.invoke<TeamFuelPeer[]>(TEAM_FUEL_CHANNELS.state)
      setTeamPeers(peers)
      setTeamStatus(mode === 'host' ? tt(language, 'fuel.team.hostActive') : tt(language, 'fuel.team.joinActive'))
    } catch (error) {
      setTeamStatus(error instanceof Error ? error.message : tt(language, 'fuel.team.startFailed'))
    } finally {
      setTeamBusy(false)
    }
  }, [teamDriverName, teamRoomKey])

  const stopTeamFuel = useCallback(async (): Promise<void> => {
    setTeamBusy(true)
    try {
      await window.ipc.invoke(TEAM_FUEL_CHANNELS.stop)
      setTeamPeers([])
      setTeamStatus(tt(language, 'fuel.team.stopped'))
    } catch (error) {
      setTeamStatus(error instanceof Error ? error.message : tt(language, 'fuel.team.stopFailed'))
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
          <div style={label}>{tt(language, 'fuel.targetLaps')}</div>
          <input style={input} type="number" min="1" placeholder="Auto" value={targetLaps} onChange={(event) => setTargetLaps(event.target.value)} />
        </div>
        <div>
          <div style={label}>{tt(language, 'fuel.raceTime')}</div>
          <input style={input} type="number" min="1" placeholder="Auto" value={raceMinutes} onChange={(event) => setRaceMinutes(event.target.value)} />
        </div>
        <div>
          <div style={label}>{tt(language, 'fuel.margin')}</div>
          <input style={input} type="number" min="0" step="0.5" value={marginLiters} onChange={(event) => setMarginLiters(event.target.value)} />
        </div>
        <div style={{ fontSize: 13, opacity: 0.78 }}>
          {connected ? tt(language, 'fuel.live') : tt(language, 'fuel.noTelemetry')}
        </div>
      </div>

      {!connected ? (
        <GuidedEmptyState language={language} />
      ) : (
        <>
          {hasFuelData ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                <Metric title={tt(language, 'fuel.fuel')} main={fmtNumber(fuel?.fuelLiters, 1)} unit="L" />
                <Metric title={tt(language, 'fuel.avgUse')} main={fmtNumber(fuel?.usedPerLap, 2)} unit={tt(language, 'fuel.literLapUnit')} />
                <Metric title={tt(language, 'fuel.lapsInTank')} main={fmtNumber(fuel?.lapsLeftWithFuel, 1)} unit={tt(language, 'fuel.lapUnit')} accent={canFinish ? 'var(--accent-success)' : 'var(--accent-warning)'} />
                <Metric title="Fuel-save target" main={fmtNumber(fuel?.saveTarget, 2)} unit={tt(language, 'fuel.literLapUnit')} accent={(fuel?.saveNeededPerLap ?? 0) > 0 ? 'var(--accent-warning)' : 'var(--accent-success)'} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                <section style={card}>
                  <div style={label}>{tt(language, 'fuel.strategy')}</div>
                  <h3 style={{ margin: '6px 0 12px' }}>{statusLabel(fuel?.pitWindow.status, language)}</h3>
                  <div style={{ display: 'grid', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
                    <div>{tt(language, 'fuel.estimatedLapsRemaining')} <strong>{fmtNumber(fuel?.raceLapsRemaining, 1)}</strong></div>
                    <div>{tt(language, 'fuel.fuelToFinish')} <strong>{fmtNumber(fuel?.fuelToFinish, 1)} L</strong></div>
                    <div>{tt(language, 'fuel.balanceToFinish')} <strong style={{ color: (fuel?.fuelDeltaToFinish ?? 0) >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)' }}>{fmtNumber(fuel?.fuelDeltaToFinish, 1)} L</strong></div>
                    <div>{tt(language, 'fuel.saveNeeded')} <strong>{fmtNumber(fuel?.saveNeededPerLap, 2)} {tt(language, 'fuel.literLapUnit')}</strong></div>
                    <div>{tt(language, 'fuel.pitWindow')} <strong>{fuel?.pitWindow.latestLap ? tt(language, 'fuel.untilLap', { lap: fuel.pitWindow.latestLap }) : '—'}</strong></div>
                  </div>
                </section>

                <section style={card}>
                  <div style={label}>Stint planner</div>
                  <h3 style={{ margin: '6px 0 12px' }}>Enduro</h3>
                  <div style={{ display: 'grid', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
                    <div>{tt(language, 'fuel.estimatedPace')} <strong>{fmtTime(fuel?.stint.estimatedLapTimeSec)}</strong></div>
                    <div>{tt(language, 'fuel.lapsPerStint')} <strong>{fuel?.stint.stintLaps ?? '—'}</strong></div>
                    <div>{tt(language, 'fuel.stintsToFinish')} <strong>{fuel?.stint.stintsToFinish ?? '—'}</strong></div>
                    <div>{tt(language, 'fuel.fuelPerStint')} <strong>{fmtNumber(fuel?.stint.fuelPerStintLiters, 1)} L</strong></div>
                    <div>{tt(language, 'fuel.history')} <strong>{fuel?.samples.length ?? 0}</strong> {tt(language, 'fuel.movingAverage')}</div>
                  </div>
                </section>
              </div>
            </>
          ) : (
            <GuidedEmptyState language={language} />
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
                <div style={label}>{tt(language, 'fuel.lapTiming')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 12 }}>
                  <div>{tt(language, 'telemetry.current')} <strong>{fmtTime(lap?.currentLapTime)}</strong></div>
                  <div>{tt(language, 'telemetry.last')} <strong>{fmtTime(lap?.lastLap)}</strong></div>
                  <div>{tt(language, 'telemetry.best')} <strong>{fmtTime(lap?.bestLap)}</strong></div>
                  <div>Optimal <strong>{fmtTime(lap?.optimalLap)}</strong></div>
                </div>
                <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                  {(lap?.sectors ?? []).map((sector) => (
                    <div key={sector.index} style={{ display: 'grid', gridTemplateColumns: '70px repeat(4, 1fr)', gap: 8, alignItems: 'center', fontVariantNumeric: 'tabular-nums' }}>
                      <strong>{tt(language, 'fuel.sector', { index: sector.index })}</strong>
                      <span>{tt(language, 'telemetry.current')} {fmtTime(sector.current)}</span>
                      <span>{tt(language, 'telemetry.last')} {fmtTime(sector.last)}</span>
                      <span>{tt(language, 'telemetry.best')} {fmtTime(sector.best)}</span>
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
            <div style={label}>{tt(language, 'fuel.roomKey')}</div>
            <input style={input} type="password" value={teamRoomKey} placeholder={tt(language, 'fuel.roomKeyPlaceholder')} onChange={(event) => setTeamRoomKey(event.target.value)} />
          </div>
          <div>
            <div style={label}>{tt(language, 'fuel.driverName')}</div>
            <input style={input} value={teamDriverName} placeholder={tt(language, 'fuel.driverNamePlaceholder')} onChange={(event) => setTeamDriverName(event.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button disabled={teamBusy} onClick={() => void startTeamFuel('host')}>{tt(language, 'common.host')}</button>
            <button disabled={teamBusy} onClick={() => void startTeamFuel('join')}>{tt(language, 'common.join')}</button>
            <button disabled={teamBusy} onClick={() => void stopTeamFuel()}>{tt(language, 'common.stop')}</button>
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
                <tr><td colSpan={7} style={{ padding: '12px 6px', color: 'rgba(255,255,255,0.58)' }}>{tt(language, 'fuel.noPeers')}</td></tr>
              ) : teamPeers.map((peer) => (
                <tr key={peer.peerId} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <td style={{ padding: '9px 6px' }}><strong>{peer.driverName}</strong>{peer.local ? <span style={{ opacity: 0.58 }}> · {tt(language, 'fuel.you')}</span> : null}</td>
                  <td style={{ textAlign: 'right', padding: '9px 6px' }}>{fmtNumber(peer.fuelLiters, 1)} L</td>
                  <td style={{ textAlign: 'right', padding: '9px 6px' }}>{fmtNumber(peer.fuelPerLap, 2)}</td>
                  <td style={{ textAlign: 'right', padding: '9px 6px' }}>{fmtNumber(peer.lapsRemaining, 1)}</td>
                  <td style={{ textAlign: 'right', padding: '9px 6px' }}>{peer.stintTargetLaps ?? '—'}</td>
                  <td style={{ padding: '9px 6px' }}>{peer.pitWindow?.latestLap ? tt(language, 'fuel.untilLap', { lap: peer.pitWindow.latestLap }) : peer.pitWindow?.status ?? '—'}</td>
                  <td style={{ textAlign: 'right', padding: '9px 6px', opacity: 0.7 }}>{fmtAge(peer.ts, language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
