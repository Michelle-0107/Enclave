import os
import random
import string
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
from supabase import create_client, Client

# load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# initialize Supabase client side
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI(title="Enclave Backend API")

# define the request body format for submitting text reports from the frontend
class ReportCreate(BaseModel):
    description: str

@app.get("/")
def read_root():
    return {"message": "Welcome to Enclave API"}

@app.get("/health")
def health_check():
    return {"status": "ok"}

# core testing interface: receive text reports -> store in Supabase -> return TicketID
@app.post("/api/reports")
def create_text_report(report: ReportCreate):
    try:
        # generate a random Ticket ID, e.g., TICK-8492
        ticket_id = "TICK-" + "".join(random.choices(string.digits, k=4))
        
        # prepare the data to be inserted into the Supabase database
        data = {
            "ticket_id": ticket_id,
            "description": report.description,
            "status": "pending"
        }
        
        # write to Supabase's reports table
        response = supabase.table("reports").insert(data).execute()
        
        return {
            "success": True,
            "message": "Report submitted successfully",
            "ticket_id": ticket_id,
            "data": response.data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))