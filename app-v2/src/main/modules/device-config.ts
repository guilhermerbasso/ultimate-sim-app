import {
  BOARDS,
  COMPONENT_TYPES,
  DEVICES_CHANNELS,
  type DeviceComponent,
  type DeviceProfile
} from '../../shared/devices'
import {
  formatAddressableLed,
  formatBrightness,
  formatBuzzer,
  formatGaugeAngle,
  formatOledRow,
  formatSegText,
  formatStripRgb
} from '../../shared/companion'
import type { ModuleContext } from '../module-context'
import type { SerialDevice } from '../serial/device'
import { getDeviceConfigStore } from '../devices/store'

// Backend for the SimHub-style Arduino hub: persists device profiles (board +
// components + pinout) and exposes CRUD + board/component catalogs + a per
// component "test output" over IPC. Per-component telemetry engines (rev lights,
// iFlag matrix, screens…) are layered on top in later phases — this module owns
// the configuration + a manual test path so users can verify wiring now.
export function register(ctx: ModuleContext): void {
  const store = getDeviceConfigStore(ctx.app)
  void store.ensureLoaded()

  const broadcastChanged = (): void => {
    ctx.broadcast(DEVICES_CHANNELS.changed, store.list())
  }

  ctx.ipcMain.handle(DEVICES_CHANNELS.list, async () => {
    await store.ensureLoaded()
    return store.list()
  })
  ctx.ipcMain.handle(DEVICES_CHANNELS.get, async (_event, id: string) => {
    await store.ensureLoaded()
    return store.get(id)
  })
  ctx.ipcMain.handle(DEVICES_CHANNELS.save, async (_event, profile: Partial<DeviceProfile>) => {
    const saved = await store.save(profile)
    broadcastChanged()
    return saved
  })
  ctx.ipcMain.handle(DEVICES_CHANNELS.remove, async (_event, id: string) => {
    await store.remove(id)
    broadcastChanged()
    return store.list()
  })
  ctx.ipcMain.handle(DEVICES_CHANNELS.getBoards, () => BOARDS)
  ctx.ipcMain.handle(DEVICES_CHANNELS.getComponentTypes, () => COMPONENT_TYPES)
  ctx.ipcMain.handle(DEVICES_CHANNELS.test, async (_event, profileId: string, componentId: string) => {
    await store.ensureLoaded()
    const profile = store.get(profileId)
    if (!profile) throw new Error('Device profile not found.')
    const component = profile.components.find((entry) => entry.id === componentId)
    if (!component) throw new Error('Component not found.')
    await testComponent(ctx, profile, component)
  })
}

// Resolve the GENERIC serial device a profile drives. Returns null when there is
// no linked device, it's missing/closed, or it is the SIM-X primary — the Hub
// never drives SIM-X (it has its own Rev Lights/OLED screens).
function resolveDevice(ctx: ModuleContext, profile: DeviceProfile): SerialDevice | null {
  if (!profile.deviceId) return null
  const device = ctx.serialHub.getDevice(profile.deviceId)
  if (!device || !device.isOpen()) return null
  const primaryId = ctx.serialHub.getPrimaryId()
  if (device.kind === 'sim-x' || (primaryId && device.id === primaryId)) return null
  return device
}

function testStripColors(count: number): string[] {
  const palette = ['ff0000', 'ff8800', 'ffff00', '00ff00', '00ffff', '0000ff', 'ff00ff', 'ffffff']
  const out: string[] = []
  for (let i = 0; i < Math.max(1, Math.min(32, count)); i++) out.push(palette[i % palette.length])
  return out
}

// Send a representative frame so the user can confirm the wiring. The Hub drives
// only generic companion devices (companion v2 frames); SIM-X is rejected above.
async function testComponent(
  ctx: ModuleContext,
  profile: DeviceProfile,
  component: DeviceComponent
): Promise<void> {
  const target = resolveDevice(ctx, profile)
  if (!target) {
    throw new Error(
      'Link this profile to a connected secondary Arduino. SIM-X is configured on the Rev Lights / OLED screens.'
    )
  }

  switch (component.type) {
    case 'rgbStrip': {
      await target.sendRaw(formatBrightness(component.brightness))
      const frame = formatStripRgb(testStripColors(component.ledCount))
      if (frame) await target.sendRaw(frame)
      break
    }
    case 'rgbMatrix': {
      // SINGLE SOURCE OF TRUTH: the iFlag matrix is driven exclusively by the
      // rgb-matrix module (rgbmatrix:* IPC), which renders through the saved
      // MatrixLayout + manual customMap and streams a single mapped frame. The
      // old generic row-by-row `Q` test here ignored that layout (so the first/
      // last columns were wrong/blank) — it was a divergent second path. The UI
      // now routes the My Hardware "Test" to `rgbmatrix:testMapped` instead, so
      // this branch must never send its own frames. Guard it so any stray caller
      // is told where the real test lives.
      throw new Error(
        'The iFlag (RGB Matrix) test is run by the "iFlag RGB Matrix" editor (rgbmatrix:testMapped), which respects the saved layout/map.'
      )
    }
    case 'screen': {
      await target.sendRaw(formatOledRow(0, 'TEST OK'))
      break
    }
    case 'segDisplay': {
      await target.sendRaw(formatSegText('8888', component.digits))
      break
    }
    case 'gauge': {
      await target.sendRaw(formatGaugeAngle(0, Math.round((component.minAngle + component.maxAngle) / 2)))
      break
    }
    case 'buzzer': {
      await target.sendRaw(formatBuzzer(2000, 150))
      break
    }
    case 'startLed': {
      const frame = formatAddressableLed(0, component.color)
      if (frame) await target.sendRaw(frame)
      break
    }
    case 'control':
      // Inputs have no output to test.
      break
    default:
      break
  }
}
