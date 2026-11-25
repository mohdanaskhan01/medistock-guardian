"""FastAPI backend for MediStock Guardian – Medical Supply Tracker.

Full feature parity with Node.js server.ts and full support for both
local simulation (USE_AWS=false) and live Amazon DynamoDB, S3, SNS, and CloudWatch (USE_AWS=true).
"""

from __future__ import annotations

import base64
import csv
import io
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from aws_services import (
    DYNAMODB_ALERTS_TABLE,
    DYNAMODB_BATCHES_TABLE,
    DYNAMODB_DOCUMENTS_TABLE,
    DYNAMODB_LOCATIONS_TABLE,
    DYNAMODB_MOVEMENTS_TABLE,
    DYNAMODB_REORDERS_TABLE,
    DYNAMODB_SUPPLIES_TABLE,
    SNS_ALERTS_TOPIC_ARN,
    USE_AWS,
    from_dynamodb_item,
    generate_presigned_download_url,
    get_dynamodb_resource,
    log_cloudwatch_event,
    publish_sns_alert,
    to_dynamodb_item,
    upload_supplier_document_to_s3,
)

load_dotenv()

app = FastAPI(
    title="MediStock Guardian API",
    description="Medical inventory management API for tracking supplies, batches, expiry dates, stock movements, and reorders.",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LocationCreate(BaseModel):
    name: str
    code: str
    zone: str
    temperatureSpec: str = "18–22°C Ambient"
    capacityNote: str = "Standard shelving"


class SupplyCreate(BaseModel):
    sku: str
    name: str
    category: str
    unit: str
    minStockLevel: int = Field(ge=0)
    defaultLocationId: str
    preferredSupplier: str = "MedLine Clinical Supply"
    unitCost: float = Field(gt=0, default=5.0)


class SupplyUpdate(BaseModel):
    minStockLevel: int | None = Field(default=None, ge=0)
    preferredSupplier: str | None = None


class BatchCreate(BaseModel):
    batchNumber: str
    supplyId: str
    locationId: str
    quantity: int = Field(gt=0)
    expiryDate: str
    receivedDate: str | None = None
    supplierName: str | None = None
    notes: str | None = None
    documentId: str | None = None
    performedBy: str = "Elena Vance"
    performedByRole: str = "Pharmacy Stock Manager"


class MovementCreate(BaseModel):
    type: Literal["IN", "OUT", "DISCARDED"]
    supplyId: str
    batchId: str
    newBatchNumber: str | None = None
    newBatchExpiryDate: str | None = None
    locationId: str | None = None
    quantity: int = Field(gt=0)
    reason: str = ""
    referenceCode: str = ""
    performedBy: str = "Marcus Reid"
    performedByRole: str = "Clinic Inventory Staff"
    documentId: str | None = None


class ReorderCreate(BaseModel):
    supplyId: str
    requestedQuantity: int = Field(gt=0)
    supplierName: str | None = None
    expectedDeliveryDate: str | None = None
    purchaseOrderNumber: str | None = None
    requestedBy: str = "Priya Nair"
    notes: str | None = None
    documentId: str | None = None


class ReorderUpdate(BaseModel):
    status: Literal["Pending", "Ordered", "Received", "Cancelled"]
    autoReceiveBatchNumber: str | None = None
    autoReceiveExpiryDate: str | None = None
    locationId: str | None = None
    performedBy: str = "Elena Vance"
    performedByRole: str = "Pharmacy Stock Manager"


class DocumentUpload(BaseModel):
    fileName: str
    contentType: str = "application/octet-stream"
    dataUrl: str
    uploadedBy: str = "Elena Vance"


class AlertAcknowledge(BaseModel):
    acknowledgedBy: str = "Staff Member"


def _date_offset(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


LOCAL_STORE: dict[str, list[dict]] = {
    "locations": [
        {
            "id": "LOC-01",
            "name": "Main Clinic Supply Room",
            "code": "CLN-104",
            "zone": "Ground Floor · Room 104",
            "temperatureSpec": "18–22°C Ambient",
            "capacityNote": "Primary shelving bays A1–D4",
            "createdAt": _now_iso(),
        },
        {
            "id": "LOC-03",
            "name": "First-Aid Station North",
            "code": "FAD-N01",
            "zone": "East Triage Bay",
            "temperatureSpec": "18–24°C Ambient",
            "capacityNote": "Rapid-access cabinets 1–3",
            "createdAt": _now_iso(),
        },
    ],
    "supplies": [
        {
            "id": "SUP-101",
            "sku": "WND-GZ44",
            "name": "Sterile Gauze Pads (4×4 in)",
            "category": "Wound Care",
            "unit": "packs",
            "minStockLevel": 50,
            "defaultLocationId": "LOC-03",
            "preferredSupplier": "MedLine Clinical Supply",
            "unitCost": 6.50,
            "createdAt": _now_iso(),
        }
    ],
    "batches": [
        {
            "id": "BAT-201",
            "batchNumber": "GZ-2026-041",
            "supplyId": "SUP-101",
            "locationId": "LOC-03",
            "quantity": 32,
            "initialQuantity": 60,
            "expiryDate": _date_offset(145),
            "receivedDate": _date_offset(-30),
            "supplierName": "MedLine Clinical Supply",
        }
    ],
    "movements": [],
    "reorders": [],
    "alerts": [],
    "documents": [],
}


def _put_item(table_name: str, local_key: str, item: dict) -> None:
    if USE_AWS:
        ddb = get_dynamodb_resource()
        ddb.Table(table_name).put_item(Item=to_dynamodb_item(item))
    else:
        existing_idx = next((i for i, x in enumerate(LOCAL_STORE[local_key]) if x.get("id") == item.get("id")), -1)
        if existing_idx >= 0:
            LOCAL_STORE[local_key][existing_idx] = item
        else:
            LOCAL_STORE[local_key].insert(0, item)


def _scan_items(table_name: str, local_key: str) -> list[dict]:
    if USE_AWS:
        ddb = get_dynamodb_resource()
        items = ddb.Table(table_name).scan().get("Items", [])
        return from_dynamodb_item(items)
    return LOCAL_STORE[local_key]


def _get_item(table_name: str, local_key: str, item_id: str) -> dict | None:
    if USE_AWS:
        ddb = get_dynamodb_resource()
        res = ddb.Table(table_name).get_item(Key={"id": item_id})
        item = res.get("Item")
        return from_dynamodb_item(item) if item else None
    return next((x for x in LOCAL_STORE[local_key] if x.get("id") == item_id), None)


def _total_quantity(supply_id: str, batches: list[dict], include_expired: bool = False) -> int:
    today = date.today()
    total = 0
    for b in batches:
        if b.get("supplyId") != supply_id:
            continue
        qty = int(b.get("quantity", 0))
        if qty <= 0:
            continue
        if not include_expired:
            try:
                if date.fromisoformat(b.get("expiryDate", "")) < today:
                    continue
            except ValueError:
                pass
        total += qty
    return total


def evaluate_alerts(trigger_reason: str = "AUTO") -> list[dict]:
    supplies = _scan_items(DYNAMODB_SUPPLIES_TABLE, "supplies")
    batches = _scan_items(DYNAMODB_BATCHES_TABLE, "batches")
    today = date.today()
    now_iso = _now_iso()
    alerts: list[dict] = []

    existing_alerts = _scan_items(DYNAMODB_ALERTS_TABLE, "alerts")
    existing_map = {a.get("id"): a for a in existing_alerts}

    for supply in supplies:
        usable_qty = _total_quantity(supply["id"], batches, include_expired=False)
        min_level = int(supply.get("minStockLevel", 0))
        if usable_qty < min_level:
            is_critical = usable_qty <= (min_level // 2)
            alert_id = f"ALT-LOW-{supply['id']}"
            prev = existing_map.get(alert_id, {})
            alert = {
                "id": alert_id,
                "type": "LOW_STOCK",
                "severity": "critical" if is_critical else "warning",
                "status": "Acknowledged" if prev.get("status") == "Acknowledged" else "Active",
                "supplyId": supply["id"],
                "title": f"Low stock: {supply['name']}",
                "message": (
                    f"{supply['name']} ({supply.get('sku', '')}) has {usable_qty} usable {supply.get('unit', 'units')}, "
                    f"below minimum threshold of {min_level} {supply.get('unit', 'units')}."
                ),
                "currentValue": f"{usable_qty} {supply.get('unit', '')}",
                "thresholdValue": f"{min_level} {supply.get('unit', '')}",
                "snsTopicArn": SNS_ALERTS_TOPIC_ARN,
                "notifiedRoles": ["First-Aid Coordinator", "Pharmacy Stock Manager"],
                "createdAt": prev.get("createdAt", now_iso),
            }
            if prev.get("acknowledgedAt"):
                alert["acknowledgedAt"] = prev["acknowledgedAt"]
                alert["acknowledgedBy"] = prev.get("acknowledgedBy")
            alerts.append(alert)
            _put_item(DYNAMODB_ALERTS_TABLE, "alerts", alert)

            if alert["status"] == "Active" and prev.get("status") != "Active":
                publish_sns_alert(alert["title"], alert["message"], {"alertType": "LOW_STOCK"})

    supply_map = {s["id"]: s for s in supplies}
    for batch in batches:
        qty = int(batch.get("quantity", 0))
        if qty <= 0:
            continue
        try:
            days_left = (date.fromisoformat(batch.get("expiryDate", "")) - today).days
        except ValueError:
            continue

        supply = supply_map.get(batch.get("supplyId", ""), {"name": batch.get("supplyId", ""), "unit": "units"})
        if days_left < 0 or days_left <= 30:
            is_expired = days_left < 0
            alert_id = f"ALT-{'EXP' if is_expired else 'SOON'}-{batch['id']}"
            prev = existing_map.get(alert_id, {})
            alert = {
                "id": alert_id,
                "type": "EXPIRED" if is_expired else "EXPIRING_SOON",
                "severity": "critical" if is_expired else "warning",
                "status": "Acknowledged" if prev.get("status") == "Acknowledged" else "Active",
                "supplyId": batch.get("supplyId", ""),
                "batchId": batch["id"],
                "title": f"Expired batch: {batch.get('batchNumber')}" if is_expired else f"Expiring soon: {batch.get('batchNumber')}",
                "message": (
                    f"Batch {batch.get('batchNumber')} of {supply['name']} expired on {batch.get('expiryDate')}."
                    if is_expired
                    else f"Batch {batch.get('batchNumber')} of {supply['name']} expires in {days_left} days ({batch.get('expiryDate')})."
                ),
                "currentValue": f"{batch.get('expiryDate')} ({days_left}d)",
                "thresholdValue": "30 days warning limit",
                "snsTopicArn": SNS_ALERTS_TOPIC_ARN,
                "notifiedRoles": ["First-Aid Coordinator", "Pharmacy Stock Manager"],
                "createdAt": prev.get("createdAt", now_iso),
            }
            if prev.get("acknowledgedAt"):
                alert["acknowledgedAt"] = prev["acknowledgedAt"]
                alert["acknowledgedBy"] = prev.get("acknowledgedBy")
            alerts.append(alert)
            _put_item(DYNAMODB_ALERTS_TABLE, "alerts", alert)

            if is_expired and alert["status"] == "Active" and prev.get("status") != "Active":
                publish_sns_alert(alert["title"], alert["message"], {"alertType": "EXPIRED"})

    LOCAL_STORE["alerts"] = alerts
    return alerts


def build_full_snapshot() -> dict[str, Any]:
    alerts = evaluate_alerts("SNAPSHOT_REFRESH")
    documents = _scan_items(DYNAMODB_DOCUMENTS_TABLE, "documents")
    for doc in documents:
        if not doc.get("downloadUrl") and doc.get("s3Key"):
            doc["downloadUrl"] = generate_presigned_download_url(doc["s3Key"])
    return {
        "locations": _scan_items(DYNAMODB_LOCATIONS_TABLE, "locations"),
        "supplies": _scan_items(DYNAMODB_SUPPLIES_TABLE, "supplies"),
        "batches": _scan_items(DYNAMODB_BATCHES_TABLE, "batches"),
        "movements": _scan_items(DYNAMODB_MOVEMENTS_TABLE, "movements"),
        "reorders": _scan_items(DYNAMODB_REORDERS_TABLE, "reorders"),
        "alerts": alerts,
        "documents": documents,
        "lastMonitorRunAt": _now_iso(),
    }


# ==========================================
# API ROUTES (14 Core Endpoints matching server.ts)
# ==========================================

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "MediStock Guardian FastAPI",
        "useAws": USE_AWS,
        "mode": "aws" if USE_AWS else "local-dummy-data",
        "timestamp": _now_iso(),
    }


@app.get("/api/snapshot")
def get_snapshot():
    return build_full_snapshot()


@app.post("/api/locations", status_code=201)
def create_location(payload: LocationCreate):
    item = {
        "id": f"LOC-{uuid.uuid4().hex[:6].upper()}",
        "name": payload.name.strip(),
        "code": payload.code.strip().upper(),
        "zone": payload.zone.strip(),
        "temperatureSpec": payload.temperatureSpec.strip(),
        "capacityNote": payload.capacityNote.strip(),
        "createdAt": _now_iso(),
    }
    _put_item(DYNAMODB_LOCATIONS_TABLE, "locations", item)
    log_cloudwatch_event("LOCATION_REGISTERED", {"locationId": item["id"], "code": item["code"]})
    return {"location": item, "snapshot": build_full_snapshot()}


@app.post("/api/supplies", status_code=201)
def create_supply(payload: SupplyCreate):
    item = {
        "id": f"SUP-{uuid.uuid4().hex[:6].upper()}",
        "sku": payload.sku.strip().upper(),
        "name": payload.name.strip(),
        "category": payload.category,
        "unit": payload.unit.strip(),
        "minStockLevel": payload.minStockLevel,
        "defaultLocationId": payload.defaultLocationId,
        "preferredSupplier": payload.preferredSupplier.strip(),
        "unitCost": payload.unitCost,
        "createdAt": _now_iso(),
    }
    _put_item(DYNAMODB_SUPPLIES_TABLE, "supplies", item)
    log_cloudwatch_event("SUPPLY_REGISTERED", {"supplyId": item["id"], "sku": item["sku"]})
    return {"supply": item, "snapshot": build_full_snapshot()}


@app.patch("/api/supplies/{supply_id}")
def update_supply(supply_id: str, payload: SupplyUpdate):
    supply = _get_item(DYNAMODB_SUPPLIES_TABLE, "supplies", supply_id)
    if not supply:
        raise HTTPException(status_code=404, detail="Medical supply not found.")

    if payload.minStockLevel is not None:
        supply["minStockLevel"] = payload.minStockLevel
    if payload.preferredSupplier is not None and payload.preferredSupplier.strip():
        supply["preferredSupplier"] = payload.preferredSupplier.strip()

    _put_item(DYNAMODB_SUPPLIES_TABLE, "supplies", supply)
    log_cloudwatch_event("SUPPLY_UPDATED", {"supplyId": supply_id, "minStockLevel": supply.get("minStockLevel")})
    return {"supply": supply, "snapshot": build_full_snapshot()}


@app.post("/api/batches", status_code=201)
def create_batch(payload: BatchCreate):
    supply = _get_item(DYNAMODB_SUPPLIES_TABLE, "supplies", payload.supplyId)
    location = _get_item(DYNAMODB_LOCATIONS_TABLE, "locations", payload.locationId)
    if not supply or not location:
        raise HTTPException(status_code=400, detail="Valid supply and location are required.")

    batch = {
        "id": f"BAT-{uuid.uuid4().hex[:6].upper()}",
        "batchNumber": payload.batchNumber.strip().upper(),
        "supplyId": payload.supplyId,
        "locationId": payload.locationId,
        "quantity": payload.quantity,
        "initialQuantity": payload.quantity,
        "expiryDate": payload.expiryDate,
        "receivedDate": payload.receivedDate or date.today().isoformat(),
        "supplierName": payload.supplierName or supply.get("preferredSupplier", "MedLine Clinical Supply"),
        "notes": payload.notes,
        "documentId": payload.documentId,
    }
    _put_item(DYNAMODB_BATCHES_TABLE, "batches", batch)

    all_batches = _scan_items(DYNAMODB_BATCHES_TABLE, "batches")
    total_supply_qty = sum(int(b.get("quantity", 0)) for b in all_batches if b.get("supplyId") == payload.supplyId)

    movement = {
        "id": f"MOV-{uuid.uuid4().hex[:6].upper()}",
        "type": "IN",
        "supplyId": payload.supplyId,
        "batchId": batch["id"],
        "batchNumber": batch["batchNumber"],
        "locationId": payload.locationId,
        "quantity": payload.quantity,
        "resultingBatchQuantity": batch["quantity"],
        "resultingSupplyTotal": total_supply_qty,
        "reason": payload.notes or f"Initial receipt of batch {batch['batchNumber']}",
        "referenceCode": f"RCV-{batch['batchNumber']}",
        "performedBy": payload.performedBy,
        "performedByRole": payload.performedByRole,
        "timestamp": _now_iso(),
        "documentId": payload.documentId,
    }
    _put_item(DYNAMODB_MOVEMENTS_TABLE, "movements", movement)

    log_cloudwatch_event("BATCH_REGISTERED", {"batchId": batch["id"], "quantity": payload.quantity})
    return {"batch": batch, "movement": movement, "snapshot": build_full_snapshot()}


@app.post("/api/movements", status_code=201)
def record_movement(payload: MovementCreate):
    supply = _get_item(DYNAMODB_SUPPLIES_TABLE, "supplies", payload.supplyId)
    if not supply:
        raise HTTPException(status_code=404, detail="Selected medical supply not found.")

    batches = _scan_items(DYNAMODB_BATCHES_TABLE, "batches")
    batch: dict | None = None

    if payload.type == "IN" and payload.batchId == "__NEW__":
        if not payload.newBatchNumber or not payload.newBatchExpiryDate:
            raise HTTPException(status_code=400, detail="New batch number and expiry date are required.")
        target_location_id = payload.locationId or supply.get("defaultLocationId") or "LOC-01"
        batch = {
            "id": f"BAT-{uuid.uuid4().hex[:6].upper()}",
            "batchNumber": payload.newBatchNumber.strip().upper(),
            "supplyId": payload.supplyId,
            "locationId": target_location_id,
            "quantity": payload.quantity,
            "initialQuantity": payload.quantity,
            "expiryDate": payload.newBatchExpiryDate,
            "receivedDate": date.today().isoformat(),
            "supplierName": supply.get("preferredSupplier", "MedLine Clinical Supply"),
            "documentId": payload.documentId,
            "notes": payload.reason or None,
        }
        _put_item(DYNAMODB_BATCHES_TABLE, "batches", batch)
    else:
        batch = next((b for b in batches if b["id"] == payload.batchId and b.get("supplyId") == payload.supplyId), None)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found for this supply.")

        current_qty = int(batch.get("quantity", 0))
        if payload.type == "IN":
            batch["quantity"] = current_qty + payload.quantity
            batch["initialQuantity"] = int(batch.get("initialQuantity", current_qty)) + payload.quantity
            if payload.documentId:
                batch["documentId"] = payload.documentId
        else:
            if payload.quantity > current_qty:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot {'issue' if payload.type == 'OUT' else 'discard'} {payload.quantity}. Only {current_qty} available.",
                )
            batch["quantity"] = current_qty - payload.quantity

        _put_item(DYNAMODB_BATCHES_TABLE, "batches", batch)

    updated_batches = _scan_items(DYNAMODB_BATCHES_TABLE, "batches")
    total_after = sum(int(b.get("quantity", 0)) for b in updated_batches if b.get("supplyId") == payload.supplyId)

    movement = {
        "id": f"MOV-{uuid.uuid4().hex[:6].upper()}",
        "type": payload.type,
        "supplyId": payload.supplyId,
        "batchId": batch["id"],
        "batchNumber": batch["batchNumber"],
        "locationId": batch.get("locationId", supply.get("defaultLocationId")),
        "quantity": payload.quantity,
        "resultingBatchQuantity": batch["quantity"],
        "resultingSupplyTotal": total_after,
        "reason": payload.reason or f"Stock {payload.type}",
        "referenceCode": payload.referenceCode or f"{'RCV' if payload.type == 'IN' else 'ISS' if payload.type == 'OUT' else 'DSC'}-{uuid.uuid4().hex[:4].upper()}",
        "performedBy": payload.performedBy,
        "performedByRole": payload.performedByRole,
        "timestamp": _now_iso(),
        "documentId": payload.documentId,
    }
    _put_item(DYNAMODB_MOVEMENTS_TABLE, "movements", movement)

    log_cloudwatch_event("STOCK_MOVEMENT_RECORDED", {"movementId": movement["id"], "type": payload.type})
    return {"movement": movement, "batch": batch, "snapshot": build_full_snapshot()}


@app.post("/api/reorders", status_code=201)
def create_reorder(payload: ReorderCreate):
    supply = _get_item(DYNAMODB_SUPPLIES_TABLE, "supplies", payload.supplyId)
    if not supply:
        raise HTTPException(status_code=404, detail="Valid supply is required.")

    item = {
        "id": f"REO-{uuid.uuid4().hex[:6].upper()}",
        "supplyId": payload.supplyId,
        "requestedQuantity": payload.requestedQuantity,
        "supplierName": (payload.supplierName or supply.get("preferredSupplier", "MedLine Clinical Supply")).strip(),
        "status": "Pending",
        "requestedBy": payload.requestedBy,
        "requestedAt": _now_iso(),
        "expectedDeliveryDate": payload.expectedDeliveryDate or _date_offset(5),
        "purchaseOrderNumber": payload.purchaseOrderNumber or f"PO-{date.today().year}-{uuid.uuid4().hex[:4].upper()}",
        "notes": payload.notes,
        "documentId": payload.documentId,
    }
    _put_item(DYNAMODB_REORDERS_TABLE, "reorders", item)
    log_cloudwatch_event("REORDER_CREATED", {"reorderId": item["id"], "po": item["purchaseOrderNumber"]})
    return {"reorder": item, "snapshot": build_full_snapshot()}


@app.patch("/api/reorders/{reorder_id}")
def update_reorder(reorder_id: str, payload: ReorderUpdate):
    reorder = _get_item(DYNAMODB_REORDERS_TABLE, "reorders", reorder_id)
    if not reorder:
        raise HTTPException(status_code=404, detail="Reorder record not found.")

    prev_status = reorder.get("status")
    reorder["status"] = payload.status

    if payload.status == "Received" and prev_status != "Received":
        reorder["receivedAt"] = _now_iso()
        supply = _get_item(DYNAMODB_SUPPLIES_TABLE, "supplies", reorder["supplyId"])
        if supply:
            batch_num = payload.autoReceiveBatchNumber or f"{supply.get('sku', 'MED')[:2]}-{date.today().year}-{uuid.uuid4().hex[:3].upper()}"
            expiry_dt = payload.autoReceiveExpiryDate or _date_offset(240)
            target_loc = payload.locationId or supply.get("defaultLocationId") or "LOC-01"

            new_batch = {
                "id": f"BAT-{uuid.uuid4().hex[:6].upper()}",
                "batchNumber": batch_num.strip().upper(),
                "supplyId": supply["id"],
                "locationId": target_loc,
                "quantity": int(reorder["requestedQuantity"]),
                "initialQuantity": int(reorder["requestedQuantity"]),
                "expiryDate": expiry_dt,
                "receivedDate": date.today().isoformat(),
                "supplierName": reorder.get("supplierName", "MedLine Clinical Supply"),
                "documentId": reorder.get("documentId"),
                "notes": f"Received from {reorder.get('purchaseOrderNumber')}",
            }
            _put_item(DYNAMODB_BATCHES_TABLE, "batches", new_batch)

            all_batches = _scan_items(DYNAMODB_BATCHES_TABLE, "batches")
            total_after = sum(int(b.get("quantity", 0)) for b in all_batches if b.get("supplyId") == supply["id"])

            movement = {
                "id": f"MOV-{uuid.uuid4().hex[:6].upper()}",
                "type": "IN",
                "supplyId": supply["id"],
                "batchId": new_batch["id"],
                "batchNumber": new_batch["batchNumber"],
                "locationId": target_loc,
                "quantity": int(reorder["requestedQuantity"]),
                "resultingBatchQuantity": new_batch["quantity"],
                "resultingSupplyTotal": total_after,
                "reason": f"Reorder {reorder.get('purchaseOrderNumber')} received from {reorder.get('supplierName')}",
                "referenceCode": reorder.get("purchaseOrderNumber", "RECV"),
                "performedBy": payload.performedBy,
                "performedByRole": payload.performedByRole,
                "timestamp": _now_iso(),
                "documentId": reorder.get("documentId"),
            }
            _put_item(DYNAMODB_MOVEMENTS_TABLE, "movements", movement)

    _put_item(DYNAMODB_REORDERS_TABLE, "reorders", reorder)
    log_cloudwatch_event("REORDER_UPDATED", {"reorderId": reorder_id, "status": payload.status})
    return {"reorder": reorder, "snapshot": build_full_snapshot()}


@app.post("/api/documents", status_code=201)
def upload_document(payload: DocumentUpload):
    raw_b64 = payload.dataUrl.split(",", 1)[-1]
    file_bytes = base64.b64decode(raw_b64)
    s3_key = upload_supplier_document_to_s3(payload.fileName, file_bytes, payload.contentType)
    doc_id = f"DOC-{uuid.uuid4().hex[:6].upper()}"

    doc = {
        "id": doc_id,
        "fileName": payload.fileName.strip(),
        "contentType": payload.contentType,
        "sizeBytes": len(file_bytes),
        "s3Key": s3_key,
        "uploadedAt": _now_iso(),
        "uploadedBy": payload.uploadedBy,
        "dataUrl": payload.dataUrl,
        "downloadUrl": generate_presigned_download_url(s3_key),
    }
    _put_item(DYNAMODB_DOCUMENTS_TABLE, "documents", doc)
    log_cloudwatch_event("S3_DOCUMENT_UPLOADED", {"documentId": doc_id, "s3Key": s3_key})
    return {"document": doc, "snapshot": build_full_snapshot()}


@app.post("/api/monitor/run")
def trigger_monitor_run():
    alerts = evaluate_alerts("MANUAL_TRIGGER")
    active_count = len([a for a in alerts if a.get("status") == "Active"])
    log_cloudwatch_event("LAMBDA_MONITOR_COMPLETED", {"activeAlerts": active_count, "totalAlerts": len(alerts)})
    return {
        "checkedAt": _now_iso(),
        "activeAlerts": active_count,
        "snapshot": build_full_snapshot(),
    }


@app.patch("/api/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: str, payload: AlertAcknowledge):
    alert = _get_item(DYNAMODB_ALERTS_TABLE, "alerts", alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found.")

    alert["status"] = "Acknowledged"
    alert["acknowledgedAt"] = _now_iso()
    alert["acknowledgedBy"] = payload.acknowledgedBy
    _put_item(DYNAMODB_ALERTS_TABLE, "alerts", alert)
    log_cloudwatch_event("ALERT_ACKNOWLEDGED", {"alertId": alert_id, "by": payload.acknowledgedBy})
    return {"alert": alert, "snapshot": build_full_snapshot()}


@app.get("/api/reports/movements.csv")
def export_movements_csv():
    movements = _scan_items(DYNAMODB_MOVEMENTS_TABLE, "movements")
    supplies = {s["id"]: s for s in _scan_items(DYNAMODB_SUPPLIES_TABLE, "supplies")}
    locations = {l["id"]: l for l in _scan_items(DYNAMODB_LOCATIONS_TABLE, "locations")}

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Movement ID", "Timestamp", "Type", "SKU", "Supply Name",
        "Batch Number", "Location", "Quantity", "Unit", "Resulting Batch Qty",
        "Resulting Supply Total", "Reference", "Reason", "Performed By", "Role"
    ])
    for m in movements:
        sup = supplies.get(m.get("supplyId"), {})
        loc = locations.get(m.get("locationId"), {})
        qty_str = f"+{m.get('quantity')}" if m.get("type") == "IN" else f"-{m.get('quantity')}"
        writer.writerow([
            m.get("id"), m.get("timestamp"), m.get("type"), sup.get("sku", ""),
            sup.get("name", ""), m.get("batchNumber", ""), loc.get("name", ""),
            qty_str, sup.get("unit", ""), m.get("resultingBatchQuantity"),
            m.get("resultingSupplyTotal"), m.get("referenceCode"), m.get("reason"),
            m.get("performedBy"), m.get("performedByRole")
        ])
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="medistock-movements-report.csv"'},
    )


@app.get("/api/reports/inventory.csv")
def export_inventory_csv():
    supplies = _scan_items(DYNAMODB_SUPPLIES_TABLE, "supplies")
    batches = _scan_items(DYNAMODB_BATCHES_TABLE, "batches")
    locations = {l["id"]: l for l in _scan_items(DYNAMODB_LOCATIONS_TABLE, "locations")}

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "SKU", "Supply Name", "Category", "Default Location", "Unit",
        "Total On-Hand", "Minimum Level", "Unit Cost (USD)", "Estimated Value (USD)", "Preferred Supplier"
    ])
    for s in supplies:
        total = sum(int(b.get("quantity", 0)) for b in batches if b.get("supplyId") == s["id"])
        loc = locations.get(s.get("defaultLocationId"), {})
        unit_cost = float(s.get("unitCost", 0.0))
        est_val = round(total * unit_cost, 2)
        writer.writerow([
            s.get("sku"), s.get("name"), s.get("category"), loc.get("name", ""),
            s.get("unit"), total, s.get("minStockLevel"), f"{unit_cost:.2f}",
            f"{est_val:.2f}", s.get("preferredSupplier")
        ])
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="medistock-inventory-summary.csv"'},
    )
