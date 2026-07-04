#line 1 "/Users/guilhermebasso/Downloads/SIM-X-ButtonBox/05_firmware_arduino/button_box/pinout.h"
/*
 * pinout.h — SIM-X Button Box (REVISADO QA rev 16 — joystick analógico KY-023 + encoders KY-040)
 * Pinagem do Arduino Pro Micro (ATmega32u4)
 *
 *  Pro Micro pinos físicos:
 *    D0 (RX)  — NÃO USAR (reservado para USB upload — não soldar nada)
 *    D1 (TX)  — NÃO USAR (reservado para USB upload — não soldar nada)
 *    D2 (SDA) → I2C OLED 0.96" SSD1306
 *    D3 (SCL) → I2C OLED 0.96" SSD1306
 *    D4, D5, D6, D7 → MUX seletores S0..S3 (compartilhados)
 *    D8       → MUX1_SIG
 *    D9       → MUX2_SIG  (= A9 — usado também como entrada analógica para joystick)
 *    D10      → REV_LED_PIN (WS2812B Rev Lights)
 *    D14, D15 → ENC1_A (CLK), ENC1_B (DT)   ← KY-040 TC
 *    D16, A3  → ENC2_A (CLK), ENC2_B (DT)   ← KY-040 ABS
 *    A2, A1   → ENC3_A (CLK), ENC3_B (DT)   ← KY-040 BIAS
 *    A0       → MUX3_SIG (3º MUX — 8 MX)
 *
 *  ENC4 (4º encoder MAP) é lido VIA MUX1 (canais 14 e 15), sem interrupt.
 *
 *  ⚠️ TOTAL = 3 MUX. Comprar 3× CD74HC4067.
 *  ⚠️ Serial USB (115200) — reservada para SimHub (Custom Serial Devices).
 *  ⚠️ Display 7" é HDMI (monitor separado, migrado do Nextion na rev 14)
 *      — SimHub Dash Studio renderiza o dashboard diretamente nele.
 *
 *  REV 16 — JOYSTICK ANALÓGICO (KY-023 / módulo PS2 5-pinos):
 *    O joystick agora é analógico (2 potenciômetros + 1 botão), não 5-way digital.
 *    Como o CD74HC4067 é um MUX analógico bilateral, VRX/VRY são lidos via MUX2
 *    fazendo analogRead(A9) (pois D9 = A9 no Pro Micro).
 *
 *    Wiring do KY-023:
 *      GND  → GND do Arduino
 *      +5V  → VCC do Arduino
 *      VRX  → MUX2 canal C14
 *      VRY  → MUX2 canal C15
 *      SW   → MUX2 canal C13 (botão push do joystick)
 *
 *  ENCODERS KY-040 (módulo EC11 montado em PCB, 5 pinos: CLK, DT, SW, +, GND):
 *    Os 4 encoders agora são módulos KY-040 (EC11 em PCB) — vêm com resistores
 *    pull-up onboard de 10kΩ. O pino "+" (VCC) PRECISA estar ligado em +5V para
 *    os pull-ups funcionarem; sem isso, leitura fica errática.
 *
 *    Wiring por encoder KY-040:
 *      GND → GND do Arduino
 *      +   → VCC (+5V) do Arduino
 *      CLK → pino do Pro Micro listado acima (ENC*_A) — ou MUX1 C14 (enc4)
 *      DT  → pino do Pro Micro listado acima (ENC*_B) — ou MUX1 C15 (enc4)
 *      SW  → MUX1 canal C10 (TC), C11 (ABS), C12 (BIAS), C13 (MAP)
 *
 *    Firmware: nenhuma mudança em relação ao EC11 puro. A biblioteca Encoder
 *    do PJRC faz INPUT_PULLUP nos pinos CLK/DT internamente, e o MUX1_SIG
 *    já é INPUT_PULLUP. O pull-up onboard do KY-040 fica em paralelo com o
 *    pull-up interno do AVR (~50kΩ), resultando em pull-up efetivo de ~8.3kΩ
 *    — mais robusto pra cabos longos sem mudança de código.
 */

#ifndef PINOUT_H
#define PINOUT_H

// ===== MUX seletores (compartilhados S0..S3) =====
#define MUX_S0  4
#define MUX_S1  5
#define MUX_S2  6
#define MUX_S3  7

// ===== MUX sinais (1 pino por MUX) =====
#define MUX1_SIG  8
#define MUX2_SIG  9
#define MUX3_SIG  A0    // 3º MUX adicionado QA rev 4

// ===== WS2812B Rev Lights =====
#define REV_LED_PIN  10

// ===== Encoders dedicados (3 unidades) =====
#define ENC1_A  14
#define ENC1_B  15
#define ENC2_A  16
#define ENC2_B  A3
#define ENC3_A  A2
#define ENC3_B  A1
// ENC4 é polled via MUX1 canais 14 e 15 (sem #define de pino)

/*
 * ================================================
 * MAPEAMENTO DOS CANAIS DOS MUX (49 inputs digitais)
 * ================================================
 *
 *  MUX1 (sinal D8) — 16 canais:
 *    C0:    Engine Start
 *    C1:    Flip Cover toggle
 *    C2-C5: Toggles 3-pos UP   (TC_HL, Type, Menu, PAGE)
 *    C6-C9: Toggles 3-pos DOWN (TC_HL, Type, Menu, PAGE)
 *    C10-C13: Push dos encoders (Push TC, ABS, BIAS, MAP)
 *    C14, C15: ENC4_A, ENC4_B (4º encoder MAP — leitura polled)
 *
 *  MUX2 (sinal D9 = A9) — 16 canais:
 *    C0-C2: 3 botões iluminados laranja Ø20mm (Ilha PIT & FUEL)
 *    C3-C5: 3 botões iluminados verdes  Ø20mm (Ilha LIGHTS & AUX)
 *    C6-C8: 3 botões iluminados azuis   Ø16mm (Ilha BLACK BOX)
 *    C9-C12: livres (eram joystick 5-way digital — rev 16 trocou por KY-023 analógico)
 *    C13:   Joystick SW (botão push do KY-023)
 *    C14:   Joystick VRX (eixo X analógico — lido via analogRead(A9))
 *    C15:   Joystick VRY (eixo Y analógico — lido via analogRead(A9))
 *
 *  MUX3 (sinal A0) — 16 canais:
 *    C0-C7: 8 botões Cherry MX (RAD, DRS, WIP, INFO, TEMP, LAP, PIT, OK)
 *    C8-C15: livres (futuro / hot-swap)
 *
 * ================================================
 * MAPA DE HID BUTTONS (USB Joystick — 32 botões total)
 * ================================================
 *  HID 0      : Engine Start
 *  HID 1      : Flip Cover → TAP (vira ON / abre)        ← REV 25
 *  HID 2-5    : Toggles 3-pos UP
 *  HID 6-9    : Toggles 3-pos DOWN
 *  HID 10-13  : Push dos encoders
 *  HID 14-21  : 8 botões Cherry MX
 *  HID 22-24  : 3 botões laranja
 *  HID 25-27  : 3 botões verdes
 *  HID 28-30  : 3 botões azuis
 *  HID 31     : Joystick CLICK
 *  HID 32-33  : Encoder 1 (TC)   CW / CCW   ← REV 24
 *  HID 34-35  : Encoder 2 (ABS)  CW / CCW   ← REV 24
 *  HID 36-37  : Encoder 3 (BIAS) CW / CCW   ← REV 24
 *  HID 38-39  : Encoder 4 (MAP)  CW / CCW   ← REV 24
 *  HID 40     : Flip Cover → TAP (vira OFF / fecha)      ← REV 25
 *  POV (Hat0) : Joystick UP/DOWN/LEFT/RIGHT
 *
 *  Encoders CW/CCW (8 ações) → enviados via SERIAL ao SimHub:
 *    Protocolo: "E<idx>:+1\n" ou "E<idx>:-1\n"  (idx = 0..3)
 *    SimHub usa o plugin "Custom Serial Devices" para mapear esses eventos
 *    em keystrokes ou ações.
 */

// ===== LEDs status =====
// Sem pinos GPIO livres! Soluções:
// - LED POWER: ligado direto em VCC via resistor 220Ω (sempre aceso)
// - LED START: TXLED interno do Pro Micro via macros TX_RX_LED_INIT / TXLED0 / TXLED1
//   (mais portável que pinMode(30) — funciona em qualquer clone de Pro Micro)
//   ⚠️ TXLED também pisca com tráfego serial — não é 100% estável como status persistente
//   Alternativa: ligue o LED START do painel direto em VCC via 220Ω (sempre aceso)

#endif
