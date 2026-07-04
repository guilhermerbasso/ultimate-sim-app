// Ultimate ButtonBox — Companion firmware: RGB LED strip (rev lights)
// ---------------------------------------------------------------------------
// Generic WS2812/SK6812 strip driver speaking the app's "companion v2" serial
// protocol. The app's device-output engine drives it from telemetry; the Setup
// Tool flashes this prebuilt .hex so the strip "just works".
//
// Serial: 115200 8N1, newline-terminated lines. Commands (App -> device):
//   P<hex...>      set pixels from #0, 6 hex (rrggbb) per LED, then show
//   L<idx>:<rrggbb> set a single LED, then show
//   R<0-100>       rev percent -> green->yellow->red bar (manual/test use)
//   B<0|1>         shift blink: 1 = whole strip blue, 0 = clear
//   Y<0-255>       global brightness (FastLED.setBrightness)
//   C              clear all
//   ?              reply capabilities: "K:rgbStrip=<NUM_LEDS>" then "KEND"
//
// Reports "K:rgbStrip=<NUM_LEDS>" once on boot so the app can auto-detect it.
//
// Wiring: DIN -> DATA_PIN (default D6), 5V, GND. For brighter/longer strips use
// an external 5V supply with a common GND and keep brightness moderate on USB.

#include <FastLED.h>

#define DATA_PIN 6
#define LED_TYPE WS2812B
#define COLOR_ORDER GRB
#define NUM_LEDS 16            // physical strip length; trailing LEDs auto-clear
#define DEFAULT_BRIGHTNESS 160
#define LINE_BUF_SIZE 240      // P for 33 LEDs = 199 chars; keep headroom

CRGB leds[NUM_LEDS];
char lineBuf[LINE_BUF_SIZE];
uint16_t lineLen = 0;
bool lineOverflow = false;

static int8_t hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

// Parse two hex chars at p into a byte; returns false on a bad char.
static bool hexByte(const char *p, uint8_t &out) {
  int8_t hi = hexNibble(p[0]);
  int8_t lo = hexNibble(p[1]);
  if (hi < 0 || lo < 0) return false;
  out = (uint8_t)((hi << 4) | lo);
  return true;
}

static void showCapabilities() {
  Serial.print(F("K:rgbStrip="));
  Serial.println(NUM_LEDS);
  Serial.println(F("KEND"));
}

// P<hex...> : set pixels from 0; clear any LEDs the frame didn't cover.
static void handlePixels(const char *payload, uint16_t len) {
  uint16_t count = len / 6;
  if (count > NUM_LEDS) count = NUM_LEDS;
  uint16_t i = 0;
  for (; i < count; i++) {
    const char *p = payload + i * 6;
    uint8_t r, g, b;
    if (!hexByte(p, r) || !hexByte(p + 2, g) || !hexByte(p + 4, b)) break;
    leds[i] = CRGB(r, g, b);
  }
  for (; i < NUM_LEDS; i++) leds[i] = CRGB::Black;
  FastLED.show();
}

// L<idx>:<rrggbb>
static void handleLed(const char *payload) {
  const char *colon = strchr(payload, ':');
  if (!colon) return;
  uint16_t idx = (uint16_t)atoi(payload);
  if (idx >= NUM_LEDS) return;
  const char *hex = colon + 1;
  uint8_t r, g, b;
  if (!hexByte(hex, r) || !hexByte(hex + 2, g) || !hexByte(hex + 4, b)) return;
  leds[idx] = CRGB(r, g, b);
  FastLED.show();
}

// R<0-100> : simple green->yellow->red rev bar (manual/test convenience).
static void handleRev(const char *payload) {
  int pct = atoi(payload);
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  uint16_t lit = (uint16_t)((long)pct * NUM_LEDS / 100);
  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    if (i < lit) {
      uint16_t third = NUM_LEDS / 3;
      if (i < third) leds[i] = CRGB::Green;
      else if (i < third * 2) leds[i] = CRGB::Yellow;
      else leds[i] = CRGB::Red;
    } else {
      leds[i] = CRGB::Black;
    }
  }
  FastLED.show();
}

static void handleBlink(const char *payload) {
  bool on = payload[0] == '1';
  fill_solid(leds, NUM_LEDS, on ? CRGB::Blue : CRGB::Black);
  FastLED.show();
}

static void handleBrightness(const char *payload) {
  int v = atoi(payload);
  if (v < 0) v = 0;
  if (v > 255) v = 255;
  FastLED.setBrightness((uint8_t)v);
  FastLED.show();
}

static void handleLine(char *line, uint16_t len) {
  if (len == 0) return;
  char cmd = line[0];
  char *payload = line + 1;
  switch (cmd) {
    case 'P': handlePixels(payload, len - 1); break;
    case 'L': handleLed(payload); break;
    case 'R': handleRev(payload); break;
    case 'B': handleBlink(payload); break;
    case 'Y': handleBrightness(payload); break;
    case 'C': fill_solid(leds, NUM_LEDS, CRGB::Black); FastLED.show(); break;
    case '?': showCapabilities(); break;
    default: break; // ignore unknown commands
  }
}

static void pumpSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (!lineOverflow && lineLen > 0) {
        lineBuf[lineLen] = '\0';
        handleLine(lineBuf, lineLen);
      }
      lineLen = 0;
      lineOverflow = false;
    } else if (!lineOverflow) {
      if (lineLen < LINE_BUF_SIZE - 1) {
        lineBuf[lineLen++] = c;
      } else {
        lineOverflow = true; // drop the rest of an over-long line cleanly
      }
    }
  }
}

void setup() {
  Serial.begin(115200);
  FastLED.addLeds<LED_TYPE, DATA_PIN, COLOR_ORDER>(leds, NUM_LEDS);
  FastLED.setBrightness(DEFAULT_BRIGHTNESS);
  // brief boot self-test: green sweep, then clear
  for (uint16_t i = 0; i < NUM_LEDS; i++) {
    leds[i] = CRGB::Green;
    FastLED.show();
    delay(15);
  }
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  FastLED.show();
  showCapabilities();
}

void loop() {
  pumpSerial();
}
