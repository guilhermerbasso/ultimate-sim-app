import type { DashboardPreset } from './dashboards'
import {
  dashboardTags,
  displayName,
  frame,
  grid,
  hifi,
  rev,
  type DenseDashboardMatrixEntry
} from './dashboards-gt3-dense-50-kit'

const E1: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_endurance_stint_core',
  name: 'Endurance Stint Core',
  purpose: 'Dry endurance cockpit page for the essential stint, fuel, tyre and traffic picture.',
  session: 'endurance',
  condition: 'dry',
  focus: 'stint',
  priority: 350
}

function buildEnduranceStintCore() {
  const g = grid([20, 21, 21, 20, 18], [25, 31, 25, 19], 76, 8)
  return frame(E1.id, E1.name, E1.purpose, [
    rev(E1.id, 'revlightsLedStrip', 68),
    hifi(E1.id, 'timeRemaining', g.cell(0, 0)),
    hifi(E1.id, 'lapsRemaining', g.cell(1, 0)),
    hifi(E1.id, 'classPosition', g.cell(2, 0)),
    hifi(E1.id, 'relative', g.cell(3, 0)),
    hifi(E1.id, 'incidents', g.cell(4, 0)),
    hifi(E1.id, 'fuel', g.cell(0, 1, 2)),
    hifi(E1.id, 'speedGear', g.cell(2, 1, 2)),
    hifi(E1.id, 'tyrePressure', g.cell(4, 1)),
    hifi(E1.id, 'trackMap3D', g.cell(0, 2)),
    hifi(E1.id, 'fuelLaps', g.cell(1, 2)),
    hifi(E1.id, 'deltaSession', g.cell(2, 2)),
    hifi(E1.id, 'tyreWear', g.cell(3, 2)),
    hifi(E1.id, 'position', g.cell(4, 2)),
    hifi(E1.id, 'telemetry-oilTemperature-ddu', g.cell(0, 3)),
    hifi(E1.id, 'telemetry-tcSetting-ddu', g.cell(1, 3)),
    hifi(E1.id, 'telemetry-absSetting-ddu', g.cell(2, 3)),
    hifi(E1.id, 'telemetry-brakeBias-ddu', g.cell(3, 3)),
    hifi(E1.id, 'telemetry-coolantTemperature-ddu', g.cell(4, 3))
  ])
}

const E2: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_endurance_rain_night',
  name: 'Endurance Rain Night',
  purpose: 'Wet endurance night page for reliability, grip and conservative control-system choices.',
  session: 'endurance',
  condition: 'wet',
  focus: 'engineer',
  priority: 360
}

function buildEnduranceRainNight() {
  const g = grid([19, 21, 21, 20, 19], [24, 31, 25, 20], 64, 8)
  return frame(E2.id, E2.name, E2.purpose, [
    rev(E2.id, 'revlightsGradient', 56),
    hifi(E2.id, 'wetness', g.cell(0, 0)),
    hifi(E2.id, 'weather', g.cell(1, 0)),
    hifi(E2.id, 'telemetry-engineWarnings-futuristic', g.cell(2, 0)),
    hifi(E2.id, 'timeRemaining', g.cell(3, 0)),
    hifi(E2.id, 'incidents', g.cell(4, 0)),
    hifi(E2.id, 'trackMap3D', g.cell(0, 1)),
    hifi(E2.id, 'speedGear', g.cell(1, 1, 2)),
    hifi(E2.id, 'tyrePressure', g.cell(3, 1)),
    hifi(E2.id, 'fuelLaps', g.cell(4, 1)),
    hifi(E2.id, 'radar', g.cell(0, 2)),
    hifi(E2.id, 'deltaBest', g.cell(1, 2)),
    hifi(E2.id, 'brakeTemp', g.cell(2, 2)),
    hifi(E2.id, 'telemetry-oilTemperature-futuristic', g.cell(3, 2)),
    hifi(E2.id, 'telemetry-coolantTemperature-futuristic', g.cell(4, 2)),
    hifi(E2.id, 'oilPressure', g.cell(0, 3)),
    hifi(E2.id, 'telemetry-tcSetting-futuristic', g.cell(1, 3)),
    hifi(E2.id, 'telemetry-absSetting-futuristic', g.cell(2, 3)),
    hifi(E2.id, 'telemetry-brakeBias-futuristic', g.cell(3, 3)),
    hifi(E2.id, 'classPosition', g.cell(4, 3))
  ])
}

const E3: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_endurance_double_stint_fuel',
  name: 'Endurance Double-Stint Fuel',
  purpose: 'Fuel-saving endurance page for extending a double stint to the planned stop window.',
  session: 'endurance',
  condition: 'fuel-save',
  focus: 'stint',
  priority: 370
}

function buildEnduranceDoubleStintFuel() {
  const g = grid([24, 23, 20, 18, 15], [33, 24, 24, 19], 72, 8)
  return frame(E3.id, E3.name, E3.purpose, [
    rev(E3.id, 'revlightsLedBar', 64),
    hifi(E3.id, 'fuel', g.cell(0, 0, 2, 2)),
    hifi(E3.id, 'speedGear', g.cell(2, 0, 2)),
    hifi(E3.id, 'timeRemaining', g.cell(4, 0)),
    hifi(E3.id, 'fuelDelta', g.cell(2, 1)),
    hifi(E3.id, 'lapsRemaining', g.cell(3, 1)),
    hifi(E3.id, 'classPosition', g.cell(4, 1)),
    hifi(E3.id, 'trackMap2D', g.cell(0, 2)),
    hifi(E3.id, 'fuelPerLap', g.cell(1, 2)),
    hifi(E3.id, 'deltaSession', g.cell(2, 2)),
    hifi(E3.id, 'tyreWear', g.cell(3, 2)),
    hifi(E3.id, 'incidents', g.cell(4, 2)),
    hifi(E3.id, 'telemetry-oilTemperature-competition', g.cell(0, 3)),
    hifi(E3.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(E3.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(E3.id, 'telemetry-brakeBias-competition', g.cell(3, 3)),
    hifi(E3.id, 'relative', g.cell(4, 3))
  ])
}

const E4: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_endurance_triple_stint_tyre',
  name: 'Endurance Triple-Stint Tyre',
  purpose: 'Tyre-saving endurance page for pressure, wear and brake load across a triple stint.',
  session: 'endurance',
  condition: 'tyre-save',
  focus: 'stint',
  priority: 380
}

function buildEnduranceTripleStintTyre() {
  const g = grid([24, 24, 20, 17, 15], [31, 28, 23, 18], 80, 8)
  return frame(E4.id, E4.name, E4.purpose, [
    rev(E4.id, 'revlightsLedStrip', 72),
    hifi(E4.id, 'tyrePressure', g.cell(0, 0, 2)),
    hifi(E4.id, 'tyreWear', g.cell(2, 0)),
    hifi(E4.id, 'timeRemaining', g.cell(3, 0)),
    hifi(E4.id, 'incidents', g.cell(4, 0)),
    hifi(E4.id, 'brakeTemp', g.cell(0, 1, 2)),
    hifi(E4.id, 'speedGear', g.cell(2, 1, 2)),
    hifi(E4.id, 'fuelLaps', g.cell(4, 1)),
    hifi(E4.id, 'trackMap3D', g.cell(0, 2)),
    hifi(E4.id, 'deltaBest', g.cell(1, 2)),
    hifi(E4.id, 'lapsRemaining', g.cell(2, 2)),
    hifi(E4.id, 'classPosition', g.cell(3, 2)),
    hifi(E4.id, 'position', g.cell(4, 2)),
    hifi(E4.id, 'telemetry-coolantTemperature-ddu', g.cell(0, 3)),
    hifi(E4.id, 'telemetry-tcSetting-ddu', g.cell(1, 3)),
    hifi(E4.id, 'telemetry-absSetting-ddu', g.cell(2, 3)),
    hifi(E4.id, 'telemetry-brakeBias-ddu', g.cell(3, 3)),
    hifi(E4.id, 'oilPressure', g.cell(4, 3))
  ])
}

const E5: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_endurance_strategy_wall',
  name: 'Endurance Strategy Wall',
  purpose: 'Dry endurance strategy page for pit timing, class traffic and finish-range decisions.',
  session: 'endurance',
  condition: 'dry',
  focus: 'strategy',
  priority: 390
}

function buildEnduranceStrategyWall() {
  const g = grid([22, 20, 20, 21, 17], [30, 29, 23, 18], 72, 8)
  return frame(E5.id, E5.name, E5.purpose, [
    rev(E5.id, 'revlightsGradient', 64),
    hifi(E5.id, 'standings', g.cell(0, 0, 1, 2)),
    hifi(E5.id, 'trackMap2D', g.cell(1, 0, 2)),
    hifi(E5.id, 'fuel', g.cell(3, 0)),
    hifi(E5.id, 'timeRemaining', g.cell(4, 0)),
    hifi(E5.id, 'relative', g.cell(1, 1)),
    hifi(E5.id, 'speedGear', g.cell(2, 1, 2)),
    hifi(E5.id, 'fuelDelta', g.cell(4, 1)),
    hifi(E5.id, 'pitLimiter', g.cell(0, 2)),
    hifi(E5.id, 'deltaSession', g.cell(1, 2)),
    hifi(E5.id, 'tyrePressure', g.cell(2, 2)),
    hifi(E5.id, 'incidents', g.cell(3, 2)),
    hifi(E5.id, 'classPosition', g.cell(4, 2)),
    hifi(E5.id, 'telemetry-oilTemperature-futuristic', g.cell(0, 3)),
    hifi(E5.id, 'telemetry-tcSetting-futuristic', g.cell(1, 3)),
    hifi(E5.id, 'telemetry-absSetting-futuristic', g.cell(2, 3)),
    hifi(E5.id, 'telemetry-brakeBias-futuristic', g.cell(3, 3)),
    hifi(E5.id, 'fuelPerLap', g.cell(4, 3))
  ])
}

const E6: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_endurance_wet_multiclass',
  name: 'Endurance Wet Multiclass',
  purpose: 'Wet endurance traffic page for mixed-class closing rates and low-grip positioning.',
  session: 'endurance',
  condition: 'wet',
  focus: 'traffic',
  priority: 400
}

function buildEnduranceWetMulticlass() {
  const g = grid([23, 19, 20, 20, 18], [29, 29, 24, 18], 80, 8)
  return frame(E6.id, E6.name, E6.purpose, [
    rev(E6.id, 'revlightsLedBar', 72),
    hifi(E6.id, 'standings', g.cell(0, 0, 1, 2)),
    hifi(E6.id, 'radar', g.cell(1, 0, 2)),
    hifi(E6.id, 'wetness', g.cell(3, 0)),
    hifi(E6.id, 'classPosition', g.cell(4, 0)),
    hifi(E6.id, 'speedGear', g.cell(1, 1, 2)),
    hifi(E6.id, 'relative', g.cell(3, 1)),
    hifi(E6.id, 'weather', g.cell(4, 1)),
    hifi(E6.id, 'trackMap3D', g.cell(0, 2)),
    hifi(E6.id, 'deltaAhead', g.cell(1, 2)),
    hifi(E6.id, 'tyrePressure', g.cell(2, 2)),
    hifi(E6.id, 'fuelLaps', g.cell(3, 2)),
    hifi(E6.id, 'incidents', g.cell(4, 2)),
    hifi(E6.id, 'telemetry-coolantTemperature-competition', g.cell(0, 3)),
    hifi(E6.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(E6.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(E6.id, 'telemetry-brakeBias-competition', g.cell(3, 3)),
    hifi(E6.id, 'position', g.cell(4, 3))
  ])
}

const E7: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_endurance_reliability_desk',
  name: 'Endurance Reliability Desk',
  purpose: 'Dry endurance engineer page for oil, water, voltage, brake and tyre surveillance.',
  session: 'endurance',
  condition: 'dry',
  focus: 'engineer',
  priority: 410
}

function buildEnduranceReliabilityDesk() {
  const g = grid([20, 20, 21, 21, 18], [27, 31, 24, 18], 68, 8)
  return frame(E7.id, E7.name, E7.purpose, [
    rev(E7.id, 'revlightsLedStrip', 60),
    hifi(E7.id, 'telemetry-oilTemperature-ddu', g.cell(0, 0)),
    hifi(E7.id, 'telemetry-coolantTemperature-ddu', g.cell(1, 0)),
    hifi(E7.id, 'telemetry-systemVoltage-ddu', g.cell(2, 0)),
    hifi(E7.id, 'telemetry-engineWarnings-ddu', g.cell(3, 0)),
    hifi(E7.id, 'incidents', g.cell(4, 0)),
    hifi(E7.id, 'oilPressure', g.cell(0, 1)),
    hifi(E7.id, 'speedGear', g.cell(1, 1, 2)),
    hifi(E7.id, 'brakeTemp', g.cell(3, 1)),
    hifi(E7.id, 'fuel', g.cell(4, 1)),
    hifi(E7.id, 'trackMap2D', g.cell(0, 2)),
    hifi(E7.id, 'deltaSession', g.cell(1, 2)),
    hifi(E7.id, 'tyrePressure', g.cell(2, 2)),
    hifi(E7.id, 'inputsBrakeThrottle', g.cell(3, 2)),
    hifi(E7.id, 'timeRemaining', g.cell(4, 2)),
    hifi(E7.id, 'telemetry-engineMap-ddu', g.cell(0, 3)),
    hifi(E7.id, 'telemetry-tcSetting-ddu', g.cell(1, 3)),
    hifi(E7.id, 'telemetry-absSetting-ddu', g.cell(2, 3)),
    hifi(E7.id, 'telemetry-brakeBias-ddu', g.cell(3, 3)),
    hifi(E7.id, 'classPosition', g.cell(4, 3))
  ])
}

const E8: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_endurance_fuel_pace_budget',
  name: 'Endurance Fuel Pace Budget',
  purpose: 'Fuel-saving endurance pace page for trading lap target against finish margin.',
  session: 'endurance',
  condition: 'fuel-save',
  focus: 'pace',
  priority: 420
}

function buildEnduranceFuelPaceBudget() {
  const g = grid([24, 22, 20, 18, 16], [30, 28, 24, 18], 76, 8)
  return frame(E8.id, E8.name, E8.purpose, [
    rev(E8.id, 'revlightsGradient', 68),
    hifi(E8.id, 'fuel', g.cell(0, 0, 2)),
    hifi(E8.id, 'telemetry-estimatedLap-futuristic', g.cell(2, 0)),
    hifi(E8.id, 'timeRemaining', g.cell(3, 0)),
    hifi(E8.id, 'incidents', g.cell(4, 0)),
    hifi(E8.id, 'fuelDelta', g.cell(0, 1)),
    hifi(E8.id, 'speedGear', g.cell(1, 1, 2)),
    hifi(E8.id, 'deltaBest', g.cell(3, 1)),
    hifi(E8.id, 'lapsRemaining', g.cell(4, 1)),
    hifi(E8.id, 'trackMap3D', g.cell(0, 2)),
    hifi(E8.id, 'fuelPerLap', g.cell(1, 2)),
    hifi(E8.id, 'tyreWear', g.cell(2, 2)),
    hifi(E8.id, 'relative', g.cell(3, 2)),
    hifi(E8.id, 'classPosition', g.cell(4, 2)),
    hifi(E8.id, 'telemetry-oilTemperature-futuristic', g.cell(0, 3)),
    hifi(E8.id, 'telemetry-tcSetting-futuristic', g.cell(1, 3)),
    hifi(E8.id, 'telemetry-absSetting-futuristic', g.cell(2, 3)),
    hifi(E8.id, 'telemetry-brakeBias-futuristic', g.cell(3, 3)),
    hifi(E8.id, 'position', g.cell(4, 3))
  ])
}

const E9: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_endurance_brake_tyre_watch',
  name: 'Endurance Brake-Tyre Watch',
  purpose: 'Tyre-saving endurance engineer page for thermal balance and long-run degradation.',
  session: 'endurance',
  condition: 'tyre-save',
  focus: 'engineer',
  priority: 430
}

function buildEnduranceBrakeTyreWatch() {
  const g = grid([23, 22, 20, 19, 16], [31, 28, 23, 18], 72, 8)
  return frame(E9.id, E9.name, E9.purpose, [
    rev(E9.id, 'revlightsLedBar', 64),
    hifi(E9.id, 'brakeTemp', g.cell(0, 0, 2)),
    hifi(E9.id, 'tyrePressure', g.cell(2, 0)),
    hifi(E9.id, 'tyreWear', g.cell(3, 0)),
    hifi(E9.id, 'incidents', g.cell(4, 0)),
    hifi(E9.id, 'inputsBrakeThrottle', g.cell(0, 1, 2)),
    hifi(E9.id, 'speedGear', g.cell(2, 1, 2)),
    hifi(E9.id, 'fuelLaps', g.cell(4, 1)),
    hifi(E9.id, 'trackMap2D', g.cell(0, 2)),
    hifi(E9.id, 'gForce', g.cell(1, 2)),
    hifi(E9.id, 'deltaSession', g.cell(2, 2)),
    hifi(E9.id, 'telemetry-oilTemperature-competition', g.cell(3, 2)),
    hifi(E9.id, 'telemetry-coolantTemperature-competition', g.cell(4, 2)),
    hifi(E9.id, 'oilPressure', g.cell(0, 3)),
    hifi(E9.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(E9.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(E9.id, 'telemetry-brakeBias-competition', g.cell(3, 3)),
    hifi(E9.id, 'classPosition', g.cell(4, 3))
  ])
}

const E10: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_endurance_driver_swap',
  name: 'Endurance Driver Swap',
  purpose: 'Dry endurance strategy page for handover timing, remaining stint and pit readiness.',
  session: 'endurance',
  condition: 'dry',
  focus: 'strategy',
  priority: 440
}

function buildEnduranceDriverSwap() {
  const g = grid([18, 22, 22, 21, 17], [24, 31, 26, 19], 80, 8)
  return frame(E10.id, E10.name, E10.purpose, [
    rev(E10.id, 'revlightsLedStrip', 72),
    hifi(E10.id, 'session', g.cell(0, 0)),
    hifi(E10.id, 'timeRemaining', g.cell(1, 0)),
    hifi(E10.id, 'lapsRemaining', g.cell(2, 0)),
    hifi(E10.id, 'pitLimiter', g.cell(3, 0)),
    hifi(E10.id, 'incidents', g.cell(4, 0)),
    hifi(E10.id, 'trackMap3D', g.cell(0, 1)),
    hifi(E10.id, 'speedGear', g.cell(1, 1, 2)),
    hifi(E10.id, 'fuel', g.cell(3, 1)),
    hifi(E10.id, 'classPosition', g.cell(4, 1)),
    hifi(E10.id, 'relative', g.cell(0, 2)),
    hifi(E10.id, 'deltaBest', g.cell(1, 2)),
    hifi(E10.id, 'tyrePressure', g.cell(2, 2)),
    hifi(E10.id, 'fuelLaps', g.cell(3, 2)),
    hifi(E10.id, 'position', g.cell(4, 2)),
    hifi(E10.id, 'telemetry-coolantTemperature-ddu', g.cell(0, 3)),
    hifi(E10.id, 'telemetry-tcSetting-ddu', g.cell(1, 3)),
    hifi(E10.id, 'telemetry-absSetting-ddu', g.cell(2, 3)),
    hifi(E10.id, 'telemetry-brakeBias-ddu', g.cell(3, 3)),
    hifi(E10.id, 'telemetry-oilTemperature-ddu', g.cell(4, 3))
  ])
}

const E11: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_endurance_wet_pit_window',
  name: 'Endurance Wet Pit Window',
  purpose: 'Wet endurance strategy page for crossover timing, pit service and tyre choice.',
  session: 'endurance',
  condition: 'wet',
  focus: 'strategy',
  priority: 450
}

function buildEnduranceWetPitWindow() {
  const g = grid([20, 21, 21, 20, 18], [24, 31, 25, 20], 84, 8)
  return frame(E11.id, E11.name, E11.purpose, [
    rev(E11.id, 'revlightsGradient', 76),
    hifi(E11.id, 'wetness', g.cell(0, 0)),
    hifi(E11.id, 'weather', g.cell(1, 0)),
    hifi(E11.id, 'telemetry-pitServiceStatus-futuristic', g.cell(2, 0)),
    hifi(E11.id, 'timeRemaining', g.cell(3, 0)),
    hifi(E11.id, 'incidents', g.cell(4, 0)),
    hifi(E11.id, 'trackMap2D', g.cell(0, 1)),
    hifi(E11.id, 'speedGear', g.cell(1, 1, 2)),
    hifi(E11.id, 'fuelLaps', g.cell(3, 1)),
    hifi(E11.id, 'pitLimiter', g.cell(4, 1)),
    hifi(E11.id, 'brakeTemp', g.cell(0, 2)),
    hifi(E11.id, 'deltaSession', g.cell(1, 2)),
    hifi(E11.id, 'tyrePressure', g.cell(2, 2)),
    hifi(E11.id, 'fuelDelta', g.cell(3, 2)),
    hifi(E11.id, 'classPosition', g.cell(4, 2)),
    hifi(E11.id, 'telemetry-coolantTemperature-futuristic', g.cell(0, 3)),
    hifi(E11.id, 'telemetry-tcSetting-futuristic', g.cell(1, 3)),
    hifi(E11.id, 'telemetry-absSetting-futuristic', g.cell(2, 3)),
    hifi(E11.id, 'telemetry-brakeBias-futuristic', g.cell(3, 3)),
    hifi(E11.id, 'flag', g.cell(4, 3))
  ])
}

const E12: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_endurance_relay_consistency',
  name: 'Endurance Relay Consistency',
  purpose: 'Dry endurance consistency page for matching pace across drivers and successive stints.',
  session: 'endurance',
  condition: 'dry',
  focus: 'consistency',
  priority: 460
}

function buildEnduranceRelayConsistency() {
  const g = grid([18, 22, 21, 21, 18], [28, 31, 23, 18], 72, 8)
  return frame(E12.id, E12.name, E12.purpose, [
    rev(E12.id, 'revlightsLedBar', 64),
    hifi(E12.id, 'telemetry-driverIdentity-competition', g.cell(0, 0)),
    hifi(E12.id, 'lapLast', g.cell(1, 0)),
    hifi(E12.id, 'lapBest', g.cell(2, 0)),
    hifi(E12.id, 'deltaSession', g.cell(3, 0)),
    hifi(E12.id, 'incidents', g.cell(4, 0)),
    hifi(E12.id, 'trackMap3D', g.cell(0, 1)),
    hifi(E12.id, 'speedGear', g.cell(1, 1, 2)),
    hifi(E12.id, 'inputsCombo', g.cell(3, 1)),
    hifi(E12.id, 'fuelLaps', g.cell(4, 1)),
    hifi(E12.id, 'gForce', g.cell(0, 2)),
    hifi(E12.id, 'telemetry-estimatedLap-competition', g.cell(1, 2)),
    hifi(E12.id, 'tyreWear', g.cell(2, 2)),
    hifi(E12.id, 'relative', g.cell(3, 2)),
    hifi(E12.id, 'classPosition', g.cell(4, 2)),
    hifi(E12.id, 'telemetry-oilTemperature-competition', g.cell(0, 3)),
    hifi(E12.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(E12.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(E12.id, 'telemetry-brakeBias-competition', g.cell(3, 3)),
    hifi(E12.id, 'position', g.cell(4, 3))
  ])
}

const E13: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_endurance_finish_fuel_target',
  name: 'Endurance Finish Fuel Target',
  purpose: 'Fuel-saving endurance finish page for exact burn, pace and final-lap reserve.',
  session: 'endurance',
  condition: 'fuel-save',
  focus: 'pace',
  priority: 470
}

function buildEnduranceFinishFuelTarget() {
  const g = grid([24, 23, 20, 18, 15], [32, 26, 24, 18], 80, 8)
  return frame(E13.id, E13.name, E13.purpose, [
    rev(E13.id, 'revlightsLedStrip', 72),
    hifi(E13.id, 'fuelDelta', g.cell(0, 0, 2)),
    hifi(E13.id, 'telemetry-fuelLevel-ddu', g.cell(2, 0)),
    hifi(E13.id, 'timeRemaining', g.cell(3, 0)),
    hifi(E13.id, 'incidents', g.cell(4, 0)),
    hifi(E13.id, 'fuel', g.cell(0, 1)),
    hifi(E13.id, 'speedGear', g.cell(1, 1, 2)),
    hifi(E13.id, 'deltaBest', g.cell(3, 1)),
    hifi(E13.id, 'lapsRemaining', g.cell(4, 1)),
    hifi(E13.id, 'trackMap2D', g.cell(0, 2)),
    hifi(E13.id, 'fuelPerLap', g.cell(1, 2)),
    hifi(E13.id, 'tyrePressure', g.cell(2, 2)),
    hifi(E13.id, 'relative', g.cell(3, 2)),
    hifi(E13.id, 'position', g.cell(4, 2)),
    hifi(E13.id, 'oilPressure', g.cell(0, 3)),
    hifi(E13.id, 'telemetry-tcSetting-ddu', g.cell(1, 3)),
    hifi(E13.id, 'telemetry-absSetting-ddu', g.cell(2, 3)),
    hifi(E13.id, 'telemetry-brakeBias-ddu', g.cell(3, 3)),
    hifi(E13.id, 'classPosition', g.cell(4, 3))
  ])
}

const E14: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_endurance_tyre_multiclass',
  name: 'Endurance Tyre Multiclass',
  purpose: 'Tyre-saving endurance traffic page for class encounters without overheating the car.',
  session: 'endurance',
  condition: 'tyre-save',
  focus: 'traffic',
  priority: 480
}

function buildEnduranceTyreMulticlass() {
  const g = grid([22, 20, 20, 21, 17], [30, 28, 24, 18], 76, 8)
  return frame(E14.id, E14.name, E14.purpose, [
    rev(E14.id, 'revlightsGradient', 68),
    hifi(E14.id, 'standings', g.cell(0, 0, 1, 2)),
    hifi(E14.id, 'radar', g.cell(1, 0, 2)),
    hifi(E14.id, 'tyrePressure', g.cell(3, 0)),
    hifi(E14.id, 'classPosition', g.cell(4, 0)),
    hifi(E14.id, 'speedGear', g.cell(1, 1, 2)),
    hifi(E14.id, 'tyreWear', g.cell(3, 1)),
    hifi(E14.id, 'relative', g.cell(4, 1)),
    hifi(E14.id, 'trackMap3D', g.cell(0, 2)),
    hifi(E14.id, 'deltaAhead', g.cell(1, 2)),
    hifi(E14.id, 'fuelLaps', g.cell(2, 2)),
    hifi(E14.id, 'incidents', g.cell(3, 2)),
    hifi(E14.id, 'brakeTemp', g.cell(4, 2)),
    hifi(E14.id, 'telemetry-coolantTemperature-futuristic', g.cell(0, 3)),
    hifi(E14.id, 'telemetry-tcSetting-futuristic', g.cell(1, 3)),
    hifi(E14.id, 'telemetry-absSetting-futuristic', g.cell(2, 3)),
    hifi(E14.id, 'telemetry-brakeBias-futuristic', g.cell(3, 3)),
    hifi(E14.id, 'position', g.cell(4, 3))
  ])
}

const E15: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_endurance_motec_debrief',
  name: 'Endurance MoTeC Debrief',
  purpose: 'Dry endurance analysis page combining inputs, G-force, balance and live stint delta.',
  session: 'endurance',
  condition: 'dry',
  focus: 'engineer',
  priority: 490
}

function buildEnduranceMotecDebrief() {
  const g = grid([19, 21, 20, 21, 19], [30, 30, 23, 17], 64, 8)
  return frame(E15.id, E15.name, E15.purpose, [
    rev(E15.id, 'revlightsLedBar', 56),
    hifi(E15.id, 'inputsCombo', g.cell(0, 0, 2)),
    hifi(E15.id, 'gForce', g.cell(2, 0)),
    hifi(E15.id, 'telemetry-steeringTorque-competition', g.cell(3, 0)),
    hifi(E15.id, 'incidents', g.cell(4, 0)),
    hifi(E15.id, 'telemetry-engineRpm-competition', g.cell(0, 1)),
    hifi(E15.id, 'speedGear', g.cell(1, 1)),
    hifi(E15.id, 'telemetry-deltaSessionOptimal-competition', g.cell(2, 1)),
    hifi(E15.id, 'tyrePressure', g.cell(3, 1)),
    hifi(E15.id, 'brakeTemp', g.cell(4, 1)),
    hifi(E15.id, 'trackMap2D', g.cell(0, 2)),
    hifi(E15.id, 'fuelPerLap', g.cell(1, 2)),
    hifi(E15.id, 'telemetry-oilTemperature-competition', g.cell(2, 2)),
    hifi(E15.id, 'telemetry-coolantTemperature-competition', g.cell(3, 2)),
    hifi(E15.id, 'classPosition', g.cell(4, 2)),
    hifi(E15.id, 'oilPressure', g.cell(0, 3)),
    hifi(E15.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(E15.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(E15.id, 'telemetry-brakeBias-competition', g.cell(3, 3)),
    hifi(E15.id, 'position', g.cell(4, 3))
  ])
}

export const GT3_DENSE_50_ENDURANCE_MATRIX = [
  E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15
] as const

export const GT3_DENSE_50_ENDURANCE_PRESETS: DashboardPreset[] = [
  { id: E1.id, name: displayName(E1.name), build: buildEnduranceStintCore, priority: E1.priority, tags: dashboardTags('endurance', 'dry', 'stint', 'ddu', 'relative', 'laps', 'position') },
  { id: E2.id, name: displayName(E2.name), build: buildEnduranceRainNight, priority: E2.priority, tags: dashboardTags('endurance', 'wet', 'engineer', 'futuristic', 'weather', 'radar', 'brakes') },
  { id: E3.id, name: displayName(E3.name), build: buildEnduranceDoubleStintFuel, priority: E3.priority, tags: dashboardTags('endurance', 'fuel-save', 'stint', 'competition', 'fuel', 'relative') },
  { id: E4.id, name: displayName(E4.name), build: buildEnduranceTripleStintTyre, priority: E4.priority, tags: dashboardTags('endurance', 'tyre-save', 'stint', 'ddu', 'tyre-pressure', 'tyre-wear', 'brakes') },
  { id: E5.id, name: displayName(E5.name), build: buildEnduranceStrategyWall, priority: E5.priority, tags: dashboardTags('endurance', 'dry', 'strategy', 'futuristic', 'standings', 'relative', 'pit') },
  { id: E6.id, name: displayName(E6.name), build: buildEnduranceWetMulticlass, priority: E6.priority, tags: dashboardTags('endurance', 'wet', 'traffic', 'competition', 'standings', 'radar', 'weather') },
  { id: E7.id, name: displayName(E7.name), build: buildEnduranceReliabilityDesk, priority: E7.priority, tags: dashboardTags('endurance', 'dry', 'engineer', 'ddu', 'engine', 'inputs', 'brakes') },
  { id: E8.id, name: displayName(E8.name), build: buildEnduranceFuelPaceBudget, priority: E8.priority, tags: dashboardTags('endurance', 'fuel-save', 'pace', 'futuristic', 'fuel', 'relative') },
  { id: E9.id, name: displayName(E9.name), build: buildEnduranceBrakeTyreWatch, priority: E9.priority, tags: dashboardTags('endurance', 'tyre-save', 'engineer', 'competition', 'inputs', 'g-force', 'brakes') },
  { id: E10.id, name: displayName(E10.name), build: buildEnduranceDriverSwap, priority: E10.priority, tags: dashboardTags('endurance', 'dry', 'strategy', 'ddu', 'pit', 'relative', 'session') },
  { id: E11.id, name: displayName(E11.name), build: buildEnduranceWetPitWindow, priority: E11.priority, tags: dashboardTags('endurance', 'wet', 'strategy', 'futuristic', 'weather', 'pit', 'flags') },
  { id: E12.id, name: displayName(E12.name), build: buildEnduranceRelayConsistency, priority: E12.priority, tags: dashboardTags('endurance', 'dry', 'consistency', 'competition', 'inputs', 'relative', 'laps') },
  { id: E13.id, name: displayName(E13.name), build: buildEnduranceFinishFuelTarget, priority: E13.priority, tags: dashboardTags('endurance', 'fuel-save', 'pace', 'ddu', 'fuel', 'relative', 'position') },
  { id: E14.id, name: displayName(E14.name), build: buildEnduranceTyreMulticlass, priority: E14.priority, tags: dashboardTags('endurance', 'tyre-save', 'traffic', 'futuristic', 'standings', 'radar', 'tyre-wear') },
  { id: E15.id, name: displayName(E15.name), build: buildEnduranceMotecDebrief, priority: E15.priority, tags: dashboardTags('endurance', 'dry', 'engineer', 'competition', 'inputs', 'g-force', 'brakes') }
]
