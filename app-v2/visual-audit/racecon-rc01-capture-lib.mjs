import { randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs"
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path"

export const CAPTURE_SIZES = Object.freeze([
  Object.freeze({ width: 800, height: 480 }),
  Object.freeze({ width: 1024, height: 600 })
])

export class CaptureSafetyError extends Error {
  constructor(message) {
    super(message)
    this.name = "CaptureSafetyError"
  }
}

function fail(message) {
  throw new CaptureSafetyError(message)
}

function normalizedPath(value) {
  const normalized = resolve(value)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function samePath(left, right) {
  return normalizedPath(left) === normalizedPath(right)
}

export function isSameOrDescendant(candidate, parent) {
  const child = normalizedPath(candidate)
  const ancestor = normalizedPath(parent)
  if (child === ancestor) return true
  const pathRelative = relative(ancestor, child)
  return pathRelative !== "" && !pathRelative.startsWith("..") && !isAbsolute(pathRelative)
}

export function parseCaptureArgs(argv) {
  let mode = "validate"
  let outputDirectory
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--mode") {
      mode = argv[index + 1]
      index += 1
      continue
    }
    if (argument === "--out") {
      outputDirectory = argv[index + 1]
      index += 1
      continue
    }
    if (argument === "--help" || argument === "-h") return { help: true }
    fail(`unknown argument: ${argument}`)
  }
  if (mode !== "final" && mode !== "validate") fail("--mode must be final or validate")
  if (typeof outputDirectory !== "string" || outputDirectory.length === 0) fail("--out requires an absolute non-existing output directory")
  if (!isAbsolute(outputDirectory)) fail("--out must be an absolute path")
  return { mode, outputDirectory: resolve(outputDirectory) }
}

function directoryIdentity(stats) {
  return `${stats.dev}:${stats.ino}`
}

function assertNoWindowsDirectoryLink(stats, label) {
  // Windows does not use directory link counts for ordinary directories. A count
  // other than one is therefore a hard-link/reparse attack signal. POSIX directory
  // link counts include children, so applying this check there would reject normal
  // directories.
  if (process.platform === "win32" && stats.nlink !== 1) fail(`${label} must not be hard-linked`)
}

function assertRealDirectoryPath(directory, label) {
  const absolute = resolve(directory)
  const parsed = parse(absolute)
  let current = parsed.root
  const segments = absolute.slice(parsed.root.length).split(/[\\/]+/u).filter(Boolean)
  for (const segment of segments) {
    current = join(current, segment)
    const listed = lstatSync(current)
    if (listed.isSymbolicLink() || !listed.isDirectory()) fail(`${label} must be a real directory: ${current}`)
    assertNoWindowsDirectoryLink(listed, `${label} path component`)
    const canonical = realpathSync.native(current)
    if (!samePath(canonical, current)) fail(`${label} must not traverse a symlink or junction: ${current}`)
  }
}

function canonicalDirectory(directory, label) {
  if (!isAbsolute(directory)) fail(`${label} must be absolute`)
  assertRealDirectoryPath(directory, label)
  const listed = lstatSync(directory)
  if (listed.isSymbolicLink() || !listed.isDirectory()) fail(`${label} must be a real directory: ${directory}`)
  assertNoWindowsDirectoryLink(listed, label)
  const canonical = realpathSync.native(directory)
  const followed = statSync(canonical)
  if (!followed.isDirectory() || followed.isSymbolicLink() || directoryIdentity(listed) !== directoryIdentity(followed)) {
    fail(`${label} changed while it was validated: ${directory}`)
  }
  assertNoWindowsDirectoryLink(followed, label)
  return { canonical, identity: directoryIdentity(followed) }
}

function revalidateDirectory(guard, label) {
  const current = canonicalDirectory(guard.canonical, label)
  if (!samePath(current.canonical, guard.canonical) || current.identity !== guard.identity) {
    fail(`${label} changed during capture`)
  }
  return guard
}

function safeLeafName(name, label) {
  if (basename(name) !== name || name === "." || name === ".." || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) {
    fail(`unsafe ${label}: ${name}`)
  }
}

function safeOutputName(fileName) {
  safeLeafName(fileName, "output file name")
}

function assertOutsideWorktrees(candidate, worktreePaths) {
  for (const worktree of worktreePaths) {
    let canonicalWorktree
    try {
      canonicalWorktree = canonicalDirectory(worktree, "Git worktree").canonical
    } catch (error) {
      if (error instanceof CaptureSafetyError) throw error
      canonicalWorktree = resolve(worktree)
    }
    if (isSameOrDescendant(candidate, canonicalWorktree)) {
      fail(`output directory must be outside every worktree: ${candidate}`)
    }
  }
}

function assertTargetAbsent(parent, target) {
  revalidateDirectory(parent, "output parent")
  if (!samePath(dirname(target), parent.canonical)) fail("output target escapes its validated parent")
  try {
    lstatSync(target)
  } catch (error) {
    if (error && error.code === "ENOENT") return
    throw error
  }
  fail(`output target must not exist: ${target}`)
}

/**
 * Validates a non-existing output target. The harness writes only to a private
 * sibling staging directory, then atomically renames that directory into place.
 */
export function prepareCaptureOutput(outputDirectory, worktreePaths) {
  if (!isAbsolute(outputDirectory)) fail("output directory must be absolute")
  const requested = resolve(outputDirectory)
  const targetName = basename(requested)
  safeLeafName(targetName, "output target name")
  const parent = canonicalDirectory(dirname(requested), "output parent")
  const target = join(parent.canonical, targetName)
  assertOutsideWorktrees(target, worktreePaths)
  assertTargetAbsent(parent, target)
  return { parent, target, targetName }
}

/** Creates a mode-0700, direct-child staging directory owned by the harness. */
export function createPrivateStaging(output) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    revalidateDirectory(output.parent, "output parent")
    assertTargetAbsent(output.parent, output.target)
    const name = `.racecon-rc01-staging-${process.pid}-${randomBytes(12).toString("hex")}`
    const candidate = join(output.parent.canonical, name)
    try {
      mkdirSync(candidate, { mode: 0o700 })
    } catch (error) {
      if (error && error.code === "EEXIST") continue
      throw error
    }
    try {
      const staging = canonicalDirectory(candidate, "private staging directory")
      if (!samePath(dirname(staging.canonical), output.parent.canonical)) fail("private staging directory escaped its parent")
      if (readdirSync(staging.canonical).length !== 0) fail("private staging directory is not empty")
      revalidateDirectory(output.parent, "output parent")
      assertTargetAbsent(output.parent, output.target)
      return { ...staging, parent: output.parent, target: output.target, expectedFiles: new Set() }
    } catch (error) {
      try { rmSync(candidate, { recursive: true, force: true }) } catch {}
      throw error
    }
  }
  fail("could not create a private staging directory")
}

export function revalidatePrivateStaging(staging) {
  revalidateDirectory(staging.parent, "output parent")
  assertTargetAbsent(staging.parent, staging.target)
  const current = revalidateDirectory(staging, "private staging directory")
  if (!samePath(dirname(current.canonical), staging.parent.canonical)) fail("private staging directory escaped its parent")
  return staging
}

function assertPrivateFiles(directory, expectedFiles, label) {
  const actual = readdirSync(directory).sort()
  const expected = [...expectedFiles].sort()
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    fail(`${label} contains unexpected files`)
  }
  for (const name of actual) {
    const file = join(directory, name)
    const listed = lstatSync(file)
    const followed = statSync(file)
    if (listed.isSymbolicLink() || !followed.isFile() || followed.nlink !== 1 || directoryIdentity(listed) !== directoryIdentity(followed)) {
      fail(`${label} contains a symlink, junction, or hard-linked file: ${file}`)
    }
  }
}

export function exclusiveWriteFile(staging, fileName, content) {
  safeOutputName(fileName)
  revalidatePrivateStaging(staging)
  const target = resolve(staging.canonical, fileName)
  if (!samePath(dirname(target), staging.canonical)) fail(`output escapes private staging: ${fileName}`)
  try {
    lstatSync(target)
    fail(`refusing to overwrite existing staged output: ${target}`)
  } catch (error) {
    if (!(error && error.code === "ENOENT")) throw error
  }

  let descriptor
  try {
    descriptor = openSync(target, "wx", 0o600)
    writeFileSync(descriptor, content)
    const opened = fstatSync(descriptor)
    if (!opened.isFile() || opened.nlink !== 1) fail(`unsafe staged output file: ${target}`)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }

  const listed = lstatSync(target)
  const followed = statSync(target)
  if (listed.isSymbolicLink() || !followed.isFile() || followed.nlink !== 1 || directoryIdentity(listed) !== directoryIdentity(followed)) {
    try { unlinkSync(target) } catch {}
    fail(`staged output became a link or changed during capture: ${target}`)
  }
  staging.expectedFiles.add(fileName)
  revalidatePrivateStaging(staging)
  return target
}

/** Publishes only a fully validated staging directory, with no overwrite path. */
export function publishPrivateStaging(staging) {
  revalidatePrivateStaging(staging)
  assertPrivateFiles(staging.canonical, staging.expectedFiles, "private staging directory")
  assertTargetAbsent(staging.parent, staging.target)
  const expectedIdentity = staging.identity
  renameSync(staging.canonical, staging.target)
  const target = canonicalDirectory(staging.target, "published output directory")
  if (target.identity !== expectedIdentity || !samePath(dirname(target.canonical), staging.parent.canonical)) {
    fail("published output directory changed during atomic rename")
  }
  revalidateDirectory(staging.parent, "output parent")
  assertPrivateFiles(target.canonical, staging.expectedFiles, "published output directory")
  return { ...target, parent: staging.parent, expectedFiles: staging.expectedFiles }
}

export function revalidatePublishedOutput(publication) {
  revalidateDirectory(publication.parent, "output parent")
  const current = revalidateDirectory(publication, "published output directory")
  if (!samePath(dirname(current.canonical), publication.parent.canonical)) fail("published output directory escaped its parent")
  assertPrivateFiles(current.canonical, publication.expectedFiles, "published output directory")
  return publication
}

export function discardPrivateStaging(staging) {
  revalidatePrivateStaging(staging)
  rmSync(staging.canonical, { recursive: true, force: false })
}

/** Removes only the publication whose identity and contents still match ours. */
export function removePublishedOutput(publication) {
  revalidatePublishedOutput(publication)
  rmSync(publication.canonical, { recursive: true, force: false })
  try {
    lstatSync(publication.canonical)
  } catch (error) {
    if (error && error.code === "ENOENT") return
    throw error
  }
  fail(`published output could not be removed: ${publication.canonical}`)
}

function runGit(appRoot, argumentsList, runner = execFileSync) {
  return String(runner("git", ["-C", appRoot, ...argumentsList], { encoding: "utf8" })).trim()
}

export function readGitState(appRoot, runner = execFileSync) {
  return {
    head: runGit(appRoot, ["rev-parse", "HEAD"], runner),
    dirty: runGit(appRoot, ["status", "--porcelain", "--untracked-files=all"], runner) !== ""
  }
}

export function assertCleanGitState(state, expectedHead) {
  if (state.dirty) fail("final capture requires a clean Git worktree")
  if (expectedHead !== undefined && state.head !== expectedHead) fail("Git HEAD changed during final capture")
  return state.head
}

export function listGitWorktrees(appRoot, runner = execFileSync) {
  const output = runGit(appRoot, ["worktree", "list", "--porcelain"], runner)
  const paths = output.split(/\r?\n/u)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
  if (paths.length === 0) fail("Git did not report a worktree")
  return paths
}

function finite(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${name} must be finite`)
  return value
}

function exact(value, expected, name) {
  if (Math.abs(finite(value, name) - expected) > 0.02) fail(`${name} must be ${expected}, received ${value}`)
}

function hasText(metrics, expected) {
  const text = `${String(metrics.rootText ?? "")} ${Array.isArray(metrics.textOutputs) ? metrics.textOutputs.join(" ") : ""}`
  if (!text.includes(expected)) fail(`capture text is missing ${expected}`)
}

const RC01_LED_COLORS = [
  "rgb(0, 217, 255)", "rgb(0, 217, 255)", "rgb(0, 217, 255)",
  "rgb(0, 230, 118)", "rgb(0, 230, 118)", "rgb(0, 230, 118)",
  "rgb(255, 179, 0)", "rgb(255, 179, 0)", "rgb(255, 179, 0)",
  "rgb(255, 59, 48)", "rgb(255, 59, 48)"
]

const APP_LED_RECTS = [
  { left: 24, width: 80.734375 }, { left: 113.515625, width: 80.75 },
  { left: 203.046875, width: 80.734375 }, { left: 292.5625, width: 80.75 },
  { left: 382.09375, width: 80.734375 }, { left: 471.609375, width: 80.75 },
  { left: 561.140625, width: 80.734375 }, { left: 650.65625, width: 80.75 },
  { left: 740.1875, width: 80.75 }, { left: 829.71875, width: 80.75 },
  { left: 919.25, width: 80.75 }
]

function assertLeds(metrics, size) {
  if (!Array.isArray(metrics.leds) || metrics.leds.length !== 11) fail("RC-01 capture requires exactly 11 LEDs")
  for (let index = 0; index < metrics.leds.length; index += 1) {
    const led = metrics.leds[index]
    const native = size.width === 800
    const appRect = APP_LED_RECTS[index]
    const expectedLeft = native ? 52 + index * 64 : appRect.left
    const expectedTop = native ? 16 : 14
    const expectedWidth = native ? 56 : appRect.width
    const expectedHeight = native ? 20 : 32
    exact(led.left, expectedLeft, `LED ${index + 1} left`)
    exact(led.top, expectedTop, `LED ${index + 1} top`)
    exact(led.width, expectedWidth, `LED ${index + 1} width`)
    exact(led.height, expectedHeight, `LED ${index + 1} height`)
    if (!led.active || led.color !== RC01_LED_COLORS[index]) fail(`LED ${index + 1} color or active state is wrong`)
  }
}

export function validateCaptureMetrics(metrics, size) {
  if (!metrics || typeof metrics !== "object") fail("missing capture metrics")
  exact(metrics.viewport.width, size.width, "viewport width")
  exact(metrics.viewport.height, size.height, "viewport height")
  exact(metrics.viewport.dpr, 1, "viewport device pixel ratio")
  exact(metrics.root.width, size.width, "capture root width")
  exact(metrics.root.height, size.height, "capture root height")
  exact(metrics.shell.width, size.width, "dashboard shell width")
  exact(metrics.shell.height, size.height, "dashboard shell height")
  exact(metrics.canvas.layoutWidth, 1024, "dashboard canvas authored width")
  exact(metrics.canvas.layoutHeight, 600, "dashboard canvas authored height")
  exact(metrics.canvas.width, size.width, "dashboard canvas physical width")
  exact(metrics.canvas.height, size.height, "dashboard canvas physical height")
  exact(metrics.canvas.left, 0, "dashboard canvas left")
  exact(metrics.canvas.top, 0, "dashboard canvas top")
  exact(metrics.dashboardElement.layoutWidth, 1024, "dashboard element authored width")
  exact(metrics.dashboardElement.layoutHeight, 600, "dashboard element authored height")
  exact(metrics.dashboardElement.width, size.width, "dashboard element physical width")
  exact(metrics.dashboardElement.height, size.height, "dashboard element physical height")
  exact(metrics.widget.layoutWidth, 1024, "widget authored width")
  exact(metrics.widget.layoutHeight, 600, "widget authored height")
  exact(metrics.widget.width, size.width, "widget physical width")
  exact(metrics.widget.height, size.height, "widget physical height")
  if (metrics.presetId !== "racecon_rc01_dash" || metrics.expectedWidgetId !== "raceconRc01Dash" || metrics.renderedWidgetId !== "raceconRc01Dash") {
    fail("capture did not resolve the unmodified RC-01 preset through DashboardCanvas")
  }
  if (metrics.dashboardWidth !== "1024" || metrics.dashboardHeight !== "600") fail("capture resized the built dashboard preset")
  if (metrics.sourceKind !== "live-telemetry" || metrics.sourceIdentity !== "acc:session:74001:connection:12" || metrics.bufferState !== "accepted") {
    fail("capture did not accept the deterministic connected live telemetry fixture")
  }
  if (metrics.errorBoundaryCount !== 0 || metrics.unknownWidgetCount !== 0 || (metrics.failures && metrics.failures.length) || (metrics.pageErrors && metrics.pageErrors.length) || (metrics.consoleErrors && metrics.consoleErrors.length)) {
    fail("capture reported a render error, error boundary, unknown widget, or console error")
  }
  if (!Array.isArray(metrics.textOutputs) || JSON.stringify(metrics.textOutputs) !== JSON.stringify(["278", "6", "9,600", "-0.216 S"])) {
    fail("capture output text does not match the live RC-01 fixture")
  }
  if (/\b(?:NaN|undefined|Infinity)\b/u.test(String(metrics.rootText))) fail("capture text contains an invalid numeric token")
  for (const expected of ["SPEED", "278", "9,600", "TC", "P02", "42.5 L", "85°", "87°", "89°", "91°", "-0.216 S"]) hasText(metrics, expected)

  const expectedScaleX = size.width / 1024
  const expectedScaleY = size.height / 600
  exact(metrics.canvas.transform.a, expectedScaleX, "dashboard canvas scale X")
  exact(metrics.canvas.transform.d, expectedScaleY, "dashboard canvas scale Y")
  exact(metrics.canvas.transform.b, 0, "dashboard canvas skew Y")
  exact(metrics.canvas.transform.c, 0, "dashboard canvas skew X")
  exact(metrics.canvas.transform.e, 0, "dashboard canvas translation X")
  exact(metrics.canvas.transform.f, 0, "dashboard canvas translation Y")

  if (size.width === 800) {
    if (metrics.layout !== "native" || metrics.nativeSize !== "800x480" || metrics.contentWidth !== "800" || metrics.contentHeight !== "480") {
      fail("800x480 capture did not select the native content-box modifier")
    }
    if (!metrics.appRail || metrics.appRail.display !== "none") fail("native RC-01 capture must not show the app attack rail")
  } else {
    if (metrics.layout !== "app" || metrics.nativeSize !== null || metrics.contentWidth !== "1024" || metrics.contentHeight !== "600") {
      fail("1024x600 capture did not select the app content-box modifier")
    }
    if (!metrics.appRail || metrics.appRail.display !== "flex") fail("1024x600 capture is missing the app attack rail")
    exact(metrics.appRail.left, 896, "app attack rail left")
    exact(metrics.appRail.top, 96, "app attack rail top")
    exact(metrics.appRail.width, 112, "app attack rail width")
    exact(metrics.appRail.height, 410, "app attack rail height")
  }
  assertLeds(metrics, size)
  return true
}
