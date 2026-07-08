// Haptics / Bass Shaker & Haptics — renderer runtime (the PRIMARY engine).
//
// Bass shakers are AUDIO transducers driven by an amplifier, so — exactly like
// SimHub "ShakeIt" — we SYNTHESIZE low-frequency effect waveforms with the Web
// Audio API and output them to a selectable audio device that feeds the shaker
// amp. Each effect is a sine OscillatorNode (low Hz) → GainNode (its intensity,
// driven by telemetry) → a shared master GainNode → the chosen sink.
//
// Graph per effect kind:
//   • continuous (engine, roadTexture): osc → vca, vca.gain tracks a smoothed level
//   • pulsed     (abs, wheelLock):      osc → vca, with a square LFO → vca.gain so
//                                       the amplitude pulses on/off rapidly
//   • transient  (gearShift, kerb, impact): osc → vca, a scheduled attack/decay
//                                       envelope fired on a telemetry edge/spike
//
// Output routing reuses the Sounds output-device idea: AudioContext.setSinkId()
// when Chromium/Electron exposes it, otherwise a MediaStreamDestination + a
// hidden <audio> element whose setSinkId() routes the stream (the bridge).
//
// The runtime is mounted ONCE at the app root via useHapticsRuntime(); the config
// UI (HapticsView) reads the same singleton engine for its live meters + tests.

import { useEffect, useRef } from 'react'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import {
  DEFAULT_HAPTICS_CONFIG,
  HAPTICS_CHANNELS,
  HAPTICS_EFFECT_IDS,
  clamp01,
  deriveHapticsFrame,
  effectLevel,
  engineCarrierHz,
  type HapticsConfig,
  type HapticsEffectId,
  type HapticsFrame
} from '../../../shared/haptics'

type SinkCapableContext = AudioContext & { setSinkId?(sinkId: string): Promise<void> }
type SinkCapableAudio = HTMLAudioElement & { setSinkId?(sinkId: string): Promise<void> }
type AudioContextCtor = typeof AudioContext
type AudioContextWindow = Window & { webkitAudioContext?: AudioContextCtor }

type EffectKind = 'continuous' | 'pulsed' | 'transient'

const EFFECT_KIND: Record<HapticsEffectId, EffectKind> = {
  engine: 'continuous',
  roadTexture: 'continuous',
  suspension: 'continuous',
  abs: 'pulsed',
  wheelLock: 'pulsed',
  gearShift: 'transient',
  kerb: 'transient',
  impact: 'transient',
  tcCut: 'transient',
  gearGrind: 'transient'
}

// Amplitude-modulation rate (Hz) for pulsed effects — how fast the on/off rumble is.
const PULSE_HZ: Partial<Record<HapticsEffectId, number>> = { abs: 14, wheelLock: 24 }

// One-shot envelope shape (seconds) for transient effects, plus a refractory floor
// (ms) so a sustained signal produces a pulse TRAIN rather than a constant tone.
const TRANSIENT_DECAY_SEC: Record<HapticsEffectId, number> = {
  engine: 0, gearShift: 0.09, abs: 0, wheelLock: 0, kerb: 0.07, roadTexture: 0, impact: 0.2,
  tcCut: 0.12, suspension: 0, gearGrind: 0.14
}
const TRANSIENT_REFRACTORY_MS: Record<HapticsEffectId, number> = {
  engine: 0, gearShift: 110, abs: 0, wheelLock: 0, kerb: 95, roadTexture: 0, impact: 240,
  tcCut: 80, suspension: 0, gearGrind: 180
}
const TRANSIENT_ATTACK_SEC = 0.006
const MIN_GAIN = 0.0001

interface Voice {
  kind: EffectKind
  osc: OscillatorNode
  vca: GainNode
  lfo?: OscillatorNode
  lfoGain?: GainNode
}

function smoothingTimeConstant(smoothing: number): number {
  return 0.005 + clamp01(smoothing) * 0.25
}

class HapticsEngine {
  private ctx: SinkCapableContext | null = null
  private master: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private meterBuf: Float32Array<ArrayBuffer> | null = null
  private readonly voices = new Map<HapticsEffectId, Voice>()
  private config: HapticsConfig = DEFAULT_HAPTICS_CONFIG

  // Output routing state.
  private sinkNode: AudioNode | null = null
  private streamDest: MediaStreamAudioDestinationNode | null = null
  private bridgeAudio: SinkCapableAudio | null = null
  private routedDeviceId: string | null = null
  private routedMode: 'context' | 'bridge' | 'default' | null = null

  // Smoothed continuous/pulsed levels (for the live meter); transient levels are
  // derived from their trigger timestamps on read.
  private readonly levels: Record<HapticsEffectId, number> = {
    engine: 0, gearShift: 0, abs: 0, wheelLock: 0, kerb: 0, roadTexture: 0, impact: 0,
    tcCut: 0, suspension: 0, gearGrind: 0
  }
  private readonly transientLastMs: Record<HapticsEffectId, number> = {
    engine: 0, gearShift: 0, abs: 0, wheelLock: 0, kerb: 0, roadTexture: 0, impact: 0,
    tcCut: 0, suspension: 0, gearGrind: 0
  }
  private readonly transientPeak: Record<HapticsEffectId, number> = {
    engine: 0, gearShift: 0, abs: 0, wheelLock: 0, kerb: 0, roadTexture: 0, impact: 0,
    tcCut: 0, suspension: 0, gearGrind: 0
  }
  private restoreMasterTimer: ReturnType<typeof setTimeout> | null = null

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  private ensureContext(): SinkCapableContext {
    if (this.ctx) return this.ctx
    const Ctor = window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext
    if (!Ctor) throw new Error('AudioContext is not available in this environment.')

    const ctx = new Ctor() as SinkCapableContext
    const master = ctx.createGain()
    master.gain.setValueAtTime(0, ctx.currentTime)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    master.connect(analyser) // passive tap — never disconnected on routing changes

    this.ctx = ctx
    this.master = master
    this.analyser = analyser
    this.meterBuf = new Float32Array(analyser.fftSize)

    for (const id of HAPTICS_EFFECT_IDS) this.buildVoice(id)
    return ctx
  }

  private buildVoice(id: HapticsEffectId): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return

    const kind = EFFECT_KIND[id]
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(this.config.effects[id].frequencyHz, ctx.currentTime)
    const vca = ctx.createGain()
    vca.gain.setValueAtTime(0, ctx.currentTime)
    osc.connect(vca)
    vca.connect(master)

    const voice: Voice = { kind, osc, vca }

    if (kind === 'pulsed') {
      const lfo = ctx.createOscillator()
      lfo.type = 'square'
      lfo.frequency.setValueAtTime(PULSE_HZ[id] ?? 16, ctx.currentTime)
      const lfoGain = ctx.createGain()
      lfoGain.gain.setValueAtTime(0, ctx.currentTime)
      lfo.connect(lfoGain)
      lfoGain.connect(vca.gain) // sums with the intrinsic base value → swings 0..level
      lfo.start()
      voice.lfo = lfo
      voice.lfoGain = lfoGain
    }

    osc.start()
    this.voices.set(id, voice)
  }

  isAvailable(): boolean {
    return Boolean(window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext)
  }

  resume(): void {
    const ctx = this.ctx
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  }

  // ─── Config ────────────────────────────────────────────────────────────────

  applyConfig(config: HapticsConfig): void {
    this.config = config
    if (!this.isAvailable()) return
    const ctx = this.ensureContext()
    this.resume()

    // Refresh fixed per-voice parameters and immediately silence disabled voices
    // (so toggling off is audible even when telemetry has stopped).
    const now = ctx.currentTime
    for (const id of HAPTICS_EFFECT_IDS) {
      const voice = this.voices.get(id)
      const eff = config.effects[id]
      if (!voice) continue
      if (voice.kind !== 'continuous' || id !== 'engine') {
        voice.osc.frequency.setTargetAtTime(eff.frequencyHz, now, 0.05)
      }
      if (voice.kind === 'pulsed') voice.lfo?.frequency.setValueAtTime(PULSE_HZ[id] ?? 16, now)
      if (!eff.enabled) this.silenceVoice(id)
    }

    this.setOutputDevice(config.outputDeviceId)
    this.applyMaster()
  }

  private applyMaster(): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const target = this.config.enabled && !this.config.muted ? clamp01(this.config.masterGain) : 0
    master.gain.setTargetAtTime(target, ctx.currentTime, 0.02)
  }

  setOutputDevice(deviceId: string): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const id = deviceId ?? ''

    const ctxHasSetSinkId = typeof ctx.setSinkId === 'function'
    const desiredMode: 'context' | 'bridge' | 'default' = ctxHasSetSinkId ? 'context' : id ? 'bridge' : 'default'
    if (this.routedDeviceId === id && this.routedMode === desiredMode) {
      // Same target — still (re)apply the context sink id, it's cheap and idempotent.
      if (desiredMode === 'context') void ctx.setSinkId?.(id).catch(() => ctx.setSinkId?.('').catch(() => undefined))
      return
    }

    // Detach master from the previous sink (keep the analyser tap intact).
    if (this.sinkNode) {
      try {
        master.disconnect(this.sinkNode)
      } catch {
        // Was not connected — ignore.
      }
      this.sinkNode = null
    }

    if (desiredMode === 'context') {
      master.connect(ctx.destination)
      this.sinkNode = ctx.destination
      void ctx.setSinkId?.(id).catch(() => ctx.setSinkId?.('').catch(() => undefined))
    } else if (desiredMode === 'bridge') {
      const dest = this.ensureBridge(ctx)
      master.connect(dest)
      this.sinkNode = dest
      const audio = this.bridgeAudio
      if (audio && typeof audio.setSinkId === 'function') {
        void audio.setSinkId(id).catch(() => audio.setSinkId?.('').catch(() => undefined))
      }
      void this.bridgeAudio?.play().catch(() => undefined)
    } else {
      master.connect(ctx.destination)
      this.sinkNode = ctx.destination
    }

    this.routedDeviceId = id
    this.routedMode = desiredMode
  }

  private ensureBridge(ctx: AudioContext): MediaStreamAudioDestinationNode {
    if (this.streamDest && this.bridgeAudio) return this.streamDest
    const dest = ctx.createMediaStreamDestination()
    const audio = new Audio() as SinkCapableAudio
    audio.autoplay = true
    audio.muted = false
    audio.srcObject = dest.stream
    this.streamDest = dest
    this.bridgeAudio = audio
    return dest
  }

  // ─── Per-tick update from telemetry ──────────────────────────────────────────

  update(frame: HapticsFrame): void {
    const ctx = this.ctx
    if (!ctx || !this.config.enabled) {
      // When disabled/missing keep the meter honest.
      if (!this.config.enabled) for (const id of HAPTICS_EFFECT_IDS) this.levels[id] = 0
      return
    }
    const cfg = this.config
    // Autoplay policy can leave the context suspended when haptics were enabled
    // from a previous session and the view was never opened — resume from the
    // telemetry path so output isn't silently dropped (mirrors soundshift).
    if (ctx.state === 'suspended') this.resume()

    this.driveContinuous('engine', effectLevel(frame.engine, cfg.effects.engine), engineCarrierHz(cfg.effects.engine, frame.engineRpmFrac))
    this.driveContinuous('roadTexture', effectLevel(frame.roadTexture, cfg.effects.roadTexture))
    this.driveContinuous('suspension', effectLevel(frame.suspension, cfg.effects.suspension))

    this.drivePulsed('abs', effectLevel(frame.absActive ? 1 : 0, cfg.effects.abs))
    this.drivePulsed('wheelLock', effectLevel(frame.wheelLock, cfg.effects.wheelLock))

    if (frame.gearShift) this.maybeTrigger('gearShift', cfg.effects.gearShift.enabled ? clamp01(cfg.effects.gearShift.intensity) : 0)
    this.maybeTrigger('kerb', effectLevel(frame.kerb, cfg.effects.kerb))
    this.maybeTrigger('impact', effectLevel(frame.impact, cfg.effects.impact))
    if (frame.tcCut) this.maybeTrigger('tcCut', cfg.effects.tcCut.enabled ? clamp01(cfg.effects.tcCut.intensity) : 0)
    if (frame.gearGrind) this.maybeTrigger('gearGrind', cfg.effects.gearGrind.enabled ? clamp01(cfg.effects.gearGrind.intensity) : 0)
  }

  // Release everything (telemetry lost). Continuous/pulsed ramp to silence.
  release(): void {
    for (const id of HAPTICS_EFFECT_IDS) {
      const kind = EFFECT_KIND[id]
      if (kind !== 'transient') this.silenceVoice(id)
      this.levels[id] = 0
    }
  }

  private driveContinuous(id: HapticsEffectId, level: number, freqHz?: number): void {
    const ctx = this.ctx
    const voice = this.voices.get(id)
    if (!ctx || !voice) return
    const now = ctx.currentTime
    const tc = smoothingTimeConstant(this.config.effects[id].smoothing)
    voice.vca.gain.setTargetAtTime(level, now, tc)
    if (freqHz != null) voice.osc.frequency.setTargetAtTime(freqHz, now, 0.06)
    this.levels[id] = level
  }

  private drivePulsed(id: HapticsEffectId, level: number): void {
    const ctx = this.ctx
    const voice = this.voices.get(id)
    if (!ctx || !voice || !voice.lfoGain) return
    const now = ctx.currentTime
    const tc = smoothingTimeConstant(this.config.effects[id].smoothing)
    const half = level / 2
    // Base (intrinsic) + LFO depth sum so the amplitude swings between 0 and level.
    voice.vca.gain.setTargetAtTime(half, now, tc)
    voice.lfoGain.gain.setTargetAtTime(half, now, tc)
    this.levels[id] = level
  }

  private maybeTrigger(id: HapticsEffectId, peak: number): void {
    if (peak <= 0) return
    const elapsed = performance.now() - this.transientLastMs[id]
    if (elapsed < TRANSIENT_REFRACTORY_MS[id]) return
    this.triggerTransient(id, peak)
  }

  private triggerTransient(id: HapticsEffectId, peak: number): void {
    const ctx = this.ctx
    const voice = this.voices.get(id)
    if (!ctx || !voice) return
    const now = ctx.currentTime
    const decay = TRANSIENT_DECAY_SEC[id]
    voice.osc.frequency.setValueAtTime(this.config.effects[id].frequencyHz, now)
    const g = voice.vca.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(MIN_GAIN, now)
    g.linearRampToValueAtTime(Math.max(MIN_GAIN, peak), now + TRANSIENT_ATTACK_SEC)
    g.exponentialRampToValueAtTime(MIN_GAIN, now + TRANSIENT_ATTACK_SEC + decay)
    this.transientLastMs[id] = performance.now()
    this.transientPeak[id] = peak
  }

  private silenceVoice(id: HapticsEffectId): void {
    const ctx = this.ctx
    const voice = this.voices.get(id)
    if (!ctx || !voice) return
    const now = ctx.currentTime
    voice.vca.gain.cancelScheduledValues(now)
    voice.vca.gain.setTargetAtTime(0, now, 0.04)
    if (voice.lfoGain) voice.lfoGain.gain.setTargetAtTime(0, now, 0.04)
    this.levels[id] = 0
  }

  // ─── Test / preview (driven by a user gesture from the View) ─────────────────

  testEffect(id: HapticsEffectId, config: HapticsConfig): void {
    this.applyConfig(config)
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    this.resume()

    // Force the master open for the burst so a test is audible even when the
    // global switch is off or muted, then restore the configured master.
    const audible = Math.max(0.7, clamp01(config.masterGain))
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setTargetAtTime(audible, ctx.currentTime, 0.01)
    if (this.restoreMasterTimer) clearTimeout(this.restoreMasterTimer)
    this.restoreMasterTimer = setTimeout(() => this.applyMaster(), 850)

    const eff = config.effects[id]
    const kind = EFFECT_KIND[id]
    const peak = Math.max(0.25, clamp01(eff.intensity))
    if (kind === 'transient') {
      this.transientLastMs[id] = 0 // bypass refractory for an explicit test
      this.triggerTransient(id, peak)
      return
    }
    this.burstEffect(id, peak, 650)
  }

  private burstEffect(id: HapticsEffectId, level: number, durationMs: number): void {
    const ctx = this.ctx
    const voice = this.voices.get(id)
    if (!ctx || !voice) return
    const now = ctx.currentTime
    if (id === 'engine') voice.osc.frequency.setTargetAtTime(engineCarrierHz(this.config.effects.engine, 0.5), now, 0.05)
    if (voice.kind === 'pulsed' && voice.lfoGain) {
      voice.vca.gain.setTargetAtTime(level / 2, now, 0.01)
      voice.lfoGain.gain.setTargetAtTime(level / 2, now, 0.01)
    } else {
      voice.vca.gain.setTargetAtTime(level, now, 0.01)
    }
    this.levels[id] = level
    setTimeout(() => this.silenceVoice(id), durationMs)
  }

  // ─── Meters (read by the UI via requestAnimationFrame) ───────────────────────

  getMeterLevel(): number {
    const analyser = this.analyser
    const buf = this.meterBuf
    if (!analyser || !buf) return 0
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)
    return clamp01(rms * 1.4)
  }

  getEffectLevels(): Record<HapticsEffectId, number> {
    const out = {} as Record<HapticsEffectId, number>
    const nowMs = performance.now()
    for (const id of HAPTICS_EFFECT_IDS) {
      if (EFFECT_KIND[id] === 'transient') {
        const decayMs = TRANSIENT_DECAY_SEC[id] * 1000
        const elapsed = nowMs - this.transientLastMs[id]
        out[id] = elapsed < decayMs ? clamp01(this.transientPeak[id] * (1 - elapsed / decayMs)) : 0
      } else {
        out[id] = this.levels[id]
      }
    }
    return out
  }
}

let engineSingleton: HapticsEngine | null = null

export function getHapticsEngine(): HapticsEngine {
  if (!engineSingleton) engineSingleton = new HapticsEngine()
  return engineSingleton
}

export function testHapticsEffect(id: HapticsEffectId, config: HapticsConfig): void {
  try {
    getHapticsEngine().testEffect(id, config)
  } catch {
    // AudioContext can be unavailable or blocked before the first gesture.
  }
}

export function setHapticsOutputDevice(deviceId: string): void {
  try {
    getHapticsEngine().setOutputDevice(deviceId)
  } catch {
    // Ignore — applied again on the next config push.
  }
}

export function getHapticsMeterLevel(): number {
  return engineSingleton ? engineSingleton.getMeterLevel() : 0
}

export function getHapticsEffectLevels(): Record<HapticsEffectId, number> {
  return getHapticsEngine().getEffectLevels()
}

// Mount ONCE at the app root (next to useSoundshiftRuntime): owns the live
// telemetry subscription that drives the bass-shaker engine for the whole app.
export function useHapticsRuntime(): void {
  const prevRef = useRef<TelemetrySnapshot | null>(null)

  useEffect(() => {
    let disposed = false
    const engine = getHapticsEngine()

    window.ipc
      .invoke<HapticsConfig>(HAPTICS_CHANNELS.getConfig)
      .then((config) => {
        if (!disposed) engine.applyConfig(config)
      })
      .catch(() => undefined)

    const offConfig = window.ipc.subscribe<HapticsConfig>(HAPTICS_CHANNELS.configEvent, (config) => {
      engine.applyConfig(config)
    })

    const offTelemetry = window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', (snapshot) => {
      if (!snapshot || !snapshot.connected) {
        prevRef.current = null
        engine.release()
        return
      }
      const frame = deriveHapticsFrame(snapshot, prevRef.current)
      engine.update(frame)
      prevRef.current = snapshot
    })

    return () => {
      disposed = true
      offConfig()
      offTelemetry()
    }
  }, [])
}
