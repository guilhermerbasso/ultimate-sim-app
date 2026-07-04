# Companion firmware — RGB LED strip (rev lights)

Generic WS2812/SK6812 strip driver for the Ultimate ButtonBox "companion v2"
protocol. Flash it from the app: **Hardware Hub → ⚡ Setup / Gravar firmware →
"Rev Lights (fita WS2812)"**. Prebuilt `.hex` ship in `resources/firmware/rgbstrip-*.hex`.

## Wiring
- `DIN` → **D6** (`DATA_PIN`)
- `5V` → 5V (external 5V supply for long/bright strips, common GND)
- `GND` → GND

Add a ~470 Ω resistor on the data line and a 1000 µF cap across 5V/GND if the
strip flickers.

## Protocol (115200 8N1, newline-terminated)
- `P<hex…>` — set pixels from #0, 6 hex (rrggbb) per LED (trailing LEDs auto-clear)
- `L<idx>:<rrggbb>` — set one LED
- `R<0-100>` — rev percent bar (green→yellow→red) for manual/test use
- `B<0|1>` — shift blink (whole strip blue / off)
- `Y<0-255>` — global brightness
- `C` — clear
- `?` — reply `K:rgbStrip=<NUM_LEDS>` then `KEND` (used for auto-detect)

## Config
`NUM_LEDS` defaults to 16; `DATA_PIN` to D6. Change at the top of
`companion_rgbstrip.ino` and recompile if your strip differs. The app drives the
strip from telemetry (rev lights + flags + shift blink) via the device-output engine.
