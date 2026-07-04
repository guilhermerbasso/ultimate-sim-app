/*
  Ultimate ButtonBox Companion Controls
  Target: ATmega32U4 boards only (SparkFun Pro Micro / Arduino Leonardo)
  HID: Matthew Heironimus Joystick library

  Default map:
    Buttons 0-11: D2, D3, D4, D5, D6, D7, D8, D9, D10, D16, D14, D15
    Encoder 0: A0/A1 -> HID buttons 12 (CW) and 13 (CCW)
    Encoder 1: A2/A3 -> HID buttons 14 (CW) and 15 (CCW)
*/

#include <Joystick.h>

#if !defined(USBCON) || !(defined(__AVR_ATmega32U4__) || defined(ARDUINO_AVR_LEONARDO) || defined(ARDUINO_AVR_MICRO))
#error "companion_controls.ino supports ATmega32U4 USB boards only (Pro Micro/Leonardo)."
#endif

// ─── User-editable pinout ────────────────────────────────────────────────────
#define BUTTON_PINS {2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 14, 15}
#define DEBOUNCE_MS 5

#define ENABLE_ENCODERS 1
#define ENCODER0_PIN_A A0
#define ENCODER0_PIN_B A1
#define ENCODER1_PIN_A A2
#define ENCODER1_PIN_B A3
#define ENCODER_PULSE_MS 35
// Quadrature steps per physical detent (common EC11 = 4). Emit one pulse per detent.
#define ENCODER_STEPS_PER_DETENT 4

// ─── HID setup ────────────────────────────────────────────────────────────────
const uint8_t buttonPins[] = BUTTON_PINS;
const uint8_t directButtonCount = sizeof(buttonPins) / sizeof(buttonPins[0]);
const uint8_t encoderCount = ENABLE_ENCODERS ? 2 : 0;
const uint8_t totalButtonCount = directButtonCount + (encoderCount * 2);

Joystick_ JOYSTICK(
  JOYSTICK_DEFAULT_REPORT_ID,
  JOYSTICK_TYPE_GAMEPAD,
  totalButtonCount,
  0,
  false, false, false,
  false, false, false,
  false, false,
  false, false, false
);

struct ButtonState {
  bool stablePressed;
  bool lastRawPressed;
  unsigned long lastRawChangeMs;
};

struct EncoderState {
  uint8_t pinA;
  uint8_t pinB;
  uint8_t lastState;
  unsigned long releaseAtMs[2]; // [0] CW HID button, [1] CCW HID button
  int8_t accum;                 // accumulated quadrature steps toward a detent
};

ButtonState buttons[sizeof(buttonPins) / sizeof(buttonPins[0])];

#if ENABLE_ENCODERS
EncoderState encoders[2] = {
  {ENCODER0_PIN_A, ENCODER0_PIN_B, 0, {0, 0}, 0},
  {ENCODER1_PIN_A, ENCODER1_PIN_B, 0, {0, 0}, 0}
};
#endif

void printCapabilities() {
  Serial.println(F("K:control"));
  Serial.println(F("KEND"));
}

void processSerial() {
  while (Serial.available() > 0) {
    const char ch = (char)Serial.read();
    if (ch == '?') {
      printCapabilities();
    }
    // CR/LF and unknown bytes are intentionally ignored.
  }
}

uint8_t readEncoderState(uint8_t pinA, uint8_t pinB) {
  const uint8_t a = digitalRead(pinA) == HIGH ? 1 : 0;
  const uint8_t b = digitalRead(pinB) == HIGH ? 1 : 0;
  return (a << 1) | b;
}

void pulseEncoderButton(uint8_t encoderIndex, int8_t direction) {
  const bool clockwise = direction > 0;
  const uint8_t relativeButton = clockwise ? 0 : 1;
  const uint8_t hidButton = directButtonCount + (encoderIndex * 2) + relativeButton;

  JOYSTICK.setButton(hidButton, 1);
#if ENABLE_ENCODERS
  encoders[encoderIndex].releaseAtMs[relativeButton] = millis() + ENCODER_PULSE_MS;
#endif

  Serial.print(F("E"));
  Serial.print(encoderIndex);
  Serial.print(F(":"));
  Serial.println(clockwise ? F("+1") : F("-1"));
}

void updateButtons() {
  const unsigned long now = millis();

  for (uint8_t i = 0; i < directButtonCount; i++) {
    const bool rawPressed = digitalRead(buttonPins[i]) == LOW;

    if (rawPressed != buttons[i].lastRawPressed) {
      buttons[i].lastRawPressed = rawPressed;
      buttons[i].lastRawChangeMs = now;
    }

    if ((now - buttons[i].lastRawChangeMs) >= DEBOUNCE_MS && rawPressed != buttons[i].stablePressed) {
      buttons[i].stablePressed = rawPressed;
      JOYSTICK.setButton(i, rawPressed ? 1 : 0);

      Serial.print(F("B"));
      Serial.print(i);
      Serial.print(F(":"));
      Serial.println(rawPressed ? F("1") : F("0"));
    }
  }
}

void updateEncoders() {
#if ENABLE_ENCODERS
  const unsigned long now = millis();

  for (uint8_t i = 0; i < encoderCount; i++) {
    const uint8_t currentState = readEncoderState(encoders[i].pinA, encoders[i].pinB);
    const uint8_t transition = (encoders[i].lastState << 2) | currentState;
    int8_t direction = 0;

    if (transition == 0b1101 || transition == 0b0100 || transition == 0b0010 || transition == 0b1011) {
      direction = 1;
    } else if (transition == 0b1110 || transition == 0b0111 || transition == 0b0001 || transition == 0b1000) {
      direction = -1;
    }

    encoders[i].lastState = currentState;
    if (direction != 0) {
      // Accumulate quadrature steps; emit one pulse per full detent so a single
      // physical click = one button press (not 4 per EC11 detent).
      encoders[i].accum += direction;
      if (encoders[i].accum >= ENCODER_STEPS_PER_DETENT) {
        encoders[i].accum -= ENCODER_STEPS_PER_DETENT;
        pulseEncoderButton(i, 1);
      } else if (encoders[i].accum <= -ENCODER_STEPS_PER_DETENT) {
        encoders[i].accum += ENCODER_STEPS_PER_DETENT;
        pulseEncoderButton(i, -1);
      }
    }

    for (uint8_t b = 0; b < 2; b++) {
      const uint8_t hidButton = directButtonCount + (i * 2) + b;
      if (encoders[i].releaseAtMs[b] != 0 && (long)(now - encoders[i].releaseAtMs[b]) >= 0) {
        JOYSTICK.setButton(hidButton, 0);
        encoders[i].releaseAtMs[b] = 0;
      }
    }
  }
#endif
}

void setup() {
  Serial.begin(115200);

  for (uint8_t i = 0; i < directButtonCount; i++) {
    pinMode(buttonPins[i], INPUT_PULLUP);
    const bool pressed = digitalRead(buttonPins[i]) == LOW;
    buttons[i].stablePressed = pressed;
    buttons[i].lastRawPressed = pressed;
    buttons[i].lastRawChangeMs = millis();
  }

#if ENABLE_ENCODERS
  for (uint8_t i = 0; i < encoderCount; i++) {
    pinMode(encoders[i].pinA, INPUT_PULLUP);
    pinMode(encoders[i].pinB, INPUT_PULLUP);
    encoders[i].lastState = readEncoderState(encoders[i].pinA, encoders[i].pinB);
  }
#endif

  JOYSTICK.begin();

  for (uint8_t i = 0; i < directButtonCount; i++) {
    JOYSTICK.setButton(i, buttons[i].stablePressed ? 1 : 0);
  }

  printCapabilities();
}

void loop() {
  processSerial();
  updateButtons();
  updateEncoders();
}
