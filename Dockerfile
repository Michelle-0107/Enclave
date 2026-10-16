FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# .dockerignore excludes private env files and platform-specific local runtimes.
COPY . .

# Install pinned Linux routing binaries and build the bundled public KL East graph.
# This step does not load application secrets or contact Supabase, AWS or Resend.
RUN python -B -m backend.navigation.prepare

EXPOSE 8000

# PORT is Render's existing platform variable. Private engine stays on loopback:8002.
CMD ["sh", "-c", "exec uvicorn backend.navigation.container_app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
