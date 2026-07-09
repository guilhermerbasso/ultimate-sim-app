import { OVERLAY2_FAMILIES } from './familyStyle'
import type { OverlayDesignFamily } from '../../../shared/overlays'

export type Overlay2Category =
  | 'cockpit'
  | 'timing'
  | 'inputs'
  | 'tyres'
  | 'brakes'
  | 'fuel'
  | 'raceControl'
  | 'standings'
  | 'radar'
  | 'weather'
  | 'coaching'

export interface Overlay2Def {
  id: string
  name: string
  category: Overlay2Category
  specIds: string[]
  families: OverlayDesignFamily[]
  w: number
  h: number
}

const allFamilies = OVERLAY2_FAMILIES

export const OVERLAYS2: Overlay2Def[] = [
  {
    id: 'cockpit-core',
    name: 'Cockpit Core',
    category: 'cockpit',
    specIds: ['speed.bignum', 'gear.segment7', 'rpm.gauge', 'shift.led', 'deltaBest.tile', 'fuelPct.ring'],
    families: allFamilies,
    w: 560,
    h: 240
  },
  {
    id: 'cockpit-sprint-ddu',
    name: 'Sprint DDU',
    category: 'cockpit',
    specIds: ['gear.bignum', 'speed.segment7', 'rpm.bar', 'shift.led', 'brakeBias.tile', 'tc.tile', 'abs.tile'],
    families: allFamilies,
    w: 640,
    h: 220
  },
  {
    id: 'cockpit-endurance-strip',
    name: 'Endurance Cockpit Strip',
    category: 'cockpit',
    specIds: ['speed.tile', 'gear.segment7', 'rpm.ring', 'fuelLapsLeft.tile', 'lapsRemaining.tile', 'deltaSession.bignum'],
    families: allFamilies,
    w: 720,
    h: 180
  },
  {
    id: 'cockpit-analog-stack',
    name: 'Analog Stack',
    category: 'cockpit',
    specIds: ['rpm.gauge', 'speed.gauge', 'gear.tile', 'waterTemp.ring', 'oilTemp.ring', 'oilPress.ring'],
    families: allFamilies,
    w: 620,
    h: 320
  },
  {
    id: 'cockpit-qualifying',
    name: 'Qualifying Cockpit',
    category: 'cockpit',
    specIds: ['deltaBest.bignum', 'curLapTime.segment7', 'rpm.bar', 'shift.led', 'speed.tile', 'gear.tile'],
    families: allFamilies,
    w: 700,
    h: 210
  },
  {
    id: 'cockpit-night',
    name: 'Night Cockpit',
    category: 'cockpit',
    specIds: ['gear.segment7', 'speed.bignum', 'rpm.led', 'shift.ring', 'tc.pixel32', 'abs.pixel32'],
    families: allFamilies,
    w: 560,
    h: 200
  },
  {
    id: 'timing-lap-delta',
    name: 'Lap Delta',
    category: 'timing',
    specIds: ['deltaBest.bignum', 'deltaSession.tile', 'curLapTime.segment7', 'bestLapTime.tile', 'lastLapTime.tile'],
    families: allFamilies,
    w: 680,
    h: 190
  },
  {
    id: 'timing-sector-focus',
    name: 'Sector Focus',
    category: 'timing',
    specIds: ['curLapTime.bignum', 'lapDist.bar', 'deltaBest.bar', 'lastLapTime.tile', 'bestLapTime.tile'],
    families: allFamilies,
    w: 720,
    h: 200
  },
  {
    id: 'timing-race-clock',
    name: 'Race Clock',
    category: 'timing',
    specIds: ['curLap.tile', 'lapsRemaining.tile', 'lapDist.ring', 'curLapTime.segment7', 'deltaSession.bignum'],
    families: allFamilies,
    w: 620,
    h: 220
  },
  {
    id: 'timing-lap-stack',
    name: 'Lap Stack',
    category: 'timing',
    specIds: ['curLapTime.tile', 'lastLapTime.tile', 'bestLapTime.tile', 'deltaBest.tile', 'deltaSession.tile'],
    families: allFamilies,
    w: 600,
    h: 260
  },
  {
    id: 'timing-push-window',
    name: 'Push Window',
    category: 'timing',
    specIds: ['deltaBest.ring', 'deltaSession.ring', 'lapDist.bar', 'speed.tile', 'rpm.bar'],
    families: allFamilies,
    w: 650,
    h: 210
  },
  {
    id: 'inputs-pedals',
    name: 'Pedals',
    category: 'inputs',
    specIds: ['throttle.barv', 'brake.barv', 'clutch.barv', 'steer.gauge', 'longG.tile'],
    families: allFamilies,
    w: 500,
    h: 320
  },
  {
    id: 'inputs-trace',
    name: 'Input Trace',
    category: 'inputs',
    specIds: ['throttle.bar', 'brake.bar', 'clutch.bar', 'steer.bar', 'latG.tile', 'longG.tile'],
    families: allFamilies,
    w: 680,
    h: 180
  },
  {
    id: 'inputs-corner-entry',
    name: 'Corner Entry Inputs',
    category: 'inputs',
    specIds: ['brake.ring', 'steer.gauge', 'throttle.bar', 'longG.bar', 'latG.bar'],
    families: allFamilies,
    w: 640,
    h: 240
  },
  {
    id: 'inputs-launch',
    name: 'Launch Control Inputs',
    category: 'inputs',
    specIds: ['throttle.bignum', 'clutch.bignum', 'rpm.bar', 'shift.led', 'gear.segment7'],
    families: allFamilies,
    w: 620,
    h: 210
  },
  {
    id: 'inputs-balance',
    name: 'Driver Balance',
    category: 'inputs',
    specIds: ['steer.tile', 'latG.ring', 'longG.ring', 'brake.bar', 'throttle.bar'],
    families: allFamilies,
    w: 640,
    h: 230
  },
  {
    id: 'tyres-temp-corners',
    name: 'Tyre Temperature Corners',
    category: 'tyres',
    specIds: ['tyreTempFL.tile', 'tyreTempFR.tile', 'tyreTempRL.tile', 'tyreTempRR.tile', 'trackTemp.tile', 'grip.ring'],
    families: allFamilies,
    w: 660,
    h: 260
  },
  {
    id: 'tyres-pressure-corners',
    name: 'Tyre Pressure Corners',
    category: 'tyres',
    specIds: ['tyrePresFL.tile', 'tyrePresFR.tile', 'tyrePresRL.tile', 'tyrePresRR.tile', 'airTemp.tile'],
    families: allFamilies,
    w: 620,
    h: 250
  },
  {
    id: 'tyres-wear-corners',
    name: 'Tyre Wear Corners',
    category: 'tyres',
    specIds: ['tyreWearFL.ring', 'tyreWearFR.ring', 'tyreWearRL.ring', 'tyreWearRR.ring', 'lapsRemaining.tile'],
    families: allFamilies,
    w: 660,
    h: 280
  },
  {
    id: 'tyres-front-axle',
    name: 'Front Axle Tyres',
    category: 'tyres',
    specIds: ['tyreTempFL.bar', 'tyreTempFR.bar', 'tyrePresFL.tile', 'tyrePresFR.tile', 'tyreWearFL.ring', 'tyreWearFR.ring'],
    families: allFamilies,
    w: 700,
    h: 240
  },
  {
    id: 'tyres-rear-axle',
    name: 'Rear Axle Tyres',
    category: 'tyres',
    specIds: ['tyreTempRL.bar', 'tyreTempRR.bar', 'tyrePresRL.tile', 'tyrePresRR.tile', 'tyreWearRL.ring', 'tyreWearRR.ring'],
    families: allFamilies,
    w: 700,
    h: 240
  },
  {
    id: 'brakes-temp-corners',
    name: 'Brake Temperature Corners',
    category: 'brakes',
    specIds: ['brakeTempFL.tile', 'brakeTempFR.tile', 'brakeTempRL.tile', 'brakeTempRR.tile', 'brakeBias.bignum'],
    families: allFamilies,
    w: 650,
    h: 250
  },
  {
    id: 'brakes-front-axle',
    name: 'Front Brake Axle',
    category: 'brakes',
    specIds: ['brakeTempFL.gauge', 'brakeTempFR.gauge', 'brakeBias.tile', 'brake.bar', 'abs.tile'],
    families: allFamilies,
    w: 700,
    h: 260
  },
  {
    id: 'brakes-rear-axle',
    name: 'Rear Brake Axle',
    category: 'brakes',
    specIds: ['brakeTempRL.gauge', 'brakeTempRR.gauge', 'brakeBias.tile', 'longG.tile', 'abs.ring'],
    families: allFamilies,
    w: 700,
    h: 260
  },
  {
    id: 'brakes-attack',
    name: 'Brake Attack',
    category: 'brakes',
    specIds: ['brake.bignum', 'brakeTempFL.bar', 'brakeTempFR.bar', 'brakeTempRL.bar', 'brakeTempRR.bar', 'abs.led'],
    families: allFamilies,
    w: 720,
    h: 220
  },
  {
    id: 'brakes-management',
    name: 'Brake Management',
    category: 'brakes',
    specIds: ['brakeBias.ring', 'brakeTempFL.tile', 'brakeTempFR.tile', 'brakeTempRL.tile', 'brakeTempRR.tile', 'waterTemp.tile'],
    families: allFamilies,
    w: 700,
    h: 260
  },
  {
    id: 'fuel-stint',
    name: 'Fuel Stint',
    category: 'fuel',
    specIds: ['fuelLiters.bignum', 'fuelPct.ring', 'fuelPerLap.tile', 'fuelLapsLeft.tile', 'lapsRemaining.tile'],
    families: allFamilies,
    w: 650,
    h: 230
  },
  {
    id: 'fuel-endurance',
    name: 'Endurance Fuel',
    category: 'fuel',
    specIds: ['fuelLiters.tile', 'fuelPct.bar', 'fuelPerLap.bignum', 'fuelLapsLeft.bignum', 'deltaSession.tile', 'position.tile'],
    families: allFamilies,
    w: 720,
    h: 240
  },
  {
    id: 'fuel-splash',
    name: 'Splash Calculator',
    category: 'fuel',
    specIds: ['fuelLapsLeft.ring', 'lapsRemaining.tile', 'fuelPerLap.tile', 'fuelLiters.tile', 'fuelPct.tile'],
    families: allFamilies,
    w: 620,
    h: 230
  },
  {
    id: 'fuel-low-alert',
    name: 'Low Fuel Alert',
    category: 'fuel',
    specIds: ['fuelPct.bignum', 'fuelLiters.bar', 'fuelLapsLeft.tile', 'gapBehind.tile', 'position.tile'],
    families: allFamilies,
    w: 620,
    h: 210
  },
  {
    id: 'fuel-save-coach',
    name: 'Fuel Save Coach',
    category: 'fuel',
    specIds: ['fuelPerLap.ring', 'throttle.bar', 'brake.bar', 'fuelLapsLeft.tile', 'deltaBest.tile', 'engineMap.tile'],
    families: allFamilies,
    w: 700,
    h: 230
  },
  {
    id: 'race-flags',
    name: 'Race Flags',
    category: 'raceControl',
    specIds: ['incidents.bignum', 'position.tile', 'classPos.tile', 'lapsRemaining.tile', 'gapAhead.tile'],
    families: allFamilies,
    w: 620,
    h: 210
  },
  {
    id: 'race-incident-watch',
    name: 'Incident Watch',
    category: 'raceControl',
    specIds: ['incidents.ring', 'gapAhead.tile', 'gapBehind.tile', 'totalCars.tile', 'sof.tile'],
    families: allFamilies,
    w: 660,
    h: 230
  },
  {
    id: 'race-restart',
    name: 'Restart Control',
    category: 'raceControl',
    specIds: ['position.bignum', 'classPos.tile', 'totalCars.tile', 'lapDist.bar', 'gear.segment7', 'speed.tile'],
    families: allFamilies,
    w: 700,
    h: 230
  },
  {
    id: 'race-pit-limiter',
    name: 'Pit Control',
    category: 'raceControl',
    specIds: ['speed.bignum', 'gear.segment7', 'fuelLiters.tile', 'brakeBias.tile', 'incidents.tile'],
    families: allFamilies,
    w: 620,
    h: 220
  },
  {
    id: 'race-engine-watch',
    name: 'Engine Watch',
    category: 'raceControl',
    specIds: ['waterTemp.ring', 'oilTemp.ring', 'oilPress.ring', 'rpm.bar', 'shift.led'],
    families: allFamilies,
    w: 680,
    h: 250
  },
  {
    id: 'standings-position',
    name: 'Position Tower Tile',
    category: 'standings',
    specIds: ['position.bignum', 'classPos.bignum', 'totalCars.tile', 'sof.tile', 'gapAhead.tile', 'gapBehind.tile'],
    families: allFamilies,
    w: 650,
    h: 240
  },
  {
    id: 'standings-gaps',
    name: 'Race Gaps',
    category: 'standings',
    specIds: ['gapAhead.bignum', 'gapBehind.bignum', 'position.tile', 'classPos.tile', 'deltaSession.tile'],
    families: allFamilies,
    w: 660,
    h: 220
  },
  {
    id: 'standings-class',
    name: 'Class Battle',
    category: 'standings',
    specIds: ['classPos.bignum', 'position.tile', 'gapAhead.ring', 'gapBehind.ring', 'sof.tile'],
    families: allFamilies,
    w: 650,
    h: 240
  },
  {
    id: 'standings-traffic',
    name: 'Traffic Stack',
    category: 'standings',
    specIds: ['gapAhead.tile', 'gapBehind.tile', 'speed.tile', 'latG.tile', 'lapDist.bar', 'position.tile'],
    families: allFamilies,
    w: 700,
    h: 210
  },
  {
    id: 'standings-sof',
    name: 'Strength Field',
    category: 'standings',
    specIds: ['sof.bignum', 'totalCars.tile', 'position.tile', 'classPos.tile', 'incidents.tile'],
    families: allFamilies,
    w: 600,
    h: 220
  },
  {
    id: 'radar-proximity',
    name: 'Proximity Radar',
    category: 'radar',
    specIds: ['gapAhead.ring', 'gapBehind.ring', 'latG.tile', 'longG.tile', 'speed.tile'],
    families: allFamilies,
    w: 620,
    h: 240
  },
  {
    id: 'radar-side-load',
    name: 'Side Load Radar',
    category: 'radar',
    specIds: ['latG.bignum', 'steer.gauge', 'speed.tile', 'throttle.bar', 'brake.bar'],
    families: allFamilies,
    w: 650,
    h: 240
  },
  {
    id: 'radar-traffic-delta',
    name: 'Traffic Delta Radar',
    category: 'radar',
    specIds: ['gapAhead.tile', 'gapBehind.tile', 'deltaBest.bignum', 'lapDist.ring', 'position.tile'],
    families: allFamilies,
    w: 650,
    h: 230
  },
  {
    id: 'radar-corner-exit',
    name: 'Corner Exit Radar',
    category: 'radar',
    specIds: ['throttle.bar', 'steer.tile', 'latG.ring', 'longG.ring', 'gapBehind.tile'],
    families: allFamilies,
    w: 660,
    h: 230
  },
  {
    id: 'radar-defence',
    name: 'Defence Radar',
    category: 'radar',
    specIds: ['gapBehind.bignum', 'position.tile', 'speed.tile', 'brake.bar', 'latG.tile', 'longG.tile'],
    families: allFamilies,
    w: 700,
    h: 220
  },
  {
    id: 'weather-session',
    name: 'Session Weather',
    category: 'weather',
    specIds: ['trackTemp.bignum', 'airTemp.tile', 'wetness.ring', 'grip.ring', 'waterTemp.tile'],
    families: allFamilies,
    w: 640,
    h: 230
  },
  {
    id: 'weather-wetness',
    name: 'Wetness Watch',
    category: 'weather',
    specIds: ['wetness.bignum', 'grip.bar', 'trackTemp.tile', 'airTemp.tile', 'tyreTempFL.tile', 'tyreTempFR.tile'],
    families: allFamilies,
    w: 700,
    h: 240
  },
  {
    id: 'weather-track-evolution',
    name: 'Track Evolution',
    category: 'weather',
    specIds: ['grip.bignum', 'trackTemp.ring', 'airTemp.ring', 'wetness.tile', 'lapDist.bar'],
    families: allFamilies,
    w: 650,
    h: 230
  },
  {
    id: 'weather-heat-soak',
    name: 'Heat Soak',
    category: 'weather',
    specIds: ['trackTemp.tile', 'airTemp.tile', 'waterTemp.ring', 'oilTemp.ring', 'tyreTempRL.tile', 'tyreTempRR.tile'],
    families: allFamilies,
    w: 700,
    h: 250
  },
  {
    id: 'weather-rain-setup',
    name: 'Rain Setup',
    category: 'weather',
    specIds: ['wetness.ring', 'grip.ring', 'tc.tile', 'abs.tile', 'brakeBias.tile', 'tyrePresFL.tile'],
    families: allFamilies,
    w: 700,
    h: 230
  },
  {
    id: 'coaching-trail-brake',
    name: 'Trail Brake Coach',
    category: 'coaching',
    specIds: ['brake.bar', 'steer.gauge', 'longG.ring', 'latG.ring', 'deltaBest.tile'],
    families: allFamilies,
    w: 680,
    h: 250
  },
  {
    id: 'coaching-throttle-app',
    name: 'Throttle Application Coach',
    category: 'coaching',
    specIds: ['throttle.bar', 'steer.tile', 'longG.tile', 'deltaBest.bignum', 'gear.segment7'],
    families: allFamilies,
    w: 680,
    h: 220
  },
  {
    id: 'coaching-consistency',
    name: 'Consistency Coach',
    category: 'coaching',
    specIds: ['lastLapTime.tile', 'bestLapTime.tile', 'deltaSession.bignum', 'incidents.tile', 'fuelPerLap.tile'],
    families: allFamilies,
    w: 700,
    h: 230
  },
  {
    id: 'coaching-tyre-care',
    name: 'Tyre Care Coach',
    category: 'coaching',
    specIds: ['tyreWearFL.tile', 'tyreWearFR.tile', 'tyreWearRL.tile', 'tyreWearRR.tile', 'steer.bar', 'latG.tile'],
    families: allFamilies,
    w: 720,
    h: 240
  },
  {
    id: 'coaching-engine-care',
    name: 'Engine Care Coach',
    category: 'coaching',
    specIds: ['rpm.bar', 'waterTemp.tile', 'oilTemp.tile', 'oilPress.tile', 'shift.led', 'engineMap.tile'],
    families: allFamilies,
    w: 720,
    h: 230
  },
  {
    id: 'coaching-racecraft',
    name: 'Racecraft Coach',
    category: 'coaching',
    specIds: ['gapAhead.tile', 'gapBehind.tile', 'position.tile', 'incidents.ring', 'deltaBest.tile', 'lapDist.bar'],
    families: allFamilies,
    w: 720,
    h: 220
  }
]

export const OVERLAYS2_BY_ID: Record<string, Overlay2Def> = Object.fromEntries(
  OVERLAYS2.map((overlay) => [overlay.id, overlay])
)
