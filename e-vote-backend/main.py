from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import mysql.connector

# ------------------------------
# FastAPI App Init & CORS
# ------------------------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------
# MySQL Connection
# ------------------------------
conn = mysql.connector.connect(
    host="localhost",
    user="root",
    password="",
    database="voter_db"
)
cursor = conn.cursor()

# ------------------------------
# Fingerprint Memory Storage
# ------------------------------
fingerprint_storage = {
    "fingerprint": None
}

# ------------------------------
# Models
# ------------------------------
class RegisterRequest(BaseModel):
    full_name: str
    nic: str
    dob: str
    gender: str
    household: str
    mobile: str
    email: str
    location_id: str
    administration: str
    electoral: str
    polling: str
    gn: str
    fingerprint: Optional[str] = None

class FingerprintPayload(BaseModel):
    fingerprint: str

class FingerVerifyPayload(BaseModel):
    fingerprint: str

class AdminLoginPayload(BaseModel):
    email: str
    password: str

class AdminCreatePayload(BaseModel):
    full_name: str
    email: str
    password: str

class VoteCreatePayload(BaseModel):
    title: str
    description: str
    created_by: int

class VoteCastPayload(BaseModel):
    fingerprint: str
    vote_id: int

# ------------------------------
# Admin APIs
# ------------------------------
@app.post("/api/admin/create")
def create_admin(data: AdminCreatePayload):
    cursor.execute("INSERT INTO admins (full_name, email, password) VALUES (%s, %s, %s)",
                   (data.full_name, data.email, data.password))
    conn.commit()
    return {"status": "success", "message": "Admin created."}

@app.post("/api/admin/login")
def admin_login(data: AdminLoginPayload):
    cursor.execute("SELECT id, full_name FROM admins WHERE email=%s AND password=%s",
                   (data.email, data.password))
    result = cursor.fetchone()
    if not result:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"admin_id": result[0], "full_name": result[1]}

# ------------------------------
# Fingerprint APIs
# ------------------------------
@app.post("/api/fingerprint/scan")
def scan_fingerprint(data: FingerprintPayload):
    fingerprint_storage["fingerprint"] = data.fingerprint
    print("📥 Received fingerprint ID:", data.fingerprint)
    return {"status": "success"}

@app.get("/api/fingerprint/scan")
def get_fingerprint():
    return {"fingerprint": fingerprint_storage["fingerprint"]}

@app.post("/api/fingerprint/verify")
def verify_fingerprint(data: FingerVerifyPayload):
    cursor.execute("SELECT id, full_name, nic, email FROM users WHERE fingerprint = %s", (data.fingerprint,))
    result = cursor.fetchone()
    if result:
        return {"status": "success", "user": {
            "id": result[0], "full_name": result[1], "nic": result[2], "email": result[3]
        }}
    return {"status": "fail", "message": "Fingerprint not found"}

# ------------------------------
# User Registration
# ------------------------------
@app.post("/api/register")
def register_user(data: RegisterRequest):
    fingerprint_value = data.fingerprint or fingerprint_storage["fingerprint"]
    cursor.execute("""
        INSERT INTO users (full_name, nic, dob, gender, household, mobile, email,
            location_id, administration, electoral, polling, gn, fingerprint)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (
        data.full_name, data.nic, data.dob, data.gender, data.household,
        data.mobile, data.email, data.location_id, data.administration,
        data.electoral, data.polling, data.gn, fingerprint_value
    ))
    conn.commit()
    fingerprint_storage["fingerprint"] = None
    return {"status": "success", "message": "User registered successfully."}

# ------------------------------
# Vote Management
# ------------------------------
@app.post("/api/vote/create")
def create_vote(data: VoteCreatePayload):
    cursor.execute("INSERT INTO votes (title, description, created_by) VALUES (%s, %s, %s)",
                   (data.title, data.description, data.created_by))
    conn.commit()
    return {"status": "success", "message": "Vote created."}

@app.get("/api/votes")
def get_all_votes():
    cursor.execute("SELECT id, title, description, created_by, created_at FROM votes")
    results = cursor.fetchall()
    votes = []
    for row in results:
        votes.append({
            "id": row[0],
            "title": row[1],
            "description": row[2],
            "created_by": row[3],
            "created_at": str(row[4])
        })
    return {"votes": votes}

# ------------------------------
# Cast Vote
# ------------------------------
@app.post("/api/vote/cast")
def cast_vote(data: VoteCastPayload):
    # Get user by fingerprint
    cursor.execute("SELECT id FROM users WHERE fingerprint = %s", (data.fingerprint,))
    user = cursor.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user_id = user[0]

    # Prevent double voting
    cursor.execute("SELECT id FROM vote_records WHERE vote_id = %s AND user_id = %s", (data.vote_id, user_id))
    if cursor.fetchone():
        raise HTTPException(status_code=409, detail="User has already voted")

    # Insert vote record
    cursor.execute("INSERT INTO vote_records (vote_id, user_id) VALUES (%s, %s)", (data.vote_id, user_id))
    conn.commit()
    return {"status": "success", "message": "Vote recorded"}

# ------------------------------
# Vote Analytics (Count per vote)
# ------------------------------
@app.get("/api/vote/analytics")
def vote_analytics():
    cursor.execute("""
        SELECT v.id, v.title, COUNT(r.id) as total_votes
        FROM votes v
        LEFT JOIN vote_records r ON v.id = r.vote_id
        GROUP BY v.id, v.title
    """)
    results = cursor.fetchall()
    analytics = []
    for row in results:
        analytics.append({
            "vote_id": row[0],
            "title": row[1],
            "total_votes": row[2]
        })
    return {"analytics": analytics}


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
