# iRacing channel catalog

Master catalog generated from `app-v2\src\shared\iracing-vars.ts` (`IRACING_VARIABLES`) and aligned with `TelemetrySnapshot` field names where a `telemetryField` exists.

## Car (`car`)

| Raw iRacing var (id) | Label | Unit | Category | Snapshot field | Surfaced? |
|---|---|---|---|---|---|
| `Speed` | Speed | km/h | `car` | `speedKmh` | Yes |
| `RPM` | Engine RPM | rpm | `car` | `rpm` | Yes |
| `Gear` | Gear | — | `car` | `gear` | Yes |
| `DriverCarSLShiftRPM` | Shift light RPM | rpm | `car` | `maxRpm` | Yes |
| `PlayerCarSLShiftRPM` | Optimal upshift RPM | rpm | `car` | `shiftRpm` | Yes |
| `ShiftIndicatorPct` | Shift indicator | % | `car` | `shiftIndicatorPct` | Yes |
| `EngineWarnings` | Engine warnings | — | `car` | — | No |
| `OilPressure` | Oil pressure | bar | `car` | `oilPressureKpa` | Yes |
| `OilTemp` | Oil temperature | °C | `car` | — | No |
| `WaterTemp` | Water temperature | °C | `car` | — | No |
| `WaterLevel` | Water level | L | `car` | `waterLevelL` | Yes |
| `Voltage` | Voltage | V | `car` | `voltage` | Yes |
| `ManifoldPress` | Manifold pressure | bar | `car` | `manifoldPressBar` | Yes |
| `Engine0_RPM` | Engine 0 RPM | rpm | `car` | `rpm` | Yes |
| `VelocityX` | Longitudinal velocity | m/s | `car` | — | No |
| `VelocityY` | Lateral velocity | m/s | `car` | — | No |
| `VelocityZ` | Vertical velocity | m/s | `car` | — | No |
| `Yaw` | Yaw | rad | `car` | `yawRad` | Yes |
| `YawRate` | Yaw rate | rad/s | `car` | — | No |
| `Pitch` | Pitch | rad | `car` | `pitchRad` | Yes |
| `PitchRate` | Pitch rate | rad/s | `car` | `pitchRateRadSec` | Yes |
| `Roll` | Roll | rad | `car` | `rollRad` | Yes |
| `RollRate` | Roll rate | rad/s | `car` | `rollRateRadSec` | Yes |
| `LatAccel` | Lateral acceleration | m/s² | `car` | — | No |
| `LongAccel` | Longitudinal acceleration | m/s² | `car` | — | No |
| `VertAccel` | Vertical acceleration | m/s² | `car` | — | No |
| `EnergyERSBatteryPct` | ERS/hybrid battery | % | `car` | `ersBatteryPct` | Yes |
| `PlayerCarWeightPenalty` | Weight penalty (BoP) | kg | `car` | `weightPenaltyKg` | Yes |
| `PlayerCarPowerAdjust` | Power adjustment (BoP) | % | `car` | `powerAdjustPct` | Yes |

## Inputs (`inputs`)

| Raw iRacing var (id) | Label | Unit | Category | Snapshot field | Surfaced? |
|---|---|---|---|---|---|
| `Throttle` | Throttle | % | `inputs` | `throttle` | Yes |
| `Brake` | Brake | % | `inputs` | `brake` | Yes |
| `Clutch` | Clutch | % | `inputs` | `clutch` | Yes |
| `SteeringWheelAngle` | Steering angle | ° | `inputs` | `steerAngleDeg` | Yes |
| `SteeringWheelAngleMax` | Max steering wheel angle | ? | `inputs` | `steeringAngleMaxDeg` | Yes |
| `SteeringWheelPctTorque` | Torque FFB | % | `inputs` | `steeringTorquePct` | Yes |
| `HandbrakeRaw` | Raw handbrake | % | `inputs` | — | No |
| `BrakeRaw` | Raw brake | % | `inputs` | `brake` | Yes |
| `ThrottleRaw` | Raw throttle | % | `inputs` | `throttle` | Yes |
| `ClutchRaw` | Raw clutch | % | `inputs` | `clutch` | Yes |

## Timing (`timing`)

| Raw iRacing var (id) | Label | Unit | Category | Snapshot field | Surfaced? |
|---|---|---|---|---|---|
| `Lap` | Current lap | — | `timing` | `currentLap` | Yes |
| `LapCompleted` | Completed laps | — | `timing` | — | No |
| `LapDist` | Lap distance | m | `timing` | — | No |
| `LapDistPct` | Lap progress | % | `timing` | `lapDistPct` | Yes |
| `LapCurrentLapTime` | Current lap time | s | `timing` | `currentLapTimeSec` | Yes |
| `LapLastLapTime` | Last lap | s | `timing` | `lastLapTimeSec` | Yes |
| `LapBestLapTime` | Best lap | s | `timing` | `bestLapTimeSec` | Yes |
| `LapBestNLapLap` | Best N-lap lap | — | `timing` | — | No |
| `LapBestNLapTime` | Best N-lap time | s | `timing` | — | No |
| `LapDeltaToBestLap` | Delta to best lap | s | `timing` | `deltaToBestSec` | Yes |
| `LapDeltaToBestLap_DD` | Delta to best lap (display) | s | `timing` | `deltaToBestSec` | Yes |
| `LapDeltaToSessionBestLap` | Delta to session best | s | `timing` | `deltaToSessionBestSec` | Yes |
| `LapDeltaToOptimalLap` | Delta to optimal lap | s | `timing` | `deltaToOptimalSec` | Yes |
| `LapDeltaToSessionOptimalLap` | Delta to session optimal | s | `timing` | `deltaToSessionOptimalSec` | Yes |
| `LapDeltaToDriverBestLap` | Delta to driver best | s | `timing` | `deltaToDriverBestSec` | Yes |
| `LapDeltaToBestLap_OK` | Best delta valid | — | `timing` | — | No |
| `LapDeltaToBestLap_SessionTime` | Best delta session time | s | `timing` | — | No |
| `EstimatedLapTime` | Estimated lap | s | `timing` | `estimatedLapTimeSec` | Yes |

## Session (`session`)

| Raw iRacing var (id) | Label | Unit | Category | Snapshot field | Surfaced? |
|---|---|---|---|---|---|
| `SessionNum` | Session number | — | `session` | — | No |
| `SessionState` | Session state | — | `session` | `sessionState` | Yes |
| `SessionTime` | Session time | s | `session` | — | No |
| `SessionTimeOfDay` | Time of day | s | `session` | `sessionTimeOfDay` | Yes |
| `SessionTimeRemain` | Time remaining | s | `session` | `sessionTimeRemainingSec` | Yes |
| `SessionLapsRemain` | Laps remaining | — | `session` | `lapsRemaining` | Yes |
| `SessionLapsRemainEx` | Exact laps remaining | — | `session` | `lapsRemaining` | Yes |
| `SessionTick` | Session tick | — | `session` | — | No |
| `SessionUniqueID` | Unique session ID | — | `session` | — | No |
| `SessionType` | Session type | — | `session` | `sessionType` | Yes |
| `PaceMode` | Pace mode | — | `session` | `paceMode` | Yes |
| `TrackName` | Track | — | `session` | `trackName` | Yes |
| `CarName` | Car | — | `session` | `carName` | Yes |
| `PlayerCarIdx` | Player car index | — | `session` | `playerCarIdx` | Yes |
| `CamCarIdx` | Camera car index | — | `session` | — | No |
| `IsOnTrack` | On track | — | `session` | `connected` | Yes |
| `IsOnTrackCar` | Car on track | — | `session` | `connected` | Yes |
| `IsReplayPlaying` | Replay playing | — | `session` | — | No |
| `ReplayFrameNum` | Replay frame | — | `session` | — | No |
| `ReplayFrameNumEnd` | Replay final frame | — | `session` | — | No |

## Standings (`standings`)

| Raw iRacing var (id) | Label | Unit | Category | Snapshot field | Surfaced? |
|---|---|---|---|---|---|
| `PlayerCarPosition` | Overall position | — | `standings` | `position` | Yes |
| `PlayerCarClassPosition` | Class position | — | `standings` | `classPosition` | Yes |
| `CarIdxPosition` | Position by car | — | `standings` | — | No |
| `CarIdxClassPosition` | Class position by car | — | `standings` | — | No |
| `CarIdxLap` | Lap by car | — | `standings` | — | No |
| `CarIdxLapCompleted` | Completed laps by car | — | `standings` | — | No |
| `CarIdxLapDistPct` | Progress by car | % | `standings` | — | No |
| `CarIdxEstTime` | Estimated time by car | s | `standings` | — | No |
| `CarIdxF2Time` | F2 relative time | s | `standings` | — | No |
| `CarIdxGear` | Gear by car | — | `standings` | — | No |
| `CarIdxRPM` | RPM by car | rpm | `standings` | — | No |
| `CarIdxOnPitRoad` | Car on pit road | — | `standings` | — | No |
| `CarIdxTrackSurface` | Surface by car | — | `standings` | — | No |
| `CarIdxTrackSurfaceMaterial` | Surface material by car | — | `standings` | — | No |
| `TotalCars` | Total cars | — | `standings` | `totalCars` | Yes |
| `StrengthOfField` | Strength of field | — | `standings` | `strengthOfField` | Yes |
| `CarLeftRightCount` | Cars alongside (1/2) | — | `standings` | `carLeftRightCount` | Yes |

## Fuel (`fuel`)

| Raw iRacing var (id) | Label | Unit | Category | Snapshot field | Surfaced? |
|---|---|---|---|---|---|
| `FuelLevel` | Fuel in tank | L | `fuel` | `fuelLiters` | Yes |
| `FuelLevelPct` | Fuel in tank | % | `fuel` | `fuelLevelPct` | Yes |
| `FuelUsePerHour` | Consumption per hour | L/h | `fuel` | — | No |
| `FuelUsePerLap` | Consumption per lap | L/lap | `fuel` | `fuelPerLap` | Yes |
| `DriverCarFuelMaxLtr` | Tank capacity | L | `fuel` | `fuelCapacityLiters` | Yes |
| `FuelPress` | Fuel pressure | bar | `fuel` | `fuelPressBar` | Yes |

## Tires and brakes (`tyres`)

| Raw iRacing var (id) | Label | Unit | Category | Snapshot field | Surfaced? |
|---|---|---|---|---|---|
| `LFtempCL` | LF tire inner temp | ?C | `tyres` | `tyres.lf.tempC` | Yes |
| `LFtempCM` | LF tire center temp | ?C | `tyres` | `tyres.lf.tempC` | Yes |
| `LFtempCR` | LF tire outer temp | ?C | `tyres` | `tyres.lf.tempC` | Yes |
| `RFtempCL` | RF tire inner temp | ?C | `tyres` | `tyres.rf.tempC` | Yes |
| `RFtempCM` | RF tire center temp | ?C | `tyres` | `tyres.rf.tempC` | Yes |
| `RFtempCR` | RF tire outer temp | ?C | `tyres` | `tyres.rf.tempC` | Yes |
| `LRtempCL` | LR tire inner temp | ?C | `tyres` | `tyres.lr.tempC` | Yes |
| `LRtempCM` | LR tire center temp | ?C | `tyres` | `tyres.lr.tempC` | Yes |
| `LRtempCR` | LR tire outer temp | ?C | `tyres` | `tyres.lr.tempC` | Yes |
| `RRtempCL` | RR tire inner temp | ?C | `tyres` | `tyres.rr.tempC` | Yes |
| `RRtempCM` | RR tire center temp | ?C | `tyres` | `tyres.rr.tempC` | Yes |
| `RRtempCR` | RR tire outer temp | ?C | `tyres` | `tyres.rr.tempC` | Yes |
| `LFcoldPressure` | LF cold pressure | kPa | `tyres` | `tireColdPressuresKpa.lf` | Yes |
| `RFcoldPressure` | RF cold pressure | kPa | `tyres` | `tireColdPressuresKpa.rf` | Yes |
| `LRcoldPressure` | LR cold pressure | kPa | `tyres` | `tireColdPressuresKpa.lr` | Yes |
| `RRcoldPressure` | RR cold pressure | kPa | `tyres` | `tireColdPressuresKpa.rr` | Yes |
| `LFpressure` | LF tire pressure | kPa | `tyres` | `tyres.lf.pressureKpa` | Yes |
| `RFpressure` | RF tire pressure | kPa | `tyres` | `tyres.rf.pressureKpa` | Yes |
| `LRpressure` | LR tire pressure | kPa | `tyres` | `tyres.lr.pressureKpa` | Yes |
| `RRpressure` | RR tire pressure | kPa | `tyres` | `tyres.rr.pressureKpa` | Yes |
| `LFwearL` | LF tire inner wear | % | `tyres` | `tyres.lf.wearPct` | Yes |
| `LFwearM` | LF tire center wear | % | `tyres` | `tyres.lf.wearPct` | Yes |
| `LFwearR` | LF tire outer wear | % | `tyres` | `tyres.lf.wearPct` | Yes |
| `RFwearL` | RF tire inner wear | % | `tyres` | `tyres.rf.wearPct` | Yes |
| `RFwearM` | RF tire center wear | % | `tyres` | `tyres.rf.wearPct` | Yes |
| `RFwearR` | RF tire outer wear | % | `tyres` | `tyres.rf.wearPct` | Yes |
| `LRwearL` | LR tire inner wear | % | `tyres` | `tyres.lr.wearPct` | Yes |
| `LRwearM` | LR tire center wear | % | `tyres` | `tyres.lr.wearPct` | Yes |
| `LRwearR` | LR tire outer wear | % | `tyres` | `tyres.lr.wearPct` | Yes |
| `RRwearL` | RR tire inner wear | % | `tyres` | `tyres.rr.wearPct` | Yes |
| `RRwearM` | RR tire center wear | % | `tyres` | `tyres.rr.wearPct` | Yes |
| `RRwearR` | RR tire outer wear | % | `tyres` | `tyres.rr.wearPct` | Yes |
| `LFbrakeLinePress` | LF brake pressure | bar | `tyres` | `brakeLinePressBar.lf` | Yes |
| `RFbrakeLinePress` | RF brake pressure | bar | `tyres` | `brakeLinePressBar.rf` | Yes |
| `LRbrakeLinePress` | LR brake pressure | bar | `tyres` | `brakeLinePressBar.lr` | Yes |
| `RRbrakeLinePress` | RR brake pressure | bar | `tyres` | `brakeLinePressBar.rr` | Yes |
| `LFbrakeTemp` | LF brake temp | ?C | `tyres` | `brakeTempC.lf` | Yes |
| `RFbrakeTemp` | RF brake temp | ?C | `tyres` | `brakeTempC.rf` | Yes |
| `LRbrakeTemp` | LR brake temp | ?C | `tyres` | `brakeTempC.lr` | Yes |
| `RRbrakeTemp` | RR brake temp | ?C | `tyres` | `brakeTempC.rr` | Yes |

## Weather and track (`weather`)

| Raw iRacing var (id) | Label | Unit | Category | Snapshot field | Surfaced? |
|---|---|---|---|---|---|
| `AirTemp` | Air temperature | ?C | `weather` | `airTempC` | Yes |
| `TrackTemp` | Track temperature | ?C | `weather` | `trackTempC` | Yes |
| `TrackTempCrew` | Track temperature (crew) | ?C | `weather` | `trackTempC` | Yes |
| `TrackWetness` | Track wetness | % | `weather` | `trackWetnessPct` | Yes |
| `Precipitation` | Precipitation | % | `weather` | `isRaining` | Yes |
| `RainIntensity` | Rain intensity | % | `weather` | `isRaining` | Yes |
| `FogLevel` | Fog | % | `weather` | `fogPct` | Yes |
| `Skies` | Sky condition | — | `weather` | `skies` | Yes |
| `RelativeHumidity` | Relative humidity | % | `weather` | `humidityPct` | Yes |
| `WindDir` | Wind direction | ? | `weather` | `windDirRad` | Yes |
| `WindVel` | Wind speed | m/s | `weather` | `windSpeedMs` | Yes |
| `SolarAltitude` | Solar altitude | ? | `weather` | `solarAltitudeRad` | Yes |
| `SolarAzimuth` | Solar azimuth | ? | `weather` | `solarAzimuthRad` | Yes |
| `TrackGripStatus` | Track grip | % | `weather` | `gripPct` | Yes |
| `WeatherDeclaredWet` | Declared wet track | — | `weather` | `weatherDeclaredWet` | Yes |
| `PlayerTrackSurfaceMaterial` | Surface material | — | `weather` | `trackSurfaceMaterial` | Yes |

## Flags (`flags`)

| Raw iRacing var (id) | Label | Unit | Category | Snapshot field | Surfaced? |
|---|---|---|---|---|---|
| `SessionFlags` | Session flags | — | `flags` | — | No |
| `FlagGreen` | Green flag | — | `flags` | `flags.green` | Yes |
| `FlagYellow` | Yellow flag | — | `flags` | `flags.yellow` | Yes |
| `FlagBlue` | Blue flag | — | `flags` | `flags.blue` | Yes |
| `FlagWhite` | White flag | — | `flags` | `flags.white` | Yes |
| `FlagCheckered` | Checkered flag | — | `flags` | `flags.checkered` | Yes |
| `FlagRed` | Red flag | — | `flags` | `flags.red` | Yes |
| `FlagBlack` | Black flag | — | `flags` | `flags.black` | Yes |
| `FlagMeatball` | Black/orange flag | — | `flags` | `flags.meatball` | Yes |
| `FlagRepair` | Required repair | — | `flags` | `flags.repair` | Yes |
| `FlagDisqualify` | Disqualification | — | `flags` | `flags.disqualify` | Yes |
| `FlagGreenWhiteCheckered` | Green-white-checkered | — | `flags` | `flags.greenWhiteCheckered` | Yes |

## Pit stop (`pit`)

| Raw iRacing var (id) | Label | Unit | Category | Snapshot field | Surfaced? |
|---|---|---|---|---|---|
| `OnPitRoad` | On pit road | — | `pit` | `onPitRoad` | Yes |
| `PitSpeedLimiter` | Pit limiter | — | `pit` | `pitLimiter` | Yes |
| `PitSvFlags` | Selected services | — | `pit` | — | No |
| `PitSvLFP` | Pit LF pressure | kPa | `pit` | — | No |
| `PitSvRFP` | Pit RF pressure | kPa | `pit` | — | No |
| `PitSvLRP` | Pit LR pressure | kPa | `pit` | — | No |
| `PitSvRRP` | Pit RR pressure | kPa | `pit` | — | No |
| `PitSvFuel` | Fuel to add | L | `pit` | — | No |
| `PitRepairLeft` | Repair remaining | s | `pit` | — | No |
| `PitOptRepairLeft` | Optional repair remaining | s | `pit` | — | No |
| `PitstopActive` | Pit stop active | — | `pit` | — | No |
| `PitsOpen` | Pits open | — | `pit` | `pit.pitsOpen` | Yes |
| `PlayerCarInPitStall` | In pit stall | — | `pit` | `pit.inPitStall` | Yes |
| `PlayerCarPitSvStatus` | Pit service status | — | `pit` | `pit.svStatus` | Yes |

## Controls and electronics (`controls`)

| Raw iRacing var (id) | Label | Unit | Category | Snapshot field | Surfaced? |
|---|---|---|---|---|---|
| `dcBrakeBias` | Brake bias | % | `controls` | — | No |
| `dcTractionControl` | Traction control | — | `controls` | — | No |
| `dcABS` | ABS | — | `controls` | — | No |
| `dcThrottleShape` | Throttle map | — | `controls` | — | No |
| `dcFuelMixture` | Fuel mixture | — | `controls` | — | No |
| `dcEngineBraking` | Engine braking | — | `controls` | — | No |
| `dcAntiRollFront` | Front anti-roll bar | — | `controls` | — | No |
| `dcAntiRollRear` | Rear anti-roll bar | — | `controls` | — | No |
| `dcWeightJackerRight` | Right weight jacker | — | `controls` | — | No |
| `DRS_Status` | Status DRS | — | `controls` | `drs` | Yes |
| `BrakeABSactive` | ABS active | — | `controls` | `absActive` | Yes |
| `BrakeABSCutPct` | ABS brake cut | % | `controls` | `absCutPct` | Yes |
| `tcActiveDerived` | TC active (derived) | — | `controls` | `tcActive` | Yes |
| `PushToPass` | Push-to-pass | — | `controls` | `pushToPass` | Yes |
| `P2P_Count` | Push-to-pass remaining | — | `controls` | `pushToPassCount` | Yes |

## Damage and incidents (`damage`)

| Raw iRacing var (id) | Label | Unit | Category | Snapshot field | Surfaced? |
|---|---|---|---|---|---|
| `PlayerCarTeamIncidentCount` | Team incidents | — | `damage` | `incidentCount` | Yes |
| `PlayerCarMyIncidentCount` | My incidents | — | `damage` | `incidentCount` | Yes |
| `PlayerCarDriverIncidentCount` | Driver incidents | — | `damage` | `incidentCount` | Yes |
| `PlayerCarMaxIncidentCount` | Incident limit | — | `damage` | `incidentLimit` | Yes |
| `FastRepairUsed` | Fast repairs used | — | `damage` | `fastRepairsUsed` | Yes |
| `FastRepairAvailable` | Fast repairs available | — | `damage` | `fastRepairsAvailable` | Yes |
| `RepairRequired` | Required repair | — | `damage` | `flags.repair` | Yes |

## Coverage summary

- Total cataloged variables: **204**.
- Surfaced through `TelemetrySnapshot`: **147**.
- Cataloged but not surfaced: **57**.
- Category counts: `car` 29, `inputs` 10, `timing` 18, `session` 20, `standings` 17, `fuel` 6, `tyres` 40, `weather` 16, `flags` 12, `pit` 14, `controls` 15, `damage` 7.

## Notable channels NOT yet in `iracing-vars.ts` (from the SDK header/relnotes)

- Suspension ride heights: `CFrideHeight`, plus related corner ride-height channels where available. Useful for setup validation and aero platform dashboards.
- Shock deflection and velocity per corner: `LFshockDefl`, `RFshockDefl`, `LRshockDefl`, `RRshockDefl`, and `LFshockVel`, `RFshockVel`, `LRshockVel`, `RRshockVel`. Useful for damper histograms and curb/ride analysis.
- Wheel speeds per corner. Useful for lockup, wheelspin, ABS/TC diagnostics, and driven/non-driven axle comparisons.
- Steering force-feedback diagnostics: `SteeringWheelTorque` and release-notes variable `SteeringFFBEnabled`. Useful for clipping, hardware setup, and FFB-enabled state checks.
- GPS/location channels: latitude, longitude, and altitude (`Lat`, `Lon`, `Alt` naming may vary by bridge). `TelemetrySnapshot` already has optional `lat`/`lon` fields, but the catalog has no raw GPS entries yet.
- Repair-needed Booleans from release notes: `PitRepairNeeded` and `PitOptRepairNeeded`. The app currently derives repair state from repair-time-left channels and catalogs `RepairRequired`.
- Push-to-pass status from release notes: `P2P_Status`; `P2P_Count` is cataloged, while active status can complement `PushToPass`.
- Complete-field standings: `CarIdx*` arrays are already listed in the catalog, and release notes add optional all-car logging through `irsdkLogAllCars=1` for larger fields.


## Historical catalog note

- Fixed: the Voltage row was previously generated from a corrupted raw id `Lapge`; the current source now uses `Voltage` with snapshot field `voltage`.
