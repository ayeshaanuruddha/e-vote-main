#include <Adafruit_Fingerprint.h>
#include <HardwareSerial.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

/* =========================================
 *            CONFIGURATION
 * ========================================= */

// ---------- Wi-Fi ----------
const char* WIFI_SSID     = "Menuka";
const char* WIFI_PASSWORD = "menuka123";

// ---------- Backend ----------
const char* BASE_URL              = "http://192.168.9.88:8000";
const char* VERIFY_ENDPOINT       = "/api/fingerprint/verify";
const char* CAST_MPC_ENDPOINT     = "/api/vote/cast_mpc";
const char* SCAN_BUFFER_ENDPOINT  = "/api/fingerprint/scan"; // polled by web UI

// ---------- Mode ----------
enum RunMode : uint8_t { REGISTER_STATION = 0, VOTE_STATION = 1 };
RunMode RUN_MODE = REGISTER_STATION;   // <— set default here

// Optional: hold this pin LOW at boot to toggle mode
const int MODE_BUTTON_PIN = -1; // e.g. 0 or 12; -1 to disable

// ---------- Vote Context (used in VOTE_STATION) ----------
const int   VOTE_ID  = 1;
const int   PARTY_ID = 1; // station-specific selection

// ---------- Fingerprint Sensor (ESP32 UART2) ----------
static const int FP_RX_PIN = 13;   // Sensor TX -> ESP32 RX
static const int FP_TX_PIN = 14;   // Sensor RX -> ESP32 TX
static const uint32_t FP_BAUD = 57600;

// ---------- HTTP Settings ----------
static const uint32_t HTTP_TIMEOUT_MS       = 8000;
static const int      HTTP_MAX_RETRIES      = 3;
static const uint32_t HTTP_RETRY_BACKOFF_MS = 250; // base backoff (exponential)

// ---------- Behavior ----------
static const uint32_t COOLDOWN_MS_AFTER_SUCCESS = 1200;
static const uint32_t COOLDOWN_MS_AFTER_ERROR   = 600;

// ---------- LED (optional) ----------
const int LED_PIN = 2;  // Onboard LED; set -1 to disable

/* =========================================
 *                GLOBALS
 * ========================================= */

HardwareSerial FPSerial(2);
Adafruit_Fingerprint finger(&FPSerial);

uint32_t lastConnectAttempt = 0;
bool wifiOK = false;

/* =========================================
 *               WIFI HELPERS
 * ========================================= */

void wifiStatusLog(wl_status_t s) {
  switch (s) {
    case WL_IDLE_STATUS:       Serial.println("WiFi: IDLE"); break;
    case WL_NO_SSID_AVAIL:     Serial.println("WiFi: SSID UNAVAILABLE"); break;
    case WL_SCAN_COMPLETED:    Serial.println("WiFi: SCAN COMPLETE"); break;
    case WL_CONNECTED:         Serial.println("WiFi: CONNECTED"); break;
    case WL_CONNECT_FAILED:    Serial.println("WiFi: CONNECT FAILED"); break;
    case WL_CONNECTION_LOST:   Serial.println("WiFi: CONNECTION LOST"); break;
    case WL_DISCONNECTED:      Serial.println("WiFi: DISCONNECTED"); break;
    default:                   Serial.printf("WiFi: STATUS %d\n", (int)s);
  }
}

void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) { wifiOK = true; return; }
  wifiOK = false;

  if (millis() - lastConnectAttempt < 2000) return;
  lastConnectAttempt = millis();

  Serial.printf("🔌 Connecting Wi-Fi: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  wifiStatusLog(WiFi.status());

  if (WiFi.status() == WL_CONNECTED) {
    wifiOK = true;
    Serial.print("📶 IP: "); Serial.println(WiFi.localIP());
  } else {
    Serial.println("❌ Wi-Fi connect failed.");
  }
}

/* =========================================
 *               HTTP HELPERS
 * ========================================= */

struct HttpResult {
  bool ok;
  int status;
  String body;
};

HttpResult httpRequest(const String& url, const String& method, const String& body = String()) {
  HttpResult result{false, -1, ""};

  for (int attempt = 1; attempt <= HTTP_MAX_RETRIES; ++attempt) {
    if (WiFi.status() != WL_CONNECTED) ensureWiFi();
    if (WiFi.status() != WL_CONNECTED) { delay(200); continue; }

    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.setReuse(true);

    if (!http.begin(url)) {
      Serial.printf("❌ HTTP begin failed (attempt %d/%d)\n", attempt, HTTP_MAX_RETRIES);
      delay(HTTP_RETRY_BACKOFF_MS * attempt);
      continue;
    }

    int code = -1;
    if (method == "GET" || method == "DELETE") {
      code = (method == "GET") ? http.GET() : http.sendRequest("DELETE");
    } else {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Connection", "keep-alive");
      code = http.sendRequest(method.c_str(), (uint8_t*)body.c_str(), body.length());
    }

    String resp = http.getString();
    http.end();

    result.ok = (code > 0);
    result.status = code;
    result.body = resp;

    if (!result.ok) {
      Serial.printf("❌ HTTP %s error: %d (attempt %d/%d)\n", method.c_str(), code, attempt, HTTP_MAX_RETRIES);
      delay(HTTP_RETRY_BACKOFF_MS * attempt);
      continue;
    }
    return result;
  }
  return result;
}

HttpResult httpPostJson(const String& url, const String& jsonBody) {
  return httpRequest(url, "POST", jsonBody);
}

String buildJson(const JsonDocument& doc) {
  String out;
  serializeJson(doc, out);
  return out;
}

/* =========================================
 *              BACKEND CALLS
 * ========================================= */

bool apiVerifyFingerprint(uint16_t fpId, String& userNameOut, String& nicOut, String& errOut) {
  userNameOut = ""; nicOut = ""; errOut = "";

  StaticJsonDocument<128> doc;
  doc["fingerprint"] = fpId;
  const String url = String(BASE_URL) + VERIFY_ENDPOINT;

  HttpResult res = httpPostJson(url, buildJson(doc));
  Serial.printf("📡 Verify HTTP %d: %s\n", res.status, res.body.c_str());

  if (!res.ok || res.status != 200) { errOut = "verify_http_" + String(res.status); return false; }

  StaticJsonDocument<512> out;
  auto err = deserializeJson(out, res.body);
  if (err) { errOut = "verify_parse"; return false; }

  const char* statusStr = out["status"] | "";
  if (String(statusStr) != "success") { errOut = out["message"] | "verify_failed"; return false; }

  userNameOut = String(out["user"]["full_name"] | "");
  nicOut      = String(out["user"]["nic"] | "");
  return true;
}

bool apiCastVoteMPC(uint16_t fpId, int voteId, int partyId, String& errOut) {
  errOut = "";
  StaticJsonDocument<160> doc;
  doc["fingerprint"] = fpId;
  doc["vote_id"]     = voteId;
  doc["party_id"]    = partyId;

  const String url = String(BASE_URL) + CAST_MPC_ENDPOINT;
  HttpResult res = httpPostJson(url, buildJson(doc));
  Serial.printf("📡 Cast MPC HTTP %d: %s\n", res.status, res.body.c_str());

  if (!res.ok) { errOut = "cast_http_err"; return false; }
  if (res.status != 200) {
    if (res.status == 409) errOut = "already_voted";
    else if (res.status == 403) errOut = "not_open";
    else if (res.status == 404) errOut = "vote_or_party_missing";
    else errOut = "cast_http_" + String(res.status);
    return false;
  }

  // If server returned 200, accept it (payload tolerant)
  return true;
}

// Publish to the same buffer your web UI polls (registration/public vote pages)
bool apiPublishScan(uint16_t fpId, String& errOut) {
  errOut = "";
  StaticJsonDocument<128> doc;
  doc["fingerprint"] = fpId;

  const String url = String(BASE_URL) + SCAN_BUFFER_ENDPOINT;
  HttpResult res = httpPostJson(url, buildJson(doc));
  Serial.printf("📡 Publish Scan HTTP %d: %s\n", res.status, res.body.c_str());

  if (!res.ok)  { errOut = "scan_http_err"; return false; }
  if (res.status != 200) { errOut = "scan_http_" + String(res.status); return false; }
  return true;
}

void apiClearScanBuffer() {
  const String url = String(BASE_URL) + SCAN_BUFFER_ENDPOINT;
  HttpResult res = httpRequest(url, "DELETE");
  Serial.printf("🧹 Clear Buffer HTTP %d\n", res.status);
}

/* =========================================
 *           FINGERPRINT HELPERS
 * ========================================= */

void waitNoFinger() {
  // wait until finger is removed
  uint32_t guard = millis();
  while (finger.getImage() != FINGERPRINT_NOFINGER) {
    if (millis() - guard > 3000) break;
    delay(50);
  }
}

bool captureImageToBuffer(uint8_t slot /*1 or 2*/) {
  int p = -1;
  uint32_t start = millis();
  while ((p = finger.getImage()) != FINGERPRINT_OK) {
    if (p != FINGERPRINT_NOFINGER && p != FINGERPRINT_IMAGEFAIL) {
      Serial.printf("⚠️ getImage err: 0x%02X\n", p);
    }
    if (millis() - start > 10000) return false; // 10s timeout
    delay(50);
  }

  p = finger.image2Tz(slot);
  if (p != FINGERPRINT_OK) {
    Serial.printf("⚠️ image2Tz(%d) err: 0x%02X\n", slot, p);
    return false;
  }
  return true;
}

// Find next free template slot: prefer templateCount+1, then probe forward
int16_t findNextFreeId() {
  // fetch system params so templateCount/capacity are current
  finger.getParameters();      // ignore return; library fills fields when connected
  finger.getTemplateCount();   // fills finger.templateCount

  int16_t cap = finger.capacity ? finger.capacity : 200; // default fallback
  int16_t startId = finger.templateCount + 1;
  if (startId < 1) startId = 1;

  for (int16_t id = startId; id <= cap; ++id) {
    // loadModel OK => occupied; BADLOCATION => free; others => comm err (skip forward)
    uint8_t r = finger.loadModel(id);
    if (r == FINGERPRINT_OK) continue;                // already used
    if (r == FINGERPRINT_BADLOCATION) return id;      // free slot
    // Any other error, try next
  }

  // If we didn’t find one after templateCount+1..cap, try 1..startId-1 (wrap)
  for (int16_t id = 1; id < startId; ++id) {
    uint8_t r = finger.loadModel(id);
    if (r == FINGERPRINT_OK) continue;
    if (r == FINGERPRINT_BADLOCATION) return id;
  }
  return -1; // none
}

bool enrollNewFinger(uint16_t &newIdOut) {
  newIdOut = 0;

  Serial.println("🧩 ENROLL: Place finger (scan #1)...");
  if (!captureImageToBuffer(1)) { Serial.println("❌ Failed first capture."); return false; }

  Serial.println("↗️  Remove finger...");
  waitNoFinger();

  Serial.println("🧩 ENROLL: Place same finger again (scan #2)...");
  if (!captureImageToBuffer(2)) { Serial.println("❌ Failed second capture."); return false; }

  int p = finger.createModel();
  if (p != FINGERPRINT_OK) {
    Serial.printf("❌ createModel err: 0x%02X (images didn’t match?)\n", p);
    return false;
  }

  int16_t id = findNextFreeId();
  if (id < 1) {
    Serial.println("❌ No free template slots.");
    return false;
  }

  // Try storing, probe forward a bit if needed
  for (int tries = 0; tries < 5; ++tries) {
    p = finger.storeModel(id);
    if (p == FINGERPRINT_OK) {
      newIdOut = id;
      Serial.printf("✅ Enrolled at ID=%d\n", id);
      return true;
    }
    Serial.printf("⚠️ storeModel(%d) err: 0x%02X, trying next...\n", id, p);
    id++;
  }

  Serial.println("❌ Could not store template.");
  return false;
}

bool matchOnce(uint16_t &matchedId, uint16_t &conf) {
  matchedId = 0; conf = 0;

  int p = finger.getImage();
  if (p != FINGERPRINT_OK) {
    if (p != FINGERPRINT_NOFINGER) Serial.printf("⚠️ getImage err: 0x%02X\n", p);
    return false;
  }

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) {
    Serial.printf("⚠️ image2Tz err: 0x%02X\n", p);
    return false;
  }

  p = finger.fingerFastSearch();
  if (p != FINGERPRINT_OK) {
    if (p == FINGERPRINT_NOTFOUND) Serial.println("❌ Finger not found in sensor.");
    else Serial.printf("⚠️ fingerFastSearch err: 0x%02X\n", p);
    return false;
  }

  matchedId = finger.fingerID;
  conf = finger.confidence;
  return true;
}

/* =========================================
 *                 SETUP
 * ========================================= */

void ledInit() {
  if (LED_PIN >= 0) { pinMode(LED_PIN, OUTPUT); digitalWrite(LED_PIN, LOW); }
}

void ledBlink(int times, int onMs = 60, int offMs = 60) {
  if (LED_PIN < 0) return;
  for (int i = 0; i < times; ++i) {
    digitalWrite(LED_PIN, HIGH); delay(onMs);
    digitalWrite(LED_PIN, LOW);  delay(offMs);
  }
}

void maybeToggleModeAtBoot() {
  if (MODE_BUTTON_PIN < 0) return;
  pinMode(MODE_BUTTON_PIN, INPUT_PULLUP);
  delay(10);
  if (digitalRead(MODE_BUTTON_PIN) == LOW) {
    RUN_MODE = (RUN_MODE == REGISTER_STATION) ? VOTE_STATION : REGISTER_STATION;
    Serial.printf("🔁 Mode toggled. Now: %s\n", RUN_MODE == REGISTER_STATION ? "REGISTER_STATION" : "VOTE_STATION");
    delay(500);
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);

  ledInit();
  maybeToggleModeAtBoot();

  // Fingerprint UART2
  FPSerial.begin(FP_BAUD, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
  finger.begin(FP_BAUD);

  Serial.println();
  Serial.println("====================================");
  Serial.println("   ESP32 Fingerprint Station");
  Serial.print  ("   Mode: "); Serial.println(RUN_MODE == REGISTER_STATION ? "REGISTER_STATION" : "VOTE_STATION");
  Serial.print  ("   Verify: "); Serial.println(VERIFY_ENDPOINT);
  Serial.print  ("   Cast:   "); Serial.println(CAST_MPC_ENDPOINT);
  Serial.print  ("   Buffer: "); Serial.println(SCAN_BUFFER_ENDPOINT);
  Serial.println("====================================");

  if (finger.verifyPassword()) {
    Serial.println("✅ Fingerprint sensor detected.");
    finger.getParameters();
    finger.getTemplateCount();
    Serial.printf("   Capacity: %d, Used: %d\n", finger.capacity, finger.templateCount);
  } else {
    Serial.println("❌ Fingerprint sensor NOT found. Check wiring & baud.");
    while (true) { ledBlink(1, 50, 250); }
  }

  ensureWiFi();
  if (wifiOK) {
    Serial.println("📘 Ready.");
    if (RUN_MODE == VOTE_STATION) {
      Serial.printf("🗳  Vote ID = %d | Party ID = %d\n", VOTE_ID, PARTY_ID);
    } else {
      // Clear buffer so the web page won’t pick an old ID
      apiClearScanBuffer();
    }
  }
}

/* =========================================
 *                 LOOP
 * ========================================= */

void loop() {
  ensureWiFi();
  if (!wifiOK) { delay(300); return; }

  if (RUN_MODE == REGISTER_STATION) {
    Serial.println("🧩 Registration: place finger to ENROLL.");
    uint16_t newId = 0;
    if (!enrollNewFinger(newId)) {
      Serial.println("❌ Enrollment failed.\n");
      ledBlink(1, 30, 200);
      delay(COOLDOWN_MS_AFTER_ERROR);
      return;
    }

    Serial.printf("📤 Publishing new ID=%u to buffer…\n", newId);
    String err;
    if (apiPublishScan(newId, err)) {
      Serial.println("✅ ID published. Proceed with web registration form.\n");
      ledBlink(3, 50, 80);
      delay(COOLDOWN_MS_AFTER_SUCCESS);
    } else {
      Serial.printf("❌ Publish failed: %s\n\n", err.c_str());
      ledBlink(1, 30, 200);
      delay(COOLDOWN_MS_AFTER_ERROR);
    }
    return;
  }

  // ---- VOTE_STATION ----
  Serial.println("🖐 Place finger to VOTE…");
  uint16_t fid = 0, conf = 0;
  if (!matchOnce(fid, conf)) { delay(150); return; }
  Serial.printf("✅ Match: ID=%u (conf=%u)\n", fid, conf);

  // Verify the user exists, then cast the vote
  String name, nic, err;
  if (!apiVerifyFingerprint(fid, name, nic, err)) {
    Serial.printf("❌ Verify failed: %s\n", err.c_str());
    ledBlink(1, 30, 200);
    delay(COOLDOWN_MS_AFTER_ERROR);
    return;
  }

  Serial.printf("👤 %s | 🪪 %s\n", name.c_str(), nic.c_str());
  Serial.printf("🗳  Casting vote (vote_id=%d, party_id=%d)…\n", VOTE_ID, PARTY_ID);
  if (apiCastVoteMPC(fid, VOTE_ID, PARTY_ID, err)) {
    Serial.println("✅ Vote recorded.\n");
    ledBlink(3, 50, 80);
    delay(COOLDOWN_MS_AFTER_SUCCESS);
  } else {
    Serial.printf("❌ Vote failed: %s\n\n", err.c_str());
    ledBlink(1, 30, 200);
    delay(COOLDOWN_MS_AFTER_ERROR);
  }
}
