"""AWS service adapters for MediStock Guardian (DynamoDB, S3, SNS, CloudWatch)."""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

AWS_REGION = os.getenv("AWS_REGION", "ap-south-2")
USE_AWS = os.getenv("USE_AWS", "false").lower() == "true"

DYNAMODB_LOCATIONS_TABLE = os.getenv("DYNAMODB_LOCATIONS_TABLE", "MediStock_Locations")
DYNAMODB_SUPPLIES_TABLE = os.getenv("DYNAMODB_SUPPLIES_TABLE", "MediStock_Supplies")
DYNAMODB_BATCHES_TABLE = os.getenv("DYNAMODB_BATCHES_TABLE", "MediStock_Batches")
DYNAMODB_MOVEMENTS_TABLE = os.getenv("DYNAMODB_MOVEMENTS_TABLE", "MediStock_Movements")
DYNAMODB_REORDERS_TABLE = os.getenv("DYNAMODB_REORDERS_TABLE", "MediStock_Reorders")
DYNAMODB_ALERTS_TABLE = os.getenv("DYNAMODB_ALERTS_TABLE", "MediStock_Alerts")
DYNAMODB_DOCUMENTS_TABLE = os.getenv("DYNAMODB_DOCUMENTS_TABLE", "MediStock_Documents")

S3_DOCUMENTS_BUCKET = os.getenv("S3_DOCUMENTS_BUCKET", "medistock-guardian-supplier-docs")
SNS_ALERTS_TOPIC_ARN = os.getenv(
    "SNS_ALERTS_TOPIC_ARN",
    "arn:aws:sns:ap-south-2:123456789012:MediStockAlertsTopic",
)
CLOUDWATCH_LOG_GROUP = os.getenv("CLOUDWATCH_LOG_GROUP", "/medistock-guardian/application")

logger = logging.getLogger("medistock.cloudwatch")
logging.basicConfig(level=logging.INFO, format="%(message)s")

_cw_stream_created = False


def log_cloudwatch_event(event: str, payload: dict[str, Any]) -> None:
    """Emit structured JSON log entries and send to CloudWatch Logs if USE_AWS=true."""
    global _cw_stream_created
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "logGroup": CLOUDWATCH_LOG_GROUP,
        "event": event,
        **payload,
    }
    logger.info(json.dumps(record))

    if USE_AWS:
        try:
            cw_client = boto3.client("logs", region_name=AWS_REGION)
            stream_name = datetime.now(timezone.utc).strftime("app-%Y-%m-%d")
            if not _cw_stream_created:
                try:
                    cw_client.create_log_stream(
                        logGroupName=CLOUDWATCH_LOG_GROUP,
                        logStreamName=stream_name,
                    )
                except ClientError as exc:
                    if exc.response.get("Error", {}).get("Code") != "ResourceAlreadyExistsException":
                        pass
                _cw_stream_created = True

            timestamp_ms = int(time.time() * 1000)
            cw_client.put_log_events(
                logGroupName=CLOUDWATCH_LOG_GROUP,
                logStreamName=stream_name,
                logEvents=[{"timestamp": timestamp_ms, "message": json.dumps(record)}],
            )
        except Exception as exc:
            # Never crash API requests on CloudWatch network or permission issues
            logger.warning(f"CloudWatch direct put failed: {exc}")


def get_dynamodb_resource():
    return boto3.resource("dynamodb", region_name=AWS_REGION)


def to_dynamodb_item(data: Any) -> Any:
    """Recursively convert float values to Decimal for DynamoDB serialization."""
    if isinstance(data, float):
        return Decimal(str(data))
    if isinstance(data, dict):
        return {k: to_dynamodb_item(v) for k, v in data.items()}
    if isinstance(data, list):
        return [to_dynamodb_item(v) for v in data]
    if isinstance(data, tuple):
        return tuple(to_dynamodb_item(v) for v in data)
    if isinstance(data, set):
        return {to_dynamodb_item(v) for v in data}
    return data


def from_dynamodb_item(data: Any) -> Any:
    """Recursively convert Decimal values from DynamoDB back into int or float for FastAPI."""
    if isinstance(data, Decimal):
        if data % 1 == 0:
            return int(data)
        return float(data)
    if isinstance(data, dict):
        return {k: from_dynamodb_item(v) for k, v in data.items()}
    if isinstance(data, list):
        return [from_dynamodb_item(v) for v in data]
    if isinstance(data, tuple):
        return tuple(from_dynamodb_item(v) for v in data)
    if isinstance(data, set):
        return {from_dynamodb_item(v) for v in data}
    return data


def publish_sns_alert(subject: str, message: str, attributes: dict[str, str] | None = None) -> dict[str, Any]:
    """Publish a shortage or expiry notification to Amazon SNS."""
    if not USE_AWS:
        log_cloudwatch_event(
            "SNS_LOCAL_SIMULATION",
            {"topicArn": SNS_ALERTS_TOPIC_ARN, "subject": subject, "message": message},
        )
        return {"mode": "local", "subject": subject}

    sns = boto3.client("sns", region_name=AWS_REGION)
    msg_attrs = {
        k: {"DataType": "String", "StringValue": v}
        for k, v in (attributes or {}).items()
    }
    try:
        response = sns.publish(
            TopicArn=SNS_ALERTS_TOPIC_ARN,
            Subject=subject[:100],
            Message=message,
            MessageAttributes=msg_attrs,
        )
        log_cloudwatch_event(
            "SNS_PUBLISHED",
            {"topicArn": SNS_ALERTS_TOPIC_ARN, "messageId": response.get("MessageId")},
        )
        return response
    except (BotoCoreError, ClientError) as exc:
        log_cloudwatch_event("SNS_PUBLISH_ERROR", {"error": str(exc)})
        raise


def upload_supplier_document_to_s3(file_name: str, file_bytes: bytes, content_type: str) -> str:
    """Upload a supplier invoice or packing slip to Amazon S3 and return the S3 object key."""
    safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in file_name)
    year = datetime.now(timezone.utc).year
    s3_key = f"supplier-docs/{year}/{int(datetime.now(timezone.utc).timestamp())}_{safe_name}"

    if not USE_AWS:
        log_cloudwatch_event(
            "S3_LOCAL_SIMULATION",
            {"bucket": S3_DOCUMENTS_BUCKET, "s3Key": s3_key, "sizeBytes": len(file_bytes)},
        )
        return s3_key

    s3 = boto3.client("s3", region_name=AWS_REGION)
    try:
        s3.put_object(
            Bucket=S3_DOCUMENTS_BUCKET,
            Key=s3_key,
            Body=file_bytes,
            ContentType=content_type,
            ServerSideEncryption="AES256",
        )
        log_cloudwatch_event(
            "S3_UPLOADED",
            {"bucket": S3_DOCUMENTS_BUCKET, "s3Key": s3_key, "sizeBytes": len(file_bytes)},
        )
        return s3_key
    except (BotoCoreError, ClientError) as exc:
        log_cloudwatch_event("S3_UPLOAD_ERROR", {"error": str(exc)})
        raise


def generate_presigned_download_url(s3_key: str, expires_in: int = 3600) -> str:
    """Generate a secure S3 pre-signed GET URL for viewing or downloading documents."""
    if not USE_AWS:
        return f"/api/documents/download/{s3_key.split('/')[-1]}"

    s3 = boto3.client("s3", region_name=AWS_REGION)
    try:
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_DOCUMENTS_BUCKET, "Key": s3_key},
            ExpiresIn=expires_in,
        )
    except Exception as exc:
        log_cloudwatch_event("S3_PRESIGN_ERROR", {"error": str(exc), "s3Key": s3_key})
        return ""
