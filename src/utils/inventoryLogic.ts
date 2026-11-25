import type {
  InventoryBatch,
  InventorySnapshot,
  MedicalSupply,
  NotificationAlert,
  StaffRole,
} from '../types.ts';

export const EXPIRY_WARNING_DAYS = 30;
export const DEFAULT_SNS_TOPIC_ARN =
  'arn:aws:sns:ap-south-2:123456789012:MediStockAlertsTopic';

export type BatchHealthStatus = 'Expired' | 'Expiring Soon' | 'Healthy' | 'Depleted';

export function getDaysUntilExpiry(expiryDate: string): number {
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const parts = expiryDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return 0;
  const expiryUtc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  return Math.round((expiryUtc - todayUtc) / (1000 * 60 * 60 * 24));
}

export function getBatchHealthStatus(batch: InventoryBatch): BatchHealthStatus {
  if (batch.quantity <= 0) return 'Depleted';
  const days = getDaysUntilExpiry(batch.expiryDate);
  if (days < 0) return 'Expired';
  if (days <= EXPIRY_WARNING_DAYS) return 'Expiring Soon';
  return 'Healthy';
}

export function getSupplyTotalQuantity(
  supplyId: string,
  batches: InventoryBatch[],
  includeExpired = false
): number {
  return batches
    .filter((b) => {
      if (b.supplyId !== supplyId || b.quantity <= 0) return false;
      if (!includeExpired && getDaysUntilExpiry(b.expiryDate) < 0) return false;
      return true;
    })
    .reduce((sum, b) => sum + b.quantity, 0);
}

export function getSupplyTotalAllQuantity(
  supplyId: string,
  batches: InventoryBatch[]
): number {
  return batches
    .filter((b) => b.supplyId === supplyId)
    .reduce((sum, b) => sum + b.quantity, 0);
}

export function getSupplyStockStatus(
  supply: MedicalSupply,
  usableQuantity: number
): 'Critical Shortage' | 'Low Stock' | 'In Stock' {
  if (usableQuantity <= Math.floor(supply.minStockLevel * 0.5)) {
    return 'Critical Shortage';
  }
  if (usableQuantity < supply.minStockLevel) {
    return 'Low Stock';
  }
  return 'In Stock';
}

/**
 * Mirrors the AWS Lambda automated expiry & low-stock monitoring function.
 * Evaluates every supply against its minimum stock level and every active batch
 * against the 30-day expiry window, preserving acknowledgment states for unchanged alerts.
 */
export function evaluateInventoryAlerts(
  snapshot: InventorySnapshot,
  snsTopicArn = DEFAULT_SNS_TOPIC_ARN
): NotificationAlert[] {
  const existingById = new Map(snapshot.alerts.map((a) => [a.id, a]));
  const nextAlerts: NotificationAlert[] = [];
  const nowIso = new Date().toISOString();

  // 1. Low-stock monitoring across supplies (usable non-expired units)
  for (const supply of snapshot.supplies) {
    const usableQty = getSupplyTotalQuantity(supply.id, snapshot.batches, false);
    const alertId = `ALT-LOW-${supply.id}`;
    const existing = existingById.get(alertId);

    if (usableQty < supply.minStockLevel) {
      const isCritical = usableQty <= Math.floor(supply.minStockLevel * 0.5);
      const notifiedRoles: StaffRole[] = [
        'First-Aid Coordinator',
        'Pharmacy Stock Manager',
      ];
      nextAlerts.push({
        id: alertId,
        type: 'LOW_STOCK',
        severity: isCritical ? 'critical' : 'warning',
        status: existing?.status === 'Acknowledged' ? 'Acknowledged' : 'Active',
        supplyId: supply.id,
        title: `Low stock: ${supply.name}`,
        message: `${supply.name} (${supply.sku}) has ${usableQty} usable ${supply.unit}, below the minimum threshold of ${supply.minStockLevel} ${supply.unit}. Initiate a replenishment reorder.`,
        currentValue: `${usableQty} ${supply.unit}`,
        thresholdValue: `Min ${supply.minStockLevel} ${supply.unit}`,
        snsTopicArn,
        notifiedRoles,
        createdAt: existing?.createdAt ?? nowIso,
        acknowledgedAt: existing?.acknowledgedAt,
        acknowledgedBy: existing?.acknowledgedBy,
      });
    }
  }

  // 2. Expiry monitoring across non-depleted batches
  const supplyById = new Map(snapshot.supplies.map((s) => [s.id, s]));
  for (const batch of snapshot.batches) {
    if (batch.quantity <= 0) continue;
    const supply = supplyById.get(batch.supplyId);
    if (!supply) continue;
    const days = getDaysUntilExpiry(batch.expiryDate);

    if (days < 0) {
      const alertId = `ALT-EXP-${batch.id}`;
      const existing = existingById.get(alertId);
      nextAlerts.push({
        id: alertId,
        type: 'EXPIRED',
        severity: 'critical',
        status: existing?.status === 'Acknowledged' ? 'Acknowledged' : 'Active',
        supplyId: supply.id,
        batchId: batch.id,
        title: `Expired batch: ${batch.batchNumber}`,
        message: `${batch.quantity} ${supply.unit} of ${supply.name} (Batch ${batch.batchNumber}) expired ${Math.abs(days)} day(s) ago on ${batch.expiryDate}. Quarantine and record as discarded.`,
        currentValue: `Expired ${Math.abs(days)}d ago`,
        thresholdValue: batch.expiryDate,
        snsTopicArn,
        notifiedRoles: ['Pharmacy Stock Manager', 'Clinic Inventory Staff'],
        createdAt: existing?.createdAt ?? nowIso,
        acknowledgedAt: existing?.acknowledgedAt,
        acknowledgedBy: existing?.acknowledgedBy,
      });
    } else if (days <= EXPIRY_WARNING_DAYS) {
      const alertId = `ALT-SOON-${batch.id}`;
      const existing = existingById.get(alertId);
      nextAlerts.push({
        id: alertId,
        type: 'EXPIRING_SOON',
        severity: days <= 10 ? 'critical' : 'warning',
        status: existing?.status === 'Acknowledged' ? 'Acknowledged' : 'Active',
        supplyId: supply.id,
        batchId: batch.id,
        title: `Expiring soon: ${batch.batchNumber}`,
        message: `${batch.quantity} ${supply.unit} of ${supply.name} (Batch ${batch.batchNumber}) expires in ${days} day(s) on ${batch.expiryDate}. Prioritize FEFO issue or schedule replacement.`,
        currentValue: `${days}d remaining`,
        thresholdValue: batch.expiryDate,
        snsTopicArn,
        notifiedRoles: ['Pharmacy Stock Manager', 'First-Aid Coordinator'],
        createdAt: existing?.createdAt ?? nowIso,
        acknowledgedAt: existing?.acknowledgedAt,
        acknowledgedBy: existing?.acknowledgedBy,
      });
    }
  }

  // Sort: Active first, critical before warning, then newest
  return nextAlerts.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'Active' ? -1 : 1;
    }
    if (a.severity !== b.severity) {
      return a.severity === 'critical' ? -1 : 1;
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function formatShortDate(dateStr: string): string {
  if (!dateStr) return '—';
  const date = dateStr.includes('T') ? new Date(dateStr) : new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(isoStr: string): string {
  if (!isoStr) return '—';
  const date = new Date(isoStr);
  if (Number.isNaN(date.getTime())) return isoStr;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}
