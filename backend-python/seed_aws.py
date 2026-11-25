"""Seed Amazon DynamoDB tables for MediStock Guardian with initial clinical data."""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone

import boto3
from dotenv import load_dotenv

from aws_services import to_dynamodb_item

load_dotenv()

AWS_REGION = os.getenv("AWS_REGION", "ap-south-2")
DYNAMODB_LOCATIONS_TABLE = os.getenv("DYNAMODB_LOCATIONS_TABLE", "MediStock_Locations")
DYNAMODB_SUPPLIES_TABLE = os.getenv("DYNAMODB_SUPPLIES_TABLE", "MediStock_Supplies")
DYNAMODB_BATCHES_TABLE = os.getenv("DYNAMODB_BATCHES_TABLE", "MediStock_Batches")
DYNAMODB_MOVEMENTS_TABLE = os.getenv("DYNAMODB_MOVEMENTS_TABLE", "MediStock_Movements")
DYNAMODB_REORDERS_TABLE = os.getenv("DYNAMODB_REORDERS_TABLE", "MediStock_Reorders")
DYNAMODB_ALERTS_TABLE = os.getenv("DYNAMODB_ALERTS_TABLE", "MediStock_Alerts")
DYNAMODB_DOCUMENTS_TABLE = os.getenv("DYNAMODB_DOCUMENTS_TABLE", "MediStock_Documents")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def date_offset(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


SEED_LOCATIONS = [
    {
        "id": "LOC-01",
        "name": "Main Clinic Supply Room",
        "code": "CLN-104",
        "zone": "Ground Floor · Room 104",
        "temperatureSpec": "18–22°C Ambient",
        "capacityNote": "Primary shelving bays A1–D4",
        "createdAt": now_iso(),
    },
    {
        "id": "LOC-02",
        "name": "Pharmacy Temperature-Controlled Depot",
        "code": "PHM-DEP",
        "zone": "Basement Wing B",
        "temperatureSpec": "2–8°C Cold Chain & 15–25°C Dry",
        "capacityNote": "Refrigerated lockers R1–R3, secure racks 1–8",
        "createdAt": now_iso(),
    },
    {
        "id": "LOC-03",
        "name": "First-Aid Station North",
        "code": "FAD-N01",
        "zone": "East Triage Bay",
        "temperatureSpec": "18–24°C Ambient",
        "capacityNote": "Rapid-access cabinets 1–3",
        "createdAt": now_iso(),
    },
    {
        "id": "LOC-04",
        "name": "Emergency Ward Crash Cart Staging",
        "code": "EMG-CRT",
        "zone": "Acute Care Corridor",
        "temperatureSpec": "Ambient Clinical",
        "capacityNote": "Dedicated mobile crash carts CC-1 to CC-4",
        "createdAt": now_iso(),
    },
]

SEED_SUPPLIES = [
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
        "createdAt": now_iso(),
    },
    {
        "id": "SUP-102",
        "sku": "PPE-GLV-M",
        "name": "Nitrile Examination Gloves (Medium)",
        "category": "PPE",
        "unit": "boxes",
        "minStockLevel": 40,
        "defaultLocationId": "LOC-01",
        "preferredSupplier": "Healthcare Safety Solutions",
        "unitCost": 14.80,
        "createdAt": now_iso(),
    },
    {
        "id": "SUP-103",
        "sku": "INJ-SYR-5",
        "name": "Disposable Syringes (5 mL w/ 22G needle)",
        "category": "Injection Supplies",
        "unit": "boxes",
        "minStockLevel": 30,
        "defaultLocationId": "LOC-02",
        "preferredSupplier": "BD Bioscience Dist.",
        "unitCost": 22.00,
        "createdAt": now_iso(),
    },
    {
        "id": "SUP-104",
        "sku": "ANT-POVI-500",
        "name": "Povidone-Iodine Antiseptic Solution 10% (500 mL)",
        "category": "Antiseptics",
        "unit": "bottles",
        "minStockLevel": 20,
        "defaultLocationId": "LOC-01",
        "preferredSupplier": "MedLine Clinical Supply",
        "unitCost": 11.25,
        "createdAt": now_iso(),
    },
    {
        "id": "SUP-105",
        "sku": "FA-TOUR-GEN",
        "name": "Combat Application Tourniquet (C-A-T Gen 7)",
        "category": "First Aid",
        "unit": "units",
        "minStockLevel": 15,
        "defaultLocationId": "LOC-04",
        "preferredSupplier": "Emergency Trauma Gear",
        "unitCost": 29.50,
        "createdAt": now_iso(),
    },
]

SEED_BATCHES = [
    {
        "id": "BAT-201",
        "batchNumber": "GZ-2026-041",
        "supplyId": "SUP-101",
        "locationId": "LOC-03",
        "quantity": 32,
        "initialQuantity": 60,
        "expiryDate": date_offset(145),
        "receivedDate": date_offset(-30),
        "supplierName": "MedLine Clinical Supply",
    },
    {
        "id": "BAT-202",
        "batchNumber": "GLV-26M-09",
        "supplyId": "SUP-102",
        "locationId": "LOC-01",
        "quantity": 48,
        "initialQuantity": 50,
        "expiryDate": date_offset(380),
        "receivedDate": date_offset(-12),
        "supplierName": "Healthcare Safety Solutions",
    },
    {
        "id": "BAT-203",
        "batchNumber": "SYR-25-884",
        "supplyId": "SUP-103",
        "locationId": "LOC-02",
        "quantity": 18,
        "initialQuantity": 30,
        "expiryDate": date_offset(22),  # Expiring soon (<30 days)
        "receivedDate": date_offset(-180),
        "supplierName": "BD Bioscience Dist.",
    },
    {
        "id": "BAT-204",
        "batchNumber": "POV-24-118",
        "supplyId": "SUP-104",
        "locationId": "LOC-01",
        "quantity": 6,
        "initialQuantity": 25,
        "expiryDate": date_offset(-5),  # Expired
        "receivedDate": date_offset(-365),
        "supplierName": "MedLine Clinical Supply",
    },
]


def seed_all():
    print(f"Connecting to DynamoDB in {AWS_REGION}...")
    ddb = boto3.resource("dynamodb", region_name=AWS_REGION)

    def populate(table_name: str, items: list[dict]):
        print(f"Seeding table {table_name} with {len(items)} items...")
        table = ddb.Table(table_name)
        for it in items:
            table.put_item(Item=to_dynamodb_item(it))
        print(f"  -> {table_name} OK")

    populate(DYNAMODB_LOCATIONS_TABLE, SEED_LOCATIONS)
    populate(DYNAMODB_SUPPLIES_TABLE, SEED_SUPPLIES)
    populate(DYNAMODB_BATCHES_TABLE, SEED_BATCHES)
    print("Database seeding completed successfully!")


if __name__ == "__main__":
    seed_all()
