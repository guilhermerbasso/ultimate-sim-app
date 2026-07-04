// Pure, unit-tested layout helpers for the touch Pit & Command panel.
//
// The previous panel placed six sections onto a `repeat(3, 1fr)` grid with
// `grid-auto-rows: minmax(0, 1fr)` and a single hand-tuned `grid-row: span 2`
// on the tyre card. On the 7" (≈1024×600) screen the equal-height rows could not
// contain the taller cards (fuel +/- grid, the 15-key chat-macro grid and the
// three-row replay transport), so their content spilled out of the cell and
// visually COLLIDED with the neighbouring card (IMG_3279).
//
// The fix expresses the placement as explicit, non-overlapping grid rectangles so
// the layout is deterministic and testable. The renderer drives each section's
// `grid-column` / `grid-row` from these rectangles, and the CSS lets each card
// scroll internally instead of overflowing onto its neighbour.

export type PitSectionId = 'fuel' | 'tyres' | 'service' | 'chat' | 'camera' | 'replay'

export interface PitSectionMeta {
  id: PitSectionId
  title: string
}

// Render/order metadata. The order here is the DOM order; placement is decided by
// the grid rectangles below.
export const PIT_SECTIONS: PitSectionMeta[] = [
  { id: 'fuel', title: 'Combustível' },
  { id: 'tyres', title: 'Pneus' },
  { id: 'service', title: 'Serviço' },
  { id: 'chat', title: 'Chat macros' },
  { id: 'camera', title: 'Câmera' },
  { id: 'replay', title: 'Replay' }
]

/** 1-based grid placement (CSS grid line semantics). */
export interface PitPlacement {
  id: PitSectionId
  /** 1-based column line start. */
  column: number
  /** 1-based row line start. */
  row: number
  columnSpan: number
  rowSpan: number
}

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

function toRect(p: PitPlacement): Rect {
  return { x0: p.column, y0: p.row, x1: p.column + p.columnSpan, y1: p.row + p.rowSpan }
}

/** True when two half-open rectangles share any area. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

/** Returns every pair of placement ids whose grid rectangles overlap. */
export function findOverlaps(placements: PitPlacement[]): Array<[PitSectionId, PitSectionId]> {
  const out: Array<[PitSectionId, PitSectionId]> = []
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      if (rectsOverlap(toRect(placements[i]), toRect(placements[j]))) {
        out.push([placements[i].id, placements[j].id])
      }
    }
  }
  return out
}

// Canonical wide layout for a 3-column screen (the 7" cockpit panel).
//
// The earlier layout used three equal-height rows, so fuel and chat each got only
// ~1/3 of the panel height (~180px). That squeezed the fuel card's tall stack
// (readout + steppers + presets + the primary "Abastecer" CTA) into a band where
// the CTA could sit below the internal scroll fold, and left the chat macro grid
// cramped. We now express the grid over EIGHT `1fr` rows so fuel and chat can each
// span 3 rows (taller than before), tyres keeps the tallest span, and the
// full-width replay transport keeps a 2-row band at the bottom. Every column sums
// to the same 8 rows, so the grid stays fully packed and overlap-free.
//
//   col1        col2        col3
// ┌──────────┬──────────┬──────────┐ row1
// │ fuel     │ tyres    │ service  │ row2
// │ (span 3) │ (tall,   │ (span 3) │ row3
// ├──────────┤  span 6) ├──────────┤ row4
// │ chat     │          │ camera   │ row5
// │ (span 3) │          │ (span 3) │ row6
// ├──────────┴──────────┴──────────┤ row7
// │ replay (full-width transport)  │ row8
// └────────────────────────────────┘
const WIDE_LAYOUT: PitPlacement[] = [
  { id: 'fuel', column: 1, row: 1, columnSpan: 1, rowSpan: 3 },
  { id: 'tyres', column: 2, row: 1, columnSpan: 1, rowSpan: 6 },
  { id: 'service', column: 3, row: 1, columnSpan: 1, rowSpan: 3 },
  { id: 'chat', column: 1, row: 4, columnSpan: 1, rowSpan: 3 },
  { id: 'camera', column: 3, row: 4, columnSpan: 1, rowSpan: 3 },
  { id: 'replay', column: 1, row: 7, columnSpan: 3, rowSpan: 2 }
]

/** Single-column stack used when the panel is narrow (≤2 columns). */
function stackLayout(columns: number): PitPlacement[] {
  const span = Math.max(1, columns)
  return PIT_SECTIONS.map((section, index) => ({
    id: section.id,
    column: 1,
    row: index + 1,
    columnSpan: span,
    rowSpan: 1
  }))
}

export const PIT_GRID_COLUMNS = 3

/**
 * Compute non-overlapping grid placements for the six pit sections.
 * @param columns Number of grid columns the panel renders with (default 3).
 */
export function computePitLayout(columns: number = PIT_GRID_COLUMNS): PitPlacement[] {
  if (columns >= 3) return WIDE_LAYOUT.map((p) => ({ ...p }))
  return stackLayout(columns)
}

/** The number of grid rows the layout occupies (for `grid-template-rows`). */
export function pitLayoutRowCount(placements: PitPlacement[]): number {
  return placements.reduce((max, p) => Math.max(max, p.row + p.rowSpan - 1), 0)
}

// ── Touch ergonomics geometry ────────────────────────────────────────────────
// Pure, CSS-mirroring constants so the touch-target and card-height guarantees
// can be proven in unit tests instead of only in a running browser. Keep these in
// sync with pitpanel.css (they intentionally describe the same pixels).

/** Physical panel size of the 7" cockpit touchscreen. */
export const PIT_SCREEN_WIDTH_PX = 1024
export const PIT_SCREEN_HEIGHT_PX = 600

/** Minimum comfortable touch target on the 7" panel (both width and height). */
export const PIT_TOUCH_TARGET_MIN_PX = 56

/** Gap between grid cells (`.pp-grid { gap }`). */
export const PIT_GRID_GAP_PX = 10
/** Horizontal padding inside `.pp-shell` (per side). */
export const PIT_SHELL_PADDING_X_PX = 10
/** Horizontal padding inside a `.pp-section` card (per side). */
export const PIT_CARD_PADDING_X_PX = 12
/** Columns in the chat macro grid (reduced from 5 → 4 to widen each key). */
export const PIT_MACRO_COLUMNS = 4
/** Gap between chat macro buttons (`.pp-macro-grid { gap }`). */
export const PIT_MACRO_GAP_PX = 6

/**
 * Height (px) that a grid section of `rowSpan` rows receives, given the panel's
 * available grid height, total row count and inter-row gap. Mirrors CSS
 * `grid-template-rows: repeat(rowCount, minmax(0, 1fr))`.
 */
export function sectionHeightPx(
  rowSpan: number,
  rowCount: number,
  availableHeightPx: number,
  gapPx: number = PIT_GRID_GAP_PX
): number {
  const rowPx = (availableHeightPx - (rowCount - 1) * gapPx) / rowCount
  return rowSpan * rowPx + (rowSpan - 1) * gapPx
}

/** Inner (content) width of a single card in the wide 3-column grid. */
export function pitCardInnerWidthPx(
  columns: number = PIT_GRID_COLUMNS,
  screenWidthPx: number = PIT_SCREEN_WIDTH_PX,
  gapPx: number = PIT_GRID_GAP_PX,
  shellPaddingXPx: number = PIT_SHELL_PADDING_X_PX,
  cardPaddingXPx: number = PIT_CARD_PADDING_X_PX
): number {
  const gridWidth = screenWidthPx - shellPaddingXPx * 2
  const columnWidth = (gridWidth - (columns - 1) * gapPx) / columns
  return columnWidth - cardPaddingXPx * 2
}

/** Width (px) of a chat macro button given the card width and macro grid config. */
export function macroButtonWidthPx(
  cardInnerWidthPx: number = pitCardInnerWidthPx(),
  macroColumns: number = PIT_MACRO_COLUMNS,
  gapPx: number = PIT_MACRO_GAP_PX
): number {
  return (cardInnerWidthPx - (macroColumns - 1) * gapPx) / macroColumns
}
