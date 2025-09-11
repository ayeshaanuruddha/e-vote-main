# app.py
from fastapi import FastAPI, HTTPException, Request, Path, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any, Union
import mysql.connector
from mysql.connector import pooling
from datetime import datetime, timezone
import threading

# ---------------- App & CORS ----------------
app = FastAPI(title="E-Vote Backend", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------- MySQL connection pool ----------------
dbconfig = {
    "host": "localhost",
    "user": "root",
    "password": "",
    "database": "voter_db",
    "charset": "utf8mb4",
    "autocommit": False,
}
pool = pooling.MySQLConnectionPool(pool_name="voter_pool", pool_size=6, **dbconfig)

def db():
    conn = pool.get_connection()
    cur = conn.cursor()
    return conn, cur

# ---------------- Fingerprint buffer (thread-safe) ----------------
_fingerprint_lock = threading.Lock()
fingerprint_storage = {"fingerprint": None, "updated_at": None}

def set_fingerprint(value: Optional[str]):
    with _fingerprint_lock:
        fingerprint_storage["fingerprint"] = value
        fingerprint_storage["updated_at"] = datetime.now(timezone.utc).isoformat()

def get_fingerprint() -> Dict[str, Optional[str]]:
    with _fingerprint_lock:
        return {
            "fingerprint": fingerprint_storage["fingerprint"],
            "updated_at": fingerprint_storage["updated_at"],
        }

# ---------------- Models ----------------
class RegisterRequest(BaseModel):
    full_name: str
    nic: str
    dob: str
    gender: Optional[str] = None
    household: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[EmailStr] = None
    location_id: str
    administration: str
    electoral: str
    polling: str
    gn: str
    fingerprint: Optional[str] = None

class FingerprintPayload(BaseModel):
    # accept "123" or 123
    fingerprint: Union[str, int]

class FingerVerifyPayload(BaseModel):
    fingerprint: Union[str, int]

class AdminLoginPayload(BaseModel):
    email: EmailStr
    password: str

class AdminCreatePayload(BaseModel):
    full_name: str
    email: EmailStr
    password: str

class VoteCreatePayload(BaseModel):
    title: str
    description: Optional[str] = None
    status: Optional[str] = "draft"      # draft|open|closed|archived
    start_at: Optional[str] = None       # 'YYYY-MM-DDTHH:MM' from <input type="datetime-local">
    end_at: Optional[str] = None

class VoteStatusUpdate(BaseModel):
    status: str

class VoteCastPayload(BaseModel):
    fingerprint: str
    vote_id: int

class PublicVoteCastPayload(BaseModel):
    fingerprint: str
    vote_id: int
    party_id: int

class PartyCreatePayload(BaseModel):
    vote_id: int
    name: str
    code: Optional[str] = None
    symbol_url: Optional[str] = None
    is_active: Optional[bool] = True

class PartyUpdatePayload(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    symbol_url: Optional[str] = None
    is_active: Optional[bool] = None

# ---------------- Utils ----------------
def parse_dt_local(dt: Optional[str]) -> Optional[str]:
    """Convert HTML datetime-local to MySQL DATETIME string."""
    if not dt:
        return None
    try:
        d = datetime.strptime(dt, "%Y-%m-%dT%H:%M")
        return d.strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        try:
            d = datetime.fromisoformat(dt.replace("Z", ""))
            return d.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid datetime format: {dt}")

def _validate_party_fields(name: Optional[str], code: Optional[str], symbol_url: Optional[str]):
    if name is not None and not name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    if code is not None and len(code) > 12:
        raise HTTPException(status_code=400, detail="Code is too long (max 12)")
    if symbol_url is not None and symbol_url.strip() != "":
        su = symbol_url.strip()
        if not (su.startswith("http://") or su.startswith("https://")):
            raise HTTPException(status_code=400, detail="symbol_url must start with http:// or https://")
        

# ---------------- Helpers (new) ----------------
def _normalize_fp(val: Union[str, int, None]) -> str:
    """Return a non-empty string version of the fingerprint value."""
    if val is None:
        raise HTTPException(status_code=400, detail="Fingerprint is required")
    s = str(val).strip()
    if not s:
        raise HTTPException(status_code=400, detail="Fingerprint is required")
    return s

# ---------------- Health ----------------
@app.get("/health")
def health():
    return {"ok": True, "time": datetime.now(timezone.utc).isoformat()}

# ---------------- Admin ----------------
@app.post("/api/admin/create")
def create_admin(data: AdminCreatePayload):
    conn, cur = db()
    try:
        cur.execute(
            "INSERT INTO admins (full_name, email, password) VALUES (%s, %s, %s)",
            (data.full_name, data.email, data.password),
        )
        conn.commit()
        return {"status": "success", "message": "Admin created."}
    except mysql.connector.Error as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        cur.close(); conn.close()

@app.post("/api/admin/login")
def admin_login(data: AdminLoginPayload):
    conn, cur = db()
    try:
        cur.execute(
            "SELECT id, full_name FROM admins WHERE email=%s AND password=%s",
            (data.email, data.password),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        return {"admin_id": row[0], "full_name": row[1]}
    finally:
        cur.close(); conn.close()

# ---------------- Fingerprint APIs (updated) ----------------
@app.post("/api/fingerprint/scan")
def scan_fingerprint(data: FingerprintPayload):
    fp = _normalize_fp(data.fingerprint)
    set_fingerprint(fp)
    # helpful to log/inspect what was buffered
    return {"status": "success", "fingerprint": fp, "updated_at": fingerprint_storage["updated_at"]}

@app.get("/api/fingerprint/scan")
def get_fingerprint_api():
    # always return the buffered value as a string
    j = get_fingerprint()
    if j["fingerprint"] is not None:
        j["fingerprint"] = str(j["fingerprint"])
    return j

@app.delete("/api/fingerprint/scan")
def clear_fingerprint():
    set_fingerprint(None)
    return {"status": "cleared"}

@app.post("/api/fingerprint/verify")
def verify_fingerprint(data: FingerVerifyPayload):
    fp = _normalize_fp(data.fingerprint)
    conn, cur = db()
    try:
        cur.execute(
            "SELECT id, full_name, nic, email FROM users WHERE fingerprint = %s",
            (fp,),
        )
        row = cur.fetchone()
        if row:
            return {"status": "success", "user": {
                "id": row[0], "full_name": row[1], "nic": row[2], "email": row[3]
            }}
        return {"status": "fail", "message": "Fingerprint not found"}
    finally:
        cur.close(); conn.close()

# ---------------- Registration (public) ----------------
@app.post("/api/register")
def register_user(data: RegisterRequest):
    fp = data.fingerprint or get_fingerprint()["fingerprint"]
    conn, cur = db()
    try:
        cur.execute("""
            INSERT INTO users (full_name, nic, dob, gender, household, mobile, email,
                location_id, administration, electoral, polling, gn, fingerprint)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            data.full_name, data.nic, data.dob, data.gender,
            data.household, data.mobile, data.email,
            data.location_id, data.administration, data.electoral,
            data.polling, data.gn, fp
        ))
        conn.commit()
        set_fingerprint(None)
        return {"status": "success", "message": "User registered successfully."}
    except mysql.connector.Error as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        cur.close(); conn.close()

# Admin route alias for create
@app.post("/api/admin/voters")
def admin_create_voter(data: RegisterRequest):
    return register_user(data)

# ---------------- Admin Voters: LIST + CRUD ----------------
@app.get("/api/admin/voters")
def admin_list_voters(
    q: Optional[str] = Query(None, description="Search name/nic/email/mobile"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    conn, cur = db()
    try:
        if q:
            like = f"%{q.strip()}%"
            cur.execute(
                """
                SELECT id, full_name, nic, email, mobile, fingerprint
                FROM users
                WHERE full_name LIKE %s OR nic LIKE %s OR email LIKE %s OR mobile LIKE %s
                ORDER BY id DESC
                LIMIT %s OFFSET %s
                """,
                (like, like, like, like, limit, offset)
            )
        else:
            cur.execute(
                """
                SELECT id, full_name, nic, email, mobile, fingerprint
                FROM users
                ORDER BY id DESC
                LIMIT %s OFFSET %s
                """,
                (limit, offset)
            )
        rows = cur.fetchall()
        items = [{
            "id": r[0],
            "full_name": r[1],
            "nic": r[2],
            "email": r[3],
            "mobile": r[4],
            "fingerprint": r[5],
        } for r in rows]
        return {"items": items, "limit": limit, "offset": offset}
    finally:
        cur.close(); conn.close()

@app.get("/api/admin/voters/{user_id}")
def admin_get_voter(user_id: int = Path(..., gt=0)):
    conn, cur = db()
    try:
        cur.execute(
            "SELECT id, full_name, nic, dob, gender, household, mobile, email, fingerprint FROM users WHERE id = %s",
            (user_id,)
        )
        r = cur.fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="User not found")
        return {
            "id": r[0], "full_name": r[1], "nic": r[2], "dob": r[3],
            "gender": r[4], "household": r[5], "mobile": r[6], "email": r[7],
            "fingerprint": r[8]
        }
    finally:
        cur.close(); conn.close()

@app.put("/api/admin/voters/{user_id}")
def admin_update_voter(user_id: int, data: RegisterRequest):
    conn, cur = db()
    try:
        cur.execute("""
            UPDATE users SET full_name=%s, nic=%s, dob=%s, gender=%s, household=%s,
                mobile=%s, email=%s, location_id=%s, administration=%s,
                electoral=%s, polling=%s, gn=%s, fingerprint=%s
            WHERE id=%s
        """, (
            data.full_name, data.nic, data.dob, data.gender, data.household,
            data.mobile, data.email, data.location_id, data.administration,
            data.electoral, data.polling, data.gn, data.fingerprint, user_id
        ))
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="User not found")
        conn.commit()
        return {"status": "success"}
    finally:
        cur.close(); conn.close()

@app.delete("/api/admin/voters/{user_id}")
def admin_delete_voter(user_id: int):
    conn, cur = db()
    try:
        cur.execute("DELETE FROM users WHERE id=%s", (user_id,))
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="User not found")
        conn.commit()
        return {"status": "success"}
    finally:
        cur.close(); conn.close()

# ---------------- Votes ----------------
@app.post("/api/vote/create")
def create_vote(data: VoteCreatePayload, request: Request):
    admin_header = request.headers.get("x-admin-id")
    try:
        created_by = int(admin_header) if admin_header else None
    except ValueError:
        created_by = None
    if not created_by:
        raise HTTPException(status_code=401, detail="Missing x-admin-id")

    status = (data.status or "draft").lower()
    if status not in ("draft", "open", "closed", "archived"):
        raise HTTPException(status_code=400, detail="Invalid status")

    start_at = parse_dt_local(data.start_at)
    end_at = parse_dt_local(data.end_at)

    conn, cur = db()
    try:
        cur.execute(
            """
            INSERT INTO votes (title, description, created_by, status, start_at, end_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (data.title, data.description, created_by, status, start_at, end_at),
        )
        conn.commit()
        return {"status": "success", "message": "Vote created."}
    except mysql.connector.Error as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        cur.close(); conn.close()

@app.get("/api/votes")
def get_all_votes():
    conn, cur = db()
    try:
        cur.execute("""
            SELECT id, title, status, start_at, end_at
            FROM votes
            ORDER BY id DESC
        """)
        rows = cur.fetchall()
        votes = [{
            "id": r[0],
            "title": r[1],
            "status": r[2],
            "start_at": r[3].strftime("%Y-%m-%d %H:%M:%S") if r[3] else None,
            "end_at": r[4].strftime("%Y-%m-%d %H:%M:%S") if r[4] else None,
        } for r in rows]
        return {"votes": votes}
    finally:
        cur.close(); conn.close()

# singular + plural variants
@app.get("/api/votes/{vote_id}")
@app.get("/api/vote/{vote_id}")
def get_vote_detail(vote_id: int = Path(..., gt=0)):
    conn, cur = db()
    try:
        cur.execute("""
            SELECT v.id, v.title, v.description, v.status, v.start_at, v.end_at,
                   v.created_by, a.full_name AS created_by_name, v.created_at
            FROM votes v
            LEFT JOIN admins a ON a.id = v.created_by
            WHERE v.id = %s
        """, (vote_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Vote not found")

        vote = {
            "id": row[0],
            "title": row[1],
            "description": row[2],
            "status": row[3],
            "start_at": row[4].strftime("%Y-%m-%d %H:%M:%S") if row[4] else None,
            "end_at": row[5].strftime("%Y-%m-%d %H:%M:%S") if row[5] else None,
            "created_by": row[6],
            "created_by_name": row[7],
            "created_at": row[8].strftime("%Y-%m-%d %H:%M:%S") if row[8] else None,
        }
        return {"vote": vote}
    finally:
        cur.close(); conn.close()

# PATCH (singular) used by Remix + a POST (plural) alias
@app.patch("/api/vote/{vote_id}/status")
def patch_vote_status(vote_id: int, data: VoteStatusUpdate):
    status = (data.status or "").lower()
    if status not in ("draft", "open", "closed", "archived"):
        raise HTTPException(status_code=400, detail="Invalid status")
    conn, cur = db()
    try:
        cur.execute("UPDATE votes SET status = %s WHERE id = %s", (status, vote_id))
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Vote not found")
        conn.commit()
        return {"status": "success"}
    finally:
        cur.close(); conn.close()

# alias to support older code paths
@app.post("/api/votes/{vote_id}/status")
def post_vote_status(vote_id: int, data: VoteStatusUpdate):
    return patch_vote_status(vote_id, data)

@app.delete("/api/votes/{vote_id}")
def delete_vote(vote_id: int = Path(..., gt=0)):
    conn, cur = db()
    try:
        cur.execute("DELETE FROM votes WHERE id = %s", (vote_id,))
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Vote not found")
        conn.commit()
        return {"status": "success"}
    finally:
        cur.close(); conn.close()

# ---------------- Parties ----------------
@app.post("/api/party/create")
def create_party(data: PartyCreatePayload, request: Request):
    _validate_party_fields(data.name, data.code, data.symbol_url)
    conn, cur = db()
    try:
        cur.execute("SELECT id FROM votes WHERE id = %s", (data.vote_id,))
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="Vote not found")

        cur.execute("""
            INSERT INTO parties (vote_id, name, code, symbol_url, is_active)
            VALUES (%s, %s, %s, %s, %s)
        """, (data.vote_id, data.name.strip(), data.code, data.symbol_url,
              1 if (data.is_active is not False) else 0))
        conn.commit()
        return {"status": "success"}
    except mysql.connector.Error as e:
        conn.rollback()
        if e.errno in (1062,):
            raise HTTPException(status_code=409, detail="Party with same name or code already exists for this vote")
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        cur.close(); conn.close()

@app.get("/api/parties/{vote_id}")
def list_parties(vote_id: int = Path(..., gt=0)):
    conn, cur = db()
    try:
        cur.execute("""
            SELECT id, vote_id, name, code, symbol_url, is_active, created_at, updated_at
            FROM parties
            WHERE vote_id = %s
            ORDER BY name ASC
        """, (vote_id,))
        rows = cur.fetchall()
        parties = [{
            "id": r[0],
            "vote_id": r[1],
            "name": r[2],
            "code": r[3],
            "symbol_url": r[4],
            "is_active": bool(r[5]),
            "created_at": r[6].strftime("%Y-%m-%d %H:%M:%S") if r[6] else None,
            "updated_at": r[7].strftime("%Y-%m-%d %H:%M:%S") if r[7] else None,
        } for r in rows]
        return {"parties": parties}
    finally:
        cur.close(); conn.close()

@app.put("/api/party/{party_id}")
def update_party(party_id: int, data: PartyUpdatePayload, request: Request):
    # Validate (only if provided)
    _validate_party_fields(data.name if data.name is not None else "ok", data.code, data.symbol_url)

    sets, params = [], []
    if data.name is not None:
        sets.append("name=%s"); params.append(data.name.strip())
    if data.code is not None:
        sets.append("code=%s"); params.append(data.code)
    if data.symbol_url is not None:
        sets.append("symbol_url=%s"); params.append(data.symbol_url.strip() if data.symbol_url else None)
    if data.is_active is not None:
        sets.append("is_active=%s"); params.append(1 if data.is_active else 0)
    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update")
    params.append(party_id)

    conn, cur = db()
    try:
        cur.execute(f"UPDATE parties SET {', '.join(sets)} WHERE id=%s", tuple(params))
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Party not found")
        conn.commit()
        return {"status": "success"}
    except mysql.connector.Error as e:
        conn.rollback()
        if e.errno in (1062,):
            raise HTTPException(status_code=409, detail="Party with same name or code already exists for this vote")
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        cur.close(); conn.close()

@app.delete("/api/party/{party_id}")
def delete_party(party_id: int):
    conn, cur = db()
    try:
        cur.execute("DELETE FROM parties WHERE id=%s", (party_id,))
        if cur.rowcount == 0:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Party not found")
        conn.commit()
        return {"status": "success"}
    finally:
        cur.close(); conn.close()

# ---------------- Public vote page + cast (MPC) ----------------
@app.get("/api/vote/{vote_id}/public")
def vote_public(vote_id: int = Path(..., gt=0)):
    """Public payload: vote (id, title, description) + active parties."""
    conn, cur = db()
    try:
        cur.execute("SELECT id, title, description, status, start_at, end_at FROM votes WHERE id=%s", (vote_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Vote not found")

        vote = {
            "id": row[0],
            "title": row[1],
            "description": row[2],
            "status": row[3],
            "start_at": row[4].strftime("%Y-%m-%d %H:%M:%S") if row[4] else None,
            "end_at": row[5].strftime("%Y-%m-%d %H:%M:%S") if row[5] else None,
        }

        cur.execute("""
            SELECT id, name, code, symbol_url
            FROM parties
            WHERE vote_id=%s AND is_active=1
            ORDER BY name ASC
        """, (vote_id,))
        parties = [{
            "id": r[0],
            "name": r[1],
            "code": r[2],
            "symbol_url": r[3],
        } for r in cur.fetchall()]

        return {"vote": {"id": vote["id"], "title": vote["title"], "description": vote["description"]}, "parties": parties}
    finally:
        cur.close(); conn.close()

@app.post("/api/vote/cast_mpc")
def cast_vote_mpc(data: PublicVoteCastPayload):
    """Authenticate via fingerprint, one vote per voter per vote_id, store party_id."""
    if not data.fingerprint.strip():
        raise HTTPException(status_code=400, detail="Fingerprint is required")

    conn, cur = db()
    try:
        cur.execute("SELECT status FROM votes WHERE id=%s", (data.vote_id,))
        v = cur.fetchone()
        if not v:
            raise HTTPException(status_code=404, detail="Vote not found")
        # Optional: enforce open status
        # if v[0] != "open":
        #     raise HTTPException(status_code=403, detail="Vote is not open")

        cur.execute("SELECT id FROM parties WHERE id=%s AND vote_id=%s AND is_active=1", (data.party_id, data.vote_id))
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="Party not found for this vote or inactive")

        cur.execute("SELECT id FROM users WHERE fingerprint=%s", (data.fingerprint,))
        u = cur.fetchone()
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = u[0]

        cur.execute("SELECT id FROM vote_records WHERE vote_id=%s AND user_id=%s", (data.vote_id, user_id))
        if cur.fetchone():
            raise HTTPException(status_code=409, detail="User has already voted")

        cur.execute("INSERT INTO vote_records (vote_id, user_id, party_id) VALUES (%s, %s, %s)", (data.vote_id, user_id, data.party_id))
        conn.commit()
        return {"status": "success", "message": "Vote recorded"}
    except mysql.connector.Error as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        cur.close(); conn.close()

# ---------------- Legacy cast + analytics ----------------
@app.post("/api/vote/cast")
def cast_vote(data: VoteCastPayload):
    conn, cur = db()
    try:
        cur.execute("SELECT id FROM users WHERE fingerprint = %s", (data.fingerprint,))
        user = cur.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = user[0]

        cur.execute("SELECT id FROM vote_records WHERE vote_id = %s AND user_id = %s", (data.vote_id, user_id))
        if cur.fetchone():
            raise HTTPException(status_code=409, detail="User has already voted")

        cur.execute("INSERT INTO vote_records (vote_id, user_id) VALUES (%s, %s)", (data.vote_id, user_id))
        conn.commit()
        return {"status": "success", "message": "Vote recorded"}
    except mysql.connector.Error as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        cur.close(); conn.close()

@app.get("/api/vote/analytics")
def vote_analytics():
    conn, cur = db()
    try:
        cur.execute("""
            SELECT v.id, v.title, COUNT(r.id) as total_votes
            FROM votes v
            LEFT JOIN vote_records r ON v.id = r.vote_id
            GROUP BY v.id, v.title
            ORDER BY v.id DESC
        """)
        results = cur.fetchall()
        analytics = [{
            "vote_id": row[0],
            "title": row[1],
            "total_votes": int(row[2]),
        } for row in results]
        return {"analytics": analytics}
    finally:
        cur.close(); conn.close()


# ---------------- Vote results (per party) ----------------
@app.get("/api/votes/{vote_id}/results")
def get_vote_results(vote_id: int = Path(..., gt=0)):
    conn, cur = db()
    try:
        # 1) Make sure the vote exists
        cur.execute(
            """
            SELECT id, title, description, status, start_at, end_at
            FROM votes
            WHERE id = %s
            """,
            (vote_id,),
        )
        vr = cur.fetchone()
        if not vr:
            raise HTTPException(status_code=404, detail="Vote not found")

        vote = {
            "id": vr[0],
            "title": vr[1],
            "description": vr[2],
            "status": vr[3],
            "start_at": vr[4].strftime("%Y-%m-%d %H:%M:%S") if vr[4] else None,
            "end_at": vr[5].strftime("%Y-%m-%d %H:%M:%S") if vr[5] else None,
        }

        # 2) Count votes per party (include all parties for this vote; add AND p.is_active=1 if you want only active)
        cur.execute(
            """
            SELECT
              p.id            AS party_id,
              p.name          AS name,
              p.code          AS code,
              p.symbol_url    AS symbol_url,
              COALESCE(COUNT(r.id), 0) AS votes
            FROM parties p
            LEFT JOIN vote_records r
              ON r.party_id = p.id
             AND r.vote_id  = %s
            WHERE p.vote_id = %s
            GROUP BY p.id, p.name, p.code, p.symbol_url
            ORDER BY votes DESC, p.name ASC
            """,
            (vote_id, vote_id),
        )
        rows = cur.fetchall()

        results = [
            {
                "party_id": r[0],
                "name": r[1],
                "code": r[2],
                "symbol_url": r[3],
                "votes": int(r[4]),
            }
            for r in rows
        ]
        total_votes = sum(item["votes"] for item in results)

        return {
            "vote": vote,
            "results": results,
            "total_votes": total_votes,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        cur.close(); conn.close()
