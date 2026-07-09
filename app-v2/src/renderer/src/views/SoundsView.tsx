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
import { tt, type ResolvedLanguage } from '../i18n'

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

const tabs: Array<{ id: SoundsTab; labelKey: string; descriptionKey: string }> = [
  { id: 'soundshift', labelKey: 'sounds.tab.soundshift', descriptionKey: 'sounds.tab.soundshift.description' },
  { id: 'incident', labelKey: 'sounds.tab.incident', descriptionKey: 'sounds.tab.incident.description' },
  { id: 'abs', labelKey: 'sounds.tab.abs', descriptionKey: 'sounds.tab.abs.description' },
  { id: 'tcs', labelKey: 'sounds.tab.tcs', descriptionKey: 'sounds.tab.tcs.description' }
]

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatPct(value: number | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}

function localeOf(language: ResolvedLanguage | undefined): string {
  return language === 'pt-BR' ? 'pt-BR' : language ?? 'en'
}

function formatRpm(value: number | undefined, language?: ResolvedLanguage): string {
  return value == null || value <= 0 ? '—' : `${Math.round(value).toLocaleString(localeOf(language))} rpm`
}

function formatBool(value: boolean | undefined, language?: ResolvedLanguage): string {
  if (value == null) return tt(language, 'sounds.value.missing')
  return value ? tt(language, 'common.yes') : tt(language, 'common.no')
}

function normalizeDefaultOutputDevice(deviceId: string): string {
  return deviceId === 'default' ? '' : deviceId
}

const SoundsView: ComponentType<AppViewProps> = ({ showToast, language }): ReactElement => {
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
      showToast(tt(language, 'sounds.toast.learningReset'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  function changeOutputDevice(outputDeviceId: string): void {
    setAudioOutputDevice(outputDeviceId)
    setConfig((current) => ({ ...current, outputDeviceId }))
    void persist({ outputDeviceId }, outputDeviceId ? tt(language, 'sounds.toast.outputSelected') : tt(language, 'sounds.toast.outputDefault'))
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
    void persist({ soundshift: { cars } }, tt(language, 'sounds.toast.carSaved', { car: cars[car.carKey]?.carName ?? car.carKey }))
  }

  async function testBeep(settings: SoundCueSettings): Promise<void> {
    try {
      ensureAudio()
      setAudioOutputDevice(config.outputDeviceId)
      await playBeep(settings.toneHz, settings.beepMs, settings.volume)
      showToast(tt(language, 'sounds.toast.testBeep'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  return (
    <section style={shell}>
      <article style={{ ...panel, minHeight: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <span style={label}>{tt(language, 'sounds.eyebrow')}</span>
          <SectionExportImport sectionId="soundshift" label={tt(language, 'sounds.exportLabel')} language={language} onImported={() => void reloadConfig()} />
        </div>
        <h3 style={{ margin: '8px 0 4px', fontSize: 26 }}>{tt(language, 'sounds.title')}</h3>
        <p style={{ color: 'rgba(255,255,255,0.62)' }}>
          {tt(language, 'sounds.summary')}
        </p>

        <AudioOutputSelector
          busy={busy || audioBusy}
          devices={audioOutputs}
          outputDeviceId={config.outputDeviceId}
          status={audioOutputsStatus}
          onChange={changeOutputDevice}
          onRefresh={() => void refreshAudioOutputs(true)}
          language={language}
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, margin: '16px 0' }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{ ...ghostButton, background: activeTab === tab.id ? 'var(--accent-primary-dim)' : ghostButton.background, border: activeTab === tab.id ? '1px solid var(--accent-primary)' : ghostButton.border, color: activeTab === tab.id ? 'var(--accent-primary)' : ghostButton.color }}
              title={tt(language, tab.descriptionKey)}
              type="button"
            >
              {tt(language, tab.labelKey)}
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
            language={language}
          />
        ) : activeTab === 'incident' ? (
          <IncidentPanel
            busy={busy}
            config={config.incident}
            live={live}
            onCommit={(patch, success) => void persist({ incident: patch }, success)}
            onLocalChange={updateIncident}
            onTest={() => void testBeep(config.incident)}
            language={language}
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
            language={language}
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
            language={language}
          />
        )}
      </article>

      <article style={panel}>
        <span style={label}>{tt(language, 'sounds.liveTelemetry')}</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, margin: '10px 0 16px' }}>
          <LiveTile labelText={tt(language, 'sounds.live.car')} value={live?.carName ?? '—'} />
          <LiveTile labelText="RPM" value={formatRpm(live?.rpm, language)} />
          <LiveTile labelText={tt(language, 'sounds.live.gear')} value={live?.gear == null ? '—' : String(live.gear)} />
          <LiveTile labelText={tt(language, 'sounds.live.shift')} value={formatPct(live?.shiftIndicatorPct)} />
          <LiveTile labelText={tt(language, 'sounds.live.incidents')} value={live?.incidentCount == null ? '—' : String(live.incidentCount)} />
          <LiveTile labelText={tt(language, 'sounds.live.absActive')} value={formatBool(live?.absActive, language)} />
          <LiveTile labelText={tt(language, 'sounds.live.tcActive')} value={formatBool(live?.tcActive, language)} />
          <LiveTile labelText={tt(language, 'sounds.live.brakeThrottle')} value={`${formatPct(live?.brake)} / ${formatPct(live?.throttle)}`} />
        </div>

        {activeTab === 'soundshift' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {carRows.length === 0 ? (
              <div style={{ ...panel,  }}>
                {tt(language, 'sounds.car.empty')}
              </div>
            ) : (
              carRows.map((car) => (
                <CarTuningCard
                  car={car}
                  key={car.carKey}
                  onChange={(patch) => updateCar(car.carKey, patch)}
                  onSave={() => saveCar(car)}
                  language={language}
                />
              ))
            )}
          </div>
        ) : (
          <AssistTelemetryNote tab={activeTab} live={live} language={language} />
        )}
      </article>
    </section>
  )
}

function AudioOutputSelector({
  busy,
  devices,
  language,
  outputDeviceId,
  status,
  onChange,
  onRefresh
}: {
  busy: boolean
  devices: AudioOutputOption[]
  language?: ResolvedLanguage
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
          <span style={label}>{tt(language, 'sounds.outputDevice')}</span>
          <p style={{ color: 'rgba(255,255,255,0.58)', fontSize: 13, margin: '4px 0 0' }}>
            {tt(language, 'sounds.outputHelp')}
          </p>
        </div>
        <button disabled={busy} onClick={onRefresh} style={ghostButton} type="button">
          {tt(language, 'common.refresh')}
        </button>
      </div>
      <select disabled={busy} onChange={(event) => onChange(event.target.value)} style={inputStyle} value={selectValue}>
        <option value="">{tt(language, 'sounds.systemDefault')}</option>
        {selectedDeviceMissing ? <option value={selectValue}>{tt(language, 'sounds.deviceUnavailable')}</option> : null}
        {dedicatedDevices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label}
          </option>
        ))}
      </select>
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: 0 }}>
        {tt(language, 'sounds.outputStatusHelp', { status })}
      </p>
    </div>
  )
}

function SoundshiftPanel({
  busy,
  config,
  language,
  live,
  onCommit,
  onLocalChange,
  onResetLearned,
  onTest
}: {
  busy: boolean
  config: SoundshiftConfig
  language?: ResolvedLanguage
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
        title={tt(language, 'sounds.soundshift.title')}
        description={tt(language, 'sounds.soundshift.description')}
        onToggle={() => onCommit({ enabled: !config.enabled }, config.enabled ? tt(language, 'sounds.toast.soundshiftPaused') : tt(language, 'sounds.toast.soundshiftEnabled'))}
        language={language}
      />
      <SoundFields config={config} language={language} onCommit={onCommit} onLocalChange={onLocalChange} />

      <div style={{ border: '1px solid var(--border-accent)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', background: 'var(--surface-selected)', display: 'grid', gap: 8 }}>
        <label style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', cursor: 'pointer' }}>
          <span style={{ fontWeight: 600 }}>{tt(language, 'sounds.soundshift.useIracing')}</span>
          <input
            checked={useIracingIndicator}
            onChange={(event) => onCommit(
              { defaultMode: event.target.checked ? 'shiftLight' : 'rpm' },
              event.target.checked ? tt(language, 'sounds.toast.soundshiftIracing') : tt(language, 'sounds.toast.soundshiftLearned')
            )}
            type="checkbox"
          />
        </label>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, margin: 0 }}>
          {useIracingIndicator
            ? tt(language, 'sounds.soundshift.iracingHelp')
            : tt(language, 'sounds.soundshift.learnedHelp')}
        </p>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: 0 }}>
          {iracingProvidingShift
            ? tt(language, 'sounds.soundshift.signalNow', { rpm: formatRpm(iracingShiftRpm, language), pct: formatPct(liveShiftPct) })
            : tt(language, liveShiftPct != null ? 'sounds.soundshift.noSignalWithIndicator' : 'sounds.soundshift.noSignal', { pct: formatPct(liveShiftPct) })}
        </p>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <span>{tt(language, 'sounds.soundshift.autoLearn')}</span>
          <input checked={config.autoLearn} onChange={(event) => onCommit({ autoLearn: event.target.checked })} type="checkbox" />
        </label>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>{tt(language, 'sounds.soundshift.resetHelp')}</span>
          <button disabled={busy} onClick={onResetLearned} style={ghostButton} type="button">{tt(language, 'sounds.soundshift.resetLearning')}</button>
        </div>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>{tt(language, 'sounds.soundshift.defaultMode')}</span>
          <select onChange={(event) => onCommit({ defaultMode: event.target.value as SoundshiftMode })} style={inputStyle} value={config.defaultMode}>
            <option value="exact">{tt(language, 'sounds.mode.exact')}</option>
            <option value="redlineOffset">{tt(language, 'sounds.mode.redlineOffsetLong')}</option>
            <option value="shiftLight">{tt(language, 'sounds.mode.shiftLightLong')}</option>
            <option value="rpm">{tt(language, 'sounds.mode.rpmLong')}</option>
          </select>
        </label>
        <NumberField labelText={tt(language, 'sounds.defaultThreshold')} min={0.5} max={1} step={0.01} value={config.defaultThresholdPct} onChange={(defaultThresholdPct) => onLocalChange({ defaultThresholdPct })} onCommit={() => onCommit({ defaultThresholdPct: config.defaultThresholdPct })} />
        <NumberField labelText={tt(language, 'sounds.rpmBeforeRedlineOffset')} min={0} max={2000} step={10} value={config.defaultShiftOffsetRpm} onChange={(defaultShiftOffsetRpm) => onLocalChange({ defaultShiftOffsetRpm })} onCommit={() => onCommit({ defaultShiftOffsetRpm: config.defaultShiftOffsetRpm })} />
      </div>
      <PanelButtons busy={busy} language={language} onSave={() => onCommit(config, tt(language, 'sounds.toast.soundshiftSaved'))} onTest={onTest} />
    </div>
  )
}

function IncidentPanel({
  busy,
  config,
  language,
  live,
  onCommit,
  onLocalChange,
  onTest
}: {
  busy: boolean
  config: IncidentSoundConfig
  language?: ResolvedLanguage
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
        title={tt(language, 'sounds.incident.title')}
        description={tt(language, 'sounds.incident.description')}
        onToggle={() => onCommit({ enabled: !config.enabled }, config.enabled ? tt(language, 'sounds.toast.incidentPaused') : tt(language, 'sounds.toast.incidentEnabled'))}
        language={language}
      />
      <SoundFields config={config} language={language} onCommit={onCommit} onLocalChange={onLocalChange} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        <NumberField labelText={tt(language, 'sounds.minimumDelta')} min={1} max={20} step={1} value={config.minDelta} onChange={(minDelta) => onLocalChange({ minDelta })} onCommit={() => onCommit({ minDelta: config.minDelta })} />
        <NumberField labelText={tt(language, 'sounds.cooldownMs')} min={0} max={10000} step={100} value={config.cooldownMs} onChange={(cooldownMs) => onLocalChange({ cooldownMs })} onCommit={() => onCommit({ cooldownMs: config.cooldownMs })} />
      </div>
      <p style={{ color: 'rgba(255,255,255,0.58)', fontSize: 13, margin: 0 }}>
        {tt(language, 'sounds.incident.liveCount', { count: live?.incidentCount == null ? tt(language, 'sounds.value.missing') : live.incidentCount })}
      </p>
      <PanelButtons busy={busy} language={language} onSave={() => onCommit(config, tt(language, 'sounds.toast.incidentSaved'))} onTest={onTest} />
    </div>
  )
}

function ControlPanel({
  busy,
  config,
  id,
  language,
  live,
  onCommit,
  onLocalChange,
  onTest
}: {
  busy: boolean
  config: ControlAssistSoundConfig
  id: 'abs' | 'tcs'
  language?: ResolvedLanguage
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
        title={tt(language, isAbs ? 'sounds.abs.title' : 'sounds.tcs.title')}
        description={tt(language, isAbs ? 'sounds.abs.description' : 'sounds.tcs.description')}
        onToggle={() => onCommit({ enabled: !config.enabled }, config.enabled ? tt(language, 'sounds.toast.controlPaused', { cue: id.toUpperCase() }) : tt(language, 'sounds.toast.controlEnabled', { cue: id.toUpperCase() }))}
        language={language}
      />
      <SoundFields config={config} language={language} onCommit={onCommit} onLocalChange={onLocalChange} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        <NumberField labelText={tt(language, isAbs ? 'sounds.brakeThreshold' : 'sounds.throttleThreshold')} min={0} max={1} step={0.01} value={config.inputThreshold} onChange={(inputThreshold) => onLocalChange({ inputThreshold })} onCommit={() => onCommit({ inputThreshold: config.inputThreshold })} />
        <NumberField labelText={tt(language, isAbs ? 'sounds.repeatIntervalMs' : 'sounds.cooldownMs')} min={75} max={5000} step={25} value={config.repeatMs} onChange={(repeatMs) => onLocalChange({ repeatMs })} onCommit={() => onCommit({ repeatMs: config.repeatMs })} />
      </div>
      {isAbs ? (
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>{tt(language, 'sounds.triggerMode')}</span>
          <select onChange={(event) => onCommit({ triggerMode: event.target.value as ControlTriggerMode })} style={inputStyle} value={config.triggerMode}>
            <option value="start">{tt(language, 'sounds.trigger.start')}</option>
            <option value="repeat">{tt(language, 'sounds.trigger.repeat')}</option>
          </select>
        </label>
      ) : (
        <p style={{ color: 'rgba(255,255,255,0.58)', fontSize: 13, margin: 0 }}>
          {tt(language, 'sounds.tcs.edgeHelp')}
        </p>
      )}
      <p style={{ color: 'rgba(255,255,255,0.58)', fontSize: 13, margin: 0 }}>
        {decision
          ? tt(language, 'sounds.currentDecisionWithReason', { state: tt(language, decision.engaging ? 'sounds.decision.engaging' : 'sounds.decision.inactive'), reason: decision.reason })
          : tt(language, 'sounds.currentDecisionWaiting')}
      </p>
      <PanelButtons busy={busy} language={language} onSave={() => onCommit(config, tt(language, 'sounds.toast.controlSaved', { cue: id.toUpperCase() }))} onTest={onTest} />
    </div>
  )
}

function SoundFields<T extends SoundCueSettings>({
  config,
  language,
  onCommit,
  onLocalChange
}: {
  config: T
  language?: ResolvedLanguage
  onCommit(patch: Partial<T>): void
  onLocalChange(patch: Partial<T>): void
}): ReactElement {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={label}>{tt(language, 'sounds.toneChoice')}</span>
        <select onChange={(event) => onCommit({ toneHz: Number(event.target.value) } as Partial<T>)} style={inputStyle} value={nearestTone(config.toneHz)}>
          <option value={520}>{tt(language, 'sounds.tone.low')}</option>
          <option value={660}>{tt(language, 'sounds.tone.medium')}</option>
          <option value={880}>{tt(language, 'sounds.tone.high')}</option>
          <option value={1320}>{tt(language, 'sounds.tone.shift')}</option>
        </select>
      </label>
      <NumberField labelText={tt(language, 'sounds.customToneHz')} min={120} max={6000} step={10} value={config.toneHz} onChange={(toneHz) => onLocalChange({ toneHz } as Partial<T>)} onCommit={() => onCommit({ toneHz: config.toneHz } as Partial<T>)} />
      <NumberField labelText={tt(language, 'sounds.volume')} min={0} max={1} step={0.05} value={config.volume} onChange={(volume) => onLocalChange({ volume } as Partial<T>)} onCommit={() => onCommit({ volume: config.volume } as Partial<T>)} />
      <NumberField labelText={tt(language, 'sounds.durationMs')} min={20} max={500} step={5} value={config.beepMs} onChange={(beepMs) => onLocalChange({ beepMs } as Partial<T>)} onCommit={() => onCommit({ beepMs: config.beepMs } as Partial<T>)} />
      {'leadMs' in config ? <NumberField labelText={tt(language, 'sounds.leadMs')} min={0} max={1000} step={10} value={config.leadMs as number} onChange={(leadMs) => onLocalChange({ leadMs } as unknown as Partial<T>)} onCommit={() => onCommit({ leadMs: config.leadMs } as unknown as Partial<T>)} /> : null}
    </div>
  )
}

function HeaderToggle({
  busy,
  description,
  enabled,
  language,
  onToggle,
  title
}: {
  busy: boolean
  description: string
  enabled: boolean
  language?: ResolvedLanguage
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
        {enabled ? tt(language, 'common.pause') : tt(language, 'common.enable')}
      </button>
    </div>
  )
}

function PanelButtons({ busy, language, onSave, onTest }: { busy: boolean; language?: ResolvedLanguage; onSave(): void; onTest(): void }): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
      <button onClick={onTest} style={ghostButton} type="button">{tt(language, 'sounds.testBeep')}</button>
      <button disabled={busy} onClick={onSave} style={ghostButton} type="button">{tt(language, 'common.saveAll')}</button>
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

function AssistTelemetryNote({ tab, live, language }: { tab: SoundsTab; live: TelemetrySnapshot | null; language?: ResolvedLanguage }): ReactElement {
  const text = tab === 'incident'
    ? tt(language, 'sounds.assist.incident')
    : tab === 'abs'
      ? tt(language, 'sounds.assist.abs')
      : tt(language, 'sounds.assist.tcs')
  return (
    <div style={{ ...panel,  }}>
      <strong>{live?.connected ? tt(language, 'sounds.telemetryConnected') : tt(language, 'sounds.telemetryWaiting')}</strong>
      <p style={{ color: 'rgba(255,255,255,0.62)', marginBottom: 0 }}>{text}</p>
    </div>
  )
}

function CarTuningCard({
  car,
  language,
  onChange,
  onSave
}: {
  car: SoundshiftCarTuning
  language?: ResolvedLanguage
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
        <button onClick={onSave} style={ghostButton} type="button">{tt(language, 'sounds.car.save')}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 12 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>{tt(language, 'sounds.car.mode')}</span>
          <select
            onChange={(event) => onChange({ mode: event.target.value === '' ? undefined : (event.target.value as SoundshiftMode) })}
            style={inputStyle}
            value={car.mode ?? ''}
          >
            <option value="">{tt(language, 'sounds.mode.followGlobal')}</option>
            <option value="exact">{tt(language, 'sounds.mode.exact')}</option>
            <option value="redlineOffset">{tt(language, 'sounds.mode.redlineOffset')}</option>
            <option value="shiftLight">{tt(language, 'sounds.mode.shiftLight')}</option>
            <option value="rpm">RPM</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>{tt(language, 'sounds.targetRpm')}</span>
          <input onChange={(event) => onChange({ targetRpm: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder={tt(language, 'common.auto')} style={inputStyle} type="number" value={car.targetRpm ?? ''} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>{tt(language, 'sounds.threshold')}</span>
          <input max={1} min={0.5} onChange={(event) => onChange({ thresholdPct: Number(event.target.value) })} step={0.01} style={inputStyle} type="number" value={car.thresholdPct ?? ''} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>{tt(language, 'sounds.rpmBeforeRedline')}</span>
          <input max={2000} min={0} onChange={(event) => onChange({ shiftOffsetRpm: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder={tt(language, 'common.auto')} step={10} style={inputStyle} type="number" value={car.shiftOffsetRpm ?? ''} />
        </label>
      </div>

      <div style={{ marginTop: 12 }}>
        <span style={label}>{tt(language, 'sounds.learnedRpmPerGear')}</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {learnedEntries.length === 0 ? (
            <span style={{ color: 'rgba(255,255,255,0.56)', fontSize: 13 }}>{tt(language, 'sounds.noSamples')}</span>
          ) : (
            learnedEntries.map(([gear, rpm]) => (
              <span className="muted-pill" key={gear}>{tt(language, 'sounds.gearShort', { gear })}: {Number(rpm).toLocaleString(localeOf(language))} rpm</span>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default SoundsView
