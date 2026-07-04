# Companion firmware — TM1638 7-seg display

Arduino companion firmware for a TM1638 module with **8x 7-seg digits, 8 buttons and 8 LEDs**. The Ultimate ButtonBox Hardware Hub drives it through the **Display 7-seg** component and the Setup Tool.

## Target boards

- Arduino Nano / Uno
- Arduino Pro Micro

Serial is **115200 8N1**, newline-terminated (`\n`). CR/LF are accepted.

## Arduino library

Install **TM1638plus** from Arduino IDE → Library Manager. This sketch uses the TM1638plus high-frequency mode constructor:

```cpp
#define TM_HIGH_FREQ true
TM1638plus tm(TM_STB_PIN, TM_CLK_PIN, TM_DIO_PIN, TM_HIGH_FREQ);
```

## Wiring

Default pins are configurable at the top of `companion_seg.ino`:

```cpp
#define TM_STB_PIN 7  // D7
#define TM_CLK_PIN 9  // D9
#define TM_DIO_PIN 8  // D8
```

| TM1638 module | Arduino default | Notes |
|---|---:|---|
| STB / STROBE | D7 | Chip select / strobe |
| CLK / CLOCK | D9 | Clock |
| DIO / DATA | D8 | Bidirectional data |
| VCC | 5V | Most TM1638 boards are 5V modules |
| GND | GND | Common ground |

To change pins or high-frequency mode, edit the `#define` values before compiling.

## Protocol

App → device:

| Command | Description |
|---|---|
| `7<text>` | Show `<text>` on the 8 digits, right-aligned and padded left with spaces. Allowed chars: digits, `.`, `-`, `:` and space. Decimal point attaches to the previous digit when supported by the library. Text is truncated to fit 8 digit cells. |
| `C` | Clear all 7-seg digits and the 8 TM1638 LEDs. |
| `?` | Query capabilities. Replies `K:segDisplay=tm1638` then `KEND`. |

Device → app:

| Message | Description |
|---|---|
| `K:segDisplay=tm1638` | Capability line, also printed on boot. |
| `KEND` | End of capability report. |
| `B<idx>:<0\|1>` | Button state change from the TM1638 keys, idx `0..7`, `1` pressed and `0` released. |

Unknown commands are ignored. The line parser is bounded and safely drops over-long frames.
