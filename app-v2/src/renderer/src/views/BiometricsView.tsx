import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppViewProps } from '../App'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import {
  BIO_CHANNELS,
  BLE_HEART_RATE_MEASUREMENT,
  BLE_HEART_RATE_SERVICE,
  type BioLiveSample,
  type BioSeriesResult,
  type BioStatus,
  type HeartRateSourceKind,
  type PaceHrInterpretation,
  type StressState
} from '../../../shared/biometrics'
import { ArHudView } from '../overlay/ar/ArHudView'
import { useTelemetrySelector } from '../lib/telemetry'

// BiometricsView (F7) — config + live view for the heart-rate data source.
// Shows live (mock) HR, the HR↔pace correlation / calm-under-pressure analysis,
// and an AR-HUD preview with a fullscreen toggle. Chrome stays warm/neutral;
// cool green/teal is used ONLY for good states (calm, faster-than-reference,
// composed under pressure).

const GOOD = '#2ee06a'
const COOL = '#49c5b1'
const WARN = '#ffb020'
const BAD = '#ff3b30'

const panel: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-6)'
}

const label: CSSProperties = {
  color: 'var(--text-muted)',
  fontFamily: '"Barlow Condensed", sans-serif',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase'
}

const primaryButton: CSSProperties = {
  background: 'var(--accent-primary)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-on-accent)',
  cursor: 'pointer',
  fontFamily: '"Rajdhani", sans-serif',
  fontWeight: 600,
  textTransform: 'uppercase',
  padding: '0 var(--space-6)',
  height: 34,
  letterSpacing: '0.06em'
}

const ghostButton: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontFamily: '"Rajdhani", sans-serif',
  fontWeight: 600,
  textTransform: 'uppercase',
  padding: '0 var(--space-5)',
  height: 32,
  letterSpacing: '0.06em'
}

function stressColor(state?: StressState): string {
  if (state === 'calm') return GOOD
  if (state === 'elevated') return WARN
  if (state === 'stressed') return BAD
  return 'var(--text-secondary)'
}

function stressLabel(state?: StressState): string {
  if (state === 'calm') return 'Calm'
  if (state === 'elevated') return 'Elevated'
  if (state === 'stressed') return 'Stressed'
  return '—'
}

function interpretation(value?: PaceHrInterpretation): { text: string; color: string } {
  if (value === 'calmer-is-faster') return { text: 'Calmer = faster', color: COOL }
  if (value === 'harder-is-faster') return { text: 'Harder = faster', color: WARN }
  return { text: 'Not enough data', color: 'var(--text-muted)' }
}

function calmColor(score: number): string {
  if (score >= 65) return GOOD
  if (score >= 45) return WARN
  return BAD
}

interface BleLike {
  requestDevice(options: {
    filters?: Array<{ services: number[] }>
    optionalServices?: number[]
  }): Promise<BleDevice>
}
interface BleDevice {
  gatt?: { connect(): Promise<BleServer> }
}
interface BleServer {
  getPrimaryService(service: number): Promise<BleService>
}
interface BleService {
  getCharacteristic(characteristic: number): Promise<BleCharacteristic>
}
interface BleCharacteristic {
  startNotifications(): Promise<BleCharacteristic>
  addEventListener(type: 'characteristicvaluechanged', listener: (event: Event) => void): void
}

function getBluetooth(): BleLike | null {
  const candidate = (navigator as unknown as { bluetooth?: BleLike }).bluetooth
  return candidate ?? null
}

// Live AR HUD preview — isolates telemetry-rate re-renders to this subtree so
// the analysis panel above doesn't repaint at 30 Hz.
function ArHudPreview({ bpm, state }: { bpm?: number; state?: StressState }): ReactElement {
  const snapshot = useTelemetrySelector<TelemetrySnapshot | null>((s) => s)
  return <ArHudView snapshot={snapshot} hr={{ bpm, state }} preview style={{ height: 280 }} />
}

export default function BiometricsView(_props: AppViewProps): ReactElement {
  const [status, setStatus] = useState<BioStatus | null>(null)
  const [live, setLive] = useState<BioLiveSample | null>(null)
  const [series, setSeries] = useState<BioSeriesResult | null>(null)
  const [sourceKind, setSourceKind] = useState<HeartRateSourceKind>('mock')
  const [arFullscreen, setArFullscreen] = useState(false)
  const [bleError, setBleError] = useState<string | null>(null)
  const bleSupported = useMemo(() => getBluetooth() !== null, [])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshStatus = useCallback(async () => {
    const next = await window.ipc.invoke<BioStatus>(BIO_CHANNELS.status)
    setStatus(next)
    setSourceKind(next.sourceKind)
  }, [])

  const refreshSeries = useCallback(async () => {
    const next = await window.ipc.invoke<BioSeriesResult>(BIO_CHANNELS.series)
    setSeries(next)
  }, [])

  useEffect(() => {
    void refreshStatus()
    const offSample = window.ipc.subscribe<BioLiveSample>(BIO_CHANNELS.sample, setLive)
    const offUpdate = window.ipc.subscribe<BioStatus>(BIO_CHANNELS.update, (next) => {
      setStatus(next)
      setSourceKind(next.sourceKind)
    })
    return () => {
      offSample()
      offUpdate()
    }
  }, [refreshStatus])

  // Poll the analysis while a session is running.
  useEffect(() => {
    if (!status?.running) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    void refreshSeries()
    pollRef.current = setInterval(() => void refreshSeries(), 3000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [status?.running, refreshSeries])

  const start = useCallback(
    async (kind: HeartRateSourceKind) => {
      const next = await window.ipc.invoke<BioStatus>(BIO_CHANNELS.start, kind)
      setStatus(next)
      setSourceKind(next.sourceKind)
    },
    []
  )

  const stop = useCallback(async () => {
    const next = await window.ipc.invoke<BioStatus>(BIO_CHANNELS.stop)
    setStatus(next)
  }, [])

  const pairBle = useCallback(async () => {
    setBleError(null)
    const bluetooth = getBluetooth()
    if (!bluetooth) {
      setBleError('Web Bluetooth is not available on this device/OS.')
      return
    }
    try {
      const device = await bluetooth.requestDevice({
        filters: [{ services: [BLE_HEART_RATE_SERVICE] }],
        optionalServices: [BLE_HEART_RATE_SERVICE]
      })
      const server = await device.gatt?.connect()
      if (!server) throw new Error('GATT unavailable.')
      const service = await server.getPrimaryService(BLE_HEART_RATE_SERVICE)
      const characteristic = await service.getCharacteristic(BLE_HEART_RATE_MEASUREMENT)
      await characteristic.startNotifications()
      characteristic.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as unknown as { value?: DataView }).value
        if (!value) return
        const bytes = Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
        void window.ipc.invoke(BIO_CHANNELS.bleValue, bytes)
      })
      await start('ble')
    } catch (error) {
      setBleError(error instanceof Error ? error.message : String(error))
    }
  }, [start])

  const running = Boolean(status?.running)
  const bpm = live?.bpm ?? status?.bpm
  const state = live?.state ?? status?.state
  const intensity = live?.intensity
  const corr = series?.correlation
  const calm = series?.calm
  const laps = series?.laps ?? []
  const spikes = series?.spikes ?? []
  const interp = interpretation(corr?.interpretation)

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* ── Controls ───────────────────────────────────────────────────────── */}
      <div style={{ ...panel, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['mock', 'ble'] as HeartRateSourceKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setSourceKind(kind)}
              style={{
                ...ghostButton,
                ...(sourceKind === kind
                  ? { borderColor: 'var(--border-accent)', background: 'var(--surface-selected)' }
                  : {})
              }}
            >
              {kind === 'mock' ? 'Mock (no hardware)' : 'BLE (real monitor)'}
            </button>
          ))}
        </div>

        {running ? (
          <button type="button" style={{ ...primaryButton, background: BAD }} onClick={() => void stop()}>
            Stop
          </button>
        ) : (
          <button type="button" style={primaryButton} onClick={() => void start(sourceKind)}>
            Start {sourceKind === 'mock' ? 'mock' : 'BLE'}
          </button>
        )}

        {sourceKind === 'ble' ? (
          <button type="button" style={ghostButton} onClick={() => void pairBle()} disabled={!bleSupported}>
            Pair BLE monitor
          </button>
        ) : null}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={label}>Source</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            {status?.sourceKind === 'ble' ? 'BLE 0x180D' : 'Mock'}
          </span>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: running ? (status?.hardwareConnected || status?.sourceKind === 'mock' ? GOOD : WARN) : 'var(--border-strong)'
            }}
          />
        </div>
      </div>

      {(status?.note || bleError) && (
        <div
          style={{
            ...panel,
            borderColor: bleError ? BAD : WARN,
            color: 'var(--text-secondary)',
            fontSize: 13
          }}
        >
          {bleError ?? status?.note}
        </div>
      )}

      {/* ── Live HR + AR preview ───────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 0.8fr) minmax(320px, 1.2fr)', gap: 18, alignItems: 'start' }}>
        <div style={{ ...panel, display: 'grid', gap: 14 }}>
          <span style={label}>Heart rate {status?.sourceKind === 'mock' ? '(simulated)' : '(BLE)'}</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 72, fontWeight: 700, lineHeight: 1, color: stressColor(state), fontVariantNumeric: 'tabular-nums' }}>
              {bpm ?? '—'}
            </span>
            <span style={{ ...label, fontSize: 16 }}>BPM</span>
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <Stat title="State" value={stressLabel(state)} color={stressColor(state)} />
            <Stat title="Baseline" value={status?.baselineBpm ? `${status.baselineBpm} BPM` : '—'} />
            <Stat title="Samples" value={String(status?.sampleCount ?? 0)} />
          </div>
          {intensity !== undefined && (
            <div style={{ display: 'grid', gap: 6 }}>
              <span style={label}>Driving intensity</span>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-sunken)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.round(intensity * 100)}%`, height: '100%', background: COOL }} />
              </div>
            </div>
          )}
        </div>

        <div style={{ ...panel, display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={label}>AR HUD preview</span>
            <button type="button" style={ghostButton} onClick={() => setArFullscreen(true)}>
              Full screen
            </button>
          </div>
          <ArHudPreview bpm={bpm} state={state} />
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            High-contrast layout optimized for AR glasses / passthrough (black = transparent on optical
            displays). Requires AR hardware for real use.
          </span>
        </div>
      </div>

      {/* ── Correlation / analysis ─────────────────────────────────────────── */}
      <div style={{ ...panel, display: 'grid', gap: 16 }}>
        <span style={label}>Stress × pace correlation</span>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Stat title="Reading" value={interp.text} color={interp.color} />
          <Stat title="Pearson (HR × tempo)" value={corr ? corr.pearson.toFixed(2) : '—'} />
          <Stat
            title="Calm under pressure"
            value={calm ? `${calm.score}/100` : '—'}
            color={calm ? calmColor(calm.score) : undefined}
          />
          <Stat title="Laps analyzed" value={String(laps.length)} />
          <Stat title="Stress spikes" value={String(spikes.length)} />
        </div>

        {laps.length > 0 && (
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={label}>Laps (average HR × time)</span>
            <div style={{ display: 'grid', gap: 4 }}>
              {laps.slice(-8).map((lap) => (
                <div
                  key={lap.lap}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '60px 1fr 90px 70px',
                    gap: 10,
                    alignItems: 'center',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--text-secondary)'
                  }}
                >
                  <span>V{lap.lap}</span>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-sunken)', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(100, Math.round((lap.avgBpm / 200) * 100))}%`,
                        height: '100%',
                        background: COOL
                      }}
                    />
                  </div>
                  <span>{lap.avgBpm} BPM</span>
                  <span>{lap.lapTimeSec.toFixed(1)}s</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {spikes.length > 0 && (
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={label}>Stress spikes aligned with events</span>
            {spikes.slice(-6).map((spike, index) => (
              <div key={`${spike.t}-${index}`} style={{ display: 'flex', gap: 12, color: 'var(--text-secondary)', fontSize: 13 }}>
                <span style={{ color: BAD, fontWeight: 600 }}>+{spike.deltaBpm} BPM</span>
                <span>{spike.peakBpm} BPM (base {spike.baselineBpm})</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {spike.event ? `↔ ${spike.event.label ?? spike.event.kind}` : 'no nearby event'}
                </span>
              </div>
            ))}
          </div>
        )}

        {!running && (
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Start a session (mock works without hardware) to collect HR and correlate it with lap pace.
          </span>
        )}
      </div>

      {/* ── Fullscreen AR HUD ──────────────────────────────────────────────── */}
      {arFullscreen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
          <FullscreenAr bpm={bpm} state={state} />
          <button
            type="button"
            onClick={() => setArFullscreen(false)}
            style={{ ...ghostButton, position: 'fixed', top: 16, right: 16, zIndex: 1001, background: 'rgba(0,0,0,0.6)' }}
          >
            Close AR
          </button>
        </div>
      )}
    </div>
  )
}

// Fullscreen variant binds to live telemetry directly.
function FullscreenAr({ bpm, state }: { bpm?: number; state?: StressState }): ReactElement {
  const snapshot = useTelemetrySelector<TelemetrySnapshot | null>((s) => s)
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <ArHudView snapshot={snapshot} hr={{ bpm, state }} />
    </div>
  )
}

function Stat({ title, value, color }: { title: string; value: string; color?: string }): ReactElement {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={label}>{title}</span>
      <span style={{ color: color ?? 'var(--text-primary)', fontWeight: 600, fontSize: 16 }}>{value}</span>
    </div>
  )
}
