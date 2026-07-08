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
import { useDevices } from '../lib/devices/DeviceRegistry'
import { SectionExportImport } from '../components/SectionExportImport'

const BLINK_PATTERNS: Array<{ id: RevlightsBlinkPattern; label: string }> = [
  { id: 'solid', label: 'Constante (sem blink)' },
  { id: 'slow', label: 'Lento (2 Hz)' },
  { id: 'fast', label: 'Rápido (4 Hz)' },
  { id: 'strobe', label: 'Estrobo (8 Hz)' }
]

const FLAG_LABELS: Record<keyof RevlightsConfig['flagColors'], string> = {
  yellow: 'Amarela',
  blue: 'Azul',
  white: 'Branca (lento)',
  red: 'Vermelha',
  meatball: 'Meatball (laranja)',
  greenWhiteCheckered: 'Verde / quadriculada'
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

function RevlightsView({ showToast }: AppViewProps): ReactElement {
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
      showToast('Conecte o ButtonBox antes de ativar as rev lights.', 'error')
      return
    }
    setBusy(true)
    try {
      const saved = await window.ipc.invoke<RevlightsConfig>('revlights:setEnabled', !config.enabled)
      setConfig(saved)
      showToast(saved.enabled ? 'Rev lights ativadas.' : 'Rev lights pausadas.', 'success')
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
    const segments = [...config.segments, { startPct, color: '#33D17C', label: `Segmento ${config.segments.length + 1}` }]
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
            <h3 style={{ margin: '8px 0 4px', fontSize: 26 }}>Configuração rica</h3>
            <p style={{ margin: 0, color: 'rgba(255,255,255,0.62)' }}>
              Colores, faixas e shift point. O app calcula o nível a partir da telemetria e envia
              <code> R&lt;lvl&gt; </code> + <code> B&lt;0|1&gt; </code> para o SIM-X.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <SectionExportImport sectionId="revlights" label="Rev lights" onImported={() => void reloadConfig()} />
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
              {config.enabled ? 'Parar' : 'Ativar'}
            </button>
          </div>
        </div>

        <div className="divider" style={{ margin: '16px 0' }} />

        <span style={label}>Presets</span>
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
              <strong style={{ display: 'block' }}>Modo F1</strong>
              <small style={{ color: 'rgba(255,255,255,0.66)' }}>
                Acende apenas nos últimos {rpmWindowPct}% do RPM, varre verde → âmbar → vermelho no preview
                e pisca no ponto de troca.
              </small>
            </span>
          </label>
          <p className="helper-text" style={{ marginBottom: 0 }}>
            Nota: as cores exatas no hardware dependem do firmware SIM-X atual, que renderiza cores por nível.
            O app já entrega o comportamento F1 hoje via <code>R&lt;lvl&gt;</code> + <code>B&lt;0|1&gt;</code>;
            RGB por LED fica para firmware futuro.
          </p>
        </div>

        <div className="divider" style={{ margin: '16px 0' }} />

        <span style={label}>Quantidade de LEDs</span>
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
          <strong style={{ minWidth: 64, textAlign: 'right' }}>{config.ledCount} LEDs</strong>
        </div>
        <p className="helper-text">
          O firmware atual aciona {REVLIGHTS_DEVICE_LED_COUNT} LEDs físicos; valores maiores são escalonados
          para usar todo o strip futuro (sem perder a UX de preview).
        </p>

        <div className="divider" style={{ margin: '16px 0' }} />

        <span style={label}>Pontos de RPM</span>
        <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Acende nos últimos N% do RPM</span>
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
              Últimos {rpmWindowPct}% · início em {Math.round(config.startRpmPct * 100)}%
            </strong>
            <small style={{ color: 'rgba(255,255,255,0.56)' }}>
              Ex.: 10% = LEDs apagados até ~90% do giro, como F1/GT.
            </small>
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Ponto de troca / blink (% maxRpm)</span>
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
            <span>Usar shiftIndicatorPct do iRacing quando disponível</span>
          </label>
        </div>
      </article>

      <div style={{ display: 'grid', gap: 18 }}>
        <article style={panel}>
          <span style={label}>Preview ao vivo</span>
          <h3 style={{ margin: '8px 0' }}>Strip atual</h3>
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
            <span style={label}>Simular nível</span>
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
              <dt>Nível real</dt>
              <dd>{status?.level ?? 0}</dd>
            </div>
            <div>
              <dt>Shift</dt>
              <dd>{status?.shiftActive ? 'PISCANDO' : '—'}</dd>
            </div>
            <div>
              <dt>RPM</dt>
              <dd>
                {(status?.rpm ?? 0).toFixed(0)} / {(status?.maxRpm ?? 0).toFixed(0)}
              </dd>
            </div>
            <div>
              <dt>Error</dt>
              <dd style={{ color: status?.lastError ? 'var(--accent-warning)' : 'inherit' }}>{status?.lastError ?? '—'}</dd>
            </div>
          </dl>
        </article>

        <article style={panel}>
          <span style={label}>Segmentos por cor</span>
          <h3 style={{ margin: '8px 0' }}>Faixas (% maxRpm)</h3>
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
                  aria-label={`Color do segmento ${index + 1}`}
                  onBlur={() => void persist({ segments: config.segments, preset: 'custom' })}
                  onChange={(event) => updateSegment(index, { color: event.target.value })}
                  style={{ height: 36, width: '100%', border: 'none', background: 'transparent' }}
                  type="color"
                  value={segment.color}
                />
                <input
                  aria-label={`Rótulo do segmento ${index + 1}`}
                  className="text-field"
                  onBlur={() => void persist({ segments: config.segments, preset: 'custom' })}
                  onChange={(event) => updateSegment(index, { label: event.target.value })}
                  placeholder={`Segmento ${index + 1}`}
                  value={segment.label ?? ''}
                />
                <input
                  aria-label={`Início % do segmento ${index + 1}`}
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
                  Remover
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
                  segments: [...config.segments, { startPct, color: '#33D17C', label: `Segmento ${config.segments.length + 1}` }],
                  preset: 'custom'
                })
              }}
              type="button"
            >
              Adicionar faixa
            </button>
          </div>
        </article>

        <article style={panel}>
          <span style={label}>Shift indicator</span>
          <h3 style={{ margin: '8px 0' }}>Pisca azul (B)</h3>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              checked={config.shiftBlink}
              onChange={(event) => void persist({ shiftBlink: event.target.checked })}
              type="checkbox"
            />
            <span>Ativar shift blink</span>
          </label>
          <label className="field-label" htmlFor="blink-pattern">Padrão de blink</label>
          <select
            className="select-field wide"
            disabled={!config.shiftBlink}
            id="blink-pattern"
            onChange={(event) => void persist({ shiftBlinkPattern: event.target.value as RevlightsBlinkPattern })}
            value={config.shiftBlinkPattern}
          >
            {BLINK_PATTERNS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="helper-text">
            O firmware faz o blink internamente; o app só envia <code>B1</code> quando o shift ativa, e o padrão
            é usado apenas no preview visual aqui.
          </p>
        </article>

        <article style={panel}>
          <span style={label}>Colores de bandeira</span>
          <h3 style={{ margin: '8px 0' }}>Paleta (preview-only)</h3>
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
                  aria-label={`Color da bandeira ${FLAG_LABELS[key]}`}
                  onBlur={() => void persist({ flagColors: config.flagColors })}
                  onChange={(event) => updateFlagColor(key, event.target.value)}
                  style={{ height: 36, width: '100%', border: 'none', background: 'transparent' }}
                  type="color"
                  value={config.flagColors[key]}
                />
                <span>{FLAG_LABELS[key]}</span>
              </div>
            ))}
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <input
              checked={config.flagBlink}
              onChange={(event) => void persist({ flagBlink: event.target.checked })}
              type="checkbox"
            />
            <span>Pulsar quando uma bandeira estiver ativa</span>
          </label>
        </article>
      </div>
    </section>
  )
}

export default RevlightsView
