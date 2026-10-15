"""Render entry point for the initialized Enclave cloud application."""

from fastapi.middleware.cors import CORSMiddleware

from backend.main import app

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

__all__ = ["app"]
