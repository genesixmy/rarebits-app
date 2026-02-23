import React, { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip as UiTooltip,
  TooltipContent as UiTooltipContent,
  TooltipProvider as UiTooltipProvider,
  TooltipTrigger as UiTooltipTrigger,
} from '@/components/ui/tooltip';
import { Loader2,
  Package, 
  Truck,
  TrendingUp, 
  TrendingDown,
  BarChart3,
  Wallet,
  CheckCircle,
  XCircle,
  Info,
  Plus,
  Receipt,
  ArrowRight,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { cn } from '@/lib/utils';
import {
  COURIER_PAYMENT_MODES,
  resolveCourierPaymentModeForInvoice,
} from '@/lib/shipping';
import { useTheme } from '@/contexts/ThemeProvider';
import { supabase } from '@/lib/customSupabaseClient';
import { resolveTransactionClassification, TRANSACTION_CLASSIFICATIONS } from '@/components/wallet/transactionClassification';
import {
  calculateBusinessHealth,
  calculateDeadCapitalMetrics,
  DEAD_CAPITAL_THRESHOLD_DAYS,
  getItemAgingDays,
  getItemAvailableQuantity,
} from '@/lib/dashboardHealth';
import { calculateRealityCheck } from '@/lib/dashboardRealityCheck';

const getInitialDateRange = () => {
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const formatDate = (date) => {
    const d = new Date(date);
    let month = '' + (d.getMonth() + 1);
    let day = '' + d.getDate();
    const year = d.getFullYear();

    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;

    return [year, month, day].join('-');
  }

  return {
    startDate: formatDate(firstDayOfMonth),
    endDate: formatDate(today)
  };
};

const SETTLED_INVOICE_STATUSES = new Set(['paid', 'partially_returned', 'returned']);
const NEXT_STEP_PENDING_COMPLETED_STATUSES = new Set(['delivered', 'completed']);

const normalizeLowerText = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
const parsePositiveNumber = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const getInvoiceRecordFromRow = (row) => (row?.invoices && typeof row.invoices === 'object' ? row.invoices : row);

export const computeNextSteps = ({ invoices, inventory }) => {
  const invoiceRows = Array.isArray(invoices) ? invoices : [];
  const inventoryRows = Array.isArray(inventory) ? inventory : [];

  const uniqueInvoicesById = invoiceRows.reduce((acc, row) => {
    const invoice = getInvoiceRecordFromRow(row);
    const invoiceId = invoice?.id;
    if (!invoiceId) return acc;
    if (!acc.has(invoiceId)) acc.set(invoiceId, invoice);
    return acc;
  }, new Map());

  const pendingShippingCount = Array.from(uniqueInvoicesById.values()).reduce((count, invoice) => {
    if (normalizeLowerText(invoice?.status) !== 'paid') return count;
    if (invoice?.shipping_required !== true) return count;

    const shipmentMeta = invoice?.shipment && typeof invoice.shipment === 'object'
      ? invoice.shipment
      : null;
    const trackingNo = normalizeText(shipmentMeta?.tracking_no || invoice?.tracking_no);
    const deliveryStatus = normalizeLowerText(
      shipmentMeta?.delivery_status
      || shipmentMeta?.ship_status
      || invoice?.delivery_status
      || invoice?.ship_status
    );
    const isCompleted = NEXT_STEP_PENDING_COMPLETED_STATUSES.has(deliveryStatus);

    return (trackingNo.length === 0 && !isCompleted) ? count + 1 : count;
  }, 0);

  const soldQtyByItemId = new Map();
  let hasSoldData = false;

  invoiceRows.forEach((row) => {
    const itemId = row?.item_id || row?.item?.id;
    if (!itemId) return;
    hasSoldData = true;

    const baseQty = parsePositiveNumber(row?.quantity);
    const returnedQty = Array.isArray(row?.invoice_item_returns)
      ? row.invoice_item_returns.reduce((sum, returnedRow) => sum + parsePositiveNumber(returnedRow?.returned_quantity), 0)
      : 0;
    const netSoldQty = Math.max(baseQty - returnedQty, 0);
    if (netSoldQty <= 0) return;

    soldQtyByItemId.set(itemId, (soldQtyByItemId.get(itemId) || 0) + netSoldQty);
  });

  const thresholdDays = DEAD_CAPITAL_THRESHOLD_DAYS;
  const nowDate = new Date();
  const riskItems = inventoryRows.filter((item) => {
    const qtyAvailable = getItemAvailableQuantity(item);
    if (qtyAvailable <= 0) return false;
    const ageDays = getItemAgingDays(item?.created_at, nowDate);
    return ageDays !== null && ageDays >= thresholdDays;
  });

  const riskStockCount = riskItems.length;
  const clearanceCount = riskItems.reduce((count, item) => {
    if (!hasSoldData) return count + 1;
    const soldQty = soldQtyByItemId.get(item?.id) || 0;
    return soldQty <= 1 ? count + 1 : count;
  }, 0);

  return {
    pendingShippingCount,
    riskStockCount,
    clearanceCount,
  };
};

const getInvoiceFinancialSummary = (invoice, fallbackOriginal = 0) => {
  const fallback = Math.max(parseFloat(fallbackOriginal) || 0, 0);
  const totalAmountRaw = parseFloat(invoice?.total_amount);
  const totalAmount = Number.isFinite(totalAmountRaw) && totalAmountRaw >= 0
    ? totalAmountRaw
    : fallback;

  const adjustmentRaw = parseFloat(invoice?.adjustment_total);
  const adjustmentTotal = Number.isFinite(adjustmentRaw) && adjustmentRaw > 0
    ? adjustmentRaw
    : 0;

  const returnedRaw = parseFloat(invoice?.returned_total);
  const returnedTotal = Number.isFinite(returnedRaw) && returnedRaw > 0
    ? returnedRaw
    : 0;

  const finalRaw = parseFloat(invoice?.final_total);
  const finalTotal = Number.isFinite(finalRaw)
    ? Math.max(Math.min(finalRaw, totalAmount), 0)
    : Math.max(totalAmount - adjustmentTotal - returnedTotal, 0);

  return {
    totalAmount,
    finalTotal,
    adjustmentTotal,
    returnedTotal,
  };
};

const getHealthTone = (label) => {
  if (label === 'Strong') {
    return {
      fillClass: 'bg-emerald-500',
      chipClass: 'bg-emerald-100 text-emerald-700',
      batteryClass: 'border-emerald-300',
    };
  }
  if (label === 'Stable') {
    return {
      fillClass: 'bg-sky-500',
      chipClass: 'bg-sky-100 text-sky-700',
      batteryClass: 'border-sky-300',
    };
  }
  if (label === 'Weak') {
    return {
      fillClass: 'bg-amber-500',
      chipClass: 'bg-amber-100 text-amber-700',
      batteryClass: 'border-amber-300',
    };
  }
  return {
    fillClass: 'bg-rose-500',
    chipClass: 'bg-rose-100 text-rose-700',
    batteryClass: 'border-rose-300',
  };
};

const getDeadCapitalTone = (deadCapitalPct) => {
  if (deadCapitalPct > 20) {
    return {
      label: 'Tinggi',
      chipClass: 'border-rose-200 bg-rose-100 text-rose-700',
      fillClass: 'bg-rose-500',
      batteryClass: 'border-rose-300',
    };
  }

  if (deadCapitalPct >= 10) {
    return {
      label: 'Waspada',
      chipClass: 'border-amber-200 bg-amber-100 text-amber-700',
      fillClass: 'bg-amber-500',
      batteryClass: 'border-amber-300',
    };
  }

  return {
    label: 'Sihat',
    chipClass: 'border-emerald-200 bg-emerald-100 text-emerald-700',
    fillClass: 'bg-emerald-500',
    batteryClass: 'border-emerald-300',
  };
};

const formatSignedPercent = (value) => {
  if (!Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
};

const getRevenueChipTone = (value) => {
  if (!Number.isFinite(value)) return 'bg-indigo-100 text-indigo-700 border-indigo-200';
  if (value >= 0) return 'bg-indigo-100 text-indigo-700 border-indigo-200';
  return 'bg-indigo-50 text-indigo-700 border-indigo-200';
};

const getProfitChipTone = (value) => {
  if (!Number.isFinite(value)) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (value >= 0) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  return 'bg-rose-100 text-rose-700 border-rose-200';
};

const getRealityOverallBadge = (severity) => {
  if (severity === 'ALERT') {
    return {
      label: 'ALERT',
      className: 'bg-rose-100 text-rose-700 border-rose-200',
    };
  }
  if (severity === 'GOOD') {
    return {
      label: 'GOOD',
      className: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    };
  }
  return {
    label: 'INFO',
    className: 'bg-slate-100 text-slate-700 border-slate-200',
  };
};

const getRealityInsightTone = (severity) => {
  if (severity === 'ALERT') {
    return {
      card: 'border-rose-200 bg-rose-50/75',
      iconWrap: 'bg-rose-100 text-rose-700',
      suggestionWrap: 'border-rose-200 bg-white/85 text-rose-700',
    };
  }
  if (severity === 'GOOD') {
    return {
      card: 'border-emerald-200 bg-emerald-50/75',
      iconWrap: 'bg-emerald-100 text-emerald-700',
      suggestionWrap: 'border-emerald-200 bg-white/85 text-emerald-700',
    };
  }
  return {
    card: 'border-amber-200 bg-amber-50/75',
    iconWrap: 'bg-amber-100 text-amber-700',
    suggestionWrap: 'border-amber-200 bg-white/85 text-amber-700',
  };
};

const getRealityInsightIcon = (insight) => {
  if (insight?.key === 'shipping_margin_pressure') return Truck;
  if (insight?.key === 'restock_spike_low_sales') return Package;
  if (insight?.key === 'healthy_movement') return TrendingUp;
  if (insight?.severity === 'ALERT') return TrendingDown;
  return Info;
};

const formatRM = (value) => `RM ${Number.parseFloat(value || 0).toFixed(2)}`;
const GLASS_CARD_CLASS =
  'rounded-2xl border border-white/65 bg-white/70 backdrop-blur-xl shadow-[0_14px_34px_-24px_rgba(148,163,184,0.5)]';

const GlassCard = ({ className, children, ...props }) => (
  <Card className={cn(GLASS_CARD_CLASS, className)} {...props}>
    {children}
  </Card>
);

const KpiCard = ({ title, value, subtext, icon: Icon, toneClass = 'bg-slate-100 text-slate-700' }) => (
  <GlassCard className="overflow-hidden">
    <CardContent className="space-y-2.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{title}</p>
        <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-xl', toneClass)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="text-[1.55rem] font-semibold leading-none tracking-tight text-slate-900">{value}</p>
      <p className="truncate text-xs text-slate-500">{subtext}</p>
    </CardContent>
  </GlassCard>
);

const getActionBadgeClasses = (tone) => {
  if (tone === 'warning') {
    return 'border-amber-200 bg-amber-100 text-amber-800';
  }
  if (tone === 'primary') {
    return 'border-indigo-200 bg-indigo-100 text-indigo-700';
  }
  return 'border-slate-200 bg-slate-100 text-slate-600';
};

const ActionRow = ({ label, description, value, valueTone = 'neutral', to, tooltip }) => (
  <Link
    to={to}
    className="group flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-slate-100/70"
  >
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        {tooltip ? (
          <UiTooltip>
            <UiTooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:text-slate-500"
                onClick={(event) => event.preventDefault()}
                aria-label={`Info ${label}`}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </UiTooltipTrigger>
            <UiTooltipContent side="top" className="max-w-[220px] text-xs">
              {tooltip}
            </UiTooltipContent>
          </UiTooltip>
        ) : null}
      </div>
      <p className="truncate text-xs text-slate-500">{description}</p>
    </div>
    <div className="inline-flex shrink-0 items-center gap-1.5">
      <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold shadow-sm', getActionBadgeClasses(valueTone))}>
        {value}
      </span>
      <ArrowRight className="h-3.5 w-3.5 text-slate-400 transition-transform group-hover:translate-x-0.5" />
    </div>
  </Link>
);

const InsightCard = ({ title, badge, action, children, className }) => (
  <GlassCard className={cn('overflow-hidden', className)}>
    <CardHeader className="pb-2">
      <div className="flex items-center justify-between gap-2">
        <CardTitle className="text-sm font-semibold text-slate-900">{title}</CardTitle>
        {action ? action : badge}
      </div>
    </CardHeader>
    <CardContent className="pt-0">{children}</CardContent>
  </GlassCard>
);

const EmptyStateMini = ({ message }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-7 text-center">
    <svg viewBox="0 0 96 72" className="h-16 w-24 text-indigo-200" aria-hidden="true">
      <rect x="8" y="22" width="80" height="40" rx="10" fill="currentColor" opacity="0.22" />
      <rect x="18" y="12" width="60" height="36" rx="9" fill="currentColor" opacity="0.4" />
      <circle cx="48" cy="30" r="8" fill="currentColor" opacity="0.75" />
      <circle cx="33" cy="30" r="1.5" fill="#ffffff" />
      <circle cx="63" cy="30" r="1.5" fill="#ffffff" />
      <path d="M40 36h16" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
    </svg>
    <p className="max-w-[22rem] text-xs text-slate-500">{message}</p>
  </div>
);

const DashboardHero = ({ userDisplayName, summaryText, priorityLine }) => (
  <GlassCard className="relative overflow-hidden">
    <span className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-gradient-to-br from-violet-300/45 to-indigo-400/30 blur-2xl" />
    <span className="pointer-events-none absolute right-24 top-16 h-24 w-24 rounded-full bg-emerald-200/30 blur-xl" />
    <CardContent className="relative z-10 flex flex-col gap-4 p-5 sm:p-6 lg:min-h-[168px] lg:flex-row lg:items-center lg:justify-between">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.09em] text-slate-500">Welcome Back</p>
        <h2 className="font-['Roboto'] text-[24px] font-semibold leading-tight text-primary sm:text-[26px]">Selamat Kembali, {userDisplayName}</h2>
        <p className="max-w-[44ch] text-[14.5px] text-slate-600">{summaryText}</p>
        <p className="text-xs font-medium text-slate-500">{priorityLine}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/80 bg-white/75 p-2.5 shadow-sm backdrop-blur-sm">
        <Button asChild variant="outline" size="sm" className="h-9 rounded-xl border-white/80 bg-white/80 px-3">
          <Link to="/inventory" className="inline-flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Tambah Item
          </Link>
        </Button>
        <Button asChild size="sm" className="h-9 rounded-xl bg-primary px-3 text-primary-foreground hover:bg-primary/90">
          <Link to="/invoices/create" className="inline-flex items-center gap-1.5">
            <Receipt className="h-3.5 w-3.5" />
            Invois Baru
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="h-9 rounded-xl border-white/80 bg-white/80 px-3">
          <Link to="/invoices?status=paid&shipping_state=pending" className="inline-flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5" />
            Semak Penghantaran
          </Link>
        </Button>
      </div>
    </CardContent>
  </GlassCard>
);

const DashboardNextSteps = ({ steps }) => (
  <GlassCard>
    <CardHeader className="pb-1 sm:pb-0">
      <CardTitle className="text-[17px] font-semibold text-slate-900">Apa perlu buat seterusnya</CardTitle>
    </CardHeader>
    <CardContent className="pt-0 sm:pt-1">
      <div className="divide-y divide-white/80">
        {steps.map((step) => (
          <ActionRow
            key={step.label}
            label={step.label}
            description={step.description}
            value={step.value}
            valueTone={step.valueTone}
            to={step.to}
            tooltip={step.tooltip}
          />
        ))}
      </div>
    </CardContent>
  </GlassCard>
);

const DashboardKpiGrid = ({
  filteredStats,
  netProfitPercentText,
  businessWalletBalance,
  totalUnitStock,
  soldUnitMovementPercent,
}) => {
  const cards = [
    {
      key: 'revenue',
      title: 'Revenue Item',
      value: formatRM(filteredStats.totalRevenue),
      subtext: `${filteredStats.soldItemsCount} jualan`,
      icon: Wallet,
      tone: 'bg-emerald-100 text-emerald-700',
    },
    {
      key: 'profit',
      title: 'Untung Sebenar',
      value: formatRM(filteredStats.totalProfit),
      subtext: netProfitPercentText,
      icon: TrendingUp,
      tone: 'bg-violet-100 text-violet-700',
    },
    {
      key: 'wallet',
      title: 'Baki Duit Semasa',
      value: formatRM(parseFloat(businessWalletBalance?.balance || 0)),
      subtext: businessWalletBalance?.name ? `${businessWalletBalance.name} (live)` : 'Wallet Business',
      icon: Wallet,
      tone: 'bg-indigo-100 text-indigo-700',
    },
    {
      key: 'units',
      title: 'Unit Terjual',
      value: `${filteredStats.totalQuantitySold}`,
      subtext: `${filteredStats.totalQuantitySold}/${totalUnitStock} unit - ${soldUnitMovementPercent.toFixed(1)}% bergerak`,
      icon: CheckCircle,
      tone: 'bg-amber-100 text-amber-700',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <KpiCard
          key={card.key}
          title={card.title}
          value={card.value}
          subtext={card.subtext}
          icon={card.icon}
          toneClass={card.tone}
        />
      ))}
    </div>
  );
};

const DashboardFiltersBar = ({
  dateRange,
  setDateRange,
  isFiltersOpen,
  setIsFiltersOpen,
}) => {
  const toDisplayDate = (value) => {
    if (!value) return '-';
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString('en-GB');
  };

  return (
    <GlassCard>
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 text-sm text-slate-600">
            <SlidersHorizontal className="h-4 w-4" />
            <span>{toDisplayDate(dateRange.startDate)} - {toDisplayDate(dateRange.endDate)}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-xl border-white/80 bg-white/80"
            onClick={() => setIsFiltersOpen((prev) => !prev)}
          >
            Tapis
            {isFiltersOpen ? <ChevronUp className="ml-1 h-3.5 w-3.5" /> : <ChevronDown className="ml-1 h-3.5 w-3.5" />}
          </Button>
        </div>

        {isFiltersOpen ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Tarikh Mula</label>
              <Input
                type="date"
                value={dateRange.startDate}
                onChange={(event) => setDateRange((prev) => ({ ...prev, startDate: event.target.value }))}
                className="h-9 rounded-xl border-white/80 bg-white/80"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Tarikh Akhir</label>
              <Input
                type="date"
                value={dateRange.endDate}
                onChange={(event) => setDateRange((prev) => ({ ...prev, endDate: event.target.value }))}
                className="h-9 rounded-xl border-white/80 bg-white/80"
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => setDateRange(getInitialDateRange())}
                className="h-9 w-full rounded-xl border-white/80 bg-white/80 md:w-auto"
              >
                Tetapkan Semula
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </GlassCard>
  );
};

const DashboardInsightsSidebar = ({
  healthTone,
  healthData,
  healthReasons,
  healthScorePercent,
  deadCapitalMetrics,
  deadCapitalTone,
  isDeadCapitalTooltipOpen,
  setIsDeadCapitalTooltipOpen,
  platformBarData,
  filteredSalesCount,
  defaultColors,
  isDark,
  tickColor,
  gridColor,
  tooltipBg,
  tooltipBorder,
  tooltipTextColor,
}) => {
  const [showDeadItems, setShowDeadItems] = useState(false);
  // Mirror Business Health style: fuller bar means healthier stock mix.
  const deadCapitalProgressWidth = deadCapitalMetrics.hasStockValue
    ? Math.max(0, Math.min(100 - (deadCapitalMetrics.deadPercent || 0), 100))
    : 0;

  return (
  <div className="space-y-4">
    <h2 className="px-1 text-[17px] font-semibold text-slate-900">Insights</h2>

    <InsightCard
      title="Business Health"
      badge={<span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold', healthTone.chipClass)}>{healthData.label}</span>}
    >
      <div className="space-y-2">
        <div className="flex items-end justify-between gap-2">
          <p className="text-xl font-semibold leading-none text-slate-900">{healthScorePercent}%</p>
          <p className="text-xs text-slate-500">Cash cover {healthData.metrics.cashBufferDays.toFixed(1)} hari</p>
        </div>
        <div className={cn('relative h-2 overflow-hidden rounded-full border bg-slate-100', healthTone.batteryClass)}>
          <div
            className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-300', healthTone.fillClass)}
            style={{ width: `${healthScorePercent}%` }}
          />
        </div>
        <p className="line-clamp-2 text-xs text-slate-500">{healthReasons[0] || 'Tiada isu utama dikesan.'}</p>
      </div>
    </InsightCard>

    <InsightCard
      title="Dead Capital"
      action={
        <div className="flex items-center gap-1.5">
          {deadCapitalMetrics.hasStockValue ? (
            <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold', deadCapitalTone.chipClass)}>
              {deadCapitalTone.label}
            </span>
          ) : null}
          <UiTooltip open={isDeadCapitalTooltipOpen} onOpenChange={setIsDeadCapitalTooltipOpen}>
            <UiTooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setIsDeadCapitalTooltipOpen((prev) => !prev);
                }}
                aria-label="Apa itu Dead Capital?"
              >
                <Info className="h-4 w-4" />
              </button>
            </UiTooltipTrigger>
            <UiTooltipContent side="top" className="z-[80] max-w-[280px] text-xs leading-relaxed">
              <p className="font-semibold text-slate-900">Dead Capital</p>
              <p className="mt-1 text-slate-600">Dead capital = modal terkunci dalam stok yang tidak terjual &gt;= {deadCapitalMetrics.thresholdDays} hari.</p>
              <p className="mt-1 text-slate-600">Kiraan: (Cost x Kuantiti tersedia) untuk item lama &gt;= {deadCapitalMetrics.thresholdDays} hari.</p>
              <p className="mt-1 text-slate-600">Termasuk unit reserved kerana modal masih terkunci.</p>
              <p className="mt-1 text-slate-600">Kenapa ini penting: modal beku -&gt; susah pusing stok &amp; cashflow.</p>
            </UiTooltipContent>
          </UiTooltip>
        </div>
      }
    >
      <div className="space-y-2.5">
        {deadCapitalMetrics.hasStockValue ? (
          <>
            <p className="text-sm text-slate-900">
              <span className="text-xl font-semibold leading-none text-slate-900">{deadCapitalMetrics.deadPercentRounded}%</span>{' '}
              modal sedang tidur
            </p>
            <p className="text-xs text-slate-600">
              {formatRM(deadCapitalMetrics.deadValue)} / {formatRM(deadCapitalMetrics.totalStockValue)}
            </p>
            <div className="relative h-2 overflow-hidden rounded-full border border-emerald-300 bg-slate-100">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${deadCapitalProgressWidth}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-rose-100 bg-rose-50/70 px-2 py-1.5">
                <p className="font-semibold text-rose-700">Dead</p>
                <p className="text-rose-800">{formatRM(deadCapitalMetrics.deadValue)}</p>
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-2 py-1.5">
                <p className="font-semibold text-emerald-700">Active</p>
                <p className="text-emerald-800">{formatRM(deadCapitalMetrics.activeValue)}</p>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              &gt;= {deadCapitalMetrics.thresholdDays} hari tanpa bergerak
            </p>
          </>
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-700">Tiada stok aktif</p>
            <p className="text-xs text-slate-500">
              {deadCapitalMetrics.hasStockUnits
                ? 'Stok ada tetapi nilai kos belum lengkap.'
                : 'Tambah stok untuk mula ukur modal yang terkunci.'}
            </p>
          </div>
        )}

        {deadCapitalMetrics.missingCostItemsCount > 0 ? (
          <p className="text-[11px] text-amber-700">
            {deadCapitalMetrics.missingCostItemsCount} item tanpa kos (dikira RM0).
          </p>
        ) : null}

        {deadCapitalMetrics.topDeadItems.length > 0 ? (
          <div className="space-y-1.5">
            <button
              type="button"
              className="inline-flex items-center rounded-md border border-slate-200 bg-white/80 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
              onClick={() => setShowDeadItems((prev) => !prev)}
            >
              {showDeadItems ? 'Sembunyi item' : 'Lihat item'}
            </button>

            {showDeadItems ? (
              <div className="space-y-1.5">
                {deadCapitalMetrics.topDeadItems.map((item) => (
                  <div key={item.id || `${item.name}-${item.ageDays}`} className="rounded-lg border border-slate-200 bg-white/80 px-2.5 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-1 text-xs font-semibold text-slate-800">{item.name}</p>
                      <p className="text-xs font-semibold text-slate-900">{formatRM(item.deadValue)}</p>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {item.ageDays || 0} hari | Qty {item.qtyStuck}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </InsightCard>

    <InsightCard
      title="Platform Jualan"
      action={
        <Link to="/sales" className="text-xs font-medium text-primary hover:underline">
          Tukar ke kategori
        </Link>
      }
    >
      <div>
        {platformBarData.length > 0 ? (
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={platformBarData} margin={{ top: 8, right: 8, left: -12, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="name" stroke={tickColor} tick={{ fill: tickColor, fontSize: 11 }} />
              <YAxis stroke={tickColor} tick={{ fill: tickColor, fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)' }}
                contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, borderRadius: '0.5rem' }}
                itemStyle={{ color: tooltipTextColor }}
                labelStyle={{ color: tooltipTextColor, fontWeight: 'bold' }}
                formatter={(value) => [`${value} jualan`]}
              />
              <Bar dataKey="jumlah" barSize={20} radius={[5, 5, 0, 0]}>
                {platformBarData.map((entry, index) => (
                  <Cell key={`platform-cell-${entry.name}-${index}`} fill={defaultColors[index % defaultColors.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyStateMini message={filteredSalesCount > 0 ? 'Platform belum dapat dirumuskan.' : 'Belum ada data platform dalam tempoh ini.'} />
        )}
      </div>
    </InsightCard>
  </div>
  );
};

const DashboardOperations = ({
  isLoadingSales,
  recentSales,
  getEffectiveCostPrice,
  revenueByInvoice,
  invoiceFinancialById,
  channelFeeByInvoice,
  shippingByInvoice,
  platformBarData,
  filteredSalesCount,
  defaultColors,
  isDark,
  tickColor,
  gridColor,
  tooltipBg,
  tooltipBorder,
  tooltipTextColor,
  realityCheckData,
  realityOverallBadge,
  realityRevenueChipLabel,
  realityProfitChipLabel,
  realityInsights,
  realityOnboardingMessage,
  healthTone,
  healthData,
  healthReasons,
  healthScorePercent,
  deadCapitalMetrics,
  deadCapitalTone,
  isDeadCapitalTooltipOpen,
  setIsDeadCapitalTooltipOpen,
}) => {
  let remainingActionSlots = 3;
  const realityInsightsWithActions = (realityInsights || []).slice(0, 2).map((insight) => {
    const insightActions = Array.isArray(insight?.actions) ? insight.actions.slice(0, 2) : [];
    const allowedActions = insightActions.slice(0, Math.max(remainingActionSlots, 0));
    remainingActionSlots -= allowedActions.length;

    return {
      ...insight,
      actions: allowedActions,
    };
  });

  return (
  <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
    <div className="space-y-5 xl:col-span-2">
      <GlassCard>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <div>
            <CardTitle className="text-[17px] font-semibold text-slate-900">Aktiviti</CardTitle>
            <p className="text-xs text-slate-500">Jualan terkini</p>
          </div>
          <Button asChild variant="outline" size="sm" className="h-8 rounded-xl border-white/80 bg-white/80">
            <Link to="/sales">Lihat semua</Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="p-3 font-medium">Item</th>
                  <th className="p-3 font-medium">Tarikh</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 text-right font-medium">Harga</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingSales ? (
                  <tr>
                    <td colSpan="4" className="py-8 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </td>
                  </tr>
                ) : recentSales.length > 0 ? (
                  recentSales.map((sale, index) => {
                    const quantity = sale.quantity || 1;
                    const costPrice = getEffectiveCostPrice(sale);
                    const totalCost = costPrice * quantity;
                    const totalRevenue = parseFloat(sale.line_total) || 0;
                    const invoiceId = sale?.invoices?.id;
                    const invoiceRevenue = invoiceId ? (revenueByInvoice.get(invoiceId) || 0) : 0;
                    const invoiceAdjustment = invoiceId ? (invoiceFinancialById.get(invoiceId)?.adjustmentTotal || 0) : 0;
                    const invoiceChannelFee = invoiceId ? (channelFeeByInvoice.get(invoiceId) || 0) : 0;
                    const channelFeeShare = invoiceRevenue > 0 ? (totalRevenue / invoiceRevenue) * invoiceChannelFee : 0;
                    const shippingInvoice = invoiceId ? shippingByInvoice.get(invoiceId) : null;
                    const shippingCharged = Math.max(parseFloat(shippingInvoice?.shippingCharged) || 0, 0);
                    const shippingCostPaid = Math.max(parseFloat(shippingInvoice?.shippingCostPaid) || 0, 0);
                    const shippingChargedShare = invoiceRevenue > 0 ? (totalRevenue / invoiceRevenue) * shippingCharged : 0;
                    const shippingCostShare = invoiceRevenue > 0 ? (totalRevenue / invoiceRevenue) * shippingCostPaid : 0;
                    const shippingProfitShare = shippingChargedShare - shippingCostShare;
                    const adjustmentShare = invoiceRevenue > 0 ? (totalRevenue / invoiceRevenue) * invoiceAdjustment : 0;
                    const profit = totalRevenue - totalCost - channelFeeShare + shippingProfitShare - adjustmentShare;
                    const isLoss = profit < 0;

                    return (
                      <tr key={`${sale.id}-${index}`} className="border-t">
                        <td className="p-3 text-sm font-semibold text-foreground">
                          {sale.is_manual ? (sale.item_name || 'Item Manual') : (sale.items?.name || 'Item Tidak Dikenali')}
                        </td>
                        <td className="p-3 text-sm text-muted-foreground">
                          {new Date(sale.invoices?.invoice_date || new Date()).toLocaleDateString()}
                        </td>
                        <td className="p-3">
                          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', isLoss ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700')}>
                            {isLoss ? <XCircle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
                            {formatRM(Math.abs(profit))}
                          </span>
                        </td>
                        <td className="p-3 text-right text-sm font-semibold text-foreground">{formatRM(totalRevenue)}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="4" className="py-2">
                      <EmptyStateMini message="Belum ada jualan dalam tempoh ini." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </GlassCard>

      <GlassCard>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-[17px] font-semibold text-slate-900">Reality Check - Minggu Ini</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                {realityCheckData.windows.thisWeek.startDate} - {realityCheckData.windows.thisWeek.endDate}
              </span>
              <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold", realityOverallBadge.className)}>
                {realityOverallBadge.label}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-indigo-200/60 bg-indigo-50/60 p-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">Revenue</p>
              <p className="mt-0.5 text-lg font-bold text-indigo-900">RM {realityCheckData.thisWeek.revenueTotal.toFixed(2)}</p>
              <span className={cn("mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", getRevenueChipTone(realityCheckData.revenueChangePct))}>
                {realityRevenueChipLabel}
              </span>
            </div>
            <div className="rounded-lg border border-emerald-200/60 bg-emerald-50/60 p-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Profit</p>
              <p className="mt-0.5 text-lg font-bold text-emerald-900">RM {realityCheckData.thisWeek.profitTotal.toFixed(2)}</p>
              <span className={cn("mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", getProfitChipTone(realityCheckData.profitChangePct))}>
                {realityProfitChipLabel}
              </span>
            </div>
          </div>

          {realityOnboardingMessage ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {realityOnboardingMessage}
            </div>
          ) : null}

          <div className="space-y-2">
            {realityInsightsWithActions.map((insight) => {
              const Icon = getRealityInsightIcon(insight);
              const tone = getRealityInsightTone(insight.severity);
              const severityBadge = getRealityOverallBadge(insight.severity);
              return (
                <div key={insight.key} className={cn("rounded-xl border px-3 py-3", tone.card)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className={cn("mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md", tone.iconWrap)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="space-y-1.5">
                        <p className="text-sm font-semibold text-slate-900">{insight.title}</p>
                        <p className="text-sm leading-snug text-slate-700">
                          <span className="font-semibold">Apa berlaku:</span> {insight.observation}
                        </p>
                        <p className="text-sm leading-snug text-slate-700">
                          <span className="font-semibold">Kesan:</span> {insight.impact}
                        </p>
                      </div>
                    </div>
                    <span className={cn("inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold", severityBadge.className)}>
                      {severityBadge.label}
                    </span>
                  </div>
                  <div className={cn("mt-2 rounded-lg border px-2.5 py-2 text-sm", tone.suggestionWrap)}>
                    <span className="font-semibold">Cadangan:</span> {insight.suggestion}
                  </div>

                  {insight.actions.length > 0 ? (
                    <div className="mt-2.5 space-y-1.5">
                      <p className="text-xs font-semibold text-slate-700">Apa anda boleh buat:</p>
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        {insight.actions.map((action, actionIndex) => (
                          <Button
                            key={`${insight.key}-action-${actionIndex}`}
                            asChild
                            size="sm"
                            variant={action.variant === 'outline' ? 'outline' : 'default'}
                            className="h-8 justify-start sm:justify-center"
                          >
                            <Link to={action.href}>{action.label}</Link>
                          </Button>
                        ))}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Tip: fokus 1 tindakan dulu - perubahan kecil pun beri kesan.
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!realityOnboardingMessage && realityInsights.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                Tiada perubahan besar minggu ini. Teruskan pantau jualan dan margin.
              </div>
            ) : null}
          </div>
        </CardContent>
      </GlassCard>
    </div>

    <DashboardInsightsSidebar
      healthTone={healthTone}
      healthData={healthData}
      healthReasons={healthReasons}
      healthScorePercent={healthScorePercent}
      deadCapitalMetrics={deadCapitalMetrics}
      deadCapitalTone={deadCapitalTone}
      isDeadCapitalTooltipOpen={isDeadCapitalTooltipOpen}
      setIsDeadCapitalTooltipOpen={setIsDeadCapitalTooltipOpen}
      platformBarData={platformBarData}
      filteredSalesCount={filteredSalesCount}
      defaultColors={defaultColors}
      isDark={isDark}
      tickColor={tickColor}
      gridColor={gridColor}
      tooltipBg={tooltipBg}
      tooltipBorder={tooltipBorder}
      tooltipTextColor={tooltipTextColor}
    />
  </div>
  );
};

const Dashboard = ({ items, isInventoryLoading = false }) => {
  const { theme } = useTheme();
  const [dateRange, setDateRange] = useState(getInitialDateRange());
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [userId, setUserId] = useState(null);
  const [userDisplayName, setUserDisplayName] = useState('Pengguna');
  const [isDeadCapitalTooltipOpen, setIsDeadCapitalTooltipOpen] = useState(false);

  // Get current user ID
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id);
      const metadataName = user?.user_metadata?.username
        || user?.user_metadata?.full_name
        || user?.user_metadata?.name;
      const emailName = user?.email ? user.email.split('@')[0] : null;
      setUserDisplayName(metadataName || emailName || 'Pengguna');
    };
    getUser();
  }, []);

  // Fetch invoice items (all sales records) instead of items table
  const { data: invoiceItems = [], isLoading: isLoadingSales } = useQuery({
    queryKey: ['dashboard-sales', userId],
    queryFn: async () => {
      if (!userId) return [];
      
      const { data, error } = await supabase
        .from('invoice_items')
        .select(`
          id,
          item_id,
          quantity,
          unit_price,
          cost_price,
          line_total,
          is_manual,
          item_name,
          items(id, name, category, cost_price, user_id),
          invoice_item_returns(returned_quantity, refund_amount, returned_unit_price, returned_cost_price),
          invoices(*)
        `);

      if (error) {
        console.error('[Dashboard] Error fetching invoice items:', error);
        return [];
      }

      // Filter to only current user's invoices with paid status
      const paidRows = (data || []).filter(invItem => 
        invItem.invoices && 
        invItem.invoices.user_id === userId &&
        SETTLED_INVOICE_STATUSES.has(invItem.invoices.status)
      );

      const shipmentIds = [...new Set(
        paidRows
          .map((row) => row?.invoices?.shipment_id)
          .filter(Boolean)
      )];

      const shipmentById = new Map();
      if (shipmentIds.length > 0) {
        const { data: shipmentRows, error: shipmentError } = await supabase
          .from('shipments')
          .select('id, user_id, shipping_cost, courier_paid, tracking_no, ship_status')
          .eq('user_id', userId)
          .in('id', shipmentIds);

        if (shipmentError) {
          console.error('[Dashboard] Error fetching shipments:', shipmentError);
        } else {
          (shipmentRows || []).forEach((shipment) => {
            shipmentById.set(shipment.id, shipment);
          });
        }
      }

      return paidRows.map((row) => ({
        ...row,
        invoices: {
          ...row.invoices,
          shipment: row?.invoices?.shipment_id
            ? (shipmentById.get(row.invoices.shipment_id) || null)
            : null,
        },
      }));
    },
    enabled: !!userId
  });

  // Fetch Business wallet IDs
  const { data: businessWallets = [] } = useQuery({
    queryKey: ['business-wallets', userId],
    queryFn: async () => {
      if (!userId) return [];
      
      const { data, error } = await supabase
        .from('wallets')
        .select('id')
        .eq('user_id', userId)
        .eq('account_type', 'Business');
      
      if (error) {
        console.error('[Dashboard] Error fetching business wallets:', error);
        return [];
      }
      return data || [];
    },
    enabled: !!userId
  });

  const businessWalletIds = businessWallets.map(w => w.id);

  // Fetch primary business wallet balance (independent from date filters)
  const { data: businessWalletBalance = null } = useQuery({
    queryKey: ['dashboard-business-wallet-balance', userId],
    queryFn: async () => {
      if (!userId) return null;

      const { data, error } = await supabase
        .from('wallets')
        .select('id, name, balance, account_type, created_at')
        .eq('user_id', userId)
        .eq('account_type', 'Business')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[Dashboard] Error fetching business wallet balance:', error);
        return null;
      }

      return data || null;
    },
    enabled: !!userId,
    refetchOnWindowFocus: true,
    staleTime: 30 * 1000,
  });

  // Fetch Business expenses only
  const { data: businessExpenses = { total: 0, nonShipping: 0, shipping: 0 } } = useQuery({
    queryKey: ['dashboard-expenses', userId, businessWalletIds.length, dateRange.startDate, dateRange.endDate],
    queryFn: async () => {
      console.log('[Dashboard] Expenses query executing:', { userId, walletCount: businessWalletIds.length, startDate: dateRange.startDate, endDate: dateRange.endDate });
      
      if (!userId || businessWalletIds.length === 0) return 0;
      
      // Adjust end date to include full day - use full ISO timestamp format
      const endDate = new Date(dateRange.endDate);
      endDate.setHours(23, 59, 59, 999);
      const endDateISO = endDate.toISOString();
      
      const { data, error } = await supabase
        .from('transactions')
        .select('amount, type, transaction_type, category, invoice_id, reference_type')
        .eq('user_id', userId)
        .in('wallet_id', businessWalletIds)
        .gte('transaction_date', dateRange.startDate)
        .lte('transaction_date', endDateISO);
      
      if (error) {
        console.error('[Dashboard] Error fetching expenses:', error);
        return { total: 0, nonShipping: 0, shipping: 0 };
      }
      
      const totals = (data || []).reduce((acc, tx) => {
        const classification = resolveTransactionClassification(tx);
        if (classification !== TRANSACTION_CLASSIFICATIONS.EXPENSE) {
          return acc;
        }
        const amountAbs = Math.abs(parseFloat(tx.amount) || 0);
        acc.total += amountAbs;
        if (tx.reference_type === 'shipment') {
          acc.shipping += amountAbs;
        } else {
          acc.nonShipping += amountAbs;
        }
        return acc;
      }, { total: 0, nonShipping: 0, shipping: 0 });
      console.log('[Dashboard] Expenses fetched:', { count: data?.length || 0, totals, data });
      return totals;
    },
    enabled: !!userId && businessWalletIds.length > 0 && !!dateRange.startDate && !!dateRange.endDate
  });

  // Fetch all invoice refund adjustments (goodwill + return)
  const { data: totalRefunds = 0 } = useQuery({
    queryKey: ['dashboard-refunds', userId, dateRange.startDate, dateRange.endDate],
    queryFn: async () => {
      console.log('[Dashboard] Refunds query executing:', { userId, startDate: dateRange.startDate, endDate: dateRange.endDate });
      
      if (!userId) return 0;
      
      // Adjust end date to include full day - use full ISO timestamp format
      const endDate = new Date(dateRange.endDate);
      endDate.setHours(23, 59, 59, 999);
      const endDateISO = endDate.toISOString();
      
      const { data, error } = await supabase
        .from('invoice_refunds')
        .select('amount')
        .eq('user_id', userId)
        .gte('created_at', dateRange.startDate)
        .lte('created_at', endDateISO);
      
      if (error) {
        console.error('[Dashboard] Error fetching refunds:', error);
        return 0;
      }
      
      const total = (data || []).reduce((sum, ref) => sum + (parseFloat(ref.amount) || 0), 0);
      console.log('[Dashboard] Refunds fetched:', { count: data?.length || 0, total, data });
      return total;
    },
    enabled: !!userId && !!dateRange.startDate && !!dateRange.endDate
  });

  const { data: expensesTotal30d = 0 } = useQuery({
    queryKey: ['dashboard-expenses-30d', userId, businessWalletIds.length],
    queryFn: async () => {
      if (!userId || businessWalletIds.length === 0) return 0;

      const now = new Date();
      const startDate = new Date();
      startDate.setDate(now.getDate() - 29);
      const endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      const startDateStr = startDate.toISOString().slice(0, 10);
      const endDateStr = endDate.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from('transactions')
        .select('amount, type, transaction_type, category, invoice_id, reference_type')
        .eq('user_id', userId)
        .in('wallet_id', businessWalletIds)
        .gte('transaction_date', startDateStr)
        .lte('transaction_date', endDateStr);

      if (error) {
        console.error('[Dashboard] Error fetching 30-day expenses:', error);
        return 0;
      }

      return (data || []).reduce((sum, tx) => {
        const classification = resolveTransactionClassification(tx);
        if (classification !== TRANSACTION_CLASSIFICATIONS.EXPENSE) return sum;
        return sum + Math.abs(parseFloat(tx.amount) || 0);
      }, 0);
    },
    enabled: !!userId && businessWalletIds.length > 0,
    staleTime: 30 * 1000,
  });

  const sales30dStats = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 29);

    const rows = invoiceItems.filter((sale) => {
      const invoiceDate = sale?.invoices?.invoice_date;
      if (!invoiceDate) return false;
      const parsed = new Date(invoiceDate);
      if (Number.isNaN(parsed.getTime())) return false;
      return parsed >= cutoff;
    });

    const soldQty30d = rows.reduce((sum, sale) => sum + getNetSoldQuantityForSale(sale), 0);

    const categorySales30d = rows.reduce((acc, sale) => {
      const category = sale.is_manual ? 'Manual' : (sale.items?.category || 'Lain-lain');
      acc[category] = (acc[category] || 0) + getNetItemRevenueForSale(sale);
      return acc;
    }, {});

    return {
      soldQty30d,
      categorySales30d,
    };
  }, [invoiceItems]);

  const healthData = useMemo(() => {
    return calculateBusinessHealth({
      items,
      walletBalance: parseFloat(businessWalletBalance?.balance) || 0,
      expensesTotal30d,
      soldQty30d: sales30dStats.soldQty30d,
      categorySales30d: sales30dStats.categorySales30d,
      underperformThresholdValue: 200,
    });
  }, [items, businessWalletBalance?.balance, expensesTotal30d, sales30dStats]);

  const healthReasons = useMemo(() => {
    return (healthData.reasons || []).slice(0, 2).map((reason) => {
      if (reason.key === 'stuck_capital') {
        return `RM${(reason.value || 0).toFixed(2)} modal tersekat >60 hari`;
      }
      if (reason.key === 'underperform_categories') {
        return `${reason.value || 0} kategori underperform`;
      }
      if (reason.key === 'cash_buffer_low') {
        return `Baki wallet rendah (cover ${(reason.value || 0).toFixed(1)} hari)`;
      }
      if (reason.key === 'sell_through_low') {
        return `Sell-through rendah (${((reason.value || 0) * 100).toFixed(1)}%/30 hari)`;
      }
      return '';
    }).filter(Boolean);
  }, [healthData.reasons]);
  const healthScorePercent = Math.max(0, Math.min(healthData.score || 0, 100));
  const healthTone = getHealthTone(healthData.label);
  const deadCapitalMetrics = useMemo(() => {
    return calculateDeadCapitalMetrics({
      items,
      thresholdDays: DEAD_CAPITAL_THRESHOLD_DAYS,
    });
  }, [items]);
  const deadCapitalTone = getDeadCapitalTone(deadCapitalMetrics.deadPercent);
  const realityCheckData = useMemo(() => (
    calculateRealityCheck({
      invoiceItems,
      inventoryItems: items,
    })
  ), [invoiceItems, items]);
  const hasRealityComparison = (
    realityCheckData.hasPreviousData
    && Number.isFinite(realityCheckData.revenueChangePct)
    && Number.isFinite(realityCheckData.profitChangePct)
  );
  const realityRevenueChangeText = formatSignedPercent(realityCheckData.revenueChangePct);
  const realityProfitChangeText = formatSignedPercent(realityCheckData.profitChangePct);
  const realityRevenueChipLabel = hasRealityComparison
    ? `${realityRevenueChangeText} vs minggu lepas`
    : 'Tiada bandingan';
  const realityProfitChipLabel = hasRealityComparison
    ? `${realityProfitChangeText} vs minggu lepas`
    : 'Tiada bandingan';
  const realityOverallBadge = getRealityOverallBadge(realityCheckData.overallSeverity);
  const realityInsights = (realityCheckData.insights || []).slice(0, 2);
  const realityOnboardingMessage = realityCheckData.onboardingMessage || null;

  // Filter by date range
  const getFilteredSales = () => {
    if (!dateRange.startDate || !dateRange.endDate) {
      return invoiceItems;
    }

    const start = new Date(dateRange.startDate);
    const end = new Date(dateRange.endDate);
    end.setHours(23, 59, 59, 999);

    return invoiceItems.filter(sale => {
      if (sale.invoices?.invoice_date) {
        const saleDate = new Date(sale.invoices.invoice_date);
        return saleDate >= start && saleDate <= end;
      }
      return false;
    });
  };

  const filteredSales = getFilteredSales();

  // Legacy safety: some old invoice lines may not have snapshot cost_price populated.
  // For non-manual items, fallback to item.cost_price when line cost is 0/null.
  const getEffectiveCostPrice = (sale) => {
    const lineCostPrice = parseFloat(sale?.cost_price);
    const hasLineCost = Number.isFinite(lineCostPrice) && lineCostPrice > 0;
    if (hasLineCost) return lineCostPrice;

    if (!sale?.is_manual) {
      const itemFallbackCost = parseFloat(sale?.items?.cost_price);
      if (Number.isFinite(itemFallbackCost) && itemFallbackCost >= 0) {
        return itemFallbackCost;
      }
    }

    if (Number.isFinite(lineCostPrice) && lineCostPrice >= 0) {
      return lineCostPrice;
    }

    return 0;
  };

  function getInvoiceItemReturnEntries(sale) {
    return Array.isArray(sale?.invoice_item_returns) ? sale.invoice_item_returns : [];
  }

  function getReturnedQuantityForSale(sale) {
    return getInvoiceItemReturnEntries(sale).reduce((sum, entry) => {
      const qty = parseFloat(entry?.returned_quantity);
      return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
    }, 0);
  }

  function getReturnedRefundTotalForSale(sale) {
    return getInvoiceItemReturnEntries(sale).reduce((sum, entry) => {
      const amount = parseFloat(entry?.refund_amount);
      return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
    }, 0);
  }

  function getNetSoldQuantityForSale(sale) {
    const soldQty = Math.max(parseFloat(sale?.quantity) || 0, 0);
    const returnedQty = getReturnedQuantityForSale(sale);
    return Math.max(soldQty - returnedQty, 0);
  }

  function getNetItemRevenueForSale(sale) {
    const lineRevenue = parseFloat(sale?.line_total);
    const baseRevenue = Number.isFinite(lineRevenue) ? lineRevenue : 0;
    return baseRevenue - getReturnedRefundTotalForSale(sale);
  }

  // Calculate stats from invoice_items
  const totalCost = filteredSales.reduce((sum, sale) => {
    const costPrice = getEffectiveCostPrice(sale);
    const cost = costPrice * getNetSoldQuantityForSale(sale);
    return sum + cost;
  }, 0);

  const shippingByInvoice = filteredSales.reduce((acc, sale) => {
    const invoice = sale?.invoices;
    if (!invoice?.id || acc.has(invoice.id)) return acc;

    const paymentMode = resolveCourierPaymentModeForInvoice(invoice);
    const isPlatformMode = paymentMode === COURIER_PAYMENT_MODES.PLATFORM;
    const shippingCharged = isPlatformMode ? 0 : Math.max(parseFloat(invoice.shipping_charged) || 0, 0);
    const shipment = invoice.shipment || null;
    const shippingCost = isPlatformMode ? 0 : Math.max(parseFloat(shipment?.shipping_cost) || 0, 0);
    const isCourierPaid = isPlatformMode ? true : Boolean(shipment?.courier_paid);
    const shippingCostPaid = isCourierPaid ? shippingCost : 0;

    acc.set(invoice.id, {
      shippingCharged,
      shippingCostPaid,
      isCourierPaid,
    });

    return acc;
  }, new Map());

  const totalShippingCharged = Array.from(shippingByInvoice.values()).reduce((sum, value) => sum + value.shippingCharged, 0);
  const totalShippingCost = Array.from(shippingByInvoice.values()).reduce((sum, value) => sum + value.shippingCostPaid, 0);
  const totalShippingProfit = totalShippingCharged - totalShippingCost;
  const shippingPendingCount = Array.from(shippingByInvoice.values()).filter(
    (value) => value.shippingCharged > 0 && !value.isCourierPaid
  ).length;

  const channelFeeByInvoice = filteredSales.reduce((acc, sale) => {
    const invoice = sale?.invoices;
    if (!invoice?.id || acc.has(invoice.id)) return acc;
    acc.set(invoice.id, Math.max(parseFloat(invoice.channel_fee_amount) || 0, 0));
    return acc;
  }, new Map());
  const totalChannelFees = Array.from(channelFeeByInvoice.values()).reduce((sum, fee) => sum + fee, 0);

  const totalItemProfit = filteredSales.reduce((sum, sale) => {
    const revenue = getNetItemRevenueForSale(sale);
    const costPrice = getEffectiveCostPrice(sale);
    const cost = costPrice * getNetSoldQuantityForSale(sale);
    return sum + (revenue - cost);
  }, 0) - totalChannelFees;

  const revenueByInvoice = filteredSales.reduce((acc, sale) => {
    const invoiceId = sale?.invoices?.id;
    if (!invoiceId) return acc;
    const revenue = getNetItemRevenueForSale(sale);
    acc.set(invoiceId, (acc.get(invoiceId) || 0) + revenue);
    return acc;
  }, new Map());

  const invoiceFinancialById = filteredSales.reduce((acc, sale) => {
    const invoice = sale?.invoices;
    const invoiceId = invoice?.id;
    if (!invoiceId || acc.has(invoiceId)) return acc;

    const itemRevenue = revenueByInvoice.get(invoiceId) || 0;
    const shippingCharged = shippingByInvoice.get(invoiceId)?.shippingCharged || 0;
    const fallbackOriginal = itemRevenue + shippingCharged;

    acc.set(invoiceId, getInvoiceFinancialSummary(invoice, fallbackOriginal));
    return acc;
  }, new Map());

  const totalFinalRevenue = Array.from(invoiceFinancialById.values()).reduce(
    (sum, values) => sum + (values.finalTotal || 0),
    0
  );
  const totalAdjustments = Array.from(invoiceFinancialById.values()).reduce(
    (sum, values) => sum + (values.adjustmentTotal || 0),
    0
  );

  const filteredStats = {
    totalRevenue: totalFinalRevenue,
    totalCost: totalCost,
    totalExpenses: parseFloat(businessExpenses.total) || 0,
    totalShippingCharged: totalShippingCharged,
    totalShippingCost: totalShippingCost,
    totalShippingProfit: totalShippingProfit,
    shippingPendingCount: shippingPendingCount,
    totalRefunds: parseFloat(totalRefunds) || 0,
    totalAdjustments: totalAdjustments,
    totalChannelFees: totalChannelFees,
    totalItemProfit: totalItemProfit,
    totalProfit: totalItemProfit + totalShippingProfit - totalAdjustments,
    soldItemsCount: filteredSales.length,
    totalQuantitySold: filteredSales.reduce((sum, sale) => {
      return sum + getNetSoldQuantityForSale(sale);
    }, 0)
  };

  const totalAvailableUnits = items.reduce((sum, item) => {
    return sum + getItemAvailableQuantity(item);
  }, 0);
  const totalUnitStock = filteredStats.totalQuantitySold + totalAvailableUnits;
  const soldUnitMovementPercent = totalUnitStock > 0
    ? (filteredStats.totalQuantitySold / totalUnitStock) * 100
    : 0;

  const netProfitPercentage = filteredStats.totalRevenue > 0
    ? (filteredStats.totalProfit / filteredStats.totalRevenue) * 100
    : 0;
  const netProfitPercentText = `${netProfitPercentage >= 0 ? 'Untung' : 'Rugi'} ${Math.abs(netProfitPercentage).toFixed(1)}%`;

  // Calculate platform stats from invoice platform field
  const platformStats = filteredSales.reduce((acc, sale) => {
    if (getNetSoldQuantityForSale(sale) <= 0) return acc;
    const platform = sale.invoices?.platform || 'Manual';
    acc[platform] = (acc[platform] || 0) + 1;
    return acc;
  }, {});

  console.log('[Dashboard] Platform stats calculated:', { 
    filteredSalesCount: filteredSales.length, 
    platformStats,
    platformBarData: Object.entries(platformStats).map(([name, value]) => ({ name, jumlah: value }))
  });

  const platformBarData = Object.entries(platformStats).map(([name, value]) => ({ name, jumlah: value }));
  
  const defaultColors = ['#3b82f6', '#10b981', '#f97316', '#a855f7', '#ef4444', '#6366f1', '#f43f5e'];

  const recentSales = filteredSales
    .filter((sale) => getNetSoldQuantityForSale(sale) > 0)
    .sort((a, b) => {
      const aTime = a.invoices?.updated_at || a.invoices?.created_at || a.invoices?.invoice_date || 0;
      const bTime = b.invoices?.updated_at || b.invoices?.created_at || b.invoices?.invoice_date || 0;
      return new Date(bTime) - new Date(aTime);
    })
    .slice(0, 5);

  const nextStepMetrics = useMemo(
    () => computeNextSteps({ invoices: invoiceItems, inventory: items }),
    [invoiceItems, items]
  );
  const pendingShippingCount = nextStepMetrics.pendingShippingCount || 0;
  const riskStockCount = nextStepMetrics.riskStockCount || 0;
  const clearanceCount = nextStepMetrics.clearanceCount || 0;

  const hasNoSalesInRange = filteredSales.length === 0;

  const heroSummaryText = useMemo(() => {
    if (hasNoSalesInRange) {
      return 'Tiada jualan dalam tempoh ini - cuba longgarkan tarikh atau semak stok aktif.';
    }

    if (pendingShippingCount > 0 || riskStockCount > 0) {
      return `Anda ada ${pendingShippingCount} pesanan perlu dihantar dan ${riskStockCount} stok berisiko.`;
    }

    return `Revenue tempoh ini ${formatRM(filteredStats.totalRevenue)} dan profit ${formatRM(filteredStats.totalProfit)}.`;
  }, [filteredStats.totalProfit, filteredStats.totalRevenue, hasNoSalesInRange, pendingShippingCount, riskStockCount]);

  const priorityLine = useMemo(
    () => `Hari ini: ${filteredStats.soldItemsCount} jualan | ${pendingShippingCount || 0} perlu pos | ${riskStockCount || 0} stok risiko`,
    [filteredStats.soldItemsCount, pendingShippingCount, riskStockCount]
  );

  const riskCountDisplay = isInventoryLoading ? '—' : `${riskStockCount}`;
  const clearanceCountDisplay = isInventoryLoading ? '—' : `${clearanceCount}`;

  const dashboardSteps = useMemo(() => ([
    {
      label: 'Buat Invois',
      description: 'Terus rekod jualan baru.',
      to: '/invoices/create',
      value: 'Go',
      valueTone: 'primary',
    },
    {
      label: 'Semak Stok Risiko',
      description: 'Item aging 60+ hari.',
      to: '/inventory?filter=risk',
      value: riskCountDisplay,
      valueTone: !isInventoryLoading && riskStockCount > 0 ? 'warning' : 'neutral',
      tooltip: 'Stok melebihi 60 hari tanpa jualan.',
    },
    {
      label: 'Cadang Clearance',
      description: 'Calon item untuk jualan pelepasan.',
      to: '/inventory?filter=aging_60',
      value: clearanceCountDisplay,
      valueTone: !isInventoryLoading && clearanceCount > 0 ? 'warning' : 'neutral',
    },
    {
      label: 'Semak Penghantaran',
      description: 'Lihat order yang belum dipos.',
      to: '/invoices?status=paid&shipping_state=pending',
      value: pendingShippingCount > 0 ? `${pendingShippingCount}` : 'Tiada',
      valueTone: pendingShippingCount > 0 ? 'warning' : 'neutral',
    },
  ]), [clearanceCount, clearanceCountDisplay, isInventoryLoading, pendingShippingCount, riskCountDisplay, riskStockCount]);

  const isDark = theme === 'dark';
  const tickColor = isDark ? '#9ca3af' : '#6b7281';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
  const tooltipBg = isDark ? '#1f2937' : '#ffffff';
  const tooltipBorder = isDark ? '#374151' : '#e5e7eb';
  const tooltipTextColor = isDark ? '#f3f4f6' : '#111827';

  return (
    <UiTooltipProvider delayDuration={120}>
      <div className="space-y-6">
        <DashboardHero
          userDisplayName={userDisplayName}
          summaryText={heroSummaryText}
          priorityLine={priorityLine}
        />

        <DashboardKpiGrid
          filteredStats={filteredStats}
          netProfitPercentText={netProfitPercentText}
          businessWalletBalance={businessWalletBalance}
          totalUnitStock={totalUnitStock}
          soldUnitMovementPercent={soldUnitMovementPercent}
        />

        {hasNoSalesInRange ? (
          <GlassCard className="border-indigo-100/80">
            <CardContent className="p-2">
              <EmptyStateMini message="Tiada data untuk tempoh ini. Cuba longgarkan tarikh atau tambah jualan pertama." />
            </CardContent>
          </GlassCard>
        ) : null}

        <DashboardNextSteps steps={dashboardSteps} />

        <DashboardFiltersBar
          dateRange={dateRange}
          setDateRange={setDateRange}
          isFiltersOpen={isFiltersOpen}
          setIsFiltersOpen={setIsFiltersOpen}
        />

        <DashboardOperations
          isLoadingSales={isLoadingSales}
          recentSales={recentSales}
          getEffectiveCostPrice={getEffectiveCostPrice}
          revenueByInvoice={revenueByInvoice}
          invoiceFinancialById={invoiceFinancialById}
          channelFeeByInvoice={channelFeeByInvoice}
          shippingByInvoice={shippingByInvoice}
          platformBarData={platformBarData}
          filteredSalesCount={filteredSales.length}
          defaultColors={defaultColors}
          isDark={isDark}
          tickColor={tickColor}
          gridColor={gridColor}
          tooltipBg={tooltipBg}
          tooltipBorder={tooltipBorder}
          tooltipTextColor={tooltipTextColor}
          realityCheckData={realityCheckData}
          realityOverallBadge={realityOverallBadge}
          realityRevenueChipLabel={realityRevenueChipLabel}
          realityProfitChipLabel={realityProfitChipLabel}
          realityInsights={realityInsights}
          realityOnboardingMessage={realityOnboardingMessage}
          healthTone={healthTone}
          healthData={healthData}
          healthReasons={healthReasons}
          healthScorePercent={healthScorePercent}
          deadCapitalMetrics={deadCapitalMetrics}
          deadCapitalTone={deadCapitalTone}
          isDeadCapitalTooltipOpen={isDeadCapitalTooltipOpen}
          setIsDeadCapitalTooltipOpen={setIsDeadCapitalTooltipOpen}
        />
      </div>
    </UiTooltipProvider>
  );
};

export default Dashboard;

