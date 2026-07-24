import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs"
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
  return Array.from({ length: 11 }, (_, index) => {
    const native = size.width === 800
    return {
      left: native ? 52 + index * 64 : APP_LED_RECTS[index].left,
      top: native ? 16 : 14,
      width: native ? 56 : APP_LED_RECTS[index].width,
      height: native ? 20 : 32,
      active: true,
      color: index < 3 ? "rgb(0, 217, 255)" : index < 6 ? "rgb(0, 230, 118)" : index < 9 ? "rgb(255, 179, 0)" : "rgb(255, 59, 48)"
    }
  })
}

function validMetrics(size) {
  const base = {
    viewport: { width: size.width, height: size.height, dpr: 1 },
    root: { left: 0, top: 0, width: size.width, height: size.height },
    shell: { left: 0, top: 0, width: size.width, height: size.height, layoutWidth: size.width, layoutHeight: size.height },
    canvas: {
      left: 0, top: 0, width: size.width, height: size.height, layoutWidth: size.width, layoutHeight: size.height,
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    },
    dashboardElement: { left: 0, top: 0, width: size.width, height: size.height, layoutWidth: size.width, layoutHeight: size.height },
    widget: { left: 0, top: 0, width: size.width, height: size.height, layoutWidth: size.width, layoutHeight: size.height },
    presetId: "racecon_rc01_dash",
    expectedWidgetId: "raceconRc01Dash",
    renderedWidgetId: "raceconRc01Dash",
    dashboardWidth: "1024",
    dashboardHeight: "600",
    sourceKind: "live-telemetry",
    sourceIdentity: "acc:session:74001:connection:12",
    bufferState: "accepted",
    errorBoundaryCount: 0,
    unknownWidgetCount: 0,
    failures: [],
    pageErrors: [],
    consoleErrors: [],
    rootText: "SPEED 278 6 9,600 -0.216 S TC 4 P02 42.5 L 85° 87° 89° 91°",
    textOutputs: ["278", "6", "9,600", "-0.216 S"],
    leds: ledMetrics(size)
  }
  if (size.width === 800) {
    return { ...base, layout: "native", nativeSize: "800x480", contentWidth: "800", contentHeight: "480", appRail: { left: 0, top: 0, width: 0, height: 0, display: "none" } }
  }
  return {
    ...base,
    layout: "app",
    nativeSize: null,
    contentWidth: "1024",
    contentHeight: "600",
    appRail: { left: 896, top: 96, width: 112, height: 410, display: "flex" }
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
  assert.match(source, /<DashboardCanvas[\s\S]*?dashboard=\{dashboard\}/u)
  assert.doesNotMatch(source, /<DashboardCanvas[\s\S]*?\bviewport=/u)
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
    const publication = publishPrivateStaging(staging)
    assert.equal(existsSync(target), true)
    removePublishedOutput(publication)
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
    assert.equal(existsSync(staging.canonical), true)
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
  assert.equal(validateCaptureMetrics(validMetrics({ width: 800, height: 480 }), { width: 800, height: 480 }), true)
  assert.equal(validateCaptureMetrics(validMetrics({ width: 1024, height: 600 }), { width: 1024, height: 600 }), true)
  const invalid = validMetrics({ width: 800, height: 480 })
  invalid.canvas.transform.a = 0.78125
  assert.throws(() => validateCaptureMetrics(invalid, { width: 800, height: 480 }), CaptureSafetyError)
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
