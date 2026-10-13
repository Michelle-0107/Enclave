
from uuid import uuid4
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(
    title="Enclave API",
    description="Community issue reporting and safety platform",
    version="0.2.0",
)

# Temporary storage for local development only.
# Reports will disappear when the server restarts.
reports: dict[str, dict] = {}


class ReportCreate(BaseModel):
    category: Literal[
        "streetlight",
        "road_damage",
        "flooding",
        "waste",
        "other",
    ]
    description: str = Field(min_length=5, max_length=500)
    location: str | None = Field(default=None, max_length=200)


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "project": "JiranKita",
    }


@app.post("/reports", status_code=201)
def create_report(report: ReportCreate):
    ticket_id = f"JK-{uuid4().hex[:8].upper()}"

    new_report = {
        "ticket_id": ticket_id,
        "category": report.category,
        "description": report.description,
        "location": report.location,
        "status": "submitted",
    }

    reports[ticket_id] = new_report

    return new_report


@app.get("/reports/{ticket_id}")
def get_report(ticket_id: str):
    report = reports.get(ticket_id)

    if report is None:
        raise HTTPException(
            status_code=404,
            detail="Report not found",
        )

    return report
