import { type CSSProperties, type ReactElement, useEffect, useMemo, useState } from 'react'
import type {
  OledDashboardConfig,
  OledDashboardStatus,
  OledPreset,
  OledPresetId
} from '../../../shared/oled'
import { SectionExportImport } from '../components/SectionExportImport'
import {
  DEFAULT_OLED_CONFIG,
  OLED_MAX_INTERVAL_MS,
  OLED_MIN_INTERVAL_MS,
  formatOledConfigPage,
  normalizeOledConfig
} from '../../../shared/oled'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import type { AppViewProps } from '../App'
import { useDevices } from '../lib/devices/DeviceRegistry'
import { getLatestTelemetry, onTelemetry } from '../lib/telemetry'

const shell: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(320px, 0.95fr) minmax(360px, 1.05fr)',
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

const buttonBase: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 'var(--radius-sm)',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 800,
  padding: '10px 13px'
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function includesPage(pages: OledPresetId[], id: OledPresetId): boolean {
  return pages.includes(id)
}

export default function OledDashboardView({ showToast }: AppViewProps): ReactElement {
  // Resolve the connected ButtonBox from the shared device registry.
  const { primaryDevice: connectedDevice } = useDevices()
  const [presets, setPresets] = useState<OledPreset[]>([])
  const [config, setConfig] = useState<OledDashboardConfig>(() =>
    normalizeOledConfig({ ...DEFAULT_OLED_CONFIG, updatedAt: new Date().toISOString() })
  )
  const [status, setStatus] = useState<OledDashboardStatus | null>(null)
  const [snap, setSnap] = useState<TelemetrySnapshot | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void Promise.all([
      window.ipc.invoke<OledPreset[]>('oled:getPresets'),
      window.ipc.invoke<OledDashboardConfig>('oled:getConfig'),
      window.ipc.invoke<OledDashboardStatus>('oled:getStatus'),
      getLatestTelemetry()
    ])
      .then(([nextPresets, nextConfig, nextStatus, latest]) => {
        setPresets(nextPresets)
        setConfig(nextConfig)
        setStatus(nextStatus)
        setSnap(latest)
      })
      .catch((error) => showToast(getErrorMessage(error), 'error'))

    const unsubscribeTelemetry = onTelemetry(setSnap)
    const unsubscribeStatus = window.ipc.subscribe<OledDashboardStatus>('oled:status', setStatus)
    return () => {
      unsubscribeTelemetry()
      unsubscribeStatus()
    }
  }, [showToast])

  const rendered = useMemo(() => formatOledConfigPage(config, snap), [config, snap])
  const selectedPresets = useMemo(
    () => config.pages.map((id) => presets.find((preset) => preset.id === id)).filter(Boolean) as OledPreset[],
    [config.pages, presets]
  )

  async function reloadConfig(): Promise<void> {
    try {
      const [nextPresets, nextConfig] = await Promise.all([
        window.ipc.invoke<OledPreset[]>('oled:getPresets'),
        window.ipc.invoke<OledDashboardConfig>('oled:getConfig')
      ])
      setPresets(nextPresets)
      setConfig(nextConfig)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function persistConfig(next: Partial<OledDashboardConfig>): Promise<void> {
    setBusy(true)
    try {
      const saved = await window.ipc.invoke<OledDashboardConfig>('oled:setConfig', next)
      setConfig(saved)
      showToast('OLED configuration saved.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function togglePreset(id: OledPresetId): Promise<void> {
    const pages = includesPage(config.pages, id)
      ? config.pages.filter((page) => page !== id)
      : [...config.pages, id]
    if (pages.length === 0) {
      showToast('Keep at least one page active.', 'error')
      return
    }
    await persistConfig({ pages, activeIndex: Math.min(config.activeIndex, pages.length - 1), intervalMs: config.intervalMs })
  }

  async function movePreset(id: OledPresetId, direction: -1 | 1): Promise<void> {
    const index = config.pages.indexOf(id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= config.pages.length) return
    const pages = [...config.pages]
    const [item] = pages.splice(index, 1)
    pages.splice(target, 0, item)
    await persistConfig({ pages, activeIndex: target, intervalMs: config.intervalMs })
  }

  async function setActivePage(activeIndex: number): Promise<void> {
    setBusy(true)
    try {
      const saved = await window.ipc.invoke<OledDashboardConfig>('oled:setActivePage', activeIndex)
      setConfig(saved)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function setStreaming(enabled: boolean): Promise<void> {
    setBusy(true)
    try {
      const saved = await window.ipc.invoke<OledDashboardConfig>('oled:setStreaming', enabled)
      setConfig(saved)
      showToast(enabled ? 'OLED streaming active.' : 'OLED streaming stopped. Port released.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const canStream = Boolean(connectedDevice) && config.pages.length > 0 && !busy
  const activeName = presets.find((preset) => preset.id === rendered.presetId)?.name ?? rendered.title
  const nextIndex = (config.activeIndex + 1) % config.pages.length
  const previousIndex = (config.activeIndex - 1 + config.pages.length) % config.pages.length

  return (
    <section style={shell}>
      <article style={{ ...panel, minHeight: 620 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <span style={label}>Preset builder</span>
            <h3 style={{ margin: '8px 0 4px', fontSize: 28 }}>Ready-made pages, no code</h3>
            <p style={{ margin: 0, color: 'rgba(255,255,255,0.62)' }}>
              Choose what goes on the OLED and order the rotation during the stint.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <SectionExportImport sectionId="oled" label="OLED dashboard" onImported={() => void reloadConfig()} />
            <button
              disabled={!canStream}
              onClick={() => void setStreaming(!config.enabled)}
              style={{
                ...buttonBase,
                background: config.enabled ? 'var(--accent-danger)' : 'var(--accent-primary)',
                color: config.enabled ? '#fff' : '#06100f',
                opacity: canStream ? 1 : 0.45
              }}
              type="button"
            >
              {config.enabled ? 'Stop' : 'Enable'} streaming
            </button>
          </div>
        </div>

        <div style={{ marginTop: 18, display: 'grid', gap: 10 }}>
          {presets.map((preset) => {
            const selected = includesPage(config.pages, preset.id)
            return (
              <div
                key={preset.id}
                style={{
                  border: `1px solid ${selected ? 'rgba(var(--accent-rgb),0.72)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 'var(--radius-sm)',
                  background: selected ? 'rgba(var(--accent-rgb),0.1)' : 'rgba(255,255,255,0.035)',
                  padding: 13
                }}
              >
                <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
                  <input
                    checked={selected}
                    disabled={busy}
                    onChange={() => void togglePreset(preset.id)}
                    style={{ marginTop: 4 }}
                    type="checkbox"
                  />
                  <span style={{ flex: 1 }}>
                    <strong style={{ display: 'block', fontSize: 16 }}>{preset.name}</strong>
                    <small style={{ color: 'rgba(255,255,255,0.62)', lineHeight: 1.45 }}>{preset.description}</small>
                    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
                      {preset.fields.map((field) => (
                        <em
                          key={field}
                          style={{
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'rgba(255,255,255,0.7)',
                            fontSize: 11,
                            fontStyle: 'normal',
                            padding: '3px 8px'
                          }}
                        >
                          {field}
                        </em>
                      ))}
                    </span>
                  </span>
                </label>
              </div>
            )
          })}
        </div>
      </article>

      <div style={{ display: 'grid', gap: 18 }}>
        <article style={panel}>
          <span style={label}>Order and rotation</span>
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {selectedPresets.map((preset, index) => (
              <div
                key={preset.id}
                style={{
                  alignItems: 'center',
                  background: index === config.activeIndex ? 'rgba(232,105,32,0.18)' : 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 'var(--radius-sm)',
                  display: 'grid',
                  gap: 8,
                  gridTemplateColumns: '32px 1fr auto auto auto',
                  padding: '9px 10px'
                }}
              >
                <strong style={{ color: 'var(--accent-primary)' }}>{index + 1}</strong>
                <span>{preset.name}</span>
                <button disabled={busy} onClick={() => void movePreset(preset.id, -1)} style={miniButton} type="button">↑</button>
                <button disabled={busy} onClick={() => void movePreset(preset.id, 1)} style={miniButton} type="button">↓</button>
                <button disabled={busy} onClick={() => void setActivePage(index)} style={miniButton} type="button">View</button>
              </div>
            ))}
          </div>

          <label style={{ display: 'grid', gap: 8, marginTop: 16 }}>
            <span style={label}>Rotation interval</span>
            <input
              max={OLED_MAX_INTERVAL_MS}
              min={OLED_MIN_INTERVAL_MS}
              onBlur={() => void persistConfig({ pages: config.pages, activeIndex: config.activeIndex, intervalMs: config.intervalMs })}
              onChange={(event) => setConfig((current) => normalizeOledConfig({ ...current, intervalMs: Number(event.target.value) }))}
              step={250}
              style={{ accentColor: 'var(--accent-primary)' }}
              type="range"
              value={config.intervalMs}
            />
            <strong>{(config.intervalMs / 1000).toFixed(2)}s per page</strong>
          </label>
        </article>

        <article style={{ ...panel, position: 'relative', overflow: 'hidden' }}>
          <div
            aria-hidden="true"
            style={{
              background: 'var(--surface-base)',
              inset: 0,
              position: 'absolute'
            }}
          />
          <div style={{ position: 'relative' }}>
            <span style={label}>Preview 128×64</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginTop: 6 }}>
              <h3 style={{ margin: 0 }}>{activeName}</h3>
              <span style={{ color: status?.lastError ? 'var(--accent-warning)' : 'var(--accent-primary)', fontSize: 12, fontWeight: 800 }}>
                {config.enabled ? '● enviando' : '○ parado'}
              </span>
            </div>

            <div
              style={{
                aspectRatio: '2 / 1',
                background: '#050809',
                border: '10px solid #171b1f',
                borderRadius: 'var(--radius-sm)',
                
                color: '#cffff6',
                display: 'grid',
                fontFamily: '"Courier New", monospace',
                gap: 6,
                marginTop: 14,
                padding: 22,
                placeContent: rendered.kind === 'bignum' ? 'center' : 'center start',
                
              }}
            >
              {rendered.kind === 'bignum' ? (
                <strong style={{ fontSize: 64, letterSpacing: 2, textAlign: 'center' }}>{rendered.value || '—'}</strong>
              ) : (
                <>
                  <strong style={{ fontSize: 22, letterSpacing: 1 }}>{rendered.lines[0]}</strong>
                  <strong style={{ fontSize: 22, letterSpacing: 1 }}>{rendered.lines[1]}</strong>
                  <strong style={{ fontSize: 22, letterSpacing: 1 }}>{rendered.lines[2]}</strong>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button disabled={busy} onClick={() => void setActivePage(previousIndex)} style={{ ...buttonBase, background: 'rgba(255,255,255,0.06)' }} type="button">
                Previous page
              </button>
              <button disabled={busy} onClick={() => void setActivePage(nextIndex)} style={{ ...buttonBase, background: 'rgba(255,255,255,0.06)' }} type="button">
                Next page
              </button>
            </div>

            <p style={{ color: 'rgba(255,255,255,0.56)', fontSize: 12, marginBottom: 0 }}>
              {connectedDevice
                ? `Port ${connectedDevice.path}. Close streaming before using SimHub.`
                : 'Connect the ButtonBox in Devices before enabling streaming.'}
              {status?.lastError ? ` Error: ${status.lastError}` : ''}
            </p>
          </div>
        </article>
      </div>
    </section>
  )
}

const miniButton: CSSProperties = {
  ...buttonBase,
  background: 'rgba(255,255,255,0.055)',
  borderRadius: 'var(--radius-sm)',
  padding: '6px 9px'
}
