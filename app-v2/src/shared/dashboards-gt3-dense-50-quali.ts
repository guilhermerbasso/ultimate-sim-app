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

const Q1: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_quali_apex_delta',
  name: 'Quali Apex Delta',
  purpose: 'Dry qualifying attack page for braking references, live delta and a clean final push lap.',
  session: 'quali',
  condition: 'dry',
  focus: 'delta',
  priority: 0
}

function buildQualiApexDelta() {
  const g = grid([28, 22, 22, 28], [30, 25, 23, 22], 72, 8)
  return frame(Q1.id, Q1.name, Q1.purpose, [
    rev(Q1.id, 'revlightsLedBar', 64),
    hifi(Q1.id, 'trackMap2D', g.cell(0, 0)),
    hifi(Q1.id, 'lapCurrent', g.cell(0, 1)),
    hifi(Q1.id, 'speedGear', g.cell(1, 0, 2, 2)),
    hifi(Q1.id, 'inputsCombo', g.cell(3, 0)),
    hifi(Q1.id, 'position', g.cell(3, 1)),
    hifi(Q1.id, 'incidents', g.cell(0, 2)),
    hifi(Q1.id, 'deltaBest', g.cell(1, 2)),
    hifi(Q1.id, 'tyrePressure', g.cell(2, 2)),
    hifi(Q1.id, 'fuel', g.cell(3, 2)),
    hifi(Q1.id, 'telemetry-oilTemperature-competition', g.cell(0, 3)),
    hifi(Q1.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(Q1.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(Q1.id, 'telemetry-brakeBias-competition', g.cell(3, 3))
  ])
}

const Q2: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_quali_rain_reference',
  name: 'Quali Rain Reference',
  purpose: 'Wet qualifying reference page balancing delta, grip state and tyre-temperature readiness.',
  session: 'quali',
  condition: 'wet',
  focus: 'delta',
  priority: 10
}

function buildQualiRainReference() {
  const g = grid([24, 28, 25, 23], [34, 23, 22, 21], 80, 8)
  return frame(Q2.id, Q2.name, Q2.purpose, [
    rev(Q2.id, 'revlightsLedStrip', 72),
    hifi(Q2.id, 'telemetry-gear-ddu', g.cell(0, 0, 1, 2)),
    hifi(Q2.id, 'trackMap3D', g.cell(1, 0, 2, 2)),
    hifi(Q2.id, 'telemetry-speed-ddu', g.cell(3, 0)),
    hifi(Q2.id, 'wetness', g.cell(3, 1)),
    hifi(Q2.id, 'deltaSession', g.cell(0, 2)),
    hifi(Q2.id, 'tyrePressure', g.cell(1, 2)),
    hifi(Q2.id, 'fuelLaps', g.cell(2, 2)),
    hifi(Q2.id, 'incidents', g.cell(3, 2)),
    hifi(Q2.id, 'telemetry-coolantTemperature-ddu', g.cell(0, 3)),
    hifi(Q2.id, 'telemetry-tcSetting-ddu', g.cell(1, 3)),
    hifi(Q2.id, 'telemetry-absSetting-ddu', g.cell(2, 3)),
    hifi(Q2.id, 'telemetry-brakeBias-ddu', g.cell(3, 3))
  ])
}

const Q3: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_quali_repeatability_lab',
  name: 'Quali Repeatability Lab',
  purpose: 'Dry qualifying repeatability page comparing successive laps and input consistency.',
  session: 'quali',
  condition: 'dry',
  focus: 'consistency',
  priority: 20
}

function buildQualiRepeatabilityLab() {
  const g = grid([23, 27, 27, 23], [24, 30, 24, 22], 68, 10)
  return frame(Q3.id, Q3.name, Q3.purpose, [
    rev(Q3.id, 'revlightsGradient', 60),
    hifi(Q3.id, 'lapLast', g.cell(0, 0)),
    hifi(Q3.id, 'lapBest', g.cell(0, 1)),
    hifi(Q3.id, 'speedGear', g.cell(1, 0, 2)),
    hifi(Q3.id, 'inputsCombo', g.cell(1, 1, 2)),
    hifi(Q3.id, 'telemetry-deltaDriverBest-futuristic', g.cell(3, 0)),
    hifi(Q3.id, 'telemetry-estimatedLap-futuristic', g.cell(3, 1)),
    hifi(Q3.id, 'trackMap2D', g.cell(0, 2)),
    hifi(Q3.id, 'fuelPerLap', g.cell(1, 2)),
    hifi(Q3.id, 'tyreWear', g.cell(2, 2)),
    hifi(Q3.id, 'incidents', g.cell(3, 2)),
    hifi(Q3.id, 'oilPressure', g.cell(0, 3)),
    hifi(Q3.id, 'telemetry-tcSetting-futuristic', g.cell(1, 3)),
    hifi(Q3.id, 'telemetry-absSetting-futuristic', g.cell(2, 3)),
    hifi(Q3.id, 'telemetry-brakeBias-futuristic', g.cell(3, 3))
  ])
}

const Q4: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_quali_tyre_prep',
  name: 'Quali Tyre Prep Window',
  purpose: 'Tyre-conserving out-lap page for pressure, brake energy and timed push preparation.',
  session: 'quali',
  condition: 'tyre-save',
  focus: 'pace',
  priority: 30
}

function buildQualiTyrePrepWindow() {
  const g = grid([25, 24, 28, 23], [29, 27, 23, 21], 76, 8)
  return frame(Q4.id, Q4.name, Q4.purpose, [
    rev(Q4.id, 'revlightsLedBar', 68),
    hifi(Q4.id, 'speedGear', g.cell(0, 0)),
    hifi(Q4.id, 'trackMap2D', g.cell(0, 1)),
    hifi(Q4.id, 'tyrePressure', g.cell(1, 0, 2, 2)),
    hifi(Q4.id, 'brakeTemp', g.cell(3, 0)),
    hifi(Q4.id, 'telemetry-estimatedLap-competition', g.cell(3, 1)),
    hifi(Q4.id, 'fuelLaps', g.cell(0, 2)),
    hifi(Q4.id, 'incidents', g.cell(1, 2)),
    hifi(Q4.id, 'telemetry-oilTemperature-competition', g.cell(2, 2)),
    hifi(Q4.id, 'deltaBest', g.cell(3, 2)),
    hifi(Q4.id, 'tyreWear', g.cell(0, 3)),
    hifi(Q4.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(Q4.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(Q4.id, 'telemetry-brakeBias-competition', g.cell(3, 3))
  ])
}

const Q5: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_quali_banker_margin',
  name: 'Quali Banker Fuel Margin',
  purpose: 'Fuel-saving banker-lap page that protects a valid time while preserving one final attempt.',
  session: 'quali',
  condition: 'fuel-save',
  focus: 'strategy',
  priority: 40
}

function buildQualiBankerFuelMargin() {
  const g = grid([27, 25, 24, 24], [31, 25, 22, 22], 64, 8)
  return frame(Q5.id, Q5.name, Q5.purpose, [
    rev(Q5.id, 'revlightsLedStrip', 56),
    hifi(Q5.id, 'fuel', g.cell(0, 0, 2, 2)),
    hifi(Q5.id, 'speedGear', g.cell(2, 0, 2)),
    hifi(Q5.id, 'fuelDelta', g.cell(2, 1)),
    hifi(Q5.id, 'deltaBest', g.cell(3, 1)),
    hifi(Q5.id, 'trackMap3D', g.cell(0, 2)),
    hifi(Q5.id, 'fuelPerLap', g.cell(1, 2)),
    hifi(Q5.id, 'tyrePressure', g.cell(2, 2)),
    hifi(Q5.id, 'incidents', g.cell(3, 2)),
    hifi(Q5.id, 'telemetry-systemVoltage-ddu', g.cell(0, 3)),
    hifi(Q5.id, 'telemetry-tcSetting-ddu', g.cell(1, 3)),
    hifi(Q5.id, 'telemetry-absSetting-ddu', g.cell(2, 3)),
    hifi(Q5.id, 'telemetry-brakeBias-ddu', g.cell(3, 3))
  ])
}

const Q6: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_quali_traffic_release',
  name: 'Quali Traffic Release',
  purpose: 'Dry qualifying traffic page for release timing, relative gaps and a clean track opening.',
  session: 'quali',
  condition: 'dry',
  focus: 'traffic',
  priority: 50
}

function buildQualiTrafficRelease() {
  const g = grid([21, 20, 20, 19, 20], [32, 25, 23, 20], 72, 8)
  return frame(Q6.id, Q6.name, Q6.purpose, [
    rev(Q6.id, 'revlightsGradient', 64),
    hifi(Q6.id, 'standings', g.cell(0, 0, 1, 2)),
    hifi(Q6.id, 'speedGear', g.cell(1, 0, 2)),
    hifi(Q6.id, 'relative', g.cell(1, 1, 2)),
    hifi(Q6.id, 'radar', g.cell(3, 0, 2, 2)),
    hifi(Q6.id, 'trackMap2D', g.cell(0, 2)),
    hifi(Q6.id, 'deltaAhead', g.cell(1, 2)),
    hifi(Q6.id, 'tyrePressure', g.cell(2, 2)),
    hifi(Q6.id, 'fuelLaps', g.cell(3, 2)),
    hifi(Q6.id, 'incidents', g.cell(4, 2)),
    hifi(Q6.id, 'telemetry-oilTemperature-futuristic', g.cell(0, 3)),
    hifi(Q6.id, 'telemetry-tcSetting-futuristic', g.cell(1, 3)),
    hifi(Q6.id, 'telemetry-absSetting-futuristic', g.cell(2, 3)),
    hifi(Q6.id, 'telemetry-brakeBias-futuristic', g.cell(3, 3)),
    hifi(Q6.id, 'position', g.cell(4, 3))
  ])
}

const Q7: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_quali_wet_trace',
  name: 'Quali Wet Trace Engineer',
  purpose: 'Wet qualifying engineering page correlating inputs, balance settings and lap-time loss.',
  session: 'quali',
  condition: 'wet',
  focus: 'engineer',
  priority: 60
}

function buildQualiWetTraceEngineer() {
  const g = grid([22, 20, 19, 19, 20], [31, 25, 24, 20], 80, 8)
  return frame(Q7.id, Q7.name, Q7.purpose, [
    rev(Q7.id, 'revlightsLedBar', 72),
    hifi(Q7.id, 'inputsBrakeThrottle', g.cell(0, 0, 2)),
    hifi(Q7.id, 'gForce', g.cell(2, 0)),
    hifi(Q7.id, 'wetness', g.cell(3, 0)),
    hifi(Q7.id, 'weather', g.cell(4, 0)),
    hifi(Q7.id, 'speedGear', g.cell(0, 1, 2)),
    hifi(Q7.id, 'telemetry-deltaSessionOptimal-competition', g.cell(2, 1)),
    hifi(Q7.id, 'tyrePressure', g.cell(3, 1)),
    hifi(Q7.id, 'fuel', g.cell(4, 1)),
    hifi(Q7.id, 'trackMap3D', g.cell(0, 2, 2)),
    hifi(Q7.id, 'brakeTemp', g.cell(2, 2, 2)),
    hifi(Q7.id, 'incidents', g.cell(4, 2)),
    hifi(Q7.id, 'oilPressure', g.cell(0, 3)),
    hifi(Q7.id, 'telemetry-coolantTemperature-competition', g.cell(1, 3)),
    hifi(Q7.id, 'telemetry-tcSetting-competition', g.cell(2, 3)),
    hifi(Q7.id, 'telemetry-absSetting-competition', g.cell(3, 3)),
    hifi(Q7.id, 'telemetry-brakeBias-competition', g.cell(4, 3))
  ])
}

const Q8: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_quali_pole_pace',
  name: 'Quali Pole Pace',
  purpose: 'Dry qualifying pace page centered on projected lap time and session-best convergence.',
  session: 'quali',
  condition: 'dry',
  focus: 'pace',
  priority: 70
}

function buildQualiPolePace() {
  const g = grid([22, 29, 27, 22], [27, 31, 22, 20], 68, 8)
  return frame(Q8.id, Q8.name, Q8.purpose, [
    rev(Q8.id, 'revlightsLedStrip', 60),
    hifi(Q8.id, 'trackMap3D', g.cell(0, 0)),
    hifi(Q8.id, 'lapBest', g.cell(0, 1)),
    hifi(Q8.id, 'telemetry-currentLapTime-ddu', g.cell(1, 0, 2)),
    hifi(Q8.id, 'speedGear', g.cell(1, 1, 2)),
    hifi(Q8.id, 'telemetry-estimatedLap-ddu', g.cell(3, 0)),
    hifi(Q8.id, 'deltaBest', g.cell(3, 1)),
    hifi(Q8.id, 'fuelLaps', g.cell(0, 2)),
    hifi(Q8.id, 'tyrePressure', g.cell(1, 2)),
    hifi(Q8.id, 'incidents', g.cell(2, 2)),
    hifi(Q8.id, 'position', g.cell(3, 2)),
    hifi(Q8.id, 'telemetry-coolantTemperature-ddu', g.cell(0, 3)),
    hifi(Q8.id, 'telemetry-tcSetting-ddu', g.cell(1, 3)),
    hifi(Q8.id, 'telemetry-absSetting-ddu', g.cell(2, 3)),
    hifi(Q8.id, 'telemetry-brakeBias-ddu', g.cell(3, 3))
  ])
}

const Q9: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_quali_pressure_conservation',
  name: 'Quali Pressure Conservation',
  purpose: 'Tyre-saving qualifying page for holding pressures inside the peak-grip launch window.',
  session: 'quali',
  condition: 'tyre-save',
  focus: 'strategy',
  priority: 80
}

function buildQualiPressureConservation() {
  const g = grid([22, 22, 20, 18, 18], [32, 25, 23, 20], 76, 10)
  return frame(Q9.id, Q9.name, Q9.purpose, [
    rev(Q9.id, 'revlightsGradient', 68),
    hifi(Q9.id, 'tyrePressure', g.cell(0, 0, 2, 2)),
    hifi(Q9.id, 'speedGear', g.cell(2, 0, 3)),
    hifi(Q9.id, 'telemetry-deltaOptimal-futuristic', g.cell(2, 1, 3)),
    hifi(Q9.id, 'trackMap2D', g.cell(0, 2)),
    hifi(Q9.id, 'tyreWear', g.cell(1, 2)),
    hifi(Q9.id, 'fuelLaps', g.cell(2, 2)),
    hifi(Q9.id, 'incidents', g.cell(3, 2)),
    hifi(Q9.id, 'brakeTemp', g.cell(4, 2)),
    hifi(Q9.id, 'telemetry-coolantTemperature-futuristic', g.cell(0, 3)),
    hifi(Q9.id, 'oilPressure', g.cell(1, 3)),
    hifi(Q9.id, 'telemetry-tcSetting-futuristic', g.cell(2, 3)),
    hifi(Q9.id, 'telemetry-absSetting-futuristic', g.cell(3, 3)),
    hifi(Q9.id, 'telemetry-brakeBias-futuristic', g.cell(4, 3))
  ])
}

const Q10: DenseDashboardMatrixEntry = {
  id: 'gt3_dense50_quali_sector_rhythm',
  name: 'Quali Sector Rhythm',
  purpose: 'Dry qualifying rhythm page for repeating sector execution without over-driving the car.',
  session: 'quali',
  condition: 'dry',
  focus: 'consistency',
  priority: 90
}

function buildQualiSectorRhythm() {
  const g = grid([18, 22, 21, 21, 18], [26, 30, 24, 20], 72, 8)
  return frame(Q10.id, Q10.name, Q10.purpose, [
    rev(Q10.id, 'revlightsLedBar', 64),
    hifi(Q10.id, 'lapLast', g.cell(0, 0)),
    hifi(Q10.id, 'lapBest', g.cell(0, 1)),
    hifi(Q10.id, 'speedGear', g.cell(1, 0, 3)),
    hifi(Q10.id, 'inputsCombo', g.cell(1, 1, 3)),
    hifi(Q10.id, 'telemetry-deltaDriverBest-competition', g.cell(4, 0)),
    hifi(Q10.id, 'telemetry-currentLapTime-competition', g.cell(4, 1)),
    hifi(Q10.id, 'trackMap2D', g.cell(0, 2)),
    hifi(Q10.id, 'fuelPerLap', g.cell(1, 2)),
    hifi(Q10.id, 'tyreWear', g.cell(2, 2)),
    hifi(Q10.id, 'incidents', g.cell(3, 2)),
    hifi(Q10.id, 'position', g.cell(4, 2)),
    hifi(Q10.id, 'telemetry-oilTemperature-competition', g.cell(0, 3)),
    hifi(Q10.id, 'telemetry-tcSetting-competition', g.cell(1, 3)),
    hifi(Q10.id, 'telemetry-absSetting-competition', g.cell(2, 3)),
    hifi(Q10.id, 'telemetry-brakeBias-competition', g.cell(3, 3)),
    hifi(Q10.id, 'telemetry-estimatedLap-competition', g.cell(4, 3))
  ])
}

export const GT3_DENSE_50_QUALI_MATRIX = [Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8, Q9, Q10] as const

export const GT3_DENSE_50_QUALI_PRESETS: DashboardPreset[] = [
  {
    id: Q1.id,
    name: displayName(Q1.name),
    build: buildQualiApexDelta,
    priority: Q1.priority,
    tags: dashboardTags('quali', 'dry', 'delta', 'competition', 'inputs', 'laps', 'position')
  },
  {
    id: Q2.id,
    name: displayName(Q2.name),
    build: buildQualiRainReference,
    priority: Q2.priority,
    tags: dashboardTags('quali', 'wet', 'delta', 'ddu', 'weather', 'wetness', 'pace')
  },
  {
    id: Q3.id,
    name: displayName(Q3.name),
    build: buildQualiRepeatabilityLab,
    priority: Q3.priority,
    tags: dashboardTags('quali', 'dry', 'consistency', 'futuristic', 'inputs', 'laps')
  },
  {
    id: Q4.id,
    name: displayName(Q4.name),
    build: buildQualiTyrePrepWindow,
    priority: Q4.priority,
    tags: dashboardTags('quali', 'tyre-save', 'pace', 'competition', 'tyre-pressure', 'tyre-wear')
  },
  {
    id: Q5.id,
    name: displayName(Q5.name),
    build: buildQualiBankerFuelMargin,
    priority: Q5.priority,
    tags: dashboardTags('quali', 'fuel-save', 'strategy', 'ddu', 'fuel', 'pit')
  },
  {
    id: Q6.id,
    name: displayName(Q6.name),
    build: buildQualiTrafficRelease,
    priority: Q6.priority,
    tags: dashboardTags('quali', 'dry', 'traffic', 'futuristic', 'standings', 'relative', 'radar')
  },
  {
    id: Q7.id,
    name: displayName(Q7.name),
    build: buildQualiWetTraceEngineer,
    priority: Q7.priority,
    tags: dashboardTags('quali', 'wet', 'engineer', 'competition', 'inputs', 'g-force', 'weather')
  },
  {
    id: Q8.id,
    name: displayName(Q8.name),
    build: buildQualiPolePace,
    priority: Q8.priority,
    tags: dashboardTags('quali', 'dry', 'pace', 'ddu', 'laps', 'position')
  },
  {
    id: Q9.id,
    name: displayName(Q9.name),
    build: buildQualiPressureConservation,
    priority: Q9.priority,
    tags: dashboardTags('quali', 'tyre-save', 'strategy', 'futuristic', 'tyre-pressure', 'tyre-wear')
  },
  {
    id: Q10.id,
    name: displayName(Q10.name),
    build: buildQualiSectorRhythm,
    priority: Q10.priority,
    tags: dashboardTags('quali', 'dry', 'consistency', 'competition', 'inputs', 'laps', 'sectors')
  }
]
