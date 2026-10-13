# Enclave

AI-powered community issue reporting and safety platform

## Requirements

- Python 3.12 or a compatible Python version

## Setup (Windows PowerShell)

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

## Run locally

```powershell
python -m uvicorn main:app --reload
```

## Endpoints

- GET /health
- GET /docs
