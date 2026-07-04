# Companion Protocol Specification

**Transport:** Serial / USB-CDC · 115 200 bps · 8N1  
**Framing:** every message is terminated by a single `\n` (LF, `0x0A`).  
CR (`\r`) before the LF is silently ignored.  
Maximum message length: **31 printable chars + `\n`** (fits in the firmware's 32-byte buffer).

---

## App → Device (host commands)

| Command | Format | Description |
|---|---|---|
| **Text row** | `T<row>:<text>` | Write `<text>` to OLED row `<row>` (0-indexed). `<row>` is a single digit `0`–`3`. `<text>` is ≤ 21 ASCII chars. Replaces the full row. Clears the big-number display. |
| **Big number** | `N<text>` | Display `<text>` in large font, centred vertically. ≤ 9 ASCII chars. Best used for gear / lap delta. Row 0 is still drawn below it as a status line. |
| **Rev lights** | `R<pct>` | Set rev-light fill to `<pct>` (integer, `0`–`100`). Firmware maps 0–60 % → green, 61–85 % → yellow, 86–99 % → red, 97–100 % → red/white blink. |
| **Shift blink** | `B<0\|1>` | `B1` activates blue shift-blink (overrides `R`). `B0` restores rev-light display. |
| **Matrix** | `M<16hex>` | Update the MAX7219 8×8 matrix. `<16hex>` is exactly 16 uppercase or lowercase hexadecimal digits: 8 rows × 1 byte each, encoded as 2 hex chars per byte, row 0 first. Example: `M183C7E7E3C180000` |
| **LED colour** | `L<idx>:<rrggbb>` | Set addressable LED at zero-based index `<idx>` to the RGB colour `<rrggbb>` (6 hex digits, no `#`). Applied immediately. Example: `L3:FF0000` |
| **Clear** | `C` | Clear all outputs: blank OLED, extinguish all LEDs, clear matrix. |

### Notes

- Commands not in this table are silently discarded.
- If a command is malformed (e.g., `M` with fewer than 16 hex chars, `L` with no colon) the firmware discards it without response.
- The `B` command (shift blink) and the `B<idx>:...` event from the device (button state) are **disambiguated by direction**: the host only sends `B<0|1>`, the device only sends `B<idx>:<0|1>`.

---

## Device → App (input events)

| Event | Format | Description |
|---|---|---|
| **Button** | `B<idx>:<state>` | A button changed state. `<idx>` is zero-based (0 to `NUM_BUTTONS-1`). `<state>` is `1` (pressed, active-low) or `0` (released). Sent immediately after debounce settling. |
| **Encoder** | `E<idx>:<delta>` | A rotary encoder moved one detent. `<idx>` is zero-based (0 to `NUM_ENCODERS-1`). `<delta>` is `+1` (clockwise) or `-1` (counter-clockwise). Sent once per detent. |
| **Analog** | `A<idx>:<value>` | An analog axis reading changed significantly. `<idx>` is zero-based (0 to `NUM_ANALOG-1`). `<value>` is `0`–`1023` (10-bit ADC). Rate-limited to one event per `ANALOG_RATE_MS` ms **and** only emitted when the reading changes by ≥ `ANALOG_DEADBAND` counts. |

### Timing guarantees

| Parameter | Default | `#define` |
|---|---|---|
| Button debounce | 20 ms | `DEBOUNCE_MS` |
| Analog min period | 50 ms | `ANALOG_RATE_MS` |
| Analog dead-band | ±8 counts | `ANALOG_DEADBAND` |
| Encoder detent size | 4 quadrature steps | Hard-coded (EC11 standard) |

---

## Example session

```
# App → Device: gear 5, 72 % revs, shift blink OFF
T0:Lap 12 / 30
T1:ERS: 87%
N5
R72
B0

# Device → App: encoder 0 clockwise, button 2 pressed, axis 0 reading
E0:+1
B2:1
A0:512

# App → Device: set matrix to a checkerboard
MAA55AA55AA55AA55

# App → Device: clear everything at session end
C
```

---

## Protocol version

**v1.0** — matches `companion.ino` r1 and the Ultimate ButtonBox app's  
"Custom Serial Device" companion preset.  
Breaking changes will increment the major version.
