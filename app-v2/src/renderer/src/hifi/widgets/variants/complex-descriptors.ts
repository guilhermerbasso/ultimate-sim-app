import {
  trackSurfaceMaterialLabel,
  type DriverEntry,
  type TelemetrySnapshot,
  type TyreInfo
} from '../../../../../shared/telemetry'
import type {
  ComplexCornerCell,
  ComplexCornersModel,
  ComplexMapModel,
  ComplexStatusModel,
  ComplexTableRow,
  ComplexTelemetryDescriptor,
  ComplexVectorAxis,
  ComplexVectorModel,
  CornerKey
} from './complex-types'
import type { TelemetryTone } from './types'

const CORNERS: CornerKey[] = ['lf', 'rf', 'lr', 'rr']

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function signed(value: number | undefined, decimals = 2): string {
  return value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}`
}

function gear(value: number | undefined): string {
  if (value == null) return '—'
  if (value < 0) return 'R'
  if (value === 0) return 'N'
  return String(Math.trunc(value))
}

function lapTime(value: number | undefined): string {
  if (value == null || value < 0) return '—'
  const minutes = Math.floor(value / 60)
  const remainder = value - minutes * 60
  return `${minutes}:${remainder.toFixed(3).padStart(6, '0')}`
}

function compactName(value: string | undefined): string {
  const text = value?.trim()
  if (!text) return '—'
  const parts = text.split(/\s+/)
  const compact = parts.length > 1 ? `${parts[0][0]}. ${parts[parts.length - 1]}` : text
  return compact.length > 18 ? `${compact.slice(0, 17)}…` : compact
}

function paceFlagLabel(value: string): string {
  if (value === 'endOfLine') return 'END OF LINE'
  if (value === 'freePass') return 'FREE PASS'
  if (value === 'wavedAround') return 'WAVED AROUND'
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase()
}

function trackLocation(value: number | undefined): string {
  switch (value) {
    case -1:
      return 'OUT'
    case 0:
      return 'OFF'
    case 1:
      return 'STALL'
    case 2:
      return 'PIT IN'
    case 3:
      return 'TRACK'
    default:
      return '—'
  }
}

function trackLocationTone(value: number | undefined): TelemetryTone {
  if (value === 0 || value === -1) return 'danger'
  if (value === 1 || value === 2) return 'info'
  return 'neutral'
}

function driverWindow(snapshot: TelemetrySnapshot | null, limit = 7): DriverEntry[] {
  const sorted = [...(snapshot?.drivers ?? [])].sort((a, b) => {
    const pa = finite(a.position) ?? Number.MAX_SAFE_INTEGER
    const pb = finite(b.position) ?? Number.MAX_SAFE_INTEGER
    return pa - pb || a.carIdx - b.carIdx
  })
  if (sorted.length <= limit) return sorted
  const playerIndex = sorted.findIndex((driver) => driver.isPlayer)
  if (playerIndex < 0) return sorted.slice(0, limit)
  const start = clamp(playerIndex - 2, 0, sorted.length - limit)
  return sorted.slice(start, start + limit)
}

function tableRows(
  snapshot: TelemetrySnapshot | null,
  read: (driver: DriverEntry) => {
    value: string
    fraction?: number
    tone?: TelemetryTone
  }
): ComplexTableRow[] {
  return driverWindow(snapshot).map((driver) => {
    const reading = read(driver)
    const value = /(?:NaN|undefined|Infinity)/i.test(reading.value) ? '—' : reading.value
    return {
      key: String(driver.carIdx),
      position: finite(driver.position),
      carNumber: driver.carNumber,
      name: compactName(driver.name),
      value,
      fraction: finite(reading.fraction),
      tone: reading.tone,
      classColor: driver.classColor,
      isPlayer: driver.isPlayer
    }
  })
}

function tableDescriptor(
  id: string,
  label: string,
  column: string,
  tags: string[],
  read: Parameters<typeof tableRows>[1]
): ComplexTelemetryDescriptor {
  return {
    id,
    label,
    context: column,
    archetype: 'table',
    category: 'standings',
    focus: 'traffic',
    requires: ['drivers'],
    tags: ['standings', 'relative', 'table', ...tags],
    read: (snapshot) => {
      const rows = tableRows(snapshot, read)
      return { kind: 'table', column, rows, available: rows.length > 0 }
    }
  }
}

function vectorAxis(
  label: string,
  value: unknown,
  unit: string,
  decimals = 2,
  signedAxis = true
): ComplexVectorAxis {
  return { label, value: finite(value), unit, decimals, signed: signedAxis }
}

function vectorModel(
  x: number | undefined,
  y: number | undefined,
  headingRad: number | undefined,
  axes: ComplexVectorAxis[]
): ComplexVectorModel {
  return {
    kind: 'vector',
    x: finite(x),
    y: finite(y),
    headingRad: finite(headingRad),
    axes,
    available: axes.some((axis) => axis.value != null)
  }
}

function mapModel(
  snapshot: TelemetrySnapshot | null,
  extra: Partial<ComplexMapModel>,
  conceptAvailable: boolean
): ComplexMapModel {
  return {
    kind: 'map',
    progress: finite(snapshot?.lapDistPct),
    distanceM: finite(snapshot?.lapDistanceM),
    trackLengthKm: finite(snapshot?.trackLengthKm),
    lat: finite(snapshot?.lat),
    lon: finite(snapshot?.lon),
    altitudeM: finite(snapshot?.altitudeM),
    available: conceptAvailable,
    ...extra
  }
}

function cornerCells(
  read: (corner: CornerKey) => Array<number | undefined>
): ComplexCornerCell[] {
  return CORNERS.map((key) => ({
    key,
    values: read(key).map(finite)
  }))
}

function cornersModel(
  unit: string,
  decimals: number,
  cells: ComplexCornerCell[],
  zoneLabels?: string[]
): ComplexCornersModel {
  return {
    kind: 'corners',
    unit,
    decimals,
    cells,
    zoneLabels,
    available: cells.some((cell) => cell.values.some((value) => value != null))
  }
}

function tyreCorner(snapshot: TelemetrySnapshot | null, key: CornerKey): TyreInfo | undefined {
  return snapshot?.tyres?.[key]
}

function statusModel(
  primary: string,
  options: Partial<Omit<ComplexStatusModel, 'kind' | 'primary'>> = {}
): ComplexStatusModel {
  return {
    kind: 'status',
    primary,
    tone: 'neutral',
    available: primary !== '—',
    ...options
  }
}

const PER_CAR_TABLES: ComplexTelemetryDescriptor[] = [
  tableDescriptor('perCarBestLap', 'Per-Car Best Lap', 'BEST', ['best', 'lap-time'], (driver) => ({
    value:
      driver.bestLapTimeSec == null
        ? '—'
        : `${lapTime(driver.bestLapTimeSec)}${driver.bestLapNum == null ? '' : ` · L${driver.bestLapNum}`}`
  })),
  tableDescriptor('perCarClassPosition', 'Per-Car Class Position', 'CLASS', ['class', 'position'], (driver) => ({
    value: driver.classPosition > 0 ? `C${driver.classPosition}` : '—'
  })),
  tableDescriptor('perCarCompletedLaps', 'Per-Car Completed Laps', 'DONE', ['laps'], (driver) => ({
    value: driver.completedLaps == null ? '—' : `L${driver.completedLaps}`
  })),
  tableDescriptor('perCarEstimatedTime', 'Per-Car Estimated Time', 'EST', ['estimated', 'timing'], (driver) => ({
    value: driver.estimatedTimeSec == null ? '—' : `${driver.estimatedTimeSec.toFixed(1)} s`
  })),
  tableDescriptor('perCarGear', 'Per-Car Gear', 'GEAR', ['gear'], (driver) => ({
    value: gear(driver.gear)
  })),
  tableDescriptor('perCarLap', 'Per-Car Lap', 'LAP', ['laps'], (driver) => ({
    value: driver.lap == null ? '—' : `L${driver.lap}`
  })),
  tableDescriptor('perCarLastLap', 'Per-Car Last Lap', 'LAST', ['lap-time'], (driver) => ({
    value: lapTime(driver.lastLapTimeSec)
  })),
  tableDescriptor('perCarPitRoad', 'Per-Car Pit-Road State', 'PIT', ['pit', 'status'], (driver) => ({
    value: driver.inPits == null ? '—' : driver.inPits ? 'PIT' : 'TRACK',
    tone: driver.inPits ? 'info' : 'neutral'
  })),
  tableDescriptor('perCarPosition', 'Per-Car Position', 'POS', ['position'], (driver) => ({
    value: driver.position > 0 ? `P${driver.position}` : '—'
  })),
  tableDescriptor('perCarProgress', 'Per-Car Lap Progress', 'PROGRESS', ['laps', 'track'], (driver) => ({
    value: driver.lapDistPct == null ? '—' : `${(driver.lapDistPct * 100).toFixed(1)}%`,
    fraction: driver.lapDistPct
  })),
  tableDescriptor('perCarPushToPass', 'Per-Car Push-to-Pass', 'P2P', ['push-to-pass'], (driver) => ({
    value:
      driver.pushToPassActive == null && driver.pushToPassCount == null
        ? '—'
        : `${driver.pushToPassActive ? 'ON' : 'READY'}${driver.pushToPassCount == null ? '' : ` · ${driver.pushToPassCount}`}`,
    tone: driver.pushToPassActive ? 'info' : 'neutral'
  })),
  tableDescriptor('perCarRpm', 'Per-Car RPM', 'RPM', ['rpm', 'engine'], (driver) => ({
    value: driver.rpm == null ? '—' : Math.round(driver.rpm).toLocaleString('en-US'),
    fraction: driver.rpm == null ? undefined : clamp(driver.rpm / 10000, 0, 1)
  })),
  tableDescriptor('perCarTrackLocation', 'Per-Car Track Location', 'LOCATION', ['track', 'status'], (driver) => ({
    value: trackLocation(driver.trackLocation),
    tone: trackLocationTone(driver.trackLocation)
  })),
  tableDescriptor('perCarTrackMaterial', 'Per-Car Track Material', 'SURFACE', ['track', 'surface'], (driver) => ({
    value: trackSurfaceMaterialLabel(driver.trackSurfaceMaterial)?.toUpperCase() ?? '—',
    tone:
      driver.trackSurfaceMaterial != null && driver.trackSurfaceMaterial >= 15
        ? 'warning'
        : 'neutral'
  })),
  {
    id: 'paceFormation',
    label: 'Pace Formation',
    context: 'PACE',
    archetype: 'table',
    category: 'standings',
    focus: 'race-control',
    requires: ['drivers'],
    tags: ['standings', 'pace', 'formation', 'table'],
    read: (snapshot) => {
      const rows = tableRows(snapshot, (driver) => ({
        value:
          driver.paceLine == null && driver.paceRow == null
            ? '—'
            : `LINE ${driver.paceLine ?? '—'} · ROW ${driver.paceRow ?? '—'}`
      }))
      return { kind: 'table', column: 'PACE', rows, available: rows.some((row) => row.value !== '—') }
    }
  }
]

const VECTOR_DESCRIPTORS: ComplexTelemetryDescriptor[] = [
  {
    id: 'accelerationVector',
    label: 'Acceleration Vector',
    context: 'G',
    archetype: 'vector',
    category: 'drive',
    focus: 'g-force',
    requires: ['latAccelG', 'longAccelG', 'vertAccelG'],
    tags: ['g-force', 'vector', 'acceleration'],
    read: (snapshot) => {
      const lat = finite(snapshot?.latAccelG)
      const long = finite(snapshot?.longAccelG)
      return vectorModel(
        lat == null ? undefined : clamp(lat / 2.5, -1, 1),
        long == null ? undefined : clamp(-long / 2.5, -1, 1),
        undefined,
        [
          vectorAxis('LONG', long, 'g'),
          vectorAxis('LAT', lat, 'g'),
          vectorAxis('VERT', snapshot?.vertAccelG, 'g')
        ]
      )
    }
  },
  {
    id: 'angularRates',
    label: 'Angular Rates',
    context: 'RATE',
    archetype: 'vector',
    category: 'drive',
    focus: 'chassis',
    requires: ['pitchRateRadSec', 'rollRateRadSec', 'yawRateRadSec'],
    tags: ['vector', 'rotation', 'chassis'],
    read: (snapshot) => {
      const pitch = finite(snapshot?.pitchRateRadSec)
      const roll = finite(snapshot?.rollRateRadSec)
      return vectorModel(
        roll == null ? undefined : clamp(roll / 3, -1, 1),
        pitch == null ? undefined : clamp(-pitch / 3, -1, 1),
        finite(snapshot?.yawRateRadSec),
        [
          vectorAxis('PITCH', pitch, 'rad/s'),
          vectorAxis('ROLL', roll, 'rad/s'),
          vectorAxis('YAW', snapshot?.yawRateRadSec, 'rad/s')
        ]
      )
    }
  },
  {
    id: 'attitude',
    label: 'Vehicle Attitude',
    context: 'ATT',
    archetype: 'vector',
    category: 'drive',
    focus: 'chassis',
    requires: ['pitchRad', 'rollRad', 'yawRad'],
    tags: ['vector', 'attitude', 'chassis'],
    read: (snapshot) => {
      const pitch = finite(snapshot?.pitchRad)
      const roll = finite(snapshot?.rollRad)
      const toDeg = (value: number | undefined): number | undefined =>
        value == null ? undefined : (value * 180) / Math.PI
      const pitchDeg = toDeg(pitch)
      const rollDeg = toDeg(roll)
      return vectorModel(
        rollDeg == null ? undefined : clamp(rollDeg / 45, -1, 1),
        pitchDeg == null ? undefined : clamp(-pitchDeg / 30, -1, 1),
        finite(snapshot?.yawRad),
        [
          vectorAxis('PITCH', pitchDeg, '°', 1),
          vectorAxis('ROLL', rollDeg, '°', 1),
          vectorAxis('YAW', toDeg(finite(snapshot?.yawRad)), '°', 1)
        ]
      )
    }
  },
  {
    id: 'solarPosition',
    label: 'Solar Position',
    context: 'SUN',
    archetype: 'vector',
    category: 'weather',
    focus: 'weather',
    requires: ['solarAltitudeRad', 'solarAzimuthRad'],
    tags: ['vector', 'weather', 'solar'],
    read: (snapshot) => {
      const altitude = finite(snapshot?.solarAltitudeRad)
      const azimuth = finite(snapshot?.solarAzimuthRad)
      const altitudeDeg = altitude == null ? undefined : (altitude * 180) / Math.PI
      const azimuthDeg = azimuth == null ? undefined : ((azimuth * 180) / Math.PI + 360) % 360
      return vectorModel(
        altitude == null || azimuth == null ? undefined : Math.sin(azimuth) * Math.cos(altitude),
        altitude == null ? undefined : clamp(-Math.sin(altitude), -1, 1),
        azimuth,
        [
          vectorAxis('ALT', altitudeDeg, '°', 1, false),
          vectorAxis('AZ', azimuthDeg, '°', 1, false)
        ]
      )
    }
  },
  {
    id: 'velocityVector',
    label: 'Velocity Vector',
    context: 'VEL',
    archetype: 'vector',
    category: 'drive',
    focus: 'pace',
    requires: ['velocityX', 'velocityY', 'velocityZ'],
    tags: ['vector', 'velocity', 'speed'],
    read: (snapshot) => {
      const x = finite(snapshot?.velocityX)
      const y = finite(snapshot?.velocityY)
      return vectorModel(
        y == null ? undefined : clamp(y / 80, -1, 1),
        x == null ? undefined : clamp(-x / 80, -1, 1),
        finite(snapshot?.yawNorth),
        [
          vectorAxis('X', x, 'm/s'),
          vectorAxis('Y', y, 'm/s'),
          vectorAxis('Z', snapshot?.velocityZ, 'm/s')
        ]
      )
    }
  },
  {
    id: 'wind',
    label: 'Wind Vector',
    context: 'WIND',
    archetype: 'vector',
    category: 'weather',
    focus: 'weather',
    requires: ['windSpeedMs', 'windDirRad'],
    tags: ['vector', 'weather', 'wind'],
    read: (snapshot) => {
      const speed = finite(snapshot?.windSpeedMs)
      const direction = finite(snapshot?.windDirRad)
      const magnitude = speed == null ? undefined : clamp(speed / 20, 0, 1)
      const directionDeg =
        direction == null ? undefined : ((direction * 180) / Math.PI + 360) % 360
      return vectorModel(
        direction == null || magnitude == null ? undefined : Math.sin(direction) * magnitude,
        direction == null || magnitude == null ? undefined : -Math.cos(direction) * magnitude,
        direction,
        [
          vectorAxis('SPD', speed, 'm/s', 1, false),
          vectorAxis('DIR', directionDeg, '°', 0, false)
        ]
      )
    }
  }
]

const CORNER_DESCRIPTORS: ComplexTelemetryDescriptor[] = [
  {
    id: 'brakeLinePressure',
    label: 'Brake-Line Pressure',
    context: 'BRAKE P',
    archetype: 'corners',
    category: 'tyres',
    focus: 'brakes',
    requires: ['brakeLinePressBar'],
    tags: ['brakes', 'pressure', 'corner-grid'],
    read: (snapshot) =>
      cornersModel(
        'bar',
        1,
        cornerCells((key) => [finite(snapshot?.brakeLinePressBar?.[key])])
      )
  },
  {
    id: 'brakeTemperature',
    label: 'Brake Temperature',
    context: 'BRAKE',
    archetype: 'corners',
    category: 'tyres',
    focus: 'brakes',
    requires: ['brakeTempC'],
    tags: ['brakes', 'temperature', 'corner-grid'],
    read: (snapshot) =>
      cornersModel('°C', 0, cornerCells((key) => [finite(snapshot?.brakeTempC?.[key])]))
  },
  {
    id: 'pitTyreTargets',
    label: 'Pit Tyre Targets',
    context: 'PIT P',
    archetype: 'corners',
    category: 'pit',
    focus: 'strategy',
    requires: ['pitTyreTargetsKpa'],
    tags: ['pit', 'tyres', 'pressure', 'corner-grid'],
    read: (snapshot) =>
      cornersModel(
        'kPa',
        0,
        cornerCells((key) => [finite(snapshot?.pitTyreTargetsKpa?.[key])])
      )
  },
  {
    id: 'tyreCarcassTemperature',
    label: 'Tyre Carcass Temperature',
    context: 'CARCASS',
    archetype: 'corners',
    category: 'tyres',
    focus: 'tyres',
    requires: ['tyres'],
    tags: ['tyres', 'temperature', 'corner-grid'],
    read: (snapshot) =>
      cornersModel(
        '°C',
        0,
        cornerCells((key) => {
          const tyre = tyreCorner(snapshot, key)
          return [tyre?.tempLeftC, tyre?.tempMiddleC ?? tyre?.tempC, tyre?.tempRightC]
        }),
        ['L', 'M', 'R']
      )
  },
  {
    id: 'tyreColdPressure',
    label: 'Tyre Cold Pressure',
    context: 'COLD P',
    archetype: 'corners',
    category: 'tyres',
    focus: 'tyres',
    requires: ['tireColdPressuresKpa'],
    tags: ['tyres', 'tyre-pressure', 'cold', 'corner-grid'],
    read: (snapshot) =>
      cornersModel(
        'kPa',
        0,
        cornerCells((key) => [finite(snapshot?.tireColdPressuresKpa?.[key])])
      )
  },
  {
    id: 'tyreSurfaceTemperature',
    label: 'Tyre Surface Temperature',
    context: 'SURFACE',
    archetype: 'corners',
    category: 'tyres',
    focus: 'tyres',
    requires: ['tyres'],
    tags: ['tyres', 'temperature', 'surface', 'corner-grid'],
    read: (snapshot) =>
      cornersModel(
        '°C',
        0,
        cornerCells((key) => {
          const tyre = tyreCorner(snapshot, key)
          return [
            tyre?.surfaceTempLeftC,
            tyre?.surfaceTempMiddleC,
            tyre?.surfaceTempRightC
          ]
        }),
        ['L', 'M', 'R']
      )
  },
  {
    id: 'tyreWear',
    label: 'Tyre Wear',
    context: 'WEAR',
    archetype: 'corners',
    category: 'tyres',
    focus: 'tyres',
    requires: ['tyres'],
    tags: ['tyres', 'tyre-wear', 'corner-grid'],
    read: (snapshot) =>
      cornersModel(
        '%',
        0,
        cornerCells((key) => {
          const tyre = tyreCorner(snapshot, key)
          return [tyre?.wearLeftPct, tyre?.wearMiddlePct ?? tyre?.wearPct, tyre?.wearRightPct].map(
            (value) => (value == null ? undefined : value * 100)
          )
        }),
        ['L', 'M', 'R']
      )
  }
]

const MAP_DESCRIPTORS: ComplexTelemetryDescriptor[] = [
  {
    id: 'geographicPosition',
    label: 'Geographic Position',
    context: 'GPS',
    archetype: 'map',
    category: 'map',
    focus: 'track',
    requires: ['lat', 'lon', 'altitudeM'],
    tags: ['map', 'track', 'position'],
    read: (snapshot) =>
      mapModel(
        snapshot,
        { distanceM: undefined, trackLengthKm: undefined },
        finite(snapshot?.lat) != null ||
          finite(snapshot?.lon) != null ||
          finite(snapshot?.altitudeM) != null
      )
  },
  {
    id: 'lapDistance',
    label: 'Lap Distance',
    context: 'DIST',
    archetype: 'map',
    category: 'map',
    focus: 'track',
    requires: ['lapDistanceM', 'lapDistPct'],
    tags: ['map', 'track', 'laps', 'distance'],
    read: (snapshot) =>
      mapModel(
        snapshot,
        { trackLengthKm: undefined, lat: undefined, lon: undefined, altitudeM: undefined },
        finite(snapshot?.lapDistanceM) != null || finite(snapshot?.lapDistPct) != null
      )
  },
  {
    id: 'trackLength',
    label: 'Track Length',
    context: 'LENGTH',
    archetype: 'map',
    category: 'map',
    focus: 'track',
    requires: ['trackLengthKm', 'lapDistPct'],
    tags: ['map', 'track', 'distance'],
    read: (snapshot) =>
      mapModel(
        snapshot,
        { distanceM: undefined, lat: undefined, lon: undefined, altitudeM: undefined },
        finite(snapshot?.trackLengthKm) != null
      )
  }
]

const STATUS_DESCRIPTORS: ComplexTelemetryDescriptor[] = [
  {
    id: 'cameraCar',
    label: 'Camera Car',
    context: 'CAM',
    archetype: 'status',
    category: 'session',
    focus: 'session',
    requires: ['cameraCarIdx', 'drivers'],
    tags: ['camera', 'driver', 'status'],
    read: (snapshot) => {
      const index = finite(snapshot?.cameraCarIdx)
      const driver = snapshot?.drivers?.find((entry) => entry.carIdx === index)
      if (index == null) return statusModel('—', { available: false })
      return statusModel(driver?.carNumber ? `#${driver.carNumber}` : `CAR ${Math.trunc(index)}`, {
        secondary: driver?.name,
        tone: driver?.isPlayer ? 'info' : 'accent',
        active: true
      })
    }
  },
  {
    id: 'onTrack',
    label: 'On-Track State',
    context: 'TRACK',
    archetype: 'status',
    category: 'session',
    focus: 'race-control',
    requires: ['onTrack'],
    tags: ['track', 'status'],
    read: (snapshot) => {
      if (typeof snapshot?.onTrack !== 'boolean') return statusModel('—', { available: false })
      return statusModel(snapshot.onTrack ? 'ON TRACK' : 'OFF TRACK', {
        tone: snapshot.onTrack ? 'good' : 'danger',
        active: true
      })
    }
  },
  {
    id: 'paceFlags',
    label: 'Pace Flags',
    context: 'PACE',
    archetype: 'status',
    category: 'session',
    focus: 'race-control',
    requires: ['paceFlags', 'drivers'],
    tags: ['pace', 'flags', 'status'],
    read: (snapshot) => {
      const active = (snapshot?.drivers ?? [])
        .flatMap((driver) =>
          (driver.paceFlags ?? []).map((flag) => ({
            key: `${driver.carIdx}-${flag}`,
            label: paceFlagLabel(flag),
            value: driver.carNumber ? `#${driver.carNumber}` : compactName(driver.name),
            tone: 'warning' as const
          }))
        )
        .slice(0, 3)
      const playerFlags = snapshot?.paceFlags ?? []
      const primary = playerFlags[0] ? paceFlagLabel(playerFlags[0]) : active[0]?.label ?? 'PACE CLEAR'
      return statusModel(primary, {
        secondary: playerFlags.length > 1 ? playerFlags.slice(1).map(paceFlagLabel).join(' · ') : undefined,
        tone: active.length || playerFlags.length ? 'warning' : 'neutral',
        active: active.length > 0 || playerFlags.length > 0,
        items: active,
        available: snapshot?.paceFlags != null || snapshot?.drivers != null
      })
    }
  },
  {
    id: 'pitStopActive',
    label: 'Pit Stop Active',
    context: 'PIT',
    archetype: 'status',
    category: 'pit',
    focus: 'strategy',
    requires: ['pitStopActive'],
    tags: ['pit', 'status', 'service'],
    read: (snapshot) => {
      if (typeof snapshot?.pitStopActive !== 'boolean') return statusModel('—', { available: false })
      return statusModel(snapshot.pitStopActive ? 'PIT SERVICE' : 'STANDBY', {
        tone: snapshot.pitStopActive ? 'info' : 'neutral',
        active: snapshot.pitStopActive
      })
    }
  },
  {
    id: 'replayState',
    label: 'Replay State',
    context: 'REPLAY',
    archetype: 'status',
    category: 'session',
    focus: 'session',
    requires: ['replayPlaying'],
    tags: ['replay', 'status'],
    read: (snapshot) => {
      if (typeof snapshot?.replayPlaying !== 'boolean') return statusModel('—', { available: false })
      return statusModel(snapshot.replayPlaying ? 'REPLAY' : 'LIVE', {
        tone: snapshot.replayPlaying ? 'info' : 'good',
        active: true
      })
    }
  },
  {
    id: 'weatherMode',
    label: 'Weather Mode',
    context: 'WEATHER',
    archetype: 'status',
    category: 'weather',
    focus: 'weather',
    requires: ['weatherType'],
    tags: ['weather', 'status'],
    read: (snapshot) => {
      const value = finite(snapshot?.weatherType)
      return value == null
        ? statusModel('—', { available: false })
        : statusModel(`WX ${Math.trunc(value)}`, {
            secondary: snapshot?.isRaining ? 'RAIN ACTIVE' : undefined,
            tone: snapshot?.isRaining ? 'warning' : 'neutral',
            active: true
          })
    }
  }
]

const RADAR_DESCRIPTOR: ComplexTelemetryDescriptor = {
  id: 'perCarRelativeTime',
  label: 'Per-Car Relative Time',
  context: 'REL',
  archetype: 'radar',
  category: 'standings',
  focus: 'traffic',
  requires: ['drivers', 'radarCars', 'carLeftRight'],
  tags: ['standings', 'relative', 'radar', 'traffic'],
  read: (snapshot) => {
    const radarByCar = new Map((snapshot?.radarCars ?? []).map((car) => [car.carIdx, car]))
    const cars = [...(snapshot?.drivers ?? [])]
      .filter((driver) => !driver.isPlayer && finite(driver.relativeTimeSec ?? driver.gapToPlayerSec) != null)
      .sort(
        (a, b) =>
          Math.abs(finite(a.relativeTimeSec ?? a.gapToPlayerSec) ?? 999) -
          Math.abs(finite(b.relativeTimeSec ?? b.gapToPlayerSec) ?? 999)
      )
      .slice(0, 8)
      .map((driver) => {
        const radar = radarByCar.get(driver.carIdx)
        const gap = finite(driver.relativeTimeSec ?? driver.gapToPlayerSec)
        const x = finite(radar?.relativeX) ?? 0
        const y =
          finite(radar?.relativeY) ??
          (gap == null || gap === 0
            ? 0
            : Math.sign(gap) * Math.min(46, 8 + Math.log1p(Math.abs(gap)) * 11))
        return {
          key: String(driver.carIdx),
          x,
          y,
          gapSec: gap,
          label: driver.carNumber ? `#${driver.carNumber}` : compactName(driver.name),
          color: driver.classColor,
          isAlongside: Math.abs(y) < 7 && Math.abs(x) > 1
        }
      })
    return {
      kind: 'radar',
      cars,
      side: snapshot?.carLeftRight ?? 'clear',
      available: snapshot?.drivers != null || snapshot?.carLeftRight != null
    }
  }
}

const STEERING_DESCRIPTOR: ComplexTelemetryDescriptor = {
  id: 'steeringAngle',
  label: 'Steering Angle',
  context: 'STEER',
  archetype: 'steering',
  category: 'inputs',
  focus: 'controls',
  requires: ['steerAngleDeg', 'steeringAngleMaxDeg'],
  tags: ['steering', 'indicator', 'driver-input'],
  read: (snapshot) => {
    const angleDeg = finite(snapshot?.steerAngleDeg)
    return {
      kind: 'steering',
      angleDeg,
      maxDeg: finite(snapshot?.steeringAngleMaxDeg),
      available: angleDeg != null
    }
  }
}

export const COMPLEX_TELEMETRY_DESCRIPTORS: ComplexTelemetryDescriptor[] = [
  ...PER_CAR_TABLES,
  RADAR_DESCRIPTOR,
  ...VECTOR_DESCRIPTORS,
  ...CORNER_DESCRIPTORS,
  ...MAP_DESCRIPTORS,
  ...STATUS_DESCRIPTORS,
  STEERING_DESCRIPTOR
]
