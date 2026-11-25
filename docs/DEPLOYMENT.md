# Production Deployment Runbook

A simple step-by-step guide to deploying MediStock Guardian on AWS in **Asia Pacific (Hyderabad – `ap-south-2`)**.

---

### Step 1: Connect to EC2 and Add Swap Space

Create a 1 GB swap file to give your `t3.micro` instance extra memory during builds:

```bash
# Connect to your instance
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>

# Create and enable 1GB swap file
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

### Step 2: Clone Repository & Run Setup

```bash
git clone https://github.com/mohdanaskhan01/medistock-guardian-medical-supply-tracker.git
cd medistock-guardian-medical-supply-tracker

# Run the installer script (installs Node.js, Python, Nginx and builds frontend)
chmod +x aws/ec2/deploy.sh
./aws/ec2/deploy.sh
```

---

### Step 3: Configure Environment Variables (`.env`)

Since the instance uses an IAM Role, no access keys are needed here:

```bash
cat << 'EOF' > .env
USE_AWS=true
AWS_REGION=ap-south-2

DYNAMODB_LOCATIONS_TABLE=MediStock_Locations
DYNAMODB_SUPPLIES_TABLE=MediStock_Supplies
DYNAMODB_BATCHES_TABLE=MediStock_Batches
DYNAMODB_MOVEMENTS_TABLE=MediStock_Movements
DYNAMODB_REORDERS_TABLE=MediStock_Reorders
DYNAMODB_ALERTS_TABLE=MediStock_Alerts
DYNAMODB_DOCUMENTS_TABLE=MediStock_Documents

S3_DOCUMENTS_BUCKET=medistock-guardian-supplier-docs
SNS_ALERTS_TOPIC_ARN=arn:aws:sns:ap-south-2:<AWS_ACCOUNT_ID>:MediStockAlertsTopic
CLOUDWATCH_LOG_GROUP=/medistock-guardian/application
EOF
```

---

### Step 4: Configure & Start systemd Service

This keeps the Python backend running in the background and auto-restarts it if it crashes:

```bash
sudo tee /etc/systemd/system/medistock-api.service > /dev/null << 'EOF'
[Unit]
Description=MediStock Guardian Backend Service
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/medistock-guardian-medical-supply-tracker/backend-python
ExecStart=/home/ubuntu/medistock-guardian-medical-supply-tracker/backend-python/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5s
EnvironmentFile=/home/ubuntu/medistock-guardian-medical-supply-tracker/.env

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and start the service
sudo systemctl daemon-reload
sudo systemctl enable --now medistock-api.service
sudo systemctl status medistock-api.service --no-pager
```

---

### Step 5: Configure Nginx Reverse Proxy

Nginx listens on port 80, serves the frontend files directly, and forwards `/api/` calls to the Python backend on port 8000:

```bash
sudo tee /etc/nginx/sites-available/medistock > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;

    # Serve static frontend files
    root /home/ubuntu/medistock-guardian-medical-supply-tracker/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Forward API requests to FastAPI backend
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# Enable configuration and restart Nginx
sudo ln -sf /etc/nginx/sites-available/medistock /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

---

### Step 6: Set up Daily Monitoring Cron (EventBridge + Lambda)

Triggers the monitor Lambda function daily at `07:00 UTC` to check stock levels and expiring batches:

```bash
# 1. Create EventBridge rule
aws events put-rule \
    --name MediStockDailyInventoryScan \
    --schedule-expression "cron(0 7 * * ? *)" \
    --region ap-south-2

# 2. Grant EventBridge permission to invoke the Lambda function
aws lambda add-permission \
    --function-name mediStock-inventory-monitor \
    --statement-id EventBridgeDailyScan \
    --action 'lambda:InvokeFunction' \
    --principal events.amazonaws.com \
    --source-arn arn:aws:events:ap-south-2:<AWS_ACCOUNT_ID>:rule/MediStockDailyInventoryScan \
    --region ap-south-2

# 3. Attach the Lambda function as target
aws events put-targets \
    --rule MediStockDailyInventoryScan \
    --targets "Id"="1","Arn"="arn:aws:lambda:ap-south-2:<AWS_ACCOUNT_ID>:function:mediStock-inventory-monitor" \
    --region ap-south-2
```
