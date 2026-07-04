import { type ReactElement, useEffect, useMemo, useState } from 'react'
import type { PortInfo } from '../../../shared/ipc'
import type { AppViewProps } from '../App'

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

export default function Esp32WifiView({ showToast }: AppViewProps): ReactElement {
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
        list.length ? `${list.length} ESP32 encontrado(s) via mDNS.` : 'Nenhum ESP32 encontrado. Confira se está na mesma rede.',
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
      showToast(`ESP32 conectado em ${device.host}:${device.port}.`, 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function connectManual(): Promise<void> {
    if (!manualHost.trim()) return
    await connect({ id: `${manualHost}:${manualPort}`, name: 'ESP32 manual', host: manualHost.trim(), port: manualPort, addresses: [] })
  }

  async function disconnect(id: string): Promise<void> {
    setBusy(true)
    try {
      await window.ipc.invoke('esp32:disconnect', id)
      await refreshStatus()
      showToast('ESP32 desconectado.', 'success')
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
      showToast('Handshake enviado (?).', 'info')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  return (
    <section className="view-grid">
      <article className="panel-card hero-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">ESP32 Wi‑Fi · Phase 3</span>
            <h3>Companion ESP32 por USB ou Wi‑Fi</h3>
          </div>
          <button className="ghost-action compact" disabled={busy} onClick={() => void discover()} type="button">
            Descobrir mDNS
          </button>
        </div>
        <p className="helper-text">
          Grave/provisione via USB e depois conecte pela rede local. Flash e Wi‑Fi precisam ser validados na bancada;
          no macOS o app fica protegido quando arduino-cli/core ESP32 ou mDNS não estiverem instalados.
        </p>
      </article>

      <section className="view-grid two-columns">
        <article className="panel-card">
          <div className="panel-heading-row">
            <div>
              <span className="panel-label">Provisionamento USB</span>
              <h3>Enviar SSID e senha</h3>
            </div>
            <button className="ghost-action compact" disabled={busy} onClick={() => void loadPorts()} type="button">
              Listar portas
            </button>
          </div>
          <div className="form-grid">
            <label>
              Placa
              <select value={board} onChange={(event) => setBoard(event.target.value as 'esp32' | 'esp32s3')}>
                <option value="esp32s3">ESP32‑S3 WROOM‑1 Type‑C</option>
                <option value="esp32">ESP32 DevKit</option>
              </select>
            </label>
            <label>
              Porta USB
              <select value={selectedPort} onChange={(event) => setSelectedPort(event.target.value)}>
                <option value="">Selecione…</option>
                {ports.map((port) => (
                  <option key={port.path} value={port.path}>
                    {port.path} {port.isSimX ? '(SIM-X — não usar)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              SSID Wi‑Fi 2.4 GHz
              <input value={ssid} onChange={(event) => setSsid(event.target.value)} placeholder="MinhaRede" />
            </label>
            <label>
              Senha
              <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" type="password" />
            </label>
          </div>
          <button className="primary-action" disabled={busy || !selectedPort || !ssid.trim()} onClick={() => void provision()} type="button">
            Gravar firmware + provisionar Wi‑Fi
          </button>
          <p className="helper-text">O app compila/envia o sketch com arduino-cli e manda WIFI:&lt;ssid&gt;:&lt;senha&gt; por serial.</p>
        </article>

        <article className="panel-card">
          <div className="panel-heading-row">
            <div>
              <span className="panel-label">Conexão manual</span>
              <h3>IP/host do ESP32</h3>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Host/IP
              <input value={manualHost} onChange={(event) => setManualHost(event.target.value)} placeholder="192.168.1.50" />
            </label>
            <label>
              Porta TCP
              <input value={manualPort} onChange={(event) => setManualPort(Number(event.target.value) || 47650)} type="number" />
            </label>
          </div>
          <button className="primary-action" disabled={busy || !manualHost.trim()} onClick={() => void connectManual()} type="button">
            Conectar manualmente
          </button>
        </article>
      </section>

      <article className="panel-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">Dispositivos encontrados</span>
            <h3>ESP32 via mDNS (_ubbcompanion._tcp)</h3>
          </div>
        </div>
        <div className="port-list">
          {devices.length === 0 && <p className="empty-state">Clique em “Descobrir mDNS” ou conecte manualmente pelo IP.</p>}
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
                    Handshake
                  </button>
                  {connected ? (
                    <button className="ghost-action compact" disabled={busy} onClick={() => void disconnect(device.id)} type="button">
                      Desconectar
                    </button>
                  ) : (
                    <button className="primary-action compact" disabled={busy} onClick={() => void connect(device)} type="button">
                      Conectar
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
            <span className="panel-label">Status / RX</span>
            <h3>Linhas recebidas</h3>
          </div>
        </div>
        {statuses.map((status) => (
          <p className="helper-text" key={status.id}>
            {status.connected ? '🟢' : '⚪'} {status.id} · {status.host}:{status.port} {status.error ? `· ${status.error}` : ''}
          </p>
        ))}
        <pre className="serial-log">{lines.join('\n') || 'Sem dados ainda.'}</pre>
      </article>
    </section>
  )
}
