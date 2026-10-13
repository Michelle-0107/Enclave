"""Export the current API contract without starting the server or opening its DB."""

import json
from pathlib import Path

from main import app


if __name__ == "__main__":
    output_path = Path(__file__).resolve().with_name("openapi.json")
    output_path.write_text(
        json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    print(f"Exported API contract to {output_path}")
