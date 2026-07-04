/*
 * SIM-X Button Box — Firmware (REV 38 — Idle/PC-off sleep mode + QA Round 1 fixes)
 *
 * REV 38: ataca "fica tudo aceso quando desligo o PC".
 *   CAUSA RAIZ: placa-mae do PC entrega +5V Standby (USB +5VSB) mesmo com PC desligado,
 *   pra wake-on-USB/charging. Arduino Pro Micro continua rodando. LEDs iluminados dos
 *   botoes (laranja/verde/azul) + LED POWER do painel sao alimentados direto do +5V,
 *   NAO dao apagar via firmware (precisa MOSFET externo ou cortar +5VSB no hardware).
 *
 *   O QUE DA pra apagar via firmware (e o que esta rev faz):
 *     - WS2812B Rev Lights (4 LEDs em D10)
 *     - OLED SSD1306 (oled.setPowerSave(1))
 *     - TXLED interno do Pro Micro
 *
 *   GATILHO de sleep mode (apos QA Round 1 - dropped USB_OFF_TIMEOUT curto):
 *     - 60s sem atividade (Serial, botao, encoder)
 *     - 30s de grace pos-boot (user ver "SIM-X Ready" mesmo sem PC enumerado)
 *
 *   WAKE de sleep mode (qualquer atividade):
 *     - Qualquer botao mudou de estado -> markActivity() -> exitSleepMode()
 *     - Qualquer encoder emitiu click -> markActivity() -> exitSleepMode()
 *     - Serial CDC reconecta (PC ligou) -> usbJustReturned -> exitSleepMode()
 *     - Byte recebido do SimHub -> markActivity() -> exitSleepMode()
 *
 *   QA Round 1 fixes (3 modelos: Gemini + Opus + GPT 5.5):
 *     - markActivity() agora ACORDA do sleep (era so updateLastActivity, faltava chamar exit)
 *     - exit edge-detect usbJustReturned (era usbAlive direto -> flicker quando fullIdle)
 *     - DROP USB_OFF_TIMEOUT curto: causava falso sleep no iRacing sem SimHub aberto
 *     - BOOT_GRACE_MS 30s: cold-boot sem PC nao apaga "SIM-X Ready" em 3s
 *     - encoderPress: release ANTES de press em sucessao rapida (OS via held continuo)
 *     - consumeEncoder: decrementa pending em vez de ZERAR (perdia clicks acumulados)
 *     - drena loop em readDedicatedEncoders (era 1 evento por loop)
 *     - MUX settle 5us -> 10us (era marginal: RC do pull-up interno ~2us τ)
 *     - readJoystick rate 5ms -> 2ms (5ms era regressao vs 3.2ms baseline pre-REV37)
 *     - canPrint re-checado por evento Serial.println (era 1x, podia bloquear no 2o)
 *
 *   SOLUCAO HARDWARE complementar (pra apagar os LEDs dos botoes tambem):
 *     - USB hub powered com switch fisico por porta (recomendado)
 *     - BIOS: desabilitar "ErP Ready" / "Deep S5" / "USB Wake" (corta +5VSB)
 *     - Cabo USB com chave on/off in-line
 *   Ver 01_manual_montagem/README ou seccao "Sleep Mode" do README do firmware.
 *
 * REV 37 (latency pass — atacar "joystick lento no iRacing/SimHub"):
 *   1. delay(2) no fim do loop REMOVIDO (era 60% do tempo do loop = 2ms de 3.2ms).
 *      Loop agora roda full-speed ~1-1.5ms = ~700-1000Hz polling rate.
 *      Watchdog 4s + Wire.setWireTimeout 25ms continuam protegendo de hang real.
 *   2. muxReadDigital settle 15us -> 5us. CD74HC4067 spec é ~50ns, 15us era 300x folgado.
 *      29+ leituras/loop x 10us economizados = ~300us/loop a menos.
 *   3. DEBOUNCE_MS 20 -> 8ms. Cherry MX bounce ~5ms, switches industriais ~6-8ms.
 *      Latencia minima por botao cai de 20ms para 8ms (>2x mais responsivo).
 *   4. ENC_PRESS_MS 50 -> 20ms. Suficiente pro iRacing/Windows HID detectar como tap,
 *      mas permite 50 clicks/sec sem fila (era 20/sec antes).
 *   5. readJoystick() rate-limited 5ms (200Hz). Pot analogico nao precisa 300Hz polling,
 *      e leitura era ~600us/loop (analogRead x2 + descarte + 50us settle x2).
 *      Resultado: ~600us liberados em ~16 de cada 17 loops.
 *   6. JOY_SETTLE_US 50 -> 20us. Mux CD74HC4067 ja settled em <1us.
 *   7. Timer1 ISR 4kHz -> 2kHz. Encoder KY-040 max ~30 clicks/sec = 120 transicoes/sec.
 *      2kHz amostra 16x acima de Nyquist - sobra margem. CPU em ISR cai pela metade.
 *   8. Serial.println dos encoder events agora checa availableForWrite() pra nao block
 *      se buffer USB CDC encher (acontece se SimHub fecha mas USB enumera).
 *
 * REV 36: Solucao consensus pos-consulta 2 modelos (Opus + GPT) pros 2 bugs persistentes:
 *   ENCODERS: Timer1 ISR @ 2kHz amostra 3 encoders dedicados. Decoder emite apenas
 *             ao retornar ao detente apos ciclo gray-code completo (threshold 4).
 *             Sem gate temporal, sem direction lockout - estes ESTAVAM CAUSANDO
 *             o "slow + oscillating" das revs anteriores.
 *   FLIP COVER: removido auto-cal (estava aprendendo thresholds errados por charge
 *               retention no ADC). Pre-descarga do pino (LOW 300us) antes de cada
 *               read elimina memoria capacitiva. Schmitt fixo: ON>650, OFF<350.
 * REV 34: OLED delta debug throttled 1Hz + shsds 8-layer fallback (mantido).
 * REV 33: Buxtronix state machine (REVERTIDO no rev 35 - polaridade incompativel).
 * REV 31: Flip cover = B1 toggle puro (sem B40+TAP). HID descriptor 41->40. invert=true default.
 *         Anti-bounce inicial nos encoders (depois revisado em rev 32).
 * REV 30: Switch ON -> B1 HELD continuo. Switch OFF -> B1 released + B40 TAP 50ms.
 *         Util pra mapear como ignition (B1 held) + off event (B40 tap) no iRacing.
 * REV 29: HIDs do flip cover trocados (B40=ON, B01=OFF — convencao do Gui)
 *         + speedups (cal timeout 8s->1.5s, threshold 150->80, throttle 5ms->2ms,
 *         settle 100us->30us). Latencia do flip cover: ~10s -> <250ms tipico.
 * REV 28: Flip cover lido como analógico (analogRead A8) sem pullup, contornando
 *         o LED em série do switch automotivo que mascara transições no modo digital.
 * Plataforma: Arduino Pro Micro (ATmega32u4)
 *
 * REV 19: ataca a causa raiz do "joystick reagiu, depois travou" do rev18.
 *  - I²C OLED em 400 kHz (era 100 kHz) → drawOled() de ~150ms → ~40ms
 *    Resultado: setup de ~56s real → ~28s real (bem mais perto dos tempos anunciados)
 *  - Wire.setWireTimeout(25ms, reset=true) → I²C nunca trava CPU em hang real
 *  - Watchdog Timer (WDTO_4S) habilitado SÓ NO LOOP (não no boot diag, pois diag dura >4s)
 *  - Serial.dtr() gate antes de Serial.print de encoders → evita stall 250ms quando USB CDC
 *    está enumerado mas SimHub não está aberto pra dranar o FIFO
 *  - BTN SCAN reduzido de 80 → 40 iter (com I²C fast = 10s reais, suficiente pra testar)
 *  - BTN SCAN máscara M2=0x3FFF para não confundir VRX/VRY (canais 14/15 analógicos) com botões
 * Autor: Guilherme Basso (build pessoal sim-racing)
 *
 * Layout do painel (REV 15) — 7 ilhas categóricas em relevo:
 *   ┌─ REV LIGHTS (topo, full-width) ────────────────────┐
 *   │ tira WS2813 4 LEDs (rev 20: era 16, ajustado)      │
 *   ├─ IN-CAR ADJUSTMENTS ───┬─ IGNITION ────────────────┤
 *   │ 4× encoder + 4× toggle │ Engine Start + Flip Cover │
 *   │ (TC / ABS / MAP / BIAS)│ + 2 LEDs (POWER / START)  │
 *   ├─ PIT & FUEL ────────┬──┴───────────────────────────┤
 *   │ 3× laranja 19mm     │                              │
 *   ├─ LIGHTS & AUX ──────┤   BLACK BOX (col. direita)   │
 *   │ 3× verde 19mm       │   OLED + joystick 5-way      │
 *   ├─────────────────────┴───┤ + 3× azul 16mm           │
 *   │   MULTI-FUNCTION ───────┴──────────────────────────│
 *   │   8× Cherry MX (grid 2×4)                          │
 *   └────────────────────────────────────────────────────┘
 *
 * Hardware (pinout INALTERADO vs rev 14):
 *  - 3× MUX CD74HC4067 (MUX1=D8, MUX2=D9, MUX3=A0; seletores S0..S3 = D4..D7)
 *  - 3× encoders rotativos EC11 dedicados (TC, ABS, BIAS) + 1 encoder no MUX1 (MAP)
 *  - 4× toggles 3-pos ON-OFF-ON (8 polos: TC_HL, Type, Menu, PAGE) no MUX1
 *  - 1× Engine Start, 1× Flip cover toggle SPDT (MUX1)
 *  - 8× botões mecânicos Cherry MX (MUX3)
 *  - 3× botões iluminados laranja Ø20 + 3× verdes Ø20 + 3× azuis Ø16 (MUX2)
 *  - 1× joystick analógico KY-023 (2 potenciômetros + SW) no MUX2
 *      (REV 16: trocado o 5-way digital pelo KY-023; VRX/VRY lidos via
 *       analogRead(A9) usando MUX2 como mux analógico bilateral — sem perda
 *       de funcionalidade, gera POV hat de 8 direções via thresholding)
 *  - 1× OLED 0.96" SSD1306 I2C (D2/D3)
 *  - 4× LEDs WS2813 rev lights (D10) — rev 20: era 16
 *
 * REV 23: OLED rotacionado 180° (U8G2_R2) — Gui colou de ponta-cabeça
 *
 * REV 15: redesign 3D do painel (bordas R15, 7 ilhas em relevo). Pinout/firmware
 * lógico INALTERADO — apenas a posição física dos componentes no painel mudou.
 * Display 7" continua HDMI externo (rev 14). SimHub Dash Studio no monitor 2.
 *
 * REV 16: joystick 5-way digital substituído pelo módulo analógico KY-023
 * (mais barato, mais fácil de encontrar). Como o CD74HC4067 é um mux analógico
 * bilateral e D9 (MUX2_SIG) é também A9 no Pro Micro, os eixos VRX/VRY são lidos
 * via analogRead após selecionar os canais 14 e 15 do MUX2. O firmware converte
 * os valores analógicos em um POV hat de 8 direções (compatível com o jogo),
 * exatamente como o 5-way fazia. SW continua no canal 13 (HID button 31).
 * Canais MUX2 C9-C12 (antes UP/DOWN/LEFT/RIGHT) ficam LIVRES.
 * Wiring KY-023: GND→GND, +5V→VCC, VRX→MUX2 C14, VRY→MUX2 C15, SW→MUX2 C13.
 *
 * Comunicação:
 *  - USB HID (Joystick library — 32 botões + 1 hat)
 *  - Serial USB 115200 com SimHub:
 *      RX (Arduino recebe do SimHub):
 *        "R<0..4>\n"            → nível das rev lights (rev 20: era 0..16)
 *        "B<0|1>\n"             → shift indicator azul piscante (rev 21)
 *        "O<l1>|<l2>|<l3>\n"    → texto OLED (3 linhas, máx 18 chars cada)
 *        "D<num>\n"             → BIGNUM OLED (rev 22) — fonte 38px centralizada (delta/gap)
 *        "S0\n" / "S1\n"        → liga/desliga LED START (TXLED interno)
 *      TX (Arduino envia para SimHub):
 *        "E<idx>:+1\n" / "E<idx>:-1\n"   → click de encoder (idx=0..3)
 *
 *  ⚠️ ENCODERS rotacionais NÃO aparecem como botões HID em Windows Game Controllers.
 *     Só funcionam dentro do SimHub via plugin "Custom Serial Devices" (mapeia
 *     "E<idx>:+1" / "E<idx>:-1" em ações/keystrokes). PUSH dos encoders (HID 10-13)
 *     aparecem normalmente em Game Controllers.
 *
 * Libraries (Arduino IDE → Library Manager):
 *  - "Joystick" by Matthew Heironimus
 *  - "Encoder" by Paul Stoffregen
 *  - "FastLED" by Daniel Garcia
 *  - "U8g2" by Oliver Kraus
 */

#include <Joystick.h>
#include <FastLED.h>
#include <U8g2lib.h>
#include <Wire.h>

#include "pinout.h"
#include <avr/wdt.h>

// REV 36: forward declaration da struct EncoderState (definida abaixo) pra Arduino IDE
// gerar protótipos das funcoes que a usam sem erro.
struct EncoderState {
  uint8_t stable;
  uint8_t lastRaw;
  uint8_t sameCount;
  uint8_t detentState;
  int8_t  accum;
  volatile int8_t pending;
};

// REV 38: forward decls pra Arduino IDE — markActivity() chama exitSleepMode()
// que esta definido bem mais abaixo.
void markActivity();
void enterSleepMode();
void exitSleepMode();


// ===== HID Joystick (41 botões + POV) =====
// REV 31: HID 0-31: botões físicos (B1 = flip cover toggle), 32-39: encoders CW/CCW.
// B40 removido (era flip cover OFF tap no rev 30).
Joystick_ Joystick(
  JOYSTICK_DEFAULT_REPORT_ID,
  JOYSTICK_TYPE_GAMEPAD,
  40,                              // REV 31: era 41 — B40 removido
  1,
  false, false, false,
  false, false, false,
  false, false,
  false, false, false
);

// ===== REV 24: Encoder → HID button press/release =====
//   Cada encoder gera 2 botões HID (CW = base, CCW = base+1):
//     ENC1 (TC):   HID 32 (CW), HID 33 (CCW)
//     ENC2 (ABS):  HID 34 (CW), HID 35 (CCW)
//     ENC3 (BIAS): HID 36 (CW), HID 37 (CCW)
//     ENC4 (MAP):  HID 38 (CW), HID 39 (CCW)
//   REV 37: Press dura 20ms (era 50ms) — suficiente pro iRacing/Windows HID detectar
//   como tap mas permite ate 50 clicks/sec (era 20/sec) sem enfileirar.
const uint8_t ENC_HID_BASE = 32;
const uint16_t ENC_PRESS_MS = 20;
uint32_t encReleaseTime[8] = {0};  // release timestamp pra cada HID 32..39

void encoderPress(uint8_t encIdx, int8_t dir) {
  uint8_t btnOffset = encIdx * 2 + (dir > 0 ? 0 : 1);
  uint8_t hid = ENC_HID_BASE + btnOffset;
  // REV 38 QA Round 3 nota (Opus M1): com o gating em readDedicatedEncoders/readMuxedEncoder
  // este branch tornou-se defensivo - call sites atuais nunca entram aqui com encReleaseTime != 0.
  // Mantido como safety net pra futuros call sites (ex: comandos de teste via Serial).
  if (encReleaseTime[btnOffset] != 0) {
    Joystick.releaseButton(hid);
  }
  Joystick.pressButton(hid);
  encReleaseTime[btnOffset] = millis() + ENC_PRESS_MS;
  markActivity();  // REV 38: acorda do sleep
}

void encoderReleaseTick() {
  uint32_t now = millis();
  for (uint8_t i = 0; i < 8; i++) {
    // REV 38 QA Round 2 fix (GPT + Gemini HIGH): rollover-safe comparison.
    // (int32_t)(now - encReleaseTime[i]) >= 0 funciona corretamente em rollover @ 49 dias.
    // Comparacao direta now >= encReleaseTime[i] falha: se encReleaseTime wrap antes de now,
    // pode dar release imediato OU button stuck por 49 dias.
    if (encReleaseTime[i] && (int32_t)(now - encReleaseTime[i]) >= 0) {
      Joystick.releaseButton(ENC_HID_BASE + i);
      encReleaseTime[i] = 0;
    }
  }
}

// ===== Encoders =====
// REV 26: ENC3 movido para polled gray-code (igual ENC4) — PJRC Encoder não estava
// detectando rotação em alguns clones de Pro Micro nos pinos A1/A2 (PF6/PF5).
// REV 31: ENC1 e ENC2 TAMBEM migrados pra polled gray-code — bounce mecanico do EC11
// inflava counts no PJRC (ISR conta toda transicao), gerando press na direcao oposta.
//   ENC1 (TC):   polled gray-code    — pinos dedicados D14/D15
//   ENC2 (ABS):  polled gray-code    — pinos dedicados D16/A3
//   ENC3 (BIAS): polled gray-code    — pinos A2/A1
//   ENC4 (MAP):  polled gray-code    — MUX1 canais 14/15

// REV 36: Estados dos encoders agora estao em encs[] array (definido na secao do Timer1 ISR mais abaixo).

// ===== OLED (page buffer mode "1" — usa 128B em vez de 1024B do full buffer "F") =====
// REV 23: U8G2_R2 = rotação 180° (Gui colou OLED de ponta-cabeça)
//   Opções: U8G2_R0 (0°), U8G2_R1 (90° CW), U8G2_R2 (180°), U8G2_R3 (270° CW), U8G2_MIRROR (espelhado)
U8G2_SSD1306_128X64_NONAME_1_HW_I2C oled(U8G2_R2, U8X8_PIN_NONE);

// Buffer das 3 linhas de texto (21 chars + \0). Total: 66 bytes
char oledLines[3][22] = {{0}, {0}, {0}};

// REV 22: Modo BIGNUM (fonte gigante centralizada) pra mostrar GAP/DELTA da volta
//   oledMode = 0 → text 3 linhas (modo padrão, comando 'O')
//   oledMode = 1 → bignum centralizado (comando 'D')
char bigNum[10] = "";
uint8_t oledMode = 0;

void drawOled() {
  oled.firstPage();
  do {
    // REV 38 QA Round 2 fix (Gemini HIGH): poll ENC4 (polled-only) entre pages I2C
    // pra nao perder transicoes quando OLED redraw bloqueia ~24ms a 400kHz.
    // ENC4 fica no main loop (sem ISR), entao precisa polling continuo. Cada page
    // I2C ~3ms, suficiente pra capturar transicoes do KY-040 (max ~120/sec).
    readMuxedEncoder();

    if (oledMode == 1 && bigNum[0]) {
      // BIGNUM mode: fonte 38px centralizada (usa logisoso38_tn — só 0-9, +, -, .)
      oled.setFont(u8g2_font_logisoso38_tn);
      uint8_t w = oled.getStrWidth(bigNum);
      uint8_t x = (w >= 128) ? 0 : (128 - w) / 2;
      oled.drawStr(x, 50, bigNum);   // y=50 → baseline pra centralizar font 38px na altura 64
    } else {
      // TEXT mode: 3 linhas pequenas
      oled.setFont(u8g2_font_ncenB08_tr);
      if (oledLines[0][0]) oled.drawStr(0, 14, oledLines[0]);
      if (oledLines[1][0]) oled.drawStr(0, 30, oledLines[1]);
      if (oledLines[2][0]) oled.drawStr(0, 46, oledLines[2]);
    }
  } while (oled.nextPage());
}

// ===== Rev Lights =====
// REV 20: NUM_REV_LEDS 16 → 4 (fita do usuário tem só 4 LEDs)
// Cores: 1 verde / 2 amarelos / 1 vermelho (padrão F1 compacto)
// REV 21: shift indicator azul piscante via comando 'B1\n' (SimHub @ RPM > shift point)
#define NUM_REV_LEDS 4
CRGB revLeds[NUM_REV_LEDS];
uint8_t revLevel = 0;
uint8_t revLevelLast = 255;   // força refresh inicial
bool shiftBlink = false;      // REV 21: ativo quando SimHub manda B1
bool shiftBlinkLast = false;

// ===== Serial buffer (char[] em vez de String — evita fragmentação de heap) =====
char serialBuf[64];
uint8_t serialBufLen = 0;

// ===== MUX helpers =====

void muxSelect(uint8_t ch) {
  digitalWrite(MUX_S0, (ch >> 0) & 0x01);
  digitalWrite(MUX_S1, (ch >> 1) & 0x01);
  digitalWrite(MUX_S2, (ch >> 2) & 0x01);
  digitalWrite(MUX_S3, (ch >> 3) & 0x01);
}

bool muxReadDigital(uint8_t sigPin, uint8_t ch) {
  muxSelect(ch);
  // REV 38 QA fix (Gemini HIGH): 5us era marginal. CD74HC4067 propaga em ~50ns, OK.
  // Mas RC do pull-up interno ATmega (~30kOhm) + Cstray linha (~75pF) tem τ ~2us.
  // 5us = ~2.5τ, sobe so ate ~92% de Vcc - marginal pra threshold 3V.
  // 10us = 5τ = ~99% Vcc, seguro contra ghost reads. Ainda economiza 5us vs 15us original.
  delayMicroseconds(10);
  return digitalRead(sigPin) == LOW;
}

// ===== REV 36: Flip cover via leitura ANALOGICA com pre-descarga + Schmitt fixo =====
// Solucao consensus pos-consulta Opus+GPT pos rev 31-35 que tinha sintoma "DOWN+UP pra release".
// Root cause: ADC pin ficava com carga residual (no LED em serie no LOAD) que mantinha leitura
// alta mesmo apos switch ir pra OFF. Auto-cal aprendia thresholds errados disso.
// Solucao: pre-descarregar o pino (pull LOW 300us) antes de cada leitura. Thresholds FIXOS.
#define MUX1_SIG_ANALOG       A8
#define FLIP_THRESH_HIGH      650
#define FLIP_THRESH_LOW       350
#define FLIP_DEBOUNCE_SAMPLES 3
#define FLIP_POLL_INTERVAL_MS 5

int flipCoverAnalogRaw = -1;
bool flipCoverState    = false;
bool flipRawState      = false;  // GPT QA: separa estado raw (Schmitt) do logico
bool flipCoverInvert   = false;  // REV 36: hardware do Gui — raw alto = UP/ON direto, sem invert
uint32_t flipCoverNextPrint = 0;
uint32_t flipCoverLastPollMs = 0;
bool flipCandidate = false;
uint8_t flipCandidateCount = 0;

static int median3(int a, int b, int c) {
  if (a > b) { int t=a; a=b; b=t; }
  if (b > c) { int t=b; b=c; c=t; }
  if (a > b) { int t=a; a=b; b=t; }
  return b;
}

// REV 36: FC reseta candidato (mantido pra compat com cmd serial FC)
void flipCoverResetCal() {
  flipCandidate = false;
  flipCandidateCount = 0;
}

bool readFlipCoverAnalog() {
  uint32_t pollNow = millis();
  if (pollNow - flipCoverLastPollMs < FLIP_POLL_INTERVAL_MS) return flipCoverState;
  flipCoverLastPollMs = pollNow;

  // GPT QA fix: muxSelect ANTES de OUTPUT LOW — evita descarregar canal anterior
  muxSelect(1);
  delayMicroseconds(5);  // mux settle (~170ns spec, 5us folga)

  // PRE-DESCARGA: pull MUX1_SIG pra GND (descarrega capacitancia parasita do LED em serie)
  pinMode(MUX1_SIG, OUTPUT);
  digitalWrite(MUX1_SIG, LOW);
  delayMicroseconds(300);

  // Solta o pino e deixa o switch carregar a linha
  pinMode(MUX1_SIG, INPUT);  // sem pullup
  delayMicroseconds(500);

  // Le (descarta primeira, median3 das proximas)
  (void)analogRead(MUX1_SIG_ANALOG);
  int s1 = analogRead(MUX1_SIG_ANALOG);
  int s2 = analogRead(MUX1_SIG_ANALOG);
  int s3 = analogRead(MUX1_SIG_ANALOG);

  // Restaura pullup p/ proximas leituras digitais dos outros canais MUX1
  pinMode(MUX1_SIG, INPUT_PULLUP);
  delayMicroseconds(300);  // REV 36e: era 20us. Da tempo pro cap do pino carregar via pull-up
                           // antes da proxima leitura (especialmente C14/C15 do ENC4 que
                           // sofriam HID 39 spurio quando flip OFF — sem caminho pra +5V).
  // REV 36e: dummy read em canal "neutro" (C0) pra forcar muxSelect+carga via outro path
  // antes de qualquer leitura subsequente. C0 tem switch Engine Start (+5V via pull-up).
  (void)digitalRead(MUX1_SIG);  // descarta - so pra estabilizar

  int v = median3(s1, s2, s3);
  flipCoverAnalogRaw = v;

  // GPT QA fix: Schmitt opera em flipRawState dedicado (nao em flipCoverState lógico).
  // Antes: usava flipCoverState como memoria, mas com invert=true ficava semanticamente errado.
  if (v >= FLIP_THRESH_HIGH) flipRawState = true;
  else if (v <= FLIP_THRESH_LOW) flipRawState = false;
  // Dentro da banda morta: flipRawState mantem ultimo valor

  // Aplica inversao logica APENAS na saida (apos Schmitt)
  bool logicalState = flipCoverInvert ? !flipRawState : flipRawState;

  // Debounce: precisa de N amostras consecutivas concordando
  if (logicalState != flipCandidate) {
    flipCandidate = logicalState;
    flipCandidateCount = 0;
  } else if (flipCandidateCount < 255) {
    flipCandidateCount++;
  }
  if (flipCandidateCount >= FLIP_DEBOUNCE_SAMPLES) {
    flipCoverState = flipCandidate;
  }

  // Print throttled 1Hz pra debug via Serial Monitor
  if (Serial && pollNow >= flipCoverNextPrint) {
    flipCoverNextPrint = pollNow + 1000;
    Serial.print(F("F v="));
    Serial.print(v);
    Serial.print(F(" raw="));
    Serial.print(flipRawState);
    Serial.print(F(" inv="));
    Serial.print(flipCoverInvert);
    Serial.print(F(" s="));
    Serial.println(flipCoverState);
  }
  return flipCoverState;
}


// ===== Debounce simples por botão HID =====
// REV 31: array dimensionado pra 40 botões (era 41 — B40 removido do HID descriptor).
// REV 37: DEBOUNCE_MS 20 -> 8ms. Cherry MX bounce ~5ms, switches industriais ~6-8ms.
// Latencia minima por botao cai de 20ms para 8ms (>2x mais responsivo no iRacing).
bool btnState[40];
unsigned long btnLastChange[40];
const unsigned long DEBOUNCE_MS = 8;

// REV 31: Flip Cover = TOGGLE simples no HID B1.
//   Switch ON  → B1 PRESSED (held)
//   Switch OFF → B1 RELEASED
// Sem B40, sem tap. SimHub/iRacing usa "on press" e "on release" do mesmo B1.

void setButtonState(uint8_t hidBtn, bool pressed) {
  if (hidBtn >= 40) return;          // REV 31: era 41
  unsigned long now = millis();
  if (btnState[hidBtn] != pressed && (now - btnLastChange[hidBtn]) > DEBOUNCE_MS) {
    btnState[hidBtn] = pressed;
    btnLastChange[hidBtn] = now;
    Joystick.setButton(hidBtn, pressed);
    markActivity();  // REV 38: acorda do sleep
  }
}

void flipCoverReleaseTick() {
  // intentionally empty - REV 31 nao usa mais TAP/B40
}

// ===== REV 36: Encoders via Timer1 ISR @ 2kHz + decodificacao por legalidade =====
// Solucao consensus pos-consulta Opus+GPT pos rev 35 que ainda perdia detentes.
// Root cause identificado: gate temporal + polling 500Hz = undersampling.
// Solucao: Timer1 ISR amostra a 2kHz, decoder emite APENAS ao retornar ao detente
// apos ciclo gray-code valido. Sem gate, sem lockout, sem reset on reversal artificial.
//
// Trade-off: Timer1 nao pode ser usado por Servo/PWM-D9-D10. FastLED usa bit-bang OK.

// Tabela quadrature padrao (mesma dos revs anteriores)
const int8_t encDecodeTable[16] PROGMEM = {
   0, -1,  1,  0,
   1,  0,  0, -1,
  -1,  0,  0,  1,
   0,  1, -1,  0
};

#define ENC_DETENT_THRESHOLD_DEFAULT 2  // KY-040 20 PPR = 2 transicoes/detente (half-step). Ajustavel via cmd 'ET<N>'.
volatile int8_t encDetentThreshold = ENC_DETENT_THRESHOLD_DEFAULT;  // GPT QA: volatile pq lida na ISR
bool debugMuxEnc = false;  // REV 36c: toggle via cmd serial 'EM' pra imprimir C13/C14/C15 raw

// State por encoder (struct EncoderState declarada no topo do arquivo)
EncoderState encs[4];  // 0=ENC1, 1=ENC2, 2=ENC3, 3=ENC4 (muxed - polled separadamente)

// Atualiza um encoder com nova leitura raw. Chamado da ISR pros dedicados,
// do loop pro muxado. Inline pra eficiencia na ISR.
static inline void updateEncoder(EncoderState& e, uint8_t raw) {
  // Debounce por estabilidade: precisa de 2 amostras iguais consecutivas
  if (raw == e.lastRaw) {
    if (e.sameCount < 255) e.sameCount++;
  } else {
    e.lastRaw = raw;
    e.sameCount = 0;
    return;
  }
  if (e.sameCount < 2) return;
  if (raw == e.stable) return;  // sem mudanca

  uint8_t oldStable = e.stable;
  e.stable = raw;

  // Decodifica via tabela
  uint8_t key = (oldStable << 2) | raw;
  int8_t delta = (int8_t)pgm_read_byte_near(&encDecodeTable[key & 0x0F]);

  if (delta == 0) {
    // Transicao ilegal (2 bits mudaram) - bounce/glitch, reseta accum
    e.accum = 0;
    e.detentState = raw;
    return;
  }

  e.accum += delta;

  // GPT QA fix: usa while+update detentState pra drenar overshoot completamente
  // (era if simples — causava double-emit residual quando threshold < transicoes/detente)
  if (raw == e.detentState) {
    int8_t th = encDetentThreshold;
    while (e.accum >= th) {
      if (e.pending < 127) e.pending++;
      e.accum -= th;
    }
    while (e.accum <= -th) {
      if (e.pending > -127) e.pending--;
      e.accum += th;
    }
  }
}

// Consume eventos pendentes (chamado do loop principal). Retorna -1/0/+1.
// REV 38 QA fix (Gemini CRITICAL): drena UM evento por chamada via decrement.
// Antes: e.pending era ZERADO unconditionally - clicks acumulados (ex: durante drawOled)
// eram permanentemente PERDIDOS. Loop principal roda a ~700-1000Hz, mais que suficiente
// pra drenar burst de encoder (max ~120 transicoes/sec do KY-040).
// REV 38 QA Round 2 (Gemini suggestion): SREG save/restore em vez de interrupts()
// unconditional. Defensivo - permite chamar inline de dentro de ISR sem reabilitar
// IRQs prematuramente. Hoje so chamado do loop, mas trivial e seguro.
static inline int8_t consumeEncoder(EncoderState& e) {
  int8_t v;
  uint8_t oldSREG = SREG;
  cli();
  if (e.pending > 0)      { e.pending--; v = +1; }
  else if (e.pending < 0) { e.pending++; v = -1; }
  else                    { v = 0; }
  SREG = oldSREG;
  return v;
}

// ISR Timer1 @ 2kHz - amostra os 3 encoders dedicados (ENC4 muxado fica no loop)
ISR(TIMER1_COMPA_vect) {
  uint8_t s1 = (digitalRead(ENC1_A) << 1) | digitalRead(ENC1_B);
  uint8_t s2 = (digitalRead(ENC2_A) << 1) | digitalRead(ENC2_B);
  uint8_t s3 = (digitalRead(ENC3_A) << 1) | digitalRead(ENC3_B);
  updateEncoder(encs[0], s1);
  updateEncoder(encs[1], s2);
  updateEncoder(encs[2], s3);
}

void setupEncoderTimer() {
  noInterrupts();
  TCCR1A = 0;
  TCCR1B = 0;
  TCNT1  = 0;
  // REV 37: CTC mode @ 2kHz (era 4kHz no rev 36b). KY-040 max ~30 clicks/sec
  // = 120 transicoes/sec. 2kHz amostra 16x acima de Nyquist - mais que suficiente.
  // ISR custa ~60us (6 digitalRead lentos + 3 updateEncoder). 2kHz x 60us = 12% CPU
  // em ISR (era 24% a 4kHz). Mais tempo livre pro loop principal e FastLED.
  // 16MHz / 64 / 125 = 2000Hz exato.
  OCR1A = 124;
  TCCR1B |= (1 << WGM12) | (1 << CS11) | (1 << CS10);
  TIMSK1 |= (1 << OCIE1A);
  interrupts();
}

void readDedicatedEncoders() {
  // REV 38 QA Round 2 fix (GPT + Gemini CRITICAL): gated emit (era while-drain).
  // While-drain emitia release+press em microssegundos -> Windows HID polling (1-8ms)
  // coalescia eventos em 1 hold continuo. Agora emite 1 evento por encoder QUANDO
  // o anterior ja foi released (encReleaseTime == 0 para ambos CW e CCW). Pacing
  // natural = ENC_PRESS_MS (20ms) = max 50 events/sec por encoder = sobra pra KY-040.
  for (uint8_t i = 0; i < 3; i++) {
    uint8_t btnCW  = i * 2;
    uint8_t btnCCW = i * 2 + 1;
    if (encReleaseTime[btnCW] != 0 || encReleaseTime[btnCCW] != 0) continue;
    int8_t d = consumeEncoder(encs[i]);
    if (d) {
      encoderPress(i, d);
      if (Serial && Serial.availableForWrite() >= 8) {
        Serial.print('E'); Serial.print(i); Serial.println(d > 0 ? ":+1" : ":-1");
      }
    }
  }
}

// ENC3 ja consumido em readDedicatedEncoders. Mantemos stub vazio.
void readPolledEnc3() { /* consumido em readDedicatedEncoders via Timer1 ISR */ }

void readMuxedEncoder() {
  // REV 36d: REGRESSION FIX - voltou pra logica simples REV 15 (que comprovadamente
  // funcionava). REV 32-36 adicionaram gating por detentState + reset destrutivo +
  // stability check que JUNTOS bloqueavam emissao. REV 15 acumulava delta sempre
  // (mesmo delta=0 nao destruia) e emitia ao atingir threshold, SEM gating.
  uint8_t a = !muxReadDigital(MUX1_SIG, 14) ? 1 : 0;
  uint8_t b = !muxReadDigital(MUX1_SIG, 15) ? 1 : 0;
  uint8_t raw = (a << 1) | b;

  EncoderState& e = encs[3];
  uint8_t key = (e.stable << 2) | raw;
  int8_t delta = (int8_t)pgm_read_byte_near(&encDecodeTable[key & 0x0F]);
  e.accum += delta;
  e.stable = raw;

  // REV 38 QA Round 2 fix (GPT + Gemini CRITICAL): gated emit pra evitar coalescing.
  // ENC4 = HID 38 (CW), HID 39 (CCW) = encReleaseTime[6,7].
  // Accum continua acumulando entre loops, sem perda. So emit quando previous released.
  if (encReleaseTime[6] != 0 || encReleaseTime[7] != 0) return;

  int8_t th = encDetentThreshold;  // default 2 (cmd 'ET<N>' altera runtime: 1, 2, 4, 8)
  if (e.accum >= th) {
    e.accum -= th;
    encoderPress(3, +1);
    if (Serial && Serial.availableForWrite() >= 8) Serial.println("E3:+1");
  } else if (e.accum <= -th) {
    e.accum += th;
    encoderPress(3, -1);
    if (Serial && Serial.availableForWrite() >= 8) Serial.println("E3:-1");
  }
}

// REV 36c: debug raw mux do ENC4 a cada 250ms. Toggle via cmd serial 'EM'.
// Use pra confirmar se CLK (C14) e DT (C15) estao oscilando ao girar ENC4.
void debugMuxEncTick() {
  if (!debugMuxEnc || !Serial) return;
  static uint32_t lastT = 0;
  uint32_t now = millis();
  if (now - lastT < 250) return;
  lastT = now;
  muxSelect(13); delayMicroseconds(15); bool c13 = digitalRead(MUX1_SIG);
  muxSelect(14); delayMicroseconds(15); bool c14 = digitalRead(MUX1_SIG);
  muxSelect(15); delayMicroseconds(15); bool c15 = digitalRead(MUX1_SIG);
  Serial.print(F("MUX1 C13(SW)=")); Serial.print(c13);
  Serial.print(F(" C14(CLK)=")); Serial.print(c14);
  Serial.print(F(" C15(DT)=")); Serial.println(c15);
}

// ===== Joystick analógico KY-023 no MUX2 (C13=SW, C14=VRX, C15=VRY) =====
// Lê VRX/VRY como analógicos via MUX (CD74HC4067 é bilateral e passa analógico).
// D9 (MUX2_SIG) é também A9 no Pro Micro, então analogRead(A9) funciona após
// selecionar o canal do MUX. Converte em POV hat de 8 direções via thresholding.
//
// Calibração (joystick em repouso fica em ~512):
//   < JOY_LOW   → direção negativa (LEFT / UP)
//   > JOY_HIGH  → direção positiva (RIGHT / DOWN)
//   meio       → centro (deadzone)
#define JOY_LOW   300
#define JOY_HIGH  700
#define JOY_SETTLE_US  20   // REV 37: era 50us. CD74HC4067 ja settled em <1us.
#define JOY_RATE_MS    2    // REV 38 QA fix (Opus): era 5ms (200Hz). Pre-REV37 era ~3.2ms (313Hz).
                            // 2ms = 500Hz analog poll, mais rapido que baseline pre-REV37,
                            // custo desprezivel (~600us em loop de ~1.5ms).

// DEBUG: se = 1, envia valores raw do joystick pela Serial a cada 250ms.
// Use APENAS pra diagnóstico (desligar SimHub) — depois volte pra 0 e recompile.
#define JOYSTICK_SERIAL_DEBUG 0

// Valores raw publicados pelo último readJoystick() — usados pelo boot diag
// que mostra no OLED. volatile pq podem ser lidos em momentos diferentes.
volatile int  joyDbgX  = -1;
volatile int  joyDbgY  = -1;
volatile bool joyDbgSW = false;

void readJoystick() {
  // REV 37: rate-limit a 5ms (200Hz). Joystick analogico KY-023 e pot mecanico,
  // 200Hz de polling > rate de movimento humano. Libera ~600us em ~16 de cada 17 loops.
  static uint32_t lastJoyMs = 0;
  uint32_t nowMs = millis();
  if (nowMs - lastJoyMs < JOY_RATE_MS) return;
  lastJoyMs = nowMs;

  // Para ler analógico no MUX2_SIG (D9/A9), removemos temporariamente o
  // pull-up interno (que está habilitado para a leitura digital dos botões).
  pinMode(MUX2_SIG, INPUT);

  // VRX no canal 14
  muxSelect(14);
  delayMicroseconds(JOY_SETTLE_US);
  (void)analogRead(A9);           // descarta primeira leitura (ADC settle)
  int vrx = analogRead(A9);

  // VRY no canal 15
  muxSelect(15);
  delayMicroseconds(JOY_SETTLE_US);
  (void)analogRead(A9);
  int vry = analogRead(A9);

  // Restaura pull-up para as próximas leituras digitais dos botões do MUX2
  pinMode(MUX2_SIG, INPUT_PULLUP);

  // SW no canal 13 (digital, ativo em LOW com pull-up interno)
  bool click = muxReadDigital(MUX2_SIG, 13);

  // Publica valores raw pra outros módulos (boot diag / serial debug)
  joyDbgX  = vrx;
  joyDbgY  = vry;
  joyDbgSW = click;

  #if JOYSTICK_SERIAL_DEBUG
    static unsigned long lastDbg = 0;
    unsigned long nowDbg = millis();
    if (nowDbg - lastDbg >= 250) {
      lastDbg = nowDbg;
      Serial.print("JD VRX=");  Serial.print(vrx);
      Serial.print(" VRY=");    Serial.print(vry);
      Serial.print(" SW=");     Serial.println(click ? 1 : 0);
    }
  #endif

  // Converte eixos em direções discretas
  bool left  = (vrx < JOY_LOW);
  bool right = (vrx > JOY_HIGH);
  bool up    = (vry < JOY_LOW);
  bool down  = (vry > JOY_HIGH);
  // Se o seu joystick estiver invertido em algum eixo, basta trocar < por >
  // nas linhas acima (ex: bool up = (vry > JOY_HIGH); bool down = (vry < JOY_LOW);)

  int16_t hat = -1;
  if (up && !down) {
    if (right)       hat = 45;
    else if (left)   hat = 315;
    else             hat = 0;
  } else if (down && !up) {
    if (right)       hat = 135;
    else if (left)   hat = 225;
    else             hat = 180;
  } else if (right)  hat = 90;
  else if (left)     hat = 270;

  // REV 38 QA Round 2 fix (Gemini suggestion): hat change conta como atividade.
  // Sem isso, movimentar joystick analogico em sleep mode nao acordava o OLED/LEDs.
  static int16_t lastHat = -2;  // -2 = nunca setado (diferente do -1 = centro)
  if (hat != lastHat) {
    lastHat = hat;
    markActivity();
  }
  Joystick.setHatSwitch(0, hat);
  setButtonState(31, click);
}

// ===== Botões nos MUX1, MUX2, MUX3 =====
void readAllButtons() {
  // ----- MUX1 -----
  // C0: Engine Start (HID 0)
  setButtonState(0, muxReadDigital(MUX1_SIG, 0));
  // C1: Flip cover (HID 1) — REV 28: leitura ANALÓGICA via A8 pra contornar LED em série
  setButtonState(1, readFlipCoverAnalog());
  // C2..C5: Toggles 3-pos UP (HID 2..5)
  // C6..C9: Toggles 3-pos DOWN (HID 6..9)
  for (uint8_t i = 0; i < 4; i++) {
    setButtonState(2 + i, muxReadDigital(MUX1_SIG, 2 + i));
    setButtonState(6 + i, muxReadDigital(MUX1_SIG, 6 + i));
  }
  // C10..C13: Push dos encoders (HID 10..13)
  for (uint8_t i = 0; i < 4; i++) {
    setButtonState(10 + i, muxReadDigital(MUX1_SIG, 10 + i));
  }
  // C14, C15: ENC4 A, B — tratado em readMuxedEncoder()

  // ----- MUX3 — 8 Cherry MX (HID 14..21) -----
  for (uint8_t i = 0; i < 8; i++) {
    setButtonState(14 + i, muxReadDigital(MUX3_SIG, i));
  }

  // ----- MUX2 — botões iluminados + joystick -----
  // C0..C2: 3 laranja (HID 22..24)
  for (uint8_t i = 0; i < 3; i++) {
    setButtonState(22 + i, muxReadDigital(MUX2_SIG, i));
  }
  // C3..C5: 3 verdes (HID 25..27)
  for (uint8_t i = 0; i < 3; i++) {
    setButtonState(25 + i, muxReadDigital(MUX2_SIG, 3 + i));
  }
  // C6..C8: 3 azuis (HID 28..30)
  for (uint8_t i = 0; i < 3; i++) {
    setButtonState(28 + i, muxReadDigital(MUX2_SIG, 6 + i));
  }
  // C9..C12: livres (eram joystick 5-way digital — agora KY-023 analógico)
  // C13: joystick SW + C14/C15: VRX/VRY (tratados em readJoystick)
}

// ===== Serial (SimHub → Arduino) =====
void handleSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    markActivity();  // REV 38: qualquer byte do SimHub conta como atividade
    if (c == '\n') {
      if (serialBufLen > 0) {
        serialBuf[serialBufLen] = '\0';
        char cmd = serialBuf[0];
        if (cmd == 'R') {
          revLevel = constrain(atoi(&serialBuf[1]), 0, NUM_REV_LEDS);
        } else if (cmd == 'B') {
          // REV 21: shift indicator azul piscante
          // B1 = ativa, B0 = desativa (volta pro modo R)
          shiftBlink = (atoi(&serialBuf[1]) != 0);
        } else if (cmd == 'O') {
          // Parse "line1|line2|line3" direto no buffer (sem String)
          // REV 22: sai do modo BIGNUM e volta pro modo text
          oledMode = 0;
          uint8_t idx = 0;
          uint8_t start = 1;
          memset(oledLines, 0, sizeof(oledLines));
          for (uint8_t i = 1; i <= serialBufLen && idx < 3; i++) {
            if (serialBuf[i] == '|' || i == serialBufLen) {
              uint8_t lineLen = i - start;
              if (lineLen > 21) lineLen = 21;
              memcpy(oledLines[idx], &serialBuf[start], lineLen);
              oledLines[idx][lineLen] = '\0';
              start = i + 1;
              idx++;
            }
          }
          drawOled();
        } else if (cmd == 'D') {
          // REV 33: Delta/Gap em BIGNUM — fonte 38px centralizada
          // Aceita 0-9, +, -, . (font logisoso38_tn). Outros chars sao ignorados pela font.
          // Debug throttled (1Hz) pra Gui ver no Serial Monitor sem saturar buffer USB.
          uint8_t len = serialBufLen - 1;
          if (len > 9) len = 9;
          memcpy(bigNum, &serialBuf[1], len);
          bigNum[len] = '\0';
          oledMode = 1;
          static uint32_t lastDPrint = 0;
          uint32_t nowD = millis();
          if (Serial && (nowD - lastDPrint) >= 1000) {
            Serial.print(F("D=")); Serial.println(bigNum);
            lastDPrint = nowD;
          }
          drawOled();
        } else if (cmd == 'S') {
          // S1 = liga LED START, S0 = apaga (TXLED via macros, mais portável)
          #ifdef TX_RX_LED_INIT
            if (atoi(&serialBuf[1])) { TXLED0; } else { TXLED1; }
          #endif
        } else if (cmd == 'F') {
          char sub = serialBufLen >= 2 ? serialBuf[1] : 0;
          if (sub == 'I' || sub == 'i') {
            flipCoverInvert = !flipCoverInvert;
            flipCoverState = !flipCoverState;
            btnState[1] = flipCoverState;
            btnLastChange[1] = millis();
            // REV 31: sincroniza HID B1 (sem B40, sem tap)
            Joystick.setButton(1, flipCoverState);
          } else if (sub == 'C' || sub == 'c') flipCoverResetCal();
        } else if (cmd == 'E') {
          // REV 36b: ET<N>\n = set encoder detent threshold (1, 2, 4 ou 8)
          // Permite testar threshold em runtime sem reflashar.
          // KY-040 padrao 20 PPR = 2 (half-step). EC11 24-detente = 4. Se duplicar = subir.
          char sub = serialBufLen >= 2 ? serialBuf[1] : 0;
          if (sub == 'T' || sub == 't') {
            int8_t v = atoi(&serialBuf[2]);
            if (v >= 1 && v <= 8) {
              encDetentThreshold = v;
              if (Serial) { Serial.print(F("ET=")); Serial.println(encDetentThreshold); }
            }
          } else if (sub == 'M' || sub == 'm') {
            // REV 36c: EM\n = toggle debug mux raw (C13/C14/C15) a cada 250ms
            // Use pra confirmar se CLK (C14) e DT (C15) estao oscilando ao girar ENC4.
            // Se um fica fixo = wiring/canal errado.
            debugMuxEnc = !debugMuxEnc;
            if (Serial) { Serial.print(F("EM=")); Serial.println(debugMuxEnc ? 1 : 0); }
          }
        }
        serialBufLen = 0;
      }
    } else if (c != '\r') {
      if (serialBufLen < 63) {
        serialBuf[serialBufLen++] = c;
      } else {
        serialBufLen = 0;  // overflow safety
      }
    }
  }
}

// ===== Rev Lights (só atualiza quando mudar) =====
// ===== REV 38: Idle / PC-off sleep mode =====
// Apaga WS2812 rev lights + OLED + TXLED quando idle (sem atividade).
// Acorda imediatamente em qualquer atividade (botao, encoder, ou DTR voltar).
//
// REV 38 QA fixes Round 1:
//   - markActivity() agora ACORDA do sleep (era so updateLastActivity, OLED ficava preto)
//   - Edge-detect usbJustReturned no exit (era usbAlive, causava FLICKER toda vez que
//     fullIdle triggava com PC ligado: entra sleep -> proximo loop vê usbAlive -> sai sleep)
//   - DROP do USB_OFF_TIMEOUT_MS curto: causava sleep falso quando user roda iRacing
//     sem SimHub aberto (Serial CDC fechado, mas PC alive). Agora so fullIdle (60s) triggera.
//   - BOOT_GRACE_MS de 30s: nao auto-sleep no boot (user ver "SIM-X Ready" sem PC ligado).
#define IDLE_TIMEOUT_MS   60000UL   // 60s sem atividade -> sleep
#define BOOT_GRACE_MS     30000UL   // 30s pos-boot sem auto-sleep

bool sleepMode = false;
uint32_t lastActivityMs = 0;
uint32_t bootMs = 0;

void markActivity() {
  lastActivityMs = millis();
  if (sleepMode) exitSleepMode();  // REV 38 QA fix: acorda imediato em qualquer atividade
}

void enterSleepMode() {
  if (sleepMode) return;
  sleepMode = true;

  // 1. Apaga WS2812 rev lights
  fill_solid(revLeds, NUM_REV_LEDS, CRGB::Black);
  FastLED.show();

  // 2. Apaga OLED (low-power mode SSD1306 ~5uA vs ~20mA ligado)
  oled.setPowerSave(1);

  // 3. Apaga TXLED interno
  #ifdef TX_RX_LED_INIT
    TXLED1;  // TXLED1 = OFF (logica invertida no Pro Micro)
  #endif

  // Forca refresh ao acordar
  revLevelLast = 255;
  shiftBlinkLast = false;
}

void exitSleepMode() {
  if (!sleepMode) return;
  sleepMode = false;

  // 1. Acorda OLED
  oled.setPowerSave(0);
  drawOled();  // redesenha conteudo atual

  // 2. Forca refresh dos rev lights no proximo updateRevLights()
  revLevelLast = 255;

  // 3. TXLED: deixa em ON pra indicar "ativo" (o SimHub vai sobrescrever via cmd 'S')
  #ifdef TX_RX_LED_INIT
    TXLED0;  // TXLED0 = ON
  #endif

  // REV 38 QA Round 2 fix (GPT CRITICAL): refresh lastActivityMs ao acordar.
  // Sem isso, usbJustReturned wake setava sleepMode=false mas fullIdle continuava true
  // -> proximo loop re-entrava em sleep. Wake virava pulso de 1 iteracao.
  lastActivityMs = millis();
}

void idleSleepTick() {
  uint32_t now = millis();

  // Boot grace: 30s pos-boot, nao entra em sleep
  // (evita "SIM-X Ready" sumir quando user pluga sem PC enumerado ainda)
  if (now - bootMs < BOOT_GRACE_MS) return;

  // Edge-detect "USB DTR voltou" pra acordar quando PC religa
  static bool wasUsbAlive = false;
  bool usbAlive = (bool)Serial;
  bool usbJustReturned = (usbAlive && !wasUsbAlive);
  wasUsbAlive = usbAlive;

  bool fullIdle = (now - lastActivityMs > IDLE_TIMEOUT_MS);

  if (!sleepMode && fullIdle) {
    enterSleepMode();
  } else if (sleepMode && usbJustReturned) {
    // PC religou (DTR/Serial voltou) -> acorda
    exitSleepMode();
  }
}


// ===== Rev Lights (só atualiza quando mudar) =====
// REV 20: cores redistribuídas pra 4 LEDs (era 16)
//   LED 0      → verde   (RPM baixa, começa subir)
//   LED 1-2    → amarelo (zona ótima de shift)
//   LED 3      → vermelho (rev limit — troca AGORA)
// REV 21: shift indicator (shiftBlink=true) → todos LEDs azuis piscando 10Hz
//         (ignora revLevel enquanto shiftBlink ativo)
// REV 38: em sleep mode, NAO atualiza nada (mantem LEDs apagados).
void updateRevLights() {
  if (sleepMode) return;  // REV 38: nao redesenha em sleep

  // ===== REV 21: Shift indicator blink =====
  if (shiftBlink) {
    // Pisca todos os 4 LEDs azul a 10Hz (100ms on / 100ms off)
    bool blinkOn = (millis() / 100) % 2 == 0;
    fill_solid(revLeds, NUM_REV_LEDS, blinkOn ? CRGB::Blue : CRGB::Black);
    FastLED.show();
    shiftBlinkLast = true;
    revLevelLast = 255;  // força refresh quando voltar pro modo normal
    return;
  }
  
  // Se ACABOU de sair do blink, força refresh imediato
  if (shiftBlinkLast) {
    shiftBlinkLast = false;
    revLevelLast = 255;
  }
  
  // ===== Modo normal: revLevel 0-4 =====
  if (revLevel == revLevelLast) return;
  revLevelLast = revLevel;
  for (uint8_t i = 0; i < NUM_REV_LEDS; i++) {
    if (i < revLevel) {
      if (i < 1)        revLeds[i] = CRGB::Green;
      else if (i < 3)   revLeds[i] = CRGB::Yellow;
      else              revLeds[i] = CRGB::Red;
    } else {
      revLeds[i] = CRGB::Black;
    }
  }
  FastLED.show();
}


// ===== SETUP =====
void setup() {
  MCUSR &= ~(1 << WDRF);
  wdt_disable();

  Serial.begin(115200);

  pinMode(MUX_S0, OUTPUT);
  pinMode(MUX_S1, OUTPUT);
  pinMode(MUX_S2, OUTPUT);
  pinMode(MUX_S3, OUTPUT);
  pinMode(MUX1_SIG, INPUT_PULLUP);
  pinMode(MUX2_SIG, INPUT_PULLUP);
  pinMode(MUX3_SIG, INPUT_PULLUP);

  #ifdef TX_RX_LED_INIT
    TX_RX_LED_INIT;
    TXLED1;
  #endif

  oled.setBusClock(400000);
  oled.begin();
  Wire.setWireTimeout(25000, true);

  Joystick.begin();
  Joystick.setHatSwitch(0, -1);

  // REV 36: pull-ups + init detente state pros 4 encoders.
  // Timer1 ISR @ 2kHz amostra ENC1-3 dedicados. ENC4 muxado fica no loop principal.
  pinMode(ENC1_A, INPUT_PULLUP); pinMode(ENC1_B, INPUT_PULLUP);
  pinMode(ENC2_A, INPUT_PULLUP); pinMode(ENC2_B, INPUT_PULLUP);
  pinMode(ENC3_A, INPUT_PULLUP); pinMode(ENC3_B, INPUT_PULLUP);
  delay(5);  // settle dos pull-ups
  // Inicializa detentState com leitura fisica atual (raw HIGH/LOW)
  uint8_t e1 = (digitalRead(ENC1_A) << 1) | digitalRead(ENC1_B);
  uint8_t e2 = (digitalRead(ENC2_A) << 1) | digitalRead(ENC2_B);
  uint8_t e3 = (digitalRead(ENC3_A) << 1) | digitalRead(ENC3_B);
  uint8_t e4 = ((!muxReadDigital(MUX1_SIG, 14) ? 1 : 0) << 1) | (!muxReadDigital(MUX1_SIG, 15) ? 1 : 0);
  encs[0] = (EncoderState){e1, e1, 2, e1, 0, 0};
  encs[1] = (EncoderState){e2, e2, 2, e2, 0, 0};
  encs[2] = (EncoderState){e3, e3, 2, e3, 0, 0};
  encs[3] = (EncoderState){e4, e4, 2, e4, 0, 0};
  setupEncoderTimer();

  // Rev Lights — animação de boot azul (feedback visual em ~3s)
  FastLED.addLeds<WS2812B, REV_LED_PIN, GRB>(revLeds, NUM_REV_LEDS);
  FastLED.setBrightness(200);
  for (uint8_t i = 0; i < NUM_REV_LEDS; i++) {
    revLeds[i] = CRGB::Blue;
    FastLED.show();
    delay(80);
  }
  fill_solid(revLeds, NUM_REV_LEDS, CRGB::Black);
  FastLED.show();

  // OLED: mostra "SIM-X Ready" no boot
  strcpy(oledLines[1], "SIM-X Ready");
  drawOled();

  // REV 38: inicializa idle/sleep tracking
  bootMs = millis();
  lastActivityMs = bootMs;

  wdt_enable(WDTO_4S);
}

// ===== LOOP =====
void loop() {
  wdt_reset();
  readMuxedEncoder();         // REV 36e: ENC4 chamado 5x intercalado pra subir polling rate
  readAllButtons();
  readMuxedEncoder();         // (2x)
  readJoystick();
  readMuxedEncoder();         // (3x)
  readDedicatedEncoders();
  readPolledEnc3();           // REV 26: ENC3 (BIAS) polled (stub vazio)
  readMuxedEncoder();         // (4x)
  debugMuxEncTick();          // REV 36c: debug toggle via cmd 'EM' (250ms throttled)
  encoderReleaseTick();
  flipCoverReleaseTick();
  handleSerial();
  readMuxedEncoder();         // (5x)
  idleSleepTick();            // REV 38: detecta idle/PC-off -> apaga OLED + WS2812 + TXLED
  updateRevLights();
  // REV 37: delay(2) REMOVIDO. Era 60% do tempo do loop (2ms de 3.2ms).
  // Loop agora roda full-speed ~1-1.5ms = ~700-1000Hz polling rate.
  // WDT 4s + Wire.setWireTimeout 25ms continuam protegendo de hang real.
  // ATmega32u4 nao vai sobrecarregar — sem PWM/RC bit-banging time-critical.
}

