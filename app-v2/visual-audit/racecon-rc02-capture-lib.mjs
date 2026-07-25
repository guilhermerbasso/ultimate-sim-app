import { PNG } from "pngjs"
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
 * RC-02 owns only what its DOM contract makes different from RC-01: the capture matrix, the
 * metric contract and the pixel audit. Every generic safety primitive (argument parsing,
 * private staging, exclusive writes, atomic no-replace publication, quarantine cleanup and
 * the Git-state gate) is imported from the RC-01 library and re-exported unchanged, so the
 * two harnesses can never drift apart on the properties that protect the reviewer's disk.
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
 * The six governed viewports: the 800x480 native canvas, the 1024x600 app reflow, and the
 * four compact viewports that select the phone and landscape compact modes.
 */
export const CAPTURE_SIZES = Object.freeze([
  Object.freeze({ width: 800, height: 480, layout: "native", compactMode: null }),
  Object.freeze({ width: 1024, height: 600, layout: "app", compactMode: null }),
  Object.freeze({ width: 393, height: 759, layout: "compact", compactMode: "phone" }),
  Object.freeze({ width: 412, height: 867, layout: "compact", compactMode: "phone" }),
  Object.freeze({ width: 759, height: 393, layout: "compact", compactMode: "landscape" }),
  Object.freeze({ width: 867, height: 412, layout: "compact", compactMode: "landscape" })
])

export const RC02_LED_COUNT = 9
export const RC02_SECTOR_COUNT = 3

function fail(message) {
  throw new CaptureSafetyError(message)
}

function finite(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${name} must be finite`)
  return value
}

function exact(value, expected, name) {
  if (Math.abs(finite(value, name) - expected) > 0.02) fail(`${name} must be ${expected}, received ${value}`)
}

function hasText(metrics, expected) {
  if (!String(metrics.rootText ?? "").includes(expected)) fail(`capture text is missing ${expected}`)
}

/** Mirrors the RC-02 breakpoint contract so a wrong modifier can never validate. */
function expectedLayoutForBox(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "app"
  if (Math.abs(width - 800) <= 1 && Math.abs(height - 480) <= 1) return "native"
  if (width >= 1023 && height >= 599) return "app"
  return "compact"
}

function expectedCompactModeForBox(width, height) {
  if (expectedLayoutForBox(width, height) !== "compact") return null
  if (width >= 360 && width <= 480 && height >= 650 && height / width >= 1.5) return "phone"
  if (width >= 650 && height >= 360 && height <= 480 && width / height >= 1.5) return "landscape"
  return "standard"
}

/**
 * Every value below is a pure function of the deterministic live fixture in
 * `racecon-rc02-capture.tsx`, so it is asserted exactly: gear 5, 214 km/h, a -0.284 s delta
 * against a 1:39.548 best and the source-bound 1:39.264 predicted lap. RC-02 renders the
 * delta unit as a separate label, so the delta output is the bare signed value.
 */
const RC02_EXPECTED_VALUES = Object.freeze({
  gear: "5",
  speed: "214",
  delta: "-0.284",
  predicted: "1:39.264",
  best: "1:39.548"
})

const RC02_EXPECTED_TYRES = Object.freeze([
  Object.freeze(["LF", "78\u00B0"]),
  Object.freeze(["RF", "81\u00B0"]),
  Object.freeze(["LR", "74\u00B0"]),
  Object.freeze(["RR", "76\u00B0"])
])

const RC02_REQUIRED_TEXT = Object.freeze([
  "SPEED", "214", "DELTA", "-0.284", "PRED", "1:39.264", "BEST", "1:39.548",
  "S1", "S2", "S3", "TIRE C", "78\u00B0", "81\u00B0", "74\u00B0", "76\u00B0",
  "LAP", "TOTAL", "Personal best pace"
])

/**
 * Sector splits and the lap ladder are measured by the widget from the scripted lap distances
 * rather than read from a telemetry channel, so they are validated by shape instead of by a
 * frozen string: a chip may only ever read as the honest dash placeholder or as a well-formed
 * signed split. That still fails closed on a fabricated or malformed reading.
 */
const RC02_SECTOR_VALUE = /^(?:--|[+-]?\d+\.\d{2,3})$/u
const RC02_LADDER_TIME = /^(?:--:--\.---|\d+:\d{2}\.\d{3})$/u

/**
 * Nine bars, all lit at 8140/8600 rpm in gear 5. The ninth bar is the cap: personal-best
 * pace tints it violet at the shift point, which is the only place that colour may appear.
 */
const RC02_LED_TONES = Object.freeze([
  "info", "info", "info", "good", "good", "good", "caution", "caution", "signature"
])

const RC02_LED_COLORS = Object.freeze({
  info: "rgb(77, 163, 255)",
  good: "rgb(70, 224, 160)",
  caution: "rgb(255, 210, 63)",
  danger: "rgb(255, 90, 77)",
  signature: "rgb(179, 136, 255)"
})

const RC02_CANVAS_RGBA = Object.freeze([5, 7, 12, 255])
const RC02_LED_RGBA = Object.freeze({
  info: Object.freeze([77, 163, 255, 255]),
  good: Object.freeze([70, 224, 160, 255]),
  caution: Object.freeze([255, 210, 63, 255]),
  signature: Object.freeze([179, 136, 255, 255])
})

/** Each governed LED colour group is far larger than this on the smallest governed viewport. */
const RC02_MIN_LED_GROUP_PIXELS = 100
const RC02_MIN_NON_CANVAS_PIXELS = 5_000

function rgbaAt(image, x, y) {
  const offset = (y * image.width + x) * 4
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]]
}

function sameRgba(actual, expected) {
  return actual[0] === expected[0] &&
    actual[1] === expected[1] &&
    actual[2] === expected[2] &&
    actual[3] === expected[3]
}

function assertRgba(image, x, y, expected, label) {
  const actual = rgbaAt(image, x, y)
  if (!sameRgba(actual, expected)) {
    fail(`${label} pixel ${x},${y} must be rgba(${expected.join(",")}), received rgba(${actual.join(",")})`)
  }
}

function assertCanvasBorder(image) {
  for (let x = 0; x < image.width; x += 1) {
    assertRgba(image, x, 0, RC02_CANVAS_RGBA, "top border")
    assertRgba(image, x, image.height - 1, RC02_CANVAS_RGBA, "bottom border")
  }
  for (let y = 0; y < image.height; y += 1) {
    assertRgba(image, 0, y, RC02_CANVAS_RGBA, "left border")
    assertRgba(image, image.width - 1, y, RC02_CANVAS_RGBA, "right border")
  }
}

function isGovernedSize(size) {
  return CAPTURE_SIZES.some((candidate) => candidate.width === size.width && candidate.height === size.height)
}

/**
 * RC-02's zones are declared as percentages of the measured content box rather than as fixed
 * pixel rectangles, so the pixel audit proves what is invariant across every governed
 * viewport: the capture is opaque, the reserved canvas gutter is untouched, the frame is not
 * blank, and every governed LED colour group — including the violet personal-best cap — is
 * actually painted.
 */
export function validateCapturePixels(buffer, size) {
  if (!isGovernedSize(size)) fail(`unsupported capture pixel-audit size ${size.width}x${size.height}`)
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
  assertCanvasBorder(image)

  let nonCanvasPixels = 0
  const ledColorPixels = { info: 0, good: 0, caution: 0, signature: 0 }
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixel = rgbaAt(image, x, y)
      if (!sameRgba(pixel, RC02_CANVAS_RGBA)) nonCanvasPixels += 1
      for (const tone of Object.keys(ledColorPixels)) {
        if (sameRgba(pixel, RC02_LED_RGBA[tone])) {
          ledColorPixels[tone] += 1
          break
        }
      }
    }
  }
  if (nonCanvasPixels < RC02_MIN_NON_CANVAS_PIXELS) fail("capture is blank against the RC-02 canvas colour")
  for (const [tone, count] of Object.entries(ledColorPixels)) {
    if (count < RC02_MIN_LED_GROUP_PIXELS) fail(`capture is missing the governed ${tone} LED colour group`)
  }

  return {
    width: image.width,
    height: image.height,
    opaque: true,
    canvasBorder: "#05070C",
    nonCanvasPixels,
    ledColorPixels
  }
}

function assertNoOverflow(box, label) {
  if (!box ||
    finite(box.scrollWidth, `${label} scroll width`) > finite(box.layoutWidth, `${label} client width`) ||
    finite(box.scrollHeight, `${label} scroll height`) > finite(box.layoutHeight, `${label} client height`)) {
    fail(`${label} overflows its layout box`)
  }
}

function assertNoHorizontalOverflow(box, label) {
  if (!box || finite(box.scrollWidth, `${label} scroll width`) > finite(box.layoutWidth, `${label} client width`)) {
    fail(`${label} overflows its layout width`)
  }
}

function containsRect(outer, inner, label) {
  if (!outer || !inner ||
    inner.left < outer.left - 0.02 ||
    inner.top < outer.top - 0.02 ||
    inner.left + inner.width > outer.left + outer.width + 0.02 ||
    inner.top + inner.height > outer.top + outer.height + 0.02) {
    fail(`${label} is not contained by its required bounds`)
  }
}

function assertLeds(metrics, size) {
  if (!Array.isArray(metrics.leds) || metrics.leds.length !== RC02_LED_COUNT) {
    fail(`RC-02 capture requires exactly ${RC02_LED_COUNT} LEDs`)
  }
  if (!metrics.ledRow) fail("RC-02 capture is missing the shift LED row")
  assertNoOverflow(metrics.ledRow, "RC-02 LED row")
  for (let index = 0; index < metrics.leds.length; index += 1) {
    const led = metrics.leds[index]
    const tone = RC02_LED_TONES[index]
    if (!led || led.tone !== tone || led.color !== RC02_LED_COLORS[tone]) {
      fail(`LED ${index + 1} must be a lit ${tone} bar`)
    }
    if (finite(led.width, `LED ${index + 1} width`) <= 0 || finite(led.height, `LED ${index + 1} height`) <= 0) {
      fail(`LED ${index + 1} has no painted area`)
    }
    containsRect(metrics.ledRow, led, `LED ${index + 1}`)
    if (index > 0 && metrics.leds[index - 1].left + metrics.leds[index - 1].width > led.left + 0.02) {
      fail(`LED ${index + 1} overlaps its predecessor`)
    }
  }
  if (metrics.leds[0].left < 0 || metrics.leds.at(-1).left + metrics.leds.at(-1).width > size.width) {
    fail("the shift LED row escapes the capture")
  }
}

function assertSectors(metrics) {
  if (!Array.isArray(metrics.sectors) || metrics.sectors.length !== RC02_SECTOR_COUNT) {
    fail(`RC-02 capture requires exactly ${RC02_SECTOR_COUNT} sector chips`)
  }
  if (!metrics.sectorsZone) fail("RC-02 capture is missing the sector column")
  // The app reflow spends the sector column's width on the history ladder, so the chips are
  // hidden there and only their zero-area boxes remain measurable.
  const sectorsHidden = metrics.sectorsZone.display === "none"
  if (metrics.layout === "app" ? !sectorsHidden : sectorsHidden) {
    fail(`sector column visibility does not match the ${metrics.layout} layout`)
  }
  if (!sectorsHidden && finite(metrics.sectorsZone.width, "sector column width") <= 0) {
    fail("visible sector column has no area")
  }
  const labels = ["S1", "S2", "S3"]
  for (let index = 0; index < labels.length; index += 1) {
    const sector = metrics.sectors[index]
    if (!sector || sector.label !== labels[index]) fail(`sector chip ${index + 1} must be labelled ${labels[index]}`)
    if (!RC02_SECTOR_VALUE.test(String(sector.text))) {
      fail(`sector chip ${labels[index]} reads "${sector.text}", which is neither the dash placeholder nor a measured split`)
    }
    if (sector.loss !== "false" && sector.loss !== "true") fail(`sector chip ${labels[index]} has no loss state`)
    // Trigger-only: a loss latch may never be reported for an unavailable split.
    if (sector.loss === "true" && sector.text === "--") fail(`sector chip ${labels[index]} latched a loss without a split`)
    if (!sectorsHidden) {
      assertNoHorizontalOverflow(sector.valueRect, `sector ${labels[index]} value`)
      containsRect(metrics.sectorsZone, sector.rect, `sector ${labels[index]} chip`)
    }
  }
}

function assertSpine(metrics) {
  if (!metrics.spine || !metrics.spineTrack || !metrics.spineDatum) {
    fail("RC-02 capture is missing the delta spine, its track, or its datum")
  }
  if (metrics.spineDirection !== "up" || metrics.spineUnavailable !== "false") {
    fail("RC-02 spine must render an available time-gained direction for this fixture")
  }
  containsRect(metrics.spine, metrics.spineTrack, "spine track")
  containsRect(metrics.spineTrack, metrics.spineDatum, "spine datum")
  const trackCenter = metrics.spineTrack.top + metrics.spineTrack.height / 2
  const datumCenter = metrics.spineDatum.top + metrics.spineDatum.height / 2
  if (Math.abs(finite(datumCenter, "spine datum centre") - finite(trackCenter, "spine track centre")) > 1) {
    fail(`spine datum must sit at the vertical centre of its track, off by ${Math.abs(datumCenter - trackCenter)}px`)
  }
  if (!metrics.spineFill) fail("spine fill is missing for a non-zero delta")
  containsRect(metrics.spineTrack, metrics.spineFill, "spine fill")
  // Time gained fills upward from the datum, so the fill may never cross below it.
  if (metrics.spineFill.top + metrics.spineFill.height > datumCenter + 1) {
    fail("time gained must fill above the spine datum")
  }
  if (!metrics.spineCap || !metrics.spineStar) fail("personal-best pace must render its spine cap and star")
  containsRect(metrics.spineTrack, metrics.spineCap, "spine cap")
}

function assertLadder(metrics) {
  if (!metrics.ladder) fail("RC-02 capture is missing the sector-history ladder")
  const ladderVisible = metrics.ladder.display === "flex"
  if (metrics.layout === "app" ? !ladderVisible : ladderVisible) {
    fail(`sector-history ladder visibility does not match the ${metrics.layout} layout`)
  }
  // Exactly one truthful state: the explicit empty row, or measured lap rows. Never both.
  const empty = metrics.ladderEmpty === 1 && metrics.ladderRows === 0
  const populated = metrics.ladderEmpty === 0 && metrics.ladderRows >= 1
  if (!empty && !populated) {
    fail(`sector-history ladder reports ${metrics.ladderRows} lap rows and ${metrics.ladderEmpty} empty rows`)
  }
  for (const value of metrics.ladderValues ?? []) {
    if (!RC02_SECTOR_VALUE.test(value) && !RC02_LADDER_TIME.test(value)) {
      fail(`sector-history ladder cell reads "${value}", which is not a truthful split, lap time or placeholder`)
    }
  }

  // The live row carries the sector-loss surface in the app layout, where the standalone
  // sector chips are hidden, so it must be present and readable exactly there.
  if (!metrics.ladderNow) fail("RC-02 capture is missing the live ladder row")
  const nowVisible = finite(metrics.ladderNow.width, "live ladder row width") > 0
  if (ladderVisible !== nowVisible) fail("the live ladder row must be visible exactly when the ladder is")
  if (!Array.isArray(metrics.ladderNowSectors) || metrics.ladderNowSectors.length !== RC02_SECTOR_COUNT) {
    fail(`the live ladder row must carry exactly ${RC02_SECTOR_COUNT} sector cells`)
  }
  const labels = ["S1", "S2", "S3"]
  for (let index = 0; index < labels.length; index += 1) {
    const cell = metrics.ladderNowSectors[index]
    if (!cell || cell.label !== labels[index]) fail(`live ladder sector ${index + 1} must be labelled ${labels[index]}`)
    if (!RC02_SECTOR_VALUE.test(String(cell.text))) {
      fail(`live ladder sector ${labels[index]} reads "${cell.text}", which is neither the dash placeholder nor a measured split`)
    }
    if (cell.loss !== "false" && cell.loss !== "true") fail(`live ladder sector ${labels[index]} has no loss state`)
    if (cell.loss === "true" && cell.text === "--") fail(`live ladder sector ${labels[index]} latched a loss without a split`)
    assertNoHorizontalOverflow(cell.rect, `live ladder sector ${labels[index]}`)
  }

  // LAP | S1 | S2 | S3 | TOTAL: every row is five cells wide and no cell may clip its text.
  const rows = metrics.ladderRowCells
  if (!Array.isArray(rows) || rows.length < 3) fail("the ladder must render its head, live and history rows")
  for (let row = 0; row < rows.length; row += 1) {
    if (rows[row].length !== 5) fail(`ladder row ${row + 1} must have five cells, received ${rows[row].length}`)
    for (let cell = 0; cell < rows[row].length; cell += 1) {
      assertNoHorizontalOverflow(rows[row][cell].rect, `ladder row ${row + 1} cell ${cell + 1}`)
    }
  }
  if (metrics.layout === "app") assertNoOverflow(metrics.ladder, "sector-history ladder")
}

export function validateCaptureMetrics(metrics, size) {
  if (!metrics || typeof metrics !== "object") fail("missing capture metrics")
  if (!isGovernedSize(size)) fail(`unsupported capture metric size ${size.width}x${size.height}`)
  exact(metrics.viewport.width, size.width, "viewport width")
  exact(metrics.viewport.height, size.height, "viewport height")
  exact(metrics.viewport.dpr, 1, "viewport device pixel ratio")
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
  exact(metrics.dashboardElement.width, size.width, "dashboard element physical width")
  exact(metrics.dashboardElement.height, size.height, "dashboard element physical height")
  exact(metrics.widget.layoutWidth, size.width, "widget responsive width")
  exact(metrics.widget.layoutHeight, size.height, "widget responsive height")
  exact(metrics.widget.width, size.width, "widget physical width")
  exact(metrics.widget.height, size.height, "widget physical height")

  if (metrics.presetId !== "racecon_rc02_dash" || metrics.expectedWidgetId !== "raceconRc02Dash" || metrics.renderedWidgetId !== "raceconRc02Dash") {
    fail("capture did not resolve the unmodified RC-02 preset through DashboardCanvas")
  }
  if (metrics.dashboardWidth !== "1024" || metrics.dashboardHeight !== "600") fail("capture resized the built dashboard preset")
  if (metrics.sourceKind !== "live-telemetry" || metrics.sourceIdentity !== "acc:session:74002:connection:9") {
    fail("capture did not bind the deterministic connected live telemetry source identity")
  }
  if (metrics.bufferState !== "accepted") {
    fail(`capture must render an accepted live frame, received buffer state ${metrics.bufferState}`)
  }
  if (metrics.pbPace !== "true") fail("capture did not reach the debounced personal-best pace state")

  // A modifier is only trustworthy when it agrees with the box the widget actually measured.
  const measuredLayout = expectedLayoutForBox(metrics.widget.width, metrics.widget.height)
  const measuredCompactMode = expectedCompactModeForBox(metrics.widget.width, metrics.widget.height)
  if (metrics.layout !== measuredLayout || metrics.layout !== size.layout) {
    fail(`layout modifier ${metrics.layout} does not match the ${metrics.widget.width}x${metrics.widget.height} content box`)
  }
  if ((metrics.compactMode ?? null) !== measuredCompactMode || (metrics.compactMode ?? null) !== size.compactMode) {
    fail(`compact modifier ${metrics.compactMode} does not match the ${metrics.widget.width}x${metrics.widget.height} content box`)
  }
  if (metrics.contentWidth !== String(size.width) || metrics.contentHeight !== String(size.height)) {
    fail("capture did not report its measured content box")
  }
  if (metrics.nativeSize !== (size.layout === "native" ? "800x480" : null)) {
    fail("native content-box modifier does not match the selected layout")
  }

  assertNoOverflow(metrics.dashboard, "RC-02 dashboard")
  if (metrics.errorBoundaryCount !== 0 || metrics.unknownWidgetCount !== 0 || (metrics.failures && metrics.failures.length) || (metrics.pageErrors && metrics.pageErrors.length) || (metrics.consoleErrors && metrics.consoleErrors.length)) {
    fail("capture reported a render error, error boundary, unknown widget, or console error")
  }
  if (!Array.isArray(metrics.textOutputs) || metrics.textOutputs.length === 0 || metrics.textOutputs.some((text) => typeof text !== "string" || text.length === 0)) {
    fail("capture rendered an empty telemetry output")
  }
  if (/\b(?:NaN|undefined|Infinity)\b/u.test(String(metrics.rootText))) fail("capture text contains an invalid numeric token")
  for (const expected of RC02_REQUIRED_TEXT) hasText(metrics, expected)

  exact(metrics.canvas.transform.a, 1, "dashboard canvas scale X")
  exact(metrics.canvas.transform.d, 1, "dashboard canvas scale Y")
  exact(metrics.canvas.transform.b, 0, "dashboard canvas skew Y")
  exact(metrics.canvas.transform.c, 0, "dashboard canvas skew X")
  exact(metrics.canvas.transform.e, 0, "dashboard canvas translation X")
  exact(metrics.canvas.transform.f, 0, "dashboard canvas translation Y")

  for (const [name, text] of Object.entries(RC02_EXPECTED_VALUES)) {
    const value = metrics.values?.[name]
    if (!value) fail(`capture is missing the ${name} output`)
    if (value.text !== text) fail(`${name} output reads "${value.text}" instead of "${text}"`)
    assertNoHorizontalOverflow(value.rect, `${name} value`)
    containsRect(metrics.root, value.rect, `${name} value`)
  }
  if (!Array.isArray(metrics.tyres) || metrics.tyres.length !== RC02_EXPECTED_TYRES.length) {
    fail("RC-02 capture must expose four tyre corners")
  }
  for (let index = 0; index < RC02_EXPECTED_TYRES.length; index += 1) {
    const tyre = metrics.tyres[index]
    const [label, text] = RC02_EXPECTED_TYRES[index]
    if (!tyre || tyre.label !== label || tyre.text !== text) fail(`tyre corner ${index + 1} must read ${label} ${text}`)
    assertNoHorizontalOverflow(tyre.valueRect, `${label} tyre value`)
    containsRect(metrics.tyreGrid, tyre.rect, `${label} tyre corner`)
  }

  assertLeds(metrics, size)
  assertSectors(metrics)
  assertSpine(metrics)
  assertLadder(metrics)
  return true
}
