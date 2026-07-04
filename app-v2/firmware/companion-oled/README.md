# Companion firmware — SSD1306 OLED screen

Firmware for the Ultimate ButtonBox companion OLED device: SSD1306 128x64 over I2C, driven by the app's Hub **Tela (OLED)** component / Setup Tool.

## Target boards

- Arduino Nano / Uno
- I2C pins on Nano/Uno: **A4 = SDA**, **A5 = SCL**
- Serial: **115200 8N1**, newline-terminated lines

## Wiring

| OLED pin | Arduino Uno/Nano |
|---|---|
| SDA | A4 |
| SCL | A5 |
| VCC | 5V |
| GND | GND |

Use a common ground with the rest of the button box electronics.

## Library

Install/use the **U8g2** Arduino library. The sketch uses:

```cpp
U8G2_SSD1306_128X64_NONAME_F_HW_I2C
```

## Protocol summary

App → device commands:

- `T<row>:<text>` — text row, `row` 0..3, up to 21 printable ASCII chars. Any `T` command switches back to the 4-line text view and redraws all rows.
- `N<text>` — big-number view, up to 9 chars (`0-9`, `.`, `-`, `:`, space), centered with a large font. Replaces text view until the next `T` command.
- `C` — clear the display.
- `?` — capability query. Device replies:
  - `K:screen=oled`
  - `KEND`

Device also prints `K:screen=oled` once on boot after the splash screen.
