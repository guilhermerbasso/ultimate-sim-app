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

const R1: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_race_traffic_attack',
  name: 'Race Traffic Attack',
  purpose: 'Dry race attack page for closing the car ahead while retaining rear awareness.',
  session: 'race',
  condition: 'dry',
  focus: 'traffic',
  priority: 200
}

function buildRaceTrafficAttack() {
  const g = grid([22, 19, 20, 20, 19], [30, 28, 23, 19], 80, 8)
  return frame(R1.id, R1.name, R1.purpose, [
    rev(R1.id, 'revlightsLedBar', 72),
    hifi(R1.id, 'relative', g.cell(0, 0, 2)),
    hifi(R1.id, 'speedGear', g.cell(2, 0, 2)),
    hifi(R1.id, 'radar', g.cell(4, 0)),
    hifi(R1.id, 'standings', g.cell(0, 1, 2)),
    hifi(R1.id, 'deltaAhead', g.cell(2, 1)),
    hifi(R1.id, 'gapAhead', g.cell(3, 1)),
    hifi(R1.id, 'position', g.cell(4, 1)),
    hifi(R1.id, 'trackMap2D', g.cell(0, 2)),
    hifi(R1.id, 'tyrePressure', g.cell(1, 2)),
    hifi(R1.id, 'fuelLaps', g.cell(2, 2)),
    hifi(R1.id, 'incidents', g.cell(3, 2)),
    hifi(R1.id, 'gapBehind', g.cell(4, 2)),
    hifi(R1.id, 'telemetry-oilTemperature-competition', g.cell(0, 3)),
    hifi(R1.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(R1.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(R1.id, 'telemetry-brakeBias-competition', g.cell(3, 3)),
    hifi(R1.id, 'timeRemaining', g.cell(4, 3))
  ])
}

const R2: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_race_rain_survival',
  name: 'Race Rain Survival',
  purpose: 'Wet race survival page balancing grip, tyre state, visibility cues and safe strategy.',
  session: 'race',
  condition: 'wet',
  focus: 'strategy',
  priority: 210
}

function buildRaceRainSurvival() {
  const g = grid([20, 21, 20, 21, 18], [23, 31, 26, 20], 88, 8)
  return frame(R2.id, R2.name, R2.purpose, [
    rev(R2.id, 'revlightsGradient', 80),
    hifi(R2.id, 'weather', g.cell(0, 0)),
    hifi(R2.id, 'wetness', g.cell(1, 0)),
    hifi(R2.id, 'grip', g.cell(2, 0)),
    hifi(R2.id, 'flag', g.cell(3, 0)),
    hifi(R2.id, 'incidents', g.cell(4, 0)),
    hifi(R2.id, 'speedGear', g.cell(0, 1, 2)),
    hifi(R2.id, 'tyrePressure', g.cell(2, 1)),
    hifi(R2.id, 'brakeTemp', g.cell(3, 1)),
    hifi(R2.id, 'fuelLaps', g.cell(4, 1)),
    hifi(R2.id, 'trackMap3D', g.cell(0, 2, 2)),
    hifi(R2.id, 'deltaBest', g.cell(2, 2)),
    hifi(R2.id, 'radar', g.cell(3, 2)),
    hifi(R2.id, 'position', g.cell(4, 2)),
    hifi(R2.id, 'telemetry-coolantTemperature-futuristic', g.cell(0, 3)),
    hifi(R2.id, 'telemetry-tcSetting-futuristic', g.cell(1, 3)),
    hifi(R2.id, 'telemetry-absSetting-futuristic', g.cell(2, 3)),
    hifi(R2.id, 'telemetry-brakeBias-futuristic', g.cell(3, 3)),
    hifi(R2.id, 'pitLimiter', g.cell(4, 3))
  ])
}

const R3: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_race_undercut_fuel',
  name: 'Race Undercut Fuel',
  purpose: 'Fuel-saving race strategy page for undercut timing, burn control and pit commitment.',
  session: 'race',
  condition: 'fuel-save',
  focus: 'strategy',
  priority: 220
}

function buildRaceUndercutFuel() {
  const g = grid([25, 23, 20, 17, 15], [32, 24, 24, 20], 72, 8)
  return frame(R3.id, R3.name, R3.purpose, [
    rev(R3.id, 'revlightsLedStrip', 64),
    hifi(R3.id, 'fuel', g.cell(0, 0, 2, 2)),
    hifi(R3.id, 'speedGear', g.cell(2, 0, 2)),
    hifi(R3.id, 'pitLimiter', g.cell(4, 0)),
    hifi(R3.id, 'trackMap2D', g.cell(2, 1, 2)),
    hifi(R3.id, 'timeRemaining', g.cell(4, 1)),
    hifi(R3.id, 'fuelDelta', g.cell(0, 2)),
    hifi(R3.id, 'fuelPerLap', g.cell(1, 2)),
    hifi(R3.id, 'deltaBest', g.cell(2, 2)),
    hifi(R3.id, 'tyreWear', g.cell(3, 2)),
    hifi(R3.id, 'incidents', g.cell(4, 2)),
    hifi(R3.id, 'oilPressure', g.cell(0, 3)),
    hifi(R3.id, 'telemetry-tcSetting-ddu', g.cell(1, 3)),
    hifi(R3.id, 'telemetry-absSetting-ddu', g.cell(2, 3)),
    hifi(R3.id, 'telemetry-brakeBias-ddu', g.cell(3, 3)),
    hifi(R3.id, 'position', g.cell(4, 3))
  ])
}

const R4: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_race_overcut_tyre',
  name: 'Race Overcut Tyre',
  purpose: 'Tyre-saving race strategy page for extending the stint without losing the pit delta.',
  session: 'race',
  condition: 'tyre-save',
  focus: 'strategy',
  priority: 230
}

function buildRaceOvercutTyre() {
  const g = grid([28, 25, 25, 22], [34, 23, 24, 19], 76, 8)
  return frame(R4.id, R4.name, R4.purpose, [
    rev(R4.id, 'revlightsLedBar', 68),
    hifi(R4.id, 'tyrePressure', g.cell(0, 0, 2, 2)),
    hifi(R4.id, 'speedGear', g.cell(2, 0, 2)),
    hifi(R4.id, 'deltaSession', g.cell(2, 1)),
    hifi(R4.id, 'fuelLaps', g.cell(3, 1)),
    hifi(R4.id, 'trackMap3D', g.cell(0, 2)),
    hifi(R4.id, 'tyreWear', g.cell(1, 2)),
    hifi(R4.id, 'incidents', g.cell(2, 2)),
    hifi(R4.id, 'pitLimiter', g.cell(3, 2)),
    hifi(R4.id, 'telemetry-coolantTemperature-competition', g.cell(0, 3)),
    hifi(R4.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(R4.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(R4.id, 'telemetry-brakeBias-competition', g.cell(3, 3))
  ])
}

const R5: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_race_pace_command',
  name: 'Race Pace Command',
  purpose: 'Dry race pace page for matching the target lap while protecting fuel and tyres.',
  session: 'race',
  condition: 'dry',
  focus: 'pace',
  priority: 240
}

function buildRacePaceCommand() {
  const g = grid([19, 22, 21, 21, 17], [27, 31, 23, 19], 68, 8)
  return frame(R5.id, R5.name, R5.purpose, [
    rev(R5.id, 'revlightsGradient', 60),
    hifi(R5.id, 'trackMap2D', g.cell(0, 0)),
    hifi(R5.id, 'lapCurrent', g.cell(0, 1)),
    hifi(R5.id, 'speedGear', g.cell(1, 0, 3)),
    hifi(R5.id, 'telemetry-estimatedLap-futuristic', g.cell(1, 1)),
    hifi(R5.id, 'deltaSession', g.cell(2, 1)),
    hifi(R5.id, 'inputsBrakeThrottle', g.cell(3, 1)),
    hifi(R5.id, 'position', g.cell(4, 0)),
    hifi(R5.id, 'timeRemaining', g.cell(4, 1)),
    hifi(R5.id, 'fuelLaps', g.cell(0, 2)),
    hifi(R5.id, 'tyrePressure', g.cell(1, 2)),
    hifi(R5.id, 'incidents', g.cell(2, 2)),
    hifi(R5.id, 'lapBest', g.cell(3, 2)),
    hifi(R5.id, 'fuelPerLap', g.cell(4, 2)),
    hifi(R5.id, 'telemetry-oilTemperature-futuristic', g.cell(0, 3)),
    hifi(R5.id, 'telemetry-tcSetting-futuristic', g.cell(1, 3)),
    hifi(R5.id, 'telemetry-absSetting-futuristic', g.cell(2, 3)),
    hifi(R5.id, 'telemetry-brakeBias-futuristic', g.cell(3, 3)),
    hifi(R5.id, 'telemetry-systemVoltage-futuristic', g.cell(4, 3))
  ])
}

const R6: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_race_wet_delta_recovery',
  name: 'Race Wet Delta Recovery',
  purpose: 'Wet race recovery page for finding lost lap time as grip and temperatures evolve.',
  session: 'race',
  condition: 'wet',
  focus: 'delta',
  priority: 250
}

function buildRaceWetDeltaRecovery() {
  const g = grid([22, 25, 27, 26], [26, 31, 23, 20], 84, 8)
  return frame(R6.id, R6.name, R6.purpose, [
    rev(R6.id, 'revlightsLedStrip', 76),
    hifi(R6.id, 'wetness', g.cell(0, 0)),
    hifi(R6.id, 'weather', g.cell(0, 1)),
    hifi(R6.id, 'telemetry-deltaBest-ddu', g.cell(1, 0, 2)),
    hifi(R6.id, 'speedGear', g.cell(1, 1, 2)),
    hifi(R6.id, 'tyrePressure', g.cell(3, 0)),
    hifi(R6.id, 'brakeTemp', g.cell(3, 1)),
    hifi(R6.id, 'trackMap3D', g.cell(0, 2)),
    hifi(R6.id, 'fuelLaps', g.cell(1, 2)),
    hifi(R6.id, 'incidents', g.cell(2, 2)),
    hifi(R6.id, 'position', g.cell(3, 2)),
    hifi(R6.id, 'telemetry-coolantTemperature-ddu', g.cell(0, 3)),
    hifi(R6.id, 'telemetry-tcSetting-ddu', g.cell(1, 3)),
    hifi(R6.id, 'telemetry-absSetting-ddu', g.cell(2, 3)),
    hifi(R6.id, 'telemetry-brakeBias-ddu', g.cell(3, 3))
  ])
}

const R7: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_race_long_run_rhythm',
  name: 'Race Long-Run Rhythm',
  purpose: 'Dry race consistency page for repeatable laps, stable inputs and controlled degradation.',
  session: 'race',
  condition: 'dry',
  focus: 'consistency',
  priority: 260
}

function buildRaceLongRunRhythm() {
  const g = grid([18, 22, 22, 21, 17], [28, 30, 24, 18], 72, 8)
  return frame(R7.id, R7.name, R7.purpose, [
    rev(R7.id, 'revlightsLedBar', 64),
    hifi(R7.id, 'lapLast', g.cell(0, 0)),
    hifi(R7.id, 'lapBest', g.cell(0, 1)),
    hifi(R7.id, 'speedGear', g.cell(1, 0, 2)),
    hifi(R7.id, 'inputsCombo', g.cell(1, 1, 2)),
    hifi(R7.id, 'tyreWear', g.cell(3, 0)),
    hifi(R7.id, 'fuelPerLap', g.cell(3, 1)),
    hifi(R7.id, 'deltaSession', g.cell(4, 0)),
    hifi(R7.id, 'timeRemaining', g.cell(4, 1)),
    hifi(R7.id, 'trackMap2D', g.cell(0, 2)),
    hifi(R7.id, 'tyrePressure', g.cell(1, 2)),
    hifi(R7.id, 'fuelLaps', g.cell(2, 2)),
    hifi(R7.id, 'incidents', g.cell(3, 2)),
    hifi(R7.id, 'position', g.cell(4, 2)),
    hifi(R7.id, 'oilPressure', g.cell(0, 3)),
    hifi(R7.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(R7.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(R7.id, 'telemetry-brakeBias-competition', g.cell(3, 3)),
    hifi(R7.id, 'telemetry-coolantTemperature-competition', g.cell(4, 3))
  ])
}

const R8: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_race_final_stint_fuel',
  name: 'Race Final-Stint Fuel',
  purpose: 'Fuel-saving final-stint page for finish range, lap targets and late-race position.',
  session: 'race',
  condition: 'fuel-save',
  focus: 'stint',
  priority: 270
}

function buildRaceFinalStintFuel() {
  const g = grid([24, 22, 20, 19, 15], [31, 26, 24, 19], 80, 8)
  return frame(R8.id, R8.name, R8.purpose, [
    rev(R8.id, 'revlightsGradient', 72),
    hifi(R8.id, 'fuel', g.cell(0, 0, 2)),
    hifi(R8.id, 'timeRemaining', g.cell(2, 0)),
    hifi(R8.id, 'lapsRemaining', g.cell(3, 0)),
    hifi(R8.id, 'position', g.cell(4, 0)),
    hifi(R8.id, 'fuelDelta', g.cell(0, 1)),
    hifi(R8.id, 'speedGear', g.cell(1, 1, 2)),
    hifi(R8.id, 'deltaBest', g.cell(3, 1)),
    hifi(R8.id, 'incidents', g.cell(4, 1)),
    hifi(R8.id, 'trackMap3D', g.cell(0, 2)),
    hifi(R8.id, 'fuelPerLap', g.cell(1, 2)),
    hifi(R8.id, 'tyreWear', g.cell(2, 2)),
    hifi(R8.id, 'relative', g.cell(3, 2, 2)),
    hifi(R8.id, 'telemetry-oilTemperature-futuristic', g.cell(0, 3)),
    hifi(R8.id, 'telemetry-tcSetting-futuristic', g.cell(1, 3)),
    hifi(R8.id, 'telemetry-absSetting-futuristic', g.cell(2, 3)),
    hifi(R8.id, 'telemetry-brakeBias-futuristic', g.cell(3, 3)),
    hifi(R8.id, 'flag', g.cell(4, 3))
  ])
}

const R9: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_race_tyre_defense',
  name: 'Race Tyre Defense',
  purpose: 'Tyre-saving race defense page with rear traffic, radar and traction-management cues.',
  session: 'race',
  condition: 'tyre-save',
  focus: 'traffic',
  priority: 280
}

function buildRaceTyreDefense() {
  const g = grid([22, 21, 19, 20, 18], [30, 27, 24, 19], 76, 8)
  return frame(R9.id, R9.name, R9.purpose, [
    rev(R9.id, 'revlightsLedStrip', 68),
    hifi(R9.id, 'tyrePressure', g.cell(0, 0, 2)),
    hifi(R9.id, 'radar', g.cell(2, 0, 2)),
    hifi(R9.id, 'gapBehind', g.cell(4, 0)),
    hifi(R9.id, 'tyreWear', g.cell(0, 1, 2)),
    hifi(R9.id, 'speedGear', g.cell(2, 1, 2)),
    hifi(R9.id, 'deltaBehind', g.cell(4, 1)),
    hifi(R9.id, 'trackMap2D', g.cell(0, 2)),
    hifi(R9.id, 'relative', g.cell(1, 2)),
    hifi(R9.id, 'fuelLaps', g.cell(2, 2)),
    hifi(R9.id, 'incidents', g.cell(3, 2)),
    hifi(R9.id, 'position', g.cell(4, 2)),
    hifi(R9.id, 'telemetry-coolantTemperature-ddu', g.cell(0, 3)),
    hifi(R9.id, 'telemetry-tcSetting-ddu', g.cell(1, 3)),
    hifi(R9.id, 'telemetry-absSetting-ddu', g.cell(2, 3)),
    hifi(R9.id, 'telemetry-brakeBias-ddu', g.cell(3, 3)),
    hifi(R9.id, 'brakeTemp', g.cell(4, 3))
  ])
}

const R10: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_race_reliability_engineer',
  name: 'Race Reliability Engineer',
  purpose: 'Dry race engineering page for engine vitals, brake condition and control-system health.',
  session: 'race',
  condition: 'dry',
  focus: 'engineer',
  priority: 290
}

function buildRaceReliabilityEngineer() {
  const g = grid([20, 21, 21, 20, 18], [28, 30, 24, 18], 68, 8)
  return frame(R10.id, R10.name, R10.purpose, [
    rev(R10.id, 'revlightsLedBar', 60),
    hifi(R10.id, 'telemetry-oilTemperature-competition', g.cell(0, 0)),
    hifi(R10.id, 'telemetry-coolantTemperature-competition', g.cell(1, 0)),
    hifi(R10.id, 'speedGear', g.cell(2, 0, 2)),
    hifi(R10.id, 'telemetry-engineWarnings-competition', g.cell(4, 0)),
    hifi(R10.id, 'oilPressure', g.cell(0, 1)),
    hifi(R10.id, 'telemetry-systemVoltage-competition', g.cell(1, 1)),
    hifi(R10.id, 'deltaSession', g.cell(2, 1)),
    hifi(R10.id, 'brakeTemp', g.cell(3, 1)),
    hifi(R10.id, 'fuel', g.cell(4, 1)),
    hifi(R10.id, 'trackMap3D', g.cell(0, 2)),
    hifi(R10.id, 'tyrePressure', g.cell(1, 2)),
    hifi(R10.id, 'inputsBrakeThrottle', g.cell(2, 2)),
    hifi(R10.id, 'incidents', g.cell(3, 2)),
    hifi(R10.id, 'position', g.cell(4, 2)),
    hifi(R10.id, 'telemetry-engineMap-competition', g.cell(0, 3)),
    hifi(R10.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(R10.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(R10.id, 'telemetry-brakeBias-competition', g.cell(3, 3)),
    hifi(R10.id, 'timeRemaining', g.cell(4, 3))
  ])
}

const R11: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_race_wet_pace_control',
  name: 'Race Wet Pace Control',
  purpose: 'Wet race pace page for adapting the target lap to grip, traffic and tyre response.',
  session: 'race',
  condition: 'wet',
  focus: 'pace',
  priority: 300
}

function buildRaceWetPaceControl() {
  const g = grid([18, 23, 22, 21, 16], [24, 32, 25, 19], 80, 8)
  return frame(R11.id, R11.name, R11.purpose, [
    rev(R11.id, 'revlightsGradient', 72),
    hifi(R11.id, 'weather', g.cell(0, 0)),
    hifi(R11.id, 'telemetry-estimatedLap-futuristic', g.cell(1, 0)),
    hifi(R11.id, 'deltaBest', g.cell(2, 0)),
    hifi(R11.id, 'wetness', g.cell(3, 0)),
    hifi(R11.id, 'incidents', g.cell(4, 0)),
    hifi(R11.id, 'trackMap2D', g.cell(0, 1)),
    hifi(R11.id, 'speedGear', g.cell(1, 1, 2)),
    hifi(R11.id, 'tyrePressure', g.cell(3, 1)),
    hifi(R11.id, 'fuelLaps', g.cell(4, 1)),
    hifi(R11.id, 'radar', g.cell(0, 2)),
    hifi(R11.id, 'inputsCombo', g.cell(1, 2, 2)),
    hifi(R11.id, 'brakeTemp', g.cell(3, 2)),
    hifi(R11.id, 'position', g.cell(4, 2)),
    hifi(R11.id, 'telemetry-coolantTemperature-futuristic', g.cell(0, 3)),
    hifi(R11.id, 'telemetry-tcSetting-futuristic', g.cell(1, 3)),
    hifi(R11.id, 'telemetry-absSetting-futuristic', g.cell(2, 3)),
    hifi(R11.id, 'telemetry-brakeBias-futuristic', g.cell(3, 3)),
    hifi(R11.id, 'timeRemaining', g.cell(4, 3))
  ])
}

const R12: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_race_position_chase',
  name: 'Race Position Chase',
  purpose: 'Dry race chase page for position gain, closing rate and decisive traffic management.',
  session: 'race',
  condition: 'dry',
  focus: 'traffic',
  priority: 310
}

function buildRacePositionChase() {
  const g = grid([21, 20, 20, 21, 18], [31, 25, 25, 19], 72, 8)
  return frame(R12.id, R12.name, R12.purpose, [
    rev(R12.id, 'revlightsLedStrip', 64),
    hifi(R12.id, 'standings', g.cell(0, 0, 1, 2)),
    hifi(R12.id, 'telemetry-overallPosition-ddu', g.cell(1, 0)),
    hifi(R12.id, 'speedGear', g.cell(2, 0, 2)),
    hifi(R12.id, 'radar', g.cell(4, 0, 1, 2)),
    hifi(R12.id, 'relative', g.cell(1, 1)),
    hifi(R12.id, 'deltaAhead', g.cell(2, 1)),
    hifi(R12.id, 'gapAhead', g.cell(3, 1)),
    hifi(R12.id, 'trackMap3D', g.cell(0, 2)),
    hifi(R12.id, 'tyrePressure', g.cell(1, 2)),
    hifi(R12.id, 'fuelLaps', g.cell(2, 2)),
    hifi(R12.id, 'incidents', g.cell(3, 2)),
    hifi(R12.id, 'gapBehind', g.cell(4, 2)),
    hifi(R12.id, 'telemetry-oilTemperature-ddu', g.cell(0, 3)),
    hifi(R12.id, 'telemetry-tcSetting-ddu', g.cell(1, 3)),
    hifi(R12.id, 'telemetry-absSetting-ddu', g.cell(2, 3)),
    hifi(R12.id, 'telemetry-brakeBias-ddu', g.cell(3, 3)),
    hifi(R12.id, 'timeRemaining', g.cell(4, 3))
  ])
}

const R13: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_race_safety_car_fuel',
  name: 'Race Safety-Car Fuel',
  purpose: 'Fuel-saving caution page for restart range, pit status and queue-position control.',
  session: 'race',
  condition: 'fuel-save',
  focus: 'strategy',
  priority: 320
}

function buildRaceSafetyCarFuel() {
  const g = grid([20, 22, 21, 20, 17], [24, 31, 25, 20], 64, 8)
  return frame(R13.id, R13.name, R13.purpose, [
    rev(R13.id, 'revlightsLedBar', 56),
    hifi(R13.id, 'flag', g.cell(0, 0)),
    hifi(R13.id, 'pitLimiter', g.cell(1, 0)),
    hifi(R13.id, 'timeRemaining', g.cell(2, 0)),
    hifi(R13.id, 'lapsRemaining', g.cell(3, 0)),
    hifi(R13.id, 'position', g.cell(4, 0)),
    hifi(R13.id, 'fuel', g.cell(0, 1, 2)),
    hifi(R13.id, 'speedGear', g.cell(2, 1, 2)),
    hifi(R13.id, 'fuelDelta', g.cell(4, 1)),
    hifi(R13.id, 'trackMap2D', g.cell(0, 2)),
    hifi(R13.id, 'deltaBest', g.cell(1, 2)),
    hifi(R13.id, 'tyrePressure', g.cell(2, 2)),
    hifi(R13.id, 'incidents', g.cell(3, 2)),
    hifi(R13.id, 'relative', g.cell(4, 2)),
    hifi(R13.id, 'oilPressure', g.cell(0, 3)),
    hifi(R13.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(R13.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(R13.id, 'telemetry-brakeBias-competition', g.cell(3, 3)),
    hifi(R13.id, 'fuelPerLap', g.cell(4, 3))
  ])
}

const R14: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_race_restart_tyre',
  name: 'Race Restart Tyre',
  purpose: 'Tyre-saving restart page for temperature recovery, launch delta and wheelspin control.',
  session: 'race',
  condition: 'tyre-save',
  focus: 'delta',
  priority: 330
}

function buildRaceRestartTyre() {
  const g = grid([19, 22, 21, 21, 17], [28, 30, 24, 18], 88, 8)
  return frame(R14.id, R14.name, R14.purpose, [
    rev(R14.id, 'revlightsGradient', 80),
    hifi(R14.id, 'flag', g.cell(0, 0)),
    hifi(R14.id, 'speedGear', g.cell(1, 0, 3)),
    hifi(R14.id, 'position', g.cell(4, 0)),
    hifi(R14.id, 'tyrePressure', g.cell(0, 1, 2)),
    hifi(R14.id, 'inputsBrakeThrottle', g.cell(2, 1, 2)),
    hifi(R14.id, 'deltaAhead', g.cell(4, 1)),
    hifi(R14.id, 'trackMap3D', g.cell(0, 2)),
    hifi(R14.id, 'tyreWear', g.cell(1, 2)),
    hifi(R14.id, 'fuelLaps', g.cell(2, 2)),
    hifi(R14.id, 'incidents', g.cell(3, 2)),
    hifi(R14.id, 'brakeTemp', g.cell(4, 2)),
    hifi(R14.id, 'telemetry-coolantTemperature-futuristic', g.cell(0, 3)),
    hifi(R14.id, 'telemetry-tcSetting-futuristic', g.cell(1, 3)),
    hifi(R14.id, 'telemetry-absSetting-futuristic', g.cell(2, 3)),
    hifi(R14.id, 'telemetry-brakeBias-futuristic', g.cell(3, 3)),
    hifi(R14.id, 'pitLimiter', g.cell(4, 3))
  ])
}

const R15: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_race_multiclass_radar',
  name: 'Race Multiclass Radar',
  purpose: 'Dry multiclass race page for class position, relative traffic and closing-speed awareness.',
  session: 'race',
  condition: 'dry',
  focus: 'traffic',
  priority: 340
}

function buildRaceMulticlassRadar() {
  const g = grid([23, 19, 20, 20, 18], [33, 25, 24, 18], 72, 8)
  return frame(R15.id, R15.name, R15.purpose, [
    rev(R15.id, 'revlightsLedBar', 64),
    hifi(R15.id, 'standings', g.cell(0, 0, 1, 2)),
    hifi(R15.id, 'radar', g.cell(1, 0, 2)),
    hifi(R15.id, 'classPosition', g.cell(3, 0)),
    hifi(R15.id, 'relative', g.cell(4, 0)),
    hifi(R15.id, 'speedGear', g.cell(1, 1, 2)),
    hifi(R15.id, 'deltaAhead', g.cell(3, 1)),
    hifi(R15.id, 'gapAhead', g.cell(4, 1)),
    hifi(R15.id, 'trackMap2D', g.cell(0, 2)),
    hifi(R15.id, 'tyrePressure', g.cell(1, 2)),
    hifi(R15.id, 'fuelLaps', g.cell(2, 2)),
    hifi(R15.id, 'incidents', g.cell(3, 2)),
    hifi(R15.id, 'position', g.cell(4, 2)),
    hifi(R15.id, 'telemetry-oilTemperature-competition', g.cell(0, 3)),
    hifi(R15.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(R15.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(R15.id, 'telemetry-brakeBias-competition', g.cell(3, 3)),
    hifi(R15.id, 'timeRemaining', g.cell(4, 3))
  ])
}

export const GT3_DENSE_50_RACE_MATRIX = [
  R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15
] as const

export const GT3_DENSE_50_RACE_PRESETS: DashboardPreset[] = [
  { id: R1.id, name: displayName(R1.name), build: buildRaceTrafficAttack, priority: R1.priority, tags: dashboardTags('race', 'dry', 'traffic', 'competition', 'relative', 'standings', 'radar') },
  { id: R2.id, name: displayName(R2.name), build: buildRaceRainSurvival, priority: R2.priority, tags: dashboardTags('race', 'wet', 'strategy', 'futuristic', 'weather', 'wetness', 'radar') },
  { id: R3.id, name: displayName(R3.name), build: buildRaceUndercutFuel, priority: R3.priority, tags: dashboardTags('race', 'fuel-save', 'strategy', 'ddu', 'fuel', 'pit') },
  { id: R4.id, name: displayName(R4.name), build: buildRaceOvercutTyre, priority: R4.priority, tags: dashboardTags('race', 'tyre-save', 'strategy', 'competition', 'tyre-pressure', 'tyre-wear', 'pit') },
  { id: R5.id, name: displayName(R5.name), build: buildRacePaceCommand, priority: R5.priority, tags: dashboardTags('race', 'dry', 'pace', 'futuristic', 'inputs', 'laps') },
  { id: R6.id, name: displayName(R6.name), build: buildRaceWetDeltaRecovery, priority: R6.priority, tags: dashboardTags('race', 'wet', 'delta', 'ddu', 'weather', 'wetness', 'brakes') },
  { id: R7.id, name: displayName(R7.name), build: buildRaceLongRunRhythm, priority: R7.priority, tags: dashboardTags('race', 'dry', 'consistency', 'competition', 'inputs', 'tyre-wear', 'laps') },
  { id: R8.id, name: displayName(R8.name), build: buildRaceFinalStintFuel, priority: R8.priority, tags: dashboardTags('race', 'fuel-save', 'stint', 'futuristic', 'fuel', 'relative', 'flags') },
  { id: R9.id, name: displayName(R9.name), build: buildRaceTyreDefense, priority: R9.priority, tags: dashboardTags('race', 'tyre-save', 'traffic', 'ddu', 'radar', 'relative', 'tyre-wear') },
  { id: R10.id, name: displayName(R10.name), build: buildRaceReliabilityEngineer, priority: R10.priority, tags: dashboardTags('race', 'dry', 'engineer', 'competition', 'inputs', 'engine', 'brakes') },
  { id: R11.id, name: displayName(R11.name), build: buildRaceWetPaceControl, priority: R11.priority, tags: dashboardTags('race', 'wet', 'pace', 'futuristic', 'weather', 'inputs', 'radar') },
  { id: R12.id, name: displayName(R12.name), build: buildRacePositionChase, priority: R12.priority, tags: dashboardTags('race', 'dry', 'traffic', 'ddu', 'position', 'standings', 'radar') },
  { id: R13.id, name: displayName(R13.name), build: buildRaceSafetyCarFuel, priority: R13.priority, tags: dashboardTags('race', 'fuel-save', 'strategy', 'competition', 'flags', 'pit', 'fuel') },
  { id: R14.id, name: displayName(R14.name), build: buildRaceRestartTyre, priority: R14.priority, tags: dashboardTags('race', 'tyre-save', 'delta', 'futuristic', 'flags', 'inputs', 'tyre-wear') },
  { id: R15.id, name: displayName(R15.name), build: buildRaceMulticlassRadar, priority: R15.priority, tags: dashboardTags('race', 'dry', 'traffic', 'competition', 'standings', 'relative', 'radar') }
]
