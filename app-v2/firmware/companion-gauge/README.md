# Companion firmware — analog gauges (servo)

Servo-based analog gauge driver for the Ultimate ButtonBox companion v2 protocol.
Targets Arduino Nano, Uno, and Pro Micro boards.

## Wiring

Default servo signal pins:

| Gauge index | Arduino pin |
| --- | --- |
| `0` | D3 |
| `1` | D5 |
| `2` | D6 |
| `3` | D9 |

- Servo signal wire → D3/D5/D6/D9 as listed above
- Servo V+ → Arduino 5V for very small loads, or preferably an external regulated 5V supply
- Servo GND → Arduino GND / external supply GND (**common GND is required**)

Do not power multiple servos from USB. Use an external 5V supply sized for the
servos' stall current.

## Library

Uses Arduino's built-in `Servo` library (`#include <Servo.h>`). No third-party
libraries are required.

## Protocol

Serial settings: **115200 8N1**, newline-terminated commands.

- `G<idx>:<angle>` — set servo `<idx>` (`0..3`) to `<angle>` degrees. The app
  protocol allows `0..359`, but hobby servos are typically `0..180`, so firmware
  clamps to `0..180`. Servos attach lazily on first use.
- `C` — return all attached servos to `0` degrees. Change `CLEAR_ANGLE` in the
  sketch to `90` if your gauge should center instead.
- `?` — reply:
  - `K:gauge=4`
  - `KEND`

The firmware also prints the same capability response on boot.

## Mapping note

The Ultimate ButtonBox app maps a telemetry metric across a configured
`minAngle..maxAngle` range and sends frames such as `G0:<angle>`. For example,
gauge 0 receives `G0:135` to move the first servo to 135 degrees.
