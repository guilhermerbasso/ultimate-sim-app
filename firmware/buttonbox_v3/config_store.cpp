#include "config_store.h"
#include <EEPROM.h>
#include <string.h>

// Event names — order MUST match the enum in config_store.h and protocol §4.2.
static const char* const EVENT_NAMES[BB_NUM_EVENTS] = {
  "e1cw", "e1ccw", "e2cw", "e2ccw", "e3cw", "e3ccw",
  "e4cw", "e4ccw", "e5cw", "e5ccw", "e6cw", "e6ccw",
  "sw1",  "sw2",   "sw3",  "sw4",   "sw5",  "sw6"
};

const char* eventName(uint8_t idx) {
  return (idx < BB_NUM_EVENTS) ? EVENT_NAMES[idx] : "";
}

int eventIndexByName(const char* name) {
  for (uint8_t i = 0; i < BB_NUM_EVENTS; i++) {
    if (strcmp(name, EVENT_NAMES[i]) == 0) return (int)i;
  }
  return -1;
}

void configDefaults(Config& c) {
  for (uint8_t i = 0; i < BB_NUM_EVENTS; i++) c.map[i] = i;  // identity 0..17
  c.pulseMs    = 80;
  c.debounceMs = 50;
  c.encMode    = ENC_PULSE;
}

// ─── EEPROM layout (see docs/serial-protocol.md §6) ──────────────────────────
#define EE_MAGIC0     0xB0
#define EE_MAGIC1     0x18
#define EE_A_MAGIC0   0
#define EE_A_MAGIC1   1
#define EE_A_VER      2
#define EE_A_MAP      3    // 18 bytes (one per event)
#define EE_A_PULSE    21
#define EE_A_DEBOUNCE 22
#define EE_A_ENCMODE  23
#define EE_A_CHECKSUM 24

// XOR of bytes 2..23 (version + map + pulse + debounce + encmode).
static uint8_t calcChecksum(const Config& c) {
  uint8_t x = BB_SCHEMA_VERSION;
  for (uint8_t i = 0; i < BB_NUM_EVENTS; i++) x ^= c.map[i];
  x ^= c.pulseMs;
  x ^= c.debounceMs;
  x ^= c.encMode;
  return x;
}

void configSave(const Config& c) {
  EEPROM.update(EE_A_MAGIC0, EE_MAGIC0);
  EEPROM.update(EE_A_MAGIC1, EE_MAGIC1);
  EEPROM.update(EE_A_VER,    BB_SCHEMA_VERSION);
  for (uint8_t i = 0; i < BB_NUM_EVENTS; i++) EEPROM.update(EE_A_MAP + i, c.map[i]);
  EEPROM.update(EE_A_PULSE,    c.pulseMs);
  EEPROM.update(EE_A_DEBOUNCE, c.debounceMs);
  EEPROM.update(EE_A_ENCMODE,  c.encMode);
  EEPROM.update(EE_A_CHECKSUM, calcChecksum(c));
}

void configLoad(Config& c) {
  // Reject if magic/version don't match this schema.
  if (EEPROM.read(EE_A_MAGIC0) != EE_MAGIC0 ||
      EEPROM.read(EE_A_MAGIC1) != EE_MAGIC1 ||
      EEPROM.read(EE_A_VER)    != BB_SCHEMA_VERSION) {
    configDefaults(c);
    configSave(c);
    return;
  }

  for (uint8_t i = 0; i < BB_NUM_EVENTS; i++) c.map[i] = EEPROM.read(EE_A_MAP + i);
  c.pulseMs    = EEPROM.read(EE_A_PULSE);
  c.debounceMs = EEPROM.read(EE_A_DEBOUNCE);
  c.encMode    = EEPROM.read(EE_A_ENCMODE);

  // Integrity: checksum + value sanity. On any failure, reset to defaults.
  bool ok = (EEPROM.read(EE_A_CHECKSUM) == calcChecksum(c));
  for (uint8_t i = 0; i < BB_NUM_EVENTS && ok; i++) {
    if (c.map[i] >= 18) ok = false;
  }
  if (ok && (c.pulseMs    < BB_PULSE_MIN    || c.pulseMs    > BB_PULSE_MAX))    ok = false;
  if (ok && (c.debounceMs < BB_DEBOUNCE_MIN || c.debounceMs > BB_DEBOUNCE_MAX)) ok = false;
  if (ok && c.encMode > ENC_HOLD) ok = false;
  if (!ok) {
    configDefaults(c);
    configSave(c);
  }
}
