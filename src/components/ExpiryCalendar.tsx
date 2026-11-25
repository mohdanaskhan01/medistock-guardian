import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
} from 'lucide-react';
import type { InventorySnapshot, MovementType } from '../types.ts';
import {
  formatShortDate,
  getBatchHealthStatus,
  getDaysUntilExpiry,
} from '../utils/inventoryLogic.ts';

interface ExpiryCalendarProps {
  snapshot: InventorySnapshot;
  onSelectBatchForMovement: (supplyId: string, batchId: string, defaultType?: MovementType) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toDateKey(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export const ExpiryCalendar: React.FC<ExpiryCalendarProps> = ({
  snapshot,
  onSelectBatchForMovement,
}) => {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDateKey, setSelectedDateKey] = useState<string>(() => {
    const active = snapshot.batches
      .filter((b) => b.quantity > 0)
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    return active[0]?.expiryDate || toDateKey(today.getFullYear(), today.getMonth(), today.getDate());
  });

  const supplyMap = useMemo(
    () => new Map(snapshot.supplies.map((s) => [s.id, s])),
    [snapshot.supplies]
  );
  const locationMap = useMemo(
    () => new Map(snapshot.locations.map((l) => [l.id, l])),
    [snapshot.locations]
  );

  const activeBatches = useMemo(
    () =>
      snapshot.batches
        .filter((b) => b.quantity > 0)
        .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)),
    [snapshot.batches]
  );

  const batchesByDate = useMemo(() => {
    const map = new Map<string, typeof activeBatches>();
    for (const batch of activeBatches) {
      const list = map.get(batch.expiryDate) || [];
      list.push(batch);
      map.set(batch.expiryDate, list);
    }
    return map;
  }, [activeBatches]);

  const calendarCells = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: Array<{ dateKey: string | null; day: number | null }> = [];
    for (let i = 0; i < firstDay; i++) {
      cells.push({ dateKey: null, day: null });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ dateKey: toDateKey(viewYear, viewMonth, day), day });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ dateKey: null, day: null });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const todayKey = toDateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const selectedBatches = batchesByDate.get(selectedDateKey) || [];

  const upcomingWatchlist = useMemo(() => {
    return activeBatches.filter((b) => getDaysUntilExpiry(b.expiryDate) <= 90);
  }, [activeBatches]);

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function jumpToDate(dateKey: string) {
    const [y, m] = dateKey.split('-').map(Number);
    if (!Number.isNaN(y) && !Number.isNaN(m)) {
      setViewYear(y);
      setViewMonth(m - 1);
      setSelectedDateKey(dateKey);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Expiry Calendar
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Inspect batch expiration dates by month and prioritize first-expired-first-out (FEFO) usage or disposal.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5 text-red-700 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            Expired
          </span>
          <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium">
            <Clock className="h-3.5 w-3.5" />
            Within 30 days
          </span>
          <span className="inline-flex items-center gap-1.5 text-teal-700 font-medium">
            <CalendarIcon className="h-3.5 w-3.5" />
            31+ days
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Monthly Calendar Grid */}
        <div className="rounded-xl border border-slate-200 bg-white lg:col-span-8">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
            <h2 className="text-base font-semibold text-slate-900">{monthLabel}</h2>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={prevMonth}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewYear(today.getFullYear());
                  setViewMonth(today.getMonth());
                  setSelectedDateKey(todayKey);
                }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Today
              </button>
              <button
                type="button"
                onClick={nextMonth}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/70 text-center text-xs font-medium text-slate-500">
            {WEEKDAYS.map((day) => (
              <div key={day} className="py-2.5">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 divide-x divide-y divide-slate-200">
            {calendarCells.map((cell, idx) => {
              if (!cell.dateKey || !cell.day) {
                return <div key={`empty-${idx}`} className="min-h-[84px] bg-slate-50/40" />;
              }
              const dayBatches = batchesByDate.get(cell.dateKey) || [];
              const isSelected = cell.dateKey === selectedDateKey;
              const isToday = cell.dateKey === todayKey;

              return (
                <button
                  key={cell.dateKey}
                  type="button"
                  onClick={() => setSelectedDateKey(cell.dateKey!)}
                  className={`min-h-[84px] p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600 flex flex-col justify-start ${
                    isSelected
                      ? 'bg-teal-50/70'
                      : 'bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`font-mono text-xs tabular-nums ${
                        isToday
                          ? 'font-bold text-teal-700 underline underline-offset-4'
                          : isSelected
                            ? 'font-semibold text-slate-900'
                            : 'text-slate-600'
                      }`}
                    >
                      {cell.day}
                    </span>
                    {dayBatches.length > 0 && (
                      <span className="font-mono text-[11px] font-medium text-slate-500 tabular-nums">
                        {dayBatches.length}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {dayBatches.slice(0, 2).map((b) => {
                      const status = getBatchHealthStatus(b);
                      return (
                        <div
                          key={b.id}
                          className={`truncate font-mono text-[11px] font-medium ${
                            status === 'Expired'
                              ? 'text-red-700'
                              : status === 'Expiring Soon'
                                ? 'text-amber-700'
                                : 'text-teal-800'
                          }`}
                        >
                          {b.batchNumber}
                        </div>
                      );
                    })}
                    {dayBatches.length > 2 && (
                      <div className="text-[11px] text-slate-400">
                        +{dayBatches.length - 2} more
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Selected Date Details + 90-Day Watchlist */}
        <div className="space-y-6 lg:col-span-4">
          {/* Selected Day Panel */}
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-3.5">
              <p className="text-xs font-medium text-slate-500">Selected Expiry Date</p>
              <h2 className="mt-0.5 font-mono text-base font-semibold text-slate-900">
                {formatShortDate(selectedDateKey)}
              </h2>
            </div>

            {selectedBatches.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">
                No active batches expire on this date. Select a highlighted date or use the 90-day watchlist below.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {selectedBatches.map((batch) => {
                  const supply = supplyMap.get(batch.supplyId);
                  const loc = locationMap.get(batch.locationId);
                  const days = getDaysUntilExpiry(batch.expiryDate);
                  return (
                    <div key={batch.id} className="p-5 space-y-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {supply?.name || batch.supplyId}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          <span className="font-mono text-slate-700">{batch.batchNumber}</span> ·{' '}
                          {loc?.name}
                        </p>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {batch.quantity} {supply?.unit} remaining
                        </span>
                        <span
                          className={`font-medium ${
                            days < 0
                              ? 'text-red-700'
                              : days <= 30
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                          }`}
                        >
                          {days < 0 ? `Expired ${Math.abs(days)}d ago` : `${days}d remaining`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {days < 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              onSelectBatchForMovement(batch.supplyId, batch.id, 'DISCARDED')
                            }
                            className="w-full rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                          >
                            Record Disposal
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              onSelectBatchForMovement(batch.supplyId, batch.id, 'OUT')
                            }
                            className="w-full rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
                          >
                            Issue Batch (FEFO)
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Upcoming 90-Day Watchlist */}
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-slate-900">Expired & Next 90 Days</h2>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {upcomingWatchlist.length} batches
              </span>
            </div>
            {upcomingWatchlist.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">
                All active batches have more than 90 days remaining.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {upcomingWatchlist.map((batch) => {
                  const supply = supplyMap.get(batch.supplyId);
                  const days = getDaysUntilExpiry(batch.expiryDate);
                  return (
                    <button
                      key={batch.id}
                      type="button"
                      onClick={() => jumpToDate(batch.expiryDate)}
                      className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-slate-50 transition-colors"
                    >
                      <div className="min-w-0 pr-3">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {supply?.name || batch.supplyId}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          <span className="font-mono">{batch.batchNumber}</span> · {batch.quantity}{' '}
                          {supply?.unit}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono text-xs text-slate-700 tabular-nums">
                          {formatShortDate(batch.expiryDate)}
                        </p>
                        <p
                          className={`text-xs font-medium ${
                            days < 0 ? 'text-red-700' : days <= 30 ? 'text-amber-700' : 'text-slate-500'
                          }`}
                        >
                          {days < 0 ? `${Math.abs(days)}d overdue` : `In ${days}d`}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
