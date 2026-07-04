# Ultimate Sim App Manual

This manual explains how to install, configure, and use Ultimate Sim App with a compatible ButtonBox.

## 1. Before you start

You need:

- Windows 10/11.
- A USB ButtonBox or compatible Arduino Pro Micro / Leonardo device.
- SimHub if you want OLED telemetry integration.
- A release build of Ultimate Sim App, or a local development build.

## 2. Install or run the app

### Installer

1. Download the `.exe` installer from a trusted release.
2. Run the installer.
3. If Windows warns that the app is unsigned, choose the trusted path only if you built or downloaded it from this repository.
4. Open **Ultimate Sim App** from the Start Menu or desktop shortcut.

### Portable ZIP

1. Download the portable `.zip`.
2. Extract it to a folder you control.
3. Run `Ultimate Sim App.exe`.

## 3. Connect the ButtonBox

1. Connect the device by USB.
2. Open **Devices** in the app.
3. Select the COM port for the ButtonBox.
4. Click connect.

The COM port can be used by only one program at a time. Close SimHub while configuring the device in Ultimate Sim App. When you race, disconnect or close Ultimate Sim App if SimHub needs the same serial port.

## 4. Configure controls

Use the app views to:

- Detect devices and COM ports.
- Test serial communication.
- Monitor HID/gamepad inputs.
- Export or import local profiles.
- Send OLED test messages.

For iRacing or other simulators, map the HID buttons inside the simulator controls screen.

## 5. OLED and SimHub telemetry

1. Flash compatible firmware from `firmware/`.
2. In SimHub, add a custom serial device.
3. Use the template in `simhub/custom_serial_bb.md`.
4. Match the baud rate expected by the firmware.
5. Test the connection while Ultimate Sim App is not holding the COM port.

## 6. Optional Windows driver helper

Most users do not need to install a driver. The ButtonBox should appear as:

- a HID/gamepad device, and
- a serial COM device through the built-in `usbser.sys` driver.

The `driver/` folder contains an optional INF file that can give the COM port a friendlier name. Read [`driver/INSTALL.md`](driver/INSTALL.md) before using it.

## 7. Troubleshooting

| Problem | What to try |
|---|---|
| COM port is busy | Close SimHub or any serial monitor, then reconnect in the app. |
| Device does not appear | Reconnect USB, try another cable/port, and check Device Manager. |
| OLED does not update | Confirm SimHub custom serial settings and firmware baud rate. |
| Buttons do not map | Confirm the device appears as a game controller and remap in the simulator. |
| Installer warning | The app is unsigned unless a release is code-signed. Only run builds you trust. |

## 8. Development build

```bash
cd app-v2
npm install
npm run dev
```

For a production build:

```bash
cd app-v2
npm run build
```

For a Windows installer:

```bash
cd app-v2
npm run dist:win
```
