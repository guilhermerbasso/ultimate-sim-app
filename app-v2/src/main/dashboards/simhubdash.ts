// Importação/Exportação de `.simhubdash` (formato ZIP do SimHub Dash Studio).
//
// IMPORT: extrai o `.djson` (JSON top-level), faz best-effort para mapear os
// elementos para o nosso modelo, traduzindo cores ARGB → CSS, BorderStyle →
// border/radius, e detectando propriedades SimHub conhecidas dentro das
// `Bindings` em JS.
//
// Tipos de item reconhecidos:
//   Text      → TextItem, TextBlockItem
//   Rect      → RectangleItem (inclui heurística de shift LEDs)
//   Bar       → BarItem, ProgressItem, ProgressBarItem
//   Gauge     → GaugeItem, RotatingNeedleItem, DigitalGaugeItem, AnalogGaugeItem
//   Shiftlights → ShiftLightsItem (direto), ShiftLightItem (consolidado via __shiftLed)
//   Map       → GeneratedMapItem
//   Radar     → RadarItem
//   Flatten   → Layer, GroupItem (recursão em Childrens)
//   Image     → ImageItem/StaticImageItem quando há base64/arquivo embutido
//   Fallback  → EllipseItem/OvalItem e demais → RectangleItem + nota
//
// EXPORT: gera um `.djson` minimal com Screens/Items mapeando nossos tipos para
// TextItem/RectangleItem e adiciona um Layer wrapper para coerência com o
// SimHub. Bindings nossos viram pequenas expressões JS `return $prop('...')`
// quando a chave for conhecida.
//
// Cobertura best-effort — comentários inline indicam o que NÃO é preservado.
import { readFile, writeFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import unzipper from 'unzipper'
import type {
  Dashboard,
  DashboardElement,
  DashboardElementStyle,
  DashboardElementType
} from '../../shared/dashboards'
import { createDashboardId, createElementId } from '../../shared/dashboards'
import { createZip } from './zip-writer'

// ─── Util: conversão ARGB SimHub → CSS rgba ──────────────────────────────────
export function argbToCss(hex: unknown): string | undefined {
  if (typeof hex !== 'string') return undefined
  const m = hex.trim().match(/^#([0-9a-f]{8})$/i)
  if (m) {
    const a = parseInt(m[1].slice(0, 2), 16) / 255
    const r = parseInt(m[1].slice(2, 4), 16)
    const g = parseInt(m[1].slice(4, 6), 16)
    const b = parseInt(m[1].slice(6, 8), 16)
    return `rgba(${r},${g},${b},${a.toFixed(3)})`
  }
  const m6 = hex.trim().match(/^#([0-9a-f]{6})$/i)
  if (m6) return hex
  return undefined
}

function cssToArgb(color: string | undefined): string {
  if (!color) return '#00000000'
  const trimmed = color.trim()
  const rgba = trimmed.match(/^rgba?\(([^)]+)\)$/i)
  if (rgba) {
    const parts = rgba[1].split(',').map((p) => p.trim())
    const r = Math.round(Math.max(0, Math.min(255, Number(parts[0] ?? 0))))
    const g = Math.round(Math.max(0, Math.min(255, Number(parts[1] ?? 0))))
    const b = Math.round(Math.max(0, Math.min(255, Number(parts[2] ?? 0))))
    const alpha = parts[3] !== undefined ? Math.max(0, Math.min(1, Number(parts[3]))) : 1
    const a = Math.round(alpha * 255)
    return `#${a.toString(16).padStart(2, '0').toUpperCase()}${r.toString(16).padStart(2, '0').toUpperCase()}${g.toString(16).padStart(2, '0').toUpperCase()}${b.toString(16).padStart(2, '0').toUpperCase()}`
  }
  const h6 = trimmed.match(/^#([0-9a-f]{6})$/i)
  if (h6) return `#FF${h6[1].toUpperCase()}`
  const h8 = trimmed.match(/^#([0-9a-f]{8})$/i)
  if (h8) {
    // SimHub usa AARRGGBB; CSS #RRGGBBAA. Assumimos entrada já ARGB.
    return `#${h8[1].toUpperCase()}`
  }
  return '#FFFFFFFF'
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

const MAX_DJSON_BYTES = 25 * 1024 * 1024
const MAX_EMBEDDED_IMAGE_BYTES = 3 * 1024 * 1024

// ─── Mapeamento de propriedades SimHub → nossas chaves de binding ────────────
const PROP_TO_BINDING: Record<string, string> = {
  // ── Speed ─────────────────────────────────────────────────────────────────
  'DataCorePlugin.GameData.NewData.SpeedKmh': 'speedKmh',
  'DataCorePlugin.GameData.NewData.Speed': 'speedKmh',
  // ── Gear / RPM ────────────────────────────────────────────────────────────
  'DataCorePlugin.GameData.NewData.Gear': 'gearLabel',
  'DataCorePlugin.GameData.NewData.Rpms': 'rpm',
  'DataCorePlugin.GameData.NewData.RPM': 'rpm',
  'DataCorePlugin.GameData.NewData.MaxRpm': 'maxRpm',
  'DataCorePlugin.GameData.NewData.MaxRPM': 'maxRpm',
  'DataCorePlugin.GameData.NewData.RpmPct': 'rpmPct',
  'DataCorePlugin.GameData.NewData.ShiftIndicator': 'shiftPct',
  'DataCorePlugin.GameData.NewData.ShiftIndicatorPct': 'shiftPct',
  // ── Inputs ────────────────────────────────────────────────────────────────
  'DataCorePlugin.GameData.NewData.Throttle': 'throttle',
  'DataCorePlugin.GameData.NewData.Gas': 'throttle',
  'DataCorePlugin.GameData.NewData.InputsGas': 'throttle',
  'DataCorePlugin.GameData.NewData.Brake': 'brake',
  'DataCorePlugin.GameData.NewData.InputsBrakes': 'brake',
  'DataCorePlugin.GameData.NewData.Clutch': 'clutch',
  'DataCorePlugin.GameData.NewData.InputsClutch': 'clutch',
  'DataCorePlugin.GameData.NewData.Steer': 'steerAngleDeg',
  'DataCorePlugin.GameData.NewData.SteeringWheelAngle': 'steerAngleDeg',
  // ── Lap times ─────────────────────────────────────────────────────────────
  'DataCorePlugin.GameData.NewData.CurrentLapTime': 'currentLapFmt',
  'DataCorePlugin.GameData.NewData.CurrentLapTimeRaw': 'currentLapTimeSec',
  'DataCorePlugin.GameData.NewData.LastLapTime': 'lastLapFmt',
  'DataCorePlugin.GameData.NewData.LastLapTimeRaw': 'lastLapTimeSec',
  'DataCorePlugin.GameData.NewData.BestLapTime': 'bestLapFmt',
  'DataCorePlugin.GameData.NewData.BestLapTimeRaw': 'bestLapTimeSec',
  'DataCorePlugin.GameData.NewData.EstimatedLapTime': 'estimatedLapTimeSec',
  // ── Deltas ────────────────────────────────────────────────────────────────
  'DataCorePlugin.GameData.NewData.DeltaToBestLap': 'deltaBestFmt',
  'DataCorePlugin.GameData.NewData.DeltaToBestLapRaw': 'deltaToBestSec',
  'DataCorePlugin.GameData.NewData.DeltaToSessionBest': 'deltaSessionBestFmt',
  'DataCorePlugin.GameData.NewData.DeltaToSessionBestRaw': 'deltaToSessionBestSec',
  // ── Session ───────────────────────────────────────────────────────────────
  'DataCorePlugin.GameData.NewData.SessionTimeLeft': 'sessionTimeLeftFmt',
  'DataCorePlugin.GameData.NewData.SessionTimeLeftRaw': 'sessionTimeRemainingSec',
  'DataCorePlugin.GameData.NewData.CurrentLap': 'currentLap',
  'DataCorePlugin.GameData.NewData.RemainingLaps': 'lapsRemaining',
  'DataCorePlugin.GameData.NewData.LapsRemaining': 'lapsRemaining',
  'DataCorePlugin.GameData.NewData.LapDistPct': 'lapDistPct',
  'DataCorePlugin.GameData.NewData.TrackPositionPercent': 'lapDistPct',
  'DataCorePlugin.GameData.NewData.Position': 'position',
  'DataCorePlugin.GameData.NewData.ClassPosition': 'classPosition',
  'DataCorePlugin.GameData.NewData.OpponentsCount': 'totalCars',
  'DataCorePlugin.GameData.NewData.TotalOpponentsCount': 'totalCars',
  'DataCorePlugin.GameData.NewData.PlayerCount': 'totalCars',
  // ── Fuel ──────────────────────────────────────────────────────────────────
  'DataCorePlugin.GameData.NewData.Fuel': 'fuelLitersStr',
  'DataCorePlugin.GameData.NewData.FuelRemaining': 'fuelLitersStr',
  'DataCorePlugin.GameData.NewData.FuelPercent': 'fuelPct',
  'DataCorePlugin.GameData.NewData.FuelPercentage': 'fuelPct',
  'DataCorePlugin.GameData.NewData.FuelPerLap': 'fuelPerLapStr',
  'DataCorePlugin.GameData.NewData.FuelUsedLap': 'fuelPerLap',
  'DataCorePlugin.GameData.NewData.FuelCapacity': 'fuelCapacityLiters',
  'DataCorePlugin.GameData.NewData.MaxFuel': 'fuelCapacityLiters',
  // ── Incidents ─────────────────────────────────────────────────────────────
  'DataCorePlugin.GameRawData.PlayerCarMyIncidentCount': 'incidentCount',
  'DataCorePlugin.GameRawData.Telemetry.PlayerCarMyIncidentCount': 'incidentCount',
  'DataCorePlugin.GameData.NewData.MaxIncidentCount': 'incidentLimit',
  'DataCorePlugin.GameData.NewData.IncidentLimit': 'incidentLimit',
  // ── Climate ───────────────────────────────────────────────────────────────
  'DataCorePlugin.GameData.NewData.TrackTemperature': 'trackTempC',
  'DataCorePlugin.GameData.NewData.AirTemperature': 'airTempC',
  'DataCorePlugin.GameData.NewData.TrackWetness': 'trackWetnessPct',
  'DataCorePlugin.GameData.NewData.GripLevel': 'gripPct',
  // ── Assists / Flags ───────────────────────────────────────────────────────
  'DataCorePlugin.GameData.NewData.ABSActive': 'absActive',
  'DataCorePlugin.GameData.NewData.TCActive': 'tcActive',
  'DataCorePlugin.GameData.NewData.DRSEnabled': 'drs',
  'DataCorePlugin.GameData.NewData.DRS_Enabled': 'drs',
  'DataCorePlugin.GameData.NewData.DRSActive': 'drs',
  // ── Gaps ──────────────────────────────────────────────────────────────────
  'DataCorePlugin.GameData.OpponentsAhead[0].GapToPlayer': 'gapAhead',
  'DataCorePlugin.GameData.OpponentsAhead[0].GaptoPlayer': 'gapAhead',
  'DataCorePlugin.GameData.OpponentsBehind[0].GapToPlayer': 'gapBehind',
  'DataCorePlugin.GameData.OpponentsBehind[0].GaptoPlayer': 'gapBehind',
  'DataCorePlugin.GameData.NewData.OpponentsAheadOnTrack_01_GaptoPlayer': 'gapAhead',
  'DataCorePlugin.GameData.NewData.OpponentsBehindOnTrack_01_GaptoPlayer': 'gapBehind'
}

const EXTRA_PROP_TO_BINDING: Record<string, string> = {
  // Speed / distance
  'DataCorePlugin.GameData.NewData.SpeedMph': 'speedMph',
  'DataCorePlugin.GameData.NewData.SpeedMPH': 'speedMph',
  'DataCorePlugin.GameRawData.Telemetry.Speed': 'speedKmh',
  'DataCorePlugin.GameRawData.Telemetry.PlayerCarIdxLapDistPct': 'lapDistPct',
  'DataCorePlugin.GameRawData.Telemetry.LapDistPct': 'lapDistPct',
  // RPM / gear / limiter
  'DataCorePlugin.GameData.NewData.RPMShiftLight': 'shiftPct',
  'DataCorePlugin.GameData.NewData.CarSettings_RPMShiftLight': 'shiftPct',
  'DataCorePlugin.GameRawData.Telemetry.RPM': 'rpm',
  'DataCorePlugin.GameRawData.Telemetry.Gear': 'gearLabel',
  'DataCorePlugin.GameRawData.Telemetry.PlayerCarSLFirstRPM': 'shiftPct',
  'DataCorePlugin.GameRawData.Telemetry.PlayerCarSLShiftRPM': 'shiftPct',
  'DataCorePlugin.GameRawData.Telemetry.PlayerCarSLBlinkRPM': 'shiftPct',
  'DataCorePlugin.GameData.NewData.PitLimiterOn': 'pitLimiter',
  'DataCorePlugin.GameRawData.Telemetry.PlayerCarPitSvFlags': 'pitLimiter',
  // Inputs / setup
  'DataCorePlugin.GameRawData.Telemetry.Throttle': 'throttle',
  'DataCorePlugin.GameRawData.Telemetry.Brake': 'brake',
  'DataCorePlugin.GameRawData.Telemetry.Clutch': 'clutch',
  'DataCorePlugin.GameRawData.Telemetry.SteeringWheelAngle': 'steerAngleDeg',
  'DataCorePlugin.GameRawData.Telemetry.SteeringWheelPctTorque': 'steerTorquePct',
  'DataCorePlugin.GameRawData.Telemetry.dcABS': 'absLevel',
  'DataCorePlugin.GameRawData.Telemetry.dcTractionControl': 'tcLevel',
  'DataCorePlugin.GameRawData.Telemetry.dcThrottleShape': 'throttleMap',
  'DataCorePlugin.GameRawData.Telemetry.dcBrakeBias': 'brakeBias',
  'DataCorePlugin.GameData.NewData.BrakeBias': 'brakeBias',
  'DataCorePlugin.GameData.NewData.EngineMap': 'engineMap',
  // Fuel
  'DataCorePlugin.GameData.NewData.Fuel_Liters': 'fuelLitersStr',
  'DataCorePlugin.GameData.NewData.FuelLevel': 'fuelLitersStr',
  'DataCorePlugin.GameData.NewData.FuelRemainingLaps': 'fuelLapsLeftStr',
  'DataCorePlugin.GameData.NewData.FuelLapsLeft': 'fuelLapsLeftStr',
  'DataCorePlugin.GameData.NewData.FuelRange': 'fuelLapsLeftStr',
  'DataCorePlugin.GameData.NewData.FuelNeeded': 'fuelNeededLiters',
  'DataCorePlugin.GameData.NewData.FuelToAdd': 'fuelToAddLiters',
  'DataCorePlugin.GameRawData.Telemetry.FuelLevel': 'fuelLitersStr',
  'DataCorePlugin.GameRawData.Telemetry.FuelLevelPct': 'fuelPct',
  // Lap / sectors / positions
  'DataCorePlugin.GameData.NewData.CurrentLapTimeString': 'currentLapFmt',
  'DataCorePlugin.GameData.NewData.LastLapTimeString': 'lastLapFmt',
  'DataCorePlugin.GameData.NewData.BestLapTimeString': 'bestLapFmt',
  'DataCorePlugin.GameData.NewData.PersonalBestLapTime': 'bestLapFmt',
  'DataCorePlugin.GameData.NewData.SessionBestLapTime': 'sessionBestLapFmt',
  'DataCorePlugin.GameData.NewData.DeltaPersonalBest': 'deltaBestFmt',
  'DataCorePlugin.GameData.NewData.DeltaSessionBest': 'deltaSessionBestFmt',
  'DataCorePlugin.GameData.NewData.DeltaToOptimal': 'deltaOptimalFmt',
  'DataCorePlugin.GameData.NewData.OptimalLapTime': 'optimalLapFmt',
  'DataCorePlugin.GameData.NewData.CurrentSector1Time': 'sector1Fmt',
  'DataCorePlugin.GameData.NewData.CurrentSector2Time': 'sector2Fmt',
  'DataCorePlugin.GameData.NewData.CurrentSector3Time': 'sector3Fmt',
  'DataCorePlugin.GameData.NewData.LastSector1Time': 'lastSector1Fmt',
  'DataCorePlugin.GameData.NewData.LastSector2Time': 'lastSector2Fmt',
  'DataCorePlugin.GameData.NewData.LastSector3Time': 'lastSector3Fmt',
  'DataCorePlugin.GameData.NewData.CompletedLaps': 'currentLap',
  'DataCorePlugin.GameData.NewData.TotalLaps': 'totalLaps',
  'DataCorePlugin.GameData.NewData.SessionLaps': 'totalLaps',
  'DataCorePlugin.GameData.NewData.CarClassPosition': 'classPosition',
  'DataCorePlugin.GameData.NewData.NumberOfCars': 'totalCars',
  // Flags / race state
  'DataCorePlugin.GameData.NewData.Flag_Yellow': 'yellowFlag',
  'DataCorePlugin.GameData.NewData.Flag_Blue': 'blueFlag',
  'DataCorePlugin.GameData.NewData.Flag_Black': 'blackFlag',
  'DataCorePlugin.GameData.NewData.Flag_White': 'whiteFlag',
  'DataCorePlugin.GameData.NewData.Flag_Checkered': 'checkeredFlag',
  'DataCorePlugin.GameData.NewData.Flag_Green': 'greenFlag',
  'DataCorePlugin.GameData.NewData.GlobalYellow': 'yellowFlag',
  'DataCorePlugin.GameData.NewData.IsInPit': 'inPit',
  'DataCorePlugin.GameData.NewData.IsInPitLane': 'inPitLane',
  // DRS / assists
  'DataCorePlugin.GameData.NewData.DRSAvailable': 'drsAvailable',
  'DataCorePlugin.GameRawData.Telemetry.DRS_Status': 'drs',
  'DataCorePlugin.GameRawData.Telemetry.DRS_Active': 'drs',
  'DataCorePlugin.GameRawData.Telemetry.ABSActive': 'absActive',
  'DataCorePlugin.GameRawData.Telemetry.TCActive': 'tcActive',
  // Engine / weather
  'DataCorePlugin.GameData.NewData.WaterTemperature': 'waterTempC',
  'DataCorePlugin.GameData.NewData.OilTemperature': 'oilTempC',
  'DataCorePlugin.GameData.NewData.OilPressure': 'oilPressure',
  'DataCorePlugin.GameRawData.Telemetry.WaterTemp': 'waterTempC',
  'DataCorePlugin.GameRawData.Telemetry.OilTemp': 'oilTempC',
  'DataCorePlugin.GameRawData.Telemetry.OilPress': 'oilPressure',
  'DataCorePlugin.GameData.NewData.AmbientTemperature': 'airTempC',
  'DataCorePlugin.GameData.NewData.RainIntensity': 'rainPct',
  // GT tyre temps
  'DataCorePlugin.GameData.NewData.TyreTemperatureFrontLeft': 'tyreTempFL',
  'DataCorePlugin.GameData.NewData.TyreTemperatureFrontRight': 'tyreTempFR',
  'DataCorePlugin.GameData.NewData.TyreTemperatureRearLeft': 'tyreTempRL',
  'DataCorePlugin.GameData.NewData.TyreTemperatureRearRight': 'tyreTempRR',
  'DataCorePlugin.GameData.NewData.TyrePressureFrontLeft': 'tyrePressureFL',
  'DataCorePlugin.GameData.NewData.TyrePressureFrontRight': 'tyrePressureFR',
  'DataCorePlugin.GameData.NewData.TyrePressureRearLeft': 'tyrePressureRL',
  'DataCorePlugin.GameData.NewData.TyrePressureRearRight': 'tyrePressureRR',
  'DataCorePlugin.GameData.NewData.TyreWearFrontLeft': 'tyreWearFL',
  'DataCorePlugin.GameData.NewData.TyreWearFrontRight': 'tyreWearFR',
  'DataCorePlugin.GameData.NewData.TyreWearRearLeft': 'tyreWearRL',
  'DataCorePlugin.GameData.NewData.TyreWearRearRight': 'tyreWearRR',
  'DataCorePlugin.GameData.NewData.BrakeTemperatureFrontLeft': 'brakeTempFL',
  'DataCorePlugin.GameData.NewData.BrakeTemperatureFrontRight': 'brakeTempFR',
  'DataCorePlugin.GameData.NewData.BrakeTemperatureRearLeft': 'brakeTempRL',
  'DataCorePlugin.GameData.NewData.BrakeTemperatureRearRight': 'brakeTempRR',
  // iRacing raw tyre/brake aliases
  'DataCorePlugin.GameRawData.Telemetry.LFtempCL': 'tyreTempFL',
  'DataCorePlugin.GameRawData.Telemetry.RFtempCL': 'tyreTempFR',
  'DataCorePlugin.GameRawData.Telemetry.LRtempCL': 'tyreTempRL',
  'DataCorePlugin.GameRawData.Telemetry.RRtempCL': 'tyreTempRR',
  'DataCorePlugin.GameRawData.Telemetry.LFpressure': 'tyrePressureFL',
  'DataCorePlugin.GameRawData.Telemetry.RFpressure': 'tyrePressureFR',
  'DataCorePlugin.GameRawData.Telemetry.LRpressure': 'tyrePressureRL',
  'DataCorePlugin.GameRawData.Telemetry.RRpressure': 'tyrePressureRR',
  'DataCorePlugin.GameRawData.Telemetry.LFwearL': 'tyreWearFL',
  'DataCorePlugin.GameRawData.Telemetry.RFwearL': 'tyreWearFR',
  'DataCorePlugin.GameRawData.Telemetry.LRwearL': 'tyreWearRL',
  'DataCorePlugin.GameRawData.Telemetry.RRwearL': 'tyreWearRR',
  'DataCorePlugin.GameRawData.Telemetry.LFbrakeLinePress': 'brakeTempFL',
  'DataCorePlugin.GameRawData.Telemetry.RFbrakeLinePress': 'brakeTempFR',
  'DataCorePlugin.GameRawData.Telemetry.LRbrakeLinePress': 'brakeTempRL',
  'DataCorePlugin.GameRawData.Telemetry.RRbrakeLinePress': 'brakeTempRR'
}
Object.assign(PROP_TO_BINDING, EXTRA_PROP_TO_BINDING)

function normalizePropName(prop: string): string {
  return prop.replace(/\+/g, '.').replace(/\[/g, '.').replace(/\]/g, '').replace(/^\.+|\.+$/g, '')
}

function heuristicBindingFromProp(prop: string): string | undefined {
  const normalized = normalizePropName(prop)
  const mapped = PROP_TO_BINDING[normalized]
  if (mapped) return mapped
  const seg = normalized.split('.').pop() ?? normalized
  const lower = seg.toLowerCase().replace(/[^a-z0-9]/g, '')
  const full = normalized.toLowerCase()
  const corner = /frontleft|leftfront|\blf\b|_fl|fl$/.test(full) ? 'FL'
    : /frontright|rightfront|\brf\b|_fr|fr$/.test(full) ? 'FR'
      : /rearleft|leftrear|\blr\b|_rl|rl$/.test(full) ? 'RL'
        : /rearright|rightrear|\brr\b|_rr|rr$/.test(full) ? 'RR'
          : undefined
  if (corner) {
    if (/tyre|tire|wheel/.test(full) && /temp/.test(full)) return `tyreTemp${corner}`
    if (/tyre|tire|wheel/.test(full) && /press/.test(full)) return `tyrePressure${corner}`
    if (/tyre|tire|wheel/.test(full) && /wear|tread/.test(full)) return `tyreWear${corner}`
    if (/brake/.test(full) && /temp|linepress|pressure/.test(full)) return `brakeTemp${corner}`
  }
  if (lower.includes('speedmph')) return 'speedMph'
  if (lower.includes('speed')) return 'speedKmh'
  if (lower === 'gear' || lower.endsWith('gear')) return 'gearLabel'
  if (lower === 'rpms' || lower === 'rpm') return 'rpm'
  if (lower.includes('maxrpm')) return 'maxRpm'
  if (lower.includes('rpmpct')) return 'rpmPct'
  if (lower.includes('shiftindicator') || lower.includes('shiftlight') || lower.includes('rpmshift')) return 'shiftPct'
  if (lower.includes('pitlimiter')) return 'pitLimiter'
  if (lower === 'throttle' || lower === 'gas' || lower.includes('inputsgas')) return 'throttle'
  if (lower === 'brake' || lower.includes('inputsbrake')) return 'brake'
  if (lower === 'clutch' || lower.includes('inputsclutch')) return 'clutch'
  if (lower.includes('steer')) return 'steerAngleDeg'
  if (lower.includes('brakebias')) return 'brakeBias'
  if (lower === 'absactive') return 'absActive'
  if (lower === 'tcactive' || lower.includes('tractioncontrolactive')) return 'tcActive'
  if (lower === 'abs' || lower.includes('dca bs'.replace(' ', ''))) return 'absLevel'
  if (lower === 'tc' || lower.includes('tractioncontrol')) return 'tcLevel'
  if (lower.includes('drsavailable')) return 'drsAvailable'
  if (lower.includes('drs')) return 'drs'
  if (lower === 'fuelpct' || lower.includes('fuelpercent') || lower.includes('fuellevelpct')) return 'fuelPct'
  if (lower.includes('fuellaps') || lower.includes('fuelremaininglaps') || lower.includes('fuelrange')) return 'fuelLapsLeftStr'
  if (lower.includes('fuelused') || lower.includes('fuelperlap')) return 'fuelPerLapStr'
  if (lower.includes('fuelcap') || lower.includes('maxfuel')) return 'fuelCapacityLiters'
  if (lower.includes('fuel')) return 'fuelLitersStr'
  if (lower.includes('estimatedlap')) return 'estimatedLapTimeSec'
  if (lower.includes('optimallap')) return 'optimalLapFmt'
  if (lower.includes('sessionbestlap')) return 'sessionBestLapFmt'
  if (lower.includes('bestlap') && lower.includes('raw')) return 'bestLapTimeSec'
  if (lower.includes('bestlap') || lower.includes('personalbest')) return 'bestLapFmt'
  if (lower.includes('lastlap') && lower.includes('raw')) return 'lastLapTimeSec'
  if (lower.includes('lastlap')) return 'lastLapFmt'
  if (lower.includes('sector1')) return 'sector1Fmt'
  if (lower.includes('sector2')) return 'sector2Fmt'
  if (lower.includes('sector3')) return 'sector3Fmt'
  if (lower.includes('lap') && lower.includes('time')) return 'currentLapFmt'
  if (lower.includes('delta') && lower.includes('optimal')) return 'deltaOptimalFmt'
  if (lower.includes('delta') && (lower.includes('best') || lower.includes('personal'))) return 'deltaBestFmt'
  if (lower.includes('delta')) return 'deltaSessionBestFmt'
  if (lower.includes('timeleft') || lower.includes('sessiontime')) return 'sessionTimeLeftFmt'
  if (lower.includes('classposition') || lower.includes('carclassposition')) return 'classPosition'
  if (lower.includes('position')) return 'position'
  if (lower.includes('lapdist') || lower.includes('trackposition')) return 'lapDistPct'
  if (lower.includes('lapsremaining') || lower.includes('remaininglaps')) return 'lapsRemaining'
  if (lower.includes('totallaps') || lower.includes('sessionlaps')) return 'totalLaps'
  if (lower.includes('currentlap') || lower.includes('completedlaps')) return 'currentLap'
  if (lower.includes('opponent') || lower.includes('playercount') || lower.includes('totalcars') || lower.includes('numberofcars')) return 'totalCars'
  if (lower === 'incidentlimit' || lower.includes('maxincident')) return 'incidentLimit'
  if (lower.includes('incident')) return 'incidentCount'
  if (lower.includes('yellow')) return 'yellowFlag'
  if (lower.includes('blueflag')) return 'blueFlag'
  if (lower.includes('blackflag')) return 'blackFlag'
  if (lower.includes('whiteflag')) return 'whiteFlag'
  if (lower.includes('checkered') || lower.includes('chequered')) return 'checkeredFlag'
  if (lower.includes('greenflag')) return 'greenFlag'
  if (lower.includes('tracktemp')) return 'trackTempC'
  if (lower.includes('airtemp') || lower.includes('ambienttemp')) return 'airTempC'
  if (lower.includes('watertemp')) return 'waterTempC'
  if (lower.includes('oiltemp')) return 'oilTempC'
  if (lower.includes('oilpress')) return 'oilPressure'
  if (lower.includes('trackwetness') || lower.includes('wetness') || lower.includes('rain')) return 'trackWetnessPct'
  if (lower.includes('grip')) return 'gripPct'
  if (lower.includes('gapahead') || (lower.includes('gap') && lower.includes('ahead'))) return 'gapAhead'
  if (lower.includes('gapbehind') || (lower.includes('gap') && lower.includes('behind'))) return 'gapBehind'
  return undefined
}

function expressionProps(expression: string): string[] {
  const props: string[] = []
  const patterns = [
    /\$prop\(\s*['"]([^'"]+)['"]\s*\)/gi,
    /prop\(\s*['"]([^'"]+)['"]\s*\)/gi,
    /property\(\s*['"]([^'"]+)['"]\s*\)/gi,
    /\[([A-Za-z0-9_.\-[\]]{3,})\]/g
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(expression)) !== null) props.push(m[1])
  }
  return props
}

function detectBindingFromExpression(expression: string | undefined): string | undefined {
  if (!expression) return undefined
  const props = expressionProps(expression)
  const scored = new Map<string, number>()
  props.forEach((prop, index) => {
    const binding = heuristicBindingFromProp(prop)
    if (!binding) return
    const propLower = prop.toLowerCase()
    let score = 20 - index
    if (/rpm|gear|speed|fuel|delta|lap|tyre|tire|brake|flag|drs|abs|tc/.test(propLower)) score += 5
    scored.set(binding, (scored.get(binding) ?? 0) + score)
  })
  if (scored.size > 0) {
    return Array.from(scored.entries()).sort((a, b) => b[1] - a[1])[0][0]
  }
  const cleaned = expression
    .replace(/format|isnull|if|return|math|min|max|round|floor|ceil|abs|timespan|tostring|tonumber/gi, ' ')
    .replace(/['"`]/g, ' ')
  for (const token of cleaned.split(/[^A-Za-z0-9_.\-[\]]+/).filter((t) => t.length > 2)) {
    const binding = heuristicBindingFromProp(token)
    if (binding) return binding
  }
  return undefined
}

// Detecta padrão de "shift LED por índice" (BackgroundColor com Math)
function looksLikeShiftLed(name: string | undefined, expression: string | undefined): boolean {
  if (!expression) return false
  return /CarSettings_RPMShiftLight|PlayerCarSLBlinkRPM|PlayerCarSLFirstRPM/.test(expression) ||
    /shiftled|shiftlight|shift_light|shift_led/i.test(name ?? '')
}

interface SimhubBorderStyle {
  BorderColor?: string
  BorderTop?: number
  BorderBottom?: number
  BorderLeft?: number
  BorderRight?: number
  RadiusTopLeft?: number
  RadiusTopRight?: number
  RadiusBottomLeft?: number
  RadiusBottomRight?: number
}

interface SimhubBinding {
  Formula?: { Expression?: string }
}

interface SimhubElement {
  $type?: string
  Name?: string
  Left?: number
  Top?: number
  Width?: number
  Height?: number
  Visible?: boolean
  Text?: string
  Font?: string
  FontWeight?: string
  FontSize?: number
  TextColor?: string
  BackgroundColor?: string
  ForegroundColor?: string  // BarItem, GaugeItem: fill / needle color
  FillColor?: string         // alternate field name in some SimHub versions
  MinValue?: number          // BarItem/GaugeItem: range minimum
  MaxValue?: number          // BarItem/GaugeItem: range maximum
  Orientation?: number       // BarItem: 0 = horizontal, 1 = vertical
  FillDirection?: number
  Direction?: number
  StartAngle?: number
  SweepAngle?: number
  Angle?: number
  Image?: string
  ImageData?: string
  ImageBase64?: string
  Source?: string
  FileName?: string
  ImagePath?: string
  ResourceName?: string
  BorderStyle?: SimhubBorderStyle
  HorizontalAlignment?: number
  VerticalAlignment?: number
  Bindings?: Record<string, SimhubBinding>
  Childrens?: SimhubElement[]
  Group?: boolean
}

function shortType(typeStr: string | undefined): string {
  if (!typeStr) return ''
  return typeStr.split(',')[0].split('.').pop() ?? ''
}

function alignFromInt(value: number | undefined): DashboardElementStyle['align'] {
  if (value === 1) return 'left'
  if (value === 2) return 'center'
  if (value === 3) return 'right'
  return undefined
}

function safeJsonParse<T>(data: Buffer, label: string, notes: string[]): T | undefined {
  try {
    return JSON.parse(data.toString('utf8')) as T
  } catch (err) {
    notes.push(`${label} invalid ignored: ${err instanceof Error ? err.message : 'malformed JSON'}.`)
    return undefined
  }
}

function mimeFromName(name: string): string | undefined {
  const lower = name.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  return undefined
}

function looksLikeBase64Image(value: string): boolean {
  return /^data:image\//i.test(value) || /^[A-Za-z0-9+/=\r\n]+$/.test(value.trim())
}

interface ZipFileEntry {
  path: string
  uncompressedSize?: number
  buffer(): Promise<Buffer>
}

interface ImageLookupContext {
  files: ZipFileEntry[]
  notes: string[]
}

async function resolveImageSource(item: SimhubElement, ctx?: ImageLookupContext): Promise<string | undefined> {
  const record = item as unknown as Record<string, unknown>
  for (const key of ['Image', 'ImageData', 'ImageBase64', 'Data', 'Bitmap']) {
    const raw = record[key]
    if (typeof raw !== 'string' || raw.trim().length === 0) continue
    const value = raw.trim()
    if (/^data:image\//i.test(value)) return value.length <= MAX_EMBEDDED_IMAGE_BYTES * 2 ? value : undefined
    if (looksLikeBase64Image(value)) {
      const bytes = Buffer.from(value.replace(/\s/g, ''), 'base64')
      if (bytes.length > 0 && bytes.length <= MAX_EMBEDDED_IMAGE_BYTES) {
        return `data:image/png;base64,${bytes.toString('base64')}`
      }
    }
  }
  if (!ctx) return undefined
  const candidates = ['Source', 'FileName', 'ImagePath', 'ResourceName', 'Path']
    .map((key) => record[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  const names = candidates.map((value) => value.replace(/\\/g, '/').split('/').pop()?.toLowerCase()).filter(Boolean) as string[]
  const entry = ctx.files.find((file) => {
    const base = file.path.replace(/\\/g, '/').split('/').pop()?.toLowerCase()
    const mime = mimeFromName(file.path)
    return Boolean(mime && base && (names.includes(base) || candidates.some((candidate) => file.path.toLowerCase().endsWith(candidate.toLowerCase().replace(/\\/g, '/')))))
  })
  if (!entry) return undefined
  const size = typeof entry.uncompressedSize === 'number' ? entry.uncompressedSize : undefined
  if (size !== undefined && size > MAX_EMBEDDED_IMAGE_BYTES) {
    ctx.notes.push(`Imagem "${entry.path}" exceeds ${Math.round(MAX_EMBEDDED_IMAGE_BYTES / 1024 / 1024)} MB e was replaced with a rectangle.`)
    return undefined
  }
  const buffer = await entry.buffer()
  if (buffer.length > MAX_EMBEDDED_IMAGE_BYTES) {
    ctx.notes.push(`Imagem "${entry.path}" exceeds ${Math.round(MAX_EMBEDDED_IMAGE_BYTES / 1024 / 1024)} MB e was replaced with a rectangle.`)
    return undefined
  }
  const mime = mimeFromName(entry.path) ?? 'image/png'
  return `data:${mime};base64,${buffer.toString('base64')}`
}

interface MapContext {
  image?: ImageLookupContext
  notes: string[]
  unknownExpressions: Set<string>
}

function flattenSimhubElements(items: SimhubElement[]): SimhubElement[] {
  const out: SimhubElement[] = []
  function walk(arr: SimhubElement[]): void {
    for (const item of arr) {
      const type = shortType(item.$type)
      // Layer and GroupItem act as transparent containers — flatten into children.
      if ((type === 'Layer' || type === 'GroupItem') && Array.isArray(item.Childrens)) {
        walk(item.Childrens)
      } else {
        out.push(item)
      }
    }
  }
  walk(items)
  return out
}

async function mapElement(item: SimhubElement, idx: number, ctx: MapContext): Promise<DashboardElement | null> {
  const type = shortType(item.$type)
  const x = num(item.Left)
  const y = num(item.Top)
  const w = num(item.Width, 120)
  const h = num(item.Height, 40)
  const bs = item.BorderStyle ?? {}
  const radius = Math.max(
    num(bs.RadiusTopLeft),
    num(bs.RadiusTopRight),
    num(bs.RadiusBottomLeft),
    num(bs.RadiusBottomRight)
  )
  const borderWidth = Math.max(
    num(bs.BorderTop),
    num(bs.BorderBottom),
    num(bs.BorderLeft),
    num(bs.BorderRight)
  )
  const style: DashboardElementStyle = {
    background: argbToCss(item.BackgroundColor),
    border: argbToCss(bs.BorderColor),
    borderWidth: borderWidth || undefined,
    radius: radius || undefined
  }

  const bindingsObj = item.Bindings ?? {}
  const textBinding = bindingsObj.Text?.Formula?.Expression
  const bgBinding = bindingsObj.BackgroundColor?.Formula?.Expression
  const valueBinding = bindingsObj.Value?.Formula?.Expression

  function noteUnknownExpression(expr: string | undefined, target: string): void {
    if (!expr || detectBindingFromExpression(expr)) return
    const compact = expr.replace(/\s+/g, ' ').trim().slice(0, 140)
    if (compact) ctx.unknownExpressions.add(`${target}: ${compact}`)
  }

  let elType: DashboardElementType = 'text'
  let binding: string | undefined
  const name = item.Name

  if (type === 'TextItem' || type === 'TextBlockItem') {
    elType = 'text'
    style.color = argbToCss(item.TextColor) ?? '#f6fbff'
    style.fontFamily = item.Font ? `${item.Font}, sans-serif` : 'Segoe UI, sans-serif'
    style.fontSize = num(item.FontSize, 18)
    style.fontWeight = item.FontWeight ?? 600
    style.align = alignFromInt(item.HorizontalAlignment) ?? 'left'
    style.text = item.Text ?? ''
    binding = detectBindingFromExpression(textBinding)
    noteUnknownExpression(textBinding, name ?? type)
    if (binding) {
      // Esvaziar texto literal — o binding manda
      style.text = undefined
    }
  } else if (type === 'RectangleItem') {
    if (looksLikeShiftLed(name, bgBinding)) {
      // Sinaliza para o pós-processamento agrupar como shiftlights
      elType = 'rect'
      binding = 'shiftPct'
      ;(style as DashboardElementStyle & { __shiftLed?: boolean }).__shiftLed = true
    } else {
      elType = 'rect'
      noteUnknownExpression(bgBinding, name ?? type)
    }
  } else if (type === 'BarItem' || type === 'ProgressItem' || type === 'ProgressBarItem') {
    elType = (item.Orientation === 1 || /vertical|up|down/i.test(str((item as SimhubElement & { FillMode?: string }).FillMode))) ? 'barv' : 'bar'
    if (item.FillDirection === 1 || item.Direction === 1) style.reverse = true
    const fillHex = item.ForegroundColor ?? item.FillColor
    style.fillColor = argbToCss(fillHex) ?? '#49C5B1'
    style.warnColor = '#ffb84d'
    style.dangerColor = '#ff5468'
    style.warnAt = 0.75
    style.dangerAt = 0.90
    // Prefer the explicit Value binding; fall back to Text/Background
    const valueExpr = valueBinding
    binding =
      detectBindingFromExpression(valueExpr) ??
      detectBindingFromExpression(textBinding) ??
      detectBindingFromExpression(bgBinding)
    noteUnknownExpression(valueExpr ?? textBinding ?? bgBinding, name ?? type)
  } else if (
    type === 'GaugeItem' ||
    type === 'RotatingNeedleItem' ||
    type === 'DigitalGaugeItem' ||
    type === 'AnalogGaugeItem'
  ) {
    elType = 'gauge'
    const fillHex = item.ForegroundColor ?? item.FillColor
    style.fillColor = argbToCss(fillHex) ?? '#3ea0ff'
    style.warnColor = '#ffb84d'
    style.dangerColor = '#ff5468'
    style.warnAt = 0.75
    style.dangerAt = 0.90
    const valueExpr = valueBinding
    binding =
      detectBindingFromExpression(valueExpr) ??
      detectBindingFromExpression(textBinding) ??
      detectBindingFromExpression(bgBinding)
    const gaugeStyle = style as DashboardElementStyle & { startAngle?: number; sweepAngle?: number }
    if (typeof item.StartAngle === 'number') gaugeStyle.startAngle = item.StartAngle
    if (typeof item.SweepAngle === 'number' || typeof item.Angle === 'number') gaugeStyle.sweepAngle = item.SweepAngle ?? item.Angle
    noteUnknownExpression(valueExpr ?? textBinding ?? bgBinding, name ?? type)
  } else if (type === 'ShiftLightsItem') {
    // Entire shift-light bar — map directly to shiftlights
    elType = 'shiftlights'
    binding = 'shiftPct'
    style.fillColor = '#3ea0ff'
    style.warnColor = '#ffb84d'
    style.dangerColor = '#ff5468'
    style.warnAt = 0.60
    style.dangerAt = 0.85
  } else if (type === 'ShiftLightItem' || type === 'ShiftLight') {
    // Individual LED — mark for consolidation by consolidateShiftLeds()
    elType = 'rect'
    binding = 'shiftPct'
    ;(style as DashboardElementStyle & { __shiftLed?: boolean }).__shiftLed = true
  } else if (type === 'GeneratedMapItem') {
    elType = 'map'
    style.fillColor = argbToCss((item as SimhubElement & { CursorColor?: string }).CursorColor) ?? '#49C5B1'
  } else if (type === 'RadarItem') {
    elType = 'radar'
    style.fillColor = '#49C5B1'
  } else if (type === 'ImageItem' || type === 'StaticImageItem') {
    const src = await resolveImageSource(item, ctx.image)
    if (src) {
      elType = 'image'
      style.src = src
      style.fit = 'contain'
      style.opacity = 1
      style.background = style.background ?? 'transparent'
    } else {
      elType = 'rect'
    }
  } else if (type === 'EllipseItem' || type === 'OvalItem') {
    elType = 'rect'
    style.radius = Math.max(style.radius ?? 0, Math.round(Math.min(w, h) / 2))
  } else {
    elType = 'rect'
  }

  return {
    id: createElementId(),
    type: elType,
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
    binding,
    style,
    name: name ?? `Item-${idx}`,
    visible: item.Visible !== false,
    sourceType: type
  }
}

function consolidateShiftLeds(elements: DashboardElement[]): DashboardElement[] {
  type AnyStyle = DashboardElementStyle & { __shiftLed?: boolean }
  const sl = elements.filter(
    (el) => el.type === 'rect' && (el.style as AnyStyle).__shiftLed === true
  )
  if (sl.length < 3) {
    // Limpa marker e retorna inalterado
    for (const el of elements) delete (el.style as AnyStyle).__shiftLed
    return elements
  }
  const minX = Math.min(...sl.map((el) => el.x))
  const minY = Math.min(...sl.map((el) => el.y))
  const maxX = Math.max(...sl.map((el) => el.x + el.w))
  const maxY = Math.max(...sl.map((el) => el.y + el.h))
  const consolidated: DashboardElement = {
    id: createElementId(),
    type: 'shiftlights',
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
    binding: 'shiftPct',
    name: 'ShiftLights',
    style: {
      background: '#0a0c10',
      border: '#1f2733',
      borderWidth: 1,
      radius: 10,
      segments: sl.length,
      fillColor: '#3ea0ff',
      warnColor: '#ffb84d',
      dangerColor: '#ff5468',
      warnAt: 0.6,
      dangerAt: 0.85
    }
  }
  const firstLedIndex = elements.findIndex((el) => el.type === 'rect' && (el.style as AnyStyle).__shiftLed === true)
  const filtered = elements.filter(
    (el) => !(el.type === 'rect' && (el.style as AnyStyle).__shiftLed === true)
  )
  for (const el of filtered) delete (el.style as AnyStyle).__shiftLed
  filtered.splice(Math.max(0, firstLedIndex), 0, consolidated)
  return filtered
}

interface SimhubScreen {
  Items?: SimhubElement[]
  Name?: string
  IdleScreen?: boolean
  InGameScreen?: boolean
  PitScreen?: boolean
  ScreenId?: string
  BackgroundColor?: string | number
}

interface SimhubDashRoot {
  BaseWidth?: number
  BaseHeight?: number
  BackgroundColor?: string
  Screens?: SimhubScreen[]
}

interface SimhubMetadata {
  Title?: string
  Description?: string
  Author?: string
  Width?: number
  Height?: number
}

export interface ImportScreenSummary {
  index: number
  name: string
  elementCount: number
  score: number
  selected: boolean
  inGame: boolean
  idle: boolean
  pit: boolean
}

export interface ImportResult {
  dashboard: Dashboard
  notes: string[]
  screens: ImportScreenSummary[]
  selectedScreenIndex: number
}

export interface ImportOptions {
  screenIndex?: number
}

// Scores a screen for selection: higher = more likely to be the main in-game screen.
function scoreScreen(s: SimhubScreen): number {
  let score = 0
  const name = (s.Name ?? '').toLowerCase()
  if (s.InGameScreen === true) score += 10
  if (s.IdleScreen === true) score -= 20
  if (s.PitScreen === true) score -= 5
  // Name hints (word-boundary safe)
  if (/\b(ingame|race|qualify|quali|main|dashboard|gt3)\b/.test(name)) score += 3
  if (/\b(idle|menu|splash|pit|background|loading)\b/.test(name)) score -= 5
  return score
}

function screenElementCount(screen: SimhubScreen): number {
  return flattenSimhubElements(Array.isArray(screen.Items) ? screen.Items : []).length
}

async function buildDashboardFromScreen(args: {
  screen: SimhubScreen | undefined
  screenIndex: number
  root: SimhubDashRoot
  metadata: SimhubMetadata
  djsonName: string
  previewPng?: string
  imageCtx: ImageLookupContext
  screens: ImportScreenSummary[]
}): Promise<ImportResult> {
  const notes = args.imageCtx.notes
  const items = Array.isArray(args.screen?.Items) ? args.screen.Items : []
  const flat = flattenSimhubElements(items)
  const unknownExpressions = new Set<string>()
  const mapped: DashboardElement[] = []
  for (let i = 0; i < flat.length; i += 1) {
    const el = await mapElement(flat[i], i, { image: args.imageCtx, notes, unknownExpressions })
    if (el) mapped.push(el)
  }
  const consolidated = consolidateShiftLeds(mapped)

  const baseW = num(args.root.BaseWidth ?? args.metadata.Width, 1920)
  const baseH = num(args.root.BaseHeight ?? args.metadata.Height, 1080)
  const bg = argbToCss(args.screen?.BackgroundColor ?? args.root.BackgroundColor) ?? '#000000'

  const KNOWN_TYPES = new Set([
    'TextItem', 'TextBlockItem',
    'RectangleItem',
    'BarItem', 'ProgressItem', 'ProgressBarItem',
    'GaugeItem', 'RotatingNeedleItem', 'DigitalGaugeItem', 'AnalogGaugeItem',
    'ShiftLightsItem', 'ShiftLightItem', 'ShiftLight',
    'GeneratedMapItem',
    'RadarItem',
    'ImageItem', 'StaticImageItem',
    'EllipseItem', 'OvalItem'
  ])

  const imageItems = flat.filter((it) => ['ImageItem', 'StaticImageItem'].includes(shortType(it.$type)))
  const importedImages = consolidated.filter((el) => el.type === 'image').length
  const ellipseItems = flat.filter((it) => ['EllipseItem', 'OvalItem'].includes(shortType(it.$type)))
  const unknownItems = flat.filter((it) => !KNOWN_TYPES.has(shortType(it.$type)))

  if (imageItems.length > 0) {
    if (importedImages > 0) notes.push(`${importedImages}/${imageItems.length} ImageItem(s) importado(s) como imagem embutida.`)
    if (importedImages < imageItems.length) notes.push(`${imageItems.length - importedImages} ImageItem(s) without an embedded/local image were replaced with rectangles.`)
  }
  if (ellipseItems.length > 0) notes.push(`${ellipseItems.length} EllipseItem(s)/OvalItem(s) approximated with rounded rectangles.`)
  if (unknownItems.length > 0) {
    const kinds = Array.from(new Set(unknownItems.map((it) => shortType(it.$type) || '(sem tipo)')))
    notes.push(`Unknown elements converted to rectangles: ${kinds.join(', ')} (${unknownItems.length} total).`)
  }
  if (unknownExpressions.size > 0) {
    const examples = Array.from(unknownExpressions).slice(0, 5)
    notes.push(`Bindings JS/NCalc sem mapeamento (${unknownExpressions.size}): ${examples.join(' | ')}${unknownExpressions.size > examples.length ? '…' : ''}`)
  }
  if (args.screens.length > 1) {
    notes.push(`Imported screen: "${args.screen?.Name ?? `Screen ${args.screenIndex + 1}`}" (${flat.length} element(s)). You can import another screen from the multi-screen selection.`)
  }

  const suffix = args.screens.length > 1 ? ` - ${args.screen?.Name ?? `Screen ${args.screenIndex + 1}`}` : ''
  const dashboard: Dashboard = {
    id: createDashboardId(),
    name: `${args.metadata.Title ?? args.djsonName}${suffix}`,
    width: baseW,
    height: baseH,
    bg,
    description: args.metadata.Description,
    author: args.metadata.Author,
    previewPng: args.previewPng,
    elements: consolidated,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  return { dashboard, notes, screens: args.screens, selectedScreenIndex: args.screenIndex }
}

export async function importSimhubDash(filePath: string, options: ImportOptions = {}): Promise<ImportResult> {
  let directory: { files: ZipFileEntry[] }
  try {
    directory = await unzipper.Open.file(filePath)
  } catch (err) {
    throw new Error(`Failed to open .simhubdash: ${err instanceof Error ? err.message : 'invalid file'}`)
  }
  const djsonEntry = directory.files.find(
    (f) =>
      f.path.toLowerCase().endsWith('.djson') &&
      !f.path.toLowerCase().endsWith('.djson.metadata') &&
      !f.path.toLowerCase().endsWith('.djson.ressources') &&
      !f.path.toLowerCase().endsWith('.djson.carclasses') &&
      !f.path.toLowerCase().endsWith('.djson.png')
  )
  if (!djsonEntry) throw new Error('.djson file not found in .simhubdash.')
  if (typeof djsonEntry.uncompressedSize === 'number' && djsonEntry.uncompressedSize > MAX_DJSON_BYTES) {
    throw new Error('.djson file is too large for safe import.')
  }

  const notes: string[] = []
  const djsonBuf = await djsonEntry.buffer()
  if (djsonBuf.length > MAX_DJSON_BYTES) throw new Error('.djson file is too large for safe import.')
  const root = safeJsonParse<SimhubDashRoot>(djsonBuf, '.djson', notes)
  if (!root) throw new Error('Invalid .djson file.')

  let metadata: SimhubMetadata = {}
  const metaEntry = directory.files.find((f) => f.path.toLowerCase().endsWith('.djson.metadata'))
  if (metaEntry) {
    try {
      const metaBuf = await metaEntry.buffer()
      metadata = safeJsonParse<SimhubMetadata>(metaBuf, 'metadata', notes) ?? {}
    } catch {
      notes.push('Metadata could not be read and was ignored.')
    }
  }

  let previewPng: string | undefined
  const pngEntry = directory.files.find((f) => f.path.toLowerCase().endsWith('.djson.png'))
  if (pngEntry) {
    try {
      const pngBuf = await pngEntry.buffer()
      if (pngBuf.length <= MAX_EMBEDDED_IMAGE_BYTES) previewPng = pngBuf.toString('base64')
      else notes.push('Preview PNG ignorado por exceedsr o limite de tamanho.')
    } catch {
      notes.push('Preview PNG invalid ignored.')
    }
  }

  const rawScreens = Array.isArray(root.Screens) ? root.Screens : []
  const screens = rawScreens.length > 0 ? rawScreens : [{ Name: 'Main', InGameScreen: true, Items: [] }]
  const ranked = screens
    .map((s, i) => ({ s, i, score: scoreScreen(s), count: screenElementCount(s) }))
    .sort((a, b) => b.score - a.score || b.count - a.count || a.i - b.i)
  const selectedIndex = options.screenIndex !== undefined && screens[options.screenIndex]
    ? options.screenIndex
    : ranked[0]?.i ?? 0
  const summaries = screens.map((screen, index) => ({
    index,
    name: screen.Name ?? `Tela ${index + 1}`,
    elementCount: screenElementCount(screen),
    score: scoreScreen(screen),
    selected: index === selectedIndex,
    inGame: screen.InGameScreen === true,
    idle: screen.IdleScreen === true,
    pit: screen.PitScreen === true
  }))

  return buildDashboardFromScreen({
    screen: screens[selectedIndex],
    screenIndex: selectedIndex,
    root,
    metadata,
    djsonName: djsonEntry.path.split(/[\\/]/).pop()?.replace(/\.djson$/i, '') ?? 'Imported',
    previewPng,
    imageCtx: { files: directory.files, notes },
    screens: summaries
  })
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────

const BINDING_TO_PROP: Record<string, string> = {
  speedKmh: 'DataCorePlugin.GameData.NewData.SpeedKmh',
  rpm: 'DataCorePlugin.GameData.NewData.Rpms',
  maxRpm: 'DataCorePlugin.GameData.NewData.MaxRpm',
  gear: 'DataCorePlugin.GameData.NewData.Gear',
  gearLabel: 'DataCorePlugin.GameData.NewData.Gear',
  currentLap: 'DataCorePlugin.GameData.NewData.CurrentLap',
  position: 'DataCorePlugin.GameData.NewData.Position',
  classPosition: 'DataCorePlugin.GameData.NewData.ClassPosition',
  currentLapFmt: 'DataCorePlugin.GameData.NewData.CurrentLapTime',
  lastLapFmt: 'DataCorePlugin.GameData.NewData.LastLapTime',
  bestLapFmt: 'DataCorePlugin.GameData.NewData.BestLapTime',
  deltaBestFmt: 'DataCorePlugin.GameData.NewData.DeltaToBestLap',
  deltaSessionBestFmt: 'DataCorePlugin.GameData.NewData.DeltaToSessionBest',
  sessionTimeLeftFmt: 'DataCorePlugin.GameData.NewData.SessionTimeLeft',
  fuelLiters: 'DataCorePlugin.GameData.NewData.Fuel',
  fuelLitersStr: 'DataCorePlugin.GameData.NewData.Fuel',
  fuelPerLap: 'DataCorePlugin.GameData.NewData.FuelPerLap',
  fuelPerLapStr: 'DataCorePlugin.GameData.NewData.FuelPerLap',
  incidentCount: 'DataCorePlugin.GameData.NewData.PlayerCarMyIncidentCount',
  trackTempC: 'DataCorePlugin.GameData.NewData.TrackTemperature',
  airTempC: 'DataCorePlugin.GameData.NewData.AirTemperature',
  absActive: 'DataCorePlugin.GameData.NewData.ABSActive',
  tcActive: 'DataCorePlugin.GameData.NewData.TCActive'
}

function bindingToExpression(binding: string | undefined): string | undefined {
  if (!binding) return undefined
  const prop = BINDING_TO_PROP[binding]
  if (!prop) return undefined
  return `var v = $prop('${prop}');\nif (v == null) return '---';\nreturn v.toString();`
}

interface ExportTextItem {
  $type: string
  IsTextItem: boolean
  Font: string
  FontWeight: string
  TextPadding: { PaddingTop: number; PaddingBottom: number; PaddingLeft: number; PaddingRight: number }
  TextWrapping: number
  FontSize: number
  Text: string
  TextColor: string
  HorizontalAlignment: number
  VerticalAlignment: number
  BackgroundColor: string
  BorderStyle: SimhubBorderStyle
  Height: number
  Left: number
  Top: number
  Visible: boolean
  Width: number
  Name: string
  Bindings?: Record<string, SimhubBinding>
}

interface ExportRectItem {
  $type: string
  BackgroundColor: string
  BorderStyle: SimhubBorderStyle
  Height: number
  Left: number
  Top: number
  Visible: boolean
  Width: number
  Name: string
}

function alignToInt(align: DashboardElementStyle['align']): number {
  if (align === 'center') return 2
  if (align === 'right') return 3
  return 1
}

function makeBorderStyle(el: DashboardElement): SimhubBorderStyle {
  const r = el.style.radius ?? 0
  const w = el.style.borderWidth ?? 0
  return {
    BorderColor: cssToArgb(el.style.border ?? '#FF1F1F1F'),
    BorderTop: w,
    BorderBottom: w,
    BorderLeft: w,
    BorderRight: w,
    RadiusTopLeft: r,
    RadiusTopRight: r,
    RadiusBottomLeft: r,
    RadiusBottomRight: r
  }
}

function toSimhubItem(el: DashboardElement): ExportTextItem | ExportRectItem | null {
  if (el.type === 'text') {
    const expression = bindingToExpression(el.binding)
    const bindings = expression
      ? { Text: { Formula: { Expression: expression, JSExt: 1, Interpreter: 1 } } }
      : undefined
    return {
      $type: 'SimHub.Plugins.OutputPlugins.GraphicalDash.Models.TextItem, SimHub.Plugins',
      IsTextItem: true,
      Font: (el.style.fontFamily ?? 'Segoe UI').split(',')[0].trim(),
      FontWeight: typeof el.style.fontWeight === 'number'
        ? (el.style.fontWeight >= 700 ? 'Bold' : 'Normal')
        : (el.style.fontWeight ?? 'Normal'),
      TextPadding: {
        PaddingTop: el.style.padding ?? 0,
        PaddingBottom: el.style.padding ?? 0,
        PaddingLeft: el.style.padding ?? 0,
        PaddingRight: el.style.padding ?? 0
      },
      TextWrapping: 0,
      FontSize: el.style.fontSize ?? 18,
      Text: el.style.text ?? '',
      TextColor: cssToArgb(el.style.color ?? '#FFFFFFFF'),
      HorizontalAlignment: alignToInt(el.style.align),
      VerticalAlignment: 1,
      BackgroundColor: cssToArgb(el.style.background),
      BorderStyle: makeBorderStyle(el),
      Height: el.h,
      Left: el.x,
      Top: el.y,
      Visible: el.visible !== false,
      Width: el.w,
      Name: el.name ?? el.id,
      Bindings: bindings
    }
  }
  if (el.type === 'rect' || el.type === 'bar' || el.type === 'shiftlights' || el.type === 'gauge') {
    return {
      $type: 'SimHub.Plugins.OutputPlugins.GraphicalDash.Models.RectangleItem, SimHub.Plugins',
      BackgroundColor: cssToArgb(el.style.background ?? '#FF1A1A1A'),
      BorderStyle: makeBorderStyle(el),
      Height: el.h,
      Left: el.x,
      Top: el.y,
      Visible: el.visible !== false,
      Width: el.w,
      Name: el.name ?? el.id
    }
  }
  // map e radar: best-effort, exporta como retângulo (não há equivalente nosso).
  if (el.type === 'map' || el.type === 'radar') {
    return {
      $type: 'SimHub.Plugins.OutputPlugins.GraphicalDash.Models.RectangleItem, SimHub.Plugins',
      BackgroundColor: cssToArgb(el.style.background ?? '#FF0E0E0E'),
      BorderStyle: makeBorderStyle({ ...el, style: { ...el.style, borderWidth: 1 } }),
      Height: el.h,
      Left: el.x,
      Top: el.y,
      Visible: el.visible !== false,
      Width: el.w,
      Name: `${el.name ?? el.type} (${el.type})`
    }
  }
  return null
}

export async function exportSimhubDash(dashboard: Dashboard, outPath: string): Promise<void> {
  const items: Array<ExportTextItem | ExportRectItem> = []
  for (const el of dashboard.elements) {
    const item = toSimhubItem(el)
    if (item) items.push(item)
  }

  const root = {
    Variables: { DashboardVariables: [] as unknown[] },
    DashboardDebugManager: {},
    Version: 2,
    Id: dashboard.id,
    BaseHeight: dashboard.height,
    BaseWidth: dashboard.width,
    BackgroundColor: cssToArgb(dashboard.bg),
    Screens: [
      {
        RenderingSkip: 0,
        Name: 'Main',
        InGameScreen: true,
        IdleScreen: false,
        PitScreen: false,
        ScreenId: dashboard.id,
        AllowOverlays: true,
        IsForegroundLayer: false,
        IsOverlayLayer: false,
        OverlayTriggerExpression: null,
        ScreenEnabledExpression: null,
        OverlayMaxDuration: 0,
        OverlayMinDuration: 0,
        IsBackgroundLayer: false,
        BackgroundColor: cssToArgb(dashboard.bg),
        Items: [
          {
            $type: 'SimHub.Plugins.OutputPlugins.GraphicalDash.Models.Layer, SimHub.Plugins',
            Group: true,
            Repetitions: 1,
            Childrens: items,
            Visible: true,
            Name: dashboard.name
          }
        ]
      }
    ],
    SnapToGrid: true,
    HideLabels: false,
    ShowForeground: true,
    ForegroundOpacity: 1.0,
    ShowBackground: true,
    BackgroundOpacity: 1.0,
    ShowBoundingRectangles: false,
    GridSize: 10,
    Images: [] as unknown[],
    Metadata: null,
    ShowOnScreenControls: false,
    IsOverlay: false,
    EnableClickThroughOverlay: false,
    EnableOnDashboardMessaging: true,
    UseStrictJSIsolation: false,
    UseStrictJSIsolationWarning: false
  }

  const metadata = {
    ScreenCount: 1,
    InGameScreensIndexs: [0],
    IdleScreensIndexs: [] as number[],
    MainPreviewIndex: 0,
    IsOverlay: false,
    OverlaySizeWarning: true,
    MetadataVersion: 2,
    EnableOnDashboardMessaging: true,
    PitScreensIndexs: [] as number[],
    SimHubVersion: '9.0.0',
    Category: null,
    Title: dashboard.name,
    Description: dashboard.description ?? '',
    Author: dashboard.author ?? '',
    Width: dashboard.width,
    Height: dashboard.height,
    DashboardVersion: '1.0.0'
  }

  const folder = dashboard.name.replace(/[^A-Za-z0-9 _.-]/g, '_')
  const djsonName = `${folder}/${folder}.djson`
  const entries: Array<{ name: string; data: Buffer }> = [
    { name: djsonName, data: Buffer.from(JSON.stringify(root, null, 2), 'utf8') },
    { name: `${djsonName}.metadata`, data: Buffer.from(JSON.stringify(metadata, null, 2), 'utf8') },
    { name: `${djsonName}.ressources`, data: Buffer.from('{"Resources":[]}', 'utf8') },
    { name: `${djsonName}.carclasses`, data: Buffer.from('[]', 'utf8') }
  ]
  if (dashboard.previewPng) {
    try {
      entries.push({ name: `${djsonName}.png`, data: Buffer.from(dashboard.previewPng, 'base64') })
    } catch {
      // ignora preview invalid
    }
  }

  const zipBuf = createZip(entries)
  await writeFile(outPath, zipBuf)
}

// Útil para testes manuais (não usado em runtime mas mantém o leitor exportado).
export async function readJsonFile(path: string): Promise<unknown> {
  const buf = await readFile(path)
  return JSON.parse(buf.toString('utf8'))
}
