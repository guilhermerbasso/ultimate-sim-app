# ButtonBox Serial Protocol v1

> [!CAUTION]
> **QUARANTINED — this document describes firmware that must not be flashed.**
> It specifies the **ButtonBox firmware v3** management protocol, and
> `firmware/buttonbox_v3/DEPRECATED.md` says *"Do not flash this firmware"*.
> The live protocols are the SIM-X / SimHub one-letter protocol
> (`app-v2/src/main/protocol.ts` + `firmware/sim-x-reference/`) and companion v2
> (`app-v2/src/shared/companion.ts` + `firmware/companion/PROTOCOL.md`).
> See [`HARDWARE-QUARANTINE.md`](./HARDWARE-QUARANTINE.md) (Q2). Kept for
> historical reference only.

Bidirectional, line-based ASCII protocol between the **ButtonBox firmware v3**
(Arduino Pro Micro, ATmega32U4) and the **ButtonBox Manager** desktop app
(Electron, Windows).

It is designed to **coexist with SimHub**: the firmware keeps accepting the same
telemetry lines SimHub already sends, and all management traffic uses a distinct
prefix so the two never collide.

> ⚠️ **Exclusive port.** A Windows COM port can only be opened by **one** process at
> a time. The Manager app and SimHub therefore cannot use the serial port
> simultaneously. The app opens the port in **Configuration mode** and must release
> it before racing (SimHub takes over). The live input monitor uses the HID/Gamepad
> path, not the serial port, so it works regardless.

---

## 1. Transport

| Property | Value |
|---|---|
| Interface | USB CDC (virtual COM port) |
| Baud rate | `115200` |
| Data bits / Parity / Stop | 8 / N / 1 |
| Line ending | `\n` (LF). `\r` is tolerated/ignored on RX. |
| Encoding | 7-bit ASCII |
| Max RX line length (firmware) | **256 bytes** (see §6) |

---

## 2. Line types

The firmware classifies each received line by its **first character**:

| First char | Meaning | Direction | Example |
|---|---|---|---|
| `>` | **Command** (management) | app → firmware | `>MAP?` |
| `<` | **Response** (management) | firmware → app | `<OK` |
| anything else | **Telemetry** (SimHub-compatible) | app/SimHub → firmware | `BB:51.5|MAP:3|TC:5|ABS:2|FUEL:28.4` |

Telemetry lines are parsed exactly as in firmware v2 and drive the OLED. This keeps
**100% backward compatibility** with the existing SimHub Custom Serial template.

General command grammar:

```
>CMD              (no arguments)
>CMD:arg          (single argument)
>CMD:k1=v1;k2=v2  (key/value list, ';' separated)
```

General response grammar:

```
<OK                      success, no payload
<ERR:<reason>            failure (see §5)
<TYPE:<payload>          success with data (payload format per command)
```

Every command produces **exactly one** response line.

---

## 3. Physical events & HID buttons

The ButtonBox exposes **18 HID buttons** (1-based as seen by iRacing/Windows).
There are **18 physical events** that can be mapped to any HID button:

| Event id | Source | Default HID button |
|---|---|---|
| `e1cw` … `e6cw` | Encoder 1–6 clockwise | 1, 3, 5, 7, 9, 11 |
| `e1ccw` … `e6ccw` | Encoder 1–6 counter-clockwise | 2, 4, 6, 8, 10, 12 |
| `sw1` … `sw6` | Encoder 1–6 push button | 13, 14, 15, 16, 17, 18 |

> HID button indices in the protocol are **1-based** (`1`–`18`). The firmware stores
> them 0-based internally and converts. The default map above reproduces firmware v2
> behaviour exactly.

Multiple events may map to the **same** HID button (allowed). An event may not be
"unmapped" in v1 — every event always targets some button (1–18).

---

## 4. Commands

### 4.1 Identify / health

| Command | Response | Notes |
|---|---|---|
| `>ID?` | `<ID:UltimateSimButtonBox;fw=3.0.0;proto=1;enc=6;sw=6;btns=18` | Handshake. App uses this to confirm it found a ButtonBox. |
| `>PING` | `<PONG` | Liveness check. |

`ID` fields: `fw` = firmware semver, `proto` = this protocol version (`1`),
`enc`/`sw`/`btns` = hardware capabilities.

### 4.2 Mapping

| Command | Response |
|---|---|
| `>MAP?` | `<MAP:e1cw=1;e1ccw=2;...;sw6=18` (all 18 pairs, fixed order) |
| `>MAP:e1cw=5;e1ccw=6` | `<OK` (sets only the listed events; others unchanged) |

- A `>MAP:` write applies to **RAM immediately** (takes effect on the next event) but
  is **not persisted** until `>SAVE` (§4.4).
- Partial writes are allowed; send any subset of events.
- Value range is `1`–`18`; out of range → `<ERR:range`.
- Unknown event id → `<ERR:bad_arg`.

`>MAP?` response order is fixed:
`e1cw;e1ccw;e2cw;e2ccw;e3cw;e3ccw;e4cw;e4ccw;e5cw;e5ccw;e6cw;e6ccw;sw1;sw2;sw3;sw4;sw5;sw6`.

### 4.3 Advanced config

| Command | Response | Notes |
|---|---|---|
| `>CFG?` | `<CFG:pulse=80;debounce=50;encmode=pulse` | Current tuning. |
| `>CFG:pulse=100;debounce=40` | `<OK` | Partial writes allowed. |

| Key | Meaning | Range | Default |
|---|---|---|---|
| `pulse` | Encoder HID button pulse length (ms) | 10–250 | 80 |
| `debounce` | Push-button debounce (ms) | 5–200 | 50 |
| `encmode` | Encoder output mode: `pulse` or `hold` | enum | `pulse` |

(`encmode=hold` is reserved for a future firmware; v3 may accept and store it but
implement only `pulse`.)

Like mapping, `CFG` writes apply to RAM immediately and persist on `>SAVE`.

### 4.4 Persistence (EEPROM)

| Command | Response | Action |
|---|---|---|
| `>SAVE` | `<OK` | Write current RAM map+config to EEPROM. |
| `>LOAD` | `<OK` | Reload map+config from EEPROM into RAM. |
| `>RESET` | `<OK` | Restore factory defaults (identity map + default config) in RAM. Caller still issues `>SAVE` to persist. |

On boot the firmware loads from EEPROM if a valid record exists, otherwise applies
factory defaults (see §6).

### 4.5 OLED preview / manual control

Used by the app's **OLED / Telemetria** tab to test the display when SimHub is not
running (remember: exclusive port).

| Command | Response | Action |
|---|---|---|
| `>OLED:BB:51.5|MAP:3|TC:5|ABS:2|FUEL:28.4` | `<OK` | Feed one telemetry payload to the OLED (same parser as SimHub lines). |
| `>OLED:CLEAR` | `<OK` | Clear the OLED. |
| `>OLED:TEXT:line1|line2` | `<OK` | Show up to two free-text lines (test pattern). Optional. |

The payload after `>OLED:` (when it isn't `CLEAR`/`TEXT:`) is handed verbatim to the
existing telemetry parser, so it accepts the exact SimHub string format.

---

## 5. Error responses

| Response | Meaning |
|---|---|
| `<ERR:unknown_cmd` | Command verb not recognised. |
| `<ERR:bad_arg` | Malformed argument or unknown key/event id. |
| `<ERR:range` | Numeric value outside the allowed range. |
| `<ERR:nomem` | Line exceeded the RX buffer (see §6). |

A command that fails leaves device state unchanged.

---

## 6. Firmware implementation notes (for `firmware-v3`)

**RX buffer.** Increase the serial buffer from 64 (v2) to **256** bytes so a full
`>MAP:` write fits. If a line overflows, discard it and reply `<ERR:nomem`.

**Line dispatch (loop):**
```
read chars until '\n':
  if line[0] == '>':  handleCommand(line)
  else if line[0] == '<': ignore   // never sent to us
  else:               parseTelemetry(line)   // SimHub path (unchanged)
```

**Applying the map.** Replace the hard-coded `Joystick.setButton(...)` indices with a
lookup through the in-RAM map (`hidButtonFor[event]`, 0-based). Encoders pulse for
`pulse` ms; push buttons use `debounce` ms.

**EEPROM layout** (ATmega32U4 has 1 KB EEPROM):

| Offset | Size | Field |
|---|---|---|
| 0 | 2 | Magic `0xB0 0x18` |
| 2 | 1 | Schema version = `1` |
| 3 | 18 | `map[18]` — HID button index per event, **0-based** (0–17), event order = §4.2 |
| 21 | 1 | `pulse_ms` |
| 22 | 1 | `debounce_ms` |
| 23 | 1 | `encmode` (0=pulse, 1=hold) |
| 24 | 1 | Checksum = XOR of bytes 2..23 |

On boot: validate magic + checksum; if invalid, write factory defaults.

**Factory defaults.** Identity map (§3 default column, stored 0-based:
`0,1,2,...,17`), `pulse=80`, `debounce=50`, `encmode=pulse`.

**Telemetry parser unchanged.** Keep the v2 `parseSerialLine()` behaviour for OLED so
SimHub keeps working with no template change.

---

## 7. App implementation notes (for `app-comm`)

- Enumerate ports with `serialport`; identify a ButtonBox by sending `>ID?` and
  matching `<ID:UltimateSimButtonBox`.
- One outstanding command at a time; await its single `<...` response with a timeout
  (e.g. 500 ms) before sending the next.
- Detect **port busy** (open fails / access denied) and surface a clear message:
  "Feche o SimHub para configurar o ButtonBox".
- Never hold the port open in the background — open on demand for a config action,
  then close, so SimHub can reclaim it for racing.
- The live input monitor does **not** use this protocol; it reads the HID joystick via
  the Web Gamepad API in the renderer.

---

## 8. Versioning

`proto=1` is reported by `>ID?`. Backward-incompatible changes bump this integer; the
app should check it and warn if the firmware protocol is newer/older than it supports.
