# 1. use lightweight Python 3.10 or 3.11 official image
FROM python:3.11-slim

# 2. setting the working directory inside the container
WORKDIR /app

# 3. install system dependencies (like compilation tools, etc., as needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 4. copy dependencies and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 5. collect project source code into the container's working directory
COPY . .

# 6. expose FastAPI default running port
EXPOSE 8000

# 7. start Uvicorn server with the FastAPI app
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]