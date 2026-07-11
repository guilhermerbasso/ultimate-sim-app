import type { Dashboard, DashboardElement, DashboardElementStyle } from './dashboards'
import type { OverlayWidgetId } from './overlays'

export type DenseDashboardSession = 'quali' | 'sprint' | 'race' | 'endurance'
export type DenseDashboardCondition = 'dry' | 'wet' | 'fuel-save' | 'tyre-save'
export type DenseDashboardFocus =
  | 'delta'
  | 'consistency'
  | 'traffic'
  | 'strategy'
  | 'pace'
  | 'stint'
  | 'engineer'

export interface DenseDashboardMatrixEntry {
  id: string
  name: string
  purpose: string
  session: DenseDashboardSession
  condition: DenseDashboardCondition
  focus: DenseDashboardFocus
  priority: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Grid {
  cell(column: number, row: number, columnSpan?: number, rowSpan?: number): Rect
}

export const DASHBOARD_WIDTH = 1024
export const DASHBOARD_HEIGHT = 600
export const DISPLAY_SUFFIX = '1024×600'

export const DENSE_BASE_TAGS = [
  'GT3',
  'IR',
  'dashboard',
  'hifi',
  '1024x600',
  'landscape',
  'dense',
  'revlights',
  'rpm',
  'speed',
  'gear',
  'delta',
  'fuel',
  'tyres',
  'brakes',
  'tc',
  'abs',
  'brake-bias',
  'incidents',
  'map',
  'engine'
] as const

const DENSE_FOCUS_VALUES = new Set<DenseDashboardFocus>([
  'delta',
  'consistency',
  'traffic',
  'strategy',
  'pace',
  'stint',
  'engineer'
])

export function dashboardTags(...tags: string[]): string[] {
  const focus = tags.find((tag) => DENSE_FOCUS_VALUES.has(tag as DenseDashboardFocus))
  return [...new Set([
    ...DENSE_BASE_TAGS,
    ...tags,
    ...(focus ? [`focus-${focus}`] : [])
  ])]
}

let elementSequence = 0
let dashboardSequence = 0

function nextElementId(prefix: string): string {
  elementSequence += 1
  return `${prefix}-el-${elementSequence.toString(36)}`
}

function nextDashboardId(prefix: string): string {
  dashboardSequence += 1
  return `${prefix}-${Date.now().toString(36)}-${dashboardSequence.toString(36)}`
}

export function grid(
  columnWeights: readonly number[],
  rowWeights: readonly number[],
  top: number,
  gap = 8,
  side = 8,
  bottom = 8
): Grid {
  const usableWidth = DASHBOARD_WIDTH - side * 2 - gap * (columnWeights.length - 1)
  const usableHeight = DASHBOARD_HEIGHT - top - bottom - gap * (rowWeights.length - 1)
  const columnTotal = columnWeights.reduce((sum, value) => sum + value, 0)
  const rowTotal = rowWeights.reduce((sum, value) => sum + value, 0)
  const widths = columnWeights.map((weight) => usableWidth * weight / columnTotal)
  const heights = rowWeights.map((weight) => usableHeight * weight / rowTotal)
  const xPositions = widths.map((_, index) =>
    side + widths.slice(0, index).reduce((sum, value) => sum + value, 0) + gap * index
  )
  const yPositions = heights.map((_, index) =>
    top + heights.slice(0, index).reduce((sum, value) => sum + value, 0) + gap * index
  )

  return {
    cell(column, row, columnSpan = 1, rowSpan = 1): Rect {
      return {
        x: xPositions[column],
        y: yPositions[row],
        w: widths.slice(column, column + columnSpan).reduce((sum, value) => sum + value, 0)
          + gap * (columnSpan - 1),
        h: heights.slice(row, row + rowSpan).reduce((sum, value) => sum + value, 0)
          + gap * (rowSpan - 1)
      }
    }
  }
}

export function hifi(
  dashboardId: string,
  moduleId: string,
  rect: Rect,
  style: Partial<DashboardElementStyle> = {}
): DashboardElement {
  return {
    id: nextElementId(dashboardId),
    type: 'overlaywidget',
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    style: {
      background: 'transparent',
      borderWidth: 0,
      radius: 0,
      ...style
    },
    name: moduleId,
    widgetId: `hifi:${moduleId}` as OverlayWidgetId,
    hifiModuleId: moduleId
  }
}

export function rev(
  dashboardId: string,
  moduleId: string,
  height: number
): DashboardElement {
  return hifi(dashboardId, moduleId, { x: 0, y: 0, w: DASHBOARD_WIDTH, h: height })
}

export function frame(
  dashboardId: string,
  name: string,
  purpose: string,
  elements: DashboardElement[]
): Dashboard {
  const now = Date.now()
  return {
    id: nextDashboardId(dashboardId),
    name: `${name} · ${DISPLAY_SUFFIX}`,
    width: DASHBOARD_WIDTH,
    height: DASHBOARD_HEIGHT,
    bg: '#000000',
    scaleMode: 'fit',
    description: purpose,
    author: 'Ultimate Sim App',
    elements,
    createdAt: now,
    updatedAt: now
  }
}

export function displayName(name: string): string {
  return `${name} · ${DISPLAY_SUFFIX}`
}
