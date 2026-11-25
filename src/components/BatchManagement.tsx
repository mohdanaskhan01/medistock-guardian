
import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Plus,
  Search,
  Upload,
  X,
} from 'lucide-react';
import type { InventorySnapshot, StaffUser } from '../types.ts';
import {
  formatShortDate,
  getBatchHealthStatus,
  getDaysUntilExpiry,
  type BatchHealthStatus,
} from '../utils/inventoryLogic.ts';

interface BatchManagementProps {
  snapshot: InventorySnapshot;
  currentUser: StaffUser;
  onCreateBatch: (payload: {
    batchNumber: string;
    supplyId: string;
    locationId: string;
    quantity: number;
    expiryDate: string;
    supplierName: string;
    notes?: string;
    documentId?: string;
  }) => Promise<void>;
  onUploadDocument: (file: File) => Promise<{ id: string; fileName: string; s3Key: string }>;
  onSelectBatchForMovement: (supplyId: string, batchId: string, defaultType?: 'IN' | 'OUT' | 'DISCARDED') => void;
}

export const BatchManagement: React.FC<BatchManagementProps> = ({
  snapshot,
  onCreateBatch,
  onUploadDocument,
  onSelectBatchForMovement,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | BatchHealthStatus>('ALL');
  const [locationFilter, setLocationFilter] = useState('ALL');
  const [showNewModal, setShowNewModal] = useState(false);

  const [batchNumber, setBatchNumber] = useState('');
  const [supplyId, setSupplyId] = useState(snapshot.supplies[0]?.id || '');
  const [locationId, setLocationId] = useState(snapshot.locations[0]?.id || '');
  const [quantity, setQuantity] = useState('50');
  const [expiryDate, setExpiryDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 180);
    return d.toISOString().slice(0, 10);
  });
  const [supplierName, setSupplierName] = useState(
    snapshot.supplies[0]?.preferredSupplier || 'MedLine Clinical Supply'
  );
  const [notes, setNotes] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supplyMap = useMemo(
    () => new Map(snapshot.supplies.map((s) => [s.id, s])),
    [snapshot.supplies]
  );
  const locationMap = useMemo(
    () => new Map(snapshot.locations.map((l) => [l.id, l])),
    [snapshot.locations]
  );
  const docMap = useMemo(
    () => new Map(snapshot.documents.map((d) => [d.id, d])),
    [snapshot.documents]
  );

  const filteredBatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return snapshot.batches
      .map((batch) => ({
        batch,
        supply: supplyMap.get(batch.supplyId),
        location: locationMap.get(batch.locationId),
        health: getBatchHealthStatus(batch),
        daysLeft: getDaysUntilExpiry(batch.expiryDate),
        doc: batch.documentId ? docMap.get(batch.documentId) : undefined,
      }))
      .filter(({ batch, supply, health }) => {
        if (q) {
          const match =
            batch.batchNumber.toLowerCase().includes(q) ||
            (supply?.name.toLowerCase().includes(q) ?? false) ||
            (supply?.sku.toLowerCase().includes(q) ?? false) ||
            batch.supplierName.toLowerCase().includes(q);
          if (!match) return false;
        }
        if (statusFilter !== 'ALL' && health !== statusFilter) return false;
        if (locationFilter !== 'ALL' && batch.locationId !== locationFilter) return false;
        return true;
      })
      .sort((a, b) => a.batch.expiryDate.localeCompare(b.batch.expiryDate));
  }, [snapshot.batches, supplyMap, locationMap, docMap, searchQuery, statusFilter, locationFilter]);

  function handleSupplyChange(nextSupplyId: string) {
    setSupplyId(nextSupplyId);
    const matched = supplyMap.get(nextSupplyId);
    if (matched) {
      setLocationId(matched.defaultLocationId || snapshot.locations[0]?.id || '');
      setSupplierName(matched.preferredSupplier);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      let documentId: string | undefined;
      if (selectedFile) {
        const uploaded = await onUploadDocument(selectedFile);
        documentId = uploaded.id;
      }
      await onCreateBatch({
        batchNumber,
        supplyId,
        locationId,
        quantity: Number(quantity),
        expiryDate,
        supplierName,
        notes,
        documentId,
      });
      setBatchNumber('');
      setNotes('');
      setSelectedFile(null);
      setShowNewModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to register batch.');
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
            Batch Management
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Track lot numbers, expiry dates, storage locations, and supplier documents stored in Amazon S3.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setShowNewModal(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          Add New Batch
        </button>
      </div>

      {/* Filters & Table */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search batch number, supply, or supplier..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
              />
            </div>

            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              aria-label="Filter batches by location"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-600 focus:outline-none"
            >
              <option value="ALL">All locations</option>
              {snapshot.locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 self-start lg:self-auto overflow-x-auto">
            {(['ALL', 'Healthy', 'Expiring Soon', 'Expired', 'Depleted'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${statusFilter === status
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                {status === 'ALL' ? 'All Batches' : status}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-3 pl-5 pr-3">Batch Number</th>
                <th className="px-3 py-3">Medical Supply</th>
                <th className="px-3 py-3">Location</th>
                <th className="px-3 py-3 text-right">Remaining / Initial</th>
                <th className="px-3 py-3">Expiry Date</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Supplier Document</th>
                <th className="py-3 pl-3 pr-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredBatches.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-sm text-slate-500">
                    No batches found matching your current filter.
                  </td>
                </tr>
              ) : (
                filteredBatches.map(({ batch, supply, location, health, daysLeft, doc }) => (
                  <tr key={batch.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 pl-5 pr-3">
                      <div className="font-mono text-sm font-semibold text-slate-900">
                        {batch.batchNumber}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        Received {formatShortDate(batch.receivedDate)}
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="font-medium text-slate-900">{supply?.name || batch.supplyId}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        <span className="font-mono">{supply?.sku}</span> · {batch.supplierName}
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-slate-700">
                      <div>{location?.name || '—'}</div>
                      <div className="font-mono text-xs text-slate-400">{location?.code}</div>
                    </td>
                    <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                      <span className="font-semibold text-slate-900">{batch.quantity}</span>
                      <span className="text-slate-400"> / {batch.initialQuantity}</span>
                      <div className="font-sans text-xs text-slate-500">{supply?.unit}</div>
                    </td>
                    <td className="px-3 py-3.5 font-mono text-xs tabular-nums">
                      <div className="text-slate-900">{formatShortDate(batch.expiryDate)}</div>
                      <div
                        className={`font-sans ${daysLeft < 0
                            ? 'text-red-600'
                            : daysLeft <= 30
                              ? 'text-amber-700'
                              : 'text-slate-500'
                          }`}
                      >
                        {daysLeft < 0
                          ? `Expired ${Math.abs(daysLeft)}d ago`
                          : `${daysLeft}d remaining`}
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      {health === 'Healthy' && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Healthy
                        </span>
                      )}
                      {health === 'Expiring Soon' && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                          <Clock className="h-3.5 w-3.5" />
                          Expiring Soon
                        </span>
                      )}
                      {health === 'Expired' && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Expired
                        </span>
                      )}
                      {health === 'Depleted' && (
                        <span className="text-xs font-medium text-slate-400">Depleted</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      {doc ? (
                        <button
                          type="button"
                          onClick={() => downloadDocument(doc.dataUrl, doc.fileName)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-900 hover:underline max-w-[180px]"
                          title={doc.s3Key}
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{doc.fileName}</span>
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">None attached</span>
                      )}
                    </td>
                    <td className="py-3.5 pl-3 pr-5 text-right">
                      {health === 'Expired' && batch.quantity > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            onSelectBatchForMovement(batch.supplyId, batch.id, 'DISCARDED')
                          }
                          className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 whitespace-nowrap shrink-0"
                        >
                          Discard Expired
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelectBatchForMovement(batch.supplyId, batch.id, 'OUT')}
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          Update Stock
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add New Batch Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Register New Supply Batch</h2>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4 p-5">
              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <div>
                  <label className="block text-xs font-medium text-slate-700">Batch Number</label>
                  <input
                    required
                    type="text"
                    value={batchNumber}
                    onChange={(e) => setBatchNumber(e.target.value)}
                    placeholder="e.g., GZ-2026-214"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Quantity</label>
                  <input
                    required
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Expiry Date</label>
                  <input
                    required
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Storage Location</label>
                  <select
                    required
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  >
                    {snapshot.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Supplier Name</label>
                <input
                  required
                  type="text"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Supplier Invoice / Packing Slip (Amazon S3)
                </label>
                <label className="mt-1 flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50/40">
                  <span className="flex items-center gap-2 truncate">
                    <Upload className="h-4 w-4 text-slate-500 shrink-0" />
                    {selectedFile ? selectedFile.name : 'Attach PDF, PNG, JPG, or TXT supplier document'}
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
                <label className="block text-xs font-medium text-slate-700">Receiving Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional inspection or shelving note"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {submitting ? 'Registering...' : 'Register Batch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
