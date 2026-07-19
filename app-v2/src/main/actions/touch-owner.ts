import type { TouchSemanticActionRequest } from '../../shared/touch-panel'

export type TouchActionOwnerReleaser = (webContentsId: number) => Promise<void>

let liveReleaser: TouchActionOwnerReleaser | null = null

export interface TouchSemanticActionResult {
  ok: boolean
  message: string
}

export interface TouchSemanticActionRuntime {
  execute(request: TouchSemanticActionRequest, ownerKey: string): Promise<TouchSemanticActionResult>
  releaseOwner(ownerKey: string): Promise<void>
}

interface RegisteredTouchSemanticRuntime {
  runtime: TouchSemanticActionRuntime
  acceptingActions: boolean
  owners: Set<string>
  operations: Set<Promise<unknown>>
  releases: Map<string, Promise<void>>
  unregisterPromise: Promise<void> | null
}

let liveSemanticRuntime: RegisteredTouchSemanticRuntime | null = null

export function registerTouchActionOwnerReleaser(releaser: TouchActionOwnerReleaser): () => void {
  liveReleaser = releaser
  return () => {
    if (liveReleaser === releaser) liveReleaser = null
  }
}

export function releaseTouchActionsForWebContents(webContentsId: number): Promise<void> {
  return liveReleaser?.(webContentsId) ?? Promise.resolve()
}

function trackRuntimeOperation<T>(
  registration: RegisteredTouchSemanticRuntime,
  operation: Promise<T>
): Promise<T> {
  registration.operations.add(operation)
  void operation.then(
    () => registration.operations.delete(operation),
    () => registration.operations.delete(operation)
  )
  return operation
}

function releaseRegisteredOwner(
  registration: RegisteredTouchSemanticRuntime,
  ownerKey: string
): Promise<void> {
  const existing = registration.releases.get(ownerKey)
  if (existing) return existing
  let release: Promise<void>
  try {
    release = trackRuntimeOperation(
      registration,
      Promise.resolve(registration.runtime.releaseOwner(ownerKey))
    )
  } catch (error) {
    release = Promise.reject(error)
  }
  registration.releases.set(ownerKey, release)
  void release.then(
    () => {
      registration.owners.delete(ownerKey)
      if (registration.releases.get(ownerKey) === release) registration.releases.delete(ownerKey)
    },
    () => {
      if (registration.releases.get(ownerKey) === release) registration.releases.delete(ownerKey)
    }
  )
  return release
}

export function registerTouchSemanticActionRuntime(runtime: TouchSemanticActionRuntime): () => Promise<void> {
  if (liveSemanticRuntime) {
    throw new Error('Touch semantic action runtime is already registered.')
  }
  const registration: RegisteredTouchSemanticRuntime = {
    runtime,
    acceptingActions: true,
    owners: new Set(),
    operations: new Set(),
    releases: new Map(),
    unregisterPromise: null
  }
  liveSemanticRuntime = registration
  return () => {
    if (registration.unregisterPromise) return registration.unregisterPromise
    registration.acceptingActions = false
    registration.unregisterPromise = (async () => {
      const releases = [...registration.owners].map((ownerKey) =>
        releaseRegisteredOwner(registration, ownerKey)
      )
      const results = await Promise.allSettled(releases)
      while (registration.operations.size > 0) {
        await Promise.allSettled([...registration.operations])
      }
      if (liveSemanticRuntime === registration) liveSemanticRuntime = null
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failed) throw failed.reason
    })()
    return registration.unregisterPromise
  }
}

export function hasTouchSemanticActionRuntime(): boolean {
  return liveSemanticRuntime?.acceptingActions === true
}

export function executeTouchSemanticAction(
  request: TouchSemanticActionRequest,
  ownerKey: string
): Promise<TouchSemanticActionResult> {
  const registration = liveSemanticRuntime
  if (!registration?.acceptingActions) {
    return Promise.resolve({ ok: false, message: 'Touch action runtime is unavailable.' })
  }
  registration.owners.add(ownerKey)
  try {
    return trackRuntimeOperation(
      registration,
      Promise.resolve(registration.runtime.execute(request, ownerKey))
    )
  } catch (error) {
    return Promise.reject(error)
  }
}

export function releaseTouchSemanticActionOwner(ownerKey: string): Promise<void> {
  const registration = liveSemanticRuntime
  return registration ? releaseRegisteredOwner(registration, ownerKey) : Promise.resolve()
}
