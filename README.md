# Ultimate Sim App

Ultimate Sim App is a Windows companion app and DIY hardware project for sim racing. It combines telemetry, overlays, dashboards, strategy tools, and configuration support for a USB ButtonBox based on Arduino-compatible hardware.

This is an independent community project maintained by Guilherme Basso.

## What is included

| Area | Path | Description |
|---|---|---|
| Desktop app | `app-v2/` | Electron + React + TypeScript Windows app. |
| Firmware | `firmware/` | Arduino sketches for the ButtonBox and companion modules. |
| Driver helper | `driver/` | Optional INF package for friendly COM-port naming using the Windows inbox `usbser.sys`. |
| Protocol docs | `docs/` | Serial protocol and implementation notes. |
| SimHub config | `simhub/` | Custom serial template for OLED telemetry. |
| CAD/print files | `cad/`, `print/` | 3D-printable enclosure sources/assets. |

## Main features

- Sim racing dashboard, overlay, telemetry, and strategy companion.
- ButtonBox configuration and serial communication tools.
- OLED telemetry payload support for compatible firmware.
- Input monitoring through the Web Gamepad API.
- Optional USB/COM friendly-name setup for Windows.
- Build workflow for Windows NSIS installers.

## Screenshots

| AI coach / driver insights | Voice spotter |
|---|---|
| ![Career ratings and coaching insights](app-v2/concepts/t1/carreira-ratings.png) | ![Voice spotter setup](app-v2/concepts/t1/voice-spotter.png) |

| Telemetry workspace | Strategy and stint tools |
|---|---|
| ![Telemetry screen](app-v2/concepts/ux/menus/00-telemetria.png) | ![Race profiles screen](app-v2/concepts/ux/menus/09-perfis-corrida.png) |

| Dashboard gallery | Overlay manager |
|---|---|
| ![Dashboard gallery](app-v2/concepts/ux/menus/01-dashboards.png) | ![Overlay manager](app-v2/concepts/ux/menus/03-overlays.png) |

| GT3 race dashboard | Endurance dashboard |
|---|---|
| ![GT3 race dashboard concept](app-v2/concepts/dash-fix/gt3_race_warm-1280x720.png) | ![Endurance dashboard concept](app-v2/concepts/dash-fix/endurance-1280x720.png) |

| Spotter dashboard | Formula dashboard |
|---|---|
| ![Spotter dashboard example](app-v2/concepts/dash10/01-spotter-800x480.png) | ![Formula dashboard concept](app-v2/concepts/dash-fix/formula-1280x720.png) |

| Overlay: gear and speed | Overlay: rev lights |
|---|---|
| ![Gear and speed overlay](app-v2/concepts/overlay-fix/gearSpeed.png) | ![Rev lights overlay](app-v2/concepts/overlay-fix/revlights.png) |

| Devices | Arduino setup |
|---|---|
| ![Devices screen](app-v2/concepts/ux/menus/12-dispositivos.png) | ![Arduino setup screen](app-v2/concepts/ux/menus/13-arduinos.png) |

| Pinout designer | Controls and keyboard mapping |
|---|---|
| ![Pinout designer](app-v2/concepts/ux/menus/19-pinout-designer.png) | ![Controls and keyboard mapping](app-v2/concepts/ux/menus/18-controls-keyboard.png) |

## Quick start for users

1. Download a trusted release build when available.
2. Install or unzip the Windows package.
3. Connect the ButtonBox by USB.
4. Open Ultimate Sim App and select the device/COM port.
5. Keep SimHub closed while configuring the serial device, then close/disconnect the app before racing if SimHub needs the same COM port.

See the full user guide in [`MANUAL.md`](MANUAL.md).

## Development setup

Requirements:

- Node.js 20+
- npm
- Git
- Windows 10/11 for final installer validation

```bash
cd app-v2
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run test
npm run build
```

Build the Windows installer:

```bash
cd app-v2
npm run dist:win
```

## Hardware and firmware

The reference ButtonBox uses:

- Arduino Pro Micro / Leonardo-compatible ATmega32U4 board
- 6 EC11 rotary encoders with push buttons
- SSD1306 OLED display
- CD74HC4067 multiplexer

Firmware and wiring docs live under `firmware/`, `docs/`, `simhub/`, `BOM.*`, and `WIRING.*`.

## Repository hygiene

Generated dependencies and build outputs are intentionally not committed:

- `node_modules/`
- `app-v2/out/`
- `app-v2/dist-win/`
- logs, caches, temporary files, and OS metadata

Release installers should be generated from source and attached to GitHub Releases after review.

## Contributing

Contributions are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md), open an issue for larger changes, and keep changes focused.

Pull requests must be reviewed and approved by the maintainer before merge.

## Support

If this project helps your sim racing setup, you can support development here:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-support-yellow?style=for-the-badge&logo=buymeacoffee)](https://buymeacoffee.com/bettercalllbasso)

## License

Licensed under the Apache License, Version 2.0. See [`LICENSE`](LICENSE).
