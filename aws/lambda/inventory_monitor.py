"""AWS Lambda function: MediStock Guardian Automated Expiry & Low-Stock Monitor.

Schedule via Amazon EventBridge (e.g., cron(0 7 * * ? *) daily at 07:00 UTC).
Reads inventory supplies and batches from Amazon DynamoDB, detects shortages
and batches expiring within 30 days (or already expired), writes alerts to
MediStock_Alerts, publishes notifications to Amazon SNS, and logs to CloudWatch.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime, timezone

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AWS_REGION = os.getenv("AWS_REGION", "ap-south-2")
SUPPLIES_TABLE = os.getenv("DYNAMODB_SUPPLIES_TABLE", "MediStock_Supplies")
BATCHES_TABLE = os.getenv("DYNAMODB_BATCHES_TABLE", "MediStock_Batches")
ALERTS_TABLE = os.getenv("DYNAMODB_ALERTS_TABLE", "MediStock_Alerts")
SNS_TOPIC_ARN = os.environ["SNS_ALERTS_TOPIC_ARN"]
EXPIRY_WARNING_DAYS = int(os.getenv("EXPIRY_WARNING_DAYS", "30"))

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
sns = boto3.client("sns", region_name=AWS_REGION)


def lambda_handler(event, context):
    today = date.today()
    now_iso = datetime.now(timezone.utc).isoformat()

    supplies = dynamodb.Table(SUPPLIES_TABLE).scan().get("Items", [])
    batches = dynamodb.Table(BATCHES_TABLE).scan().get("Items", [])
    alerts_table = dynamodb.Table(ALERTS_TABLE)

    triggered_alerts = []

    # 1. Check Low-Stock Thresholds
    for supply in supplies:
        usable_qty = sum(
            int(b["quantity"])
            for b in batches
            if b["supplyId"] == supply["id"]
            and int(b["quantity"]) > 0
            and date.fromisoformat(b["expiryDate"]) >= today
        )
        min_level = int(supply["minStockLevel"])
        if usable_qty < min_level:
            subject = f"[MediStock Alert] Low Stock: {supply['name']}"
            message = (
                f"Supply: {supply['name']} ({supply['sku']})\n"
                f"Current Usable Quantity: {usable_qty} {supply['unit']}\n"
                f"Minimum Threshold: {min_level} {supply['unit']}\n"
                f"Action Required: Initiate replenishment reorder."
            )
            alert_item = {
                "id": f"ALT-LOW-{supply['id']}",
                "type": "LOW_STOCK",
                "severity": "critical" if usable_qty <= min_level // 2 else "warning",
                "status": "Active",
                "supplyId": supply["id"],
                "title": subject,
                "message": message,
                "createdAt": now_iso,
            }
            alerts_table.put_item(Item=alert_item)
            sns.publish(TopicArn=SNS_TOPIC_ARN, Subject=subject[:100], Message=message)
            triggered_alerts.append(alert_item["id"])

    # 2. Check Upcoming & Past Expiries
    supply_by_id = {s["id"]: s for s in supplies}
    for batch in batches:
        qty = int(batch["quantity"])
        if qty <= 0:
            continue
        days_left = (date.fromisoformat(batch["expiryDate"]) - today).days
        supply = supply_by_id.get(batch["supplyId"], {"name": batch["supplyId"], "unit": "units"})

        if days_left < 0 or days_left <= EXPIRY_WARNING_DAYS:
            is_expired = days_left < 0
            alert_type = "EXPIRED" if is_expired else "EXPIRING_SOON"
            subject = (
                f"[MediStock Alert] Expired Batch: {batch['batchNumber']}"
                if is_expired
                else f"[MediStock Alert] Batch Expiring in {days_left}d: {batch['batchNumber']}"
            )
            message = (
                f"Supply: {supply['name']}\n"
                f"Batch Number: {batch['batchNumber']}\n"
                f"Remaining Quantity: {qty} {supply['unit']}\n"
                f"Expiry Date: {batch['expiryDate']}\n"
                f"Action Required: {'Quarantine and discard expired stock.' if is_expired else 'Prioritize FEFO usage or replace.'}"
            )
            alert_item = {
                "id": f"ALT-{'EXP' if is_expired else 'SOON'}-{batch['id']}",
                "type": alert_type,
                "severity": "critical" if is_expired or days_left <= 10 else "warning",
                "status": "Active",
                "supplyId": batch["supplyId"],
                "batchId": batch["id"],
                "title": subject,
                "message": message,
                "createdAt": now_iso,
            }
            alerts_table.put_item(Item=alert_item)
            sns.publish(TopicArn=SNS_TOPIC_ARN, Subject=subject[:100], Message=message)
            triggered_alerts.append(alert_item["id"])

    summary = {
        "checkedAt": now_iso,
        "suppliesChecked": len(supplies),
        "batchesChecked": len(batches),
        "alertsTriggered": len(triggered_alerts),
    }
    logger.info(json.dumps({"event": "LAMBDA_MONITOR_RUN", **summary}))
    return {"statusCode": 200, "body": json.dumps(summary)}
