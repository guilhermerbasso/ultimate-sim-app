#pragma once
#include <Arduino.h>

// ════════════════════════════════════════════════════════════════════════════
//  Config store — persistent button mapping + tuning for ButtonBox v3
//  See docs/serial-protocol.md §3 (events) and §6 (EEPROM layout).
// ════════════════════════════════════════════════════════════════════════════

#define BB_NUM_EVENTS     18   // 12 encoder directions + 6 push buttons
#define BB_SCHEMA_VERSION 1    // EEPROM schema version

// Physical event indices. Order MUST match the protocol (§4.2) and the EEPROM
// layout. Encoder N (0-based) -> CW = N*2, CCW = N*2+1. Push N -> 12 + N.
enum {
  EV_E1CW = 0, EV_E1CCW, EV_E2CW, EV_E2CCW, EV_E3CW, EV_E3CCW,
  EV_E4CW,     EV_E4CCW, EV_E5CW, EV_E5CCW, EV_E6CW, EV_E6CCW,
  EV_SW1,      EV_SW2,   EV_SW3,  EV_SW4,   EV_SW5,  EV_SW6
};

enum EncMode { ENC_PULSE = 0, ENC_HOLD = 1 };

// Tuning limits (kept within 1 byte so they fit the EEPROM layout).
#define BB_PULSE_MIN     10
#define BB_PULSE_MAX     250
#define BB_DEBOUNCE_MIN  5
#define BB_DEBOUNCE_MAX  200

struct Config {
  uint8_t map[BB_NUM_EVENTS];  // 0-based HID button index (0..17) per event
  uint8_t pulseMs;             // encoder pulse length
  uint8_t debounceMs;          // push-button debounce
  uint8_t encMode;             // EncMode
};

// Fill c with factory defaults (identity map 0..17, pulse=80, debounce=50).
void configDefaults(Config& c);

// Load config from EEPROM into c. If the stored record is missing/invalid,
// factory defaults are written and returned.
void configLoad(Config& c);

// Persist c to EEPROM (uses EEPROM.update to limit wear).
void configSave(const Config& c);

// Event id <-> name helpers (names per protocol §4.2, e.g. "e1cw", "sw3").
const char* eventName(uint8_t idx);
int         eventIndexByName(const char* name);  // -1 if unknown
