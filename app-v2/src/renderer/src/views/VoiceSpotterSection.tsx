import { type CSSProperties, type ReactElement, useEffect, useMemo, useState } from 'react'
import type { AppViewProps } from '../App'
import { SectionExportImport } from '../components/SectionExportImport'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import {
  CALLOUT_CATALOG,
  CATEGORY_LABELS,
  DEFAULT_SPOTTER_CONFIG,
  SPOTTER_CHANNELS,
  type CalloutCategory,
  type CalloutConfig,
  type CalloutId,
  type SpotterConfig,
  type SpotterConfigPatch,
  type SpotterLang,
  type SpotterThresholds
} from '../../../shared/spotter'
import {
  type SpotterLogEntry,
  type UnifiedVoice,
  getSpotterVoices,
  getUnifiedVoices,
  subscribeSpotterLog,
  subscribeUnifiedVoices,
  testCallout,
  testSpotterVoice,
  useSpotterRuntime
} from '../lib/spotter-runtime'
import { useDevices } from '../lib/devices/DeviceRegistry'
import { tt } from '../i18n'
import { useUnitSystem } from '../lib/units'
import { feetToMeters, formatMeasurement, mphToKmh } from '../../../shared/units'

const shell: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(360px, 1.15fr) minmax(320px, 0.85fr)',
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
  height: 34
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
  letterSpacing: '0.06em'
}

const rangeStyle: CSSProperties = {
  width: '100%',
  accentColor: 'var(--accent-primary)',
  cursor: 'pointer'
}

const CATEGORY_ORDER: CalloutCategory[] = ['flags', 'fuel', 'pit', 'proximity', 'incidents', 'shift', 'lap']

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatSec(value: number | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}s`
}

function lapsOfFuel(live: TelemetrySnapshot | null): number | undefined {
  if (!live) return undefined
  const fuel = live.fuelLiters
  const per = live.fuelPerLap
  if (fuel == null || per == null || per <= 0) return undefined
  return fuel / per
}

function activeFlags(live: TelemetrySnapshot | null, language: AppViewProps['language']): string {
  const flags = live?.flags
  if (!flags) return '—'
  const names: string[] = []
  if (flags.green) names.push(tt(language, 'spotter.flag.green'))
  if (flags.yellow) names.push(tt(language, 'spotter.flag.yellow'))
  if (flags.blue) names.push(tt(language, 'spotter.flag.blue'))
  if (flags.white) names.push(tt(language, 'spotter.flag.white'))
  if (flags.checkered) names.push(tt(language, 'spotter.flag.checkered'))
  if (flags.meatball) names.push('meatball')
  if (flags.black) names.push(tt(language, 'spotter.flag.black'))
  return names.length ? names.join(', ') : tt(language, 'common.none')
}

// Voice Spotter / Warnings falados — absorbed into AI Engineer (the single VOICE
// hub). This renders the spotter's config + controls (voice selection, callout
// toggles, telemetry-driven spoken-callout settings). The spotter RUNTIME stays
// globally mounted in App.tsx; the hook below is ref-counted so co-mounting here
// is a no-op driver (no double-speak — see spotter-runtime.ts).
export function VoiceSpotterSection({ showToast, language }: Pick<AppViewProps, 'showToast' | 'language'>): ReactElement {
  const unitSystem = useUnitSystem()
  // Drive the engine while this section is open. The hook is ref-counted + backed
  // by a module singleton, so this co-exists with the App-root mount without
  // any double-speak (see spotter-runtime.ts).
  useSpotterRuntime()

  const { audioOutputs, audioOutputsStatus, audioBusy, refreshAudioOutputs } = useDevices()
  const [config, setConfig] = useState<SpotterConfig>(DEFAULT_SPOTTER_CONFIG)
  const [live, setLive] = useState<TelemetrySnapshot | null>(null)
  const [voices, setVoices] = useState<UnifiedVoice[]>(() => getUnifiedVoices())
  const [log, setLog] = useState<SpotterLogEntry[]>([])
  const [activeCategory, setActiveCategory] = useState<CalloutCategory>('flags')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.ipc
      .invoke<SpotterConfig>(SPOTTER_CHANNELS.getConfig)
      .then(setConfig)
      .catch((error) => showToast(getErrorMessage(error), 'error'))

    const offConfig = window.ipc.subscribe<SpotterConfig>(SPOTTER_CHANNELS.configEvent, setConfig)
    const offTelemetry = window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', setLive)
    const offVoices = subscribeUnifiedVoices(setVoices)
    const offLog = subscribeSpotterLog(setLog)
    void refreshAudioOutputs(false)
    return () => {
      offConfig()
      offTelemetry()
      offVoices()
      offLog()
    }
  }, [showToast, refreshAudioOutputs])

  async function persist(patch: SpotterConfigPatch, success?: string): Promise<void> {
    setBusy(true)
    try {
      const saved = await window.ipc.invoke<SpotterConfig>(SPOTTER_CHANNELS.setConfig, patch)
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
      const loaded = await window.ipc.invoke<SpotterConfig>(SPOTTER_CHANNELS.getConfig)
      setConfig(loaded)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  function updateCalloutLocal(id: CalloutId, patch: Partial<CalloutConfig>): void {
    setConfig((current) => ({
      ...current,
      callouts: { ...current.callouts, [id]: { ...current.callouts[id], ...patch } }
    }))
  }

  function commitCallout(id: CalloutId, patch: Partial<CalloutConfig>, success?: string): void {
    void persist({ callouts: { [id]: patch } as Partial<Record<CalloutId, Partial<CalloutConfig>>> }, success)
  }

  function updateThresholdLocal(patch: Partial<SpotterThresholds>): void {
    setConfig((current) => ({ ...current, thresholds: { ...current.thresholds, ...patch } }))
  }

  const categoryCallouts = useMemo(
    () => CALLOUT_CATALOG.filter((meta) => meta.category === activeCategory),
    [activeCategory]
  )

  const enabledCount = useMemo(
    () => CALLOUT_CATALOG.reduce((total, meta) => total + (config.callouts[meta.id]?.enabled ? 1 : 0), 0),
    [config.callouts]
  )

  return (
    <section style={shell}>
      <article style={{ ...panel, minHeight: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <span style={label}>{tt(language, 'spotter.eyebrow')}</span>
          <SectionExportImport sectionId="spotter" label={tt(language, 'spotter.exportLabel')} onImported={() => void reloadConfig()} />
        </div>
        <h3 style={{ margin: '8px 0 4px', fontSize: 26 }}>{tt(language, 'spotter.title')}</h3>
        <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
          {tt(language, 'spotter.help', { enabled: enabledCount, total: CALLOUT_CATALOG.length })}
        </p>

        <MasterControls
          audioOutputs={audioOutputs}
          audioOutputsStatus={audioOutputsStatus}
          audioBusy={audioBusy}
          busy={busy}
          config={config}
          language={language}
          voices={voices}
          onRefreshOutputs={() => void refreshAudioOutputs(true)}
          onToggleEnabled={() =>
            void persist({ enabled: !config.enabled }, config.enabled ? tt(language, 'spotter.toast.paused') : tt(language, 'spotter.toast.active'))
          }
          onToggleMuted={() => void persist({ muted: !config.muted })}
          onChangeMasterVolumeLocal={(masterVolume) => setConfig((c) => ({ ...c, masterVolume }))}
          onCommitMasterVolume={(masterVolume) => void persist({ masterVolume })}
          onChangeDefaultVoice={(defaultVoiceURI) => void persist({ defaultVoiceURI })}
          onChangeOutput={(outputDeviceId) => void persist({ outputDeviceId })}
          onTestVoice={() => testSpotterVoice(config)}
        />

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '18px 0 14px' }}>
          {CATEGORY_ORDER.map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              style={{
                ...ghostButton,
                background: activeCategory === category ? 'var(--accent-primary-dim)' : 'transparent',
                borderColor: activeCategory === category ? 'var(--accent-primary)' : 'var(--border-strong)',
                color: activeCategory === category ? 'var(--accent-primary)' : 'var(--text-secondary)'
              }}
              type="button"
            >
              {CATEGORY_LABELS[category]}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          {categoryCallouts.map((meta) => (
            <CalloutRow
              key={meta.id}
              cfg={config.callouts[meta.id]}
              description={meta.description}
              title={meta.label}
              voices={voices}
              appLanguage={language}
              language={config.language}
              onToggle={() =>
                commitCallout(meta.id, { enabled: !config.callouts[meta.id].enabled })
              }
              onChangeLocal={(patch) => updateCalloutLocal(meta.id, patch)}
              onCommit={(patch) => commitCallout(meta.id, patch)}
              onTest={() => testCallout(meta.id, config)}
            />
          ))}

          <AdvancedThresholds
            category={activeCategory}
            thresholds={config.thresholds}
            onChangeLocal={updateThresholdLocal}
            onCommit={(patch) => void persist({ thresholds: patch })}
          />
        </div>
      </article>

      <article style={panel}>
        <span style={label}>{tt(language, 'spotter.liveTelemetry')}</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, margin: '10px 0 16px' }}>
          <LiveTile labelText={tt(language, 'spotter.telemetry')} value={live?.connected ? tt(language, 'spotter.connected') : tt(language, 'spotter.waiting')} />
          <LiveTile labelText={tt(language, 'spotter.flags')} value={activeFlags(live, language)} />
          <LiveTile labelText={tt(language, 'spotter.fuelLaps')} value={formatSec(lapsOfFuel(live), 1).replace('s', '')} />
          <LiveTile labelText={tt(language, 'spotter.lapsRemaining')} value={live?.lapsRemaining == null ? '—' : String(Math.floor(live.lapsRemaining))} />
          <LiveTile labelText={tt(language, 'spotter.position')} value={live?.position == null ? '—' : `P${live.position}`} />
          <LiveTile labelText={tt(language, 'spotter.incidents')} value={live?.incidentCount == null ? '—' : `${live.incidentCount}${live.incidentLimit ? ` / ${live.incidentLimit}` : ''}`} />
          <LiveTile labelText={tt(language, 'spotter.gapAhead')} value={formatSec(live?.relatives?.ahead?.gapSec)} />
          <LiveTile labelText={tt(language, 'spotter.gapBehind')} value={formatSec(live?.relatives?.behind?.gapSec)} />
          <LiveTile labelText={tt(language, 'spotter.onPitRoad')} value={live?.onPitRoad == null ? '—' : live.onPitRoad ? tt(language, 'common.sim') : tt(language, 'common.no')} />
          <LiveTile labelText={tt(language, 'spotter.speed')} value={formatMeasurement(live?.speedKmh, 'speed-kmh', unitSystem, { decimals: 0, includeUnit: true }).display} />
        </div>

        <span style={label}>{tt(language, 'spotter.lastCallouts')}</span>
        <div style={{ display: 'grid', gap: 6, marginTop: 8, minHeight: 96 }}>
          {log.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
              {tt(language, 'spotter.noCallouts')}
            </p>
          ) : (
            log.slice(0, 10).map((entry, index) => (
              <div
                key={`${entry.at}-${index}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  borderBottom: '1px solid var(--border-subtle)',
                  paddingBottom: 5
                }}
              >
                <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>{entry.text}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
                  {new Date(entry.at).toLocaleTimeString('pt-BR')}
                </span>
              </div>
            ))
          )}
        </div>

        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
          <span style={label}>{tt(language, 'spotter.voicesOutput')}</span>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '6px 0 0' }}>
            {(() => {
              const osCount = voices.filter((v) => v.engine === 'os').length
              const piperInstalled = voices.filter((v) => v.engine === 'piper' && v.piperInstalled).length
              const piperTotal = voices.filter((v) => v.engine === 'piper').length
              if (osCount === 0 && piperTotal === 0) return tt(language, 'spotter.loadingVoices')
              const parts: string[] = []
              if (osCount > 0) parts.push(tt(language, 'spotter.systemVoices', { count: osCount }))
              if (piperInstalled > 0) parts.push(tt(language, 'spotter.piperInstalled', { count: piperInstalled }))
              else if (piperTotal > 0) parts.push(tt(language, 'spotter.piperAvailable', { count: piperTotal }))
              return parts.join(' · ')
            })()}
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '6px 0 0' }}>
            {tt(language, 'spotter.voiceHelp')} <strong>{tt(language, 'voice.viewName')}</strong>.
          </p>
        </div>
      </article>
    </section>
  )
}

function MasterControls({
  audioOutputs,
  audioOutputsStatus,
  audioBusy,
  busy,
  config,
  language,
  voices,
  onRefreshOutputs,
  onToggleEnabled,
  onToggleMuted,
  onChangeMasterVolumeLocal,
  onCommitMasterVolume,
  onChangeDefaultVoice,
  onChangeOutput,
  onTestVoice
}: {
  audioOutputs: Array<{ deviceId: string; label: string }>
  audioOutputsStatus: string
  audioBusy: boolean
  busy: boolean
  config: SpotterConfig
  language: AppViewProps['language']
  voices: UnifiedVoice[]
  onRefreshOutputs(): void
  onToggleEnabled(): void
  onToggleMuted(): void
  onChangeMasterVolumeLocal(value: number): void
  onCommitMasterVolume(value: number): void
  onChangeDefaultVoice(voiceURI: string): void
  onChangeOutput(outputDeviceId: string): void
  onTestVoice(): void
}): ReactElement {
  const selectedDeviceMissing =
    config.outputDeviceId.length > 0 && !audioOutputs.some((device) => device.deviceId === config.outputDeviceId)

  return (
    <div
      style={{
        border: '1px solid var(--border-accent)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-5)',
        background: 'var(--surface-selected)',
        display: 'grid',
        gap: 12
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div>
          <h4 style={{ margin: '0 0 4px', fontSize: 18 }}>{tt(language, 'spotter.voiceEngine')}</h4>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: 13 }}>
            {config.enabled ? (config.muted ? tt(language, 'spotter.status.muted') : tt(language, 'spotter.status.speaking')) : tt(language, 'spotter.status.paused')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            disabled={busy}
            onClick={onToggleMuted}
            style={{
              ...ghostButton,
              borderColor: config.muted ? 'var(--accent-warning)' : 'var(--border-strong)',
              color: config.muted ? 'var(--accent-warning)' : 'var(--text-secondary)'
            }}
            type="button"
          >
            {config.muted ? tt(language, 'spotter.muted') : 'Mute'}
          </button>
          <button
            disabled={busy}
            onClick={onToggleEnabled}
            style={{ ...primaryButton, background: config.enabled ? 'var(--accent-danger)' : 'var(--accent-primary)' }}
            type="button"
          >
            {config.enabled ? tt(language, 'spotter.pause') : tt(language, 'spotter.activate')}
          </button>
        </div>
      </div>

      <RangeField
        labelText={tt(language, 'spotter.masterVolume')}
        min={0}
        max={1}
        step={0.05}
        value={config.masterVolume}
        display={`${Math.round(config.masterVolume * 100)}%`}
        onChange={onChangeMasterVolumeLocal}
        onCommit={onCommitMasterVolume}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>{tt(language, 'spotter.language')}</span>
          <select disabled style={inputStyle} value={config.language}>
            <option value="pt-BR">Portuguese (BR)</option>
            <option value="en-US">English</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>{tt(language, 'spotter.defaultVoice')}</span>
          <VoiceSelect language={config.language} onChange={onChangeDefaultVoice} value={config.defaultVoiceURI} voices={voices} />
        </label>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <span style={label}>{tt(language, 'spotter.outputDevice')}</span>
          <button disabled={audioBusy} onClick={onRefreshOutputs} style={ghostButton} type="button">
            {tt(language, 'spotter.refresh')}
          </button>
        </div>
        <select disabled={audioBusy} onChange={(event) => onChangeOutput(event.target.value)} style={inputStyle} value={config.outputDeviceId}>
          <option value="">{tt(language, 'spotter.systemDefault')}</option>
          {selectedDeviceMissing ? <option value={config.outputDeviceId}>{tt(language, 'spotter.deviceUnavailable')}</option> : null}
          {audioOutputs.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>{audioOutputsStatus}</p>
      </div>

      <div>
        <button onClick={onTestVoice} style={ghostButton} type="button">
          {tt(language, 'spotter.testVoice')}
        </button>
      </div>
    </div>
  )
}

function CalloutRow({
  cfg,
  description,
  title,
  voices,
  appLanguage,
  language,
  onToggle,
  onChangeLocal,
  onCommit,
  onTest
}: {
  cfg: CalloutConfig
  description: string
  title: string
  voices: UnifiedVoice[]
  appLanguage: AppViewProps['language']
  language: SpotterLang
  onToggle(): void
  onChangeLocal(patch: Partial<CalloutConfig>): void
  onCommit(patch: Partial<CalloutConfig>): void
  onTest(): void
}): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div
      style={{
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface-sunken)',
        padding: 12
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: 'block' }}>{title}</strong>
          <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '2px 0 0' }}>{description}</p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={onTest} style={ghostButton} type="button">
            {tt(appLanguage, 'spotter.test')}
          </button>
          <button
            onClick={() => setOpen((value) => !value)}
            style={{ ...ghostButton, padding: '0 10px' }}
            type="button"
          >
            {open ? tt(appLanguage, 'common.close') : tt(appLanguage, 'spotter.adjustments')}
          </button>
          <button
            onClick={onToggle}
            style={{
              ...ghostButton,
              minWidth: 52,
              background: cfg.enabled ? 'var(--accent-primary-dim)' : 'transparent',
              borderColor: cfg.enabled ? 'var(--accent-primary)' : 'var(--border-strong)',
              color: cfg.enabled ? 'var(--accent-primary)' : 'var(--text-secondary)'
            }}
            type="button"
          >
            {cfg.enabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {open ? (
        <div style={{ display: 'grid', gap: 12, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={label}>{tt(appLanguage, 'spotter.voice')}</span>
            <VoiceSelect language={language} onChange={(voiceURI) => onCommit({ voiceURI })} value={cfg.voiceURI} voices={voices} />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <RangeField
              labelText={tt(appLanguage, 'spotter.rate')}
              min={0.5}
              max={2}
              step={0.05}
              value={cfg.rate}
              display={`${cfg.rate.toFixed(2)}×`}
              onChange={(rate) => onChangeLocal({ rate })}
              onCommit={(rate) => onCommit({ rate })}
            />
            <RangeField
              labelText={tt(appLanguage, 'spotter.pitch')}
              min={0}
              max={2}
              step={0.05}
              value={cfg.pitch}
              display={cfg.pitch.toFixed(2)}
              onChange={(pitch) => onChangeLocal({ pitch })}
              onCommit={(pitch) => onCommit({ pitch })}
            />
            <RangeField
              labelText={tt(appLanguage, 'spotter.volume')}
              min={0}
              max={1}
              step={0.05}
              value={cfg.volume}
              display={`${Math.round(cfg.volume * 100)}%`}
              onChange={(volume) => onChangeLocal({ volume })}
              onCommit={(volume) => onCommit({ volume })}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <NumberField
              labelText="Cooldown (ms)"
              min={0}
              max={120000}
              step={250}
              value={cfg.cooldownMs}
              onChange={(cooldownMs) => onChangeLocal({ cooldownMs })}
              onCommit={(cooldownMs) => onCommit({ cooldownMs })}
            />
            <NumberField
              labelText={tt(appLanguage, 'spotter.priority')}
              min={1}
              max={10}
              step={1}
              value={cfg.priority}
              onChange={(priority) => onChangeLocal({ priority })}
              onCommit={(priority) => onCommit({ priority })}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AdvancedThresholds({
  category,
  thresholds,
  onChangeLocal,
  onCommit
}: {
  category: CalloutCategory
  thresholds: SpotterThresholds
  onChangeLocal(patch: Partial<SpotterThresholds>): void
  onCommit(patch: Partial<SpotterThresholds>): void
}): ReactElement | null {
  const unitSystem = useUnitSystem()
  const fields = THRESHOLD_FIELDS[category]
  if (!fields || fields.length === 0) return null
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface-base)',
        padding: 12,
        marginTop: 4
      }}
    >
      <span style={label}>Advanced · triggers</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 10 }}>
        {fields.map((field) => {
          const speed = field.key === 'pitSpeedLimitKmh'
          const distance = field.key === 'proximityAheadMeters' || field.key === 'proximitySideMeters'
          const kind = speed ? 'speed-kmh' : distance ? 'distance-m' : undefined
          const displayValue = kind ? formatMeasurement(thresholds[field.key], kind, unitSystem, { decimals: distance ? 1 : 0 }).value ?? thresholds[field.key] : thresholds[field.key]
          const displayMin = kind ? formatMeasurement(field.min, kind, unitSystem, { decimals: distance ? 1 : 0 }).value ?? field.min : field.min
          const displayMax = kind ? formatMeasurement(field.max, kind, unitSystem, { decimals: distance ? 1 : 0 }).value ?? field.max : field.max
          const displayStep = kind ? formatMeasurement(field.step, kind, unitSystem, { decimals: distance ? 1 : 0 }).value ?? field.step : field.step
          const toCanonical = (value: number): number => unitSystem === 'imperial'
            ? speed
              ? mphToKmh(value) ?? value
              : distance
                ? feetToMeters(value) ?? value
                : value
            : value
          const labelText = kind ? field.labelText.replace(/\((?:km\/h|m)\)/, `(${formatMeasurement(undefined, kind, unitSystem).unit})`) : field.labelText
          return (
            <NumberField
              key={field.key}
              labelText={labelText}
              min={displayMin}
              max={displayMax}
              step={displayStep}
              value={displayValue}
              onChange={(value) => onChangeLocal({ [field.key]: toCanonical(value) } as Partial<SpotterThresholds>)}
              onCommit={(value) => onCommit({ [field.key]: toCanonical(value) } as Partial<SpotterThresholds>)}
            />
          )
        })}
      </div>
    </div>
  )
}

interface ThresholdField {
  key: keyof SpotterThresholds
  labelText: string
  min: number
  max: number
  step: number
}

const THRESHOLD_FIELDS: Partial<Record<CalloutCategory, ThresholdField[]>> = {
  fuel: [
    { key: 'fuelLowLaps', labelText: 'Low fuel (laps)', min: 0.5, max: 20, step: 0.5 },
    { key: 'fuelBoxLaps', labelText: 'Box this lap (laps)', min: 0.2, max: 10, step: 0.5 }
  ],
  pit: [
    { key: 'pitSpeedLimitKmh', labelText: 'Pit speed limit (km/h)', min: 20, max: 120, step: 1 },
    { key: 'pitWindowOpenLaps', labelText: 'Pit window (laps)', min: 1, max: 100, step: 1 }
  ],
  proximity: [
    { key: 'gapChangeSec', labelText: 'Gap change (s)', min: 0.05, max: 5, step: 0.05 },
    { key: 'proximityAheadMeters', labelText: 'Longitudinal range (m)', min: 1, max: 20, step: 0.5 },
    { key: 'proximitySideMeters', labelText: 'Side range (m)', min: 1, max: 20, step: 0.5 }
  ],
  incidents: [{ key: 'incidentWarnMargin', labelText: 'Limit margin (pts)', min: 1, max: 20, step: 1 }]
}

function VoiceSelect({
  language,
  onChange,
  value,
  voices
}: {
  language: SpotterLang
  onChange(voiceURI: string): void
  value: string
  voices: UnifiedVoice[]
}): ReactElement {
  const langNorm = language.toLowerCase().replace('_', '-')
  const sorted = useMemo(() => {
    return [...voices].sort((a, b) => {
      // 1. Language match first
      const aLangMatch = (a.lang ?? '').toLowerCase().replace('_', '-') === langNorm ? 0 : 1
      const bLangMatch = (b.lang ?? '').toLowerCase().replace('_', '-') === langNorm ? 0 : 1
      if (aLangMatch !== bLangMatch) return aLangMatch - bLangMatch
      // 2. Piper voices before OS voices (higher quality + device routing)
      const aEngine = a.engine === 'piper' ? 0 : 1
      const bEngine = b.engine === 'piper' ? 0 : 1
      if (aEngine !== bEngine) return aEngine - bEngine
      return a.name.localeCompare(b.name)
    })
  }, [voices, langNorm])
  const selectedMissing = value.length > 0 && !voices.some((v) => v.id === value)
  return (
    <select onChange={(event) => onChange(event.target.value)} style={inputStyle} value={value}>
      <option value="">Default voice ({language})</option>
      {selectedMissing ? <option value={value}>Voice unavailable</option> : null}
      {sorted.map((voice) => (
        <option
          key={voice.id}
          value={voice.id}
          disabled={voice.engine === 'piper' && voice.piperInstalled === false}
        >
          {voice.name} · {voice.lang}
          {voice.engine === 'piper' && voice.piperInstalled === false ? ' (not installed)' : ''}
        </option>
      ))}
    </select>
  )
}

function RangeField({
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
  onCommit(value: number): void
}): ReactElement {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ ...label, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{labelText}</span>
        <span style={{ color: 'var(--text-secondary)' }}>{display}</span>
      </span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        onBlur={(event) => onCommit(Number(event.target.value))}
        onPointerUp={(event) => onCommit(Number((event.target as HTMLInputElement).value))}
        step={step}
        style={rangeStyle}
        type="range"
        value={Number.isFinite(value) ? value : min}
      />
    </label>
  )
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
  onCommit(value: number): void
}): ReactElement {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={label}>{labelText}</span>
      <input
        max={max}
        min={min}
        onBlur={(event) => onCommit(Number(event.target.value))}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        style={inputStyle}
        type="number"
        value={Number.isFinite(value) ? value : min}
      />
    </label>
  )
}

function LiveTile({ labelText, value }: { labelText: string; value: string }): ReactElement {
  return (
    <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', padding: 10, background: 'var(--surface-sunken)' }}>
      <span style={label}>{labelText}</span>
      <strong style={{ display: 'block', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</strong>
    </div>
  )
}

export default VoiceSpotterSection
