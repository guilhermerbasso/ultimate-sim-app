# Coach Intent & Racecraft — Research & Design (Phase 0)

> **Goal:** Elevate the LOCAL AI Coach / AI Engineer from "math by fixed thresholds" to
> **context-, intent- and RACECRAFT-awareness**, staying **100% deterministic, explainable and
> local-first** — no cloud LLM, no black-box ML. The local LLM only *verbalizes* a decision that
> the deterministic core already made. **Silence > noise.**

This document is the mandatory Phase-0 deliverable: it summarizes the research (with citations),
states what applies / does not apply to our case and why, validates the findings against the
current code, and records the resulting design decision per problem. Research was run with parallel
web + GitHub research agents (fleet) plus targeted web search.

---

## 1. Problem statement

Today `analyzeLap()` (`src/shared/coach.ts`) is a sequence of hardcoded rules with ~30 fixed
thresholds (e.g. coast = `throttle ≤ 0.08 && brake ≤ 0.05 && speed ≥ 80`). It has **no confidence
score** and — critically — **only reads the ego car**: it never consumes racecraft signals
(other cars, flags, pace). So any deliberate deviation from the ideal line (attacking, defending,
giving room, avoiding an incident, saving fuel/tyres, a yellow/blue flag, a wet patch, an out/in
lap) is misread as an ERROR. The coach must **infer intent** from many signals over a time window
before calling anything a mistake, and **stay silent** when it is not confident.

---

## 2. Findings by topic

### A) How real telemetry-coaching tools detect errors (and separate error from choice)

**Key finding (decisive):** Mainstream tools (MoTeC i2, Track Titan, Trophi.ai, Garage61, VRS,
Racelogic/VBOX, Driver61, Coach Dave/Delta) all use the same **reference-lap comparison + delta
attribution** workflow, and there is **little/no public evidence that any of them infer race
intent** (traffic/defending/fuel-save) before labelling a deviation. They *assume comparable clean
laps* and leave intent to the human. The universal lesson for us:
**line deviation alone must never produce coaching** — use it only as a hypothesis, then confirm
with delta + inputs + vehicle state + context.

- Standard workflow: pick reference → align by lap distance → plot delta/time-variance → find where
  delta grows → inspect brake/throttle/speed/steering/gear/line at that spot.
- Concrete metrics tools use: brake point / pressure / release; throttle pickup / full-throttle
  point; coast / pedal-transition time; **minimum corner speed** and its location; entry/apex/exit
  speed; delta derivative; racing line; steering corrections; lockup/ABS/TC.
- Cited numbers worth reusing as *reference*, not universal thresholds:
  - Track Titan example: reference apex min-speed **152 kph** vs analysed **138 kph**, exiting
    **4 kph** faster → loss attributed to earlier braking + delayed throttle + too long at min speed.
    <https://www.tracktitan.io/post/how-to-analyse-telemetry-for-sim-racing>
  - Garage61 / Braking Lab braking-zone features: peak brake pressure, entry speed, exit speed;
    **trail-brake score = 70% release smoothness + 30% peak-hold duration**; brake curves
    downsampled to **10 samples/s**. <https://www.brakinglab.com/en/docs/telemetry/lap-comparison>
  - Driver61: braking **10 m later ≈ 0.2 s**; final brake release smooth over last **10–20%**;
    balanced-throttle phase ~**10–20% throttle** before opening steering; six corner phases
    (braking, trail-braking, pedal transition, balanced throttle, increasing throttle, max throttle).
    <https://driver61.com/uni/braking/>, <https://driver61.com/uni/corner-phases/>,
    <https://driver61.com/uni/racing-line/>
  - Coach Dave **Delta / Auto Insights** breaks each corner into **braking, entry, apex, exit** and
    says which phase cost time; recommends a trusted reference under similar conditions.
    <https://coachdaveacademy.com/delta/>
  - VRS / Coach Dave both **require comparable conditions** ("Default Weather", same car/track state)
    and consistency **before** coaching. <https://virtualracingschool.com/academy/iracing-career-guide/season-one/using-datapacks/>
- MoTeC i2 = math channels + delta/time-variance plots; analysis, **not** automated intent.
  <https://www.motec.com.au/products/I2>

**Applies:** reference comparison *gated by context*; delta-derivative to localize loss; the
corner-phase model; multi-signal error evidence; confidence/silence; per-driver baseline.
**Does NOT apply:** fixed global thresholds; a single ideal line; reference mimicry; delta-only
coaching; opaque "AI" claims without explainability.

### B) Driver-intent inference (deterministic, rule-based)

**Recommendation:** a **deterministic rule registry + fuzzy scoring + FSM phase gating + evidence
fusion + hysteresis**, explicitly **avoiding black-box ML** (needs data/training, hurts determinism
& explainability — Rudin, "stop explaining black box models", <https://arxiv.org/abs/1811.10154>).

- **Fuzzy logic** turns continuous signals into degrees in `[0,1]` instead of brittle true/false
  thresholds — ideal for brake pressure, steering angle, throttle ramp, yaw error.
  <https://plato.stanford.edu/entries/logic-fuzzy/>
- **Finite state machines / probabilistic FSMs + fuzzy logic** are used in the maneuver-recognition
  literature (Hulnhagen et al., <https://doi.org/10.1109/ivs.2010.5548066>) and map cleanly to
  racing phases: approach → brake → rotate → apex → exit. <https://en.wikipedia.org/wiki/Finite-state_machine>
- **Evidence fusion**: combine multiple weak signals into one confidence (weighted mean; optionally
  Dempster–Shafer for explicit "unknown/conflict", <https://en.wikipedia.org/wiki/Dempster%E2%80%93Shafer_theory>).
- **Hysteresis / debounce**: require confidence to cross an *enter* threshold and later fall below a
  lower *exit* threshold so decisions don't flip-flop on noise.
  <https://en.wikipedia.org/wiki/Hysteresis>
- Each rule returns `{ intent, confidence 0..1, evidence[], missingEvidence[], contradicting[] }`;
  decision rule: **flag an error only if `max(intent.confidence) < threshold` AND error evidence is
  strong.** Explanation is a first-class output ("not flagged because trail-braking intent = 0.78").
- Driver-intent / lane-change / overtaking-intention literature background: Xing/Lv/Cao chapters
  (<https://doi.org/10.1016/B978-0-12-819113-2.00005-1>), HMM/semi-Markov approaches
  (<https://doi.org/10.1109/TVT.2020.3011672>). We take the *structure* (phases, evidence, windows),
  not the trained models.

**Applies strongly:** fuzzy memberships, FSM phases, sliding windows, evidence fusion, explainability
first. **Applies with caution:** Dempster–Shafer / Bayesian nets (overkill initially). **Does NOT
apply:** deep learning / RNNs / trained HMMs; pure fixed thresholds; single ideal line.

### C) iRacing racecraft signals (authoritative SDK values)

Source hierarchy: `irsdk_defines.h` (via `Friss/iracing-sdk-js`), `kutu/pyirsdk` (`irsdk.py` +
`vars.txt`), official telemetry PDF (`margic/iracing-mcp`), and live-capture interpretation
(`Boucher-David/TMROverlay`) + a proven relative-gap implementation (`isaachansen/trailbrake`).

- **`CarLeftRight`** (`int` enum, **local player only** — does not say which CarIdx):
  `0 Off · 1 Clear · 2 CarLeft · 3 CarRight · 4 CarLeftRight (both) · 5 2CarsLeft · 6 2CarsRight`.
  Left = {2,4,5}, Right = {3,4,6}. `≥ 2` → **cars alongside / battle → give room / attack / defend.**
  <https://github.com/Friss/iracing-sdk-js/blob/main/src/cpp/irsdk/irsdk_defines.h>
- **`SessionFlags`** (u32 bitfield, `irsdk_Flags`): `checkered 0x1 · white 0x2 · green 0x4 ·
  yellow 0x8 · red 0x10 · blue 0x20 · debris 0x40 · crossed 0x80 · yellowWaving 0x100 ·
  oneLapToGreen 0x200 · greenHeld 0x400 · tenToGo 0x800 · fiveToGo 0x1000 · caution 0x4000 ·
  cautionWaving 0x8000`; per-car via `CarIdxSessionFlags[64]` includes `blue 0x20`,
  `black 0x10000`, `repair (meatball) 0x100000`. <https://github.com/kutu/pyirsdk/blob/master/irsdk.py>
- **No explicit Safety Car / VSC boolean.** Full-course caution = `SessionFlags & caution (0x4000)`
  and/or `PaceMode != 4`. `cautionWaving (0x8000)` precedes `caution`.
- **`PaceMode`** (`int` enum): `0 SingleFileStart · 1 DoubleFileStart · 2 SingleFileRestart ·
  3 DoubleFileRestart · 4 NotPacing`. `!= 4` → under pace/formation → **no racing moves**.
  Per-car `CarIdxPaceFlags`: `endOfLine 0x1 · freePass 0x2 · wavedAround 0x4`.
- **`SessionState`** (`int` enum): `0 Invalid · 1 GetInCar · 2 Warmup · 3 ParadeLaps · 4 Racing ·
  5 Checkered · 6 CoolDown`. `< 4` → pre-green (no racing moves). It's a *phase*, not the session
  *type* (type comes from the YAML `SessionInfo.Sessions[].SessionType`).
- **Proximity is DERIVED** (no per-car X/Y). Standard signed track-time gap (proven in
  `isaachansen/trailbrake`), folding the S/F wrap into `[-lapLen/2, +lapLen/2]`:
  ```ts
  function relativeGap(carEst, playerEst, carLap, playerLap, lapLenS) {
    const lapDelta = carLap - playerLap, raw = carEst - playerEst;
    if (lapDelta !== 0) return lapDelta * lapLenS + raw;
    const m = ((raw % lapLenS) + lapLenS) % lapLenS;
    return m > lapLenS / 2 ? m - lapLenS : m; // >0 ahead, <0 behind
  }
  ```
  **Battle** ≈ `|gap| < ~1.5 s`. Physical distance ≈ `|Δ lapDistPct| * trackLengthM`. Continuous
  battle metric = `CarIdxLap + CarIdxLapDistPct`. `CarIdxEstTime` is more reliable than
  `CarIdxF2Time` (placeholder for ~first 8 min of a race).
- **Sectors are AUTHORITATIVE** via session YAML `SplitTimeInfo.Sectors[] = { SectorNum,
  SectorStartPct }` (fractions of the lap; Sector 0 at 0.000). Same scale as `lapDistPct`.

**Applies:** every racecraft intent (attack/defend/give-room/avoid/yield-under-flag/pace) maps to
real signals we already ingest. **Does NOT exist (use proxies/stubs):** VSC, per-car lateral meters,
"which CarIdx is alongside", marbles, track-limits/off-track (only `CarIdxTrackSurface` 0=OffTrack).

### D) Extensible rules-registry architecture (TypeScript)

- Prefer a **small, domain-specific registry of rule objects (Strategy pattern)** over a generic
  production-rule engine — Fowler warns generic engines add implicit flow & debugging cost
  (<https://martinfowler.com/bliki/RulesEngine.html>); Strategy avoids bloated conditionals
  (<https://refactoring.guru/design-patterns/strategy>); Registry is the lookup
  (<https://martinfowler.com/eaaCatalog/registry.html>). `json-rules-engine` is good *vocabulary*
  (facts, priorities, cached almanac) but is boolean/event-oriented, not graded-confidence-first
  (<https://github.com/CacheControl/json-rules-engine>).
- **Sliding windows over ring buffers** (fixed memory) for time/distance/lap windows —
  <https://en.wikipedia.org/wiki/Circular_buffer>, windowing concept
  <https://nightlies.apache.org/flink/flink-docs-master/docs/dev/datastream/operators/windows/>.
- **Confidence** = normalized weighted sum of `severity · repeatability · baselineDeviation ·
  signalQuality`; pick winner by max; optional softmax for UI ranking only (not a calibrated
  probability). Min-max normalization <https://en.wikipedia.org/wiki/Feature_scaling>.
- **Local-first persistence:** JSON under `app.getPath('userData')` with an explicit
  `schemaVersion` + startup migration (mirrors our existing settings/driver-notes/spotter/strategy
  stores). <https://www.electronjs.org/docs/latest/api/app#appgetpathname>

### E) Distinguishing driver STYLE from ERROR (personal baselines)

- Compare against the driver's **own clean laps** (personal best + a robust "style" baseline), not
  only an alien reference. A repeated deliberate pattern = style/strategy, not a mistake (unless it
  keeps costing time). <https://sarahmooreracing.com/how-drivers-can-use-telemetry-data-to-improve-racing-skills/>
- **Robust statistics, no training:** per-corner `median` + `MAD` (outlier-resistant,
  <https://en.wikipedia.org/wiki/Median_absolute_deviation>) with an **EMA** for gradual adaptation
  updated **only from clean laps**; robust limit `median + k · 1.4826 · MAD`; reject outliers with
  robust z-score before learning.
- **Repetition detection (signal vs noise) via SPC/Western-Electric-style run rules:** flag when the
  same intent+corner occurs in **≥ 2 of last 3** clean laps (or **≥ 3 of last 5**), else keep as
  "observation". <https://en.wikipedia.org/wiki/Western_Electric_rules>
- State machine: `single → observation`; `2/3 laps → likely issue`; `3/5 + confidence>thr → coach`;
  `stable over many clean laps → style (unless persistent time loss)`.

---

## 3. Validation against the current code

| Research signal | Current code state | Gap to close |
|---|---|---|
| Reference/delta attribution | ✅ `biggestTimeLossZone`, `deltaToBestSec`, bidirectional corner findings (`coach.ts`) | Keep; gate by context/intent before flagging |
| Corner-phase model | ✅ `phaseForSample` entry/mid/exit; corner map auto-numbers **Turn 1..N** (`track-map/corner-map.ts`) | Reuse for evidence + Turn locator |
| Official sectors (SplitTimeInfo) | ✅ already read (uneven sector starts — `proactive-engineer.test.ts:78`) | Unify Turn↔Sector into one **track catalog** |
| Racecraft signals | ⚠️ **present in telemetry but NOT consumed by coach**: `carLeftRight`, `relatives.gapSec`, `radarCars`, `flags`, `sessionState`, `paceMode/paceFlags` | Feed into an enriched context sample + intent registry |
| Confidence / silence | ❌ no `confidence` field anywhere | Add `confidence`/`intent`/`intentEvidence` to `CoachFinding` + silence gate |
| Per-driver baselines / repetition | ❌ none persisted for the coach (driver-notes/spotter/strategy stores exist as the pattern) | New `userData/coach-baselines.json` (car+track) + median/MAD/EMA + 2-of-3 repetition |
| Registry / plugability | ❌ hardcoded if/switch in `analyzeLap` | New `src/shared/driver-intent.ts` rule registry (Strategy) |
| LLM role | ✅ local `node-llama-cpp` used only for phrasing/passthrough; `intent-router.ts` = **user voice commands** (name clash → new engine uses `driver-intent`) | LLM verbalizes decided findings only; fix PT persona "Always answer in American English" |
| Out-lap suppression precedent | ✅ proactive engine already discards out-laps un-analysed (`proactive-engineer.ts` `outLap`) | Generalize into context/intent suppressors |

**Architectural anchor:** both `LiveCoachEngine` and `proactive-engineer.ts` consume the shared
`analyzeLap → buildCoachReport`. Implementing the intent gate inside the shared core makes **both**
consumers context-aware with no duplicated logic.

---

## 4. Design decision (per problem)

1. **Intent model** — deterministic **rule registry** in `src/shared/driver-intent.ts`. Each intent
   is a pluggable rule `evaluate(ctx) → { confidence 0..1, evidence[] } | null` reading named signals
   over a **sliding window**; scoring uses **fuzzy memberships** (no hard true/false), **FSM phase**
   gating (entry/mid/exit) and **weighted evidence fusion**; winner by max confidence; **hysteresis**
   on the speak decision. Justification: deterministic, explainable, local-first, extensible without
   touching the core (topics B & D).
2. **Golden rule (decision)** — a candidate loss event becomes a **finding** only if **no** legitimate
   intent explains it with `confidence ≥ threshold`, **AND** it **repeats lap-to-lap** (baseline),
   **AND** there is **real measured time loss**. Otherwise → **silence** or record as neutral
   **context** ("Defensive line in T4 — car on the right, ok."). Justification: topic A's universal
   rule + topic E's repetition gate.
3. **Track catalog (Turn ↔ Sector)** — `src/shared/track-catalog.ts` + `userData/track-catalog.json`
   keyed by `trackLayoutKey`: unify **Turn 1..N** (corner map) with **Sector 1..N** (SplitTimeInfo,
   fallback 3) and map each Turn to its Sector. Enables **detailed** feedback that cites both.
4. **Context-grounded phrasing** — every finding cites **Turn N + Sector M** together, the specific
   dimension in plain words ("virou pouco o volante"), the **time lost in seconds**, the raw signal,
   the **discarded intent + evidence**, and a comparison vs personal best/baseline. Target line:
   *"Na Turn 13 (Sector 3) você virou pouco o volante e perdeu 1.0s vs. sua melhor volta."*
5. **Local memory** — `userData/coach-baselines.json` per car+track: per-corner median/MAD/EMA of
   brake point, min speed, throttle pickup, style; lap-to-lap repetition (2-of-3 / 3-of-5). Adapts
   thresholds to the driver so **style ≠ error**. Local-first, never uploaded.
6. **Confidence + UI sensitivity** — `confidence` on findings; a UI **sensitivity slider**
   (config-backed) sets the silence threshold. Below threshold → no finding, no voice.
7. **LLM + voice only verbalize** — pass the decided finding (intent + evidence + Turn/Sector as
   context) to the deterministic phrasing and the existing local voice stack (Piper/Sherpa TTS,
   Whisper STT, wake-word); improve PT-BR/EN phrasing; the LLM never decides.

---

## 5. Intent catalogue mapped to real signals

| # | Intent (category) | Primary signals (all present in our telemetry) | Verdict |
|---|---|---|---|
| A1 | Attack (late-brake / dive-bomb) | `relatives.ahead.gapSec` small closing, brake later than baseline, controlled inputs | not a finding |
| A2 | Defend (defensive line) | `relatives.behind.gapSec` small, off-line but stable | not a finding |
| A3 | Side-by-side / give room | `carLeftRight` ∈ {2..6}, `carLeftRightCount` | not a finding |
| A4 | Avoid incident / traffic | gap collapsing, `CarIdxTrackSurface` OffTrack ahead, slow car, sudden lift/steer | never a finding |
| A5 | Being overtaken / blue | `flags.blue` (per-car), lift while faster car alongside | not a finding |
| B1 | Lift-and-coast (fuel) | end-of-stint, `fuelLevelPct`/`fuelPerLap` plan, early lift pattern, small loss | not a finding |
| B2 | Tyre/brake save | high `tyres.*.wearPct`/temps, `brakeTempC`, reduced peak inputs over stint | not a finding |
| B3 | Out/in-lap, warm-up, cool-down | `sessionState` 2/3/6, `onPitRoad`, lap 1 after pit | not a finding |
| C1 | Yellow / double-yellow | `flags.yellow`/`yellowWaving` | mandatory lift, not a finding |
| C2 | Blue (yield to leaders) | per-car `blue` | not a finding |
| C3 | White / last lap | `flags.white` | context |
| C4 | Safety car / caution / pace | `flags.caution`/`cautionWaving` or `paceMode != 4` | not a finding |
| C5 | Wet / low grip | `trackWetnessPct`/`gripPct`/`isRaining` | not a finding |
| C6 | Track limits / marbles | **stub** — only `CarIdxTrackSurface`; no marbles signal | extensible stub |
| D  | Real error | none of the above explains it, repeats lap-to-lap, measurable loss | **finding** |

---

## 6. References (consolidated)

Coaching tools: MoTeC i2 <https://www.motec.com.au/products/I2> · Track Titan
<https://www.tracktitan.io/post/how-to-analyse-telemetry-for-sim-racing> · Trophi.ai
<https://www.trophi.ai/post/how-to-use-iracing-telemetry-to-find-faster-lap-times-a-practical-guide> ·
Garage61 <https://garage61.net/docs/usage> · Braking Lab
<https://www.brakinglab.com/en/docs/telemetry/lap-comparison> · VRS
<https://virtualracingschool.com/academy/iracing-career-guide/season-one/using-datapacks/> ·
Racelogic/VBOX <https://www.vboxmotorsport.co.uk/en/circuit-tools> · Driver61
<https://driver61.com/uni/braking/>, <https://driver61.com/uni/corner-phases/> · Coach Dave/Delta
<https://coachdaveacademy.com/delta/>.

Intent inference: fuzzy logic <https://plato.stanford.edu/entries/logic-fuzzy/> · FSM+fuzzy maneuver
recognition <https://doi.org/10.1109/ivs.2010.5548066> · interpretable-over-blackbox (Rudin)
<https://arxiv.org/abs/1811.10154> · Dempster–Shafer
<https://en.wikipedia.org/wiki/Dempster%E2%80%93Shafer_theory> · hysteresis
<https://en.wikipedia.org/wiki/Hysteresis>.

iRacing SDK: `irsdk_defines.h`
<https://github.com/Friss/iracing-sdk-js/blob/main/src/cpp/irsdk/irsdk_defines.h> · pyirsdk
<https://github.com/kutu/pyirsdk/blob/master/irsdk.py> + `vars.txt`
<https://github.com/kutu/pyirsdk/blob/master/vars.txt> · relative-gap impl
<https://github.com/isaachansen/trailbrake/blob/main/crates/iracing-connector/src/connector.rs> ·
SDK interpretation
<https://github.com/Boucher-David/TMROverlay/blob/main/skills/tmr-overlay-context/references/iracing-sdk-telemetry-interpretation.md>.

Architecture & baselines: Strategy <https://refactoring.guru/design-patterns/strategy> · Registry
<https://martinfowler.com/eaaCatalog/registry.html> · RulesEngine caveat
<https://martinfowler.com/bliki/RulesEngine.html> · json-rules-engine
<https://github.com/CacheControl/json-rules-engine> · circular buffer
<https://en.wikipedia.org/wiki/Circular_buffer> · Flink windows
<https://nightlies.apache.org/flink/flink-docs-master/docs/dev/datastream/operators/windows/> ·
MAD <https://en.wikipedia.org/wiki/Median_absolute_deviation> · Western Electric rules
<https://en.wikipedia.org/wiki/Western_Electric_rules> · Electron userData
<https://www.electronjs.org/docs/latest/api/app#appgetpathname>.

---

## Implementation status (living)

- **Fase 0** ✅ `docs/coach-intent-research.md`.
- **Fase 1** ✅ `src/shared/driver-intent.ts` (registry + fuzzy + window + confidence),
  catalogues `driver-intent-{racecraft,management,conditions}.ts` + `driver-intent-catalog.ts`,
  context frame in `coach.ts` (`CoachContextSample` + `coachContextFromSnapshot`), decision core
  `coach-intent-gate.ts` (golden rule + zero-regression no-op) wired into `analyzeLap`/`buildCoachReport`
  and both consumers (LiveCoachEngine + proactive-engineer).
- **Fase 2** ✅ confidence/intent fields + silence gate; `track-catalog.ts` (Turn↔Sector);
  context-grounded phrasing (`groundedFindingText`, `Turn N (Sector M)` locator); ui-sensitivity (in progress).
- **Fase 3** ✅ `coach-baseline.ts` + `coach-baselines.ts` (median/MAD/EMA + 2-of-3 repetition);
  wired into the proactive engine (load baseline → gate → record lap events).
- **Fase 4** llm-phrasing + voice (in progress).
- **Fase 5** integration tests ✅ (`coach-intent-integration.test.ts`, 8/8: A–D categories + silence +
  zero-regression); full validate + PR pending.

