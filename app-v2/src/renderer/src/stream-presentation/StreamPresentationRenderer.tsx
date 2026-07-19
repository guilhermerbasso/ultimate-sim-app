import { useMemo, type CSSProperties, type ReactElement } from 'react'
import type { Dashboard } from '../../../shared/dashboards'
import {
  dashboardForStreamPresentation,
  resolveStreamPresentation,
  resolveTouchPresentationLayout,
  type StreamPresentationProfile
} from '../../../shared/stream-presentation'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import type { ButtonBoxPanel } from '../../../shared/touch-panel'
import { DashboardCanvas } from '../dashboard/DashboardRoot'
import { ButtonBoxRenderer } from '../touchpanel/ButtonBoxRenderer'
import './stream-presentation.css'

export type StreamPresentationRendererMode = 'preview' | 'runtime'

export interface StreamPresentationRendererProps {
  profile: StreamPresentationProfile
  dashboard?: Dashboard | null
  touchPanel?: ButtonBoxPanel | null
  snapshot?: TelemetrySnapshot | null
  mode: StreamPresentationRendererMode
  interactiveTouch?: boolean
  ariaLabel?: string
  unavailableLabel?: string
}

export function StreamPresentationRenderer({
  profile,
  dashboard = null,
  touchPanel = null,
  snapshot = null,
  mode,
  interactiveTouch = false,
  ariaLabel = 'Mobile stream presentation preview',
  unavailableLabel = 'Target preview unavailable.'
}: StreamPresentationRendererProps): ReactElement {
  const resolved = useMemo(() => resolveStreamPresentation(profile), [profile])
  const presentedDashboard = useMemo(
    () => dashboard ? dashboardForStreamPresentation(dashboard, resolved) : null,
    [dashboard, resolved]
  )
  const touchLayout = useMemo(
    () => touchPanel ? resolveTouchPresentationLayout(touchPanel, resolved) : null,
    [resolved, touchPanel]
  )
  const viewportStyle: CSSProperties = {
    width: resolved.viewport.width,
    height: resolved.viewport.height
  }
  const contentStyle: CSSProperties = {
    left: resolved.safeArea.left,
    top: resolved.safeArea.top,
    width: resolved.content.width,
    height: resolved.content.height
  }
  const safeAreaStyle: CSSProperties = {
    left: resolved.safeArea.left,
    top: resolved.safeArea.top,
    right: resolved.safeArea.right,
    bottom: resolved.safeArea.bottom
  }
  const sourceReady = profile.target.kind === 'dashboard' ? Boolean(presentedDashboard) : Boolean(touchPanel)

  return (
    <section
      className={`stream-presentation-renderer is-${mode}`}
      style={viewportStyle}
      aria-label={ariaLabel}
      data-presentation-mode={mode}
      data-presentation-profile={profile.id}
      data-presentation-target={`${profile.target.kind}:${profile.target.id}`}
      data-presentation-signature={resolved.signature}
      data-viewport={`${resolved.viewport.width}x${resolved.viewport.height}`}
      data-active-breakpoint={resolved.activeBreakpointId ?? ''}
    >
      {mode === 'preview' ? (
        <>
          <div className="stream-presentation-safe-mask" style={safeAreaStyle} aria-hidden="true" />
          <span className="stream-presentation-safe-label" aria-hidden="true">
            SAFE {resolved.safeArea.top}/{resolved.safeArea.right}/{resolved.safeArea.bottom}/{resolved.safeArea.left}
          </span>
        </>
      ) : null}
      <div className="stream-presentation-content" style={contentStyle}>
        {profile.target.kind === 'dashboard' && presentedDashboard ? (
          <DashboardCanvas
            dashboard={presentedDashboard}
            snapshot={snapshot}
            viewport={resolved.content}
            preview={mode === 'preview' ? 'inert' : undefined}
            showConnectionStatus={false}
          />
        ) : null}
        {profile.target.kind === 'touch' && touchPanel && touchLayout ? (
          <div
            className="stream-presentation-touch-stage"
            style={{
              width: touchLayout.width,
              height: touchLayout.height,
              left: touchLayout.left,
              top: touchLayout.top,
              transform: `scale(${touchLayout.scale})`
            }}
            data-touch-fit={resolved.fitMode}
            data-touch-scale={touchLayout.scale}
          >
            <ButtonBoxRenderer
              panel={touchPanel}
              interactive={mode === 'preview' && interactiveTouch}
              minimumTouchTarget={resolved.minimumTouchTarget}
              hiddenButtonIds={resolved.hiddenElementIds}
            />
          </div>
        ) : null}
        {!sourceReady ? (
          <div className="stream-presentation-empty" role="status">
            {unavailableLabel}
          </div>
        ) : null}
      </div>
    </section>
  )
}

export default StreamPresentationRenderer
