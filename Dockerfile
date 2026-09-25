FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render injects the PORT environment variable dynamically (defaults to 10000)
ENV PORT=10000
EXPOSE ${PORT}

# Use shell form to allow variable expansion for the port
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
