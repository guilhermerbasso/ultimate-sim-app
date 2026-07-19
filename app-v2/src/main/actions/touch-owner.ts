export type TouchActionOwnerReleaser = (webContentsId: number) => Promise<void>

let liveReleaser: TouchActionOwnerReleaser | null = null

export function registerTouchActionOwnerReleaser(releaser: TouchActionOwnerReleaser): () => void {
  liveReleaser = releaser
  return () => {
    if (liveReleaser === releaser) liveReleaser = null
  }
}

export function releaseTouchActionsForWebContents(webContentsId: number): Promise<void> {
  return liveReleaser?.(webContentsId) ?? Promise.resolve()
}