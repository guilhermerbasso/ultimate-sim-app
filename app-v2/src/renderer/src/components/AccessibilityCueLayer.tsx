import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useRef,
  useState
} from 'react'
import {
  ACCESSIBILITY_CUE_CHANNELS,
  cueRouteSemanticKey,
  cueSeverityPriority,
  effectiveCueModalities,
  getActiveCueProfile,
  isActuatingHapticIntensity,
  type AccessibilityCueStateEnvelope,
  type CueHapticPattern,
  type CueProfile,
  type CueRoute
} from '../../../shared/accessibility-cues'
import type { UnitSystem } from '../../../shared/units'
import { tt, type ResolvedLanguage } from '../i18n'
import {
  localizeCueMessage,
  localizeCueSymbolLabel
} from '../lib/accessibility-cue-localization'
import { CueModalityDeliveryQueue } from '../lib/accessibility-cue-arbiter'
import {
  playAccessibilityHaptic,
  stopAccessibilityHaptic
} from '../lib/haptics-runtime'
import {
  speakViaIsolatedTts,
  stopIsolatedTts
} from '../lib/tts-runtime'
import { useUnitSystem } from '../lib/units'

export interface VisualCueEntry {
  id: string
  renderKey: string
  semanticKey: string
  route: CueRoute
  message: string
  hasCaption: boolean
  persistentCaption: boolean
  symbol?: string
  symbolLabel?: string
}

export const MAX_VISUAL_CUE_ENTRIES = 8

export function visualCueSemanticKey(route: CueRoute): string {
  return cueRouteSemanticKey(route)
}

export function visualCueEntry(
  route: CueRoute,
  message: string,
  symbolLabel: string | undefined
): VisualCueEntry | null {
  const caption = route.outputs.find((output) => output.modality === 'caption')
  const symbol = route.outputs.find((output) => output.modality === 'symbol')
  if (!caption && !symbol) return null
  const semanticKey = visualCueSemanticKey(route)
  const persistentCaption = Boolean(
    caption && route.presentation.persistentCaptions
  )
  return {
    id: route.instanceId,
    renderKey: persistentCaption
      ? `persistent-caption:${semanticKey}`
      : route.instanceId,
    semanticKey,
    route,
    message,
    hasCaption: Boolean(caption),
    persistentCaption,
    symbol: symbol?.symbol,
    symbolLabel
  }
}

function severityRank(entry: VisualCueEntry): number {
  return { info: 0, warning: 1, critical: 2 }[entry.route.severity]
}

function sortVisualCues(entries: VisualCueEntry[]): VisualCueEntry[] {
  return entries.sort((left, right) => {
    const severity = severityRank(right) - severityRank(left)
    return severity || left.route.timestamp - right.route.timestamp
  })
}

export function appendVisualCue(
  current: readonly VisualCueEntry[],
  incoming: VisualCueEntry
): VisualCueEntry[] {
  const next = [
    ...current.filter(
      (entry) =>
        entry.id !== incoming.id &&
        !(
          entry.hasCaption &&
          incoming.hasCaption &&
          entry.semanticKey === incoming.semanticKey &&
          (entry.persistentCaption || incoming.persistentCaption)
        )
    ),
    incoming
  ]
  if (next.length <= MAX_VISUAL_CUE_ENTRIES) return sortVisualCues(next)

  const retainedIds = new Set(
    [...next]
      .sort(
        (left, right) =>
          severityRank(right) - severityRank(left) ||
          right.route.timestamp - left.route.timestamp
      )
      .slice(0, MAX_VISUAL_CUE_ENTRIES)
      .map((entry) => entry.id)
  )
  return sortVisualCues(next.filter((entry) => retainedIds.has(entry.id)))
}

export function relocalizeVisualCues(
  entries: readonly VisualCueEntry[],
  language: ResolvedLanguage,
  unitSystem: UnitSystem
): VisualCueEntry[] {
  return entries.map((entry) => {
    const symbol = entry.route.outputs.find(
      (output) => output.modality === 'symbol'
    )
    return {
      ...entry,
      message: localizeCueMessage(entry.route, language, unitSystem),
      symbolLabel: symbol
        ? localizeCueSymbolLabel(symbol, language)
        : undefined
    }
  })
}

export function reconcileVisualCuesForProfile(
  entries: readonly VisualCueEntry[],
  profile: CueProfile,
  profileRevision?: number
): VisualCueEntry[] {
  return entries.flatMap((entry) => {
    const enabled = effectiveCueModalities(profile, entry.route.eventId)
    if (
      entry.persistentCaption &&
      (!enabled.caption || !profile.persistentCaptions)
    ) {
      return []
    }
    const hasCaption = entry.hasCaption && enabled.caption
    const symbol = enabled.symbol ? entry.symbol : undefined
    if (!hasCaption && !symbol) return []
    return [{
      ...entry,
      hasCaption,
      symbol,
      persistentCaption: entry.persistentCaption && hasCaption,
      route: {
        ...entry.route,
        presentation: {
          profileId: profile.id,
          profileKind: profile.kind,
          profileRevision,
          textScale: profile.textScale,
          highContrast: profile.highContrast,
          persistentCaptions: profile.persistentCaptions,
          captionDurationMs: profile.captionDurationMs,
          reducedMotion: profile.reducedMotion
        }
      }
    }]
  })
}

export function isCueRouteCurrent(
  route: CueRoute,
  activeProfileId: string | null,
  profileRevision: number | null
): boolean {
  if (
    activeProfileId &&
    route.presentation.profileId !== activeProfileId
  ) {
    return false
  }
  return !(
    profileRevision !== null &&
    route.presentation.profileRevision !== undefined &&
    route.presentation.profileRevision !== profileRevision
  )
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

export function visualCueAccessibility(entry: VisualCueEntry): {
  role: 'alert' | 'status' | 'group'
  ariaLive?: 'assertive' | 'polite'
  announceCaption: boolean
} {
  if (!entry.hasCaption) {
    return { role: 'group', announceCaption: false }
  }
  return entry.route.severity === 'critical'
    ? { role: 'alert', ariaLive: 'assertive', announceCaption: true }
    : { role: 'status', ariaLive: 'polite', announceCaption: true }
}

function isHapticPattern(value: unknown): value is CueHapticPattern {
  return value === 'single' || value === 'double' || value === 'triple' || value === 'long'
}

function hapticSpacing(pattern: CueHapticPattern): number {
  if (pattern === 'long') return 650
  if (pattern === 'triple') return 720
  if (pattern === 'double') return 500
  return 300
}

export function AccessibilityCueLayer({
  language
}: {
  language: ResolvedLanguage
}): ReactElement | null {
  const unitSystem = useUnitSystem()
  const [entries, setEntries] = useState<VisualCueEntry[]>([])
  const languageRef = useRef(language)
  const unitSystemRef = useRef(unitSystem)
  const settingsKeyRef = useRef(`${language}:${unitSystem}`)
  const lifecycleGenerationRef = useRef(0)
  const profileRevisionRef = useRef<number | null>(null)
  const activeProfileIdRef = useRef<string | null>(null)
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const audioQueueRef = useRef<CueModalityDeliveryQueue<{
    generation: number
    route: CueRoute
    message: string
    language: ResolvedLanguage
    spatialPan?: number
  }> | null>(null)
  const hapticQueueRef = useRef<CueModalityDeliveryQueue<{
    generation: number
    pattern: CueHapticPattern
    intensity: number
  }> | null>(null)
  if (!audioQueueRef.current) {
    audioQueueRef.current = new CueModalityDeliveryQueue(
      async (next, signal) => {
        if (
          signal.aborted ||
          next.generation !== lifecycleGenerationRef.current
        ) {
          return
        }
        await speakViaIsolatedTts(
          'accessibility-live',
          next.message,
          {
            lang: next.language,
            source: 'accessibility-cue',
            tipId: next.route.instanceId,
            spatialPan: next.spatialPan,
            semanticKey: cueRouteSemanticKey(next.route),
            priority: cueSeverityPriority(next.route.severity)
          }
        )
      },
      {
        maxPending: 8,
        onPreempt: () => stopIsolatedTts('accessibility-live')
      }
    )
  }
  if (!hapticQueueRef.current) {
    hapticQueueRef.current = new CueModalityDeliveryQueue(
      async (next, signal) => {
        if (
          signal.aborted ||
          next.generation !== lifecycleGenerationRef.current
        ) {
          return
        }
        playAccessibilityHaptic(next.pattern, next.intensity)
        await abortableDelay(hapticSpacing(next.pattern), signal)
      },
      {
        maxPending: 8,
        onPreempt: () => stopAccessibilityHaptic()
      }
    )
  }

  useEffect(() => {
    const settingsKey = `${language}:${unitSystem}`
    const changed = settingsKeyRef.current !== settingsKey
    settingsKeyRef.current = settingsKey
    languageRef.current = language
    unitSystemRef.current = unitSystem
    if (!changed) return
    lifecycleGenerationRef.current += 1
    audioQueueRef.current?.clear()
    hapticQueueRef.current?.clear()
    stopIsolatedTts('accessibility-live')
    stopAccessibilityHaptic()
    setEntries((current) =>
      relocalizeVisualCues(current, language, unitSystem)
    )
  }, [language, unitSystem])

  useEffect(() => {
    let disposed = false
    const applyEnvelope = (envelope: AccessibilityCueStateEnvelope): void => {
      if (
        disposed ||
        !envelope.ready ||
        (profileRevisionRef.current !== null &&
          envelope.revision <= profileRevisionRef.current)
      ) {
        return
      }
      profileRevisionRef.current = envelope.revision
      const profile = getActiveCueProfile(envelope.state)
      activeProfileIdRef.current = profile.id
      lifecycleGenerationRef.current += 1
      audioQueueRef.current?.clear()
      hapticQueueRef.current?.clear()
      stopIsolatedTts('accessibility-live')
      stopAccessibilityHaptic()
      setEntries((current) => {
        const next = reconcileVisualCuesForProfile(
          current,
          profile,
          envelope.revision
        )
        const retainedIds = new Set(next.map((entry) => entry.id))
        for (const entry of current) {
          if (retainedIds.has(entry.id)) continue
          const timer = timersRef.current.get(entry.id)
          if (timer) clearTimeout(timer)
          timersRef.current.delete(entry.id)
        }
        return next
      })
    }
    void window.ipc
      .invoke<AccessibilityCueStateEnvelope>(
        ACCESSIBILITY_CUE_CHANNELS.getState
      )
      .then(applyEnvelope)
      .catch(() => undefined)
    const off = window.ipc.subscribe<AccessibilityCueStateEnvelope>(
      ACCESSIBILITY_CUE_CHANNELS.stateEvent,
      applyEnvelope
    )
    return () => {
      disposed = true
      off()
    }
  }, [])

  useEffect(() => {
    const dismiss = (id: string): void => {
      const timer = timersRef.current.get(id)
      if (timer) clearTimeout(timer)
      timersRef.current.delete(id)
      setEntries((current) => current.filter((entry) => entry.id !== id))
    }

    const off = window.ipc.subscribe<CueRoute>(
      ACCESSIBILITY_CUE_CHANNELS.routedEvent,
      (route) => {
        if (route.source !== 'live' || route.status === 'blocked') return
        if (!isCueRouteCurrent(
          route,
          activeProfileIdRef.current,
          profileRevisionRef.current
        )) {
          return
        }
        const generation = lifecycleGenerationRef.current
        const semanticKey = visualCueSemanticKey(route)
        const priority = cueSeverityPriority(route.severity)
        const localizedMessage = localizeCueMessage(
          route,
          languageRef.current,
          unitSystemRef.current
        )

        const audio = route.outputs.find((output) => output.modality === 'audio')
        if (audio) {
          audioQueueRef.current?.enqueue(
            {
              generation,
              route,
              message: localizedMessage,
              language: languageRef.current,
              spatialPan: audio.spatialPan
            },
            { key: semanticKey, priority }
          )
        }

        const haptic = route.outputs.find(
          (output) =>
            output.modality === 'haptic' &&
            output.delivery === 'hardware' &&
            isHapticPattern(output.pattern)
        )
        const hapticIntensity = haptic?.intensity ?? 0.7
        if (
          haptic &&
          isHapticPattern(haptic.pattern) &&
          isActuatingHapticIntensity(hapticIntensity)
        ) {
          hapticQueueRef.current?.enqueue({
            generation,
            pattern: haptic.pattern,
            intensity: hapticIntensity
          }, { key: semanticKey, priority })
        }

        const symbol = route.outputs.find((output) => output.modality === 'symbol')
        const visual = visualCueEntry(
          route,
          localizedMessage,
          symbol
            ? localizeCueSymbolLabel(symbol, languageRef.current)
            : undefined
        )
        if (!visual) return
        setEntries((current) => {
          const next = appendVisualCue(current, visual)
          const retainedIds = new Set(next.map((entry) => entry.id))
          for (const entry of current) {
            if (retainedIds.has(entry.id)) continue
            const timer = timersRef.current.get(entry.id)
            if (timer) clearTimeout(timer)
            timersRef.current.delete(entry.id)
          }
          return next
        })

        if (!route.presentation.persistentCaptions || !visual.hasCaption) {
          const existing = timersRef.current.get(visual.id)
          if (existing) clearTimeout(existing)
          const timer = setTimeout(
            () => dismiss(visual.id),
            route.presentation.captionDurationMs
          )
          timersRef.current.set(visual.id, timer)
        }
      }
    )

    return () => {
      off()
      for (const timer of timersRef.current.values()) clearTimeout(timer)
      timersRef.current.clear()
      audioQueueRef.current?.clear()
      hapticQueueRef.current?.clear()
      stopIsolatedTts('accessibility-live')
      stopAccessibilityHaptic()
    }
  }, [])

  if (entries.length === 0) return null

  return (
    <div
      className="accessibility-cue-stack"
      aria-label={tt(language, 'accessibilityCues.liveRegion')}
    >
      {entries.map((entry) => {
        const { route } = entry
        const accessibility = visualCueAccessibility(entry)
        return (
          <aside
            key={entry.renderKey}
            className={`accessibility-cue-layer accessibility-cue-layer--${route.severity}`}
            data-high-contrast={route.presentation.highContrast ? 'true' : undefined}
            data-reduced-motion={route.presentation.reducedMotion ? 'true' : undefined}
            style={{
              '--cue-text-scale': route.presentation.textScale
            } as CSSProperties}
            role={accessibility.role}
            aria-live={accessibility.ariaLive}
            aria-atomic={entry.hasCaption ? true : undefined}
          >
            {entry.symbol && (
              <span
                className="accessibility-cue-layer__symbol"
                aria-hidden={entry.hasCaption ? 'true' : undefined}
                aria-label={entry.hasCaption ? undefined : entry.symbolLabel}
                role={entry.hasCaption ? undefined : 'img'}
              >
                {entry.symbol}
              </span>
            )}
            {entry.hasCaption && (
              <span className="accessibility-cue-layer__copy">
                <strong>
                  {tt(language, `accessibilityCues.severity.${route.severity}`)}
                </strong>
                <span>{entry.message}</span>
              </span>
            )}
            <button
              className="accessibility-cue-layer__dismiss"
              type="button"
              aria-label={tt(language, 'accessibilityCues.dismiss')}
              onClick={() => {
                const timer = timersRef.current.get(entry.id)
                if (timer) clearTimeout(timer)
                timersRef.current.delete(entry.id)
                setEntries((current) =>
                  current.filter((candidate) => candidate.id !== entry.id)
                )
              }}
            >
              ×
            </button>
          </aside>
        )
      })}
    </div>
  )
}
