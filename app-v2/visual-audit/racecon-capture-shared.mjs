import { createHash } from "node:crypto"
import { basename, resolve } from "node:path"
import { PNG } from "pngjs"
import { createServer } from "vite"
import {
  CaptureSafetyError,
  assertCleanGitState,
  createPrivateStaging,
  discardPrivateStaging,
  exclusiveWriteFile,
  isSameOrDescendant,
  listGitWorktrees,
  parseCaptureArgs,
  prepareCaptureOutput,
  publishPrivateStaging,
  readGitState,
  removePublishedOutput,
  revalidatePrivateStaging,
  revalidatePublishedOutput
} from "./racecon-rc01-capture-lib.mjs"

/**
 * Shared RaceCon render-QA harness.
 *
 * RC-01 owns the primitives that protect the reviewer's disk (argument parsing, private
 * staging, exclusive writes, atomic no-replace publication, quarantine cleanup, the Git-state
 * gate) and RC-02 re-exported them unchanged rather than forking them. RC-03 … RC-08 add six
 * more copies of everything ABOVE that layer — the governed viewport matrix, the breakpoint
 * contract, the geometry measurement helpers, the generic metric contract and the capture
 * driver — so those are hoisted here once and each artifact keeps only what its own DOM,
 * zones, channels, alert families and packet omissions make genuinely different.
 *
 * Nothing artifact-specific belongs in this file.
 */
export {
  CaptureSafetyError,
  assertCleanGitState,
  createPrivateStaging,
  discardPrivateStaging,
  exclusiveWriteFile,
  isSameOrDescendant,
  listGitWorktrees,
  parseCaptureArgs,
  prepareCaptureOutput,
  publishPrivateStaging,
  readGitState,
  removePublishedOutput,
  revalidatePrivateStaging,
  revalidatePublishedOutput
}

/**
 * The breakpoint contract every RaceCon dashboard shares. RC-03 … RC-08 each export their own
 * `RCnn_NATIVE_WIDTH_PX` … `RCnn_LANDSCAPE_MAX_HEIGHT_PX` constants with identical values and
 * an identical `rcNNLayoutForContentBox` / `rcNNCompactModeForContentBox` pair, so the harness
 * mirrors the contract once. A harness that re-derived it per artifact could drift silently.
 */
export const RACECON_NATIVE_WIDTH_PX = 800
export const RACECON_NATIVE_HEIGHT_PX = 480
export const RACECON_NATIVE_TOLERANCE_PX = 1
export const RACECON_APP_WIDTH_PX = 1024
export const RACECON_APP_HEIGHT_PX = 600
export const RACECON_PHONE_MIN_WIDTH_PX = 360
export const RACECON_PHONE_MAX_WIDTH_PX = 480
export const RACECON_PHONE_MIN_HEIGHT_PX = 650
export const RACECON_LANDSCAPE_MIN_WIDTH_PX = 650
export const RACECON_LANDSCAPE_MIN_HEIGHT_PX = 360
export const RACECON_LANDSCAPE_MAX_HEIGHT_PX = 480

/**
 * The six governed viewports: the 800x480 native canvas, the 1024x600 app reflow, and the four
 * compact viewports that select the phone and landscape compact modes.
 */
export const CAPTURE_SIZES = Object.freeze([
  Object.freeze({ width: 800, height: 480, layout: "native", compactMode: null }),
  Object.freeze({ width: 1024, height: 600, layout: "app", compactMode: null }),
  Object.freeze({ width: 393, height: 759, layout: "compact", compactMode: "phone" }),
  Object.freeze({ width: 412, height: 867, layout: "compact", compactMode: "phone" }),
  Object.freeze({ width: 759, height: 393, layout: "compact", compactMode: "landscape" }),
  Object.freeze({ width: 867, height: 412, layout: "compact", compactMode: "landscape" })
])

export function fail(message) {
  throw new CaptureSafetyError(message)
}

export function finite(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${name} must be finite`)
  return value
}

export function exact(value, expected, name, tolerance = 0.02) {
  if (Math.abs(finite(value, name) - expected) > tolerance) fail(`${name} must be ${expected}, received ${value}`)
}

/** Mirrors the shared breakpoint contract so a wrong modifier can never validate. */
export function expectedLayoutForBox(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "app"
  if (
    Math.abs(width - RACECON_NATIVE_WIDTH_PX) <= RACECON_NATIVE_TOLERANCE_PX &&
    Math.abs(height - RACECON_NATIVE_HEIGHT_PX) <= RACECON_NATIVE_TOLERANCE_PX
  ) {
    return "native"
  }
  if (width >= RACECON_APP_WIDTH_PX - 1 && height >= RACECON_APP_HEIGHT_PX - 1) return "app"
  return "compact"
}

export function expectedCompactModeForBox(width, height) {
  if (expectedLayoutForBox(width, height) !== "compact") return null
  if (
    width >= RACECON_PHONE_MIN_WIDTH_PX &&
    width <= RACECON_PHONE_MAX_WIDTH_PX &&
    height >= RACECON_PHONE_MIN_HEIGHT_PX &&
    height / width >= 1.5
  ) {
    return "phone"
  }
  if (
    width >= RACECON_LANDSCAPE_MIN_WIDTH_PX &&
    height >= RACECON_LANDSCAPE_MIN_HEIGHT_PX &&
    height <= RACECON_LANDSCAPE_MAX_HEIGHT_PX &&
    width / height >= 1.5
  ) {
    return "landscape"
  }
  return "standard"
}

export function isGovernedSize(size) {
  return CAPTURE_SIZES.some((candidate) => candidate.width === size.width && candidate.height === size.height)
}

export function hasText(metrics, expected) {
  if (!String(metrics.rootText ?? "").includes(expected)) fail(`capture text is missing ${expected}`)
}

export function lacksText(metrics, forbidden, why) {
  if (String(metrics.rootText ?? "").includes(forbidden)) {
    fail(`capture text contains ${forbidden}, which ${why}`)
  }
}

/**
 * A documented packet omission is proved by the absence of a RENDERED READOUT, not by a
 * substring of the concatenated frame text: adjacent text nodes join without separators, so a
 * litre unit next to a FUEL label reads as "LFUEL" and would fail a naive substring test. Leaf
 * text is what a reader actually sees as one value.
 */
export function lacksLeafText(metrics, forbidden, why) {
  if ((metrics.leafTexts ?? []).some((text) => text === forbidden)) {
    fail(`capture renders "${forbidden}" as a readout, which ${why}`)
  }
}

/**
 * Finds the ledger entry that records a measured defect for this state and viewport, if any.
 * A recorded defect is never a blanket exemption: the caller must still compare the measurement
 * against `budgetPx`, so a defect that grows, spreads to another breakpoint or appears on
 * another element still fails closed.
 */
function findDefect(defects, key, entry, field = "key") {
  const sizeKey = `${entry.size.width}x${entry.size.height}`
  return (defects ?? []).find(
    (candidate) =>
      candidate[field] === key &&
      (candidate.states === undefined || candidate.states.includes(entry.state)) &&
      (candidate.sizes === undefined || candidate.sizes.includes(sizeKey))
  )
}

/**
 * `white-space: nowrap` defeats `overflow: hidden`, so an element can escape its box while
 * `scrollWidth === clientWidth` on its ancestors and a full green jsdom suite says nothing. This
 * sweep is measured in a real browser, covers every leaf rather than a declared list, and fails
 * closed on anything the artifact has not recorded.
 */
export function auditOverflowLeaves(metrics, entry, knownDefects = []) {
  const sizeKey = `${entry.size.width}x${entry.size.height}`
  const observed = []
  for (const leaf of metrics.overflowLeaves ?? []) {
    const waiver = findDefect(knownDefects, leaf.key, entry)
    if (!waiver) {
      fail(
        `${leaf.key} "${leaf.text}" paints ${leaf.overflowX}px wider than its ${leaf.clientWidth}px box ` +
          `(text spans ${leaf.textLeft.toFixed(2)}..${leaf.textRight.toFixed(2)})`
      )
    }
    if (leaf.overflowX > waiver.budgetPx) {
      fail(
        `${leaf.key} "${leaf.text}" overflows by ${leaf.overflowX}px, past the ${waiver.budgetPx}px recorded for ` +
          `the known defect: ${waiver.note}`
      )
    }
    observed.push({
      key: leaf.key,
      text: leaf.text,
      state: entry.state,
      size: sizeKey,
      overflowX: leaf.overflowX,
      clientWidth: leaf.clientWidth,
      textSpan: [Number(leaf.textLeft.toFixed(2)), Number(leaf.textRight.toFixed(2))],
      note: waiver.note
    })
  }
  return observed
}

/**
 * A zone whose own content is taller or wider than its layout box. Same ledger discipline as the
 * leaf sweep: unrecorded fails, recorded is compared against its measured budget.
 */
export function auditZoneOverflow(zones, entry, zoneDefects = [], label = "zone") {
  const observed = []
  for (const zone of zones ?? []) {
    if (!zone || zone.display === "none") continue
    const overflow = Math.max(
      finite(zone.scrollWidth, `${zone.name} scroll width`) - finite(zone.layoutWidth, `${zone.name} client width`),
      finite(zone.scrollHeight, `${zone.name} scroll height`) - finite(zone.layoutHeight, `${zone.name} client height`)
    )
    if (overflow <= 0.5) continue
    const waiver = findDefect(zoneDefects, zone.name, entry, "zone")
    if (!waiver) fail(`${label} ${zone.name} overflows its layout box by ${overflow.toFixed(2)}px`)
    if (overflow > waiver.budgetPx) {
      fail(
        `${label} ${zone.name} overflows by ${overflow.toFixed(2)}px, past the ${waiver.budgetPx}px recorded for ` +
          `the known defect: ${waiver.note}`
      )
    }
    observed.push({
      zone: zone.name,
      state: entry.state,
      size: `${entry.size.width}x${entry.size.height}`,
      overflowPx: Number(overflow.toFixed(2)),
      note: waiver.note
    })
  }
  return observed
}

export function containsRect(outer, inner, label, tolerance = 0.02) {
  if (
    !outer ||
    !inner ||
    inner.left < outer.left - tolerance ||
    inner.top < outer.top - tolerance ||
    inner.left + inner.width > outer.left + outer.width + tolerance ||
    inner.top + inner.height > outer.top + outer.height + tolerance
  ) {
    fail(`${label} is not contained by its required bounds`)
  }
}

export function assertNoOverflow(box, label) {
  if (
    !box ||
    finite(box.scrollWidth, `${label} scroll width`) > finite(box.layoutWidth, `${label} client width`) ||
    finite(box.scrollHeight, `${label} scroll height`) > finite(box.layoutHeight, `${label} client height`)
  ) {
    fail(`${label} overflows its layout box`)
  }
}

export function assertNoHorizontalOverflow(box, label) {
  if (!box || finite(box.scrollWidth, `${label} scroll width`) > finite(box.layoutWidth, `${label} client width`)) {
    fail(`${label} overflows its layout width`)
  }
}

/**
 * `scrollWidth` cannot see this class of overflow: `white-space: nowrap` sizes an inline box to
 * its own text, so the box escapes its zone while `scrollWidth === clientWidth`. Only the
 * measured rectangles disagree, which is why every escape check is rect-based.
 */
export function assertZoneContainment(entries, tolerance = 0.5, defects = [], entry = null) {
  const observed = []
  for (const item of entries ?? []) {
    if (!item || item.ownerDisplay === "none") continue
    if (!item.owner || !item.value) fail(`${item.label} has no measurable owner or value box`)
    const escape = {
      left: item.owner.left - item.value.left,
      right: item.value.left + item.value.width - (item.owner.left + item.owner.width),
      top: item.owner.top - item.value.top,
      bottom: item.value.top + item.value.height - (item.owner.top + item.owner.height)
    }
    const worst = Math.max(...Object.values(escape))
    if (worst <= tolerance) continue
    const waiver = entry ? findDefect(defects, item.label, entry, "label") : undefined
    if (!waiver) {
      const edge = Object.entries(escape).find(([, overflow]) => overflow === worst)[0]
      fail(`${item.label} escapes its zone on the ${edge} by ${worst.toFixed(2)}px`)
    }
    if (worst > waiver.budgetPx) {
      fail(
        `${item.label} escapes its zone by ${worst.toFixed(2)}px, past the ${waiver.budgetPx}px recorded for ` +
          `the known defect: ${waiver.note}`
      )
    }
    observed.push({
      label: item.label,
      state: entry.state,
      size: `${entry.size.width}x${entry.size.height}`,
      escapePx: Number(worst.toFixed(2)),
      note: waiver.note
    })
  }
  return observed
}

/**
 * Visible zones may touch but never overlap. A zero-area or hidden zone is not compared.
 *
 * `exemptions` names the pairs a packet deliberately overlaps — RC-03's stint clock sits over
 * the pace band's reserved right corner, for example — so the check stays a real check
 * everywhere else instead of being softened into a tolerance.
 */
export function assertZonesDoNotOverlap(zones, tolerance = 0.5, exemptions = []) {
  const exempt = new Set(exemptions.map(([first, second]) => [first, second].sort().join("\u0000")))
  const visible = (zones ?? []).filter((zone) => zone && zone.display !== "none" && zone.width > 0 && zone.height > 0)
  for (let a = 0; a < visible.length; a += 1) {
    for (let b = a + 1; b < visible.length; b += 1) {
      const first = visible[a]
      const second = visible[b]
      if (exempt.has([first.name, second.name].sort().join("\u0000"))) continue
      const overlapX =
        Math.min(first.left + first.width, second.left + second.width) - Math.max(first.left, second.left)
      const overlapY =
        Math.min(first.top + first.height, second.top + second.height) - Math.max(first.top, second.top)
      const overlap = Math.min(overlapX, overlapY)
      if (overlap > tolerance) {
        fail(
          `zone ${first.name} overlaps ${second.name} by ${overlapX.toFixed(2)}x${overlapY.toFixed(2)}px`
        )
      }
    }
  }
}

/** Nothing measurable may leave the captured frame. */
export function assertInsideFrame(rects, size, tolerance = 0.5) {
  for (const entry of rects ?? []) {
    if (!entry || entry.display === "none") continue
    if (entry.width <= 0 && entry.height <= 0) continue
    if (
      entry.left < -tolerance ||
      entry.top < -tolerance ||
      entry.left + entry.width > size.width + tolerance ||
      entry.top + entry.height > size.height + tolerance
    ) {
      fail(
        `${entry.name} is out of frame at ${entry.left.toFixed(2)},${entry.top.toFixed(2)} ` +
          `${entry.width.toFixed(2)}x${entry.height.toFixed(2)} in a ${size.width}x${size.height} capture`
      )
    }
  }
}

/**
 * The governed type scale is an ORDER, not a set of pixel sizes: each step must be strictly
 * larger than the next. A tie is a failure — two readouts at the same size carry no hierarchy,
 * which is exactly the regression the RC-03 image QA recorded against speed and delta.
 */
export function assertTypeScaleOrder(steps, minimumStepPx = 1) {
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    if (!step || !Number.isFinite(step.fontSize) || step.fontSize <= 0) {
      fail(`type-scale step ${step?.label ?? index} has no measured font size`)
    }
  }
  for (let index = 1; index < steps.length; index += 1) {
    const larger = steps[index - 1]
    const smaller = steps[index]
    if (larger.fontSize - smaller.fontSize < minimumStepPx) {
      fail(
        `type-scale hierarchy does not hold: ${larger.label} ${larger.fontSize}px must be strictly larger ` +
          `than ${smaller.label} ${smaller.fontSize}px`
      )
    }
  }
  return steps.map((step) => ({ label: step.label, fontSize: step.fontSize }))
}

/* ── Pixel audit ──────────────────────────────────────────────────────────────────────── */

export function rgbaAt(image, x, y) {
  const offset = (y * image.width + x) * 4
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]]
}

export function sameRgba(actual, expected) {
  return actual[0] === expected[0] && actual[1] === expected[1] && actual[2] === expected[2] && actual[3] === expected[3]
}

export function decodeCapturePng(buffer, size) {
  let image
  try {
    image = PNG.sync.read(buffer)
  } catch (error) {
    fail(`capture PNG could not be decoded: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (image.width !== size.width || image.height !== size.height) {
    fail(`capture PNG must be ${size.width}x${size.height}, received ${image.width}x${image.height}`)
  }
  for (let offset = 3; offset < image.data.length; offset += 4) {
    if (image.data[offset] !== 255) fail(`capture PNG must be fully opaque; alpha ${image.data[offset]} found`)
  }
  return image
}

export function assertCanvasBorder(image, canvasRgba, label = "canvas") {
  const check = (x, y, edge) => {
    const actual = rgbaAt(image, x, y)
    if (!sameRgba(actual, canvasRgba)) {
      fail(`${label} ${edge} pixel ${x},${y} must be rgba(${canvasRgba.join(",")}), received rgba(${actual.join(",")})`)
    }
  }
  for (let x = 0; x < image.width; x += 1) {
    check(x, 0, "top border")
    check(x, image.height - 1, "bottom border")
  }
  for (let y = 0; y < image.height; y += 1) {
    check(0, y, "left border")
    check(image.width - 1, y, "right border")
  }
}

/**
 * Hue-family classification.
 *
 * A channel-ratio test such as `g < 0.62r && b < 0.62r` is not a red test: it also accepts
 * amber, olive and any warm grey whose green channel happens to sit below the ratio, and it
 * reported 8,578 "red" pixels on a frame whose hue-confirmed truth was zero. Hue is the
 * property that actually distinguishes an alert colour from a resting one, and it survives the
 * `filter: brightness()` several RaceCon dashboards apply, because scaling every channel by the
 * same factor leaves the hue angle unchanged.
 *
 * Achromatic pixels (low saturation) and near-black pixels (low value) carry no hue and are
 * classified `neutral`, which keeps antialiasing against the canvas out of every family count.
 */
export const HUE_SATURATION_FLOOR = 0.35
export const HUE_VALUE_FLOOR = 0.2

export function hueFamily(r, g, b, saturationFloor = HUE_SATURATION_FLOOR, valueFloor = HUE_VALUE_FLOOR) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const value = max / 255
  const delta = max - min
  const saturation = max === 0 ? 0 : delta / max
  if (value < valueFloor || saturation < saturationFloor) return "neutral"
  let hue
  if (max === min) hue = 0
  else if (max === r) hue = 60 * (((g - b) / delta + 6) % 6)
  else if (max === g) hue = 60 * ((b - r) / delta + 2)
  else hue = 60 * ((r - g) / delta + 4)
  if (hue < 15 || hue >= 345) return "red"
  if (hue < 70) return "amber"
  if (hue < 165) return "green"
  if (hue < 200) return "cyan"
  if (hue < 255) return "blue"
  if (hue < 290) return "violet"
  return "magenta"
}

export function hueFamilyOfHex(hex) {
  const value = hex.replace("#", "")
  return hueFamily(
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  )
}

/**
 * Counts every hue family in the frame and, for each family, how many of its pixels fall
 * outside the rectangles that are allowed to carry it. `scopes` maps a family to the list of
 * rectangles that own it, which is what proves an alert colour is present only under its own
 * alert scope rather than merely present somewhere.
 */
export function auditHueFamilies(image, scopes = {}) {
  const counts = { red: 0, amber: 0, green: 0, cyan: 0, blue: 0, violet: 0, magenta: 0, neutral: 0 }
  const outside = {}
  for (const family of Object.keys(scopes)) outside[family] = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const [r, g, b] = rgbaAt(image, x, y)
      const family = hueFamily(r, g, b)
      counts[family] += 1
      const rects = scopes[family]
      if (!rects) continue
      const inside = rects.some(
        (rect) =>
          x >= rect.left - 1 && x <= rect.left + rect.width + 1 && y >= rect.top - 1 && y <= rect.top + rect.height + 1
      )
      if (!inside) outside[family] += 1
    }
  }
  return { counts, outside }
}

export function assertHueFamilyAbsent(audit, family, label, budget = 0) {
  const count = audit.counts[family] ?? 0
  if (count > budget) fail(`${label}: the ${family} hue family must be absent, ${count} pixels measured`)
}

export function assertHueFamilyPresent(audit, family, label, minimum = 1) {
  const count = audit.counts[family] ?? 0
  if (count < minimum) fail(`${label}: the ${family} hue family must be painted, ${count} pixels measured`)
}

export function assertHueFamilyScoped(audit, family, label) {
  const stray = audit.outside[family] ?? 0
  if (stray > 0) fail(`${label}: ${stray} ${family} pixels fall outside the elements that own that alert`)
}

/* ── Capture driver ───────────────────────────────────────────────────────────────────── */

export const STOP_MOTION_CSS =
  "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important;scroll-behavior:auto!important}"

/**
 * Installed before any application script runs, so every artifact collector measures geometry
 * the same way. `__rcMeasure` binds the helpers to the capture root; `__rcCommon` returns the
 * metric contract every RaceCon capture shares.
 */
export const MEASURE_SCRIPT = `
window.__rcMeasure = (root) => {
  const rootRect = root.getBoundingClientRect()
  const relativeRect = (node) => {
    if (!node) return null
    const rect = node.getBoundingClientRect()
    return { left: rect.left - rootRect.left, top: rect.top - rootRect.top, width: rect.width, height: rect.height }
  }
  const measuredRect = (node) => {
    const rect = relativeRect(node)
    if (!node || !rect) return null
    return {
      ...rect,
      layoutWidth: node.clientWidth,
      layoutHeight: node.clientHeight,
      scrollWidth: node.scrollWidth,
      scrollHeight: node.scrollHeight
    }
  }
  const textRect = (node) => {
    if (!node) return null
    const range = document.createRange()
    range.selectNodeContents(node)
    const rect = range.getBoundingClientRect()
    return { left: rect.left - rootRect.left, top: rect.top - rootRect.top, width: rect.width, height: rect.height }
  }
  const transform = (node) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform)
    return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f }
  }
  const valueMetric = (label, selector) => {
    const node = root.querySelector(selector)
    if (!node) return { label, selector, present: false, rect: null, textRect: null, text: '', fontSize: 0 }
    const style = getComputedStyle(node)
    return {
      label,
      selector,
      present: true,
      rect: measuredRect(node),
      textRect: textRect(node),
      text: node.textContent?.trim() ?? '',
      fontSize: Number.parseFloat(style.fontSize),
      color: style.color,
      display: style.display
    }
  }
  const zoneMetric = (name, selector) => {
    const node = root.querySelector(selector)
    if (!node) return { name, selector, present: false, display: 'none', left: 0, top: 0, width: 0, height: 0 }
    const rect = measuredRect(node)
    return { name, selector, present: true, display: getComputedStyle(node).display, ...rect }
  }
  const ownedMetric = (label, ownerSelector, valueSelector) => {
    const owner = root.querySelector(ownerSelector)
    const value = root.querySelector(valueSelector)
    if (!owner || !value) return null
    return {
      label,
      owner: relativeRect(owner),
      ownerDisplay: getComputedStyle(owner).display,
      value: relativeRect(value),
      valueDisplay: getComputedStyle(value).display
    }
  }
  return { rootRect, relativeRect, measuredRect, textRect, transform, valueMetric, zoneMetric, ownedMetric }
}

window.__rcCommon = (root, spec, helpers) => {
  const h = helpers ?? window.__rcMeasure(root)
  const widget = root.querySelector('[data-widget="' + spec.widgetId + '"]')
  const attr = (name) => widget?.getAttribute(spec.attrPrefix + name) ?? null
  const dataset = root.dataset
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    page: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    root: h.relativeRect(root),
    shell: h.measuredRect(root.querySelector('.dashboard-shell')),
    canvas: (() => {
      const canvas = root.querySelector('.dashboard-canvas')
      return canvas ? { ...h.measuredRect(canvas), transform: h.transform(canvas) } : null
    })(),
    dashboardElement: h.measuredRect(root.querySelector('.dash-element.dash-overlaywidget')),
    widget: h.measuredRect(widget),
    dashboard: h.measuredRect(root.querySelector(spec.dashboardSelector)),
    presetId: dataset.capturePresetId,
    expectedWidgetId: dataset.captureWidgetId,
    renderedWidgetId: widget?.getAttribute('data-widget') ?? null,
    dashboardWidth: dataset.captureDashboardWidth,
    dashboardHeight: dataset.captureDashboardHeight,
    sourceKind: dataset.captureSourceKind,
    sourceIdentity: dataset.captureSourceIdentity,
    captureState: dataset.captureState,
    captureSequence: dataset.captureSequence,
    layout: attr('layout'),
    compactMode: attr('compact-mode'),
    bufferState: attr('buffer-state'),
    contentWidth: attr('content-width'),
    contentHeight: attr('content-height'),
    stateAttributes: Object.fromEntries((spec.stateAttributes ?? []).map((name) => [name, attr(name)])),
    zones: (spec.zones ?? []).map(([name, selector]) => h.zoneMetric(name, selector)),
    values: (spec.values ?? []).map(([label, selector]) => h.valueMetric(label, selector)),
    containment: (spec.containment ?? [])
      .map(([label, ownerSelector, valueSelector]) => h.ownedMetric(label, ownerSelector, valueSelector))
      .filter((entry) => entry !== null),
    forbidden: (spec.forbidden ?? []).map(([label, selector]) => ({
      label,
      selector,
      count: root.querySelectorAll(selector).length
    })),
    counted: (spec.counted ?? []).map(([label, selector]) => ({
      label,
      selector,
      count: root.querySelectorAll(selector).length
    })),
    textOutputs: Array.from(root.querySelectorAll('output')).map((output) => output.textContent?.trim() ?? ''),
    leafTexts: Array.from(root.querySelectorAll('*'))
      .filter((node) => node.childElementCount === 0)
      .map((node) => node.textContent?.trim() ?? '')
      .filter((text) => text.length > 0),
    overflowLeaves: Array.from(root.querySelectorAll('*'))
      .filter((node) => node.childElementCount === 0)
      .map((node) => {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden') return null
        // The standard visually-hidden pattern clips a 1px box and relies on nowrap text
        // overflowing it. That is a screen-reader surface, not a painted one. Both the modern
        // clip-path inset(50%) and the legacy clip rect(...) spellings are in use.
        if (style.clipPath !== 'none' || style.clip !== 'auto') return null
        if (node.clientWidth <= 1 && node.clientHeight <= 1) return null
        const overflowX = node.scrollWidth - node.clientWidth
        if (overflowX <= 0) return null
        const range = document.createRange()
        range.selectNodeContents(node)
        const text = range.getBoundingClientRect()
        return {
          key: node.getAttribute('data-testid') ?? node.getAttribute('class') ?? node.tagName.toLowerCase(),
          text: (node.textContent ?? '').trim().slice(0, 32),
          fontSize: Number.parseFloat(style.fontSize),
          whiteSpace: style.whiteSpace,
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          overflowX,
          textLeft: text.left - h.rootRect.left,
          textRight: text.right - h.rootRect.left
        }
      })
      .filter((entry) => entry !== null),
    rootText: root.textContent ?? '',
    errorBoundaryCount: root.querySelectorAll('[data-va-failed]').length,
    unknownWidgetCount: root.querySelectorAll('[data-dashboard-unknown-widget]').length,
    failures: window.__vaFailures ?? []
  }
}
`

/**
 * Every assertion that is true of any RaceCon capture regardless of artifact. Each artifact's
 * `validateCaptureMetrics` calls this first and then adds only what its own DOM contract says.
 */
export function validateCommonMetrics(metrics, entry, spec) {
  const size = entry.size
  if (!metrics || typeof metrics !== "object") fail("missing capture metrics")
  if (!isGovernedSize(size)) fail(`unsupported capture metric size ${size.width}x${size.height}`)

  exact(metrics.viewport.width, size.width, "viewport width")
  exact(metrics.viewport.height, size.height, "viewport height")
  exact(metrics.viewport.dpr, 1, "viewport device pixel ratio")
  exact(metrics.page.scrollWidth, metrics.page.clientWidth, "document scroll width")
  exact(metrics.root.width, size.width, "capture root width")
  exact(metrics.root.height, size.height, "capture root height")
  exact(metrics.shell.width, size.width, "dashboard shell width")
  exact(metrics.shell.height, size.height, "dashboard shell height")
  exact(metrics.canvas.layoutWidth, size.width, "dashboard canvas responsive width")
  exact(metrics.canvas.layoutHeight, size.height, "dashboard canvas responsive height")
  exact(metrics.canvas.width, size.width, "dashboard canvas physical width")
  exact(metrics.canvas.height, size.height, "dashboard canvas physical height")
  exact(metrics.canvas.left, 0, "dashboard canvas left")
  exact(metrics.canvas.top, 0, "dashboard canvas top")
  exact(metrics.dashboardElement.layoutWidth, size.width, "dashboard element responsive width")
  exact(metrics.dashboardElement.layoutHeight, size.height, "dashboard element responsive height")
  exact(metrics.widget.layoutWidth, size.width, "widget responsive width")
  exact(metrics.widget.layoutHeight, size.height, "widget responsive height")
  exact(metrics.widget.width, size.width, "widget physical width")
  exact(metrics.widget.height, size.height, "widget physical height")

  exact(metrics.canvas.transform.a, 1, "dashboard canvas scale X")
  exact(metrics.canvas.transform.d, 1, "dashboard canvas scale Y")
  exact(metrics.canvas.transform.b, 0, "dashboard canvas skew Y")
  exact(metrics.canvas.transform.c, 0, "dashboard canvas skew X")
  exact(metrics.canvas.transform.e, 0, "dashboard canvas translation X")
  exact(metrics.canvas.transform.f, 0, "dashboard canvas translation Y")

  if (
    metrics.presetId !== spec.presetId ||
    metrics.expectedWidgetId !== spec.widgetId ||
    metrics.renderedWidgetId !== spec.widgetId
  ) {
    fail(`capture did not resolve the unmodified ${spec.presetId} preset through DashboardCanvas`)
  }
  if (metrics.dashboardWidth !== "1024" || metrics.dashboardHeight !== "600") {
    fail("capture resized the built dashboard preset")
  }
  if (metrics.sourceKind !== "live-telemetry" || metrics.sourceIdentity !== spec.sourceIdentity) {
    fail("capture did not bind the deterministic connected live telemetry source identity")
  }
  if (metrics.captureState !== entry.state) {
    fail(`capture rendered the ${metrics.captureState} scenario while capturing ${entry.state}`)
  }
  if (metrics.bufferState !== "accepted") {
    fail(`capture must render an accepted live frame, received buffer state ${metrics.bufferState}`)
  }

  // A modifier is only trustworthy when it agrees with the box the widget actually measured.
  const measuredLayout = expectedLayoutForBox(metrics.widget.width, metrics.widget.height)
  const measuredCompactMode = expectedCompactModeForBox(metrics.widget.width, metrics.widget.height)
  if (metrics.layout !== measuredLayout || metrics.layout !== size.layout) {
    fail(`layout modifier ${metrics.layout} does not match the ${metrics.widget.width}x${metrics.widget.height} content box`)
  }
  // Several artifacts omit the compact modifier entirely outside the compact layout; a
  // published modifier must still agree with the measured box.
  const publishedCompactMode = metrics.compactMode ?? measuredCompactMode
  if (publishedCompactMode !== measuredCompactMode || publishedCompactMode !== (size.compactMode ?? measuredCompactMode)) {
    fail(`compact modifier ${metrics.compactMode} does not match the ${metrics.widget.width}x${metrics.widget.height} content box`)
  }
  if (metrics.contentWidth !== String(size.width) || metrics.contentHeight !== String(size.height)) {
    fail("capture did not report its measured content box")
  }

  assertNoOverflow(metrics.dashboard, `${spec.artifact} dashboard`)
  if (
    metrics.errorBoundaryCount !== 0 ||
    metrics.unknownWidgetCount !== 0 ||
    (metrics.failures && metrics.failures.length) ||
    (metrics.pageErrors && metrics.pageErrors.length) ||
    (metrics.consoleErrors && metrics.consoleErrors.length)
  ) {
    fail("capture reported a render error, error boundary, unknown widget, or console error")
  }
  if (
    !Array.isArray(metrics.textOutputs) ||
    metrics.textOutputs.length === 0 ||
    metrics.textOutputs.some((text) => typeof text !== "string" || text.length === 0)
  ) {
    fail("capture rendered an empty telemetry output")
  }
  if (/\b(?:NaN|undefined|Infinity)\b/u.test(String(metrics.rootText))) {
    fail("capture text contains an invalid numeric token")
  }

  for (const zone of metrics.zones ?? []) {
    if (!zone.present) fail(`zone ${zone.name} is missing from the capture`)
  }
  const zoneDefects = auditZoneOverflow(metrics.zones, entry, spec.zoneOverflowDefects ?? [], `${spec.artifact} zone`)
  assertZonesDoNotOverlap(metrics.zones, 0.5, spec.zoneOverlapExemptions ?? [])
  assertInsideFrame(metrics.zones, size)
  const containmentDefects = assertZoneContainment(metrics.containment, 0.5, spec.containmentDefects ?? [], entry)

  for (const value of metrics.values ?? []) {
    if (!value.present) fail(`capture is missing the ${value.label} output`)
    if (value.display === "none") continue
    containsRect(metrics.root, value.rect, `${value.label} value`, 0.5)
    if (value.textRect) containsRect(metrics.root, value.textRect, `${value.label} text`, 0.5)
  }

  const knownDefects = auditOverflowLeaves(metrics, entry, spec.knownDefects ?? [])

  // A documented packet omission renders nothing; a harness that finds the element instead has
  // found a reintroduction, which is the only failure this check can report.
  for (const entryForbidden of metrics.forbidden ?? []) {
    if (entryForbidden.count !== 0) {
      fail(`${entryForbidden.label} must not be rendered: ${entryForbidden.count} matched ${entryForbidden.selector}`)
    }
  }
  return { knownDefects, zoneDefects, containmentDefects }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex")
}

function usage(artifact, script) {
  return [
    `Usage: node visual-audit/${script} --mode <validate|final> --out <absolute-non-existing-directory>`,
    "",
    `Captures the ${artifact} dashboard across the six governed viewports in every governed state.`,
    "validate permits dirty source; final requires a clean, unchanged Git HEAD.",
    "The target must not exist, must be outside every Git worktree, and is atomically published only after private staging succeeds."
  ].join("\n")
}

async function captureOne(browser, baseUrl, entry, options) {
  const { spec, appRoot, mode, finalHead, collectMetrics, validateCaptureMetrics, validateCapturePixels } = options
  if (mode === "final") assertCleanGitState(readGitState(appRoot), finalHead)
  const context = await browser.newContext({
    viewport: { width: entry.size.width, height: entry.size.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "dark"
  })
  const page = await context.newPage()
  const pageErrors = []
  const consoleErrors = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  try {
    await page.addInitScript((style) => {
      const addStyle = () => {
        const element = document.createElement("style")
        element.setAttribute("data-racecon-capture-motion", "true")
        element.textContent = style
        document.head.appendChild(element)
      }
      if (document.head) addStyle()
      else document.addEventListener("DOMContentLoaded", addStyle, { once: true })
    }, STOP_MOTION_CSS)
    await page.addInitScript({ content: MEASURE_SCRIPT })

    const target = new URL(spec.captureHtml, baseUrl)
    target.searchParams.set("width", String(entry.size.width))
    target.searchParams.set("height", String(entry.size.height))
    target.searchParams.set("state", entry.state)
    await page.goto(target.href, { waitUntil: "networkidle", timeout: 90_000 })
    await page.locator(spec.rootSelector).waitFor({ state: "visible", timeout: 45_000 })
    const readySpec = {
      rootSelector: spec.rootSelector,
      widgetId: spec.widgetId,
      attrPrefix: spec.attrPrefix,
      layout: entry.size.layout,
      compactMode: entry.size.compactMode,
      required: entry.required ?? []
    }
    const ready = (input) => {
      const root = document.querySelector(input.rootSelector)
      if (!root || root.getAttribute("data-capture-ready") !== "true") return false
      const widget = root.querySelector(`[data-widget="${input.widgetId}"]`)
      if (!widget) return false
      const attr = (name) => widget.getAttribute(input.attrPrefix + name)
      if (attr("buffer-state") !== "accepted") return false
      if (attr("layout") !== input.layout) return false
      const compactMode = attr("compact-mode")
      if (input.compactMode === null) {
        if (compactMode !== null && compactMode !== "standard") return false
      } else if (compactMode !== input.compactMode) return false
      return input.required.every(([name, value]) => attr(name) === value)
    }
    await page.waitForFunction(ready, readySpec, { timeout: 90_000 })
    await page.addStyleTag({ content: STOP_MOTION_CSS })
    await page.evaluate(async () => {
      if (document.fonts) await document.fonts.ready
    })

    // Bind metric collection to a newly accepted live frame even when an internal freshness
    // tick caused a duplicate-only render.
    let metrics
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await page.waitForFunction(ready, readySpec, { timeout: 45_000 })
      metrics = { ...(await collectMetrics(page, spec, entry)), pageErrors, consoleErrors }
      if (metrics.bufferState === "accepted") break
    }
    const label = `${entry.state} ${entry.size.width}x${entry.size.height}`
    let audit
    try {
      audit = validateCaptureMetrics(metrics, entry)
    } catch (error) {
      throw error instanceof CaptureSafetyError ? new CaptureSafetyError(`${label}: ${error.message}`) : error
    }
    const png = await page.locator(spec.rootSelector).screenshot({ type: "png", animations: "disabled", caret: "hide" })
    let pixelAudit
    try {
      pixelAudit = validateCapturePixels(png, entry, metrics)
    } catch (error) {
      throw error instanceof CaptureSafetyError
        ? new CaptureSafetyError(`${label}: ${error.message}`)
        : error
    }
    if (mode === "final") assertCleanGitState(readGitState(appRoot), finalHead)
    return { metrics, audit, pixelAudit, png }
  } finally {
    await context.close()
  }
}

/**
 * The whole capture lifecycle: private staging, one context per governed viewport and state,
 * metric and pixel validation, byte-length and SHA-256 receipts, atomic no-replace publication
 * and immediate revalidation, with the Git-state gate re-checked around every step in final
 * mode. Identical for every artifact, so it lives here rather than in six near-copies.
 */
export async function runRaceconCapture(config) {
  const { spec, appRoot, here, argv, captureMatrix, collectMetrics, validateCaptureMetrics, validateCapturePixels } =
    config
  const options = parseCaptureArgs(argv)
  if (options.help) {
    console.log(usage(spec.artifact, spec.script))
    return
  }
  const output = prepareCaptureOutput(options.outputDirectory, listGitWorktrees(appRoot))
  const initialGit = readGitState(appRoot)
  const finalHead = options.mode === "final" ? assertCleanGitState(initialGit) : initialGit.head
  const staging = createPrivateStaging(output)
  const server = await createServer({
    configFile: resolve(here, "vite.config.ts"),
    logLevel: "warn",
    server: { host: "127.0.0.1", port: 0, strictPort: false }
  })
  let browser
  let publication
  let succeeded = false
  const report = {
    presetId: spec.presetId,
    mode: options.mode,
    generatedAt: new Date().toISOString(),
    git: { before: initialGit, requiredHead: finalHead },
    captures: []
  }
  try {
    await server.listen()
    const baseUrl = server.resolvedUrls?.local?.[0]
    if (!baseUrl) throw new Error("visual-audit Vite server did not report a local URL")
    const { chromium } = await import("playwright")
    try {
      browser = await chromium.launch({ headless: true })
    } catch (error) {
      throw new Error(
        `Chromium launch failed without installing a browser: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    for (const entry of captureMatrix) {
      const { metrics, audit, pixelAudit, png } = await captureOne(browser, baseUrl, entry, {
        spec,
        appRoot,
        mode: options.mode,
        finalHead,
        collectMetrics,
        validateCaptureMetrics,
        validateCapturePixels
      })
      const filePath = exclusiveWriteFile(
        staging,
        `${spec.presetId}-${entry.state}-${entry.size.width}x${entry.size.height}.png`,
        png
      )
      report.captures.push({
        size: entry.size,
        state: entry.state,
        file: basename(filePath),
        sha256: sha256(png),
        bytes: png.length,
        audit,
        pixelAudit,
        metrics
      })
      if (options.mode === "final") assertCleanGitState(readGitState(appRoot), finalHead)
    }
    report.git.beforePublication = readGitState(appRoot)
    if (options.mode === "final") assertCleanGitState(report.git.beforePublication, finalHead)
    exclusiveWriteFile(staging, `${spec.presetId}-capture.json`, Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8"))
    // This check is intentionally after every file and the manifest are written.
    if (options.mode === "final") assertCleanGitState(readGitState(appRoot), finalHead)
    publication = publishPrivateStaging(staging)
    try {
      if (options.mode === "final") assertCleanGitState(readGitState(appRoot), finalHead)
      revalidatePublishedOutput(publication)
    } catch (error) {
      try {
        removePublishedOutput(publication)
      } catch {}
      publication = undefined
      throw error
    }
    succeeded = true
    console.log(`${spec.artifact} ${options.mode} capture complete`)
    for (const capture of report.captures) {
      const scale = (capture.audit?.typeScale ?? []).map((step) => `${step.label} ${step.fontSize}px`).join(" > ")
      console.log(`  ${capture.file}  sha256=${capture.sha256}${scale ? `  type-scale ${scale}` : ""}`)
    }
    const defects = report.captures.flatMap((capture) => [
      ...(capture.audit?.knownDefects ?? []).map((defect) => `${defect.state} ${defect.size} ${defect.key} "${defect.text}" +${defect.overflowX}px — ${defect.note}`),
      ...(capture.audit?.zoneDefects ?? []).map((defect) => `${defect.state} ${defect.size} zone ${defect.zone} +${defect.overflowPx}px — ${defect.note}`),
      ...(capture.audit?.containmentDefects ?? []).map((defect) => `${defect.state} ${defect.size} ${defect.label} escapes ${defect.escapePx}px — ${defect.note}`)
    ])
    if (defects.length > 0) {
      console.log(`  ${defects.length} recorded render defect(s) observed:`)
      for (const defect of defects) console.log(`    ${defect}`)
    }
    console.log(`  ${publication.canonical}`)
  } finally {
    if (browser) await browser.close()
    await server.close()
    if (!succeeded) {
      try {
        if (publication) removePublishedOutput(publication)
        else discardPrivateStaging(staging)
      } catch {}
    }
  }
}

export function reportCaptureFailure(error) {
  const prefix = error instanceof CaptureSafetyError ? "[racecon-capture safety]" : "[racecon-capture]"
  console.error(prefix, error instanceof Error ? error.message : error)
  process.exitCode = 1
}
