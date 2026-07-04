import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import type { DashboardPlaylist } from '../../../shared/dashboards'
import {
  addButtonPanelToPlaylist,
  createButtonBoxPanel,
  parseButtonBoxPanel,
  type ButtonBoxPanel,
  type ButtonBoxSummary
} from '../../../shared/touch-panel'
import { TOUCH_PANEL_PRESETS } from '../../../shared/touch-panel-presets'
import type { AppViewProps } from '../App'
import { ButtonBoxEditor } from '../touchpanel/ButtonBoxEditor'

interface DisplayInfo {
  id: number
  label: string
  width: number
  height: number
  primary: boolean
}

const PANEL_BG = '#0e1116'
const PANEL_BORDER = '#1f2733'
const TEXT_DIM = '#9aa6b2'
const TEXT_FG = '#f6fbff'
const ACCENT = 'var(--accent-primary)'

function panel(): CSSProperties {
  return { background: PANEL_BG, border: `1px solid ${PANEL_BORDER}`, borderRadius: 14, padding: 16 }
}

function btn(kind: 'default' | 'primary' | 'danger' = 'default'): CSSProperties {
  const base: CSSProperties = {
    border: `1px solid ${PANEL_BORDER}`,
    borderRadius: 8,
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    background: '#0b0e13',
    color: TEXT_FG
  }
  if (kind === 'primary') return { ...base, background: ACCENT, borderColor: ACCENT, color: '#04111f' }
  if (kind === 'danger') return { ...base, borderColor: '#7f1d1d', color: '#fca5a5' }
  return base
}

function input(): CSSProperties {
  return { background: '#0b0e13', color: TEXT_FG, border: `1px solid ${PANEL_BORDER}`, borderRadius: 8, padding: '8px 10px', fontSize: 13 }
}

export default function TouchControlsView({ showToast }: AppViewProps): ReactElement {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [pitDisplayId, setPitDisplayId] = useState<number | null>(null)
  const [pitPanelOpen, setPitPanelOpen] = useState(false)

  const [summaries, setSummaries] = useState<ButtonBoxSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelDraft, setPanelDraft] = useState<ButtonBoxPanel | null>(null)
  const [selectedButtonId, setSelectedButtonId] = useState<string | null>(null)
  const [panelDisplayId, setPanelDisplayId] = useState<number | null>(null)
  const [fullscreen, setFullscreen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)

  const refreshDisplays = useCallback(async () => {
    const list = await window.ipc.invoke<DisplayInfo[]>('app:touchpanel:listDisplays')
    setDisplays(list)
    const primary = list.find((d) => d.primary)?.id ?? list[0]?.id ?? null
    setPitDisplayId((cur) => (cur !== null && list.some((d) => d.id === cur) ? cur : primary))
    setPanelDisplayId((cur) => (cur !== null && list.some((d) => d.id === cur) ? cur : primary))
  }, [])

  const refreshPanels = useCallback(async () => {
    const list = await window.ipc.invoke<ButtonBoxSummary[]>('app:touchpanel:list')
    setSummaries(list)
  }, [])

  useEffect(() => {
    void refreshDisplays().catch(() => undefined)
    void refreshPanels().catch(() => undefined)
    void window.ipc.invoke<{ open: boolean }>('app:touchpanel:isOpen').then((s) => setPitPanelOpen(Boolean(s?.open))).catch(() => undefined)
    const offList = window.ipc.subscribe<ButtonBoxSummary[]>('app:touchpanel:list', setSummaries)
    const offPit = window.ipc.subscribe<{ open: boolean }>('app:pitpanel:openState', (s) => setPitPanelOpen(Boolean(s?.open)))
    void window.ipc.invoke<{ open: boolean }>('app:pitpanel:isOpen').then((s) => setPitPanelOpen(Boolean(s?.open))).catch(() => undefined)
    return () => {
      offList()
      offPit()
    }
  }, [refreshDisplays, refreshPanels])

  const loadPanel = useCallback(async (id: string) => {
    const raw = await window.ipc.invoke('app:touchpanel:get', id)
    const parsed = parseButtonBoxPanel(raw)
    if (parsed) {
      setPanelDraft(parsed)
      setSelectedId(id)
      setSelectedButtonId(null)
      setDirty(false)
    }
  }, [])

  // Guarded panel switch: warn before discarding unsaved edits.
  const requestLoadPanel = useCallback(
    (id: string) => {
      if (id === selectedId) return
      if (dirty && !window.confirm('Há alterações não salvas neste button box. Descartar e trocar de painel?')) return
      void run(() => loadPanel(id))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dirty, loadPanel, selectedId]
  )

  const onEditorChange = useCallback((next: ButtonBoxPanel) => {
    setPanelDraft(next)
    setDirty(true)
  }, [])

  async function run(task: () => Promise<void>): Promise<void> {
    setBusy(true)
    try {
      await task()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha na operação.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const createPanel = useCallback(async () => {
    const next = createButtonBoxPanel({ name: `Button box ${summaries.length + 1}` })
    await window.ipc.invoke('app:touchpanel:save', next)
    await refreshPanels()
    setPanelDraft(next)
    setSelectedId(next.id)
    setSelectedButtonId(null)
    setDirty(false)
    showToast('Button box criado.', 'success')
  }, [refreshPanels, showToast, summaries.length])

  const requestCreatePanel = useCallback(() => {
    if (dirty && !window.confirm('Há alterações não salvas neste button box. Descartar e criar um novo?')) return
    void run(createPanel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createPanel, dirty])

  const createFromPreset = useCallback(
    async (presetId: string) => {
      const preset = TOUCH_PANEL_PRESETS.find((p) => p.id === presetId)
      if (!preset) return
      const next = createButtonBoxPanel({
        name: preset.name,
        columns: preset.columns,
        rows: preset.rows,
        gap: preset.gap,
        background: preset.background,
        buttons: preset.buttons.map((b) => ({ ...b, id: undefined }))
      })
      await window.ipc.invoke('app:touchpanel:save', next)
      await refreshPanels()
      setPanelDraft(next)
      setSelectedId(next.id)
      setSelectedButtonId(null)
      setDirty(false)
      showToast(`Modelo "${preset.name}" criado.`, 'success')
    },
    [refreshPanels, showToast]
  )

  const requestCreateFromPreset = useCallback(
    (id: string) => {
      if (dirty && !window.confirm('Há alterações não salvas neste button box. Descartar e criar do modelo?')) return
      void run(() => createFromPreset(id))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [createFromPreset, dirty]
  )

  const savePanel = useCallback(async () => {
    if (!panelDraft) return
    await window.ipc.invoke('app:touchpanel:save', panelDraft)
    await refreshPanels()
    setDirty(false)
    showToast('Button box salvo.', 'success')
  }, [panelDraft, refreshPanels, showToast])

  const deletePanel = useCallback(async () => {
    if (!selectedId) return
    if (!window.confirm('Excluir este button box?')) return
    await window.ipc.invoke('app:touchpanel:delete', selectedId)
    setPanelDraft(null)
    setSelectedId(null)
    setDirty(false)
    await refreshPanels()
    showToast('Button box excluído.', 'info')
  }, [refreshPanels, selectedId, showToast])

  const openFullscreen = useCallback(async () => {
    if (!panelDraft) return
    await window.ipc.invoke('app:touchpanel:save', panelDraft)
    setDirty(false)
    const opened = await window.ipc.invoke('app:touchpanel:open', { panelId: panelDraft.id, displayId: panelDisplayId ?? undefined, fullscreen })
    if (!opened) throw new Error('Não foi possível abrir o painel (sem monitor?).')
    showToast('Button box aberto em tela cheia.', 'success')
  }, [fullscreen, panelDisplayId, panelDraft, showToast])

  const addToPlaylist = useCallback(async () => {
    if (!panelDraft) return
    await window.ipc.invoke('app:touchpanel:save', panelDraft)
    setDirty(false)
    const current = await window.ipc.invoke<DashboardPlaylist>('app:dash:playlist:get')
    const next = addButtonPanelToPlaylist(current ?? { items: [], updatedAt: 0 }, panelDraft.id, {
      displayId: panelDisplayId ?? undefined,
      fullscreen
    })
    await window.ipc.invoke('app:dash:playlist:set', next)
    showToast('Button box adicionado à playlist de dashboards.', 'success')
  }, [fullscreen, panelDisplayId, panelDraft, showToast])

  const openPitPanel = useCallback(async () => {
    await window.ipc.invoke('app:pitpanel:open', { displayId: pitDisplayId ?? undefined })
    setPitPanelOpen(true)
    showToast('Painel de Pit aberto.', 'success')
  }, [pitDisplayId, showToast])

  const closePitPanel = useCallback(async () => {
    await window.ipc.invoke('app:pitpanel:close')
    setPitPanelOpen(false)
  }, [])

  const displayOptions = useMemo(
    () =>
      displays.map((d) => (
        <option key={d.id} value={d.id}>
          {d.label} · {d.width}×{d.height}{d.primary ? ' · primário' : ''}
        </option>
      )),
    [displays]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Pit panel launcher (moved out of Dashboards) ──────────────────── */}
      <section style={panel()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }} aria-hidden>🏁</span>
          <strong style={{ color: TEXT_FG, fontSize: 14, letterSpacing: '0.04em' }}>Painel de Pit (touch)</strong>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ color: TEXT_DIM, fontSize: 12 }}>Monitor</span>
          <select value={pitDisplayId ?? ''} onChange={(e) => setPitDisplayId(e.target.value ? Number(e.target.value) : null)} style={input()}>
            {displays.length === 0 && <option value="">Nenhum monitor</option>}
            {displayOptions}
          </select>
          <button style={btn('primary')} disabled={busy || displays.length === 0} onClick={() => run(openPitPanel)}>
            {pitPanelOpen ? 'Reabrir Painel de Pit' : 'Abrir Painel de Pit'}
          </button>
          {pitPanelOpen && (
            <button style={btn('danger')} disabled={busy} onClick={() => run(closePitPanel)}>
              Fechar painel
            </button>
          )}
        </div>
        <p style={{ color: TEXT_DIM, fontSize: 12, margin: '8px 0 0' }}>
          Painel de toque para pit stop e comandos rápidos — combustível, pneus, serviço, chat macros, câmera e replay.
          O Kiosk de dashboards continua em <strong>Dashboards</strong>.
        </p>
      </section>

      {/* ── Button-box panels ─────────────────────────────────────────────── */}
      <section style={panel()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }} aria-hidden>🎛️</span>
            <strong style={{ color: TEXT_FG, fontSize: 14, letterSpacing: '0.04em' }}>Button boxes editáveis (RGB)</strong>
          </div>
          <button style={btn('primary')} disabled={busy} onClick={requestCreatePanel}>＋ Novo button box</button>
        </div>

        <details style={{ marginBottom: 12 }}>
          <summary style={{ color: TEXT_FG, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            📋 Começar de um modelo pronto ({TOUCH_PANEL_PRESETS.length})
          </summary>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {TOUCH_PANEL_PRESETS.map((p) => (
              <button
                key={p.id}
                style={{ ...btn('default'), display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                disabled={busy}
                onClick={() => requestCreateFromPreset(p.id)}
                title={`${p.buttons.length} teclas`}
              >
                <span>{p.name}</span>
                <span style={{ fontSize: 11, opacity: 0.7 }}>{p.columns}×{p.rows} · {p.buttons.length} teclas</span>
              </button>
            ))}
          </div>
        </details>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {summaries.length === 0 && <span style={{ color: TEXT_DIM, fontSize: 13 }}>Nenhum painel ainda. Crie um para começar.</span>}
          {summaries.map((s) => (
            <button
              key={s.id}
              style={{ ...btn(s.id === selectedId ? 'primary' : 'default'), display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
              disabled={busy}
              onClick={() => requestLoadPanel(s.id)}
            >
              <span>{s.name}</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>{s.columns}×{s.rows} · {s.buttonCount} teclas</span>
            </button>
          ))}
        </div>

        {panelDraft ? (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <button style={btn('primary')} disabled={busy} onClick={() => run(savePanel)}>Salvar</button>
              <button style={btn()} disabled={busy} onClick={() => run(openFullscreen)}>Abrir em tela cheia</button>
              <button style={btn()} disabled={busy} onClick={() => run(addToPlaylist)}>Adicionar à playlist</button>
              <button style={btn('danger')} disabled={busy} onClick={() => run(deletePanel)}>Excluir</button>
              <span style={{ width: 1, height: 24, background: PANEL_BORDER }} />
              <span style={{ color: TEXT_DIM, fontSize: 12 }}>Monitor</span>
              <select value={panelDisplayId ?? ''} onChange={(e) => setPanelDisplayId(e.target.value ? Number(e.target.value) : null)} style={input()}>
                {displays.length === 0 && <option value="">Nenhum monitor</option>}
                {displayOptions}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: TEXT_DIM, fontSize: 13 }}>
                <input type="checkbox" checked={fullscreen} onChange={(e) => setFullscreen(e.target.checked)} />
                Tela cheia
              </label>
            </div>

            <ButtonBoxEditor
              panel={panelDraft}
              selectedId={selectedButtonId}
              onChange={onEditorChange}
              onSelect={setSelectedButtonId}
            />
          </>
        ) : (
          <p style={{ color: TEXT_DIM, fontSize: 13 }}>Selecione um button box acima ou crie um novo para editar.</p>
        )}
      </section>
    </div>
  )
}
