import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { createInitialSeedData } from './src/data/seedData.ts';
import {
  DEFAULT_SNS_TOPIC_ARN,
  evaluateInventoryAlerts,
  getSupplyTotalAllQuantity,
} from './src/utils/inventoryLogic.ts';
import type {
  InventoryBatch,
  InventorySnapshot,
  MedicalSupply,
  MovementType,
  ReorderRecord,
  ReorderStatus,
  StaffRole,
  StockMovement,
  StorageLocation,
  SupplierDocument,
} from './src/types.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'medistock-store.json');
const PORT = Number(process.env.PORT || 3000);
const SNS_TOPIC_ARN = process.env.SNS_ALERTS_TOPIC_ARN || DEFAULT_SNS_TOPIC_ARN;
const S3_BUCKET = process.env.S3_DOCUMENTS_BUCKET || 'medistock-guardian-supplier-docs';
const CLOUDWATCH_GROUP = process.env.CLOUDWATCH_LOG_GROUP || '/medistock-guardian/application';

function logCloudWatchEvent(event: string, detail: Record<string, unknown>): void {
  const payload = {
    timestamp: new Date().toISOString(),
    logGroup: CLOUDWATCH_GROUP,
    service: 'medistock-guardian-api',
    event,
    ...detail,
  };
  console.log(JSON.stringify(payload));
}

function loadStore(): InventorySnapshot {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (fs.existsSync(STORE_PATH)) {
    try {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as InventorySnapshot;
      if (parsed && Array.isArray(parsed.supplies) && Array.isArray(parsed.batches)) {
        parsed.alerts = evaluateInventoryAlerts(parsed, SNS_TOPIC_ARN);
        return parsed;
      }
    } catch (err) {
      logCloudWatchEvent('STORE_LOAD_FALLBACK', { error: String(err) });
    }
  }
  const initial = createInitialSeedData();
  initial.alerts = evaluateInventoryAlerts(initial, SNS_TOPIC_ARN);
  saveStore(initial);
  return initial;
}

function saveStore(snapshot: InventorySnapshot): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');
}

function generateId(prefix: string): string {
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  const timePart = Date.now().toString().slice(-3);
  return `${prefix}-${timePart}${randomPart}`;
}

function csvEscape(value: unknown): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

let store: InventorySnapshot = loadStore();

function refreshAlertsAndSave(triggerReason: string): void {
  const previousIds = new Set(store.alerts.map((a) => a.id));
  store.alerts = evaluateInventoryAlerts(store, SNS_TOPIC_ARN);
  store.lastMonitorRunAt = new Date().toISOString();

  const newlyTriggered = store.alerts.filter(
    (a) => a.status === 'Active' && !previousIds.has(a.id)
  );
  if (newlyTriggered.length > 0) {
    logCloudWatchEvent('SNS_ALERT_DISPATCHED', {
      triggerReason,
      snsTopicArn: SNS_TOPIC_ARN,
      alertCount: newlyTriggered.length,
      alertTitles: newlyTriggered.map((a) => a.title),
    });
  }
  saveStore(store);
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Health endpoint for EC2 / ALB checks
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'MediStock Guardian',
      mode: process.env.USE_AWS === 'true' ? 'aws' : 'local-dummy-data',
      timestamp: new Date().toISOString(),
    });
  });

  // Full inventory snapshot
  app.get('/api/snapshot', (_req, res) => {
    store.alerts = evaluateInventoryAlerts(store, SNS_TOPIC_ARN);
    res.json(store);
  });

  // Register a storage location
  app.post('/api/locations', (req, res) => {
    const { name, code, zone, temperatureSpec, capacityNote } = req.body as Partial<StorageLocation>;
    if (!name?.trim() || !code?.trim() || !zone?.trim()) {
      res.status(400).json({ error: 'Location name, code, and zone are required.' });
      return;
    }

    const newLocation: StorageLocation = {
      id: generateId('LOC'),
      name: name.trim(),
      code: code.trim().toUpperCase(),
      zone: zone.trim(),
      temperatureSpec: (temperatureSpec || '18–22°C Ambient').trim(),
      capacityNote: (capacityNote || 'Standard clinical shelving').trim(),
      createdAt: new Date().toISOString(),
    };

    store.locations.push(newLocation);
    saveStore(store);
    logCloudWatchEvent('LOCATION_REGISTERED', { locationId: newLocation.id, code: newLocation.code });
    res.status(201).json({ location: newLocation, snapshot: store });
  });

  // Register a medical supply
  app.post('/api/supplies', (req, res) => {
    const {
      sku,
      name,
      category,
      unit,
      minStockLevel,
      defaultLocationId,
      preferredSupplier,
      unitCost,
    } = req.body as Partial<MedicalSupply>;

    if (!name?.trim() || !sku?.trim() || !category || !unit?.trim()) {
      res.status(400).json({ error: 'SKU, supply name, category, and unit are required.' });
      return;
    }
    const parsedMin = Number(minStockLevel);
    if (Number.isNaN(parsedMin) || parsedMin < 0) {
      res.status(400).json({ error: 'Minimum stock level must be zero or greater.' });
      return;
    }

    const newSupply: MedicalSupply = {
      id: generateId('SUP'),
      sku: sku.trim().toUpperCase(),
      name: name.trim(),
      category,
      unit: unit.trim(),
      minStockLevel: parsedMin,
      defaultLocationId: defaultLocationId || store.locations[0]?.id || '',
      preferredSupplier: (preferredSupplier || 'MedLine Clinical Supply').trim(),
      unitCost: Number(unitCost) > 0 ? Number(unitCost) : 5.0,
      createdAt: new Date().toISOString(),
    };

    store.supplies.push(newSupply);
    refreshAlertsAndSave('SUPPLY_REGISTERED');
    logCloudWatchEvent('SUPPLY_REGISTERED', { supplyId: newSupply.id, sku: newSupply.sku });
    res.status(201).json({ supply: newSupply, snapshot: store });
  });

  // Update minimum stock level or supply details
  app.patch('/api/supplies/:id', (req, res) => {
    const supply = store.supplies.find((s) => s.id === req.params.id);
    if (!supply) {
      res.status(404).json({ error: 'Medical supply not found.' });
      return;
    }
    if (req.body.minStockLevel !== undefined) {
      const minVal = Number(req.body.minStockLevel);
      if (Number.isNaN(minVal) || minVal < 0) {
        res.status(400).json({ error: 'Invalid minimum stock level.' });
        return;
      }
      supply.minStockLevel = minVal;
    }
    if (typeof req.body.preferredSupplier === 'string' && req.body.preferredSupplier.trim()) {
      supply.preferredSupplier = req.body.preferredSupplier.trim();
    }
    refreshAlertsAndSave('SUPPLY_UPDATED');
    logCloudWatchEvent('SUPPLY_UPDATED', { supplyId: supply.id, minStockLevel: supply.minStockLevel });
    res.json({ supply, snapshot: store });
  });

  // Upload supplier document (Amazon S3 integration / local store)
  app.post('/api/documents', (req, res) => {
    const { fileName, contentType, dataUrl, uploadedBy } = req.body as {
      fileName?: string;
      contentType?: string;
      dataUrl?: string;
      uploadedBy?: string;
    };

    if (!fileName?.trim() || !dataUrl) {
      res.status(400).json({ error: 'File name and file payload are required.' });
      return;
    }

    const sanitizedName = fileName.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
    const year = new Date().getFullYear();
    const doc: SupplierDocument = {
      id: generateId('DOC'),
      fileName: fileName.trim(),
      contentType: contentType || 'application/octet-stream',
      sizeBytes: Math.round((dataUrl.length * 3) / 4),
      s3Key: `supplier-docs/${year}/${Date.now()}_${sanitizedName}`,
      uploadedAt: new Date().toISOString(),
      uploadedBy: uploadedBy || 'Staff Member',
      dataUrl,
    };

    store.documents.unshift(doc);
    saveStore(store);
    logCloudWatchEvent('S3_DOCUMENT_UPLOADED', {
      bucket: S3_BUCKET,
      s3Key: doc.s3Key,
      documentId: doc.id,
    });
    res.status(201).json({ document: doc, snapshot: store });
  });

  // Register a new batch (and automatically log an IN stock movement)
  app.post('/api/batches', (req, res) => {
    const {
      batchNumber,
      supplyId,
      locationId,
      quantity,
      expiryDate,
      receivedDate,
      supplierName,
      notes,
      documentId,
      performedBy,
      performedByRole,
    } = req.body as Partial<InventoryBatch> & {
      performedBy?: string;
      performedByRole?: StaffRole;
    };

    const supply = store.supplies.find((s) => s.id === supplyId);
    const location = store.locations.find((l) => l.id === locationId);
    const qty = Number(quantity);

    if (!batchNumber?.trim() || !supply || !location || !expiryDate || Number.isNaN(qty) || qty <= 0) {
      res.status(400).json({
        error: 'Batch number, valid supply, storage location, positive quantity, and expiry date are required.',
      });
      return;
    }

    const newBatch: InventoryBatch = {
      id: generateId('BAT'),
      batchNumber: batchNumber.trim().toUpperCase(),
      supplyId: supply.id,
      locationId: location.id,
      quantity: qty,
      initialQuantity: qty,
      expiryDate,
      receivedDate: receivedDate || new Date().toISOString().slice(0, 10),
      supplierName: (supplierName || supply.preferredSupplier).trim(),
      documentId,
      notes: notes?.trim() || undefined,
    };

    store.batches.unshift(newBatch);

    const totalAfter = getSupplyTotalAllQuantity(supply.id, store.batches);
    const movement: StockMovement = {
      id: generateId('MOV'),
      type: 'IN',
      supplyId: supply.id,
      batchId: newBatch.id,
      batchNumber: newBatch.batchNumber,
      locationId: location.id,
      quantity: qty,
      resultingBatchQuantity: newBatch.quantity,
      resultingSupplyTotal: totalAfter,
      reason: notes?.trim() || `Initial receipt of batch ${newBatch.batchNumber}`,
      referenceCode: `RCV-${newBatch.batchNumber}`,
      performedBy: performedBy || 'Elena Vance',
      performedByRole: performedByRole || 'Pharmacy Stock Manager',
      timestamp: new Date().toISOString(),
      documentId,
    };
    store.movements.unshift(movement);

    refreshAlertsAndSave('BATCH_REGISTERED');
    logCloudWatchEvent('BATCH_REGISTERED', {
      batchId: newBatch.id,
      batchNumber: newBatch.batchNumber,
      supplyId: supply.id,
      quantity: qty,
    });
    res.status(201).json({ batch: newBatch, movement, snapshot: store });
  });

  // Record Stock-In, Stock-Out, or Discarded movement
  app.post('/api/movements', (req, res) => {
    const {
      type,
      supplyId,
      batchId,
      newBatchNumber,
      newBatchExpiryDate,
      locationId,
      quantity,
      reason,
      referenceCode,
      performedBy,
      performedByRole,
      documentId,
    } = req.body as {
      type?: MovementType;
      supplyId?: string;
      batchId?: string;
      newBatchNumber?: string;
      newBatchExpiryDate?: string;
      locationId?: string;
      quantity?: number;
      reason?: string;
      referenceCode?: string;
      performedBy?: string;
      performedByRole?: StaffRole;
      documentId?: string;
    };

    const qty = Number(quantity);
    if (!type || !['IN', 'OUT', 'DISCARDED'].includes(type)) {
      res.status(400).json({ error: 'Movement type must be IN, OUT, or DISCARDED.' });
      return;
    }
    if (Number.isNaN(qty) || qty <= 0) {
      res.status(400).json({ error: 'Quantity must be a positive number.' });
      return;
    }

    const supply = store.supplies.find((s) => s.id === supplyId);
    if (!supply) {
      res.status(404).json({ error: 'Selected medical supply not found.' });
      return;
    }

    let batch: InventoryBatch | undefined;

    if (type === 'IN' && batchId === '__NEW__') {
      if (!newBatchNumber?.trim() || !newBatchExpiryDate) {
        res.status(400).json({ error: 'New batch number and expiry date are required for new batch receipt.' });
        return;
      }
      const targetLocationId = locationId || supply.defaultLocationId || store.locations[0]?.id;
      batch = {
        id: generateId('BAT'),
        batchNumber: newBatchNumber.trim().toUpperCase(),
        supplyId: supply.id,
        locationId: targetLocationId,
        quantity: qty,
        initialQuantity: qty,
        expiryDate: newBatchExpiryDate,
        receivedDate: new Date().toISOString().slice(0, 10),
        supplierName: supply.preferredSupplier,
        documentId,
        notes: reason?.trim() || undefined,
      };
      store.batches.unshift(batch);
    } else {
      batch = store.batches.find((b) => b.id === batchId && b.supplyId === supply.id);
      if (!batch) {
        res.status(404).json({ error: 'Selected batch not found for this supply.' });
        return;
      }

      if (type === 'IN') {
        batch.quantity += qty;
        batch.initialQuantity += qty;
        if (documentId) batch.documentId = documentId;
      } else {
        if (qty > batch.quantity) {
          res.status(400).json({
            error: `Cannot ${type === 'OUT' ? 'issue' : 'discard'} ${qty} ${supply.unit}. Batch ${batch.batchNumber} only has ${batch.quantity} ${supply.unit} available.`,
          });
          return;
        }
        batch.quantity -= qty;
      }
    }

    const totalAfter = getSupplyTotalAllQuantity(supply.id, store.batches);
    const movement: StockMovement = {
      id: generateId('MOV'),
      type,
      supplyId: supply.id,
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      locationId: batch.locationId,
      quantity: qty,
      resultingBatchQuantity: batch.quantity,
      resultingSupplyTotal: totalAfter,
      reason:
        reason?.trim() ||
        (type === 'IN'
          ? 'Supplier shipment received'
          : type === 'OUT'
            ? 'Issued to clinical unit'
            : 'Expired or damaged stock discarded'),
      referenceCode:
        referenceCode?.trim() ||
        `${type === 'IN' ? 'RCV' : type === 'OUT' ? 'ISS' : 'DSC'}-${Math.floor(1000 + Math.random() * 9000)}`,
      performedBy: performedBy || 'Marcus Reid',
      performedByRole: performedByRole || 'Clinic Inventory Staff',
      timestamp: new Date().toISOString(),
      documentId,
    };

    store.movements.unshift(movement);
    refreshAlertsAndSave(`MOVEMENT_${type}`);
    logCloudWatchEvent('STOCK_MOVEMENT_RECORDED', {
      movementId: movement.id,
      type,
      supplyId: supply.id,
      batchNumber: batch.batchNumber,
      quantity: qty,
      resultingBatchQuantity: batch.quantity,
    });
    res.status(201).json({ movement, batch, snapshot: store });
  });

  // Record a reorder
  app.post('/api/reorders', (req, res) => {
    const {
      supplyId,
      requestedQuantity,
      supplierName,
      expectedDeliveryDate,
      purchaseOrderNumber,
      requestedBy,
      notes,
      documentId,
    } = req.body as Partial<ReorderRecord>;

    const supply = store.supplies.find((s) => s.id === supplyId);
    const qty = Number(requestedQuantity);

    if (!supply || Number.isNaN(qty) || qty <= 0) {
      res.status(400).json({ error: 'Valid supply and positive reorder quantity are required.' });
      return;
    }

    const defaultExpected = new Date();
    defaultExpected.setDate(defaultExpected.getDate() + 5);

    const reorder: ReorderRecord = {
      id: generateId('REO'),
      supplyId: supply.id,
      requestedQuantity: qty,
      supplierName: (supplierName || supply.preferredSupplier).trim(),
      status: 'Pending',
      requestedBy: requestedBy || 'Priya Nair',
      requestedAt: new Date().toISOString(),
      expectedDeliveryDate: expectedDeliveryDate || defaultExpected.toISOString().slice(0, 10),
      purchaseOrderNumber:
        purchaseOrderNumber?.trim() || `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      notes: notes?.trim() || undefined,
      documentId,
    };

    store.reorders.unshift(reorder);
    saveStore(store);
    logCloudWatchEvent('REORDER_CREATED', {
      reorderId: reorder.id,
      supplyId: supply.id,
      quantity: qty,
      po: reorder.purchaseOrderNumber,
    });
    res.status(201).json({ reorder, snapshot: store });
  });

  // Update reorder status (and optionally receive stock into inventory)
  app.patch('/api/reorders/:id', (req, res) => {
    const reorder = store.reorders.find((r) => r.id === req.params.id);
    if (!reorder) {
      res.status(404).json({ error: 'Reorder record not found.' });
      return;
    }

    const { status, autoReceiveBatchNumber, autoReceiveExpiryDate, locationId, performedBy, performedByRole } =
      req.body as {
        status?: ReorderStatus;
        autoReceiveBatchNumber?: string;
        autoReceiveExpiryDate?: string;
        locationId?: string;
        performedBy?: string;
        performedByRole?: StaffRole;
      };

    if (!status || !['Pending', 'Ordered', 'Received', 'Cancelled'].includes(status)) {
      res.status(400).json({ error: 'Valid reorder status is required.' });
      return;
    }

    const previousStatus = reorder.status;
    reorder.status = status;

    if (status === 'Received' && previousStatus !== 'Received') {
      reorder.receivedAt = new Date().toISOString();
      const supply = store.supplies.find((s) => s.id === reorder.supplyId);
      if (supply) {
        const defaultExp = new Date();
        defaultExp.setDate(defaultExp.getDate() + 240);
        const targetLoc = locationId || supply.defaultLocationId || store.locations[0]?.id;
        const batchNumber =
          autoReceiveBatchNumber?.trim().toUpperCase() ||
          `${supply.sku.slice(0, 2)}-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;

        const newBatch: InventoryBatch = {
          id: generateId('BAT'),
          batchNumber,
          supplyId: supply.id,
          locationId: targetLoc,
          quantity: reorder.requestedQuantity,
          initialQuantity: reorder.requestedQuantity,
          expiryDate: autoReceiveExpiryDate || defaultExp.toISOString().slice(0, 10),
          receivedDate: new Date().toISOString().slice(0, 10),
          supplierName: reorder.supplierName,
          documentId: reorder.documentId,
          notes: `Received from ${reorder.purchaseOrderNumber}`,
        };
        store.batches.unshift(newBatch);

        const totalAfter = getSupplyTotalAllQuantity(supply.id, store.batches);
        store.movements.unshift({
          id: generateId('MOV'),
          type: 'IN',
          supplyId: supply.id,
          batchId: newBatch.id,
          batchNumber: newBatch.batchNumber,
          locationId: targetLoc,
          quantity: reorder.requestedQuantity,
          resultingBatchQuantity: newBatch.quantity,
          resultingSupplyTotal: totalAfter,
          reason: `Reorder ${reorder.purchaseOrderNumber} received from ${reorder.supplierName}`,
          referenceCode: reorder.purchaseOrderNumber,
          performedBy: performedBy || 'Elena Vance',
          performedByRole: performedByRole || 'Pharmacy Stock Manager',
          timestamp: new Date().toISOString(),
          documentId: reorder.documentId,
        });
      }
    }

    refreshAlertsAndSave('REORDER_STATUS_UPDATED');
    logCloudWatchEvent('REORDER_UPDATED', { reorderId: reorder.id, status });
    res.json({ reorder, snapshot: store });
  });

  // Trigger automated expiry & low-stock monitor check (AWS Lambda logic)
  app.post('/api/monitor/run', (_req, res) => {
    refreshAlertsAndSave('MANUAL_LAMBDA_TRIGGER');
    logCloudWatchEvent('LAMBDA_MONITOR_COMPLETED', {
      activeAlerts: store.alerts.filter((a) => a.status === 'Active').length,
      totalAlerts: store.alerts.length,
    });
    res.json({
      checkedAt: store.lastMonitorRunAt,
      activeAlerts: store.alerts.filter((a) => a.status === 'Active').length,
      snapshot: store,
    });
  });

  // Acknowledge an alert
  app.patch('/api/alerts/:id/acknowledge', (req, res) => {
    const alert = store.alerts.find((a) => a.id === req.params.id);
    if (!alert) {
      res.status(404).json({ error: 'Alert not found.' });
      return;
    }
    alert.status = 'Acknowledged';
    alert.acknowledgedAt = new Date().toISOString();
    alert.acknowledgedBy = req.body.acknowledgedBy || 'Staff Member';
    saveStore(store);
    logCloudWatchEvent('ALERT_ACKNOWLEDGED', { alertId: alert.id, by: alert.acknowledgedBy });
    res.json({ alert, snapshot: store });
  });

  // Export Stock Movements CSV report
  app.get('/api/reports/movements.csv', (_req, res) => {
    const supplyMap = new Map(store.supplies.map((s) => [s.id, s]));
    const locationMap = new Map(store.locations.map((l) => [l.id, l]));
    const headers = [
      'Movement ID',
      'Timestamp',
      'Type',
      'SKU',
      'Supply Name',
      'Batch Number',
      'Location',
      'Quantity',
      'Unit',
      'Resulting Batch Qty',
      'Resulting Supply Total',
      'Reference',
      'Reason',
      'Performed By',
      'Role',
    ];
    const rows = store.movements.map((m) => {
      const supply = supplyMap.get(m.supplyId);
      const location = locationMap.get(m.locationId);
      return [
        m.id,
        m.timestamp,
        m.type,
        supply?.sku ?? '',
        supply?.name ?? '',
        m.batchNumber,
        location?.name ?? '',
        m.type === 'IN' ? `+${m.quantity}` : `-${m.quantity}`,
        supply?.unit ?? '',
        m.resultingBatchQuantity,
        m.resultingSupplyTotal,
        m.referenceCode,
        m.reason,
        m.performedBy,
        m.performedByRole,
      ]
        .map(csvEscape)
        .join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="medistock-movements-report.csv"');
    res.send(csv);
  });

  // Export Inventory Summary CSV report
  app.get('/api/reports/inventory.csv', (_req, res) => {
    const locationMap = new Map(store.locations.map((l) => [l.id, l]));
    const headers = [
      'SKU',
      'Supply Name',
      'Category',
      'Default Location',
      'Unit',
      'Total On-Hand',
      'Minimum Level',
      'Unit Cost (USD)',
      'Estimated Value (USD)',
      'Preferred Supplier',
    ];
    const rows = store.supplies.map((s) => {
      const total = getSupplyTotalAllQuantity(s.id, store.batches);
      const location = locationMap.get(s.defaultLocationId);
      return [
        s.sku,
        s.name,
        s.category,
        location?.name ?? '',
        s.unit,
        total,
        s.minStockLevel,
        s.unitCost.toFixed(2),
        (total * s.unitCost).toFixed(2),
        s.preferredSupplier,
      ]
        .map(csvEscape)
        .join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="medistock-inventory-summary.csv"');
    res.send(csv);
  });

  // Vite dev middleware or static dist serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });

    // When HMR is disabled in middlewareMode, Vite still injects /@vite/client
    // which attempts to open a WebSocket to port 24678. Serve a clean WebSocket-free
    // client shim that preserves CSS injection and module helpers with zero WS errors.
    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return \`\${pathname}?\${queryToInject}\${search ? '&' + search.slice(1) : ''}\${hash || ''}\`;
}
export class ErrorOverlay extends HTMLElement {}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    logCloudWatchEvent('SERVER_STARTED', { port: PORT, env: process.env.NODE_ENV || 'development' });
  });
}

startServer();