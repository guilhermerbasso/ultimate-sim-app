import type { TelemetrySnapshot } from '../../../shared/telemetry'

export interface RevisionedHydrationOptions<T> {
  subscribe(listener: (value: T) => void): () => void
  hydrate(): Promise<T>
  revision(value: T): number
  apply(value: T): void
  onError?(error: unknown): void
}

export function subscribeWithRevisionedHydration<T>({
  subscribe,
  hydrate,
  revision,
  apply,
  onError
}: RevisionedHydrationOptions<T>): () => void {
  let active = true
  let hasValue = false
  let newestRevision = Number.NEGATIVE_INFINITY
  let newestSource: 'hydrate' | 'live' | null = null
  const applyNewest = (value: T, source: 'hydrate' | 'live'): void => {
    if (!active) return
    const candidateRevision = revision(value)
    if (hasValue && candidateRevision < newestRevision) return
    if (hasValue && candidateRevision === newestRevision && source === 'hydrate' && newestSource === 'live') return
    hasValue = true
    newestRevision = candidateRevision
    newestSource = source
    apply(value)
  }
  const unsubscribe = subscribe((value) => applyNewest(value, 'live'))
  void hydrate().then(
    (value) => applyNewest(value, 'hydrate'),
    (error: unknown) => {
      if (active && !hasValue) onError?.(error)
    }
  )
  return () => {
    active = false
    unsubscribe()
  }
}

export interface TelemetryHydrationOptions {
  subscribe(listener: (value: TelemetrySnapshot | null) => void): () => void
  hydrate(): Promise<TelemetrySnapshot | null>
  apply(value: TelemetrySnapshot | null): void
  onError?(error: unknown): void
}

export function subscribeWithTelemetryHydration({
  subscribe,
  hydrate,
  apply,
  onError
}: TelemetryHydrationOptions): () => void {
  let active = true
  let latestLive: { value: TelemetrySnapshot | null } | null = null
  const unsubscribe = subscribe((value) => {
    if (!active) return
    latestLive = { value }
    apply(value)
  })
  void hydrate().then(
    (value) => {
      if (!active) return
      if (!latestLive) {
        apply(value)
        return
      }
      if (latestLive.value === null) return
      const hydratedRevision = value?.timestamp ?? Number.NEGATIVE_INFINITY
      const liveRevision = latestLive.value.timestamp ?? Number.NEGATIVE_INFINITY
      if (hydratedRevision > liveRevision) apply(value)
    },
    (error: unknown) => {
      if (active && !latestLive) onError?.(error)
    }
  )
  return () => {
    active = false
    unsubscribe()
  }
}
