import type { ReactElement } from 'react'
import type { OverlayWidgetId } from '../../../../shared/overlays'
import './overlayWidgetsR16.css'
import { CarSilhouetteRadarWidget } from './CarSilhouetteRadarWidget'
import { CoachHeatmapWidget } from './CoachHeatmapWidget'
import {
  CoachFindingsWidget,
  CoachSectorGraphWidget,
  CoachTipsWidget,
  EngineerFeedWidget
} from './CoachEngineerWidgets'
import { CompactHudWidget } from './CompactHudWidget'
import { CustomValueWidget } from './CustomValueWidget'
import { DeltaLapWidget } from './DeltaLapWidget'
import { EngineVitalsStripWidget } from './EngineVitalsStripWidget'
import {
  ErsBarWidget,
  ErsBatteryWidget,
  ErsFlowWidget,
  PushToPassHudWidget,
  PushToPassPipsWidget
} from './EnergyHudWidgets'
import {
  ApexRadarWidget,
  DeltaBarWidget,
  LapReadoutWidget,
  NeonGearBarWidget
} from './ExtraHudWidgets'
import { FlagsWidget } from './FlagsWidget'
import { FuelWidget } from './FuelWidget'
import { GapAheadWidget, GapBehindWidget } from './GapWidgets'
import {
  BrakeHeatTilesWidget,
  DeltaNeedleWidget,
  DeltaRibbonWidget,
  FlagIconStackWidget,
  FuelLapsPipsWidget,
  FuelOrbWidget,
  GearRingWidget,
  InputsOscilloscopeWidget,
  InputsVectorWidget,
  OrbitRadarWidget,
  RelativeBeaconsWidget,
  RelativeLadderWidget,
  RevCometWidget,
  SideRadarGlyphWidget,
  SpeedGlyphWidget,
  TrackMapRibbonWidget,
  TrackSectorPulseWidget,
  TyreHaloGridWidget,
  WeatherGripGlyphWidget
} from './FuturisticOverlayWidgets'
import { GForceWidget } from './GForceWidget'
import { GT3AlarmWidget } from './GT3AlarmWidget'
import { GT3ClusterWidget } from './GT3ClusterWidget'
import { GearSpeedWidget } from './GearSpeedWidget'
import { InputsTraceWidget } from './InputsTraceWidget'
import { InputsWidget } from './InputsWidget'
import { ProximityRadarWidget } from './ProximityRadarWidget'
import {
  CatchAheadWidget,
  CaughtBehindWidget,
  FuelMarginWidget,
  PaceProjectedWidget,
  TireWearPredWidget
} from './PredictionWidgets'
import {
  BopBadgeWidget,
  ColdPressureCardWidget,
  ColdPressureGridWidget,
  PitStatusHudWidget,
  PitTicketWidget,
  SessionClockWidget,
  SurfaceScopeWidget,
  SurfaceTagWidget,
  TrackClockWidget,
  WetRadarWidget,
  WetTagWidget
} from './RaceControlWidgets'
import { RelativeWidget } from './RelativeWidget'
import { RelativesStripWidget } from './RelativesStripWidget'
import { RevLightsWidget } from './RevLightsWidget'
import { SessionWeatherWidget } from './SessionWeatherWidget'
import { StandingsWidget } from './StandingsWidget'
import { SymbolStatusWidget } from './SymbolStatusWidget'
import { TeamFuelWidget } from './TeamFuelWidget'
import { TireWearWidget } from './TireWearWidget'
import { TrackMapNav3DWidget } from './TrackMapNav3DWidget'
import { TrackMapWidget } from './TrackMapWidget'
import { TyresBrakesWidget } from './TyresBrakesWidget'
import { TyresDetailWidget } from './TyresDetailWidget'
import { WeatherWidget } from './WeatherWidget'
import { GridStackDashWidget } from './GridStackDashWidget'
import { GridProDashWidget } from './GridProDashWidget'
import { Bosch296DashWidget } from './Bosch296DashWidget'
import { RingDashWidget } from './RingDashWidget'
import { LmuEnduranceDashWidget } from './LmuEnduranceDashWidget'
import { LmuStintDashWidget } from './LmuStintDashWidget'
import { RaceconRc01DashWidget } from './RaceconRc01DashWidget'
import { RaceconRc02DashWidget } from './RaceconRc02DashWidget'
import { RaceconRc03DashWidget } from './RaceconRc03DashWidget'
import { RaceconRc04DashWidget } from './RaceconRc04DashWidget'
import { RaceconRc05DashWidget } from './RaceconRc05DashWidget'
import { RaceconRc06DashWidget } from './RaceconRc06DashWidget'
import { HifiDduWidget, HifiEnduranceWidget, HifiEngineerWidget, HifiMinimalWidget, HifiBroadcastWidget } from './HifiDashWidgets'
import { PerCornerTyrePressureWidget } from './PerCornerTyrePressureWidget'
import { BrakeTempCornersWidget } from './BrakeTempCornersWidget'
import { FuelDeltaTileWidget } from './FuelDeltaTileWidget'
import { ShiftPointBarWidget } from './ShiftPointBarWidget'
import { EngineVitalsDialWidget } from './EngineVitalsDialWidget'
import { SessionInfoTileWidget } from './SessionInfoTileWidget'
import { EngineTellTalesWidget } from './EngineTellTalesWidget'
import { AbsCutGaugeWidget } from './AbsCutGaugeWidget'
import { SessionStateBannerWidget } from './SessionStateBannerWidget'
import { PaceRestartWidget } from './PaceRestartWidget'
import { SideProximityWidget } from './SideProximityWidget'
import { AnalogTachWidget } from './AnalogTachWidget'
import { CupClusterWidget } from './CupClusterWidget'
import { EnduranceMultiWidget } from './EnduranceMultiWidget'
import { OledStripWidget } from './OledStripWidget'
import { MotecDenseWidget } from './MotecDenseWidget'
import { Gt3WheelWidget } from './Gt3WheelWidget'
import { HifiWidgetHost } from './HifiWidgetHost'
import type { WidgetProps } from './types'

type LegacyOverlayWidgetId = Exclude<OverlayWidgetId, `hifi:${string}`>

export const WIDGET_COMPONENTS: Record<string, (props: WidgetProps) => ReactElement> = {
  revlights: RevLightsWidget,
  gearSpeed: GearSpeedWidget,
  deltaLap: DeltaLapWidget,
  inputs: InputsWidget,
  fuel: FuelWidget,
  gforce: GForceWidget,
  relative: RelativeWidget,
  flags: FlagsWidget,
  tyresBrakes: TyresBrakesWidget,
  weather: WeatherWidget,
  standings: StandingsWidget,
  inputsTrace: InputsTraceWidget,
  tyresDetail: TyresDetailWidget,
  trackMap: TrackMapWidget,
  trackMapNav3D: TrackMapNav3DWidget,
  proximityRadar: ProximityRadarWidget,
  carSilhouetteRadar: CarSilhouetteRadarWidget,
  sessionWeather: SessionWeatherWidget,
  customValue: CustomValueWidget,
  tireWear: TireWearWidget,
  teamFuel: TeamFuelWidget,
  gt3Cluster: GT3ClusterWidget,
  gt3Alarm: GT3AlarmWidget,
  engineVitalsStrip: EngineVitalsStripWidget,
  relativesStrip: RelativesStripWidget,
  compactHud: CompactHudWidget,
  symbolStatus: SymbolStatusWidget,
  gridStackDash: GridStackDashWidget,
  gridProDash: GridProDashWidget,
  bosch296Dash: Bosch296DashWidget,
  ringDash: RingDashWidget,
  lmuEnduranceDash: LmuEnduranceDashWidget,
  lmuStintDash: LmuStintDashWidget,
  raceconRc01Dash: RaceconRc01DashWidget,
  raceconRc02Dash: RaceconRc02DashWidget,
  raceconRc03Dash: RaceconRc03DashWidget,
  raceconRc04Dash: RaceconRc04DashWidget,
  raceconRc05Dash: RaceconRc05DashWidget,
  raceconRc06Dash: RaceconRc06DashWidget,
  hifiDdu: HifiDduWidget,
  hifiEndurance: HifiEnduranceWidget,
  hifiEngineer: HifiEngineerWidget,
  hifiMinimal: HifiMinimalWidget,
  hifiBroadcast: HifiBroadcastWidget,
  perCornerTyrePressure: PerCornerTyrePressureWidget,
  brakeTempCorners: BrakeTempCornersWidget,
  fuelDeltaTile: FuelDeltaTileWidget,
  shiftPointBar: ShiftPointBarWidget,
  engineVitalsDial: EngineVitalsDialWidget,
  sessionInfoTile: SessionInfoTileWidget,
  revComet: RevCometWidget,
  sideRadarGlyph: SideRadarGlyphWidget,
  orbitRadar: OrbitRadarWidget,
  relativeBeacons: RelativeBeaconsWidget,
  relativeLadder: RelativeLadderWidget,
  deltaNeedle: DeltaNeedleWidget,
  deltaRibbon: DeltaRibbonWidget,
  gearRing: GearRingWidget,
  speedGlyph: SpeedGlyphWidget,
  fuelOrb: FuelOrbWidget,
  fuelPips: FuelLapsPipsWidget,
  inputsVector: InputsVectorWidget,
  inputsScope: InputsOscilloscopeWidget,
  tyreHaloGrid: TyreHaloGridWidget,
  brakeHeatTiles: BrakeHeatTilesWidget,
  trackRibbonFuture: TrackMapRibbonWidget,
  trackSectorPulse: TrackSectorPulseWidget,
  weatherGripGlyph: WeatherGripGlyphWidget,
  flagIconStack: FlagIconStackWidget,
  gapAhead: GapAheadWidget,
  gapBehind: GapBehindWidget,
  // ─── R16 batch — futuristic ───────────────────────────────────────────────
  ersBattery: ErsBatteryWidget,
  ersFlow: ErsFlowWidget,
  pushToPassHud: PushToPassHudWidget,
  pitStatusHud: PitStatusHudWidget,
  coldPressureGrid: ColdPressureGridWidget,
  trackClock: TrackClockWidget,
  wetRadar: WetRadarWidget,
  surfaceScope: SurfaceScopeWidget,
  neonGearBar: NeonGearBarWidget,
  apexRadar: ApexRadarWidget,
  // ─── R16 batch — minimalist ───────────────────────────────────────────────
  ersBar: ErsBarWidget,
  pushToPassPips: PushToPassPipsWidget,
  pitTicket: PitTicketWidget,
  coldPressureCard: ColdPressureCardWidget,
  sessionClock: SessionClockWidget,
  wetTag: WetTagWidget,
  surfaceTag: SurfaceTagWidget,
  bopBadge: BopBadgeWidget,
  deltaBar: DeltaBarWidget,
  lapReadout: LapReadoutWidget,
  // ─── WS-H: predictor overlays ─────────────────────────────────────────────
  predCatchAhead: CatchAheadWidget,
  predCaughtBehind: CaughtBehindWidget,
  predFuelMargin: FuelMarginWidget,
  predTireWear: TireWearPredWidget,
  predPaceProjected: PaceProjectedWidget,
  // ─── WS-M: coaching heatmap overlay ───────────────────────────────────────
  coachHeatmap: CoachHeatmapWidget,
  // ─── WS-WIDGETS: live-coach + AI-engineer text/graph overlays ─────────────
  coachTips: CoachTipsWidget,
  coachFindings: CoachFindingsWidget,
  coachSectorGraph: CoachSectorGraphWidget,
  engineerFeed: EngineerFeedWidget,
  // ─── B-widgets: overlays for the new iRacing telemetry signals ─────────────
  engineTellTales: EngineTellTalesWidget,
  absCut: AbsCutGaugeWidget,
  sessionBanner: SessionStateBannerWidget,
  paceRestart: PaceRestartWidget,
  sideProximity: SideProximityWidget,
  // ─── T4: GT3 instrument-style cluster widgets (brand-neutral) ──────────────
  analogTach: AnalogTachWidget,
  cupCluster: CupClusterWidget,
  enduranceMulti: EnduranceMultiWidget,
  oledStrip: OledStripWidget,
  motecDense: MotecDenseWidget,
  gt3Wheel: Gt3WheelWidget
}

export function resolveWidgetComponent(id: OverlayWidgetId): ((props: WidgetProps) => ReactElement) | undefined {
  return id.startsWith('hifi:') ? HifiWidgetHost : WIDGET_COMPONENTS[id as LegacyOverlayWidgetId]
}

export { HifiWidgetHost }
