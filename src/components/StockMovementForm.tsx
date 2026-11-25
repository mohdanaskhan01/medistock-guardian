import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Trash2,
  Upload,
} from 'lucide-react';
import type { InventorySnapshot, MovementType, StaffUser } from '../types.ts';
import {
  formatShortDate,
  getDaysUntilExpiry,
  getSupplyTotalQuantity,
} from '../utils/inventoryLogic.ts';

interface StockMovementFormProps {
  snapshot: InventorySnapshot;
  currentUser: StaffUser;
  preselectedSupplyId?: string;
  preselectedBatchId?: string;
  preselectedType?: MovementType;
  onRecordMovement: (payload: {
    type: MovementType;
    supplyId: string;
    batchId: string;
    newBatchNumber?: string;
    newBatchExpiryDate?: string;
    locationId?: string;
    quantity: number;
    reason: string;
    referenceCode: string;
    documentId?: string;
  }) => Promise<void>;
  onUploadDocument: (file: File) => Promise<{ id: string; fileName: string; s3Key: string }>;
  onViewHistory: () => void;
  onViewAlerts: () => void;
}

export const StockMovementForm: React.FC<StockMovementFormProps> = ({
  snapshot,
  currentUser,
  preselectedSupplyId,
  preselectedBatchId,
  preselectedType,
  onRecordMovement,
  onUploadDocument,
  onViewHistory,
  onViewAlerts,
}) => {
  const [movementType, setMovementType] = useState<MovementType>(preselectedType || 'OUT');
  const [supplyId, setSupplyId] = useState(preselectedSupplyId || snapshot.supplies[0]?.id || '');
  const [batchId, setBatchId] = useState(preselectedBatchId || '');
  const [newBatchNumber, setNewBatchNumber] = useState('');
  const [newBatchExpiryDate, setNewBatchExpiryDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 180);
    return d.toISOString().slice(0, 10);
  });
  const [locationId, setLocationId] = useState(snapshot.locations[0]?.id || '');
  const [quantity, setQuantity] = useState('10');
  const [referenceCode, setReferenceCode] = useState('');
  const [reason, setReason] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const selectedSupply = useMemo(
    () => snapshot.supplies.find((s) => s.id === supplyId),
    [snapshot.supplies, supplyId]
  );

  const supplyBatches = useMemo(() => {
    return snapshot.batches
      .filter((b) => b.supplyId === supplyId)
      .filter((b) => (movementType === 'IN' ? true : b.quantity > 0))
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  }, [snapshot.batches, supplyId, movementType]);

  // Keep preselection synchronized when navigating from dashboard/batches/calendar
  useEffect(() => {
    if (preselectedSupplyId) setSupplyId(preselectedSupplyId);
    if (preselectedType) setMovementType(preselectedType);
    if (preselectedBatchId) setBatchId(preselectedBatchId);
  }, [preselectedSupplyId, preselectedBatchId, preselectedType]);

  // Ensure a valid batch selection when supply or movement type changes
  useEffect(() => {
    if (selectedSupply) {
      setLocationId(selectedSupply.defaultLocationId || snapshot.locations[0]?.id || '');
    }
    if (batchId === '__NEW__' && movementType === 'IN') return;
    if (!supplyBatches.some((b) => b.id === batchId)) {
      if (supplyBatches.length > 0) {
        setBatchId(supplyBatches[0].id);
      } else if (movementType === 'IN') {
        setBatchId('__NEW__');
      } else {
        setBatchId('');
      }
    }
  }, [supplyId, movementType, supplyBatches, selectedSupply, snapshot.locations, batchId]);

  const selectedBatch = useMemo(
    () => snapshot.batches.find((b) => b.id === batchId),
    [snapshot.batches, batchId]
  );

  const currentUsableTotal = selectedSupply
    ? getSupplyTotalQuantity(selectedSupply.id, snapshot.batches, false)
    : 0;

  const parsedQty = Math.max(0, Number(quantity) || 0);
  const isSelectedBatchExpired = selectedBatch
    ? getDaysUntilExpiry(selectedBatch.expiryDate) < 0
    : false;

  const projectedSupplyTotal = useMemo(() => {
    if (!selectedSupply) return 0;
    if (movementType === 'IN') {
      if (batchId === '__NEW__') {
        const expDays = getDaysUntilExpiry(newBatchExpiryDate);
        return expDays >= 0 ? currentUsableTotal + parsedQty : currentUsableTotal;
      }
      return isSelectedBatchExpired ? currentUsableTotal : currentUsableTotal + parsedQty;
    }
    return isSelectedBatchExpired
      ? currentUsableTotal
      : Math.max(0, currentUsableTotal - parsedQty);
  }, [
    selectedSupply,
    movementType,
    batchId,
    newBatchExpiryDate,
    currentUsableTotal,
    parsedQty,
    isSelectedBatchExpired,
  ]);

  const willTriggerLowStock =
    selectedSupply !== undefined && projectedSupplyTotal < selectedSupply.minStockLevel;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    if (!selectedSupply) {
      setError('Please select a medical supply.');
      return;
    }
    if (!batchId) {
      setError('No available batch with stock to issue or discard.');
      return;
    }

    setSubmitting(true);
    try {
      let documentId: string | undefined;
      if (selectedFile) {
        const uploaded = await onUploadDocument(selectedFile);
        documentId = uploaded.id;
      }

      await onRecordMovement({
        type: movementType,
        supplyId: selectedSupply.id,
        batchId,
        newBatchNumber: batchId === '__NEW__' ? newBatchNumber : undefined,
        newBatchExpiryDate: batchId === '__NEW__' ? newBatchExpiryDate : undefined,
        locationId,
        quantity: Number(quantity),
        reason,
        referenceCode,
        documentId,
      });

      const verb =
        movementType === 'IN'
          ? 'received into'
          : movementType === 'OUT'
            ? 'issued from'
            : 'discarded from';
      setSuccessMsg(
        `Recorded ${quantity} ${selectedSupply.unit} of ${selectedSupply.name} ${verb} inventory. Stock totals and automated alerts have been updated.`
      );
      setReason('');
      setReferenceCode('');
      setNewBatchNumber('');
      setSelectedFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record stock movement.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Stock-In / Stock-Out Form
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Record supplies received, issued to clinical rooms, or discarded. Inventory totals and shortage alerts update automatically.
        </p>
      </div>

      {successMsg && (
        <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            <p className="text-sm font-medium text-emerald-950">{successMsg}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onViewHistory}
              className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-50 whitespace-nowrap"
            >
              View Movement Ledger
            </button>
            <button
              type="button"
              onClick={onViewAlerts}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap"
            >
              Check Alerts
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Form Card */}
        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7"
        >
          {/* Movement Type Segmented Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">
              Transaction Type
            </label>
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setMovementType('IN')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  movementType === 'IN'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ArrowDownLeft className="h-3.5 w-3.5" />
                Stock Received
              </button>
              <button
                type="button"
                onClick={() => setMovementType('OUT')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  movementType === 'OUT'
                    ? 'bg-white text-teal-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
                Stock Issued
              </button>
              <button
                type="button"
                onClick={() => setMovementType('DISCARDED')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  movementType === 'DISCARDED'
                    ? 'bg-white text-red-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Discarded
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Medical Supply & Batch */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Medical Supply</label>
              <select
                required
                value={supplyId}
                onChange={(e) => setSupplyId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
              >
                {snapshot.supplies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.sku})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Batch (FEFO sorted by earliest expiry)
              </label>
              <select
                required
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
              >
                {movementType === 'IN' && (
                  <option value="__NEW__">+ Receive as New Batch</option>
                )}
                {supplyBatches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchNumber} ({b.quantity} {selectedSupply?.unit} · exp {b.expiryDate})
                  </option>
                ))}
                {supplyBatches.length === 0 && movementType !== 'IN' && (
                  <option value="">No batches with remaining stock</option>
                )}
              </select>
            </div>
          </div>

          {/* New Batch Details when Stock-In selects __NEW__ */}
          {movementType === 'IN' && batchId === '__NEW__' && (
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">New Batch Number</label>
                <input
                  required
                  type="text"
                  value={newBatchNumber}
                  onChange={(e) => setNewBatchNumber(e.target.value)}
                  placeholder="e.g., GZ-2026-305"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Expiry Date</label>
                <input
                  required
                  type="date"
                  value={newBatchExpiryDate}
                  onChange={(e) => setNewBatchExpiryDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Storage Location</label>
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                >
                  {snapshot.locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Quantity & Reference */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Quantity ({selectedSupply?.unit || 'units'})
              </label>
              <input
                required
                type="number"
                min={1}
                max={movementType !== 'IN' && selectedBatch ? selectedBatch.quantity : undefined}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Reference / Requisition / PO Code
              </label>
              <input
                type="text"
                value={referenceCode}
                onChange={(e) => setReferenceCode(e.target.value)}
                placeholder={
                  movementType === 'IN'
                    ? 'e.g., PO-2026-0490'
                    : movementType === 'OUT'
                      ? 'e.g., REQ-8905'
                      : 'e.g., DSC-114'
                }
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-medium text-slate-700">
              Movement Reason / Clinical Destination
            </label>
            <input
              required
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                movementType === 'IN'
                  ? 'e.g., Replenishment delivery received from supplier'
                  : movementType === 'OUT'
                    ? 'e.g., Issued to First-Aid Station North treatment bay'
                    : 'e.g., Expired batch removed from shelf per disposal log'
              }
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
            />
          </div>

          {/* Optional S3 Supplier Document Upload on Stock-In */}
          {movementType === 'IN' && (
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Attach Delivery Receipt / Invoice (Optional · Amazon S3)
              </label>
              <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 hover:border-teal-500">
                <Upload className="h-4 w-4 text-slate-500 shrink-0" />
                <span className="truncate">
                  {selectedFile ? selectedFile.name : 'Choose supplier receipt file'}
                </span>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.txt,.csv"
                  className="sr-only"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            <div className="text-xs text-slate-500">
              Recorded by <span className="font-medium text-slate-800">{currentUser.name}</span> ·{' '}
              {currentUser.role}
            </div>
            <button
              type="submit"
              disabled={submitting || !batchId}
              className={`rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                movementType === 'DISCARDED'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-teal-700 hover:bg-teal-800'
              }`}
            >
              {submitting
                ? 'Updating Inventory...'
                : movementType === 'IN'
                  ? 'Record Stock Received'
                  : movementType === 'OUT'
                    ? 'Record Stock Issued'
                    : 'Record Stock Discarded'}
            </button>
          </div>
        </form>

        {/* Live Impact Preview Panel */}
        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-slate-900">Projected Stock Impact</h2>
            {selectedSupply ? (
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-base font-semibold text-slate-900">{selectedSupply.name}</p>
                  <p className="text-xs text-slate-500">
                    <span className="font-mono">{selectedSupply.sku}</span> · {selectedSupply.category}
                  </p>
                </div>

                <dl className="divide-y divide-slate-200 border-y border-slate-200 text-sm">
                  <div className="flex items-center justify-between py-2.5">
                    <dt className="text-slate-500">Current Usable Stock</dt>
                    <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                      {currentUsableTotal} {selectedSupply.unit}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <dt className="text-slate-500">Minimum Threshold</dt>
                    <dd className="font-mono text-slate-700 tabular-nums">
                      {selectedSupply.minStockLevel} {selectedSupply.unit}
                    </dd>
                  </div>
                  {selectedBatch && batchId !== '__NEW__' && (
                    <div className="flex items-center justify-between py-2.5">
                      <dt className="text-slate-500">Selected Batch ({selectedBatch.batchNumber})</dt>
                      <dd className="font-mono text-slate-700 tabular-nums">
                        {selectedBatch.quantity} →{' '}
                        <span className="font-semibold text-slate-900">
                          {movementType === 'IN'
                            ? selectedBatch.quantity + parsedQty
                            : Math.max(0, selectedBatch.quantity - parsedQty)}
                        </span>
                      </dd>
                    </div>
                  )}
                  <div className="flex items-center justify-between py-2.5">
                    <dt className="font-medium text-slate-700">Projected Usable Total</dt>
                    <dd
                      className={`font-mono font-semibold tabular-nums ${
                        willTriggerLowStock ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                    >
                      {projectedSupplyTotal} {selectedSupply.unit}
                    </dd>
                  </div>
                </dl>

                {selectedBatch && batchId !== '__NEW__' && (
                  <p className="text-xs text-slate-500">
                    Batch expiry: <span className="font-mono">{formatShortDate(selectedBatch.expiryDate)}</span>
                    {isSelectedBatchExpired ? ' (Expired — quarantined stock)' : ''}
                  </p>
                )}

                {willTriggerLowStock && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-950">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                    <p>
                      After this transaction, usable stock ({projectedSupplyTotal}{' '}
                      {selectedSupply.unit}) will be below the minimum threshold (
                      {selectedSupply.minStockLevel} {selectedSupply.unit}). MediStock Guardian will
                      immediately trigger an automated shortage alert via Amazon SNS.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Select a medical supply to preview stock changes.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
