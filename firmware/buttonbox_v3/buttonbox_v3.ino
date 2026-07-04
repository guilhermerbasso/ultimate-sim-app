/**
 * Button Box V3 — 6 Encoders Rotativos + Display OLED + Management Protocol
 * Projeto P2.3 (evolução) — Guilherme Basso / iRacing SimRacing DIY
 *
 * Novidades em relação ao v2:
 *   - Mapeamento de botões configurável e persistente (EEPROM)
 *   - Protocolo serial bidirecional ">"/"<" para o app ButtonBox Manager
 *   - Parâmetros de tuning (pulse / debounce) configuráveis em runtime
 *   - Identidade ">ID?" para o app reconhecer o dispositivo
 *   - 100% compatível com o template de telemetria do SimHub (OLED inalterado)
 *
 * Protocolo completo: docs/serial-protocol.md
 *
 * Hardware (idêntico ao v2):
 *   - Arduino Pro Micro (ATmega32U4, 5V/16MHz)
 *   - 6x Encoders EC11 com push-button
 *   - 1x CD74HC4067 (multiplexador 16 canais)
 *   - 1x Display OLED 0.96" SSD1306 I2C
 *
 * Bibliotecas necessárias:
 *   - Joystick (MHeironimus v2.1.1)
 *   - Adafruit SSD1306 (v2.5.x)
 *   - Adafruit GFX Library
 *   - Wire, EEPROM (built-in)
 */

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Joystick.h>
#include <string.h>
#include <stdlib.h>

#include "protocol.h"
#include "config_store.h"

// ─── Configurações do Display OLED ──────────────────────────────────────────
#define OLED_WIDTH    128
#define OLED_HEIGHT    64
#define OLED_RESET     -1
#define OLED_ADDR    0x3C

Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET);
bool oledOk = false;   // display detectado? Se não, o app/HID/serial seguem funcionando.

// ─── Pinos do CD74HC4067 (Multiplexador 16 canais) ───────────────────────────
#define MUX_S0   5
#define MUX_S1   6
#define MUX_S2   14
#define MUX_S3   16
#define MUX_SIG  A0
#define MUX_CLK_BASE  0    // canais 0-5  = CLK dos encoders 1-6
#define MUX_DT_BASE   6    // canais 6-11 = DT  dos encoders 1-6

// ─── Pinos diretos para SW (push-button) dos encoders ────────────────────────
const int SW_PINS[6] = {4, 7, 8, 9, A2, A3};

#define NUM_ENCODERS  6

// ─── Configuração do Joystick HID (18 botões) ────────────────────────────────
Joystick_ Joystick(
  JOYSTICK_DEFAULT_REPORT_ID,
  JOYSTICK_TYPE_JOYSTICK,
  18,     // buttonCount
  0,      // hatSwitchCount
  false, false, false, false, false, false,
  false, false, false, false, false
);

// ─── Configuração persistente (mapa + tuning), carregada da EEPROM ───────────
Config cfg;

// ─── Estado dos encoders ─────────────────────────────────────────────────────
int8_t   encLastClk[NUM_ENCODERS];
int8_t   encLastDt[NUM_ENCODERS];
bool     swLastState[NUM_ENCODERS];
uint32_t swDebounceTime[NUM_ENCODERS];

// Timers non-blocking para liberar pulsos de encoder. Indexado por EVENTO
// (0..11 = e1cw,e1ccw,...,e6ccw). O botão HID liberado é cfg.map[evento].
uint32_t btnPressTime[NUM_ENCODERS * 2];
bool     btnArmed[NUM_ENCODERS * 2];     // pulso em andamento? (substitui a sentinela 0 — sem colisão no rollover)

// ─── Dados de telemetria (OLED) ──────────────────────────────────────────────
struct TelemetryData {
  char bb[8];        // texto cru recebido, ex.: "51.5"
  int  map;
  int  tc;
  int  abs_level;
  char fuel[8];      // texto cru recebido, ex.: "28.4"
  bool updated;
};
TelemetryData telem = {"50.0", 1, 3, 3, "25.0", false};

// ─── Buffer de parsing serial ────────────────────────────────────────────────
#define SERIAL_BUF_SIZE  256          // 256 p/ caber um ">MAP:" completo (§6)
char     serialBuf[SERIAL_BUF_SIZE];
uint16_t serialIdx = 0;
bool     serialOverflow = false;

// ─── Estado HID com contagem de referência ───────────────────────────────────
// Corrige (1) botão "preso" quando o mapa muda no meio de um pulso/hold e
// (2) mapeamentos duplicados (dois eventos no mesmo botão).
uint8_t hidActive[18];                    // refcount por botão HID (0..N)
uint8_t encPressedBtn[NUM_ENCODERS * 2];  // botão HID disparado por evento de encoder (snapshot)
uint8_t swPressedBtn[NUM_ENCODERS];       // botão HID disparado por cada switch (snapshot)
bool    hidDirty = false;                 // algum botão mudou de estado neste loop?

// Só altera o estado do Joystick na transição 0<->1 do refcount.
static inline void hidPress(uint8_t btn) {
  if (btn < 18 && hidActive[btn]++ == 0) { Joystick.setButton(btn, HIGH); hidDirty = true; }
}
static inline void hidRelease(uint8_t btn) {
  if (btn < 18 && hidActive[btn] > 0 && --hidActive[btn] == 0) { Joystick.setButton(btn, LOW); hidDirty = true; }
}

// ─── Protótipos ──────────────────────────────────────────────────────────────
void   muxSelectChannel(uint8_t ch);
int8_t muxReadDigital(uint8_t ch);
void   processEncoders();
void   releaseEncoderButtons();
void   processSwitches();

void   handleLine(char* line);
void   handleCommand(char* line);
void   parseTelemetry(const char* line);
void   sendMap();
void   sendCfg();
void   cmdSetMap(char* args);
void   cmdSetCfg(char* args);
void   cmdOled(char* args);
void   oledText(char* s);
void   replyOK();
void   replyErr(const char* reason);

void   updateOLED();
void   drawOLEDLayout();

// ════════════════════════════════════════════════════════════════════════════
//  SETUP
// ════════════════════════════════════════════════════════════════════════════
void setup() {
  // Pinos do mux
  pinMode(MUX_S0, OUTPUT);
  pinMode(MUX_S1, OUTPUT);
  pinMode(MUX_S2, OUTPUT);
  pinMode(MUX_S3, OUTPUT);
  pinMode(MUX_SIG, INPUT_PULLUP);

  // Pinos SW diretos — pull-up interno
  for (int i = 0; i < NUM_ENCODERS; i++) {
    pinMode(SW_PINS[i], INPUT_PULLUP);
    swLastState[i]    = HIGH;
    swDebounceTime[i] = 0;
  }

  // Leitura inicial dos CLK/DT para evitar falsos pulsos ao ligar
  for (int i = 0; i < NUM_ENCODERS; i++) {
    encLastClk[i] = muxReadDigital(MUX_CLK_BASE + i);
    encLastDt[i]  = muxReadDigital(MUX_DT_BASE  + i);
    btnPressTime[i * 2]     = 0;
    btnPressTime[i * 2 + 1] = 0;
  }

  // Serial (SimHub + protocolo de gerenciamento)
  Serial.begin(115200);

  // Configuração persistente
  configLoad(cfg);

  // HID
  Joystick.begin(false);  // não envia estado automaticamente

  // OLED (OPCIONAL): se não for detectado, NÃO trava — HID e protocolo serial
  // continuam funcionando (essencial para o app conectar mesmo sem display / I2C 0x3D).
  oledOk = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  if (oledOk) {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(20, 20);
    display.println(F("Button Box V3"));
    display.setCursor(30, 35);
    display.println(F("iRacing Ready"));
    display.display();
    delay(800);
    drawOLEDLayout();
    updateOLED();
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  LOOP PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
void loop() {
  processEncoders();
  releaseEncoderButtons();
  processSwitches();
  if (hidDirty) { Joystick.sendState(); hidDirty = false; }  // só transmite quando muda

  // Recepção serial linha-a-linha
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialOverflow) {
        replyErr("nomem");
        serialOverflow = false;
        serialIdx = 0;
      } else if (serialIdx > 0) {
        serialBuf[serialIdx] = '\0';
        handleLine(serialBuf);
        serialIdx = 0;
      }
    } else if (serialIdx < SERIAL_BUF_SIZE - 1) {
      serialBuf[serialIdx++] = c;
    } else {
      serialOverflow = true;  // linha longa demais: descarta até o '\n'
    }
  }

  if (telem.updated) {
    updateOLED();
    telem.updated = false;
  }

  delayMicroseconds(100);
}

// ════════════════════════════════════════════════════════════════════════════
//  MULTIPLEXADOR
// ════════════════════════════════════════════════════════════════════════════
void muxSelectChannel(uint8_t ch) {
  digitalWrite(MUX_S0, (ch >> 0) & 1);
  digitalWrite(MUX_S1, (ch >> 1) & 1);
  digitalWrite(MUX_S2, (ch >> 2) & 1);
  digitalWrite(MUX_S3, (ch >> 3) & 1);
}

int8_t muxReadDigital(uint8_t ch) {
  muxSelectChannel(ch);
  delayMicroseconds(2);   // settling do CD74HC4067
  return digitalRead(MUX_SIG);
}

// ════════════════════════════════════════════════════════════════════════════
//  ENCODERS  (aplica o mapa configurável cfg.map[])
// ════════════════════════════════════════════════════════════════════════════
void processEncoders() {
  uint32_t now = millis();
  for (int enc = 0; enc < NUM_ENCODERS; enc++) {
    int8_t clk = muxReadDigital(MUX_CLK_BASE + enc);
    int8_t dt  = muxReadDigital(MUX_DT_BASE  + enc);

    if (clk != encLastClk[enc] && clk == LOW) {
      uint8_t ev = (dt != clk) ? (enc * 2) : (enc * 2 + 1);  // CW : CCW
      if (!btnArmed[ev]) {
        encPressedBtn[ev] = cfg.map[ev];   // snapshot: release usa o MESMO índice
        hidPress(encPressedBtn[ev]);
        btnArmed[ev] = true;
      }
      btnPressTime[ev] = now;              // (re)arma/estende o pulso
    }
    encLastClk[enc] = clk;
    encLastDt[enc]  = dt;
  }
}

void releaseEncoderButtons() {
  uint32_t now = millis();
  for (uint8_t ev = 0; ev < NUM_ENCODERS * 2; ev++) {
    if (btnArmed[ev] && (now - btnPressTime[ev]) >= cfg.pulseMs) {
      hidRelease(encPressedBtn[ev]);       // usa o snapshot, não cfg.map[ev]
      btnArmed[ev] = false;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  PUSH-BUTTONS (SW)
// ════════════════════════════════════════════════════════════════════════════
void processSwitches() {
  uint32_t now = millis();
  for (int i = 0; i < NUM_ENCODERS; i++) {
    bool state = digitalRead(SW_PINS[i]);  // LOW = pressionado (pull-up)

    if (state != swLastState[i] && (now - swDebounceTime[i]) > cfg.debounceMs) {
      swDebounceTime[i] = now;
      swLastState[i]    = state;
      uint8_t ev = 12 + i;   // eventos sw1..sw6
      if (state == LOW) {                  // pressionado
        swPressedBtn[i] = cfg.map[ev];     // snapshot
        hidPress(swPressedBtn[i]);
      } else {                             // solto
        hidRelease(swPressedBtn[i]);       // usa o snapshot
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  DISPATCH DE LINHA SERIAL
// ════════════════════════════════════════════════════════════════════════════
void handleLine(char* line) {
  if (line[0] == '>') {
    handleCommand(line);
  } else if (line[0] == '<') {
    return;                 // respostas nunca chegam ao firmware: ignora
  } else {
    parseTelemetry(line);   // caminho SimHub (OLED) — inalterado
  }
}

void replyOK()  { Serial.print(F("<OK\n")); }

void replyErr(const char* reason) {
  Serial.print(F("<ERR:"));
  Serial.print(reason);
  Serial.print('\n');
}

// ════════════════════════════════════════════════════════════════════════════
//  COMANDOS DE GERENCIAMENTO  (ver docs/serial-protocol.md §4)
// ════════════════════════════════════════════════════════════════════════════
void handleCommand(char* line) {
  char* cmd  = line + 1;            // pula o '>'
  char* args = strchr(cmd, ':');    // separa verbo : argumentos
  if (args) { *args = '\0'; args++; }

  if (strcmp(cmd, "ID?") == 0) {
    if (args) { replyErr("bad_arg"); return; }
    Serial.print(F("<ID:"));
    Serial.print(F(DEVICE_NAME));
    Serial.print(F(";fw="));
    Serial.print(F(FW_VERSION));
    Serial.print(F(";proto="));
    Serial.print(PROTO_VERSION);
    Serial.print(F(";enc=6;sw=6;btns=18\n"));
  }
  else if (strcmp(cmd, "PING") == 0)  { if (args) { replyErr("bad_arg"); return; } Serial.print(F("<PONG\n")); }
  else if (strcmp(cmd, "MAP?") == 0)  { if (args) { replyErr("bad_arg"); return; } sendMap(); }
  else if (strcmp(cmd, "MAP")  == 0)  { cmdSetMap(args); }
  else if (strcmp(cmd, "CFG?") == 0)  { if (args) { replyErr("bad_arg"); return; } sendCfg(); }
  else if (strcmp(cmd, "CFG")  == 0)  { cmdSetCfg(args); }
  else if (strcmp(cmd, "SAVE") == 0)  { if (args) { replyErr("bad_arg"); return; } configSave(cfg); replyOK(); }
  else if (strcmp(cmd, "LOAD") == 0)  { if (args) { replyErr("bad_arg"); return; } configLoad(cfg); replyOK(); }
  else if (strcmp(cmd, "RESET") == 0) { if (args) { replyErr("bad_arg"); return; } configDefaults(cfg); replyOK(); }
  else if (strcmp(cmd, "OLED") == 0)  { cmdOled(args); }
  else                                { Serial.print(F("<ERR:unknown_cmd\n")); }
}

void sendMap() {
  Serial.print(F("<MAP:"));
  for (uint8_t i = 0; i < BB_NUM_EVENTS; i++) {
    Serial.print(eventName(i));
    Serial.print('=');
    Serial.print(cfg.map[i] + 1);          // 1-based no protocolo
    if (i < BB_NUM_EVENTS - 1) Serial.print(';');
  }
  Serial.print('\n');
}

void sendCfg() {
  Serial.print(F("<CFG:pulse="));
  Serial.print(cfg.pulseMs);
  Serial.print(F(";debounce="));
  Serial.print(cfg.debounceMs);
  Serial.print(F(";encmode="));
  Serial.print(cfg.encMode == ENC_HOLD ? F("hold") : F("pulse"));
  Serial.print('\n');
}

// ">MAP:e1cw=5;e1ccw=6" — aplica só os eventos listados. Commit atômico:
// valida tudo num buffer temporário e só então grava (estado intacto em erro).
void cmdSetMap(char* args) {
  if (!args || *args == '\0') { replyErr("bad_arg"); return; }

  uint8_t tmp[BB_NUM_EVENTS];
  memcpy(tmp, cfg.map, BB_NUM_EVENTS);

  bool any = false;
  char* tok = strtok(args, ";");
  while (tok != NULL) {
    char* eq = strchr(tok, '=');
    if (!eq) { replyErr("bad_arg"); return; }
    *eq = '\0';
    int ev = eventIndexByName(tok);
    if (ev < 0) { replyErr("bad_arg"); return; }
    char* endp;
    long val = strtol(eq + 1, &endp, 10);
    if (endp == eq + 1 || *endp != '\0') { replyErr("bad_arg"); return; }  // não-numérico
    if (val < 1 || val > 18) { replyErr("range"); return; }
    tmp[ev] = (uint8_t)(val - 1);
    any = true;
    tok = strtok(NULL, ";");
  }
  if (!any) { replyErr("bad_arg"); return; }

  memcpy(cfg.map, tmp, BB_NUM_EVENTS);
  replyOK();
}

// ">CFG:pulse=100;debounce=40;encmode=pulse" — commit atômico.
void cmdSetCfg(char* args) {
  if (!args || *args == '\0') { replyErr("bad_arg"); return; }

  uint8_t p = cfg.pulseMs, d = cfg.debounceMs, m = cfg.encMode;

  bool any = false;
  char* tok = strtok(args, ";");
  while (tok != NULL) {
    char* eq = strchr(tok, '=');
    if (!eq) { replyErr("bad_arg"); return; }
    *eq = '\0';
    char* key = tok;
    char* val = eq + 1;

    if (strcmp(key, "pulse") == 0) {
      char* endp;
      long x = strtol(val, &endp, 10);
      if (endp == val || *endp != '\0') { replyErr("bad_arg"); return; }
      if (x < BB_PULSE_MIN || x > BB_PULSE_MAX) { replyErr("range"); return; }
      p = (uint8_t)x;
    } else if (strcmp(key, "debounce") == 0) {
      char* endp;
      long x = strtol(val, &endp, 10);
      if (endp == val || *endp != '\0') { replyErr("bad_arg"); return; }
      if (x < BB_DEBOUNCE_MIN || x > BB_DEBOUNCE_MAX) { replyErr("range"); return; }
      d = (uint8_t)x;
    } else if (strcmp(key, "encmode") == 0) {
      if      (strcmp(val, "pulse") == 0) m = ENC_PULSE;
      else if (strcmp(val, "hold")  == 0) m = ENC_HOLD;
      else { replyErr("bad_arg"); return; }
    } else {
      replyErr("bad_arg"); return;
    }
    any = true;
    tok = strtok(NULL, ";");
  }
  if (!any) { replyErr("bad_arg"); return; }

  cfg.pulseMs    = p;
  cfg.debounceMs = d;
  cfg.encMode    = m;
  replyOK();
}

// ">OLED:..." — preview/controle manual do OLED (quando o SimHub está fechado).
void cmdOled(char* args) {
  if (!args) { replyErr("bad_arg"); return; }

  if (strcmp(args, "CLEAR") == 0) {
    if (oledOk) { display.clearDisplay(); display.display(); }
    replyOK();
    return;
  }
  if (strncmp(args, "TEXT:", 5) == 0) {
    oledText(args + 5);
    replyOK();
    return;
  }

  // Caso geral: payload no formato SimHub → mesmo parser de telemetria.
  parseTelemetry(args);
  updateOLED();
  telem.updated = false;   // já atualizamos diretamente
  replyOK();
}

void oledText(char* s) {
  if (!oledOk) return;
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  char* nl = strchr(s, '|');
  display.setCursor(0, 20);
  if (nl) {
    *nl = '\0';
    display.print(s);
    display.setCursor(0, 38);
    display.print(nl + 1);
  } else {
    display.print(s);
  }
  display.display();
}

// ════════════════════════════════════════════════════════════════════════════
//  TELEMETRIA (SimHub → OLED) — formato inalterado em relação ao v2
//  "BB:xx.x|MAP:x|TC:x|ABS:x|FUEL:xx.x"
// ════════════════════════════════════════════════════════════════════════════
void parseTelemetry(const char* line) {
  static char buf[SERIAL_BUF_SIZE];
  strncpy(buf, line, SERIAL_BUF_SIZE - 1);
  buf[SERIAL_BUF_SIZE - 1] = '\0';

  // Parsing manual (sem sscanf — economiza ~2KB de flash no AVR).
  char* token = strtok(buf, "|");
  while (token != NULL) {
    char* colon = strchr(token, ':');
    if (colon) {
      *colon = '\0';
      const char* key = token;
      const char* val = colon + 1;
      // BB/FUEL ficam como texto cru (sem atof/dtostrf → sem float lib no AVR).
      if      (strcmp(key, "BB")   == 0) { strncpy(telem.bb, val, sizeof(telem.bb) - 1);   telem.bb[sizeof(telem.bb) - 1] = '\0'; }
      else if (strcmp(key, "MAP")  == 0) telem.map       = atoi(val);
      else if (strcmp(key, "TC")   == 0) telem.tc        = atoi(val);
      else if (strcmp(key, "ABS")  == 0) telem.abs_level = atoi(val);
      else if (strcmp(key, "FUEL") == 0) { strncpy(telem.fuel, val, sizeof(telem.fuel) - 1); telem.fuel[sizeof(telem.fuel) - 1] = '\0'; }
    }
    token = strtok(NULL, "|");
  }
  telem.updated = true;
}

// ════════════════════════════════════════════════════════════════════════════
//  DISPLAY OLED
// ════════════════════════════════════════════════════════════════════════════
void drawOLEDLayout() {
  if (!oledOk) return;
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(F("BB    MAP   TC    ABS"));
  display.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  display.setCursor(0, 48);
  display.print(F("FUEL"));
  display.drawLine(0, 45, 127, 45, SSD1306_WHITE);
  display.display();
}

void updateOLED() {
  if (!oledOk) return;
  display.fillRect(0, 13, 128, 30, SSD1306_BLACK);
  display.setTextSize(2);

  // BB (texto cru, ex.: "51.5")
  display.setCursor(0, 16);
  display.print(telem.bb);

  // MAP / TC / ABS (inteiros) — print nativo com pad de 1 espaço p/ 1 dígito
  // (evita snprintf, que puxa ~1KB de flash no AVR).
  display.setCursor(52, 16);
  if (telem.map >= 0 && telem.map < 10) display.print(' ');
  display.print(telem.map);

  display.setCursor(84, 16);
  if (telem.tc >= 0 && telem.tc < 10) display.print(' ');
  display.print(telem.tc);

  display.setCursor(108, 16);
  if (telem.abs_level >= 0 && telem.abs_level < 10) display.print(' ');
  display.print(telem.abs_level);

  // FUEL (texto cru, ex.: "28.4")
  display.fillRect(30, 48, 98, 16, SSD1306_BLACK);
  display.setCursor(35, 50);
  display.print(telem.fuel);
  display.print('L');

  display.display();
}
