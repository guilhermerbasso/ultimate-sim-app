import { DEFAULT_APP_SETTINGS } from '@shared/settings'
import { DEFAULT_ALERTS_CONFIG } from '@shared/alerts'
import { DEFAULT_OLED_CONFIG, OLED_PRESETS } from '@shared/oled'
import { DEFAULT_REVLIGHTS_CONFIG, REVLIGHTS_PRESETS } from '@shared/revlights'
import { DEFAULT_SOUNDS_CONFIG } from '@shared/soundshift'
import { DEFAULT_HAPTICS_CONFIG } from '@shared/haptics'
import { DEFAULT_HAPTICS_ZONAL_CONFIG } from '@shared/haptics-zonal'
import { DEFAULT_SETUPS_CONFIG } from '@shared/setups'
import { DEFAULT_ENGINEER_CONFIG } from '@shared/engineer-ipc'
import { DEFAULT_SPOTTER_CONFIG } from '@shared/spotter'
import { EXPR_CHANNELS, type ExpressionResultsBatch } from '@shared/expr'
import {
  resolveExpressionDestinationPlacements,
  type ExpressionPlacementRequest,
  type ExpressionStudioSnapshot
} from '@shared/expression-studio'
import { summarizeButtonBoxPanel } from '@shared/touch-panel'
import { TOUCH_PANEL_PRESETS } from '@shared/touch-panel-presets'
import { createMockSnapshot } from './mock-telemetry'

type AnyFn = (...args: unknown[]) => unknown

const snapshot = createMockSnapshot()
const drivers = snapshot.drivers ?? []
const noop = (): void => {}

const displays = [
  { id: 'display-1', label: 'Display 1 · 1280×800', bounds: { x: 0, y: 0, width: 1280, height: 800 }, primary: true }
]

const settings = {
  ...DEFAULT_APP_SETTINGS,
  language: 'en',
  defaultTelemetrySource: 'mock'
}

const touchDisplay = {
  id: 1,
  label: 'Cockpit touch display · 1280×800',
  width: 1280,
  height: 800,
  primary: true
}
const touchPanel = TOUCH_PANEL_PRESETS[0]
const touchPanelSummary = touchPanel ? summarizeButtonBoxPanel(touchPanel) : null

const expressionStudio: ExpressionStudioSnapshot = {
  version: 3,
  revision: 7,
  expressions: [
    {
      id: 'attack-window',
      name: 'Attack window',
      expr: 'speedKmh > 200 ? "PUSH" : "HOLD"'
    }
  ],
  enabledVars: [],
  outputs: [],
  destinations: [
    {
      id: 'attack-window-dashboard',
      source: { expressionId: 'attack-window' },
      surface: 'dashboard',
      targetId: 'gt3_dense50_race_final_stint_fuel',
      presentation: 'status',
      geometry: { x: 760, y: 64, width: 220, height: 96 },
      format: {
        label: 'Attack window',
        trueText: 'PUSH',
        falseText: 'HOLD',
        color: '#14ffec'
      },
      enabled: true
    }
  ],
  updatedAt: '2026-07-15T00:00:00.000Z',
  capabilities: [
    {
      surface: 'dashboard',
      available: true,
      presentations: ['value', 'bar', 'gauge', 'status'],
      targets: [
        {
          id: 'gt3_dense50_race_final_stint_fuel',
          label: 'GT3 · Final stint fuel',
          width: 1024,
          height: 600,
          kind: 'dashboard'
        }
      ]
    },
    {
      surface: 'overlay',
      available: true,
      presentations: ['value', 'bar', 'gauge', 'status'],
      targets: [
        {
          id: 'visual-audit-overlay',
          label: 'Race engineer overlay',
          width: 420,
          height: 140,
          kind: 'custom-overlay'
        }
      ]
    },
    {
      surface: 'oled',
      available: false,
      reason: 'OLED destinations are reserved for a later release.',
      presentations: ['value', 'status'],
      targets: []
    },
    {
      surface: 'touch',
      available: false,
      reason: 'Touch destinations are reserved for a later release.',
      presentations: ['value', 'status'],
      targets: []
    }
  ],
  destinationStatuses: [
    {
      destinationId: 'attack-window-dashboard',
      status: 'ready'
    }
  ]
}

const expressionResults: ExpressionResultsBatch['results'] = {
  'attack-window': {
    name: 'Attack window',
    value: 'PUSH'
  }
}

const fuelState = {
  connected: true,
  currentLap: snapshot.currentLap,
  fuelLiters: snapshot.fuelLiters,
  fuelCapacityLiters: snapshot.fuelCapacityLiters,
  usedPerLap: snapshot.fuelPerLap,
  samples: [
    { lap: 10, usedLiters: 2.82, lapTimeSec: 103.4 },
    { lap: 11, usedLiters: 2.88, lapTimeSec: 103.1 }
  ],
  lapsLeftWithFuel: 13.4,
  raceLapsRemaining: snapshot.lapsRemaining,
  fuelToFinish: 51.5,
  fuelDeltaToFinish: -13.1,
  saveTarget: 2.35,
  saveNeededPerLap: 0.51,
  pitWindow: { canFinish: false, earliestLap: 24, latestLap: 26, lapsUntilPit: 12, status: 'pit-required' },
  stint: { estimatedLapTimeSec: snapshot.estimatedLapTimeSec, raceLapsRemaining: snapshot.lapsRemaining, stintLaps: 13, stintsToFinish: 2, fuelPerStintLiters: 37.2 },
  settings: { targetLaps: 30, raceTimeMinutes: 45, fuelMarginLiters: 3 },
  updatedAt: Date.now()
}

const lapState = {
  currentLap: snapshot.currentLap,
  lastLapTimeSec: snapshot.lastLapTimeSec,
  bestLapTimeSec: snapshot.bestLapTimeSec,
  sectors: [
    { index: 1, currentSec: 31.8, bestSec: 31.6 },
    { index: 2, currentSec: 36.2, bestSec: 35.9 },
    { index: 3, currentSec: 35.1, bestSec: 35.0 }
  ],
  history: []
}

const engineerStatus = {
  enabled: true,
  activeModelId: DEFAULT_ENGINEER_CONFIG.modelId,
  runtime: { available: false, loaded: false, busy: false },
  models: [],
  config: { ...DEFAULT_ENGINEER_CONFIG, language: 'en-US' }
}

const emulationStatus = {
  platform: 'win32',
  keyboard: { available: false, message: 'Visual audit mock.' },
  gamepad: { available: false, message: 'Visual audit mock.' }
}

function channelDefault(channel: string, args: unknown[]): unknown {
  if (channel === 'app:getSettings') return settings
  if (channel === 'app:setSettings') return { ...settings, ...(args[0] as object | undefined) }
  if (channel === 'app:openUserData' || channel === 'app:openRecordings') return ''
  if (channel === 'app:touchpanel:listDisplays') return [touchDisplay]
  if (channel === 'app:touchpanel:list') return touchPanelSummary ? [touchPanelSummary] : []
  if (channel === 'app:touchpanel:get') return args[0] === touchPanel?.id ? touchPanel : null
  if (channel.includes('listDisplays') || channel === 'overlays:getDisplays') return displays
  if (channel === 'oled:getPresets') return OLED_PRESETS
  if (channel === 'revlights:getPresets') return REVLIGHTS_PRESETS
  if (channel.includes(':list') || channel.includes(':getProfiles') || channel.includes(':getPresets')) return []
  if (channel.includes(':listOpen')) return []
  if (channel.includes(':playlist')) return { items: [], enabled: false }
  if (channel.includes(':openState')) return {}
  if (channel.includes(':isOpen')) return false
  if (channel === 'oled:getConfig' || channel === 'oled:setConfig' || channel === 'oled:setActivePage' || channel === 'oled:setStreaming') return DEFAULT_OLED_CONFIG
  if (channel === 'revlights:getConfig' || channel === 'revlights:setConfig' || channel === 'revlights:setEnabled' || channel === 'revlights:applyPreset') return DEFAULT_REVLIGHTS_CONFIG
  if (channel === 'alerts:getConfig' || channel === 'alerts:setConfig') return DEFAULT_ALERTS_CONFIG
  if (channel === 'soundshift:getConfig' || channel === 'soundshift:setConfig' || channel === 'soundshift:clearLearned') return DEFAULT_SOUNDS_CONFIG
  if (channel === 'haptics:getConfig' || channel === 'haptics:setConfig') return DEFAULT_HAPTICS_CONFIG
  if (channel === 'hapticsZonal:getConfig' || channel === 'hapticsZonal:setConfig') return DEFAULT_HAPTICS_ZONAL_CONFIG
  if (channel === 'setups:getConfig' || channel === 'setups:setConfig') return DEFAULT_SETUPS_CONFIG
  if (channel === 'engineer:getConfig' || channel === 'engineer:setConfig') return { ...DEFAULT_ENGINEER_CONFIG, language: 'en-US' }
  if (channel === 'spotter:getConfig' || channel === 'spotter:setConfig') return DEFAULT_SPOTTER_CONFIG
  if (channel.includes(':getConfig')) return {}
  if (channel === 'oled:getStatus') return { enabled: DEFAULT_OLED_CONFIG.enabled, activeIndex: 0, activePresetId: DEFAULT_OLED_CONFIG.pages[0], connected: false, lastPayload: null, lastError: null }
  if (channel === 'revlights:getStatus') return { enabled: false, level: 3, shiftActive: false, rpm: snapshot.rpm, maxRpm: snapshot.maxRpm, shiftIndicatorPct: snapshot.shiftIndicatorPct, lastError: null, connected: false, flag: null }
  if (channel === 'engineer:getStatus') return engineerStatus
  if (channel.includes(':getStatus') || channel.endsWith(':status')) return { connected: true, source: 'mock', rateHz: 60 }
  if (channel.includes('Diagnostics')) return { platform: 'win32', koffiLoaded: true, iracingRunning: false, headerRead: false, statusConnected: true, varsDecoded: 0, providerConnected: true, activeSource: 'mock' }
  if (channel.startsWith('telemetry:')) {
    if (channel.endsWith(':drivers')) return drivers
    if (channel.endsWith(':status') || channel.endsWith(':setSource')) return { connected: true, source: 'mock', activeSource: 'mock', rateHz: 60 }
    return snapshot
  }
  if (channel === 'fuel:get') return fuelState
  if (channel === 'lap:get') return lapState
  if (channel.startsWith('tire:')) return {
    connected: true,
    currentLap: snapshot.currentLap,
    corners: {
      lf: { wearPct: 0.91, wearPerLap: 0.011, lapsToThreshold: 18 },
      rf: { wearPct: 0.88, wearPerLap: 0.014, lapsToThreshold: 14 },
      lr: { wearPct: 0.93, wearPerLap: 0.009, lapsToThreshold: 22 },
      rr: { wearPct: 0.9, wearPerLap: 0.012, lapsToThreshold: 16 }
    },
    worstCorner: 'rf',
    avgWearPerLap: 0.0115,
    recommendedPitLap: 26,
    lapsRemainingOnTyres: 14,
    raceLapsRemaining: 18,
    estimated: false,
    notes: ['RF wearing fastest', 'Pit window opens lap 24'],
    settings: { wearThresholdPct: 0.3, targetLaps: 28 },
    updatedAt: Date.now()
  }
  if (channel.startsWith('teamfuel:')) return []
  if (channel.startsWith('alerts:')) return DEFAULT_ALERTS_CONFIG
  if (channel === EXPR_CHANNELS.getStudio) return expressionStudio
  if (channel === EXPR_CHANNELS.mutateStudio) return { ...expressionStudio, revision: expressionStudio.revision + 1 }
  if (channel === EXPR_CHANNELS.getPlacements) {
    const request = args[0] as Partial<ExpressionPlacementRequest> | undefined
    if (
      (request?.surface === 'dashboard' || request?.surface === 'overlay') &&
      typeof request.targetId === 'string'
    ) {
      return resolveExpressionDestinationPlacements(
        expressionStudio,
        expressionStudio.capabilities,
        request as ExpressionPlacementRequest
      )
    }
    return []
  }
  if (channel === EXPR_CHANNELS.getResults) return expressionResults
  if (channel === EXPR_CHANNELS.getExpressions || channel === EXPR_CHANNELS.setExpressions) return expressionStudio.expressions
  if (channel === EXPR_CHANNELS.getEnabledVars || channel === EXPR_CHANNELS.setEnabledVars) return expressionStudio.enabledVars
  if (channel.startsWith('outputs:')) return []
  if (channel === 'actions:emulationStatus') return emulationStatus
  if (channel.startsWith('actions:')) return []
  if (channel.startsWith('arduino:')) {
    if (channel.includes('RuntimeState')) return { connected: false, lines: [], log: [], snapshot: null, updatedAt: Date.now() }
    if (channel.includes('HardwareProfile')) return { id: 'visual-audit', name: 'Visual Audit', components: [] }
    return channel.includes('FirmwareInfo') ? { available: false, boards: [] } : []
  }
  if (channel.startsWith('esp32:')) return channel.includes('discover') ? [] : { devices: [], connected: false }
  if (channel.startsWith('overlays:')) return channel.includes('Config') ? {} : []
  if (channel.startsWith('app:dash:')) return []
  if (channel.startsWith('app:touchpanel:')) return []
  if (channel.startsWith('app:pitpanel:')) return false
  if (channel === 'setups:env') return { supported: true, platform: 'win32', setupsDir: 'C:\\iRacing\\setups' }
  if (channel === 'setups:listCarFolders') return []
  if (channel === 'setups:detectCar') return { carName: snapshot.carName, folder: '', confidence: 'mock' }
  if (channel === 'setups:libraryList') return { root: 'C:\\iRacing\\setups', items: [] }
  if (channel.startsWith('setups:')) return []
  if (channel === 'career:getOverview') return {
    identity: null,
    licenses: [],
    career: [],
    thisYear: null,
    strengthsByCar: [],
    strengthsByTrack: [],
    incidentTrend: [],
    availableCategoryIds: [5],
    primaryCategoryId: 5,
    status: { auth: 'needs-login', fromCache: false }
  }
  if (channel === 'career:getCharts') return { categoryId: 5, charts: null, status: { auth: 'needs-login', fromCache: false } }
  if (channel === 'career:getRecent') return { races: [], status: { auth: 'needs-login', fromCache: false } }
  if (channel === 'career:getEnrichment') return { yearly: [], profile: null, leagues: [], division: null, activeSeasonsForPrimary: [], status: { auth: 'needs-login', fromCache: false } }
  if (channel.startsWith('drivers:')) return []
  if (channel.startsWith('career:')) return {}
  if (channel.startsWith('search:')) return { items: [], results: [] }
  if (channel.startsWith('community:')) return { sources: [], imports: [] }
  if (channel === 'engineer:ask') return { id: `mock-${Date.now()}`, at: Date.now(), question: String(args[0] ?? ''), text: 'Mock engineer ready for visual audit.', speak: false, source: 'fallback' }
  if (channel === 'engineer:ensureModel') return { ok: false, error: 'Visual audit mock' }
  if (channel.startsWith('coach:')) return { enabled: false, messages: [], findings: [] }
  if (channel.startsWith('engineer:')) return engineerStatus
  if (channel.startsWith('hapticsZonal:')) return DEFAULT_HAPTICS_ZONAL_CONFIG
  if (channel.startsWith('haptics:')) return DEFAULT_HAPTICS_CONFIG
  if (channel.startsWith('soundshift:')) return DEFAULT_SOUNDS_CONFIG
  if (channel.startsWith('spotter')) return DEFAULT_SPOTTER_CONFIG
  if (channel.startsWith('tts') || channel.startsWith('stt')) return { enabled: false }
  if (channel === 'logs:getVerbose' || channel === 'logs:setVerbose') return false
  if (channel === 'logs:info') return { dir: 'C:\\UltimateSimApp\\logs', retentionMs: 86_400_000, appVersion: 'visual-audit' }
  if (channel === 'logs:export') return { canceled: false, filePath: 'C:\\UltimateSimApp\\logs.zip', files: 0, bytes: 0 }
  if (channel === 'logs:openFolder') return ''
  if (channel === 'trackmap:getOAuthConfig') return { clientId: '', clientSecret: '' }
  if (channel.startsWith('trackmap:')) return { status: { authenticated: false, message: 'Visual audit mock' } }
  if (channel.startsWith('config:')) return { ok: true, sections: [] }
  if (channel.includes(':get') || channel.includes(':status')) return {}
  return null
}

const ipc = {
  invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => channelDefault(channel, args),
  subscribe: (channel: string, callback?: (payload: unknown) => void): (() => void) => {
    if (channel === 'telemetry:snapshot' || channel === 'telemetry:fast' || channel === 'telemetry:race' || channel === 'telemetry:session') {
      window.setTimeout(() => callback?.(snapshot), 20)
    }
    return noop
  },
  on: () => noop,
  send: () => undefined,
  removeListener: () => undefined,
  off: () => undefined
}

const apiResponses: Record<string, unknown> = {
  listPorts: [],
  getStatus: null,
  getMapping: {},
  getConfig: {},
  listProfiles: []
}

const api = new Proxy(
  {},
  {
    get: (_target, prop: string): AnyFn => async () => apiResponses[prop] ?? null
  }
)

const mediaDevices = {
  enumerateDevices: async () => [],
  getUserMedia: async () => ({ getTracks: () => [] })
}

Object.defineProperty(navigator, 'mediaDevices', { value: mediaDevices, configurable: true })
Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
Object.defineProperty(navigator, 'languages', { value: ['en-US', 'en'], configurable: true })

const w = window as unknown as { ipc: unknown; api: unknown; __USA_VISUAL_SNAPSHOT__: unknown }
w.ipc = ipc
w.api = api
w.__USA_VISUAL_SNAPSHOT__ = snapshot

window.localStorage.setItem('usa.onboardingCompleted', 'true')
window.localStorage.setItem('usa:sidebar-collapsed', 'false')

export {}
