#!/usr/bin/env bash
# MediStock Guardian – Amazon EC2 Ubuntu Deployment Script
# Run on an Ubuntu 22.04/24.04 EC2 instance inside your isolated VPC.

set -euo pipefail

echo "=== 1. Installing system packages (Node.js, Python 3, Nginx) ==="
sudo apt-get update -y
sudo apt-get install -y python3-venv python3-pip nginx curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "=== 2. Building React frontend ==="
if [ -f "package-lock.json" ]; then
  npm ci
else
  npm install
fi
npm run build

echo "=== 3. Setting up Python FastAPI backend ==="
python3 -m venv backend-python/.venv
source backend-python/.venv/bin/activate
pip install -r backend-python/requirements.txt

echo "=== 4. Ready to start services ==="
echo "Start Python API:  cd backend-python && .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000"
echo "Or start Node app: NODE_ENV=production PORT=3000 npm start"
