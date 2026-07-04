// 3D Spotter — renderer Web Audio runtime.
//
// The audio half of the 3D Spotter. It drives a tiny pool of Web Audio voices
// (Oscillator → Gain → PannerNode[HRTF] → master) whose 3D position and gain
// track the strongest spatial cues, so a panned tone follows each nearby car —
// left/right by stereo position, near/far by volume.
//
// The PURE config + cue mapping (computeSpatialCues) live in shared/spotter3d.ts
// so main, renderer and tests share one source of truth. This file only adds the
// browser-only audio runtime; it does NOT touch the real Voice Spotter callouts
// in lib/spotter-runtime.ts.

import type { TelemetrySnapshot } from '../../../shared/telemetry'
import {
  DEFAULT_SPOTTER_3D_CONFIG,
  type SpatialCue,
  type SpatialSide,
  type Spotter3DConfig,
  computeSpatialCues
} from '../../../shared/spotter3d'

export {
  DEFAULT_SPOTTER_3D_CONFIG,
  SPOTTER_3D_CHANNELS,
  computeSpatialCues,
  mergeSpotter3DConfig,
  sideFromPan,
  type SpatialCue,
  type SpatialSide,
  type Spotter3DConfig,
  type Spotter3DConfigPatch
} from '../../../shared/spotter3d'

type AudioContextConstructor = typeof AudioContext
type AudioContextWindow = Window & { webkitAudioContext?: AudioContextConstructor }

// Test-button positions. 'behind' is not a stereo SIDE (left/right/center) — it
// is a front/back placement — so the view drives it through this richer union.
export type Spotter3DTestPosition = SpatialSide | 'behind'

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function clampPan(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < -1 ? -1 : value > 1 ? 1 : value
}

interface Voice {
  osc: OscillatorNode
  gain: GainNode
  panner: PannerNode
  started: boolean
}

export class Spotter3DEngine {
  private config: Spotter3DConfig
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private voices: Voice[] = []
  private running = false

  constructor(config: Spotter3DConfig = DEFAULT_SPOTTER_3D_CONFIG) {
    this.config = config
  }

  setConfig(config: Spotter3DConfig): void {
    this.config = config
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.running ? config.masterVolume : 0, this.context.currentTime, 0.03)
    }
  }

  getConfig(): Spotter3DConfig {
    return this.config
  }

  isRunning(): boolean {
    return this.running
  }

  // Begin playback. Safe to call before any user gesture: it creates/holds the
  // AudioContext (which starts SUSPENDED under Chromium's autoplay policy) and
  // arms the master gain. Actual sound only flows once resume() succeeds after
  // the app-wide gesture unlock — so this never throws in the telemetry path.
  start(): void {
    this.running = true
    const ctx = this.ensureContext()
    if (!ctx || !this.master) return
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    this.master.gain.setTargetAtTime(this.config.masterVolume, ctx.currentTime, 0.05)
  }

  stop(): void {
    this.running = false
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.05)
    }
  }

  // Resume the AudioContext (call from a user gesture). Resolves regardless of
  // success; isUnlocked()/audioState() report whether sound can actually flow.
  async resume(): Promise<void> {
    const ctx = this.ensureContext()
    if (!ctx) return
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {
        // Stays suspended until a real user gesture lands.
      }
    }
  }

  // True once the context is actually running (audio can be heard).
  isUnlocked(): boolean {
    return this.context?.state === 'running'
  }

  audioState(): AudioContextState | 'unavailable' {
    return this.context ? this.context.state : 'unavailable'
  }

  // Drive the voices from a telemetry snapshot. Returns the computed cues so the
  // caller can also render a visual radar.
  update(snap: TelemetrySnapshot | null): SpatialCue[] {
    const cues = computeSpatialCues(snap, this.config)
    if (!this.running) return cues
    const ctx = this.ensureContext()
    if (!ctx) return cues
    for (let i = 0; i < this.voices.length; i += 1) {
      this.applyCue(this.voices[i], cues[i] ?? null)
    }
    return cues
  }

  // Fire a one-shot positioned blip (for the view's test buttons). Accepts the
  // stereo sides plus 'behind' so the user can audition front/back imaging.
  test(position: Spotter3DTestPosition, intensity = 0.85): void {
    const ctx = this.ensureContext()
    if (!ctx || !this.master) return
    void this.resume()
    const reach = Math.max(0.5, this.config.panWidthM) * 0.85
    let x = 0
    let z = reach // default: ahead/center
    let side: SpatialSide = 'center'
    if (position === 'left') {
      x = -reach
      z = reach * 0.25
      side = 'left'
    } else if (position === 'right') {
      x = reach
      z = reach * 0.25
      side = 'right'
    } else if (position === 'behind') {
      x = 0
      z = -reach
      side = 'center'
    }
    const cue: SpatialCue = {
      id: -99,
      side,
      pan: clampPan(x / Math.max(0.5, this.config.panWidthM)),
      front: z >= 0,
      x,
      z,
      distanceM: Math.hypot(x, z),
      intensity: clamp01(intensity)
    }
    this.playBlip(ctx, cue)
  }

  dispose(): void {
    this.running = false
    for (const voice of this.voices) {
      try {
        if (voice.started) voice.osc.stop()
        voice.osc.disconnect()
        voice.gain.disconnect()
        voice.panner.disconnect()
      } catch {
        // ignore teardown races
      }
    }
    this.voices = []
    this.master?.disconnect()
    this.master = null
    if (this.context) void this.context.close().catch(() => undefined)
    this.context = null
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context
    const AudioCtor = window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext
    if (!AudioCtor) return null
    try {
      const ctx = new AudioCtor()
      const master = ctx.createGain()
      master.gain.value = 0
      master.connect(ctx.destination)
      this.context = ctx
      this.master = master
      this.voices = Array.from({ length: 6 }, () => this.createVoice(ctx, master))
      return ctx
    } catch {
      return null
    }
  }

  private createVoice(ctx: AudioContext, master: GainNode): Voice {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const panner = ctx.createPanner()
    osc.type = 'triangle'
    osc.frequency.value = this.config.toneHz
    gain.gain.value = 0
    // HRTF + inverse-distance attenuation gives a believable "out there in space"
    // image. refDistance ~2 m keeps alongside cars present without clipping, and
    // maxDistance/rolloff bound how quickly far cars fade so they never vanish
    // abruptly (which would read as a glitch).
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'inverse'
    panner.refDistance = 2
    panner.maxDistance = Math.max(4, this.config.maxDistanceM)
    panner.rolloffFactor = 1.4
    this.setPannerPosition(panner, 0, 0, 5)
    osc.connect(gain)
    gain.connect(panner)
    panner.connect(master)
    let started = false
    try {
      osc.start()
      started = true
    } catch {
      started = false
    }
    return { osc, gain, panner, started }
  }

  private applyCue(voice: Voice, cue: SpatialCue | null): void {
    const ctx = this.context
    if (!ctx) return
    const now = ctx.currentTime
    if (!cue) {
      // Smoothly duck an unused voice to silence (no zipper / click).
      voice.gain.gain.setTargetAtTime(0, now, 0.08)
      return
    }
    // Front/back disambiguation: cars behind are pitched clearly lower; a small
    // proximity-driven lift makes a closing car sound a touch more urgent.
    const base = this.config.toneHz
    const proximityLift = 0.92 + 0.16 * clamp01(cue.intensity)
    const freq = base * (cue.front ? 1 : 0.72) * proximityLift
    voice.osc.frequency.setTargetAtTime(freq, now, 0.06)
    this.setPannerPosition(voice.panner, cue.x, 0, -cue.z)
    // Ramp gain (longer constant) so position/volume changes glide instead of
    // stepping — the main defence against zipper noise between telemetry frames.
    voice.gain.gain.setTargetAtTime(clamp01(cue.intensity) * 0.35, now, 0.08)
  }

  private playBlip(ctx: AudioContext, cue: SpatialCue): void {
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const panner = ctx.createPanner()
    osc.type = 'triangle'
    osc.frequency.value = this.config.toneHz * (cue.front ? 1 : 0.72)
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'inverse'
    panner.refDistance = 2
    panner.maxDistance = Math.max(4, this.config.maxDistanceM)
    panner.rolloffFactor = 1.4
    this.setPannerPosition(panner, cue.x, 0, -cue.z)
    const peak = clamp01(cue.intensity) * 0.4
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32)
    osc.connect(gain)
    gain.connect(panner)
    panner.connect(this.master ?? ctx.destination)
    osc.start(now)
    osc.stop(now + 0.36)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
      panner.disconnect()
    }
  }

  // PannerNode position via AudioParams when available, falling back to the
  // deprecated setPosition for older engines.
  private setPannerPosition(panner: PannerNode, x: number, y: number, z: number): void {
    const ctx = this.context
    const t = ctx ? ctx.currentTime : 0
    if (panner.positionX) {
      panner.positionX.setTargetAtTime(x, t, 0.03)
      panner.positionY.setTargetAtTime(y, t, 0.03)
      panner.positionZ.setTargetAtTime(z, t, 0.03)
    } else {
      const legacy = panner as PannerNode & { setPosition?: (x: number, y: number, z: number) => void }
      legacy.setPosition?.(x, y, z)
    }
  }
}
