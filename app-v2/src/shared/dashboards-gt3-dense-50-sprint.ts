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

const S1: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_sprint_launch_delta',
  name: 'Sprint Launch Delta',
  purpose: 'Dry sprint opening-lap page with immediate delta, position and launch-system awareness.',
  session: 'sprint',
  condition: 'dry',
  focus: 'delta',
  priority: 100
}

function buildSprintLaunchDelta() {
  const g = grid([18, 21, 22, 21, 18], [31, 27, 23, 19], 88, 8)
  return frame(S1.id, S1.name, S1.purpose, [
    rev(S1.id, 'revlightsLedBar', 80),
    hifi(S1.id, 'flag', g.cell(0, 0)),
    hifi(S1.id, 'speedGear', g.cell(1, 0, 3)),
    hifi(S1.id, 'position', g.cell(4, 0)),
    hifi(S1.id, 'trackMap2D', g.cell(0, 1)),
    hifi(S1.id, 'deltaAhead', g.cell(1, 1)),
    hifi(S1.id, 'deltaBehind', g.cell(2, 1)),
    hifi(S1.id, 'radar', g.cell(3, 1, 2)),
    hifi(S1.id, 'tyrePressure', g.cell(0, 2)),
    hifi(S1.id, 'fuelLaps', g.cell(1, 2)),
    hifi(S1.id, 'incidents', g.cell(2, 2)),
    hifi(S1.id, 'gapAhead', g.cell(3, 2)),
    hifi(S1.id, 'gapBehind', g.cell(4, 2)),
    hifi(S1.id, 'telemetry-oilTemperature-competition', g.cell(0, 3)),
    hifi(S1.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(S1.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(S1.id, 'telemetry-brakeBias-competition', g.cell(3, 3)),
    hifi(S1.id, 'lapsRemaining', g.cell(4, 3))
  ])
}

const S2: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_sprint_rain_traffic',
  name: 'Sprint Rain Traffic',
  purpose: 'Wet sprint traffic page prioritizing radar, relative gaps and changing surface grip.',
  session: 'sprint',
  condition: 'wet',
  focus: 'traffic',
  priority: 110
}

function buildSprintRainTraffic() {
  const g = grid([22, 20, 20, 20, 18], [28, 30, 23, 19], 80, 8)
  return frame(S2.id, S2.name, S2.purpose, [
    rev(S2.id, 'revlightsGradient', 72),
    hifi(S2.id, 'relative', g.cell(0, 0, 2)),
    hifi(S2.id, 'radar', g.cell(2, 0, 2)),
    hifi(S2.id, 'wetness', g.cell(4, 0)),
    hifi(S2.id, 'standings', g.cell(0, 1, 2)),
    hifi(S2.id, 'speedGear', g.cell(2, 1, 2)),
    hifi(S2.id, 'weather', g.cell(4, 1)),
    hifi(S2.id, 'trackMap3D', g.cell(0, 2)),
    hifi(S2.id, 'deltaBehind', g.cell(1, 2)),
    hifi(S2.id, 'tyrePressure', g.cell(2, 2)),
    hifi(S2.id, 'fuel', g.cell(3, 2)),
    hifi(S2.id, 'incidents', g.cell(4, 2)),
    hifi(S2.id, 'telemetry-coolantTemperature-futuristic', g.cell(0, 3)),
    hifi(S2.id, 'telemetry-tcSetting-futuristic', g.cell(1, 3)),
    hifi(S2.id, 'telemetry-absSetting-futuristic', g.cell(2, 3)),
    hifi(S2.id, 'telemetry-brakeBias-futuristic', g.cell(3, 3)),
    hifi(S2.id, 'position', g.cell(4, 3))
  ])
}

const S3: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_sprint_fuel_attack',
  name: 'Sprint Fuel Attack',
  purpose: 'Fuel-saving sprint page that preserves attack pace while monitoring burn and range.',
  session: 'sprint',
  condition: 'fuel-save',
  focus: 'pace',
  priority: 120
}

function buildSprintFuelAttack() {
  const g = grid([29, 25, 24, 22], [32, 24, 23, 21], 68, 8)
  return frame(S3.id, S3.name, S3.purpose, [
    rev(S3.id, 'revlightsLedStrip', 60),
    hifi(S3.id, 'fuel', g.cell(0, 0, 2, 2)),
    hifi(S3.id, 'speedGear', g.cell(2, 0, 2)),
    hifi(S3.id, 'telemetry-estimatedLap-ddu', g.cell(2, 1)),
    hifi(S3.id, 'deltaBest', g.cell(3, 1)),
    hifi(S3.id, 'trackMap2D', g.cell(0, 2)),
    hifi(S3.id, 'tyreWear', g.cell(1, 2)),
    hifi(S3.id, 'fuelPerLap', g.cell(2, 2)),
    hifi(S3.id, 'incidents', g.cell(3, 2)),
    hifi(S3.id, 'oilPressure', g.cell(0, 3)),
    hifi(S3.id, 'telemetry-tcSetting-ddu', g.cell(1, 3)),
    hifi(S3.id, 'telemetry-absSetting-ddu', g.cell(2, 3)),
    hifi(S3.id, 'telemetry-brakeBias-ddu', g.cell(3, 3))
  ])
}

const S4: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_sprint_tyre_defense',
  name: 'Sprint Tyre Defense',
  purpose: 'Tyre-saving sprint defense page for rear traffic, pressure stability and exit traction.',
  session: 'sprint',
  condition: 'tyre-save',
  focus: 'traffic',
  priority: 130
}

function buildSprintTyreDefense() {
  const g = grid([20, 21, 20, 21, 18], [29, 28, 23, 20], 76, 8)
  return frame(S4.id, S4.name, S4.purpose, [
    rev(S4.id, 'revlightsLedBar', 68),
    hifi(S4.id, 'tyrePressure', g.cell(0, 0, 2)),
    hifi(S4.id, 'radar', g.cell(2, 0, 2)),
    hifi(S4.id, 'position', g.cell(4, 0)),
    hifi(S4.id, 'tyreWear', g.cell(0, 1, 2)),
    hifi(S4.id, 'speedGear', g.cell(2, 1, 2)),
    hifi(S4.id, 'deltaBehind', g.cell(4, 1)),
    hifi(S4.id, 'trackMap3D', g.cell(0, 2)),
    hifi(S4.id, 'relative', g.cell(1, 2)),
    hifi(S4.id, 'fuelLaps', g.cell(2, 2)),
    hifi(S4.id, 'incidents', g.cell(3, 2)),
    hifi(S4.id, 'gapBehind', g.cell(4, 2)),
    hifi(S4.id, 'telemetry-oilTemperature-competition', g.cell(0, 3)),
    hifi(S4.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(S4.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(S4.id, 'telemetry-brakeBias-competition', g.cell(3, 3)),
    hifi(S4.id, 'brakeTemp', g.cell(4, 3))
  ])
}

const S5: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_sprint_gap_duel',
  name: 'Sprint Gap Duel',
  purpose: 'Dry sprint combat page tracking the car ahead, the car behind and best-lap delta.',
  session: 'sprint',
  condition: 'dry',
  focus: 'delta',
  priority: 140
}

function buildSprintGapDuel() {
  const g = grid([19, 21, 20, 21, 19], [34, 22, 24, 20], 72, 10)
  return frame(S5.id, S5.name, S5.purpose, [
    rev(S5.id, 'revlightsGradient', 64),
    hifi(S5.id, 'relative', g.cell(0, 0, 1, 2)),
    hifi(S5.id, 'speedGear', g.cell(1, 0, 3)),
    hifi(S5.id, 'radar', g.cell(4, 0, 1, 2)),
    hifi(S5.id, 'deltaAhead', g.cell(1, 1)),
    hifi(S5.id, 'deltaBehind', g.cell(2, 1)),
    hifi(S5.id, 'gapAhead', g.cell(3, 1)),
    hifi(S5.id, 'trackMap2D', g.cell(0, 2)),
    hifi(S5.id, 'tyrePressure', g.cell(1, 2)),
    hifi(S5.id, 'fuelLaps', g.cell(2, 2)),
    hifi(S5.id, 'incidents', g.cell(3, 2)),
    hifi(S5.id, 'position', g.cell(4, 2)),
    hifi(S5.id, 'telemetry-coolantTemperature-futuristic', g.cell(0, 3)),
    hifi(S5.id, 'telemetry-tcSetting-futuristic', g.cell(1, 3)),
    hifi(S5.id, 'telemetry-absSetting-futuristic', g.cell(2, 3)),
    hifi(S5.id, 'telemetry-brakeBias-futuristic', g.cell(3, 3)),
    hifi(S5.id, 'gapBehind', g.cell(4, 3))
  ])
}

const S6: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_sprint_wet_rhythm',
  name: 'Sprint Wet Rhythm',
  purpose: 'Wet sprint consistency page for repeatable braking and stable lap-time production.',
  session: 'sprint',
  condition: 'wet',
  focus: 'consistency',
  priority: 150
}

function buildSprintWetRhythm() {
  const g = grid([21, 21, 20, 20, 18], [25, 31, 24, 20], 84, 8)
  return frame(S6.id, S6.name, S6.purpose, [
    rev(S6.id, 'revlightsLedStrip', 76),
    hifi(S6.id, 'telemetry-currentLapTime-ddu', g.cell(0, 0, 2)),
    hifi(S6.id, 'wetness', g.cell(2, 0)),
    hifi(S6.id, 'weather', g.cell(3, 0)),
    hifi(S6.id, 'incidents', g.cell(4, 0)),
    hifi(S6.id, 'inputsCombo', g.cell(0, 1, 2)),
    hifi(S6.id, 'speedGear', g.cell(2, 1, 2)),
    hifi(S6.id, 'position', g.cell(4, 1)),
    hifi(S6.id, 'trackMap3D', g.cell(0, 2)),
    hifi(S6.id, 'deltaSession', g.cell(1, 2)),
    hifi(S6.id, 'tyrePressure', g.cell(2, 2)),
    hifi(S6.id, 'fuel', g.cell(3, 2)),
    hifi(S6.id, 'brakeTemp', g.cell(4, 2)),
    hifi(S6.id, 'telemetry-oilTemperature-ddu', g.cell(0, 3)),
    hifi(S6.id, 'telemetry-tcSetting-ddu', g.cell(1, 3)),
    hifi(S6.id, 'telemetry-absSetting-ddu', g.cell(2, 3)),
    hifi(S6.id, 'telemetry-brakeBias-ddu', g.cell(3, 3)),
    hifi(S6.id, 'lapBest', g.cell(4, 3))
  ])
}

const S7: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_sprint_pace_ladder',
  name: 'Sprint Pace Ladder',
  purpose: 'Dry sprint pace page for converting lap projection into a controlled attack cadence.',
  session: 'sprint',
  condition: 'dry',
  focus: 'pace',
  priority: 160
}

function buildSprintPaceLadder() {
  const g = grid([24, 26, 28, 22], [30, 28, 22, 20], 68, 8)
  return frame(S7.id, S7.name, S7.purpose, [
    rev(S7.id, 'revlightsLedBar', 60),
    hifi(S7.id, 'trackMap3D', g.cell(0, 0)),
    hifi(S7.id, 'lapCurrent', g.cell(0, 1)),
    hifi(S7.id, 'speedGear', g.cell(1, 0, 2)),
    hifi(S7.id, 'telemetry-estimatedLap-competition', g.cell(1, 1)),
    hifi(S7.id, 'deltaBest', g.cell(2, 1)),
    hifi(S7.id, 'inputsBrakeThrottle', g.cell(3, 0)),
    hifi(S7.id, 'position', g.cell(3, 1)),
    hifi(S7.id, 'fuelLaps', g.cell(0, 2)),
    hifi(S7.id, 'tyreWear', g.cell(1, 2)),
    hifi(S7.id, 'incidents', g.cell(2, 2)),
    hifi(S7.id, 'lapBest', g.cell(3, 2)),
    hifi(S7.id, 'telemetry-coolantTemperature-competition', g.cell(0, 3)),
    hifi(S7.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(S7.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(S7.id, 'telemetry-brakeBias-competition', g.cell(3, 3))
  ])
}

const S8: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_sprint_fuel_window',
  name: 'Sprint Fuel Window',
  purpose: 'Fuel-saving sprint strategy page for finish margin, pit exposure and lap targets.',
  session: 'sprint',
  condition: 'fuel-save',
  focus: 'strategy',
  priority: 170
}

function buildSprintFuelWindow() {
  const g = grid([22, 22, 21, 19, 16], [31, 25, 24, 20], 80, 8)
  return frame(S8.id, S8.name, S8.purpose, [
    rev(S8.id, 'revlightsGradient', 72),
    hifi(S8.id, 'fuel', g.cell(0, 0, 2)),
    hifi(S8.id, 'trackMap2D', g.cell(2, 0, 2)),
    hifi(S8.id, 'pitLimiter', g.cell(4, 0)),
    hifi(S8.id, 'fuelDelta', g.cell(0, 1)),
    hifi(S8.id, 'fuelPerLap', g.cell(1, 1)),
    hifi(S8.id, 'speedGear', g.cell(2, 1, 2)),
    hifi(S8.id, 'timeRemaining', g.cell(4, 1)),
    hifi(S8.id, 'lapsRemaining', g.cell(0, 2)),
    hifi(S8.id, 'deltaBest', g.cell(1, 2)),
    hifi(S8.id, 'tyrePressure', g.cell(2, 2)),
    hifi(S8.id, 'incidents', g.cell(3, 2)),
    hifi(S8.id, 'position', g.cell(4, 2)),
    hifi(S8.id, 'oilPressure', g.cell(0, 3)),
    hifi(S8.id, 'telemetry-tcSetting-futuristic', g.cell(1, 3)),
    hifi(S8.id, 'telemetry-absSetting-futuristic', g.cell(2, 3)),
    hifi(S8.id, 'telemetry-brakeBias-futuristic', g.cell(3, 3)),
    hifi(S8.id, 'flag', g.cell(4, 3))
  ])
}

const S9: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_sprint_brake_conservation',
  name: 'Sprint Brake Conservation',
  purpose: 'Tyre-saving sprint engineering page linking brake heat, bias and tyre condition.',
  session: 'sprint',
  condition: 'tyre-save',
  focus: 'engineer',
  priority: 180
}

function buildSprintBrakeConservation() {
  const g = grid([22, 21, 20, 21, 16], [30, 29, 23, 18], 72, 8)
  return frame(S9.id, S9.name, S9.purpose, [
    rev(S9.id, 'revlightsLedStrip', 64),
    hifi(S9.id, 'brakeTemp', g.cell(0, 0, 2)),
    hifi(S9.id, 'speedGear', g.cell(2, 0, 2)),
    hifi(S9.id, 'telemetry-coolantTemperature-ddu', g.cell(4, 0)),
    hifi(S9.id, 'tyrePressure', g.cell(0, 1, 2)),
    hifi(S9.id, 'inputsBrakeThrottle', g.cell(2, 1, 2)),
    hifi(S9.id, 'telemetry-oilTemperature-ddu', g.cell(4, 1)),
    hifi(S9.id, 'trackMap3D', g.cell(0, 2)),
    hifi(S9.id, 'deltaSession', g.cell(1, 2)),
    hifi(S9.id, 'fuelLaps', g.cell(2, 2)),
    hifi(S9.id, 'incidents', g.cell(3, 2)),
    hifi(S9.id, 'position', g.cell(4, 2)),
    hifi(S9.id, 'oilPressure', g.cell(0, 3)),
    hifi(S9.id, 'telemetry-tcSetting-ddu', g.cell(1, 3)),
    hifi(S9.id, 'telemetry-absSetting-ddu', g.cell(2, 3)),
    hifi(S9.id, 'telemetry-brakeBias-ddu', g.cell(3, 3)),
    hifi(S9.id, 'tyreWear', g.cell(4, 3))
  ])
}

const S10: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_sprint_input_engineer',
  name: 'Sprint Input Engineer',
  purpose: 'Dry sprint engineering page for throttle, brake, steering and balance diagnostics.',
  session: 'sprint',
  condition: 'dry',
  focus: 'engineer',
  priority: 190
}

function buildSprintInputEngineer() {
  const g = grid([22, 21, 19, 20, 18], [32, 27, 23, 18], 64, 8)
  return frame(S10.id, S10.name, S10.purpose, [
    rev(S10.id, 'revlightsGradient', 56),
    hifi(S10.id, 'inputsCombo', g.cell(0, 0, 2)),
    hifi(S10.id, 'gForce', g.cell(2, 0)),
    hifi(S10.id, 'telemetry-steeringTorque-futuristic', g.cell(3, 0)),
    hifi(S10.id, 'incidents', g.cell(4, 0)),
    hifi(S10.id, 'speedGear', g.cell(0, 1, 2)),
    hifi(S10.id, 'deltaSession', g.cell(2, 1)),
    hifi(S10.id, 'tyrePressure', g.cell(3, 1)),
    hifi(S10.id, 'fuel', g.cell(4, 1)),
    hifi(S10.id, 'trackMap2D', g.cell(0, 2, 2)),
    hifi(S10.id, 'brakeTemp', g.cell(2, 2)),
    hifi(S10.id, 'telemetry-oilTemperature-futuristic', g.cell(3, 2)),
    hifi(S10.id, 'telemetry-coolantTemperature-futuristic', g.cell(4, 2)),
    hifi(S10.id, 'telemetry-tcSetting-futuristic', g.cell(0, 3)),
    hifi(S10.id, 'telemetry-absSetting-futuristic', g.cell(1, 3)),
    hifi(S10.id, 'telemetry-brakeBias-futuristic', g.cell(2, 3)),
    hifi(S10.id, 'telemetry-systemVoltage-futuristic', g.cell(3, 3)),
    hifi(S10.id, 'position', g.cell(4, 3))
  ])
}

export const GT3_DENSE_50_SPRINT_MATRIX = [S1, S2, S3, S4, S5, S6, S7, S8, S9, S10] as const

export const GT3_DENSE_50_SPRINT_PRESETS: DashboardPreset[] = [
  {
    id: S1.id,
    name: displayName(S1.name),
    build: buildSprintLaunchDelta,
    priority: S1.priority,
    tags: dashboardTags('sprint', 'dry', 'delta', 'competition', 'flags', 'traffic', 'position')
  },
  {
    id: S2.id,
    name: displayName(S2.name),
    build: buildSprintRainTraffic,
    priority: S2.priority,
    tags: dashboardTags('sprint', 'wet', 'traffic', 'futuristic', 'relative', 'radar', 'weather')
  },
  {
    id: S3.id,
    name: displayName(S3.name),
    build: buildSprintFuelAttack,
    priority: S3.priority,
    tags: dashboardTags('sprint', 'fuel-save', 'pace', 'ddu', 'fuel', 'laps')
  },
  {
    id: S4.id,
    name: displayName(S4.name),
    build: buildSprintTyreDefense,
    priority: S4.priority,
    tags: dashboardTags('sprint', 'tyre-save', 'traffic', 'competition', 'radar', 'relative', 'tyre-wear')
  },
  {
    id: S5.id,
    name: displayName(S5.name),
    build: buildSprintGapDuel,
    priority: S5.priority,
    tags: dashboardTags('sprint', 'dry', 'delta', 'futuristic', 'gap', 'relative', 'radar')
  },
  {
    id: S6.id,
    name: displayName(S6.name),
    build: buildSprintWetRhythm,
    priority: S6.priority,
    tags: dashboardTags('sprint', 'wet', 'consistency', 'ddu', 'inputs', 'weather', 'laps')
  },
  {
    id: S7.id,
    name: displayName(S7.name),
    build: buildSprintPaceLadder,
    priority: S7.priority,
    tags: dashboardTags('sprint', 'dry', 'pace', 'competition', 'inputs', 'laps')
  },
  {
    id: S8.id,
    name: displayName(S8.name),
    build: buildSprintFuelWindow,
    priority: S8.priority,
    tags: dashboardTags('sprint', 'fuel-save', 'strategy', 'futuristic', 'pit', 'flags', 'fuel')
  },
  {
    id: S9.id,
    name: displayName(S9.name),
    build: buildSprintBrakeConservation,
    priority: S9.priority,
    tags: dashboardTags('sprint', 'tyre-save', 'engineer', 'ddu', 'inputs', 'tyre-pressure', 'brakes')
  },
  {
    id: S10.id,
    name: displayName(S10.name),
    build: buildSprintInputEngineer,
    priority: S10.priority,
    tags: dashboardTags('sprint', 'dry', 'engineer', 'futuristic', 'inputs', 'steering', 'g-force')
  }
]
