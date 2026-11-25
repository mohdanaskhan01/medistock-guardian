import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  MapPin,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type {
  InventorySnapshot,
  MedicalSupply,
  StaffUser,
  SupplyCategory,
} from '../types.ts';
import {
  formatShortDate,
  getBatchHealthStatus,
  getDaysUntilExpiry,
  getSupplyStockStatus,
  getSupplyTotalQuantity,
} from '../utils/inventoryLogic.ts';

interface InventoryDashboardProps {
  snapshot: InventorySnapshot;
  currentUser: StaffUser;
  onCreateLocation: (payload: {
    name: string;
    code: string;
    zone: string;
    temperatureSpec: string;
    capacityNote: string;
  }) => Promise<void>;
  onCreateSupply: (payload: {
    sku: string;
    name: string;
    category: SupplyCategory;
    unit: string;
    minStockLevel: number;
    defaultLocationId: string;
    preferredSupplier: string;
    unitCost: number;
  }) => Promise<void>;
  onUpdateMinLevel: (supplyId: string, minStockLevel: number) => Promise<void>;
  onQuickStockAction: (supplyId: string, batchId?: string) => void;
  onQuickReorder: (supplyId: string) => void;
  onViewAlerts: () => void;
}

const CATEGORIES: SupplyCategory[] = [
  'Wound Care',
  'PPE',
  'Injection Supplies',
  'First Aid',
  'Antiseptics',
  'Diagnostics',
];

export const InventoryDashboard: React.FC<InventoryDashboardProps> = ({
  snapshot,
  onCreateLocation,
  onCreateSupply,
  onUpdateMinLevel,
  onQuickStockAction,
  onQuickReorder,
  onViewAlerts,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [locationFilter, setLocationFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'LOW' | 'EXPIRING' | 'HEALTHY'>('ALL');
  const [activeModal, setActiveModal] = useState<'location' | 'supply' | null>(null);
  const [editingMinId, setEditingMinId] = useState<string | null>(null);
  const [editingMinValue, setEditingMinValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Location form state
  const [locName, setLocName] = useState('');
  const [locCode, setLocCode] = useState('');
  const [locZone, setLocZone] = useState('');
  const [locTemp, setLocTemp] = useState('18–22°C Ambient');
  const [locNote, setLocNote] = useState('');

  // Supply form state
  const [supSku, setSupSku] = useState('');
  const [supName, setSupName] = useState('');
  const [supCategory, setSupCategory] = useState<SupplyCategory>('Wound Care');
  const [supUnit, setSupUnit] = useState('packs');
  const [supMin, setSupMin] = useState('40');
  const [supLocId, setSupLocId] = useState(snapshot.locations[0]?.id || '');
  const [supSupplier, setSupSupplier] = useState('MedLine Clinical Supply');
  const [supCost, setSupCost] = useState('6.50');

  const locationMap = useMemo(
    () => new Map(snapshot.locations.map((l) => [l.id, l])),
    [snapshot.locations]
  );

  const enrichedSupplies = useMemo(() => {
    return snapshot.supplies.map((supply) => {
      const supplyBatches = snapshot.batches.filter(
        (b) => b.supplyId === supply.id && b.quantity > 0
      );
      const usableQty = getSupplyTotalQuantity(supply.id, snapshot.batches, false);
      const expiredQty = supplyBatches
        .filter((b) => getDaysUntilExpiry(b.expiryDate) < 0)
        .reduce((sum, b) => sum + b.quantity, 0);
      const expiringSoonCount = supplyBatches.filter(
        (b) => getBatchHealthStatus(b) === 'Expiring Soon'
      ).length;
      const stockStatus = getSupplyStockStatus(supply, usableQty);
      const sortedDates = [...supplyBatches]
        .filter((b) => getDaysUntilExpiry(b.expiryDate) >= 0)
        .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
      const nearestExpiry = sortedDates[0]?.expiryDate || null;
      const batchLocations = new Set(supplyBatches.map((b) => b.locationId));
      batchLocations.add(supply.defaultLocationId);

      return {
        supply,
        usableQty,
        expiredQty,
        activeBatchCount: supplyBatches.length,
        expiringSoonCount,
        stockStatus,
        nearestExpiry,
        batchLocations,
      };
    });
  }, [snapshot.supplies, snapshot.batches]);

  const metrics = useMemo(() => {
    const totalSupplies = snapshot.supplies.length;
    const totalUsableUnits = enrichedSupplies.reduce((sum, r) => sum + r.usableQty, 0);
    const lowStockCount = enrichedSupplies.filter((r) => r.stockStatus !== 'In Stock').length;
    const expiryAttentionCount = snapshot.batches.filter((b) => {
      const status = getBatchHealthStatus(b);
      return status === 'Expired' || status === 'Expiring Soon';
    }).length;
    const activeAlertCount = snapshot.alerts.filter((a) => a.status === 'Active').length;
    return {
      totalSupplies,
      totalUsableUnits,
      lowStockCount,
      expiryAttentionCount,
      activeAlertCount,
    };
  }, [snapshot.supplies, snapshot.batches, snapshot.alerts, enrichedSupplies]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedSupplies.filter((row) => {
      if (q) {
        const matches =
          row.supply.name.toLowerCase().includes(q) ||
          row.supply.sku.toLowerCase().includes(q) ||
          row.supply.category.toLowerCase().includes(q) ||
          row.supply.preferredSupplier.toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (locationFilter !== 'ALL' && !row.batchLocations.has(locationFilter)) {
        return false;
      }
      if (statusFilter === 'LOW' && row.stockStatus === 'In Stock') return false;
      if (statusFilter === 'EXPIRING' && row.expiringSoonCount === 0 && row.expiredQty === 0)
        return false;
      if (statusFilter === 'HEALTHY' && row.stockStatus !== 'In Stock') return false;
      return true;
    });
  }, [enrichedSupplies, searchQuery, locationFilter, statusFilter]);

  const urgentShortages = useMemo(
    () => enrichedSupplies.filter((r) => r.stockStatus !== 'In Stock'),
    [enrichedSupplies]
  );

  async function handleLocationSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await onCreateLocation({
        name: locName,
        code: locCode,
        zone: locZone,
        temperatureSpec: locTemp,
        capacityNote: locNote,
      });
      setLocName('');
      setLocCode('');
      setLocZone('');
      setLocNote('');
      setActiveModal(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to register location.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSupplySubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await onCreateSupply({
        sku: supSku,
        name: supName,
        category: supCategory,
        unit: supUnit,
        minStockLevel: Number(supMin),
        defaultLocationId: supLocId || snapshot.locations[0]?.id || '',
        preferredSupplier: supSupplier,
        unitCost: Number(supCost),
      });
      setSupSku('');
      setSupName('');
      setActiveModal(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to register supply.');
    } finally {
      setSubmitting(false);
    }
  }

  async function saveMinLevel(supply: MedicalSupply) {
    const parsed = Number(editingMinValue);
    if (Number.isNaN(parsed) || parsed < 0) return;
    await onUpdateMinLevel(supply.id, parsed);
    setEditingMinId(null);
  }

  return (
    <div className="space-y-6">
      {/* Page Title & Registration Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Inventory Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Monitor usable stock quantities, minimum thresholds, and storage rooms across clinical locations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setActiveModal('location');
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
          >
            <MapPin className="h-4 w-4 text-slate-500" />
            Register Location
          </button>
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setSupLocId(snapshot.locations[0]?.id || '');
              setActiveModal('supply');
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4 text-teal-700" />
            Register Supply
          </button>
        </div>
      </div>

      {/* 4-Column Flat KPI Strip */}
      <div className="grid grid-cols-1 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Registered Supplies</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.totalSupplies}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Across {snapshot.locations.length} storage locations
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Usable Units on Hand</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {metrics.totalUsableUnits.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Excludes expired quarantined batches
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Below Minimum Threshold</p>
          <p
            className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${
              metrics.lowStockCount > 0 ? 'text-amber-700' : 'text-emerald-700'
            }`}
          >
            {metrics.lowStockCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {metrics.lowStockCount > 0 ? 'Replenishment action required' : 'All supplies meet minimum'}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Expiry Attention Batches</p>
          <p
            className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${
              metrics.expiryAttentionCount > 0 ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {metrics.expiryAttentionCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Expired or within 30-day window
          </p>
        </div>
      </div>

      {/* Priority Shortage Callout Strip (Flat bordered container, no thick left accent border) */}
      {urgentShortages.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {urgentShortages.length} medical {urgentShortages.length === 1 ? 'supply is' : 'supplies are'} below minimum stock level
              </p>
              <p className="mt-0.5 text-sm text-slate-700">
                {urgentShortages
                  .map(
                    (s) =>
                      `${s.supply.name} (${s.usableQty} / ${s.supply.minStockLevel} ${s.supply.unit})`
                  )
                  .join(' · ')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onQuickReorder(urgentShortages[0].supply.id)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0"
            >
              Initiate Reorder
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onViewAlerts}
              className="inline-flex items-center rounded-lg border border-amber-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-amber-50 transition-colors whitespace-nowrap shrink-0"
            >
              View Alerts ({metrics.activeAlertCount})
            </button>
          </div>
        </div>
      )}

      {/* Main Inventory Table */}
      <div className="rounded-xl border border-slate-200 bg-white">
        {/* Table Filter Toolbar */}
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search supply, SKU, category, or supplier..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
              />
            </div>

            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              aria-label="Filter by storage location"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
            >
              <option value="ALL">All storage locations</option>
              {snapshot.locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name} ({loc.code})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 self-start lg:self-auto">
            {(
              [
                ['ALL', 'All'],
                ['LOW', 'Low Stock'],
                ['EXPIRING', 'Expiry Watch'],
                ['HEALTHY', 'In Stock'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* High-Density Data Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-3 pl-5 pr-3">Supply & SKU</th>
                <th className="px-3 py-3">Default Location</th>
                <th className="px-3 py-3 text-right">Usable Qty</th>
                <th className="px-3 py-3 text-right">Min Level</th>
                <th className="px-3 py-3">Nearest Expiry</th>
                <th className="px-3 py-3">Stock Status</th>
                <th className="py-3 pl-3 pr-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-slate-500">
                    No medical supplies match the current filters.
                  </td>
                </tr>
              ) : (
                filteredRows.map(
                  ({
                    supply,
                    usableQty,
                    expiredQty,
                    activeBatchCount,
                    expiringSoonCount,
                    stockStatus,
                    nearestExpiry,
                  }) => {
                    const loc = locationMap.get(supply.defaultLocationId);
                    const isLow = stockStatus !== 'In Stock';
                    const isEditing = editingMinId === supply.id;

                    return (
                      <tr
                        key={supply.id}
                        className="hover:bg-slate-50/80 transition-colors"
                      >
                        <td className="py-3.5 pl-5 pr-3">
                          <div className="font-medium text-slate-900">{supply.name}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                            <span className="font-mono text-slate-600">{supply.sku}</span>
                            <span aria-hidden="true">·</span>
                            <span>{supply.category}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {activeBatchCount} {activeBatchCount === 1 ? 'batch' : 'batches'}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-slate-700">
                          <div>{loc?.name || 'Unassigned'}</div>
                          <div className="text-xs font-mono text-slate-400">{loc?.code || '—'}</div>
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                          <span className={`font-semibold ${isLow ? 'text-amber-700' : 'text-slate-900'}`}>
                            {usableQty}
                          </span>{' '}
                          <span className="text-xs text-slate-500">{supply.unit}</span>
                          {expiredQty > 0 && (
                            <div className="text-xs text-red-600">+{expiredQty} expired</div>
                          )}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono tabular-nums text-slate-700">
                          {isEditing ? (
                            <div className="inline-flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                value={editingMinValue}
                                onChange={(e) => setEditingMinValue(e.target.value)}
                                className="w-16 rounded border border-teal-500 px-1.5 py-0.5 text-right text-xs"
                                aria-label="Edit minimum stock level"
                              />
                              <button
                                type="button"
                                onClick={() => saveMinLevel(supply)}
                                className="rounded bg-teal-700 px-2 py-0.5 text-xs font-sans font-medium text-white hover:bg-teal-800"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingMinId(null)}
                                className="text-xs font-sans text-slate-500 hover:text-slate-800"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMinId(supply.id);
                                setEditingMinValue(String(supply.minStockLevel));
                              }}
                              title="Click to adjust minimum stock level"
                              className="inline-flex items-center gap-1 text-slate-700 hover:text-teal-700"
                            >
                              <span>{supply.minStockLevel}</span>
                              <SlidersHorizontal className="h-3 w-3 text-slate-400" />
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-3.5 font-mono text-xs tabular-nums text-slate-700">
                          {nearestExpiry ? (
                            <div>
                              <span>{formatShortDate(nearestExpiry)}</span>
                              {expiringSoonCount > 0 && (
                                <div className="mt-0.5 flex items-center gap-1 font-sans text-amber-700">
                                  <Clock className="h-3 w-3" />
                                  <span>{expiringSoonCount} expiring soon</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="font-sans text-slate-400">No usable batch</span>
                          )}
                        </td>
                        <td className="px-3 py-3.5">
                          {stockStatus === 'In Stock' ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              In Stock
                            </span>
                          ) : stockStatus === 'Critical Shortage' ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Critical Shortage
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Low Stock
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 pl-3 pr-5 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onQuickStockAction(supply.id)}
                              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap shrink-0"
                            >
                              Stock In/Out
                            </button>
                            {isLow && (
                              <button
                                type="button"
                                onClick={() => onQuickReorder(supply.id)}
                                className="rounded-md bg-teal-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap shrink-0"
                              >
                                Reorder
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }
                )
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Storage Locations Directory */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">Registered Storage Locations</h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {snapshot.locations.length} rooms
          </span>
        </div>
        <div className="grid grid-cols-1 divide-y divide-slate-200 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          {snapshot.locations.map((loc) => {
            const batchCount = snapshot.batches.filter(
              (b) => b.locationId === loc.id && b.quantity > 0
            ).length;
            const unitCount = snapshot.batches
              .filter((b) => b.locationId === loc.id && b.quantity > 0)
              .reduce((sum, b) => sum + b.quantity, 0);
            return (
              <div key={loc.id} className="p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{loc.name}</h3>
                  <span className="font-mono text-xs text-slate-500">{loc.code}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {loc.zone} · {loc.temperatureSpec}
                </p>
                <p className="mt-2 font-mono text-xs text-slate-700 tabular-nums">
                  {batchCount} active batches · {unitCount} units
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Register Storage Location Modal */}
      {activeModal === 'location' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Register Storage Location</h2>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleLocationSubmit} className="space-y-4 p-5">
              {formError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {formError}
                </p>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700">Location Name</label>
                <input
                  required
                  type="text"
                  value={locName}
                  onChange={(e) => setLocName(e.target.value)}
                  placeholder="e.g., Pediatric First-Aid Cabinet"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Room Code</label>
                  <input
                    required
                    type="text"
                    value={locCode}
                    onChange={(e) => setLocCode(e.target.value)}
                    placeholder="e.g., PED-108"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Temperature Spec</label>
                  <input
                    type="text"
                    value={locTemp}
                    onChange={(e) => setLocTemp(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Floor / Wing Zone</label>
                <input
                  required
                  type="text"
                  value={locZone}
                  onChange={(e) => setLocZone(e.target.value)}
                  placeholder="e.g., First Floor · West Wing"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Shelving / Capacity Notes</label>
                <input
                  type="text"
                  value={locNote}
                  onChange={(e) => setLocNote(e.target.value)}
                  placeholder="Optional storage note"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {submitting ? 'Saving...' : 'Save Location'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Register Medical Supply Modal */}
      {activeModal === 'supply' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Register Medical Supply</h2>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSupplySubmit} className="space-y-4 p-5">
              {formError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {formError}
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">SKU Code</label>
                  <input
                    required
                    type="text"
                    value={supSku}
                    onChange={(e) => setSupSku(e.target.value)}
                    placeholder="e.g., WND-BD22"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700">Supply Name</label>
                  <input
                    required
                    type="text"
                    value={supName}
                    onChange={(e) => setSupName(e.target.value)}
                    placeholder="e.g., Sterile Non-Adherent Dressings (3×4 in)"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Category</label>
                  <select
                    value={supCategory}
                    onChange={(e) => setSupCategory(e.target.value as SupplyCategory)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Unit</label>
                  <input
                    required
                    type="text"
                    value={supUnit}
                    onChange={(e) => setSupUnit(e.target.value)}
                    placeholder="packs / boxes / rolls"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Min Stock Level</label>
                  <input
                    required
                    type="number"
                    min={0}
                    value={supMin}
                    onChange={(e) => setSupMin(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Default Storage Location</label>
                  <select
                    value={supLocId}
                    onChange={(e) => setSupLocId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  >
                    {snapshot.locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} ({loc.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Unit Cost (USD)</label>
                  <input
                    required
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={supCost}
                    onChange={(e) => setSupCost(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Preferred Supplier</label>
                <input
                  required
                  type="text"
                  value={supSupplier}
                  onChange={(e) => setSupSupplier(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {submitting ? 'Saving...' : 'Save Supply'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
