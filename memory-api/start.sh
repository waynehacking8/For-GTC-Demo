#!/bin/bash
# Memory API Startup Script

cd "$(dirname "$0")"

# Check if venv exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

# Load environment variables from parent .env if exists
if [ -f "../.env" ]; then
    export $(grep -v '^#' ../.env | xargs)
fi

echo "Starting Memory API on port 8021..."
python -m uvicorn main:app --host 0.0.0.0 --port 8021 --reload
