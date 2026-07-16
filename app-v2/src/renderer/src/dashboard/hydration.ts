export interface SubscribeWithHydrationOptions<T> {
  subscribe(listener: (value: T) => void): () => void
  hydrate(): Promise<T>
  revision(value: T): number
  apply(value: T): void
  onError?(error: unknown): void
}

export function subscribeWithHydration<T>({
  subscribe,
  hydrate,
  revision,
  apply,
  onError
}: SubscribeWithHydrationOptions<T>): () => void {
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
  const unsubscribe = subscribe((value) => {
    applyNewest(value, 'live')
  })

  void hydrate().then(
    (value) => {
      applyNewest(value, 'hydrate')
    },
    (error: unknown) => {
      if (active && !hasValue) onError?.(error)
    }
  )

  return () => {
    active = false
    unsubscribe()
  }
}
