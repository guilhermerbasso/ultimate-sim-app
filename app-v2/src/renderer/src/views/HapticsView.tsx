import { type ComponentType, type CSSProperties, type ReactElement, useEffect, useRef, useState } from 'react'
import type { AppViewProps } from '../App'
import { tt } from '../i18n'
import { SectionExportImport } from '../components/SectionExportImport'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import {
  DEFAULT_HAPTICS_CONFIG,
  HAPTICS_CHANNELS,
  HAPTICS_EFFECT_IDS,
  HAPTICS_EFFECT_META,
  deriveHapticsFrame,
  type HapticsConfig,
  type HapticsEffectConfig,
  type HapticsEffectId,
  type HapticsFrame
} from '../../../shared/haptics'
import {
  getHapticsEffectLevels,
  getHapticsMeterLevel,
  setHapticsOutputDevice,
  testHapticsEffect
} from '../lib/haptics-runtime'
import { useDevices } from '../lib/devices/DeviceRegistry'

const shell: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(420px, 1.15fr) minmax(360px, 0.85fr)',
  gap: 18,
  alignItems: 'start'
}

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
  letterSpacing: '0.10em',
  textTransform: 'uppercase'
}

const inputStyle: CSSProperties = {
  width: '100%',
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-primary)',
  fontFamily: '"Instrument Sans", sans-serif',
  padding: '0 var(--space-4)',
  height: 36
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
  height: 32,
  letterSpacing: '0.08em'
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
  height: 30,
  letterSpacing: '0.08em'
}

type HapticsConfigPatch = {
  enabled?: boolean
  muted?: boolean
  masterGain?: number
  outputDeviceId?: string
  effects?: Partial<Record<HapticsEffectId, Partial<HapticsEffectConfig>>>
  arduino?: Partial<HapticsConfig['arduino']>
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function pct(value: number | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}

function num(value: number | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits)
}

const HapticsView: ComponentType<AppViewProps> = ({ showToast, language }): ReactElement => {
  const { audioOutputs, audioOutputsStatus, audioBusy, refreshAudioOutputs, serialDevices, refreshFleet } = useDevices()
  const [config, setConfig] = useState<HapticsConfig>(DEFAULT_HAPTICS_CONFIG)
  const [live, setLive] = useState<TelemetrySnapshot | null>(null)
  const [frame, setFrame] = useState<HapticsFrame>(() => deriveHapticsFrame(null, null))
  const [meter, setMeter] = useState(0)
  const [levels, setLevels] = useState<Record<HapticsEffectId, number>>(() => getHapticsEffectLevels())
  const [busy, setBusy] = useState(false)
  const prevRef = useRef<TelemetrySnapshot | null>(null)

  useEffect(() => {
    void window.ipc
      .invoke<HapticsConfig>(HAPTICS_CHANNELS.getConfig)
      .then(setConfig)
      .catch((error) => showToast(getErrorMessage(error), 'error'))

    const offConfig = window.ipc.subscribe<HapticsConfig>(HAPTICS_CHANNELS.configEvent, setConfig)
    const offTelemetry = window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', (snapshot) => {
      setLive(snapshot)
      setFrame(deriveHapticsFrame(snapshot, prevRef.current))
      prevRef.current = snapshot && snapshot.connected ? snapshot : null
    })
    void refreshAudioOutputs(false)
    void refreshFleet().catch(() => undefined)

    return () => {
      offConfig()
      offTelemetry()
    }
  }, [showToast, refreshAudioOutputs, refreshFleet])

  // Poll the live engine meters (~12 Hz) so the bars reflect real audio output.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setMeter(getHapticsMeterLevel())
      setLevels(getHapticsEffectLevels())
    }, 80)
    return () => window.clearInterval(timer)
  }, [])

  async function reloadConfig(): Promise<void> {
    try {
      const loaded = await window.ipc.invoke<HapticsConfig>(HAPTICS_CHANNELS.getConfig)
      setConfig(loaded)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function persist(patch: HapticsConfigPatch, success?: string): Promise<void> {
    setBusy(true)
    try {
      const saved = await window.ipc.invoke<HapticsConfig>(HAPTICS_CHANNELS.setConfig, patch)
      setConfig(saved)
      if (success) showToast(success, 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  function patchEffectLocal(id: HapticsEffectId, patch: Partial<HapticsEffectConfig>): void {
    setConfig((current) => ({ ...current, effects: { ...current.effects, [id]: { ...current.effects[id], ...patch } } }))
  }

  function changeOutputDevice(outputDeviceId: string): void {
    setHapticsOutputDevice(outputDeviceId)
    setConfig((current) => ({ ...current, outputDeviceId }))
    void persist({ outputDeviceId }, outputDeviceId ? tt(language, 'haptics.outputSelectedToast') : tt(language, 'haptics.outputDefaultToast'))
  }

  const arduinoDevices = serialDevices.filter((device) => device.kind !== 'sim-x')

  return (
    <section style={shell}>
      <article style={{ ...panel, minHeight: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <span style={label}>Haptics · Bass shaker</span>
          <SectionExportImport sectionId="haptics" label={tt(language, 'haptics.exportLabel')} onImported={() => void reloadConfig()} />
        </div>
        <h3 style={{ margin: '8px 0 4px', fontSize: 26 }}>{tt(language, 'haptics.title')}</h3>
        <p style={{ color: 'rgba(255,255,255,0.62)', marginTop: 0 }}>
          {tt(language, 'haptics.summary')}
        </p>

        <MasterBar
          language={language}
          busy={busy}
          config={config}
          meter={meter}
          onToggleEnabled={() => void persist({ enabled: !config.enabled })}
          onToggleMute={() => void persist({ muted: !config.muted })}
          onMaster={(masterGain) => setConfig((c) => ({ ...c, masterGain }))}
          onMasterCommit={(masterGain) => void persist({ masterGain })}
        />

        <OutputSelector
          language={language}
          busy={busy || audioBusy}
          devices={audioOutputs}
          outputDeviceId={config.outputDeviceId}
          status={audioOutputsStatus}
          onChange={changeOutputDevice}
          onRefresh={() => void refreshAudioOutputs(true)}
        />

        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          {HAPTICS_EFFECT_IDS.map((id) => (
            <EffectCard
              language={language}
              key={id}
              busy={busy}
              effect={config.effects[id]}
              id={id}
              level={levels[id] ?? 0}
              onChange={(patch) => patchEffectLocal(id, patch)}
              onCommit={(patch, success) => void persist({ effects: { [id]: patch } }, success)}
              onTest={() => testHapticsEffect(id, config)}
              onToggle={() => void persist({ effects: { [id]: { enabled: !config.effects[id].enabled } } })}
            />
          ))}
        </div>
      </article>

      <div style={{ display: 'grid', gap: 18 }}>
        <article style={panel}>
          <span style={label}>{tt(language, 'haptics.liveTelemetry')}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, margin: '10px 0 4px' }}>
            <Tile labelText="RPM" value={live?.rpm == null ? '—' : `${Math.round(live.rpm)}`} />
            <Tile labelText={tt(language, 'haptics.gear')} value={live?.gear == null ? '—' : String(live.gear)} />
            <Tile labelText={tt(language, 'haptics.speed')} value={live?.speedKmh == null ? '—' : `${Math.round(live.speedKmh)} km/h`} />
            <Tile labelText={tt(language, 'haptics.throttle')} value={pct(live?.throttle)} />
            <Tile labelText={tt(language, 'haptics.brake')} value={pct(live?.brake)} />
            <Tile labelText="ABS" value={live?.absActive == null ? tt(language, 'haptics.noDataShort') : live.absActive ? tt(language, 'common.sim') : tt(language, 'common.no')} />
            <Tile labelText="TC" value={live?.tcActive == null ? tt(language, 'haptics.noDataShort') : live.tcActive ? tt(language, 'common.sim') : tt(language, 'common.no')} />
            
            <Tile labelText={tt(language, 'haptics.latAccel')} value={`${num(frame.latAccelMs2)} m/s²`} />
          </div>
          <span style={label}>{tt(language, 'haptics.derivedSignals')}</span>
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            <SignalBar labelText={tt(language, 'haptics.engine')} value={frame.engine} />
            <SignalBar labelText={tt(language, 'haptics.texture')} value={frame.roadTexture} />
            <SignalBar labelText={tt(language, 'haptics.lockSpin')} value={frame.wheelLock} />
            <SignalBar labelText={tt(language, 'haptics.kerb')} value={frame.kerb} />
            <SignalBar labelText={tt(language, 'haptics.impact')} value={frame.impact} />
            <SignalBar labelText={tt(language, 'haptics.suspension')} value={frame.suspension} />
            <SignalBar labelText="TC Cut" value={frame.tcCut ? 1 : 0} />
            <SignalBar labelText={tt(language, 'haptics.grind')} value={frame.gearGrind ? 1 : 0} />
          </div>
        </article>

        <ArduinoPanel
          language={language}
          busy={busy}
          config={config}
          devices={arduinoDevices.map((d) => ({ id: d.id, label: d.label, connected: d.connected }))}
          onChange={(patch) => setConfig((c) => ({ ...c, arduino: { ...c.arduino, ...patch } }))}
          onCommit={(patch, success) => void persist({ arduino: patch }, success)}
          onRefresh={() => void refreshFleet().catch(() => undefined)}
          onTest={async (effectId) => {
            try {
              await window.ipc.invoke<boolean>(HAPTICS_CHANNELS.testArduino, effectId)
              showToast(tt(language, 'haptics.testBuzzToast'), 'success')
            } catch (error) {
              showToast(getErrorMessage(error), 'error')
            }
          }}
        />

        <article style={panel}>
          <span style={label}>{tt(language, 'haptics.telemetryFidelity')}</span>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, margin: '8px 0 0' }}>
            {tt(language, 'haptics.fidelityHelp')} <code>TelemetrySnapshot</code>:
          </p>
          <ul style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
            <li>Native <strong>longAccel / latAccel</strong> (currently derived from speed/yaw) — impacts and curbs.</li>
            <li><strong>vertAccel</strong> (vertical acceleration) — real curbs/rumble.</li>
            <li><strong>wheelSlip / per-wheel speed</strong> — precise lockup and sliding.</li>
            <li>{tt(language, 'haptics.fidelityCurbBefore')} <strong>curb/rumble signal</strong>{tt(language, 'haptics.fidelityCurbAfter')}</li>
          </ul>
        </article>
      </div>
    </section>
  )
}

function MasterBar({
  language,
  busy,
  config,
  meter,
  onToggleEnabled,
  onToggleMute,
  onMaster,
  onMasterCommit
}: {
  language: AppViewProps['language']
  busy: boolean
  config: HapticsConfig
  meter: number
  onToggleEnabled(): void
  onToggleMute(): void
  onMaster(value: number): void
  onMasterCommit(value: number): void
}): ReactElement {
  return (
    <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)', background: 'var(--surface-sunken)', display: 'grid', gap: 12, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <strong style={{ fontSize: 16 }}>{tt(language, 'haptics.globalOutput')}</strong>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, margin: '2px 0 0' }}>{tt(language, 'haptics.globalOutputDesc')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={busy} onClick={onToggleEnabled} style={{ ...primaryButton, background: config.enabled ? 'var(--accent-primary)' : 'transparent', color: config.enabled ? 'var(--text-on-accent)' : 'var(--text-primary)', border: config.enabled ? 'none' : '1px solid var(--border-strong)' }} type="button">
            {config.enabled ? tt(language, 'haptics.active') : tt(language, 'haptics.turnOn')}
          </button>
          <button disabled={busy} onClick={onToggleMute} style={{ ...primaryButton, background: config.muted ? 'var(--accent-danger)' : 'transparent', color: config.muted ? 'var(--text-on-accent)' : 'var(--text-primary)', border: config.muted ? 'none' : '1px solid var(--border-strong)' }} type="button">
            {config.muted ? tt(language, 'haptics.muted') : tt(language, 'haptics.mute')}
          </button>
        </div>
      </div>
      <Slider labelText={tt(language, 'haptics.masterGain')} min={0} max={1} step={0.01} value={config.masterGain} display={pct(config.masterGain)} onChange={onMaster} onCommit={() => onMasterCommit(config.masterGain)} />
      <div>
        <span style={label}>{tt(language, 'haptics.outputMeter')}</span>
        <Meter value={config.enabled && !config.muted ? meter : 0} />
      </div>
    </div>
  )
}

function OutputSelector({
  language,
  busy,
  devices,
  outputDeviceId,
  status,
  onChange,
  onRefresh
}: {
  language: AppViewProps['language']
  busy: boolean
  devices: { deviceId: string; label: string }[]
  outputDeviceId: string
  status: string
  onChange(value: string): void
  onRefresh(): void
}): ReactElement {
  const missing = outputDeviceId.length > 0 && !devices.some((device) => device.deviceId === outputDeviceId)
  return (
    <div style={{ border: '1px solid var(--border-accent)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', background: 'var(--surface-selected)', display: 'grid', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div>
          <span style={label}>{tt(language, 'haptics.outputDevice')}</span>
          <p style={{ color: 'rgba(255,255,255,0.58)', fontSize: 12, margin: '4px 0 0' }}>{tt(language, 'haptics.outputDeviceHelp')}</p>
        </div>
        <button disabled={busy} onClick={onRefresh} style={ghostButton} type="button">{tt(language, 'haptics.refresh')}</button>
      </div>
      <select disabled={busy} onChange={(event) => onChange(event.target.value)} style={inputStyle} value={outputDeviceId}>
        <option value="">{tt(language, 'haptics.systemDefault')}</option>
        {missing ? <option value={outputDeviceId}>{tt(language, 'haptics.deviceUnavailable')}</option> : null}
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
        ))}
      </select>
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: 0 }}>{status}</p>
    </div>
  )
}

function EffectCard({
  language,
  busy,
  effect,
  id,
  level,
  onChange,
  onCommit,
  onTest,
  onToggle
}: {
  language: AppViewProps['language']
  busy: boolean
  effect: HapticsEffectConfig
  id: HapticsEffectId
  level: number
  onChange(patch: Partial<HapticsEffectConfig>): void
  onCommit(patch: Partial<HapticsEffectConfig>, success?: string): void
  onTest(): void
  onToggle(): void
}): ReactElement {
  const meta = HAPTICS_EFFECT_META[id]
  const accent = effect.enabled ? 'var(--accent-primary)' : 'var(--border-strong)'
  return (
    <div style={{ border: `1px solid ${effect.enabled ? 'var(--border-accent)' : 'var(--border-default)'}`, borderRadius: 'var(--radius-md)', background: effect.enabled ? 'var(--surface-selected)' : 'var(--surface-sunken)', padding: 'var(--space-5)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 15 }}>{meta.label}</strong>
            {meta.heuristic ? <span style={{ ...label, color: 'var(--accent-warning)' }}>{tt(language, 'haptics.heuristic')}</span> : null}
            {meta.transient ? <span style={{ ...label, color: 'var(--text-secondary)' }}>{tt(language, 'haptics.pulse')}</span> : null}
          </div>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, margin: '3px 0 0' }}>{meta.blurb}</p>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, margin: '2px 0 0' }}>{tt(language, 'haptics.signalLabel', { signal: meta.signal })}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={onTest} style={ghostButton} type="button">{tt(language, 'haptics.test')}</button>
          <button disabled={busy} onClick={onToggle} style={{ ...ghostButton, borderColor: accent, color: effect.enabled ? 'var(--accent-primary)' : 'var(--text-primary)' }} type="button">
            {effect.enabled ? tt(language, 'haptics.on') : tt(language, 'haptics.off')}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <Meter value={effect.enabled ? level : 0} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: meta.sweep ? '1fr 1fr' : '1fr', gap: 12, marginTop: 12 }}>
        <Slider labelText={meta.sweep ? tt(language, 'haptics.minFreq') : tt(language, 'haptics.frequency')} min={meta.freqMin} max={meta.freqMax} step={1} value={effect.frequencyHz} display={`${Math.round(effect.frequencyHz)} Hz`} onChange={(frequencyHz) => onChange({ frequencyHz })} onCommit={() => onCommit({ frequencyHz: effect.frequencyHz })} />
        {meta.sweep ? (
          <Slider labelText={tt(language, 'haptics.maxFreq')} min={meta.freqMin} max={meta.freqMax} step={1} value={effect.frequencyToHz ?? meta.freqMax} display={`${Math.round(effect.frequencyToHz ?? meta.freqMax)} Hz`} onChange={(frequencyToHz) => onChange({ frequencyToHz })} onCommit={() => onCommit({ frequencyToHz: effect.frequencyToHz ?? meta.freqMax })} />
        ) : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
        <Slider labelText={tt(language, 'haptics.intensity')} min={0} max={1} step={0.01} value={effect.intensity} display={pct(effect.intensity)} onChange={(intensity) => onChange({ intensity })} onCommit={() => onCommit({ intensity: effect.intensity })} />
        <Slider labelText={tt(language, 'haptics.smoothing')} min={0} max={1} step={0.01} value={effect.smoothing} display={pct(effect.smoothing)} onChange={(smoothing) => onChange({ smoothing })} onCommit={() => onCommit({ smoothing: effect.smoothing })} />
        <Slider labelText={tt(language, 'haptics.minThreshold')} min={0} max={1} step={0.01} value={effect.minThreshold} display={pct(effect.minThreshold)} onChange={(minThreshold) => onChange({ minThreshold })} onCommit={() => onCommit({ minThreshold: effect.minThreshold })} />
        <Slider labelText={tt(language, 'haptics.maxThreshold')} min={0} max={1} step={0.01} value={effect.maxThreshold} display={pct(effect.maxThreshold)} onChange={(maxThreshold) => onChange({ maxThreshold })} onCommit={() => onCommit({ maxThreshold: effect.maxThreshold })} />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer' }}>
        <input checked={effect.arduino} onChange={(event) => onCommit({ arduino: event.target.checked })} style={{ accentColor: 'var(--accent-primary)' }} type="checkbox" />
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{tt(language, 'haptics.sendArduino')}</span>
      </label>
    </div>
  )
}

function ArduinoPanel({
  language,
  busy,
  config,
  devices,
  onChange,
  onCommit,
  onRefresh,
  onTest
}: {
  language: AppViewProps['language']
  busy: boolean
  config: HapticsConfig
  devices: { id: string; label: string; connected: boolean }[]
  onChange(patch: Partial<HapticsConfig['arduino']>): void
  onCommit(patch: Partial<HapticsConfig['arduino']>, success?: string): void
  onRefresh(): void
  onTest(effectId: HapticsEffectId): void
}): ReactElement {
  const routed = HAPTICS_EFFECT_IDS.filter((id) => config.effects[id].arduino)
  const missing = config.arduino.deviceId.length > 0 && !devices.some((device) => device.id === config.arduino.deviceId)
  return (
    <article style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <span style={label}>Arduino · secondary</span>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, margin: '4px 0 0' }}>Discrete buzzes (vibration motor) in the button box/wheel. Optional — audio bass shaker is the main output.</p>
        </div>
        <button disabled={busy} onClick={() => onCommit({ enabled: !config.arduino.enabled })} style={{ ...primaryButton, background: config.arduino.enabled ? 'var(--accent-primary)' : 'transparent', color: config.arduino.enabled ? 'var(--text-on-accent)' : 'var(--text-primary)', border: config.arduino.enabled ? 'none' : '1px solid var(--border-strong)' }} type="button">
          {config.arduino.enabled ? tt(language, 'haptics.active') : tt(language, 'haptics.turnOn')}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12 }}>
        <label style={{ display: 'grid', gap: 6, flex: 1 }}>
          <span style={label}>{tt(language, 'haptics.serialDevice')}</span>
          <select disabled={busy} onChange={(event) => onCommit({ deviceId: event.target.value })} style={inputStyle} value={config.arduino.deviceId}>
            <option value="">Select…</option>
            {missing ? <option value={config.arduino.deviceId}>{tt(language, 'haptics.deviceUnavailable')}</option> : null}
            {devices.map((device) => (
              <option key={device.id} value={device.id}>{device.label}{device.connected ? '' : ` (${tt(language, 'haptics.offline')})`}</option>
            ))}
          </select>
        </label>
        <button disabled={busy} onClick={onRefresh} style={ghostButton} type="button">{tt(language, 'haptics.refresh')}</button>
      </div>

      <div style={{ marginTop: 10 }}>
        <Slider labelText={tt(language, 'haptics.minBuzzInterval')} min={40} max={1000} step={10} value={config.arduino.minIntervalMs} display={`${config.arduino.minIntervalMs} ms`} onChange={(minIntervalMs) => onChange({ minIntervalMs })} onCommit={() => onCommit({ minIntervalMs: config.arduino.minIntervalMs })} />
      </div>

      <div style={{ marginTop: 12 }}>
        <span style={label}>{tt(language, 'haptics.routedEffects')}</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {routed.length === 0 ? (
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{tt(language, 'haptics.noRoutedEffects')}</span>
          ) : (
            routed.map((id) => (
              <button key={id} onClick={() => onTest(id)} style={ghostButton} type="button">{tt(language, 'haptics.testEffect', { name: HAPTICS_EFFECT_META[id].label })}</button>
            ))
          )}
        </div>
      </div>
    </article>
  )
}

function Slider({
  labelText,
  min,
  max,
  step,
  value,
  display,
  onChange,
  onCommit
}: {
  labelText: string
  min: number
  max: number
  step: number
  value: number
  display: string
  onChange(value: number): void
  onCommit(): void
}): ReactElement {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={label}>{labelText}</span>
        <span style={{ ...label, color: 'var(--text-secondary)' }}>{display}</span>
      </span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        onKeyUp={onCommit}
        onPointerUp={onCommit}
        step={step}
        style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
        type="range"
        value={Number.isFinite(value) ? value : min}
      />
    </label>
  )
}

function Meter({ value }: { value: number }): ReactElement {
  const width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
  return (
    <div style={{ height: 8, borderRadius: 'var(--radius-pill)', background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width, background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-primary-bright))', transition: 'width 80ms linear' }} />
    </div>
  )
}

function SignalBar({ labelText, value }: { labelText: string; value: number }): ReactElement {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 8, alignItems: 'center' }}>
      <span style={{ ...label, color: 'var(--text-secondary)' }}>{labelText}</span>
      <Meter value={value} />
    </div>
  )
}

function Tile({ labelText, value }: { labelText: string; value: string }): ReactElement {
  return (
    <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', padding: 10, background: 'var(--surface-sunken)' }}>
      <span style={label}>{labelText}</span>
      <strong style={{ display: 'block', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</strong>
    </div>
  )
}

export default HapticsView
