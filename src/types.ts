export type StaffRole =
  | 'Clinic Inventory Staff'
  | 'Pharmacy Stock Manager'
  | 'First-Aid Coordinator';

export interface StaffUser {
  id: string;
  name: string;
  role: StaffRole;
  email: string;
  iamRoleName: string;
  permissions: string[];
}

export interface StorageLocation {
  id: string;
  name: string;
  code: string;
  zone: string;
  temperatureSpec: string;
  capacityNote: string;
  createdAt: string;
}

export type SupplyCategory =
  | 'Wound Care'
  | 'PPE'
  | 'Injection Supplies'
  | 'First Aid'
  | 'Antiseptics'
  | 'Diagnostics';

export interface MedicalSupply {
  id: string;
  sku: string;
  name: string;
  category: SupplyCategory;
  unit: string;
  minStockLevel: number;
  defaultLocationId: string;
  preferredSupplier: string;
  unitCost: number;
  createdAt: string;
}

export interface SupplierDocument {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  s3Key: string;
  uploadedAt: string;
  uploadedBy: string;
  dataUrl?: string;
}

export interface InventoryBatch {
  id: string;
  batchNumber: string;
  supplyId: string;
  locationId: string;
  quantity: number;
  initialQuantity: number;
  expiryDate: string; // YYYY-MM-DD
  receivedDate: string; // YYYY-MM-DD
  supplierName: string;
  documentId?: string;
  notes?: string;
}

export type MovementType = 'IN' | 'OUT' | 'DISCARDED';

export interface StockMovement {
  id: string;
  type: MovementType;
  supplyId: string;
  batchId: string;
  batchNumber: string;
  locationId: string;
  quantity: number;
  resultingBatchQuantity: number;
  resultingSupplyTotal: number;
  reason: string;
  referenceCode: string;
  performedBy: string;
  performedByRole: StaffRole;
  timestamp: string; // ISO string
  documentId?: string;
}

export type ReorderStatus = 'Pending' | 'Ordered' | 'Received' | 'Cancelled';

export interface ReorderRecord {
  id: string;
  supplyId: string;
  requestedQuantity: number;
  supplierName: string;
  status: ReorderStatus;
  requestedBy: string;
  requestedAt: string;
  expectedDeliveryDate: string;
  receivedAt?: string;
  purchaseOrderNumber: string;
  notes?: string;
  documentId?: string;
}

export type AlertType = 'LOW_STOCK' | 'EXPIRING_SOON' | 'EXPIRED';
export type AlertSeverity = 'warning' | 'critical';
export type AlertStatus = 'Active' | 'Acknowledged' | 'Resolved';

export interface NotificationAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  supplyId: string;
  batchId?: string;
  title: string;
  message: string;
  currentValue: string;
  thresholdValue: string;
  snsTopicArn: string;
  notifiedRoles: StaffRole[];
  createdAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
}

export interface InventorySnapshot {
  locations: StorageLocation[];
  supplies: MedicalSupply[];
  batches: InventoryBatch[];
  movements: StockMovement[];
  reorders: ReorderRecord[];
  alerts: NotificationAlert[];
  documents: SupplierDocument[];
  lastMonitorRunAt: string;
}

export type ScreenId =
  | 'dashboard'
  | 'batches'
  | 'stock-form'
  | 'expiry-calendar'
  | 'reorders'
  | 'alerts'
  | 'history'
  | 'reports';
