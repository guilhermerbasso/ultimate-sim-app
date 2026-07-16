export interface SubscribeWithHydrationOptions<T> {
  subscribe(listener: (value: T) => void): () => void
  hydrate(): Promise<T>
  apply(value: T): void
  onError?(error: unknown): void
}

export function subscribeWithHydration<T>({
  subscribe,
  hydrate,
  apply,
  onError
}: SubscribeWithHydrationOptions<T>): () => void {
  let active = true
  let liveVersion = 0
  const unsubscribe = subscribe((value) => {
    if (!active) return
    liveVersion += 1
    apply(value)
  })
  const hydrationVersion = liveVersion

  void hydrate().then(
    (value) => {
      if (active && liveVersion === hydrationVersion) apply(value)
    },
    (error: unknown) => {
      if (active && liveVersion === hydrationVersion) onError?.(error)
    }
  )

  return () => {
    active = false
    unsubscribe()
  }
}
