# Companion iFlag firmware

Arduino firmware for the Hardware Hub **RGB Matrix (iFlag)** companion device: an 8x8 WS2812/WS2812B RGB matrix driven by the app's Companion Protocol v2 over serial.

> **This firmware is the supported path for the iFlag.** The app drives the matrix
> with the frames documented below (`Y<brightness>` + `Q<row>:<hex>`, and `P<hex…>`
> for strips). A stock iFlag flashed with **SimHub**, **WLED**, FastLED demos, or any
> other sketch speaks a *different* protocol and will **not** light up from this app —
> it will silently ignore `Q`/`Y`/`P`. If your iFlag does not light, flash
> `companion_iflag.ino` (or the prebuilt `.hex`) onto it first; that is what makes the
> app's frames render.

## Target boards

- Arduino Nano / Uno (ATmega328P)
- Arduino Pro Micro / Leonardo (ATmega32U4)

Select the matching board and port in Arduino IDE, then flash `companion_iflag.ino`.

## Arduino library

Install:

- **FastLED** via Arduino IDE → Library Manager

No other runtime libraries are required.

## Wiring

Default firmware data pin:

```cpp
#define DATA_PIN 6
```

Recommended wiring:

| Matrix | Arduino | Notes |
|---|---|---|
| DIN | D6 / `DATA_PIN` | Add ~330 Ω resistor in series close to DIN |
| 5V | External 5V supply | Do not power 64 LEDs from the Arduino 5V pin |
| GND | Arduino GND + PSU GND | Grounds must be common |

Power stability:

- Add a **1000 µF electrolytic capacitor** across matrix 5V/GND.
- Budget up to **~3.8 A** for 64 RGB LEDs at full white (`64 × 60 mA`). Real iFlag usage is usually much lower, but size the PSU with margin.
- Uno/Nano are 5V logic and usually drive WS2812 DIN directly. If using a 3.3V board or long data wire, use a 74HCT/5V level shifter.

## Matrix wiring layout

The app sends row pixels left→right, row 0 at the top. The firmware maps `(x,y)` to the physical LED strip index.

Compile-time flags in `companion_iflag.ino`:

```cpp
#define SERPENTINE true
#define ORIENTATION 0
```

- `SERPENTINE true`: every odd physical row is reversed (boustrophedon / zig-zag wiring).
- `SERPENTINE false`: every row is wired left→right progressively.
- `ORIENTATION`: physical panel rotation relative to the app preview. Supported values: `0`, `90`, `180`, `270`.

If flags appear rotated or mirrored, first set the app component orientation, then adjust these firmware constants only if the physical panel still does not match.

## Serial protocol

- Baud: **115200**
- Serial format: **8N1**
- Line ending: **LF** (`\n`), CR is ignored.

Commands accepted by this iFlag firmware:

| Command | Direction | Description |
|---|---|---|
| `Q<row>:<hex>` | App → device | Set one 0-based matrix row. `<hex>` is 8 pixels left→right, 6 hex chars per pixel (`rrggbb`), total 48 chars. |
| `P<hex...>` | App → device | Set all pixels sequentially from physical pixel 0, 6 hex chars per pixel. Shows immediately. |
| `C` | App → device | Clear all pixels to black. |
| `?` | App → device | Query capabilities. Device replies `K:rgbMatrix=8x8` then `KEND`. |
| `Y<0-255>` | App → device | Set global FastLED brightness. This is an additive v2 brightness command. |
| `M<2hex>` | App → device | Set + persist (EEPROM) the matrix layout byte and re-map the current image immediately. Bit0 serpentine, bits1-2 rotation (`0/90/180/270`), bit3 flipX, bit4 flipY. |
| `T<0-3>` | App → device | Calibration pattern lit *through* the active layout: `0` origin corner, `1` logical row 0, `2` logical column 0, `3` bold asymmetric “F” (best for spotting mirror / rotation / serpentine scramble). |
| `I<idx>` | App → device | **Manual-remap probe.** Light EXACTLY one **physical** LED (`idx` ∈ `0..63`) white, raw — straight into `leds[idx]`, bypassing the layout byte / `xyToIndex`. Self-contained (one frame, one show) and forced to a visible brightness floor, so it works on slow/old boards and recovers from a prior `Y0`. Used by the app's per-pixel manual-remap wizard to identify the wiring of panels that match no serpentine/rotation/flip preset. |

Capabilities sent by the firmware:

```text
K:rgbMatrix=8x8
KEND
```

On boot, the firmware briefly shows a green self-test frame, clears the matrix, and prints `K:rgbMatrix=8x8` once so the app can auto-detect the device.

The Hardware Hub **RGB Matrix (iFlag)** component drives this firmware using `Q` row frames during tests and live rendering. The firmware buffers rows and calls `FastLED.show()` after row 7, or after a short idle delay if fewer rows arrive.

> The app's `sendRaw` caps a generic companion frame at 200 chars, so a single
> full-panel `P` frame (64 px = 385 chars) is **not** used for the 8x8 matrix —
> the app sends eight `Q<row>:<48hex>` frames instead. The `P` pixel-stream
> command is used for shorter RGB strips and is still parsed here for ≤32-LED
> frames and manual testing.

## Flashing the iFlag (board selection + "not in sync")

The board under an iFlag is not always obvious, and picking the wrong family is the
#1 cause of avrdude failing with `stk500_getsync(): not in sync: resp=0x03` (it
selected the "new bootloader") or `resp=0xef` (the "old bootloader"). Match the
programmer to the bootloader:

| Board family | Programmer | Baud | Reset |
|---|---|---|---|
| ATmega328P (Nano/Uno) | `arduino` (stk500) | 115200 genuine · **57600** clone/old Optiboot | auto DTR |
| ATmega32U4 (Pro Micro/Leonardo) | `avr109` (Caterina) | 57600 | **1200bps touch** → COM re-enumerates |
| ESP32 / ESP32-S3 | arduino-cli / esptool | 921600 | auto / BOOT button |

Key rule: the **`arduino` (stk500) programmer only syncs with a 328P Optiboot
bootloader**. If the iFlag is actually a 32U4, stk500 will *never* sync — you must
use `avr109` + the 1200bps reset (pick the "Pro Micro (32U4)" board in the wizard).

The app helps you get this right:

- **USB auto-detection** — the wizard reads the USB descriptor (VID/PID/friendly
  name) and preselects the likely board family: `1a86` CH340 → Nano clone (328P);
  `0403` FTDI → Nano/Uno; `2341`/`2a03` → genuine Arduino (PID disambiguates 32U4
  Leonardo/Micro from 328P Uno); `1b4f` SparkFun / `239a` Adafruit → 32U4;
  `303a` Espressif / `10c4` CP210x → ESP.
- **Baud auto-retry** — on a 328P not-in-sync, the app automatically retries the
  other Optiboot speed (115200 ↔ 57600) before giving up.

If a flash still fails with not-in-sync, check, in order:

1. Right **board family** selected (especially 328P vs 32U4).
2. Right **COM port**.
3. No **SimHub / Arduino IDE / Serial Monitor** holding the port open.
4. A **USB data cable** (not charge-only) and the correct **CH340/CP210x/FTDI** driver.
5. For 32U4: double-tap **RESET** to enter Caterina, then flash immediately (the COM
   port changes for ~2s during the write — that's expected).

## Orientação: app vs firmware

A rotação da matriz é aplicada **no app** (componente RGB Matrix → Orientação 0/90/180/270).
Mantenha `ORIENTATION 0` no firmware (default) e use o controle do app — assim a imagem é
rotacionada uma única vez. Só ajuste `ORIENTATION` no firmware se for usar a matriz **sem** o app.
`SERPENTINE` continua sendo do firmware (é uma propriedade física da fiação da fita).
