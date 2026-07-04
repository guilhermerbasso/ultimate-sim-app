# Companion firmware — HD44780 LCD over I2C

Firmware for an HD44780 character LCD with a PCF8574 I2C backpack, used by the
Ultimate ButtonBox companion serial protocol. Target boards: Arduino Nano or Uno.

## Hardware

- LCD `SDA` → Uno/Nano `A4`
- LCD `SCL` → Uno/Nano `A5`
- LCD `VCC` → `5V`
- LCD `GND` → `GND`

Adjust the backpack contrast trimpot if the backlight is on but no characters are
visible.

## Library

Install the Arduino **LiquidCrystal I2C** library before compiling.

## Configuration

Edit the defines at the top of `companion_lcd.ino`:

```cpp
#define LCD_ADDR 0x27
#define LCD_COLS 20
#define LCD_ROWS 4
```

Most PCF8574 backpacks use `0x27`; some use `0x3F`. The default display size is
20x4. For a 16x2 LCD, change `LCD_COLS` to `16` and `LCD_ROWS` to `2`.

## Protocol

Serial settings: **115200 8N1**, newline-terminated commands.

App → LCD:

- `T<row>:<text>` — write text to row `0..LCD_ROWS-1`, padded/truncated to `LCD_COLS`
- `N<text>` — center text on row 0 and blank the other rows
- `C` — clear the LCD
- `?` — query capabilities

LCD → app:

- On boot: `K:screen=lcd`
- Query reply: `K:screen=lcd` then `KEND`

Unknown commands are ignored. CR/LF line endings are accepted.
