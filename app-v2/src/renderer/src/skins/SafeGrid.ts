// Safe-area grid — snap every widget element to whole cells so icons/telltales
// are drawn in fixed inner boxes and NEVER size to content (symbol overflow
// becomes impossible by construction — research opus.md §2.6). Coordinates are
// SVG design units; the root viewBox scales them uniformly.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface SafeGrid {
  cols: number
  rows: number
  W: number
  H: number
  gutter: number
  cellW: number
  cellH: number
  /** Rect for a cell block starting at (col,row), spanning colSpan×rowSpan cells. */
  cell(col: number, row: number, colSpan?: number, rowSpan?: number): Rect
  /** Rect shrunk by `pad` on every side (for the inner drawable area). */
  inset(rect: Rect, pad: number): Rect
}

export function makeGrid(cols: number, rows: number, W: number, H: number, gutter = 8): SafeGrid {
  const usableW = Math.max(0, W - gutter * (cols + 1))
  const usableH = Math.max(0, H - gutter * (rows + 1))
  const cellW = cols > 0 ? usableW / cols : 0
  const cellH = rows > 0 ? usableH / rows : 0

  function cell(col: number, row: number, colSpan = 1, rowSpan = 1): Rect {
    const c = Math.max(0, Math.min(cols - 1, col))
    const r = Math.max(0, Math.min(rows - 1, row))
    const cs = Math.max(1, Math.min(cols - c, colSpan))
    const rs = Math.max(1, Math.min(rows - r, rowSpan))
    return {
      x: gutter + c * (cellW + gutter),
      y: gutter + r * (cellH + gutter),
      w: cs * cellW + (cs - 1) * gutter,
      h: rs * cellH + (rs - 1) * gutter
    }
  }

  function inset(rect: Rect, pad: number): Rect {
    const p = Math.min(pad, rect.w / 2, rect.h / 2)
    return { x: rect.x + p, y: rect.y + p, w: Math.max(0, rect.w - p * 2), h: Math.max(0, rect.h - p * 2) }
  }

  return { cols, rows, W, H, gutter, cellW, cellH, cell, inset }
}

/** Canonical 800×480 GT3/LMDh wheel-display grid (12 cols × 6 rows). */
export const WHEEL_GRID: SafeGrid = makeGrid(12, 6, 800, 480, 8)
