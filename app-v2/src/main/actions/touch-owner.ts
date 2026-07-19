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
  ownerVersions: Map<string, number>
  operations: Set<Promise<unknown>>
  releases: Map<string, { ownerVersion: number; promise: Promise<void> }>
  releaseErrors: unknown[]
  unregisterPromise: Promise<void> | null
}

let liveSemanticRuntime: RegisteredTouchSemanticRuntime | null = null

function registerOwner(registration: RegisteredTouchSemanticRuntime, ownerKey: string): void {
  registration.owners.add(ownerKey)
  registration.ownerVersions.set(
    ownerKey,
    (registration.ownerVersions.get(ownerKey) ?? 0) + 1
  )
}

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
  const ownerVersion = registration.ownerVersions.get(ownerKey) ?? 0
  const existing = registration.releases.get(ownerKey)
  if (existing?.ownerVersion === ownerVersion) return existing.promise
  let release: Promise<void>
  try {
    const releaseOwner = (): Promise<void> =>
      Promise.resolve(registration.runtime.releaseOwner(ownerKey))
    release = trackRuntimeOperation(
      registration,
      existing
        ? existing.promise.catch(() => undefined).then(releaseOwner)
        : releaseOwner()
    )
  } catch (error) {
    release = Promise.reject(error)
  }
  const releaseRecord = { ownerVersion, promise: release }
  registration.releases.set(ownerKey, releaseRecord)
  void release.then(
    () => {
      if ((registration.ownerVersions.get(ownerKey) ?? 0) === ownerVersion) {
        registration.owners.delete(ownerKey)
        registration.ownerVersions.delete(ownerKey)
      }
      if (registration.releases.get(ownerKey) === releaseRecord) registration.releases.delete(ownerKey)
    },
    (error) => {
      if ((registration.ownerVersions.get(ownerKey) ?? 0) === ownerVersion) {
        registration.owners.delete(ownerKey)
        registration.ownerVersions.delete(ownerKey)
      }
      registration.releaseErrors.push(error)
      if (registration.releases.get(ownerKey) === releaseRecord) registration.releases.delete(ownerKey)
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
    ownerVersions: new Map(),
    operations: new Set(),
    releases: new Map(),
    releaseErrors: [],
    unregisterPromise: null
  }
  liveSemanticRuntime = registration
  return () => {
    if (registration.unregisterPromise) return registration.unregisterPromise
    registration.acceptingActions = false
    registration.unregisterPromise = (async () => {
      do {
        await Promise.allSettled(
          [...registration.owners].map((ownerKey) =>
            releaseRegisteredOwner(registration, ownerKey)
          )
        )
        if (registration.operations.size > 0) {
          await Promise.allSettled([...registration.operations])
        }
        await new Promise<void>((resolve) => setImmediate(resolve))
      } while (registration.operations.size > 0 || registration.owners.size > 0)
      if (liveSemanticRuntime === registration) liveSemanticRuntime = null
      if (registration.releaseErrors.length > 0) throw registration.releaseErrors[0]
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
  registerOwner(registration, ownerKey)
  try {
    return trackRuntimeOperation(
      registration,
      Promise.resolve(registration.runtime.execute(request, ownerKey))
    )
  } catch (error) {
    return Promise.reject(error)
  }
}

export function executeTouchSemanticCleanupAction(
  request: TouchSemanticActionRequest,
  ownerKey: string
): Promise<TouchSemanticActionResult> {
  const registration = liveSemanticRuntime
  if (!registration) {
    return Promise.resolve({ ok: false, message: 'Touch action runtime is unavailable.' })
  }
  registerOwner(registration, ownerKey)
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
