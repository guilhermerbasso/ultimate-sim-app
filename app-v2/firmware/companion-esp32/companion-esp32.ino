// Ultimate ButtonBox ESP32 companion firmware.
// Supports the same line-framed companion protocol over USB serial and TCP/Wi-Fi.
// Provision Wi-Fi over USB with: WIFI:<base64-ssid>:<base64-password>

#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <ESPmDNS.h>

static const uint32_t BAUD = 115200;
static const uint16_t TCP_PORT = 47650;
static const char *MDNS_NAME = "ubb-esp32";
static const char *MDNS_SERVICE = "_ubbcompanion";
static const char *FW_VERSION = "esp32-phase3-1";

Preferences prefs;
WiFiServer server(TCP_PORT);
WiFiClient client;
String serialLine;
String wifiLine;
bool wifiReady = false;

void sendCapabilities(Print &out) {
  out.println("K:wifi=esp32 companion tcp usb");
#if CONFIG_IDF_TARGET_ESP32S3
  out.println("K:board=esp32-s3");
#else
  out.println("K:board=esp32");
#endif
  out.println("K:control=buttons encoders analog");
  out.println("K:rgbStrip=ws2812");
  out.println("K:rgbMatrix=8x8");
  out.println("K:screen=oled lcd");
  out.println("K:version=" + String(FW_VERSION));
  out.println("KEND");
}

String b64decode(const String &input) {
  const char *alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  String out;
  int val = 0;
  int valb = -8;
  for (size_t i = 0; i < input.length(); i++) {
    char c = input[i];
    if (c == '=') break;
    const char *p = strchr(alphabet, c);
    if (!p) continue;
    val = (val << 6) + int(p - alphabet);
    valb += 6;
    if (valb >= 0) {
      out += char((val >> valb) & 0xFF);
      valb -= 8;
    }
  }
  return out;
}

void provisionWifi(const String &line, Print &out) {
  int first = line.indexOf(':');
  int second = line.indexOf(':', first + 1);
  if (first < 0 || second < 0) {
    out.println("WERR:formato esperado WIFI:<ssid-base64>:<senha-base64>");
    return;
  }
  String ssid = b64decode(line.substring(first + 1, second));
  String pass = b64decode(line.substring(second + 1));
  if (ssid.length() == 0) {
    out.println("WERR:ssid vazio");
    return;
  }
  prefs.begin("ubb", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.end();
  out.println("WOK:credenciais salvas; reiniciando");
  delay(400);
  ESP.restart();
}

void handleCommand(const String &raw, Print &out) {
  String line = raw;
  line.trim();
  if (line.length() == 0) return;
  if (line == "?") {
    sendCapabilities(out);
    return;
  }
  if (line.startsWith("WIFI:")) {
    provisionWifi(line, out);
    return;
  }
  if (line == "C") {
    out.println("OK:C");
    return;
  }

  // Phase-3 transport skeleton: existing app engines can already send T/N/R/B/M/L.
  // Hardware-specific LED/display rendering can be added here without changing TCP/USB.
  char prefix = line[0];
  if (prefix == 'T' || prefix == 'N' || prefix == 'R' || prefix == 'B' || prefix == 'M' || prefix == 'L') {
    out.println("OK:" + line.substring(0, 1));
    return;
  }
  out.println("ERR:unknown");
}

void connectWifi() {
  prefs.begin("ubb", true);
  String ssid = prefs.getString("ssid", "");
  String pass = prefs.getString("pass", "");
  prefs.end();
  if (ssid.length() == 0) {
    Serial.println("WIFI:sem credenciais; provisione via USB");
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());
  Serial.print("WIFI:conectando ");
  Serial.println(ssid);
  uint32_t deadline = millis() + 15000;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WIFI:falha ao conectar");
    return;
  }

  wifiReady = true;
  server.begin();
  if (MDNS.begin(MDNS_NAME)) {
    MDNS.addService("ubbcompanion", "tcp", TCP_PORT);
    MDNS.addServiceTxt("ubbcompanion", "tcp", "id", String((uint32_t)ESP.getEfuseMac(), HEX));
    MDNS.addServiceTxt("ubbcompanion", "tcp", "fw", FW_VERSION);
#if CONFIG_IDF_TARGET_ESP32S3
    MDNS.addServiceTxt("ubbcompanion", "tcp", "board", "esp32s3");
#else
    MDNS.addServiceTxt("ubbcompanion", "tcp", "board", "esp32");
#endif
  }
  Serial.print("WIFI:pronto ");
  Serial.print(WiFi.localIP());
  Serial.print(':');
  Serial.println(TCP_PORT);
}

void pollSerial() {
  while (Serial.available()) {
    char c = char(Serial.read());
    if (c == '\n' || c == '\r') {
      handleCommand(serialLine, Serial);
      serialLine = "";
    } else if (serialLine.length() < 160) {
      serialLine += c;
    }
  }
}

void pollWifi() {
  if (!wifiReady) return;
  if ((!client || !client.connected()) && server.hasClient()) {
    if (client) client.stop();
    client = server.available();
    client.println("HELLO:ubb-esp32");
  }
  if (!client || !client.connected()) return;
  while (client.available()) {
    char c = char(client.read());
    if (c == '\n' || c == '\r') {
      handleCommand(wifiLine, client);
      wifiLine = "";
    } else if (wifiLine.length() < 160) {
      wifiLine += c;
    }
  }
}

void setup() {
  Serial.begin(BAUD);
  delay(400);
  Serial.println("Ultimate ButtonBox ESP32 Companion");
  connectWifi();
}

void loop() {
  pollSerial();
  pollWifi();
  delay(2);
}
