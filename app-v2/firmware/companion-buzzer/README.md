# Companion firmware — piezo buzzer (audio alerts)

Piezo buzzer driver for the Ultimate ButtonBox "companion v2" protocol. It is
intended for audio alerts triggered by the app's Alerts engine and the component
Test button, which send `Z` buzzer frames.

Target boards: Arduino Nano, Uno and Pro Micro.

## Wiring

- Piezo `+` → **D8** (`BUZZER_PIN`)
- Piezo `-` → **GND**

`BUZZER_PIN` defaults to D8 in `companion_buzzer.ino`. Use a pin that works with
Arduino `tone()` on your board. D8 is a safe default for Nano/Uno/Pro Micro;
avoid D3/D11 if your board/core has `tone()` timer conflicts on those pins.

## Protocol (115200 8N1, newline-terminated)

- `Z<freq>:<ms>` — play a tone at `<freq>` Hz for `<ms>` milliseconds.
  - `Z0:<ms>` or `Z<freq>:0` silences the buzzer with `noTone()`.
  - Playback is non-blocking: the firmware records an end time and stops the
    tone from `loop()` without using `delay()`.
- `C` — silence the buzzer immediately.
- `?` — reply:
  - `K:buzzer`
  - `KEND`

The firmware also prints `K:buzzer` and `KEND` on boot and plays a short
confirmation beep.

## Notes

This sketch uses only Arduino's built-in `tone()` and `noTone()` APIs, so no
external libraries are required.
