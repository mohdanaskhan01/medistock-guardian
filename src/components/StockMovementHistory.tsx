import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Search,
  Trash2,
} from 'lucide-react';
import type { InventorySnapshot, MovementType } from '../types.ts';
import { formatDateTime } from '../utils/inventoryLogic.ts';

interface StockMovementHistoryProps {
  snapshot: InventorySnapshot;
}

export const StockMovementHistory: React.FC<StockMovementHistoryProps> = ({ snapshot }) => {
  const [typeFilter, setTypeFilter] = useState<'ALL' | MovementType>('ALL');
  const [supplyFilter, setSupplyFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const supplyMap = useMemo(
    () => new Map(snapshot.supplies.map((s) => [s.id, s])),
    [snapshot.supplies]
  );
  const locationMap = useMemo(
    () => new Map(snapshot.locations.map((l) => [l.id, l])),
    [snapshot.locations]
  );

  const filteredMovements = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return snapshot.movements.filter((m) => {
      if (typeFilter !== 'ALL' && m.type !== typeFilter) return false;
      if (supplyFilter !== 'ALL' && m.supplyId !== supplyFilter) return false;
      if (q) {
        const supply = supplyMap.get(m.supplyId);
        const match =
          m.batchNumber.toLowerCase().includes(q) ||
          m.referenceCode.toLowerCase().includes(q) ||
          m.reason.toLowerCase().includes(q) ||
          m.performedBy.toLowerCase().includes(q) ||
          (supply?.name.toLowerCase().includes(q) ?? false);
        if (!match) return false;
      }
      return true;
    });
  }, [snapshot.movements, typeFilter, supplyFilter, searchQuery, supplyMap]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Stock Movement History
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Complete audit ledger of every supply receipt, clinical issuance, and disposal transaction.
          </p>
        </div>
        <a
          href="/api/reports/movements.csv"
          download="medistock-movements-report.csv"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Download className="h-4 w-4 text-slate-500" />
          Download CSV
        </a>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search batch, reference, staff, or reason..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none"
              />
            </div>

            <select
              value={supplyFilter}
              onChange={(e) => setSupplyFilter(e.target.value)}
              aria-label="Filter movements by medical supply"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-600 focus:outline-none"
            >
              <option value="ALL">All medical supplies</option>
              {snapshot.supplies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 self-start lg:self-auto">
            {(
              [
                ['ALL', 'All Types'],
                ['IN', 'Received'],
                ['OUT', 'Issued'],
                ['DISCARDED', 'Discarded'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTypeFilter(key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  typeFilter === key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-3 pl-5 pr-3">Timestamp</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Supply & Batch</th>
                <th className="px-3 py-3">Location</th>
                <th className="px-3 py-3 text-right">Quantity Delta</th>
                <th className="px-3 py-3 text-right">Batch Balance</th>
                <th className="px-3 py-3">Reference & Reason</th>
                <th className="py-3 pl-3 pr-5">Recorded By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-sm text-slate-500">
                    No stock movement entries match your filters.
                  </td>
                </tr>
              ) : (
                filteredMovements.map((m) => {
                  const supply = supplyMap.get(m.supplyId);
                  const loc = locationMap.get(m.locationId);
                  return (
                    <tr key={m.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 pl-5 pr-3 font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
                        {formatDateTime(m.timestamp)}
                      </td>
                      <td className="px-3 py-3.5 whitespace-nowrap">
                        {m.type === 'IN' && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                            <ArrowDownLeft className="h-3.5 w-3.5" />
                            Received
                          </span>
                        )}
                        {m.type === 'OUT' && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-800">
                            <ArrowUpRight className="h-3.5 w-3.5" />
                            Issued
                          </span>
                        )}
                        {m.type === 'DISCARDED' && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
                            <Trash2 className="h-3.5 w-3.5" />
                            Discarded
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="font-medium text-slate-900">
                          {supply?.name || m.supplyId}
                        </div>
                        <div className="font-mono text-xs text-slate-500">{m.batchNumber}</div>
                      </td>
                      <td className="px-3 py-3.5 text-slate-700">
                        <div>{loc?.name || '—'}</div>
                        <div className="font-mono text-xs text-slate-400">{loc?.code}</div>
                      </td>
                      <td
                        className={`px-3 py-3.5 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                          m.type === 'IN'
                            ? 'text-emerald-700'
                            : m.type === 'DISCARDED'
                              ? 'text-red-700'
                              : 'text-slate-900'
                        }`}
                      >
                        {m.type === 'IN' ? `+${m.quantity}` : `-${m.quantity}`}{' '}
                        <span className="font-sans text-xs font-normal text-slate-500">
                          {supply?.unit}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums text-slate-700">
                        {m.resultingBatchQuantity} {supply?.unit}
                      </td>
                      <td className="px-3 py-3.5 max-w-xs">
                        <div className="font-mono text-xs text-slate-600">{m.referenceCode}</div>
                        <div className="mt-0.5 text-xs text-slate-600 truncate" title={m.reason}>
                          {m.reason}
                        </div>
                      </td>
                      <td className="py-3.5 pl-3 pr-5">
                        <div className="text-sm text-slate-900">{m.performedBy}</div>
                        <div className="text-xs text-slate-500">{m.performedByRole}</div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
