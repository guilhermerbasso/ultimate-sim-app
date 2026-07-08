import { type ComponentType, type CSSProperties, type ReactElement, useEffect, useMemo, useState } from 'react'
import type { AppViewProps } from '../App'
import { SectionExportImport } from '../components/SectionExportImport'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import {
  DEFAULT_SOUNDS_CONFIG,
  SOUNDSHIFT_CHANNELS,
  carKeyOf,
  evaluateAbs,
  evaluateTcs,
  type ControlAssistSoundConfig,
  type ControlTriggerMode,
  type IncidentSoundConfig,
  type SoundCueSettings,
  type SoundsConfig,
  type SoundshiftCarTuning,
  type SoundshiftConfig,
  type SoundshiftMode
} from '../../../shared/soundshift'
import { ensureAudio, playBeep, setAudioOutputDevice } from '../lib/soundshift-runtime'
import { useDevices } from '../lib/devices/DeviceRegistry'

const shell: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(320px, 0.9fr) minmax(460px, 1.1fr)',
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
  padding: '0 var(--space-6)',
  height: 32,
  letterSpacing: '0.08em'
}

type SoundsTab = 'soundshift' | 'incident' | 'abs' | 'tcs'
type SoundsConfigPatch = {
  outputDeviceId?: string
  soundshift?: Partial<SoundshiftConfig>
  incident?: Partial<IncidentSoundConfig>
  abs?: Partial<ControlAssistSoundConfig>
  tcs?: Partial<ControlAssistSoundConfig>
}

interface AudioOutputOption {
  deviceId: string
  label: string
}

const tabs: Array<{ id: SoundsTab; label: string; description: string }> = [
  { id: 'soundshift', label: 'Soundshift', description: 'Optimal shift beep' },
  { id: 'incident', label: 'Incident', description: 'iRacing incident count increase' },
  { id: 'abs', label: 'ABS', description: 'ABS engaging under braking' },
  { id: 'tcs', label: 'TCS', description: 'Traction control intervention' }
]

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatPct(value: number | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}

function formatRpm(value: number | undefined): string {
  return value == null || value <= 0 ? '—' : `${Math.round(value).toLocaleString('pt-BR')} rpm`
}

function formatBool(value: boolean | undefined): string {
  if (value == null) return 'missing'
  return value ? 'yes' : 'no'
}

function normalizeDefaultOutputDevice(deviceId: string): string {
  return deviceId === 'default' ? '' : deviceId
}

const SoundsView: ComponentType<AppViewProps> = ({ showToast }): ReactElement => {
  // Audio outputs come from the shared device registry so the list (and the
  // selected output) stays consistent with the Devices hub and every other
  // menu — no per-view re-enumeration.
  const { audioOutputs, audioOutputsStatus, audioBusy, refreshAudioOutputs } = useDevices()
  const [activeTab, setActiveTab] = useState<SoundsTab>('soundshift')
  const [config, setConfig] = useState<SoundsConfig>(DEFAULT_SOUNDS_CONFIG)
  const [live, setLive] = useState<TelemetrySnapshot | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.ipc
      .invoke<SoundsConfig>(SOUNDSHIFT_CHANNELS.getConfig)
      .then(setConfig)
      .catch((error) => showToast(getErrorMessage(error), 'error'))

    const offConfig = window.ipc.subscribe<SoundsConfig>(SOUNDSHIFT_CHANNELS.configEvent, setConfig)
    const offTelemetry = window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', setLive)
    void refreshAudioOutputs(true)
    return () => {
      offConfig()
      offTelemetry()
    }
  }, [showToast])

  const carRows = useMemo(() => {
    const rows = new Map<string, SoundshiftCarTuning>()
    for (const [key, tuning] of Object.entries(config.soundshift.cars)) rows.set(key, tuning)
    const currentKey = carKeyOf(live?.carName)
    if (live?.carName && !rows.has(currentKey)) {
      rows.set(currentKey, {
        carKey: currentKey,
        carName: live.carName,
        thresholdPct: config.soundshift.defaultThresholdPct
      })
    }
    return [...rows.values()].sort((a, b) => (a.carName ?? a.carKey).localeCompare(b.carName ?? b.carKey))
  }, [config.soundshift, live?.carName])

  async function persist(patch: SoundsConfigPatch, success?: string): Promise<void> {
    setBusy(true)
    try {
      const saved = await window.ipc.invoke<SoundsConfig>(SOUNDSHIFT_CHANNELS.setConfig, patch)
      setConfig(saved)
      if (success) showToast(success, 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function reloadConfig(): Promise<void> {
    try {
      const loaded = await window.ipc.invoke<SoundsConfig>(SOUNDSHIFT_CHANNELS.getConfig)
      setConfig(loaded)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function resetLearned(): Promise<void> {
    setBusy(true)
    try {
      const saved = await window.ipc.invoke<SoundsConfig>(SOUNDSHIFT_CHANNELS.clearLearned)
      setConfig(saved)
      showToast('Learned RPM by gear reset.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  function changeOutputDevice(outputDeviceId: string): void {
    setAudioOutputDevice(outputDeviceId)
    setConfig((current) => ({ ...current, outputDeviceId }))
    void persist({ outputDeviceId }, outputDeviceId ? 'Audio cues routed to selected output.' : 'Audio cues routed to system default.')
  }

  function updateSoundshift(patch: Partial<SoundshiftConfig>): void {
    setConfig((current) => ({
      ...current,
      soundshift: { ...current.soundshift, ...patch, cars: patch.cars ?? current.soundshift.cars }
    }))
  }

  function updateIncident(patch: Partial<IncidentSoundConfig>): void {
    setConfig((current) => ({ ...current, incident: { ...current.incident, ...patch } }))
  }

  function updateControl(id: 'abs' | 'tcs', patch: Partial<ControlAssistSoundConfig>): void {
    setConfig((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
  }

  function updateCar(carKey: string, patch: Partial<SoundshiftCarTuning>): void {
    const existing = config.soundshift.cars[carKey] ?? {
      carKey,
      carName: carKey === carKeyOf(live?.carName) ? live?.carName : undefined,
      thresholdPct: config.soundshift.defaultThresholdPct
    }
    // Spreading `patch` last lets an explicit `mode: undefined` clear the per-car pin (so the
    // car follows the global default); a patch that omits `mode` preserves the existing one.
    const nextCar: SoundshiftCarTuning = {
      ...existing,
      ...patch,
      carKey
    }
    updateSoundshift({ cars: { ...config.soundshift.cars, [carKey]: nextCar } })
  }

  function saveCar(car: SoundshiftCarTuning): void {
    const cars = { ...config.soundshift.cars, [car.carKey]: config.soundshift.cars[car.carKey] ?? car }
    void persist({ soundshift: { cars } }, `Saved tuning for ${cars[car.carKey]?.carName ?? car.carKey}.`)
  }

  async function testBeep(settings: SoundCueSettings): Promise<void> {
    try {
      ensureAudio()
      setAudioOutputDevice(config.outputDeviceId)
      await playBeep(settings.toneHz, settings.beepMs, settings.volume)
      showToast('Test beep sent to the selected output.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  return (
    <section style={shell}>
      <article style={{ ...panel, minHeight: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <span style={label}>Sounds · PC audio</span>
          <SectionExportImport sectionId="soundshift" label="SoundShift" onImported={() => void reloadConfig()} />
        </div>
        <h3 style={{ margin: '8px 0 4px', fontSize: 26 }}>Audio cues hub</h3>
        <p style={{ color: 'rgba(255,255,255,0.62)' }}>
          Configure Soundshift, incident, ABS and TCS cues. These app audio cues are generated in the renderer and routed to the selected output device.
        </p>

        <AudioOutputSelector
          busy={busy || audioBusy}
          devices={audioOutputs}
          outputDeviceId={config.outputDeviceId}
          status={audioOutputsStatus}
          onChange={changeOutputDevice}
          onRefresh={() => void refreshAudioOutputs(true)}
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, margin: '16px 0' }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{ ...ghostButton, background: activeTab === tab.id ? 'var(--accent-primary-dim)' : ghostButton.background, border: activeTab === tab.id ? '1px solid var(--accent-primary)' : ghostButton.border, color: activeTab === tab.id ? 'var(--accent-primary)' : ghostButton.color }}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'soundshift' ? (
          <SoundshiftPanel
            busy={busy}
            config={config.soundshift}
            live={live}
            onCommit={(patch, success) => void persist({ soundshift: patch }, success)}
            onLocalChange={updateSoundshift}
            onResetLearned={() => void resetLearned()}
            onTest={() => void testBeep(config.soundshift)}
          />
        ) : activeTab === 'incident' ? (
          <IncidentPanel
            busy={busy}
            config={config.incident}
            live={live}
            onCommit={(patch, success) => void persist({ incident: patch }, success)}
            onLocalChange={updateIncident}
            onTest={() => void testBeep(config.incident)}
          />
        ) : activeTab === 'abs' ? (
          <ControlPanel
            busy={busy}
            config={config.abs}
            id="abs"
            live={live}
            onCommit={(patch, success) => void persist({ abs: patch }, success)}
            onLocalChange={(patch) => updateControl('abs', patch)}
            onTest={() => void testBeep(config.abs)}
          />
        ) : (
          <ControlPanel
            busy={busy}
            config={config.tcs}
            id="tcs"
            live={live}
            onCommit={(patch, success) => void persist({ tcs: patch }, success)}
            onLocalChange={(patch) => updateControl('tcs', patch)}
            onTest={() => void testBeep(config.tcs)}
          />
        )}
      </article>

      <article style={panel}>
        <span style={label}>Live telemetry</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, margin: '10px 0 16px' }}>
          <LiveTile labelText="Car" value={live?.carName ?? '—'} />
          <LiveTile labelText="RPM" value={formatRpm(live?.rpm)} />
          <LiveTile labelText="Gear" value={live?.gear == null ? '—' : String(live.gear)} />
          <LiveTile labelText="Shift" value={formatPct(live?.shiftIndicatorPct)} />
          <LiveTile labelText="Incidents" value={live?.incidentCount == null ? '—' : String(live.incidentCount)} />
          <LiveTile labelText="ABS active" value={formatBool(live?.absActive)} />
          <LiveTile labelText="TC active" value={formatBool(live?.tcActive)} />
          <LiveTile labelText="Brake / throttle" value={`${formatPct(live?.brake)} / ${formatPct(live?.throttle)}`} />
        </div>

        {activeTab === 'soundshift' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {carRows.length === 0 ? (
              <div style={{ ...panel,  }}>
                Connect iRacing telemetry to create the first per-car tuning.
              </div>
            ) : (
              carRows.map((car) => (
                <CarTuningCard
                  car={car}
                  key={car.carKey}
                  onChange={(patch) => updateCar(car.carKey, patch)}
                  onSave={() => saveCar(car)}
                />
              ))
            )}
          </div>
        ) : (
          <AssistTelemetryNote tab={activeTab} live={live} />
        )}
      </article>
    </section>
  )
}

function AudioOutputSelector({
  busy,
  devices,
  outputDeviceId,
  status,
  onChange,
  onRefresh
}: {
  busy: boolean
  devices: AudioOutputOption[]
  outputDeviceId: string
  status: string
  onChange(outputDeviceId: string): void
  onRefresh(): void
}): ReactElement {
  const selectValue = normalizeDefaultOutputDevice(outputDeviceId)
  const selectedDeviceMissing =
    selectValue.length > 0 &&
    !devices.some((device) => normalizeDefaultOutputDevice(device.deviceId) === selectValue)
  const dedicatedDevices = devices.filter((device) => normalizeDefaultOutputDevice(device.deviceId).length > 0)

  return (
    <div style={{ border: '1px solid var(--border-accent)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', background: 'var(--surface-selected)', display: 'grid', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div>
          <span style={label}>Output device</span>
          <p style={{ color: 'rgba(255,255,255,0.58)', fontSize: 13, margin: '4px 0 0' }}>
            Routes this app's cue beeps only; it does not change game audio.
          </p>
        </div>
        <button disabled={busy} onClick={onRefresh} style={ghostButton} type="button">
          Refresh
        </button>
      </div>
      <select disabled={busy} onChange={(event) => onChange(event.target.value)} style={inputStyle} value={selectValue}>
        <option value="">System default</option>
        {selectedDeviceMissing ? <option value={selectValue}>Selected device unavailable</option> : null}
        {dedicatedDevices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label}
          </option>
        ))}
      </select>
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: 0 }}>
        {status} If device names are hidden, Refresh may request audio permission to unlock labels.
      </p>
    </div>
  )
}

function SoundshiftPanel({
  busy,
  config,
  live,
  onCommit,
  onLocalChange,
  onResetLearned,
  onTest
}: {
  busy: boolean
  config: SoundshiftConfig
  live: TelemetrySnapshot | null
  onCommit(patch: Partial<SoundshiftConfig>, success?: string): void
  onLocalChange(patch: Partial<SoundshiftConfig>): void
  onResetLearned(): void
  onTest(): void
}): ReactElement {
  const useIracingIndicator = config.defaultMode === 'shiftLight'
  // PlayerCarSLShiftRPM only comes from iRacing's real shift-light data, so it is a
  // reliable "the yes is providing its own shift signal" flag (unlike shiftIndicatorPct,
  // which falls back to a synthetic rpm/maxRpm proxy for dashboards).
  const iracingShiftRpm = live?.shiftRpm
  const iracingProvidingShift = iracingShiftRpm != null && iracingShiftRpm > 0
  const liveShiftPct = live?.shiftIndicatorPct
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <HeaderToggle
        busy={busy}
        enabled={config.enabled}
        title="Optimal shift beep"
        description="Beeps at the optimal shift point from iRacing's own shift indicator when available, or a learned/manual RPM target otherwise — with lead time and per-gear learning."
        onToggle={() => onCommit({ enabled: !config.enabled }, config.enabled ? 'Soundshift paused.' : 'Soundshift enabled.')}
      />
      <SoundFields config={config} onCommit={onCommit} onLocalChange={onLocalChange} />

      <div style={{ border: '1px solid var(--border-accent)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', background: 'var(--surface-selected)', display: 'grid', gap: 8 }}>
        <label style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', cursor: 'pointer' }}>
          <span style={{ fontWeight: 600 }}>Use iRacing shiftIndicatorPct when available</span>
          <input
            checked={useIracingIndicator}
            onChange={(event) => onCommit(
              { defaultMode: event.target.checked ? 'shiftLight' : 'rpm' },
              event.target.checked ? 'Soundshift using the iRacing shift indicator.' : 'Soundshift using learned/manual target RPM.'
            )}
            type="checkbox"
          />
        </label>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, margin: 0 }}>
          {useIracingIndicator
            ? 'The beep follows iRacing?s own shift light indicator (ShiftIndicatorPct ? threshold). When the sim does not provide that signal, it automatically falls back to the learned/manual target RPM by gear.'
            : 'The beep uses the learned/manual target RPM by gear. Enable this to prioritize the iRacing shift indicator when available.'}
        </p>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: 0 }}>
          {iracingProvidingShift
            ? `iRacing is providing a shift signal now · upshift ${formatRpm(iracingShiftRpm)} · indicator ${formatPct(liveShiftPct)}`
            : `No sim shift signal now ? would use the learned/manual target RPM${liveShiftPct != null ? ` (indicator ${formatPct(liveShiftPct)})` : ''}.`}
        </p>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <span>Auto-learn per gear</span>
          <input checked={config.autoLearn} onChange={(event) => onCommit({ autoLearn: event.target.checked })} type="checkbox" />
        </label>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>Clears the learned shift RPM by gear for all cars.</span>
          <button disabled={busy} onClick={onResetLearned} style={ghostButton} type="button">Reset learning</button>
        </div>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>Default mode</span>
          <select onChange={(event) => onCommit({ defaultMode: event.target.value as SoundshiftMode })} style={inputStyle} value={config.defaultMode}>
            <option value="exact">Exato no shift point</option>
            <option value="redlineOffset">Before redline (RPM offset)</option>
            <option value="shiftLight">iRacing shift indicator (shiftIndicatorPct)</option>
            <option value="rpm">Target / learned RPM</option>
          </select>
        </label>
        <NumberField labelText="Default threshold" min={0.5} max={1} step={0.01} value={config.defaultThresholdPct} onChange={(defaultThresholdPct) => onLocalChange({ defaultThresholdPct })} onCommit={() => onCommit({ defaultThresholdPct: config.defaultThresholdPct })} />
        <NumberField labelText="RPM before redline (offset)" min={0} max={2000} step={10} value={config.defaultShiftOffsetRpm} onChange={(defaultShiftOffsetRpm) => onLocalChange({ defaultShiftOffsetRpm })} onCommit={() => onCommit({ defaultShiftOffsetRpm: config.defaultShiftOffsetRpm })} />
      </div>
      <PanelButtons busy={busy} onSave={() => onCommit(config, 'Soundshift settings saved.')} onTest={onTest} />
    </div>
  )
}

function IncidentPanel({
  busy,
  config,
  live,
  onCommit,
  onLocalChange,
  onTest
}: {
  busy: boolean
  config: IncidentSoundConfig
  live: TelemetrySnapshot | null
  onCommit(patch: Partial<IncidentSoundConfig>, success?: string): void
  onLocalChange(patch: Partial<IncidentSoundConfig>): void
  onTest(): void
}): ReactElement {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <HeaderToggle
        busy={busy}
        enabled={config.enabled}
        title="Incident count increase"
        description="Beeps only when the iRacing incident count increases after the current count has been observed once."
        onToggle={() => onCommit({ enabled: !config.enabled }, config.enabled ? 'Incident cue paused.' : 'Incident cue enabled.')}
      />
      <SoundFields config={config} onCommit={onCommit} onLocalChange={onLocalChange} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        <NumberField labelText="Minimum delta" min={1} max={20} step={1} value={config.minDelta} onChange={(minDelta) => onLocalChange({ minDelta })} onCommit={() => onCommit({ minDelta: config.minDelta })} />
        <NumberField labelText="Cooldown (ms)" min={0} max={10000} step={100} value={config.cooldownMs} onChange={(cooldownMs) => onLocalChange({ cooldownMs })} onCommit={() => onCommit({ cooldownMs: config.cooldownMs })} />
      </div>
      <p style={{ color: 'rgba(255,255,255,0.58)', fontSize: 13, margin: 0 }}>
        Live incident count: {live?.incidentCount == null ? 'missing' : live.incidentCount}. Missing telemetry is treated as inactive.
      </p>
      <PanelButtons busy={busy} onSave={() => onCommit(config, 'Incident settings saved.')} onTest={onTest} />
    </div>
  )
}

function ControlPanel({
  busy,
  config,
  id,
  live,
  onCommit,
  onLocalChange,
  onTest
}: {
  busy: boolean
  config: ControlAssistSoundConfig
  id: 'abs' | 'tcs'
  live: TelemetrySnapshot | null
  onCommit(patch: Partial<ControlAssistSoundConfig>, success?: string): void
  onLocalChange(patch: Partial<ControlAssistSoundConfig>): void
  onTest(): void
}): ReactElement {
  const isAbs = id === 'abs'
  const decision = live ? (isAbs ? evaluateAbs(config, live) : evaluateTcs(config, live)) : null
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <HeaderToggle
        busy={busy}
        enabled={config.enabled}
        title={isAbs ? 'ABS engaging' : 'TCS in use'}
        description={isAbs ? 'Uses only absActive as a true intervention signal plus brake threshold. If the sim does not expose ABS activity, the cue stays quiet.' : 'Uses only tcActive as a true intervention signal plus throttle threshold. If the sim does not expose TC activity, the cue stays quiet.'}
        onToggle={() => onCommit({ enabled: !config.enabled }, config.enabled ? `${id.toUpperCase()} cue paused.` : `${id.toUpperCase()} cue enabled.`)}
      />
      <SoundFields config={config} onCommit={onCommit} onLocalChange={onLocalChange} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        <NumberField labelText={isAbs ? 'Brake threshold' : 'Throttle threshold'} min={0} max={1} step={0.01} value={config.inputThreshold} onChange={(inputThreshold) => onLocalChange({ inputThreshold })} onCommit={() => onCommit({ inputThreshold: config.inputThreshold })} />
        <NumberField labelText={isAbs ? 'Repeat interval (ms)' : 'Cooldown (ms)'} min={75} max={5000} step={25} value={config.repeatMs} onChange={(repeatMs) => onLocalChange({ repeatMs })} onCommit={() => onCommit({ repeatMs: config.repeatMs })} />
      </div>
      {isAbs ? (
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>Trigger mode</span>
          <select onChange={(event) => onCommit({ triggerMode: event.target.value as ControlTriggerMode })} style={inputStyle} value={config.triggerMode}>
            <option value="start">Only when engagement starts</option>
            <option value="repeat">Repeat while engaging</option>
          </select>
        </label>
      ) : (
        <p style={{ color: 'rgba(255,255,255,0.58)', fontSize: 13, margin: 0 }}>
          TCS is edge-triggered only: one beep when intervention starts, then the cooldown prevents repeat spam.
        </p>
      )}
      <p style={{ color: 'rgba(255,255,255,0.58)', fontSize: 13, margin: 0 }}>
        Current decision: {decision ? `${decision.engaging ? 'engaging' : 'inactive'} (${decision.reason})` : 'waiting for telemetry'}.
      </p>
      <PanelButtons busy={busy} onSave={() => onCommit(config, `${id.toUpperCase()} settings saved.`)} onTest={onTest} />
    </div>
  )
}

function SoundFields<T extends SoundCueSettings>({
  config,
  onCommit,
  onLocalChange
}: {
  config: T
  onCommit(patch: Partial<T>): void
  onLocalChange(patch: Partial<T>): void
}): ReactElement {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={label}>Tone choice</span>
        <select onChange={(event) => onCommit({ toneHz: Number(event.target.value) } as Partial<T>)} style={inputStyle} value={nearestTone(config.toneHz)}>
          <option value={520}>Low beep · 520 Hz</option>
          <option value={660}>Medium beep · 660 Hz</option>
          <option value={880}>High beep · 880 Hz</option>
          <option value={1320}>Shift beep · 1320 Hz</option>
        </select>
      </label>
      <NumberField labelText="Custom tone (Hz)" min={120} max={6000} step={10} value={config.toneHz} onChange={(toneHz) => onLocalChange({ toneHz } as Partial<T>)} onCommit={() => onCommit({ toneHz: config.toneHz } as Partial<T>)} />
      <NumberField labelText="Volume" min={0} max={1} step={0.05} value={config.volume} onChange={(volume) => onLocalChange({ volume } as Partial<T>)} onCommit={() => onCommit({ volume: config.volume } as Partial<T>)} />
      <NumberField labelText="Duration (ms)" min={20} max={500} step={5} value={config.beepMs} onChange={(beepMs) => onLocalChange({ beepMs } as Partial<T>)} onCommit={() => onCommit({ beepMs: config.beepMs } as Partial<T>)} />
      {'leadMs' in config ? <NumberField labelText="Lead (ms)" min={0} max={1000} step={10} value={config.leadMs as number} onChange={(leadMs) => onLocalChange({ leadMs } as unknown as Partial<T>)} onCommit={() => onCommit({ leadMs: config.leadMs } as unknown as Partial<T>)} /> : null}
    </div>
  )
}

function HeaderToggle({
  busy,
  description,
  enabled,
  onToggle,
  title
}: {
  busy: boolean
  description: string
  enabled: boolean
  onToggle(): void
  title: string
}): ReactElement {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
      <div>
        <h4 style={{ margin: '0 0 4px', fontSize: 20 }}>{title}</h4>
        <p style={{ color: 'rgba(255,255,255,0.62)', margin: 0 }}>{description}</p>
      </div>
      <button disabled={busy} onClick={onToggle} style={{ ...primaryButton, background: enabled ? 'var(--accent-danger)' : 'var(--accent-primary)', color: 'var(--text-on-accent)' }} type="button">
        {enabled ? 'Pause' : 'Enable'}
      </button>
    </div>
  )
}

function PanelButtons({ busy, onSave, onTest }: { busy: boolean; onSave(): void; onTest(): void }): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
      <button onClick={onTest} style={ghostButton} type="button">Test beep</button>
      <button disabled={busy} onClick={onSave} style={ghostButton} type="button">Save all</button>
    </div>
  )
}

function nearestTone(toneHz: number): number {
  const choices = [520, 660, 880, 1320]
  return choices.reduce((best, current) => Math.abs(current - toneHz) < Math.abs(best - toneHz) ? current : best, choices[0])
}

function NumberField({
  labelText,
  min,
  max,
  step,
  value,
  onChange,
  onCommit
}: {
  labelText: string
  min: number
  max: number
  step: number
  value: number
  onChange(value: number): void
  onCommit(): void
}): ReactElement {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={label}>{labelText}</span>
      <input max={max} min={min} onBlur={onCommit} onChange={(event) => onChange(Number(event.target.value))} step={step} style={inputStyle} type="number" value={Number.isFinite(value) ? value : min} />
    </label>
  )
}

function LiveTile({ labelText, value }: { labelText: string; value: string }): ReactElement {
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-sm)', padding: 12, background: 'rgba(255,255,255,0.035)' }}>
      <span style={label}>{labelText}</span>
      <strong style={{ display: 'block', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</strong>
    </div>
  )
}

function AssistTelemetryNote({ tab, live }: { tab: SoundsTab; live: TelemetrySnapshot | null }): ReactElement {
  const text = tab === 'incident'
    ? 'Incident cue relies on incidentCount increasing. Missing incidentCount is inactive.'
    : tab === 'abs'
      ? 'ABS cue relies on the sim exposing absActive as actual intervention. Missing ABS activity stays quiet rather than beeping from an enabled state.'
      : 'TCS cue relies on the sim exposing tcActive as actual intervention. Missing TC activity stays quiet rather than beeping from an enabled/toggle state.'
  return (
    <div style={{ ...panel,  }}>
      <strong>{live?.connected ? 'Telemetry connected' : 'Waiting for telemetry'}</strong>
      <p style={{ color: 'rgba(255,255,255,0.62)', marginBottom: 0 }}>{text}</p>
    </div>
  )
}

function CarTuningCard({
  car,
  onChange,
  onSave
}: {
  car: SoundshiftCarTuning
  onChange(patch: Partial<SoundshiftCarTuning>): void
  onSave(): void
}): ReactElement {
  const learnedEntries = Object.entries(car.learnedUpshiftRpmByGear ?? {}).sort(([a], [b]) => Number(a) - Number(b))
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.04)', padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <strong>{car.carName ?? car.carKey}</strong>
          <p style={{ marginTop: 4, color: 'rgba(255,255,255,0.56)', fontSize: 12 }}>{car.carKey}</p>
        </div>
        <button onClick={onSave} style={ghostButton} type="button">Save car</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 12 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>Mode</span>
          <select
            onChange={(event) => onChange({ mode: event.target.value === '' ? undefined : (event.target.value as SoundshiftMode) })}
            style={inputStyle}
            value={car.mode ?? ''}
          >
            <option value="">Follow global default</option>
            <option value="exact">Exato no shift point</option>
            <option value="redlineOffset">Before redline</option>
            <option value="shiftLight">Shift light</option>
            <option value="rpm">RPM</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>Target RPM</span>
          <input onChange={(event) => onChange({ targetRpm: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="auto" style={inputStyle} type="number" value={car.targetRpm ?? ''} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>Threshold</span>
          <input max={1} min={0.5} onChange={(event) => onChange({ thresholdPct: Number(event.target.value) })} step={0.01} style={inputStyle} type="number" value={car.thresholdPct ?? ''} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>RPM before redline</span>
          <input max={2000} min={0} onChange={(event) => onChange({ shiftOffsetRpm: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="auto" step={10} style={inputStyle} type="number" value={car.shiftOffsetRpm ?? ''} />
        </label>
      </div>

      <div style={{ marginTop: 12 }}>
        <span style={label}>Learned RPM per gear</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {learnedEntries.length === 0 ? (
            <span style={{ color: 'rgba(255,255,255,0.56)', fontSize: 13 }}>No samples yet.</span>
          ) : (
            learnedEntries.map(([gear, rpm]) => (
              <span className="muted-pill" key={gear}>G{gear}: {Number(rpm).toLocaleString('pt-BR')} rpm</span>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default SoundsView
