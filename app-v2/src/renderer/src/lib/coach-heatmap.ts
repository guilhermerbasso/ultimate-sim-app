// WS-M — renderer helper that subscribes to the live coaching report so every
// heatmap surface (the interactive Coach panel, the read-only overlay widget and
// the dashboard widget) shares ONE subscription pattern.
//
// The corner map (numbered Curva 1..N) AND the per-corner findings/deltas all
// ride inside `CoachReport` (`report.corners` + `report.findings` +
// `report.cornerMetrics`), so this hook is the single source the heatmap needs on
// top of the existing `useTrackMapData()` geometry hook. It rides the EXISTING
// `coach:` preload prefix — no new channel namespace is introduced.

import { useEffect, useState } from 'react'
import { COACH_CHANNELS, type CoachReport, type CoachReportPayload } from '../../../shared/coach'

/**
 * Subscribe to the latest deterministic `CoachReport`. Seeds from `coach:getReport`
 * and then follows the `coach:report` broadcast. Test/SSR-safe: it no-ops when
 * `window.ipc` is unavailable (e.g. a render harness) and swallows IPC rejections
 * (e.g. an overlay window before `coach:` is wired) so the heatmap yesply falls
 * back to a plain outline instead of throwing.
 */
export function useCoachReport(): CoachReport | null {
  const [report, setReport] = useState<CoachReport | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ipc) return
    let active = true

    void window.ipc
      .invoke<CoachReportPayload | null>(COACH_CHANNELS.getReport)
      .then((payload) => {
        if (active && payload) setReport(payload.report)
      })
      .catch(() => undefined)

    const unsub = window.ipc.subscribe<CoachReportPayload | null>(COACH_CHANNELS.report, (payload) => {
      if (payload) setReport(payload.report)
    })

    return () => {
      active = false
      unsub()
    }
  }, [])

  return report
}
