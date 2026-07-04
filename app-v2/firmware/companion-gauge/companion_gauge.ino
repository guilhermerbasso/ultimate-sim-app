// Ultimate ButtonBox — Companion firmware: analog gauges (servo)
// ---------------------------------------------------------------------------
// Drives up to four hobby servos as analog gauges using the app's companion v2
// serial protocol.
//
// Serial: 115200 8N1, newline-terminated lines. Commands (App -> device):
//   G<idx>:<angle>  set gauge/servo idx 0..3 to angle degrees; clamps to 0..180
//   C               return attached servos to CLEAR_ANGLE
//   ?               reply capabilities: "K:gauge=4" then "KEND"
//
// Reports "K:gauge=4" once on boot so the app can auto-detect it.
// Wiring: servo signal -> D3/D5/D6/D9, servo V+ -> 5V or external 5V,
// common GND between Arduino and servo power.

#include <Servo.h>

#define SERVO_COUNT 4
#define LINE_BUF_SIZE 64
#define CLEAR_ANGLE 0

const uint8_t SERVO_PINS[SERVO_COUNT] = {3, 5, 6, 9};

Servo servos[SERVO_COUNT];
bool servoAttached[SERVO_COUNT] = {false, false, false, false};
char lineBuf[LINE_BUF_SIZE];
uint8_t lineLen = 0;
bool lineOverflow = false;

static int clampAngle(long angle) {
  if (angle < 0) return 0;
  if (angle > 180) return 180;
  return (int)angle;
}

static void attachServoIfNeeded(uint8_t idx) {
  if (idx >= SERVO_COUNT || servoAttached[idx]) return;
  servos[idx].attach(SERVO_PINS[idx]);
  servoAttached[idx] = true;
}

static void showCapabilities() {
  Serial.println(F("K:gauge=4"));
  Serial.println(F("KEND"));
}

// G<idx>:<angle>
static void handleGauge(char *payload) {
  char *colon = strchr(payload, ':');
  if (!colon) return;

  char *idxEnd = NULL;
  long idx = strtol(payload, &idxEnd, 10);
  if (idxEnd != colon || idx < 0 || idx >= SERVO_COUNT) return;

  char *angleEnd = NULL;
  long angle = strtol(colon + 1, &angleEnd, 10);
  if (angleEnd == colon + 1 || *angleEnd != '\0') return;

  attachServoIfNeeded((uint8_t)idx);
  servos[idx].write(clampAngle(angle));
}

static void clearGauges() {
  for (uint8_t i = 0; i < SERVO_COUNT; i++) {
    if (servoAttached[i]) servos[i].write(CLEAR_ANGLE);
  }
}

static void handleLine(char *line, uint8_t len) {
  if (len == 0) return;
  switch (line[0]) {
    case 'G': handleGauge(line + 1); break;
    case 'C': if (len == 1) clearGauges(); break;
    case '?': if (len == 1) showCapabilities(); break;
    default: break;
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

void setup() {
  Serial.begin(115200);
  showCapabilities();
}

void loop() {
  pumpSerial();
}
