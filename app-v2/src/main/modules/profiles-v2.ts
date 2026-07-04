import type { RaceProfile } from '../../shared/raceprofiles'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { ModuleContext } from '../module-context'
import { RaceProfileStore } from '../raceprofiles/store'

export function register(ctx: ModuleContext): void {
  const store = new RaceProfileStore(ctx.app.getPath('userData'))
  let lastCarName: string | undefined
  let lastTrackName: string | undefined
  let lastSuggestedProfileId: string | null = null
  let suggestionGeneration = 0

  ctx.ipcMain.handle('profilesv2:list', () => store.list())
  ctx.ipcMain.handle('profilesv2:get', (_event, id: string) => store.get(id))
  ctx.ipcMain.handle('profilesv2:save', (_event, profile: RaceProfile) => store.save(profile))
  ctx.ipcMain.handle('profilesv2:delete', (_event, id: string) => store.delete(id))
  ctx.ipcMain.handle('profilesv2:getAutoSwitch', () => store.getAutoSwitch())
  ctx.ipcMain.handle('profilesv2:setAutoSwitch', (_event, enabled: boolean) => store.setAutoSwitch(enabled))

  ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
    if (!snapshot?.connected) {
      suggestionGeneration += 1
      // Reset the last car/track (and suggestion) so reconnecting with the same
      // car/track re-evaluates and can re-show the autoswitch prompt.
      lastCarName = undefined
      lastTrackName = undefined
      lastSuggestedProfileId = null
      return
    }

    const carName = normalizeTelemetryName(snapshot.carName)
    const trackName = normalizeTelemetryName(snapshot.trackName)
    if (carName === lastCarName && trackName === lastTrackName) return

    lastCarName = carName
    lastTrackName = trackName
    const generation = ++suggestionGeneration
    if (!carName && !trackName) {
      lastSuggestedProfileId = null
      return
    }

    void suggestMatchingProfile(
      store,
      ctx,
      carName,
      trackName,
      lastSuggestedProfileId,
      () => generation === suggestionGeneration && carName === lastCarName && trackName === lastTrackName
    ).then((suggestedProfileId) => {
      if (generation !== suggestionGeneration || carName !== lastCarName || trackName !== lastTrackName) return
      lastSuggestedProfileId = suggestedProfileId
    })
  })
}

async function suggestMatchingProfile(
  store: RaceProfileStore,
  ctx: ModuleContext,
  carName: string | undefined,
  trackName: string | undefined,
  lastSuggestedProfileId: string | null,
  isCurrent: () => boolean
): Promise<string | null> {
  if (!(await store.getAutoSwitch())) return lastSuggestedProfileId

  const profile = await store.findMatch(carName, trackName)
  if (!isCurrent()) return lastSuggestedProfileId
  if (!profile) return null
  if (profile.id === lastSuggestedProfileId) return lastSuggestedProfileId

  ctx.broadcast('profilesv2:suggest', { profileId: profile.id, carName, trackName })
  return profile.id
}

function normalizeTelemetryName(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}
