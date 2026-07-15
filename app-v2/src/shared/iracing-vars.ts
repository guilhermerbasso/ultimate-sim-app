import type { ExpressionScope, ExpressionValue } from './expr'
import type { TelemetrySnapshot } from './telemetry'

export type IracingVarCategory =
  | 'car'
  | 'session'
  | 'timing'
  | 'fuel'
  | 'tyres'
  | 'inputs'
  | 'weather'
  | 'flags'
  | 'standings'
  | 'pit'
  | 'controls'
  | 'damage'

export interface IracingVarDef {
  id: string
  label: string
  unit?: string
  category: IracingVarCategory
  telemetryField?: string
}

export const IRACING_VAR_CATEGORY_LABELS: Record<IracingVarCategory, string> = {
  car: 'Car',
  session: 'Session',
  timing: 'Timing',
  fuel: 'Fuel',
  tyres: 'Tires and brakes',
  inputs: 'Inputs',
  weather: 'Weather and track',
  flags: 'Flags',
  standings: 'Qualifying',
  pit: 'Pit stop',
  controls: 'Controls and electronics',
  damage: 'Damage and incidents'
}

export const IRACING_VAR_CATEGORY_ORDER: IracingVarCategory[] = [
  'car',
  'inputs',
  'timing',
  'session',
  'standings',
  'fuel',
  'tyres',
  'weather',
  'flags',
  'pit',
  'controls',
  'damage'
]

export const IRACING_VARIABLES: IracingVarDef[] = [
  { id: 'Speed', label: 'Speed', unit: 'km/h', category: 'car', telemetryField: 'speedKmh' },
  { id: 'RPM', label: 'Engine RPM', unit: 'rpm', category: 'car', telemetryField: 'rpm' },
  { id: 'Gear', label: 'Gear', category: 'car', telemetryField: 'gear' },
  { id: 'DriverCarSLShiftRPM', label: 'Shift light RPM', unit: 'rpm', category: 'car', telemetryField: 'maxRpm' },
  { id: 'PlayerCarSLShiftRPM', label: 'Optimal upshift RPM', unit: 'rpm', category: 'car', telemetryField: 'shiftRpm' },
  { id: 'ShiftIndicatorPct', label: 'Shift indicator', unit: '%', category: 'car', telemetryField: 'shiftIndicatorPct' },
  { id: 'EngineWarnings', label: 'Engine warnings', category: 'car' },
  { id: 'OilPressure', label: 'Oil pressure', unit: 'kPa', category: 'car', telemetryField: 'oilPressureKpa' },
  { id: 'OilTemp', label: 'Oil temperature', unit: '°C', category: 'car' },
  { id: 'WaterTemp', label: 'Water temperature', unit: '°C', category: 'car' },
  { id: 'WaterLevel', label: 'Water level', unit: 'L', category: 'car', telemetryField: 'waterLevelL' },
  { id: 'Voltage', label: 'Voltage', unit: 'V', category: 'car', telemetryField: 'voltage' },
  { id: 'ManifoldPress', label: 'Manifold pressure', unit: 'bar', category: 'car', telemetryField: 'manifoldPressBar' },
  { id: 'Engine0_RPM', label: 'Engine 0 RPM', unit: 'rpm', category: 'car', telemetryField: 'rpm' },
  { id: 'VelocityX', label: 'Longitudinal velocity', unit: 'm/s', category: 'car' },
  { id: 'VelocityY', label: 'Lateral velocity', unit: 'm/s', category: 'car' },
  { id: 'VelocityZ', label: 'Vertical velocity', unit: 'm/s', category: 'car' },
  { id: 'Yaw', label: 'Yaw', unit: 'rad', category: 'car', telemetryField: 'yawRad' },
  { id: 'YawRate', label: 'Yaw rate', unit: 'rad/s', category: 'car' },
  { id: 'Pitch', label: 'Pitch', unit: 'rad', category: 'car', telemetryField: 'pitchRad' },
  { id: 'PitchRate', label: 'Pitch rate', unit: 'rad/s', category: 'car', telemetryField: 'pitchRateRadSec' },
  { id: 'Roll', label: 'Roll', unit: 'rad', category: 'car', telemetryField: 'rollRad' },
  { id: 'RollRate', label: 'Roll rate', unit: 'rad/s', category: 'car', telemetryField: 'rollRateRadSec' },
  { id: 'LatAccel', label: 'Lateral acceleration', unit: 'm/s²', category: 'car' },
  { id: 'LongAccel', label: 'Longitudinal acceleration', unit: 'm/s²', category: 'car' },
  { id: 'VertAccel', label: 'Vertical acceleration', unit: 'm/s²', category: 'car' },
  { id: 'EnergyERSBatteryPct', label: 'ERS/hybrid battery', unit: '%', category: 'car', telemetryField: 'ersBatteryPct' },
  { id: 'PlayerCarWeightPenalty', label: 'Weight penalty (BoP)', unit: 'kg', category: 'car', telemetryField: 'weightPenaltyKg' },
  { id: 'PlayerCarPowerAdjust', label: 'Power adjustment (BoP)', unit: '%', category: 'car', telemetryField: 'powerAdjustPct' },

  { id: 'Throttle', label: 'Throttle', unit: '%', category: 'inputs', telemetryField: 'throttle' },
  { id: 'Brake', label: 'Brake', unit: '%', category: 'inputs', telemetryField: 'brake' },
  { id: 'Clutch', label: 'Clutch', unit: '%', category: 'inputs', telemetryField: 'clutch' },
  { id: 'SteeringWheelAngle', label: 'Steering angle', unit: '°', category: 'inputs', telemetryField: 'steerAngleDeg' },
  { id: 'SteeringWheelAngleMax', label: 'Max steering wheel angle', unit: '?', category: 'inputs', telemetryField: 'steeringAngleMaxDeg' },
  { id: 'SteeringWheelPctTorque', label: 'Torque FFB', unit: '%', category: 'inputs', telemetryField: 'steeringTorquePct' },
  { id: 'HandbrakeRaw', label: 'Raw handbrake', unit: '%', category: 'inputs' },
  { id: 'BrakeRaw', label: 'Raw brake', unit: '%', category: 'inputs', telemetryField: 'brake' },
  { id: 'ThrottleRaw', label: 'Raw throttle', unit: '%', category: 'inputs', telemetryField: 'throttle' },
  { id: 'ClutchRaw', label: 'Raw clutch', unit: '%', category: 'inputs', telemetryField: 'clutch' },

  { id: 'Lap', label: 'Current lap', category: 'timing', telemetryField: 'currentLap' },
  { id: 'LapCompleted', label: 'Completed laps', category: 'timing' },
  { id: 'LapDist', label: 'Lap distance', unit: 'm', category: 'timing' },
  { id: 'LapDistPct', label: 'Lap progress', unit: '%', category: 'timing', telemetryField: 'lapDistPct' },
  { id: 'LapCurrentLapTime', label: 'Current lap time', unit: 's', category: 'timing', telemetryField: 'currentLapTimeSec' },
  { id: 'LapLastLapTime', label: 'Last lap', unit: 's', category: 'timing', telemetryField: 'lastLapTimeSec' },
  { id: 'LapBestLapTime', label: 'Best lap', unit: 's', category: 'timing', telemetryField: 'bestLapTimeSec' },
  { id: 'LapBestNLapLap', label: 'Best N-lap lap', category: 'timing' },
  { id: 'LapBestNLapTime', label: 'Best N-lap time', unit: 's', category: 'timing' },
  { id: 'LapDeltaToBestLap', label: 'Delta to best lap', unit: 's', category: 'timing', telemetryField: 'deltaToBestSec' },
  { id: 'LapDeltaToBestLap_DD', label: 'Delta to best lap (display)', unit: 's', category: 'timing', telemetryField: 'deltaToBestSec' },
  { id: 'LapDeltaToSessionBestLap', label: 'Delta to session best', unit: 's', category: 'timing', telemetryField: 'deltaToSessionBestSec' },
  { id: 'LapDeltaToOptimalLap', label: 'Delta to optimal lap', unit: 's', category: 'timing', telemetryField: 'deltaToOptimalSec' },
  { id: 'LapDeltaToSessionOptimalLap', label: 'Delta to session optimal', unit: 's', category: 'timing', telemetryField: 'deltaToSessionOptimalSec' },
  { id: 'LapDeltaToDriverBestLap', label: 'Delta to driver best', unit: 's', category: 'timing', telemetryField: 'deltaToDriverBestSec' },
  { id: 'LapDeltaToBestLap_OK', label: 'Best delta valid', category: 'timing' },
  { id: 'LapDeltaToBestLap_SessionTime', label: 'Best delta session time', unit: 's', category: 'timing' },
  { id: 'EstimatedLapTime', label: 'Estimated lap', unit: 's', category: 'timing', telemetryField: 'estimatedLapTimeSec' },

  { id: 'SessionNum', label: 'Session number', category: 'session' },
  { id: 'SessionState', label: 'Session state', category: 'session', telemetryField: 'sessionState' },
  { id: 'SessionTime', label: 'Session time', unit: 's', category: 'session' },
  { id: 'SessionTimeOfDay', label: 'Time of day', unit: 's', category: 'session', telemetryField: 'sessionTimeOfDay' },
  { id: 'SessionTimeRemain', label: 'Time remaining', unit: 's', category: 'session', telemetryField: 'sessionTimeRemainingSec' },
  { id: 'SessionLapsRemain', label: 'Laps remaining', category: 'session', telemetryField: 'lapsRemaining' },
  { id: 'SessionLapsRemainEx', label: 'Exact laps remaining', category: 'session', telemetryField: 'lapsRemaining' },
  { id: 'SessionTick', label: 'Session tick', category: 'session' },
  { id: 'SessionUniqueID', label: 'Unique session ID', category: 'session' },
  { id: 'SessionType', label: 'Session type', category: 'session', telemetryField: 'sessionType' },
  { id: 'PaceMode', label: 'Pace mode', category: 'session', telemetryField: 'paceMode' },
  { id: 'TrackName', label: 'Track', category: 'session', telemetryField: 'trackName' },
  { id: 'CarName', label: 'Car', category: 'session', telemetryField: 'carName' },
  { id: 'PlayerCarIdx', label: 'Player car index', category: 'session', telemetryField: 'playerCarIdx' },
  { id: 'CamCarIdx', label: 'Camera car index', category: 'session' },
  { id: 'IsOnTrack', label: 'On track', category: 'session', telemetryField: 'connected' },
  { id: 'IsOnTrackCar', label: 'Car on track', category: 'session', telemetryField: 'connected' },
  { id: 'IsReplayPlaying', label: 'Replay playing', category: 'session' },
  { id: 'ReplayFrameNum', label: 'Replay frame', category: 'session' },
  { id: 'ReplayFrameNumEnd', label: 'Replay final frame', category: 'session' },

  { id: 'PlayerCarPosition', label: 'Overall position', category: 'standings', telemetryField: 'position' },
  { id: 'PlayerCarClassPosition', label: 'Class position', category: 'standings', telemetryField: 'classPosition' },
  { id: 'CarIdxPosition', label: 'Position by car', category: 'standings' },
  { id: 'CarIdxClassPosition', label: 'Class position by car', category: 'standings' },
  { id: 'CarIdxLap', label: 'Lap by car', category: 'standings' },
  { id: 'CarIdxLapCompleted', label: 'Completed laps by car', category: 'standings' },
  { id: 'CarIdxLapDistPct', label: 'Progress by car', unit: '%', category: 'standings' },
  { id: 'CarIdxEstTime', label: 'Estimated time by car', unit: 's', category: 'standings' },
  { id: 'CarIdxF2Time', label: 'F2 relative time', unit: 's', category: 'standings' },
  { id: 'CarIdxGear', label: 'Gear by car', category: 'standings' },
  { id: 'CarIdxRPM', label: 'RPM by car', unit: 'rpm', category: 'standings' },
  { id: 'CarIdxOnPitRoad', label: 'Car on pit road', category: 'standings' },
  { id: 'CarIdxTrackSurface', label: 'Surface by car', category: 'standings' },
  { id: 'CarIdxTrackSurfaceMaterial', label: 'Surface material by car', category: 'standings' },
  { id: 'TotalCars', label: 'Total cars', category: 'standings', telemetryField: 'totalCars' },
  { id: 'StrengthOfField', label: 'Strength of field', category: 'standings', telemetryField: 'strengthOfField' },
  { id: 'CarLeftRightCount', label: 'Cars alongside (1/2)', category: 'standings', telemetryField: 'carLeftRightCount' },

  { id: 'FuelLevel', label: 'Fuel in tank', unit: 'L', category: 'fuel', telemetryField: 'fuelLiters' },
  { id: 'FuelLevelPct', label: 'Fuel in tank', unit: '%', category: 'fuel', telemetryField: 'fuelLevelPct' },
  { id: 'FuelUsePerHour', label: 'Consumption per hour', unit: 'L/h', category: 'fuel' },
  { id: 'FuelUsePerLap', label: 'Consumption per lap', unit: 'L/lap', category: 'fuel', telemetryField: 'fuelPerLap' },
  { id: 'DriverCarFuelMaxLtr', label: 'Tank capacity', unit: 'L', category: 'fuel', telemetryField: 'fuelCapacityLiters' },
  { id: 'FuelPress', label: 'Fuel pressure', unit: 'bar', category: 'fuel', telemetryField: 'fuelPressBar' },

  { id: 'LFtempCL', label: 'LF tire inner temp', unit: '?C', category: 'tyres', telemetryField: 'tyres.lf.tempC' },
  { id: 'LFtempCM', label: 'LF tire center temp', unit: '?C', category: 'tyres', telemetryField: 'tyres.lf.tempC' },
  { id: 'LFtempCR', label: 'LF tire outer temp', unit: '?C', category: 'tyres', telemetryField: 'tyres.lf.tempC' },
  { id: 'RFtempCL', label: 'RF tire inner temp', unit: '?C', category: 'tyres', telemetryField: 'tyres.rf.tempC' },
  { id: 'RFtempCM', label: 'RF tire center temp', unit: '?C', category: 'tyres', telemetryField: 'tyres.rf.tempC' },
  { id: 'RFtempCR', label: 'RF tire outer temp', unit: '?C', category: 'tyres', telemetryField: 'tyres.rf.tempC' },
  { id: 'LRtempCL', label: 'LR tire inner temp', unit: '?C', category: 'tyres', telemetryField: 'tyres.lr.tempC' },
  { id: 'LRtempCM', label: 'LR tire center temp', unit: '?C', category: 'tyres', telemetryField: 'tyres.lr.tempC' },
  { id: 'LRtempCR', label: 'LR tire outer temp', unit: '?C', category: 'tyres', telemetryField: 'tyres.lr.tempC' },
  { id: 'RRtempCL', label: 'RR tire inner temp', unit: '?C', category: 'tyres', telemetryField: 'tyres.rr.tempC' },
  { id: 'RRtempCM', label: 'RR tire center temp', unit: '?C', category: 'tyres', telemetryField: 'tyres.rr.tempC' },
  { id: 'RRtempCR', label: 'RR tire outer temp', unit: '?C', category: 'tyres', telemetryField: 'tyres.rr.tempC' },
  { id: 'LFcoldPressure', label: 'LF cold pressure', unit: 'kPa', category: 'tyres', telemetryField: 'tireColdPressuresKpa.lf' },
  { id: 'RFcoldPressure', label: 'RF cold pressure', unit: 'kPa', category: 'tyres', telemetryField: 'tireColdPressuresKpa.rf' },
  { id: 'LRcoldPressure', label: 'LR cold pressure', unit: 'kPa', category: 'tyres', telemetryField: 'tireColdPressuresKpa.lr' },
  { id: 'RRcoldPressure', label: 'RR cold pressure', unit: 'kPa', category: 'tyres', telemetryField: 'tireColdPressuresKpa.rr' },
  { id: 'LFpressure', label: 'LF tire pressure', unit: 'kPa', category: 'tyres', telemetryField: 'tyres.lf.pressureKpa' },
  { id: 'RFpressure', label: 'RF tire pressure', unit: 'kPa', category: 'tyres', telemetryField: 'tyres.rf.pressureKpa' },
  { id: 'LRpressure', label: 'LR tire pressure', unit: 'kPa', category: 'tyres', telemetryField: 'tyres.lr.pressureKpa' },
  { id: 'RRpressure', label: 'RR tire pressure', unit: 'kPa', category: 'tyres', telemetryField: 'tyres.rr.pressureKpa' },
  { id: 'LFwearL', label: 'LF tire inner wear', unit: '%', category: 'tyres', telemetryField: 'tyres.lf.wearPct' },
  { id: 'LFwearM', label: 'LF tire center wear', unit: '%', category: 'tyres', telemetryField: 'tyres.lf.wearPct' },
  { id: 'LFwearR', label: 'LF tire outer wear', unit: '%', category: 'tyres', telemetryField: 'tyres.lf.wearPct' },
  { id: 'RFwearL', label: 'RF tire inner wear', unit: '%', category: 'tyres', telemetryField: 'tyres.rf.wearPct' },
  { id: 'RFwearM', label: 'RF tire center wear', unit: '%', category: 'tyres', telemetryField: 'tyres.rf.wearPct' },
  { id: 'RFwearR', label: 'RF tire outer wear', unit: '%', category: 'tyres', telemetryField: 'tyres.rf.wearPct' },
  { id: 'LRwearL', label: 'LR tire inner wear', unit: '%', category: 'tyres', telemetryField: 'tyres.lr.wearPct' },
  { id: 'LRwearM', label: 'LR tire center wear', unit: '%', category: 'tyres', telemetryField: 'tyres.lr.wearPct' },
  { id: 'LRwearR', label: 'LR tire outer wear', unit: '%', category: 'tyres', telemetryField: 'tyres.lr.wearPct' },
  { id: 'RRwearL', label: 'RR tire inner wear', unit: '%', category: 'tyres', telemetryField: 'tyres.rr.wearPct' },
  { id: 'RRwearM', label: 'RR tire center wear', unit: '%', category: 'tyres', telemetryField: 'tyres.rr.wearPct' },
  { id: 'RRwearR', label: 'RR tire outer wear', unit: '%', category: 'tyres', telemetryField: 'tyres.rr.wearPct' },
  { id: 'LFbrakeLinePress', label: 'LF brake pressure', unit: 'bar', category: 'tyres', telemetryField: 'brakeLinePressBar.lf' },
  { id: 'RFbrakeLinePress', label: 'RF brake pressure', unit: 'bar', category: 'tyres', telemetryField: 'brakeLinePressBar.rf' },
  { id: 'LRbrakeLinePress', label: 'LR brake pressure', unit: 'bar', category: 'tyres', telemetryField: 'brakeLinePressBar.lr' },
  { id: 'RRbrakeLinePress', label: 'RR brake pressure', unit: 'bar', category: 'tyres', telemetryField: 'brakeLinePressBar.rr' },
  { id: 'LFbrakeTemp', label: 'LF brake temp', unit: '?C', category: 'tyres', telemetryField: 'brakeTempC.lf' },
  { id: 'RFbrakeTemp', label: 'RF brake temp', unit: '?C', category: 'tyres', telemetryField: 'brakeTempC.rf' },
  { id: 'LRbrakeTemp', label: 'LR brake temp', unit: '?C', category: 'tyres', telemetryField: 'brakeTempC.lr' },
  { id: 'RRbrakeTemp', label: 'RR brake temp', unit: '?C', category: 'tyres', telemetryField: 'brakeTempC.rr' },

  { id: 'AirTemp', label: 'Air temperature', unit: '?C', category: 'weather', telemetryField: 'airTempC' },
  { id: 'TrackTemp', label: 'Track temperature', unit: '?C', category: 'weather', telemetryField: 'trackTempC' },
  { id: 'TrackTempCrew', label: 'Track temperature (crew)', unit: '?C', category: 'weather', telemetryField: 'trackTempC' },
  { id: 'TrackWetness', label: 'Track wetness', unit: '%', category: 'weather', telemetryField: 'trackWetnessPct' },
  { id: 'Precipitation', label: 'Precipitation', unit: '%', category: 'weather', telemetryField: 'isRaining' },
  { id: 'RainIntensity', label: 'Rain intensity', unit: '%', category: 'weather', telemetryField: 'isRaining' },
  { id: 'FogLevel', label: 'Fog', unit: '%', category: 'weather', telemetryField: 'fogPct' },
  { id: 'Skies', label: 'Sky condition', category: 'weather', telemetryField: 'skies' },
  { id: 'RelativeHumidity', label: 'Relative humidity', unit: '%', category: 'weather', telemetryField: 'humidityPct' },
  { id: 'WindDir', label: 'Wind direction', unit: '?', category: 'weather', telemetryField: 'windDirRad' },
  { id: 'WindVel', label: 'Wind speed', unit: 'm/s', category: 'weather', telemetryField: 'windSpeedMs' },
  { id: 'SolarAltitude', label: 'Solar altitude', unit: '?', category: 'weather', telemetryField: 'solarAltitudeRad' },
  { id: 'SolarAzimuth', label: 'Solar azimuth', unit: '?', category: 'weather', telemetryField: 'solarAzimuthRad' },
  { id: 'TrackGripStatus', label: 'Track grip', unit: '%', category: 'weather', telemetryField: 'gripPct' },
  { id: 'WeatherDeclaredWet', label: 'Declared wet track', category: 'weather', telemetryField: 'weatherDeclaredWet' },
  { id: 'PlayerTrackSurfaceMaterial', label: 'Surface material', category: 'weather', telemetryField: 'trackSurfaceMaterial' },

  { id: 'SessionFlags', label: 'Session flags', category: 'flags' },
  { id: 'FlagGreen', label: 'Green flag', category: 'flags', telemetryField: 'flags.green' },
  { id: 'FlagYellow', label: 'Yellow flag', category: 'flags', telemetryField: 'flags.yellow' },
  { id: 'FlagBlue', label: 'Blue flag', category: 'flags', telemetryField: 'flags.blue' },
  { id: 'FlagWhite', label: 'White flag', category: 'flags', telemetryField: 'flags.white' },
  { id: 'FlagCheckered', label: 'Checkered flag', category: 'flags', telemetryField: 'flags.checkered' },
  { id: 'FlagRed', label: 'Red flag', category: 'flags', telemetryField: 'flags.red' },
  { id: 'FlagBlack', label: 'Black flag', category: 'flags', telemetryField: 'flags.black' },
  { id: 'FlagMeatball', label: 'Black/orange flag', category: 'flags', telemetryField: 'flags.meatball' },
  { id: 'FlagRepair', label: 'Required repair', category: 'flags', telemetryField: 'flags.repair' },
  { id: 'FlagDisqualify', label: 'Disqualification', category: 'flags', telemetryField: 'flags.disqualify' },
  { id: 'FlagGreenWhiteCheckered', label: 'Green-white-checkered', category: 'flags', telemetryField: 'flags.greenWhiteCheckered' },

  { id: 'OnPitRoad', label: 'On pit road', category: 'pit', telemetryField: 'onPitRoad' },
  { id: 'PitSpeedLimiter', label: 'Pit limiter', category: 'pit', telemetryField: 'pitLimiter' },
  { id: 'PitSvFlags', label: 'Selected services', category: 'pit' },
  { id: 'PitSvLFP', label: 'Pit LF pressure', unit: 'kPa', category: 'pit' },
  { id: 'PitSvRFP', label: 'Pit RF pressure', unit: 'kPa', category: 'pit' },
  { id: 'PitSvLRP', label: 'Pit LR pressure', unit: 'kPa', category: 'pit' },
  { id: 'PitSvRRP', label: 'Pit RR pressure', unit: 'kPa', category: 'pit' },
  { id: 'PitSvFuel', label: 'Fuel to add', unit: 'L', category: 'pit' },
  { id: 'PitRepairLeft', label: 'Repair remaining', unit: 's', category: 'pit' },
  { id: 'PitOptRepairLeft', label: 'Optional repair remaining', unit: 's', category: 'pit' },
  { id: 'PitstopActive', label: 'Pit stop active', category: 'pit' },
  { id: 'PitsOpen', label: 'Pits open', category: 'pit', telemetryField: 'pit.pitsOpen' },
  { id: 'PlayerCarInPitStall', label: 'In pit stall', category: 'pit', telemetryField: 'pit.inPitStall' },
  { id: 'PlayerCarPitSvStatus', label: 'Pit service status', category: 'pit', telemetryField: 'pit.svStatus' },

  { id: 'dcBrakeBias', label: 'Brake bias', unit: '%', category: 'controls' },
  { id: 'dcTractionControl', label: 'Traction control', category: 'controls' },
  { id: 'dcABS', label: 'ABS', category: 'controls' },
  { id: 'dcThrottleShape', label: 'Throttle map', category: 'controls' },
  { id: 'dcFuelMixture', label: 'Fuel mixture', category: 'controls' },
  { id: 'dcEngineBraking', label: 'Engine braking', category: 'controls' },
  { id: 'dcAntiRollFront', label: 'Front anti-roll bar', category: 'controls' },
  { id: 'dcAntiRollRear', label: 'Rear anti-roll bar', category: 'controls' },
  { id: 'dcWeightJackerRight', label: 'Right weight jacker', category: 'controls' },
  // Compatibility contract: existing saved expressions expect DRS_Status to stay boolean.
  { id: 'DRS_Status', label: 'DRS active', category: 'controls', telemetryField: 'drs' },
  { id: 'DRS_State', label: 'DRS state (0–3)', category: 'controls', telemetryField: 'drsState' },
  // The real iRacing raw var for "ABS intervening" is `BrakeABSactive` (lower-case `active`).
  // The old `ABSActive` id was a PHANTOM (iRacing publishes no such var) — corrected here.
  { id: 'BrakeABSactive', label: 'ABS active', category: 'controls', telemetryField: 'absActive' },
  { id: 'BrakeABSCutPct', label: 'ABS brake cut', unit: '%', category: 'controls', telemetryField: 'absCutPct' },
  // iRacing exposes NO native TC-active var (SimHub derives it). Per product decision,
  // `tcActive` is DERIVED via deriveTcActive (TC_ACTIVE_DERIVED default ON), NOT a raw
  // telemetry channel. Kept for expressions and clearly annotated as derived.
  { id: 'tcActiveDerived', label: 'TC active (derived)', category: 'controls', telemetryField: 'tcActive' },
  { id: 'PushToPass', label: 'Push-to-pass', category: 'controls', telemetryField: 'pushToPass' },
  { id: 'P2P_Count', label: 'Push-to-pass remaining', category: 'controls', telemetryField: 'pushToPassCount' },

  { id: 'PlayerCarTeamIncidentCount', label: 'Team incidents', category: 'damage', telemetryField: 'incidentCount' },
  { id: 'PlayerCarMyIncidentCount', label: 'My incidents', category: 'damage', telemetryField: 'incidentCount' },
  { id: 'PlayerCarDriverIncidentCount', label: 'Driver incidents', category: 'damage', telemetryField: 'incidentCount' },
  { id: 'PlayerCarMaxIncidentCount', label: 'Incident limit', category: 'damage', telemetryField: 'incidentLimit' },
  { id: 'FastRepairUsed', label: 'Fast repairs used', category: 'damage', telemetryField: 'fastRepairsUsed' },
  { id: 'FastRepairAvailable', label: 'Fast repairs available', category: 'damage', telemetryField: 'fastRepairsAvailable' },
  { id: 'RepairRequired', label: 'Required repair', category: 'damage', telemetryField: 'flags.repair' }
]

export function buildIracingExpressionScope(snapshot: TelemetrySnapshot | null | undefined, enabledIds: readonly string[]): ExpressionScope {
  const scope: ExpressionScope = {}
  const enabled = new Set(enabledIds)

  for (const variable of IRACING_VARIABLES) {
    if (!enabled.has(variable.id) || !variable.telemetryField) continue
    scope[variable.id] = getSnapshotValue(snapshot, variable.telemetryField)
  }

  return scope
}

export function getIracingTelemetryValue(snapshot: TelemetrySnapshot | null | undefined, variable: IracingVarDef): ExpressionValue | undefined {
  return variable.telemetryField ? getSnapshotValue(snapshot, variable.telemetryField) : undefined
}

function getSnapshotValue(snapshot: TelemetrySnapshot | null | undefined, path: string): ExpressionValue | undefined {
  if (!snapshot) return undefined
  let current: unknown = snapshot

  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }

  if (current === undefined || current === null || typeof current === 'number' || typeof current === 'boolean' || typeof current === 'string') {
    return current as ExpressionValue | undefined
  }
  return undefined
}
