import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useRef,
  useState
} from 'react'
import {
  ACCESSIBILITY_CUE_CHANNELS,
  cueRouteHasModality,
  type CueHapticPattern,
  type CueRoute
} from '../../../shared/accessibility-cues'
import { tt, type ResolvedLanguage } from '../i18n'
import { playAccessibilityHaptic } from '../lib/haptics-runtime'
import { speakViaTts } from '../lib/tts-runtime'

const SEVERITY_RANK: Record<CueRoute['severity'], number> = {
  info: 0,
  warning: 1,
  critical: 2
}

export function shouldReplaceActiveCue(
  active: CueRoute | null,
  incoming: CueRoute
): boolean {
  if (!active) return true
  return SEVERITY_RANK[incoming.severity] >= SEVERITY_RANK[active.severity]
}

function isHapticPattern(value: unknown): value is CueHapticPattern {
  return value === 'single' || value === 'double' || value === 'triple' || value === 'long'
}

export function AccessibilityCueLayer({
  language
}: {
  language: ResolvedLanguage
}): ReactElement | null {
  const [route, setRoute] = useState<CueRoute | null>(null)
  const activeRef = useRef<CueRoute | null>(null)
  const languageRef = useRef(language)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    languageRef.current = language
  }, [language])

  useEffect(() => {
    const clearTimer = (): void => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }

    const off = window.ipc.subscribe<CueRoute>(
      ACCESSIBILITY_CUE_CHANNELS.routedEvent,
      (incoming) => {
        if (incoming.source !== 'live' || incoming.status === 'blocked') return
        if (!shouldReplaceActiveCue(activeRef.current, incoming)) return

        const audio = incoming.outputs.find((output) => output.modality === 'audio')
        if (audio) {
          void speakViaTts(incoming.message, {
            lang: languageRef.current,
            source: 'accessibility-cue',
            tipId: incoming.eventId,
            spatialPan: audio.spatialPan
          })
        }

        const haptic = incoming.outputs.find(
          (output) =>
            output.modality === 'haptic' &&
            output.delivery === 'hardware' &&
            isHapticPattern(output.pattern)
        )
        if (haptic && isHapticPattern(haptic.pattern)) {
          playAccessibilityHaptic(haptic.pattern, haptic.intensity ?? 0.7)
        }

        const visual =
          cueRouteHasModality(incoming, 'caption') ||
          cueRouteHasModality(incoming, 'symbol')
        if (!visual) return

        clearTimer()
        activeRef.current = incoming
        setRoute(incoming)
        if (!incoming.presentation.persistentCaptions) {
          clearTimerRef.current = setTimeout(() => {
            activeRef.current = null
            setRoute(null)
            clearTimerRef.current = null
          }, incoming.presentation.captionDurationMs)
        }
      }
    )

    return () => {
      off()
      clearTimer()
      activeRef.current = null
    }
  }, [])

  if (!route) return null
  const symbol = route.outputs.find((output) => output.modality === 'symbol')?.symbol
  const assertive = route.severity === 'critical'

  return (
    <aside
      className={`accessibility-cue-layer accessibility-cue-layer--${route.severity}`}
      data-high-contrast={route.presentation.highContrast ? 'true' : undefined}
      data-reduced-motion={route.presentation.reducedMotion ? 'true' : undefined}
      role={assertive ? 'alert' : 'status'}
      aria-atomic="true"
      aria-live={assertive ? 'assertive' : 'polite'}
      style={{
        '--cue-text-scale': route.presentation.textScale
      } as CSSProperties}
    >
      {symbol && (
        <span className="accessibility-cue-layer__symbol" aria-hidden="true">
          {symbol}
        </span>
      )}
      <span className="accessibility-cue-layer__copy">
        <strong>
          {tt(language, `accessibilityCues.severity.${route.severity}`)}
        </strong>
        <span>{route.message}</span>
      </span>
      <button
        className="accessibility-cue-layer__dismiss"
        type="button"
        aria-label={tt(language, 'accessibilityCues.dismiss')}
        onClick={() => {
          if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
          clearTimerRef.current = null
          activeRef.current = null
          setRoute(null)
        }}
      >
        ×
      </button>
    </aside>
  )
}
