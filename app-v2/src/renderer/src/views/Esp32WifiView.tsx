import { type ReactElement, useEffect, useMemo, useState } from 'react'
import type { PortInfo } from '../../../shared/ipc'
import type { AppViewProps } from '../App'
import { tt } from '../i18n'

interface WifiCompanionDevice {
  id: string
  name: string
  host: string
  port: number
  addresses: string[]
  txt?: Record<string, string>
}

interface WifiTransportStatus {
  id: string
  host: string
  port: number
  connected: boolean
  connecting: boolean
  lastLineAt?: string
  error?: string
}

interface ProvisionResult {
  ok: boolean
  message: string
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function Esp32WifiView({ showToast, language }: AppViewProps): ReactElement {
  const [devices, setDevices] = useState<WifiCompanionDevice[]>([])
  const [statuses, setStatuses] = useState<WifiTransportStatus[]>([])
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [board, setBoard] = useState<'esp32' | 'esp32s3'>('esp32s3')
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')
  const [manualHost, setManualHost] = useState('')
  const [manualPort, setManualPort] = useState(47650)
  const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState<string[]>([])

  const connectedIds = useMemo(
    () => new Set(statuses.filter((status) => status.connected).map((status) => status.id)),
    [statuses]
  )

  useEffect(() => {
    void refreshStatus()
    const offStatus = window.ipc.subscribe<WifiTransportStatus | WifiTransportStatus[]>('esp32:statusChanged', (payload) => {
      if (Array.isArray(payload)) setStatuses(payload)
      else setStatuses((current) => [...current.filter((entry) => entry.id !== payload.id), payload])
    })
    const offLine = window.ipc.subscribe<{ id: string; line: string }>('esp32:line', (payload) => {
      setLines((current) => [`${payload.id}: ${payload.line}`, ...current].slice(0, 80))
    })
    return () => {
      offStatus()
      offLine()
    }
  }, [])

  async function refreshStatus(): Promise<void> {
    const list = await window.ipc.invoke<WifiTransportStatus[]>('esp32:status').catch(() => [] as WifiTransportStatus[])
    setStatuses(list)
  }

  async function discover(): Promise<void> {
    setBusy(true)
    try {
      const list = await window.ipc.invoke<WifiCompanionDevice[]>('esp32:discover')
      setDevices(list)
      showToast(
        list.length ? tt(language, 'esp32Wifi.discoveredToast', { count: list.length }) : tt(language, 'esp32Wifi.noneFoundToast'),
        'info'
      )
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function loadPorts(): Promise<void> {
    setBusy(true)
    try {
      const list = await window.api.listPorts()
      setPorts(list)
      setSelectedPort((current) => current || list.find((port) => !port.isSimX)?.path || list[0]?.path || '')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function connect(device: WifiCompanionDevice): Promise<void> {
    setBusy(true)
    try {
      await window.ipc.invoke('esp32:connect', device)
      await refreshStatus()
      showToast(tt(language, 'esp32Wifi.connectedToast', { host: device.host, port: device.port }), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function connectManual(): Promise<void> {
    if (!manualHost.trim()) return
    await connect({ id: `${manualHost}:${manualPort}`, name: tt(language, 'esp32Wifi.manualDeviceName'), host: manualHost.trim(), port: manualPort, addresses: [] })
  }

  async function disconnect(id: string): Promise<void> {
    setBusy(true)
    try {
      await window.ipc.invoke('esp32:disconnect', id)
      await refreshStatus()
      showToast(tt(language, 'esp32Wifi.disconnectedToast'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function provision(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.ipc.invoke<ProvisionResult>('esp32:provisionOverUsb', {
        port: selectedPort,
        ssid,
        password,
        board,
        flash: true
      })
      showToast(result.message, result.ok ? 'success' : 'error')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function sendQuery(id: string): Promise<void> {
    try {
      await window.ipc.invoke('esp32:send', id, '?')
      showToast(tt(language, 'esp32Wifi.handshakeToast'), 'info')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  return (
    <section className="view-grid">
      <article className="panel-card hero-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">{tt(language, 'esp32Wifi.eyebrow')}</span>
            <h3>{tt(language, 'esp32Wifi.title')}</h3>
          </div>
          <button className="ghost-action compact" disabled={busy} onClick={() => void discover()} type="button">
            {tt(language, 'esp32Wifi.discover')}
          </button>
        </div>
        <p className="helper-text">
          {tt(language, 'esp32Wifi.heroHelp')}
        </p>
      </article>

      <section className="view-grid two-columns">
        <article className="panel-card">
          <div className="panel-heading-row">
            <div>
              <span className="panel-label">{tt(language, 'esp32Wifi.usbProvisioning')}</span>
              <h3>{tt(language, 'esp32Wifi.sendCredentials')}</h3>
            </div>
            <button className="ghost-action compact" disabled={busy} onClick={() => void loadPorts()} type="button">
              {tt(language, 'esp32Wifi.listPorts')}
            </button>
          </div>
          <div className="form-grid">
            <label>
              {tt(language, 'esp32Wifi.board')}
              <select value={board} onChange={(event) => setBoard(event.target.value as 'esp32' | 'esp32s3')}>
                <option value="esp32s3">ESP32‑S3 WROOM‑1 Type‑C</option>
                <option value="esp32">ESP32 DevKit</option>
              </select>
            </label>
            <label>
              {tt(language, 'esp32Wifi.usbPort')}
              <select value={selectedPort} onChange={(event) => setSelectedPort(event.target.value)}>
                <option value="">{tt(language, 'esp32Wifi.selectPort')}</option>
                {ports.map((port) => (
                  <option key={port.path} value={port.path}>
                    {port.path} {port.isSimX ? tt(language, 'esp32Wifi.doNotUseSimx') : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tt(language, 'esp32Wifi.ssid')}
              <input value={ssid} onChange={(event) => setSsid(event.target.value)} placeholder={tt(language, 'esp32Wifi.ssidPlaceholder')} />
            </label>
            <label>
              {tt(language, 'esp32Wifi.password')}
              <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" type="password" />
            </label>
          </div>
          <button className="primary-action" disabled={busy || !selectedPort || !ssid.trim()} onClick={() => void provision()} type="button">
            {tt(language, 'esp32Wifi.flashProvision')}
          </button>
          <p className="helper-text">{tt(language, 'esp32Wifi.provisionHelp')}</p>
        </article>

        <article className="panel-card">
          <div className="panel-heading-row">
            <div>
              <span className="panel-label">{tt(language, 'esp32Wifi.manualConnection')}</span>
              <h3>{tt(language, 'esp32Wifi.manualTitle')}</h3>
            </div>
          </div>
          <div className="form-grid">
            <label>
              {tt(language, 'esp32Wifi.hostIp')}
              <input value={manualHost} onChange={(event) => setManualHost(event.target.value)} placeholder="192.168.1.50" />
            </label>
            <label>
              {tt(language, 'esp32Wifi.tcpPort')}
              <input value={manualPort} onChange={(event) => setManualPort(Number(event.target.value) || 47650)} type="number" />
            </label>
          </div>
          <button className="primary-action" disabled={busy || !manualHost.trim()} onClick={() => void connectManual()} type="button">
            {tt(language, 'esp32Wifi.connectManual')}
          </button>
        </article>
      </section>

      <article className="panel-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">{tt(language, 'esp32Wifi.devicesFound')}</span>
            <h3>{tt(language, 'esp32Wifi.mdnsTitle')}</h3>
          </div>
        </div>
        <div className="port-list">
          {devices.length === 0 && <p className="empty-state">{tt(language, 'esp32Wifi.emptyDevices')}</p>}
          {devices.map((device) => {
            const connected = connectedIds.has(device.id)
            return (
              <div className={`port-item ${connected ? 'is-selected' : ''}`} key={device.id}>
                <div>
                  <strong>{device.name}</strong>
                  <small>{device.host}:{device.port}</small>
                </div>
                <div className="inline-actions">
                  <button className="ghost-action compact" disabled={busy} onClick={() => void sendQuery(device.id)} type="button">
                    {tt(language, 'esp32Wifi.handshake')}
                  </button>
                  {connected ? (
                    <button className="ghost-action compact" disabled={busy} onClick={() => void disconnect(device.id)} type="button">
                      {tt(language, 'esp32Wifi.disconnect')}
                    </button>
                  ) : (
                    <button className="primary-action compact" disabled={busy} onClick={() => void connect(device)} type="button">
                      {tt(language, 'esp32Wifi.connect')}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </article>

      <article className="panel-card scroll-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">{tt(language, 'esp32Wifi.statusRx')}</span>
            <h3>{tt(language, 'esp32Wifi.receivedLines')}</h3>
          </div>
        </div>
        {statuses.map((status) => (
          <p className="helper-text" key={status.id}>
            {status.connected ? '🟢' : '⚪'} {status.id} · {status.host}:{status.port} {status.error ? `· ${status.error}` : ''}
          </p>
        ))}
        <pre className="serial-log">{lines.join('\n') || tt(language, 'esp32Wifi.noData')}</pre>
      </article>
    </section>
  )
}
