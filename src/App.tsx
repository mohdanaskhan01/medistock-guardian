import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Calendar,
  History,
  LayoutDashboard,
  Menu,
  Package,
  RefreshCw,
  ShieldPlus,
  ShoppingCart,
  X,
} from 'lucide-react';
import { STAFF_USERS } from './data/seedData.ts';
import { api } from './services/api.ts';
import type {
  InventorySnapshot,
  MovementType,
  ReorderStatus,
  ScreenId,
  SupplyCategory,
} from './types.ts';
import { InventoryDashboard } from './components/InventoryDashboard.tsx';
import { BatchManagement } from './components/BatchManagement.tsx';
import { StockMovementForm } from './components/StockMovementForm.tsx';
import { ExpiryCalendar } from './components/ExpiryCalendar.tsx';
import { ReorderTracker } from './components/ReorderTracker.tsx';
import { NotificationAlerts } from './components/NotificationAlerts.tsx';
import { StockMovementHistory } from './components/StockMovementHistory.tsx';
import { InventoryReports } from './components/InventoryReports.tsx';

interface NavItem {
  id: ScreenId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Inventory Dashboard', icon: LayoutDashboard },
  { id: 'batches', label: 'Batch Management', icon: Package },
  { id: 'stock-form', label: 'Stock-In / Stock-Out', icon: ArrowLeftRight },
  { id: 'expiry-calendar', label: 'Expiry Calendar', icon: Calendar },
  { id: 'reorders', label: 'Reorder Tracker', icon: ShoppingCart },
  { id: 'alerts', label: 'Notification Alerts', icon: Bell },
  { id: 'history', label: 'Stock Movement History', icon: History },
  { id: 'reports', label: 'Inventory Reports', icon: BarChart3 },
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected document.'));
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeScreen, setActiveScreen] = useState<ScreenId>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>(STAFF_USERS[0].id);

  // Cross-screen contextual prefill state
  const [prefillMovement, setPrefillMovement] = useState<{
    supplyId?: string;
    batchId?: string;
    type?: MovementType;
  }>({});
  const [prefillReorder, setPrefillReorder] = useState<{
    supplyId?: string;
    openModal: boolean;
  }>({ openModal: false });

  const currentUser = useMemo(
    () => STAFF_USERS.find((u) => u.id === currentUserId) || STAFF_USERS[0],
    [currentUserId]
  );

  const fetchSnapshot = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await api.getSnapshot();
      setSnapshot(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to load inventory records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  const activeAlertCount = useMemo(
    () => (snapshot ? snapshot.alerts.filter((a) => a.status === 'Active').length : 0),
    [snapshot]
  );

  const currentNavLabel =
    NAV_ITEMS.find((n) => n.id === activeScreen)?.label || 'Inventory Dashboard';

  function navigateTo(screen: ScreenId) {
    setActiveScreen(screen);
    setMobileMenuOpen(false);
  }

  function handleQuickStockAction(
    supplyId: string,
    batchId?: string,
    type: MovementType = 'OUT'
  ) {
    setPrefillMovement({ supplyId, batchId, type });
    navigateTo('stock-form');
  }

  function handleQuickReorder(supplyId: string) {
    setPrefillReorder({ supplyId, openModal: true });
    navigateTo('reorders');
  }

  const handleClearReorderPreselect = useCallback(() => {
    setPrefillReorder({ openModal: false });
  }, []);

  async function handleUploadDocument(file: File) {
    const dataUrl = await readFileAsDataUrl(file);
    const result = await api.uploadDocument({
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      dataUrl,
      uploadedBy: currentUser.name,
    });
    setSnapshot(result.snapshot);
    return result.document;
  }

  async function handleCreateLocation(payload: {
    name: string;
    code: string;
    zone: string;
    temperatureSpec: string;
    capacityNote: string;
  }) {
    const res = await api.createLocation(payload);
    setSnapshot(res.snapshot);
  }

  async function handleCreateSupply(payload: {
    sku: string;
    name: string;
    category: SupplyCategory;
    unit: string;
    minStockLevel: number;
    defaultLocationId: string;
    preferredSupplier: string;
    unitCost: number;
  }) {
    const res = await api.createSupply(payload);
    setSnapshot(res.snapshot);
  }

  async function handleUpdateMinLevel(supplyId: string, minStockLevel: number) {
    const res = await api.updateSupply(supplyId, { minStockLevel });
    setSnapshot(res.snapshot);
  }

  async function handleCreateBatch(payload: {
    batchNumber: string;
    supplyId: string;
    locationId: string;
    quantity: number;
    expiryDate: string;
    supplierName: string;
    notes?: string;
    documentId?: string;
  }) {
    const res = await api.createBatch({
      ...payload,
      performedBy: currentUser.name,
      performedByRole: currentUser.role,
    });
    setSnapshot(res.snapshot);
  }

  async function handleRecordMovement(payload: {
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
  }) {
    const res = await api.recordMovement({
      ...payload,
      performedBy: currentUser.name,
      performedByRole: currentUser.role,
    });
    setSnapshot(res.snapshot);
  }

  async function handleCreateReorder(payload: {
    supplyId: string;
    requestedQuantity: number;
    supplierName: string;
    expectedDeliveryDate: string;
    purchaseOrderNumber: string;
    notes?: string;
    documentId?: string;
  }) {
    const res = await api.createReorder({
      ...payload,
      requestedBy: currentUser.name,
    });
    setSnapshot(res.snapshot);
  }

  async function handleUpdateReorder(
    id: string,
    payload: {
      status: ReorderStatus;
      autoReceiveBatchNumber?: string;
      autoReceiveExpiryDate?: string;
      locationId?: string;
    }
  ) {
    const res = await api.updateReorder(id, {
      ...payload,
      performedBy: currentUser.name,
      performedByRole: currentUser.role,
    });
    setSnapshot(res.snapshot);
  }

  async function handleRunMonitorCheck() {
    const res = await api.runMonitorCheck();
    setSnapshot(res.snapshot);
  }

  async function handleAcknowledgeAlert(alertId: string) {
    const res = await api.acknowledgeAlert(alertId, currentUser.name);
    setSnapshot(res.snapshot);
  }

  const SidebarContent = (
    <div className="flex h-full flex-col bg-white">
      {/* Brand Lockup */}
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
        <button
          type="button"
          onClick={() => navigateTo('dashboard')}
          className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-700 text-white">
            <ShieldPlus className="h-4 w-4" />
          </span>
          <span className="font-display text-base font-bold tracking-tight text-slate-900">
            MediStock Guardian
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 8 Core Feature Screens Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeScreen === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigateTo(item.id)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-teal-50 text-teal-900'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? 'text-teal-700' : 'text-slate-400'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {item.id === 'alerts' && activeAlertCount > 0 && (
                <span className="font-mono text-xs font-semibold text-red-700 tabular-nums">
                  {activeAlertCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* AWS IAM Role Switcher */}
      <div className="border-t border-slate-200 p-4">
        <label htmlFor="staff-role-select" className="block text-xs font-medium text-slate-500">
          Active Staff Role (AWS IAM)
        </label>
        <select
          id="staff-role-select"
          value={currentUserId}
          onChange={(e) => setCurrentUserId(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-800 focus:border-teal-600 focus:bg-white focus:outline-none"
        >
          {STAFF_USERS.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {u.role}
            </option>
          ))}
        </select>
        <p className="mt-2 truncate font-mono text-[11px] text-slate-400" title={currentUser.iamRoleName}>
          {currentUser.iamRoleName}
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#F8FAFC] text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 lg:block">
        <div className="sticky top-0 h-screen">{SidebarContent}</div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-64 max-w-[82vw] border-r border-slate-200 bg-white">
            {SidebarContent}
          </aside>
        </div>
      )}

      {/* Main Workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Clean Contextual Top Bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden text-slate-400 sm:inline whitespace-nowrap">
                MediStock Guardian
              </span>
              <span className="hidden text-slate-300 sm:inline" aria-hidden="true">
                /
              </span>
              <span className="truncate font-medium text-slate-900">{currentNavLabel}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setPrefillMovement({});
              navigateTo('stock-form');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Record Movement
          </button>
        </header>

        {/* Main Viewport Content */}
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {loading ? (
            <div className="space-y-6">
              <div className="h-8 w-56 animate-pulse rounded bg-slate-200" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
                ))}
              </div>
              <div className="h-80 animate-pulse rounded-xl border border-slate-200 bg-white" />
            </div>
          ) : loadError || !snapshot ? (
            <div className="rounded-xl border border-red-200 bg-white p-8 text-center">
              <p className="text-sm font-semibold text-red-700">
                {loadError || 'Unable to load MediStock Guardian inventory.'}
              </p>
              <button
                type="button"
                onClick={fetchSnapshot}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
              >
                <RefreshCw className="h-4 w-4" />
                Retry Connection
              </button>
            </div>
          ) : (
            <>
              {activeScreen === 'dashboard' && (
                <InventoryDashboard
                  snapshot={snapshot}
                  currentUser={currentUser}
                  onCreateLocation={handleCreateLocation}
                  onCreateSupply={handleCreateSupply}
                  onUpdateMinLevel={handleUpdateMinLevel}
                  onQuickStockAction={handleQuickStockAction}
                  onQuickReorder={handleQuickReorder}
                  onViewAlerts={() => navigateTo('alerts')}
                />
              )}

              {activeScreen === 'batches' && (
                <BatchManagement
                  snapshot={snapshot}
                  currentUser={currentUser}
                  onCreateBatch={handleCreateBatch}
                  onUploadDocument={handleUploadDocument}
                  onSelectBatchForMovement={handleQuickStockAction}
                />
              )}

              {activeScreen === 'stock-form' && (
                <StockMovementForm
                  snapshot={snapshot}
                  currentUser={currentUser}
                  preselectedSupplyId={prefillMovement.supplyId}
                  preselectedBatchId={prefillMovement.batchId}
                  preselectedType={prefillMovement.type}
                  onRecordMovement={handleRecordMovement}
                  onUploadDocument={handleUploadDocument}
                  onViewHistory={() => navigateTo('history')}
                  onViewAlerts={() => navigateTo('alerts')}
                />
              )}

              {activeScreen === 'expiry-calendar' && (
                <ExpiryCalendar
                  snapshot={snapshot}
                  onSelectBatchForMovement={handleQuickStockAction}
                />
              )}

              {activeScreen === 'reorders' && (
                <ReorderTracker
                  snapshot={snapshot}
                  currentUser={currentUser}
                  preselectedSupplyId={prefillReorder.supplyId}
                  openCreateInitially={prefillReorder.openModal}
                  onClearPreselect={handleClearReorderPreselect}
                  onCreateReorder={handleCreateReorder}
                  onUpdateReorder={handleUpdateReorder}
                  onUploadDocument={handleUploadDocument}
                />
              )}

              {activeScreen === 'alerts' && (
                <NotificationAlerts
                  snapshot={snapshot}
                  currentUser={currentUser}
                  onRunMonitorCheck={handleRunMonitorCheck}
                  onAcknowledgeAlert={handleAcknowledgeAlert}
                  onInitiateReorder={handleQuickReorder}
                  onDiscardExpiredBatch={handleQuickStockAction}
                />
              )}

              {activeScreen === 'history' && <StockMovementHistory snapshot={snapshot} />}

              {activeScreen === 'reports' && <InventoryReports snapshot={snapshot} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
