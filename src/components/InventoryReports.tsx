import React, { useMemo } from 'react';
import { Download } from 'lucide-react';
import type { InventorySnapshot } from '../types.ts';
import {
  formatCurrency,
  getBatchHealthStatus,
  getSupplyTotalQuantity,
} from '../utils/inventoryLogic.ts';

interface InventoryReportsProps {
  snapshot: InventorySnapshot;
}

export const InventoryReports: React.FC<InventoryReportsProps> = ({ snapshot }) => {
  const supplyMap = useMemo(
    () => new Map(snapshot.supplies.map((s) => [s.id, s])),
    [snapshot.supplies]
  );

  const reportStats = useMemo(() => {
    let totalUsableValuation = 0;
    let compliantSupplies = 0;

    for (const supply of snapshot.supplies) {
      const usableQty = getSupplyTotalQuantity(supply.id, snapshot.batches, false);
      totalUsableValuation += usableQty * supply.unitCost;
      if (usableQty >= supply.minStockLevel) compliantSupplies += 1;
    }

    const complianceRate =
      snapshot.supplies.length > 0
        ? Math.round((compliantSupplies / snapshot.supplies.length) * 100)
        : 100;

    let unitsIn = 0;
    let unitsOut = 0;
    let unitsDiscarded = 0;
    for (const m of snapshot.movements) {
      if (m.type === 'IN') unitsIn += m.quantity;
      if (m.type === 'OUT') unitsOut += m.quantity;
      if (m.type === 'DISCARDED') unitsDiscarded += m.quantity;
    }

    let expiringUnits = 0;
    let expiredUnits = 0;
    for (const b of snapshot.batches) {
      const health = getBatchHealthStatus(b);
      if (health === 'Expiring Soon') expiringUnits += b.quantity;
      if (health === 'Expired') expiredUnits += b.quantity;
    }

    return {
      totalUsableValuation,
      complianceRate,
      compliantSupplies,
      unitsIn,
      unitsOut,
      unitsDiscarded,
      expiringUnits,
      expiredUnits,
    };
  }, [snapshot.supplies, snapshot.batches, snapshot.movements]);

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { units: number; value: number; supplyCount: number }>();
    for (const supply of snapshot.supplies) {
      const usableQty = getSupplyTotalQuantity(supply.id, snapshot.batches, false);
      const current = map.get(supply.category) || { units: 0, value: 0, supplyCount: 0 };
      current.units += usableQty;
      current.value += usableQty * supply.unitCost;
      current.supplyCount += 1;
      map.set(supply.category, current);
    }
    const items = Array.from(map.entries())
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => b.value - a.value);
    const maxValue = Math.max(...items.map((i) => i.value), 1);
    return { items, maxValue };
  }, [snapshot.supplies, snapshot.batches]);

  const locationBreakdown = useMemo(() => {
    const items = snapshot.locations.map((loc) => {
      const locBatches = snapshot.batches.filter(
        (b) => b.locationId === loc.id && b.quantity > 0
      );
      const units = locBatches.reduce((sum, b) => sum + b.quantity, 0);
      const value = locBatches.reduce((sum, b) => {
        const s = supplyMap.get(b.supplyId);
        return sum + b.quantity * (s?.unitCost || 0);
      }, 0);
      return {
        location: loc,
        batchCount: locBatches.length,
        units,
        value,
      };
    });
    const maxUnits = Math.max(...items.map((i) => i.units), 1);
    return { items, maxUnits };
  }, [snapshot.locations, snapshot.batches, supplyMap]);

  const totalMovementUnits = Math.max(
    reportStats.unitsIn + reportStats.unitsOut + reportStats.unitsDiscarded,
    1
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Inventory Reports
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Stock valuation, movement totals, storage distribution, and threshold compliance exports.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href="/api/reports/inventory.csv"
            download="medistock-inventory-summary.csv"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="h-4 w-4 text-slate-500" />
            Inventory CSV
          </a>
          <a
            href="/api/reports/movements.csv"
            download="medistock-movements-report.csv"
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="h-4 w-4" />
            Movement Report CSV
          </a>
        </div>
      </div>

      {/* Executive Summary Strip */}
      <div className="grid grid-cols-1 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Usable Stock Valuation</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {formatCurrency(reportStats.totalUsableValuation)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Based on current non-expired batches</p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Minimum Threshold Compliance</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {reportStats.complianceRate}%
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {reportStats.compliantSupplies} of {snapshot.supplies.length} supplies above minimum
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Recorded Movements Volume</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {snapshot.movements.length}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            +{reportStats.unitsIn} in · -{reportStats.unitsOut} out · -{reportStats.unitsDiscarded} disc.
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Expiry Risk Exposure</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-amber-700 tabular-nums">
            {reportStats.expiringUnits + reportStats.expiredUnits} units
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {reportStats.expiringUnits} expiring ≤30d · {reportStats.expiredUnits} expired
          </p>
        </div>
      </div>

      {/* Analytics Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Category Valuation Breakdown */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              Usable Inventory Value by Category
            </h2>
            <span className="text-xs text-slate-500">USD valuation</span>
          </div>
          <div className="mt-5 space-y-4">
            {categoryBreakdown.items.map((item) => {
              const pct = Math.max(4, Math.round((item.value / categoryBreakdown.maxValue) * 100));
              return (
                <div key={item.category}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium text-slate-800">
                      {item.category}{' '}
                      <span className="text-xs font-normal text-slate-500">
                        ({item.units} units)
                      </span>
                    </span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(item.value)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-teal-700"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Stock Movement Flow & Storage Distribution */}
        <div className="space-y-6">
          {/* Movement Flow */}
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">Stock Movement Summary</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Total units logged across received, issued, and discarded records
            </p>
            <div className="mt-5 space-y-3.5">
              {[
                {
                  label: 'Stock Received (IN)',
                  value: reportStats.unitsIn,
                  barColor: 'bg-emerald-600',
                  textColor: 'text-emerald-700',
                },
                {
                  label: 'Stock Issued (OUT)',
                  value: reportStats.unitsOut,
                  barColor: 'bg-teal-700',
                  textColor: 'text-teal-800',
                },
                {
                  label: 'Stock Discarded',
                  value: reportStats.unitsDiscarded,
                  barColor: 'bg-red-600',
                  textColor: 'text-red-700',
                },
              ].map((row) => {
                const widthPct =
                  row.value === 0 ? 0 : Math.max(3, Math.round((row.value / totalMovementUnits) * 100));
                return (
                  <div key={row.label}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-slate-700">{row.label}</span>
                      <span className={`font-mono font-semibold tabular-nums ${row.textColor}`}>
                        {row.value} units
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${row.barColor}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Storage Location Distribution */}
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">Units by Storage Location</h2>
            <div className="mt-4 divide-y divide-slate-200">
              {locationBreakdown.items.map(({ location, batchCount, units, value }) => (
                <div
                  key={location.id}
                  className="flex items-center justify-between py-2.5 text-sm"
                >
                  <div>
                    <p className="font-medium text-slate-900">{location.name}</p>
                    <p className="text-xs text-slate-500">
                      <span className="font-mono">{location.code}</span> · {batchCount} batches
                    </p>
                  </div>
                  <div className="text-right font-mono tabular-nums">
                    <p className="font-semibold text-slate-900">{units} units</p>
                    <p className="text-xs text-slate-500">{formatCurrency(value)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Supply Compliance Table */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            Supply Replenishment & Valuation Table
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-3 pl-5 pr-3">SKU</th>
                <th className="px-3 py-3">Medical Supply</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3 text-right">Usable Qty</th>
                <th className="px-3 py-3 text-right">Min Level</th>
                <th className="px-3 py-3 text-right">Variance</th>
                <th className="py-3 pl-3 pr-5 text-right">Valuation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {snapshot.supplies.map((supply) => {
                const usable = getSupplyTotalQuantity(supply.id, snapshot.batches, false);
                const variance = usable - supply.minStockLevel;
                return (
                  <tr key={supply.id} className="hover:bg-slate-50/70">
                    <td className="py-3 pl-5 pr-3 font-mono text-xs text-slate-600">
                      {supply.sku}
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-900">{supply.name}</td>
                    <td className="px-3 py-3 text-slate-600">{supply.category}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-900">
                      {usable} {supply.unit}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-600">
                      {supply.minStockLevel}
                    </td>
                    <td
                      className={`px-3 py-3 text-right font-mono font-semibold tabular-nums ${
                        variance < 0 ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {variance >= 0 ? `+${variance}` : variance}
                    </td>
                    <td className="py-3 pl-3 pr-5 text-right font-mono tabular-nums text-slate-900">
                      {formatCurrency(usable * supply.unitCost)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
