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

let liveSemanticRuntime: TouchSemanticActionRuntime | null = null

export function registerTouchActionOwnerReleaser(releaser: TouchActionOwnerReleaser): () => void {
  liveReleaser = releaser
  return () => {
    if (liveReleaser === releaser) liveReleaser = null
  }
}

export function releaseTouchActionsForWebContents(webContentsId: number): Promise<void> {
  return liveReleaser?.(webContentsId) ?? Promise.resolve()
}

export function registerTouchSemanticActionRuntime(runtime: TouchSemanticActionRuntime): () => void {
  liveSemanticRuntime = runtime
  return () => {
    if (liveSemanticRuntime === runtime) liveSemanticRuntime = null
  }
}

export function hasTouchSemanticActionRuntime(): boolean {
  return liveSemanticRuntime !== null
}

export function executeTouchSemanticAction(
  request: TouchSemanticActionRequest,
  ownerKey: string
): Promise<TouchSemanticActionResult> {
  return liveSemanticRuntime?.execute(request, ownerKey) ??
    Promise.resolve({ ok: false, message: 'Touch action runtime is unavailable.' })
}

export function releaseTouchSemanticActionOwner(ownerKey: string): Promise<void> {
  return liveSemanticRuntime?.releaseOwner(ownerKey) ?? Promise.resolve()
}
