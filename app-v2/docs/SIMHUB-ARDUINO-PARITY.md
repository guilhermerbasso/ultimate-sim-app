# SimHub Arduino parity / gap reference

This document catalogs SimHub's Arduino attachable-hardware ecosystem and maps it to the current Electron companion app architecture. Scope is intentionally practical: what users can wire, what firmware/setup choices are needed, which telemetry each component tends to render, and what our roadmap should prioritize.

> Current app baseline was read from `src/shared/companion.ts`, `src/shared/revlights.ts`, `src/shared/oled.ts`, `src/shared/outputs.ts`, and `src/shared/arduino.ts`. The SIM-X firmware baseline noted by product is: `R<level 0-4>`, `B`, `O`, `D`, `S`; fixed rev-light colors; no per-LED RGB frame protocol.

## 1. SimHub Arduino model overview

SimHub's Arduino flow is centered on a generated sketch rather than a generic runtime protocol:

1. User opens the **Arduino Setup tool**.
2. User assigns a **unique Arduino name** so SimHub can distinguish multiple boards.
3. User enables features/components: LED strip, RGB matrix, TM1637/TM1638/MAX7219 displays, LCD/OLED, buttons, encoders, motor shields, gauges, etc.
4. User selects pins and board type, ensuring **all used pins are unique**. SimHub's own docs warn that defaults may conflict because not every feature combination fits one board.
5. SimHub generates/configures the sketch and uploads it to the selected COM port/board.
6. Runtime configuration then happens in SimHub editors: LED editor, matrix/display settings, gauge calibration, ShakeIt motor/wind output settings, input mappings, custom serial formulas.

Important model details:

- **Supported AVR boards:** Uno R3, Nano v3 ATmega328, Mega 2560, Pro Micro 5V/16MHz, Leonardo. Uno R4, ATmega168 Nano clones, WAVGAT/fake boards are called out as unsupported/risky. Pro Micro/Leonardo are the HID-capable choices for native gamepad buttons/encoders. Source: [Arduino Setup](https://github.com/SHWotever/SimHub/wiki/Arduino--Setup).
- **Power model:** USB may be enough for small builds, but larger LED/motor setups need external 5V/12V power with common ground. SimHub explicitly warns not to back-feed Arduino 5V from the external LED supply. Source: [Arduino Setup](https://github.com/SHWotever/SimHub/wiki/Arduino--Setup#powering-considerations).
- **Multiple Arduinos:** SimHub can aggregate multiple Arduinos as one logical device. Addressable-per-device features include 7-segment displays, 20x4 LCD, RGB/TM1638 LEDs, motors, and custom protocol. Other features such as tach/boost/gear indicator may be replicated. Unique names are required. Source: [Multiple devices support](https://github.com/SHWotever/SimHub/wiki/Arduino-Multiple-devices-support).
- **Custom serial devices:** SimHub also has a plugin for unsupported serial devices. The user defines baud/RTS/DTR, connect/disconnect messages, and update messages built with NCalc/JavaScript at a chosen frequency; ASCII is sent as-is with no implicit terminator. Source: [Custom serial devices](https://github.com/SHWotever/SimHub/wiki/Custom-serial-devices).
- **Nextion:** SimHub historically supported Nextion as a simple graphic dash over USB-TTL or Pro Micro bridge, but official docs mark it as end-of-support/no future fixes and recommend avoiding new Nextion purchases. Sources: [Nextion Display](https://github.com/SHWotever/SimHub/wiki/Nextion-Display), [Nextion end of support](https://github.com/SHWotever/SimHub/wiki/Nextion---End-of-support).

## 2. Parity table

Priority key: **P1** = needed for credible SimHub-style hub MVP; **P2** = high-value follow-up; **P3** = niche/advanced/stretch.

| Component | SimHub support | Typical hardware/chip | Pins/libraries needed | Telemetry it shows / drives | Our current support | Priority |
|---|---|---|---|---|---|---|
| Addressable RGB LEDs / rev lights | Native Arduino feature + LED editor. One WS2812B output per Arduino; up to 150 LEDs per board, 512 overall across multiple boards. RGBW not supported; LED chip/color order selected at setup. | WS2812B/NeoPixel, WS2813/SK6812-class addressable strips if protocol-compatible, PL9823. APA102 is not called out in fetched official docs. | 5V, GND, data commonly D6; FastLED/NeoPixel-style firmware; optional 470Ω data resistor; external 5V for larger counts. | RPM gradients, shift flash, flags, spotter, fuel/turbo/temp warnings, custom LED effects. | `companion.ts` has `R<0-100>`, `B<0|1>`, `L<idx>:rrggbb`; `revlights.ts` computes UI color previews and flags, but SIM-X firmware only accepts `R0..4` + `B` with fixed colors. No multi-LED frame/effect protocol yet. | P1 |
| RGB LED matrix / iFlag | Native RGB matrix feature. Shows gears, flags, spotter, custom animations. Officially one RGB matrix per Arduino for performance/power; up to 4 separate matrix contents can be authored and assigned across Arduinos. | WS2812B 8x8 RGB matrix, SunFounder/DM163 shield (iFlag), SunFounder SH1.0-4P I2C RGB matrix. | WS2812 matrix DIN D6 + 5V/GND/VIN; DM163 shield plugs to Uno/Leonardo; options for serpentine layout and rotation. | Race flags, gear, spotter arrows, alerts, custom icons/animations. | `companion.ts` supports `M<16 hex chars>` for **monochrome** 8x8 MAX7219 bitmap only. No RGB matrix color frames, serpentine/rotation, content slots, or iFlag semantics. | P1 |
| Single-color 8x8 matrix | Native feature, but SimHub docs say it handles one MAX7219 matrix; multiple devices replicate unless split through multi-device behavior. | MAX7219/MAX7221 8x8 dot matrix. | 5V/GND plus DIN/CLK/CS pins per setup. Library equivalent to LedControl/MD_MAX72xx. | Current gear primarily; fonts customizable in SimHub's `MatrixFonts` folder. | `M<16 hex chars>` can draw arbitrary 1-bit bitmap; this is close for raw output, but lacks font/profile editor and SimHub's gear default. | P1 |
| Character LCD | Native display feature. SimHub supports 20x4 or 16x2 I2C LCDs; warns I2C backpack chip/address compatibility varies. | HD44780 16x2/20x4 with PCF8574-style I2C backpack. | I2C: Uno/Nano A4/A5, Mega 20/21, Leonardo 2/3. Addresses commonly `0x27`/`0x3f`; alternative LCD library selectable. | Text dashboards: lap, fuel, speed, temps, timings, alerts. | No HD44780-specific component. OLED text commands can render strings to SSD1306 only (`T`, legacy `O`). | P2 |
| Graphical OLED | Native SSD1306 I2C 0.96" support; only one OLED, replicated across multiple USB mode. Docs warn Uno/Nano only as sole feature, Micro not enough memory, Mega OK. | SSD1306 128x64 I2C OLED. | I2C pins by board; U8g2/Adafruit_SSD1306-class framebuffer library. | Text pages, simple graphical templates, big numbers. | Strong partial: `oled.ts` supports 3-line text and bignum telemetry presets; `companion.ts` supports `T<row>` + `N`. SIM-X uses legacy `O`/`D`. No template designer/graphics primitives. | P1 |
| TFT displays | Not part of the fetched official Arduino component list. SimHub's modern graphic dash path is Dash Studio on USB/VoCore/USBD480 rather than Arduino TFT in the pages reviewed. | ST7735/ILI9341 SPI TFT in community/custom builds. | SPI pins, CS/DC/RST, Adafruit_GFX/TFT_eSPI-class libraries; higher bandwidth than classic AVR serial can comfortably drive. | Full dashboards, pages, gauges. | None. Could be implemented as separate display app/device rather than Arduino component. | P3 |
| Nextion display | Supported historically via USB-TTL or Arduino Pro Micro bridge, but **end-of-support** and disabled by default. 4.3" and 2.8" have bundled templates; 5"+ unsupported for performance; newer Nextion/TJC variants problematic. | Nextion NX-series HMI screen; USB-TTL; optional Pro Micro bridge with LEDs/buttons. | USB-TTL RX/TX cross wiring, or Pro Micro RX1/TX0 bridge. SimHub's Nextion extension/editor/uploader; optional WS2812B on D6. | Simple graphic dash pages, mapped telemetry fields, wheel/device dash. | None. Given upstream EOL, do not build first unless importing legacy projects is a target. | P3 |
| TM1637 4-digit / 6-digit | Native. SimHub supports up to 6 TM1637 4-digit modules and up to 6 tested RobotDyn 6-digit modules. Warns to avoid 4-digit “clock version” without decimal points. | TM1637 4-digit 7-seg; RobotDyn 6-digit TM1637. | 5V/GND, DIO D4, CLK D3 by example; extra modules use free pins; some modules can share CLK or DIO but setup flags conflicts. | Speed, gear, lap time, delta, fuel, static numeric values. | No native segment-display component. Can only send generic serial strings if user writes firmware. | P2 |
| TM1638 display + buttons + LEDs | Native. Supports single-color and dual-color modules, daisy-chain/ribbon use, extra strobe per extra module; LED editor configures LEDs. | TM1638 8-digit 7-seg modules with 8 buttons and 8/16 LEDs. | 5V/GND plus STB/CLK/DIO; one extra STB per module. TM1638 library. | Numeric display, rev/flag LEDs, and button input panel. | No TM1638 component. Inputs exist only via companion `B<idx>` events if firmware reports them; no display/button combined abstraction. | P2 |
| MAX7219/MAX7221 7-segment | Native. Supports up to 6 cascaded 8-digit modules. | MAX7219/MAX7221 8-digit 7-segment boards. | 5V/GND direct to Arduino for voltage consistency; DIN/CLK/CS cascade. LedControl/MD_MAX72xx-class library. | Gear, speed, lap time, delta, fuel, numeric warnings. | No native 7-seg component. | P2 |
| HT16K33 7-seg/alphanumeric | Not found in official SimHub Arduino wiki pages reviewed. Common in DIY via Adafruit LED Backpack/custom serial. | HT16K33 I2C 4-digit/14-segment backpacks. | I2C SDA/SCL, address selection; Adafruit_LEDBackpack/Adafruit_GFX. | Numeric/alphanumeric telemetry. | None. Treat as custom/community unless we explicitly add support. | P3 |
| Display & alerts editor | Native concept across Display and Alerts, LED editor, matrix fonts/content, gauge calibration, test-data editor. LED editor supports profiles per game, effect groups, layered/left-to-right layout, brightness, dimming, conditions, and simulated telemetry. | Software feature spanning LEDs, matrix, displays, outputs. | App-side editors + firmware capabilities; no special pins beyond selected component. | Flags, RPM, gear, spotter, warnings, custom formulas, test data preview. | `outputs.ts` provides generic telemetry/expression/literal to serial/dashboard/overlay routing and string templating; companion presets exist, but no visual effect editor, content profiles, conditions, or test-data simulator for hardware. | P1 |
| Buttons | Native. Momentary switches; can be used by SimHub on any Arduino, or exposed as gamepad only on Pro Micro/Leonardo/ATmega32U4. Supports pin-to-GND and VCC-to-pin wiring. | Momentary push buttons, toggles only if firmware handles state; illuminated buttons need resistor in VCC-to-pin mode. | Digital pins; internal pullups or 10k resistor depending wiring. Avoid Nano A6/A7 and D13. Joystick library for HID on 32U4. | User actions, game controls, SimHub actions, HID gamepad buttons. | `parseCompanionInput` handles `B<idx>:<0|1>` and app aggregates input snapshots. SIM-X firmware exposes 32 HID buttons and serial encoder events; no user-defined pinout/HID firmware generation. | P1 |
| Button matrix | Native. SimHub docs emphasize momentary-only and no multiple simultaneous button presses. Gamepad mode only on Pro Micro/Leonardo/ATmega32U4. | Row/column button matrix. | Digital row/column pins; firmware scanning/debounce. Avoid Nano A6/A7 and D13. | Compact button boxes/actions/HID buttons. | No configurable matrix component. SIM-X uses CD74HC4067 multiplexers and fixed HID map; companion protocol can receive individual button events only. | P2 |
| Rotary encoders | Native. Supports half-step/full-step timing encoders; EC11 recommended. Gamepad mode only on Pro Micro/Leonardo/ATmega32U4. | KY-040 / EC11 rotary encoders with optional push. | Two digital pins per encoder; optional internal pullups; Encoder library. Avoid Nano A6/A7 and D13. | ABS/TC/bias/map adjustment, menu navigation, relative actions. | `parseCompanionInput` supports `E<idx>:+1/-1`; SIM-X has 4 fixed encoders. No configurable pinout, detent type, acceleration, or HID mapping generator. | P1 |
| Analog axes / pots | Not a highlighted official Arduino wiki page in the fetched list, but common through button box/HID/custom firmware and our SIM-X. | Potentiometers, joystick axes, Hall sensors, KY-023. | Analog pins or multiplexer analog signal; Joystick HID for native game axes. | Throttle/brake/clutch, joystick, trim knobs, menu axes. | `parseCompanionInput` supports `A<idx>:0-1023`; SIM-X maps KY-023 to POV HID. No generic axis calibration/deadzone/HID descriptor generation. | P2 |
| Shift registers | Not found as first-party Arduino component in fetched SimHub docs. Common DIY expansion path. | 74HC165 parallel-in serial-out. | DATA/CLOCK/LATCH pins; digital input scan library. | Many buttons/switches with few pins. | None. | P3 |
| Multiplexers | Not a first-party SimHub component page in fetched docs; our SIM-X uses them heavily. | CD74HC4067 16-channel analog/digital mux. | SIG + S0-S3 select pins, optional EN; analog/digital scan logic. | Many buttons, analogs, encoder channels. | Fixed SIM-X hardware profile documents three CD74HC4067 muxes; no user-defined mux component in app/firmware generator. | P2 |
| Buzzer / piezo | Not found as a dedicated official Arduino component in the fetched SimHub wiki. Alerts can be modeled via custom serial, LEDs, ShakeIt, or custom firmware. | Active buzzer or passive piezo. | Digital pin, optional resistor/transistor depending buzzer current; `tone()` for passive piezo. | Shift beep, pit limiter, warnings, flags, spotter/audio-like alerts. | None. Could be a simple companion command and alert target. | P2 |
| Servos / hobby gauge | Not confirmed in fetched official SimHub Arduino docs. Treat as community/custom unless verified in current SimHub UI/manual. | SG90/MG90S hobby servo. | 5V/GND/signal on PWM-capable pin; Servo library; external 5V for more than one servo. | Analog needle for speed/RPM/fuel/temp. | None. | P3 |
| Automotive stepper gauges | Not confirmed as a dedicated X27/VID29 page in fetched official wiki, but SimHub officially documents automotive tach/speed/boost/BMW cluster signal-generation gauges. Stepper support should be verified against current SimHub manual/UI before committing parity claims. | X27.168, VID29, Switec-style motors, or real automotive cluster gauges. | For steppers: 4 coils via driver/ULN2003 or direct pins + SwitecX25-class library. For real gauges: PWM/tone pins, transistors, 5V/12V signal conditioning. | RPM, speed, turbo/boost, fuel, water temp. | None beyond OLED/rev indicators. | P3 |
| Aftermarket tachometer | Native documented gauge. Signal pin exclusively D9 in the legacy doc; uses TIP120, 2.2k resistor, 12V diode, 12V power. Real/full-scale modes and RPM offset calibration. | Aftermarket 12V tachometer. | D9 output, TIP120 driver, resistor, diode, 12V supply. | Engine RPM. | None. | P3 |
| Aftermarket boost gauge | Native documented gauge. PWM 490-1000Hz; default D5 must be PWM. Falls back from turbo data to engine torque in Project Cars, then throttle. | Aftermarket boost/turbo gauge. | PWM pin, 12V supply depending gauge. | Turbo/boost, torque fallback, throttle fallback. | None. | P3 |
| Aftermarket speedometer / E36 cluster | Native documented gauge/cluster support. Speedo may require 5V or 12V frequency signal; E36 uses PWM/frequency signals for tach/speed/fuel/temp with limitations. | Automotive speedometer, BMW E36 cluster. | Tone/PWM pins; optional 5V→12V transistor wiring; calibration. | Speed, RPM, fuel, water temp. | None. | P3 |
| Motors / haptics | Native ShakeIt Arduino support. Supports Adafruit Motor Shield V2 recommended, up to 3 stacked shields at I2C addresses 0x60-0x62, Monster Moto for high power, deprecated DK shield. | DC vibration motors, rumble motors, pedal motors, motor shields. | Motor shield I2C/stacking, 7-12V supply, careful polarity and current limits; ShakeIt firmware. | Engine vibration, kerbs, wheel slip/lock, impacts, road texture. | None. Out-of-scope for buttonbox hub MVP, but should be acknowledged. | P3 |
| Wind / fans | Native ShakeIt wind support. Supports 3-pin DC fans via motor shield and up to 3 PWM 4-pin fans. | 12V PC fans/blowers, Adafruit Motor Shield V2, Monster Moto, direct PWM fans. | 12V power, common ground; PWM pins by board: Uno 9/10, Leonardo 9/10/11, Mega 11/12/13. | Speed-proportional wind, gear/throttle effects. | None. Likely separate “effects hardware” phase. | P3 |
| Relays / high-power switching | Not a first-class page in fetched docs, but common custom hardware pattern and can be driven through custom serial/firmware outputs. | Relay module, MOSFET board, SSR. | Digital output, transistor/MOSFET/relay driver, flyback protection for coils. | Lights, fans on/off, pit/flag indicators, accessories. | None. | P3 |
| Custom serial device | Native plugin, independent of Arduino Setup. Lets user define serial port settings, connect/disconnect messages, update formulas/frequencies, import/export/freeze settings, and custom setting panel. | Any serial microcontroller/device. | Serial link, ASCII protocol; NCalc/JavaScript formulas app-side. | Anything the custom device understands. | Strong partial: `OutputRoute` + serial template interpolation and companion presets; lacks UI-equivalent connect/disconnect messages, per-message frequencies, settings panel, freeze/import/export semantics. | P1 |

## 3. Per-component notes and MVP definitions

### 3.1 Addressable RGB LEDs / rev lights

SimHub behavior:

- One addressable LED output per Arduino for WS2812B/PL9823-style chains.
- User configures LED count, LED type, RGB encoding/order, and test mode at setup.
- LED editor defines profiles per game and effects groups. Effects can be layered or laid out left-to-right, target ranges by start position/count, mirror right-to-left, dim final LED for gradients, and condition on game data.
- Common effects: RPM gradient, shift flash, pit limiter, flags, spotter, DRS, low fuel, tire/brake warnings, custom formulas.

Our MVP:

- Add firmware capability for full per-LED RGB frames, not just `R0..4`.
- Keep existing simple `R%` as a high-level rev component, but compile it into color frames app-side when the firmware supports RGB.
- Component config: data pin, LED count, color order, brightness, direction, external-power warning.
- Initial effect set: RPM gradient, shift blink, flags, static telemetry threshold, test pattern.

Key gap: the UI already models rich colors in `revlights.ts`, but the SIM-X firmware cannot render them. This is the most visible parity gap.

### 3.2 RGB matrix / iFlag

SimHub behavior:

- Matrix can show gear, flags, spotter, and custom animations.
- Supported hardware includes WS2812B 8x8, DM163/SunFounder iFlag shield, and SunFounder I2C RGB matrix.
- Setup supports serpentine option and rotation.
- Newer SimHub supports up to 4 logical matrix contents, assigned to separate Arduinos.

Our MVP:

- Implement a matrix component with size `8x8` first, hardware type `WS2812 RGB matrix` first.
- Firmware protocol should support either full RGB frame (`64 * 3 = 192 bytes`, likely binary/COBS or hex chunks) or indexed palette frame; text-only `M<16 hex>` is insufficient.
- App-side presets: yellow/blue/white/red/green/checkered flags, gear glyphs, pit limiter, spotter arrows.
- Config: width/height, serpentine, rotation, data pin, brightness, content slot.

Key gap: current `M<16 hex>` is monochrome and MAX7219-oriented. It can be retained as “single-color matrix,” but iFlag needs RGB.

### 3.3 SSD1306 OLED / text display

SimHub behavior:

- One I2C SSD1306 OLED is supported; memory-heavy on Uno/Nano and not enough memory on Micro per docs.
- Templates live in SimHub install directory and can be edited.
- Multiple USB mode replicates the OLED content.

Our MVP:

- Promote existing OLED pages to a board component: SSD1306 128x64 I2C.
- Add component config: I2C address, rotation, line count, font mode, update rate.
- Keep current `T<row>`/`N` companion protocol for generic firmware; keep SIM-X legacy `O`/`D` adapter.
- Add a simple page/template builder rather than full pixel graphics initially.

Key gap: we have runtime OLED rendering but not a setup-time component model or template editor.

### 3.4 Character LCD

SimHub behavior:

- 16x2/20x4 I2C LCDs with common addresses `0x27`/`0x3f`.
- Alternative LCD library option for incompatible backpacks.
- Testing mode can print “hello world” on startup.

Our MVP:

- Component config: `16x2`/`20x4`, I2C address, update rate.
- Reuse text-page renderer with row/column constraints.
- Firmware library choice can wait; first firmware can target the most common PCF8574 backpack.

### 3.5 Seven-segment drivers: TM1637, TM1638, MAX7219

SimHub behavior:

- TM1637: up to 6 4-digit or RobotDyn 6-digit modules.
- TM1638: display + buttons + LEDs; dual-color and single-color modules; LED editor controls LEDs.
- MAX7219/MAX7221: up to 6 cascaded 8-digit modules.

Our MVP:

- Start with TM1637 4-digit because it is cheap and simple: component fields for CLK/DIO, digits, decimal point support, brightness, bound value/format.
- Add MAX7219 8-digit after a generic “segment display” abstraction exists.
- Treat TM1638 as a compound component: segment display + LED bank + buttons. It needs both input and output routing.

Key gap: our generic serial output can drive a user-written segment firmware, but users cannot define a segment module/pinout and have us generate firmware.

### 3.6 Buttons, matrix, encoders, analog inputs

SimHub behavior:

- Buttons and encoders work inside SimHub on supported boards; only Pro Micro/Leonardo/ATmega32U4 expose them as native gamepad/HID.
- Button matrix is momentary-only and does not support multiple simultaneous presses in the documented wiring.
- Encoders must have compatible half-step/full-step timing; EC11 is recommended.

Our MVP:

- Keep companion RX messages (`B`, `E`, `A`) as the logical protocol.
- Add setup components: button, encoder, analog axis, button matrix, CD74HC4067 mux.
- Add per-input metadata: label, pin(s), pullup mode, debounce, invert, HID mapping/action mapping.
- Generate firmware that can either report to app only or expose HID on Pro Micro/Leonardo.

Key gap: we can parse inputs, but we cannot create the firmware/pinout that scans arbitrary user inputs.

### 3.7 Custom serial device parity

SimHub behavior:

- User defines arbitrary ASCII messages, multiple update messages at different frequencies, connect/disconnect messages, reconnect behavior, and custom settings inserted into formulas.
- Empty messages are skipped; SimHub does not add start/terminator automatically.

Our MVP:

- Existing `OutputRoute` and `interpolateTemplate()` are a good base.
- Add per-route rate limit (`changes only`, Hz), connect/disconnect messages, serial settings per device, and import/export presets.
- Add an “advanced” panel for raw formulas/expressions only after safe expression boundaries are defined.

### 3.8 Buzzer / piezo

SimHub evidence:

- No dedicated buzzer page was found in the fetched official wiki pages. However, alerts are a common output class and can be implemented through custom serial/firmware.

Our MVP:

- Simple `tone` output component: digital pin, active/passive type, default frequency, duration, pattern.
- Bind to shift point, pit limiter, flags, low fuel, off-track, custom expressions.

### 3.9 Gauges: servo, stepper, real automotive gauges

SimHub evidence:

- Official fetched pages document real automotive tach/boost/speedo/E36-cluster signal generation, not a clearly verified first-party SG90/X27/VID29 page.
- Treat SG90/X27/VID29 as a requested parity item to verify against current SimHub UI/manual before claiming exact official support.

Our MVP:

- Defer until after displays/LEDs/inputs unless physical gauges become core product direction.
- If implemented, use a generic “gauge output” abstraction: input telemetry range, output min/max, smoothing, calibration/test sweep, zeroing.
- First firmware path: servo gauge (Servo library) is simpler than stepper. Stepper needs zeroing/homing strategy and persistent calibration.

### 3.10 Motors, haptics, wind, relays

SimHub behavior:

- ShakeIt supports vibration motors and fans using motor shields, Monster Moto, and PWM fans.
- Docs emphasize power, polarity, current limits, USB noise, and thermal shutdown risks.

Our MVP:

- Do not include in “Arduinos menu MVP” unless we intentionally expand into haptics.
- Still reserve architecture for high-current outputs: component type, external-power warnings, MOSFET/driver requirements, safety copy.

## 4. Firmware / setup-tool implications

### 4.1 What SimHub effectively provides

SimHub's setup tool is a firmware generator/configurator:

- Board selection and port selection.
- Named device identity for multi-Arduino support.
- Feature enablement and pin assignment.
- Conflict detection for pins, though some shared-pin experiments can still be uploaded.
- Sketch upload through Arduino tooling/AVR upload pipeline.
- Optional profile save/load for later modifications.

Sources: [Arduino Setup](https://github.com/SHWotever/SimHub/wiki/Arduino--Setup), [Multiple devices support](https://github.com/SHWotever/SimHub/wiki/Arduino-Multiple-devices-support).

### 4.2 What we need to build

Recommended firmware/setup architecture:

1. **Board profiles**
   - AVR first: Uno/Nano/Mega/Leonardo/Pro Micro.
   - Mark Pro Micro/Leonardo as HID-capable.
   - ESP32 should be a separate later path because flashing uses esptool/arduino-cli core support rather than classic AVR-only assumptions.

2. **Component schema**
   - Each component declares required pins, optional pins, power warnings, library dependencies, memory cost, update rate, and runtime capabilities.
   - Example: `ws2812Strip` requires one data pin, count, color order, brightness; depends on FastLED/Adafruit_NeoPixel.

3. **Pin allocator/conflict checker**
   - Enforce unique pins by default.
   - Allow intentional sharing only for known-safe buses: I2C SDA/SCL, SPI bus with separate CS, TM1637 shared CLK/DIO edge cases if we explicitly support them.
   - Board-specific forbidden/caution pins: Nano A6/A7 not digital; D13 onboard LED caution; I2C pins vary by board.

4. **Firmware generator**
   - Short term: generate `.ino` from templates with `#define` feature blocks.
   - Medium term: maintain a single firmware with compile-time feature flags.
   - Long term: prebuilt firmware variants for common board/component combinations plus a capability descriptor stored in the app.

5. **Uploader**
   - Use `arduino-cli` for compile/upload where possible, invoking `avrdude` underneath for AVR boards.
   - Keep upload logs visible and actionable.
   - Auto-close serial connection before flash and reopen after flash.
   - For Pro Micro/Leonardo, handle bootloader reset timing and document manual reset fallback.

6. **Capability handshake**
   - On connect, companion firmware should emit a version/capability line, e.g. `HELLO simx-companion v2 caps=rgbstrip,matrixrgb,oled,buttons,encoders,analog hid=1 leds=32 matrix=8x8`.
   - App should reject/gray out routes if firmware lacks the target capability.
   - This fixes the current SIM-X limitation where firmware does not report version.

7. **Protocol evolution**
   - Keep newline ASCII for low-rate debug and simple components.
   - Add a binary or chunked frame protocol for RGB strip/matrix to avoid huge hex strings and partial-frame tearing.
   - Include sequence numbers/checksums for frame outputs.
   - Keep inbound input events (`B`, `E`, `A`) line-oriented for monitor readability.

### 4.3 Prebuilt vs generated firmware

Recommended hybrid:

- **P1:** ship prebuilt “Companion Standard” firmware for Pro Micro/Leonardo and Uno/Nano with a constrained component set: WS2812 strip, SSD1306 OLED, 8x8 RGB matrix, buttons/encoders/analog.
- **P2:** add generated firmware for arbitrary pinouts and TM1637/TM1638/MAX7219/LCD.
- **P3:** ESP32, TFT, haptics, wind, automotive gauges.

## 5. Recommended implementation order

### Phase 1 — Make the hub credible

1. **Device/component data model**: board, serial port, firmware version, component list, pinout, capabilities.
2. **Capability handshake** in new companion firmware.
3. **Addressable RGB LED strip** with real per-LED color frames.
4. **SSD1306 OLED component** using existing renderers.
5. **Buttons + encoders + analog input components** using existing `B`/`E`/`A` parse model.
6. **Custom serial parity basics**: per-device templates, rate limits, connect/disconnect messages.

Why first: these map directly to existing app code and close the biggest mismatch between UI promises and firmware reality.

### Phase 2 — SimHub-style displays and iFlag

1. **RGB 8x8 matrix / iFlag** with flags, gear, spotter arrows, rotation, serpentine.
2. **Single-color MAX7219 matrix** polish: fonts, gear default, icon library.
3. **TM1637 4/6-digit segment display**.
4. **Character LCD 16x2/20x4**.
5. **Button matrix + CD74HC4067 mux configuration**.
6. **Import/export hardware profiles** so users can share setups like SimHub profiles.

Why second: high visible parity and low-to-medium firmware complexity.

### Phase 3 — Advanced SimHub ecosystem

1. **TM1638 compound module**: display + LED bank + buttons.
2. **MAX7219 7-segment cascades**.
3. **Buzzer/piezo alerts**.
4. **Servo/stepper/automotive gauges**, after verifying current SimHub support details.
5. **Motors/haptics/wind/relays** only if the product intentionally moves beyond button boxes/displays.
6. **ESP32/TFT** only as a separate high-bandwidth display/device track.

## 6. Highest-impact gaps

1. **Firmware capability gap:** current SIM-X firmware cannot identify itself or declare supported components.
2. **RGB output gap:** app models per-LED colors, but firmware only renders fixed 4-LED levels.
3. **Matrix gap:** current `M<16 hex>` is monochrome; SimHub-style iFlag requires RGB matrix frames, rotation, serpentine, and content presets.
4. **Setup-tool gap:** no board/pin/component schema, no compile/upload pipeline, no pin conflict checker.
5. **Input-generation gap:** app parses `B/E/A`, but users cannot define arbitrary buttons/encoders/axes and flash a scanner/HID firmware.
6. **Display-driver gap:** OLED is partially supported; LCD and seven-segment modules are absent.
7. **Custom serial parity gap:** existing templates lack SimHub-like per-message frequency, connect/disconnect messages, settings panel, and import/export/freeze.

## Sources

Official SimHub / SHWotever wiki pages reviewed:

- [Arduino Setup](https://github.com/SHWotever/SimHub/wiki/Arduino--Setup)
- [Arduino Multiple devices support](https://github.com/SHWotever/SimHub/wiki/Arduino-Multiple-devices-support)
- [Arduino WS2812B RGB LEDs wiring/setup](https://github.com/SHWotever/SimHub/wiki/Arduino-WS2812b-RGBLEDS--Wiring-Setup)
- [Arduino PL9823 RGB LEDs wiring/setup](https://github.com/SHWotever/SimHub/wiki/Arduino-PL9823-RGBLEDS--Wiring-Setup)
- [LED Editor guide](https://github.com/SHWotever/SimHub/wiki/LED-Editor-guide)
- [Arduino RGB Matrix](https://github.com/SHWotever/SimHub/wiki/Arduino-RGB-Matrix)
- [Arduino MAX7219 Matrix wiring](https://github.com/SHWotever/SimHub/wiki/Arduino-MAX7219-Matrix-Wiring)
- [Arduino SSD1306 0.96 OLED I2C](https://github.com/SHWotever/SimHub/wiki/Arduino-SSD1306-0.96''-Oled-I2C)
- [Arduino 20x4 or 16x2 I2C LCD](https://github.com/SHWotever/SimHub/wiki/Arduino-20x4-or-16x2-I2C-LCD)
- [Arduino TM1637 Display wiring](https://github.com/SHWotever/SimHub/wiki/Arduino-Tm1637-Display-Wiring)
- [Arduino TM1637 6 digits RobotDyn wiring](https://github.com/SHWotever/SimHub/wiki/Arduino-Tm1637-6Digits-Display-Wiring-(RobotDyn))
- [Arduino TM1638 Display wiring](https://github.com/SHWotever/SimHub/wiki/Arduino-Tm1638-Display-Wiring)
- [Arduino MAX7219/MAX7221 7-segment display](https://github.com/SHWotever/SimHub/wiki/Arduino--MAX7219-MAX7221-7-segment-display)
- [Arduino Press Buttons](https://github.com/SHWotever/SimHub/wiki/Arduino-Press-Buttons)
- [Arduino Button matrix](https://github.com/SHWotever/SimHub/wiki/Arduino---Button-matrix)
- [Arduino Rotary Encoders](https://github.com/SHWotever/SimHub/wiki/Arduino-Rotary-Encoders)
- [Arduino ShakeIt](https://github.com/SHWotever/SimHub/wiki/Arduino-Shake-It)
- [Arduino ShakeIt Wind simulation](https://github.com/SHWotever/SimHub/wiki/Arduino-ShakeIt-Wind-simulation)
- [Arduino After Market Tach support](https://github.com/SHWotever/SimHub/wiki/Arduino-After-Market-Tach-support)
- [Arduino After Market Boost Gauge](https://github.com/SHWotever/SimHub/wiki/Arduino-After-Market-Boost-Gauge)
- [Arduino After Market Speedo support](https://github.com/SHWotever/SimHub/wiki/Arduino-After-Market-Speedo-support)
- [BMW E36 Cluster Setup](https://github.com/SHWotever/SimHub/wiki/BMW-E36-Cluster-Setup)
- [Custom serial devices](https://github.com/SHWotever/SimHub/wiki/Custom-serial-devices)
- [Nextion Display](https://github.com/SHWotever/SimHub/wiki/Nextion-Display)
- [Nextion end of support](https://github.com/SHWotever/SimHub/wiki/Nextion---End-of-support)
