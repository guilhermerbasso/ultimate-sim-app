# ⚠️ DEPRECATED — `buttonbox_v3`

**Do not flash this firmware.** It implements a proprietary serial protocol
(`>ID?` / `MAP` / `CFG` / `SAVE`) that is **incompatible** with the SimHub
protocol the app and SimHub itself now speak.

The SIM-X Button Box must run the firmware in
[`../sim-x-reference/`](../sim-x-reference/README.md), which uses the simple
one-letter SimHub commands (`R` / `B` / `O` / `D` / `S` out, `E<idx>:±1` in).

This folder is kept only as historical reference so the design notes in
`usb_identity.md` and the `config_store.*` source aren't lost. Treat the
whole tree as read-only.
