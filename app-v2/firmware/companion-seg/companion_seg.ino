// Ultimate ButtonBox — Companion firmware: TM1638 7-seg display
// ---------------------------------------------------------------------------
// Drives a TM1638 module (8x 7-seg digits + 8 buttons + 8 LEDs) using the
// app's Companion Protocol v2 over Serial: 115200 8N1, newline-terminated.
//
// App -> device:
//   7<text>        display text on 8 digits, right-aligned
//   C              clear digits and LEDs
//   ?              report capability: "K:segDisplay=tm1638" then "KEND"
//
// Device -> app:
//   B<idx>:<0|1>   button state changes, idx 0..7

#include <TM1638plus.h>

#ifndef TM_STB_PIN
#define TM_STB_PIN 7   // D7
#endif
#ifndef TM_CLK_PIN
#define TM_CLK_PIN 9   // D9
#endif
#ifndef TM_DIO_PIN
#define TM_DIO_PIN 8   // D8
#endif

#define DIGIT_COUNT 8
#define LINE_BUF_SIZE 64
#ifndef TM_HIGH_FREQ
#define TM_HIGH_FREQ true
#endif

TM1638plus tm(TM_STB_PIN, TM_CLK_PIN, TM_DIO_PIN, TM_HIGH_FREQ);

char lineBuf[LINE_BUF_SIZE];
uint8_t lineLen = 0;
bool lineOverflow = false;
uint8_t lastButtons = 0;

static bool isAllowedSegChar(char c) {
  return (c >= '0' && c <= '9') || c == '.' || c == '-' || c == ':' || c == ' ';
}

static bool consumesDigit(char c) {
  return c != '.';
}

static void printCapabilities() {
  Serial.println(F("K:segDisplay=tm1638"));
  Serial.println(F("KEND"));
}

static void clearModule() {
  tm.displayText("        ");
  for (uint8_t i = 0; i < 8; i++) tm.setLED(i, 0);
}

static void displaySegText(const char *payload) {
  char cleaned[LINE_BUF_SIZE];
  uint8_t cleanLen = 0;
  uint8_t cells = 0;

  for (uint8_t i = 0; payload[i] && cleanLen < LINE_BUF_SIZE - 1; i++) {
    char c = payload[i];
    if (!isAllowedSegChar(c)) continue;
    if (c == '.' && cleanLen == 0) continue; // decimal point needs a previous digit
    if (consumesDigit(c)) {
      if (cells >= DIGIT_COUNT) break;
      cells++;
    }
    cleaned[cleanLen++] = c;
  }
  cleaned[cleanLen] = '\0';

  char out[LINE_BUF_SIZE];
  uint8_t outLen = 0;
  for (uint8_t i = cells; i < DIGIT_COUNT && outLen < LINE_BUF_SIZE - 1; i++) {
    out[outLen++] = ' ';
  }
  for (uint8_t i = 0; i < cleanLen && outLen < LINE_BUF_SIZE - 1; i++) {
    out[outLen++] = cleaned[i];
  }
  out[outLen] = '\0';

  tm.displayText(out);
}

static void handleLine(char *line) {
  if (!line[0]) return;

  switch (line[0]) {
    case '7':
      displaySegText(line + 1);
      break;
    case 'C':
      clearModule();
      break;
    case '?':
      printCapabilities();
      break;
    default:
      break;
  }
}

static void pumpSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    if (c == '\n' || c == '\r') {
      if (!lineOverflow && lineLen > 0) {
        lineBuf[lineLen] = '\0';
        handleLine(lineBuf);
      }
      lineLen = 0;
      lineOverflow = false;
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

static void pollButtons() {
  uint8_t buttons = tm.readButtons();
  uint8_t changed = buttons ^ lastButtons;
  if (!changed) return;

  for (uint8_t i = 0; i < 8; i++) {
    uint8_t mask = (uint8_t)(1 << i);
    if (changed & mask) {
      Serial.print(F("B"));
      Serial.print(i);
      Serial.print(F(":"));
      Serial.println((buttons & mask) ? 1 : 0);
    }
  }
  lastButtons = buttons;
}

void setup() {
  Serial.begin(115200);
  tm.displayBegin();
  clearModule();
  lastButtons = tm.readButtons();
  printCapabilities();
}

void loop() {
  pumpSerial();
  pollButtons();
}
