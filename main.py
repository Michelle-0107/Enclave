import os
from dotenv import load_dotenv
from fastapi import FastAPI

# import the split-out routes
from backend.routers import auth, reports

# Load environment variables
load_dotenv()

app = FastAPI(title="Enclave Backend API")

# all routes
app.include_router(auth.router)

app.include_router(reports.router)


@app.get("/")
def read_root():
    return {"message": "Welcome to Enclave API"}


@app.get("/health")
def health_check():
    return {"status": "ok"}