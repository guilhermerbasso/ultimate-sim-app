# iRacing SDK enum reference

These enums are used to decode raw iRacing bitfields and integer labels in the app.

Source: `irsdk_defines.h` from the local iRacing SDK 1.20 extract; descriptions below are distilled, original-prose interpretations.

## `irsdk_Flags`

| value | name | meaning |
|---:|---|---|
| 1 (0x00000001) | `irsdk_checkered` | Checkered flag is active. |
| 2 (0x00000002) | `irsdk_white` | White flag is active. |
| 4 (0x00000004) | `irsdk_green` | Green flag is active. |
| 8 (0x00000008) | `irsdk_yellow` | Yellow flag is active. |
| 16 (0x00000010) | `irsdk_red` | Red flag is active. |
| 32 (0x00000020) | `irsdk_blue` | Blue flag is active. |
| 64 (0x00000040) | `irsdk_debris` | Debris flag or debris condition. |
| 128 (0x00000080) | `irsdk_crossed` | Crossed flags are displayed. |
| 256 (0x00000100) | `irsdk_yellowWaving` | Waving yellow flag. |
| 512 (0x00000200) | `irsdk_oneLapToGreen` | One lap remains before green. |
| 1024 (0x00000400) | `irsdk_greenHeld` | Green flag held condition. |
| 2048 (0x00000800) | `irsdk_tenToGo` | Ten laps to go signal. |
| 4096 (0x00001000) | `irsdk_fiveToGo` | Five laps to go signal. |
| 8192 (0x00002000) | `irsdk_randomWaving` | Random waving flag. |
| 16384 (0x00004000) | `irsdk_caution` | Caution condition. |
| 32768 (0x00008000) | `irsdk_cautionWaving` | Waving caution. |
| 65536 (0x00010000) | `irsdk_black` | Driver black flag. |
| 131072 (0x00020000) | `irsdk_disqualify` | Driver disqualification flag. |
| 262144 (0x00040000) | `irsdk_servicible` | Car is allowed service; this is a service state, not a displayed flag. |
| 524288 (0x00080000) | `irsdk_furled` | Furled black flag. |
| 1048576 (0x00100000) | `irsdk_repair` | Repair/meatball condition. |
| 2097152 (0x00200000) | `irsdk_dqScoringInvalid` | Disqualified and scoring disabled. |
| 268435456 (0x10000000) | `irsdk_startHidden` | Start lights hidden. |
| 536870912 (0x20000000) | `irsdk_startReady` | Start lights ready phase. |
| 1073741824 (0x40000000) | `irsdk_startSet` | Start lights set phase. |
| 2147483648 (0x80000000) | `irsdk_startGo` | Start/go signal. |

## `irsdk_SessionState`

| value | name | meaning |
|---:|---|---|
| 0 | `irsdk_StateInvalid` | No valid session state. |
| 1 | `irsdk_StateGetInCar` | Driver may get in the car. |
| 2 | `irsdk_StateWarmup` | Warmup phase. |
| 3 | `irsdk_StateParadeLaps` | Parade or formation laps. |
| 4 | `irsdk_StateRacing` | Racing is active. |
| 5 | `irsdk_StateCheckered` | Checkered flag has ended the session. |
| 6 | `irsdk_StateCoolDown` | Cool-down phase after the finish. |

## `irsdk_PaceMode`

| value | name | meaning |
|---:|---|---|
| 0 | `irsdk_PaceModeSingleFileStart` | Single-file initial start. |
| 1 | `irsdk_PaceModeDoubleFileStart` | Double-file initial start. |
| 2 | `irsdk_PaceModeSingleFileRestart` | Single-file restart. |
| 3 | `irsdk_PaceModeDoubleFileRestart` | Double-file restart. |
| 4 | `irsdk_PaceModeNotPacing` | No pace/formation mode is active. |

## `irsdk_PaceFlags`

| value | name | meaning |
|---:|---|---|
| 1 (0x0001) | `irsdk_PaceFlagsEndOfLine` | Car is instructed to go to the end of the pacing line. |
| 2 (0x0002) | `irsdk_PaceFlagsFreePass` | Free-pass/lucky-dog condition. |
| 4 (0x0004) | `irsdk_PaceFlagsWavedAround` | Waved-around condition. |

## `irsdk_TrkSurf`

| value | name | meaning |
|---:|---|---|
| -1 | `irsdk_SurfaceNotInWorld` | No valid world surface. |
| 0 | `irsdk_UndefinedMaterial` | Surface material is undefined. |
| 1 | `irsdk_Asphalt1Material` | Asphalt material variant 1. |
| 2 | `irsdk_Asphalt2Material` | Asphalt material variant 2. |
| 3 | `irsdk_Asphalt3Material` | Asphalt material variant 3. |
| 4 | `irsdk_Asphalt4Material` | Asphalt material variant 4. |
| 5 | `irsdk_Concrete1Material` | Concrete material variant 1. |
| 6 | `irsdk_Concrete2Material` | Concrete material variant 2. |
| 7 | `irsdk_RacingDirt1Material` | Racing dirt material variant 1. |
| 8 | `irsdk_RacingDirt2Material` | Racing dirt material variant 2. |
| 9 | `irsdk_Paint1Material` | Painted surface material variant 1. |
| 10 | `irsdk_Paint2Material` | Painted surface material variant 2. |
| 11 | `irsdk_Rumble1Material` | Rumble strip material variant 1. |
| 12 | `irsdk_Rumble2Material` | Rumble strip material variant 2. |
| 13 | `irsdk_Rumble3Material` | Rumble strip material variant 3. |
| 14 | `irsdk_Rumble4Material` | Rumble strip material variant 4. |
| 15 | `irsdk_Grass1Material` | Grass material variant 1. |
| 16 | `irsdk_Grass2Material` | Grass material variant 2. |
| 17 | `irsdk_Grass3Material` | Grass material variant 3. |
| 18 | `irsdk_Grass4Material` | Grass material variant 4. |
| 19 | `irsdk_Dirt1Material` | Dirt material variant 1. |
| 20 | `irsdk_Dirt2Material` | Dirt material variant 2. |
| 21 | `irsdk_Dirt3Material` | Dirt material variant 3. |
| 22 | `irsdk_Dirt4Material` | Dirt material variant 4. |
| 23 | `irsdk_SandMaterial` | Sand material. |
| 24 | `irsdk_Gravel1Material` | Gravel material variant 1. |
| 25 | `irsdk_Gravel2Material` | Gravel material variant 2. |
| 26 | `irsdk_GrasscreteMaterial` | Grasscrete material. |
| 27 | `irsdk_AstroturfMaterial` | Astroturf material. |

## `irsdk_TrkLoc`

| value | name | meaning |
|---:|---|---|
| -1 | `irsdk_NotInWorld` | Car is not in the world. |
| 0 | `irsdk_OffTrack` | Car is off the racing surface. |
| 1 | `irsdk_InPitStall` | Car is in its pit stall. |
| 2 | `irsdk_AproachingPits` | Car is on the pit-entry lead-in or pit road speed-limit area. |
| 3 | `irsdk_OnTrack` | Car is on track. |

## `irsdk_CarLeftRight`

| value | name | meaning |
|---:|---|---|
| 0 | `irsdk_LROff` | Left/right spotter signal is off. |
| 1 | `irsdk_LRClear` | No cars alongside. |
| 2 | `irsdk_LRCarLeft` | One car is on the left. |
| 3 | `irsdk_LRCarRight` | One car is on the right. |
| 4 | `irsdk_LRCarLeftRight` | Cars are on both sides. |
| 5 | `irsdk_LR2CarsLeft` | Two cars are on the left. |
| 6 | `irsdk_LR2CarsRight` | Two cars are on the right. |

## `irsdk_PitSvFlags`

| value | name | meaning |
|---:|---|---|
| 1 (0x0001) | `irsdk_LFTireChange` | Left-front tire change is selected. |
| 2 (0x0002) | `irsdk_RFTireChange` | Right-front tire change is selected. |
| 4 (0x0004) | `irsdk_LRTireChange` | Left-rear tire change is selected. |
| 8 (0x0008) | `irsdk_RRTireChange` | Right-rear tire change is selected. |
| 16 (0x0010) | `irsdk_FuelFill` | Fuel fill service is selected. |
| 32 (0x0020) | `irsdk_WindshieldTearoff` | Windshield tear-off service is selected. |
| 64 (0x0040) | `irsdk_FastRepair` | Fast repair is selected. |

## `irsdk_PitSvStatus`

| value | name | meaning |
|---:|---|---|
| 0 | `irsdk_PitSvNone` | No pit service is active. |
| 1 | `irsdk_PitSvInProgress` | Pit service is in progress. |
| 2 | `irsdk_PitSvComplete` | Pit service completed. |
| 100 | `irsdk_PitSvTooFarLeft` | Car is too far left in the stall. |
| 101 | `irsdk_PitSvTooFarRight` | Car is too far right in the stall. |
| 102 | `irsdk_PitSvTooFarForward` | Car is too far forward in the stall. |
| 103 | `irsdk_PitSvTooFarBack` | Car is too far back in the stall. |
| 104 | `irsdk_PitSvBadAngle` | Car angle is invalid for service. |
| 105 | `irsdk_PitSvCantFixThat` | Requested service cannot fix the issue. |

## `irsdk_VarType`

| value | name | meaning |
|---:|---|---|
| 0 | `irsdk_char` | One-byte character data. |
| 1 | `irsdk_bool` | One-byte Boolean data. |
| 2 | `irsdk_int` | Four-byte signed integer data. |
| 3 | `irsdk_bitField` | Four-byte bitfield data. |
| 4 | `irsdk_float` | Four-byte floating-point data. |
| 5 | `irsdk_double` | Eight-byte floating-point data. |
| 6 | `irsdk_ETCount` | Internal count/sentinel; not a telemetry value type. |
