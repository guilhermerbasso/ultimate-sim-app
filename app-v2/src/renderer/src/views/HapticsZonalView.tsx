import { type ComponentType, type CSSProperties, type ReactElement, useEffect, useMemo, useRef, useState } from 'react'
import type { AppViewProps } from '../App'
import { tt } from '../i18n'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { useDevices } from '../lib/devices/DeviceRegistry'
import {
  DEFAULT_HAPTICS_ZONAL_CONFIG,
  HAPTICS_ZONAL_CHANNELS,
  HAPTIC_EVENT_IDS,
  HAPTIC_EVENT_META,
  HAPTIC_ZONE_IDS,
  HAPTIC_ZONE_META,
  computeZonalHaptics,
  mapEventsToZones,
  rawEventsForTest,
  type HapticEventId,
  type HapticZoneId,
  type HapticsZonalConfig,
  type HapticsZonalConfigPatch,
  type ZonalFrame
} from '../../../shared/haptics-zonal'

// Zonal Haptics config + VISUAL zone simulator. The boxes light per telemetry
// EVENT so the engine is fully tunable WITHOUT any transducer hardware. Real
// tactile feel needs bass-shaker transducers wired to per-zone amp channels —
// this view drives only the visual yes and the optional secondary serial buzzer.

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

const primaryButton: CSSProperties = {
  background: 'var(--accent-primary)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-on-accent)',
  cursor: 'pointer',
  fontFamily: '"Rajdhani", sans-serif',
  fontWeight: 600,
  textTransform: 'uppercase',
  padding: '0 var(--space-5)',
  height: 30,
  letterSpacing: '0.06em'
}

const ZONE_ACCENT = '#49C5B1'

function Toggle({ checked, onChange, text }: { checked: boolean; onChange(next: boolean): void; text: string }): ReactElement {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        ...primaryButton,
        background: checked ? 'var(--accent-primary)' : 'transparent',
        color: checked ? 'var(--text-on-accent)' : 'var(--text-primary)',
        border: checked ? 'none' : '1px solid var(--border-strong)'
      }}
      type="button"
    >
      {text}
    </button>
  )
}

function Slider({
  text,
  min,
  max,
  step,
  value,
  display,
  onChange,
  onCommit
}: {
  text: string
  min: number
  max: number
  step: number
  value: number
  display: string
  onChange(next: number): void
  onCommit(next: number): void
}): ReactElement {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ ...label, display: 'flex', justifyContent: 'space-between' }}>
        <span>{text}</span>
        <span style={{ color: 'var(--text-primary)' }}>{display}</span>
      </span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={() => onCommit(value)}
        onKeyUp={() => onCommit(value)}
        step={step}
        style={{ width: '100%', accentColor: ZONE_ACCENT }}
        type="range"
        value={value}
      />
    </label>
  )
}

function ZoneBox({ id, label: name, intensity }: { id: HapticZoneId; label: string; intensity: number }): ReactElement {
  const lit = Math.max(0, Math.min(1, intensity))
  return (
    <div
      style={{
        background: `rgba(73, 197, 177, ${0.08 + lit * 0.85})`,
        border: `1px solid ${lit > 0.02 ? ZONE_ACCENT : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-sm)',
        boxShadow: lit > 0.02 ? `0 0 ${Math.round(4 + lit * 22)}px rgba(73,197,177,${lit})` : 'none',
        padding: '10px 12px',
        minHeight: 54,
        display: 'grid',
        alignContent: 'center',
        gap: 2,
        transition: 'background 60ms linear, box-shadow 60ms linear'
      }}
      title={HAPTIC_ZONE_META[id].blurb}
    >
      <span style={{ color: 'var(--text-primary)', fontFamily: '"Rajdhani", sans-serif', fontWeight: 600, fontSize: 13 }}>{name}</span>
      <span style={{ color: 'var(--text-muted)', fontFamily: '"Barlow Condensed", sans-serif', fontSize: 12 }}>{Math.round(lit * 100)}%</span>
    </div>
  )
}

const HapticsZonalView: ComponentType<AppViewProps> = ({ showToast, language }): ReactElement => {
  const { serialDevices } = useDevices()
  const [config, setConfig] = useState<HapticsZonalConfig>(DEFAULT_HAPTICS_ZONAL_CONFIG)
  const [live, setLive] = useState<TelemetrySnapshot | null>(null)
  const [flash, setFlash] = useState<ZonalFrame | null>(null)
  const [busy, setBusy] = useState(false)
  const prevRef = useRef<TelemetrySnapshot | null>(null)
  const flashTimer = useRef<number | null>(null)

  useEffect(() => {
    void window.ipc
      .invoke<HapticsZonalConfig>(HAPTICS_ZONAL_CHANNELS.getConfig)
      .then(setConfig)
      .catch((error) => showToast(getErrorMessage(error), 'error'))
    const offConfig = window.ipc.subscribe<HapticsZonalConfig>(HAPTICS_ZONAL_CHANNELS.configEvent, setConfig)
    const offTelemetry = window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', setLive)
    return () => {
      offConfig()
      offTelemetry()
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    }
  }, [showToast])

  // The yes FORCES the engine on so it reacts to live telemetry even when the
  // real output is disabled — per-event/zone enables still apply.
  const previewConfig = useMemo<HapticsZonalConfig>(() => ({ ...config, enabled: true, muted: false }), [config])
  const liveFrame = useMemo<ZonalFrame>(() => computeZonalHaptics(live, prevRef.current, previewConfig), [live, previewConfig])
  useEffect(() => {
    prevRef.current = live
  }, [live])

  const displayFrame = flash ?? liveFrame

  async function persist(patch: HapticsZonalConfigPatch, success?: string): Promise<void> {
    setBusy(true)
    try {
      const saved = await window.ipc.invoke<HapticsZonalConfig>(HAPTICS_ZONAL_CHANNELS.setConfig, patch)
      setConfig(saved)
      if (success) showToast(success, 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  function testEvent(eventId: HapticEventId): void {
    const frame = mapEventsToZones(rawEventsForTest(eventId, 1), previewConfig)
    setFlash(frame)
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(null), 480)
    void window.ipc.invoke(HAPTICS_ZONAL_CHANNELS.test, eventId, 1).catch(() => undefined)
  }

  const buzzerDevices = serialDevices.filter((device) => device.kind !== 'sim-x')
  const missingDevice = config.arduino.deviceId.length > 0 && !buzzerDevices.some((d) => d.id === config.arduino.deviceId)

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <header style={{ display: 'grid', gap: 6 }}>
        <h1 style={{ margin: 0, fontFamily: '"Rajdhani", sans-serif', fontSize: 24, color: 'var(--text-primary)' }}>{tt(language, 'hapticsZonal.title')}</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', maxWidth: 720 }}>
          {tt(language, 'hapticsZonal.summary')}
        </p>
        <div
          style={{
            background: 'rgba(255, 196, 0, 0.10)',
            border: '1px solid rgba(255, 196, 0, 0.45)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)',
            padding: '8px 12px',
            fontSize: 13
          }}
        >
          {tt(language, 'hapticsZonal.hardwareBefore')} <strong>{tt(language, 'hapticsZonal.transducers')}</strong> {tt(language, 'hapticsZonal.hardwareMiddle')} <strong>{tt(language, 'hapticsZonal.serialBuzzer')}</strong> {tt(language, 'hapticsZonal.hardwareAfter')}
        </div>
      </header>

      <section style={{ ...panel, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Toggle checked={config.enabled} text={config.enabled ? tt(language, 'hapticsZonal.outputOn') : tt(language, 'hapticsZonal.outputOff')} onChange={(next) => void persist({ enabled: next })} />
          <Toggle checked={config.muted} text={config.muted ? tt(language, 'hapticsZonal.muted') : tt(language, 'hapticsZonal.sound')} onChange={(next) => void persist({ muted: next })} />
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {config.enabled && !config.muted ? 'Engine active' : 'Engine inactive — the simulator still reacts to telemetry'}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 16 }}>
          <Slider
            text={tt(language, 'hapticsZonal.masterGain')}
            min={0}
            max={1}
            step={0.05}
            value={config.masterGain}
            display={`${Math.round(config.masterGain * 100)}%`}
            onChange={(masterGain) => setConfig((c) => ({ ...c, masterGain }))}
            onCommit={(masterGain) => void persist({ masterGain })}
          />
          <Slider
            text={tt(language, 'hapticsZonal.minBuzzerInterval')}
            min={30}
            max={500}
            step={10}
            value={config.minIntervalMs}
            display={`${config.minIntervalMs} ms`}
            onChange={(minIntervalMs) => setConfig((c) => ({ ...c, minIntervalMs }))}
            onCommit={(minIntervalMs) => void persist({ minIntervalMs })}
          />
        </div>
      </section>

      <section style={{ ...panel, display: 'grid', gap: 14 }}>
        <span style={label}>{tt(language, 'hapticsZonal.zoneSimulator')}</span>
        <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
          <ZoneBox id="wheel" label={config.zones.wheel.label} intensity={displayFrame.zones.wheel} />
          <ZoneBox id="seat" label={config.zones.seat.label} intensity={displayFrame.zones.seat} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <ZoneBox id="pedalLeft" label={config.zones.pedalLeft.label} intensity={displayFrame.zones.pedalLeft} />
            <ZoneBox id="pedalRight" label={config.zones.pedalRight.label} intensity={displayFrame.zones.pedalRight} />
          </div>
        </div>

        <span style={label}>{tt(language, 'hapticsZonal.eventsClickTest')}</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {HAPTIC_EVENT_IDS.map((id) => {
            const lit = displayFrame.events[id]
            return (
              <button
                key={id}
                onClick={() => testEvent(id)}
                title={HAPTIC_EVENT_META[id].blurb}
                style={{
                  background: `rgba(73, 197, 177, ${0.08 + lit * 0.8})`,
                  border: `1px solid ${lit > 0.02 ? ZONE_ACCENT : 'var(--border-strong)'}`,
                  borderRadius: 'var(--radius-pill, 999px)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontFamily: '"Rajdhani", sans-serif',
                  fontWeight: 600,
                  padding: '6px 12px',
                  fontSize: 13
                }}
                type="button"
              >
                {HAPTIC_EVENT_META[id].label}
              </button>
            )
          })}
        </div>
      </section>

      <section style={{ ...panel, display: 'grid', gap: 14 }}>
        <span style={label}>Events — gain, threshold, and per-zone routing</span>
        {HAPTIC_EVENT_IDS.map((id) => (
          <div key={id} style={{ display: 'grid', gap: 8, borderTop: '1px solid var(--border-default)', paddingTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--text-primary)', fontFamily: '"Rajdhani", sans-serif', fontWeight: 600 }}>
                {HAPTIC_EVENT_META[id].label}
                {HAPTIC_EVENT_META[id].heuristic ? <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · heuristic</span> : null}
              </span>
              <Toggle
                checked={config.events[id].enabled}
                text={config.events[id].enabled ? tt(language, 'hapticsZonal.on') : tt(language, 'hapticsZonal.off')}
                onChange={(next) => void persist({ events: { [id]: { enabled: next } } })}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(180px, 1fr))', gap: 12 }}>
              <Slider
                text={tt(language, 'hapticsZonal.gain')}
                min={0}
                max={1}
                step={0.05}
                value={config.events[id].gain}
                display={`${Math.round(config.events[id].gain * 100)}%`}
                onChange={(gain) => setConfig((c) => ({ ...c, events: { ...c.events, [id]: { ...c.events[id], gain } } }))}
                onCommit={(gain) => void persist({ events: { [id]: { gain } } })}
              />
              <Slider
                text={tt(language, 'hapticsZonal.threshold')}
                min={0}
                max={1}
                step={0.05}
                value={config.events[id].threshold}
                display={`${Math.round(config.events[id].threshold * 100)}%`}
                onChange={(threshold) => setConfig((c) => ({ ...c, events: { ...c.events, [id]: { ...c.events[id], threshold } } }))}
                onCommit={(threshold) => void persist({ events: { [id]: { threshold } } })}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {HAPTIC_ZONE_IDS.map((zone) => (
                <Slider
                  key={zone}
                  text={HAPTIC_ZONE_META[zone].label}
                  min={0}
                  max={1}
                  step={0.05}
                  value={config.events[id].zones[zone]}
                  display={`${Math.round(config.events[id].zones[zone] * 100)}%`}
                  onChange={(weight) =>
                    setConfig((c) => ({
                      ...c,
                      events: { ...c.events, [id]: { ...c.events[id], zones: { ...c.events[id].zones, [zone]: weight } } }
                    }))
                  }
                  onCommit={(weight) => void persist({ events: { [id]: { zones: { [zone]: weight } } } })}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section style={{ ...panel, display: 'grid', gap: 14 }}>
        <span style={label}>Zones — enable, gain, and label</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))', gap: 12 }}>
          {HAPTIC_ZONE_IDS.map((zone) => (
            <div key={zone} style={{ display: 'grid', gap: 8, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <input
                  onChange={(event) => void persist({ zones: { [zone]: { label: event.target.value } } })}
                  style={{
                    background: 'var(--surface-sunken)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    padding: '4px 8px',
                    height: 28,
                    width: '60%'
                  }}
                  value={config.zones[zone].label}
                />
                <Toggle
                  checked={config.zones[zone].enabled}
                  text={config.zones[zone].enabled ? tt(language, 'hapticsZonal.on') : tt(language, 'hapticsZonal.off')}
                  onChange={(next) => void persist({ zones: { [zone]: { enabled: next } } })}
                />
              </div>
              <Slider
                text={tt(language, 'hapticsZonal.zoneGain')}
                min={0}
                max={1}
                step={0.05}
                value={config.zones[zone].gain}
                display={`${Math.round(config.zones[zone].gain * 100)}%`}
                onChange={(gain) => setConfig((c) => ({ ...c, zones: { ...c.zones, [zone]: { ...c.zones[zone], gain } } }))}
                onCommit={(gain) => void persist({ zones: { [zone]: { gain } } })}
              />
            </div>
          ))}
        </div>
      </section>

      <section style={{ ...panel, display: 'grid', gap: 12 }}>
        <span style={label}>{tt(language, 'hapticsZonal.secondaryBuzzer')}</span>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
          A single motor does not address zones — it receives the strongest zone as a pulse. Reuses the same tactile serial hub (companion
          <code> Z&lt;freq&gt;:&lt;ms&gt;</code>). It never uses the primary SIM-X device.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Toggle
            checked={config.arduino.enabled}
            text={config.arduino.enabled ? tt(language, 'hapticsZonal.active') : tt(language, 'hapticsZonal.turnOn')}
            onChange={(next) => void persist({ arduino: { enabled: next } })}
          />
          <select
            disabled={busy}
            onChange={(event) => void persist({ arduino: { deviceId: event.target.value } })}
            style={{
              background: 'var(--surface-sunken)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              height: 30,
              minWidth: 220
            }}
            value={config.arduino.deviceId}
          >
            <option value="">Select a device…</option>
            {missingDevice ? <option value={config.arduino.deviceId}>{tt(language, 'hapticsZonal.deviceUnavailable')}</option> : null}
            {buzzerDevices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
                {device.connected ? '' : ` (${tt(language, 'hapticsZonal.offline')})`}
              </option>
            ))}
          </select>
          <div style={{ width: 200 }}>
            <Slider
              text={tt(language, 'hapticsZonal.frequency')}
              min={20}
              max={200}
              step={5}
              value={config.arduino.frequencyHz}
              display={`${config.arduino.frequencyHz} Hz`}
              onChange={(frequencyHz) => setConfig((c) => ({ ...c, arduino: { ...c.arduino, frequencyHz } }))}
              onCommit={(frequencyHz) => void persist({ arduino: { frequencyHz } })}
            />
          </div>
        </div>
      </section>
    </div>
  )
}

export default HapticsZonalView
