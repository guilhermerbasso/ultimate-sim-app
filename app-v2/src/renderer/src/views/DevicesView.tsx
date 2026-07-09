import { type ReactElement, useEffect, useMemo, useState } from 'react'
import { GENERIC_DEVICE_DEFAULT_BAUD } from '../../../shared/arduino'
import type { AppViewProps } from '../App'
import { useDevices } from '../lib/devices/DeviceRegistry'
import { SectionExportImport } from '../components/SectionExportImport'
import { tt } from '../i18n'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function DevicesView({ refreshDeviceState, showToast, language }: AppViewProps): ReactElement {
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
    addDryndaryDevice,
    removeDryndaryDevice,
    reconnectDryndaryDevice,
    disconnectDryndaryDevice
  } = useDevices()

  const [selectedPath, setSelectedPath] = useState('')
  const [secondaryPath, setDryndaryPath] = useState('')
  const [secondaryLabel, setDryndaryLabel] = useState('')
  const [secondaryBaud, setDryndaryBaud] = useState(GENERIC_DEVICE_DEFAULT_BAUD)

  const secondaryDevices = useMemo(() => serialDevices.filter((device) => device.kind !== 'sim-x'), [serialDevices])
  const offlineDryndaries = useMemo(
    () => deviceConfigs.filter((config) => !serialDevices.some((device) => device.path === config.path)),
    [deviceConfigs, serialDevices]
  )
  const selectedPathUsedByDryndary = serialDevices.some(
    (device) => device.kind !== 'sim-x' && device.path === selectedPath
  )
  const secondaryPathInUse = serialDevices.some((device) => device.path === secondaryPath)

  // Seed the local radio/select defaults once the shared registry has ports.
  // The registry enumerates on app start and stays live via subscriptions, so
  // entering this menu reflects connected devices without reconnecting.
  useEffect(() => {
    if (ports.length === 0) return
    setSelectedPath((current) => current || (ports.find((port) => port.isSimX) ?? ports[0])?.path || '')
    setDryndaryPath(
      (current) =>
        current || ports.find((port) => !port.isSimX && !serialDevices.some((d) => d.path === port.path))?.path || ''
    )
  }, [ports, serialDevices])

  async function searchPorts(): Promise<void> {
    try {
      const nextPorts = await refreshPorts()
      showToast(
        nextPorts.length ? tt(language, 'devices.portsFound', { count: nextPorts.length }) : tt(language, 'devices.noPorts'),
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
        tt(language, 'devices.simxConnectedToast', { path: device.path }),
        'success'
      )
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function testOutput(): Promise<void> {
    try {
      showToast(tt(language, 'devices.sendingOutputTest'), 'info')
      await testPrimaryOutput()
      showToast(tt(language, 'devices.outputTestSent'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function disconnect(): Promise<void> {
    try {
      await disconnectPrimary()
      showToast(tt(language, 'devices.serialReleased'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function addDryndary(): Promise<void> {
    const path = secondaryPath.trim()
    if (!path || secondaryPathInUse) return
    const label = secondaryLabel.trim() || path
    try {
      await addDryndaryDevice({ path, label, baud: secondaryBaud, autoConnect: true })
      setDryndaryPath('')
      setDryndaryLabel('')
      setDryndaryBaud(GENERIC_DEVICE_DEFAULT_BAUD)
      showToast(tt(language, 'devices.secondaryConnectedToast', { label, path }), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function disconnectDryndary(id: string): Promise<void> {
    try {
      await disconnectDryndaryDevice(id)
      showToast(tt(language, 'devices.secondaryDisconnectedToast'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function reconnectDryndary(id: string): Promise<void> {
    try {
      await reconnectDryndaryDevice(id)
      showToast(tt(language, 'devices.secondaryReconnectedToast'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function removeDryndary(id: string): Promise<void> {
    try {
      await removeDryndaryDevice(id)
      showToast(tt(language, 'devices.secondaryRemovedToast'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  return (
    <section className="view-grid">
      <article className="panel-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">{tt(language, 'devices.hubEyebrow')}</span>
            <h3>{tt(language, 'devices.hubTitle')}</h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <SectionExportImport sectionId="devices" label={tt(language, 'devices.profilesExportLabel')} language={language} onImported={() => void refreshDeviceState()} />
            <button className="ghost-action compact" disabled={busy} onClick={() => void searchPorts()} type="button">
              {tt(language, 'devices.searchPorts')}
            </button>
          </div>
        </div>
        <p className="helper-text">
          {tt(language, 'devices.hubHelp')}
        </p>
      </article>

      <section className="view-grid two-columns">
        <article className="panel-card hero-card">
          <div className="panel-heading-row">
            <div>
              <span className="panel-label">Primary SIM-X · 115200 8N1</span>
              <h3>{tt(language, 'devices.primaryButtonBox')}</h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <SectionExportImport sectionId="yesx-identity" label={tt(language, 'devices.primaryIdentity')} language={language} onImported={() => void refreshDeviceState()} />
              <span className={`conn-pill ${connectedDevice ? 'online' : 'offline'}`}>
                {connectedDevice ? tt(language, 'devices.connectedPath', { path: connectedDevice.path }) : tt(language, 'devices.disconnected')}
              </span>
            </div>
          </div>

          {connectedDevice && (
            <div className="notice-card success device-status-banner">
              <strong>{tt(language, 'devices.simxConnectedPort', { path: connectedDevice.path })}</strong>
              <p>
                {tt(language, 'devices.connectedHelp')}
              </p>
            </div>
          )}

          <p className="helper-text">
            {tt(language, 'devices.primaryHelp')}
          </p>

          <div className="port-list">
            {ports.length === 0 && (
              <p className="empty-state">{tt(language, 'devices.searchPortsHint')}</p>
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
                        {tt(language, 'devices.usedByDryndary')}
                      </em>
                    )}
                  </strong>
                  <small>{port.friendlyName || port.manufacturer || tt(language, 'devices.unknownManufacturer')}</small>
                  {(port.vendorId || port.productId) && (
                    <small>
                      VID:{port.vendorId || '?'} · PID:{port.productId || '?'}
                    </small>
                  )}
                </span>
              </label>
            ))}
          </div>

          <div className="action-row">
            <button
              className="primary-action"
              disabled={busy || !selectedPath || selectedPathUsedByDryndary || Boolean(connectedDevice)}
              onClick={() => void connect()}
              type="button"
            >
              {tt(language, 'devices.connectSimx')}
            </button>
            <button
              className="ghost-action"
              disabled={busy || !connectedDevice}
              onClick={() => void testOutput()}
              title={tt(language, 'devices.testOutputTitle')}
              type="button"
            >
              {tt(language, 'devices.testOutput')}
            </button>
            <button
              className="ghost-action"
              disabled={busy || !connectedDevice}
              onClick={() => void disconnect()}
              type="button"
            >
              {tt(language, 'devices.disconnectSimx')}
            </button>
          </div>
        </article>

        <article className="panel-card stats-card">
          <span className="panel-label">{tt(language, 'devices.simxStatus')}</span>
          {connectedDevice ? (
            <dl className="status-list">
              <div>
                <dt>{tt(language, 'devices.statusName')}</dt>
                <dd>{connectedDevice.name}</dd>
              </div>
              <div>
                <dt>{tt(language, 'devices.statusPort')}</dt>
                <dd>{connectedDevice.path}</dd>
              </div>
              <div>
                <dt>{tt(language, 'devices.statusManufacturer')}</dt>
                <dd>{connectedDevice.manufacturer ?? '—'}</dd>
              </div>
              <div>
                <dt>{tt(language, 'devices.statusFriendlyName')}</dt>
                <dd>{connectedDevice.friendlyName ?? '—'}</dd>
              </div>
              <div>
                <dt>{tt(language, 'devices.statusFirmware')}</dt>
                <dd>{connectedDevice.firmwareVersion ?? tt(language, 'devices.simhubProtocol')}</dd>
              </div>
              <div>
                <dt>{tt(language, 'devices.statusProtocol')}</dt>
                <dd>{connectedDevice.protocolVersion ? `v${connectedDevice.protocolVersion}` : tt(language, 'devices.simhubOneLetter')}</dd>
              </div>
              <div>
                <dt>{tt(language, 'devices.hidButtons')}</dt>
                <dd>{connectedDevice.hidButtons ?? 32}</dd>
              </div>
              <div>
                <dt>{tt(language, 'devices.encodersSwitches')}</dt>
                <dd>
                  {connectedDevice.encoders ?? 4} / {connectedDevice.switches ?? '—'}
                </dd>
              </div>
              <div>
                <dt>{tt(language, 'devices.connectedAt')}</dt>
                <dd>{new Date(connectedDevice.connectedAt).toLocaleString()}</dd>
              </div>
            </dl>
          ) : (
            <div className="notice-card warning">
              <strong>{tt(language, 'devices.simxDisconnected')}</strong>
              <p>
                {tt(language, 'devices.disconnectedHelp')}
              </p>
            </div>
          )}
        </article>
      </section>

      <article className="panel-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">{tt(language, 'devices.secondariesEyebrow')}</span>
            <h3>{tt(language, 'devices.secondariesTitle')}</h3>
          </div>
        </div>
        <p className="helper-text">
          {tt(language, 'devices.secondariesHelp')}
        </p>

        <div className="port-list">
          {secondaryDevices.length === 0 && (
            <p className="empty-state">{tt(language, 'devices.noDryndary')}</p>
          )}
          {secondaryDevices.map((device) => (
            <div className="port-item is-static" key={device.id}>
              <span>
                <strong>
                  {device.label}
                  <em className={`muted-pill ${device.connected ? 'is-online' : ''}`} style={{ marginLeft: 8 }}>
                    {device.connected ? tt(language, 'devices.connectedLower') : tt(language, 'devices.disconnectedLower')}
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
                  onClick={() => void disconnectDryndary(device.id)}
                  type="button"
                >
                  {tt(language, 'devices.disconnect')}
                </button>
                <button
                  className="ghost-action compact danger"
                  disabled={busy}
                  onClick={() => void removeDryndary(device.id)}
                  type="button"
                >
                  {tt(language, 'devices.forget')}
                </button>
              </div>
            </div>
          ))}
        </div>

        {offlineDryndaries.length > 0 && (
          <div className="config-block">
            <strong>{tt(language, 'devices.savedDisconnected')}</strong>
            <ul className="plain-list">
              {offlineDryndaries.map((config) => (
                <li key={`${config.path}-${config.id ?? 'new'}`}>
                  <code>{config.path}</code> · {config.label} · {config.baud} baud
                  {config.id ? (
                    <>
                      <button
                        className="ghost-action compact"
                        disabled={busy}
                        onClick={() => void reconnectDryndary(config.id!)}
                        style={{ marginLeft: 8 }}
                        type="button"
                      >
                        {tt(language, 'devices.connect')}
                      </button>
                      <button
                        className="ghost-action compact danger"
                        disabled={busy}
                        onClick={() => void removeDryndary(config.id!)}
                        style={{ marginLeft: 6 }}
                        type="button"
                      >
                        {tt(language, 'devices.forget')}
                      </button>
                    </>
                  ) : (
                    <em className="muted-pill" style={{ marginLeft: 8 }}>
                      {tt(language, 'devices.noSavedId')}
                    </em>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="config-block">
          <strong>{tt(language, 'devices.addDryndary')}</strong>
          <small>{tt(language, 'devices.addDryndaryHelp')}</small>
          <form
            className="command-row"
            onSubmit={(event) => {
              event.preventDefault()
              void addDryndary()
            }}
            style={{ flexWrap: 'wrap', gap: 8, marginTop: 12 }}
          >
            <select
              className="command-input"
              onChange={(event) => {
                const value = event.target.value
                setDryndaryPath(value)
                const match = ports.find((port) => port.path === value)
                if (match && !secondaryLabel) {
                  setDryndaryLabel(match.friendlyName ?? match.manufacturer ?? value)
                }
              }}
              style={{ minWidth: 220 }}
              value={secondaryPath}
            >
              <option value="">{tt(language, 'devices.selectPort')}</option>
              {ports.map((port) => {
                const inUse = serialDevices.some((device) => device.path === port.path)
                const reservedForPrimary = port.isSimX
                return (
                  <option disabled={inUse || reservedForPrimary} key={port.path} value={port.path}>
                    {port.path} {port.friendlyName ? `· ${port.friendlyName}` : ''}{' '}
                    {inUse ? tt(language, 'devices.inUseSuffix') : reservedForPrimary ? tt(language, 'devices.primarySuffix') : ''}
                  </option>
                )
              })}
            </select>
            <input
              className="command-input"
              onChange={(event) => setDryndaryLabel(event.target.value)}
              placeholder={tt(language, 'devices.labelPlaceholder')}
              style={{ minWidth: 180 }}
              type="text"
              value={secondaryLabel}
            />
            <input
              className="command-input"
              max={2000000}
              min={300}
              onChange={(event) => setDryndaryBaud(Number(event.target.value) || GENERIC_DEVICE_DEFAULT_BAUD)}
              placeholder={tt(language, 'devices.baudPlaceholder')}
              style={{ width: 120 }}
              type="number"
              value={secondaryBaud}
            />
            <button
              className="primary-action"
              disabled={busy || !secondaryPath || secondaryPathInUse || ports.some((port) => port.path === secondaryPath && port.isSimX)}
              type="submit"
            >
              {tt(language, 'devices.connectDryndary')}
            </button>
          </form>
        </div>
      </article>

      <article className="panel-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">{tt(language, 'devices.audioOutputsEyebrow')}</span>
            <h3>{tt(language, 'devices.audioOutputsTitle')}</h3>
          </div>
          <button
            className="ghost-action compact"
            disabled={audioBusy}
            onClick={() => void refreshAudioOutputs(true)}
            type="button"
          >
            {tt(language, 'devices.refresh')}
          </button>
        </div>
        <p className="helper-text">
          {tt(language, 'devices.audioOutputsHelp')}
        </p>
        <div className="port-list">
          {audioOutputs.length === 0 && <p className="empty-state">{audioOutputsStatus}</p>}
          {audioOutputs.map((output) => (
            <div className="port-item is-static" key={output.deviceId}>
              <span>
                <strong>{output.label}</strong>
                <small>{tt(language, 'devices.audioOutputWindows')}</small>
              </span>
            </div>
          ))}
        </div>
      </article>

      <article className="panel-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">{tt(language, 'devices.monitorsEyebrow')}</span>
            <h3>{tt(language, 'devices.monitorsTitle')}</h3>
          </div>
          <button className="ghost-action compact" disabled={busy} onClick={() => void refreshDisplays()} type="button">
            {tt(language, 'devices.refresh')}
          </button>
        </div>
        <p className="helper-text">
          {tt(language, 'devices.monitorsHelp')}
        </p>
        <div className="port-list">
          {displays.length === 0 && <p className="empty-state">{tt(language, 'devices.noMonitor')}</p>}
          {displays.map((display) => (
            <div className="port-item is-static" key={display.id}>
              <span>
                <strong>
                  {display.label}
                  {display.primary && (
                    <em className="muted-pill" style={{ marginLeft: 8 }}>
                      {tt(language, 'devices.primary')}
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
