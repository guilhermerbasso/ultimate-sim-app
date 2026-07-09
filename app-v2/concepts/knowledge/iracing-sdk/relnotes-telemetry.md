# iRacing release-notes telemetry changes

Sources note: Distilled from iRacing Release Notes History (not reproduced here).

## Chronological telemetry-impact summary

- **2024 Season 3 Patch 2 [2024.06.28.01]** — The race server name began appearing in the Session string. Dashboard apps can retain server identity in session metadata and logs.
- **2024 Season 4 [2024.09.03.02]** — A live-telemetry dropout bug was fixed. Consumers should see fewer transient gaps in dashboards and telemetry recorders.
- **2024 Season 4 Patch 1 [2024.09.06.02]** — Current precipitation telemetry was changed to reflect actual rainfall at the start/finish line. Weather pages should treat this as a more location-specific rain signal.
- **2024 Season 4 Patch 2 Hotfix 1 [2024.09.25.03]** — Push-to-pass telemetry was expanded with `P2P_Count` and `P2P_Status`. Dashboards can show remaining P2P allowance and active deployment state for supported cars.
- **2025 Season 1 Vehicle Telemetry Update [2025.02.18.01]** — iRacing introduced a separate anonymized race-data telemetry collection system for selected official series. The existing SDK/IBT telemetry used by Atlas, MoTeC, and third-party apps was stated to remain unchanged, so app integrations should not need protocol changes for this collection program.
- **2025 Season 2 [header date: 2024.03.10.03]** — Added `SteeringFFBEnabled`, a Boolean showing whether force feedback is enabled in simulator options. Also added `SessionInfo:CurrentSessionNum` to make a Session string self-identify its originating session. Apps can diagnose FFB configuration and bind session metadata more safely.
- **2025 Season 2 Patch 5 [header date: 2024.05.06.01]** — Safety Rating formatting in the Session string dropped the leading zero. Parsers should avoid depending on fixed-width SR text.
- **2025 Season 3 [header date: 2024.06.10.01]** — Tire compound type metadata was added under driver tire information in the Session string, mapping tire indexes such as `PitSvTireCompound` and `PlayerTireCompound` to compound categories. `WeekendInfo:TrackLength` resolution increased from 10 m to 10 cm, improving distance-dependent calculations.
- **2025 Season 3 Patch 4 [2025.07.25.02] / 2025 Season 4 [2025.09.08.02]** — Added `PitRepairNeeded` and `PitOptRepairNeeded` Boolean telemetry variables for mandatory and optional repair needs. Pit pages can show repair requirements without deriving them only from repair-time-left channels.
- **2026 Season 1 Patch 2 [2026.01.02.01]** — Secondary incident limits were added to the Session string as `IncidentWarningInitialLimit` and `IncidentWarningSubsequentLimit`. Race-control widgets can distinguish initial and subsequent warning thresholds.
- **2026 Season 2 Initial Release [2026.03.09.03]** — Fixed possible corruption of `CarDesignStr` in the session screen during AI races. Apps using session-screen car paint/design metadata should see more reliable values.
- **2026 Season 2 UI updates** — Driver-input telemetry widgets gained history/timeline and graph readability options, including an undock/dock workflow for the telemetry overlay. This does not change SDK channel names, but it confirms iRacing's own UI is exposing more telemetry-history concepts.
- **2026 Season 2 UI fix** — The pedal-input ABS telemetry graph no longer moves while replay playback is paused. Replay-aware dashboards should similarly freeze time-history widgets when replay time is stopped.
- **2026 Season 3 Patch 1 [2026.06.12.02]** — Telemetry logging can optionally include all cars in a session via `[Misc] irsdkLogAllCars=1`, allowing `CarIdxXXX` arrays to grow to the entries-table size. Standings, relatives, and multi-car analysis pages can use complete field data when the user enables this setting.
- **2026 Season 3 Patch 2 [2026.06.24.02]** — Fixed pace-car telemetry collection. Pace-car and caution-state analysis should have fewer missing or incorrect records.
