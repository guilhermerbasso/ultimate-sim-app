import { type CSSProperties, type ReactElement, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AlertEvent,
  AlertOutput,
  AlertOutputButtonbox,
  AlertOutputButtonboxPreset,
  AlertOutputSecondScreen,
  AlertOutputSerial,
  AlertOutputSound,
  AlertRuleConfig,
  AlertSeverity,
  AlertSoundPayload,
  AlertsConfig,
  AlertsConfigPatch
} from '../../../shared/alerts'
import type { AppViewProps } from '../App'
import { SectionExportImport } from '../components/SectionExportImport'

// ─── Styles ────────────────────────────────────────────────────────────────

const card: CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 'var(--radius-sm)',
  padding: '14px 16px'
}

const label: CSSProperties = { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.6 }

const severityColor: Record<AlertSeverity, string> = {
  info: 'var(--accent-primary)',
  warning: 'var(--accent-warning)',
  critical: 'var(--accent-danger)'
}

const buttonStyle: CSSProperties = {
  padding: '7px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'transparent',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 12
}

const inputBase: CSSProperties = {
  background: 'rgba(0,0,0,0.25)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 'var(--radius-sm)',
  color: '#fff',
  padding: '6px 8px',
  minWidth: 80
}

// ─── Rule metadata ─────────────────────────────────────────────────────────

type RuleKey =
  | 'pitLimiter'
  | 'flags'
  | 'lowFuel'
  | 'shiftPoint'
  | 'incidentLimit'
  | 'tyrePressure'
  | 'tyreTemp'
  | 'brakeTemp'
  | 'drsAvailable'
  | 'blueFlag'

interface RuleMeta {
  key: RuleKey
  title: string
  description: string
}

const RULES: RuleMeta[] = [
  { key: 'pitLimiter', title: 'Pit limiter', description: 'Alerta na borda quando o limitador de pit liga.' },
  { key: 'flags', title: 'Bandeiras', description: 'Azul, amarela, preta e preta/laranja.' },
  { key: 'lowFuel', title: 'Combustível baixo', description: 'Avisa ao cruzar abaixo do número de voltas.' },
  { key: 'shiftPoint', title: 'Ponto de troca', description: 'Usa shiftIndicatorPct ou RPM/maxRpm.' },
  { key: 'incidentLimit', title: 'Incidentes', description: 'Avisa quando faltam poucos incidentes para o limite.' },
  { key: 'tyrePressure', title: 'Pressão de pneu', description: 'Sai da janela de pressão por canto (kPa).' },
  { key: 'tyreTemp', title: 'Temperatura de pneu', description: 'Pneu acima do limite por canto (°C).' },
  { key: 'brakeTemp', title: 'Temperatura de freio', description: 'Freio acima do limite por canto (°C).' },
  { key: 'drsAvailable', title: 'DRS disponível', description: 'Alerta quando DRS fica disponível na zona.' },
  { key: 'blueFlag', title: 'Bandeira azul (dedicada)', description: 'Canal separado para saídas exclusivas da azul.' }
]

// ─── IPC helpers ───────────────────────────────────────────────────────────

function patchConfig(patch: AlertsConfigPatch): Promise<AlertsConfig> {
  return window.ipc.invoke<AlertsConfig>('alerts:setConfig', patch)
}

function getConfig(): Promise<AlertsConfig> {
  return window.ipc.invoke<AlertsConfig>('alerts:getConfig')
}

// ─── Audio ─────────────────────────────────────────────────────────────────

type AudioContextWindow = Window & { webkitAudioContext?: typeof AudioContext }

let alertAudioContext: AudioContext | null = null

function ensureAlertAudio(): AudioContext {
  const AudioCtor = window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext
  if (!AudioCtor) throw new Error('AudioContext is not available in this environment.')
  if (!alertAudioContext) alertAudioContext = new AudioCtor()
  return alertAudioContext
}

function finiteNumber(valueToCheck: unknown): valueToCheck is number {
  return typeof valueToCheck === 'number' && Number.isFinite(valueToCheck)
}

function playBeep(severity: AlertSeverity, sound?: AlertSoundPayload): void {
  try {
    const context = ensureAlertAudio()
    const start = (): void => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const now = context.currentTime
      const defaultFrequency = severity === 'critical' ? 880 : severity === 'warning' ? 660 : 440
      const defaultDurationMs = severity === 'critical' ? 320 : 180
      const frequency = finiteNumber(sound?.toneHz) ? sound.toneHz : defaultFrequency
      const durationMs = finiteNumber(sound?.durationMs) ? sound.durationMs : defaultDurationMs
      const duration = Math.max(0.02, Math.min(5, durationMs / 1000))
      const volume = Math.max(0, Math.min(1, finiteNumber(sound?.volume) ? sound.volume : 0.18))
      let cleaned = false
      const cleanup = (): void => {
        if (cleaned) return
        cleaned = true
        oscillator.disconnect()
        gain.disconnect()
      }

      oscillator.type = severity === 'critical' ? 'square' : 'sine'
      oscillator.frequency.setValueAtTime(Math.max(50, Math.min(8000, frequency)), now)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(now)
      oscillator.stop(now + duration + 0.03)
      oscillator.onended = cleanup
      window.setTimeout(cleanup, Math.ceil((duration + 0.6) * 1000))
    }

    if (context.state === 'suspended') {
      void context.resume().then(start).catch(() => undefined)
      return
    }
    start()
  } catch {
    // Browser audio can be blocked until the first user gesture.
  }
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ─── View ──────────────────────────────────────────────────────────────────

export default function AlertsView({ showToast }: AppViewProps): ReactElement {
  const [config, setConfig] = useState<AlertsConfig | null>(null)
  const [events, setEvents] = useState<AlertEvent[]>([])
  const audioEnabled = useRef(true)

  useEffect(() => {
    getConfig()
      .then((nextConfig) => {
        setConfig(nextConfig)
        audioEnabled.current = nextConfig.audioEnabled
      })
      .catch(() => showToast('Não foi possível carregar os alertas.', 'error'))

    const unsubscribe = window.ipc.subscribe<AlertEvent>('alerts:event', (event) => {
      setEvents((current) => [event, ...current].slice(0, 40))
      if (audioEnabled.current) playBeep(event.severity, event.sound)
    })

    return unsubscribe
  }, [showToast])

  const updateConfig = async (patch: AlertsConfigPatch): Promise<void> => {
    try {
      const nextConfig = await patchConfig(patch)
      setConfig(nextConfig)
      audioEnabled.current = nextConfig.audioEnabled
    } catch {
      showToast('Não foi possível salvar a configuração de alertas.', 'error')
    }
  }

  const reloadConfig = async (): Promise<void> => {
    try {
      const nextConfig = await getConfig()
      setConfig(nextConfig)
      audioEnabled.current = nextConfig.audioEnabled
    } catch {
      showToast('Não foi possível recarregar os alertas.', 'error')
    }
  }

  if (!config) {
    return <div style={card}>Carregando alertas…</div>
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
        <div>
          <div style={label}>Módulo de alertas</div>
          <h3 style={{ margin: '4px 0 0' }}>Condições de corrida em tempo real</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <SectionExportImport sectionId="alerts" label="Alertas" onImported={() => void reloadConfig()} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              checked={config.audioEnabled}
              onChange={(event) => updateConfig({ audioEnabled: event.target.checked })}
              type="checkbox"
            />
            Áudio ligado
          </label>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {RULES.map((meta) => (
          <RuleEditor
            key={meta.key}
            meta={meta}
            config={config}
            onPatch={(patch) => updateConfig(patch)}
          />
        ))}
      </div>

      <Feed events={events} onClear={() => setEvents([])} />
    </div>
  )
}

// ─── Per-rule editor ───────────────────────────────────────────────────────

function RuleEditor({
  meta,
  config,
  onPatch
}: {
  meta: RuleMeta
  config: AlertsConfig
  onPatch(patch: AlertsConfigPatch): void
}): ReactElement {
  const rule = readRule(config, meta.key)
  const outputs = rule?.outputs ?? []

  const patchRule = (changes: Partial<AlertRuleConfig>): void => {
    onPatch(buildRulePatch(meta.key, changes))
  }

  const patchOutputs = (next: AlertOutput[] | undefined): void => {
    patchRule({ outputs: next })
  }

  return (
    <div style={card}>
      <label style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <strong>{meta.title}</strong>
        <input
          checked={rule?.enabled === true}
          onChange={(event) => patchRule({ enabled: event.target.checked })}
          type="checkbox"
        />
      </label>
      <p style={{ margin: '8px 0 12px', opacity: 0.72, fontSize: 13 }}>{meta.description}</p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <SeverityField
          value={rule?.severity}
          onChange={(severity) => patchRule({ severity })}
        />
        <NumberField
          labelText="Cooldown (ms)"
          min={0}
          max={60000}
          step={100}
          value={rule?.cooldownMs}
          onCommit={(value) => patchRule({ cooldownMs: value })}
        />
        <NumberField
          labelText="Repetir (ms)"
          min={0}
          max={600000}
          step={500}
          value={rule?.repeatMs}
          onCommit={(value) => patchRule({ repeatMs: value })}
        />
      </div>

      <ThresholdFields meta={meta} config={config} onPatch={onPatch} />

      <OutputsEditor outputs={outputs} onChange={patchOutputs} />
    </div>
  )
}

function ThresholdFields({
  meta,
  config,
  onPatch
}: {
  meta: RuleMeta
  config: AlertsConfig
  onPatch(patch: AlertsConfigPatch): void
}): ReactElement | null {
  switch (meta.key) {
    case 'lowFuel':
      return (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <NumberField
            labelText="Voltas"
            max={20}
            min={0.5}
            step={0.5}
            value={config.lowFuel.lapsThreshold}
            onCommit={(lapsThreshold) =>
              onPatch({ lowFuel: { lapsThreshold: lapsThreshold ?? config.lowFuel.lapsThreshold } })
            }
          />
        </div>
      )
    case 'shiftPoint':
      return (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <NumberField
            labelText="Indicador %"
            max={100}
            min={50}
            step={1}
            value={Math.round(config.shiftPoint.shiftIndicatorPct * 100)}
            onCommit={(value) =>
              onPatch({ shiftPoint: { shiftIndicatorPct: (value ?? 92) / 100 } })
            }
          />
          <NumberField
            labelText="RPM %"
            max={100}
            min={50}
            step={1}
            value={Math.round(config.shiftPoint.rpmPct * 100)}
            onCommit={(value) => onPatch({ shiftPoint: { rpmPct: (value ?? 96) / 100 } })}
          />
        </div>
      )
    case 'incidentLimit':
      return (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <NumberField
            labelText="Restantes"
            max={20}
            min={0}
            step={1}
            value={config.incidentLimit.remainingThreshold}
            onCommit={(remainingThreshold) =>
              onPatch({
                incidentLimit: {
                  remainingThreshold:
                    remainingThreshold ?? config.incidentLimit.remainingThreshold
                }
              })
            }
          />
        </div>
      )
    case 'tyrePressure':
      return (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <NumberField
            labelText="Mín (kPa)"
            max={500}
            min={0}
            step={1}
            value={config.tyrePressure?.minKpa}
            onCommit={(minKpa) => onPatch({ tyrePressure: { minKpa } })}
          />
          <NumberField
            labelText="Máx (kPa)"
            max={500}
            min={0}
            step={1}
            value={config.tyrePressure?.maxKpa}
            onCommit={(maxKpa) => onPatch({ tyrePressure: { maxKpa } })}
          />
        </div>
      )
    case 'tyreTemp':
      return (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <NumberField
            labelText="Máx (°C)"
            max={250}
            min={0}
            step={1}
            value={config.tyreTemp?.maxC}
            onCommit={(maxC) => onPatch({ tyreTemp: { maxC } })}
          />
        </div>
      )
    case 'brakeTemp':
      return (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <NumberField
            labelText="Máx (°C)"
            max={1200}
            min={0}
            step={5}
            value={config.brakeTemp?.maxC}
            onCommit={(maxC) => onPatch({ brakeTemp: { maxC } })}
          />
        </div>
      )
    default:
      return null
  }
}

// ─── Output editor ─────────────────────────────────────────────────────────

function OutputsEditor({
  outputs,
  onChange
}: {
  outputs: AlertOutput[]
  onChange(next: AlertOutput[] | undefined): void
}): ReactElement {
  const addOutput = (kind: AlertOutput['kind']): void => {
    const next: AlertOutput = createDefaultOutput(kind)
    onChange([...outputs, next])
  }

  const updateOutput = (index: number, next: AlertOutput): void => {
    const copy = [...outputs]
    copy[index] = next
    onChange(copy)
  }

  const removeOutput = (index: number): void => {
    const copy = outputs.filter((_, i) => i !== index)
    onChange(copy.length > 0 ? copy : undefined)
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={label}>Saídas</span>
        <button type="button" style={buttonStyle} onClick={() => addOutput('buttonbox')}>+ ButtonBox</button>
        <button type="button" style={buttonStyle} onClick={() => addOutput('serial')}>+ Serial</button>
        <button type="button" style={buttonStyle} onClick={() => addOutput('secondScreen')}>+ 2ª tela</button>
        <button type="button" style={buttonStyle} onClick={() => addOutput('sound')}>+ Som</button>
      </div>
      {outputs.length === 0 && (
        <div style={{ opacity: 0.6, fontSize: 12 }}>
          Sem saídas configuradas — esse alerta só aparece no feed e toca o beep padrão.
        </div>
      )}
      {outputs.map((output, index) => (
        <OutputRow
          key={`${output.kind}-${index}`}
          output={output}
          onChange={(next) => updateOutput(index, next)}
          onRemove={() => removeOutput(index)}
        />
      ))}
    </div>
  )
}

function createDefaultOutput(kind: AlertOutput['kind']): AlertOutput {
  switch (kind) {
    case 'buttonbox':
      return { kind: 'buttonbox', preset: 'startLedFlash', enabled: true, durationMs: 800 }
    case 'serial':
      return { kind: 'serial', template: '${type}:${value}', enabled: true }
    case 'secondScreen':
      return { kind: 'secondScreen', slot: 'alert', template: '${message}', enabled: true }
    case 'sound':
      return { kind: 'sound', enabled: true }
  }
}

function OutputRow({
  output,
  onChange,
  onRemove
}: {
  output: AlertOutput
  onChange(next: AlertOutput): void
  onRemove(): void
}): ReactElement {
  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 'var(--radius-sm)',
        padding: '10px 12px',
        background: 'rgba(0,0,0,0.18)',
        display: 'grid',
        gap: 8
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{outputTitle(output)}</strong>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
            <input
              type="checkbox"
              checked={output.enabled !== false}
              onChange={(event) => onChange({ ...output, enabled: event.target.checked })}
            />
            Ativo
          </label>
          <button type="button" style={buttonStyle} onClick={onRemove}>Remover</button>
        </div>
      </div>
      {output.kind === 'buttonbox' && (
        <ButtonboxFields output={output} onChange={(next) => onChange(next)} />
      )}
      {output.kind === 'serial' && (
        <SerialFields output={output} onChange={(next) => onChange(next)} />
      )}
      {output.kind === 'secondScreen' && (
        <SecondScreenFields output={output} onChange={(next) => onChange(next)} />
      )}
      {output.kind === 'sound' && (
        <SoundFields output={output} onChange={(next) => onChange(next)} />
      )}
    </div>
  )
}

function outputTitle(output: AlertOutput): string {
  switch (output.kind) {
    case 'buttonbox':
      return `ButtonBox · ${output.preset}`
    case 'serial':
      return `Serial · ${output.deviceId ?? 'primary'}`
    case 'secondScreen':
      return `2ª tela · slot "${output.slot}"`
    case 'sound':
      return 'Som personalizado'
  }
}

function ButtonboxFields({
  output,
  onChange
}: {
  output: AlertOutputButtonbox
  onChange(next: AlertOutputButtonbox): void
}): ReactElement {
  const presets: AlertOutputButtonboxPreset[] = [
    'startLedFlash',
    'revLightsPulse',
    'shiftBlink',
    'oledMessage',
    'bigNum'
  ]
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <SelectField
        labelText="Preset"
        value={output.preset}
        onChange={(value) => onChange({ ...output, preset: value as AlertOutputButtonboxPreset })}
        options={presets.map((preset) => ({ value: preset, label: preset }))}
      />
      <NumberField
        labelText="Duração (ms)"
        min={0}
        max={60000}
        step={100}
        value={output.durationMs}
        onCommit={(durationMs) => onChange({ ...output, durationMs })}
      />
      {output.preset === 'revLightsPulse' && (
        <NumberField
          labelText="Rev level"
          min={0}
          max={4}
          step={1}
          value={output.revLevel}
          onCommit={(revLevel) => onChange({ ...output, revLevel })}
        />
      )}
      {output.preset === 'oledMessage' && (
        <>
          <TextField
            labelText="OLED L1"
            value={output.oledLine1 ?? ''}
            onCommit={(oledLine1) => onChange({ ...output, oledLine1 })}
            placeholder="${message}"
          />
          <TextField
            labelText="OLED L2"
            value={output.oledLine2 ?? ''}
            onCommit={(oledLine2) => onChange({ ...output, oledLine2 })}
          />
          <TextField
            labelText="OLED L3"
            value={output.oledLine3 ?? ''}
            onCommit={(oledLine3) => onChange({ ...output, oledLine3 })}
          />
        </>
      )}
      {output.preset === 'bigNum' && (
        <TextField
          labelText="BigNum"
          value={output.bigNumValue ?? ''}
          onCommit={(bigNumValue) => onChange({ ...output, bigNumValue })}
          placeholder="${value}"
        />
      )}
    </div>
  )
}

function SerialFields({
  output,
  onChange
}: {
  output: AlertOutputSerial
  onChange(next: AlertOutputSerial): void
}): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <TextField
        labelText="Device id"
        value={output.deviceId ?? ''}
        onCommit={(deviceId) => onChange({ ...output, deviceId: deviceId || undefined })}
        placeholder="primary"
      />
      <TextField
        labelText="Template"
        value={output.template}
        onCommit={(template) => onChange({ ...output, template })}
        placeholder="${type}:${value}"
        wide
      />
    </div>
  )
}

function SecondScreenFields({
  output,
  onChange
}: {
  output: AlertOutputSecondScreen
  onChange(next: AlertOutputSecondScreen): void
}): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <TextField
        labelText="Slot"
        value={output.slot}
        onCommit={(slot) => onChange({ ...output, slot })}
        placeholder="alert"
      />
      <TextField
        labelText="Template"
        value={output.template ?? ''}
        onCommit={(template) => onChange({ ...output, template: template || undefined })}
        placeholder="${message}"
        wide
      />
    </div>
  )
}

function SoundFields({
  output,
  onChange
}: {
  output: AlertOutputSound
  onChange(next: AlertOutputSound): void
}): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <NumberField
        labelText="Tom (Hz)"
        min={50}
        max={8000}
        step={10}
        value={output.toneHz}
        onCommit={(toneHz) => onChange({ ...output, toneHz })}
      />
      <NumberField
        labelText="Duração (ms)"
        min={0}
        max={5000}
        step={50}
        value={output.durationMs}
        onCommit={(durationMs) => onChange({ ...output, durationMs })}
      />
      <NumberField
        labelText="Volume (0-1)"
        min={0}
        max={1}
        step={0.05}
        value={output.volume}
        onCommit={(volume) => onChange({ ...output, volume })}
      />
    </div>
  )
}

// ─── Live feed ─────────────────────────────────────────────────────────────

function Feed({ events, onClear }: { events: AlertEvent[]; onClear(): void }): ReactElement {
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div>
          <div style={label}>Feed ao vivo</div>
          <strong>{events.length > 0 ? `${events.length} eventos recentes` : 'Aguardando eventos'}</strong>
        </div>
        <button onClick={onClear} style={buttonStyle} type="button">
          Limpar feed
        </button>
      </div>
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {events.length === 0 && (
          <div style={{ opacity: 0.7 }}>
            Selecione a fonte <strong>Demo (mock)</strong> em Telemetria para validar o ponto de troca.
          </div>
        )}
        {events.map((event) => (
          <div
            key={event.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '86px 96px 1fr',
              gap: 10,
              alignItems: 'center',
              border: `1px solid ${severityColor[event.severity]}66`,
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              background: `${severityColor[event.severity]}18`
            }}
          >
            <span style={{ opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{formatTime(event.timestamp)}</span>
            <span style={{ color: severityColor[event.severity], fontWeight: 700, textTransform: 'uppercase' }}>
              {event.severity}
            </span>
            <span>{event.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Field primitives ──────────────────────────────────────────────────────

function SeverityField({
  value,
  onChange
}: {
  value: AlertSeverity | undefined
  onChange(value: AlertSeverity | undefined): void
}): ReactElement {
  return (
    <SelectField
      labelText="Severidade"
      value={value ?? ''}
      onChange={(next) => onChange(next ? (next as AlertSeverity) : undefined)}
      options={[
        { value: '', label: 'Padrão' },
        { value: 'info', label: 'Info' },
        { value: 'warning', label: 'Warning' },
        { value: 'critical', label: 'Critical' }
      ]}
    />
  )
}

function NumberField({
  labelText,
  max,
  min,
  onCommit,
  step,
  value
}: {
  labelText: string
  max: number
  min: number
  onCommit(value: number | undefined): void
  step: number
  value: number | undefined
}): ReactElement {
  const stringValue = useMemo(() => (value === undefined ? '' : String(value)), [value])
  return (
    <label style={{ display: 'grid', gap: 4, minWidth: 92 }}>
      <span style={label}>{labelText}</span>
      <input
        max={max}
        min={min}
        onBlur={(event) => onCommit(parseOptionalNumber(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommit(parseOptionalNumber(event.currentTarget.value))
        }}
        step={step}
        style={inputBase}
        type="number"
        key={stringValue}
        defaultValue={stringValue}
      />
    </label>
  )
}

function TextField({
  labelText,
  value,
  onCommit,
  placeholder,
  wide
}: {
  labelText: string
  value: string
  onCommit(value: string): void
  placeholder?: string
  wide?: boolean
}): ReactElement {
  return (
    <label style={{ display: 'grid', gap: 4, minWidth: wide ? 220 : 120, flex: wide ? 1 : undefined }}>
      <span style={label}>{labelText}</span>
      <input
        type="text"
        defaultValue={value}
        placeholder={placeholder}
        key={value}
        onBlur={(event) => onCommit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommit(event.currentTarget.value)
        }}
        style={inputBase}
      />
    </label>
  )
}

function SelectField({
  labelText,
  value,
  onChange,
  options
}: {
  labelText: string
  value: string
  onChange(value: string): void
  options: Array<{ value: string; label: string }>
}): ReactElement {
  return (
    <label style={{ display: 'grid', gap: 4, minWidth: 120 }}>
      <span style={label}>{labelText}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={inputBase}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// ─── Patch helpers ─────────────────────────────────────────────────────────

function readRule(config: AlertsConfig, key: RuleKey): AlertRuleConfig | undefined {
  switch (key) {
    case 'pitLimiter':
      return config.pitLimiter
    case 'flags':
      return config.flags
    case 'lowFuel':
      return config.lowFuel
    case 'shiftPoint':
      return config.shiftPoint
    case 'incidentLimit':
      return config.incidentLimit
    case 'tyrePressure':
      return config.tyrePressure
    case 'tyreTemp':
      return config.tyreTemp
    case 'brakeTemp':
      return config.brakeTemp
    case 'drsAvailable':
      return config.drsAvailable
    case 'blueFlag':
      return config.blueFlag
  }
}

function buildRulePatch(key: RuleKey, changes: Partial<AlertRuleConfig>): AlertsConfigPatch {
  return { [key]: changes } as AlertsConfigPatch
}

function parseOptionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : undefined
}
