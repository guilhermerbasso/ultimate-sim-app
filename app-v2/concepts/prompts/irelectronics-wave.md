# irElectronics reference prompt

Create transparent-background, hi-fi motorsport telemetry electronics tell-tales for iRacing controls widgets. Style: clean Bosch DDU/MoTeC-inspired SVG badges, no panel, no border, no title text, highly legible over cockpit video. On states must glow strongly; off/null states must be visibly dim grey.

- `drs`: bold rounded `DRS` badge, centered, bright green fill/outline/glow when `drs === true`; same badge dim grey when false or undefined.
- `pushToPass`: bold italic `P2P` badge with a lightning glyph at the right, electric cyan neon glow when active; dim grey when false or undefined.
- `pushToPassCount`: large remaining-use number, white/cyan glow, with eight pip dots beneath; lit pips equal remaining uses up to eight, grey pips for spent uses; undefined uses an em dash and dim pips.

References copied into `concepts/refs/`: `ref-ir-drs.png`, `ref-ir-p2p.png`, `ref-ir-p2pcount.png`.
