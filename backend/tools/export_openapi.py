"""Export the cloud API schema without credentials, startup, or network access."""

import json
from pathlib import Path

from ..main import app


if __name__ == "__main__":
    path = Path(__file__).resolve().parents[1] / "docs" / "api" / "openapi.json"
    path.write_text(json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8")
    print("Exported backend/docs/api/openapi.json")
