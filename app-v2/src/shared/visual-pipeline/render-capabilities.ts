import type { DashboardElementType } from '../dashboards'

export interface DashboardElementRenderCapabilities {
  consumesBinding: boolean
}

const BINDING_CONSUMER_TYPES = [
  'text',
  'bar',
  'barv',
  'dualbar',
  'deltabar',
  'gauge',
  'shiftlights',
  'map',
  'trace',
  'shiftbar',
  'deltatile',
  'trackmini',
  'trackmap-clean',
  'trackmap-elaborate',
  'delta-clean',
  'delta-elaborate',
  'value',
  'valuebar',
  'valuegauge',
  'analoggauge',
  'linearmeter',
  'segment7',
  'digitalclock',
  'bigtext',
  'historygraph',
  'donut',
  'segmentbars',
  'ringgauge',
  'ledbar',
  'statuslamp',
  'neon-ring-futuristic',
  'segmented-gauge-futuristic',
  'sci-fi-delta-futuristic',
  'hud-tile-futuristic',
  'neon-bar-futuristic',
  'grid-gauge-futuristic',
  'mono-tile-minimal',
  'typo-readout-minimal',
  'hairline-bar-minimal',
  'dot-gauge-minimal',
  'stacked-readout-minimal',
  'arc-minimal'
] as const satisfies readonly DashboardElementType[]

export const DASHBOARD_RENDER_CAPABILITIES = Object.freeze(
  Object.fromEntries(
    BINDING_CONSUMER_TYPES.map((type) => [
      type,
      Object.freeze({ consumesBinding: true })
    ])
  ) as Partial<Record<DashboardElementType, DashboardElementRenderCapabilities>>
)

export function dashboardElementConsumesBinding(type: DashboardElementType): boolean {
  return DASHBOARD_RENDER_CAPABILITIES[type]?.consumesBinding === true
}
