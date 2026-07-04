// Companion iFlag firmware for an 8x8 WS2812/WS2812B RGB matrix.
// Protocol: 115200 8N1, newline-terminated Companion v2 frames.
//
// The physical wiring of a cheap 8x8 panel varies wildly (serpentine vs
// progressive, which corner the DIN enters, rotation). Instead of guessing with
// compile-time flags, the matrix layout is RUNTIME-configurable and persisted in
// EEPROM, plus a calibration mode lights unambiguous patterns so the layout can
// be identified visually. See the `M` and `T` commands below.

#include <FastLED.h>
#include <EEPROM.h>

#define DATA_PIN 6
#define LED_TYPE WS2812B
#define COLOR_ORDER GRB

#define MATRIX_W 8
#define MATRIX_H 8
#define NUM_LEDS 64

// Compile-time DEFAULTS only. These seed the layout the very first time the
// device boots (or after an EEPROM reset). At runtime the layout is changed with
// the `M` command and persisted, so a panel never needs a recompile again.
// Default = serpentine ON — the SimHub "Serpentine layout" convention (start
// top-left, row 0 left→right, every ODD physical row reversed). This matches the
// overwhelming majority of cheap 8x8 WS2812B panels, including the ones SimHub
// drives with "Enable WS2812B → Serpentine layout", so flags/gears render
// correctly out of the box. Progressive wiring is one toggle away in the app's
// calibration, and the app also pushes the saved layout on every connect.
#ifndef SERPENTINE
#define SERPENTINE true
#endif

// Supported values: 0, 90, 180, 270.
#ifndef ORIENTATION
#define ORIENTATION 0
#endif

#define DEFAULT_BRIGHTNESS 120
// Manual-remap / pixel-probe brightness floor. The probe lights ONE physical LED
// so the user can map a non-standard panel; force it visible even if a prior Y0
// (or a low per-component brightness) left the panel dark.
#define PROBE_BRIGHTNESS 160
#define LINE_BUF_SIZE 160
#define ROW_HEX_LEN (MATRIX_W * 6)
#define FRAME_IDLE_SHOW_MS 15

// ─── Layout byte (also the `M<byte>` wire value and EEPROM payload) ──────────
// bit 0      serpentine (odd physical rows reversed)
// bits 1..2  rotation: 0=0deg, 1=90deg, 2=180deg, 3=270deg
// bit 3      flipX (mirror logical columns before rotation)
// bit 4      flipY (mirror logical rows before rotation)
#define LAYOUT_SERP 0x01
#define LAYOUT_ROT_SHIFT 1
#define LAYOUT_ROT_MASK 0x06
#define LAYOUT_FLIPX 0x08
#define LAYOUT_FLIPY 0x10

#define EEPROM_MAGIC 0x4C  // 'L' — marks an initialised layout slot
#define EEPROM_ADDR_MAGIC 0
#define EEPROM_ADDR_LAYOUT 1

CRGB leds[NUM_LEDS];          // physical strip order — what FastLED writes out
CRGB logicalFrame[NUM_LEDS];  // logical row-major image (source of truth)

uint8_t layoutByte = 0;

char lineBuf[LINE_BUF_SIZE];
uint8_t lineLen = 0;
bool lineOverflow = false;
bool frameDirty = false;
uint32_t lastFrameWriteMs = 0;

CRGB pixelFrame[NUM_LEDS];
char pixelHex[6];
uint16_t pixelNibbleCount = 0;
uint8_t pixelCount = 0;
bool pixelStreamMode = false;
bool pixelStreamInvalid = false;

bool isHexDigit(char c) {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

uint8_t hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return 0;
}

bool parseRgb(const char *hex, CRGB &out) {
  for (uint8_t i = 0; i < 6; i++) {
    if (!isHexDigit(hex[i])) return false;
  }

  out.r = (hexNibble(hex[0]) << 4) | hexNibble(hex[1]);
  out.g = (hexNibble(hex[2]) << 4) | hexNibble(hex[3]);
  out.b = (hexNibble(hex[4]) << 4) | hexNibble(hex[5]);
  return true;
}

bool parseBrightness(const char *text, uint8_t &out) {
  if (!text[0]) return false;

  uint16_t value = 0;
  for (uint8_t i = 0; text[i]; i++) {
    if (text[i] < '0' || text[i] > '9') return false;
    value = (value * 10) + (text[i] - '0');
    if (value > 255) value = 255;
  }

  out = (uint8_t)value;
  return true;
}

uint8_t defaultLayoutByte() {
  uint8_t b = 0;
  if (SERPENTINE) b |= LAYOUT_SERP;
  b |= (uint8_t)(((ORIENTATION / 90) & 0x03) << LAYOUT_ROT_SHIFT);
  return b;
}

// Map a logical (x,y) — column x left→right, row y top→bottom in the app preview
// — to the physical LED index using the current layout. The pipeline is:
//   1. optional logical flips (flipX / flipY)
//   2. rotation into panel coordinates
//   3. optional serpentine reversal on odd physical rows
uint8_t xyToIndex(uint8_t x, uint8_t y) {
  if (layoutByte & LAYOUT_FLIPX) x = MATRIX_W - 1 - x;
  if (layoutByte & LAYOUT_FLIPY) y = MATRIX_H - 1 - y;

  uint8_t px, py;
  switch ((layoutByte & LAYOUT_ROT_MASK) >> LAYOUT_ROT_SHIFT) {
    case 1:  // 90
      px = MATRIX_H - 1 - y;
      py = x;
      break;
    case 2:  // 180
      px = MATRIX_W - 1 - x;
      py = MATRIX_H - 1 - y;
      break;
    case 3:  // 270
      px = y;
      py = MATRIX_W - 1 - x;
      break;
    default:  // 0
      px = x;
      py = y;
      break;
  }

  if ((layoutByte & LAYOUT_SERP) && (py & 1)) {
    px = MATRIX_W - 1 - px;
  }

  return (py * MATRIX_W) + px;
}

// Re-map the logical frame through the active layout and push it to the strip.
// Every visible update goes through here, so a layout change instantly re-maps
// whatever image is currently shown.
void renderFrame() {
  for (uint8_t y = 0; y < MATRIX_H; y++) {
    for (uint8_t x = 0; x < MATRIX_W; x++) {
      leds[xyToIndex(x, y)] = logicalFrame[y * MATRIX_W + x];
    }
  }
  FastLED.show();
  frameDirty = false;
}

void printHexByte(uint8_t value) {
  const char digits[] = "0123456789abcdef";
  Serial.write(digits[(value >> 4) & 0x0F]);
  Serial.write(digits[value & 0x0F]);
}

void printLayout() {
  Serial.print(F("K:layout="));
  printHexByte(layoutByte);
  Serial.println();
}

void applyLayout(uint8_t value, bool persist) {
  layoutByte = value;
  if (persist) {
    EEPROM.update(EEPROM_ADDR_MAGIC, EEPROM_MAGIC);
    EEPROM.update(EEPROM_ADDR_LAYOUT, layoutByte);
  }
  renderFrame();
  printLayout();
}

void loadLayout() {
  if (EEPROM.read(EEPROM_ADDR_MAGIC) == EEPROM_MAGIC) {
    layoutByte = EEPROM.read(EEPROM_ADDR_LAYOUT);
  } else {
    layoutByte = defaultLayoutByte();
    EEPROM.update(EEPROM_ADDR_MAGIC, EEPROM_MAGIC);
    EEPROM.update(EEPROM_ADDR_LAYOUT, layoutByte);
  }
}

void printCapabilities() {
  Serial.println(F("K:rgbMatrix=8x8"));
  printLayout();
  Serial.println(F("KEND"));
}

void clearMatrix() {
  fill_solid(logicalFrame, NUM_LEDS, CRGB::Black);
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  FastLED.show();
  frameDirty = false;
}

void selfTest() {
  fill_solid(leds, NUM_LEDS, CRGB(0, 32, 0));
  FastLED.show();
  delay(180);

  clearMatrix();
}

// Bold asymmetric "F" used by calibration T3. Row-major, MSB = logical column 0.
// Asymmetric on BOTH axes (left stem + top-heavy bars), so a single glance
// reveals any mirroring (flipX/flipY), rotation, or serpentine row-scramble.
static const uint8_t CALIB_GLYPH_F[MATRIX_H] = {
  0b01111100,  // .#####..  top bar
  0b01100000,  // .##.....
  0b01100000,  // .##.....
  0b01111000,  // .####...  middle bar (shorter than the top)
  0b01100000,  // .##.....
  0b01100000,  // .##.....
  0b01100000,  // .##.....
  0b00000000   // ........
};

// Calibration patterns light an unambiguous LOGICAL shape through the current
// layout so the user can confirm/fix the mapping from the app:
//   T0 → only logical (0,0)  (white)  — where is the origin corner?
//   T1 → only logical row 0  (red)    — top row should be a straight line
//   T2 → only logical col 0  (blue)   — left column should be a straight line
//   T3 → a bold letter "F"   (white)  — asymmetric in BOTH axes, so mirroring,
//        rotation or a serpentine scramble is obvious. Tune the layout until the
//        "F" reads upright and correct; this is the most diagnostic test.
void calibration(uint8_t mode) {
  fill_solid(logicalFrame, NUM_LEDS, CRGB::Black);
  if (mode == 0) {
    logicalFrame[0] = CRGB::White;
  } else if (mode == 1) {
    for (uint8_t x = 0; x < MATRIX_W; x++) logicalFrame[x] = CRGB::Red;
  } else if (mode == 2) {
    for (uint8_t y = 0; y < MATRIX_H; y++) logicalFrame[y * MATRIX_W] = CRGB::Blue;
  } else if (mode == 3) {
    for (uint8_t y = 0; y < MATRIX_H; y++) {
      uint8_t bits = CALIB_GLYPH_F[y];
      for (uint8_t x = 0; x < MATRIX_W; x++) {
        if (bits & (uint8_t)(0x80 >> x)) logicalFrame[y * MATRIX_W + x] = CRGB::White;
      }
    }
  }
  renderFrame();
}

bool payloadIsHexLen(const char *payload, uint16_t expectedLen) {
  for (uint16_t i = 0; i < expectedLen; i++) {
    if (!payload[i] || !isHexDigit(payload[i])) return false;
  }
  return payload[expectedLen] == '\0';
}

void handleRowCommand(char *line) {
  char *colon = strchr(line + 1, ':');
  if (!colon) return;

  *colon = '\0';
  int row = atoi(line + 1);
  if (row < 0 || row >= MATRIX_H) return;

  const char *payload = colon + 1;
  if (!payloadIsHexLen(payload, ROW_HEX_LEN)) return;

  for (uint8_t x = 0; x < MATRIX_W; x++) {
    CRGB color;
    if (!parseRgb(payload + (x * 6), color)) return;
    logicalFrame[row * MATRIX_W + x] = color;
  }

  frameDirty = true;
  lastFrameWriteMs = millis();
  if (row == MATRIX_H - 1) {
    renderFrame();
  }
}

void handleBrightnessCommand(const char *payload) {
  uint8_t brightness;
  if (!parseBrightness(payload, brightness)) return;
  FastLED.setBrightness(brightness);
  FastLED.show();
}

// I<idx> — manual-remap probe. Light EXACTLY one PHYSICAL LED (idx ∈ [0,63])
// white, RAW: straight into leds[idx], bypassing logicalFrame/xyToIndex and the
// layout byte entirely. Self-contained like a calibration pattern (one frame,
// one show), so it never depends on a burst of multi-row Q frames rendering on a
// slow/old board. Brightness is forced to a visible floor so the probe is never
// invisible because of a prior Y0 or a low per-component brightness. This is the
// primitive the app's per-pixel "manual remap" wizard uses to identify the
// physical wiring of panels that match no serpentine/rotation/flip combination.
void handlePixelProbe(const char *payload) {
  uint16_t value = 0;
  if (!payload[0]) return;
  for (uint8_t i = 0; payload[i]; i++) {
    if (payload[i] < '0' || payload[i] > '9') return;
    value = (value * 10) + (payload[i] - '0');
    if (value >= NUM_LEDS) return;
  }
  fill_solid(logicalFrame, NUM_LEDS, CRGB::Black);
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  leds[value] = CRGB::White;
  if (FastLED.getBrightness() < PROBE_BRIGHTNESS) FastLED.setBrightness(PROBE_BRIGHTNESS);
  FastLED.show();
  frameDirty = false;
}

// M<2 hex> — set + persist the matrix layout byte and re-render. Rejects
// anything that is not exactly two hex digits (so a stray legacy M<16hex> frame
// for a MAX7219 panel is ignored rather than mis-parsed).
void handleLayoutCommand(const char *payload) {
  if (!isHexDigit(payload[0]) || !isHexDigit(payload[1]) || payload[2] != '\0') return;
  uint8_t value = (hexNibble(payload[0]) << 4) | hexNibble(payload[1]);
  applyLayout(value, true);
}

// T<n> — calibration test pattern (n ∈ 0..3). Strict single-digit form so it
// can never collide with an OLED-style "T<row>:<text>" frame.
void handleCalibrationCommand(const char *payload) {
  if (payload[0] >= '0' && payload[0] <= '3' && payload[1] == '\0') {
    calibration(payload[0] - '0');
  }
}

void startPixelStream() {
  pixelStreamMode = true;
  pixelStreamInvalid = false;
  pixelNibbleCount = 0;
  pixelCount = 0;
}

void writePixelStreamChar(char c) {
  if (!isHexDigit(c)) {
    pixelStreamInvalid = true;
    return;
  }

  if (pixelNibbleCount >= (NUM_LEDS * 6)) {
    pixelStreamInvalid = true;
    return;
  }

  pixelHex[pixelNibbleCount % 6] = c;
  pixelNibbleCount++;

  if ((pixelNibbleCount % 6) == 0) {
    CRGB color;
    if (!parseRgb(pixelHex, color) || pixelCount >= NUM_LEDS) {
      pixelStreamInvalid = true;
      return;
    }
    pixelFrame[pixelCount++] = color;
  }
}

void finishPixelStream() {
  if (!pixelStreamInvalid && pixelNibbleCount > 0 && (pixelNibbleCount % 6) == 0) {
    for (uint8_t i = 0; i < NUM_LEDS; i++) {
      logicalFrame[i] = (i < pixelCount) ? pixelFrame[i] : CRGB::Black;
    }
    renderFrame();
  }

  pixelStreamMode = false;
}

void processLine(char *line) {
  if (!line[0]) return;

  switch (line[0]) {
    case 'Q':
      handleRowCommand(line);
      break;
    case 'C':
      clearMatrix();
      break;
    case '?':
      printCapabilities();
      break;
    case 'Y':
      handleBrightnessCommand(line + 1);
      break;
    case 'M':
      handleLayoutCommand(line + 1);
      break;
    case 'T':
      handleCalibrationCommand(line + 1);
      break;
    case 'I':
      handlePixelProbe(line + 1);
      break;
    default:
      break;
  }
}

void readSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    if (c == '\r') continue;

    if (c == '\n') {
      if (pixelStreamMode) {
        finishPixelStream();
        continue;
      }

      if (!lineOverflow) {
        lineBuf[lineLen] = '\0';
        processLine(lineBuf);
      }
      lineLen = 0;
      lineOverflow = false;
      continue;
    }

    if (pixelStreamMode) {
      writePixelStreamChar(c);
      continue;
    }

    if (lineLen == 0 && c == 'P') {
      startPixelStream();
      continue;
    }

    if (lineOverflow) continue;

    if (lineLen < LINE_BUF_SIZE - 1) {
      lineBuf[lineLen++] = c;
    } else {
      lineLen = 0;
      lineOverflow = true;
    }
  }
}

void flushIdleFrame() {
  if (frameDirty && (millis() - lastFrameWriteMs) >= FRAME_IDLE_SHOW_MS) {
    renderFrame();
  }
}

void setup() {
  Serial.begin(115200);

  FastLED.addLeds<LED_TYPE, DATA_PIN, COLOR_ORDER>(leds, NUM_LEDS);
  FastLED.setBrightness(DEFAULT_BRIGHTNESS);
  FastLED.clear(true);

  fill_solid(logicalFrame, NUM_LEDS, CRGB::Black);
  loadLayout();

  selfTest();
  Serial.println(F("K:rgbMatrix=8x8"));
  printLayout();
}

void loop() {
  readSerial();
  flushIdleFrame();
}
