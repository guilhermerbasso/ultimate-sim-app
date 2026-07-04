# Ultimate ButtonBox companion controls firmware

Arduino sketch for turning a **32U4-only** board (target: **Pro Micro**, also works on Leonardo/Micro) into a USB HID joystick for the Ultimate ButtonBox companion input monitor.

It uses the Matthew Heironimus **Joystick** library and exposes a fixed HID layout. Remap controls inside the game/simulator, just like the SIM-X box model; the firmware does not send per-game mappings.

## Default pinout

Direct buttons use `INPUT_PULLUP`; wire each switch between the pin and GND. Pressed = `LOW`.

| HID button | Board pin |
|---:|---|
| 0 | D2 |
| 1 | D3 |
| 2 | D4 |
| 3 | D5 |
| 4 | D6 |
| 5 | D7 |
| 6 | D8 |
| 7 | D9 |
| 8 | D10 |
| 9 | D16 |
| 10 | D14 |
| 11 | D15 |

Rotary encoders are optional and also use `INPUT_PULLUP`.

| Encoder | Pins | CW HID button | CCW HID button | Serial monitor event |
|---:|---|---:|---:|---|
| 0 | A0, A1 | 12 | 13 | `E0:+1` / `E0:-1` |
| 1 | A2, A3 | 14 | 15 | `E1:+1` / `E1:-1` |

Each encoder tick briefly presses a momentary HID button, so games see encoder movement as normal button presses.

## Serial protocol

Serial runs at **115200 8N1** for the Ultimate ButtonBox app input monitor:

- Button changes: `B<idx>:<0|1>` (`1` = pressed)
- Encoder ticks: `E<idx>:+1` or `E<idx>:-1`
- Capability query `?`: replies `K:control` then `KEND` (also printed on boot)

## Customizing pins

Edit the `#define` values at the top of `companion_controls.ino`:

```cpp
#define BUTTON_PINS {2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 14, 15}
#define ENABLE_ENCODERS 1
#define ENCODER0_PIN_A A0
#define ENCODER0_PIN_B A1
#define ENCODER1_PIN_A A2
#define ENCODER1_PIN_B A3
```

If encoder direction is reversed, swap that encoder's A/B pins in the defines.
