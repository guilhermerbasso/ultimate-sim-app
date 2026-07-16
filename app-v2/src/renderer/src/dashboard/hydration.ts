export interface SubscribeWithHydrationOptions<T> {
  subscribe(listener: (value: T) => void): () => void
  hydrate(): Promise<T>
  revision(value: T): number
  liveValueSupersedesHydration?(value: T): boolean
  apply(value: T): void
  onError?(error: unknown): void
}

export function subscribeWithHydration<T>({
  subscribe,
  hydrate,
  revision,
  liveValueSupersedesHydration,
  apply,
  onError
}: SubscribeWithHydrationOptions<T>): () => void {
  let active = true
  let latestLive: { value: T } | null = null
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
      if (liveValueSupersedesHydration?.(latestLive.value)) return
      if (revision(value) > revision(latestLive.value)) apply(value)
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
