import { type CSSProperties, type ReactElement, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEVICES_CHANNELS,
  type DeviceProfile,
  type RgbMatrixComponent
} from '../../../../shared/devices'
import {
  MATRIX_ROTATIONS,
  RGB_MATRIX_EFFECT_CATALOG,
  RGB_MATRIX_GROUP_CATALOG,
  RGB_MATRIX_FULL_BRIGHTNESS,
  RGB_MATRIX_SIZE,
  RGB_MATRIX_SPECIAL_CATALOG,
  RGB_MATRIX_STATUS_LED_CATALOG,
  FLAG_NAMES,
  GEAR_LABELS,
  applyBlinkPhase,
  buildFlagHexGrid,
  buildGearGlyphHexGrid,
  createAnimationFrame,
  createEffectAnimation,
  createRgbMatrixEffect,
  createRgbMatrixGroup,
  createRgbMatrixStatusLed,
  defaultFlagCustomPatterns,
  defaultGearCustomGlyphs,
  defaultMatrixLayout,
  defaultRgbMatrixProfile,
  emptyMatrixHexGrid,
  ensureUniqueEffectPriorities,
  withEffectOnTop,
  isValidCustomMap,
  isValidHexGrid,
  renderMatrixFrame,
  rgbToHex,
  selectAnimationFrame,
  wireLayoutByte,
  type FlagName,
  type GearLabel,
  type MatrixLayout,
  type MatrixRotation,
  type MatrixTestMode,
  type RgbAnimationFrame,
  type RgbAnimationLoopMode,
  type RgbEffectAnimation,
  type RgbMatrixAnimationEffect,
  type RgbMatrixCatalogItem,
  type RgbMatrixCondition,
  type RgbMatrixEffect,
  type RgbMatrixEffectBase,
  type RgbMatrixEffectColors,
  type RgbMatrixFlagsEffect,
  type RgbMatrixFlagMode,
  type RgbMatrixGearEffect,
  type RgbMatrixProfile,
  type RgbMatrixStatusLedEffect,
  type RgbMatrixStatusLedId
} from '../../../../shared/rgb-matrix'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { Field, NumberField, SelectField, Slider, TextField, Toggle } from '../hub/controls'
import type { SelectOption } from '../hub/controls'
import { ACCENT_BORDER, ACCENT_SOFT, buttonStyle, card, getErrorMessage, helper, input, label, panel } from '../hub/styles'
import { SectionExportImport } from '../../components/SectionExportImport'

type ArduinoMode = 'disabled' | 'single' | 'multiple'
type ToastVariant = 'success' | 'error' | 'info'
type PaintMode = 'paint' | 'erase'

interface MatrixTarget {
  key: string
  profileId: string
  componentId: string
  profileLabel: string
  componentLabel: string
  component: RgbMatrixComponent
}

export interface RgbMatrixWorkspaceProps {
  showToast(message: string, variant?: ToastVariant): void
  mode?: ArduinoMode
}

const CHANNELS = {
  getProfile: 'rgbmatrix:getProfile',
  setProfile: 'rgbmatrix:setProfile',
  setLayout: 'rgbmatrix:setLayout',
  calibrate: 'rgbmatrix:calibrate',
  testMapped: 'rgbmatrix:testMapped',
  lightPhysical: 'rgbmatrix:lightPhysical',
  resume: 'rgbmatrix:resume',
  previewFrame: 'rgbmatrix:previewFrame'
} as const

// Effect edits (add/remove/reorder/recolor/brightness/rotation/pixel-paint/mode)
// auto-apply LIVE to the panel: after the last keystroke/click we debounce a
// single `rgbmatrix:setProfile` push (which both PERSISTS the profile and drives
// the device via the broadcast→tick→driveMatrix chain). This mirrors how layout
// edits already auto-apply through `setLayout`, so the user no longer has to
// click "Save profile" for the panel to update. The debounce coalesces rapid
// edits into one IPC call; the main module additionally dedups identical serial
// frames, so this never spams the wire.
const AUTO_APPLY_DEBOUNCE_MS = 300

// Live paint preview: while painting a pixel/frame we throttle a push of the
// ACTIVE edited grid to the physical iFlag so the editor is WYSIWYG on the panel.
// Kept short (within 80–150ms) so the panel tracks the brush, with the latest
// grid coalesced into one push per window so we never spam the serial port.
const PREVIEW_PUSH_MS = 120

// Threaded to the per-pixel paint editors so painting a frame mirrors it live on
// the device. Default is a no-op so the editors stay usable outside this view /
// in tests. Receives the active 8×8 hex grid the user is currently painting.
const PreviewFrameContext = createContext<(grid: string[][]) => void>(() => {})

const STATUS_OPTIONS: ReadonlyArray<SelectOption<RgbMatrixStatusLedId>> = RGB_MATRIX_STATUS_LED_CATALOG.map((entry) => ({
  value: entry.status,
  label: entry.label
}))

const CONDITION_OPTIONS: ReadonlyArray<SelectOption<RgbMatrixCondition['kind']>> = [
  { value: 'gameRunning', label: 'Game running' },
  { value: 'gameNotRunning', label: 'Game not running' },
  { value: 'inPitLane', label: 'Car in pit lane' },
  { value: 'speedLimiter', label: 'Speed limiter ON' },
  { value: 'brakePressed', label: 'Brake pressed' },
  { value: 'formulaTrue', label: 'Formula true' },
  { value: 'selectedCarModel', label: 'Selected car model' },
  { value: 'selectedGames', label: 'Selected games' },
  { value: 'special', label: 'Special wrapper' }
]

const rootGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(280px, 0.8fr) minmax(460px, 1.2fr)',
  gap: 18,
  alignItems: 'start'
}

const matrixSurface: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: `repeat(${RGB_MATRIX_SIZE}, 24px)`,
  gap: 4,
  padding: 14,
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-base)',
  border: '1px solid rgba(255,255,255,0.12)',
  width: 'fit-content'
}

const rowStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap'
}

// Honest, non-blocking hint shown when a live paint preview couldn't reach the
// physical panel (COM intermittently absent). Warm amber — it's a "not connected
// yet" chrome cue, never a cool good/connected colour.
const previewHintStyle: CSSProperties = {
  margin: '10px 0 0',
  padding: '6px 10px',
  borderRadius: 'var(--radius-sm)',
  fontSize: 12,
  lineHeight: 1.3,
  color: '#F2B765',
  background: 'rgba(214, 138, 51, 0.12)',
  border: '1px solid rgba(214, 138, 51, 0.35)'
}

function keyFor(deviceId?: string, componentId?: string): string {
  return `${deviceId ?? 'default'}:${componentId ?? 'rgbMatrix'}`
}

function matrixTargetsFromProfiles(profiles: DeviceProfile[]): MatrixTarget[] {
  return profiles.flatMap((profile) =>
    profile.components
      .filter((component): component is RgbMatrixComponent => component.type === 'rgbMatrix')
      .map((component) => ({
        key: keyFor(profile.id, component.id),
        profileId: profile.id,
        componentId: component.id,
        profileLabel: profile.label,
        componentLabel: component.label,
        component
      }))
  )
}

function mockTelemetry(timeMs: number): TelemetrySnapshot {
  const phase = Math.floor(timeMs / 1800) % 8
  return {
    sim: 'mock',
    connected: phase !== 7,
    timestamp: timeMs,
    speedKmh: 137,
    rpm: phase > 4 ? 7800 : 4200,
    gear: phase % 6,
    maxRpm: 8000,
    shiftIndicatorPct: phase > 4 ? 0.99 : 0.52,
    throttle: 0.72,
    brake: phase === 3 ? 0.8 : 0,
    clutch: 0,
    drs: phase === 5,
    absActive: phase === 3,
    tcActive: phase === 4,
    fuelLiters: phase === 6 ? 3.2 : 22,
    fuelCapacityLiters: 60,
    pitLimiter: phase === 2,
    onPitRoad: phase === 2,
    flags: {
      green: phase === 0,
      yellow: phase === 1,
      blue: phase === 4,
      white: false,
      checkered: phase === 6,
      red: false,
      black: false,
      meatball: false,
      repair: false,
      disqualify: false,
      greenWhiteCheckered: false
    }
  }
}

export default function RgbMatrixWorkspace({
  showToast,
  mode = 'multiple'
}: RgbMatrixWorkspaceProps): ReactElement {
  const [targets, setTargets] = useState<MatrixTarget[]>([])
  const [targetKey, setTargetKey] = useState<string | null>(null)
  const activeTarget = useMemo(
    () => (targetKey ? targets.find((target) => target.key === targetKey) ?? null : targets[0] ?? null),
    [targetKey, targets]
  )
  const profileKey = activeTarget?.key ?? keyFor()
  const [profile, setProfile] = useState<RgbMatrixProfile>(defaultRgbMatrixProfile)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [layoutBusy, setLayoutBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [timeMs, setTimeMs] = useState(Date.now())

  // Latest profile + pending auto-apply timer, used by the debounced live push.
  // profileRef always mirrors `profile` so the debounced callback reads the most
  // recent edits; the timer ref lets us coalesce/cancel pending pushes.
  const profileRef = useRef(profile)
  const autoApplyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    profileRef.current = profile
  }, [profile])

  // Live paint preview plumbing. previewTimer throttles pushes; previewPending
  // holds the latest grid to coalesce a burst of paint events into one push; and
  // previewDisconnected drives an honest, non-blocking "connect the iFlag" hint
  // when a push couldn't reach a live device (COM intermittently absent).
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewPending = useRef<string[][] | null>(null)
  const [previewDisconnected, setPreviewDisconnected] = useState(false)

  function cancelAutoApply(): void {
    if (autoApplyTimer.current) {
      clearTimeout(autoApplyTimer.current)
      autoApplyTimer.current = null
    }
  }

  // If a debounced push is still pending, send it NOW for `key` (used when the
  // editor unmounts or the target switches within the debounce window, so the
  // last edits aren't dropped).
  function flushAutoApply(key: string): void {
    if (!autoApplyTimer.current) return
    clearTimeout(autoApplyTimer.current)
    autoApplyTimer.current = null
    void window.ipc.invoke<RgbMatrixProfile>(CHANNELS.setProfile, key, profileRef.current).catch(() => {
      // Best-effort flush; the next mount reloads the persisted profile.
    })
  }

  // Debounce a single live `setProfile` push for the active matrix key. This both
  // persists and drives the panel, so effect edits take effect without a manual
  // Save. We capture the key at schedule time; switching targets flushes any
  // pending push (see the load effect cleanup) so we never write to the wrong key.
  function scheduleAutoApply(): void {
    const key = profileKey
    cancelAutoApply()
    autoApplyTimer.current = setTimeout(() => {
      autoApplyTimer.current = null
      const snapshot = profileRef.current
      void window.ipc
        .invoke<RgbMatrixProfile>(CHANNELS.setProfile, key, snapshot)
        .then(() => {
          // Only flip the indicator to "saved" if no further edit landed while
          // the push was in flight (each edit replaces the profile object).
          if (profileRef.current === snapshot) setDirty(false)
        })
        .catch((error) => {
          showToast(getErrorMessage(error), 'error')
        })
    }, AUTO_APPLY_DEBOUNCE_MS)
  }

  // Throttle-push the ACTIVE painted grid to the physical iFlag for a live WYSIWYG
  // preview. Called from the per-pixel paint handlers, so it MUST NEVER throw —
  // any failure is swallowed and only flips the "connect the iFlag" hint. The
  // latest grid is coalesced into one push per PREVIEW_PUSH_MS window so a drag
  // never floods the serial port. The main module holds off normal frames while
  // previewing and restores the live image when we call resume on exit.
  function pushPreviewFrame(grid: string[][]): void {
    try {
      previewPending.current = grid
      if (previewTimer.current) return
      const key = profileKey
      previewTimer.current = setTimeout(() => {
        previewTimer.current = null
        const next = previewPending.current
        previewPending.current = null
        if (!next) return
        void window.ipc
          .invoke<boolean>(CHANNELS.previewFrame, key, next)
          .then((sent) => setPreviewDisconnected(!sent))
          .catch(() => setPreviewDisconnected(true))
      }, PREVIEW_PUSH_MS)
    } catch {
      // Preview is best-effort; it must never break the paint interaction.
    }
  }

  function cancelPreview(): void {
    if (previewTimer.current) {
      clearTimeout(previewTimer.current)
      previewTimer.current = null
    }
    previewPending.current = null
  }

  useEffect(() => {
    const timer = window.setInterval(() => setTimeMs(Date.now()), 80)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let active = true
    const loadTargets = async (): Promise<void> => {
      try {
        const profiles = await window.ipc.invoke<DeviceProfile[]>(DEVICES_CHANNELS.list)
        if (!active) return
        const nextTargets = matrixTargetsFromProfiles(profiles)
        setTargets(nextTargets)
        setTargetKey((current) => {
          if (current && nextTargets.some((target) => target.key === current)) return current
          return nextTargets[0]?.key ?? null
        })
      } catch (error) {
        if (active) showToast(getErrorMessage(error), 'error')
      }
    }
    void loadTargets()
    const off = window.ipc.subscribe<DeviceProfile[]>(DEVICES_CHANNELS.changed, (profiles) => {
      const nextTargets = matrixTargetsFromProfiles(profiles)
      setTargets(nextTargets)
      setTargetKey((current) => {
        if (current && nextTargets.some((target) => target.key === current)) return current
        return nextTargets[0]?.key ?? null
      })
    })
    return () => {
      active = false
      off()
    }
  }, [showToast])

  useEffect(() => {
    let active = true
    setBusy(true)
    void window.ipc
      .invoke<RgbMatrixProfile>(CHANNELS.getProfile, profileKey)
      .then((loaded) => {
        if (!active) return
        setProfile(loaded)
        setSelectedId(findFirstEffectId(loaded.effects))
        setDirty(false)
      })
      .catch(() => {
        if (!active) return
        const fallback = defaultRgbMatrixProfile()
        setProfile(fallback)
        setSelectedId(findFirstEffectId(fallback.effects))
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
      // Flush any pending live push for THIS key before the next target loads,
      // so edits made just before switching (or unmount) aren't lost.
      flushAutoApply(profileKey)
    }
  }, [profileKey])

  // Never let the "Add effect" modal linger when the active matrix target
  // switches (e.g. a device-registry hot-plug re-render picks a new profile):
  // a backdrop tied to a stale target would otherwise keep blocking input.
  useEffect(() => {
    setAddOpen(false)
  }, [profileKey])

  const telemetry = useMemo(() => mockTelemetry(timeMs), [timeMs])
  // SINGLE SOURCE OF TRUTH + customMap independence: the live preview (and the
  // effect stack it mirrors) are ALWAYS computed from the composed logical image
  // — renderMatrixFrame(profile, telemetry, timeMs) — which already honours each
  // effect's per-effect rotation/brightness. A manual customMap (or serpentine/
  // rotation) is a WIRING concern only: it re-orders pixels on their way to the
  // physical panel, but must NEVER gate, blank, or disable the effect stack or
  // this preview. Only the wiring controls in the calibration wizard are locked
  // while a custom map is active. This keeps the editor working after the user
  // saves a customMap (previously it appeared to "stop working").
  const frame = useMemo(() => renderMatrixFrame(profile, telemetry, timeMs), [profile, telemetry, timeMs])
  const selected = useMemo(() => (selectedId ? findEffect(profile.effects, selectedId) : null), [profile.effects, selectedId])

  function replaceEffects(nextEffects: RgbMatrixEffect[]): void {
    setProfile((current) => ({ ...current, effects: nextEffects }))
    setDirty(true)
    scheduleAutoApply()
  }

  function updateEffect(effectId: string, updater: (effect: RgbMatrixEffect) => RgbMatrixEffect): void {
    replaceEffects(updateEffectTree(profile.effects, effectId, updater))
  }

  function addEffect(effect: RgbMatrixEffect): void {
    // A newly-added effect lands ON TOP (priority 0, overrides all); existing
    // siblings shift down. Deterministic whether or not the profile was normalised.
    replaceEffects(withEffectOnTop(profile.effects, effect))
    setSelectedId(effect.id)
    setAddOpen(false)
  }

  function removeEffect(effectId: string): void {
    const next = removeEffectTree(profile.effects, effectId)
    replaceEffects(next)
    setSelectedId(findFirstEffectId(next))
  }

  // Change an effect's UNIQUE priority by SWAPPING it with the adjacent sibling in
  // priority order (direction -1 = up/toward priority 0 = top; +1 = down). Swapping
  // two values keeps the sibling set unique; the stored array order is untouched.
  function changePriority(effectId: string, direction: -1 | 1): void {
    replaceEffects(changePriorityTree(profile.effects, effectId, direction))
  }

  async function save(): Promise<void> {
    cancelAutoApply()
    setBusy(true)
    try {
      const saved = await window.ipc.invoke<RgbMatrixProfile>(CHANNELS.setProfile, profileKey, profile)
      setProfile(saved)
      setDirty(false)
      showToast('RGB Matrix profile saved.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function reloadProfile(): Promise<void> {
    cancelAutoApply()
    setBusy(true)
    try {
      const loaded = await window.ipc.invoke<RgbMatrixProfile>(CHANNELS.getProfile, profileKey)
      setProfile(loaded)
      setSelectedId(findFirstEffectId(loaded.effects))
      setDirty(false)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  // Persist + push a layout to the live iFlag in one shot. Returns whether a
  // device actually received it so the wizard can re-fire the active test and
  // surface an honest "connect the device" hint. Keeps the page-level preview
  // and Save payload in sync via setProfile.
  async function commitLayout(next: MatrixLayout): Promise<boolean> {
    setProfile((current) => ({ ...current, layout: next }))
    setLayoutBusy(true)
    try {
      const result = await window.ipc.invoke<{ profile: RgbMatrixProfile; sent: boolean }>(
        CHANNELS.setLayout,
        profileKey,
        next
      )
      return result.sent
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
      return false
    } finally {
      setLayoutBusy(false)
    }
  }

  async function fireCalibration(calibMode: 0 | 1 | 2 | 3): Promise<boolean> {
    try {
      return await window.ipc.invoke<boolean>(CHANNELS.calibrate, profileKey, calibMode)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
      return false
    }
  }

  async function lightPhysical(physicalIndex: number): Promise<boolean> {
    try {
      return await window.ipc.invoke<boolean>(CHANNELS.lightPhysical, profileKey, physicalIndex)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
      return false
    }
  }

  async function testMapped(testMode: MatrixTestMode): Promise<boolean> {
    try {
      return await window.ipc.invoke<boolean>(CHANNELS.testMapped, profileKey, testMode)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
      return false
    }
  }

  // Clear any test/calibration hold and repaint the live image. Fired when the
  // user leaves a test and on unmount / target switch so the panel is never left
  // "preso no teste".
  async function resumeMatrix(key: string): Promise<void> {
    try {
      await window.ipc.invoke<boolean>(CHANNELS.resume, key)
    } catch {
      // Best-effort: the next steady tick repaints anyway.
    }
  }

  // On unmount or when switching matrix targets, push a fresh live/clear frame to
  // the matrix we were editing so a lingering test pattern is cleared promptly.
  useEffect(() => {
    return () => {
      cancelPreview()
      void resumeMatrix(profileKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey])

  // Switching matrix targets clears the stale "connect the iFlag" hint so it
  // reflects the newly selected panel, not the previous one.
  useEffect(() => {
    setPreviewDisconnected(false)
  }, [profileKey])

  return (
    <section style={rootGrid}>
      <article style={panel}>
        <div style={{ ...rowStyle, justifyContent: 'space-between' }}>
          <div>
            <span style={label}>RGB Matrix · iFlag 8×8</span>
            <h3 style={{ margin: '4px 0 0' }}>Effect stack</h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <SectionExportImport sectionId="rgb-matrix" label="RGB matrix (iFlag)" onImported={() => void reloadProfile()} />
            <button type="button" style={buttonStyle('primary')} disabled={mode === 'disabled'} onClick={() => setAddOpen(true)}>
              Add effect
            </button>
          </div>
        </div>
        <p style={helper}>
          Stack effects and conditional groups like SimHub. Cada efeito tem uma prioridade ÚNICA: a 0 fica por cima (sobrepõe todas), a 1 sobre a 2, etc. A lista é exibida em ordem de prioridade (0 no topo).
        </p>
        <TargetSelector
          targets={targets}
          selectedKey={activeTarget?.key ?? null}
          onSelect={setTargetKey}
        />
        <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          {orderByPriorityForDisplay(profile.effects).map(({ effect, priority }, displayIndex, ordered) => (
            <EffectStackItem
              key={effect.id}
              effect={effect}
              depth={0}
              selectedId={selectedId}
              priority={priority}
              canMoveUp={displayIndex > 0}
              canMoveDown={displayIndex < ordered.length - 1}
              onSelect={setSelectedId}
              onChangePriority={changePriority}
              onRemove={removeEffect}
              onToggle={(id, enabled) => updateEffect(id, (entry) => ({ ...entry, enabled }))}
            />
          ))}
        </div>
        <div style={{ ...rowStyle, marginTop: 16 }}>
          <button type="button" style={buttonStyle('primary')} disabled={!dirty || busy} onClick={() => void save()}>
            Save profile
          </button>
          <button
            type="button"
            style={buttonStyle('ghost')}
            disabled={busy}
            onClick={() => {
              const next = defaultRgbMatrixProfile()
              setProfile(next)
              setSelectedId(findFirstEffectId(next.effects))
              setDirty(true)
              scheduleAutoApply()
            }}
          >
            Reset
          </button>
          <span style={helper}>{dirty ? 'Unsaved changes' : 'Profile saved'} · key {profileKey}</span>
        </div>
      </article>

      <article style={panel}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, auto) 1fr', gap: 18, alignItems: 'start' }}>
          <div>
            <span style={label}>Live preview</span>
            <MatrixFrameView frame={frame} />
            <p style={helper}>
              Mock telemetry cycles flags, brake, pit limiter, DRS, TC and redline so stacking can be verified without a sim.
            </p>
            {previewDisconnected ? (
              <p style={previewHintStyle}>Conecte o iFlag (COM) para ver o preview ao vivo</p>
            ) : null}
          </div>
          {selected ? (
            <PreviewFrameContext.Provider value={pushPreviewFrame}>
              <EffectEditor
                effect={selected}
                onChange={(next) => updateEffect(selected.id, () => next)}
                onAddChild={(parentId, child) => {
                  updateEffect(parentId, (entry) =>
                    entry.kind === 'group' ? { ...entry, effects: withEffectOnTop(entry.effects, child) } : entry
                  )
                  setSelectedId(child.id)
                }}
              />
            </PreviewFrameContext.Provider>
          ) : (
            <div style={card}>
              <span style={label}>No effect selected</span>
              <p style={helper}>Add or select an effect to edit its position, colors, behavior and animation frames.</p>
            </div>
          )}
        </div>
      </article>

      <MatrixCalibrationWizard
        layout={profile.layout}
        onCommitLayout={commitLayout}
        onFireTest={fireCalibration}
        onLightPhysical={lightPhysical}
        onTestMapped={testMapped}
        onResume={() => void resumeMatrix(profileKey)}
        disabled={mode === 'disabled'}
        busy={busy || layoutBusy}
        hasTarget={targets.length > 0}
        showToast={showToast}
      />

      {addOpen ? (
        <AddEffectDialog
          query={query}
          setQuery={setQuery}
          onClose={() => setAddOpen(false)}
          onAdd={addEffect}
        />
      ) : null}
    </section>
  )
}

const ROTATION_OPTIONS: ReadonlyArray<SelectOption<string>> = MATRIX_ROTATIONS.map((rotation) => ({
  value: String(rotation),
  label: `${rotation}°`
}))

// One-tap rotation cycle: 0 → 90 → 180 → 270 → 0. Used by the "Rotacionar 90°"
// button so the user just taps until the calibration glyph reads upright.
function nextRotation(current: MatrixRotation): MatrixRotation {
  const idx = MATRIX_ROTATIONS.indexOf(current)
  return MATRIX_ROTATIONS[(idx + 1) % MATRIX_ROTATIONS.length]
}

// ─── Calibration wizard (iFlag physical mapping) ─────────────────────────────

type CalibMode = 0 | 1 | 2 | 3
const CALIB_OFF = '#0b0b12'
const CALIB_WHITE = '#ffffff'
const CALIB_RED = '#ff3340'
const CALIB_BLUE = '#3a86ff'

// Same asymmetric "F" the firmware lights for T3 (companion_iflag.ino,
// CALIB_GLYPH_F). Row-major, MSB = logical column 0. Asymmetric on BOTH axes so
// any mirror / rotation / serpentine scramble is obvious at a glance.
const CALIB_F_ROWS = [0x7c, 0x60, 0x60, 0x78, 0x60, 0x60, 0x60, 0x00]

interface CalibTest {
  mode: CalibMode
  label: string
  // What the user must see ON THE PHYSICAL PANEL when the layout is correct.
  expect: string
}

const CALIB_TESTS: ReadonlyArray<CalibTest> = [
  { mode: 0, label: 'Canto (0,0)', expect: 'Apenas 1 pixel aceso no canto SUPERIOR-ESQUERDO do painel.' },
  { mode: 1, label: 'Linha 0', expect: 'Uma linha horizontal vermelha no TOPO (de ponta a ponta).' },
  { mode: 2, label: 'Coluna 0', expect: 'Uma linha vertical azul à ESQUERDA (de cima a baixo).' },
  { mode: 3, label: 'Letra “F”', expect: 'Um “F” branco, legível e em pé (teste decisivo).' }
]

// Always-available panel tests, rendered app-side THROUGH the active mapping
// (customMap or firmware layout) and streamed in one frame — so they confirm the
// panel + a saved manual map even when the layout wizard is locked.
const MAPPED_TESTS: ReadonlyArray<{ mode: MatrixTestMode; label: string }> = [
  { mode: 'all', label: 'Painel branco' },
  { mode: 'f', label: 'Letra “F”' },
  { mode: 'corner', label: 'Canto (0,0)' },
  { mode: 'row', label: 'Linha 0' },
  { mode: 'col', label: 'Coluna 0' }
]

// Content tests that exercise the REAL telemetry visuals (race flags + the gear
// digit) through the SAME mapping path — so the user can confirm flags and the
// gear marker render correctly on the panel without opening the simulator.
const MAPPED_CONTENT_TESTS: ReadonlyArray<{ mode: MatrixTestMode; label: string }> = [
  { mode: 'flag-green', label: 'Flag verde' },
  { mode: 'flag-yellow', label: 'Flag amarela' },
  { mode: 'flag-blue', label: 'Flag azul' },
  { mode: 'flag-white', label: 'Flag branca' },
  { mode: 'flag-checkered', label: 'Quadriculada' },
  { mode: 'gear', label: 'Marcha “3”' }
]

// The LOGICAL image each calibration pattern represents — i.e. exactly what the
// app sends and what a correctly-mapped panel must mirror. Mirrors the firmware
// `calibration()` shapes so the on-screen grid is a faithful "expected result".
function calibrationLogicalGrid(mode: CalibMode): string[][] {
  const grid: string[][] = []
  for (let y = 0; y < RGB_MATRIX_SIZE; y += 1) grid.push(new Array<string>(RGB_MATRIX_SIZE).fill(CALIB_OFF))
  if (mode === 0) {
    grid[0][0] = CALIB_WHITE
  } else if (mode === 1) {
    for (let x = 0; x < RGB_MATRIX_SIZE; x += 1) grid[0][x] = CALIB_RED
  } else if (mode === 2) {
    for (let y = 0; y < RGB_MATRIX_SIZE; y += 1) grid[y][0] = CALIB_BLUE
  } else {
    for (let y = 0; y < RGB_MATRIX_SIZE; y += 1) {
      const bits = CALIB_F_ROWS[y]
      for (let x = 0; x < RGB_MATRIX_SIZE; x += 1) {
        if (bits & (0x80 >> x)) grid[y][x] = CALIB_WHITE
      }
    }
  }
  return grid
}

function layoutSummary(layout: MatrixLayout): string {
  const parts = [
    `Serpentina ${layout.serpentine ? 'ON' : 'OFF'}`,
    `Rotação ${layout.rotation}°`,
    `FlipX ${layout.flipX ? 'ON' : 'OFF'}`,
    `FlipY ${layout.flipY ? 'ON' : 'OFF'}`
  ]
  if (isValidCustomMap(layout.customMap)) parts.push('Mapa manual ATIVO')
  // The exact byte sent to the firmware (`M<hex>`) — the SINGLE source of panel
  // orientation. Surfacing it makes a 90°/mirror mismatch obvious and verifiable.
  parts.push(`M=${wireLayoutByte(layout).toString(16).padStart(2, '0')}`)
  return parts.join(' · ')
}

// Non-interactive 8×8 grid that renders a hex string[][] image.
function StaticMatrixGrid({ grid, cell = 22 }: { grid: string[][]; cell?: number }): ReactElement {
  return (
    <div style={{ ...matrixSurface, gridTemplateColumns: `repeat(${RGB_MATRIX_SIZE}, ${cell}px)`, gap: 4 }}>
      {grid.flatMap((row, y) =>
        row.map((color, x) => (
          <span
            key={`${x}-${y}`}
            style={{ ...ledStyle(color), width: cell, height: cell, cursor: 'default' }}
            aria-label={`x${x} y${y}`}
          />
        ))
      )}
    </div>
  )
}

function MatrixCalibrationWizard({
  layout,
  onCommitLayout,
  onFireTest,
  onLightPhysical,
  onTestMapped,
  onResume,
  disabled,
  busy,
  hasTarget,
  showToast
}: {
  layout: MatrixLayout
  onCommitLayout(next: MatrixLayout): Promise<boolean>
  onFireTest(mode: CalibMode): Promise<boolean>
  onLightPhysical(physicalIndex: number): Promise<boolean>
  onTestMapped(mode: MatrixTestMode): Promise<boolean>
  onResume(): void
  disabled: boolean
  busy: boolean
  hasTarget: boolean
  showToast(message: string, variant?: ToastVariant): void
}): ReactElement {
  const [activeTest, setActiveTest] = useState<CalibMode>(3)
  const [autoCycle, setAutoCycle] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const actionsDisabled = disabled || busy
  const customActive = isValidCustomMap(layout.customMap)
  const previewGrid = useMemo(() => calibrationLogicalGrid(activeTest), [activeTest])
  // Always points at the LATEST layout. The manual-remap "resume" can fire from an
  // unmount cleanup AFTER a removal commit; reading the ref (not a stale `layout`
  // closure) keeps that resume idempotent so it never re-adds a just-removed map.
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const resumeManualRemap = (): void => {
    setManualOpen(false)
    // Drop the server-side manual-probe hold and resume normal frames without changing the saved map.
    void onCommitLayout(layoutRef.current)
  }

  // Fire a test pattern at the device and remember it as the "current" test so
  // any subsequent layout tweak can re-fire it (see applyLayout below).
  const runTest = async (mode: CalibMode): Promise<void> => {
    setActiveTest(mode)
    const reached = await onFireTest(mode)
    if (!reached) showToast('Nenhum iFlag conectado. Conecte o dispositivo para ver os testes no painel.', 'info')
  }

  // Instant-apply a layout change: persist + push `M<byte>` to the device, then
  // immediately RE-FIRE the active test so the user sees the new mapping live.
  const applyLayout = async (next: MatrixLayout): Promise<void> => {
    const sent = await onCommitLayout(next)
    if (sent && !isValidCustomMap(next.customMap)) {
      // The firmware re-maps the pattern still in its buffer on `M`, but re-fire
      // T anyway so the panel is unambiguous even if frames had resumed.
      await onFireTest(activeTest)
    }
    if (!sent) showToast('Layout salvo no perfil. Conecte o iFlag para enviá-lo ao dispositivo.', 'info')
  }

  // Auto-cycle helper: step through the four tests so the user can eyeball the
  // whole mapping without clicking each one.
  useEffect(() => {
    if (!autoCycle || manualOpen) return
    let order: CalibMode[] = [0, 1, 2, 3]
    let i = order.findIndex((m) => m === activeTest)
    const timer = window.setInterval(() => {
      i = (i + 1) % order.length
      void runTest(order[i])
    }, 2200)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCycle, manualOpen])

  return (
    <article style={{ ...panel, gridColumn: '1 / -1' }}>
      <div style={{ ...rowStyle, justifyContent: 'space-between' }}>
        <div>
          <span style={label}>Calibração da matriz · iFlag 8×8</span>
          <h3 style={{ margin: '4px 0 0' }}>Assistente de mapeamento físico</h3>
        </div>
        <span style={{ ...helper, fontVariantNumeric: 'tabular-nums' }}>Layout ativo: {layoutSummary(layout)}</span>
      </div>
      <p style={helper}>
        Cada teste acende um padrão <strong>inequívoco</strong> no painel <em>através</em> do layout atual. Ajuste os
        4 controles abaixo (aplicação <strong>instantânea</strong>) até o que aparece no seu painel bater com a coluna
        “o que você deve ver”. Comece pela letra <strong>“F”</strong>: é assimétrica nos dois eixos, então qualquer
        espelhamento, rotação ou serpentina trocada fica óbvio.
      </p>

      {/* Always-on panel tests — rendered app-side THROUGH the active mapping
          (customMap or firmware layout) and streamed in ONE frame at a forced
          brightness, so they confirm the panel + a saved manual map even when the
          layout wizard below is locked (and on slow boards). */}
      <div style={{ ...card, marginTop: 6 }}>
        <span style={label}>Testar painel {customActive ? '· via seu mapa manual' : ''}</span>
        <p style={helper}>
          Funciona com ou sem mapa manual e <strong>sem o simulador aberto</strong>. <strong>Painel branco</strong>
          {' '}acende tudo (teste de alimentação/brilho); a <strong>“F”</strong> deve aparecer legível e em pé se o
          mapeamento estiver correto. Os botões de <strong>Flags</strong> e <strong>Marcha</strong> abaixo desenham as
          cores das bandeiras e o dígito da marcha <em>através do seu mapa</em>, no <strong>brilho atual</strong> do
          iFlag (o mesmo da corrida) — é assim que você confirma que as flags e a marcha vão aparecer certas. Se
          ficarem fracas aqui, aumente o brilho do componente. Se aparecerem certas aqui mas <em>não</em> em
          corrida, confira se os efeitos <strong>Flags</strong>/<strong>Marcha</strong> estão ativados e em tela cheia.
        </p>
        <div style={{ ...rowStyle, flexWrap: 'wrap', gap: 8 }}>
          {MAPPED_TESTS.map((t) => (
            <button
              key={t.mode}
              type="button"
              style={buttonStyle('soft')}
              disabled={actionsDisabled || !hasTarget}
              onClick={() => {
                void onTestMapped(t.mode).then((ok) => {
                  if (!ok) showToast('Conecte o iFlag para testar o painel.', 'info')
                })
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span style={{ ...label, marginTop: 10 }}>Conteúdo · Flags &amp; Marcha</span>
        <div style={{ ...rowStyle, flexWrap: 'wrap', gap: 8 }}>
          {MAPPED_CONTENT_TESTS.map((t) => (
            <button
              key={t.mode}
              type="button"
              style={buttonStyle('soft')}
              disabled={actionsDisabled || !hasTarget}
              onClick={() => {
                void onTestMapped(t.mode).then((ok) => {
                  if (!ok) showToast('Conecte o iFlag para testar o painel.', 'info')
                })
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ ...rowStyle, marginTop: 10 }}>
          <button
            type="button"
            style={buttonStyle('ghost')}
            disabled={actionsDisabled || !hasTarget}
            onClick={() => onResume()}
          >
            Retomar imagem ao vivo
          </button>
          <span style={helper}>Encerra o teste e volta a desenhar o conteúdo ao vivo (ou painel apagado).</span>
        </div>
      </div>

      {/* Side-by-side: what the app sends (logical) vs what to look for. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 18, alignItems: 'start', marginTop: 6 }}>
        <div>
          <span style={label}>O app está enviando (lógico)</span>
          <StaticMatrixGrid grid={previewGrid} />
          <p style={{ ...helper, marginTop: 8, maxWidth: 220 }}>
            Esta é a imagem correta. O painel físico deve <strong>espelhar exatamente</strong> esta grade.
          </p>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <span style={label}>O que você deve ver no painel</span>
          <div style={{ display: 'grid', gap: 6 }}>
            {CALIB_TESTS.map((test) => {
              const selected = test.mode === activeTest
              return (
                <button
                  key={test.mode}
                  type="button"
                  disabled={actionsDisabled || customActive}
                  onClick={() => void runTest(test.mode)}
                  style={{
                    ...buttonStyle(selected ? 'primary' : 'soft'),
                    textAlign: 'left',
                    padding: '8px 12px',
                    borderColor: selected ? ACCENT_BORDER : undefined
                  }}
                >
                  <strong>{test.label}</strong>
                  <br />
                  <small style={{ color: 'rgba(255,255,255,0.62)' }}>{test.expect}</small>
                </button>
              )
            })}
          </div>
          <div style={rowStyle}>
            <Toggle checked={autoCycle} caption={autoCycle ? 'Auto-ciclo ON' : 'Auto-ciclo'} onChange={setAutoCycle} />
            <span style={helper}>Percorre os 4 testes a cada ~2,2 s.</span>
          </div>
          {/* ONE-TAP orientation fix, right beside the live test pattern. Each tap
              of "Rotacionar 90°" cycles 0→90→180→270 and applyLayout persists the
              `M` byte AND re-fires the active test, so the glyph visibly rotates on
              the panel until it reads upright. Quick flip toggles cover mirrors. */}
          <div style={{ ...card, marginTop: 4, padding: 12 }}>
            <span style={label}>Orientação rápida · 1 toque</span>
            <p style={{ ...helper, marginTop: 4 }}>
              Dispare a <strong>“F”</strong> e toque <strong>Rotacionar 90°</strong> até ela ficar <strong>em pé</strong> e
              legível no painel. Se aparecer espelhada, use <strong>Espelhar X/Y</strong>. Cada toque grava o layout e
              re-dispara o teste — sem stale, o quadro inteiro é reenviado.
            </p>
            <div style={{ ...rowStyle, flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                style={buttonStyle('primary')}
                disabled={actionsDisabled || customActive}
                onClick={() => void applyLayout({ ...layout, rotation: nextRotation(layout.rotation) })}
              >
                Rotacionar 90° · atual {layout.rotation}°
              </button>
              <button
                type="button"
                style={buttonStyle(layout.flipX ? 'primary' : 'soft')}
                disabled={actionsDisabled || customActive}
                onClick={() => void applyLayout({ ...layout, flipX: !layout.flipX })}
              >
                Espelhar X · {layout.flipX ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                style={buttonStyle(layout.flipY ? 'primary' : 'soft')}
                disabled={actionsDisabled || customActive}
                onClick={() => void applyLayout({ ...layout, flipY: !layout.flipY })}
              >
                Espelhar Y · {layout.flipY ? 'ON' : 'OFF'}
              </button>
            </div>
            {customActive ? (
              <p style={{ ...helper, marginTop: 8 }}>
                Mapa manual ativo — rotação/espelho ficam inativos (o mapa por pixel já decide a fiação).
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Four instant-apply layout controls. */}
      <div style={{ ...card, marginTop: 16, opacity: customActive ? 0.5 : 1, pointerEvents: customActive ? 'none' : 'auto' }}>
        <span style={label}>Controles do layout (aplicação instantânea)</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginTop: 8 }}>
          <Field caption="Serpentina" hint="Linhas ímpares fiadas ao contrário — padrão na maioria dos painéis.">
            <Toggle
              checked={layout.serpentine}
              caption={layout.serpentine ? 'Ativada' : 'Desativada'}
              onChange={(serpentine) => void applyLayout({ ...layout, serpentine })}
            />
          </Field>
          <Field caption="Rotação" hint="Gire para casar o canto lógico (0,0) com o canto físico.">
            <SelectField
              value={String(layout.rotation)}
              options={ROTATION_OPTIONS}
              onChange={(value) => void applyLayout({ ...layout, rotation: Number(value) as MatrixRotation })}
            />
          </Field>
          <Field caption="Espelhar X" hint="Inverte as colunas (DIN entrando pelo lado oposto).">
            <Toggle
              checked={layout.flipX}
              caption={layout.flipX ? 'Invertido' : 'Normal'}
              onChange={(flipX) => void applyLayout({ ...layout, flipX })}
            />
          </Field>
          <Field caption="Espelhar Y" hint="Inverte as linhas (origem embaixo).">
            <Toggle
              checked={layout.flipY}
              caption={layout.flipY ? 'Invertido' : 'Normal'}
              onChange={(flipY) => void applyLayout({ ...layout, flipY })}
            />
          </Field>
        </div>
        <div style={{ ...rowStyle, marginTop: 12 }}>
          <button
            type="button"
            style={buttonStyle('ghost')}
            disabled={busy || customActive}
            onClick={() => void applyLayout({ serpentine: true, rotation: 0, flipX: false, flipY: false })}
          >
            Restaurar padrão
          </button>
          <span style={helper}>
            Cada ajuste grava o byte <code>M</code> na EEPROM do iFlag e re-dispara o teste atual.
          </span>
        </div>
        {customActive ? (
          <p style={{ ...helper, marginTop: 8 }}>
            Mapa manual ativo — os 4 controles de fiação acima (serpentina/rotação/espelho) ficam inativos porque o
            mapeamento por pixel já decide a fiação. Use os testes <strong>“Testar painel”</strong> (inclusive Flags e
            Marcha) acima para conferir, ou <strong>Refazer</strong>/<strong>Remover</strong> o mapa logo abaixo.
          </p>
        ) : null}
      </div>

      {/* Advanced: per-pixel manual remap fallback. */}
      <div style={{ ...card, marginTop: 14 }}>
        <div style={{ ...rowStyle, justifyContent: 'space-between' }}>
          <span style={label}>Avançado: mapeamento manual (pixel a pixel)</span>
          {customActive ? (
            <div style={{ ...rowStyle, gap: 8 }}>
              <button
                type="button"
                style={buttonStyle(manualOpen ? 'primary' : 'soft')}
                disabled={actionsDisabled}
                onClick={() => {
                  if (manualOpen) resumeManualRemap()
                  else setManualOpen(true)
                }}
              >
                {manualOpen ? 'Fechar mapeamento' : 'Refazer mapeamento'}
              </button>
              {!manualOpen ? (
                <button
                  type="button"
                  style={buttonStyle('ghost')}
                  disabled={busy}
                  onClick={() => void applyLayout({ serpentine: layout.serpentine, rotation: layout.rotation, flipX: layout.flipX, flipY: layout.flipY })}
                >
                  Remover mapa manual
                </button>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              style={buttonStyle(manualOpen ? 'primary' : 'soft')}
              disabled={actionsDisabled}
              onClick={() => {
                if (manualOpen) resumeManualRemap()
                else setManualOpen(true)
              }}
            >
              {manualOpen ? 'Fechar mapeamento' : 'Abrir mapeamento manual'}
            </button>
          )}
        </div>
        <p style={helper}>
          Para painéis cuja fiação <strong>não casa com nenhuma</strong> combinação de serpentina/rotação/espelho (ex.:
          módulos 4×4 emendados, zig-zag diagonal). O app acende <strong>um LED físico de cada vez</strong>; você toca a
          célula correspondente na grade e construímos uma permutação completa (64 pixels). Depois o app passa a enviar
          os quadros <em>já remapeados</em>, então o firmware exibe 1:1 — sem recompilar nada.
        </p>
        {manualOpen ? (
          <ManualRemap
            onLightPhysical={onLightPhysical}
            onSave={async (customMap) => {
              const sent = await onCommitLayout({ ...layout, customMap })
              showToast(
                sent ? 'Mapa manual salvo e aplicado ao iFlag.' : 'Mapa manual salvo no perfil. Conecte o iFlag para aplicar.',
                sent ? 'success' : 'info'
              )
              setManualOpen(false)
            }}
            onCancel={resumeManualRemap}
            onResume={() => {
              void onCommitLayout(layoutRef.current)
            }}
            disabled={actionsDisabled}
          />
        ) : null}
      </div>

      {!hasTarget ? (
        <p style={{ ...helper, marginTop: 12 }}>
          Nenhum componente iFlag/matriz cadastrado. Adicione um em “Meu Hardware” para enviar layout e testes ao
          dispositivo físico.
        </p>
      ) : null}
    </article>
  )
}

// Per-pixel manual remap. Lights physical LED `probeIndex` (white) on the panel
// and the user taps the on-screen cell where it appears. Each tap records
// cellToPhysical[cell] = physical LED, which IS the logical→physical permutation
// (customMap). When all 64 are placed we have a bijection ready to persist.
function ManualRemap({
  onLightPhysical,
  onSave,
  onCancel,
  onResume,
  disabled
}: {
  onLightPhysical(physicalIndex: number): Promise<boolean>
  onSave(customMap: number[]): Promise<void>
  onCancel(): void
  onResume(): void
  disabled: boolean
}): ReactElement {
  const total = RGB_MATRIX_SIZE * RGB_MATRIX_SIZE
  const [cellToPhysical, setCellToPhysical] = useState<(number | null)[]>(() => new Array(total).fill(null))
  const [probeIndex, setProbeIndex] = useState(0)
  const exitHandledRef = useRef(false)
  const onResumeRef = useRef(onResume)

  useEffect(() => {
    onResumeRef.current = onResume
  }, [onResume])

  useEffect(() => {
    return () => {
      if (!exitHandledRef.current) onResumeRef.current()
    }
  }, [])

  // Light the current physical LED whenever the probe target changes (and when
  // the device finishes connecting, so the first LED lights without a manual
  // "Reacender").
  useEffect(() => {
    if (disabled || probeIndex >= total) return
    void onLightPhysical(probeIndex)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeIndex, disabled])

  const assignedCount = useMemo(() => cellToPhysical.filter((v) => v !== null).length, [cellToPhysical])
  const complete = assignedCount === total

  const nextMissingPhysical = (map: (number | null)[]): number => {
    for (let i = 0; i < total; i += 1) if (!map.includes(i)) return i
    return total
  }

  const handleTap = (cell: number): void => {
    if (disabled || probeIndex >= total) return
    setCellToPhysical((current) => {
      const next = current.slice()
      // A physical LED maps to exactly one visual cell: clear any prior cell that
      // held this physical index, then assign it here.
      for (let i = 0; i < next.length; i += 1) if (next[i] === probeIndex) next[i] = null
      next[cell] = probeIndex
      const missing = nextMissingPhysical(next)
      setProbeIndex(missing)
      return next
    })
  }

  const reset = (): void => {
    setCellToPhysical(new Array(total).fill(null))
    setProbeIndex(0)
  }

  const stepBack = (): void => {
    if (disabled || probeIndex <= 0) return
    const previousPhysical = Math.min(probeIndex - 1, total - 1)
    setCellToPhysical((current) => {
      const next = current.slice()
      for (let i = 0; i < next.length; i += 1) if (next[i] === previousPhysical) next[i] = null
      return next
    })
    setProbeIndex(previousPhysical)
  }

  const save = (): void => {
    const customMap = cellToPhysical.map((v) => (v === null ? -1 : v))
    if (customMap.some((v) => v < 0)) return
    exitHandledRef.current = true
    void onSave(customMap)
  }

  const cancel = (): void => {
    if (exitHandledRef.current) return
    exitHandledRef.current = true
    onCancel()
  }

  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 18, alignItems: 'start' }}>
        <div>
          <div
            style={{ ...matrixSurface, gridTemplateColumns: `repeat(${RGB_MATRIX_SIZE}, 30px)`, gap: 4 }}
            role="grid"
            aria-label="Grade de mapeamento manual"
          >
            {cellToPhysical.map((physical, cell) => {
              const assigned = physical !== null
              return (
                <button
                  key={cell}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleTap(cell)}
                  title={assigned ? `LED físico ${physical}` : 'Toque onde o LED aceso aparece'}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${assigned ? ACCENT_BORDER : 'rgba(255,255,255,0.16)'}`,
                    background: assigned ? ACCENT_SOFT : 'var(--surface-base)',
                    color: 'rgba(255,255,255,0.82)',
                    fontSize: 10,
                    cursor: disabled ? 'default' : 'pointer',
                    fontVariantNumeric: 'tabular-nums'
                  }}
                >
                  {assigned ? physical : ''}
                </button>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <p style={helper}>
            {complete ? (
              <>Todos os 64 pixels mapeados. Confira e clique <strong>Salvar mapa</strong>.</>
            ) : (
              <>
                O painel está acendendo o <strong>LED físico #{probeIndex}</strong> (branco). Toque, na grade ao lado, a
                célula onde ele aparece. Em seguida acendemos o próximo automaticamente.
              </>
            )}
          </p>
          <div style={{ ...rowStyle }}>
            <span
              style={{
                ...helper,
                fontVariantNumeric: 'tabular-nums',
                padding: '2px 8px',
                borderRadius: 999,
                background: ACCENT_SOFT,
                border: `1px solid ${ACCENT_BORDER}`
              }}
            >
              {assignedCount}/{total} mapeados
            </span>
            {!complete ? (
              <button type="button" style={buttonStyle('ghost')} disabled={disabled || probeIndex >= total} onClick={() => void onLightPhysical(probeIndex)}>
                Reacender LED #{probeIndex}
              </button>
            ) : null}
          </div>
          <div style={rowStyle}>
            <button type="button" style={buttonStyle('primary')} disabled={disabled || !complete} onClick={save}>
              Salvar mapa
            </button>
            <button type="button" style={buttonStyle('ghost')} disabled={disabled} onClick={reset}>
              Recomeçar
            </button>
            <button type="button" style={buttonStyle('ghost')} disabled={disabled || probeIndex <= 0} onClick={stepBack}>
              Voltar um
            </button>
            <button type="button" style={buttonStyle('ghost')} disabled={disabled} onClick={cancel}>
              Cancelar
            </button>
          </div>
          <p style={helper}>
            Dica: se errou o LED atual, toque a célula correta. Para corrigir o LED anterior, use <strong>Voltar um</strong>.
          </p>
        </div>
      </div>
    </div>
  )
}

function TargetSelector({
  targets,
  selectedKey,
  onSelect
}: {
  targets: MatrixTarget[]
  selectedKey: string | null
  onSelect(key: string): void
}): ReactElement {
  if (targets.length === 0) {
    return (
      <div style={{ ...card, marginTop: 14, borderColor: 'rgba(255,255,255,0.18)' }}>
        <span style={label}>Target matrix</span>
        <p style={helper}>
          No RGB Matrix component exists yet. You can still design a preview profile here, but it will not drive hardware until
          an iFlag / matrix component is added in My Hardware.
        </p>
      </div>
    )
  }

  if (targets.length === 1) {
    const target = targets[0]
    return (
      <div style={{ ...card, marginTop: 14 }}>
        <span style={label}>Target matrix</span>
        <p style={helper}>
          Editing <strong>{target.componentLabel}</strong> on <strong>{target.profileLabel}</strong> · key <code>{target.key}</code>
        </p>
      </div>
    )
  }

  return (
    <div style={{ ...card, marginTop: 14 }}>
      <Field caption="Which iFlag / matrix component">
        <select value={selectedKey ?? targets[0]?.key ?? ''} onChange={(event) => onSelect(event.target.value)} style={input}>
          {targets.map((target) => (
            <option key={target.key} value={target.key}>
              {target.profileLabel} / {target.componentLabel} ({target.component.width}×{target.component.height})
            </option>
          ))}
        </select>
      </Field>
      <p style={helper}>
        Profiles are saved by the real hardware key <code>{selectedKey ?? targets[0]?.key}</code>, so runtime sends the same
        configuration to the matching device/component.
      </p>
    </div>
  )
}

function EffectStackItem({
  effect,
  depth,
  selectedId,
  priority,
  canMoveUp,
  canMoveDown,
  onSelect,
  onChangePriority,
  onRemove,
  onToggle
}: {
  effect: RgbMatrixEffect
  depth: number
  selectedId: string | null
  priority: number
  canMoveUp: boolean
  canMoveDown: boolean
  onSelect(id: string): void
  onChangePriority(id: string, direction: -1 | 1): void
  onRemove(id: string): void
  onToggle(id: string, enabled: boolean): void
}): ReactElement {
  const active = selectedId === effect.id
  return (
    <div style={{ display: 'grid', gap: 6, marginLeft: depth * 14 }}>
      <div
        style={{
          ...card,
          borderColor: active ? ACCENT_BORDER : 'rgba(255,255,255,0.1)',
          background: active ? ACCENT_SOFT : card.background,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          gap: 10,
          alignItems: 'center'
        }}
      >
        <input type="checkbox" checked={effect.enabled} onChange={(event) => onToggle(effect.id, event.target.checked)} />
        <button type="button" style={{ ...buttonStyle('ghost', active), textAlign: 'left' }} onClick={() => onSelect(effect.id)}>
          <strong>{effect.name}</strong>
          <br />
          <small style={{ color: 'rgba(255,255,255,0.58)' }}>
            {effect.kind === 'group' ? 'Conditional group' : effect.kind}
            {' · '}
            <span style={{ color: priority === 0 ? '#49C5B1' : 'rgba(255,255,255,0.7)' }}>
              Prioridade {priority}{priority === 0 ? ' (por cima)' : ''}
            </span>
          </small>
        </button>
        <div style={rowStyle}>
          <button type="button" title="Subir prioridade (mais por cima)" style={buttonStyle('ghost')} disabled={!canMoveUp} onClick={() => onChangePriority(effect.id, -1)}>
            ↑
          </button>
          <button type="button" title="Descer prioridade (mais por baixo)" style={buttonStyle('ghost')} disabled={!canMoveDown} onClick={() => onChangePriority(effect.id, 1)}>
            ↓
          </button>
          <button type="button" style={buttonStyle('danger')} onClick={() => onRemove(effect.id)}>
            Delete
          </button>
        </div>
      </div>
      {effect.kind === 'group'
        ? orderByPriorityForDisplay(effect.effects).map(({ effect: child, priority: childPriority }, childDisplayIndex, ordered) => (
            <EffectStackItem
              key={child.id}
              effect={child}
              depth={depth + 1}
              selectedId={selectedId}
              priority={childPriority}
              canMoveUp={childDisplayIndex > 0}
              canMoveDown={childDisplayIndex < ordered.length - 1}
              onSelect={onSelect}
              onChangePriority={onChangePriority}
              onRemove={onRemove}
              onToggle={onToggle}
            />
          ))
        : null}
    </div>
  )
}

function EffectEditor({
  effect,
  onChange,
  onAddChild
}: {
  effect: RgbMatrixEffect
  onChange(effect: RgbMatrixEffect): void
  onAddChild(parentId: string, effect: RgbMatrixEffect): void
}): ReactElement {
  if (effect.kind === 'group') {
    return (
      <div style={{ display: 'grid', gap: 14 }}>
        <HeaderEditor effect={effect} onChange={onChange} />
        <ConditionEditor effect={effect} onChange={onChange} />
        <div style={card}>
          <span style={label}>Child effects</span>
          <div style={{ ...rowStyle, marginTop: 10 }}>
            {(['static', 'animation', 'flags', 'gear', 'spotter'] as const).map((kind) => (
              <button key={kind} type="button" style={buttonStyle('soft')} onClick={() => onAddChild(effect.id, createRgbMatrixEffect(kind))}>
                Add {kind}
              </button>
            ))}
            <button type="button" style={buttonStyle('soft')} onClick={() => onAddChild(effect.id, createRgbMatrixStatusLed('speedLimiterOn'))}>
              Add status LED
            </button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <HeaderEditor effect={effect} onChange={onChange} />
      <BrightnessEditor effect={effect} onChange={onChange} />
      <RotationEditor effect={effect} onChange={onChange} />
      <PositionEditor effect={effect} onChange={onChange} />
      <ColorEditor effect={effect} onChange={onChange} />
      <BehaviourEditor effect={effect} onChange={onChange} />
      <AnimationEditor effect={effect} onChange={onChange} />
      {effect.kind === 'flags' ? <FlagsEditor effect={effect} onChange={onChange} /> : null}
      {effect.kind === 'gear' ? <GearEditor effect={effect} onChange={onChange} /> : null}
      {effect.kind === 'statusLed' ? <StatusLedEditor effect={effect} onChange={onChange} /> : null}
      <MiniPreview effect={effect} />
    </div>
  )
}

function HeaderEditor({ effect, onChange }: { effect: RgbMatrixEffect; onChange(effect: RgbMatrixEffect): void }): ReactElement {
  return (
    <div style={card}>
      <Field caption="Effect name">
        <TextField value={effect.name} onChange={(name) => onChange({ ...effect, name })} />
      </Field>
      <div style={{ ...rowStyle, marginTop: 10 }}>
        <Toggle checked={effect.enabled} caption="Enabled" onChange={(enabled) => onChange({ ...effect, enabled })} />
        <Toggle checked={effect.forceActivation} caption="Force activation" onChange={(forceActivation) => onChange({ ...effect, forceActivation })} />
      </div>
    </div>
  )
}

// Per-effect brightness (0–255, 255 = full). Scales this effect's output colour
// before it is composited into the single frame sent to the iFlag.
function BrightnessEditor({
  effect,
  onChange
}: {
  effect: RgbMatrixEffectBase
  onChange(effect: RgbMatrixEffect): void
}): ReactElement {
  const value = typeof effect.brightness === 'number' ? effect.brightness : RGB_MATRIX_FULL_BRIGHTNESS
  return (
    <div style={card}>
      <Field caption="Brightness" hint="Brilho só deste efeito (0–255). 255 = cheio. Escala a cor antes de compor o quadro.">
        <Slider
          value={value}
          min={0}
          max={RGB_MATRIX_FULL_BRIGHTNESS}
          step={1}
          onChange={(brightness) => onChange({ ...effect, brightness } as RgbMatrixEffect)}
          format={(v) => `${Math.round((v / RGB_MATRIX_FULL_BRIGHTNESS) * 100)}%`}
        />
      </Field>
    </div>
  )
}

// Per-effect clockwise rotation (0/90/180/270°), applied to this effect's layer
// before it is composited into the frame — independent of the panel wiring
// rotation. Lets the user "girar" a glyph/flag/animation without redrawing it.
function RotationEditor({
  effect,
  onChange
}: {
  effect: RgbMatrixEffectBase
  onChange(effect: RgbMatrixEffect): void
}): ReactElement {
  const value = MATRIX_ROTATIONS.includes(effect.rotation as MatrixRotation) ? (effect.rotation as MatrixRotation) : 0
  return (
    <div style={card}>
      <Field caption="Rotação" hint="Gira só este efeito (sentido horário) antes de compor o quadro. Não altera a fiação do painel.">
        <SelectField
          value={String(value)}
          options={ROTATION_OPTIONS}
          onChange={(next) => onChange({ ...effect, rotation: Number(next) as MatrixRotation } as RgbMatrixEffect)}
        />
      </Field>
    </div>
  )
}

function PositionEditor({
  effect,
  onChange
}: {
  effect: RgbMatrixEffectBase
  onChange(effect: RgbMatrixEffect): void
}): ReactElement {
  return (
    <div style={card}>
      <span style={label}>Position</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginTop: 10 }}>
        {([
          ['matrixStart', 'Matrix start', 0, 63],
          ['startX', 'X', 0, 7],
          ['startY', 'Y', 0, 7],
          ['width', 'Width', 1, 8],
          ['height', 'Height', 1, 8]
        ] as const).map(([key, caption, min, max]) => (
          <Field key={key} caption={caption}>
            <NumberField
              value={effect.position[key]}
              min={min}
              max={max}
              onChange={(value) => onChange({ ...effect, position: { ...effect.position, [key]: Math.round(value) } } as RgbMatrixEffect)}
            />
          </Field>
        ))}
      </div>
    </div>
  )
}

function ColorEditor({
  effect,
  onChange
}: {
  effect: RgbMatrixEffectBase
  onChange(effect: RgbMatrixEffect): void
}): ReactElement {
  return (
    <div style={card}>
      <span style={label}>Colors</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 10 }}>
        {([
          ['active', 'Main / active'],
          ['blink', 'Blink'],
          ['inactive', 'Inactive'],
          ['inactiveBlink', 'Inactive blink']
        ] as const).map(([key, caption]) => (
          <label key={key} style={{ display: 'grid', gap: 6 }}>
            <span style={label}>{caption}</span>
            <input
              type="color"
              value={effect.colors[key]}
              onChange={(event) => onChange({ ...effect, colors: { ...effect.colors, [key]: event.target.value } } as RgbMatrixEffect)}
              style={{ ...input, height: 38, padding: 4 }}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

function BehaviourEditor({
  effect,
  onChange
}: {
  effect: RgbMatrixEffectBase
  onChange(effect: RgbMatrixEffect): void
}): ReactElement {
  const blink = effect.blink ?? { enabled: effect.behaviour.blinking, onMs: effect.behaviour.blinkOnDelayMs, offMs: effect.behaviour.blinkOffDelayMs }
  const setBlink = (patch: Partial<NonNullable<RgbMatrixEffectBase['blink']>>): void => {
    const nextBlink = { ...blink, ...patch, enabled: patch.enabled ?? blink.enabled ?? false, onMs: patch.onMs ?? blink.onMs ?? 300, offMs: patch.offMs ?? blink.offMs ?? 300 }
    onChange({
      ...effect,
      blink: nextBlink,
      behaviour: {
        ...effect.behaviour,
        blinking: nextBlink.enabled,
        blinkMode: 'onOffDelay',
        blinkOnDelayMs: nextBlink.onMs,
        blinkOffDelayMs: nextBlink.offMs
      }
    } as RgbMatrixEffect)
  }
  return (
    <div style={card}>
      <span style={label}>Blink animation</span>
      <p style={helper}>A fase OFF pode apagar, trocar cor ou tocar outra animação. “Cycle colors” cria o blink trocando de cor.</p>
      <div style={{ ...rowStyle, marginTop: 10 }}>
        <Toggle checked={blink.enabled} caption="Blink enabled" onChange={(enabled) => setBlink({ enabled })} />
        <Toggle checked={blink.animateColors === true} caption="Cycle colors" onChange={(animateColors) => setBlink({ animateColors })} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
        <Field caption="On ms">
          <NumberField value={blink.onMs} min={20} max={10000} onChange={(onMs) => setBlink({ onMs })} />
        </Field>
        <Field caption="Off ms">
          <NumberField value={blink.offMs} min={20} max={10000} onChange={(offMs) => setBlink({ offMs })} />
        </Field>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>Alt color</span>
          <input type="color" value={blink.altColor ?? effect.colors.blink} onChange={(event) => setBlink({ altColor: event.target.value })} style={{ ...input, height: 38, padding: 4 }} />
        </label>
      </div>
      <div style={{ ...rowStyle, marginTop: 10 }}>
        <button type="button" style={buttonStyle('soft')} onClick={() => setBlink({ altFrames: (effect.frames ?? []).map(cloneAnimationFrame) })}>
          Use timeline as alt animation
        </button>
        <button type="button" style={buttonStyle('ghost')} onClick={() => setBlink({ altFrames: undefined })}>
          Clear alt animation
        </button>
        <span style={helper}>{blink.altFrames?.length ? `${blink.altFrames.length} alt frame(s)` : 'Sem alt frames: OFF usa alt color/cycle ou apaga.'}</span>
      </div>
    </div>
  )
}

function StatusLedEditor({
  effect,
  onChange
}: {
  effect: RgbMatrixStatusLedEffect
  onChange(effect: RgbMatrixEffect): void
}): ReactElement {
  return (
    <div style={card}>
      <Field caption="Status condition">
        <SelectField value={effect.status} options={STATUS_OPTIONS} onChange={(status) => onChange({ ...effect, status })} />
      </Field>
    </div>
  )
}

function ConditionEditor({
  effect,
  onChange
}: {
  effect: Extract<RgbMatrixEffect, { kind: 'group' }>
  onChange(effect: RgbMatrixEffect): void
}): ReactElement {
  return (
    <div style={card}>
      <Field caption="Condition">
        <SelectField
          value={effect.condition.kind}
          options={CONDITION_OPTIONS}
          onChange={(kind) => onChange({ ...effect, condition: defaultCondition(kind) })}
        />
      </Field>
      {effect.condition.kind === 'brakePressed' ? (
        <Field caption="Brake threshold">
          <NumberField value={effect.condition.threshold} min={0} max={1} step={0.01} onChange={(threshold) => onChange({ ...effect, condition: { kind: 'brakePressed', threshold } })} />
        </Field>
      ) : null}
      {effect.condition.kind === 'formulaTrue' ? (
        <Field caption="Formula">
          <TextField value={effect.condition.formula} placeholder="rpm > 7000" onChange={(formula) => onChange({ ...effect, condition: { kind: 'formulaTrue', formula } })} />
        </Field>
      ) : null}
    </div>
  )
}

const LOOP_MODE_OPTIONS: ReadonlyArray<SelectOption<RgbAnimationLoopMode>> = [
  { value: 'loop', label: 'Loop' },
  { value: 'pingpong', label: 'Ping-pong' },
  { value: 'once', label: 'Once' }
]

function AnimationEditor({
  effect,
  onChange
}: {
  effect: Exclude<RgbMatrixEffect, { kind: 'group' }>
  onChange(effect: RgbMatrixEffect): void
}): ReactElement {
  const frames = effect.frames?.length ? effect.frames : [createAnimationFrame(seedEffectGrid(effect))]
  const [frameId, setFrameId] = useState(frames[0]?.id ?? '')
  const [paintColor, setPaintColor] = useState(effect.colors.active)
  const [paintMode, setPaintMode] = useState<PaintMode>('paint')
  const activeFrame = frames.find((frame) => frame.id === frameId) ?? frames[0]
  const activePixels = frameGridForEditor(activeFrame)
  const pushPreviewFrame = useContext(PreviewFrameContext)

  function commitFrames(nextFrames: RgbAnimationFrame[]): void {
    onChange({ ...effect, frames: nextFrames.map(cloneAnimationFrame) } as RgbMatrixEffect)
  }

  function updateFrame(next: RgbAnimationFrame): void {
    commitFrames(frames.map((frame) => (frame.id === next.id ? withFrameGrid(next, frameGridForEditor(next)) : frame)))
  }

  function paint(x: number, y: number): void {
    if (!activeFrame) return
    const grid = activePixels.map((row) => row.slice())
    grid[y][x] = paintMode === 'paint' ? paintColor : '#000000'
    updateFrame(withFrameGrid(activeFrame, grid))
    pushPreviewFrame(grid)
  }

  function addFrame(copyCurrent = false): void {
    const frame = copyCurrent && activeFrame ? createAnimationFrame(frameGridForEditor(activeFrame), activeFrame.durationMs) : createAnimationFrame()
    commitFrames([...frames, frame])
    setFrameId(frame.id ?? '')
  }

  function moveFrame(direction: -1 | 1): void {
    if (!activeFrame) return
    const index = frames.findIndex((frame) => frame.id === activeFrame.id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= frames.length) return
    const next = frames.slice()
    next[index] = frames[target]
    next[target] = frames[index]
    commitFrames(next)
  }

  return (
    <div style={card}>
      <div style={{ ...rowStyle, justifyContent: 'space-between' }}>
        <div>
          <span style={label}>Frame timeline</span>
          <p style={helper}>Cada efeito pode ser uma animação 8×8 com duração por frame.</p>
        </div>
        <div style={rowStyle}>
          <button type="button" style={buttonStyle('soft')} onClick={() => addFrame(true)}>Duplicate</button>
          <button type="button" style={buttonStyle('primary')} onClick={() => addFrame(false)}>Add frame</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
        <Field caption="Loop mode">
          <SelectField value={effect.loopMode ?? 'loop'} options={LOOP_MODE_OPTIONS} onChange={(loopMode) => onChange({ ...effect, loopMode } as RgbMatrixEffect)} />
        </Field>
        <Field caption="Speed" hint="1 = normal, 2 = dobro da velocidade.">
          <NumberField value={effect.speed ?? 1} min={0.05} max={8} step={0.05} onChange={(speed) => onChange({ ...effect, speed } as RgbMatrixEffect)} />
        </Field>
        <Field caption="Frames">
          <span style={{ ...helper, fontVariantNumeric: 'tabular-nums' }}>{frames.length} frame(s)</span>
        </Field>
      </div>
      <div style={{ ...rowStyle, marginTop: 10 }}>
        {frames.map((frame, index) => (
          <button key={frame.id ?? index} type="button" style={buttonStyle('soft', activeFrame?.id === frame.id)} onClick={() => setFrameId(frame.id ?? '')}>
            {index + 1} · {frame.durationMs} ms
          </button>
        ))}
      </div>
      {activeFrame ? (
        <>
          <div style={{ ...rowStyle, marginTop: 12 }}>
            <Field caption="Duration ms">
              <NumberField value={activeFrame.durationMs} min={20} max={60000} onChange={(durationMs) => updateFrame({ ...activeFrame, durationMs })} />
            </Field>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={label}>Paint color</span>
              <input type="color" value={paintColor} onChange={(event) => setPaintColor(event.target.value)} style={{ ...input, width: 90, height: 38, padding: 4 }} />
            </label>
            <button type="button" style={buttonStyle('soft', paintMode === 'paint')} onClick={() => setPaintMode('paint')}>Paint</button>
            <button type="button" style={buttonStyle('soft', paintMode === 'erase')} onClick={() => setPaintMode('erase')}>Erase</button>
            <button type="button" style={buttonStyle('ghost')} disabled={frames.length <= 1} onClick={() => moveFrame(-1)}>←</button>
            <button type="button" style={buttonStyle('ghost')} disabled={frames.length <= 1} onClick={() => moveFrame(1)}>→</button>
            <button
              type="button"
              style={buttonStyle('danger')}
              disabled={frames.length <= 1}
              onClick={() => {
                const nextFrames = frames.filter((frame) => frame.id !== activeFrame.id)
                commitFrames(nextFrames)
                setFrameId(nextFrames[0]?.id ?? '')
              }}
            >
              Remove frame
            </button>
          </div>
          <PaintGrid pixels={activePixels} onPaint={paint} />
        </>
      ) : null}
    </div>
  )
}

function frameGridForEditor(frame: RgbAnimationFrame): string[][] {
  return isValidHexGrid(frame.grid) ? frame.grid : isValidHexGrid(frame.pixels) ? frame.pixels : emptyMatrixHexGrid()
}

function withFrameGrid(frame: RgbAnimationFrame, grid: string[][]): RgbAnimationFrame {
  const next = grid.map((row) => row.slice())
  return { ...frame, grid: next, pixels: next }
}

function cloneAnimationFrame(frame: RgbAnimationFrame): RgbAnimationFrame {
  return withFrameGrid({ ...frame }, frameGridForEditor(frame))
}

function seedEffectGrid(effect: Exclude<RgbMatrixEffect, { kind: 'group' }>): string[][] {
  if (effect.kind === 'flags') return buildFlagHexGrid('green')
  if (effect.kind === 'gear') return buildGearGlyphHexGrid('3', effect.numberColor ?? effect.colors.active)
  return Array.from({ length: RGB_MATRIX_SIZE }, () => Array.from({ length: RGB_MATRIX_SIZE }, () => effect.colors.active))
}


const FLAG_LABELS_PT: Record<FlagName, string> = {
  green: 'Verde',
  yellow: 'Amarela',
  blue: 'Azul',
  white: 'Branca',
  red: 'Vermelha',
  black: 'Preta',
  meatball: 'Meatball (dano)',
  checkered: 'Quadriculada'
}

const FLAG_MODE_OPTIONS: ReadonlyArray<SelectOption<RgbMatrixFlagMode>> = [
  { value: 'currentFlag', label: 'Bandeira atual (auto)' },
  { value: 'solid', label: 'Cor sólida (Main)' },
  { value: 'checkered', label: 'Quadriculada' },
  { value: 'custom', label: 'Personalizado (pixel a pixel)' }
]

const GEAR_MODE_OPTIONS: ReadonlyArray<SelectOption<'font' | 'custom'>> = [
  { value: 'font', label: 'Fonte padrão' },
  { value: 'custom', label: 'Personalizado (pixel a pixel)' }
]

// The animation currently being edited for a label: an explicit per-label
// animation, else the legacy single grid as frame 0, else the default seed.
function labelAnimation(
  animation: RgbEffectAnimation | undefined,
  grid: string[][] | undefined,
  seed: string[][]
): RgbEffectAnimation {
  if (animation && animation.frames.length > 0) return animation
  return createEffectAnimation(isValidHexGrid(grid) ? grid : seed)
}

type ScopeBlink = NonNullable<RgbEffectAnimation['blink']>

// Live 8×8 preview of ONE per-flag / per-gear-label animation: plays the whole
// timeline (so 'once' is visible too) and applies its blink. Animates via the
// workspace's 80 ms re-render tick.
function AnimationPreview({ animation, colors }: { animation: RgbEffectAnimation; colors: RgbMatrixEffectColors }): ReactElement {
  const frames = animation.frames.length > 0 ? animation.frames : [createAnimationFrame()]
  const speed = Math.max(0.05, animation.speed || 1)
  const totalMs = frames.reduce((sum, frame) => sum + Math.max(1, frame.durationMs), 0) / speed
  const elapsed = Date.now() % (Math.max(1, totalMs) + 700)
  const frame = selectAnimationFrame(animation, elapsed)
  const base = frame ? frameGridForEditor(frame) : emptyMatrixHexGrid()
  const grid = applyBlinkPhase({ blink: animation.blink, colors, loopMode: animation.loopMode, speed: animation.speed }, elapsed, base)
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <span style={label}>Preview</span>
      <StaticMatrixGrid grid={grid} cell={16} />
    </div>
  )
}

// Reusable per-label animation editor: a row of label chips selects which flag /
// gear-label timeline is edited, then a frame timeline (add/dup/remove/reorder,
// per-frame duration, loop/speed) + blink + per-pixel paint of the active frame,
// with a live preview of THAT label. Frame 0 IS the legacy single grid, so simple
// single-image editing still works (it edits frame 0). Used for both the gear
// digits (R,N,0–9) and the flag colours.
function PerLabelAnimationEditor<L extends string>({
  labels,
  labelText,
  animations,
  grids,
  seed,
  colors,
  initialColor,
  onCommit
}: {
  labels: readonly L[]
  labelText(label: L): string
  animations: Partial<Record<L, RgbEffectAnimation>>
  grids: Partial<Record<L, string[][]>>
  seed(label: L): string[][]
  colors: RgbMatrixEffectColors
  initialColor: string
  onCommit(label: L, animation: RgbEffectAnimation): void
}): ReactElement {
  const [activeLabel, setActiveLabel] = useState<L>(labels[0])
  const [frameId, setFrameId] = useState('')
  const [paintColor, setPaintColor] = useState(initialColor)
  const [paintMode, setPaintMode] = useState<PaintMode>('paint')
  const pushPreviewFrame = useContext(PreviewFrameContext)

  const animation = labelAnimation(animations[activeLabel], grids[activeLabel], seed(activeLabel))
  const frames = animation.frames.length > 0 ? animation.frames : [createAnimationFrame(seed(activeLabel))]
  const activeFrame = frames.find((frame) => frame.id === frameId) ?? frames[0]
  const activePixels = frameGridForEditor(activeFrame)
  const blink: ScopeBlink = animation.blink ?? { enabled: false, onMs: 300, offMs: 300 }

  function commitAnimation(next: RgbEffectAnimation): void {
    onCommit(activeLabel, { ...next, frames: next.frames.map(cloneAnimationFrame) })
  }
  function commitFrames(nextFrames: RgbAnimationFrame[]): void {
    commitAnimation({ ...animation, frames: nextFrames })
  }
  function updateFrame(next: RgbAnimationFrame): void {
    commitFrames(frames.map((frame) => (frame.id === next.id ? withFrameGrid(next, frameGridForEditor(next)) : frame)))
  }
  function paint(x: number, y: number): void {
    const grid = activePixels.map((row) => row.slice())
    grid[y][x] = paintMode === 'paint' ? paintColor : '#000000'
    updateFrame(withFrameGrid(activeFrame, grid))
    pushPreviewFrame(grid)
  }
  function addFrame(copyCurrent: boolean): void {
    const frame = copyCurrent ? createAnimationFrame(activePixels, activeFrame.durationMs) : createAnimationFrame()
    commitFrames([...frames, frame])
    setFrameId(frame.id ?? '')
  }
  function moveFrame(direction: -1 | 1): void {
    const index = frames.findIndex((frame) => frame.id === activeFrame.id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= frames.length) return
    const next = frames.slice()
    next[index] = frames[target]
    next[target] = frames[index]
    commitFrames(next)
  }
  function setBlink(patch: Partial<ScopeBlink>): void {
    const next: ScopeBlink = {
      ...blink,
      ...patch,
      enabled: patch.enabled ?? blink.enabled ?? false,
      onMs: patch.onMs ?? blink.onMs ?? 300,
      offMs: patch.offMs ?? blink.offMs ?? 300
    }
    commitAnimation({ ...animation, blink: next })
  }
  function selectLabel(next: L): void {
    setActiveLabel(next)
    setFrameId('')
  }

  return (
    <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
      <span style={label}>Escolha o que editar</span>
      <div style={{ ...rowStyle, flexWrap: 'wrap', gap: 6 }}>
        {labels.map((entry) => {
          const count = animations[entry]?.frames.length ?? 0
          return (
            <button key={entry} type="button" style={buttonStyle('soft', entry === activeLabel)} onClick={() => selectLabel(entry)}>
              {labelText(entry)}
              {count > 1 ? ` · ${count}f` : ''}
            </button>
          )
        })}
      </div>

      <div style={{ ...rowStyle, justifyContent: 'space-between' }}>
        <div>
          <span style={label}>Frame timeline — {labelText(activeLabel)}</span>
          <p style={helper}>Frame 1 é a imagem única; adicione frames para animar esta bandeira/marcha.</p>
        </div>
        <div style={rowStyle}>
          <button type="button" style={buttonStyle('soft')} onClick={() => addFrame(true)}>Duplicate</button>
          <button type="button" style={buttonStyle('primary')} onClick={() => addFrame(false)}>Add frame</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <Field caption="Loop mode">
          <SelectField value={animation.loopMode} options={LOOP_MODE_OPTIONS} onChange={(loopMode) => commitAnimation({ ...animation, loopMode })} />
        </Field>
        <Field caption="Speed" hint="1 = normal, 2 = dobro.">
          <NumberField value={animation.speed} min={0.05} max={8} step={0.05} onChange={(speed) => commitAnimation({ ...animation, speed })} />
        </Field>
        <Field caption="Frames">
          <span style={{ ...helper, fontVariantNumeric: 'tabular-nums' }}>{frames.length} frame(s)</span>
        </Field>
      </div>

      <div style={{ ...rowStyle, flexWrap: 'wrap', gap: 6 }}>
        {frames.map((frame, index) => (
          <button key={frame.id ?? index} type="button" style={buttonStyle('soft', activeFrame.id === frame.id)} onClick={() => setFrameId(frame.id ?? '')}>
            {index + 1} · {frame.durationMs} ms
          </button>
        ))}
      </div>

      <div style={{ ...rowStyle, flexWrap: 'wrap' }}>
        <Field caption="Duration ms">
          <NumberField value={activeFrame.durationMs} min={20} max={60000} onChange={(durationMs) => updateFrame({ ...activeFrame, durationMs })} />
        </Field>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>Paint color</span>
          <input type="color" value={paintColor} onChange={(event) => setPaintColor(event.target.value)} style={{ ...input, width: 90, height: 38, padding: 4 }} />
        </label>
        <button type="button" style={buttonStyle('soft', paintMode === 'paint')} onClick={() => setPaintMode('paint')}>Paint</button>
        <button type="button" style={buttonStyle('soft', paintMode === 'erase')} onClick={() => setPaintMode('erase')}>Erase</button>
        <button type="button" style={buttonStyle('ghost')} disabled={frames.length <= 1} onClick={() => moveFrame(-1)}>←</button>
        <button type="button" style={buttonStyle('ghost')} disabled={frames.length <= 1} onClick={() => moveFrame(1)}>→</button>
        <button type="button" style={buttonStyle('ghost')} onClick={() => updateFrame(withFrameGrid(activeFrame, emptyMatrixHexGrid()))}>Limpar</button>
        <button type="button" style={buttonStyle('ghost')} onClick={() => updateFrame(withFrameGrid(activeFrame, seed(activeLabel)))}>Restaurar padrão</button>
        <button
          type="button"
          style={buttonStyle('danger')}
          disabled={frames.length <= 1}
          onClick={() => {
            const nextFrames = frames.filter((frame) => frame.id !== activeFrame.id)
            commitFrames(nextFrames)
            setFrameId(nextFrames[0]?.id ?? '')
          }}
        >
          Remove frame
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
        <PaintGrid pixels={activePixels} onPaint={paint} />
        <AnimationPreview animation={animation} colors={colors} />
      </div>

      <div style={card}>
        <span style={label}>Blink — {labelText(activeLabel)}</span>
        <p style={helper}>Quando ligado, a fase OFF apaga, troca de cor (alt) ou cicla cores, no clock desta bandeira/marcha.</p>
        <div style={{ ...rowStyle, marginTop: 8 }}>
          <Toggle checked={blink.enabled} caption="Blink enabled" onChange={(enabled) => setBlink({ enabled })} />
          <Toggle checked={blink.animateColors === true} caption="Cycle colors" onChange={(animateColors) => setBlink({ animateColors })} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
          <Field caption="On ms">
            <NumberField value={blink.onMs} min={20} max={10000} onChange={(onMs) => setBlink({ onMs })} />
          </Field>
          <Field caption="Off ms">
            <NumberField value={blink.offMs} min={20} max={10000} onChange={(offMs) => setBlink({ offMs })} />
          </Field>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={label}>Alt color</span>
            <input type="color" value={blink.altColor ?? colors.blink} onChange={(event) => setBlink({ altColor: event.target.value })} style={{ ...input, height: 38, padding: 4 }} />
          </label>
        </div>
      </div>
    </div>
  )
}

function FlagsEditor({
  effect,
  onChange
}: {
  effect: RgbMatrixFlagsEffect
  onChange(effect: RgbMatrixEffect): void
}): ReactElement {
  function setMode(mode: RgbMatrixFlagMode): void {
    if (mode === 'custom' && !effect.customPatterns && !effect.flagAnimations) {
      onChange({ ...effect, mode, customPatterns: defaultFlagCustomPatterns() })
      return
    }
    onChange({ ...effect, mode })
  }
  // Persist the full per-flag animation AND keep customPatterns[flag] readable as
  // frame 0, so old app builds / the calibration test grids still render it.
  function commit(flag: FlagName, animation: RgbEffectAnimation): void {
    const frame0 = animation.frames[0]
    const grid0 = frame0 ? frameGridForEditor(frame0) : buildFlagHexGrid(flag)
    onChange({
      ...effect,
      flagAnimations: { ...effect.flagAnimations, [flag]: animation },
      customPatterns: { ...effect.customPatterns, [flag]: grid0 }
    })
  }
  return (
    <div style={card}>
      <span style={label}>Flags</span>
      <Field caption="Flag mode" hint="“Bandeira atual” mostra a flag da telemetria; “Personalizado” deixa você animar cada bandeira.">
        <SelectField value={effect.mode} options={FLAG_MODE_OPTIONS} onChange={setMode} />
      </Field>
      <Field
        caption="Bandeira prevalece sobre a marcha"
        hint="Ligado (padrão): uma bandeira de CAUTELA (amarela, azul, branca, vermelha, preta, meatball ou quadriculada) esconde o dígito da marcha — a bandeira ocupa o painel inteiro e a marcha não aparece por cima nem vaza no piscar. A bandeira VERDE sempre mantém a marcha visível (corrida normal)."
      >
        <Toggle
          checked={effect.hideGearWhenFlagActive !== false}
          caption={effect.hideGearWhenFlagActive !== false ? 'Cautela esconde a marcha' : 'Marcha sempre por cima'}
          onChange={(value) => onChange({ ...effect, hideGearWhenFlagActive: value })}
        />
      </Field>
      {effect.mode === 'custom' ? (
        <PerLabelAnimationEditor
          labels={FLAG_NAMES}
          labelText={(flag) => FLAG_LABELS_PT[flag]}
          animations={effect.flagAnimations ?? {}}
          grids={effect.customPatterns ?? {}}
          seed={(flag) => buildFlagHexGrid(flag)}
          colors={effect.colors}
          initialColor={effect.colors.active}
          onCommit={commit}
        />
      ) : (
        <p style={helper}>
          Selecione <strong>Personalizado</strong> para desenhar e animar, frame a frame, o que acende em cada bandeira
          (verde, amarela, azul, branca, vermelha, preta, meatball e quadriculada).
        </p>
      )}
    </div>
  )
}

function GearEditor({
  effect,
  onChange
}: {
  effect: RgbMatrixGearEffect
  onChange(effect: RgbMatrixEffect): void
}): ReactElement {
  const mode = effect.mode ?? 'font'
  function setMode(next: 'font' | 'custom'): void {
    if (next === 'custom' && !effect.customGlyphs && !effect.gearAnimations) {
      onChange({ ...effect, mode: next, customGlyphs: defaultGearCustomGlyphs(effect.colors.active) })
      return
    }
    onChange({ ...effect, mode: next })
  }
  // Persist the full per-gear-label animation AND keep customGlyphs[label]
  // readable as frame 0 (back-compat + calibration "gear" test grid).
  function commit(gearKey: GearLabel, animation: RgbEffectAnimation): void {
    const frame0 = animation.frames[0]
    const grid0 = frame0 ? frameGridForEditor(frame0) : buildGearGlyphHexGrid(gearKey, effect.colors.active)
    onChange({
      ...effect,
      gearAnimations: { ...effect.gearAnimations, [gearKey]: animation },
      customGlyphs: { ...effect.customGlyphs, [gearKey]: grid0 }
    })
  }
  return (
    <div style={card}>
      <span style={label}>Gear digit</span>
      <Field caption="Glyph source" hint="“Fonte padrão” usa o desenho embutido; “Personalizado” deixa você animar cada marcha.">
        <SelectField value={mode} options={GEAR_MODE_OPTIONS} onChange={setMode} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 10 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>Normal number</span>
          <input type="color" value={effect.numberColor ?? effect.colors.active} onChange={(event) => onChange({ ...effect, numberColor: event.target.value })} style={{ ...input, height: 38, padding: 4 }} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={label}>Redline number</span>
          <input type="color" value={effect.redlineNumberColor ?? '#FF2D20'} onChange={(event) => onChange({ ...effect, redlineNumberColor: event.target.value })} style={{ ...input, height: 38, padding: 4 }} />
        </label>
      </div>
      {mode === 'custom' ? (
        <PerLabelAnimationEditor
          labels={GEAR_LABELS}
          labelText={(gear) => gear}
          animations={effect.gearAnimations ?? {}}
          grids={effect.customGlyphs ?? {}}
          seed={(gear) => buildGearGlyphHexGrid(gear, effect.numberColor ?? effect.colors.active)}
          colors={effect.colors}
          initialColor={effect.numberColor ?? effect.colors.active}
          onCommit={commit}
        />
      ) : (
        <p style={helper}>
          Selecione <strong>Personalizado</strong> para desenhar e animar, frame a frame, o dígito de cada marcha (R, N e 0–9).
          Células pretas ficam transparentes: a marcha aparece por cima da bandeira <strong>verde</strong> (corrida normal). Sob uma
          bandeira de cautela, a bandeira prevalece e esconde a marcha (ajuste isso no efeito <strong>Flags</strong>).
        </p>
      )}
    </div>
  )
}

function PaintGrid({ pixels, onPaint }: { pixels: string[][]; onPaint(x: number, y: number): void }): ReactElement {
  const [dragging, setDragging] = useState(false)
  return (
    <div
      style={{ ...matrixSurface, marginTop: 12 }}
      onMouseLeave={() => setDragging(false)}
      onMouseUp={() => setDragging(false)}
    >
      {pixels.flatMap((row, y) =>
        row.map((color, x) => (
          <button
            key={`${x}-${y}`}
            type="button"
            onMouseDown={() => {
              setDragging(true)
              onPaint(x, y)
            }}
            onMouseEnter={() => {
              if (dragging) onPaint(x, y)
            }}
            style={ledStyle(color)}
            aria-label={`LED ${x + 1}, ${y + 1}`}
          />
        ))
      )}
    </div>
  )
}

function MiniPreview({ effect }: { effect: Exclude<RgbMatrixEffect, { kind: 'group' }> }): ReactElement {
  const frame = renderMatrixFrame({ version: 1, effects: [effect], layout: defaultMatrixLayout() }, mockTelemetry(Date.now()), Date.now())
  return (
    <div style={card}>
      <span style={label}>Per-effect preview</span>
      <MatrixFrameView frame={frame} small />
    </div>
  )
}

function MatrixFrameView({ frame, small = false }: { frame: ReturnType<typeof renderMatrixFrame>; small?: boolean }): ReactElement {
  return (
    <div style={{ ...matrixSurface, gridTemplateColumns: `repeat(${RGB_MATRIX_SIZE}, ${small ? 14 : 24}px)`, gap: small ? 3 : 4, marginTop: 10 }}>
      {frame.flatMap((row, y) =>
        row.map((color, x) => (
          <span
            key={`${x}-${y}`}
            style={{
              ...ledStyle(rgbToHex(color)),
              width: small ? 14 : 24,
              height: small ? 14 : 24,
              cursor: 'default'
            }}
          />
        ))
      )}
    </div>
  )
}

function AddEffectDialog({
  query,
  setQuery,
  onClose,
  onAdd
}: {
  query: string
  setQuery(query: string): void
  onClose(): void
  onAdd(effect: RgbMatrixEffect): void
}): ReactElement {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape, true)
    return () => document.removeEventListener('keydown', closeOnEscape, true)
  }, [onClose])

  const allItems: ReadonlyArray<RgbMatrixCatalogItem> = [
    ...RGB_MATRIX_EFFECT_CATALOG,
    ...RGB_MATRIX_STATUS_LED_CATALOG,
    ...RGB_MATRIX_GROUP_CATALOG,
    ...RGB_MATRIX_SPECIAL_CATALOG
  ]
  const visible = allItems.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.58)', zIndex: 20, display: 'grid', placeItems: 'center' }}
    >
      <div role="dialog" aria-modal="true" aria-label="Add effect or group" style={{ ...panel, width: 'min(760px, 92vw)', maxHeight: '82vh', overflow: 'auto' }}>
        <div style={{ ...rowStyle, justifyContent: 'space-between' }}>
          <div>
            <span style={label}>Add effect / group</span>
            <h3 style={{ margin: '4px 0 0' }}>SimHub-style catalogue</h3>
          </div>
          <button type="button" style={buttonStyle('ghost')} onClick={onClose}>
            Close
          </button>
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search effects, status LEDs, groups..." style={{ ...input, marginTop: 14 }} />
        {(['Effects', 'Status leds', 'Conditional groups', 'Special'] as const).map((category) => {
          const items = visible.filter((item) => item.category === category)
          if (items.length === 0) return null
          return (
            <div key={category} style={{ marginTop: 16 }}>
              <span style={label}>{category}</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, marginTop: 8 }}>
                {items.map((item) => (
                  <button key={`${item.category}-${item.id}`} type="button" style={{ ...buttonStyle('soft'), textAlign: 'left', padding: 12 }} onClick={() => onAdd(createFromCatalog(item))}>
                    <strong>{item.label}</strong>
                    <br />
                    <small style={{ color: 'rgba(255,255,255,0.58)' }}>{item.description}</small>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function createFromCatalog(item: RgbMatrixCatalogItem): RgbMatrixEffect {
  if (item.category === 'Status leds') {
    const statusItem = RGB_MATRIX_STATUS_LED_CATALOG.find((entry) => entry.id === item.id)
    return createRgbMatrixStatusLed(statusItem?.status ?? 'speedLimiterOn')
  }
  if (item.category === 'Conditional groups') return createRgbMatrixGroup(defaultCondition(item.id as RgbMatrixCondition['kind']))
  if (item.category === 'Special') return createRgbMatrixGroup({ kind: 'special', mode: item.id === 'scriptedJsContent' ? 'scriptedJsContent' : 'changeBrightness' })
  switch (item.id) {
    case 'animation':
      return createRgbMatrixEffect('animation')
    case 'flags':
      return createRgbMatrixEffect('flags')
    case 'gear':
      return createRgbMatrixEffect('gear')
    case 'spotter':
      return createRgbMatrixEffect('spotter')
    case 'static':
    default:
      return createRgbMatrixEffect('static')
  }
}

function defaultCondition(kind: RgbMatrixCondition['kind']): RgbMatrixCondition {
  switch (kind) {
    case 'gameRunning':
      return { kind }
    case 'gameNotRunning':
      return { kind }
    case 'inPitLane':
      return { kind }
    case 'speedLimiter':
      return { kind }
    case 'brakePressed':
      return { kind, threshold: 0.05 }
    case 'formulaTrue':
      return { kind, formula: 'rpm > 7000' }
    case 'selectedCarModel':
      return { kind, carModel: '' }
    case 'selectedGames':
      return { kind, games: ['iracing'] }
    case 'special':
      return { kind, mode: 'changeBrightness' }
  }
}

function ledStyle(color: string): CSSProperties {
  return {
    width: 24,
    height: 24,
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    background: color,
  }
}

function findEffect(effects: RgbMatrixEffect[], id: string): RgbMatrixEffect | null {
  for (const effect of effects) {
    if (effect.id === id) return effect
    if (effect.kind === 'group') {
      const child = findEffect(effect.effects, id)
      if (child) return child
    }
  }
  return null
}

function findFirstEffectId(effects: RgbMatrixEffect[]): string | null {
  const first = effects[0]
  if (!first) return null
  return first.id
}

function updateEffectTree(
  effects: RgbMatrixEffect[],
  id: string,
  updater: (effect: RgbMatrixEffect) => RgbMatrixEffect
): RgbMatrixEffect[] {
  return effects.map((effect) => {
    if (effect.id === id) return updater(effect)
    if (effect.kind === 'group') return { ...effect, effects: updateEffectTree(effect.effects, id, updater) }
    return effect
  })
}

function removeEffectTree(effects: RgbMatrixEffect[], id: string): RgbMatrixEffect[] {
  const filtered = effects
    .filter((effect) => effect.id !== id)
    .map((effect) => (effect.kind === 'group' ? { ...effect, effects: removeEffectTree(effect.effects, id) } : effect))
  // Recompact to a contiguous unique 0..N-1 so a middle delete (e.g. 0,2,3) does not
  // leave a gap; visual order is preserved (the effect that was priority 0 stays 0).
  return ensureUniqueEffectPriorities(filtered)
}

// Order a sibling list for DISPLAY by priority ASC (0 = top, overrides all). Pairs
// each effect with the priority shown in the editor. Priorities are guaranteed via
// ensureUniqueEffectPriorities so a legacy/just-loaded list always shows numbers.
function orderByPriorityForDisplay(effects: RgbMatrixEffect[]): { effect: RgbMatrixEffect; priority: number }[] {
  const ensured = ensureUniqueEffectPriorities(effects)
  return ensured
    .map((effect, index) => ({ effect, index, priority: displayPriority(effect, index) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ effect, priority }) => ({ effect, priority }))
}

function displayPriority(effect: RgbMatrixEffect, fallback: number): number {
  return typeof effect.priority === 'number' && Number.isFinite(effect.priority) ? effect.priority : fallback
}

// Swap an effect's priority with its neighbour in priority order (direction -1 = up
// toward 0/top, +1 = down). Two values are exchanged so the set stays unique; the
// stored array order is preserved (only priority fields change). Recurses into
// groups so a nested child reorders within its own sibling list.
function changePriorityTree(effects: RgbMatrixEffect[], id: string, direction: -1 | 1): RgbMatrixEffect[] {
  if (effects.some((effect) => effect.id === id)) {
    const ensured = ensureUniqueEffectPriorities(effects)
    const order = ensured
      .map((effect, index) => ({ effect, index, priority: displayPriority(effect, index) }))
      .sort((a, b) => a.priority - b.priority || a.index - b.index)
    const pos = order.findIndex((entry) => entry.effect.id === id)
    const target = pos + direction
    if (pos < 0 || target < 0 || target >= order.length) return ensured
    const a = order[pos]
    const b = order[target]
    return ensured.map((effect) => {
      if (effect.id === a.effect.id) return { ...effect, priority: b.priority }
      if (effect.id === b.effect.id) return { ...effect, priority: a.priority }
      return effect
    })
  }
  return effects.map((effect) => (effect.kind === 'group' ? { ...effect, effects: changePriorityTree(effect.effects, id, direction) } : effect))
}
