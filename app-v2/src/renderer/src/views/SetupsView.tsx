import { type CSSProperties, type ReactElement, useEffect, useMemo, useState } from 'react'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import {
  DEFAULT_SETUPS_CONFIG,
  SETUPS_CHANNELS,
  type InstallResult,
  type SetupFileInfo,
  type SetupSource,
  type SetupsConfig,
  type SetupsEnv
} from '../../../shared/setups'
import {
  SETUP_MANAGER_CHANNELS,
  type SetupCompareResult,
  type SetupLibraryItem,
  type SetupLibraryResult,
  type SetupMetadata,
  type SetupMetadataPatch
} from '../../../shared/setup-manager'
import type { StoDiffEntry } from '../../../shared/sto-parser'
import type { AppViewProps } from '../App'
import { SectionExportImport } from '../components/SectionExportImport'

interface DetectCarResult {
  carName?: string
  suggestedFolder?: string
}

type ConfigPatch = Partial<SetupsConfig>
type TabId = 'install' | 'library' | 'compare'

const card: CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 'var(--radius-sm)',
  padding: '14px 16px'
}

const label: CSSProperties = { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.6 }
const row: CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }
const input: CSSProperties = {
  background: 'rgba(0,0,0,0.25)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 'var(--radius-sm)',
  color: '#fff',
  padding: '7px 9px'
}
const button: CSSProperties = {
  padding: '7px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'transparent',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 12
}
const primaryButton: CSSProperties = { ...button, border: '1px solid rgba(var(--accent-rgb),0.55)', background: 'rgba(var(--accent-rgb),0.16)' }
const dangerText: CSSProperties = { color: 'var(--accent-danger)' }
const successText: CSSProperties = { color: 'var(--accent-success)' }
const warningText: CSSProperties = { color: 'var(--accent-warning)' }

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function emptyMetadata(): SetupMetadata {
  return { car: '', track: '', notes: '', tags: [], rating: 0, updatedAt: 0 }
}

export default function SetupsView({ showToast }: AppViewProps): ReactElement {
  const [activeTab, setActiveTab] = useState<TabId>('install')
  const [env, setEnv] = useState<SetupsEnv | null>(null)
  const [config, setConfig] = useState<SetupsConfig>(DEFAULT_SETUPS_CONFIG)
  const [carFolders, setCarFolders] = useState<string[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState('')
  const [files, setFiles] = useState<SetupFileInfo[]>([])
  const [urlDraft, setUrlDraft] = useState('')
  const [detected, setDetected] = useState<DetectCarResult>({})
  const [selectedFolders, setSelectedFolders] = useState<Record<string, string>>({})
  const [rememberCar, setRememberCar] = useState(true)
  const [busy, setBusy] = useState(false)
  const [libraryRoot, setLibraryRoot] = useState('')
  const [libraryItems, setLibraryItems] = useState<SetupLibraryItem[]>([])
  const [libraryBusy, setLibraryBusy] = useState(false)
  const [selectedLibraryPath, setSelectedLibraryPath] = useState('')
  const [metadataDraft, setMetadataDraft] = useState<SetupMetadata>(emptyMetadata())
  const [compareLeftPath, setCompareLeftPath] = useState('')
  const [compareRightPath, setCompareRightPath] = useState('')
  const [compareResult, setCompareResult] = useState<SetupCompareResult | null>(null)

  const folderSources = useMemo(() => config.sources.filter((source) => source.kind === 'folder'), [config.sources])
  const selectedSource = useMemo(
    () => config.sources.find((source) => source.id === selectedSourceId) ?? null,
    [config.sources, selectedSourceId]
  )
  const selectedLibraryItem = useMemo(
    () => libraryItems.find((item) => item.path === selectedLibraryPath) ?? null,
    [libraryItems, selectedLibraryPath]
  )

  useEffect(() => {
    void refreshAll()
    const offConfig = window.ipc.subscribe<SetupsConfig>(SETUPS_CHANNELS.config, (nextConfig) => setConfig(nextConfig))
    const offTelemetry = window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', (snapshot) => {
      setDetected((current) => ({ ...current, carName: snapshot?.carName ?? current.carName }))
    })
    return () => {
      offConfig()
      offTelemetry()
    }
  }, [])

  useEffect(() => {
    if (!selectedSourceId && config.sources.length > 0) setSelectedSourceId(config.sources[0].id)
    if (selectedSourceId && !config.sources.some((source) => source.id === selectedSourceId)) setSelectedSourceId(config.sources[0]?.id ?? '')
  }, [config.sources, selectedSourceId])

  useEffect(() => {
    if (selectedSourceId) void loadSource(selectedSourceId)
    else setFiles([])
  }, [selectedSourceId])

  useEffect(() => {
    if ((activeTab === 'library' || activeTab === 'compare') && libraryItems.length === 0) void loadLibrary(false)
  }, [activeTab])

  useEffect(() => {
    if (!selectedLibraryPath && libraryItems.length > 0) setSelectedLibraryPath(libraryItems[0].path)
    if (selectedLibraryPath && !libraryItems.some((item) => item.path === selectedLibraryPath)) setSelectedLibraryPath(libraryItems[0]?.path ?? '')
    if (!compareLeftPath && libraryItems.length > 0) setCompareLeftPath(libraryItems[0].path)
    if (!compareRightPath && libraryItems.length > 1) setCompareRightPath(libraryItems[1].path)
  }, [compareLeftPath, compareRightPath, libraryItems, selectedLibraryPath])

  useEffect(() => {
    setMetadataDraft(selectedLibraryItem?.metadata ?? emptyMetadata())
  }, [selectedLibraryItem])

  async function refreshAll(): Promise<void> {
    try {
      const [nextEnv, nextConfig, nextFolders, nextDetected] = await Promise.all([
        window.ipc.invoke<SetupsEnv>(SETUPS_CHANNELS.env),
        window.ipc.invoke<SetupsConfig>(SETUPS_CHANNELS.getConfig),
        window.ipc.invoke<string[]>(SETUPS_CHANNELS.listCarFolders),
        window.ipc.invoke<DetectCarResult>(SETUPS_CHANNELS.detectCar)
      ])
      setEnv(nextEnv)
      setConfig(nextConfig)
      setCarFolders(nextFolders)
      setDetected(nextDetected)
      if (!selectedSourceId && nextConfig.sources.length > 0) setSelectedSourceId(nextConfig.sources[0].id)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function patchConfig(patch: ConfigPatch): Promise<SetupsConfig> {
    const saved = await window.ipc.invoke<SetupsConfig>(SETUPS_CHANNELS.setConfig, patch)
    setConfig(saved)
    return saved
  }

  async function addFolderSource(): Promise<void> {
    try {
      const folder = await window.ipc.invoke<string | undefined>(SETUPS_CHANNELS.pickFolder)
      if (!folder) return
      const labelText = folder.split(/[\\/]/).pop() || 'Local folder'
      const source: SetupSource = { id: createId('folder'), kind: 'folder', label: labelText, path: folder }
      await patchConfig({ sources: [...config.sources, source] })
      setSelectedSourceId(source.id)
      showToast('Local source added.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function addUrlSource(): Promise<void> {
    const url = urlDraft.trim()
    if (!isHttpsUrl(url)) {
      showToast('Enter a valid HTTPS URL.', 'error')
      return
    }
    const source: SetupSource = { id: createId('url'), kind: 'url', label: new URL(url).hostname, url }
    try {
      await patchConfig({ sources: [...config.sources, source] })
      setUrlDraft('')
      setSelectedSourceId(source.id)
      showToast('URL source added.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function removeSource(sourceId: string): Promise<void> {
    try {
      const nextSources = config.sources.filter((source) => source.id !== sourceId)
      const patch: ConfigPatch = { sources: nextSources }
      if (config.autoInstallSourceId === sourceId) {
        patch.autoInstall = false
        patch.autoInstallSourceId = undefined
      }
      await patchConfig(patch)
      if (selectedSourceId === sourceId) setSelectedSourceId(nextSources[0]?.id ?? '')
      showToast('Source removed.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function loadSource(sourceId: string): Promise<void> {
    setBusy(true)
    try {
      const nextFiles = await window.ipc.invoke<SetupFileInfo[]>(SETUPS_CHANNELS.listSource, sourceId)
      setFiles(nextFiles)
      setSelectedFolders((current) => {
        const next = { ...current }
        for (const file of nextFiles) next[file.id] = next[file.id] || file.suggestedCarFolder || detected.suggestedFolder || carFolders[0] || ''
        return next
      })
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
      setFiles([])
    } finally {
      setBusy(false)
    }
  }

  async function install(file: SetupFileInfo): Promise<void> {
    const carFolder = selectedFolders[file.id]?.trim()
    if (!carFolder) {
      showToast('Select the car folder.', 'error')
      return
    }
    setBusy(true)
    try {
      const result = await window.ipc.invoke<InstallResult>(SETUPS_CHANNELS.install, {
        file,
        carFolder,
        rememberFor: rememberCar ? detected.carName : undefined
      })
      showToast(result.message, result.ok ? 'success' : 'error')
      if (result.ok) {
        await refreshAll()
        await loadLibrary(false)
      }
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function toggleAutoInstall(enabled: boolean): Promise<void> {
    try {
      await patchConfig({ autoInstall: enabled, autoInstallSourceId: enabled ? config.autoInstallSourceId || folderSources[0]?.id : config.autoInstallSourceId })
      showToast(enabled ? 'Auto-install enabled.' : 'Auto-install disabled.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function loadLibrary(showSuccess = true): Promise<void> {
    setLibraryBusy(true)
    try {
      const result = await window.ipc.invoke<SetupLibraryResult>(SETUP_MANAGER_CHANNELS.libraryList)
      setLibraryRoot(result.root)
      setLibraryItems(result.items)
      if (showSuccess) showToast('Library updated.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
      setLibraryItems([])
    } finally {
      setLibraryBusy(false)
    }
  }

  async function saveMetadata(): Promise<void> {
    if (!selectedLibraryItem) return
    const patch: SetupMetadataPatch = {
      car: metadataDraft.car,
      track: metadataDraft.track,
      notes: metadataDraft.notes,
      tags: metadataDraft.tags,
      rating: metadataDraft.rating
    }
    try {
      const saved = await window.ipc.invoke<SetupMetadata>(SETUP_MANAGER_CHANNELS.saveMeta, { path: selectedLibraryItem.path, metadata: patch })
      setLibraryItems((current) => current.map((item) => item.path === selectedLibraryItem.path ? { ...item, metadata: saved } : item))
      showToast('Metadados salvos.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function compareSelected(): Promise<void> {
    if (!compareLeftPath || !compareRightPath || compareLeftPath === compareRightPath) {
      showToast('Select two different setups.', 'error')
      return
    }
    setLibraryBusy(true)
    try {
      const result = await window.ipc.invoke<SetupCompareResult>(SETUP_MANAGER_CHANNELS.compare, { leftPath: compareLeftPath, rightPath: compareRightPath })
      setCompareResult(result)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
      setCompareResult(null)
    } finally {
      setLibraryBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
        <div>
          <div style={label}>Setups iRacing</div>
          <h3 style={{ margin: '4px 0 0' }}>Setup Manager</h3>
          <p style={{ margin: '6px 0 0', opacity: 0.72 }}>
            Install, catalog, and compare .sto files with section diffs.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SectionExportImport sectionId="setups" label="Setups (library)" onImported={() => void refreshAll()} />
          <SectionExportImport sectionId="setup-manager" label="Setup manager" onImported={() => void refreshAll()} />
          <button style={button} type="button" onClick={() => void window.ipc.invoke(SETUPS_CHANNELS.openSetupsDir)}>
            Open setups folder
          </button>
        </div>
      </div>

      <div className="view-tabs" style={{ display: 'flex', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <TabButton active={activeTab === 'install'} label="Instalar" onClick={() => setActiveTab('install')} />
        <TabButton active={activeTab === 'library'} label="Library" onClick={() => setActiveTab('library')} />
        <TabButton active={activeTab === 'compare'} label="Comparar" onClick={() => setActiveTab('compare')} />
      </div>

      {activeTab === 'install' && renderInstallTab()}
      {activeTab === 'library' && renderLibraryTab()}
      {activeTab === 'compare' && renderCompareTab()}
    </div>
  )

  function renderInstallTab(): ReactElement {
    const suggestedFolder = detected.suggestedFolder?.trim()

    return (
      <div style={{ display: 'grid', gap: 16 }}>
        {env && !env.supported && (
          <div style={{ ...card, borderColor: 'rgba(255,185,0,0.35)' }}>
            <strong>Installation available only on Windows.</strong>
            <p style={{ margin: '6px 0 0', opacity: 0.78 }}>You can still configure sources. Expected folder: {env.setupsDir}</p>
          </div>
        )}

        <section style={card}>
          <div style={row}>
            <div style={{ flex: 1 }}>
              <div style={label}>Detected car</div>
              <strong>{detected.carName || 'No telemetry right now'}</strong>
              {suggestedFolder ? <span style={{ opacity: 0.72 }}> → {suggestedFolder}</span> : null}
            </div>
            <label style={row}>
              <input checked={rememberCar} onChange={(event) => setRememberCar(event.target.checked)} type="checkbox" />
              lembrar pasta deste carro
            </label>
          </div>
        </section>

        <section style={card}>
          <div style={{ ...row, justifyContent: 'space-between' }}>
            <div>
              <div style={label}>Fonts</div>
              <h3 style={{ margin: '4px 0 0' }}>Setup library</h3>
            </div>
            <button style={primaryButton} type="button" onClick={() => void addFolderSource()}>Add folder</button>
          </div>
          <div style={{ ...row, marginTop: 12 }}>
            <input style={{ ...input, flex: 1, minWidth: 260 }} value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} placeholder="https://example.org/setups.json or setup.sto" />
            <button style={button} type="button" onClick={() => void addUrlSource()}>Add URL</button>
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {config.sources.map((source) => (
              <div key={source.id} style={{ ...row, justifyContent: 'space-between', padding: 10, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-sm)' }}>
                <button style={{ ...button, borderColor: selectedSourceId === source.id ? 'var(--accent-primary)' : 'rgba(255,255,255,0.14)' }} type="button" onClick={() => setSelectedSourceId(source.id)}>
                  {source.kind === 'folder' ? 'Folder' : 'URL'} · {source.label}
                </button>
                <small style={{ opacity: 0.62, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source.path ?? source.url}</small>
                <button style={button} type="button" onClick={() => void removeSource(source.id)}>Remove</button>
              </div>
            ))}
            {config.sources.length === 0 && <p style={{ opacity: 0.7 }}>No sources added yet.</p>}
          </div>
        </section>

        <section style={card}>
          <div style={row}>
            <label style={row}>
              <input checked={config.autoInstall} disabled={folderSources.length === 0} onChange={(event) => void toggleAutoInstall(event.target.checked)} type="checkbox" />
              auto-install new .sto files
            </label>
            <select
              style={input}
              value={config.autoInstallSourceId ?? ''}
              disabled={!config.autoInstall || folderSources.length === 0}
              onChange={(event) => void patchConfig({ autoInstallSourceId: event.target.value || undefined })}
            >
              <option value="">Select folder</option>
              {folderSources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
            </select>
          </div>
        </section>

        <section style={card}>
          <div style={{ ...row, justifyContent: 'space-between' }}>
            <div>
              <div style={label}>Available files</div>
              <h3 style={{ margin: '4px 0 0' }}>{selectedSource ? selectedSource.label : 'Select a source'}</h3>
            </div>
            <button disabled={!selectedSourceId || busy} style={button} type="button" onClick={() => void loadSource(selectedSourceId)}>Refresh</button>
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {files.map((file) => (
              <div key={file.id} style={{ display: 'grid', gridTemplateColumns: '1fr minmax(180px, 260px) auto', gap: 10, alignItems: 'center', padding: 10, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-sm)' }}>
                <div>
                  <strong>{file.fileName}</strong>
                  <div style={{ opacity: 0.6, fontSize: 12 }}>{file.sizeBytes ? `${Math.round(file.sizeBytes / 1024)} KB` : 'Remote'} {file.suggestedCarFolder ? `· suggestion: ${file.suggestedCarFolder}` : ''}</div>
                </div>
                <CarFolderInput
                  folders={carFolders}
                  value={selectedFolders[file.id] ?? ''}
                  onChange={(value) => setSelectedFolders((current) => ({ ...current, [file.id]: value }))}
                />
                <button disabled={busy} style={primaryButton} type="button" onClick={() => void install(file)}>Instalar</button>
              </div>
            ))}
            {files.length === 0 && <p style={{ opacity: 0.7 }}>{busy ? 'Loading setups…' : 'No .sto found in this source.'}</p>}
          </div>
        </section>
      </div>
    )
  }

  function renderLibraryTab(): ReactElement {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.1fr) minmax(320px, 0.9fr)', gap: 16 }}>
        <section style={card}>
          <div style={{ ...row, justifyContent: 'space-between' }}>
            <div>
              <div style={label}>Local library</div>
              <h3 style={{ margin: '4px 0 0' }}>{libraryItems.length} setups indexados</h3>
              <small style={{ opacity: 0.62 }}>{libraryRoot || 'Folder not loaded yet'}</small>
            </div>
            <button disabled={libraryBusy} style={button} type="button" onClick={() => void loadLibrary()}>Refresh</button>
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 12, maxHeight: 520, overflow: 'auto' }}>
            {libraryItems.map((item) => <LibraryItemButton key={item.id} active={item.path === selectedLibraryPath} item={item} onClick={() => setSelectedLibraryPath(item.path)} />)}
            {libraryItems.length === 0 && <p style={{ opacity: 0.7 }}>{libraryBusy ? 'Indexing setups…' : 'No .sto found in the local folder.'}</p>}
          </div>
        </section>

        <section style={card}>
          <div style={label}>Metadados</div>
          <h3 style={{ margin: '4px 0 12px' }}>{selectedLibraryItem?.fileName ?? 'Select a setup'}</h3>
          <MetadataEditor metadata={metadataDraft} disabled={!selectedLibraryItem} onChange={setMetadataDraft} />
          <div style={{ ...row, justifyContent: 'flex-end', marginTop: 12 }}>
            <button disabled={!selectedLibraryItem} style={primaryButton} type="button" onClick={() => void saveMetadata()}>Save metadados</button>
          </div>
        </section>
      </div>
    )
  }

  function renderCompareTab(): ReactElement {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <section style={card}>
          <div style={{ ...row, justifyContent: 'space-between' }}>
            <div>
              <div style={label}>Comparar setups</div>
              <h3 style={{ margin: '4px 0 0' }}>Delta-App style diff</h3>
            </div>
            <button disabled={libraryBusy} style={button} type="button" onClick={() => void loadLibrary()}>Refresh library</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, marginTop: 12, alignItems: 'end' }}>
            <SetupSelect label="Setup A" items={libraryItems} value={compareLeftPath} onChange={setCompareLeftPath} />
            <SetupSelect label="Setup B" items={libraryItems} value={compareRightPath} onChange={setCompareRightPath} />
            <button disabled={libraryBusy || libraryItems.length < 2} style={primaryButton} type="button" onClick={() => void compareSelected()}>Comparar</button>
          </div>
        </section>

        {compareResult ? <DiffView result={compareResult} /> : <section style={card}><p style={{ opacity: 0.7, margin: 0 }}>Select two setups to see differences by section.</p></section>}
      </div>
    )
  }
}

function TabButton({ active, label: tabLabel, onClick }: { active: boolean; label: string; onClick(): void }): ReactElement {
  return (
    <button className={`tab-button ${active ? 'active' : ''}`} type="button" onClick={onClick} style={{ background: 'transparent', border: 0, borderBottom: active ? '2px solid var(--accent-primary)' : '2px solid transparent', padding: '10px 12px', cursor: 'pointer' }}>
      <span>{tabLabel}</span>
    </button>
  )
}

function LibraryItemButton({ active, item, onClick }: { active: boolean; item: SetupLibraryItem; onClick(): void }): ReactElement {
  const tags = item.metadata.tags.length > 0 ? ` · ${item.metadata.tags.join(', ')}` : ''
  return (
    <button type="button" onClick={onClick} style={{ ...button, textAlign: 'left', borderColor: active ? 'var(--accent-primary)' : 'rgba(255,255,255,0.08)', background: active ? 'rgba(var(--accent-rgb),0.12)' : 'rgba(255,255,255,0.02)' }}>
      <strong>{item.fileName}</strong>
      <div style={{ opacity: 0.62, fontSize: 12 }}>{item.relativePath}</div>
      <div style={{ opacity: 0.72, fontSize: 12 }}>{item.metadata.car || item.carFolder || 'Car not defined'} {item.metadata.track ? `· ${item.metadata.track}` : ''}{tags}</div>
    </button>
  )
}

function MetadataEditor({ disabled, metadata, onChange }: { disabled: boolean; metadata: SetupMetadata; onChange(metadata: SetupMetadata): void }): ReactElement {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Field label="Car" disabled={disabled} value={metadata.car} onChange={(value) => onChange({ ...metadata, car: value })} />
      <Field label="Track" disabled={disabled} value={metadata.track} onChange={(value) => onChange({ ...metadata, track: value })} />
      <Field label="Tags" disabled={disabled} value={metadata.tags.join(', ')} placeholder="qualy, race, baseline" onChange={(value) => onChange({ ...metadata, tags: value.split(',').map((tag) => tag.trim()).filter(Boolean) })} />
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={label}>Rating</span>
        <select disabled={disabled} style={input} value={metadata.rating} onChange={(event) => onChange({ ...metadata, rating: Number(event.target.value) })}>
          {[0, 1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating === 0 ? 'No rating' : `${rating}/5`}</option>)}
        </select>
      </label>
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={label}>Notas</span>
        <textarea disabled={disabled} style={{ ...input, minHeight: 140, resize: 'vertical' }} value={metadata.notes} onChange={(event) => onChange({ ...metadata, notes: event.target.value })} placeholder="Ex.: stable over a long stint, adjust brake bias…" />
      </label>
    </div>
  )
}

function Field({ disabled, label: fieldLabel, onChange, placeholder, value }: { disabled: boolean; label: string; onChange(value: string): void; placeholder?: string; value: string }): ReactElement {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={label}>{fieldLabel}</span>
      <input disabled={disabled} style={input} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  )
}

function SetupSelect({ items, label: selectLabel, onChange, value }: { items: SetupLibraryItem[]; label: string; onChange(value: string): void; value: string }): ReactElement {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={label}>{selectLabel}</span>
      <select style={input} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Selecionar setup</option>
        {items.map((item) => <option key={item.id} value={item.path}>{item.relativePath}</option>)}
      </select>
    </label>
  )
}

function DiffView({ result }: { result: SetupCompareResult }): ReactElement {
  return (
    <section style={card}>
      <div style={row}>
        <strong>{result.left.fileName}</strong>
        <span style={{ opacity: 0.58 }}>vs</span>
        <strong>{result.right.fileName}</strong>
        <span style={{ ...warningText, marginLeft: 'auto' }}>{result.diff.totalChanges} differences</span>
      </div>
      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        {result.diff.sections.map((section) => (
          <div key={section.section} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
            <div style={{ padding: 10, background: 'rgba(var(--accent-rgb),0.10)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <strong>{section.section}</strong>
            </div>
            <DiffEntries title="Alterados" entries={section.changed} kind="changed" />
            <DiffEntries title="Adicionados" entries={section.added} kind="added" />
            <DiffEntries title="Removidos" entries={section.removed} kind="removed" />
          </div>
        ))}
        {result.diff.sections.length === 0 && <p style={{ opacity: 0.7, margin: 0 }}>No differences found.</p>}
      </div>
    </section>
  )
}

function DiffEntries({ entries, kind, title }: { entries: StoDiffEntry[]; kind: StoDiffEntry['kind']; title: string }): ReactElement | null {
  if (entries.length === 0) return null
  const color = kind === 'added' ? successText : kind === 'removed' ? dangerText : warningText
  return (
    <div style={{ padding: 10, display: 'grid', gap: 6 }}>
      <div style={{ ...label, ...color }}>{title}</div>
      {entries.map((entry) => (
        <div key={`${entry.kind}:${entry.key}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 260px) 1fr', gap: 10, fontSize: 12 }}>
          <code style={color}>{entry.key}</code>
          <div>
            {entry.kind === 'changed' ? <><span style={dangerText}>{entry.before || '∅'}</span><span style={{ opacity: 0.55 }}> → </span><span style={successText}>{entry.after || '∅'}</span></> : null}
            {entry.kind === 'added' ? <span style={successText}>{entry.after || '∅'}</span> : null}
            {entry.kind === 'removed' ? <span style={dangerText}>{entry.before || '∅'}</span> : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function CarFolderInput({ folders, value, onChange }: { folders: string[]; value: string; onChange(value: string): void }): ReactElement {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <select style={input} value={folders.includes(value) ? value : ''} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select folder</option>
        {folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
      </select>
      <input style={input} value={value} onChange={(event) => onChange(event.target.value)} placeholder="or new car folder" />
    </div>
  )
}
