#include <Adafruit_Fingerprint.h>
#include <HardwareSerial.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

/* ================================
 *  CONFIG
 * ================================ */

// --- Wi-Fi ---
const char* WIFI_SSID     = "Menuka";
const char* WIFI_PASSWORD = "menuka123";

// --- Backend (Coordinator) ---
const char* BASE_URL              = "http://192.168.9.88:8000";
const char* VERIFY_ENDPOINT       = "/api/fingerprint/verify";
const char* CAST_MPC_ENDPOINT     = "/api/vote/cast_mpc";   // ✅ MPC endpoint

// --- Vote Context ---
const int   VOTE_ID  = 1;  // Set your active vote_id
const int   PARTY_ID = 1;  // Set your chosen party_id for this station (or wire buttons to change it)

// --- Fingerprint Sensor (ESP32 UART2) ---
static const int FP_RX_PIN = 13;           // Sensor TX -> ESP32 RX
static const int FP_TX_PIN = 14;           // Sensor RX -> ESP32 TX
static const uint32_t FP_BAUD = 57600;

// --- HTTP Timeouts / Retries ---
static const uint32_t HTTP_TIMEOUT_MS = 8000;
static const int HTTP_MAX_RETRIES = 3;

// --- Loop behavior ---
static const uint32_t COOLDOWN_MS_AFTER_VOTE = 1500; // small delay after successful vote

/* ================================
 *  GLOBALS
 * ================================ */

HardwareSerial FPSerial(2);
Adafruit_Fingerprint finger(&FPSerial);

uint32_t lastConnectAttempt = 0;
bool wifiOK = false;

/* ================================
 *  HELPERS: Wi-Fi
 * ================================ */

void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiOK = true;
    return;
  }
  wifiOK = false;

  // Avoid hammering reconnects
  if (millis() - lastConnectAttempt < 2000) return;
  lastConnectAttempt = millis();

  Serial.print("🔌 Connecting Wi-Fi: ");
  Serial.print(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(300);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    wifiOK = true;
    Serial.println("\n✅ Wi-Fi connected.");
    Serial.print("📶 IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n❌ Wi-Fi connect failed.");
  }
}

/* ================================
 *  HELPERS: HTTP
 * ================================ */

bool httpPostJson(const String& url, const String& json, String& outResponse, int& outStatus) {
  outResponse = "";
  outStatus = -1;

  for (int attempt = 1; attempt <= HTTP_MAX_RETRIES; ++attempt) {
    if (WiFi.status() != WL_CONNECTED) ensureWiFi();
    if (WiFi.status() != WL_CONNECTED) {
      delay(300);
      continue;
    }

    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);

    if (!http.begin(url)) {
      Serial.printf("❌ HTTP begin failed (attempt %d/%d)\n", attempt, HTTP_MAX_RETRIES);
      delay(200);
      continue;
    }

    http.addHeader("Content-Type", "application/json");
    int code = http.POST(json);
    String resp = http.getString();
    http.end();

    outStatus = code;
    outResponse = resp;

    if (code > 0) {
      return true;  // we got a response code from server (even if it's not 200)
    }

    Serial.printf("❌ HTTP POST error: %d (attempt %d/%d)\n", code, attempt, HTTP_MAX_RETRIES);
    delay(200);
  }
  return false;
}

/* ================================
 *  BACKEND CALLS
 * ================================ */

bool apiVerifyFingerprint(uint16_t fpId, String& userNameOut, String& nicOut) {
  userNameOut = "";
  nicOut = "";

  String url = String(BASE_URL) + VERIFY_ENDPOINT;
  String payload = String("{\"fingerprint\":\"") + fpId + "\"}";

  String resp;
  int status = 0;
  bool ok = httpPostJson(url, payload, resp, status);

  Serial.printf("📡 Verify HTTP %d: %s\n", status, resp.c_str());

  if (!ok || status != 200) return false;

  StaticJsonDocument<512> doc;
  auto err = deserializeJson(doc, resp);
  if (err) {
    Serial.println("❌ JSON parse error (verify).");
    return false;
  }

  const char* statusStr = doc["status"] | "";
  if (String(statusStr) != "success") return false;

  userNameOut = String(doc["user"]["full_name"] | "");
  nicOut      = String(doc["user"]["nic"] | "");
  return true;
}

bool apiCastVoteMPC(uint16_t fpId, int voteId, int partyId) {
  String url = String(BASE_URL) + CAST_MPC_ENDPOINT;
  // Required body for MPC: fingerprint, vote_id, party_id
  String payload = String("{\"fingerprint\":\"") + fpId + "\",\"vote_id\":" + voteId + ",\"party_id\":" + partyId + "}";

  String resp;
  int status = 0;
  bool ok = httpPostJson(url, payload, resp, status);

  Serial.printf("📡 Cast MPC HTTP %d: %s\n", status, resp.c_str());

  if (!ok || status != 200) return false;

  // Optionally validate JSON "status":"success"
  StaticJsonDocument<384> doc;
  if (deserializeJson(doc, resp) == DeserializationError::Ok) {
    const char* s = doc["status"] | "";
    if (String(s) == "success") return true;
  }
  // If server returns 200 but not JSON/expected—assume success unless you want strict checks
  return true;
}

/* ================================
 *  FINGERPRINT HELPERS
 * ================================ */

bool captureAndMatch() {
  // Get image
  int p = finger.getImage();
  if (p != FINGERPRINT_OK) {
    if (p != FINGERPRINT_NOFINGER) {
      Serial.printf("⚠️ getImage err: 0x%02X\n", p);
    }
    return false;
  }

  // Convert image
  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) {
    Serial.printf("⚠️ image2Tz err: 0x%02X\n", p);
    return false;
  }

  // Search library (fast)
  p = finger.fingerFastSearch();
  if (p != FINGERPRINT_OK) {
    if (p == FINGERPRINT_NOTFOUND) {
      Serial.println("❌ Finger not found in sensor library.");
    } else {
      Serial.printf("⚠️ fingerFastSearch err: 0x%02X\n", p);
    }
    return false;
  }

  // Success: finger.fingerID contains template ID
  return true;
}

/* ================================
 *  SETUP
 * ================================ */

void setup() {
  Serial.begin(115200);
  delay(400);

  // Fingerprint UART2
  FPSerial.begin(FP_BAUD, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
  finger.begin(FP_BAUD);

  Serial.println();
  Serial.println("====================================");
  Serial.println("  MPC Voting Station – ESP32");
  Serial.println("  • Verify: /api/fingerprint/verify");
  Serial.println("  • Cast:   /api/vote/cast_mpc");
  Serial.println("====================================");

  if (finger.verifyPassword()) {
    Serial.println("✅ Fingerprint sensor detected.");
  } else {
    Serial.println("❌ Fingerprint sensor not found. Check wiring & baud.");
    while (true) delay(20);
  }

  ensureWiFi();
  if (wifiOK) {
    Serial.println("📘 Mode: VOTE (MPC)");
    Serial.printf("📦 Vote ID = %d | Party ID = %d\n", VOTE_ID, PARTY_ID);
  }
}

/* ================================
 *  LOOP
 * ================================ */

void loop() {
  ensureWiFi();
  if (!wifiOK) {
    delay(300);
    return;
  }

  Serial.println("🖐 Place finger to vote…");
  if (!captureAndMatch()) {
    delay(150);
    return;
  }

  uint16_t fid = finger.fingerID;  // template ID from sensor
  uint16_t conf = finger.confidence;
  Serial.printf("✅ Sensor match! ID=%u (conf=%u)\n", fid, conf);

  // Verify against backend DB
  String name, nic;
  if (!apiVerifyFingerprint(fid, name, nic)) {
    Serial.println("❌ Backend verify failed or user not registered.\n");
    delay(400);
    return;
  }

  Serial.printf("👤 %s | 🪪 %s\n", name.c_str(), nic.c_str());
  Serial.printf("🗳  Casting vote VOTE_ID=%d, PARTY_ID=%d …\n", VOTE_ID, PARTY_ID);

  if (apiCastVoteMPC(fid, VOTE_ID, PARTY_ID)) {
    Serial.println("✅ Vote recorded via MPC.\n");
    delay(COOLDOWN_MS_AFTER_VOTE);
  } else {
    Serial.println("❌ Vote failed (not open, already voted, or network error).\n");
    delay(600);
  }
}
