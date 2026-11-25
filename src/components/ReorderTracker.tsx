import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  FileText,
  PackageCheck,
  Plus,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import type {
  InventorySnapshot,
  ReorderRecord,
  ReorderStatus,
  StaffUser,
} from '../types.ts';
import {
  formatShortDate,
  getSupplyTotalQuantity,
} from '../utils/inventoryLogic.ts';

interface ReorderTrackerProps {
  snapshot: InventorySnapshot;
  currentUser: StaffUser;
  preselectedSupplyId?: string;
  openCreateInitially?: boolean;
  onClearPreselect: () => void;
  onCreateReorder: (payload: {
    supplyId: string;
    requestedQuantity: number;
    supplierName: string;
    expectedDeliveryDate: string;
    purchaseOrderNumber: string;
    notes?: string;
    documentId?: string;
  }) => Promise<void>;
  onUpdateReorder: (
    id: string,
    payload: {
      status: ReorderStatus;
      autoReceiveBatchNumber?: string;
      autoReceiveExpiryDate?: string;
      locationId?: string;
    }
  ) => Promise<void>;
  onUploadDocument: (file: File) => Promise<{ id: string; fileName: string; s3Key: string }>;
}

export const ReorderTracker: React.FC<ReorderTrackerProps> = ({
  snapshot,
  currentUser,
  preselectedSupplyId,
  openCreateInitially,
  onClearPreselect,
  onCreateReorder,
  onUpdateReorder,
  onUploadDocument,
}) => {
  const [statusFilter, setStatusFilter] = useState<'ALL' | ReorderStatus>('ALL');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [receivingReorder, setReceivingReorder] = useState<ReorderRecord | null>(null);

  // Create form state
  const [supplyId, setSupplyId] = useState(snapshot.supplies[0]?.id || '');
  const [requestedQuantity, setRequestedQuantity] = useState('100');
  const [supplierName, setSupplierName] = useState(
    snapshot.supplies[0]?.preferredSupplier || 'MedLine Clinical Supply'
  );
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    return d.toISOString().slice(0, 10);
  });
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Receive modal state
  const [recvBatchNumber, setRecvBatchNumber] = useState('');
  const [recvExpiryDate, setRecvExpiryDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 240);
    return d.toISOString().slice(0, 10);
  });
  const [recvLocationId, setRecvLocationId] = useState(snapshot.locations[0]?.id || '');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supplyMap = useMemo(
    () => new Map(snapshot.supplies.map((s) => [s.id, s])),
    [snapshot.supplies]
  );
  const docMap = useMemo(
    () => new Map(snapshot.documents.map((d) => [d.id, d])),
    [snapshot.documents]
  );

  useEffect(() => {
    if (openCreateInitially && preselectedSupplyId) {
      const supply = supplyMap.get(preselectedSupplyId);
      setSupplyId(preselectedSupplyId);
      if (supply) {
        const currentQty = getSupplyTotalQuantity(supply.id, snapshot.batches, false);
        const suggestedQty = Math.max(supply.minStockLevel * 2 - currentQty, 50);
        setRequestedQuantity(String(suggestedQty));
        setSupplierName(supply.preferredSupplier);
        setNotes(
          `Replenishment initiated for low stock (${currentQty}/${supply.minStockLevel} ${supply.unit})`
        );
      }
      setPurchaseOrderNumber(
        `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
      );
      setShowCreateModal(true);
      onClearPreselect();
    }
  }, [openCreateInitially, preselectedSupplyId, supplyMap, snapshot.batches, onClearPreselect]);

  const filteredReorders = useMemo(() => {
    return snapshot.reorders.filter((r) =>
      statusFilter === 'ALL' ? true : r.status === statusFilter
    );
  }, [snapshot.reorders, statusFilter]);

  function openNewReorder() {
    const firstSupply = snapshot.supplies[0];
    if (firstSupply) {
      setSupplyId(firstSupply.id);
      setSupplierName(firstSupply.preferredSupplier);
    }
    setPurchaseOrderNumber(
      `PO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
    );
    setNotes('');
    setSelectedFile(null);
    setError(null);
    setShowCreateModal(true);
  }

  function handleSupplyChange(nextId: string) {
    setSupplyId(nextId);
    const supply = supplyMap.get(nextId);
    if (supply) {
      setSupplierName(supply.preferredSupplier);
    }
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      let documentId: string | undefined;
      if (selectedFile) {
        const uploaded = await onUploadDocument(selectedFile);
        documentId = uploaded.id;
      }
      await onCreateReorder({
        supplyId,
        requestedQuantity: Number(requestedQuantity),
        supplierName,
        expectedDeliveryDate,
        purchaseOrderNumber,
        notes,
        documentId,
      });
      setShowCreateModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create reorder.');
    } finally {
      setSubmitting(false);
    }
  }

  function openReceiveModal(reorder: ReorderRecord) {
    const supply = supplyMap.get(reorder.supplyId);
    setReceivingReorder(reorder);
    setRecvBatchNumber(
      `${(supply?.sku || 'MS').slice(0, 2)}-${new Date().getFullYear()}-${Math.floor(
        100 + Math.random() * 900
      )}`
    );
    setRecvLocationId(supply?.defaultLocationId || snapshot.locations[0]?.id || '');
    setError(null);
  }

  async function handleConfirmReceive(e: React.FormEvent) {
    e.preventDefault();
    if (!receivingReorder) return;
    setSubmitting(true);
    setError(null);
    try {
      await onUpdateReorder(receivingReorder.id, {
        status: 'Received',
        autoReceiveBatchNumber: recvBatchNumber,
        autoReceiveExpiryDate: recvExpiryDate,
        locationId: recvLocationId,
      });
      setReceivingReorder(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to mark reorder as received.');
    } finally {
      setSubmitting(false);
    }
  }

  function downloadDocument(dataUrl: string | undefined, fileName: string) {
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Reorder Tracker
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Initiate replenishment orders for low-stock medical supplies and receive deliveries directly into batch inventory.
          </p>
        </div>
        <button
          type="button"
          onClick={openNewReorder}
          className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          Record Reorder
        </button>
      </div>

      {/* Filter Bar & Reorder Table */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(['ALL', 'Pending', 'Ordered', 'Received', 'Cancelled'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === status
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {status === 'ALL' ? 'All Reorders' : status}
              </button>
            ))}
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {filteredReorders.length} records
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-3 pl-5 pr-3">PO Number</th>
                <th className="px-3 py-3">Medical Supply</th>
                <th className="px-3 py-3 text-right">Order Qty</th>
                <th className="px-3 py-3">Supplier</th>
                <th className="px-3 py-3">Expected Delivery</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Document</th>
                <th className="py-3 pl-3 pr-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredReorders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-sm text-slate-500">
                    No reorder records in this view.
                  </td>
                </tr>
              ) : (
                filteredReorders.map((reorder) => {
                  const supply = supplyMap.get(reorder.supplyId);
                  const doc = reorder.documentId ? docMap.get(reorder.documentId) : undefined;
                  return (
                    <tr key={reorder.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 pl-5 pr-3">
                        <div className="font-mono text-sm font-semibold text-slate-900">
                          {reorder.purchaseOrderNumber}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          Requested by {reorder.requestedBy}
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="font-medium text-slate-900">
                          {supply?.name || reorder.supplyId}
                        </div>
                        {reorder.notes && (
                          <div className="mt-0.5 text-xs text-slate-500 max-w-xs truncate">
                            {reorder.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                        <span className="font-semibold text-slate-900">
                          {reorder.requestedQuantity}
                        </span>{' '}
                        <span className="text-xs text-slate-500">{supply?.unit}</span>
                      </td>
                      <td className="px-3 py-3.5 text-slate-700">{reorder.supplierName}</td>
                      <td className="px-3 py-3.5 font-mono text-xs tabular-nums text-slate-700">
                        <div>{formatShortDate(reorder.expectedDeliveryDate)}</div>
                        {reorder.receivedAt && (
                          <div className="font-sans text-emerald-700">
                            Received {formatShortDate(reorder.receivedAt)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3.5">
                        {reorder.status === 'Pending' && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                            <Clock className="h-3.5 w-3.5" />
                            Pending
                          </span>
                        )}
                        {reorder.status === 'Ordered' && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700">
                            <Truck className="h-3.5 w-3.5" />
                            Ordered
                          </span>
                        )}
                        {reorder.status === 'Received' && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Received
                          </span>
                        )}
                        {reorder.status === 'Cancelled' && (
                          <span className="text-xs font-medium text-slate-400">Cancelled</span>
                        )}
                      </td>
                      <td className="px-3 py-3.5">
                        {doc ? (
                          <button
                            type="button"
                            onClick={() => downloadDocument(doc.dataUrl, doc.fileName)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline max-w-[140px]"
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{doc.fileName}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3.5 pl-3 pr-5 text-right">
                        <div className="inline-flex items-center gap-2">
                          {reorder.status === 'Pending' && (
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateReorder(reorder.id, { status: 'Ordered' })
                              }
                              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                            >
                              Mark Ordered
                            </button>
                          )}
                          {(reorder.status === 'Pending' || reorder.status === 'Ordered') && (
                            <button
                              type="button"
                              onClick={() => openReceiveModal(reorder)}
                              className="inline-flex items-center gap-1 rounded-md bg-teal-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap"
                            >
                              <PackageCheck className="h-3.5 w-3.5" />
                              Receive Stock
                            </button>
                          )}
                          {reorder.status === 'Received' && (
                            <span className="text-xs text-slate-400">Completed</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Reorder Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Record Replenishment Reorder</h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="space-y-4 p-5">
              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700">Medical Supply</label>
                <select
                  required
                  value={supplyId}
                  onChange={(e) => handleSupplyChange(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                >
                  {snapshot.supplies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.sku})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Order Quantity</label>
                  <input
                    required
                    type="number"
                    min={1}
                    value={requestedQuantity}
                    onChange={(e) => setRequestedQuantity(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Purchase Order #</label>
                  <input
                    required
                    type="text"
                    value={purchaseOrderNumber}
                    onChange={(e) => setPurchaseOrderNumber(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Supplier</label>
                  <input
                    required
                    type="text"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Expected Delivery</label>
                  <input
                    required
                    type="date"
                    value={expectedDeliveryDate}
                    onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Attach Purchase Order / Quote (Amazon S3)
                </label>
                <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 hover:border-teal-500">
                  <Upload className="h-4 w-4 text-slate-500 shrink-0" />
                  <span className="truncate">
                    {selectedFile ? selectedFile.name : 'Upload supplier PO document (optional)'}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.txt,.csv"
                    className="sr-only"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  />
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional reorder reason or urgency details"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-500">Requested by {currentUser.name}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                  >
                    {submitting ? 'Saving...' : 'Save Reorder'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Receive Reorder into Batch Modal */}
      {receivingReorder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">
                Receive {receivingReorder.purchaseOrderNumber}
              </h2>
              <button
                type="button"
                onClick={() => setReceivingReorder(null)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmReceive} className="space-y-4 p-5">
              <p className="text-sm text-slate-600">
                Marking this reorder as received automatically creates a new inventory batch for{' '}
                <span className="font-mono font-semibold text-slate-900">
                  {receivingReorder.requestedQuantity}
                </span>{' '}
                units and logs a Stock-In movement.
              </p>
              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700">Received Batch Number</label>
                <input
                  required
                  type="text"
                  value={recvBatchNumber}
                  onChange={(e) => setRecvBatchNumber(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Batch Expiry Date</label>
                <input
                  required
                  type="date"
                  value={recvExpiryDate}
                  onChange={(e) => setRecvExpiryDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Storage Location</label>
                <select
                  value={recvLocationId}
                  onChange={(e) => setRecvLocationId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                >
                  {snapshot.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReceivingReorder(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {submitting ? 'Receiving...' : 'Confirm & Update Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
