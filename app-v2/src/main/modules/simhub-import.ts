import type { ModuleContext } from '../module-context'
import { getDeviceConfigStore } from '../devices/store'
import { detectSimHub, buildProfileFromParsed, matrixLayoutFromParsed } from '../simhub/import'
import { SIMHUB_CHANNELS } from '../../shared/simhub'
import type { SimHubDetection, SimHubImportResult } from '../../shared/simhub'

export function register(ctx: ModuleContext): void {
  ctx.ipcMain.handle(SIMHUB_CHANNELS.detect, async (): Promise<SimHubDetection> => {
    return detectSimHub(ctx.app)
  })

  ctx.ipcMain.handle(SIMHUB_CHANNELS.import, async (): Promise<SimHubImportResult> => {
    const detection = await detectSimHub(ctx.app)
    if (!detection.found) throw new Error(detection.reason)

    const profilePartial = buildProfileFromParsed(detection.parsed)
    const layout = matrixLayoutFromParsed(detection.parsed)

    const store = getDeviceConfigStore(ctx.app)
    await store.ensureLoaded()
    const saved = await store.save(profilePartial)

    ctx.broadcast('devices:changed', store.list())
    return { profile: saved, layout }
  })
}
