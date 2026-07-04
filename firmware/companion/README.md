# Companion Firmware — Wiring & Setup Guide

> **What is this?**  
> `companion.ino` is a **reference sketch** for a *second* Arduino that works alongside the fixed SIM-X firmware.  
> The Ultimate ButtonBox app drives it via the **Custom Serial Device** feature — no changes to the SIM-X firmware needed.  
> You adapt the `#define` block at the top of the sketch to match your wiring; everything else is handled automatically.

---

## Supported boards

| Board | Notes |
|---|---|
| Arduino Uno (ATmega328P) | Verified target. 32 KB flash / 2 KB RAM. |
| Arduino Nano (ATmega328P) | Pin-compatible with Uno. |
| Arduino Pro Micro (ATmega32U4) | Native USB-CDC; appears as a COM port without a USB–serial bridge. **Recommended** for sim-rig use. |

> ⚠️ The ATmega32U4 (Pro Micro) has only **2.5 KB RAM** — keep `NUM_BUTTONS`, `NUM_ENCODERS`, and `NUM_ANALOG` small, or disable unused peripherals.

---

## Required libraries

Install all libraries via **Sketch → Include Library → Manage Libraries** in the Arduino IDE.

| Library | Library Manager name | Used for |
|---|---|---|
| U8g2 | `U8g2` (author: oliver) | SSD1306 OLED display |
| FastLED | `FastLED` (author: Daniel Garcia) | WS2812 rev lights + addressable LEDs |
| LedControl | `LedControl` (author: Eberhard Fahle) | MAX7219 8×8 LED matrix |
| Encoder | `Encoder` (author: Paul Stoffregen / PJRC) | Rotary encoders |

---

## Feature toggles (`#define`s)

Edit the **PIN DEFINITIONS** block at the top of `companion.ino`.

| `#define` | Default | Effect |
|---|---|---|
| `ENABLE_OLED` | `1` | Include U8g2 OLED support. Set `0` to free ~3 KB flash. |
| `ENABLE_REV_LEDS` | `1` | Include WS2812 rev-light strip. |
| `ENABLE_MATRIX` | `1` | Include MAX7219 8×8 matrix. |
| `ENABLE_ADDR_LEDS` | `1` | Include `L<idx>:<rrggbb>` per-LED colour command. Set `0` if you have no individually-addressed LEDs. |
| `ENABLE_BUTTONS` | `1` | Include button scanning. |
| `ENABLE_ENCODERS` | `1` | Include rotary encoder scanning. |
| `ENABLE_ANALOG` | `1` | Include analog axis reporting. |

### Pin assignments

| `#define` | Default | Description |
|---|---|---|
| `REV_LED_PIN` | `6` | WS2812 data pin |
| `NUM_REV_LEDS` | `8` | Number of LEDs in rev strip |
| `MATRIX_DIN` | `11` | MAX7219 data in (MOSI) |
| `MATRIX_CLK` | `13` | MAX7219 clock (SCK) |
| `MATRIX_CS` | `10` | MAX7219 chip-select / LOAD |
| `MATRIX_DEVICES` | `1` | Number of chained MAX7219 modules |
| `NUM_BUTTONS` | `4` | Number of push buttons |
| `BTN_PINS[]` | `{2,3,4,5}` | Pin per button (array, active-low) |
| `NUM_ENCODERS` | `2` | Number of rotary encoders |
| `ENC_PINS[][2]` | `{{A2,A3},{A4,A5}}` | {CLK, DT} pin pair per encoder |
| `NUM_ANALOG` | `2` | Number of analog axes |
| `ADC_PINS[]` | `{A0, A1}` | Analog pin per axis |
| `ANALOG_DEADBAND` | `8` | Min ADC change to emit an event |
| `ANALOG_RATE_MS` | `50` | Min ms between axis events per channel |
| `DEBOUNCE_MS` | `20` | Button debounce window |

---

## Wiring guide

### OLED SSD1306 (128×64, I2C)

```
OLED  →  Arduino
VCC   →  3.3 V or 5 V (check your module)
GND   →  GND
SDA   →  A4  (Uno/Nano)  |  D2  (Pro Micro)
SCL   →  A5  (Uno/Nano)  |  D3  (Pro Micro)
```

> The I2C address is usually `0x3C`. If your display doesn't initialise, try `0x3D` by editing the U8g2 constructor in the sketch.

### WS2812B Rev Lights

```
WS2812 strip  →  Arduino
5V / VCC      →  5V  (use external supply for > 8 LEDs)
GND           →  GND  (common ground with Arduino!)
DIN           →  REV_LED_PIN (D6 default)
```

> Always add a **300–500 Ω series resistor** on DIN and a **100–1000 µF capacitor** across 5V/GND near the strip.

### MAX7219 8×8 LED Matrix

```
MAX7219 module  →  Arduino
VCC             →  5V
GND             →  GND
DIN             →  MATRIX_DIN  (D11 default)
CLK             →  MATRIX_CLK  (D13 default)
CS / LOAD       →  MATRIX_CS   (D10 default)
```

> To chain multiple modules: DOUT of module N → DIN of module N+1; CLK and CS are shared. Set `MATRIX_DEVICES` accordingly.

### Push Buttons (active-low)

```
Button pin  →  Arduino digital pin  (BTN_PINS array)
Other leg   →  GND
```

The firmware uses `INPUT_PULLUP` — no external resistor needed.

### Rotary Encoders (EC11 / KY-040)

```
Encoder  →  Arduino
GND      →  GND
+/VCC    →  5V  (enables onboard pull-ups on KY-040 modules)
CLK      →  ENC_PINS[n][0]
DT       →  ENC_PINS[n][1]
SW       →  Any BTN_PINS entry (optional push)
```

> Interrupt-capable pins (D2, D3 on Uno; D0–D3 on Pro Micro) give better accuracy at high spin speeds.

### Analog Axes (potentiometers / hall sensors)

```
Pot wiper  →  ADC_PINS[n]  (A0, A1 default)
Pot ends   →  GND and 5V
```

---

## Flashing instructions

1. Open `companion.ino` in **Arduino IDE 2.x** (or 1.8.x).
2. Install all four libraries listed above.
3. Select your board:
   - **Uno / Nano:** Tools → Board → Arduino AVR Boards → Arduino Uno / Nano
   - **Pro Micro:** Tools → Board → SparkFun AVR Boards → SparkFun Pro Micro  
     (install the SparkFun board package via Boards Manager if missing:  
     `https://raw.githubusercontent.com/sparkfun/Arduino_Boards/main/IDE_Board_Manager/package_sparkfun_index.json`)
4. Set **Tools → Processor** to **ATmega32U4 (5V, 16 MHz)** for Pro Micro.
5. Select the correct COM port.
6. Click **Upload**.

> ⚠️ The Pro Micro uses a **bootloader double-tap** to enter programming mode if a sketch is running. Press the reset button twice quickly if the upload fails.

---

## Connecting to the app

1. Open the **Ultimate ButtonBox** app.
2. Go to **Settings → Devices → Add Custom Serial Device**.
3. Select the companion's COM port, baud rate **115 200**.
4. Import or manually enter the protocol mappings from `PROTOCOL.md`.
5. The companion is now live alongside the SIM-X device.

---

## Memory budget (Pro Micro — ATmega32U4)

With all features enabled and default array sizes:

| Resource | Approximate usage |
|---|---|
| Flash | ~22–26 KB of 32 KB |
| SRAM | ~800–1 100 bytes of 2 560 bytes |

Disable unused features (`ENABLE_x 0`) or reduce array sizes to reclaim memory.  
All string literals in the sketch use the `F()` macro to keep them in flash.

---

## Adapting this reference

This sketch is a **starting point** — adapt freely:

- Add more encoders or buttons by expanding the arrays.
- Change the OLED font in `renderOled()` (see U8g2 font catalogue).
- Adjust `FastLED.setBrightness()` for your power budget.
- Replace the `LedControl` matrix driver with `MD_MAX72XX` if preferred (same wiring).

See `PROTOCOL.md` for the exact command/event specification the app expects.
