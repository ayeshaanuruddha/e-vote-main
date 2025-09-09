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
const char* SCAN_BUFFER_ENDPOINT  = "/api/fingerprint/scan"; // polled by web UI (registration + public vote pages)

// ---------- Mode ----------
enum RunMode : uint8_t { MPC_STATION = 0, BRIDGE = 1 }; // BRIDGE works for registration (and any page that polls)
RunMode RUN_MODE = MPC_STATION;  // <- set to BRIDGE for registration station

// Optional: hardware mode toggle (press at boot to switch mode)
const int MODE_BUTTON_PIN = -1; // e.g. 0 or 12; keep -1 to disable

// ---------- Vote Context (used in MPC_STATION) ----------
const int   VOTE_ID  = 1;
const int   PARTY_ID = 1;

// ---------- Fingerprint Sensor (ESP32 UART2) ----------
static const int FP_RX_PIN = 13;  // Sensor TX -> ESP32 RX
static const int FP_TX_PIN = 14;  // Sensor RX -> ESP32 TX
static const uint32_t FP_BAUD = 57600;

// ---------- HTTP Settings ----------
static const uint32_t HTTP_TIMEOUT_MS       = 8000;
static const int      HTTP_MAX_RETRIES      = 3;
static const uint32_t HTTP_RETRY_BACKOFF_MS = 250; // base backoff (exponential)

// ---------- Scan Behavior ----------
static const uint32_t COOLDOWN_MS_AFTER_SUCCESS = 1200;
static const uint32_t COOLDOWN_MS_AFTER_ERROR   = 600;
static const uint32_t DEDUP_WINDOW_MS           = 2500; // ignore same finger within this window

// ---------- LED (optional) ----------
const int LED_PIN = 2;  // Onboard LED on many ESP32 modules; set to -1 to disable

/* =========================================
 *                GLOBALS
 * ========================================= */

HardwareSerial FPSerial(2);
Adafruit_Fingerprint finger(&FPSerial);

uint32_t lastConnectAttempt = 0;
bool wifiOK = false;

uint16_t lastFingerId = 0;
uint32_t lastFingerTime = 0;

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
  if (WiFi.status() == WL_CONNECTED) {
    wifiOK = true;
    return;
  }
  wifiOK = false;

  // Avoid hammering reconnects
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
  bool ok;        // we managed to talk to the server (got an HTTP code)
  int status;     // HTTP status code (200..)
  String body;    // response body
};

HttpResult httpRequest(const String& url, const String& method, const String& body = String()) {
  HttpResult result{false, -1, ""};

  for (int attempt = 1; attempt <= HTTP_MAX_RETRIES; ++attempt) {
    if (WiFi.status() != WL_CONNECTED) ensureWiFi();
    if (WiFi.status() != WL_CONNECTED) {
      delay(200);
      continue;
    }

    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.setReuse(true); // keep-alive where possible

    if (!http.begin(url)) {
      Serial.printf("❌ HTTP begin failed (attempt %d/%d)\n", attempt, HTTP_MAX_RETRIES);
      delay(HTTP_RETRY_BACKOFF_MS * attempt);
      continue;
    }

    int code = -1;
    if (method == "GET" || method == "DELETE") {
      code = (method == "GET") ? http.GET() : http.sendRequest("DELETE");
    } else { // POST/PUT
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

  if (!res.ok || res.status != 200) {
    errOut = "verify_http_" + String(res.status);
    return false;
  }

  StaticJsonDocument<512> out;
  auto err = deserializeJson(out, res.body);
  if (err) {
    errOut = "verify_parse";
    Serial.println("❌ JSON parse error (verify).");
    return false;
  }

  const char* statusStr = out["status"] | "";
  if (String(statusStr) != "success") {
    errOut = out["message"] | "verify_failed";
    return false;
  }

  userNameOut = String(out["user"]["full_name"] | "");
  nicOut      = String(out["user"]["nic"] | "");
  return true;
}

bool apiCastVoteMPC(uint16_t fpId, int voteId, int partyId, String& errOut) {
  errOut = "";

  StaticJsonDocument<160> doc;
  doc["fingerprint"] = fpId;
  doc["vote_id"] = voteId;
  doc["party_id"] = partyId;

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

  StaticJsonDocument<256> out;
  if (deserializeJson(out, res.body) == DeserializationError::Ok) {
    const char* s = out["status"] | "";
    if (String(s) == "success") return true;
  }
  // If server returned 200 but unexpected payload, accept as success
  return true;
}

// Push the scan so any web page that polls GET /api/fingerprint/scan can consume it (registration page, public vote page, etc.)
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

// Optional: clear buffer so the next scan is guaranteed fresh
void apiClearScanBuffer() {
  const String url = String(BASE_URL) + SCAN_BUFFER_ENDPOINT;
  HttpResult res = httpRequest(url, "DELETE");
  Serial.printf("🧹 Clear Buffer HTTP %d\n", res.status);
}

/* =========================================
 *           FINGERPRINT LOGIC
 * ========================================= */

bool captureAndMatchOnce(uint16_t& matchedId, uint16_t& conf) {
  matchedId = 0; conf = 0;

  int p = finger.getImage();
  if (p != FINGERPRINT_OK) {
    if (p != FINGERPRINT_NOFINGER) {
      Serial.printf("⚠️ getImage err: 0x%02X\n", p);
    }
    return false;
  }

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) {
    Serial.printf("⚠️ image2Tz err: 0x%02X\n", p);
    return false;
  }

  p = finger.fingerFastSearch();
  if (p != FINGERPRINT_OK) {
    if (p == FINGERPRINT_NOTFOUND) {
      Serial.println("❌ Finger not found in sensor library.");
    } else {
      Serial.printf("⚠️ fingerFastSearch err: 0x%02X\n", p);
    }
    return false;
  }

  matchedId = finger.fingerID;
  conf = finger.confidence;
  return true;
}

bool dedupFinger(uint16_t id) {
  const uint32_t now = millis();
  if (id == lastFingerId && (now - lastFingerTime) < DEDUP_WINDOW_MS) {
    return true; // duplicate within window
  }
  lastFingerId = id;
  lastFingerTime = now;
  return false;
}

/* =========================================
 *                 SETUP
 * ========================================= */

void ledInit() {
  if (LED_PIN >= 0) {
    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, LOW);
  }
}

void ledBlink(int times, int onMs = 60, int offMs = 60) {
  if (LED_PIN < 0) return;
  for (int i = 0; i < times; ++i) {
    digitalWrite(LED_PIN, HIGH);
    delay(onMs);
    digitalWrite(LED_PIN, LOW);
    delay(offMs);
  }
}

void maybeToggleModeAtBoot() {
  if (MODE_BUTTON_PIN < 0) return;
  pinMode(MODE_BUTTON_PIN, INPUT_PULLUP);
  delay(10);
  // Hold button LOW during boot to toggle mode
  if (digitalRead(MODE_BUTTON_PIN) == LOW) {
    RUN_MODE = (RUN_MODE == MPC_STATION) ? BRIDGE : MPC_STATION;
    Serial.printf("🔁 Mode toggled at boot. Now: %s\n", RUN_MODE == MPC_STATION ? "MPC_STATION" : "BRIDGE");
    delay(500);
  }
}

void setup() {
  Serial.begin(115200);
  delay(400);

  ledInit();
  maybeToggleModeAtBoot();

  // Fingerprint UART2
  FPSerial.begin(FP_BAUD, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
  finger.begin(FP_BAUD);

  Serial.println();
  Serial.println("====================================");
  Serial.println("   ESP32 Fingerprint Station");
  Serial.print  ("   Mode: "); Serial.println(RUN_MODE == MPC_STATION ? "MPC_STATION" : "BRIDGE");
  Serial.print  ("   Verify: "); Serial.println(VERIFY_ENDPOINT);
  Serial.print  ("   Cast:   "); Serial.println(CAST_MPC_ENDPOINT);
  Serial.print  ("   Buffer: "); Serial.println(SCAN_BUFFER_ENDPOINT);
  Serial.println("====================================");

  if (finger.verifyPassword()) {
    Serial.println("✅ Fingerprint sensor detected.");
  } else {
    Serial.println("❌ Fingerprint sensor NOT found. Check wiring & baud.");
    while (true) { ledBlink(1, 50, 250); }
  }

  ensureWiFi();
  if (wifiOK) {
    Serial.println("📘 Ready.");
    if (RUN_MODE == MPC_STATION) {
      Serial.printf("📦 Vote ID = %d | Party ID = %d\n", VOTE_ID, PARTY_ID);
    } else {
      // Clear on boot so registration / vote UI won't pick an old value
      apiClearScanBuffer();
    }
  }
}

/* =========================================
 *                 LOOP
 * ========================================= */

void loop() {
  ensureWiFi();
  if (!wifiOK) {
    delay(300);
    return;
  }

  Serial.println("🖐 Place finger…");
  uint16_t fid = 0, conf = 0;
  if (!captureAndMatchOnce(fid, conf)) {
    delay(120);
    return;
  }

  if (dedupFinger(fid)) {
    Serial.printf("↩️  Ignored duplicate finger (ID=%u) within %ums window\n", fid, DEDUP_WINDOW_MS);
    delay(180);
    return;
  }

  Serial.printf("✅ Sensor match! ID=%u (conf=%u)\n", fid, conf);

  if (RUN_MODE == BRIDGE) {
    // Publish to /api/fingerprint/scan so the web client (registration page, etc.) can pick it up
    String err;
    if (apiPublishScan(fid, err)) {
      Serial.println("📤 Scan published to buffer.");
      ledBlink(2);
      delay(COOLDOWN_MS_AFTER_SUCCESS);
    } else {
      Serial.printf("❌ Publish failed: %s\n", err.c_str());
      ledBlink(1, 30, 200);
      delay(COOLDOWN_MS_AFTER_ERROR);
    }
    return;
  }

  // MPC_STATION mode: verify, then cast
  String name, nic, err;
  if (!apiVerifyFingerprint(fid, name, nic, err)) {
    Serial.printf("❌ Backend verify failed: %s\n", err.c_str());
    ledBlink(1, 30, 200);
    delay(COOLDOWN_MS_AFTER_ERROR);
    return;
  }

  Serial.printf("👤 %s | 🪪 %s\n", name.c_str(), nic.c_str());
  Serial.printf("🗳  Casting vote VOTE_ID=%d, PARTY_ID=%d …\n", VOTE_ID, PARTY_ID);

  if (apiCastVoteMPC(fid, VOTE_ID, PARTY_ID, err)) {
    Serial.println("✅ Vote recorded via MPC.\n");
    ledBlink(3, 50, 80);
    delay(COOLDOWN_MS_AFTER_SUCCESS);
  } else {
    Serial.printf("❌ Vote failed: %s\n\n", err.c_str());
    ledBlink(1, 30, 200);
    delay(COOLDOWN_MS_AFTER_ERROR);
  }
}
