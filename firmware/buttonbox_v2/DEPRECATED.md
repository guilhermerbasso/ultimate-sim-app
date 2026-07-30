# ⚠️ DEPRECATED — `buttonbox_v2`

**Do not flash this firmware and do not wire a rig for it.**

`buttonbox_v2.ino` targets a 6-encoder topology whose wiring comes from the
quarantined `WIRING.csv`, and its serial mapping does not match the canonical
SIM-X protocol the app and SimHub speak
(`app-v2/src/main/protocol.ts`).

The SIM-X Button Box must run the firmware in
[`../sim-x-reference/`](../sim-x-reference/README.md), which declares a
different pinout (`pinout.h`: 3× CD74HC4067, 4 encoders, WS2812B rev lights on
`D10`) and uses the one-letter SimHub commands
(`R` / `B` / `O` / `D` / `S` out, `E<idx>:±1` in).

The matching SimHub Custom Serial mapping, `simhub/custom_serial_bb.md`, is
quarantined for the same reason.

See [`../../docs/HARDWARE-QUARANTINE.md`](../../docs/HARDWARE-QUARANTINE.md)
(Q1, Q3). This folder is kept only as historical reference. Treat the whole
tree as read-only.
