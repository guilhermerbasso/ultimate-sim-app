// Companion OLED firmware for SSD1306 128x64 I2C displays.
// Protocol: 115200 8N1, newline-terminated Ultimate ButtonBox companion frames.

#include <Arduino.h>
#include <U8g2lib.h>
#include <Wire.h>

#define LINE_BUF_SIZE 120
#define OLED_ROWS 4
#define OLED_LINE_WIDTH 21
#define BIGNUM_MAX_LEN 9

U8G2_SSD1306_128X64_NONAME_1_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE);

char lineBuf[LINE_BUF_SIZE];
uint8_t lineLen = 0;
bool lineOverflow = false;

char textLines[OLED_ROWS][OLED_LINE_WIDTH + 1];
char bigNum[BIGNUM_MAX_LEN + 1];

enum ViewMode {
  VIEW_TEXT,
  VIEW_BIGNUM,
  VIEW_CLEAR
};

ViewMode currentView = VIEW_CLEAR;

bool isPrintableAscii(char c) {
  return c >= 0x20 && c < 0x7f;
}

bool isBigNumChar(char c) {
  return (c >= '0' && c <= '9') || c == '.' || c == '-' || c == ':' || c == ' ';
}

void printCapabilities() {
  Serial.println(F("K:screen=oled"));
  Serial.println(F("KEND"));
}

void renderTextView() {
  u8g2.firstPage();
  do {
    u8g2.setFont(u8g2_font_6x12_tf);
    u8g2.setFontPosTop();
    for (uint8_t row = 0; row < OLED_ROWS; row++) {
      u8g2.drawStr(0, row * 16, textLines[row]);
    }
  } while (u8g2.nextPage());
}

void renderBigNumView() {
  u8g2.setFont(u8g2_font_logisoso28_tf);
  int16_t width = u8g2.getStrWidth(bigNum);
  int16_t x = (128 - width) / 2;
  if (x < 0) x = 0;

  u8g2.firstPage();
  do {
    u8g2.setFont(u8g2_font_logisoso28_tf);
    u8g2.setFontPosBaseline();
    u8g2.drawStr(x, 46, bigNum);
  } while (u8g2.nextPage());
}

void clearDisplay() {
  if (currentView == VIEW_CLEAR) return;

  u8g2.firstPage();
  do {
    // intentionally empty: clears every page
  } while (u8g2.nextPage());
  currentView = VIEW_CLEAR;
}

void showSplash() {
  u8g2.firstPage();
  do {
    u8g2.setFont(u8g2_font_6x12_tf);
    u8g2.setFontPosTop();
    u8g2.drawStr(10, 16, "Ultimate ButtonBox");
    u8g2.drawStr(25, 34, "OLED companion");
  } while (u8g2.nextPage());
  delay(650);
  currentView = VIEW_TEXT;
  clearDisplay();
}

void setTextRow(uint8_t row, const char *text) {
  char next[OLED_LINE_WIDTH + 1];
  uint8_t out = 0;
  while (text[out] && out < OLED_LINE_WIDTH) {
    char c = text[out];
    next[out] = isPrintableAscii(c) ? c : ' ';
    out++;
  }
  next[out] = '\0';

  if (currentView == VIEW_TEXT && strcmp(textLines[row], next) == 0) return;

  strcpy(textLines[row], next);
  currentView = VIEW_TEXT;
  renderTextView();
}

void setBigNum(const char *text) {
  char next[BIGNUM_MAX_LEN + 1];
  uint8_t out = 0;
  for (uint8_t i = 0; text[i] && out < BIGNUM_MAX_LEN; i++) {
    if (isBigNumChar(text[i])) {
      next[out++] = text[i];
    }
  }
  next[out] = '\0';

  if (currentView == VIEW_BIGNUM && strcmp(bigNum, next) == 0) return;

  strcpy(bigNum, next);
  currentView = VIEW_BIGNUM;
  renderBigNumView();
}

void handleTextCommand(char *line) {
  if (line[1] < '0' || line[1] > '3' || line[2] != ':') return;
  setTextRow((uint8_t)(line[1] - '0'), line + 3);
}

void processLine(char *line) {
  if (!line[0]) return;

  switch (line[0]) {
    case 'T':
      handleTextCommand(line);
      break;
    case 'N':
      setBigNum(line + 1);
      break;
    case 'C':
      if (line[1] == '\0') clearDisplay();
      break;
    case '?':
      if (line[1] == '\0') printCapabilities();
      break;
    default:
      break;
  }
}

void readSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    if (c == '\r' || c == '\n') {
      if (!lineOverflow && lineLen > 0) {
        lineBuf[lineLen] = '\0';
        processLine(lineBuf);
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

void setup() {
  Serial.begin(115200);
  u8g2.begin();

  for (uint8_t row = 0; row < OLED_ROWS; row++) {
    textLines[row][0] = '\0';
  }
  bigNum[0] = '\0';

  showSplash();
  Serial.println(F("K:screen=oled"));
}

void loop() {
  readSerial();
}
