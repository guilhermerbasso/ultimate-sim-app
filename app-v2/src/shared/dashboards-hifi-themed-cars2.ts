// ─── Hi-fi PER-CAR THEMED composition dashboards ──────────────────────────────
// One 1024×600 dashboard per car family, built from that car's themed rev-lights
// signature plus its themed channel and derived widgets (themedChannels /
// themedDerived). Self-contained: imports only the composition kit (which imports
// only TYPES from ./dashboards). Spread into BUILTIN_PRESETS.
import { bg, comp, dashboard, hifiEl, revTop, type HifiCompPreset } from './dashboards-hifi-kit'

const A = { x: 12, y: 108, w: 328, h: 230 }
const B = { x: 348, y: 108, w: 328, h: 230 }
const C = { x: 684, y: 108, w: 328, h: 230 }
const D = { x: 12, y: 356, w: 328, h: 230 }
const E = { x: 348, y: 356, w: 328, h: 230 }
const F = { x: 684, y: 356, w: 328, h: 230 }

function slot(moduleId: string, s: { x: number; y: number; w: number; h: number }) {
  return hifiEl(moduleId, s.x, s.y, s.w, s.h)
}

interface CarThemedSpec {
  id: string
  name: string
  rev: string
  key: string
  widgets: string[]
}

const CAR_DASHES: CarThemedSpec[] = [
  {
    id: 'hifi_themed_ferrari_full',
    name: 'Ferrari Themed Cluster',
    rev: 'revThemedFerrari',
    key: 'ferrari',
    widgets: ['speedThemedFerrari', 'rpmThemedFerrari', 'gearThemedFerrari', 'shiftPointFerrari', 'fuelLapsLeftFerrari', 'slipAngleFerrari']
  },
  {
    id: 'hifi_themed_porsche_full',
    name: 'Porsche Themed Cluster',
    rev: 'revThemedPorsche',
    key: 'porsche',
    widgets: ['speedThemedPorsche', 'rpmThemedPorsche', 'gearThemedPorsche', 'shiftPointPorsche', 'fuelLapsLeftPorsche', 'steeringLockPorsche']
  },
  {
    id: 'hifi_themed_amg_full',
    name: 'Mercedes-AMG Themed Cluster',
    rev: 'revThemedAmg',
    key: 'amg',
    widgets: ['speedThemedAmg', 'rpmThemedAmg', 'gearThemedAmg', 'waterThemedAmg', 'oilThemedAmg', 'rotationRatesAmg']
  },
  {
    id: 'hifi_themed_mclaren_full',
    name: 'McLaren Themed Cluster',
    rev: 'revThemedMclaren',
    key: 'mclaren',
    widgets: ['speedThemedMclaren', 'rpmThemedMclaren', 'gearThemedMclaren', 'throttleThemedMclaren', 'brakeThemedMclaren', 'carAttitudeMclaren']
  },
  {
    id: 'hifi_themed_corvette_full',
    name: 'Corvette Themed Cluster',
    rev: 'revThemedCorvette',
    key: 'corvette',
    widgets: ['speedThemedCorvette', 'rpmThemedCorvette', 'gearThemedCorvette', 'deltaBestThemedCorvette', 'positionThemedCorvette', 'gpsHeadingCorvette']
  },
  {
    id: 'hifi_themed_lambo_full',
    name: 'Lamborghini Themed Cluster',
    rev: 'revThemedLambo',
    key: 'lambo',
    widgets: ['speedThemedLambo', 'rpmThemedLambo', 'gearThemedLambo', 'fuelThemedLambo', 'deltaSessionThemedLambo', 'engineTelltaleLambo']
  }
]

const SLOTS = [A, B, C, D, E, F]

export const HIFI_THEMED_CAR_PRESETS: HifiCompPreset[] = CAR_DASHES.map((car) =>
  comp(
    car.id,
    car.name,
    `${car.name}: the car's themed rev-lights signature with its themed speed, RPM, gear and derived telemetry widgets.`,
    [car.key, 'themed', 'car', 'cluster', 'revlights', 'derived', 'channel'],
    () =>
      dashboard(car.name, `${car.name} themed page.`, [
        bg(),
        revTop(car.rev),
        ...car.widgets.map((w, i) => slot(w, SLOTS[i]))
      ])
  )
)
