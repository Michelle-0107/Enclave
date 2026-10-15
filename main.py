import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routers import email, reports

# Load environment variables
load_dotenv()

app = FastAPI(title="Enclave Backend API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],  
    allow_headers=["*"], 
)

# all routes
app.include_router(email.router)

app.include_router(reports.router)


@app.get("/")
def read_root():
    return {"message": "Welcome to Enclave API"}


@app.get("/health")
def health_check():
    return {"status": "ok"}
