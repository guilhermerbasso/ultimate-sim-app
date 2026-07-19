import type { ModuleContext } from '../module-context'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SimxAutostartController } from './simx-autostart'
import { GenericAutostartController } from './generic-autostart'
import { getSerialDevicesStore } from '../serial-devices/store'
import { settingsEvents } from '../settings/events'
import { logger } from './logger'
import type { SettingsStore } from '../settings/store'
import type { RevlightsEngine } from '../revlights/engine'
import type { RgbMatrixModule } from './rgb-matrix'
import { register as actionEngine } from './action-engine'
import { register as alerts } from './alerts'
import { register as appShellUi } from './app-shell-ui'
import { register as arduino } from './arduino'
import { register as arduinoSetup } from './arduino-setup'
import { register as dashboards } from './dashboards'
import { register as deviceConfig } from './device-config'
import { register as deviceOutput } from './device-output'
import { register as expressionEngine } from './expression-engine'
import { register as fuelStrategy } from './fuel-strategy'
import { register as iracingControl } from './iracing-control'
import { register as iracingDiagnostics } from './iracing-diagnostics'
import { register as iracingExtras } from './iracing-extras'
import { register as iracingProvider } from './iracing-provider'
import { register as lapTiming } from './lap-timing'
import { register as oledDashboard } from './oled-dashboard'
import { register as outputRouter } from './output-router'
import { register as overlayWidgets } from './overlay-widgets'
import { register as overlaysCore } from './overlays-core'
import { register as profilesV2 } from './profiles-v2'
import { register as recordingAnalysis } from './recording-analysis'
import { register as diagnosticsLog } from './diagnostics-log'
import { register as revlights } from './revlights'
import { register as setups } from './setups'
import { register as setupManager } from './setup-manager'
import { register as setupExperiment } from './setup-experiment'
import { register as simProviders } from './sim-providers'
import { register as soundshift } from './soundshift'
import { register as telemetry } from './telemetry'
import { register as tireStrategy } from './tire-strategy'
import { register as trackMap } from '../track-map'
import { register as pinoutFirmware } from '../devices/pinout-firmware'
import { register as esp32Wifi } from './esp32-wifi'
import { register as rgbMatrix } from './rgb-matrix'
import { register as customCatalog } from './custom-catalog'
import { register as career } from './career'
import { register as driverNotes } from './driver-notes'
import { register as spotter } from './spotter'
import { register as piperTts } from '../tts/piper'
import { register as haptics } from './haptics'
import { register as teamFuel } from './team-fuel'
import { register as tradingPaints } from './trading-paints'
import { register as coach } from './coach'
import { register as predictions } from './predictions'
import { register as paceModel } from './pace-model'
import { register as aiEngineer } from './ai-engineer'
import { register as proactiveEngineer } from './proactive-engineer'
import { register as strategy } from './strategy'
import { register as stintDebrief } from './stint-debrief'
import { register as incidentRecorder } from './incident-recorder'
import { register as storyEngine } from './story-engine'
import { register as communityLocal } from './community-local'
import { register as semanticSearch } from './semantic-search'
import { register as dashboardAi } from './dashboard-ai'
import { register as biometrics } from './biometrics'
import { register as hapticsZonal } from './haptics-zonal'
import { register as spotter3d } from './spotter3d'
import { register as stt } from './stt'
import { register as iflagDynamic } from './iflag-dynamic'
import { register as streaming } from './streaming'
import { register as stewardDesk } from './steward-desk'
import { register as streamPresentation } from './stream-presentation'
import { register as simhubImport } from './simhub-import'
import { register as configExport } from './config-export'
import { register as diagnosticLogger } from './logger'
import { register as bugReport } from './bug-report'
import { register as updater } from './updater'
import { register as pitPanel } from '../pitpanel/window'
import { register as touchPanel } from '../touchpanel/manager'
import { register as mqttTarget } from './mqtt-target'

// Registro central dos módulos. A telemetria vem primeiro (todos dependem dela).
// expressionEngine e outputRouter ficam fora do loop porque o orquestrador
// captura seus retornos para ligar o resolver de expressões do router.
const moduleRegistrars: Array<(ctx: ModuleContext) => void> = [
  telemetry,
  iracingProvider,
  iracingDiagnostics,
  iracingExtras,
  iracingControl,
  simProviders,
  oledDashboard,
  overlaysCore,
  overlayWidgets,
  fuelStrategy,
  tireStrategy,
  lapTiming,
  alerts,
  recordingAnalysis,
  diagnosticsLog,
  actionEngine,
  profilesV2,
  dashboards,
  deviceConfig,
  arduino,
  arduinoSetup,
  deviceOutput,
  trackMap,
  soundshift,
  setups,
  setupManager,
  setupExperiment,
  customCatalog,
  pinoutFirmware,
  esp32Wifi,
  career,
  driverNotes,
  spotter,
  piperTts,
  haptics,
  teamFuel,
  tradingPaints,
  coach,
  predictions,
  paceModel,
  aiEngineer,
  proactiveEngineer,
  strategy,
  stintDebrief,
  incidentRecorder,
  storyEngine,
  communityLocal,
  semanticSearch,
  dashboardAi,
  biometrics,
  hapticsZonal,
  spotter3d,
  stt,
  streaming,
  stewardDesk,
  mqttTarget,
  simhubImport,
  configExport,
  updater,
  diagnosticLogger,
  bugReport,
  pitPanel,
  touchPanel,
  streamPresentation
]

export interface RegisteredModules {
  settingsStore: SettingsStore
  revlightsEngine: RevlightsEngine
  rgbMatrix: RgbMatrixModule
}

export function registerModules(ctx: ModuleContext): RegisteredModules {
  for (const register of moduleRegistrars) {
    try {
      register(ctx)
    } catch (error) {
      // A single module failing to register must NEVER break the chain — the
      // rev-lights and iFlag (rgb-matrix) are registered AFTER this loop, so an
      // unguarded throw here would leave the LED outputs dead. Log and continue.
      logger.warn('main', 'module register failed (isolated)', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  // app-shell-ui (owns the SettingsStore), revlights (owns the engine) and rgb-matrix
  // (owns the iFlag panels) are pulled out of the loop so we can capture their handles:
  // wire the SIM-X auto-start coordinator, and let index.ts drive a clean quit teardown
  // (turn the iFlag OFF, then disconnect) and the close-to-tray behavior.
  const settingsStore = appShellUi(ctx)
  const revlightsEngine = revlights(ctx)
  const rgbMatrixModule = rgbMatrix(ctx)
  // F3: the iFlag dynamic-panel module is pulled out of the loop so its handle can
  // override the matrix frame (race-state panel) when the user enables it.
  rgbMatrixModule.iflagDynamic = iflagDynamic(ctx)
  wireSimxAutostart(ctx, settingsStore, revlightsEngine)
  wireGenericAutostart(ctx, settingsStore)

  // Wire the expression engine's live results into the output-router so that
  // OutputRoutes with an `expression` source actually resolve a value.
  const exprApi = expressionEngine(ctx)
  const routerApi = outputRouter(ctx)
  routerApi.setExpressionResolver((exprId) => exprApi.getResultsSnapshot()[exprId]?.value ?? undefined)
  exprApi.setOutputSink((routes, activeExpressionIds) => routerApi.setExpressionRoutes(routes, activeExpressionIds))
  void (async () => {
    const legacyRoutes = await routerApi.getLegacyExpressionRoutes()
    if (legacyRoutes.length === 0) return
    const migratedRouteIds = await exprApi.migrateLegacyOutputState(legacyRoutes)
    await routerApi.removeLegacyExpressionRoutes(migratedRouteIds)
  })().catch((error) => {
    logger.warn('main', 'failed to migrate legacy expression output state', {
      message: error instanceof Error ? error.message : String(error)
    })
  })

  return { settingsStore, revlightsEngine, rgbMatrix: rgbMatrixModule }
}

function wireSimxAutostart(ctx: ModuleContext, settingsStore: SettingsStore, revlightsEngine: RevlightsEngine): void {
  const file = join(ctx.app.getPath('userData'), 'simx-autostart.json')
  const loadLastPort = (): string | null => {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { lastPort?: unknown }
      return typeof raw.lastPort === 'string' && raw.lastPort.length > 0 ? raw.lastPort : null
    } catch {
      return null
    }
  }
  const saveLastPort = (path: string): void => {
    try {
      mkdirSync(ctx.app.getPath('userData'), { recursive: true })
      writeFileSync(file, JSON.stringify({ lastPort: path }))
    } catch {
      // best effort — auto-start still works via isSimX detection next launch
    }
  }
  const controller = new SimxAutostartController({
    serial: ctx.serialManager,
    setRevlightsEnabled: (enabled) => revlightsEngine.setEnabled(enabled),
    isEnabled: () => settingsStore.getSettings().autoStartSimX,
    loadLastPort,
    saveLastPort,
    logger
  })
  const unsubscribe = settingsEvents.onChanged(() => controller.onSettingsChanged())
  controller.start()
  ctx.app.once('before-quit', () => {
    unsubscribe()
    controller.dispose()
  })
}

// Robust boot auto-connect for GENERIC serial devices (the iFlag RGB matrix and
// any other user-added Arduino flagged `autoConnect`). Mirrors wireSimxAutostart
// but drives a multi-device controller over the SerialHub and the persisted
// device-config store. Gated by the independent `autoConnectDevices` setting.
function wireGenericAutostart(ctx: ModuleContext, settingsStore: SettingsStore): void {
  const store = getSerialDevicesStore(ctx.app)
  const controller = new GenericAutostartController({
    serial: {
      listPorts: () => ctx.serialHub.listPorts(),
      // The hub only keeps OPEN devices in its map, so every summary it lists is
      // a live connection we must not re-open.
      listConnected: () =>
        ctx.serialHub.listDevices().map((device) => ({
          id: device.id,
          path: device.path,
          kind: device.kind
        })),
      connectDevice: (opts) =>
        ctx.serialHub.connectDevice({
          path: opts.path,
          id: opts.id,
          kind: 'generic',
          label: opts.label,
          baud: opts.baud,
          primary: false,
          // Generic CDC devices don't need the Pro Micro DTR dance.
          assertSignals: false
        }),
      on: (event, handler) => {
        ctx.serialHub.on(event, handler)
      },
      off: (event, handler) => {
        ctx.serialHub.off(event, handler)
      }
    },
    isEnabled: () => settingsStore.getSettings().autoConnectDevices,
    loadDevices: async () => {
      await store.ensureLoaded()
      return store.list()
    },
    saveDevicePath: (config, path) => {
      void store
        .upsert({
          id: config.id,
          path,
          label: config.label,
          baud: config.baud,
          autoConnect: config.autoConnect,
          vendorId: config.vendorId,
          productId: config.productId,
          serialNumber: config.serialNumber
        })
        .catch(() => undefined)
    },
    logger
  })
  const unsubscribe = settingsEvents.onChanged(() => controller.onSettingsChanged())
  controller.start()
  ctx.app.once('before-quit', () => {
    unsubscribe()
    controller.dispose()
  })
}
