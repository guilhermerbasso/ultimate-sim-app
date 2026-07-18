import { type ReactElement, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_MQTT_LOCAL_CONFIG,
  MQTT_CHANNELS,
  stableMqttJson,
  type MqttContractSummary,
  type MqttLocalConfig,
  type MqttTargetStatus
} from '../../../shared/mqtt'
import { tt, type ResolvedLanguage } from '../i18n'

interface MqttSetupPanelProps {
  language?: ResolvedLanguage
  showToast(message: string, tone?: 'success' | 'error' | 'info'): void
}

function stateColor(state: MqttTargetStatus['state'] | undefined): string {
  if (state === 'online') return '#35d07f'
  if (state === 'error') return '#ff5f57'
  if (state === 'connecting' || state === 'reconnecting') return '#f2bd4a'
  return 'var(--muted)'
}

function metric(value: number | undefined): string {
  return String(value ?? 0)
}

export function MqttSetupPanel({ language, showToast }: MqttSetupPanelProps): ReactElement {
  const [config, setConfig] = useState<MqttLocalConfig>({ ...DEFAULT_MQTT_LOCAL_CONFIG })
  const [savedConfig, setSavedConfig] = useState<MqttLocalConfig>({ ...DEFAULT_MQTT_LOCAL_CONFIG })
  const [status, setStatus] = useState<MqttTargetStatus | null>(null)
  const [contract, setContract] = useState<MqttContractSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  useEffect(() => {
    let active = true
    void Promise.all([
      window.ipc.invoke<MqttLocalConfig>(MQTT_CHANNELS.getConfig),
      window.ipc.invoke<MqttTargetStatus>(MQTT_CHANNELS.status),
      window.ipc.invoke<MqttContractSummary>(MQTT_CHANNELS.contract)
    ])
      .then(([loadedConfig, loadedStatus, loadedContract]) => {
        if (!active) return
        setConfig(loadedConfig)
        setSavedConfig(loadedConfig)
        setStatus(loadedStatus)
        setContract(loadedContract)
      })
      .catch((error) => {
        if (active) showToast(error instanceof Error ? error.message : String(error), 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const unsubscribe = window.ipc.subscribe<MqttTargetStatus>(
      MQTT_CHANNELS.statusChanged,
      (nextStatus) => {
        if (active) setStatus(nextStatus)
      }
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [showToast])

  const dirty = useMemo(
    () => stableMqttJson(config) !== stableMqttJson(savedConfig),
    [config, savedConfig]
  )

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const nextStatus = await window.ipc.invoke<MqttTargetStatus>(MQTT_CHANNELS.setConfig, config)
      setConfig(nextStatus.config)
      setSavedConfig(nextStatus.config)
      setStatus(nextStatus)
      setContract(await window.ipc.invoke<MqttContractSummary>(MQTT_CHANNELS.contract))
      showToast(tt(language, 'mqtt.toast.saved'), 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  const reconnect = async (): Promise<void> => {
    setReconnecting(true)
    try {
      const nextStatus = await window.ipc.invoke<MqttTargetStatus>(MQTT_CHANNELS.reconnect)
      setStatus(nextStatus)
      showToast(tt(language, 'mqtt.toast.reconnect'), 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setReconnecting(false)
    }
  }

  const statusText = status
    ? tt(language, `mqtt.state.${status.state}`)
    : tt(language, 'mqtt.state.disabled')
  const stages = [
    {
      label: tt(language, 'mqtt.stage.disabled'),
      active: !config.enabled
    },
    {
      label: tt(language, 'mqtt.stage.loopback'),
      active: config.enabled
    },
    {
      label: tt(language, 'mqtt.stage.acl'),
      active: config.enabled && Boolean(status)
    },
    {
      label: tt(language, 'mqtt.stage.live'),
      active: status?.state === 'online'
    }
  ]

  return (
    <section className="panel-card" style={{ display: 'grid', gap: 16 }} aria-labelledby="mqtt-target-title">
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 420px' }}>
          <div className="field-label" style={{ margin: 0 }}>{tt(language, 'mqtt.eyebrow')}</div>
          <h3 id="mqtt-target-title" style={{ margin: '5px 0 4px', fontSize: 20 }}>
            {tt(language, 'mqtt.title')}
          </h3>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, maxWidth: 720 }}>
            {tt(language, 'mqtt.summary')}
          </p>
        </div>
        <div
          aria-live="polite"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 11px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 999,
            background: 'color-mix(in srgb, var(--panel) 88%, transparent)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '.04em',
            textTransform: 'uppercase'
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: stateColor(status?.state),
              boxShadow: status?.state === 'online' ? '0 0 12px #35d07f' : undefined
            }}
          />
          {statusText}
        </div>
      </div>

      <div
        aria-label={tt(language, 'mqtt.safetyRail')}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 6
        }}
      >
        {stages.map((stage, index) => (
          <div
            key={stage.label}
            style={{
              minWidth: 0,
              padding: '8px 9px',
              borderRadius: 6,
              border: `1px solid ${stage.active ? 'color-mix(in srgb, var(--accent) 55%, var(--border-subtle))' : 'var(--border-subtle)'}`,
              background: stage.active
                ? 'color-mix(in srgb, var(--accent) 12%, var(--panel))'
                : 'color-mix(in srgb, var(--panel) 94%, transparent)',
              color: stage.active ? 'var(--text)' : 'var(--muted)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '.055em',
              textTransform: 'uppercase'
            }}
          >
            <span style={{ opacity: 0.7, marginRight: 5 }}>{index + 1}</span>
            {stage.label}
          </div>
        ))}
      </div>

      <label
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          padding: '12px 0',
          borderTop: '1px solid var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)'
        }}
      >
        <span>
          <strong>{tt(language, 'mqtt.enable')}</strong>
          <small style={{ display: 'block', marginTop: 3, color: 'var(--muted)' }}>
            {tt(language, 'mqtt.enableHelp')}
          </small>
        </span>
        <input
          checked={config.enabled}
          disabled={loading || saving}
          onChange={(event) => setConfig((current) => ({ ...current, enabled: event.currentTarget.checked }))}
          style={{ width: 22, height: 22, accentColor: 'var(--accent)' }}
          type="checkbox"
        />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label style={{ display: 'grid', gap: 7 }}>
          <span className="field-label" style={{ margin: 0 }}>{tt(language, 'mqtt.host')}</span>
          <select
            className="select-field"
            disabled={loading || saving}
            onChange={(event) =>
              setConfig((current) => ({
                ...current,
                host: event.currentTarget.value as MqttLocalConfig['host']
              }))
            }
            value={config.host}
          >
            <option value="127.0.0.1">127.0.0.1</option>
            <option value="::1">::1</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 7 }}>
          <span className="field-label" style={{ margin: 0 }}>{tt(language, 'mqtt.port')}</span>
          <input
            className="text-field"
            disabled={loading || saving}
            max={65533}
            min={1}
            onChange={(event) =>
              setConfig((current) => ({
                ...current,
                port: Number(event.currentTarget.value)
              }))
            }
            type="number"
            value={config.port}
          />
        </label>
        <label style={{ display: 'grid', gap: 7 }}>
          <span className="field-label" style={{ margin: 0 }}>{tt(language, 'mqtt.instance')}</span>
          <input
            className="text-field"
            disabled={loading || saving}
            maxLength={32}
            onChange={(event) =>
              setConfig((current) => ({ ...current, instanceId: event.currentTarget.value.toLowerCase() }))
            }
            pattern="[a-z0-9][a-z0-9_-]*"
            spellCheck={false}
            type="text"
            value={config.instanceId}
          />
        </label>
        <label style={{ display: 'grid', gap: 7 }}>
          <span className="field-label" style={{ margin: 0 }}>{tt(language, 'mqtt.rate')}</span>
          <select
            className="select-field"
            disabled={loading || saving}
            onChange={(event) =>
              setConfig((current) => ({ ...current, telemetryRateHz: Number(event.currentTarget.value) }))
            }
            value={config.telemetryRateHz}
          >
            {[1, 2, 5, 10].map((rate) => (
              <option key={rate} value={rate}>{rate} Hz</option>
            ))}
          </select>
        </label>
      </div>

      <div
        style={{
          display: 'grid',
          gap: 10,
          padding: 12,
          borderRadius: 8,
          border: '1px solid color-mix(in srgb, #f2bd4a 40%, var(--border-subtle))',
          background: 'color-mix(in srgb, #f2bd4a 7%, var(--panel))'
        }}
      >
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14 }}>
          <span>
            <strong>{tt(language, 'mqtt.commands')}</strong>
            <small style={{ display: 'block', marginTop: 3, color: 'var(--muted)' }}>
              {tt(language, 'mqtt.commandsHelp')}
            </small>
          </span>
          <input
            checked={config.commandsEnabled}
            disabled={loading || saving || !config.enabled}
            onChange={(event) =>
              setConfig((current) => ({ ...current, commandsEnabled: event.currentTarget.checked }))
            }
            style={{ width: 22, height: 22, accentColor: '#f2bd4a' }}
            type="checkbox"
          />
        </label>
        <small style={{ color: 'var(--muted)' }}>{tt(language, 'mqtt.noDriving')}</small>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 8
        }}
      >
        {[
          [tt(language, 'mqtt.metric.published'), metric(status?.metrics.published)],
          [tt(language, 'mqtt.metric.queue'), metric(status?.queueDepth)],
          [tt(language, 'mqtt.metric.reconnects'), metric(status?.metrics.reconnects)],
          [tt(language, 'mqtt.metric.resyncs'), metric(status?.metrics.resyncs)],
          [tt(language, 'mqtt.metric.denied'), metric(status?.metrics.denied)],
          [tt(language, 'mqtt.metric.dropped'), metric(status?.metrics.overloadDropped)]
        ].map(([label, value]) => (
          <div
            key={label}
            style={{
              padding: '9px 10px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              background: 'color-mix(in srgb, var(--panel) 92%, transparent)'
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
            <div style={{ color: 'var(--muted)', fontSize: 11 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 7 }}>
        <div className="field-label" style={{ margin: 0 }}>{tt(language, 'mqtt.endpoints')}</div>
        <code style={{ color: 'var(--muted)', fontSize: 12, overflowWrap: 'anywhere' }}>
          {status?.brokerUrl ?? `mqtt://${config.host}:${config.port}`} · {tt(language, 'mqtt.publisher')}
        </code>
        <code style={{ color: 'var(--muted)', fontSize: 12, overflowWrap: 'anywhere' }}>
          {status?.readerUrl ?? `mqtt://${config.host}:${config.port + 1}`} · {tt(language, 'mqtt.reader')}
        </code>
        <code style={{ color: 'var(--muted)', fontSize: 12, overflowWrap: 'anywhere' }}>
          {status?.commandUrl ?? `mqtt://${config.host}:${config.port + 2}`} · {tt(language, 'mqtt.commandListener')}
        </code>
      </div>

      {contract && (
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 650 }}>{tt(language, 'mqtt.topicContract')}</summary>
          <div style={{ display: 'grid', gap: 5, marginTop: 9 }}>
            {Object.values(contract.topics).map((topic) => (
              <code key={topic} style={{ color: 'var(--muted)', fontSize: 11, overflowWrap: 'anywhere' }}>
                {topic}
              </code>
            ))}
          </div>
        </details>
      )}

      {status?.lastError && (
        <p role="alert" style={{ margin: 0, color: 'var(--danger, #ff5f57)', fontSize: 12 }}>
          {status.lastError}
        </p>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button
          className="ghost-action"
          disabled={loading || saving || reconnecting || !savedConfig.enabled}
          onClick={() => void reconnect()}
          type="button"
        >
          {reconnecting ? tt(language, 'mqtt.reconnecting') : tt(language, 'mqtt.reconnect')}
        </button>
        <button
          className={dirty ? 'primary-action' : 'ghost-action'}
          disabled={loading || saving || !dirty}
          onClick={() => void save()}
          type="button"
        >
          {saving ? tt(language, 'mqtt.saving') : tt(language, 'mqtt.save')}
        </button>
      </div>

      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12 }}>
        {tt(language, 'mqtt.localOnly')}
      </p>
    </section>
  )
}
