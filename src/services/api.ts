import type {
  InventorySnapshot,
  MovementType,
  ReorderStatus,
  StaffRole,
  SupplyCategory,
} from '../types.ts';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }
  return data as T;
}

export const api = {
  getSnapshot: () => requestJson<InventorySnapshot>('/api/snapshot'),

  createLocation: (payload: {
    name: string;
    code: string;
    zone: string;
    temperatureSpec: string;
    capacityNote: string;
  }) =>
    requestJson<{ snapshot: InventorySnapshot }>('/api/locations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createSupply: (payload: {
    sku: string;
    name: string;
    category: SupplyCategory;
    unit: string;
    minStockLevel: number;
    defaultLocationId: string;
    preferredSupplier: string;
    unitCost: number;
  }) =>
    requestJson<{ snapshot: InventorySnapshot }>('/api/supplies', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateSupply: (id: string, payload: { minStockLevel?: number; preferredSupplier?: string }) =>
    requestJson<{ snapshot: InventorySnapshot }>(`/api/supplies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  uploadDocument: (payload: {
    fileName: string;
    contentType: string;
    dataUrl: string;
    uploadedBy: string;
  }) =>
    requestJson<{ document: { id: string; fileName: string; s3Key: string }; snapshot: InventorySnapshot }>(
      '/api/documents',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  createBatch: (payload: {
    batchNumber: string;
    supplyId: string;
    locationId: string;
    quantity: number;
    expiryDate: string;
    supplierName: string;
    notes?: string;
    documentId?: string;
    performedBy: string;
    performedByRole: StaffRole;
  }) =>
    requestJson<{ snapshot: InventorySnapshot }>('/api/batches', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  recordMovement: (payload: {
    type: MovementType;
    supplyId: string;
    batchId: string;
    newBatchNumber?: string;
    newBatchExpiryDate?: string;
    locationId?: string;
    quantity: number;
    reason: string;
    referenceCode: string;
    performedBy: string;
    performedByRole: StaffRole;
    documentId?: string;
  }) =>
    requestJson<{ snapshot: InventorySnapshot }>('/api/movements', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createReorder: (payload: {
    supplyId: string;
    requestedQuantity: number;
    supplierName: string;
    expectedDeliveryDate: string;
    purchaseOrderNumber: string;
    requestedBy: string;
    notes?: string;
    documentId?: string;
  }) =>
    requestJson<{ snapshot: InventorySnapshot }>('/api/reorders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateReorder: (
    id: string,
    payload: {
      status: ReorderStatus;
      autoReceiveBatchNumber?: string;
      autoReceiveExpiryDate?: string;
      locationId?: string;
      performedBy: string;
      performedByRole: StaffRole;
    }
  ) =>
    requestJson<{ snapshot: InventorySnapshot }>(`/api/reorders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  runMonitorCheck: () =>
    requestJson<{ checkedAt: string; activeAlerts: number; snapshot: InventorySnapshot }>(
      '/api/monitor/run',
      { method: 'POST' }
    ),

  acknowledgeAlert: (id: string, acknowledgedBy: string) =>
    requestJson<{ snapshot: InventorySnapshot }>(`/api/alerts/${id}/acknowledge`, {
      method: 'PATCH',
      body: JSON.stringify({ acknowledgedBy }),
    }),
};
