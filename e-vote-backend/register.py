# ✅ register.py (FastAPI Backend)

from fastapi import FastAPI
from pydantic import BaseModel
import mysql.connector
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MySQL connection
conn = mysql.connector.connect(
    host="localhost",
    user="root",
    password="",
    database="voter_db"
)
cursor = conn.cursor()

# Request model
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

@app.post("/api/register")
def register(data: RegisterRequest):
    query = """
        INSERT INTO users (
            full_name, nic, dob, gender, household, mobile, email,
            location_id, administration, electoral, polling, gn
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    values = (
        data.full_name, data.nic, data.dob, data.gender, data.household,
        data.mobile, data.email, data.location_id,
        data.administration, data.electoral, data.polling, data.gn
    )
    cursor.execute(query, values)
    conn.commit()

    return {"status": "success", "message": "Registered successfully"}

