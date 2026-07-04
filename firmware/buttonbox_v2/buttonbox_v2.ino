/**
 * Button Box V2 — 6 Encoders Rotativos + Display OLED
 * Projeto P2.3 — Guilherme Basso / iRacing SimRacing DIY
 *
 * Hardware:
 *   - Arduino Pro Micro (ATmega32U4, 5V/16MHz)
 *   - 6x Encoders EC11 com push-button
 *   - 1x CD74HC4067 (multiplexador 16 canais)
 *   - 1x Display OLED 0.96" SSD1306 I2C
 *
 * Estratégia de multiplexação:
 *   - CLK dos 6 encoders → canais 0-5 do mux
 *   - DT  dos 6 encoders → canais 6-11 do mux
 *   - SW  dos 6 encoders → leitura direta (D4,D7,D8,D9,A2,A3)
 *   - 1 pino SIG (A0) lê todos os CLK/DT via varredura ~100µs/canal
 *
 * Saída HID:
 *   - Botões 1-12: encoders (par=CW, ímpar=CCW)
 *   - Botões 13-18: push-buttons dos encoders
 *
 * Comunicação OLED:
 *   - SimHub envia via Serial: "BB:xx.x|MAP:x|TC:x|ABS:x|FUEL:xx.x\n"
 *
 * Bibliotecas necessárias:
 *   - Joystick (MHeironimus v2.1.1)
 *   - Adafruit SSD1306 (v2.5.x)
 *   - Adafruit GFX Library
 *   - Wire (built-in)
 */

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Joystick.h>

// ─── Configurações do Display OLED ──────────────────────────────────────────
#define OLED_WIDTH    128
#define OLED_HEIGHT    64
#define OLED_RESET     -1   // Reset compartilhado com o Reset do Arduino
#define OLED_ADDR    0x3C

Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET);

// ─── Pinos do CD74HC4067 (Multiplexador 16 canais) ───────────────────────────
// SELECT (S0-S3): determinam qual canal (0-15) está conectado ao SIG
#define MUX_S0   5
#define MUX_S1   6
#define MUX_S2   14   // D14 = MISO/SPI no Pro Micro — funciona como GPIO digital quando SPI inativo
#define MUX_S3   16
#define MUX_SIG  A0   // Sinal lido do mux (pino analógico/digital)
#define MUX_EN   -1   // Enable ativo-baixo; conecte ao GND para sempre habilitado

// Canais do mux por encoder (0-15)
// Canal 0-5:  CLK dos encoders 1-6
// Canal 6-11: DT  dos encoders 1-6
#define MUX_CLK_BASE  0   // Canal 0 = ENC1_CLK, canal 1 = ENC2_CLK ...
#define MUX_DT_BASE   6   // Canal 6 = ENC1_DT,  canal 7 = ENC2_DT  ...

// ─── Pinos diretos para SW (push-button) dos encoders ────────────────────────
// Lidos diretamente para não ter latência do mux nos push-buttons
const int SW_PINS[6] = {4, 7, 8, 9, A2, A3};

// ─── Número de encoders ──────────────────────────────────────────────────────
#define NUM_ENCODERS  6

// ─── Configuração do Joystick HID ───────────────────────────────────────────
// 18 botões: 12 para encoders CW/CCW + 6 para SW
Joystick_ Joystick(
  JOYSTICK_DEFAULT_REPORT_ID,
  JOYSTICK_TYPE_JOYSTICK,
  18,     // buttonCount
  0,      // hatSwitchCount
  false,  // includeXAxis
  false,  // includeYAxis
  false,  // includeZAxis
  false,  // includeRxAxis
  false,  // includeRyAxis
  false,  // includeRzAxis
  false,  // includeRudder
  false,  // includeThrottle
  false,  // includeAccelerator
  false,  // includeBrake
  false   // includeSteering
);

// ─── Estado dos encoders ─────────────────────────────────────────────────────
int8_t  encLastClk[NUM_ENCODERS];    // Último estado CLK lido
int8_t  encLastDt[NUM_ENCODERS];     // Último estado DT lido
bool    swLastState[NUM_ENCODERS];   // Último estado SW lido
uint32_t swDebounceTime[NUM_ENCODERS]; // Timestamp do último bounce SW

// Duração (ms) do pulso de botão enviado via HID (non-blocking)
#define BUTTON_PULSE_MS   80

// Tempo de debounce para SW (ms)
#define SW_DEBOUNCE_MS    50

// Timers non-blocking para liberação dos botões de encoder
// Índice: enc*2 = CW, enc*2+1 = CCW
uint32_t btnPressTime[NUM_ENCODERS * 2];

// ─── Dados de telemetria vindos do SimHub ─────────────────────────────────────
struct TelemetryData {
  float bb;          // Brake Bias (%)
  int   map;         // Engine MAP (0-12 tipicamente)
  int   tc;          // Traction Control (0-12)
  int   abs_level;   // ABS (0-12)
  float fuel;        // Fuel Target (L)
  bool  updated;     // Flag: novos dados recebidos
};

TelemetryData telem = {50.0f, 1, 3, 3, 25.0f, false};

// Buffer de parsing serial
#define SERIAL_BUF_SIZE  64
char   serialBuf[SERIAL_BUF_SIZE];
uint8_t serialIdx = 0;

// ─── Protótipos ──────────────────────────────────────────────────────────────
void     muxSelectChannel(uint8_t ch);
int8_t   muxReadDigital(uint8_t ch);
void     processEncoders();
void     releaseEncoderButtons();
void     processSwitches();
void     parseSerialLine(const char* line);
void     updateOLED();
void     drawOLEDLayout();

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
    swLastState[i]     = HIGH;
    swDebounceTime[i]  = 0;
  }

  // Leitura inicial dos CLK para evitar falsos pulsos ao ligar
  for (int i = 0; i < NUM_ENCODERS; i++) {
    encLastClk[i] = muxReadDigital(MUX_CLK_BASE + i);
    encLastDt[i]  = muxReadDigital(MUX_DT_BASE  + i);
    btnPressTime[i*2]   = 0;
    btnPressTime[i*2+1] = 0;
  }

  // Inicializa comunicação serial com o SimHub
  Serial.begin(115200);

  // Inicializa HID
  Joystick.begin(false);  // false = não envia estado automaticamente

  // Inicializa OLED
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    // Se OLED não encontrado: continua sem display (não é crítico)
    while (1) { delay(10); }
  }
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  // Tela de boas-vindas
  display.setTextSize(1);
  display.setCursor(20, 20);
  display.println(F("Button Box V2"));
  display.setCursor(30, 35);
  display.println(F("iRacing Ready"));
  display.display();
  delay(1500);

  drawOLEDLayout();
  updateOLED();
}

// ════════════════════════════════════════════════════════════════════════════
//  LOOP PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
void loop() {
  // 1. Lê encoders via mux e gera eventos HID (non-blocking)
  processEncoders();

  // 2. Libera botões de encoder após BUTTON_PULSE_MS (non-blocking)
  releaseEncoderButtons();

  // 2. Lê SW diretos e gera eventos HID
  processSwitches();

  // 3. Envia estado HID acumulado
  Joystick.sendState();

  // 4. Processa dados seriais do SimHub (não-bloqueante)
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialIdx > 0) {
        serialBuf[serialIdx] = '\0';
        parseSerialLine(serialBuf);
        serialIdx = 0;
      }
    } else if (serialIdx < SERIAL_BUF_SIZE - 1) {
      serialBuf[serialIdx++] = c;
    }
  }

  // 5. Atualiza OLED se novos dados chegaram
  if (telem.updated) {
    updateOLED();
    telem.updated = false;
  }

  // Delay mínimo — mantém loop rápido para não perder passos de encoder
  delayMicroseconds(100);
}

// ════════════════════════════════════════════════════════════════════════════
//  FUNÇÕES DO MULTIPLEXADOR
// ════════════════════════════════════════════════════════════════════════════

/**
 * Seleciona o canal do CD74HC4067 via 4 pinos de seleção (S0-S3).
 * ch: 0-15
 */
void muxSelectChannel(uint8_t ch) {
  digitalWrite(MUX_S0, (ch >> 0) & 1);
  digitalWrite(MUX_S1, (ch >> 1) & 1);
  digitalWrite(MUX_S2, (ch >> 2) & 1);
  digitalWrite(MUX_S3, (ch >> 3) & 1);
}

/**
 * Lê o estado digital do canal ch do mux.
 * Retorna HIGH (1) ou LOW (0).
 * Tempo de settling do CD74HC4067: ~125ns @ 5V — delayMicroseconds(1) é suficiente.
 */
int8_t muxReadDigital(uint8_t ch) {
  muxSelectChannel(ch);
  delayMicroseconds(2);   // Aguarda settling do mux
  return digitalRead(MUX_SIG);
}

// ════════════════════════════════════════════════════════════════════════════
//  PROCESSAMENTO DOS ENCODERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Varre todos os encoders lendo CLK e DT via mux.
 * Detecta mudança de CLK e determina direção pelo estado de DT.
 * Gera pulso de botão HID SEM delay() bloqueante:
 *   - Registra tempo de início em btnPressTime[]
 *   - releaseEncoderButtons() verifica expiração no loop principal
 *
 *   - Botão (enc*2)   = rotação horária (CW)
 *   - Botão (enc*2+1) = rotação anti-horária (CCW)
 */
void processEncoders() {
  uint32_t now = millis();
  for (int enc = 0; enc < NUM_ENCODERS; enc++) {
    int8_t clk = muxReadDigital(MUX_CLK_BASE + enc);
    int8_t dt  = muxReadDigital(MUX_DT_BASE  + enc);

    // Detecta borda de descida no CLK (início de passo)
    if (clk != encLastClk[enc] && clk == LOW) {
      int btnBase = enc * 2;   // Índice base (0-indexed)

      if (dt != clk) {
        // DT ≠ CLK → rotação HORÁRIA (CW)
        Joystick.setButton(btnBase, HIGH);
        btnPressTime[btnBase] = now;
      } else {
        // DT == CLK → rotação ANTI-HORÁRIA (CCW)
        Joystick.setButton(btnBase + 1, HIGH);
        btnPressTime[btnBase + 1] = now;
      }
    }
    encLastClk[enc] = clk;
    encLastDt[enc]  = dt;
  }
}

/**
 * Libera os botões de encoder após BUTTON_PULSE_MS.
 * Chamado no loop principal — não usa delay().
 */
void releaseEncoderButtons() {
  uint32_t now = millis();
  for (int i = 0; i < NUM_ENCODERS * 2; i++) {
    if (btnPressTime[i] > 0 && (now - btnPressTime[i]) >= BUTTON_PULSE_MS) {
      Joystick.setButton(i, LOW);
      btnPressTime[i] = 0;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  PROCESSAMENTO DOS PUSH-BUTTONS (SW)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Lê os 6 push-buttons diretos (SW) com debounce.
 * Botões HID 12-17 (base 0 interno).
 */
void processSwitches() {
  uint32_t now = millis();
  for (int i = 0; i < NUM_ENCODERS; i++) {
    bool state = digitalRead(SW_PINS[i]);  // LOW = pressionado (pull-up)

    if (state != swLastState[i] && (now - swDebounceTime[i]) > SW_DEBOUNCE_MS) {
      swDebounceTime[i] = now;
      swLastState[i]    = state;
      int btnIdx = 12 + i;   // Botões 12-17 (base 0)
      Joystick.setButton(btnIdx, state == LOW ? HIGH : LOW);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  PARSING SERIAL (SimHub → Arduino)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Parseia linha recebida do SimHub.
 * Formato esperado: "BB:xx.x|MAP:x|TC:x|ABS:x|FUEL:xx.x"
 * Exemplo: "BB:51.5|MAP:3|TC:5|ABS:2|FUEL:28.4"
 *
 * Usa strtok para evitar uso de String (fragmentação de heap).
 */
void parseSerialLine(const char* line) {
  // Cópia local para não modificar o buffer original com strtok
  static char buf[SERIAL_BUF_SIZE];
  strncpy(buf, line, SERIAL_BUF_SIZE - 1);
  buf[SERIAL_BUF_SIZE - 1] = '\0';

  char* token = strtok(buf, "|");
  while (token != NULL) {
    char key[12];
    char val[12];
    if (sscanf(token, "%11[^:]:%11s", key, val) == 2) {
      if      (strcmp(key, "BB")   == 0) telem.bb        = atof(val);
      else if (strcmp(key, "MAP")  == 0) telem.map        = atoi(val);
      else if (strcmp(key, "TC")   == 0) telem.tc         = atoi(val);
      else if (strcmp(key, "ABS")  == 0) telem.abs_level  = atoi(val);
      else if (strcmp(key, "FUEL") == 0) telem.fuel       = atof(val);
    }
    token = strtok(NULL, "|");
  }
  telem.updated = true;
}

// ════════════════════════════════════════════════════════════════════════════
//  DISPLAY OLED
// ════════════════════════════════════════════════════════════════════════════

/**
 * Desenha o layout fixo do OLED (labels).
 * Chamado apenas uma vez no setup ou quando precisar redesenhar tudo.
 */
void drawOLEDLayout() {
  display.clearDisplay();

  // Título topo
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(F("BB    MAP   TC    ABS"));

  // Linha separadora
  display.drawLine(0, 10, 127, 10, SSD1306_WHITE);

  // Labels linha 2
  display.setCursor(0, 48);
  display.print(F("FUEL"));

  // Linha separadora inferior
  display.drawLine(0, 45, 127, 45, SSD1306_WHITE);

  display.display();
}

/**
 * Atualiza apenas os valores numéricos no OLED.
 * Não redesenha labels para reduzir flickering.
 */
void updateOLED() {
  char buf[8];

  // ── Linha de valores principais (y=15) ──────────────────────────────────
  // Apaga só a área dos valores para evitar flickering total
  display.fillRect(0, 13, 128, 30, SSD1306_BLACK);

  display.setTextSize(2);

  // BB (brake bias) — ex: "51.5"
  dtostrf(telem.bb, 4, 1, buf);
  display.setCursor(0, 16);
  display.print(buf);

  // MAP — ex: "3"
  snprintf(buf, sizeof(buf), "%2d", telem.map);
  display.setCursor(52, 16);
  display.print(buf);

  // TC — ex: "5"
  snprintf(buf, sizeof(buf), "%2d", telem.tc);
  display.setCursor(84, 16);
  display.print(buf);

  // ABS — ex: "2"
  snprintf(buf, sizeof(buf), "%2d", telem.abs_level);
  display.setCursor(108, 16);
  display.print(buf);

  // ── Linha de FUEL (y=50) ────────────────────────────────────────────────
  display.fillRect(30, 48, 98, 16, SSD1306_BLACK);
  display.setTextSize(2);
  dtostrf(telem.fuel, 5, 1, buf);
  display.setCursor(35, 50);
  display.print(buf);
  display.print(F("L"));

  display.display();
}
