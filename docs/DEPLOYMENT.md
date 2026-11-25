## Production Deployment Runbook

### 1. Provision EC2 Host & Prepare Swap
```bash
# Connect to your Ubuntu 24.04 LTS instance in ap-south-2
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>

# Configure 1 GB swap space to support memory overhead during builds
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 2. Clone Repository & Run Host Setup
```bash
git clone https://github.com/mohdanaskhan01/medistock-guardian-medical-supply-tracker.git
cd medistock-guardian-medical-supply-tracker

# Run the deployment setup script
chmod +x aws/ec2/deploy.sh
./aws/ec2/deploy.sh
```

### 3. Configure Keyless Production Environment
```bash
# Copy template — IAM role handles AWS authentication automatically
cp .env.example .env

# Verify environment configuration
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

### 4. Configure `systemd` Service
```bash
sudo tee /etc/systemd/system/medistock-api.service > /dev/null << 'EOF'
[Unit]
Description=MediStock Guardian FastAPI Application
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

sudo systemctl daemon-reload
sudo systemctl enable --now medistock-api.service
sudo systemctl status medistock-api.service --no-pager
```

### 5. Configure Nginx Reverse Proxy
```bash
sudo tee /etc/nginx/sites-available/medistock > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;

    # Static frontend assets built by Vite
    root /home/ubuntu/medistock-guardian-medical-supply-tracker/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Internal API reverse proxy
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

sudo ln -sf /etc/nginx/sites-available/medistock /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

### 6. Attach EventBridge Scheduled Rule to Lambda
```bash
# Create the daily cron rule (triggers at 07:00 UTC)
aws events put-rule \
    --name MediStockDailyInventoryScan \
    --schedule-expression "cron(0 7 * * ? *)" \
    --region ap-south-2

# Add permission for EventBridge to invoke Lambda
aws lambda add-permission \
    --function-name mediStock-inventory-monitor \
    --statement-id EventBridgeDailyScan \
    --action 'lambda:InvokeFunction' \
    --principal events.amazonaws.com \
    --source-arn arn:aws:events:ap-south-2:<AWS_ACCOUNT_ID>:rule/MediStockDailyInventoryScan \
    --region ap-south-2

# Associate target Lambda function with the EventBridge rule
aws events put-targets \
    --rule MediStockDailyInventoryScan \
    --targets "Id"="1","Arn"="arn:aws:lambda:ap-south-2:<AWS_ACCOUNT_ID>:function:mediStock-inventory-monitor" \
    --region ap-south-2
```

