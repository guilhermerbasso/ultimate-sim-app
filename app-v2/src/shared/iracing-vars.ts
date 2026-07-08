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
  tyres: 'Tires e brakes',
  inputs: 'Inputs',
  weather: 'Clima e pista',
  flags: 'Bandeiras',
  standings: 'Qualifying',
  pit: 'Pit stop',
  controls: 'Controls e eletrônica',
  damage: 'Danos e incidentes'
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
  { id: 'Speed', label: 'Velocidade', unit: 'km/h', category: 'car', telemetryField: 'speedKmh' },
  { id: 'RPM', label: 'Engine RPM', unit: 'rpm', category: 'car', telemetryField: 'rpm' },
  { id: 'Gear', label: 'Gear', category: 'car', telemetryField: 'gear' },
  { id: 'DriverCarSLShiftRPM', label: 'RPM de shift light', unit: 'rpm', category: 'car', telemetryField: 'maxRpm' },
  { id: 'PlayerCarSLShiftRPM', label: 'RPM de upshift optimal', unit: 'rpm', category: 'car', telemetryField: 'shiftRpm' },
  { id: 'ShiftIndicatorPct', label: 'Indicador de troca', unit: '%', category: 'car', telemetryField: 'shiftIndicatorPct' },
  { id: 'EngineWarnings', label: 'Alertas do motor', category: 'car' },
  { id: 'OilPressure', label: 'Oil pressure', unit: 'bar', category: 'car' },
  { id: 'OilTemp', label: 'Oil temperature', unit: '°C', category: 'car' },
  { id: 'WaterTemp', label: 'Water temperature', unit: '°C', category: 'car' },
  { id: 'WaterLevel', label: 'Level da água', unit: 'L', category: 'car' },
  { id: 'Lapge', label: 'Lapgem', unit: 'V', category: 'car' },
  { id: 'ManifoldPress', label: 'Manifold pressure', unit: 'bar', category: 'car' },
  { id: 'Engine0_RPM', label: 'RPM motor 0', unit: 'rpm', category: 'car', telemetryField: 'rpm' },
  { id: 'VelocityX', label: 'Velocidade longitudinal', unit: 'm/s', category: 'car' },
  { id: 'VelocityY', label: 'Velocidade lateral', unit: 'm/s', category: 'car' },
  { id: 'VelocityZ', label: 'Velocidade vertical', unit: 'm/s', category: 'car' },
  { id: 'Yaw', label: 'Yaw', unit: 'rad', category: 'car' },
  { id: 'YawRate', label: 'Taxa de yaw', unit: 'rad/s', category: 'car' },
  { id: 'Pitch', label: 'Pitch', unit: 'rad', category: 'car' },
  { id: 'PitchRate', label: 'Taxa de pitch', unit: 'rad/s', category: 'car' },
  { id: 'Roll', label: 'Roll', unit: 'rad', category: 'car' },
  { id: 'RollRate', label: 'Taxa de roll', unit: 'rad/s', category: 'car' },
  { id: 'LatAccel', label: 'Lateral acceleration', unit: 'm/s²', category: 'car' },
  { id: 'LongAccel', label: 'Longitudinal acceleration', unit: 'm/s²', category: 'car' },
  { id: 'VertAccel', label: 'Vertical acceleration', unit: 'm/s²', category: 'car' },
  { id: 'EnergyERSBatteryPct', label: 'ERS/hybrid battery', unit: '%', category: 'car', telemetryField: 'ersBatteryPct' },
  { id: 'PlayerCarWeightPenalty', label: 'Penalidade de peso (BoP)', unit: 'kg', category: 'car', telemetryField: 'weightPenaltyKg' },
  { id: 'PlayerCarPowerAdjust', label: 'Power adjustment (BoP)', unit: '%', category: 'car', telemetryField: 'powerAdjustPct' },

  { id: 'Throttle', label: 'Acelerador', unit: '%', category: 'inputs', telemetryField: 'throttle' },
  { id: 'Brake', label: 'Brake', unit: '%', category: 'inputs', telemetryField: 'brake' },
  { id: 'Clutch', label: 'Embreagem', unit: '%', category: 'inputs', telemetryField: 'clutch' },
  { id: 'SteeringWheelAngle', label: 'Steering angle', unit: '°', category: 'inputs', telemetryField: 'steerAngleDeg' },
  { id: 'SteeringWheelAngleMax', label: 'Ângulo máximo do steering', unit: '°', category: 'inputs' },
  { id: 'SteeringWheelPctTorque', label: 'Torque FFB', unit: '%', category: 'inputs' },
  { id: 'HandbrakeRaw', label: 'Brake de hand bruto', unit: '%', category: 'inputs' },
  { id: 'BrakeRaw', label: 'Brake bruto', unit: '%', category: 'inputs', telemetryField: 'brake' },
  { id: 'ThrottleRaw', label: 'Acelerador bruto', unit: '%', category: 'inputs', telemetryField: 'throttle' },
  { id: 'ClutchRaw', label: 'Embreagem bruta', unit: '%', category: 'inputs', telemetryField: 'clutch' },

  { id: 'Lap', label: 'Lap atual', category: 'timing', telemetryField: 'currentLap' },
  { id: 'LapCompleted', label: 'Laps completas', category: 'timing' },
  { id: 'LapDist', label: 'Lap distance', unit: 'm', category: 'timing' },
  { id: 'LapDistPct', label: 'Progresso da lap', unit: '%', category: 'timing', telemetryField: 'lapDistPct' },
  { id: 'LapCurrentLapTime', label: 'Tempo da lap atual', unit: 's', category: 'timing', telemetryField: 'currentLapTimeSec' },
  { id: 'LapLastLapTime', label: 'Last lap', unit: 's', category: 'timing', telemetryField: 'lastLapTimeSec' },
  { id: 'LapBestLapTime', label: 'Best lap', unit: 's', category: 'timing', telemetryField: 'bestLapTimeSec' },
  { id: 'LapBestNLapLap', label: 'Lap do melhor N-lap', category: 'timing' },
  { id: 'LapBestNLapTime', label: 'Tempo do melhor N-lap', unit: 's', category: 'timing' },
  { id: 'LapDeltaToBestLap', label: 'Delta para melhor lap', unit: 's', category: 'timing', telemetryField: 'deltaToBestSec' },
  { id: 'LapDeltaToBestLap_DD', label: 'Delta para melhor lap (display)', unit: 's', category: 'timing', telemetryField: 'deltaToBestSec' },
  { id: 'LapDeltaToSessionBestLap', label: 'Delta para melhor da sessão', unit: 's', category: 'timing', telemetryField: 'deltaToSessionBestSec' },
  { id: 'LapDeltaToOptimalLap', label: 'Delta para lap ótima', unit: 's', category: 'timing' },
  { id: 'LapDeltaToSessionOptimalLap', label: 'Delta para ótima da sessão', unit: 's', category: 'timing' },
  { id: 'LapDeltaToDriverBestLap', label: 'Delta para melhor do piloto', unit: 's', category: 'timing' },
  { id: 'LapDeltaToBestLap_OK', label: 'Delta melhor válido', category: 'timing' },
  { id: 'LapDeltaToBestLap_SessionTime', label: 'Tempo sessão do delta melhor', unit: 's', category: 'timing' },
  { id: 'EstimatedLapTime', label: 'Lap estimada', unit: 's', category: 'timing', telemetryField: 'estimatedLapTimeSec' },

  { id: 'SessionNum', label: 'Número da sessão', category: 'session' },
  { id: 'SessionState', label: 'Estado da sessão', category: 'session', telemetryField: 'sessionState' },
  { id: 'SessionTime', label: 'Tempo da sessão', unit: 's', category: 'session' },
  { id: 'SessionTimeOfDay', label: 'Hora do dia', unit: 's', category: 'session', telemetryField: 'sessionTimeOfDay' },
  { id: 'SessionTimeRemain', label: 'Tempo restante', unit: 's', category: 'session', telemetryField: 'sessionTimeRemainingSec' },
  { id: 'SessionLapsRemain', label: 'Laps restantes', category: 'session', telemetryField: 'lapsRemaining' },
  { id: 'SessionLapsRemainEx', label: 'Laps restantes exatas', category: 'session', telemetryField: 'lapsRemaining' },
  { id: 'SessionTick', label: 'Tick da sessão', category: 'session' },
  { id: 'SessionUniqueID', label: 'ID único da sessão', category: 'session' },
  { id: 'SessionType', label: 'Tipo de sessão', category: 'session', telemetryField: 'sessionType' },
  { id: 'PaceMode', label: 'Modo de pace', category: 'session', telemetryField: 'paceMode' },
  { id: 'TrackName', label: 'Pista', category: 'session', telemetryField: 'trackName' },
  { id: 'CarName', label: 'Car', category: 'session', telemetryField: 'carName' },
  { id: 'PlayerCarIdx', label: 'Índice do carro do jogador', category: 'session', telemetryField: 'playerCarIdx' },
  { id: 'CamCarIdx', label: 'Índice do carro na câmera', category: 'session' },
  { id: 'IsOnTrack', label: 'Na pista', category: 'session', telemetryField: 'connected' },
  { id: 'IsOnTrackCar', label: 'Car na pista', category: 'session', telemetryField: 'connected' },
  { id: 'IsReplayPlaying', label: 'Replay rodando', category: 'session' },
  { id: 'ReplayFrameNum', label: 'Frame do replay', category: 'session' },
  { id: 'ReplayFrameNumEnd', label: 'Frame final do replay', category: 'session' },

  { id: 'PlayerCarPosition', label: 'Position geral', category: 'standings', telemetryField: 'position' },
  { id: 'PlayerCarClassPosition', label: 'Position na classe', category: 'standings', telemetryField: 'classPosition' },
  { id: 'CarIdxPosition', label: 'Position por carro', category: 'standings' },
  { id: 'CarIdxClassPosition', label: 'Position na classe por carro', category: 'standings' },
  { id: 'CarIdxLap', label: 'Lap por carro', category: 'standings' },
  { id: 'CarIdxLapCompleted', label: 'Laps completas por carro', category: 'standings' },
  { id: 'CarIdxLapDistPct', label: 'Progresso por carro', unit: '%', category: 'standings' },
  { id: 'CarIdxEstTime', label: 'Tempo estimado por carro', unit: 's', category: 'standings' },
  { id: 'CarIdxF2Time', label: 'Tempo relativo F2', unit: 's', category: 'standings' },
  { id: 'CarIdxGear', label: 'Gear por carro', category: 'standings' },
  { id: 'CarIdxRPM', label: 'RPM por carro', unit: 'rpm', category: 'standings' },
  { id: 'CarIdxOnPitRoad', label: 'Car no pit road', category: 'standings' },
  { id: 'CarIdxTrackSurface', label: 'Superfície por carro', category: 'standings' },
  { id: 'CarIdxTrackSurfaceMaterial', label: 'Material da superfície por carro', category: 'standings' },
  { id: 'TotalCars', label: 'Total de carros', category: 'standings', telemetryField: 'totalCars' },
  { id: 'StrengthOfField', label: 'Strength of field', category: 'standings', telemetryField: 'strengthOfField' },
  { id: 'CarLeftRightCount', label: 'Cars ao lado (1/2)', category: 'standings', telemetryField: 'carLeftRightCount' },

  { id: 'FuelLevel', label: 'Fuel no tanque', unit: 'L', category: 'fuel', telemetryField: 'fuelLiters' },
  { id: 'FuelLevelPct', label: 'Fuel no tanque', unit: '%', category: 'fuel' },
  { id: 'FuelUsePerHour', label: 'Consumo por hora', unit: 'L/h', category: 'fuel' },
  { id: 'FuelUsePerLap', label: 'Consumo por lap', unit: 'L/lap', category: 'fuel', telemetryField: 'fuelPerLap' },
  { id: 'DriverCarFuelMaxLtr', label: 'Capacidade do tanque', unit: 'L', category: 'fuel', telemetryField: 'fuelCapacityLiters' },
  { id: 'FuelPress', label: 'Pressão de fuel', unit: 'bar', category: 'fuel' },

  { id: 'LFtempCL', label: 'Temp. tire DE interna', unit: '°C', category: 'tyres', telemetryField: 'tyres.lf.tempC' },
  { id: 'LFtempCM', label: 'Temp. tire DE central', unit: '°C', category: 'tyres', telemetryField: 'tyres.lf.tempC' },
  { id: 'LFtempCR', label: 'Temp. tire DE externa', unit: '°C', category: 'tyres', telemetryField: 'tyres.lf.tempC' },
  { id: 'RFtempCL', label: 'Temp. tire DD interna', unit: '°C', category: 'tyres', telemetryField: 'tyres.rf.tempC' },
  { id: 'RFtempCM', label: 'Temp. tire DD central', unit: '°C', category: 'tyres', telemetryField: 'tyres.rf.tempC' },
  { id: 'RFtempCR', label: 'Temp. tire DD externa', unit: '°C', category: 'tyres', telemetryField: 'tyres.rf.tempC' },
  { id: 'LRtempCL', label: 'Temp. tire TE interna', unit: '°C', category: 'tyres', telemetryField: 'tyres.lr.tempC' },
  { id: 'LRtempCM', label: 'Temp. tire TE central', unit: '°C', category: 'tyres', telemetryField: 'tyres.lr.tempC' },
  { id: 'LRtempCR', label: 'Temp. tire TE externa', unit: '°C', category: 'tyres', telemetryField: 'tyres.lr.tempC' },
  { id: 'RRtempCL', label: 'Temp. tire TD interna', unit: '°C', category: 'tyres', telemetryField: 'tyres.rr.tempC' },
  { id: 'RRtempCM', label: 'Temp. tire TD central', unit: '°C', category: 'tyres', telemetryField: 'tyres.rr.tempC' },
  { id: 'RRtempCR', label: 'Temp. tire TD externa', unit: '°C', category: 'tyres', telemetryField: 'tyres.rr.tempC' },
  { id: 'LFcoldPressure', label: 'Pressão fria DE', unit: 'kPa', category: 'tyres', telemetryField: 'tireColdPressuresKpa.lf' },
  { id: 'RFcoldPressure', label: 'Pressão fria DD', unit: 'kPa', category: 'tyres', telemetryField: 'tireColdPressuresKpa.rf' },
  { id: 'LRcoldPressure', label: 'Pressão fria TE', unit: 'kPa', category: 'tyres', telemetryField: 'tireColdPressuresKpa.lr' },
  { id: 'RRcoldPressure', label: 'Pressão fria TD', unit: 'kPa', category: 'tyres', telemetryField: 'tireColdPressuresKpa.rr' },
  { id: 'LFpressure', label: 'Pressão tire DE', unit: 'kPa', category: 'tyres', telemetryField: 'tyres.lf.pressureKpa' },
  { id: 'RFpressure', label: 'Pressão tire DD', unit: 'kPa', category: 'tyres', telemetryField: 'tyres.rf.pressureKpa' },
  { id: 'LRpressure', label: 'Pressão tire TE', unit: 'kPa', category: 'tyres', telemetryField: 'tyres.lr.pressureKpa' },
  { id: 'RRpressure', label: 'Pressão tire TD', unit: 'kPa', category: 'tyres', telemetryField: 'tyres.rr.pressureKpa' },
  { id: 'LFwearL', label: 'Desgaste tire DE interno', unit: '%', category: 'tyres', telemetryField: 'tyres.lf.wearPct' },
  { id: 'LFwearM', label: 'Desgaste tire DE central', unit: '%', category: 'tyres', telemetryField: 'tyres.lf.wearPct' },
  { id: 'LFwearR', label: 'Desgaste tire DE externo', unit: '%', category: 'tyres', telemetryField: 'tyres.lf.wearPct' },
  { id: 'RFwearL', label: 'Desgaste tire DD interno', unit: '%', category: 'tyres', telemetryField: 'tyres.rf.wearPct' },
  { id: 'RFwearM', label: 'Desgaste tire DD central', unit: '%', category: 'tyres', telemetryField: 'tyres.rf.wearPct' },
  { id: 'RFwearR', label: 'Desgaste tire DD externo', unit: '%', category: 'tyres', telemetryField: 'tyres.rf.wearPct' },
  { id: 'LRwearL', label: 'Desgaste tire TE interno', unit: '%', category: 'tyres', telemetryField: 'tyres.lr.wearPct' },
  { id: 'LRwearM', label: 'Desgaste tire TE central', unit: '%', category: 'tyres', telemetryField: 'tyres.lr.wearPct' },
  { id: 'LRwearR', label: 'Desgaste tire TE externo', unit: '%', category: 'tyres', telemetryField: 'tyres.lr.wearPct' },
  { id: 'RRwearL', label: 'Desgaste tire TD interno', unit: '%', category: 'tyres', telemetryField: 'tyres.rr.wearPct' },
  { id: 'RRwearM', label: 'Desgaste tire TD central', unit: '%', category: 'tyres', telemetryField: 'tyres.rr.wearPct' },
  { id: 'RRwearR', label: 'Desgaste tire TD externo', unit: '%', category: 'tyres', telemetryField: 'tyres.rr.wearPct' },
  { id: 'LFbrakeLinePress', label: 'Pressão brake DE', unit: 'bar', category: 'tyres' },
  { id: 'RFbrakeLinePress', label: 'Pressão brake DD', unit: 'bar', category: 'tyres' },
  { id: 'LRbrakeLinePress', label: 'Pressão brake TE', unit: 'bar', category: 'tyres' },
  { id: 'RRbrakeLinePress', label: 'Pressão brake TD', unit: 'bar', category: 'tyres' },
  { id: 'LFbrakeTemp', label: 'Temp. brake DE', unit: '°C', category: 'tyres', telemetryField: 'brakeTempC.lf' },
  { id: 'RFbrakeTemp', label: 'Temp. brake DD', unit: '°C', category: 'tyres', telemetryField: 'brakeTempC.rf' },
  { id: 'LRbrakeTemp', label: 'Temp. brake TE', unit: '°C', category: 'tyres', telemetryField: 'brakeTempC.lr' },
  { id: 'RRbrakeTemp', label: 'Temp. brake TD', unit: '°C', category: 'tyres', telemetryField: 'brakeTempC.rr' },

  { id: 'AirTemp', label: 'Temperatura do ar', unit: '°C', category: 'weather', telemetryField: 'airTempC' },
  { id: 'TrackTemp', label: 'Temperatura da pista', unit: '°C', category: 'weather', telemetryField: 'trackTempC' },
  { id: 'TrackTempCrew', label: 'Temperatura da pista (crew)', unit: '°C', category: 'weather', telemetryField: 'trackTempC' },
  { id: 'TrackWetness', label: 'Molhado na pista', unit: '%', category: 'weather', telemetryField: 'trackWetnessPct' },
  { id: 'Precipitation', label: 'Precipitação', unit: '%', category: 'weather', telemetryField: 'isRaining' },
  { id: 'RainIntensity', label: 'Intensidade da rain', unit: '%', category: 'weather', telemetryField: 'isRaining' },
  { id: 'FogLevel', label: 'Neblina', unit: '%', category: 'weather' },
  { id: 'Skies', label: 'Condição do céu', category: 'weather' },
  { id: 'RelativeHumidity', label: 'Umidade relativa', unit: '%', category: 'weather' },
  { id: 'WindDir', label: 'Direção do vento', unit: '°', category: 'weather' },
  { id: 'WindVel', label: 'Velocidade do vento', unit: 'm/s', category: 'weather' },
  { id: 'SolarAltitude', label: 'Altitude solar', unit: '°', category: 'weather' },
  { id: 'SolarAzimuth', label: 'Azimute solar', unit: '°', category: 'weather' },
  { id: 'TrackGripStatus', label: 'Grip da pista', unit: '%', category: 'weather', telemetryField: 'gripPct' },
  { id: 'WeatherDeclaredWet', label: 'Pista declarada molhada', category: 'weather', telemetryField: 'weatherDeclaredWet' },
  { id: 'PlayerTrackSurfaceMaterial', label: 'Material da superfície', category: 'weather', telemetryField: 'trackSurfaceMaterial' },

  { id: 'SessionFlags', label: 'Bandeiras da sessão', category: 'flags' },
  { id: 'FlagGreen', label: 'Bandeira verde', category: 'flags', telemetryField: 'flags.green' },
  { id: 'FlagYellow', label: 'Yellow flag', category: 'flags', telemetryField: 'flags.yellow' },
  { id: 'FlagBlue', label: 'Blue flag', category: 'flags', telemetryField: 'flags.blue' },
  { id: 'FlagWhite', label: 'Bandeira branca', category: 'flags', telemetryField: 'flags.white' },
  { id: 'FlagCheckered', label: 'Bandeirada final', category: 'flags', telemetryField: 'flags.checkered' },
  { id: 'FlagRed', label: 'Bandeira vermelha', category: 'flags', telemetryField: 'flags.red' },
  { id: 'FlagBlack', label: 'Black flag', category: 'flags', telemetryField: 'flags.black' },
  { id: 'FlagMeatball', label: 'Black flag/laranja', category: 'flags', telemetryField: 'flags.meatball' },
  { id: 'FlagRepair', label: 'Reparo obrigatório', category: 'flags', telemetryField: 'flags.repair' },
  { id: 'FlagDisqualify', label: 'Desclassificação', category: 'flags', telemetryField: 'flags.disqualify' },
  { id: 'FlagGreenWhiteCheckered', label: 'Green-white-checkered', category: 'flags', telemetryField: 'flags.greenWhiteCheckered' },

  { id: 'OnPitRoad', label: 'No pit road', category: 'pit', telemetryField: 'onPitRoad' },
  { id: 'PitSpeedLimiter', label: 'Limitador de pit', category: 'pit', telemetryField: 'pitLimiter' },
  { id: 'PitSvFlags', label: 'Serviços selecionados', category: 'pit' },
  { id: 'PitSvLFP', label: 'Pressão pit DE', unit: 'kPa', category: 'pit' },
  { id: 'PitSvRFP', label: 'Pressão pit DD', unit: 'kPa', category: 'pit' },
  { id: 'PitSvLRP', label: 'Pressão pit TE', unit: 'kPa', category: 'pit' },
  { id: 'PitSvRRP', label: 'Pressão pit TD', unit: 'kPa', category: 'pit' },
  { id: 'PitSvFuel', label: 'Fuel a adicionar', unit: 'L', category: 'pit' },
  { id: 'PitRepairLeft', label: 'Reparo restante', unit: 's', category: 'pit' },
  { id: 'PitOptRepairLeft', label: 'Reparo opcional restante', unit: 's', category: 'pit' },
  { id: 'PitstopActive', label: 'Pit stop ativo', category: 'pit' },
  { id: 'PitsOpen', label: 'Pits abertos', category: 'pit', telemetryField: 'pit.pitsOpen' },
  { id: 'PlayerCarInPitStall', label: 'No box (pit stall)', category: 'pit', telemetryField: 'pit.inPitStall' },
  { id: 'PlayerCarPitSvStatus', label: 'Status do serviço de pit', category: 'pit', telemetryField: 'pit.svStatus' },

  { id: 'dcBrakeBias', label: 'Brake bias', unit: '%', category: 'controls' },
  { id: 'dcTractionControl', label: 'Traction control', category: 'controls' },
  { id: 'dcABS', label: 'ABS', category: 'controls' },
  { id: 'dcThrottleShape', label: 'Mapa do acelerador', category: 'controls' },
  { id: 'dcFuelMixture', label: 'Mistura de fuel', category: 'controls' },
  { id: 'dcEngineBraking', label: 'Brake motor', category: 'controls' },
  { id: 'dcAntiRollFront', label: 'Barra estabilizadora dianteira', category: 'controls' },
  { id: 'dcAntiRollRear', label: 'Barra estabilizadora traseira', category: 'controls' },
  { id: 'dcWeightJackerRight', label: 'Weight jacker direito', category: 'controls' },
  { id: 'DRS_Status', label: 'Status DRS', category: 'controls', telemetryField: 'drs' },
  // The real iRacing raw var for "ABS intervening" is `BrakeABSactive` (lower-case `active`).
  // The old `ABSActive` id was a PHANTOM (iRacing publishes no such var) — corrected here.
  { id: 'BrakeABSactive', label: 'ABS ativo', category: 'controls', telemetryField: 'absActive' },
  { id: 'BrakeABSCutPct', label: 'Corte de brake do ABS', unit: '%', category: 'controls', telemetryField: 'absCutPct' },
  // iRacing exposes NO native TC-active var (SimHub derives it). Per product decision,
  // `tcActive` is DERIVED via deriveTcActive (TC_ACTIVE_DERIVED default ON), NOT a raw
  // telemetry channel. Kept for expressions and clearly annotated as derived.
  { id: 'tcActiveDerived', label: 'TC ativo (derivado)', category: 'controls', telemetryField: 'tcActive' },
  { id: 'PushToPass', label: 'Push-to-pass', category: 'controls', telemetryField: 'pushToPass' },
  { id: 'P2P_Count', label: 'Push-to-pass restantes', category: 'controls', telemetryField: 'pushToPassCount' },

  { id: 'PlayerCarTeamIncidentCount', label: 'Incidentes do time', category: 'damage', telemetryField: 'incidentCount' },
  { id: 'PlayerCarMyIncidentCount', label: 'Meus incidentes', category: 'damage', telemetryField: 'incidentCount' },
  { id: 'PlayerCarDriverIncidentCount', label: 'Incidentes do piloto', category: 'damage', telemetryField: 'incidentCount' },
  { id: 'PlayerCarMaxIncidentCount', label: 'Limit of incidentes', category: 'damage', telemetryField: 'incidentLimit' },
  { id: 'FastRepairUsed', label: 'Fast repairs usados', category: 'damage', telemetryField: 'fastRepairsUsed' },
  { id: 'FastRepairAvailable', label: 'Fast repairs disponíveis', category: 'damage', telemetryField: 'fastRepairsAvailable' },
  { id: 'RepairRequired', label: 'Reparo obrigatório', category: 'damage', telemetryField: 'flags.repair' }
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
