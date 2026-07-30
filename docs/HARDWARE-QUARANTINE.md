# Hardware quarantine register

> [!CAUTION]
> **Do not build, wire or flash anything from a quarantined document.**
> The documents listed here contradict each other, contradict the reference
> firmware, or contradict the part they claim to describe. Every quarantine on
> this page can only be lifted by a **qualified person doing an electrical
> review against the manufacturer datasheets**, followed by a bench test. It
> cannot be lifted by reading this file, by a code review, or by an agent.

Audit references: §13 (Hardware, firmware e segurança física), **P0-08**
(quarantine incompatible docs/firmware), **§24-14** (quarantine obsolete
WIRING / SimHub / protocol documents).

This register records **what conflicts**, with citations. It deliberately does
**not** decide which side is correct: adjudicating a circuit from a datasheet is
an electrical-engineering judgement, and a confident wrong answer here damages
hardware or injures someone.

---

## Q1 — `WIRING.csv`, `WIRING.xlsx`, `BOM.csv`, `BOM.xlsx`, `previews/02-wiring-diagram.svg`

**Status: QUARANTINED — not an assembly source.**

### Q1.1 The same physical multiplexer pin is assigned two different jobs, four times

| Physical pin | First assignment in `WIRING.csv` | Second assignment in `WIRING.csv` |
| --- | --- | --- |
| 6 | `Pro Micro,GND,GND,CD74HC4067,6,GND (VEE)` | `CD74HC4067,6,C4,ENC5,CLK` |
| 7 | `CD74HC4067,7,C5,ENC6,CLK` | `CD74HC4067,7,C11,ENC6,DT` |
| 8 | `Pro Micro,GND,GND,CD74HC4067,8,GND` | `CD74HC4067,8,C6,ENC1,DT` |
| 16 | `Pro Micro,VCC,5V,CD74HC4067,16,VCC` | `CD74HC4067,16,C10,ENC5,DT` |

The document flags the pin-7 case itself, in the `Notas` column:
`Pin 7 do mux (C5 e C11 — verificar datasheet)` and
`Atenção: pin 7 = C5 e C11 no CD74HC4067 standard. Verificar datasheet específico do módulo.`
The pin 6, 8 and 16 collisions are **not** flagged anywhere.

Wiring a supply rail and a signal channel to the same physical pin is the class
of error that destroys parts. **This is the reason the CSVs are quarantined.**

### Q1.2 The BOM package and the WIRING pin numbering do not agree

`BOM.csv` item 4 states:

> `CD74HC4067 Multiplexador 16ch, … ⚠️ Pacote DIP24/SOIC24 (NÃO DIP16); preferir módulo breakout com labels C0-C15`

`WIRING.csv` numbers the part as `VCC = 16`, `GND = 8`, `GND (VEE) = 6`,
`SIG/COM = 1`, `S0 = 10`, `S1 = 11`, `S2 = 14`, `S3 = 13`.

Whether those pin numbers describe the **24-pin** TI part the BOM specifies is
exactly the question that must be answered against the datasheet:

- <https://www.ti.com/lit/ds/symlink/cd74hc4067.pdf>

**Not adjudicated here.** A reviewer must confirm the package, the pinout and
the `VEE` treatment against that document, and state which of the two files is
wrong.

### Q1.3 `WIRING.csv` contradicts the reference firmware

`firmware/sim-x-reference/pinout.h` is the **canonical** firmware pinout
(`firmware/sim-x-reference/README.md` — "Grave ESTE firmware no Pro Micro").
It is incompatible with `WIRING.csv` on almost every line:

| Signal | `firmware/sim-x-reference/pinout.h` | `WIRING.csv` |
| --- | --- | --- |
| Multiplexer count | **3×** CD74HC4067 (`⚠️ TOTAL = 3 MUX. Comprar 3× CD74HC4067.`) | 1 mux; `BOM.csv` item 4 buys **1** |
| Mux selectors S0..S3 | `D4, D5, D6, D7` | `D5, D6, A0/D14, D16` |
| Mux signal lines | `D8 = MUX1_SIG`, `D9 = MUX2_SIG`, `A0 = MUX3_SIG` | single `A0 = SIG/COM`; `D8`/`D9` used as encoder switches |
| Encoder inputs | `D14/D15`, `D16/A3`, `A2/A1` (KY-040 modules) | `D14`/`D16` used as mux selectors; `A2`/`A3` used as encoder switches |
| Encoder count | **4** (ENC4 read via MUX1) | **6** (`ENC1`…`ENC6`) |
| Rev lights | `D10 = REV_LED_PIN` (WS2812B) | **absent** — yet the app sends `R<lvl>` rev-light frames (`app-v2/src/main/protocol.ts`) |
| Joystick | KY-023 analog on MUX2 `C13/C14/C15` (rev 16) | **absent** |

The app's own device descriptor also reports **4** encoders for a SIM-X device
(`app-v2/src/main/serial/device.ts`, `encoders: this.kind === 'sim-x' ? 4 : undefined`),
which matches the firmware, not the CSV.

### Q1.4 `WIRING.csv` contradicts itself on the OLED supply

The same `Pro Micro,VCC` pin is described as `5V` in the multiplexer row and as
`3.3V` in the OLED row (`Pro Micro,VCC,3.3V,OLED SSD1306,VCC,VCC,…,OLED aceita 3.3V ou 5V`).

### How to lift Q1

1. A qualified person reviews the CD74HC4067 datasheet and states the correct
   package and pinout for the part in the BOM.
2. The same person decides the canonical topology (1 mux vs 3, 4 encoders vs 6)
   **together with** the firmware owner, since the firmware pinout is the other
   half of the contradiction.
3. `WIRING.csv`, `BOM.csv`, their `.xlsx` siblings and
   `previews/02-wiring-diagram.svg` are **regenerated** from that decision — not
   patched — and bench tested before this quarantine is removed.

`.xlsx` files cannot carry an inline banner and are quarantined by this register
alone. Treat `WIRING.xlsx` and `BOM.xlsx` exactly as their `.csv` twins.

---

## Q2 — `docs/serial-protocol.md`

**Status: QUARANTINED — documents a firmware that must not be flashed.**

It describes the **ButtonBox firmware v3** management protocol
(`>ID?` / `MAP` / `CFG` / `SAVE`). That firmware is already deprecated:
`firmware/buttonbox_v3/DEPRECATED.md` says *"Do not flash this firmware"*.

The live protocols are:

- **SIM-X / SimHub one-letter protocol** — `app-v2/src/main/protocol.ts` +
  `firmware/sim-x-reference/`.
- **Companion v2** — `app-v2/src/shared/companion.ts` +
  `firmware/companion/PROTOCOL.md` and the `app-v2/firmware/companion-*`
  sketches. **Not quarantined** — this is current and in use.

---

## Q3 — `simhub/custom_serial_bb.md` and `firmware/buttonbox_v2/`

**Status: QUARANTINED — superseded SimHub Custom Serial mapping.**

`simhub/custom_serial_bb.md` configures SimHub for `buttonbox_v2.ino`. Neither
the v2 firmware nor its serial mapping matches the canonical SIM-X protocol in
`app-v2/src/main/protocol.ts`. Following it while the app is also connected
produces two writers on one COM port.

---

## Q4 — `firmware/buttonbox_v3/`

**Status: ALREADY QUARANTINED** by `firmware/buttonbox_v3/DEPRECATED.md`.
Listed here for completeness; no change made.

---

## What is NOT quarantined

- `firmware/sim-x-reference/` — canonical SIM-X firmware and pinout.
- `firmware/companion/` and `app-v2/firmware/companion-*` — current companion v2
  protocol, matching `app-v2/src/shared/companion.ts`.

---

## Human sign-off required

None of the following can be closed by an agent, a test suite or a code review:

| Item | Who | Evidence needed to lift |
| --- | --- | --- |
| Q1.1 duplicate physical pins 6 / 7 / 8 / 16 | Qualified electrical reviewer | Corrected netlist, datasheet-checked |
| Q1.2 DIP24/SOIC24 vs 16-pin numbering | Qualified electrical reviewer | Explicit statement of package + pinout vs the TI datasheet |
| Q1.3 1 mux vs 3, 4 encoders vs 6, missing rev-light and joystick rows | Maintainer + firmware owner | A single canonical topology decision |
| Q1 regeneration | Maintainer | CSV/XLSX/SVG regenerated from the decision, bench tested |
| Q2 / Q3 protocol consolidation | Maintainer | One canonical protocol declared; superseded docs deleted or archived |
