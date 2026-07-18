import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'

import {
  COLLABORATION_CHANNELS,
  COLLABORATION_DOCUMENT_KINDS,
  collaborationTitlePath,
  type CollaborationDocumentKind,
  type CollaborationDocumentView,
  type CollaborationFileResult,
  type CollaborationJson,
  type CollaborationMockEditInput,
  type CollaborationOperation,
  type CollaborationWorkspaceState
} from '../../../shared/local-collaboration'
import type { AppViewProps } from '../App'

const panel: CSSProperties = {
  padding: 16,
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(255,255,255,0.035)'
}
const row: CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }
const input: CSSProperties = {
  padding: '8px 10px',
  color: '#fff',
  background: 'rgba(0,0,0,0.28)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 'var(--radius-sm)'
}
const button: CSSProperties = {
  ...input,
  cursor: 'pointer',
  background: 'rgba(255,255,255,0.06)'
}
const primaryButton: CSSProperties = {
  ...button,
  borderColor: 'rgba(var(--accent-rgb),0.55)',
  background: 'rgba(var(--accent-rgb),0.18)'
}
const badge: CSSProperties = {
  padding: '4px 8px',
  borderRadius: 999,
  fontSize: 11,
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(255,255,255,0.05)'
}
const muted: CSSProperties = { color: 'var(--muted)', fontSize: 12 }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function kindLabel(kind: CollaborationDocumentKind): string {
  return {
    dashboard: 'Dashboard document',
    'race-notes': 'Race notes',
    'cue-profile': 'Cue profile',
    'accessibility-profile': 'Accessibility profile'
  }[kind]
}

function defaultPatch(kind: CollaborationDocumentKind): { path: string; value: string } {
  if (kind === 'dashboard') return { path: '/description', value: '"Shared GT3 dashboard notes"' }
  if (kind === 'race-notes') {
    return { path: '/entries/note-1', value: '{"id":"note-1","text":"Brake marker and traffic note"}' }
  }
  if (kind === 'cue-profile') {
    return {
      path: '/cues/yellow-flag',
      value: '{"id":"yellow-flag","label":"Yellow flag","channels":["visual","audio"],"enabled":true}'
    }
  }
  return { path: '/preferences/contrast', value: '"high"' }
}

function parseValue(raw: string): CollaborationJson {
  return JSON.parse(raw) as CollaborationJson
}

function formatOperation(operation: CollaborationOperation): string {
  if (operation.type === 'delete') return `Deleted ${operation.path}`
  const value = JSON.stringify(operation.value)
  return `Set ${operation.path} = ${value.length > 100 ? `${value.slice(0, 97)}…` : value}`
}

function formatDate(value: number | null): string {
  if (value === null) return 'Not saved yet'
  return new Date(value).toLocaleString()
}

export default function CollaborationView({ showToast }: AppViewProps): ReactElement {
  const [workspace, setWorkspace] = useState<CollaborationWorkspaceState | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [document, setDocument] = useState<CollaborationDocumentView | null>(null)
  const [kind, setKind] = useState<CollaborationDocumentKind>('race-notes')
  const [title, setTitle] = useState('Shared race plan')
  const [editTitle, setEditTitle] = useState('')
  const [path, setPath] = useState(defaultPatch('race-notes').path)
  const [value, setValue] = useState(defaultPatch('race-notes').value)
  const [message, setMessage] = useState('')
  const [peerName, setPeerName] = useState('Second crew member')
  const [peerAccess, setPeerAccess] = useState<'viewer' | 'editor'>('editor')
  const [mockPeerId, setMockPeerId] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<CollaborationWorkspaceState> => {
    const state = await window.ipc.invoke<CollaborationWorkspaceState>(COLLABORATION_CHANNELS.state)
    setWorkspace(state)
    setSelectedId((current) => current || state.documents[0]?.id || '')
    return state
  }, [])

  const loadDocument = useCallback(async (id: string): Promise<void> => {
    if (!id) {
      setDocument(null)
      return
    }
    const next = await window.ipc.invoke<CollaborationDocumentView>(COLLABORATION_CHANNELS.getDocument, id)
    setDocument(next)
    setEditTitle(next.title)
    const patch = defaultPatch(next.kind)
    setPath(patch.path)
    setValue(patch.value)
  }, [])

  useEffect(() => {
    void refresh().catch((error) => showToast(errorMessage(error), 'error'))
    return window.ipc.subscribe<CollaborationWorkspaceState>(COLLABORATION_CHANNELS.changed, (state) => {
      setWorkspace(state)
    })
  }, [refresh, showToast])

  useEffect(() => {
    void loadDocument(selectedId).catch((error) => showToast(errorMessage(error), 'error'))
  }, [loadDocument, selectedId, workspace?.documents.find((item) => item.id === selectedId)?.revision, showToast])

  const editorPeers = useMemo(
    () => workspace?.peers.filter((peer) => peer.capabilities.includes(`${document?.kind ?? 'race-notes'}:write`)) ?? [],
    [document?.kind, workspace?.peers]
  )

  useEffect(() => {
    if (!editorPeers.some((peer) => peer.id === mockPeerId)) {
      setMockPeerId(editorPeers[0]?.id ?? '')
    }
  }, [editorPeers, mockPeerId])

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const createDocument = (): void => {
    void run(async () => {
      const created = await window.ipc.invoke<CollaborationDocumentView>(COLLABORATION_CHANNELS.create, {
        kind,
        title
      })
      setSelectedId(created.id)
      setDocument(created)
      showToast('Local-primary collaboration document created.', 'success')
    })
  }

  const saveTitle = (): void => {
    if (!document) return
    void run(async () => {
      const updated = await window.ipc.invoke<CollaborationDocumentView>(COLLABORATION_CHANNELS.set, {
        documentId: document.id,
        path: collaborationTitlePath(document.kind),
        value: editTitle,
        message: 'Renamed document'
      })
      setDocument(updated)
      showToast('Document title saved locally.', 'success')
    })
  }

  const applyPatch = (asMock: boolean): void => {
    if (!document) return
    void run(async () => {
      const operation: CollaborationOperation = { type: 'set', path, value: parseValue(value) }
      if (asMock) {
        if (!mockPeerId) throw new Error('Add or select an editor mock peer first.')
        const input: CollaborationMockEditInput = {
          peerId: mockPeerId,
          documentId: document.id,
          operation,
          message: message || 'In-memory peer edit'
        }
        await window.ipc.invoke(COLLABORATION_CHANNELS.mockEdit, input)
      } else {
        const updated = await window.ipc.invoke<CollaborationDocumentView>(COLLABORATION_CHANNELS.set, {
          documentId: document.id,
          path,
          value: operation.value,
          message: message || undefined
        })
        setDocument(updated)
      }
      await refresh()
      await loadDocument(document.id)
      showToast(asMock ? 'Mock peer edit recorded.' : 'Local edit saved.', 'success')
    })
  }

  const deletePath = (asMock: boolean): void => {
    if (!document) return
    void run(async () => {
      if (asMock) {
        if (!mockPeerId) throw new Error('Add or select an editor mock peer first.')
        await window.ipc.invoke(COLLABORATION_CHANNELS.mockEdit, {
          peerId: mockPeerId,
          documentId: document.id,
          operation: { type: 'delete', path },
          message: message || 'In-memory peer tombstone'
        } satisfies CollaborationMockEditInput)
      } else {
        setDocument(await window.ipc.invoke<CollaborationDocumentView>(COLLABORATION_CHANNELS.delete, {
          documentId: document.id,
          path,
          message: message || undefined
        }))
      }
      await refresh()
      await loadDocument(document.id)
      showToast('Tombstone saved.', 'success')
    })
  }

  const exportDocuments = (): void => {
    void run(async () => {
      const result = await window.ipc.invoke<CollaborationFileResult>(COLLABORATION_CHANNELS.exportFile)
      if (!result.canceled) showToast(`Exported ${result.documentCount ?? 0} documents.`, 'success')
    })
  }

  const importDocuments = (): void => {
    void run(async () => {
      const result = await window.ipc.invoke<CollaborationFileResult>(COLLABORATION_CHANNELS.importFile)
      if (!result.canceled) {
        await refresh()
        showToast(`Imported collaboration bundle (${result.documentCount ?? 0} local documents).`, 'success')
      }
    })
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <header>
        <div style={{ ...row, justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1.3 }}>
              Wave F · local-first
            </div>
            <h1 style={{ margin: '5px 0' }}>Collaboration</h1>
            <p style={{ ...muted, maxWidth: 850 }}>
              The local copy is authoritative. Only dashboard documents, race notes, cue profiles, and accessibility
              profiles can sync. Telemetry, secrets, credentials, machine settings, and device control are rejected.
            </p>
          </div>
          <div style={row} aria-live="polite">
            <span style={{ ...badge, color: 'var(--accent-success)' }}>Local primary</span>
            <span style={badge}>In-memory mock transport only</span>
            <span style={{ ...badge, color: workspace?.status.online ? 'var(--accent-success)' : 'var(--accent-primary)' }}>
              {workspace?.status.online ? 'Online to mock peers' : 'Offline edits enabled'}
            </span>
          </div>
        </div>
      </header>

      {workspace && (
        <section style={{ ...panel, display: 'grid', gap: 12 }}>
          <div style={{ ...row, justifyContent: 'space-between' }}>
            <div style={row}>
              <strong>{workspace.status.documentCount} documents</strong>
              <span style={muted}>{workspace.status.peerCount} capability peers</span>
              <span style={muted}>{workspace.status.pendingChangeCount} pending changes</span>
              <span style={muted}>{workspace.status.quarantineCount} quarantined</span>
            </div>
            <div style={row}>
              <button
                type="button"
                style={button}
                disabled={busy}
                onClick={() => void run(async () => {
                  setWorkspace(await window.ipc.invoke(COLLABORATION_CHANNELS.setOnline, !workspace.status.online))
                })}
              >
                Go {workspace.status.online ? 'offline' : 'online'}
              </button>
              <button
                type="button"
                style={button}
                disabled={busy || !workspace.status.online}
                onClick={() => void run(async () => {
                  setWorkspace(await window.ipc.invoke(COLLABORATION_CHANNELS.sync))
                  if (selectedId) await loadDocument(selectedId)
                })}
              >
                Sync mock peers
              </button>
              <button type="button" style={button} disabled={busy} onClick={exportDocuments}>Export</button>
              <button type="button" style={button} disabled={busy} onClick={importDocuments}>Import</button>
            </div>
          </div>
          <div style={muted}>
            Author: {workspace.status.localActor.displayName} · {workspace.status.localActor.id} · Last local save:{' '}
            {formatDate(workspace.status.lastSavedAt)}
          </div>
          {workspace.status.lastError && (
            <div role="alert" style={{ color: 'var(--accent-primary)' }}>{workspace.status.lastError}</div>
          )}
        </section>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 0.8fr) minmax(420px, 2fr)', gap: 14 }}>
        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <div style={{ ...panel, display: 'grid', gap: 10 }}>
            <strong>Create allowed document</strong>
            <select
              style={input}
              value={kind}
              onChange={(event) => {
                const next = event.currentTarget.value as CollaborationDocumentKind
                setKind(next)
              }}
            >
              {COLLABORATION_DOCUMENT_KINDS.map((item) => (
                <option key={item} value={item}>{kindLabel(item)}</option>
              ))}
            </select>
            <input style={input} value={title} maxLength={120} onChange={(event) => setTitle(event.currentTarget.value)} />
            <button type="button" style={primaryButton} disabled={busy || !title.trim()} onClick={createDocument}>
              Create local copy
            </button>
          </div>

          <div style={{ ...panel, display: 'grid', gap: 8 }}>
            <strong>Documents</strong>
            {workspace?.documents.length === 0 && <span style={muted}>No collaboration documents yet.</span>}
            {workspace?.documents.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                style={{
                  ...button,
                  textAlign: 'left',
                  borderColor: selectedId === item.id ? 'rgba(var(--accent-rgb),0.65)' : 'rgba(255,255,255,0.12)'
                }}
              >
                <strong style={{ display: 'block' }}>{item.title}</strong>
                <span style={muted}>
                  {kindLabel(item.kind)} · v{item.changeCount} · {item.conflictCount} conflicts
                </span>
              </button>
            ))}
          </div>

          <div style={{ ...panel, display: 'grid', gap: 10 }}>
            <strong>Capability-based mock peers</strong>
            <div style={row}>
              <input style={{ ...input, flex: 1 }} value={peerName} onChange={(event) => setPeerName(event.currentTarget.value)} />
              <select style={input} value={peerAccess} onChange={(event) => setPeerAccess(event.currentTarget.value as 'viewer' | 'editor')}>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="button"
                style={button}
                disabled={busy}
                onClick={() => void run(async () => {
                  setWorkspace(await window.ipc.invoke(COLLABORATION_CHANNELS.addMockPeer, {
                    displayName: peerName,
                    access: peerAccess
                  }))
                })}
              >
                Add mock
              </button>
            </div>
            {workspace?.peers.map((peer) => (
              <div key={peer.id} style={{ paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ ...row, justifyContent: 'space-between' }}>
                  <strong>{peer.actor.displayName}</strong>
                  <span style={badge}>{peer.connected ? 'connected' : 'offline'}</span>
                </div>
                <div style={muted}>{peer.capabilities.join(' · ')}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          {!document ? (
            <div style={panel}>Select or create a document.</div>
          ) : (
            <>
              <section style={{ ...panel, display: 'grid', gap: 12 }}>
                <div style={{ ...row, justifyContent: 'space-between' }}>
                  <div>
                    <strong>{document.title}</strong>
                    <div style={muted}>
                      {kindLabel(document.kind)} · revision {document.revision.slice(0, 12)} · {document.heads.length} heads ·{' '}
                      {document.tombstoneCount} tombstones
                    </div>
                  </div>
                  <span style={{ ...badge, color: document.conflicts.length ? 'var(--accent-primary)' : 'var(--accent-success)' }}>
                    {document.conflicts.length ? `${document.conflicts.length} conflicts` : 'Converged'}
                  </span>
                </div>
                <div style={row}>
                  <input style={{ ...input, flex: 1 }} value={editTitle} onChange={(event) => setEditTitle(event.currentTarget.value)} />
                  <button type="button" style={button} disabled={busy} onClick={saveTitle}>Rename</button>
                </div>
                <details>
                  <summary style={{ cursor: 'pointer' }}>Materialized local document</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>
                    {JSON.stringify(document.data, null, 2)}
                  </pre>
                </details>
              </section>

              <section style={{ ...panel, display: 'grid', gap: 10 }}>
                <strong>Versioned field edit</strong>
                <span style={muted}>
                  Paths are schema-scoped. Deletion creates a tombstone; concurrent values remain visible in conflict inspection.
                </span>
                <input style={input} value={path} onChange={(event) => setPath(event.currentTarget.value)} />
                <textarea
                  style={{ ...input, minHeight: 110, resize: 'vertical', fontFamily: 'monospace' }}
                  value={value}
                  onChange={(event) => setValue(event.currentTarget.value)}
                />
                <input
                  style={input}
                  value={message}
                  maxLength={240}
                  placeholder="Optional history message"
                  onChange={(event) => setMessage(event.currentTarget.value)}
                />
                <div style={row}>
                  <button type="button" style={primaryButton} disabled={busy} onClick={() => applyPatch(false)}>Save local edit</button>
                  <button type="button" style={button} disabled={busy} onClick={() => deletePath(false)}>Delete / tombstone</button>
                  <select style={input} value={mockPeerId} onChange={(event) => setMockPeerId(event.currentTarget.value)}>
                    <option value="">Select editor mock</option>
                    {editorPeers.map((peer) => <option key={peer.id} value={peer.id}>{peer.actor.displayName}</option>)}
                  </select>
                  <button type="button" style={button} disabled={busy || !mockPeerId} onClick={() => applyPatch(true)}>Mock peer set</button>
                  <button type="button" style={button} disabled={busy || !mockPeerId} onClick={() => deletePath(true)}>Mock peer delete</button>
                </div>
              </section>

              <section style={{ ...panel, display: 'grid', gap: 10 }}>
                <strong>Conflict visualization</strong>
                {document.conflicts.length === 0 && <span style={muted}>No active concurrent field conflicts.</span>}
                {document.conflicts.map((conflict) => (
                  <div key={conflict.path} style={{ padding: 10, border: '1px solid rgba(255,177,66,0.35)', borderRadius: 8 }}>
                    <strong>{conflict.path}</strong>
                    {conflict.candidates.map((candidate) => (
                      <div
                        key={candidate.changeId}
                        style={{
                          marginTop: 7,
                          padding: 8,
                          background: candidate.selected ? 'rgba(var(--accent-rgb),0.14)' : 'rgba(0,0,0,0.2)'
                        }}
                      >
                        <span style={badge}>{candidate.selected ? 'deterministic winner' : 'concurrent alternative'}</span>{' '}
                        {candidate.author.displayName} · {formatOperation(candidate.operation)}
                      </div>
                    ))}
                  </div>
                ))}
              </section>

              <section style={{ ...panel, display: 'grid', gap: 8 }}>
                <strong>Authorship and history</strong>
                {document.history.map((entry) => (
                  <div key={entry.changeId} style={{ padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ ...row, justifyContent: 'space-between' }}>
                      <strong>{entry.author.displayName}</strong>
                      <span style={muted}>L{entry.lamport} · {new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                    <div style={{ fontSize: 12 }}>{formatOperation(entry.operation)}</div>
                    {entry.message && <div style={muted}>{entry.message}</div>}
                  </div>
                ))}
              </section>
            </>
          )}

          {workspace && workspace.quarantine.length > 0 && (
            <section style={{ ...panel, display: 'grid', gap: 8 }}>
              <strong>Rejected / quarantined input</strong>
              {workspace.quarantine.map((entry, index) => (
                <div key={`${entry.receivedAt}-${index}`} role="alert" style={{ color: 'var(--accent-primary)' }}>
                  {entry.reason}
                </div>
              ))}
            </section>
          )}
        </div>
      </section>
    </div>
  )
}
