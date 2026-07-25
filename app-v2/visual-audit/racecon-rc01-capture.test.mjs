import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { PNG } from "pngjs"
import {
  CAPTURE_SIZES,
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
  revalidatePublishedOutput,
  validateCaptureMetrics,
  validateCapturePixels
} from "./racecon-rc01-capture-lib.mjs"

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "racecon-rc01-capture-test-"))
}

const APP_LED_RECTS = [
  { left: 24, width: 80.734375 }, { left: 113.515625, width: 80.75 },
  { left: 203.046875, width: 80.734375 }, { left: 292.5625, width: 80.75 },
  { left: 382.09375, width: 80.734375 }, { left: 471.609375, width: 80.75 },
  { left: 561.140625, width: 80.734375 }, { left: 650.65625, width: 80.75 },
  { left: 740.1875, width: 80.75 }, { left: 829.71875, width: 80.75 },
  { left: 919.25, width: 80.75 }
]

function ledMetrics(size) {
  const native = size.width === 800 && size.height === 480
  const app = size.width === 1024 && size.height === 600
  const compactWidth = (size.width - 24 - 40) / 11
  return Array.from({ length: 11 }, (_, index) => {
    return {
      left: native ? 52 + index * 64 : app ? APP_LED_RECTS[index].left : 12 + index * (compactWidth + 4),
      top: native ? 16 : app ? 14 : 12,
      width: native ? 56 : app ? APP_LED_RECTS[index].width : compactWidth,
      height: native ? 20 : app ? 32 : 16,
      active: true,
      color: index < 3 ? "rgb(0, 217, 255)" : index < 6 ? "rgb(0, 230, 118)" : index < 9 ? "rgb(255, 179, 0)" : "rgb(255, 59, 48)"
    }
  })
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

function validMetrics(input) {
  const size = { ...input }
  const native = size.width === 800 && size.height === 480
  const app = size.width === 1024 && size.height === 600
  const phone = (size.width === 393 && size.height === 759) || (size.width === 412 && size.height === 867)
  const landscape = (size.width === 759 && size.height === 393) || (size.width === 867 && size.height === 412)
  const detail = size.detail ?? (phone ? "tyres" : "fuel")
  const statusTop = phone ? Math.floor(size.height * 0.53) : 0
  const phoneStatus = {
    left: 12,
    top: statusTop,
    width: size.width - 24,
    height: size.height - statusTop - 18
  }
  const landscapeStatus = {
    left: size.width * 0.7,
    top: size.height * 0.64,
    width: size.width * 0.28,
    height: size.height * 0.32
  }
  const status = native
    ? { left: 570, top: 326, width: 190, height: 132 }
    : app
      ? { left: 24, top: 372, width: 848, height: 210 }
      : phone
        ? phoneStatus
        : landscapeStatus
  const toggle = native
    ? { left: 716, top: 414, width: 44, height: 44 }
    : app
      ? { left: 0, top: 0, width: 0, height: 0 }
      : phone
        ? {
            left: phoneStatus.left + phoneStatus.width - 44,
            top: phoneStatus.top + phoneStatus.height - 45,
            width: 44,
            height: 44
          }
        : {
            left: landscapeStatus.left + landscapeStatus.width - 44,
            top: landscapeStatus.top + landscapeStatus.height - 44,
            width: 44,
            height: 44
          }

  let statusGrid = measuredRect({ left: status.left, top: status.top, width: status.width, height: status.height * 0.7 })
  let statusMetrics = []
  let tyreGrid = { ...measuredRect({ left: 0, top: 0, width: 0, height: 0 }), display: "none" }
  let tyreMetrics = []
  if (phone) {
    const gridRect = {
      left: phoneStatus.left,
      top: phoneStatus.top + 1,
      width: phoneStatus.width * 0.44,
      height: phoneStatus.height - 52
    }
    statusGrid = { ...measuredRect(gridRect), columns: [`${gridRect.width / 2}px`, `${gridRect.width / 2}px`] }
    const columnWidth = gridRect.width / 2
    const makeMetric = (label, text, index) => {
      const rect = measuredRect({ left: gridRect.left + columnWidth * index, top: gridRect.top, width: columnWidth, height: gridRect.height })
      const valueRect = measuredRect({ left: rect.left + 4, top: rect.top + 40, width: rect.width - 8, height: 34 })
      return { label, text, display: "flex", rect, valueRect, valueTextRect: { left: valueRect.left + 4, top: valueRect.top + 3, width: Math.min(48, valueRect.width - 8), height: 28 } }
    }
    statusMetrics = [
      makeMetric("TC", "4", 0),
      makeMetric("POS", "P02", 1),
      {
        label: "FUEL", text: "42.5 L", display: "none",
        rect: measuredRect({ left: 0, top: 0, width: 0, height: 0 }),
        valueRect: measuredRect({ left: 0, top: 0, width: 0, height: 0 }),
        valueTextRect: { left: 0, top: 0, width: 0, height: 0 }
      }
    ]
    const tyreRect = {
      left: phoneStatus.left + phoneStatus.width * 0.44,
      top: phoneStatus.top + 1,
      width: phoneStatus.width * 0.56,
      height: phoneStatus.height - 52
    }
    tyreGrid = { ...measuredRect(tyreRect), display: "grid" }
    const tyreLabels = [["LF", "85\u00B0"], ["RF", "87\u00B0"], ["LR", "89\u00B0"], ["RR", "91\u00B0"]]
    tyreMetrics = tyreLabels.map(([label, text], index) => {
      const width = tyreRect.width / 2
      const height = tyreRect.height / 2
      const rect = measuredRect({ left: tyreRect.left + (index % 2) * width, top: tyreRect.top + Math.floor(index / 2) * height, width, height })
      return {
        label, text, rect,
        valueRect: measuredRect({ left: rect.left + 4, top: rect.top + 20, width: rect.width - 8, height: 24 })
      }
    })
  } else if (landscape) {
    const gridRect = { left: status.left, top: status.top + 1, width: status.width, height: status.height * 0.64 }
    statusGrid = { ...measuredRect(gridRect), columns: ["1fr", "1fr", "1fr"] }
    const labels = [["TC", "4"], ["POS", "P02"], ["FUEL", "42.5 L"]]
    statusMetrics = labels.map(([label, text], index) => {
      const width = gridRect.width / 3
      const rect = measuredRect({ left: gridRect.left + width * index, top: gridRect.top, width, height: gridRect.height })
      return {
        label, text, display: "flex", rect,
        valueRect: measuredRect({ left: rect.left + 2, top: rect.top + 28, width: rect.width - 4, height: 28 }),
        valueTextRect: { left: rect.left + 4, top: rect.top + 30, width: rect.width - 8, height: 24 }
      }
    })
  }

  const hero = (zone, value, text, fontSize) => ({
    zone,
    value: measuredRect(value),
    textRect: { left: value.left + 6, top: value.top + 4, width: value.width - 12, height: value.height - 8 },
    text,
    fontSize
  })
  const heroes = landscape
    ? {
        speed: hero(
          { left: size.width * 0.02, top: size.height * 0.12, width: size.width * 0.27, height: size.height * 0.48 },
          { left: size.width * 0.02, top: size.height * 0.22, width: size.width * 0.27, height: 72 },
          "278", 68
        ),
        gear: hero(
          { left: size.width * 0.31, top: size.height * 0.09, width: size.width * 0.36, height: size.height * 0.54 },
          { left: size.width * 0.31, top: size.height * 0.17, width: size.width * 0.36, height: 120 },
          "6", 120
        ),
        rpm: hero(
          { left: size.width * 0.69, top: size.height * 0.12, width: size.width * 0.29, height: size.height * 0.48 },
          { left: size.width * 0.69, top: size.height * 0.25, width: size.width * 0.29 - 8, height: 56 },
          "9,600", 48
        )
      }
    : { speed: null, gear: null, rpm: null }

  const base = {
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
    presetId: "racecon_rc01_dash",
    expectedWidgetId: "raceconRc01Dash",
    renderedWidgetId: "raceconRc01Dash",
    dashboardWidth: "1024",
    dashboardHeight: "600",
    sourceKind: "live-telemetry",
    sourceIdentity: "acc:session:74001:connection:12",
    bufferState: "accepted",
    detail,
    detailClass: detail,
    compactMode: phone ? "phone" : landscape ? "landscape" : null,
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures: [],
    pageErrors: [],
    consoleErrors: [],
    rootText: "SPEED 278 6 9,600 -0.216 S TC 4 P02 42.5 L 85\u00B0 87\u00B0 89\u00B0 91\u00B0",
    textOutputs: ["278", "6", "9,600", "-0.216 S"],
    ledArc: landscape ? { left: 12, top: 12, width: size.width - 24, height: 16 } : null,
    delta: landscape ? { left: size.width * 0.02, top: size.height * 0.64, width: size.width * 0.65, height: size.height * 0.32 } : null,
    status,
    statusGrid,
    tyreGrid,
    statusToggle: {
      ...toggle,
      display: app ? "none" : "block",
      ariaLabel: detail === "tyres" ? "Show fuel status" : "Show tyre summary",
      beforeContent: "\"\"",
      afterContent: "\"\""
    },
    statusMetrics,
    tyreMetrics,
    heroes,
    leds: ledMetrics(size)
  }
  if (native) {
    return { ...base, layout: "native", nativeSize: "800x480", contentWidth: "800", contentHeight: "480", appRail: { left: 0, top: 0, width: 0, height: 0, display: "none" } }
  }
  if (app) return {
    ...base,
    layout: "app",
    nativeSize: null,
    contentWidth: "1024",
    contentHeight: "600",
    appRail: { left: 896, top: 96, width: 112, height: 410, display: "flex" }
  }
  return {
    ...base,
    layout: "compact",
    nativeSize: null,
    contentWidth: String(size.width),
    contentHeight: String(size.height),
    appRail: { left: 0, top: 0, width: 0, height: 0, display: "none" }
  }
}

test("capture CLI accepts only explicit mode and a non-existing absolute target", () => {
  const absolute = resolve(tmpdir(), "racecon-rc01-output")
  assert.deepEqual(parseCaptureArgs(["--mode", "final", "--out", absolute]), { mode: "final", outputDirectory: absolute })
  assert.deepEqual(parseCaptureArgs(["--out", absolute]), { mode: "validate", outputDirectory: absolute })
  assert.deepEqual(parseCaptureArgs(["--help"]), { help: true })
  assert.throws(() => parseCaptureArgs(["--mode", "final", "--out", "relative"]), CaptureSafetyError)
  assert.throws(() => parseCaptureArgs(["--mode", "preview", "--out", absolute]), CaptureSafetyError)
})

test("capture exercises the default production DashboardCanvas viewport path", () => {
  const source = readFileSync(new URL("./racecon-rc01-capture.tsx", import.meta.url), "utf8")
  const driver = readFileSync(new URL("./racecon-rc01-capture.mjs", import.meta.url), "utf8")
  assert.match(source, /<DashboardCanvas[\s\S]*?dashboard=\{dashboard\}/u)
  assert.doesNotMatch(source, /<DashboardCanvas[\s\S]*?\bviewport=/u)
  assert.match(driver, /size\.detail === "tyres"[\s\S]*?toggle\.click\(\)/u)
  assert.match(driver, /size\.width\}x\$\{size\.height\}-\$\{size\.detail\}\.png/u)
  assert.match(driver, /sha256: sha256\(png\)/u)
  assert.match(driver, /exclusiveWriteFile\(staging/u)
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
    exclusiveWriteFile(staging, "racecon_rc01_dash-capture.json", Buffer.from("{}\n"))
    assert.deepEqual(staging.expectedFiles.get("capture.png"), {
      bytes: 3,
      sha256: "8f8cbb7dcf46e0bc7d53265749a6c17d116093a6ba95e442764060c76fd4a86c"
    })
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
    exclusiveWriteFile(staging, "racecon_rc01_dash-capture.json", Buffer.from("{}\n"))
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
    exclusiveWriteFile(staging, "racecon_rc01_dash-capture.json", Buffer.from("{}\n"))

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
    exclusiveWriteFile(staging, "racecon_rc01_dash-capture.json", Buffer.from("{}\n"))
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
    exclusiveWriteFile(staging, "racecon_rc01_dash-capture.json", Buffer.from("{}\n"))
    mkdirSync(target)
    assert.throws(() => publishPrivateStaging(staging), CaptureSafetyError)
    assert.equal(existsSync(target), true)
    assert.equal(existsSync(staging.canonical), false)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test("target creation in the final publication window is never overwritten", () => {
  const parent = temporaryDirectory()
  const target = join(parent, "published-capture")
  try {
    const staging = createPrivateStaging(prepareCaptureOutput(target, []))
    exclusiveWriteFile(staging, "capture.png", Buffer.from("trusted"))
    exclusiveWriteFile(staging, "racecon_rc01_dash-capture.json", Buffer.from("{}\n"))

    assert.throws(() => publishPrivateStaging(staging, {
      beforeExclusiveTargetCreate: (publicationTarget) => {
        mkdirSync(publicationTarget)
        writeFileSync(join(publicationTarget, "attacker.txt"), "do-not-overwrite")
      }
    }), CaptureSafetyError)
    assert.equal(readFileSync(join(target, "attacker.txt"), "utf8"), "do-not-overwrite")
    assert.equal(existsSync(staging.canonical), false)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test("final Git state rejects dirty work and HEAD movement after artifact creation", () => {
  assert.equal(assertCleanGitState({ head: "abc", dirty: false }), "abc")
  assert.throws(() => assertCleanGitState({ head: "abc", dirty: true }), CaptureSafetyError)
  assert.throws(() => assertCleanGitState({ head: "def", dirty: false }, "abc"), CaptureSafetyError)
})

test("metric validation proves the responsive DashboardCanvas model, content modifiers, LEDs, and text", () => {
  assert.equal(CAPTURE_SIZES.length, 6)
  assert.equal(Object.isFrozen(CAPTURE_SIZES), true)
  for (const capture of CAPTURE_SIZES) {
    assert.equal(Object.isFrozen(capture), true)
    assert.equal(validateCaptureMetrics(validMetrics(capture), capture), true)
  }
  const invalid = validMetrics({ width: 800, height: 480, detail: "fuel" })
  invalid.canvas.transform.a = 0.78125
  assert.throws(() => validateCaptureMetrics(invalid, { width: 800, height: 480, detail: "fuel" }), CaptureSafetyError)
})

function exactNativePng() {
  const image = new PNG({ width: 800, height: 480 })
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = 12
    image.data[offset + 1] = 15
    image.data[offset + 2] = 19
    image.data[offset + 3] = 255
  }
  const colors = [
    [0, 217, 255], [0, 217, 255], [0, 217, 255],
    [0, 230, 118], [0, 230, 118], [0, 230, 118],
    [255, 179, 0], [255, 179, 0], [255, 179, 0],
    [255, 59, 48], [255, 59, 48]
  ]
  for (let index = 0; index < 11; index += 1) {
    for (let y = 16; y <= 35; y += 1) {
      for (let x = 52 + index * 64; x <= 107 + index * 64; x += 1) {
        const offset = (y * image.width + x) * 4
        image.data[offset] = colors[index][0]
        image.data[offset + 1] = colors[index][1]
        image.data[offset + 2] = colors[index][2]
      }
    }
  }
  return image
}

function exactAppPng() {
  const image = new PNG({ width: 1024, height: 600 })
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = 12
    image.data[offset + 1] = 15
    image.data[offset + 2] = 19
    image.data[offset + 3] = 255
  }
  const rects = [
    { left: 24, width: 81 }, { left: 114, width: 80 }, { left: 203, width: 81 },
    { left: 293, width: 80 }, { left: 382, width: 81 }, { left: 472, width: 80 },
    { left: 561, width: 81 }, { left: 651, width: 80 }, { left: 740, width: 81 },
    { left: 830, width: 80 }, { left: 919, width: 81 }
  ]
  const colors = [
    [0, 217, 255], [0, 217, 255], [0, 217, 255],
    [0, 230, 118], [0, 230, 118], [0, 230, 118],
    [255, 179, 0], [255, 179, 0], [255, 179, 0],
    [255, 59, 48], [255, 59, 48]
  ]
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index]
    for (let y = 14; y <= 45; y += 1) {
      for (let x = rect.left; x < rect.left + rect.width; x += 1) {
        const offset = (y * image.width + x) * 4
        image.data[offset] = colors[index][0]
        image.data[offset + 1] = colors[index][1]
        image.data[offset + 2] = colors[index][2]
      }
    }
  }
  return image
}

test("pixel validation proves the exact opaque native top-band contract", () => {
  const image = exactNativePng()
  const result = validateCapturePixels(PNG.sync.write(image), { width: 800, height: 480 })
  assert.equal(result.nativeTopBandExact, true)
  assert.deepEqual(result.nativeLedExactPixels, Array(11).fill(1120))
})

test("pixel validation rejects a single anti-aliased native LED edge pixel", () => {
  const image = exactNativePng()
  const offset = (16 * image.width + 52) * 4
  image.data[offset] = 8
  image.data[offset + 1] = 84
  image.data[offset + 2] = 99
  assert.throws(
    () => validateCapturePixels(PNG.sync.write(image), { width: 800, height: 480 }),
    CaptureSafetyError
  )
})

test("pixel validation proves the exact opaque app top-band contract", () => {
  const result = validateCapturePixels(PNG.sync.write(exactAppPng()), { width: 1024, height: 600 })
  assert.equal(result.appTopBandExact, true)
  assert.deepEqual(result.appLedExactPixels, [2592, 2560, 2592, 2560, 2592, 2560, 2592, 2560, 2592, 2560, 2592])
})

test("pixel validation rejects a blank app capture", () => {
  const blank = new PNG({ width: 1024, height: 600 })
  for (let offset = 0; offset < blank.data.length; offset += 4) {
    blank.data[offset] = 12
    blank.data[offset + 1] = 15
    blank.data[offset + 2] = 19
    blank.data[offset + 3] = 255
  }
  assert.throws(
    () => validateCapturePixels(PNG.sync.write(blank), { width: 1024, height: 600 }),
    CaptureSafetyError
  )
})

function compactPng(size) {
  const image = new PNG(size)
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = 12
    image.data[offset + 1] = 15
    image.data[offset + 2] = 19
    image.data[offset + 3] = 255
  }
  const colors = [[0, 217, 255], [0, 230, 118], [255, 179, 0], [255, 59, 48]]
  for (let index = 0; index < colors.length; index += 1) {
    for (let y = 12; y < 32; y += 1) {
      for (let x = 12 + index * 36; x < 42 + index * 36; x += 1) {
        const offset = (y * image.width + x) * 4
        image.data[offset] = colors[index][0]
        image.data[offset + 1] = colors[index][1]
        image.data[offset + 2] = colors[index][2]
      }
    }
  }
  for (let y = 80; y < 130; y += 1) {
    for (let x = 20; x < 80; x += 1) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = 255
      image.data[offset + 1] = 255
      image.data[offset + 2] = 255
    }
  }
  return image
}

test("pixel validation accepts nonblank opaque compact captures with all LED color groups", () => {
  for (const size of [
    { width: 393, height: 759 }, { width: 412, height: 867 },
    { width: 759, height: 393 }, { width: 867, height: 412 }
  ]) {
    const result = validateCapturePixels(PNG.sync.write(compactPng(size)), size)
    assert.ok(result.compactNonCanvasPixels >= 5_000)
    assert.deepEqual(Object.keys(result.compactLedColorPixels).sort(), ["amber", "cyan", "green", "red"])
  }
})
