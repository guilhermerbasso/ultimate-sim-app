# P1 Wave — Chassis / motion telemetry (irChassis group)

Per-asset gpt-image flow: validated American-English prompt → gpt-image → image-QA →
build clean SVG widget (`hifi/widgets/irChassis`) → visual-QA vs reference.

All widgets are clean by convention: transparent, title-less/self-explanatory, no panel
fill, no border, no logos, generous margins, Bosch DDU / MoTeC-style typography.
References used here are copied into `concepts/refs/`.

| Widget id | Channel (snapshot field) | Reference | Unit |
|---|---|---|---|
| `attitude` | `pitchRad`, `rollRad` | `ref-ir-attitude.png` | artificial horizon |
| `yawRate` | `yawRateRadSec` | `ref-ir-yawrate.png` | deg/s |
| `ffbTorque` | `steeringTorquePct` | `ref-ir-ffbtorque.png` | % |
| `vertG` | `vertAccelG` | modelled on irVitals digital readout | g |
| `altitude` | `altitudeM` | modelled on irVitals digital readout | m |

## Prompts (American English)

**attitude** — Ultra-clean sim-racing dashboard WIDGET reference, fully TRANSPARENT
background (alpha), no scene, no car, no logos, no title text. Subject: circular
GT3 chassis ATTITUDE artificial horizon, cyan sky and dark graphite ground split by
a white horizon line, tilted slightly by roll, with a fixed white center chevron and
small pitch ladder marks labelled 10 and 20. Bosch DDU / MoTeC style, front-on flat
2D UI, crisp anti-aliased vector edges, high contrast, no panel fill, no border.

**yawRate** — Ultra-clean transparent GT3 yaw-rate widget reference: one large cyan
digital number "12" with small "deg/s" unit, a small curved rotation glyph below,
and a center-zero horizontal scale from -90 to 90 with dense ticks and an amber
triangle marker slightly right of center. No title, no frame, no background.

**ffbTorque** — Ultra-clean transparent force-feedback torque widget reference:
large cyan digital number "42" with a small "%" unit, directly above a thin 0–100%
horizontal scale. The bar transitions cyan through amber to red near clipping, with
0, 25, 50, 75, 100 labels. No title, no frame, no panel fill.

**vertG** — Clean GT3 dashboard digital readout for vertical G-load: large signed
number "+0.90" with small "g" unit, plus a subtle center-zero hairline bar below.
Transparent, no title, no frame, MoTeC/Bosch DDU typography.

**altitude** — Clean GT3 dashboard digital readout for altitude: large number "120"
with small "m" unit and a subtle min-to-max hairline micro-scale below. Transparent,
no title, no frame, crisp high-contrast typography.

## Prompt-validation checklist

Subject ✓ · exact telemetry shown ✓ · clean transparent layout ✓ · GT/DDU theme ✓ ·
no titles / no logos / no panel / no border / no overlap ✓ · American English ✓.
