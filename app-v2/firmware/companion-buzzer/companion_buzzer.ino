// Ultimate ButtonBox — Companion firmware: piezo buzzer (audio alerts)
// ---------------------------------------------------------------------------
// Simple non-blocking buzzer driver for the app's "companion v2" serial
// protocol. Uses Arduino's built-in tone()/noTone().
//
// Serial: 115200 8N1, newline-terminated lines. Commands (App -> device):
//   Z<freq>:<ms>   play freq Hz for ms milliseconds; 0 freq or 0 ms = silence
//   C              clear/silence
//   ?              reply capabilities: "K:buzzer" then "KEND"
//
// Reports "K:buzzer" once on boot so the app can auto-detect it.
//
// Wiring: piezo + -> BUZZER_PIN (default D8), piezo - -> GND.

#define BUZZER_PIN 8
#define LINE_BUF_SIZE 64
#define MAX_FREQ_HZ 20000UL
#define MAX_DURATION_MS 60000UL

char lineBuf[LINE_BUF_SIZE];
uint8_t lineLen = 0;
bool lineOverflow = false;

bool toneActive = false;
unsigned long toneEndAt = 0;

static void stopTone() {
  noTone(BUZZER_PIN);
  toneActive = false;
  toneEndAt = 0;
}

static void startTone(unsigned long freqHz, unsigned long durationMs) {
  if (freqHz == 0 || durationMs == 0) {
    stopTone();
    return;
  }

  if (freqHz > MAX_FREQ_HZ) freqHz = MAX_FREQ_HZ;
  if (durationMs > MAX_DURATION_MS) durationMs = MAX_DURATION_MS;

  tone(BUZZER_PIN, (unsigned int)freqHz);
  toneActive = true;
  toneEndAt = millis() + durationMs;
}

static bool parseUnsigned(const char *start, const char *end, unsigned long maxValue, unsigned long &out) {
  if (start >= end) return false;

  unsigned long value = 0;
  for (const char *p = start; p < end; p++) {
    if (*p < '0' || *p > '9') return false;
    unsigned long digit = (unsigned long)(*p - '0');
    if (value > (maxValue - digit) / 10UL) {
      value = maxValue;
    } else {
      value = value * 10UL + digit;
    }
  }

  out = value;
  return true;
}

static void showCapabilities() {
  Serial.println(F("K:buzzer"));
  Serial.println(F("KEND"));
}

static void handleBuzzer(const char *payload) {
  const char *colon = strchr(payload, ':');
  if (!colon) return;

  unsigned long freqHz = 0;
  unsigned long durationMs = 0;
  if (!parseUnsigned(payload, colon, MAX_FREQ_HZ, freqHz)) return;
  if (!parseUnsigned(colon + 1, payload + strlen(payload), MAX_DURATION_MS, durationMs)) return;

  startTone(freqHz, durationMs);
}

static void handleLine(char *line, uint8_t len) {
  if (len == 0) return;

  switch (line[0]) {
    case 'Z':
      handleBuzzer(line + 1);
      break;
    case 'C':
      stopTone();
      break;
    case '?':
      showCapabilities();
      break;
    default:
      break;
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
        lineOverflow = true;
      }
    }
  }
}

static void updateToneTimeout() {
  if (toneActive && (long)(millis() - toneEndAt) >= 0) {
    stopTone();
  }
}

void setup() {
  pinMode(BUZZER_PIN, OUTPUT);
  stopTone();

  Serial.begin(115200);
  showCapabilities();
  startTone(1800, 45);
}

void loop() {
  pumpSerial();
  updateToneTimeout();
}
