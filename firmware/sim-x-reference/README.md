# SIM-X Button Box · firmware de referência

This folder is the **canonical reference firmware** for the SIM-X Button Box
(Arduino Pro Micro, 32 HID buttons + POV hat + 4 rotary encoders + OLED + 4
WS2812B rev LEDs + start LED).

> ⚠️ **Grave ESTE firmware no Pro Micro.** O app Electron e o SimHub falam
> exatamente o mesmo protocolo serial; trocar para um firmware proprietário
> (como o antigo `firmware/buttonbox_v3/`) quebra a comunicação.

## Files

| File | Purpose |
|---|---|
| `button_box.ino` | Main sketch — HID Joystick (32 buttons + hat), serial RX/TX, OLED, NeoPixel rev lights |
| `pinout.h` | Pin assignments and board macros |
| `SOURCE_README.md` | Original README that ships with the firmware repo |

These files are copied verbatim from
`~/Documents/SIM-X-ButtonBox/05_firmware_arduino/button_box/` and **must not be
edited from inside the app project**. Make changes upstream and re-copy.

## SimHub protocol (one-letter commands)

App → box (`\n` terminated):

| Command | Meaning |
|---|---|
| `R<lvl>` | Rev lights level, `0..N` (firmware caps at the strip length) |
| `B<0\|1>` | Shift indicator (firmware does the blue blink) |
| `O<l1>\|<l2>\|<l3>` | OLED, three lines (≤21 chars each) |
| `D<num>` | OLED BIGNUM (≤9 chars, digits / `+` / `-` / `.` only — logisoso38 font) |
| `S<0\|1>` | Start LED |

Box → app (`\n` terminated):

| Event | Meaning |
|---|---|
| `E<idx>:+1` / `E<idx>:-1` | Encoder click (4 encoders, idx `0..3`) |

The 32 HID buttons and the POV hat are **read in the renderer through the
Web Gamepad API** — they are never sent over serial.

## Flashing

1. Open `button_box.ino` in the Arduino IDE.
2. Board: **Arduino Leonardo** (the Pro Micro is pin-compatible).
3. Required libraries: `Joystick` (Matthew Heironimus), `Adafruit_NeoPixel`,
   `U8g2`, `Encoder`.
4. Upload. The Pro Micro will appear as a HID gamepad on Windows and as a CDC
   serial port — pick the COM in the app's *Dispositivos* tab.
