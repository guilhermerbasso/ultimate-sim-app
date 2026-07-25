import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { PNG } from "pngjs"
import {
  CaptureSafetyError,
  assertCleanGitState,
  createPrivateStaging,
  discardPrivateStaging,
  exclusiveWriteFile,
  isSameOrDescendant,
  parseCaptureArgs,
  prepareCaptureOutput,
  publishPrivateStaging,
  removePublishedOutput,
  revalidatePrivateStaging,
  revalidatePublishedOutput
} from "./racecon-rc01-capture-lib.mjs"
import {
  CAPTURE_SIZES,
  RC02_LED_COUNT,
  RC02_SECTOR_COUNT,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc02-capture-lib.mjs"

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "racecon-rc02-capture-test-"))
}

const CANVAS_RGB = [5, 7, 12]
const LED_RGB = {
  info: [77, 163, 255],
  good: [70, 224, 160],
  caution: [255, 210, 63],
  signature: [179, 136, 255]
}
const LED_TONES = ["info", "info", "info", "good", "good", "good", "caution", "caution", "signature"]
const LED_COLORS = {
  info: "rgb(77, 163, 255)",
  good: "rgb(70, 224, 160)",
  caution: "rgb(255, 210, 63)",
  signature: "rgb(179, 136, 255)"
}

function measuredRect(rect) {
  return {
    ...rect,
    layoutWidth: rect.width,
    layoutHeight: rect.height,
    scrollWidth: rect.width,
    scrollHeight: rect.height
  }
}

function box(size, left, top, width, height) {
  return {
    left: size.width * left,
    top: size.height * top,
    width: size.width * width,
    height: size.height * height
  }
}

/** Mirrors the zone geometry declared per layout in `raceconRc02.css`. */
function zones(size) {
  const native = size.layout === "native"
  const app = size.layout === "app"
  const phone = size.compactMode === "phone"
  const landscape = size.compactMode === "landscape"
  if (native) {
    return {
      head: box(size, 0.375, 0.02083, 0.25, 0.25),
      spine: box(size, 0.425, 0.29167, 0.15, 0.625),
      sectors: box(size, 0.03, 0.29167, 0.1875, 0.625),
      targets: box(size, 0.78, 0.29167, 0.1875, 0.625),
      speed: box(size, 0.225, 0.3125, 0.175, 0.1875),
      tyres: box(size, 0.225, 0.75, 0.175, 0.16667),
      ladder: { left: 0, top: 0, width: 0, height: 0 }
    }
  }
  if (app) {
    return {
      head: box(size, 0.40234, 0.03333, 0.19531, 0.2),
      spine: box(size, 0.44141, 0.25, 0.11719, 0.66667),
      sectors: { left: 0, top: 0, width: 0, height: 0 },
      targets: box(size, 0.625, 0.25, 0.35156, 0.4),
      speed: box(size, 0.02344, 0.03333, 0.35156, 0.18333),
      tyres: box(size, 0.625, 0.68333, 0.35156, 0.23333),
      ladder: box(size, 0.02344, 0.25, 0.35156, 0.66667)
    }
  }
  if (phone) {
    const headHeight = Math.round(size.height * 0.19)
    const spineTop = 12 + headHeight + 16
    const bottomHeight = Math.round(size.height * 0.17)
    const bottomTop = size.height - bottomHeight - 16
    const spineHeight = Math.max(120, bottomTop - spineTop - 16)
    return {
      head: { left: 12, top: 12, width: size.width - 24, height: headHeight },
      spine: { left: size.width * 0.34, top: spineTop, width: size.width * 0.32, height: spineHeight },
      sectors: { left: 12, top: spineTop, width: size.width * 0.3, height: spineHeight },
      targets: { left: size.width * 0.7 - 12, top: spineTop, width: size.width * 0.3, height: spineHeight },
      speed: { left: 12, top: bottomTop, width: size.width * 0.45 - 12, height: bottomHeight },
      tyres: { left: size.width * 0.47, top: bottomTop, width: size.width * 0.53 - 12, height: bottomHeight },
      ladder: { left: 0, top: 0, width: 0, height: 0 }
    }
  }
  if (landscape) {
    return {
      head: box(size, 0.38, 0.02, 0.24, 0.27),
      spine: box(size, 0.43, 0.31, 0.14, 0.65),
      sectors: box(size, 0.02, 0.31, 0.2, 0.65),
      targets: box(size, 0.78, 0.31, 0.2, 0.65),
      speed: box(size, 0.235, 0.31, 0.17, 0.28),
      tyres: box(size, 0.235, 0.62, 0.17, 0.34),
      ladder: { left: 0, top: 0, width: 0, height: 0 }
    }
  }
  throw new Error(`unsupported RC-02 fixture size ${size.width}x${size.height}`)
}

function ledMetrics(size, head) {
  const height = Math.min(22, Math.max(10, size.height * 0.032))
  const gap = head.width * 0.024
  const width = (head.width - gap * (RC02_LED_COUNT - 1)) / RC02_LED_COUNT
  return Array.from({ length: RC02_LED_COUNT }, (_unused, index) => ({
    left: head.left + index * (width + gap),
    top: head.top,
    width,
    height,
    tone: LED_TONES[index],
    color: LED_COLORS[LED_TONES[index]]
  }))
}

function stacked(zone, count, gap) {
  const height = (zone.height - gap * (count - 1)) / count
  return Array.from({ length: count }, (_unused, index) => ({
    left: zone.left,
    top: zone.top + index * (height + gap),
    width: zone.width,
    height
  }))
}

function valueMetric(rect, text) {
  return {
    rect: measuredRect(rect),
    textRect: { left: rect.left + 1, top: rect.top + 1, width: rect.width - 2, height: rect.height - 2 },
    text,
    fontSize: Math.max(12, rect.height * 0.6)
  }
}

function validMetrics(input) {
  const size = { ...input }
  const zone = zones(size)
  const hidden = { ...measuredRect({ left: 0, top: 0, width: 0, height: 0 }), display: "none" }
  const leds = ledMetrics(size, zone.head)
  const sectorHidden = size.layout === "app"
  const sectorRects = sectorHidden
    ? [0, 1, 2].map(() => ({ left: 0, top: 0, width: 0, height: 0 }))
    : stacked(zone.sectors, RC02_SECTOR_COUNT, 6)
  const sectorTexts = ["-0.256", "-0.256", "--"]
  const sectors = sectorRects.map((rect, index) => ({
    label: `S${index + 1}`,
    loss: "false",
    text: sectorTexts[index],
    rect: measuredRect(rect),
    valueRect: measuredRect({ left: rect.left, top: rect.top + rect.height * 0.4, width: rect.width, height: rect.height * 0.5 })
  }))

  const trackTop = zone.spine.top + zone.spine.height * 0.45
  const trackHeight = zone.spine.height * 0.55
  const spineTrack = { left: zone.spine.left, top: trackTop, width: zone.spine.width, height: trackHeight }
  const datumCenter = trackTop + trackHeight / 2
  const fillHeight = trackHeight * 0.142
  const spineFill = { left: spineTrack.left + 1, top: datumCenter - fillHeight, width: spineTrack.width - 2, height: fillHeight }

  const targetRects = stacked(zone.targets, 2, 8)
  const tyreGrid = { left: zone.tyres.left, top: zone.tyres.top + zone.tyres.height * 0.25, width: zone.tyres.width, height: zone.tyres.height * 0.75 }
  const tyreColumns = size.layout === "app" ? 4 : 2
  const tyreRows = size.layout === "app" ? 1 : 2
  const tyres = ["LF", "RF", "LR", "RR"].map((label, index) => {
    const width = tyreGrid.width / tyreColumns
    const height = tyreGrid.height / tyreRows
    const rect = {
      left: tyreGrid.left + (index % tyreColumns) * width,
      top: tyreGrid.top + Math.floor(index / tyreColumns) * height,
      width,
      height
    }
    return {
      label,
      text: `${[78, 81, 74, 76][index]}\u00B0`,
      rect: measuredRect(rect),
      valueRect: measuredRect({ left: rect.left, top: rect.top + height * 0.35, width: rect.width, height: height * 0.5 })
    }
  })

  const ladderVisible = size.layout === "app"
  const ladderRowRects = ladderVisible
    ? stacked(zone.ladder, 3, 4)
    : [0, 1, 2].map(() => ({ left: 0, top: 0, width: 0, height: 0 }))
  const ladderCells = (rect) => Array.from({ length: 5 }, (_unused, column) => {
    const width = rect.width / 5
    return { text: "cell", rect: measuredRect({ left: rect.left + column * width, top: rect.top, width, height: rect.height }) }
  })
  const ladderNowSectors = ["S1", "S2", "S3"].map((label, index) => {
    const width = ladderRowRects[1].width / 5
    return {
      label,
      loss: "false",
      text: sectorTexts[index],
      rect: measuredRect({
        left: ladderRowRects[1].left + (index + 1) * width,
        top: ladderRowRects[1].top,
        width,
        height: ladderRowRects[1].height
      })
    }
  })

  return {
    viewport: { width: size.width, height: size.height, dpr: 1 },
    root: { left: 0, top: 0, width: size.width, height: size.height },
    shell: measuredRect({ left: 0, top: 0, width: size.width, height: size.height }),
    canvas: {
      ...measuredRect({ left: 0, top: 0, width: size.width, height: size.height }),
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    },
    dashboardElement: measuredRect({ left: 0, top: 0, width: size.width, height: size.height }),
    widget: measuredRect({ left: 0, top: 0, width: size.width, height: size.height }),
    dashboard: measuredRect({ left: 0, top: 0, width: size.width, height: size.height }),
    presetId: "racecon_rc02_dash",
    expectedWidgetId: "raceconRc02Dash",
    renderedWidgetId: "raceconRc02Dash",
    dashboardWidth: "1024",
    dashboardHeight: "600",
    sourceKind: "live-telemetry",
    sourceIdentity: "acc:session:74002:connection:9",
    bufferState: "accepted",
    pbPace: "true",
    layout: size.layout,
    compactMode: size.compactMode,
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    nativeSize: size.layout === "native" ? "800x480" : null,
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures: [],
    pageErrors: [],
    consoleErrors: [],
    rootText: [
      "5 S1 -0.256 S2 -0.256 S3 -- SPEED 214 KM/H DELTA -0.284 S",
      "PRED 1:39.264 BEST 1:39.548 TIRE C LF 78\u00B0 RF 81\u00B0 LR 74\u00B0 RR 76\u00B0",
      "LAP S1 S2 S3 TOTAL NOW -0.256 -0.256 -- 1:39.264 1 31.49 31.49 27.55 1:30.528 Personal best pace"
    ].join(" "),
    textOutputs: [
      "5", "-0.256", "-0.256", "--", "214", "-0.284", "1:39.264", "1:39.548",
      "-0.256", "-0.256", "--", "1:39.264", "31.49", "31.49", "27.55", "1:30.528"
    ],
    ledRow: measuredRect({ left: zone.head.left, top: zone.head.top, width: zone.head.width, height: leds[0].height }),
    leds,
    sectors,
    sectorsZone: sectorHidden ? hidden : { ...measuredRect(zone.sectors), display: "flex" },
    ladder: size.layout === "app" ? { ...measuredRect(zone.ladder), display: "flex" } : hidden,
    ladderNow: measuredRect(ladderRowRects[1]),
    ladderNowSectors,
    ladderRowCells: ladderRowRects.map((rect) => ladderCells(rect)),
    ladderRows: 1,
    ladderEmpty: 0,
    ladderValues: ["31.49", "31.49", "27.55", "1:30.528"],
    spine: zone.spine,
    spineDirection: "up",
    spineUnavailable: "false",
    spineTrack,
    spineDatum: { left: spineTrack.left + 1, top: datumCenter - 1, width: spineTrack.width - 2, height: 2 },
    spineFill,
    spineCap: { left: spineTrack.left + 1, top: spineFill.top - 4, width: spineTrack.width - 2, height: 4 },
    spineStar: { left: spineTrack.left + spineTrack.width, top: spineFill.top - 4, width: 12, height: 12 },
    values: {
      gear: valueMetric({ left: zone.head.left, top: zone.head.top + leds[0].height + 4, width: zone.head.width, height: zone.head.height * 0.6 }, "5"),
      speed: valueMetric({ left: zone.speed.left, top: zone.speed.top + zone.speed.height * 0.3, width: zone.speed.width, height: zone.speed.height * 0.5 }, "214"),
      delta: valueMetric({ left: zone.spine.left, top: zone.spine.top + zone.spine.height * 0.1, width: zone.spine.width, height: zone.spine.height * 0.2 }, "-0.284"),
      predicted: valueMetric({ left: targetRects[0].left, top: targetRects[0].top + targetRects[0].height * 0.4, width: targetRects[0].width, height: targetRects[0].height * 0.5 }, "1:39.264"),
      best: valueMetric({ left: targetRects[1].left, top: targetRects[1].top + targetRects[1].height * 0.4, width: targetRects[1].width, height: targetRects[1].height * 0.5 }, "1:39.548")
    },
    tyreGrid: measuredRect(tyreGrid),
    tyres
  }
}

test("capture CLI accepts only explicit mode and a non-existing absolute target", () => {
  const absolute = resolve(tmpdir(), "racecon-rc02-output")
  assert.deepEqual(parseCaptureArgs(["--mode", "final", "--out", absolute]), { mode: "final", outputDirectory: absolute })
  assert.deepEqual(parseCaptureArgs(["--out", absolute]), { mode: "validate", outputDirectory: absolute })
  assert.deepEqual(parseCaptureArgs(["--help"]), { help: true })
  assert.throws(() => parseCaptureArgs(["--mode", "final", "--out", "relative"]), CaptureSafetyError)
  assert.throws(() => parseCaptureArgs(["--mode", "preview", "--out", absolute]), CaptureSafetyError)
})

test("RC-02 reuses the RC-01 safety primitives instead of forking them", () => {
  const library = readFileSync(new URL("./racecon-rc02-capture-lib.mjs", import.meta.url), "utf8")
  assert.match(library, /from "\.\/racecon-rc01-capture-lib\.mjs"/u)
  for (const symbol of [
    "parseCaptureArgs", "prepareCaptureOutput", "createPrivateStaging", "exclusiveWriteFile",
    "publishPrivateStaging", "revalidatePublishedOutput", "removePublishedOutput",
    "discardPrivateStaging", "assertCleanGitState", "listGitWorktrees", "readGitState"
  ]) {
    assert.match(library, new RegExp(`^\\s{2}${symbol},?$`, "mu"), `${symbol} must be re-exported, not redefined`)
    assert.doesNotMatch(library, new RegExp(`function ${symbol}\\b`, "u"), `${symbol} must not be forked into the RC-02 library`)
  }
})

test("capture exercises the default production DashboardCanvas viewport path", () => {
  const source = readFileSync(new URL("./racecon-rc02-capture.tsx", import.meta.url), "utf8")
  const driver = readFileSync(new URL("./racecon-rc02-capture.mjs", import.meta.url), "utf8")
  assert.match(source, /<DashboardCanvas[\s\S]*?dashboard=\{dashboard\}/u)
  assert.doesNotMatch(source, /<DashboardCanvas[\s\S]*?\bviewport=/u)
  assert.doesNotMatch(source, /mock-telemetry/u)
  assert.match(driver, /ROOT_SELECTOR = "#racecon-rc02-capture-root"/u)
  assert.match(driver, /racecon_rc02_dash-\$\{size\.width\}x\$\{size\.height\}\.png/u)
  assert.match(driver, /racecon_rc02_dash-capture\.json/u)
  assert.match(driver, /getAttribute\("data-rc02-buffer-state"\) === "accepted"/u)
  assert.match(driver, /sha256: sha256\(png\)/u)
  assert.match(driver, /exclusiveWriteFile\(staging/u)
})

test("the fixture drives a live source identity with no replay or mock marker", () => {
  const source = readFileSync(new URL("./racecon-rc02-capture.tsx", import.meta.url), "utf8")
  assert.match(source, /sessionUniqueId: FIXTURE_SESSION_ID/u)
  assert.match(source, /connectionEpoch: FIXTURE_CONNECTION_EPOCH/u)
  assert.match(source, /connected: true/u)
  assert.match(source, /timestamp: FIXTURE_TIMESTAMP \+ sequence \* FIXTURE_FRAME_MS/u)
  assert.doesNotMatch(source, /replayContext/u)
  assert.doesNotMatch(source, /sim: "(?:mock|replay|none)"/u)
})

test("private staging publishes only to a non-existing target outside worktrees", () => {
  const parent = temporaryDirectory()
  const target = join(parent, "published-capture")
  const worktree = join(parent, "worktree")
  mkdirSync(worktree)
  try {
    assert.equal(isSameOrDescendant(join(worktree, "inside"), worktree), true)
    assert.throws(() => prepareCaptureOutput(join(worktree, "inside"), [worktree]), CaptureSafetyError)
    const output = prepareCaptureOutput(target, [])
    const staging = createPrivateStaging(output)
    assert.equal(existsSync(target), false)
    assert.notEqual(staging.canonical, target)
    exclusiveWriteFile(staging, "capture.png", Buffer.from("png"))
    exclusiveWriteFile(staging, "racecon_rc02_dash-capture.json", Buffer.from("{}\n"))
    const publication = publishPrivateStaging(staging)
    assert.equal(existsSync(target), true)
    removePublishedOutput(publication)
    assert.equal(existsSync(target), false)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test("staged overwrite before publication is rejected and private output is cleaned", () => {
  const parent = temporaryDirectory()
  const target = join(parent, "published-capture")
  try {
    const staging = createPrivateStaging(prepareCaptureOutput(target, []))
    const capture = exclusiveWriteFile(staging, "capture.png", Buffer.from("trusted"))
    exclusiveWriteFile(staging, "racecon_rc02_dash-capture.json", Buffer.from("{}\n"))
    writeFileSync(capture, Buffer.from("reviewer-overwrite"))

    assert.throws(() => publishPrivateStaging(staging), CaptureSafetyError)
    assert.equal(existsSync(target), false)
    assert.equal(existsSync(staging.canonical), false)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test("descriptor-close overwrite cannot become the trusted staged hash", () => {
  const parent = temporaryDirectory()
  const target = join(parent, "published-capture")
  try {
    const staging = createPrivateStaging(prepareCaptureOutput(target, []))
    assert.throws(() => exclusiveWriteFile(
      staging,
      "capture.png",
      Buffer.from("trusted"),
      {
        afterDescriptorClose: (path) => {
          writeFileSync(path, Buffer.from("attacker-controlled"))
        }
      }
    ), CaptureSafetyError)
    assert.equal(existsSync(join(staging.canonical, "capture.png")), false)
    assert.equal(staging.expectedFiles.has("capture.png"), false)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test("exclusive-open race never deletes an unowned staged-path file", () => {
  const parent = temporaryDirectory()
  const target = join(parent, "published-capture")
  try {
    const staging = createPrivateStaging(prepareCaptureOutput(target, []))
    assert.throws(() => exclusiveWriteFile(
      staging,
      "capture.png",
      Buffer.from("trusted"),
      {
        beforeExclusiveOpen: (path) => {
          writeFileSync(path, Buffer.from("attacker-owned"))
        }
      }
    ), CaptureSafetyError)
    assert.equal(existsSync(staging.canonical), false)
    const quarantines = readdirSync(parent)
      .filter((name) => name.startsWith(".racecon-rc01-quarantine-"))
    assert.equal(quarantines.length, 1)
    assert.equal(
      readFileSync(join(parent, quarantines[0], "capture.png"), "utf8"),
      "attacker-owned"
    )
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test("post-publication verification rejects mutation and removes the published output", () => {
  const parent = temporaryDirectory()
  const target = join(parent, "published-capture")
  try {
    const staging = createPrivateStaging(prepareCaptureOutput(target, []))
    exclusiveWriteFile(staging, "capture.png", Buffer.from("trusted"))
    exclusiveWriteFile(staging, "racecon_rc02_dash-capture.json", Buffer.from("{}\n"))

    assert.throws(() => publishPrivateStaging(staging, {
      afterExclusivePublication: (publishedDirectory) => {
        writeFileSync(join(publishedDirectory, "capture.png"), Buffer.from("post-publish-overwrite"))
      }
    }), CaptureSafetyError)
    assert.equal(existsSync(target), false)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test("a later published-file overwrite is rejected and cleaned during revalidation", () => {
  const parent = temporaryDirectory()
  const target = join(parent, "published-capture")
  try {
    const staging = createPrivateStaging(prepareCaptureOutput(target, []))
    exclusiveWriteFile(staging, "capture.png", Buffer.from("trusted"))
    exclusiveWriteFile(staging, "racecon_rc02_dash-capture.json", Buffer.from("{}\n"))
    const publication = publishPrivateStaging(staging)
    writeFileSync(join(target, "capture.png"), Buffer.from("late-overwrite"))

    assert.throws(() => revalidatePublishedOutput(publication), CaptureSafetyError)
    assert.equal(existsSync(target), false)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test("staging revalidation rejects a directory swap before exclusive output writes", () => {
  const parent = temporaryDirectory()
  const target = join(parent, "published-capture")
  try {
    const staging = createPrivateStaging(prepareCaptureOutput(target, []))
    const moved = join(parent, "moved-staging")
    renameSync(staging.canonical, moved)
    mkdirSync(staging.canonical)
    assert.throws(() => revalidatePrivateStaging(staging), CaptureSafetyError)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test("post-manifest target creation prevents publication rather than overwriting", () => {
  const parent = temporaryDirectory()
  const target = join(parent, "published-capture")
  try {
    const output = prepareCaptureOutput(target, [])
    const staging = createPrivateStaging(output)
    exclusiveWriteFile(staging, "capture.png", Buffer.from("png"))
    exclusiveWriteFile(staging, "racecon_rc02_dash-capture.json", Buffer.from("{}\n"))
    mkdirSync(target)
    assert.throws(() => publishPrivateStaging(staging), CaptureSafetyError)
    assert.equal(existsSync(target), true)
    assert.equal(existsSync(staging.canonical), false)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test("discarded staging never leaves an output identity behind", () => {
  const parent = temporaryDirectory()
  const target = join(parent, "published-capture")
  try {
    const staging = createPrivateStaging(prepareCaptureOutput(target, []))
    exclusiveWriteFile(staging, "capture.png", Buffer.from("trusted"))
    discardPrivateStaging(staging)
    assert.equal(existsSync(staging.canonical), false)
    assert.equal(existsSync(target), false)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test("final Git state rejects dirty work and HEAD movement after artifact creation", () => {
  assert.equal(assertCleanGitState({ head: "abc", dirty: false }), "abc")
  assert.throws(() => assertCleanGitState({ head: "abc", dirty: true }), CaptureSafetyError)
  assert.throws(() => assertCleanGitState({ head: "def", dirty: false }, "abc"), CaptureSafetyError)
})

test("metric validation proves the responsive DashboardCanvas model, RC-02 modifiers, LEDs, sectors, spine and text", () => {
  assert.equal(CAPTURE_SIZES.length, 6)
  assert.equal(Object.isFrozen(CAPTURE_SIZES), true)
  for (const capture of CAPTURE_SIZES) {
    assert.equal(Object.isFrozen(capture), true)
    assert.equal(validateCaptureMetrics(validMetrics(capture), capture), true)
  }
})

test("metric validation fails closed on the RC-02 structural contract", () => {
  const size = CAPTURE_SIZES[0]
  const mutations = {
    "LED count": (metrics) => { metrics.leds = metrics.leds.slice(0, RC02_LED_COUNT - 1) },
    "sector chip count": (metrics) => { metrics.sectors = metrics.sectors.slice(0, RC02_SECTOR_COUNT - 1) },
    "missing spine datum": (metrics) => { metrics.spineDatum = null },
    "missing spine track": (metrics) => { metrics.spineTrack = null },
    "off-centre spine datum": (metrics) => { metrics.spineDatum = { ...metrics.spineDatum, top: metrics.spineDatum.top + 6 } },
    "wrong data-widget": (metrics) => { metrics.renderedWidgetId = "raceconRc01Dash" },
    "refused buffer state": (metrics) => { metrics.bufferState = "duplicate" },
    "missing personal-best pace": (metrics) => { metrics.pbPace = "false" },
    "wrong layout modifier": (metrics) => { metrics.layout = "app" },
    "wrong native size modifier": (metrics) => { metrics.nativeSize = null },
    "scaled dashboard canvas": (metrics) => { metrics.canvas.transform.a = 0.78125 },
    "fabricated sector value": (metrics) => { metrics.sectors[2].text = "1,234" },
    "unevidenced sector loss": (metrics) => { metrics.sectors[2].loss = "true" },
    "contradictory ladder state": (metrics) => { metrics.ladderEmpty = 1 },
    "fabricated ladder cell": (metrics) => { metrics.ladderValues = ["31.49", "31.49", "27.55", "n/a"] },
    "missing live ladder sector": (metrics) => { metrics.ladderNowSectors = metrics.ladderNowSectors.slice(0, 2) },
    "unevidenced live ladder loss": (metrics) => { metrics.ladderNowSectors[2].loss = "true" },
    "four-cell ladder row": (metrics) => { metrics.ladderRowCells[0] = metrics.ladderRowCells[0].slice(0, 4) },
    "console error": (metrics) => { metrics.consoleErrors = ["boom"] }
  }
  for (const [label, mutate] of Object.entries(mutations)) {
    const metrics = validMetrics(size)
    mutate(metrics)
    assert.throws(() => validateCaptureMetrics(metrics, size), CaptureSafetyError, `${label} must fail closed`)
  }
})

test("metric validation rejects a value output that does not match the live fixture", () => {
  for (const [name, wrong] of [["gear", "6"], ["speed", "215"], ["delta", "+0.284"], ["predicted", "1:39.265"], ["best", "1:39.549"]]) {
    const size = CAPTURE_SIZES[0]
    const metrics = validMetrics(size)
    metrics.values[name].text = wrong
    assert.throws(() => validateCaptureMetrics(metrics, size), CaptureSafetyError, `${name} must fail closed`)
  }
  const size = CAPTURE_SIZES[0]
  const tyres = validMetrics(size)
  tyres.tyres[1].text = "99\u00B0"
  assert.throws(() => validateCaptureMetrics(tyres, size), CaptureSafetyError)
})

test("metric validation rejects a modifier that disagrees with the measured content box", () => {
  const size = CAPTURE_SIZES[2]
  const metrics = validMetrics(size)
  metrics.compactMode = "landscape"
  assert.throws(() => validateCaptureMetrics(metrics, size), CaptureSafetyError)

  const landscape = CAPTURE_SIZES[4]
  const swapped = validMetrics(landscape)
  swapped.widget = { ...swapped.widget, width: 800, height: 480 }
  assert.throws(() => validateCaptureMetrics(swapped, landscape), CaptureSafetyError)
})

function paint(image, rect, rgb) {
  for (let y = rect.top; y < rect.top + rect.height; y += 1) {
    for (let x = rect.left; x < rect.left + rect.width; x += 1) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = rgb[0]
      image.data[offset + 1] = rgb[1]
      image.data[offset + 2] = rgb[2]
      image.data[offset + 3] = 255
    }
  }
}

function capturePng(size) {
  const image = new PNG({ width: size.width, height: size.height })
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = CANVAS_RGB[0]
    image.data[offset + 1] = CANVAS_RGB[1]
    image.data[offset + 2] = CANVAS_RGB[2]
    image.data[offset + 3] = 255
  }
  const ledTop = 16
  const ledHeight = 16
  const ledWidth = 18
  for (let index = 0; index < RC02_LED_COUNT; index += 1) {
    paint(image, { left: 40 + index * (ledWidth + 4), top: ledTop, width: ledWidth, height: ledHeight }, LED_RGB[LED_TONES[index]])
  }
  // A filled zone body, so a blank capture can never satisfy the audit by LEDs alone.
  paint(image, { left: 30, top: 120, width: Math.min(120, size.width - 60), height: Math.min(120, size.height - 200) }, [16, 24, 38])
  return image
}

test("pixel validation accepts an opaque RC-02 capture with every governed LED colour group", () => {
  for (const size of CAPTURE_SIZES) {
    const audit = validateCapturePixels(PNG.sync.write(capturePng(size)), size)
    assert.equal(audit.opaque, true)
    assert.equal(audit.canvasBorder, "#05070C")
    assert.equal(audit.width, size.width)
    assert.equal(audit.height, size.height)
    assert.ok(audit.nonCanvasPixels >= 5_000)
    assert.deepEqual(Object.keys(audit.ledColorPixels).sort(), ["caution", "good", "info", "signature"])
    assert.ok(Object.values(audit.ledColorPixels).every((count) => count >= 100))
  }
})

test("pixel validation rejects a blank capture", () => {
  const size = CAPTURE_SIZES[0]
  const blank = new PNG({ width: size.width, height: size.height })
  for (let offset = 0; offset < blank.data.length; offset += 4) {
    blank.data[offset] = CANVAS_RGB[0]
    blank.data[offset + 1] = CANVAS_RGB[1]
    blank.data[offset + 2] = CANVAS_RGB[2]
    blank.data[offset + 3] = 255
  }
  assert.throws(() => validateCapturePixels(PNG.sync.write(blank), size), CaptureSafetyError)
})

test("pixel validation rejects a missing personal-best cap colour", () => {
  const size = CAPTURE_SIZES[1]
  const image = capturePng(size)
  paint(image, { left: 40 + 8 * 22, top: 16, width: 18, height: 16 }, LED_RGB.caution)
  assert.throws(() => validateCapturePixels(PNG.sync.write(image), size), CaptureSafetyError)
})

test("pixel validation rejects transparency, a wrong size, and a painted canvas gutter", () => {
  const size = CAPTURE_SIZES[0]
  const transparent = capturePng(size)
  transparent.data[3] = 254
  assert.throws(() => validateCapturePixels(PNG.sync.write(transparent), size), CaptureSafetyError)

  assert.throws(
    () => validateCapturePixels(PNG.sync.write(capturePng(size)), CAPTURE_SIZES[1]),
    CaptureSafetyError
  )

  const gutter = capturePng(size)
  paint(gutter, { left: 0, top: 0, width: 4, height: 4 }, LED_RGB.info)
  assert.throws(() => validateCapturePixels(PNG.sync.write(gutter), size), CaptureSafetyError)

  assert.throws(
    () => validateCapturePixels(PNG.sync.write(capturePng(size)), { width: 640, height: 480 }),
    CaptureSafetyError
  )
})
