import { describe, expect, it } from 'vitest'
import type { DashboardPlaylist } from './dashboards'
import {
  addButtonPanelToPlaylist,
  buttonActionToIpc,
  buttonPanelPlaylistItem,
  clampColumns,
  clampFontSize,
  createButtonBoxPanel,
  estimateDataUrlBytes,
  IMAGE_MAX_BYTES,
  isDataUrlWithinLimit,
  isTouchPanelPlaylistItem,
  normalizeAction,
  parseButtonBoxPanel,
  parseButtonBoxPanelDetailed,
  resizePanelButtons,
  serializeButtonBoxPanel,
  summarizeButtonBoxPanel,
  TOUCH_ACTION_IPC_CHANNEL,
  TYRE_CORNER_LABELS,
  type ButtonAction
} from './touch-panel'

describe('ButtonBox model — clamps', () => {
  it('clamps columns into [1, 8]', () => {
    expect(clampColumns(0)).toBe(1)
    expect(clampColumns(99)).toBe(8)
    expect(clampColumns(4)).toBe(4)
    expect(clampColumns('nope')).toBe(3)
  })

  it('clamps font size into [8, 96]', () => {
    expect(clampFontSize(2)).toBe(8)
    expect(clampFontSize(500)).toBe(96)
    expect(clampFontSize(40)).toBe(40)
  })
})

describe('ButtonBox model — factory', () => {
  it('seeds columns*rows buttons by default', () => {
    const panel = createButtonBoxPanel({ columns: 4, rows: 2 })
    expect(panel.buttons).toHaveLength(8)
    expect(panel.columns).toBe(4)
    expect(panel.rows).toBe(2)
  })

  it('assigns distinct neon palette colours to seeded buttons', () => {
    const panel = createButtonBoxPanel({ columns: 3, rows: 1 })
    const colours = new Set(panel.buttons.map((b) => b.bodyColor))
    expect(colours.size).toBeGreaterThan(1)
  })
})

describe('ButtonBox model — serialize / parse round-trip', () => {
  it('round-trips a panel through JSON', () => {
    const panel = createButtonBoxPanel({ name: 'Pit Box', columns: 2, rows: 2 })
    const json = serializeButtonBoxPanel(panel)
    const parsed = parseButtonBoxPanel(json)
    expect(parsed).not.toBeNull()
    expect(parsed?.id).toBe(panel.id)
    expect(parsed?.name).toBe('Pit Box')
    expect(parsed?.columns).toBe(2)
    expect(parsed?.buttons).toHaveLength(panel.buttons.length)
  })

  it('rejects malformed JSON / missing id', () => {
    expect(parseButtonBoxPanel('{ not json')).toBeNull()
    expect(parseButtonBoxPanel({ name: 'no id' })).toBeNull()
    expect(parseButtonBoxPanel(null)).toBeNull()
  })

  it('summarizes a panel', () => {
    const panel = createButtonBoxPanel({ name: 'X', columns: 3, rows: 2 })
    const summary = summarizeButtonBoxPanel(panel)
    expect(summary).toMatchObject({ id: panel.id, name: 'X', columns: 3, rows: 2, buttonCount: 6 })
  })
})

describe('ButtonBox model — action normalisation + IPC mapping', () => {
  it('normalises unknown actions to none', () => {
    expect(normalizeAction(undefined)).toEqual({ kind: 'none' })
    expect(normalizeAction({ kind: 'bogus' })).toEqual({ kind: 'none' })
    expect(normalizeAction({ kind: 'iracing' })).toEqual({ kind: 'none' })
  })

  it('coerces a keys-less / corrupt keyboard command to a safe shape', () => {
    expect(normalizeAction({ kind: 'keyboard', command: { mode: 'press' } })).toEqual({
      kind: 'keyboard',
      command: { mode: 'press', keys: [] }
    })
    // Invalid mode falls back to press; non-string keys are dropped.
    expect(
      normalizeAction({ kind: 'keyboard', command: { mode: 'bogus', keys: ['a', 5, null, 'b'] } })
    ).toEqual({ kind: 'keyboard', command: { mode: 'press', keys: ['a', 'b'] } })
  })

  it('fails a keys-less legacy keyboard migration instead of silently changing it', () => {
    const result = parseButtonBoxPanelDetailed({
      id: 'p1',
      name: 'Corrupt',
      columns: 1,
      rows: 1,
      buttons: [{ id: 'b1', action: { kind: 'keyboard', command: { mode: 'press' } } }]
    })
    expect(result.panel).toBeNull()
    expect(result.errors.join(' ')).toContain('has no keyboard key list')
    expect(result.errors.join(' ')).toContain('migration aborted')
  })

  it('maps every action kind through the dedicated semantic Touch channel', () => {
    const actions: ButtonAction[] = [
      { kind: 'iracing', command: { group: 'pit', name: 'pit:clearAll' } },
      { kind: 'keyboard', command: { mode: 'press', keys: ['F1'] } },
      { kind: 'app', command: { name: 'dash:cycleNext' } },
      { kind: 'app', command: { name: 'oled:setActivePage', pageIndex: 3 } },
      { kind: 'app', command: { name: 'overlays:toggle', overlayId: 'fuel' } }
    ]
    for (const action of actions) {
      const ipc = buttonActionToIpc(action)
      expect(ipc?.channel).toBe(TOUCH_ACTION_IPC_CHANNEL)
      expect(ipc?.args[0]).toMatchObject({ action, phase: 'trigger', zone: 'main' })
    }
  })

  it('returns null for a none action', () => {
    expect(buttonActionToIpc({ kind: 'none' })).toBeNull()
  })})

describe('ButtonBox model — tyre corner labels (QA: inverted L/R)', () => {
  // Corner-code semantics: L=Esquerdo, R=Direito, F=Dianteiro, R(ear)=Traseiro.
  const cases: Array<[keyof typeof TYRE_CORNER_LABELS, string, string, string]> = [
    ['pit:toggleTyreLf', 'Dianteiro', 'esquerdo', 'LF'],
    ['pit:toggleTyreRf', 'Dianteiro', 'direito', 'RF'],
    ['pit:toggleTyreLr', 'Traseiro', 'esquerdo', 'LR'],
    ['pit:toggleTyreRr', 'Traseiro', 'direito', 'RR']
  ]

  it.each(cases)('%s label matches its corner', (cmd, axle, side, code) => {
    const labelText = TYRE_CORNER_LABELS[cmd]
    expect(labelText).toContain(axle)
    expect(labelText).toContain(side)
    expect(labelText).toContain(code)
  })

  it('does not swap left/right or front/rear', () => {
    // Left corners say esquerdo, right corners say direito.
    expect(TYRE_CORNER_LABELS['pit:toggleTyreLf']).toContain('esquerdo')
    expect(TYRE_CORNER_LABELS['pit:toggleTyreRf']).toContain('direito')
    expect(TYRE_CORNER_LABELS['pit:toggleTyreLr']).toContain('esquerdo')
    expect(TYRE_CORNER_LABELS['pit:toggleTyreRr']).toContain('direito')
    // Front corners say Dianteiro, rear corners say Traseiro.
    expect(TYRE_CORNER_LABELS['pit:toggleTyreLf']).toContain('Dianteiro')
    expect(TYRE_CORNER_LABELS['pit:toggleTyreRr']).toContain('Traseiro')
    // And every corner label is unique.
    const labels = Object.values(TYRE_CORNER_LABELS)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('ButtonBox model — grid resizing (QA: rows/cols add cells)', () => {
  it('grows the button list to columns*rows and shrinks back', () => {
    const panel = createButtonBoxPanel({ columns: 3, rows: 2 })
    expect(panel.buttons).toHaveLength(6)
    const grown = resizePanelButtons(panel.buttons, 3 * 3)
    expect(grown).toHaveLength(9)
    const shrunk = resizePanelButtons(grown, 2 * 2)
    expect(shrunk).toHaveLength(4)
  })

  it('never mutates the input array and keeps existing buttons', () => {
    const panel = createButtonBoxPanel({ columns: 2, rows: 2 })
    const originalIds = panel.buttons.map((b) => b.id)
    const grown = resizePanelButtons(panel.buttons, 6)
    expect(panel.buttons).toHaveLength(4)
    expect(grown.slice(0, 4).map((b) => b.id)).toEqual(originalIds)
  })

  it('seeds appended cells as blank placeholders', () => {
    const grown = resizePanelButtons([], 2)
    expect(grown).toHaveLength(2)
    expect(grown.every((b) => b.label === '')).toBe(true)
  })
})

describe('ButtonBox model — image upload size guard (QA: bloated JSON)', () => {
  it('estimates decoded byte length of a base64 data URL', () => {
    expect(estimateDataUrlBytes('data:image/png;base64,AAAA')).toBe(3)
    expect(estimateDataUrlBytes('')).toBe(0)
  })

  it('flags oversized images as over the limit', () => {
    const big = `data:image/png;base64,${'A'.repeat(300_000)}`
    expect(estimateDataUrlBytes(big)).toBeGreaterThan(IMAGE_MAX_BYTES)
    expect(isDataUrlWithinLimit(big)).toBe(false)
  })

  it('accepts small images', () => {
    expect(isDataUrlWithinLimit('data:image/png;base64,AAAA')).toBe(true)
  })
})

describe('ButtonBox model — image src validation (QA: SSRF/beacon/file read)', () => {
  it('keeps an inline data:image/ URL', () => {
    const panel = createButtonBoxPanel({
      columns: 1,
      rows: 1,
      buttons: [{ image: 'data:image/png;base64,AAAA' }]
    })
    expect(panel.buttons[0].image).toBe('data:image/png;base64,AAAA')
  })

  it('drops external and local-file image URLs on parse', () => {
    for (const evil of ['https://evil.example/beacon.png', 'file:///etc/passwd', 'data:text/html,x', 'javascript:alert(1)']) {
      const json = JSON.stringify({
        id: 'p1',
        name: 'Corrupt',
        columns: 1,
        rows: 1,
        buttons: [{ id: 'b1', image: evil }]
      })
      const parsed = parseButtonBoxPanel(json)
      expect(parsed).not.toBeNull()
      expect(parsed!.buttons[0].image).toBeUndefined()
    }
  })
})

describe('ButtonBox model — playlist integration', () => {
  it('builds a touch-panel playlist item flagged correctly', () => {
    const item = buttonPanelPlaylistItem('panel-1', { displayId: 2, fullscreen: true })
    expect(item.dashboardId).toBe('panel-1')
    expect(item.touchPanelId).toBe('panel-1')
    expect(item.kind).toBe('touch-panel')
    expect(item.displayId).toBe(2)
    expect(isTouchPanelPlaylistItem(item)).toBe(true)
  })

  it('does not flag a regular dashboard item as a touch panel', () => {
    expect(isTouchPanelPlaylistItem({ dashboardId: 'dash-1' })).toBe(false)
  })

  it('appends a panel to an existing playlist without dropping items', () => {
    const playlist: DashboardPlaylist = {
      items: [{ dashboardId: 'dash-1' }],
      updatedAt: 0
    }
    const next = addButtonPanelToPlaylist(playlist, 'panel-9', { displayId: 1 })
    expect(next.items).toHaveLength(2)
    expect(next.items[0].dashboardId).toBe('dash-1')
    expect(next.items[1].touchPanelId).toBe('panel-9')
    expect(isTouchPanelPlaylistItem(next.items[1])).toBe(true)
    expect(next.updatedAt).toBeGreaterThan(0)
  })
})
