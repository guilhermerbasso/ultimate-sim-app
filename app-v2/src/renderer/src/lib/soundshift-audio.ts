type AudioContextConstructor = typeof AudioContext

type AudioContextWindow = Window & {
  webkitAudioContext?: AudioContextConstructor
}

let audioContext: AudioContext | null = null

export function ensureAudio(): AudioContext {
  const AudioCtor = window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext
  if (!AudioCtor) throw new Error('AudioContext is not available in this environment.')

  if (!audioContext) audioContext = new AudioCtor()
  if (audioContext.state === 'suspended') void audioContext.resume().catch(() => undefined)
  return audioContext
}

export function playBeep(toneHz: number, ms: number, volume: number): void {
  try {
    const context = ensureAudio()
    const start = (): void => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const now = context.currentTime
      const duration = Math.max(0.02, Math.min(0.5, ms / 1000))
      const safeVolume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.5))
      const peak = Math.max(0.0001, safeVolume * 0.42)
      const attack = Math.min(0.008, duration * 0.25)
      const releaseStart = Math.max(attack + 0.004, duration - 0.018)

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(Math.max(120, Math.min(6000, toneHz)), now)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(peak, now + attack)
      gain.gain.setTargetAtTime(peak * 0.82, now + attack, 0.025)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseStart)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(now)
      oscillator.stop(now + duration + 0.02)
      oscillator.onended = () => {
        oscillator.disconnect()
        gain.disconnect()
      }
    }

    if (context.state === 'suspended') {
      void context.resume().then(start).catch(() => undefined)
      return
    }

    start()
  } catch {
    // Audio can be unavailable or blocked before the first browser gesture.
  }
}
