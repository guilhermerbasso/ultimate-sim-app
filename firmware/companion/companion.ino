/*
 * companion.ino — Ultimate ButtonBox Companion Firmware
 * -------------------------------------------------------
 * Target boards : Arduino Uno (ATmega328P) · Nano · Pro Micro (ATmega32U4)
 * Serial        : 115200 8N1 over USB-CDC (Pro Micro) or UART (Uno/Nano)
 * Role          : Second Arduino driven by the app's "Custom Serial Device"
 *                 feature. Handles OLED, WS2812 rev-lights, MAX7219 8×8
 *                 matrix, buttons, encoders and analog axes — completely
 *                 independent from the fixed SIM-X firmware.
 *
 * Required libraries (install via Arduino Library Manager):
 *   U8g2          — oliver  (SSD1306 OLED)
 *   FastLED       — Daniel Garcia / Mark Kriegsman
 *   LedControl    — Eberhard Fahle  (MAX7219)
 *   Encoder       — PJRC / Paul Stoffregen
 *
 * Protocol — 115200 8N1, newline-terminated.  See PROTOCOL.md for full spec.
 *   App → device : T<row>:<text>  N<text>  R<0-100>  B<0|1>
 *                  M<16hex>  L<idx>:<rrggbb>  C
 *   Device → App : B<idx>:<0|1>  E<idx>:<+1|-1>  A<idx>:<0-1023>
 *
 * Adapt pin #defines below to your build. Disable unused peripherals by
 * setting their ENABLE_ flag to 0 — saves flash and RAM.
 */

// ===========================================================================
// ██████╗ ██╗███╗   ██╗    ██████╗ ███████╗███████╗██╗███╗   ██╗███████╗███████╗
// ██╔══██╗██║████╗  ██║    ██╔══██╗██╔════╝██╔════╝██║████╗  ██║██╔════╝██╔════╝
// ██████╔╝██║██╔██╗ ██║    ██║  ██║█████╗  █████╗  ██║██╔██╗ ██║█████╗  ███████╗
// ██╔═══╝ ██║██║╚██╗██║    ██║  ██║██╔══╝  ██╔══╝  ██║██║╚██╗██║██╔══╝  ╚════██║
// ██║     ██║██║ ╚████║    ██████╔╝███████╗██║     ██║██║ ╚████║███████╗███████║
// ╚═╝     ╚═╝╚═╝  ╚═══╝    ╚═════╝ ╚══════╝╚═╝     ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝
// ===========================================================================
// Edit the block below to match your wiring.  Set ENABLE_x to 0 to skip a
// peripheral entirely (no code pulled in, saves flash & RAM).
// ===========================================================================

// ── OLED SSD1306 (I2C) ──────────────────────────────────────────────────────
#define ENABLE_OLED      1   // 0 = disable
// I2C SDA/SCL are board-defined (A4/A5 on Uno/Nano; 2/3 on Pro Micro).
// No separate pin #defines needed for software-I2C variants — U8g2 handles it.
// OLED address: 0x3C (most breakouts); change in U8g2 constructor if needed.
#define OLED_ROWS        4   // usable text rows (font u8g2_font_6x10_tf)

// ── WS2812 Rev Lights ───────────────────────────────────────────────────────
#define ENABLE_REV_LEDS  1
#define REV_LED_PIN      6   // data pin
#define NUM_REV_LEDS     8   // number of LEDs in the strip
#define REV_LED_TYPE     WS2812B
#define REV_COLOR_ORDER  GRB

// ── MAX7219 8×8 LED Matrix ──────────────────────────────────────────────────
#define ENABLE_MATRIX    1
#define MATRIX_DIN       11  // MOSI-compatible (hardware SPI or bit-bang)
#define MATRIX_CLK       13  // SCK
#define MATRIX_CS        10  // SS / LOAD
#define MATRIX_DEVICES   1   // number of chained MAX7219 modules

// ── Addressable LEDs (individual L<idx>:<rrggbb> command) ───────────────────
// Shares the same strip as rev lights by default. If you want a separate
// strip, wire it and change ADDR_LED_PIN.
#define ENABLE_ADDR_LEDS 1
#define ADDR_LED_PIN     REV_LED_PIN   // reuse rev strip; set different pin if needed
#define NUM_ADDR_LEDS    NUM_REV_LEDS

// ── Push Buttons ────────────────────────────────────────────────────────────
#define ENABLE_BUTTONS   1
#define NUM_BUTTONS      4   // adjust to actual count
// Pin list — must have exactly NUM_BUTTONS entries.
// Use INPUT_PULLUP; wire buttons between pin and GND (active-low).
const uint8_t BTN_PINS[NUM_BUTTONS] = { 2, 3, 4, 5 };

// ── Rotary Encoders ─────────────────────────────────────────────────────────
#define ENABLE_ENCODERS  1
#define NUM_ENCODERS     2   // adjust (each uses 2 pins)
// CLK/DT pairs. Interrupt-capable pins preferred (2,3 on Uno; 0,1,2,3 on Pro Micro).
const uint8_t ENC_PINS[NUM_ENCODERS][2] = {
    { A2, A3 },   // encoder 0: {CLK, DT}
    { A4, A5 },   // encoder 1: {CLK, DT}
};

// ── Analog Axes ─────────────────────────────────────────────────────────────
#define ENABLE_ANALOG    1
#define NUM_ANALOG       2   // adjust
const uint8_t ADC_PINS[NUM_ANALOG] = { A0, A1 };
#define ANALOG_DEADBAND  8   // minimum change to emit an A event (0–1023)
#define ANALOG_RATE_MS   50  // minimum ms between A events per axis

// ===========================================================================
// END OF USER CONFIG — do not edit below unless you know what you're doing
// ===========================================================================

#include <Arduino.h>

// ── Conditional includes ─────────────────────────────────────────────────────
#if ENABLE_OLED
  #include <U8g2lib.h>
  // Hardware I2C (400 kHz). Change constructor for SW-I2C or SPI OLED variants.
  U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, /* reset= */ U8X8_PIN_NONE);
#endif

#if ENABLE_REV_LEDS || ENABLE_ADDR_LEDS
  #include <FastLED.h>
  CRGB leds[
    #if ENABLE_REV_LEDS && ENABLE_ADDR_LEDS && (ADDR_LED_PIN == REV_LED_PIN)
      NUM_REV_LEDS  // one shared array
    #elif ENABLE_REV_LEDS
      NUM_REV_LEDS
    #else
      NUM_ADDR_LEDS
    #endif
  ];
#endif

#if ENABLE_MATRIX
  #include <LedControl.h>
  LedControl lc(MATRIX_DIN, MATRIX_CLK, MATRIX_CS, MATRIX_DEVICES);
#endif

#if ENABLE_ENCODERS
  #include <Encoder.h>
  // Encoder objects — stored as raw pointers to allow runtime init from array
  Encoder *encoders[NUM_ENCODERS];
  int32_t encLast[NUM_ENCODERS];
#endif

// ===========================================================================
// Serial rx buffer
// ===========================================================================
#define SERIAL_BUF_SIZE  32
static char   rxBuf[SERIAL_BUF_SIZE];
static uint8_t rxPos = 0;

// ===========================================================================
// State / display buffers
// ===========================================================================
#if ENABLE_OLED
  static char oledRows[OLED_ROWS][22];  // 21 chars + NUL per row
  static char oledBigNum[10];           // N command — up to 9 chars
  static bool oledDirty = false;
#endif

#if ENABLE_REV_LEDS
  static uint8_t revPercent = 0;
  static bool    shiftBlink = false;
  static uint32_t blinkTimer = 0;
  static bool    blinkState  = false;
#endif

#if ENABLE_BUTTONS
  static uint8_t btnState[NUM_BUTTONS];
  static uint8_t btnLast[NUM_BUTTONS];
  static uint32_t btnDebounce[NUM_BUTTONS];
  #define DEBOUNCE_MS 20
#endif

#if ENABLE_ANALOG
  static int16_t  adcLast[NUM_ANALOG];
  static uint32_t adcTimer[NUM_ANALOG];
#endif

// ===========================================================================
// Helpers
// ===========================================================================

// Parse a 2-char hex string into a byte (e.g. "FF" → 255).
static uint8_t hexByte(const char *p) {
  uint8_t hi = (p[0] >= 'a') ? p[0]-'a'+10 : (p[0] >= 'A') ? p[0]-'A'+10 : p[0]-'0';
  uint8_t lo = (p[1] >= 'a') ? p[1]-'a'+10 : (p[1] >= 'A') ? p[1]-'A'+10 : p[1]-'0';
  return (hi << 4) | lo;
}

// Safe atoi stopping at NUL / non-digit.
static int16_t safeAtoi(const char *s) {
  int16_t v = 0;
  bool neg = false;
  if (*s == '-') { neg = true; s++; }
  while (*s >= '0' && *s <= '9') v = v * 10 + (*s++ - '0');
  return neg ? -v : v;
}

#if ENABLE_REV_LEDS
// Map rev percent 0–100 to a CRGB colour gradient:
//  0-60  → green  (CRGB::Green)
//  61-85 → yellow (CRGB::Yellow)
//  86-99 → red    (CRGB::Red)
// 100    → blink white/red (handled in updateRevLeds)
static CRGB revColor(uint8_t pct) {
  if (pct <= 60)  return CRGB::Green;
  if (pct <= 85)  return CRGB::Yellow;
  return CRGB::Red;
}

static void updateRevLeds() {
  uint8_t litCount = (uint16_t)revPercent * NUM_REV_LEDS / 100;
  uint32_t now = millis();

  if (shiftBlink) {
    // Blue blink overrides everything
    if (now - blinkTimer > 80) { blinkTimer = now; blinkState = !blinkState; }
    CRGB c = blinkState ? CRGB::Blue : CRGB::Black;
    for (uint8_t i = 0; i < NUM_REV_LEDS; i++) leds[i] = c;
    FastLED.show();
    return;
  }

  bool nearMax = (revPercent >= 97);
  if (nearMax && (now - blinkTimer > 60)) { blinkTimer = now; blinkState = !blinkState; }

  CRGB baseColor = revColor(revPercent);
  for (uint8_t i = 0; i < NUM_REV_LEDS; i++) {
    if (i < litCount) {
      leds[i] = nearMax ? (blinkState ? CRGB::White : CRGB::Red) : baseColor;
    } else {
      leds[i] = CRGB::Black;
    }
  }
  FastLED.show();
}
#endif // ENABLE_REV_LEDS

#if ENABLE_OLED
static void renderOled() {
  u8g2.clearBuffer();

  // If bignum is set, render it large across the display
  if (oledBigNum[0] != '\0') {
    u8g2.setFont(u8g2_font_logisoso24_tn);
    u8g2.drawStr(0, 28, oledBigNum);
    // Still draw row 0 beneath as status line
    u8g2.setFont(u8g2_font_6x10_tf);
    u8g2.drawStr(0, 55, oledRows[0]);
  } else {
    u8g2.setFont(u8g2_font_6x10_tf);
    for (uint8_t r = 0; r < OLED_ROWS && r < 4; r++) {
      u8g2.drawStr(0, 10 + r * 14, oledRows[r]);
    }
  }

  u8g2.sendBuffer();
  oledDirty = false;
}
#endif // ENABLE_OLED

// ===========================================================================
// Command parser — called once per complete line received
// ===========================================================================
static void handleCommand(const char *cmd) {
  if (!cmd || cmd[0] == '\0') return;
  char op = cmd[0];

  switch (op) {

    // T<row>:<text>  — set OLED text row (row 0-3, ≤21 chars)
    case 'T': {
#if ENABLE_OLED
      uint8_t row = (uint8_t)(cmd[1] - '0');
      if (row >= OLED_ROWS) break;
      const char *txt = (cmd[2] == ':') ? cmd + 3 : cmd + 2;
      strncpy(oledRows[row], txt, 21);
      oledRows[row][21] = '\0';
      oledBigNum[0] = '\0';  // clear bignum when text rows are used
      oledDirty = true;
#endif
      break;
    }

    // N<text>  — OLED big number (≤9 chars)
    case 'N': {
#if ENABLE_OLED
      strncpy(oledBigNum, cmd + 1, 9);
      oledBigNum[9] = '\0';
      oledDirty = true;
#endif
      break;
    }

    // R<0-100>  — rev lights percent
    case 'R': {
#if ENABLE_REV_LEDS
      int16_t v = safeAtoi(cmd + 1);
      revPercent = (uint8_t)(v < 0 ? 0 : v > 100 ? 100 : v);
      updateRevLeds();
#endif
      break;
    }

    // B<0|1>  — blue shift-blink override
    case 'B': {
#if ENABLE_REV_LEDS
      shiftBlink = (cmd[1] == '1');
      blinkTimer = millis();
      updateRevLeds();
#endif
      break;
    }

    // M<16hex>  — 8×8 matrix (8 rows × 2 hex chars = 16 chars total)
    case 'M': {
#if ENABLE_MATRIX
      if (strlen(cmd + 1) < 16) break;
      for (uint8_t r = 0; r < 8; r++) {
        uint8_t rowData = hexByte(cmd + 1 + r * 2);
        lc.setRow(0, r, rowData);
      }
#endif
      break;
    }

    // L<idx>:<rrggbb>  — set addressable LED to RGB colour
    case 'L': {
#if ENABLE_ADDR_LEDS
      const char *colon = strchr(cmd + 1, ':');
      if (!colon || strlen(colon + 1) < 6) break;
      uint8_t idx = (uint8_t)safeAtoi(cmd + 1);
      if (idx >= NUM_ADDR_LEDS) break;
      uint8_t r = hexByte(colon + 1);
      uint8_t g = hexByte(colon + 3);
      uint8_t b = hexByte(colon + 5);
      leds[idx] = CRGB(r, g, b);
      FastLED.show();
#endif
      break;
    }

    // C  — clear all outputs
    case 'C': {
#if ENABLE_OLED
      for (uint8_t r = 0; r < OLED_ROWS; r++) oledRows[r][0] = '\0';
      oledBigNum[0] = '\0';
      oledDirty = true;
#endif
#if ENABLE_REV_LEDS || ENABLE_ADDR_LEDS
      revPercent = 0;
      shiftBlink = false;
      FastLED.clear();
      FastLED.show();
#endif
#if ENABLE_MATRIX
      for (uint8_t r = 0; r < 8; r++) lc.setRow(0, r, 0);
#endif
      break;
    }

    default:
      break;  // unknown command — silently ignore
  }
}

// ===========================================================================
// Serial rx — non-blocking, overflow-safe, newline-terminated
// ===========================================================================
static void pollSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (rxPos > 0) {
        rxBuf[rxPos] = '\0';
        handleCommand(rxBuf);
        rxPos = 0;
      }
    } else {
      if (rxPos < SERIAL_BUF_SIZE - 1) {
        rxBuf[rxPos++] = c;
      } else {
        // Buffer overflow — discard and reset
        rxPos = 0;
      }
    }
  }
}

// ===========================================================================
// setup()
// ===========================================================================
void setup() {
  Serial.begin(115200);

#if ENABLE_OLED
  u8g2.begin();
  u8g2.setFont(u8g2_font_6x10_tf);
  for (uint8_t r = 0; r < OLED_ROWS; r++) oledRows[r][0] = '\0';
  oledBigNum[0] = '\0';
  u8g2.clearBuffer();
  u8g2.drawStr(0, 10, F("Companion ready"));  // F() keeps string in flash
  u8g2.sendBuffer();
#endif

#if ENABLE_REV_LEDS
  FastLED.addLeds<REV_LED_TYPE, REV_LED_PIN, REV_COLOR_ORDER>(leds, NUM_REV_LEDS);
  FastLED.setBrightness(180);
  FastLED.clear(true);
#elif ENABLE_ADDR_LEDS
  FastLED.addLeds<WS2812B, ADDR_LED_PIN, GRB>(leds, NUM_ADDR_LEDS);
  FastLED.setBrightness(180);
  FastLED.clear(true);
#endif

#if ENABLE_MATRIX
  lc.shutdown(0, false);   // wake from power-down
  lc.setIntensity(0, 8);   // 0-15 brightness
  lc.clearDisplay(0);
#endif

#if ENABLE_ENCODERS
  for (uint8_t i = 0; i < NUM_ENCODERS; i++) {
    encoders[i] = new Encoder(ENC_PINS[i][0], ENC_PINS[i][1]);
    encLast[i] = 0;
  }
#endif

#if ENABLE_BUTTONS
  for (uint8_t i = 0; i < NUM_BUTTONS; i++) {
    pinMode(BTN_PINS[i], INPUT_PULLUP);
    btnState[i]    = 1;  // pull-up idle = HIGH = not pressed
    btnLast[i]     = 1;
    btnDebounce[i] = 0;
  }
#endif

#if ENABLE_ANALOG
  for (uint8_t i = 0; i < NUM_ANALOG; i++) {
    adcLast[i]  = analogRead(ADC_PINS[i]);
    adcTimer[i] = millis();
  }
#endif
}

// ===========================================================================
// loop()
// ===========================================================================
void loop() {
  // 1. Drain serial input
  pollSerial();

  uint32_t now = millis();

  // 2. Button scan + debounce + emit B events
#if ENABLE_BUTTONS
  for (uint8_t i = 0; i < NUM_BUTTONS; i++) {
    uint8_t raw = digitalRead(BTN_PINS[i]);
    if (raw != btnLast[i]) {
      btnDebounce[i] = now;
      btnLast[i] = raw;
    }
    if ((now - btnDebounce[i]) >= DEBOUNCE_MS && raw != btnState[i]) {
      btnState[i] = raw;
      // active-low: raw==0 → pressed (1), raw==1 → released (0)
      Serial.print(F("B"));
      Serial.print(i);
      Serial.print(':');
      Serial.println(raw == LOW ? '1' : '0');
    }
  }
#endif

  // 3. Encoder scan + emit E events
#if ENABLE_ENCODERS
  for (uint8_t i = 0; i < NUM_ENCODERS; i++) {
    int32_t pos = encoders[i]->read();
    // Encoder library counts 4 ticks per detent for typical EC11
    int32_t delta = (pos - encLast[i]) / 4;
    if (delta != 0) {
      encLast[i] += delta * 4;
      // Clamp to ±1 per iteration to avoid multi-step jumps on fast spin
      int8_t step = (delta > 0) ? 1 : -1;
      Serial.print(F("E"));
      Serial.print(i);
      Serial.print(':');
      Serial.println(step == 1 ? F("+1") : F("-1"));
    }
  }
#endif

  // 4. Analog axes — rate-limited + dead-band filtered
#if ENABLE_ANALOG
  for (uint8_t i = 0; i < NUM_ANALOG; i++) {
    if ((now - adcTimer[i]) >= ANALOG_RATE_MS) {
      int16_t val = analogRead(ADC_PINS[i]);
      if (abs(val - adcLast[i]) >= ANALOG_DEADBAND) {
        adcLast[i]  = val;
        adcTimer[i] = now;
        Serial.print(F("A"));
        Serial.print(i);
        Serial.print(':');
        Serial.println(val);
      } else {
        adcTimer[i] = now;  // still reset timer to avoid hammering at threshold
      }
    }
  }
#endif

  // 5. OLED refresh (only when dirty)
#if ENABLE_OLED
  if (oledDirty) renderOled();
#endif

  // 6. Periodic rev-light blink tick (near-max + shift blink need continuous refresh)
#if ENABLE_REV_LEDS
  if (shiftBlink || revPercent >= 97) {
    updateRevLeds();
  }
#endif
}
