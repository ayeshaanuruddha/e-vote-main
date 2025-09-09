# app.py
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
import mysql.connector
from mysql.connector import pooling
from datetime import datetime, timezone
import threading

# ------------------------------
# FastAPI App Init & CORS
# ------------------------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # lock this down in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------
# MySQL Connection (Pool)
# ------------------------------
dbconfig = {
    "host": "localhost",
    "user": "root",
    "password": "",
    "database": "voter_db",
    "charset": "utf8mb4",
    "autocommit": False,
}

pool = pooling.MySQLConnectionPool(pool_name="voter_pool", pool_size=5, **dbconfig)

def db():
    conn = pool.get_connection()
    cur = conn.cursor()
    return conn, cur

# ------------------------------
# Fingerprint Memory Storage
# ------------------------------
_fingerprint_lock = threading.Lock()
fingerprint_storage = {
    "fingerprint": None,
    "updated_at": None,
}

def set_fingerprint(value: Optional[str]):
    with _fingerprint_lock:
        fingerprint_storage["fingerprint"] = value
        fingerprint_storage["updated_at"] = datetime.now(timezone.utc).isoformat()

def get_fingerprint():
    with _fingerprint_lock:
        return {
            "fingerprint": fingerprint_storage["fingerprint"],
            "updated_at": fingerprint_storage["updated_at"],
        }

# ------------------------------
# Models
# ------------------------------
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
    fingerprint: str = Field(min_length=1)

class FingerVerifyPayload(BaseModel):
    fingerprint: str = Field(min_length=1)

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
    created_by: int

class VoteCastPayload(BaseModel):
    fingerprint: str
    vote_id: int

# ------------------------------
# Health
# ------------------------------
@app.get("/health")
def health():
    return {"ok": True, "time": datetime.now(timezone.utc).isoformat()}

# ------------------------------
# Admin APIs
# ------------------------------
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
        result = cur.fetchone()
        if not result:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        return {"admin_id": result[0], "full_name": result[1]}
    finally:
        cur.close(); conn.close()

# ------------------------------
# Fingerprint APIs
# ------------------------------
@app.post("/api/fingerprint/scan")
def scan_fingerprint(data: FingerprintPayload):
    set_fingerprint(data.fingerprint)
    print("📥 Received fingerprint ID:", data.fingerprint)
    return {"status": "success"}

@app.get("/api/fingerprint/scan")
def get_fingerprint_api():
    return get_fingerprint()

@app.delete("/api/fingerprint/scan")
def clear_fingerprint():
    set_fingerprint(None)
    return {"status": "cleared"}

@app.post("/api/fingerprint/verify")
def verify_fingerprint(data: FingerVerifyPayload):
    conn, cur = db()
    try:
        cur.execute(
            "SELECT id, full_name, nic, email FROM users WHERE fingerprint = %s",
            (data.fingerprint,),
        )
        result = cur.fetchone()
        if result:
            return {"status": "success", "user": {
                "id": result[0], "full_name": result[1], "nic": result[2], "email": result[3]
            }}
        return {"status": "fail", "message": "Fingerprint not found"}
    finally:
        cur.close(); conn.close()

# ------------------------------
# User Registration
# ------------------------------
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
        # clear captured fp after successful registration
        set_fingerprint(None)
        return {"status": "success", "message": "User registered successfully."}
    except mysql.connector.Error as e:
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        cur.close(); conn.close()

# Alias used by your Remix action (keeps your frontend unchanged)
@app.post("/api/admin/voters")
def admin_create_voter(data: RegisterRequest):
    return register_user(data)

# ------------------------------
# Vote Management
# ------------------------------
@app.post("/api/vote/create")
def create_vote(data: VoteCreatePayload):
    conn, cur = db()
    try:
        cur.execute(
            "INSERT INTO votes (title, description, created_by) VALUES (%s, %s, %s)",
            (data.title, data.description, data.created_by),
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
        cur.execute("SELECT id, title, description, created_by, created_at FROM votes")
        results = cur.fetchall()
        votes = [{
            "id": row[0], "title": row[1], "description": row[2],
            "created_by": row[3], "created_at": row[4].isoformat() if row[4] else None
        } for row in results]
        return {"votes": votes}
    finally:
        cur.close(); conn.close()

# ------------------------------
# Cast Vote
# ------------------------------
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

# ------------------------------
# Vote Analytics
# ------------------------------
@app.get("/api/vote/analytics")
def vote_analytics():
    conn, cur = db()
    try:
        cur.execute("""
            SELECT v.id, v.title, COUNT(r.id) as total_votes
            FROM votes v
            LEFT JOIN vote_records r ON v.id = r.vote_id
            GROUP BY v.id, v.title
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


"""
✅ MySQL Database Schema for Fingerprint E-Voting System

Run this SQL code in your MySQL to create all necessary tables.
Make sure to use the correct database (e.g., `USE voter_db;`).

-- Users Table (Voter Registry)
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    nic VARCHAR(20) NOT NULL,
    dob DATE NOT NULL,
    gender VARCHAR(10),
    household VARCHAR(100),
    mobile VARCHAR(20),
    email VARCHAR(100),
    location_id VARCHAR(50),
    administration VARCHAR(100),
    electoral VARCHAR(100),
    polling VARCHAR(100),
    gn VARCHAR(100),
    fingerprint VARCHAR(50) UNIQUE
);

-- Admins Table
CREATE TABLE admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(100) NOT NULL
);

-- Votes Table
CREATE TABLE votes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL
);

-- Vote Records Table (Tracks who voted in which vote)
CREATE TABLE vote_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vote_id INT NOT NULL,
    user_id INT NOT NULL,
    voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vote_id) REFERENCES votes(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (vote_id, user_id)  -- Prevent duplicate voting
);
"""
