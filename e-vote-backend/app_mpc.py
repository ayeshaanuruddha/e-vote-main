import os, hmac, hashlib, time, uuid, json, random
from typing import Optional, Dict, Any, List, Tuple
from enum import Enum
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from datetime import datetime
import mysql.connector
import requests
from passlib.hash import bcrypt

# =========================
# Modes & Config
# =========================
MODE = os.getenv("MODE", "coordinator").lower()      # "coordinator" | "share"
NODE_ID = os.getenv("NODE_ID", "")                    # "A" | "B" (share nodes)
HMAC_KEY = os.getenv("HMAC_KEY", "change_me_64_chars_min").encode("utf-8")
ALLOW_COORD = os.getenv("ALLOW_COORD_ORIGIN", "")

COORD_DB = {
    "host": os.getenv("COORD_DB_HOST", "linux-us.genixplay.com"),
    "user": os.getenv("COORD_DB_USER", "root"),
    "password": os.getenv("COORD_DB_PASS", "Sethu2008!!"),
    "database": os.getenv("COORD_DB_NAME", "voter_db"),
}
SHARE_DB = {
    "host": os.getenv("SHARE_DB_HOST", "linux-us.genixplay.com"),
    "user": os.getenv("SHARE_DB_USER", "root"),
    "password": os.getenv("SHARE_DB_PASS", "Sethu2008!!"),
    "database": os.getenv("SHARE_DB_NAME", "voter_shares"),
}

NODE_A_URL = os.getenv("SHARE_NODE_A_URL", "")
NODE_B_URL = os.getenv("SHARE_NODE_B_URL", "")

MODULUS = 2**61 - 1
HTTP_TIMEOUT = int(os.getenv("HTTP_TIMEOUT", "10"))

app = FastAPI(title="MPC Voting Service", version="1.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if MODE == "coordinator" else [ALLOW_COORD] if ALLOW_COORD else ["*"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

# =========================
# DB helpers
# =========================
def get_conn(cfg: Dict[str,str]):
    return mysql.connector.connect(
        host=cfg["host"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        autocommit=False
    )

def coord_conn():
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    return get_conn(COORD_DB)

def share_conn():
    if MODE != "share":
        raise HTTPException(404, "Share node only")
    return get_conn(SHARE_DB)

# =========================
# HMAC helpers
# =========================
def sign_payload(payload: Dict[str, Any])->Tuple[str,str]:
    ts = str(int(time.time()))
    body = json.dumps(payload, separators=(",",":"), sort_keys=True)
    msg = (ts + "." + body).encode("utf-8")
    sig = hmac.new(HMAC_KEY, msg, hashlib.sha256).hexdigest()
    return ts, sig

def verify_signature(ts: str, sig: str, payload: Dict[str, Any])->bool:
    body = json.dumps(payload, separators=(",",":"), sort_keys=True)
    msg = (ts + "." + body).encode("utf-8")
    expected = hmac.new(HMAC_KEY, msg, hashlib.sha256).hexdigest()
    try:
        if abs(int(time.time()) - int(ts)) > 60:
            return False
    except:
        return False
    return hmac.compare_digest(expected, sig)

def call_signed(url: str, payload: Dict[str, Any])->requests.Response:
    ts, sig = sign_payload(payload)
    return requests.post(
        url,
        headers={"x-timestamp": ts, "x-signature": sig, "content-type":"application/json"},
        data=json.dumps(payload),
        timeout=HTTP_TIMEOUT
    )

def call_signed_get(url: str)->Dict[str, Any]:
    ts, sig = sign_payload({})
    r = requests.get(url, headers={"x-timestamp": ts, "x-signature": sig}, timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    return r.json()

# =========================
# Schemas (Pydantic v2-safe)
# =========================
class AdminCreate(BaseModel):
    full_name: str
    email: EmailStr
    password: str

class AdminLogin(BaseModel):
    email: EmailStr
    password: str

class RegisterRequest(BaseModel):
    full_name: str
    nic: str
    dob: str
    gender: Optional[str] = None
    household: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[EmailStr] = None
    location_id: Optional[str] = None
    administration: Optional[str] = None
    electoral: Optional[str] = None
    polling: Optional[str] = None
    gn: Optional[str] = None
    fingerprint: Optional[str] = None

class FingerprintPayload(BaseModel):
    fingerprint: str

class VoteStatus(str, Enum):
    draft = "draft"
    open = "open"
    closed = "closed"
    archived = "archived"

class VoteCreate(BaseModel):
    title: str
    description: Optional[str] = None
    created_by: Optional[int] = None
    status: VoteStatus = VoteStatus.draft
    start_at: Optional[str] = None     # ISO datetime string
    end_at: Optional[str] = None

class VoteUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start_at: Optional[str] = None
    end_at: Optional[str] = None

class VoteStatusUpdate(BaseModel):
    status: VoteStatus

class PartyCreate(BaseModel):
    vote_id: int
    name: str
    code: Optional[str] = None
    symbol_url: Optional[str] = None
    is_active: bool = True

class PartyUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    symbol_url: Optional[str] = None
    is_active: Optional[bool] = None

class CastMpcPayload(BaseModel):
    fingerprint: str
    vote_id: int
    party_id: int

class PreparePayload(BaseModel):
    tx_id: str
    vote_id: int
    party_id: int
    delta: int

class TxIdPayload(BaseModel):
    tx_id: str

# ----- Admin voter management schemas -----
class VoterAdminCreate(BaseModel):
    full_name: str
    nic: str
    dob: str
    gender: Optional[str] = None
    household: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[EmailStr] = None
    location_id: Optional[str] = None
    administration: Optional[str] = None
    electoral: Optional[str] = None
    polling: Optional[str] = None
    gn: Optional[str] = None
    fingerprint: Optional[str] = None

class VoterAdminUpdate(BaseModel):
    full_name: Optional[str] = None
    nic: Optional[str] = None
    dob: Optional[str] = None
    gender: Optional[str] = None
    household: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[EmailStr] = None
    location_id: Optional[str] = None
    administration: Optional[str] = None
    electoral: Optional[str] = None
    polling: Optional[str] = None
    gn: Optional[str] = None
    fingerprint: Optional[str] = None

# =========================
# Share node internal APIs
# =========================
@app.post("/internal/share/prepare")
def share_prepare(
    data: PreparePayload,
    x_signature: str = Header(None),
    x_timestamp: str = Header(None)
):
    if MODE != "share":
        raise HTTPException(404, "Not a share node")
    if not x_signature or not x_timestamp:
        raise HTTPException(401, "Missing signature headers")
    if not verify_signature(x_timestamp, x_signature, data.model_dump()):
        raise HTTPException(401, "Bad signature")

    conn = share_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT status FROM share_transactions WHERE tx_id=%s", (data.tx_id,))
        row = cur.fetchone()
        if row:
            if row[0] == "aborted":
                conn.rollback(); raise HTTPException(409, "TX already aborted")
        else:
            cur.execute(
                """INSERT INTO share_transactions (tx_id, vote_id, party_id, delta, status)
                   VALUES (%s,%s,%s,%s,'prepared')""",
                (data.tx_id, data.vote_id, data.party_id, int(data.delta) % MODULUS)
            )
        conn.commit()
        return {"status":"ok"}
    finally:
        cur.close(); conn.close()

@app.post("/internal/share/commit")
def share_commit(
    data: TxIdPayload,
    x_signature: str = Header(None),
    x_timestamp: str = Header(None)
):
    if MODE != "share":
        raise HTTPException(404, "Not a share node")
    if not x_signature or not x_timestamp:
        raise HTTPException(401, "Missing signature headers")
    if not verify_signature(x_timestamp, x_signature, data.model_dump()):
        raise HTTPException(401, "Bad signature")

    conn = share_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT vote_id, party_id, delta, status FROM share_transactions WHERE tx_id=%s", (data.tx_id,))
        row = cur.fetchone()
        if not row:
            conn.rollback(); raise HTTPException(404, "TX not found")
        vote_id, party_id, delta, status = row
        if status == "aborted":
            conn.rollback(); raise HTTPException(409, "TX already aborted")
        if status == "committed":
            return {"status":"ok"}

        cur.execute("SELECT share FROM share_totals WHERE vote_id=%s AND party_id=%s", (vote_id, party_id))
        r = cur.fetchone()
        if r:
            new_share = (int(r[0]) + int(delta)) % MODULUS
            cur.execute(
                "UPDATE share_totals SET share=%s WHERE vote_id=%s AND party_id=%s",
                (new_share, vote_id, party_id)
            )
        else:
            cur.execute(
                "INSERT INTO share_totals (vote_id, party_id, share) VALUES (%s,%s,%s)",
                (vote_id, party_id, int(delta) % MODULUS)
            )
        cur.execute("UPDATE share_transactions SET status='committed' WHERE tx_id=%s", (data.tx_id,))
        conn.commit()
        return {"status":"ok"}
    finally:
        cur.close(); conn.close()

@app.post("/internal/share/abort")
def share_abort(
    data: TxIdPayload,
    x_signature: str = Header(None),
    x_timestamp: str = Header(None)
):
    if MODE != "share":
        raise HTTPException(404, "Not a share node")
    if not x_signature or not x_timestamp:
        raise HTTPException(401, "Missing signature headers")
    if not verify_signature(x_timestamp, x_signature, data.model_dump()):
        raise HTTPException(401, "Bad signature")

    conn = share_conn(); cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE share_transactions SET status='aborted' WHERE tx_id=%s AND status='prepared'",
            (data.tx_id,)
        )
        conn.commit()
        return {"status":"ok"}
    finally:
        cur.close(); conn.close()

@app.get("/internal/share/snapshot")
def share_snapshot(
    x_signature: str = Header(None),
    x_timestamp: str = Header(None)
):
    if MODE != "share":
        raise HTTPException(404, "Not a share node")
    if not x_signature or not x_timestamp:
        raise HTTPException(401, "Missing signature headers")
    if not verify_signature(x_timestamp, x_signature, {}):
        raise HTTPException(401, "Bad signature")

    conn = share_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT vote_id, party_id, share FROM share_totals")
        rows = cur.fetchall()
        return {
            "node_id": NODE_ID or "unknown",
            "shares": [
                {"vote_id": int(r[0]), "party_id": int(r[1]), "share": int(r[2])} for r in rows
            ],
            "modulus": MODULUS
        }
    finally:
        cur.close(); conn.close()

# =========================
# Coordinator helpers
# =========================
def ensure_vote_exists(vote_id: int):
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM votes WHERE id=%s", (vote_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Vote not found")
    finally:
        cur.close(); conn.close()

def ensure_party_in_vote(party_id: int, vote_id: int):
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute(
            "SELECT id FROM parties WHERE id=%s AND vote_id=%s AND is_active=1",
            (party_id, vote_id)
        )
        if not cur.fetchone():
            raise HTTPException(404, "Party not found in this vote or inactive")
    finally:
        cur.close(); conn.close()

def check_vote_open(vote_id: int):
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT status, start_at, end_at FROM votes WHERE id=%s", (vote_id,))
        r = cur.fetchone()
        if not r:
            raise HTTPException(404, "Vote not found")
        status, start_at, end_at = r[0], r[1], r[2]
        if status != "open":
            raise HTTPException(409, "Vote is not open")
        now = datetime.utcnow()
        if start_at and now < start_at:
            raise HTTPException(409, "Vote not started")
        if end_at and now > end_at:
            raise HTTPException(409, "Vote ended")
    finally:
        cur.close(); conn.close()

def coordinator_verify_voter_and_prevent_double(fingerprint: str, vote_id: int) -> int:
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM users WHERE fingerprint=%s", (fingerprint,))
        u = cur.fetchone()
        if not u:
            raise HTTPException(404, "User not found by fingerprint")
        user_id = int(u[0])
        cur.execute("SELECT id FROM vote_records WHERE vote_id=%s AND user_id=%s", (vote_id, user_id))
        if cur.fetchone():
            raise HTTPException(409, "User has already voted in this vote")
        return user_id
    finally:
        cur.close(); conn.close()

# =========================
# Coordinator: Admin/Auth
# =========================
@app.post("/api/admin/create")
def create_admin(data: AdminCreate):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO admins (full_name, email, password) VALUES (%s,%s,%s)",
            (data.full_name, data.email, bcrypt.hash(data.password))
        )
        conn.commit()
        return {"status":"success"}
    except mysql.connector.IntegrityError:
        conn.rollback()
        raise HTTPException(409, "Email exists")
    finally:
        cur.close(); conn.close()

@app.post("/api/admin/login")
def admin_login(data: AdminLogin):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT id, full_name, password FROM admins WHERE email=%s", (data.email,))
        r = cur.fetchone()
        if not r or not bcrypt.verify(data.password, r[2]):
            raise HTTPException(401, "Invalid credentials")
        return {"admin_id": int(r[0]), "full_name": r[1]}
    finally:
        cur.close(); conn.close()

# =========================
# Coordinator: Users & Fingerprints (public register used by admin UI only)
# =========================
fingerprint_storage = {"fingerprint": None}

@app.post("/api/fingerprint/scan")
def scan_fingerprint(data: FingerprintPayload):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    fingerprint_storage["fingerprint"] = data.fingerprint
    return {"status":"success"}

@app.get("/api/fingerprint/scan")
def get_fingerprint():
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    return {"fingerprint": fingerprint_storage["fingerprint"]}

@app.post("/api/register")
def register_user(data: RegisterRequest):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    fp = data.fingerprint or fingerprint_storage["fingerprint"]
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO users
               (full_name,nic,dob,gender,household,mobile,email,location_id,administration,
                electoral,polling,gn,fingerprint)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (data.full_name, data.nic, data.dob, data.gender, data.household, data.mobile, data.email,
             data.location_id, data.administration, data.electoral, data.polling, data.gn, fp)
        )
        conn.commit()
        fingerprint_storage["fingerprint"] = None
        return {"status":"success"}
    finally:
        cur.close(); conn.close()

@app.post("/api/fingerprint/verify")
def verify_fingerprint(data: FingerprintPayload):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute("SELECT id, full_name, nic, email FROM users WHERE fingerprint=%s", (data.fingerprint,))
        r = cur.fetchone()
        if not r:
            return {"status":"fail","message":"Fingerprint not found"}
        return {
            "status":"success",
            "user":{"id":int(r[0]),"full_name":r[1],"nic":r[2],"email":r[3]}
        }
    finally:
        cur.close(); conn.close()

# =========================
# Coordinator: Admin VOTERS CRUD (used by Remix admin pages)
# =========================
@app.get("/api/admin/voters")
def admin_list_voters(q: Optional[str] = None, limit: int = 50, offset: int = 0):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    conn = coord_conn(); cur = conn.cursor(dictionary=True)
    try:
        base = "SELECT id, full_name, nic, email, mobile, fingerprint, created_at FROM users"
        args: List[Any] = []
        if q:
            base += " WHERE (full_name LIKE %s OR nic LIKE %s OR email LIKE %s OR mobile LIKE %s)"
            like = f"%{q}%"
            args.extend([like, like, like, like])
        base += " ORDER BY id DESC LIMIT %s OFFSET %s"
        args.extend([int(limit), int(offset)])
        cur.execute(base, args)
        rows = cur.fetchall()
        items = []
        for r in rows:
            items.append({
                "id": int(r["id"]),
                "full_name": r["full_name"],
                "nic": r["nic"],
                "email": r.get("email"),
                "mobile": r.get("mobile"),
                "fingerprint": r.get("fingerprint"),
                "created_at": r["created_at"].isoformat() if r.get("created_at") else None
            })
        return {"items": items, "limit": limit, "offset": offset}
    finally:
        cur.close(); conn.close()

@app.post("/api/admin/voters")
def admin_create_voter(data: VoterAdminCreate):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO users
               (full_name,nic,dob,gender,household,mobile,email,location_id,administration,
                electoral,polling,gn,fingerprint)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (data.full_name, data.nic, data.dob, data.gender, data.household, data.mobile, data.email,
             data.location_id, data.administration, data.electoral, data.polling, data.gn, data.fingerprint)
        )
        user_id = cur.lastrowid
        conn.commit()
        return {"status": "success", "id": int(user_id)}
    except mysql.connector.IntegrityError as e:
        conn.rollback()
        # fingerprint has UNIQUE index; catch duplicates
        if "fingerprint" in str(e).lower():
            raise HTTPException(409, "Fingerprint already registered")
        raise
    finally:
        cur.close(); conn.close()

@app.get("/api/admin/voters/{user_id}")
def admin_get_voter(user_id: int):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    conn = coord_conn(); cur = conn.cursor(dictionary=True)
    try:
        cur.execute("""SELECT id, full_name, nic, dob, gender, household, mobile, email, location_id,
                              administration, electoral, polling, gn, fingerprint, created_at
                       FROM users WHERE id=%s""", (user_id,))
        r = cur.fetchone()
        if not r:
            raise HTTPException(404, "Voter not found")
        r["id"] = int(r["id"])
        r["created_at"] = r["created_at"].isoformat() if r.get("created_at") else None
        # return the voter object directly (matches Remix loader expectation)
        return r
    finally:
        cur.close(); conn.close()

@app.put("/api/admin/voters/{user_id}")
def admin_update_voter(user_id: int, data: VoterAdminUpdate):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    fields, vals = [], []
    for col, val in [
        ("full_name", data.full_name),
        ("nic", data.nic),
        ("dob", data.dob),
        ("gender", data.gender),
        ("household", data.household),
        ("mobile", data.mobile),
        ("email", data.email),
        ("location_id", data.location_id),
        ("administration", data.administration),
        ("electoral", data.electoral),
        ("polling", data.polling),
        ("gn", data.gn),
        ("fingerprint", data.fingerprint),
    ]:
        if val is not None:
            fields.append(f"{col}=%s")
            vals.append(val)
    if not fields:
        return {"status": "noop"}
    vals.append(user_id)

    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute(f"UPDATE users SET {', '.join(fields)} WHERE id=%s", vals)
        if cur.rowcount == 0:
            raise HTTPException(404, "Voter not found")
        conn.commit()
        return {"status": "success"}
    except mysql.connector.IntegrityError as e:
        conn.rollback()
        if "fingerprint" in str(e).lower():
            raise HTTPException(409, "Fingerprint already registered")
        raise
    finally:
        cur.close(); conn.close()

@app.delete("/api/admin/voters/{user_id}")
def admin_delete_voter(user_id: int):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM users WHERE id=%s", (user_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Voter not found")
        conn.commit()
        return {"status": "success"}
    finally:
        cur.close(); conn.close()

# =========================
# Coordinator: Votes CRUD & Lifecycle
# =========================
@app.post("/api/vote/create")
def create_vote(data: VoteCreate):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO votes (title,description,created_by,status,start_at,end_at)
               VALUES (%s,%s,%s,%s,%s,%s)""",
            (data.title, data.description, data.created_by, data.status.value, data.start_at, data.end_at)
        )
        vid = cur.lastrowid
        conn.commit()
        return {"status":"success","vote_id":vid}
    finally:
        cur.close(); conn.close()

@app.put("/api/vote/{vote_id}")
def update_vote(vote_id: int, data: VoteUpdate):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    ensure_vote_exists(vote_id)
    fields, vals = [], []
    if data.title is not None: fields.append("title=%s"); vals.append(data.title)
    if data.description is not None: fields.append("description=%s"); vals.append(data.description)
    if data.start_at is not None: fields.append("start_at=%s"); vals.append(data.start_at)
    if data.end_at is not None: fields.append("end_at=%s"); vals.append(data.end_at)
    if not fields:
        return {"status":"noop"}
    vals.append(vote_id)
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute(f"UPDATE votes SET {', '.join(fields)} WHERE id=%s", vals)
        conn.commit()
        return {"status":"success"}
    finally:
        cur.close(); conn.close()

@app.patch("/api/vote/{vote_id}/status")
def set_vote_status(vote_id: int, data: VoteStatusUpdate):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    ensure_vote_exists(vote_id)
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute("UPDATE votes SET status=%s WHERE id=%s", (data.status.value, vote_id))
        conn.commit()
        return {"status":"success","vote_id":vote_id,"new_status":data.status.value}
    finally:
        cur.close(); conn.close()

@app.delete("/api/vote/{vote_id}")
def delete_vote(vote_id: int):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    ensure_vote_exists(vote_id)
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM votes WHERE id=%s", (vote_id,))
        conn.commit()
        return {"status":"success"}
    finally:
        cur.close(); conn.close()

@app.get("/api/vote/{vote_id}")
def get_vote(vote_id: int):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute(
            """SELECT id,title,description,created_by,status,start_at,end_at,created_at
               FROM votes WHERE id=%s""",
            (vote_id,)
        )
        r = cur.fetchone()
        if not r:
            raise HTTPException(404,"Vote not found")
        return {"vote":{
            "id": int(r[0]), "title": r[1], "description": r[2], "created_by": r[3],
            "status": r[4],
            "start_at": r[5].isoformat() if r[5] else None,
            "end_at": r[6].isoformat() if r[6] else None,
            "created_at": r[7].isoformat() if isinstance(r[7], datetime) else str(r[7]),
        }}
    finally:
        cur.close(); conn.close()

@app.get("/api/votes")
def list_votes():
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute(
            """SELECT id,title,description,created_by,status,start_at,end_at,created_at
               FROM votes ORDER BY id DESC"""
        )
        rows = cur.fetchall()
        return {"votes":[{
            "id":int(r[0]),
            "title":r[1],
            "description":r[2],
            "created_by":r[3],
            "status":r[4],
            "start_at": r[5].isoformat() if r[5] else None,
            "end_at": r[6].isoformat() if r[6] else None,
            "created_at": r[7].isoformat() if isinstance(r[7], datetime) else str(r[7]),
        } for r in rows]}
    finally:
        cur.close(); conn.close()

# =========================
# Coordinator: Parties CRUD
# =========================
@app.post("/api/party/create")
def create_party(data: PartyCreate):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    ensure_vote_exists(data.vote_id)
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO parties (vote_id,name,code,symbol_url,is_active)
               VALUES (%s,%s,%s,%s,%s)""",
            (data.vote_id, data.name, data.code, data.symbol_url, 1 if data.is_active else 0)
        )
        pid = cur.lastrowid
        conn.commit()
        return {"status":"success","party_id":pid}
    except mysql.connector.IntegrityError:
        conn.rollback()
        raise HTTPException(409, "Duplicate name/code in this vote")
    finally:
        cur.close(); conn.close()

@app.put("/api/party/{party_id}")
def update_party(party_id: int, data: PartyUpdate):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    fields, vals = [], []
    if data.name is not None: fields.append("name=%s"); vals.append(data.name)
    if data.code is not None: fields.append("code=%s"); vals.append(data.code)
    if data.symbol_url is not None: fields.append("symbol_url=%s"); vals.append(data.symbol_url)
    if data.is_active is not None: fields.append("is_active=%s"); vals.append(1 if data.is_active else 0)
    if not fields:
        return {"status":"noop"}
    vals.append(party_id)
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute(f"UPDATE parties SET {', '.join(fields)} WHERE id=%s", vals)
        if cur.rowcount == 0:
            raise HTTPException(404, "Party not found")
        conn.commit()
        return {"status":"success"}
    except mysql.connector.IntegrityError:
        conn.rollback()
        raise HTTPException(409, "Duplicate name/code in this vote")
    finally:
        cur.close(); conn.close()

@app.delete("/api/party/{party_id}")
def delete_party(party_id: int):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM parties WHERE id=%s", (party_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Party not found")
        conn.commit()
        return {"status":"success"}
    finally:
        cur.close(); conn.close()

@app.get("/api/parties/{vote_id}")
def list_parties(vote_id: int):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    ensure_vote_exists(vote_id)
    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute(
            "SELECT id,name,code,symbol_url,is_active FROM parties WHERE vote_id=%s ORDER BY id",
            (vote_id,)
        )
        rows = cur.fetchall()
        return {
            "parties":[
                {"id":int(r[0]),"name":r[1],"code":r[2],"symbol_url":r[3],"is_active":bool(r[4])}
                for r in rows]
        }
    finally:
        cur.close(); conn.close()

# =========================
# Public vote page & casting
# =========================
@app.get("/api/vote/{vote_id}/public")
def public_vote(vote_id: int):
    """For the vote page: returns vote details + ACTIVE parties if the vote is open (time window respected)."""
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    conn = coord_conn(); cur = conn.cursor(dictionary=True)
    try:
        cur.execute("SELECT id,title,description,status,start_at,end_at FROM votes WHERE id=%s", (vote_id,))
        v = cur.fetchone()
        if not v:
            raise HTTPException(404, "Vote not found")
        now = datetime.utcnow()
        if v["status"] != "open":
            raise HTTPException(409, "Vote is not open")
        if v["start_at"] and now < v["start_at"]:
            raise HTTPException(409, "Vote not started")
        if v["end_at"] and now > v["end_at"]:
            raise HTTPException(409, "Vote ended")

        cur.execute(
            "SELECT id,name,code,symbol_url FROM parties WHERE vote_id=%s AND is_active=1 ORDER BY id",
            (vote_id,)
        )
        parties = cur.fetchall()
        v["start_at"] = v["start_at"].isoformat() if v["start_at"] else None
        v["end_at"] = v["end_at"].isoformat() if v["end_at"] else None
        return {"vote": v, "parties": parties}
    finally:
        cur.close(); conn.close()

@app.post("/api/vote/cast_mpc")
def cast_mpc(data: CastMpcPayload):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    if not NODE_A_URL or not NODE_B_URL:
        raise HTTPException(500, "Share node URLs not configured")

    check_vote_open(data.vote_id)
    user_id = coordinator_verify_voter_and_prevent_double(data.fingerprint, data.vote_id)
    ensure_party_in_vote(data.party_id, data.vote_id)

    r = random.randrange(0, MODULUS)
    delta_a, delta_b = r, (1 - r) % MODULUS
    tx_root = uuid.uuid4().hex
    tx_a, tx_b = tx_root+"-A", tx_root+"-B"
    prep_a = {"tx_id": tx_a, "vote_id": data.vote_id, "party_id": data.party_id, "delta": int(delta_a)}
    prep_b = {"tx_id": tx_b, "vote_id": data.vote_id, "party_id": data.party_id, "delta": int(delta_b)}

    # phase 1
    try:
        call_signed(f"{NODE_A_URL}/internal/share/prepare", prep_a).raise_for_status()
        call_signed(f"{NODE_B_URL}/internal/share/prepare", prep_b).raise_for_status()
    except Exception as e:
        try: call_signed(f"{NODE_A_URL}/internal/share/abort", {"tx_id": tx_a})
        except: pass
        try: call_signed(f"{NODE_B_URL}/internal/share/abort", {"tx_id": tx_b})
        except: pass
        raise HTTPException(502, f"Prepare failed: {e}")

    # phase 2
    try:
        call_signed(f"{NODE_A_URL}/internal/share/commit", {"tx_id": tx_a}).raise_for_status()
        call_signed(f"{NODE_B_URL}/internal/share/commit", {"tx_id": tx_b}).raise_for_status()
    except Exception as e:
        try: call_signed(f"{NODE_A_URL}/internal/share/abort", {"tx_id": tx_a})
        except: pass
        try: call_signed(f"{NODE_B_URL}/internal/share/abort", {"tx_id": tx_b})
        except: pass
        raise HTTPException(502, f"Commit failed: {e}")

    conn = coord_conn(); cur = conn.cursor()
    try:
        cur.execute("INSERT INTO vote_records (vote_id, user_id) VALUES (%s,%s)", (data.vote_id, user_id))
        cur.execute(
            """INSERT INTO mpc_audit (tx_id, vote_id, party_id, user_id, node_a_delta, node_b_delta, status)
               VALUES (%s,%s,%s,%s,%s,%s,'success')""",
            (tx_root, data.vote_id, data.party_id, user_id, int(delta_a), int(delta_b))
        )
        conn.commit()
    finally:
        cur.close(); conn.close()

    return {"status":"success","message":"Vote recorded","tx_id":tx_root}

@app.get("/api/vote/tally_mpc/{vote_id}")
def tally_mpc_vote(vote_id: int):
    if MODE != "coordinator":
        raise HTTPException(404, "Coordinator only")
    ensure_vote_exists(vote_id)
    try:
        snap_a = call_signed_get(f"{NODE_A_URL}/internal/share/snapshot")
        snap_b = call_signed_get(f"{NODE_B_URL}/internal/share/snapshot")
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch shares: {e}")
    if snap_a.get("modulus") != snap_b.get("modulus") or snap_a.get("modulus") != MODULUS:
        raise HTTPException(500, "Modulus mismatch")

    a_map, b_map = {}, {}
    for s in snap_a.get("shares", []):
        if int(s["vote_id"]) == vote_id:
            a_map[int(s["party_id"])] = int(s["share"])
    for s in snap_b.get("shares", []):
        if int(s["vote_id"]) == vote_id:
            b_map[int(s["party_id"])] = int(s["share"])

    party_ids = sorted(set(a_map.keys()) | set(b_map.keys()))
    totals = [{"party_id": pid, "total_votes": int((a_map.get(pid,0)+b_map.get(pid,0))%MODULUS)} for pid in party_ids]
    return {
        "vote_id": vote_id,
        "tally": totals,
        "modulus": MODULUS,
        "nodes": {"A": snap_a.get("node_id"), "B": snap_b.get("node_id")}
    }

# =========================
# Health
# =========================
@app.get("/health")
def health():
    return {"mode": MODE, "node": NODE_ID or None, "ok": True}
