// Companion LCD firmware for HD44780 character LCDs over I2C (PCF8574 backpack).
// Protocol: 115200 8N1, newline-terminated Ultimate ButtonBox companion frames.

#include <Wire.h>
#include <LiquidCrystal_I2C.h>

#define LCD_ADDR 0x27
#define LCD_COLS 20
#define LCD_ROWS 4

#define LINE_BUF_SIZE 120

LiquidCrystal_I2C lcd(LCD_ADDR, LCD_COLS, LCD_ROWS);

char lineBuf[LINE_BUF_SIZE];
uint8_t lineLen = 0;
bool lineOverflow = false;
char rowBuf[LCD_ROWS][LCD_COLS + 1];

bool isPrintableAscii(char c) {
  return c >= 0x20 && c < 0x7f;
}

void resetRowBuffer(uint8_t row) {
  for (uint8_t col = 0; col < LCD_COLS; col++) {
    rowBuf[row][col] = ' ';
  }
  rowBuf[row][LCD_COLS] = '\0';
}

void resetAllRows() {
  for (uint8_t row = 0; row < LCD_ROWS; row++) {
    resetRowBuffer(row);
  }
}

void printRow(uint8_t row) {
  lcd.setCursor(0, row);
  lcd.print(rowBuf[row]);
}

void printAllRows() {
  for (uint8_t row = 0; row < LCD_ROWS; row++) {
    printRow(row);
  }
}

void clearDisplay() {
  resetAllRows();
  lcd.clear();
}

void printCapabilities() {
  Serial.println(F("K:screen=lcd"));
  Serial.println(F("KEND"));
}

void writeTextRow(uint8_t row, const char *text) {
  resetRowBuffer(row);

  for (uint8_t col = 0; col < LCD_COLS && text[col]; col++) {
    rowBuf[row][col] = isPrintableAscii(text[col]) ? text[col] : ' ';
  }

  printRow(row);
}

void showCenteredTop(const char *text) {
  resetAllRows();

  uint8_t len = 0;
  while (text[len] && len < LCD_COLS) {
    len++;
  }

  uint8_t startCol = (LCD_COLS - len) / 2;
  for (uint8_t i = 0; i < len; i++) {
    rowBuf[0][startCol + i] = isPrintableAscii(text[i]) ? text[i] : ' ';
  }

  printAllRows();
}

bool parseRowNumber(const char *start, char **endPtr, uint8_t &row) {
  if (!start[0] || start[0] < '0' || start[0] > '9') return false;

  uint16_t value = 0;
  uint8_t i = 0;
  while (start[i] >= '0' && start[i] <= '9') {
    value = (value * 10) + (start[i] - '0');
    if (value >= LCD_ROWS) return false;
    i++;
  }

  row = (uint8_t)value;
  *endPtr = (char *)(start + i);
  return true;
}

void handleTextCommand(char *line) {
  char *pos = nullptr;
  uint8_t row = 0;
  if (!parseRowNumber(line + 1, &pos, row)) return;
  if (*pos != ':') return;

  writeTextRow(row, pos + 1);
}

void processLine(char *line) {
  if (!line[0]) return;

  switch (line[0]) {
    case 'T':
      handleTextCommand(line);
      break;
    case 'N':
      showCenteredTop(line + 1);
      break;
    case 'C':
      clearDisplay();
      break;
    case '?':
      printCapabilities();
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
      if (!lineOverflow) {
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

  lcd.init();
  lcd.backlight();
  clearDisplay();

  Serial.println(F("K:screen=lcd"));
}

void loop() {
  readSerial();
}
