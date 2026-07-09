import { type CSSProperties, type ReactElement, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_REVLIGHTS_CONFIG,
  REVLIGHTS_DEVICE_LED_COUNT,
  REVLIGHTS_MAX_LED_COUNT,
  REVLIGHTS_MIN_LED_COUNT,
  applyPreset,
  normalizeRevlightsConfig,
  previewLedColors
} from '../../../shared/revlights'
import type {
  RevlightsBlinkPattern,
  RevlightsConfig,
  RevlightsPreset,
  RevlightsPresetId,
  RevlightsSegment,
  RevlightsStatus
} from '../../../shared/revlights'
import type { AppViewProps } from '../App'
import { tt } from '../i18n'
import { useDevices } from '../lib/devices/DeviceRegistry'
import { SectionExportImport } from '../components/SectionExportImport'

const BLINK_PATTERNS: Array<{ id: RevlightsBlinkPattern; labelKey: string }> = [
  { id: 'solid', labelKey: 'revlights.blink.solid' },
  { id: 'slow', labelKey: 'revlights.blink.slow' },
  { id: 'fast', labelKey: 'revlights.blink.fast' },
  { id: 'strobe', labelKey: 'revlights.blink.strobe' }
]

const FLAG_LABEL_KEYS: Record<keyof RevlightsConfig['flagColors'], string> = {
  yellow: 'revlights.flag.yellow',
  blue: 'revlights.flag.blue',
  white: 'revlights.flag.white',
  red: 'revlights.flag.red',
  meatball: 'revlights.flag.meatball',
  greenWhiteCheckered: 'revlights.flag.greenWhiteCheckered'
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

const shell: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(320px, 0.95fr) minmax(380px, 1.05fr)',
  gap: 18,
  alignItems: 'start'
}

const panel: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 'var(--radius-sm)',
  
  padding: 18
}

const label: CSSProperties = {
  color: 'rgba(255,255,255,0.56)',
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 1.5,
  textTransform: 'uppercase'
}

function RevlightsView({ showToast, language }: AppViewProps): ReactElement {
  // Resolve the connected ButtonBox from the shared device registry.
  const { primaryDevice: connectedDevice } = useDevices()
  const [presets, setPresets] = useState<RevlightsPreset[]>([])
  const [config, setConfig] = useState<RevlightsConfig>(() =>
    normalizeRevlightsConfig({ ...DEFAULT_REVLIGHTS_CONFIG, updatedAt: new Date().toISOString() })
  )
  const [status, setStatus] = useState<RevlightsStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [previewLevel, setPreviewLevel] = useState(0)

  useEffect(() => {
    void Promise.all([
      window.ipc.invoke<RevlightsPreset[]>('revlights:getPresets'),
      window.ipc.invoke<RevlightsConfig>('revlights:getConfig'),
      window.ipc.invoke<RevlightsStatus>('revlights:getStatus')
    ])
      .then(([nextPresets, nextConfig, nextStatus]) => {
        setPresets(nextPresets)
        setConfig(nextConfig)
        setStatus(nextStatus)
      })
      .catch((error) => showToast(getErrorMessage(error), 'error'))

    const unsubscribe = window.ipc.subscribe<RevlightsStatus>('revlights:status', setStatus)
    return unsubscribe
  }, [showToast])

  const previewColors = useMemo(() => previewLedColors(config, previewLevel), [config, previewLevel])
  const rpmWindowPct = useMemo(() => Math.round((1 - config.startRpmPct) * 100), [config.startRpmPct])
  const f1KnobPreset: RevlightsPresetId = config.preset === 'f1' ? 'f1' : 'custom'

  async function reloadConfig(): Promise<void> {
    try {
      const [nextPresets, nextConfig] = await Promise.all([
        window.ipc.invoke<RevlightsPreset[]>('revlights:getPresets'),
        window.ipc.invoke<RevlightsConfig>('revlights:getConfig')
      ])
      setPresets(nextPresets)
      setConfig(nextConfig)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function persist(next: Partial<RevlightsConfig>): Promise<void> {
    setBusy(true)
    try {
      const saved = await window.ipc.invoke<RevlightsConfig>('revlights:setConfig', next)
      setConfig(saved)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function toggleEnabled(): Promise<void> {
    if (!config.enabled && !connectedDevice) {
      showToast(tt(language, 'revlights.connectBeforeEnable'), 'error')
      return
    }
    setBusy(true)
    try {
      const saved = await window.ipc.invoke<RevlightsConfig>('revlights:setEnabled', !config.enabled)
      setConfig(saved)
      showToast(saved.enabled ? tt(language, 'revlights.enabledToast') : tt(language, 'revlights.pausedToast'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function applyPresetById(presetId: RevlightsPresetId): Promise<void> {
    if (presetId === 'custom') {
      await persist({ preset: 'custom' })
      return
    }
    setBusy(true)
    try {
      // Apply locally for a snappy UI and persist canonical version from main.
      const localPreview = applyPreset(presetId, config)
      setConfig(localPreview)
      const saved = await window.ipc.invoke<RevlightsConfig>('revlights:applyPreset', presetId)
      setConfig(saved)
      showToast(`Preset “${presetId}” aplicado.`, 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  function updateSegment(index: number, patch: Partial<RevlightsSegment>): void {
    const segments = config.segments.map((segment, segmentIndex) =>
      segmentIndex === index ? { ...segment, ...patch } : segment
    )
    setConfig({ ...config, segments, preset: 'custom' })
  }

  function addSegment(): void {
    const last = config.segments[config.segments.length - 1]
    const startPct = last ? Math.min(0.99, Number(last.startPct) + 0.05) : 0.5
    const segments = [...config.segments, { startPct, color: '#33D17C', label: tt(language, 'revlights.segmentName', { index: config.segments.length + 1 }) }]
    setConfig({ ...config, segments, preset: 'custom' })
  }

  function removeSegment(index: number): void {
    if (config.segments.length <= 1) return
    const segments = config.segments.filter((_, segmentIndex) => segmentIndex !== index)
    setConfig({ ...config, segments, preset: 'custom' })
  }

  function updateFlagColor(key: keyof RevlightsConfig['flagColors'], value: string): void {
    setConfig({ ...config, flagColors: { ...config.flagColors, [key]: value }, preset: 'custom' })
  }

  function updateRpmWindowPct(value: number): void {
    const windowPct = clampNumber(value, 1, 100)
    setConfig({ ...config, startRpmPct: clampNumber(1 - (windowPct / 100), 0, 1), preset: f1KnobPreset })
  }

  return (
    <section style={shell}>
      <article style={{ ...panel, minHeight: 620 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <span style={label}>Rev lights · WS2812B 4 LEDs</span>
            <h3 style={{ margin: '8px 0 4px', fontSize: 26 }}>{tt(language, 'revlights.title')}</h3>
            <p style={{ margin: 0, color: 'rgba(255,255,255,0.62)' }}>
              {tt(language, 'revlights.summaryBeforeCode')}<code> R&lt;lvl&gt; </code> + <code> B&lt;0|1&gt; </code>{tt(language, 'revlights.summaryAfterCode')}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <SectionExportImport sectionId="revlights" label={tt(language, 'revlights.exportLabel')} onImported={() => void reloadConfig()} />
            <button
              disabled={busy || (!connectedDevice && !config.enabled)}
              onClick={() => void toggleEnabled()}
              style={{
                background: config.enabled ? 'var(--accent-danger)' : 'var(--accent-primary)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                color: config.enabled ? '#fff' : '#06100f',
                cursor: 'pointer',
                fontWeight: 800,
                padding: '10px 16px'
              }}
              type="button"
            >
              {config.enabled ? tt(language, 'common.stop') : tt(language, 'revlights.enable')}
            </button>
          </div>
        </div>

        <div className="divider" style={{ margin: '16px 0' }} />

        <span style={label}>{tt(language, 'revlights.presets')}</span>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {presets.map((preset) => (
            <label
              key={preset.id}
              style={{
                border: `1px solid ${config.preset === preset.id ? 'rgba(var(--accent-rgb),0.72)' : 'rgba(255,255,255,0.1)'}`,
                background: config.preset === preset.id ? 'rgba(var(--accent-rgb),0.1)' : 'rgba(255,255,255,0.035)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                padding: 12,
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start'
              }}
            >
              <input
                checked={config.preset === preset.id}
                disabled={busy}
                name="revlights-preset"
                onChange={() => void applyPresetById(preset.id)}
                style={{ marginTop: 4 }}
                type="radio"
              />
              <span style={{ flex: 1 }}>
                <strong style={{ display: 'block' }}>{preset.name}</strong>
                <small style={{ color: 'rgba(255,255,255,0.62)' }}>{preset.description}</small>
              </span>
            </label>
          ))}
        </div>

        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 'var(--radius-sm)',
            border: `1px solid ${config.preset === 'f1' ? 'rgba(var(--accent-rgb),0.72)' : 'rgba(255,255,255,0.12)'}`,
            background: config.preset === 'f1' ? 'rgba(var(--accent-rgb),0.1)' : 'rgba(255,255,255,0.035)'
          }}
        >
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <input
              checked={config.preset === 'f1'}
              disabled={busy}
              onChange={(event) => {
                if (event.target.checked) void applyPresetById('f1')
                else void persist({ preset: 'custom' })
              }}
              style={{ marginTop: 4 }}
              type="checkbox"
            />
            <span>
              <strong style={{ display: 'block' }}>{tt(language, 'revlights.f1Mode')}</strong>
              <small style={{ color: 'rgba(255,255,255,0.66)' }}>
                Lights only in the last {rpmWindowPct}% of RPM, sweeps green → amber → red in the preview
                and blinks at the shift point.
              </small>
            </span>
          </label>
          <p className="helper-text" style={{ marginBottom: 0 }}>
            {tt(language, 'revlights.noteBeforeCode')} <code>R&lt;lvl&gt;</code> + <code>B&lt;0|1&gt;</code>; {tt(language, 'revlights.noteAfterCode')}
          </p>
        </div>

        <div className="divider" style={{ margin: '16px 0' }} />

        <span style={label}>{tt(language, 'revlights.ledCount')}</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
          <input
            max={REVLIGHTS_MAX_LED_COUNT}
            min={REVLIGHTS_MIN_LED_COUNT}
            onBlur={() => void persist({ ledCount: config.ledCount })}
            onChange={(event) => setConfig({ ...config, ledCount: clampNumber(Number(event.target.value), REVLIGHTS_MIN_LED_COUNT, REVLIGHTS_MAX_LED_COUNT) })}
            style={{ flex: 1, accentColor: 'var(--accent-primary)' }}
            type="range"
            value={config.ledCount}
          />
          <strong style={{ minWidth: 64, textAlign: 'right' }}>{tt(language, 'revlights.ledCountValue', { count: config.ledCount })}</strong>
        </div>
        <p className="helper-text">
          {tt(language, 'revlights.ledHelp', { count: REVLIGHTS_DEVICE_LED_COUNT })}
        </p>

        <div className="divider" style={{ margin: '16px 0' }} />

        <span style={label}>{tt(language, 'revlights.rpmPoints')}</span>
        <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>{tt(language, 'revlights.lastRpm')}</span>
            <input
              max={100}
              min={1}
              onBlur={() => void persist({ startRpmPct: config.startRpmPct, preset: f1KnobPreset })}
              onChange={(event) => updateRpmWindowPct(Number(event.target.value))}
              step={1}
              type="range"
              value={rpmWindowPct}
            />
            <strong>
              Last {rpmWindowPct}% · start at {Math.round(config.startRpmPct * 100)}%
            </strong>
            <small style={{ color: 'rgba(255,255,255,0.56)' }}>
              {tt(language, 'revlights.lastHelp')}
            </small>
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>{tt(language, 'revlights.shiftPoint')}</span>
            <input
              max={1}
              min={0}
              onBlur={() => void persist({ shiftRpmPct: config.shiftRpmPct, preset: f1KnobPreset })}
              onChange={(event) => setConfig({ ...config, shiftRpmPct: clampNumber(Number(event.target.value), 0, 1), preset: f1KnobPreset })}
              step={0.005}
              type="range"
              value={config.shiftRpmPct}
            />
            <strong>{(config.shiftRpmPct * 100).toFixed(1)}%</strong>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              checked={config.useShiftIndicatorPct}
              onChange={(event) => void persist({ useShiftIndicatorPct: event.target.checked })}
              type="checkbox"
            />
            <span>{tt(language, 'revlights.useIracingShift')}</span>
          </label>
        </div>
      </article>

      <div style={{ display: 'grid', gap: 18 }}>
        <article style={panel}>
          <span style={label}>{tt(language, 'revlights.livePreview')}</span>
          <h3 style={{ margin: '8px 0' }}>{tt(language, 'revlights.currentStrip')}</h3>
          <div style={{ display: 'flex', gap: 6, padding: '8px 0' }}>
            {previewColors.map((color, index) => (
              <div
                aria-hidden="true"
                key={index}
                style={{
                  background: color,
                  borderRadius: '50%',
                  flex: 1,
                  height: 38,
                  transition: 'background 80ms linear'
                }}
              />
            ))}
          </div>
          <label style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            <span style={label}>{tt(language, 'revlights.simulateLevel')}</span>
            <input
              max={config.ledCount}
              min={0}
              onChange={(event) => setPreviewLevel(Number(event.target.value))}
              step={1}
              type="range"
              value={previewLevel}
            />
            <strong>{previewLevel} / {config.ledCount}</strong>
          </label>
          <dl className="status-list" style={{ marginTop: 12 }}>
            <div>
              <dt>{tt(language, 'revlights.realLevel')}</dt>
              <dd>{status?.level ?? 0}</dd>
            </div>
            <div>
              <dt>{tt(language, 'revlights.shift')}</dt>
              <dd>{status?.shiftActive ? 'BLINKING' : '—'}</dd>
            </div>
            <div>
              <dt>RPM</dt>
              <dd>
                {(status?.rpm ?? 0).toFixed(0)} / {(status?.maxRpm ?? 0).toFixed(0)}
              </dd>
            </div>
            <div>
              <dt>{tt(language, 'revlights.error')}</dt>
              <dd style={{ color: status?.lastError ? 'var(--accent-warning)' : 'inherit' }}>{status?.lastError ?? '—'}</dd>
            </div>
          </dl>
        </article>

        <article style={panel}>
          <span style={label}>{tt(language, 'revlights.segmentsByColor')}</span>
          <h3 style={{ margin: '8px 0' }}>{tt(language, 'revlights.bandsTitle')}</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {config.segments.map((segment, index) => (
              <div
                key={index}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 1fr 90px 80px auto',
                  gap: 8,
                  alignItems: 'center',
                  padding: 10,
                  background: 'rgba(255,255,255,0.035)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 'var(--radius-sm)'
                }}
              >
                <input
                  aria-label={tt(language, 'revlights.segmentColorAria', { index: index + 1 })}
                  onBlur={() => void persist({ segments: config.segments, preset: 'custom' })}
                  onChange={(event) => updateSegment(index, { color: event.target.value })}
                  style={{ height: 36, width: '100%', border: 'none', background: 'transparent' }}
                  type="color"
                  value={segment.color}
                />
                <input
                  aria-label={tt(language, 'revlights.segmentLabelAria', { index: index + 1 })}
                  className="text-field"
                  onBlur={() => void persist({ segments: config.segments, preset: 'custom' })}
                  onChange={(event) => updateSegment(index, { label: event.target.value })}
                  placeholder={tt(language, 'revlights.segmentName', { index: index + 1 })}
                  value={segment.label ?? ''}
                />
                <input
                  aria-label={tt(language, 'revlights.segmentStartAria', { index: index + 1 })}
                  className="text-field"
                  max={1}
                  min={0}
                  onBlur={() => void persist({ segments: config.segments, preset: 'custom' })}
                  onChange={(event) => updateSegment(index, { startPct: clampNumber(Number(event.target.value), 0, 1) })}
                  step={0.01}
                  type="number"
                  value={segment.startPct}
                />
                <strong style={{ textAlign: 'right' }}>{Math.round(segment.startPct * 100)}%</strong>
                <button
                  className="ghost-action"
                  disabled={config.segments.length <= 1 || busy}
                  onClick={() => {
                    removeSegment(index)
                    void persist({ segments: config.segments.filter((_, i) => i !== index), preset: 'custom' })
                  }}
                  type="button"
                >
                  {tt(language, 'common.remove')}
                </button>
              </div>
            ))}
          </div>
          <div className="action-row">
            <button
              className="ghost-action"
              disabled={busy}
              onClick={() => {
                addSegment()
                const last = config.segments[config.segments.length - 1]
                const startPct = last ? Math.min(0.99, Number(last.startPct) + 0.05) : 0.5
                void persist({
                  segments: [...config.segments, { startPct, color: '#33D17C', label: tt(language, 'revlights.segmentName', { index: config.segments.length + 1 }) }],
                  preset: 'custom'
                })
              }}
              type="button"
            >
              {tt(language, 'revlights.addBand')}
            </button>
          </div>
        </article>

        <article style={panel}>
          <span style={label}>{tt(language, 'revlights.shiftIndicator')}</span>
          <h3 style={{ margin: '8px 0' }}>{tt(language, 'revlights.blueBlink')}</h3>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              checked={config.shiftBlink}
              onChange={(event) => void persist({ shiftBlink: event.target.checked })}
              type="checkbox"
            />
            <span>{tt(language, 'revlights.enableShiftBlink')}</span>
          </label>
          <label className="field-label" htmlFor="blink-pattern">{tt(language, 'revlights.blinkPattern')}</label>
          <select
            className="select-field wide"
            disabled={!config.shiftBlink}
            id="blink-pattern"
            onChange={(event) => void persist({ shiftBlinkPattern: event.target.value as RevlightsBlinkPattern })}
            value={config.shiftBlinkPattern}
          >
            {BLINK_PATTERNS.map((option) => (
              <option key={option.id} value={option.id}>
                {tt(language, option.labelKey)}
              </option>
            ))}
          </select>
          <p className="helper-text">
            {tt(language, 'revlights.firmwareBlinkBefore')} <code>B1</code> {tt(language, 'revlights.firmwareBlinkAfter')}
          </p>
        </article>

        <article style={panel}>
          <span style={label}>{tt(language, 'revlights.flagColors')}</span>
          <h3 style={{ margin: '8px 0' }}>{tt(language, 'revlights.palettePreview')}</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {(Object.keys(config.flagColors) as Array<keyof RevlightsConfig['flagColors']>).map((key) => (
              <div
                key={key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 1fr',
                  gap: 8,
                  alignItems: 'center'
                }}
              >
                <input
                  aria-label={tt(language, 'revlights.flagColorAria', { flag: tt(language, FLAG_LABEL_KEYS[key]) })}
                  onBlur={() => void persist({ flagColors: config.flagColors })}
                  onChange={(event) => updateFlagColor(key, event.target.value)}
                  style={{ height: 36, width: '100%', border: 'none', background: 'transparent' }}
                  type="color"
                  value={config.flagColors[key]}
                />
                <span>{tt(language, FLAG_LABEL_KEYS[key])}</span>
              </div>
            ))}
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <input
              checked={config.flagBlink}
              onChange={(event) => void persist({ flagBlink: event.target.checked })}
              type="checkbox"
            />
            <span>{tt(language, 'revlights.pulseFlag')}</span>
          </label>
        </article>
      </div>
    </section>
  )
}

export default RevlightsView
