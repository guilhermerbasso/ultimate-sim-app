import './views-harness-stubs'

import { createRoot } from 'react-dom/client'
import type { CSSProperties } from 'react'
import type { Dashboard } from '@shared/dashboards'
import {
  createStreamPresentationProfile,
  type StreamPresentationTargetDescriptor
} from '@shared/stream-presentation'
import { createButtonBoxPanel } from '@shared/touch-panel'
import { ResponsiveStreamPresentationFrame } from '@renderer/stream-presentation/ResponsiveStreamPresentationFrame'
import '@renderer/dashboard/dashboard-runtime.css'
import '@renderer/touchpanel/buttonbox.css'

const query = new URLSearchParams(window.location.search)
const kind = query.get('kind') === 'touch' ? 'touch' : 'dashboard'
const presetId = query.get('preset') ?? 'iphone-15-pro'
const orientation = query.get('orientation') === 'landscape' ? 'landscape' : 'portrait'
const interactiveTouch = query.get('interactive') === '1'
const columns = Math.max(1, Math.min(16, Number(query.get('columns')) || 2))
const safeTop = Math.max(0, Number(query.get('safeTop')) || 0)
const safeRight = Math.max(0, Number(query.get('safeRight')) || 0)
const safeBottom = Math.max(0, Number(query.get('safeBottom')) || 0)
const safeLeft = Math.max(0, Number(query.get('safeLeft')) || 0)

const target: StreamPresentationTargetDescriptor = kind === 'touch'
  ? {
      kind: 'touch',
      id: 'visual-touch',
      name: 'Visual touch controls',
      revision: `touch:visual:${columns}`,
      itemCount: columns,
      hidden: false
    }
  : {
      kind: 'dashboard',
      id: 'visual-dashboard',
      name: 'Visual dashboard',
      revision: 'dashboard:visual:1',
      width: 1024,
      height: 600,
      itemCount: 0,
      hidden: false
    }
const profile = createStreamPresentationProfile(target, {
  id: `visual-${kind}-${presetId}`,
  presetId,
  now: 10
})
profile.settings.orientation = orientation

const dashboard: Dashboard = {
  id: 'visual-dashboard',
  name: 'Visual dashboard',
  width: 1024,
  height: 600,
  bg: '#02080d',
  elements: []
}
const panel = createButtonBoxPanel({
  id: 'visual-touch',
  name: 'Visual touch controls',
  columns,
  rows: 1,
  buttons: Array.from({ length: columns }, (_, index) => ({
    id: `visual-control-${index}`,
    label: `CONTROL ${index + 1}`,
    control: {
      kind: 'momentary' as const,
      action: { kind: 'none' as const }
    }
  }))
})
const frameStyle = {
  '--stream-safe-area-top': `${safeTop}px`,
  '--stream-safe-area-right': `${safeRight}px`,
  '--stream-safe-area-bottom': `${safeBottom}px`,
  '--stream-safe-area-left': `${safeLeft}px`
} as CSSProperties

createRoot(document.getElementById('root')!).render(
  <ResponsiveStreamPresentationFrame
    profile={profile}
    dashboard={kind === 'dashboard' ? dashboard : null}
    touchPanel={kind === 'touch' ? panel : null}
    mode="runtime"
    interactiveTouch={interactiveTouch}
    style={frameStyle}
    ariaLabel={`${kind} responsive visual harness`}
  />
)

document.documentElement.dataset.harness = 'stream-presentation-responsive'
