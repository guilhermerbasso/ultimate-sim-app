# Ultimate ButtonBox ESP32 companion firmware

Phase-3 companion sketch for ESP32 / ESP32-S3 boards. It exposes the existing line-framed companion protocol over:

- USB serial at `115200 8N1`
- TCP on port `47650` after Wi-Fi connects
- mDNS service `_ubbcompanion._tcp` for LAN discovery

## Provisioning flow

1. Connect the ESP32/ESP32-S3 over USB.
2. The app compiles/uploads this sketch with Arduino CLI using `esp32:esp32:esp32` or `esp32:esp32:esp32s3`.
3. The app sends `WIFI:<base64-ssid>:<base64-password>` over USB serial.
4. The sketch stores credentials in NVS (`Preferences`) and restarts.
5. After boot, it connects to Wi-Fi, advertises `_ubbcompanion._tcp`, and accepts one TCP companion client.

Install the ESP32 core first when needed:

```bash
arduino-cli core install esp32:esp32
```

Bench validation is required for flashing, USB CDC behavior, and Wi-Fi reliability on the target board.
