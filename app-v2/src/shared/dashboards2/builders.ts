import type { CarFamily } from '../car-families'
import type { Dashboard, DashboardElement, DashboardElementStyle, DashboardElementType } from '../dashboards'

export type Dashboard2LayoutClass = 'cockpit' | 'engineer' | 'endurance' | 'strategy' | 'broadcast'

export interface Dashboard2Target {
  width: number
  height: number
}

const FONT_TECH = '"Avenir Next", "Bahnschrift", "Segoe UI", system-ui, sans-serif'
const FONT_CONDENSED = '"Avenir Next Condensed", "DIN Condensed", "Arial Narrow", system-ui, sans-serif'
const FONT_NUM = '"DSEG7 Classic", "DS-Digital", "SF Mono", "Cascadia Mono", ui-monospace, monospace'

const LAYOUT_LABELS: Record<Dashboard2LayoutClass, string> = {
  cockpit: 'DDU Cockpit',
  engineer: 'Engineer Wall',
  endurance: 'Endurance Stint',
  strategy: 'Strategy Desk',
  broadcast: 'Broadcast Race'
}

let nextElementId = 0

function resetIds(): void {
  nextElementId = 0
}

function elementId(dashId: string): string {
  nextElementId += 1
  return `${dashId}-el-${nextElementId}`
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function px(value: number, fallback = 0): number {
  return Math.max(0, Math.round(finiteNumber(value, fallback)))
}

function clampMin(value: number, min: number): number {
  return Math.max(min, px(value, min))
}

function panelStyle(family: CarFamily, extra: DashboardElementStyle = {}): DashboardElementStyle {
  return {
    background: `${family.palette.bg}EE`,
    border: family.palette.accent,
    borderWidth: 1,
    radius: 12,
    color: family.palette.text,
    fontFamily: FONT_TECH,
    accentColor: family.palette.accent,
    brandStyle: family.brandStyle,
    skin: 'gt3',
    ...extra
  }
}

function element(
  dashId: string,
  type: DashboardElementType,
  x: number,
  y: number,
  w: number,
  h: number,
  style: DashboardElementStyle,
  opts: { binding?: string; name?: string } = {}
): DashboardElement {
  return {
    id: elementId(dashId),
    type,
    x: px(x),
    y: px(y),
    w: clampMin(w, 1),
    h: clampMin(h, 1),
    binding: opts.binding,
    name: opts.name,
    style
  }
}

interface RectSpec {
  x: number
  y: number
  w: number
  h: number
}

function makeGrid(width: number, height: number, rows: number, cols: number, margin: number, top: number, gap: number): RectSpec[] {
  const contentY = margin + top + gap
  const contentH = Math.max(1, height - contentY - margin)
  const cellW = Math.max(1, (width - margin * 2 - gap * (cols - 1)) / cols)
  const cellH = Math.max(1, (contentH - gap * (rows - 1)) / rows)
  const cells: RectSpec[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({ x: margin + col * (cellW + gap), y: contentY + row * (cellH + gap), w: cellW, h: cellH })
    }
  }
  return cells
}

function baseElements(dashId: string, family: CarFamily, width: number, height: number): { elements: DashboardElement[]; margin: number; gap: number; top: number } {
  const margin = clampMin(Math.min(width, height) * 0.025, 10)
  const gap = clampMin(Math.min(width, height) * 0.015, 8)
  const top = clampMin(height * 0.052, 24)
  const elements = [
    element(dashId, 'rect', 0, 0, width, height, { background: family.palette.bg, borderWidth: 0, radius: 0, brandStyle: family.brandStyle, skin: 'gt3' }, { name: 'Backplate' }),
    element(
      dashId,
      'shiftlights',
      margin,
      margin,
      width - margin * 2,
      top,
      panelStyle(family, {
        background: 'transparent',
        borderWidth: 0,
        segments: 18,
        fillColor: family.palette.good,
        warnColor: family.palette.warn,
        dangerColor: family.palette.danger,
        warnAt: 0.62,
        dangerAt: 0.86
      }),
      { binding: 'shiftPct', name: 'Shift Lights' }
    )
  ]
  return { elements, margin, gap, top }
}

function tile(
  dashId: string,
  family: CarFamily,
  rect: RectSpec,
  binding: string,
  label: string,
  type: DashboardElementType = 'text',
  extra: DashboardElementStyle = {}
): DashboardElement {
  return element(
    dashId,
    type,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    panelStyle(family, {
      label,
      title: label,
      align: 'center',
      fontFamily: type === 'text' || type === 'gauge' ? FONT_NUM : FONT_TECH,
      minFontSize: 12,
      maxFontSize: 72,
      ...extra
    }),
    { binding, name: label }
  )
}

function cockpit(dashId: string, family: CarFamily, width: number, height: number): DashboardElement[] {
  const base = baseElements(dashId, family, width, height)
  const c = makeGrid(width, height, 3, 4, base.margin, base.top, base.gap)
  return [
    ...base.elements,
    tile(dashId, family, c[0], 'gearLabel', 'GEAR', 'text', { fontFamily: FONT_CONDENSED, fontWeight: 800, maxFontSize: 120 }),
    tile(dashId, family, c[1], 'speedKmh', 'KM/H', 'gauge', { gaugeMin: 0, gaugeMax: family.class === 'prototype' ? 360 : 320, suffix: 'km/h' }),
    tile(dashId, family, c[2], 'rpmPct', 'RPM', 'bar', { fillColor: family.palette.accent, warnColor: family.palette.warn, dangerColor: family.palette.danger, warnAt: 0.7, dangerAt: 0.9 }),
    tile(dashId, family, c[3], 'flagLabel', 'FLAG', 'flag', { flagKey: 'any', fillColor: family.palette.warn }),
    tile(dashId, family, c[4], 'deltaBestFmt', 'Δ BEST', 'deltabar', { deltaRangeSec: 1, fillColor: family.palette.good }),
    tile(dashId, family, c[5], 'fuelPct', 'FUEL', 'bar', { fillColor: family.palette.good, warnColor: family.palette.warn, dangerColor: family.palette.danger, reverse: false }),
    tile(dashId, family, c[6], 'throttle', 'THR / BRK', 'dualbar', { fillColor: family.palette.good, secondaryBinding: 'brake', secondaryColor: family.palette.danger }),
    tile(dashId, family, c[7], 'currentLapFmt', 'LAP', 'text'),
    tile(dashId, family, c[8], 'position', 'POS', 'text', { accentColor: family.palette.warn }),
    tile(dashId, family, c[9], 'gapAheadFmt', 'AHEAD', 'text', { accentColor: family.palette.good }),
    tile(dashId, family, c[10], 'gapBehindFmt', 'BEHIND', 'text', { accentColor: family.palette.danger }),
    tile(dashId, family, c[11], 'pitLimiter', 'PIT', 'text', { accentColor: family.palette.warn })
  ]
}

function engineer(dashId: string, family: CarFamily, width: number, height: number): DashboardElement[] {
  const base = baseElements(dashId, family, width, height)
  const c = makeGrid(width, height, 4, 3, base.margin, base.top, base.gap)
  return [
    ...base.elements,
    tile(dashId, family, c[0], 'rpm', 'RPM TRACE', 'trace', { traceLength: 160, traceColor2: family.palette.warn, secondaryBinding: 'throttle' }),
    tile(dashId, family, c[1], 'brake', 'BRAKE', 'barv', { fillColor: family.palette.danger }),
    tile(dashId, family, c[2], 'throttle', 'THROTTLE', 'barv', { fillColor: family.palette.good }),
    tile(dashId, family, c[3], 'trackTempC', 'TRACK °C', 'gauge', { gaugeMin: 0, gaugeMax: 70, suffix: '°C', accentColor: family.palette.warn }),
    tile(dashId, family, c[4], 'airTempC', 'AIR °C', 'gauge', { gaugeMin: -5, gaugeMax: 45, suffix: '°C' }),
    tile(dashId, family, c[5], 'fuelPerLap', 'L/LAP', 'text', { decimals: 2, suffix: ' L' }),
    tile(dashId, family, c[6], 'bestLapFmt', 'BEST', 'text', { accentColor: family.palette.good }),
    tile(dashId, family, c[7], 'lastLapFmt', 'LAST', 'text'),
    tile(dashId, family, c[8], 'deltaSessionBestFmt', 'Δ SESSION', 'deltabar', { deltaRangeSec: 1.5, fillColor: family.palette.good }),
    tile(dashId, family, c[9], 'incidentCount', 'INC', 'text', { accentColor: family.palette.danger }),
    tile(dashId, family, c[10], 'absActive', 'ABS', 'text', { accentColor: family.palette.warn }),
    tile(dashId, family, c[11], 'tcActive', 'TC', 'text', { accentColor: family.palette.warn })
  ]
}

function endurance(dashId: string, family: CarFamily, width: number, height: number): DashboardElement[] {
  const base = baseElements(dashId, family, width, height)
  const c = makeGrid(width, height, 3, 4, base.margin, base.top, base.gap)
  return [
    ...base.elements,
    tile(dashId, family, c[0], 'fuelLitersStr', 'FUEL L', 'text', { accentColor: family.palette.good }),
    tile(dashId, family, c[1], 'fuelPct', 'TANK', 'bar', { fillColor: family.palette.good, warnColor: family.palette.warn, dangerColor: family.palette.danger }),
    tile(dashId, family, c[2], 'fuelLapsLeftStr', 'LAPS LEFT', 'text', { accentColor: family.palette.good }),
    tile(dashId, family, c[3], 'fuelPerLap', 'L/LAP', 'text', { decimals: 2, suffix: ' L' }),
    tile(dashId, family, c[4], 'lapsRemaining', 'TO GO', 'text'),
    tile(dashId, family, c[5], 'currentLap', 'LAP NO', 'text'),
    tile(dashId, family, c[6], 'currentLapFmt', 'CURRENT', 'text'),
    tile(dashId, family, c[7], 'lastLapFmt', 'LAST', 'text'),
    tile(dashId, family, c[8], 'deltaBestFmt', 'Δ BEST', 'deltabar', { deltaRangeSec: 2, fillColor: family.palette.good }),
    tile(dashId, family, c[9], 'flagLabel', 'FLAG', 'flag', { flagKey: 'any' }),
    tile(dashId, family, c[10], 'position', 'POS', 'text', { accentColor: family.palette.warn }),
    tile(dashId, family, c[11], 'speedKmh', 'SPEED', 'gauge', { gaugeMax: family.class === 'prototype' ? 360 : 320, suffix: 'km/h' })
  ]
}

function strategy(dashId: string, family: CarFamily, width: number, height: number): DashboardElement[] {
  const base = baseElements(dashId, family, width, height)
  const c = makeGrid(width, height, 4, 3, base.margin, base.top, base.gap)
  return [
    ...base.elements,
    tile(dashId, family, c[0], 'position', 'OVERALL', 'text', { accentColor: family.palette.warn }),
    tile(dashId, family, c[1], 'classPosition', 'CLASS', 'text', { accentColor: family.palette.warn }),
    tile(dashId, family, c[2], 'totalCars', 'FIELD', 'text'),
    tile(dashId, family, c[3], 'gapAheadFmt', 'GAP AHEAD', 'text', { accentColor: family.palette.good }),
    tile(dashId, family, c[4], 'gapBehindFmt', 'GAP BACK', 'text', { accentColor: family.palette.danger }),
    tile(dashId, family, c[5], 'incidentCount', 'INCIDENTS', 'text', { accentColor: family.palette.danger }),
    tile(dashId, family, c[6], 'fuelLapsLeftStr', 'FUEL LAPS', 'text', { accentColor: family.palette.good }),
    tile(dashId, family, c[7], 'fuelPct', 'FUEL %', 'bar', { fillColor: family.palette.good }),
    tile(dashId, family, c[8], 'pitLimiter', 'PIT LIMITER', 'text', { accentColor: family.palette.warn }),
    tile(dashId, family, c[9], 'flagAny', 'CAUTION', 'flag', { flagKey: 'any' }),
    tile(dashId, family, c[10], 'deltaSessionBestFmt', 'Δ FIELD', 'deltabar', { deltaRangeSec: 2, fillColor: family.palette.good }),
    tile(dashId, family, c[11], 'drs', 'DRS', 'text', { accentColor: family.palette.good })
  ]
}

function broadcast(dashId: string, family: CarFamily, width: number, height: number): DashboardElement[] {
  const base = baseElements(dashId, family, width, height)
  const c = makeGrid(width, height, 3, 4, base.margin, base.top, base.gap)
  return [
    ...base.elements,
    element(dashId, 'standings', c[0].x, c[0].y, c[0].w, c[0].h, panelStyle(family, { tableColumns: ['pos', 'number', 'name', 'gap'], tableMaxRows: 6, showHeader: true, headerColor: family.palette.accent }), { name: 'Standings' }),
    tile(dashId, family, c[1], 'gearLabel', 'GEAR', 'text', { fontFamily: FONT_CONDENSED, fontWeight: 800, maxFontSize: 100 }),
    tile(dashId, family, c[2], 'speedKmh', 'SPEED', 'gauge', { suffix: 'km/h', gaugeMax: family.class === 'prototype' ? 360 : 320 }),
    tile(dashId, family, c[3], 'rpmPct', 'RPM', 'bar', { fillColor: family.palette.accent, warnColor: family.palette.warn, dangerColor: family.palette.danger }),
    tile(dashId, family, c[4], 'position', 'POS', 'text', { accentColor: family.palette.warn }),
    tile(dashId, family, c[5], 'classPosition', 'CLASS', 'text', { accentColor: family.palette.warn }),
    tile(dashId, family, c[6], 'gapAheadFmt', 'AHEAD', 'text', { accentColor: family.palette.good }),
    tile(dashId, family, c[7], 'gapBehindFmt', 'BEHIND', 'text', { accentColor: family.palette.danger }),
    tile(dashId, family, c[8], 'currentLapFmt', 'LAP TIME', 'text'),
    tile(dashId, family, c[9], 'bestLapFmt', 'BEST', 'text', { accentColor: family.palette.good }),
    tile(dashId, family, c[10], 'flagColor', 'FLAG COLOR', 'flag', { flagKey: 'any' }),
    tile(dashId, family, c[11], 'fuelLitersStr', 'FUEL', 'text', { accentColor: family.palette.good })
  ]
}

const BUILDERS: Record<Dashboard2LayoutClass, (dashId: string, family: CarFamily, width: number, height: number) => DashboardElement[]> = {
  cockpit,
  engineer,
  endurance,
  strategy,
  broadcast
}

export function buildDashboard2(family: CarFamily, layoutClass: Dashboard2LayoutClass, target: Dashboard2Target): Dashboard {
  const width = clampMin(target.width, 1)
  const height = clampMin(target.height, 1)
  const dashId = `d2-${family.id}-${layoutClass}-${width}x${height}`
  resetIds()
  const elements = BUILDERS[layoutClass](dashId, family, width, height)
  return {
    id: dashId,
    name: `${family.displayName} · ${LAYOUT_LABELS[layoutClass]} · ${width}×${height}`,
    width,
    height,
    bg: family.palette.bg,
    scaleMode: 'fit',
    elements,
    description: `${family.displayName} ${LAYOUT_LABELS[layoutClass].toLowerCase()} dashboard for ${family.class === 'prototype' ? 'prototype endurance' : 'GT3'} telemetry, using generic colours and no licensed marks.`,
    author: 'Ultimate Sim App',
    createdAt: 0,
    updatedAt: 0
  }
}

export const DASHBOARD2_LAYOUT_CLASSES: Dashboard2LayoutClass[] = ['cockpit', 'engineer', 'endurance', 'strategy', 'broadcast']
