from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Temporary in-memory storage (reset after restart)
fingerprint_storage = {
    "template": None
}

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Template model for ESP32
class FingerprintPayload(BaseModel):
    fingerprint: str

# --- POST from ESP32 to submit scanned template ---
@app.post("/api/fingerprint/scan")
async def store_fingerprint(data: FingerprintPayload):
    fingerprint_storage["template"] = data.fingerprint
    return {"status": "success", "message": "Fingerprint stored temporarily."}

# --- GET from frontend to retrieve latest scanned fingerprint ---
@app.get("/api/fingerprint/scan")
async def get_fingerprint():
    if fingerprint_storage["template"]:
        return {"status": "success", "fingerprint": fingerprint_storage["template"]}
    else:
        return {"status": "waiting", "fingerprint": None}
