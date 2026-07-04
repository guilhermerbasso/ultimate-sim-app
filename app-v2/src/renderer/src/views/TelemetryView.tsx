import { type CSSProperties, type ReactElement, useEffect, useMemo, useState } from 'react'
import type { IRacingDiagnostics, TelemetrySnapshot, TelemetrySource, TelemetryStatus } from '../../../shared/telemetry'
import type { AppViewProps } from '../App'
import { getIRacingDiagnostics, getTelemetryStatus, onTelemetry, setTelemetrySource } from '../lib/telemetry'

const SOURCES: { id: TelemetrySource; label: string }[] = [
  { id: 'off', label: 'Desligado' },
  { id: 'auto', label: 'Auto-detectar' },
  { id: 'mock', label: 'Demo (mock)' },
  { id: 'iracing', label: 'iRacing' },
  { id: 'acc', label: 'ACC' },
  { id: 'ac', label: 'Assetto Corsa' },
  { id: 'ams2', label: 'AMS2' }
]

function gearLabel(gear: number): string {
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(gear)
}

function fmtTime(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '--:--.---'
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}

function fmtDelta(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—'
  return `${seconds >= 0 ? '+' : ''}${seconds.toFixed(3)}`
}

const card: CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 'var(--radius-sm)',
  padding: '14px 16px'
}
const label: CSSProperties = { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.6 }
const value: CSSProperties = { fontSize: 26, fontWeight: 700, marginTop: 4 }
const pillBtn: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'transparent',
  color: '#fff',
  cursor: 'pointer'
}

function DiagRow({ rowLabel, ok, text }: { rowLabel: string; ok: boolean; text: string }): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      <span style={{ color: ok ? 'var(--accent-primary)' : 'var(--accent-danger)' }}>{ok ? '●' : '○'}</span>
      <span style={{ opacity: 0.7 }}>{rowLabel}:</span>
      <strong style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{text}</strong>
    </div>
  )
}

function Bar({ value: v, color }: { value: number; color: string }): ReactElement {
  return (
    <div style={{ height: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
      <div style={{ width: `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`, height: '100%', background: color }} />
    </div>
  )
}

export default function TelemetryView(_props: AppViewProps): ReactElement {
  const [snap, setSnap] = useState<TelemetrySnapshot | null>(null)
  const [status, setStatus] = useState<TelemetryStatus | null>(null)
  const [diag, setDiag] = useState<IRacingDiagnostics | null>(null)
  const [diagBusy, setDiagBusy] = useState(false)

  useEffect(() => {
    getTelemetryStatus()
      .then(setStatus)
      .catch(() => undefined)
    const unsubscribe = onTelemetry(setSnap)
    return unsubscribe
  }, [])

  const choose = async (id: TelemetrySource): Promise<void> => {
    try {
      setStatus(await setTelemetrySource(id))
    } catch {
      // ignora
    }
  }

  const runDiagnostics = async (): Promise<void> => {
    setDiagBusy(true)
    try {
      setDiag(await getIRacingDiagnostics())
    } catch {
      setDiag(null)
    } finally {
      setDiagBusy(false)
    }
  }

  const rpmPct = useMemo(() => {
    if (!snap?.maxRpm) return 0
    return snap.rpm / snap.maxRpm
  }, [snap])

  const connected = snap?.connected ?? false

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={label}>Fonte de telemetria</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SOURCES.map((source) => (
            <button
              key={source.id}
              type="button"
              onClick={() => choose(source.id)}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid rgba(255,255,255,0.14)',
                background: status?.source === source.id ? 'var(--accent-primary)' : 'transparent',
                color: '#fff',
                cursor: 'pointer'
              }}
            >
              {source.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={runDiagnostics} disabled={diagBusy} style={{ ...pillBtn, opacity: diagBusy ? 0.6 : 1 }}>
          {diagBusy ? 'Diagnosticando…' : 'Diagnóstico iRacing'}
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.8 }}>
          {connected ? `● conectado (${snap?.sim})` : '○ sem dados'} · {status?.rateHz ?? 30} Hz
        </span>
      </div>

      {diag && (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={label}>Diagnóstico iRacing</span>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{new Date(diag.timestamp).toLocaleTimeString()}</span>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(JSON.stringify(diag, null, 2))}
              style={{ ...pillBtn, marginLeft: 'auto' }}
            >
              Copiar JSON
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
            <DiagRow rowLabel="Plataforma" ok={diag.mmf.platform === 'win32'} text={diag.mmf.platform} />
            <DiagRow rowLabel="koffi carregado" ok={diag.mmf.koffiLoaded} text={diag.mmf.koffiLoaded ? 'sim' : 'não'} />
            <DiagRow rowLabel="iRacing em execução" ok={diag.mmf.viewMapped} text={diag.mmf.viewMapped ? 'sim' : 'não'} />
            <DiagRow rowLabel="Header lido" ok={diag.mmf.headerRead} text={diag.mmf.headerRead ? 'sim' : 'não'} />
            <DiagRow rowLabel="Status conectado" ok={diag.mmf.statusConnected} text={`status=${diag.mmf.status ?? '—'}`} />
            <DiagRow rowLabel="Vars decodificadas" ok={(diag.mmf.valuesDecoded ?? 0) > 0} text={String(diag.mmf.valuesDecoded ?? '—')} />
            <DiagRow rowLabel="Provider conectado" ok={diag.provider.isConnected} text={diag.provider.isConnected ? 'sim' : 'não'} />
            <DiagRow rowLabel="Fonte ativa (hub)" ok={diag.hub.connected} text={`${diag.hub.source}/${diag.hub.active}`} />
          </div>
          {diag.mmf.notes.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, opacity: 0.9 }}>
              {diag.mmf.notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          )}
          {Object.keys(diag.mmf.sampleVars).length > 0 && (
            <pre style={{ margin: 0, fontSize: 12, opacity: 0.8, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(diag.mmf.sampleVars, null, 2)}
            </pre>
          )}
        </div>
      )}

      {!connected && (
        <div style={{ ...card, opacity: 0.85 }}>
          Sem telemetria. Escolha <strong>Demo (mock)</strong> para visualizar com dados sintéticos, ou
          <strong> Auto-detectar</strong>/<strong>iRacing</strong> num PC com o sim aberto.
        </div>
      )}

      {snap && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <div style={card}>
              <div style={label}>Marcha</div>
              <div style={{ ...value, fontSize: 44 }}>{gearLabel(snap.gear)}</div>
            </div>
            <div style={card}>
              <div style={label}>Velocidade</div>
              <div style={value}>{Math.round(snap.speedKmh)} <small style={{ fontSize: 13, opacity: 0.6 }}>km/h</small></div>
            </div>
            <div style={card}>
              <div style={label}>RPM</div>
              <div style={value}>{Math.round(snap.rpm)}</div>
              <div style={{ marginTop: 8 }}><Bar value={rpmPct} color={snap.shiftIndicatorPct && snap.shiftIndicatorPct > 0.8 ? 'var(--accent-danger)' : 'var(--accent-primary)'} /></div>
            </div>
            <div style={card}>
              <div style={label}>Posição</div>
              <div style={value}>P{snap.position ?? '—'} <small style={{ fontSize: 13, opacity: 0.6 }}>/ {snap.totalCars ?? '—'}</small></div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div style={card}>
              <div style={label}>Inputs</div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div><small style={label}>Acelerador</small><Bar value={snap.throttle} color="var(--accent-primary)" /></div>
                <div><small style={label}>Freio</small><Bar value={snap.brake} color="var(--accent-danger)" /></div>
                {snap.clutch > 0 && <div><small style={label}>Embreagem</small><Bar value={snap.clutch} color="var(--accent-primary)" /></div>}
              </div>
            </div>
            <div style={card}>
              <div style={label}>Tempos</div>
              <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                <div>Atual <strong>{fmtTime(snap.currentLapTimeSec)}</strong></div>
                <div>Última <strong>{fmtTime(snap.lastLapTimeSec)}</strong></div>
                <div>Melhor <strong>{fmtTime(snap.bestLapTimeSec)}</strong></div>
                <div>Delta <strong style={{ color: (snap.deltaToBestSec ?? 0) <= 0 ? 'var(--accent-primary)' : 'var(--accent-danger)' }}>{fmtDelta(snap.deltaToBestSec)}</strong></div>
              </div>
            </div>
            <div style={card}>
              <div style={label}>Combustível</div>
              <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                <div><strong>{snap.fuelLiters?.toFixed(1) ?? '—'}</strong> L</div>
                <div>{snap.fuelPerLap?.toFixed(2) ?? '—'} L/volta</div>
                <div>Voltas restantes: <strong>{snap.lapsRemaining ?? '—'}</strong></div>
              </div>
            </div>
            <div style={card}>
              <div style={label}>iRacing / sessão</div>
              <div style={{ marginTop: 8, display: 'grid', gap: 4, fontSize: 13 }}>
                <div>Incidentes: <strong>{snap.incidentCount ?? '—'}{snap.incidentLimit ? `/${snap.incidentLimit}x` : ''}</strong></div>
                <div>Fast repairs: <strong>{snap.fastRepairsAvailable ?? '—'}</strong></div>
                <div>Pista: <strong>{snap.trackTempC?.toFixed(0) ?? '—'}°C</strong> · {snap.isRaining ? `chuva ${Math.round((snap.trackWetnessPct ?? 0) * 100)}%` : 'seco'}</div>
                <div>SoF: <strong>{snap.strengthOfField ?? '—'}</strong></div>
              </div>
            </div>
          </div>

          {snap.drivers && snap.drivers.length > 0 && (
            <div style={card}>
              <div style={label}>Relativo</div>
              <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                {snap.drivers.map((d) => (
                  <div key={d.carIdx} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 8px', borderRadius: 'var(--radius-sm)', background: d.isPlayer ? 'rgba(232,105,32,0.18)' : 'transparent' }}>
                    <span style={{ width: 28, textAlign: 'right', opacity: 0.7 }}>P{d.position}</span>
                    <span style={{ width: 10, height: 10, borderRadius: 'var(--radius-sm)', background: d.classColor ?? '#888' }} />
                    <span style={{ flex: 1 }}>#{d.carNumber} {d.name}</span>
                    <span style={{ opacity: 0.7 }}>{d.className}</span>
                    <span style={{ width: 70, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d.isPlayer ? '—' : fmtDelta(d.gapToPlayerSec)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
