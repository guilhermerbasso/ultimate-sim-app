import { type ReactElement, useEffect, useMemo, useState } from 'react'
import { GENERIC_DEVICE_DEFAULT_BAUD } from '../../../shared/arduino'
import type { AppViewProps } from '../App'
import { useDevices } from '../lib/devices/DeviceRegistry'
import { SectionExportImport } from '../components/SectionExportImport'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function DevicesView({ refreshDeviceState, showToast }: AppViewProps): ReactElement {
  const {
    ports,
    serialDevices,
    deviceConfigs,
    audioOutputs,
    audioOutputsStatus,
    displays,
    primaryDevice: connectedDevice,
    busy,
    audioBusy,
    refreshPorts,
    refreshAudioOutputs,
    refreshDisplays,
    connectPrimary,
    disconnectPrimary,
    testPrimaryOutput,
    addSecondaryDevice,
    removeSecondaryDevice,
    reconnectSecondaryDevice,
    disconnectSecondaryDevice
  } = useDevices()

  const [selectedPath, setSelectedPath] = useState('')
  const [secondaryPath, setSecondaryPath] = useState('')
  const [secondaryLabel, setSecondaryLabel] = useState('')
  const [secondaryBaud, setSecondaryBaud] = useState(GENERIC_DEVICE_DEFAULT_BAUD)

  const secondaryDevices = useMemo(() => serialDevices.filter((device) => device.kind !== 'sim-x'), [serialDevices])
  const offlineSecondaries = useMemo(
    () => deviceConfigs.filter((config) => !serialDevices.some((device) => device.path === config.path)),
    [deviceConfigs, serialDevices]
  )
  const selectedPathUsedBySecondary = serialDevices.some(
    (device) => device.kind !== 'sim-x' && device.path === selectedPath
  )
  const secondaryPathInUse = serialDevices.some((device) => device.path === secondaryPath)

  // Seed the local radio/select defaults once the shared registry has ports.
  // The registry enumerates on app start and stays live via subscriptions, so
  // entering this menu reflects connected devices without reconnecting.
  useEffect(() => {
    if (ports.length === 0) return
    setSelectedPath((current) => current || (ports.find((port) => port.isSimX) ?? ports[0])?.path || '')
    setSecondaryPath(
      (current) =>
        current || ports.find((port) => !port.isSimX && !serialDevices.some((d) => d.path === port.path))?.path || ''
    )
  }, [ports, serialDevices])

  async function searchPorts(): Promise<void> {
    try {
      const nextPorts = await refreshPorts()
      showToast(
        nextPorts.length ? `${nextPorts.length} porta(s) encontrada(s).` : 'Nenhuma porta serial encontrada.',
        'info'
      )
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function connect(): Promise<void> {
    if (!selectedPath) return
    try {
      const device = await connectPrimary(selectedPath)
      await refreshDeviceState()
      showToast(
        `SIM-X conectado em ${device.path} — enviando teste de saída (rev lights + OLED) para confirmar o link…`,
        'success'
      )
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function testOutput(): Promise<void> {
    try {
      showToast('Enviando teste de saída ao SIM-X… observe as rev lights e o OLED.', 'info')
      await testPrimaryOutput()
      showToast('Teste de saída enviado: rev lights varreram e o OLED mostrou “SIM-X CONECTADO”.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function disconnect(): Promise<void> {
    try {
      await disconnectPrimary()
      showToast('Porta serial liberada. O SimHub pode usá-la novamente.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function addSecondary(): Promise<void> {
    const path = secondaryPath.trim()
    if (!path || secondaryPathInUse) return
    const label = secondaryLabel.trim() || path
    try {
      await addSecondaryDevice({ path, label, baud: secondaryBaud, autoConnect: true })
      setSecondaryPath('')
      setSecondaryLabel('')
      setSecondaryBaud(GENERIC_DEVICE_DEFAULT_BAUD)
      showToast(`Dispositivo serial "${label}" conectado em ${path}.`, 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function disconnectSecondary(id: string): Promise<void> {
    try {
      await disconnectSecondaryDevice(id)
      showToast('Dispositivo serial desconectado. Os demais continuam conectados.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function reconnectSecondary(id: string): Promise<void> {
    try {
      await reconnectSecondaryDevice(id)
      showToast('Dispositivo serial reconectado.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function removeSecondary(id: string): Promise<void> {
    try {
      await removeSecondaryDevice(id)
      showToast('Dispositivo serial removido da lista.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  return (
    <section className="view-grid">
      <article className="panel-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">Hub de dispositivos · serial + Windows</span>
            <h3>Central de dispositivos</h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <SectionExportImport sectionId="devices" label="Perfis de dispositivos (ButtonBox/controles)" onImported={() => void refreshDeviceState()} />
            <button className="ghost-action compact" disabled={busy} onClick={() => void searchPorts()} type="button">
              Procurar portas
            </button>
          </div>
        </div>
        <p className="helper-text">
          Este é o hub central: o que você conecta aqui é compartilhado com <strong>todos os outros menus</strong>, sem
          reconectar. Conecte os dispositivos <strong>seriais</strong> (SIM-X ButtonBox, Arduinos extras e iFlag em
          portas COM/USB) abaixo. Saídas de áudio (USB/HDMI) e monitores são gerenciados pelo Windows e aparecem como
          referência compartilhada no fim da página.
        </p>
      </article>

      <section className="view-grid two-columns">
        <article className="panel-card hero-card">
          <div className="panel-heading-row">
            <div>
              <span className="panel-label">SIM-X principal · 115200 8N1</span>
              <h3>ButtonBox primário</h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <SectionExportImport sectionId="simx-identity" label="Identidade do SIM-X primário" onImported={() => void refreshDeviceState()} />
              <span className={`conn-pill ${connectedDevice ? 'online' : 'offline'}`}>
                {connectedDevice ? `● Conectado · ${connectedDevice.path}` : '○ Desconectado'}
              </span>
            </div>
          </div>

          {connectedDevice && (
            <div className="notice-card success device-status-banner">
              <strong>SIM-X conectado • porta {connectedDevice.path}</strong>
              <p>
                Link serial aberto (rev lights + OLED + encoder). Sem iRacing aberto a saída fica ociosa — use{' '}
                <strong>Testar saída</strong> para ver as rev lights varrerem e o OLED escrever no hardware.
              </p>
            </div>
          )}

          <p className="helper-text">
            A porta é exclusiva: feche o SimHub antes de conectar pelo app. O SIM-X continua no caminho legado para
            rev lights, OLED e encoder; dispositivos extras usam conexões secundárias separadas.
          </p>

          <div className="port-list">
            {ports.length === 0 && (
              <p className="empty-state">Clique em “Procurar portas” para listar as portas seriais disponíveis.</p>
            )}
            {ports.map((port) => (
              <label className={`port-item ${selectedPath === port.path ? 'is-selected' : ''}`} key={port.path}>
                <input
                  checked={selectedPath === port.path}
                  disabled={serialDevices.some((device) => device.kind !== 'sim-x' && device.path === port.path)}
                  name="serial-port"
                  onChange={() => setSelectedPath(port.path)}
                  type="radio"
                />
                <span>
                  <strong>
                    {port.path}
                    {port.isSimX && (
                      <em className="muted-pill" style={{ marginLeft: 8 }}>
                        SIM-X
                      </em>
                    )}
                    {serialDevices.some((device) => device.kind !== 'sim-x' && device.path === port.path) && (
                      <em className="muted-pill" style={{ marginLeft: 8 }}>
                        em uso por secundário
                      </em>
                    )}
                  </strong>
                  <small>{port.friendlyName || port.manufacturer || 'Fabricante não identificado'}</small>
                  {(port.vendorId || port.productId) && (
                    <small>
                      VID:{port.vendorId || '????'} · PID:{port.productId || '????'}
                    </small>
                  )}
                </span>
              </label>
            ))}
          </div>

          <div className="action-row">
            <button
              className="primary-action"
              disabled={busy || !selectedPath || selectedPathUsedBySecondary || Boolean(connectedDevice)}
              onClick={() => void connect()}
              type="button"
            >
              Conectar SIM-X
            </button>
            <button
              className="ghost-action"
              disabled={busy || !connectedDevice}
              onClick={() => void testOutput()}
              title="Envia uma varredura de rev lights + mensagem no OLED para confirmar a saída serial (não precisa do iRacing)."
              type="button"
            >
              Testar saída
            </button>
            <button
              className="ghost-action"
              disabled={busy || !connectedDevice}
              onClick={() => void disconnect()}
              type="button"
            >
              Desconectar SIM-X
            </button>
          </div>
        </article>

        <article className="panel-card stats-card">
          <span className="panel-label">Status do SIM-X</span>
          {connectedDevice ? (
            <dl className="status-list">
              <div>
                <dt>Nome</dt>
                <dd>{connectedDevice.name}</dd>
              </div>
              <div>
                <dt>Porta</dt>
                <dd>{connectedDevice.path}</dd>
              </div>
              <div>
                <dt>Fabricante</dt>
                <dd>{connectedDevice.manufacturer ?? '—'}</dd>
              </div>
              <div>
                <dt>Friendly name</dt>
                <dd>{connectedDevice.friendlyName ?? '—'}</dd>
              </div>
              <div>
                <dt>Firmware</dt>
                <dd>{connectedDevice.firmwareVersion ?? 'SIM-X (SimHub protocol)'}</dd>
              </div>
              <div>
                <dt>Protocolo</dt>
                <dd>{connectedDevice.protocolVersion ? `v${connectedDevice.protocolVersion}` : 'SimHub one-letter'}</dd>
              </div>
              <div>
                <dt>Botões HID</dt>
                <dd>{connectedDevice.hidButtons ?? 32}</dd>
              </div>
              <div>
                <dt>Encoders / switches</dt>
                <dd>
                  {connectedDevice.encoders ?? 4} / {connectedDevice.switches ?? '—'}
                </dd>
              </div>
              <div>
                <dt>Conectado em</dt>
                <dd>{new Date(connectedDevice.connectedAt).toLocaleString()}</dd>
              </div>
            </dl>
          ) : (
            <div className="notice-card warning">
              <strong>SIM-X desconectado</strong>
              <p>
                Escolha a COM do ButtonBox e clique em <strong>Conectar SIM-X</strong>. Isso não desconecta Arduinos ou
                iFlag já abertos em outras portas.
              </p>
            </div>
          )}
        </article>
      </section>

      <article className="panel-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">Secundários · Arduinos / iFlag</span>
            <h3>Dispositivos seriais adicionais</h3>
          </div>
        </div>
        <p className="helper-text">
          Conecte cada Arduino extra ou iFlag em sua própria porta. Eles usam a frota serial existente e não assumem o
          papel do SIM-X primário.
        </p>

        <div className="port-list">
          {secondaryDevices.length === 0 && (
            <p className="empty-state">Nenhum dispositivo secundário conectado.</p>
          )}
          {secondaryDevices.map((device) => (
            <div className="port-item is-static" key={device.id}>
              <span>
                <strong>
                  {device.label}
                  <em className={`muted-pill ${device.connected ? 'is-online' : ''}`} style={{ marginLeft: 8 }}>
                    {device.connected ? '● conectado' : '○ desconectado'}
                  </em>
                </strong>
                <small>
                  {device.path} · {device.baud} 8N1 · id <code>{device.id}</code>
                </small>
              </span>
              <div className="action-row compact-row">
                <button
                  className="ghost-action compact"
                  disabled={busy || !device.connected}
                  onClick={() => void disconnectSecondary(device.id)}
                  type="button"
                >
                  Desconectar
                </button>
                <button
                  className="ghost-action compact danger"
                  disabled={busy}
                  onClick={() => void removeSecondary(device.id)}
                  type="button"
                >
                  Esquecer
                </button>
              </div>
            </div>
          ))}
        </div>

        {offlineSecondaries.length > 0 && (
          <div className="config-block">
            <strong>Dispositivos salvos desconectados</strong>
            <ul className="plain-list">
              {offlineSecondaries.map((config) => (
                <li key={`${config.path}-${config.id ?? 'new'}`}>
                  <code>{config.path}</code> · {config.label} · {config.baud} baud
                  {config.id ? (
                    <>
                      <button
                        className="ghost-action compact"
                        disabled={busy}
                        onClick={() => void reconnectSecondary(config.id!)}
                        style={{ marginLeft: 8 }}
                        type="button"
                      >
                        Conectar
                      </button>
                      <button
                        className="ghost-action compact danger"
                        disabled={busy}
                        onClick={() => void removeSecondary(config.id!)}
                        style={{ marginLeft: 6 }}
                        type="button"
                      >
                        Esquecer
                      </button>
                    </>
                  ) : (
                    <em className="muted-pill" style={{ marginLeft: 8 }}>
                      sem id salvo
                    </em>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="config-block">
          <strong>Adicionar secundário</strong>
          <small>Use para iFlag, Arduino companion ou outro CDC serial. Não selecione a porta do SIM-X primário.</small>
          <form
            className="command-row"
            onSubmit={(event) => {
              event.preventDefault()
              void addSecondary()
            }}
            style={{ flexWrap: 'wrap', gap: 8, marginTop: 12 }}
          >
            <select
              className="command-input"
              onChange={(event) => {
                const value = event.target.value
                setSecondaryPath(value)
                const match = ports.find((port) => port.path === value)
                if (match && !secondaryLabel) {
                  setSecondaryLabel(match.friendlyName ?? match.manufacturer ?? value)
                }
              }}
              style={{ minWidth: 220 }}
              value={secondaryPath}
            >
              <option value="">Selecione uma porta…</option>
              {ports.map((port) => {
                const inUse = serialDevices.some((device) => device.path === port.path)
                const reservedForPrimary = port.isSimX
                return (
                  <option disabled={inUse || reservedForPrimary} key={port.path} value={port.path}>
                    {port.path} {port.friendlyName ? `· ${port.friendlyName}` : ''}{' '}
                    {inUse ? '· em uso' : reservedForPrimary ? '· SIM-X primário' : ''}
                  </option>
                )
              })}
            </select>
            <input
              className="command-input"
              onChange={(event) => setSecondaryLabel(event.target.value)}
              placeholder="Rótulo (ex.: iFlag)"
              style={{ minWidth: 180 }}
              type="text"
              value={secondaryLabel}
            />
            <input
              className="command-input"
              max={2000000}
              min={300}
              onChange={(event) => setSecondaryBaud(Number(event.target.value) || GENERIC_DEVICE_DEFAULT_BAUD)}
              placeholder="Baud"
              style={{ width: 120 }}
              type="number"
              value={secondaryBaud}
            />
            <button
              className="primary-action"
              disabled={busy || !secondaryPath || secondaryPathInUse || ports.some((port) => port.path === secondaryPath && port.isSimX)}
              type="submit"
            >
              Conectar secundário
            </button>
          </form>
        </div>
      </article>

      <article className="panel-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">Saídas de áudio · Windows (USB/HDMI/Bluetooth)</span>
            <h3>Dispositivos de som detectados</h3>
          </div>
          <button
            className="ghost-action compact"
            disabled={audioBusy}
            onClick={() => void refreshAudioOutputs(true)}
            type="button"
          >
            Atualizar
          </button>
        </div>
        <p className="helper-text">
          Saídas de áudio são gerenciadas pelo Windows e <strong>não precisam ser conectadas aqui</strong>. Esta mesma
          lista alimenta o menu <strong>Sounds</strong>, onde você escolhe a saída dos alertas do app — sem reconfigurar
          em cada menu.
        </p>
        <div className="port-list">
          {audioOutputs.length === 0 && <p className="empty-state">{audioOutputsStatus}</p>}
          {audioOutputs.map((output) => (
            <div className="port-item is-static" key={output.deviceId}>
              <span>
                <strong>{output.label}</strong>
                <small>Saída de áudio · Windows</small>
              </span>
            </div>
          ))}
        </div>
      </article>

      <article className="panel-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">Monitores · HDMI / DisplayPort</span>
            <h3>Telas disponíveis no Windows</h3>
          </div>
          <button className="ghost-action compact" disabled={busy} onClick={() => void refreshDisplays()} type="button">
            Atualizar
          </button>
        </div>
        <p className="helper-text">
          Os monitores conectados via HDMI/DisplayPort são compartilhados com <strong>Overlays</strong> e{' '}
          <strong>Dashboards</strong> para escolher em qual tela exibir — sem reconfigurar em cada menu.
        </p>
        <div className="port-list">
          {displays.length === 0 && <p className="empty-state">Nenhum monitor detectado.</p>}
          {displays.map((display) => (
            <div className="port-item is-static" key={display.id}>
              <span>
                <strong>
                  {display.label}
                  {display.primary && (
                    <em className="muted-pill" style={{ marginLeft: 8 }}>
                      principal
                    </em>
                  )}
                </strong>
                <small>
                  {display.bounds.width}×{display.bounds.height} · id {display.id}
                </small>
              </span>
            </div>
          ))}
        </div>
      </article>
    </section>
  )
}

export default DevicesView
