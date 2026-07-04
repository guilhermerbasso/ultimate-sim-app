// Renderer-shared helpers for drawing the track map (used by both the dashboard
// `ElementMap` and the overlay `TrackMapWidget`).
//
// The data layer (src/shared/track-map.ts + main process) gives us a
// `TrackMapData` that either contains the official iRacing SVG layers OR a
// learned normalized polyline. This module turns either flavour into a uniform
// `TrackMapRenderable` exposing:
//   • the SVG `viewBox` to drive the <svg> wrapper;
//   • path `d` strings for the outline / pitroad / start-finish marker;
//   • `sample(pct)` and `samplePath(frac)` callbacks that map a 0..1 progress
//     to a point in viewBox coordinates so car dots can be plotted.
//
// Sampling strategy: we create a single offscreen `<path>` (via
// `document.createElementNS`), set its `d`, and rely on the browser's native
// `getTotalLength()` / `getPointAtLength()` SVG geometry implementation. This
// keeps the JS surface tiny and matches how Chromium internally renders the
// path, so the dot is always exactly on the stroke we draw.

import { useEffect, useMemo, useState } from 'react'
import type {
  TrackMapData,
  TrackMapPoint,
  TrackMapSource,
  TrackMapStatus,
  TrackMapViewBox
} from '../../../shared/track-map'
import { TRACK_MAP_CHANNELS } from '../../../shared/track-map'

const SVG_NS = 'http://www.w3.org/2000/svg'
const DEFAULT_VIEW_BOX: TrackMapViewBox = [0, 0, 100, 100]

export interface TrackMapSamplePoint {
  x: number
  y: number
}

export interface TrackMapStartFinishMarker {
  x1: number
  y1: number
  x2: number
  y2: number
}

export type TrackMapLayerKey = 'background' | 'inactive' | 'active' | 'pitroad' | 'startFinish' | 'turns'

export interface TrackMapRenderableLayer {
  key: TrackMapLayerKey
  innerHtml: string
  viewBox: TrackMapViewBox | null
}

export interface TrackMapRenderableRecording {
  active: boolean
  progress: number // 0..1 driven fraction of the current lap
  sampleCount: number
  mode: 'lat-lon' | 'velocity-yaw' | null
  // Open path for the partial trace captured so far, in `viewBox` space.
  pathD: string | null
  viewBox: TrackMapViewBox
}

export interface TrackMapRenderable {
  source: TrackMapSource
  viewBox: TrackMapViewBox
  svgLayers: TrackMapRenderableLayer[]
  outlinePathD: string | null
  pitroadPathD: string | null
  totalLength: number
  startFinishPct: number
  /**
   * Live state of the telemetry learner while it records the current lap.
   * Independent of `source`: present whenever the main process is capturing a
   * lap for the active track, so the UI can draw the growing trace and show a
   * real recording-progress value. `null` when nothing is being recorded.
   */
  recording: TrackMapRenderableRecording | null
  /**
   * Sample a 0..1 lap progress (telemetry `lapDistPct`) into viewBox-space
   * coordinates. Accounts for the optional `startFinishPct` offset so that
   * `pct=0` lands exactly on the start/finish line.
   * Returns `null` when there is no path to sample on (source === 'none').
   */
  sample: (pct: number) => TrackMapSamplePoint | null
  /**
   * Sample a raw 0..1 fraction along the path itself (not lap-progress).
   * Useful when you need the geometric SF position regardless of offset.
   */
  samplePath: (frac: number) => TrackMapSamplePoint | null
}

// ───────────────────────── SVG parsing helpers ──────────────────────────────

function parseSvgString(svgString: string): SVGSVGElement | null {
  try {
    const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml')
    const root = doc.documentElement
    if (!root || root.nodeName.toLowerCase() !== 'svg') return null
    if (doc.getElementsByTagName('parsererror').length > 0) return null
    return root as unknown as SVGSVGElement
  } catch {
    return null
  }
}

function extractPathDFromSvg(svgString: string | undefined): string | null {
  if (!svgString) return null
  const svg = parseSvgString(svgString)
  if (!svg) return null
  const parts: string[] = []
  for (const path of Array.from(svg.querySelectorAll('path[d]'))) {
    const d = path.getAttribute('d')
    if (d && d.trim()) parts.push(d.trim())
  }
  for (const poly of Array.from(svg.querySelectorAll('polyline[points], polygon[points]'))) {
    const d = pointsAttributeToPathD(poly.getAttribute('points'), poly.tagName.toLowerCase() === 'polygon')
    if (d) parts.push(d)
  }
  if (parts.length === 0) return null
  return parts.join(' ')
}

function pointsAttributeToPathD(points: string | null, close: boolean): string | null {
  if (!points) return null
  const values = points
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((value) => Number.isFinite(value))
  if (values.length < 4 || values.length % 2 !== 0) return null
  let d = `M ${values[0]} ${values[1]}`
  for (let i = 2; i < values.length; i += 2) d += ` L ${values[i]} ${values[i + 1]}`
  if (close) d += ' Z'
  return d
}

function extractSvgLayer(svgString: string | undefined, key: TrackMapLayerKey): TrackMapRenderableLayer | null {
  if (!svgString) return null
  const svg = parseSvgString(svgString)
  if (!svg) return null
  sanitizeSvg(svg)
  const innerHtml = Array.from(svg.childNodes)
    .map((node) => new XMLSerializer().serializeToString(node))
    .join('')
    .trim()
  if (!innerHtml) return null
  return { key, innerHtml, viewBox: extractViewBoxFromSvgElement(svg) }
}

function sanitizeSvg(svg: SVGSVGElement): void {
  for (const node of Array.from(svg.querySelectorAll('script, foreignObject'))) node.remove()
  for (const element of Array.from(svg.querySelectorAll('*'))) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim().toLowerCase()
      if (name.startsWith('on') || value.startsWith('javascript:')) {
        element.removeAttribute(attr.name)
      }
    }
  }
}

function extractViewBoxFromSvgElement(svg: SVGSVGElement): TrackMapViewBox | null {
  const vb = svg.getAttribute('viewBox')
  if (!vb) return null
  const parts = vb.trim().split(/[\s,]+/).map(Number)
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2] > 0 && parts[3] > 0) {
    return [parts[0], parts[1], parts[2], parts[3]] as TrackMapViewBox
  }
  return null
}

function extractViewBoxFromSvgString(svgString: string | undefined): TrackMapViewBox | null {
  if (!svgString) return null
  const svg = parseSvgString(svgString)
  if (!svg) return null
  return extractViewBoxFromSvgElement(svg)
}

function polylineToPathD(points: TrackMapPoint[] | undefined, close = true): string | null {
  if (!points || points.length < 2) return null
  let d = `M ${points[0].x.toFixed(6)} ${points[0].y.toFixed(6)}`
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x.toFixed(6)} ${points[i].y.toFixed(6)}`
  }
  // Closed loops (the learned map) get a `Z`; the live recording trace stays
  // open because the lap isn't finished yet.
  if (close) d += ' Z'
  return d
}

// ──────────────────── Offscreen SVG path sampler ────────────────────────────

interface PathSampler {
  totalLength: number
  pointAt: (frac: number) => TrackMapSamplePoint | null
}

function createPathSampler(d: string | null): PathSampler | null {
  if (!d) return null
  if (typeof document === 'undefined') return null
  try {
    const el = document.createElementNS(SVG_NS, 'path') as SVGPathElement
    el.setAttribute('d', d)
    const total = el.getTotalLength()
    if (!Number.isFinite(total) || total <= 0) return null
    return {
      totalLength: total,
      pointAt: (frac: number): TrackMapSamplePoint | null => {
        if (!Number.isFinite(frac)) return null
        // Wrap to [0,1) so closed paths behave nicely past the seam.
        let f = frac % 1
        if (f < 0) f += 1
        try {
          const pt = el.getPointAtLength(f * total)
          return { x: pt.x, y: pt.y }
        } catch {
          return null
        }
      }
    }
  } catch {
    return null
  }
}

function computeViewBoxFromSampler(sampler: PathSampler): TrackMapViewBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const samples = 96
  for (let i = 0; i <= samples; i++) {
    const pt = sampler.pointAt(i / samples)
    if (!pt) continue
    if (pt.x < minX) minX = pt.x
    if (pt.y < minY) minY = pt.y
    if (pt.x > maxX) maxX = pt.x
    if (pt.y > maxY) maxY = pt.y
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return DEFAULT_VIEW_BOX
  const rawW = Math.max(0.0001, maxX - minX)
  const rawH = Math.max(0.0001, maxY - minY)
  const pad = Math.max(rawW, rawH) * 0.06
  return [minX - pad, minY - pad, rawW + pad * 2, rawH + pad * 2]
}

// ───────────────────────── Public API ───────────────────────────────────────

export function buildTrackMap(data: TrackMapData | null | undefined): TrackMapRenderable | null {
  const recording = buildRecordingRenderable(data)
  if (!data || data.source === 'none') {
    return {
      source: 'none',
      viewBox: DEFAULT_VIEW_BOX,
      svgLayers: [],
      outlinePathD: null,
      pitroadPathD: null,
      totalLength: 0,
      startFinishPct: 0,
      recording,
      sample: () => null,
      samplePath: () => null
    }
  }

  let outlinePathD: string | null = null
  let pitroadPathD: string | null = null
  let viewBox: TrackMapViewBox | null = null
  let svgLayers: TrackMapRenderableLayer[] = []

  if (data.source === 'iracing-svg') {
    const orderedLayers: Array<[TrackMapLayerKey, string | undefined]> = [
      ['background', data.svgLayers?.background],
      ['inactive', data.svgLayers?.inactive],
      ['active', data.svgLayers?.active ?? data.svg],
      ['pitroad', data.svgLayers?.pitroad],
      ['startFinish', data.svgLayers?.startFinish],
      ['turns', data.svgLayers?.turns]
    ]
    svgLayers = orderedLayers
      .map(([key, svg]) => extractSvgLayer(svg, key))
      .filter((layer): layer is TrackMapRenderableLayer => layer !== null)
    const activeSvg = data.svgLayers?.active ?? data.svg
    const sampleSvg = activeSvg ?? data.svgLayers?.inactive ?? data.svgLayers?.background
    outlinePathD = extractPathDFromSvg(sampleSvg)
    pitroadPathD = extractPathDFromSvg(data.svgLayers?.pitroad)
    viewBox =
      data.viewBox ??
      svgLayers.find((layer) => layer.key === 'active')?.viewBox ??
      svgLayers.find((layer) => layer.viewBox !== null)?.viewBox ??
      extractViewBoxFromSvgString(sampleSvg) ??
      null
  } else if (data.source === 'learned') {
    outlinePathD = polylineToPathD(data.polyline)
    viewBox = data.viewBox ?? [0, 0, 1, 1]
  }

  const sampler = createPathSampler(outlinePathD)
  if (!sampler) {
    return {
      source: data.source,
      viewBox: viewBox ?? DEFAULT_VIEW_BOX,
      svgLayers,
      outlinePathD,
      pitroadPathD,
      totalLength: 0,
      startFinishPct: clamp01(data.startFinishPct ?? 0),
      recording,
      sample: () => null,
      samplePath: () => null
    }
  }

  if (!viewBox) viewBox = computeViewBoxFromSampler(sampler)

  const startFinishPct = clamp01(data.startFinishPct ?? 0)

  return {
    source: data.source,
    viewBox,
    svgLayers,
    outlinePathD,
    pitroadPathD,
    totalLength: sampler.totalLength,
    startFinishPct,
    recording,
    sample: (pct: number): TrackMapSamplePoint | null => {
      if (!Number.isFinite(pct)) return null
      return sampler.pointAt(pct + startFinishPct)
    },
    samplePath: sampler.pointAt
  }
}

// Turn the main-process recording payload into a renderable trace. Independent
// of the map source so it can ride alongside `source: 'none'` (first lap) or an
// older `learned` map being re-recorded.
function buildRecordingRenderable(
  data: TrackMapData | null | undefined
): TrackMapRenderableRecording | null {
  const rec = data?.recording
  if (!rec || !rec.active) return null
  const viewBox: TrackMapViewBox = rec.viewBox ?? [0, 0, 1, 1]
  return {
    active: true,
    progress: clamp01Linear(rec.progress),
    sampleCount: typeof rec.sampleCount === 'number' ? rec.sampleCount : 0,
    mode: rec.mode ?? null,
    pathD: polylineToPathD(rec.polyline, false),
    viewBox
  }
}

// Plain 0..1 clamp (the loop-aware `clamp01` below wraps values ≥1, which is
// wrong for a monotonic progress value).
function clamp01Linear(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export function sampleTrackPoint(
  map: TrackMapRenderable | null | undefined,
  pct: number
): TrackMapSamplePoint | null {
  if (!map) return null
  return map.sample(pct)
}

// Short perpendicular tick at the start/finish line, expressed in viewBox
// coordinates. Length scales with viewBox so the tick is visible at any zoom.
export function getStartFinishMarker(
  map: TrackMapRenderable | null | undefined
): TrackMapStartFinishMarker | null {
  if (!map || map.totalLength <= 0) return null
  const center = map.samplePath(map.startFinishPct)
  if (!center) return null
  // Use a tiny step on either side to estimate the tangent.
  const stepFrac = Math.min(0.005, 1 / Math.max(map.totalLength, 1))
  const before = map.samplePath(map.startFinishPct - stepFrac) ?? center
  const after = map.samplePath(map.startFinishPct + stepFrac) ?? center
  const dx = after.x - before.x
  const dy = after.y - before.y
  const len = Math.hypot(dx, dy) || 1
  // Perpendicular = (-dy, dx) normalized.
  const nx = -dy / len
  const ny = dx / len
  const tickHalf = Math.max(map.viewBox[2], map.viewBox[3]) * 0.025
  return {
    x1: center.x - nx * tickHalf,
    y1: center.y - ny * tickHalf,
    x2: center.x + nx * tickHalf,
    y2: center.y + ny * tickHalf
  }
}

// ───────────────────────── Convenience constants ────────────────────────────

export function trackMapStrokeWidth(viewBox: TrackMapViewBox, scale = 1): number {
  return Math.max(viewBox[2], viewBox[3]) * 0.006 * scale
}

export function trackMapDotRadius(viewBox: TrackMapViewBox, scale = 1): number {
  return Math.max(viewBox[2], viewBox[3]) * 0.014 * scale
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return ((value % 1) + 1) % 1
  if (value >= 1) return value % 1
  return value
}

export interface UseTrackMapDataResult {
  data: TrackMapData | null
  status: TrackMapStatus | null
  renderable: TrackMapRenderable | null
  refresh: () => Promise<void>
}

export function useTrackMapData(): UseTrackMapDataResult {
  const [data, setData] = useState<TrackMapData | null>(null)
  const [status, setStatus] = useState<TrackMapStatus | null>(null)

  const load = async (): Promise<void> => {
    const [nextData, nextStatus] = await Promise.all([
      window.ipc.invoke<TrackMapData | null>(TRACK_MAP_CHANNELS.getForCurrentTrack),
      window.ipc.invoke<TrackMapStatus | null>(TRACK_MAP_CHANNELS.getStatus)
    ])
    setData(nextData ?? null)
    setStatus(nextStatus ?? null)
  }

  useEffect(() => {
    let canceled = false
    const loadSafe = async (): Promise<void> => {
      try {
        const [nextData, nextStatus] = await Promise.all([
          window.ipc.invoke<TrackMapData | null>(TRACK_MAP_CHANNELS.getForCurrentTrack),
          window.ipc.invoke<TrackMapStatus | null>(TRACK_MAP_CHANNELS.getStatus)
        ])
        if (!canceled) {
          setData(nextData ?? null)
          setStatus(nextStatus ?? null)
        }
      } catch {
        // Keep the last known map when IPC is temporarily unavailable.
      }
    }
    void loadSafe()
    const off = window.ipc.subscribe<TrackMapData | null>(TRACK_MAP_CHANNELS.updated, (next) => {
      setData(next ?? null)
      void window.ipc
        .invoke<TrackMapStatus | null>(TRACK_MAP_CHANNELS.getStatus)
        .then((nextStatus) => {
          if (!canceled) setStatus(nextStatus ?? null)
        })
        .catch(() => undefined)
    })
    return () => {
      canceled = true
      off()
    }
  }, [])

  return {
    data,
    status,
    renderable: useMemo(() => buildTrackMap(data), [data]),
    refresh: load
  }
}

export function useTrackMapStatus(): { status: TrackMapStatus | null; refresh: () => Promise<void> } {
  const [status, setStatus] = useState<TrackMapStatus | null>(null)
  const refresh = async (): Promise<void> => {
    const next = await window.ipc.invoke<TrackMapStatus | null>(TRACK_MAP_CHANNELS.getStatus)
    setStatus(next ?? null)
  }
  useEffect(() => {
    void refresh().catch(() => undefined)
    const off = window.ipc.subscribe<TrackMapData | null>(TRACK_MAP_CHANNELS.updated, () => {
      void refresh().catch(() => undefined)
    })
    return off
  }, [])
  return { status, refresh }
}
