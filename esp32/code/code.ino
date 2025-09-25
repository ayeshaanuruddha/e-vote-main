#include <Arduino.h>
#include <HardwareSerial.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Adafruit_Fingerprint.h>

/* ============================ CONFIG ============================ */
// ---------- Wi-Fi ----------
const char* WIFI_SSID     = "Dialog 4G 175"; // Change Accordingly
const char* WIFI_PASSWORD = "eEafA9f3"; //Change Accordingly

// ---------- Backend ----------
const char* BASE_URL              = "http://192.168.8.106:8000"; //Base URL is to be changed according to IPV4 of Local Machine
const char* SCAN_BUFFER_ENDPOINT  = "/api/fingerprint/scan";       // POST {"fingerprint":"ID"}, DELETE to clear
const char* VERIFY_ENDPOINT       = "/api/fingerprint/verify";     // POST {"fingerprint":"ID"}
const char* CAST_MPC_ENDPOINT     = "/api/fingerprint/scan";          // POST {"fingerprint":"ID","vote_id":X,"party_id":Y}

// ---------- Station Mode ----------
enum RunMode : uint8_t { REGISTER_STATION = 0, VOTE_STATION = 1 };
RunMode RUN_MODE = VOTE_STATION;   // change to VOTE_STATION when using for voting

// Vote context (used only in VOTE_STATION)
const int VOTE_ID  = 1;
const int PARTY_ID = 1;

// ---------- Fingerprint Sensor on ESP32 UART2 (CROSS TX/RX) ----------
// Sensor TX -> ESP32 RX2, Sensor RX -> ESP32 TX2
// Choose pins you wired: (13,14) or (16,17) or (27,26). Keep baud 57600 unless you changed sensor’s baud.
static const int FP_RX_PIN = 27;      // ESP32 RX2  (sensor TX -> here)
static const int FP_TX_PIN = 26;      // ESP32 TX2  (sensor RX <- here)
static const uint32_t FP_BAUD = 57600;

// ---------- HTTP ----------
static const uint32_t HTTP_TIMEOUT_MS       = 8000;
static const int      HTTP_MAX_RETRIES      = 3;
static const uint32_t HTTP_RETRY_BACKOFF_MS = 300;

// ---------- Behavior tweaks ----------
static const uint32_t ENROLL_FIRST_TIMEOUT_MS  = 15000;  // wait up to 15s finger on #1
static const uint32_t ENROLL_SECOND_TIMEOUT_MS = 15000;  // wait up to 15s finger on #2
static const uint32_t COOLDOWN_OK_MS           = 1200;
static const uint32_t COOLDOWN_ERR_MS          = 700;

// ---------- Optional LED ----------
const int LED_PIN = 2; // -1 to disable

/* ============================ GLOBALS ============================ */
HardwareSerial FPSerial(2);
Adafruit_Fingerprint finger(&FPSerial);

bool wifiOK = false;
uint32_t lastConnectAttemptMs = 0;

struct HttpResult {
  bool ok;
  int status;
  String body;
};

/* ============================ HELPERS ============================ */
void ledBlink(int times, int onMs = 70, int offMs = 120) {
  if (LED_PIN < 0) return;
  for (int i = 0; i < times; ++i) {
    digitalWrite(LED_PIN, HIGH); delay(onMs);
    digitalWrite(LED_PIN, LOW);  delay(offMs);
  }
}

void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) { wifiOK = true; return; }
  wifiOK = false;

  if (millis() - lastConnectAttemptMs < 2000) return; // don’t spam
  lastConnectAttemptMs = millis();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - t0) < 15000) {
    delay(300);
  }
  wifiOK = (WiFi.status() == WL_CONNECTED);
  if (wifiOK) {
    Serial.print("📶 IP: "); Serial.println(WiFi.localIP());
  } else {
    Serial.println("⚠ Wi-Fi not connected yet.");
  }
}

HttpResult httpRequest(const String& url, const char* method, const String& body = String()) {
  HttpResult res{false, -1, ""};

  for (int attempt = 1; attempt <= HTTP_MAX_RETRIES; ++attempt) {
    ensureWiFi();
    if (WiFi.status() != WL_CONNECTED) { delay(HTTP_RETRY_BACKOFF_MS * attempt); continue; }

    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.setReuse(false); // be conservative on small APs

    Serial.printf("🌐 %s %s (attempt %d/%d)\n", method, url.c_str(), attempt, HTTP_MAX_RETRIES);

    if (!http.begin(url)) {
      Serial.println("❌ http.begin() failed");
      delay(HTTP_RETRY_BACKOFF_MS * attempt);
      continue;
    }

    int code = -1;
    if (strcmp(method, "GET") == 0) {
      code = http.GET();
    } else if (strcmp(method, "DELETE") == 0) {
      code = http.sendRequest("DELETE");
    } else {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Connection", "close");
      code = http.sendRequest(method, (uint8_t*)body.c_str(), body.length());
    }

    res.status = code;
    res.body   = http.getString();
    http.end();

    if (code > 0) {
      res.ok = true;
      Serial.printf("✅ HTTP %d\n", code);
      return res;
    } else {
      Serial.printf("❌ HTTP error: %d\n", code);
      delay(HTTP_RETRY_BACKOFF_MS * attempt);
    }
  }
  return res;
}

/* ---------- Backend calls ---------- */
bool apiPublishScan(uint16_t fpId, String& errOut) {
  errOut = "";
  const String url = String(BASE_URL) + SCAN_BUFFER_ENDPOINT;
  // send as STRING to avoid 422
  const String payload = String("{\"fingerprint\":\"") + String(fpId) + String("\"}");

  HttpResult r = httpRequest(url, "POST", payload);
  if (!r.ok)                 { errOut = "net_error"; return false; }
  if (r.status != 200 && r.status != 201) { errOut = String("http_") + String(r.status); return false; }
  return true;
}

void apiClearScanBuffer() {
  const String url = String(BASE_URL) + SCAN_BUFFER_ENDPOINT;
  (void)httpRequest(url, "DELETE");
}

bool apiVerify(String fpStr /* always string */, String& nameOut, String& nicOut, String& errOut) {
  nameOut = ""; nicOut = ""; errOut = "";
  const String url = String(BASE_URL) + VERIFY_ENDPOINT;
  const String payload = String("{\"fingerprint\":\"") + fpStr + String("\"}");

  HttpResult r = httpRequest(url, "POST", payload);
  if (!r.ok)                 { errOut = "net_error"; return false; }
  if (r.status != 200)       { errOut = String("http_") + String(r.status); return false; }

  // Tiny tolerant parse (avoid ArduinoJson). We just look for keys.
  if (r.body.indexOf("\"status\":\"success\"") >= 0) {
    // naive extracts (works with your backend shape)
    int p1 = r.body.indexOf("\"full_name\"");
    int p2 = r.body.indexOf("\"nic\"");
    if (p1 >= 0) {
      int q = r.body.indexOf(':', p1); int s = r.body.indexOf('"', q+1); int e = r.body.indexOf('"', s+1);
      if (q>=0 && s>=0 && e>s) nameOut = r.body.substring(s+1, e);
    }
    if (p2 >= 0) {
      int q = r.body.indexOf(':', p2); int s = r.body.indexOf('"', q+1); int e = r.body.indexOf('"', s+1);
      if (q>=0 && s>=0 && e>s) nicOut = r.body.substring(s+1, e);
    }
    return true;
  }
  errOut = "verify_fail";
  return false;
}

bool apiCastMPC(String fpStr, int voteId, int partyId, String& errOut) {
  errOut = "";
  const String url = String(BASE_URL) + CAST_MPC_ENDPOINT;
  String payload = String("{\"fingerprint\":\"") + fpStr + String("\",\"vote_id\":") +
                   String(voteId) + String(",\"party_id\":") + String(partyId) + String("}");

  HttpResult r = httpRequest(url, "POST", payload);
  if (!r.ok)           { errOut = "net_error"; return false; }
  if (r.status == 409) { errOut = "already_voted"; return false; }
  if (r.status != 200) { errOut = String("http_") + String(r.status); return false; }
  return true;
}

/* ---------- Fingerprint helpers ---------- */
void waitNoFinger(uint32_t timeoutMs = 3000) {
  uint32_t t0 = millis();
  while (finger.getImage() != FINGERPRINT_NOFINGER) {
    if (millis() - t0 > timeoutMs) break;
    delay(50);
  }
}

bool captureToBuffer(uint8_t slot, uint32_t timeoutMs) {
  uint8_t r;
  uint32_t t0 = millis();
  while (true) {
    r = finger.getImage();
    if (r == FINGERPRINT_OK) break;
    if (r != FINGERPRINT_NOFINGER && r != FINGERPRINT_IMAGEFAIL) {
      Serial.printf("⚠ getImage err=0x%02X\n", r);
    }
    if (millis() - t0 > timeoutMs) return false;
    delay(60);
  }
  r = finger.image2Tz(slot);
  if (r != FINGERPRINT_OK) {
    Serial.printf("⚠ image2Tz(%d) err=0x%02X\n", slot, r);
    return false;
  }
  return true;
}

int16_t nextIdFromCount() {
  if (finger.getTemplateCount() != FINGERPRINT_OK) return -1;
  int16_t n = finger.templateCount;
  if (n < 0) n = 0;
  return n + 1;
}

bool enrollNewFinger(uint16_t &newIdOut) {
  newIdOut = 0;

  Serial.println("▶ Scan #1 …");
  if (!captureToBuffer(1, ENROLL_FIRST_TIMEOUT_MS)) {
    Serial.println("⏱ timeout on scan #1");
    return false;
  }
  Serial.println("↗ Remove finger…");
  waitNoFinger();

  Serial.println("▶ Scan #2 (same finger) …");
  if (!captureToBuffer(2, ENROLL_SECOND_TIMEOUT_MS)) {
    Serial.println("⏱ timeout on scan #2");
    return false;
  }

  uint8_t p = finger.createModel();
  if (p != FINGERPRINT_OK) {
    Serial.printf("❌ createModel err=0x%02X (images mismatch?)\n", p);
    return false;
  }

  int16_t id = nextIdFromCount();
  if (id < 1) { Serial.println("❌ no free slot"); return false; }

  for (int tries = 0; tries < 5; ++tries, ++id) {
    p = finger.storeModel(id);
    if (p == FINGERPRINT_OK) {
      newIdOut = (uint16_t)id;
      return true;
    }
    Serial.printf("⚠ storeModel(%d) err=0x%02X, trying next…\n", id, p);
  }
  return false;
}

bool matchOnce(uint16_t &matchedId, uint16_t &conf) {
  matchedId = 0; conf = 0;

  uint8_t p = finger.getImage();
  if (p != FINGERPRINT_OK) {
    if (p != FINGERPRINT_NOFINGER) Serial.printf("⚠ getImage err=0x%02X\n", p);
    return false;
  }

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) { Serial.printf("⚠ image2Tz err=0x%02X\n", p); return false; }

  p = finger.fingerFastSearch();
  if (p != FINGERPRINT_OK) {
    if (p == FINGERPRINT_NOTFOUND) Serial.println("❌ finger not found in library");
    else Serial.printf("⚠ fingerFastSearch err=0x%02X\n", p);
    return false;
  }

  matchedId = finger.fingerID;
  conf      = finger.confidence;
  return true;
}

/* ============================ SETUP / LOOP ============================ */
void setup() {
  Serial.begin(115200);
  delay(250);

  if (LED_PIN >= 0) { pinMode(LED_PIN, OUTPUT); digitalWrite(LED_PIN, LOW); }

  // Fingerprint UART2
  FPSerial.begin(FP_BAUD, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
  finger.begin(FP_BAUD);

  Serial.println();
  Serial.println("====================================");
  Serial.println("   ESP32 Fingerprint Station");
  Serial.print  ("   Mode: "); Serial.println(RUN_MODE == REGISTER_STATION ? "REGISTER_STATION" : "VOTE_STATION");
  Serial.print  ("   UART2 RX="); Serial.print(FP_RX_PIN);
  Serial.print  (" TX="); Serial.println(FP_TX_PIN);
  Serial.println("====================================");

  if (!finger.verifyPassword()) {
    Serial.println("❌ Sensor NOT detected. Check power + CROSS TX/RX + baud 57600.");
    while (true) { ledBlink(1, 60, 240); delay(280); }
  }

  if (finger.getParameters() == FINGERPRINT_OK) {
    (void)finger.getTemplateCount();
    Serial.printf("✅ Sensor OK. Capacity=%d, Used=%d\n", finger.capacity, finger.templateCount);
  }

  ensureWiFi();
  if (wifiOK) {
    if (RUN_MODE == REGISTER_STATION) {
      // Clear buffer at boot for fresh scans
      apiClearScanBuffer();
    }
  }
}

void loop() {
  ensureWiFi();
  if (!wifiOK) { delay(300); return; }

  if (RUN_MODE == REGISTER_STATION) {
    Serial.println("🧩 Place finger to ENROLL (two scans)...");
    uint16_t newId = 0;

    if (!enrollNewFinger(newId)) {
      Serial.println("❌ Enrollment failed.\n");
      ledBlink(1); delay(COOLDOWN_ERR_MS);
      return;
    }

    Serial.printf("✅ Enrolled at ID=%u\n", newId);
    Serial.printf("📤 Publishing ID=%u to %s …\n", newId, SCAN_BUFFER_ENDPOINT);

    String err;
    if (apiPublishScan(newId, err)) {
      Serial.println("✅ Published. Finish the form on the web UI.\n");
      ledBlink(3); delay(COOLDOWN_OK_MS);
    } else {
      Serial.printf("❌ Publish failed: %s\n\n", err.c_str());
      ledBlink(1); delay(COOLDOWN_ERR_MS);
    }
    return;
  }

  // ----- VOTE_STATION -----
  Serial.println("🖐 Place finger to VOTE…");
  uint16_t fid = 0, conf = 0;
  if (!matchOnce(fid, conf)) { delay(150); return; }
  Serial.printf("✅ Match: ID=%u (conf=%u)\n", fid, conf);

  String name, nic, err;
  if (!apiVerify(String(fid), name, nic, err)) {
    Serial.printf("❌ Verify failed: %s\n", err.c_str());
    ledBlink(1); delay(COOLDOWN_ERR_MS);
    return;
  }

  Serial.printf("👤 %s | 🪪 %s\n", name.c_str(), nic.c_str());
  Serial.printf("🗳 Casting vote (vote_id=%d, party_id=%d)…\n", VOTE_ID, PARTY_ID);

  if (apiCastMPC(String(fid), VOTE_ID, PARTY_ID, err)) {
    Serial.println("✅ Vote recorded.\n");
    ledBlink(3); delay(COOLDOWN_OK_MS);
  } else {
    Serial.printf("❌ Vote failed: %s\n\n", err.c_str());
    ledBlink(1); delay(COOLDOWN_ERR_MS);
  }
}
