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
import { TagFilter, filterByTags } from '../components/TagFilter'
import { ButtonBoxEditor } from '../touchpanel/ButtonBoxEditor'
import { tt } from '../i18n'

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

function touchPresetTags(preset: ButtonBoxPanel): string[] {
  const tags = new Set<string>([
    `${preset.columns}×${preset.rows}`,
    `${preset.buttons.length} buttons`,
    preset.buttons.length <= 9 ? 'compact' : preset.buttons.length >= 20 ? 'large' : 'standard'
  ])
  for (const tag of preset.tags ?? []) tags.add(tag)
  const name = preset.name.toLocaleLowerCase()
  if (name.includes('pit')) tags.add('pit')
  if (name.includes('race')) tags.add('race')
  if (name.includes('stream')) tags.add('stream')
  for (const car of ['ferrari', 'porsche', 'mercedes-amg', 'mclaren', 'corvette', 'lamborghini']) {
    if (name.includes(car) || preset.tags?.includes(car)) tags.add(car)
  }
  for (const button of preset.buttons) {
    tags.add(button.material.replace('_', '-'))
    if (button.action.kind === 'iracing') tags.add('iRacing')
    if (button.action.kind === 'keyboard') tags.add('keyboard')
    if (button.action.kind === 'app') tags.add('app')
  }
  return Array.from(tags)
}

export default function TouchControlsView({ showToast, language }: AppViewProps): ReactElement {
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
  const [presetTagFilters, setPresetTagFilters] = useState<string[]>([])
  const [selectedPanelIds, setSelectedPanelIds] = useState<Set<string>>(() => new Set())

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
      if (dirty && !window.confirm(tt(language, 'touchControls.discardSwitchConfirm'))) return
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
      showToast(error instanceof Error ? error.message : tt(language, 'touchControls.operationFailed'), 'error')
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
    showToast(tt(language, 'touchControls.createdToast'), 'success')
  }, [refreshPanels, showToast, summaries.length])

  const requestCreatePanel = useCallback(() => {
    if (dirty && !window.confirm(tt(language, 'touchControls.discardCreateConfirm'))) return
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
        tags: preset.tags,
        buttons: preset.buttons.map((b) => ({ ...b, id: undefined }))
      })
      await window.ipc.invoke('app:touchpanel:save', next)
      await refreshPanels()
      setPanelDraft(next)
      setSelectedId(next.id)
      setSelectedButtonId(null)
      setDirty(false)
      showToast(tt(language, 'touchControls.presetCreatedToast', { name: preset.name }), 'success')
    },
    [refreshPanels, showToast]
  )

  const requestCreateFromPreset = useCallback(
    (id: string) => {
      if (dirty && !window.confirm(tt(language, 'touchControls.discardTemplateConfirm'))) return
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
    showToast(tt(language, 'touchControls.savedToast'), 'success')
  }, [panelDraft, refreshPanels, showToast])

  const deletePanel = useCallback(async () => {
    if (!selectedId) return
    if (!window.confirm(tt(language, 'touchControls.deleteConfirm'))) return
    await window.ipc.invoke('app:touchpanel:delete', selectedId)
    setPanelDraft(null)
    setSelectedId(null)
    setDirty(false)
    await refreshPanels()
    showToast(tt(language, 'touchControls.deletedToast'), 'info')
  }, [refreshPanels, selectedId, showToast])

  const openFullscreen = useCallback(async () => {
    if (!panelDraft) return
    await window.ipc.invoke('app:touchpanel:save', panelDraft)
    setDirty(false)
    const opened = await window.ipc.invoke('app:touchpanel:open', { panelId: panelDraft.id, displayId: panelDisplayId ?? undefined, fullscreen })
    if (!opened) throw new Error(tt(language, 'touchControls.openFailed'))
    showToast(tt(language, 'touchControls.openedToast'), 'success')
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
    showToast(tt(language, 'touchControls.addedPlaylistToast'), 'success')
  }, [fullscreen, language, panelDisplayId, panelDraft, showToast])

  const openPitPanel = useCallback(async () => {
    await window.ipc.invoke('app:pitpanel:open', { displayId: pitDisplayId ?? undefined })
    setPitPanelOpen(true)
    showToast(tt(language, 'touchControls.pitOpenedToast'), 'success')
  }, [language, pitDisplayId, showToast])

  const closePitPanel = useCallback(async () => {
    await window.ipc.invoke('app:pitpanel:close')
    setPitPanelOpen(false)
  }, [])

  const displayOptions = useMemo(
    () =>
      displays.map((d) => (
        <option key={d.id} value={d.id}>
          {d.label} · {d.width}×{d.height}{d.primary ? ' · primary' : ''}
        </option>
      )),
    [displays]
  )

  const filteredTouchPresets = useMemo(
    () => filterByTags(TOUCH_PANEL_PRESETS, presetTagFilters, touchPresetTags),
    [presetTagFilters]
  )
  const visibleSummaries = useMemo(() => summaries.filter((summary) => !summary.hidden), [summaries])
  const hiddenSummaries = useMemo(() => summaries.filter((summary) => summary.hidden), [summaries])

  function togglePanelSelection(id: string): void {
    setSelectedPanelIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function setPanelsHidden(ids: string[], hidden: boolean): Promise<void> {
    if (ids.length === 0) return
    for (const id of ids) {
      await window.ipc.invoke('app:touchpanel:setHidden', id, hidden)
    }
    setSelectedPanelIds(new Set())
    if (selectedId && ids.includes(selectedId) && hidden) {
      setPanelDraft(null)
      setSelectedId(null)
      setDirty(false)
    }
    await refreshPanels()
    showToast(hidden ? tt(language, 'touchControls.hiddenToast') : tt(language, 'touchControls.restoredToast'), 'info')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* â”€â”€ Pit panel launcher (moved out of Dashboards) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section style={panel()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 18 }} aria-hidden>ðŸ</span>
          <strong style={{ color: TEXT_FG, fontSize: 14, letterSpacing: '0.04em' }}>{tt(language, 'touchControls.pitPanelTitle')}</strong>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ color: TEXT_DIM, fontSize: 12 }}>{tt(language, 'touchControls.monitor')}</span>
          <select value={pitDisplayId ?? ''} onChange={(e) => setPitDisplayId(e.target.value ? Number(e.target.value) : null)} style={input()}>
            {displays.length === 0 && <option value="">{tt(language, 'touchControls.noMonitor')}</option>}
            {displayOptions}
          </select>
          <button style={btn('primary')} disabled={busy || displays.length === 0} onClick={() => run(openPitPanel)}>
            {pitPanelOpen ? tt(language, 'touchControls.reopenPitPanel') : tt(language, 'touchControls.openPitPanel')}
          </button>
          {pitPanelOpen && (
            <button style={btn('danger')} disabled={busy} onClick={() => run(closePitPanel)}>
              {tt(language, 'touchControls.closePanel')}
            </button>
          )}
        </div>
        <p style={{ color: TEXT_DIM, fontSize: 12, margin: '8px 0 0' }}>
          {tt(language, 'touchControls.pitHelp')}
          <strong>{tt(language, 'touchControls.dashboardsName')}</strong>
        </p>
      </section>

      {/* â”€â”€ Button-box panels â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section style={panel()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }} aria-hidden>ðŸŽ›ï¸</span>
            <strong style={{ color: TEXT_FG, fontSize: 14, letterSpacing: '0.04em' }}>{tt(language, 'touchControls.editableBoxes')}</strong>
          </div>
          <button style={btn('primary')} disabled={busy} onClick={requestCreatePanel}>ï¼‹ New button box</button>
        </div>

        <details style={{ marginBottom: 12 }}>
          <summary style={{ color: TEXT_FG, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            ðŸ“‹ Start from a built-in preset ({TOUCH_PANEL_PRESETS.length})
          </summary>
          <TagFilter
            items={TOUCH_PANEL_PRESETS}
            selectedTags={presetTagFilters}
            onSelectedTagsChange={setPresetTagFilters}
            getTags={touchPresetTags}
            style={{ marginTop: 10, marginBottom: 10 }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {filteredTouchPresets.map((p) => (
              <button
                key={p.id}
                style={{ ...btn('default'), display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                disabled={busy}
                onClick={() => requestCreateFromPreset(p.id)}
                title={tt(language, 'touchControls.keysCount', { count: p.buttons.length })}
              >
                <span>{p.name}</span>
                <span style={{ fontSize: 11, opacity: 0.7 }}>{p.columns}Ã—{p.rows} Â· {p.buttons.length} keys</span>
              </button>
            ))}
          </div>
        </details>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {visibleSummaries.length === 0 && <span style={{ color: TEXT_DIM, fontSize: 13 }}>{tt(language, 'touchControls.noVisible')}</span>}
          {visibleSummaries.map((s) => (
            <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
              <label style={{ color: TEXT_DIM, fontSize: 12, display: 'flex', gap: 6 }}>
                <input type="checkbox" checked={selectedPanelIds.has(s.id)} disabled={busy} onChange={() => togglePanelSelection(s.id)} />
                {tt(language, 'touchControls.select')}
              </label>
              <button
                style={{ ...btn(s.id === selectedId ? 'primary' : 'default'), display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                disabled={busy}
                onClick={() => requestLoadPanel(s.id)}
              >
                <span>{s.name}</span>
                <span style={{ fontSize: 11, opacity: 0.8 }}>{s.columns}Ã—{s.rows} Â· {s.buttonCount} keys</span>
              </button>
              <button style={btn()} disabled={busy} onClick={() => run(() => setPanelsHidden([s.id], true))}>{tt(language, 'touchControls.hide')}</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button style={btn()} disabled={busy || selectedPanelIds.size === 0} onClick={() => run(() => setPanelsHidden(Array.from(selectedPanelIds), true))}>{tt(language, 'touchControls.hideSelected')}</button>
        </div>
        {hiddenSummaries.length > 0 && (
          <details style={{ marginBottom: 12 }}>
            <summary style={{ color: TEXT_FG, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{tt(language, 'touchControls.hiddenSummary', { count: hiddenSummaries.length })}</summary>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {hiddenSummaries.map((s) => (
                <label key={s.id} style={{ ...btn('default'), display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={selectedPanelIds.has(s.id)} onChange={() => togglePanelSelection(s.id)} />
                  <span>{s.name}</span>
                  <button style={btn()} disabled={busy} onClick={() => run(() => setPanelsHidden([s.id], false))}>{tt(language, 'touchControls.restore')}</button>
                </label>
              ))}
            </div>
            <button style={{ ...btn(), marginTop: 10 }} disabled={busy || selectedPanelIds.size === 0} onClick={() => run(() => setPanelsHidden(Array.from(selectedPanelIds), false))}>{tt(language, 'touchControls.restoreSelected')}</button>
          </details>
        )}

        {panelDraft ? (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <button style={btn('primary')} disabled={busy} onClick={() => run(savePanel)}>{tt(language, 'touchControls.save')}</button>
              <button style={btn()} disabled={busy} onClick={() => run(openFullscreen)}>{tt(language, 'touchControls.openFullscreen')}</button>
              <button style={btn()} disabled={busy} onClick={() => run(addToPlaylist)}>{tt(language, 'touchControls.addPlaylist')}</button>
              <button style={btn('danger')} disabled={busy} onClick={() => run(deletePanel)}>{tt(language, 'touchControls.delete')}</button>
              <span style={{ width: 1, height: 24, background: PANEL_BORDER }} />
              <span style={{ color: TEXT_DIM, fontSize: 12 }}>{tt(language, 'touchControls.monitor')}</span>
              <select value={panelDisplayId ?? ''} onChange={(e) => setPanelDisplayId(e.target.value ? Number(e.target.value) : null)} style={input()}>
                {displays.length === 0 && <option value="">{tt(language, 'touchControls.noMonitor')}</option>}
                {displayOptions}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: TEXT_DIM, fontSize: 13 }}>
                <input type="checkbox" checked={fullscreen} onChange={(e) => setFullscreen(e.target.checked)} />
                {tt(language, 'touchControls.fullscreen')}
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
          <p style={{ color: TEXT_DIM, fontSize: 13 }}>{tt(language, 'touchControls.selectPrompt')}</p>
        )}
      </section>
    </div>
  )
}

