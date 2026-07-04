import { useEffect, useRef, type MutableRefObject } from 'react'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import {
  DEFAULT_SOUNDS_CONFIG,
  SOUNDSHIFT_CHANNELS,
  carKeyOf,
  type SoundCue,
  type SoundsConfig
} from '../../../shared/soundshift'

type SinkCapableContext = AudioContext & {
  setSinkId?(sinkId: string): Promise<void>
}
type SinkCapableAudio = HTMLAudioElement & {
  setSinkId?(sinkId: string): Promise<void>
}
type AudioContextCtor = typeof AudioContext
type AudioContextWindow = Window & { webkitAudioContext?: AudioContextCtor }

// Shift fields (shiftIndicatorPct/shiftRpm) ride along the snapshot end-to-end so the
// learning path and any future renderer-side decision can see iRacing's optimal-shift data.
type ShiftSnapshot = Pick<TelemetrySnapshot, 'carName' | 'rpm' | 'maxRpm' | 'shiftIndicatorPct' | 'shiftRpm' | 'gear' | 'throttle'>

const MIN_GAIN = 0.0001

// Both '' and 'default' denote Chromium's system-default sink.
function isDefaultSink(id: string): boolean {
  return id === '' || id === 'default'
}

// A single persistent Web Audio engine drives every cue (test + telemetry). Using
// a long-lived AudioContext + scheduled oscillators (instead of `new Audio(dataURL)`)
// is reliable on Chromium: it resumes deterministically on the user-gesture test
// button (autoplay policy) and routes to a chosen device the same way haptics does:
//   • AudioContext.setSinkId(id) when available, else
//   • a hidden <audio> element fed by a MediaStreamDestination ("bridge"), whose
//     own setSinkId(id) selects the output device.
// The system default needs neither — master connects straight to ctx.destination.
class SoundshiftAudioEngine {
  private ctx: SinkCapableContext | null = null
  private master: GainNode | null = null
  private deviceId = ''
  private sinkNode: AudioNode | null = null
  private streamDest: MediaStreamAudioDestinationNode | null = null
  private bridgeAudio: SinkCapableAudio | null = null
  private routedDeviceId: string | null = null
  private routedMode: 'context' | 'bridge' | 'default' | null = null
  private sinkSwitchPromise: Promise<void> | null = null
  private sinkSwitchToken = 0

  isAvailable(): boolean {
    return Boolean(window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext)
  }

  setOutputDevice(deviceId: string | undefined): void {
    this.deviceId = deviceId ?? ''
    if (this.ctx) this.applyRoute()
  }

  private ensureContext(): SinkCapableContext {
    if (this.ctx) return this.ctx
    const Ctor = window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext
    if (!Ctor) throw new Error('Web Audio (AudioContext) is not available in this environment.')
    const ctx = new Ctor() as SinkCapableContext
    const master = ctx.createGain()
    master.gain.setValueAtTime(1, ctx.currentTime)
    this.ctx = ctx
    this.master = master
    this.applyRoute()
    return ctx
  }

  private async resume(): Promise<void> {
    const ctx = this.ctx
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {
        // Stays suspended until a real user gesture; playBeep surfaces that below.
      }
    }
  }

  private applyRoute(): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const id = this.deviceId
    const ctxHasSetSinkId = typeof ctx.setSinkId === 'function'
    const desiredMode: 'context' | 'bridge' | 'default' = ctxHasSetSinkId
      ? 'context'
      : isDefaultSink(id)
        ? 'default'
        : 'bridge'

    if (this.routedDeviceId === id && this.routedMode === desiredMode) {
      // Same target — re-apply the (idempotent) context sink id so a device that
      // (re)appeared is honoured without rebuilding the graph.
      if (desiredMode === 'context' && !this.sinkSwitchPromise) {
        void ctx.setSinkId?.(isDefaultSink(id) ? '' : id).catch(() => ctx.setSinkId?.('').catch(() => undefined))
      }
      return
    }

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
      this.trackSinkSwitch(ctx.setSinkId?.(isDefaultSink(id) ? '' : id).catch(() => ctx.setSinkId?.('').catch(() => undefined)))
    } else if (desiredMode === 'bridge') {
      const dest = this.ensureBridge(ctx)
      master.connect(dest)
      this.sinkNode = dest
      const audio = this.bridgeAudio
      if (audio && typeof audio.setSinkId === 'function') {
        this.trackSinkSwitch(audio.setSinkId(id).catch(() => audio.setSinkId?.('').catch(() => undefined)))
      } else {
        this.clearSinkSwitch()
      }
      void this.bridgeAudio?.play().catch(() => undefined)
    } else {
      master.connect(ctx.destination)
      this.sinkNode = ctx.destination
      this.clearSinkSwitch()
    }

    this.routedDeviceId = id
    this.routedMode = desiredMode
  }

  private trackSinkSwitch(promise: Promise<void> | undefined): void {
    if (!promise) {
      this.clearSinkSwitch()
      return
    }
    const token = ++this.sinkSwitchToken
    this.sinkSwitchPromise = promise.finally(() => {
      if (this.sinkSwitchToken === token) this.sinkSwitchPromise = null
    })
  }

  private clearSinkSwitch(): void {
    this.sinkSwitchToken += 1
    this.sinkSwitchPromise = null
  }

  private async waitForSinkSwitch(): Promise<void> {
    const pending = this.sinkSwitchPromise
    if (pending) await pending
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

  async playBeep(toneHz: number, ms: number, volume: number): Promise<void> {
    const ctx = this.ensureContext()
    const master = this.master
    if (!master) throw new Error('Audio engine is not ready.')

    await this.resume()
    this.applyRoute()
    await this.waitForSinkSwitch()
    if (ctx.state !== 'running') {
      throw new Error('O áudio está bloqueado até você interagir com o app (política de autoplay).')
    }

    const now = ctx.currentTime
    const frequency = clamp(toneHz, 120, 6000, 1320)
    const durationSec = clamp(ms / 1000, 0.02, 0.5, 0.07)
    const peak = clamp(volume, 0, 1, 0.5) * 0.6

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(frequency, now)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(MIN_GAIN, now)
    gain.gain.linearRampToValueAtTime(Math.max(MIN_GAIN, peak), now + 0.008)
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, now + durationSec)

    osc.connect(gain)
    gain.connect(master)
    osc.start(now)
    osc.stop(now + durationSec + 0.02)
    osc.addEventListener(
      'ended',
      () => {
        try {
          osc.disconnect()
          gain.disconnect()
        } catch {
          // Already torn down.
        }
      },
      { once: true }
    )
  }
}

const audioEngine = new SoundshiftAudioEngine()

export function setAudioOutputDevice(deviceId: string | undefined): void {
  audioEngine.setOutputDevice(deviceId)
}

export function ensureAudio(): void {
  if (!audioEngine.isAvailable()) throw new Error('Web Audio is not available in this environment.')
}

// Emits a single cue on the currently-selected output device. REJECTS on failure
// (no sink, autoplay-blocked, engine unavailable) so callers can surface the error
// — the telemetry cue path swallows it, the test button reports it via toast.
export async function playBeep(toneHz: number, ms: number, volume: number): Promise<void> {
  ensureAudio()
  await audioEngine.playBeep(toneHz, ms, volume)
}

export function useSoundshiftRuntime(): void {
  const configRef = useRef<SoundsConfig>(DEFAULT_SOUNDS_CONFIG)
  const lastSnapshotRef = useRef<ShiftSnapshot | null>(null)
  const lastLearnByGearRef = useRef<Record<number, number>>({})

  useEffect(() => {
    let disposed = false

    window.ipc
      .invoke<SoundsConfig>(SOUNDSHIFT_CHANNELS.getConfig)
      .then((config) => {
        if (!disposed) {
          configRef.current = config
          setAudioOutputDevice(config.outputDeviceId)
        }
      })
      .catch(() => undefined)

    const offConfig = window.ipc.subscribe<SoundsConfig>(SOUNDSHIFT_CHANNELS.configEvent, (config) => {
      configRef.current = config
      setAudioOutputDevice(config.outputDeviceId)
    })

    const offCue = window.ipc.subscribe<SoundCue>(SOUNDSHIFT_CHANNELS.cueEvent, (cue) => {
      // Telemetry-driven cues stay silent on failure (no toast spam); the test
      // button is the user-facing path that surfaces errors.
      void playBeep(cue.toneHz, cue.beepMs, cue.volume).catch(() => undefined)
    })

    const offTelemetry = window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', (snapshot) => {
      if (!snapshot) return
      processLearningSnapshot(snapshot, configRef.current, lastSnapshotRef, lastLearnByGearRef)
    })

    return () => {
      disposed = true
      offConfig()
      offCue()
      offTelemetry()
    }
  }, [])
}

function processLearningSnapshot(
  snapshot: ShiftSnapshot,
  config: SoundsConfig,
  lastSnapshotRef: MutableRefObject<ShiftSnapshot | null>,
  lastLearnByGearRef: MutableRefObject<Record<number, number>>
): void {
  const previous = lastSnapshotRef.current
  if (previous && snapshot.gear !== previous.gear) {
    maybeLearnUpshift(config, previous, snapshot, lastLearnByGearRef)
  }

  lastSnapshotRef.current = snapshot
}

function maybeLearnUpshift(
  config: SoundsConfig,
  previous: ShiftSnapshot,
  current: ShiftSnapshot,
  lastLearnByGearRef: MutableRefObject<Record<number, number>>
): void {
  if (!config.soundshift.autoLearn) return
  if (previous.gear < 1 || current.gear !== previous.gear + 1) return
  if (previous.throttle < 0.5 || current.throttle < 0.5) return
  if (!Number.isFinite(previous.rpm) || previous.rpm <= 0) return

  // De-contamination: never learn without a real car name. An empty/missing carName
  // collapses to the 'unknown' bucket that mixed distinct cars (different redlines).
  const carName = previous.carName ?? current.carName
  if (!carName || !carName.trim()) return

  // Clamp source: a learned upshift RPM must never exceed the car's redline (a missed or
  // late shift would otherwise poison the per-gear value). main clamps authoritatively too.
  const maxRpm = previous.maxRpm ?? current.maxRpm
  if (maxRpm != null && Number.isFinite(maxRpm) && maxRpm > 0 && previous.rpm > maxRpm) return

  const now = Date.now()
  const lastForGear = lastLearnByGearRef.current[previous.gear] ?? 0
  if (now - lastForGear < 250) return
  lastLearnByGearRef.current[previous.gear] = now

  const carKey = carKeyOf(carName)
  void window.ipc
    .invoke<SoundsConfig>(SOUNDSHIFT_CHANNELS.updateLearned, carKey, previous.gear, previous.rpm, carName, maxRpm)
    .catch(() => undefined)
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}
