import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Tooltip as UiTooltip,
  TooltipContent as UiTooltipContent,
  TooltipProvider as UiTooltipProvider,
  TooltipTrigger as UiTooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { Loader2,
  Package, 
  Truck,
  Bell,
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
  ChevronUp,
  X
} from 'lucide-react';
import { Cell, Tooltip, ResponsiveContainer, PieChart, Pie } from 'recharts';
import { cn } from '@/lib/utils';
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
import {
  buildCompletedReminderOccurrenceSet,
  expandRemindersOccurrencesInWindow,
  isReminderRecurring,
  isDateKeyWithinRange,
  shiftDateKeyByDays,
} from '@/components/reminders/reminderCalendarUtils';
import {
  buildFinancialMetricsFromSalesLines,
  getSaleLineFinancialBreakdown,
  getSaleLineItemSubtotal,
  getSaleLineNetQuantity,
} from '@/lib/financialDefinitions';

const getInitialDateRange = () => {
  const today = new Date();
  const rollingStartDate = new Date(today);
  rollingStartDate.setDate(today.getDate() - 29);

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
    startDate: formatDate(rollingStartDate),
    endDate: formatDate(today)
  };
};

const getLocalDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const SETTLED_INVOICE_STATUSES = new Set(['paid', 'partially_returned', 'returned']);
const NEXT_STEP_PENDING_COMPLETED_STATUSES = new Set(['delivered', 'completed']);
const NEXT_STEP_URGENCY_THRESHOLDS = {
  pending_shipping: { warning: 1, critical: 4 },
  risk_stock: { warning: 1, critical: 6 },
  clearance_candidate: { warning: 1, critical: 4 },
};

const normalizeLowerText = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
const parsePositiveNumber = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const normalizeHexColor = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const shortMatch = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  const longMatch = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
  if (longMatch) return `#${longMatch[1].toLowerCase()}`;
  return null;
};

const hexToRgb = (hexColor) => {
  const normalized = normalizeHexColor(hexColor);
  if (!normalized) return null;
  const value = normalized.slice(1);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
};

const rgbToHex = ({ r, g, b }) => {
  const toHex = (channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const mixHexColor = (baseHex, targetRgb, ratio) => {
  const baseRgb = hexToRgb(baseHex);
  if (!baseRgb) return baseHex;
  const safeRatio = Math.max(0, Math.min(1, ratio));
  return rgbToHex({
    r: baseRgb.r + ((targetRgb.r - baseRgb.r) * safeRatio),
    g: baseRgb.g + ((targetRgb.g - baseRgb.g) * safeRatio),
    b: baseRgb.b + ((targetRgb.b - baseRgb.b) * safeRatio),
  });
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

const getUrgency = (type, count) => {
  const safeCount = Number.isFinite(count) ? Math.max(0, count) : 0;
  const threshold = NEXT_STEP_URGENCY_THRESHOLDS[type];
  if (!threshold) {
    return { variant: 'neutral', label: '' };
  }

  if (safeCount >= threshold.critical) {
    if (type === 'pending_shipping') return { variant: 'critical', label: 'Urgent' };
    if (type === 'risk_stock') return { variant: 'critical', label: 'Modal berisiko' };
    return { variant: 'critical', label: 'Clearance sekarang' };
  }

  if (safeCount >= threshold.warning) {
    if (type === 'pending_shipping') return { variant: 'warning', label: 'Perlu tindakan' };
    if (type === 'risk_stock') return { variant: 'warning', label: 'Perlu semak' };
    return { variant: 'warning', label: 'Boleh clearance' };
  }

  if (type === 'risk_stock') return { variant: 'neutral', label: 'Sihat' };
  return { variant: 'neutral', label: 'Tiada' };
};

const getHealthTone = (label) => {
  if (label === 'Strong') {
    return {
      fillClass: 'brand-gradient',
      chipClass: 'bg-emerald-100 text-emerald-700',
      batteryClass: 'border-primary/30',
    };
  }
  if (label === 'Stable') {
    return {
      fillClass: 'brand-gradient',
      chipClass: 'bg-green-100 text-green-700',
      batteryClass: 'border-primary/30',
    };
  }
  if (label === 'Weak') {
    return {
      fillClass: 'brand-gradient',
      chipClass: 'bg-emerald-100 text-emerald-700',
      batteryClass: 'border-primary/30',
    };
  }
  return {
    fillClass: 'brand-gradient',
    chipClass: 'bg-green-100 text-green-800',
    batteryClass: 'border-primary/30',
  };
};

const getDeadCapitalTone = (deadCapitalPct) => {
  if (deadCapitalPct > 20) {
    return {
      label: 'Tinggi',
      chipClass: 'border-emerald-300 bg-emerald-200 text-emerald-900',
      fillClass: 'brand-gradient',
      batteryClass: 'border-primary/30',
    };
  }

  if (deadCapitalPct >= 10) {
    return {
      label: 'Waspada',
      chipClass: 'border-teal-300 bg-teal-100 text-teal-800',
      fillClass: 'brand-gradient',
      batteryClass: 'border-primary/30',
    };
  }

  return {
    label: 'Sihat',
    chipClass: 'border-green-200 bg-green-100 text-green-700',
    fillClass: 'brand-gradient',
    batteryClass: 'border-primary/30',
  };
};

const formatSignedPercent = (value) => {
  if (!Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
};

const getRevenueChipTone = (value) => {
  if (!Number.isFinite(value)) return 'bg-slate-100 text-slate-600 border-slate-200';
  if (value >= 0) return 'bg-primary/10 text-primary border-primary/30';
  return 'bg-rose-50 text-rose-700 border-rose-200';
};

const getProfitChipTone = (value) => {
  if (!Number.isFinite(value)) return 'bg-slate-100 text-slate-600 border-slate-200';
  if (value >= 0) return 'bg-primary/10 text-primary border-primary/30';
  return 'bg-rose-100 text-rose-700 border-rose-200';
};

const getRealityOverallBadge = (severity) => {
  if (severity === 'ALERT') {
    return {
      label: 'ALERT',
      className: 'bg-rose-50 text-rose-700 border-rose-200',
    };
  }
  if (severity === 'GOOD') {
    return {
      label: 'GOOD',
      className: 'bg-primary/10 text-primary border-primary/30',
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
      card: 'bg-white border-rose-200/80 border-l-4 border-l-rose-300',
      iconWrap: 'border border-rose-200 bg-rose-50 text-rose-600',
      suggestionWrap: 'border-rose-200 bg-rose-50/60 text-slate-700',
      tipWrap: 'border-amber-200 bg-amber-50/70 text-slate-700',
      tipIcon: 'text-amber-600',
    };
  }
  if (severity === 'GOOD') {
    return {
      card: 'bg-white border-primary/30 border-l-4 border-l-primary/60',
      iconWrap: 'border border-primary/30 bg-primary/10 text-primary',
      suggestionWrap: 'border-primary/25 bg-primary/5 text-slate-700',
      tipWrap: 'border-primary/25 bg-cyan-50/70 text-slate-700',
      tipIcon: 'text-primary',
    };
  }
  return {
    card: 'bg-white border-amber-200/80 border-l-4 border-l-amber-300',
    iconWrap: 'border border-amber-200 bg-amber-50 text-amber-700',
    suggestionWrap: 'border-amber-200 bg-amber-50/60 text-slate-700',
    tipWrap: 'border-amber-200 bg-amber-50/70 text-slate-700',
    tipIcon: 'text-amber-600',
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

const KpiCard = ({
  title,
  value,
  subtext,
  icon: Icon,
  toneClass = 'bg-slate-100 text-slate-700',
  tooltip,
  onClick,
  ariaLabel,
}) => (
  <GlassCard
    className={cn(
      'overflow-hidden',
      typeof onClick === 'function' && 'cursor-pointer transition-colors hover:border-primary/40'
    )}
    role={typeof onClick === 'function' ? 'button' : undefined}
    tabIndex={typeof onClick === 'function' ? 0 : undefined}
    onClick={onClick}
    onKeyDown={typeof onClick === 'function'
      ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }
      : undefined}
    aria-label={ariaLabel}
  >
    <CardContent className="space-y-2.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex min-w-0 items-center gap-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{title}</p>
          {tooltip ? (
            <UiTooltip>
              <UiTooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:text-slate-600"
                  aria-label={`Info ${title}`}
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </UiTooltipTrigger>
              <UiTooltipContent side="top" className="max-w-[240px] text-xs leading-relaxed">
                {tooltip}
              </UiTooltipContent>
            </UiTooltip>
          ) : null}
        </div>
        <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-xl', toneClass)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="text-[1.55rem] font-semibold leading-none tracking-tight text-slate-900">{value}</p>
      <p className="text-xs leading-snug text-slate-500">{subtext}</p>
    </CardContent>
  </GlassCard>
);

const getActionBadgeClasses = (tone) => {
  if (tone === 'critical') {
    return 'border-rose-200 bg-rose-100 text-rose-800';
  }
  if (tone === 'warning') {
    return 'border-amber-200 bg-amber-100 text-amber-800';
  }
  if (tone === 'primary') {
    return 'border-indigo-200 bg-indigo-100 text-indigo-700';
  }
  return 'border-slate-200 bg-slate-100 text-slate-600';
};

const getQuickActionIcon = (label) => {
  const normalized = normalizeLowerText(label);
  if (normalized.includes('invois')) return Receipt;
  if (normalized.includes('reminder')) return Bell;
  if (normalized.includes('penghantaran')) return Truck;
  if (normalized.includes('clearance')) return BarChart3;
  return Package;
};

const REMINDER_PRIORITY_SCORE = {
  high: 3,
  normal: 2,
  low: 1,
};

const resolveReminderSourceId = (reminder) => (
  reminder?.source_reminder_id || reminder?.reminder_id || reminder?.id || null
);

const getReminderPriorityMeta = (priority) => {
  const normalized = normalizeLowerText(priority);
  if (normalized === 'high') {
    return { label: 'High', className: 'border-rose-200 bg-rose-100 text-rose-700' };
  }
  if (normalized === 'low') {
    return { label: 'Low', className: 'border-slate-200 bg-slate-100 text-slate-700' };
  }
  return { label: 'Normal', className: 'border-indigo-200 bg-indigo-100 text-indigo-700' };
};

const ActionRow = ({
  label,
  description,
  value,
  valueTone = 'neutral',
  valueCount,
  valueLabel,
  valueAriaLabel,
  to,
  tooltip,
  onClick,
}) => {
  const ActionIcon = getQuickActionIcon(label);
  const badgeText = valueCount !== undefined
    ? `${valueCount}${valueLabel ? ` ${valueLabel}` : ''}`.trim()
    : value;
  const cardClassName = 'group relative flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200/90 bg-white px-3 py-4 text-center shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md';
  const rowContent = (
    <>
      {badgeText ? (
        <span
          className={cn(
            'absolute right-2 top-2 inline-flex max-w-[calc(100%-16px)] truncate rounded-full border px-2 py-0.5 text-[10px] font-semibold shadow-sm',
            getActionBadgeClasses(valueTone)
          )}
          aria-label={valueAriaLabel}
        >
          {badgeText}
        </span>
      ) : null}
      {tooltip ? (
        <UiTooltip>
          <UiTooltipTrigger asChild>
            <button
              type="button"
              className="absolute left-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
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
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white brand-gradient">
        <ActionIcon className="h-5 w-5" />
      </span>
      <p className="line-clamp-2 text-sm font-semibold text-slate-900">{label}</p>
      <p className="line-clamp-2 text-[11px] leading-snug text-slate-500">{description}</p>
    </>
  );

  if (typeof onClick === 'function') {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onClick();
          }
        }}
        className={cn(cardClassName, 'cursor-pointer')}
      >
        {rowContent}
      </div>
    );
  }

  return (
    <Link to={to} className={cardClassName}>
      {rowContent}
    </Link>
  );
};

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
        <Button asChild variant="outline" size="sm" className="h-9 rounded-xl border-white/80 bg-white/80 px-3 transition-colors hover:border-primary/40 hover:bg-white hover:text-primary">
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
        <Button asChild variant="outline" size="sm" className="h-9 rounded-xl border-white/80 bg-white/80 px-3 transition-colors hover:border-primary/40 hover:bg-white hover:text-primary">
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {steps.map((step) => (
          <ActionRow
            key={step.label}
            label={step.label}
            description={step.description}
            value={step.value}
            valueTone={step.valueTone}
            valueCount={step.valueCount}
            valueLabel={step.valueLabel}
            valueAriaLabel={step.valueAriaLabel}
            to={step.to}
            tooltip={step.tooltip}
            onClick={step.onClick}
          />
        ))}
      </div>
    </CardContent>
  </GlassCard>
);

const DashboardReminderPreviewModal = ({
  open,
  onClose,
  todayReminders,
  overdueCount,
  onToggleCompleted,
  isToggling,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/80 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Reminder Hari Ini"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-violet-700">
              <Bell className="h-4 w-4" />
            </span>
            <p className="text-base font-semibold text-slate-900">Reminder Hari Ini</p>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-4 py-3">
          {overdueCount > 0 ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {overdueCount} reminder lewat - semak sekarang.
            </div>
          ) : null}

          {todayReminders.length > 0 ? (
            todayReminders.map((reminder) => {
              const priorityMeta = getReminderPriorityMeta(reminder.priority);
              return (
                <div key={reminder.occurrence_key || reminder.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{reminder.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', priorityMeta.className)}>
                        {priorityMeta.label}
                      </span>
                      {isReminderRecurring(reminder) ? (
                        <span className="inline-flex rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                          Ulang
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">
                    <Checkbox
                      checked={Boolean(reminder.is_completed)}
                      onCheckedChange={(checked) => onToggleCompleted(reminder, checked === true)}
                      disabled={isToggling}
                    />
                    Selesai
                  </label>
                </div>
              );
            })
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Tiada reminder untuk hari ini.
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Tutup
          </Button>
          <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Link to="/reminders">Lihat Semua</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

const DashboardKpiGrid = ({
  filteredStats,
  netProfitPercentText,
  businessWalletBalance,
  totalUnitStock,
  soldUnitMovementPercent,
  onOpenProfitDetail,
}) => {
  const cards = [
    {
      key: 'revenue',
      title: 'Revenue Item',
      value: formatRM(filteredStats.totalRevenue),
      subtext: `${filteredStats.soldItemsCount} jualan`,
      tooltip: `Revenue Item = jualan barang (line item) selepas refund return item, tidak termasuk caj pos dan tidak tolak pelarasan goodwill. Jumlah Kutipan (akhir invois, termasuk pos): ${formatRM(filteredStats.totalCollected)}.`,
      icon: Wallet,
      tone: 'bg-emerald-100 text-emerald-700',
    },
    {
      key: 'profit',
      title: 'Untung Bersih',
      value: formatRM(filteredStats.totalProfit),
      subtext: `${netProfitPercentText} - Klik untuk lihat pecahan`,
      tooltip: `Untung Bersih = Untung Item + Untung Pos - Caj Platform - Pelarasan. Caj Platform tempoh ini: ${formatRM(filteredStats.totalPlatformFees)}.`,
      icon: TrendingUp,
      tone: 'bg-violet-100 text-violet-700',
      onClick: onOpenProfitDetail,
      ariaLabel: 'Lihat butiran untung bersih',
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
          tooltip={card.tooltip}
          onClick={card.onClick}
          ariaLabel={card.ariaLabel}
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
  categoryBarData,
  filteredSalesCount,
  defaultColors,
  categoryColorMap,
  categoryPalette,
  tooltipBg,
  tooltipBorder,
  tooltipTextColor,
}) => {
  const [showDeadItems, setShowDeadItems] = useState(false);
  const [salesBreakdownView, setSalesBreakdownView] = useState('platform');
  const [hoveredBreakdown, setHoveredBreakdown] = useState(null);
  // Mirror Business Health style: fuller bar means healthier stock mix.
  const deadCapitalProgressWidth = deadCapitalMetrics.hasStockValue
    ? Math.max(0, Math.min(100 - (deadCapitalMetrics.deadPercent || 0), 100))
    : 0;
  const activeBreakdownData = salesBreakdownView === 'category' ? categoryBarData : platformBarData;
  const isCategoryView = salesBreakdownView === 'category';
  const salesBreakdownTitle = isCategoryView ? 'Kategori Jualan' : 'Platform Jualan';
  const salesBreakdownActionLabel = isCategoryView ? 'Platform' : 'Kategori';
  const salesBreakdownEmptyMessage = filteredSalesCount > 0
    ? (isCategoryView ? 'Kategori belum dapat dirumuskan.' : 'Platform belum dapat dirumuskan.')
    : (isCategoryView ? 'Belum ada data kategori dalam tempoh ini.' : 'Belum ada data platform dalam tempoh ini.');
  const activeBreakdownTotal = activeBreakdownData.reduce(
    (sum, entry) => sum + (parseFloat(entry?.jumlah) || 0),
    0
  );
  const activeBreakdownPalette = Array.isArray(categoryPalette) && categoryPalette.length > 0
    ? categoryPalette
    : defaultColors;
  const activeBreakdownDonutData = activeBreakdownData.map((entry, index) => {
    const value = parseFloat(entry?.jumlah) || 0;
    const percent = activeBreakdownTotal > 0 ? (value / activeBreakdownTotal) * 100 : 0;
    const normalizedName = normalizeLowerText(entry?.name);
    const categoryMappedColor = normalizedName ? categoryColorMap?.get(normalizedName) : null;
    const baseColor = categoryMappedColor || activeBreakdownPalette[index % activeBreakdownPalette.length];
    const gradientIdSafeName = `${entry?.name || 'lain-lain'}-${index}`.replace(/[^a-zA-Z0-9_-]/g, '-');
    const gradientId = `insight-${isCategoryView ? 'kategori' : 'platform'}-${gradientIdSafeName}`;
    const gradientStart = mixHexColor(baseColor, { r: 255, g: 255, b: 255 }, 0.35);
    const gradientEnd = mixHexColor(baseColor, { r: 15, g: 23, b: 42 }, 0.18);
    return {
      name: entry?.name || 'Lain-lain',
      value,
      percent,
      color: baseColor,
      gradientId,
      gradientStart,
      gradientEnd,
    };
  });
  const centerDisplayValue = hoveredBreakdown ? hoveredBreakdown.value : activeBreakdownTotal;
  const centerDisplayLabel = hoveredBreakdown
    ? hoveredBreakdown.name
    : 'jualan';

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
            <div className={cn('relative h-2 overflow-hidden rounded-full border bg-slate-100', deadCapitalTone.batteryClass)}>
              <div
                className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-300', deadCapitalTone.fillClass)}
                style={{ width: `${deadCapitalProgressWidth}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-rose-100 bg-rose-50/70 px-2 py-1.5">
                <p className="font-semibold text-rose-700">Dead</p>
                <p className="text-rose-800">{formatRM(deadCapitalMetrics.deadValue)}</p>
              </div>
              <div className="rounded-lg border border-teal-200 bg-teal-50/80 px-2 py-1.5">
                <p className="font-semibold text-teal-700">Active</p>
                <p className="text-teal-900">{formatRM(deadCapitalMetrics.activeValue)}</p>
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
      title={salesBreakdownTitle}
      action={
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-xl border-0 px-3 text-[11px] font-semibold text-white brand-gradient brand-gradient-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          onClick={() => setSalesBreakdownView((prev) => (prev === 'platform' ? 'category' : 'platform'))}
        >
          {salesBreakdownActionLabel}
        </button>
      }
    >
      <div>
        {activeBreakdownData.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[170px_1fr] sm:items-center">
            <div className="relative mx-auto h-[170px] w-[170px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <defs>
                    {activeBreakdownDonutData.map((entry) => (
                      <linearGradient key={entry.gradientId} id={entry.gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor={entry.gradientStart} />
                        <stop offset="100%" stopColor={entry.gradientEnd} />
                      </linearGradient>
                    ))}
                  </defs>
                  <Pie
                    data={activeBreakdownDonutData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={46}
                    outerRadius={72}
                    paddingAngle={3}
                    cornerRadius={8}
                    stroke="none"
                    onMouseEnter={(_, index) => {
                      const nextHover = activeBreakdownDonutData[index] || null;
                      setHoveredBreakdown(nextHover);
                    }}
                    onMouseLeave={() => setHoveredBreakdown(null)}
                  >
                    {activeBreakdownDonutData.map((entry) => (
                      <Cell key={`${isCategoryView ? 'category' : 'platform'}-donut-${entry.name}`} fill={`url(#${entry.gradientId})`} />
                    ))}
                  </Pie>
                  <Tooltip
                    wrapperStyle={{ zIndex: 80 }}
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '0.65rem',
                      padding: '6px 8px',
                      boxShadow: '0 10px 30px -18px rgba(15, 23, 42, 0.45)',
                    }}
                    itemStyle={{ color: tooltipTextColor }}
                    labelStyle={{ color: tooltipTextColor, fontWeight: 'bold' }}
                    formatter={(value) => [`${value} jualan`]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <div className="max-w-[108px] rounded-2xl border border-white/90 bg-white/90 px-2.5 py-1.5 text-center shadow-sm backdrop-blur-sm">
                  <p className="truncate text-base font-semibold leading-none text-slate-900">{centerDisplayValue}</p>
                  <p className="truncate pt-1 text-[11px] leading-none text-slate-500">{centerDisplayLabel}</p>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              {activeBreakdownDonutData.map((entry) => (
                <div
                  key={`${isCategoryView ? 'category' : 'platform'}-donut-row-${entry.name}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: entry.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate text-xs font-medium text-slate-700">{entry.name}</span>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-slate-900">
                    {entry.value} ({entry.percent.toFixed(0)}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyStateMini message={salesBreakdownEmptyMessage} />
        )}
      </div>
    </InsightCard>
  </div>
  );
};

const DashboardOperations = ({
  isLoadingSales,
  recentSales,
  revenueByInvoice,
  invoiceFinancialById,
  platformFeeByInvoice,
  shippingByInvoice,
  platformBarData,
  categoryBarData,
  filteredSalesCount,
  defaultColors,
  categoryColorMap,
  categoryPalette,
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

  const invoiceGoodwillById = useMemo(() => {
    const map = new Map();
    if (invoiceFinancialById instanceof Map) {
      invoiceFinancialById.forEach((financial, invoiceId) => {
        map.set(invoiceId, Math.max(parseFloat(financial?.adjustmentTotal) || 0, 0));
      });
    }
    return map;
  }, [invoiceFinancialById]);

  const lineMetrics = useMemo(() => ({
    invoiceItemSubtotalById: revenueByInvoice,
    invoicePlatformFeeById: platformFeeByInvoice,
    invoiceGoodwillById,
    invoiceShippingById: shippingByInvoice,
  }), [revenueByInvoice, platformFeeByInvoice, invoiceGoodwillById, shippingByInvoice]);

  return (
  <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
    <div className="space-y-5 xl:col-span-2">
      <GlassCard>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <div>
            <CardTitle className="text-[17px] font-semibold text-slate-900">Aktiviti</CardTitle>
            <p className="text-xs text-slate-500">Jualan terkini</p>
          </div>
          <Button asChild variant="default" size="sm" className="h-8 rounded-xl border-0 px-3 text-white brand-gradient brand-gradient-hover">
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
                    const breakdown = getSaleLineFinancialBreakdown(sale, lineMetrics);
                    const profit = breakdown.netProfit;
                    const isLoss = profit < 0;

                    return (
                      <tr key={`${sale.id}-${index}`} className="border-t relative group overflow-hidden">
                        <td className="p-3 text-sm font-semibold text-foreground">
                          <div className="absolute left-0 top-0 h-full w-1 bg-primary scale-y-0 transition-transform origin-center duration-300 group-hover:scale-y-100" />
                          <div className="transition-transform duration-300 group-hover:translate-x-2">
                            {sale.is_manual ? (sale.item_name || 'Item Manual') : (sale.items?.name || 'Item Tidak Dikenali')}
                          </div>
                        </td>
                        <td className="p-3 text-sm text-muted-foreground">
                          {new Date(sale.invoices?.invoice_date || new Date()).toLocaleDateString()}
                        </td>
                        <td className="p-3">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                              isLoss
                                ? 'border border-rose-200 bg-rose-50 text-rose-700'
                                : 'text-white brand-gradient'
                            )}
                          >
                            {isLoss ? <XCircle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
                            {formatRM(Math.abs(profit))}
                          </span>
                        </td>
                        <td className="p-3 text-right text-sm font-semibold text-foreground">{formatRM(breakdown.netRevenueAfterGoodwill)}</td>
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
            <div className="rounded-lg border border-primary/30 bg-white p-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Revenue</p>
              <p className="mt-0.5 text-lg font-bold text-slate-900">RM {realityCheckData.thisWeek.revenueTotal.toFixed(2)}</p>
              <span className={cn("mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", getRevenueChipTone(realityCheckData.revenueChangePct))}>
                {realityRevenueChipLabel}
              </span>
            </div>
            <div className="rounded-lg border border-primary/30 bg-white p-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Profit</p>
              <p className="mt-0.5 text-lg font-bold text-slate-900">RM {realityCheckData.thisWeek.profitTotal.toFixed(2)}</p>
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
                  <div className={cn("mt-2 rounded-lg border px-2.5 py-2 text-sm", tone.tipWrap)}>
                    <p className="flex items-start gap-2 leading-snug">
                      <Info className={cn("mt-0.5 h-4 w-4 shrink-0", tone.tipIcon)} aria-hidden="true" />
                      <span>
                        <span className="font-semibold">Tip:</span> fokus 1 tindakan dulu - perubahan kecil pun beri kesan.
                      </span>
                    </p>
                  </div>
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
      categoryBarData={categoryBarData}
      filteredSalesCount={filteredSalesCount}
      defaultColors={defaultColors}
      categoryColorMap={categoryColorMap}
      categoryPalette={categoryPalette}
      tooltipBg={tooltipBg}
      tooltipBorder={tooltipBorder}
      tooltipTextColor={tooltipTextColor}
    />
  </div>
  );
};

const DebugMetricRow = ({ label, value, isStrong = false }) => (
  <div className={cn(
    'flex items-center justify-between rounded-lg border px-3 py-2 text-sm',
    isStrong
      ? 'border-primary/30 bg-gradient-to-r from-cyan-50 to-teal-50'
      : 'border-primary/20 bg-primary/5'
  )}>
    <span className={cn('font-medium', isStrong ? 'text-primary' : 'text-slate-700')}>{label}</span>
    <span className={cn('font-semibold', isStrong ? 'text-primary' : 'text-slate-900')}>{value}</span>
  </div>
);

const DashboardFinancialDebugPanel = ({
  isOpen,
  onToggle,
  metrics,
}) => (
  <GlassCard className="border-primary/20">
    <CardHeader className="pb-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-left transition-colors hover:bg-primary/10"
        aria-expanded={isOpen}
        aria-label="Toggle Financial Debug panel"
      >
        <div>
          <CardTitle className="text-sm font-semibold text-primary">🛠 Financial Debug (Dev Only)</CardTitle>
          <p className="mt-0.5 text-xs text-slate-500">Breakdown formula untuk julat tarikh semasa</p>
        </div>
        {isOpen ? <ChevronUp className="h-4 w-4 text-primary" /> : <ChevronDown className="h-4 w-4 text-primary" />}
      </button>
    </CardHeader>

    {isOpen ? (
      <CardContent className="space-y-2 pt-0">
        <DebugMetricRow label="Revenue Item" value={formatRM(metrics.revenueItem)} />
        <DebugMetricRow label="Shipping Charged" value={formatRM(metrics.shippingCharged)} />
        <DebugMetricRow label="Platform Fees" value={formatRM(metrics.platformFeeTotal)} />
        <DebugMetricRow label="Item Cost" value={formatRM(metrics.itemCostTotal)} />
        <DebugMetricRow label="Shipping Cost" value={formatRM(metrics.shippingCost)} />
        <DebugMetricRow label="Goodwill Adjustments" value={formatRM(metrics.goodwillAdjustments)} />

        <div className="my-1 border-t border-dashed border-primary/25" />
        <DebugMetricRow label="Item Profit" value={formatRM(metrics.itemProfit)} />
        <DebugMetricRow label="Shipping Profit" value={formatRM(metrics.shippingProfit)} />
        <div className="my-1 border-t border-dashed border-primary/25" />
        <DebugMetricRow label="Net Profit" value={formatRM(metrics.netProfit)} isStrong />

        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <DebugMetricRow label="Paid Invoices" value={`${metrics.paidInvoiceCount || 0}`} />
          <DebugMetricRow label="Partially Returned Invoices" value={`${metrics.partiallyReturnedInvoiceCount || 0}`} />
          <DebugMetricRow label="Returned Invoices" value={`${metrics.returnedInvoiceCount || 0}`} />
          <DebugMetricRow label="Adjusted Invoices (Goodwill)" value={`${metrics.adjustedInvoiceCount || 0}`} />
        </div>
      </CardContent>
    ) : null}
  </GlassCard>
);

const Dashboard = ({ items, user, profile, isInventoryLoading = false }) => {
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dateRange, setDateRange] = useState(getInitialDateRange());
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [isDeadCapitalTooltipOpen, setIsDeadCapitalTooltipOpen] = useState(false);
  const [isReminderPreviewOpen, setIsReminderPreviewOpen] = useState(false);
  const [isNetProfitDetailOpen, setIsNetProfitDetailOpen] = useState(false);
  const [isFinancialDebugOpen, setIsFinancialDebugOpen] = useState(false);
  const userId = user?.id || null;
  const todayKey = useMemo(() => getLocalDateKey(new Date()), []);
  const reminderWindowStartKey = useMemo(() => shiftDateKeyByDays(todayKey, -30), [todayKey]);
  const dashboardReminderQueryKey = ['dashboard-reminders-today', userId, todayKey];
  const dashboardReminderOccurrenceQueryKey = ['dashboard-reminder-occurrences', userId, todayKey];
  const userDisplayName = useMemo(() => {
    const profileUsername = typeof profile?.username === 'string' ? profile.username.trim() : '';
    if (profileUsername) return profileUsername;

    const emailName = typeof user?.email === 'string'
      ? user.email.split('@')[0]?.trim()
      : '';
    return emailName || 'Pengguna';
  }, [profile?.username, user?.email]);

  useEffect(() => {
    if (!isReminderPreviewOpen) return undefined;

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsReminderPreviewOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isReminderPreviewOpen]);

  const { data: dashboardReminderRows = [], isLoading: isLoadingDashboardReminders } = useQuery({
    queryKey: dashboardReminderQueryKey,
    queryFn: async () => {
      if (!userId) return [];

      const { data, error } = await supabase
        .from('reminders')
        .select('id, title, start_date, end_date, due_date, recurrence, recurrence_interval, recurrence_until, is_completed, priority, created_at')
        .eq('user_id', userId)
        .eq('is_completed', false)
        .lte('start_date', todayKey)
        .order('start_date', { ascending: true })
        .order('due_date', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Dashboard] Error fetching reminder summary:', error);
        return [];
      }

      return data || [];
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
  });

  const {
    data: dashboardReminderOccurrenceRows = [],
    isLoading: isLoadingDashboardReminderOccurrences,
  } = useQuery({
    queryKey: dashboardReminderOccurrenceQueryKey,
    queryFn: async () => {
      if (!userId) return [];

      const { data, error } = await supabase
        .from('reminder_occurrences')
        .select('id, reminder_id, occurrence_date, status, created_at')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .lte('occurrence_date', todayKey)
        .order('occurrence_date', { ascending: false });

      if (error) {
        console.error('[Dashboard] Error fetching reminder occurrences:', error);
        return [];
      }

      return data || [];
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
  });

  const {
    todayReminderCount,
    overdueReminderCount,
    next3TodayReminders,
  } = useMemo(() => {
    const rows = Array.isArray(dashboardReminderRows) ? dashboardReminderRows : [];
    const completedOccurrenceSet = buildCompletedReminderOccurrenceSet(dashboardReminderOccurrenceRows);
    const occurrenceRows = expandRemindersOccurrencesInWindow(rows, {
      windowStartKey: reminderWindowStartKey,
      windowEndKey: todayKey,
      maxOccurrences: 1200,
      completedOccurrenceSet,
    });

    const todayRows = occurrenceRows.filter((occurrence) => (
      !occurrence.is_completed
      && isDateKeyWithinRange(
        todayKey,
        occurrence.occurrence_start_date,
        occurrence.occurrence_end_date
      )
    ));

    const overdueRows = occurrenceRows.filter(
      (occurrence) => !occurrence.is_completed && occurrence.occurrence_end_date < todayKey
    );

    const sortedToday = [...todayRows].sort((left, right) => {
      const leftScore = REMINDER_PRIORITY_SCORE[normalizeLowerText(left?.priority)] || 0;
      const rightScore = REMINDER_PRIORITY_SCORE[normalizeLowerText(right?.priority)] || 0;
      if (leftScore !== rightScore) return rightScore - leftScore;

      const leftCreatedAt = new Date(left?.created_at || 0).getTime();
      const rightCreatedAt = new Date(right?.created_at || 0).getTime();
      return rightCreatedAt - leftCreatedAt;
    });

    return {
      todayReminderCount: sortedToday.length,
      overdueReminderCount: overdueRows.length,
      next3TodayReminders: sortedToday.slice(0, 3),
    };
  }, [dashboardReminderOccurrenceRows, dashboardReminderRows, reminderWindowStartKey, todayKey]);

  const reminderHeroLine = useMemo(() => {
    if (isLoadingDashboardReminders || isLoadingDashboardReminderOccurrences) {
      return 'Menyemak reminder hari ini...';
    }
    if (overdueReminderCount > 0) {
      return `🔴 ${overdueReminderCount} reminder lewat • ${todayReminderCount} untuk hari ini`;
    }
    if (todayReminderCount > 0) {
      return `🟠 ${todayReminderCount} reminder untuk hari ini`;
    }
    return '✅ Tiada reminder hari ini';
  }, [isLoadingDashboardReminderOccurrences, isLoadingDashboardReminders, overdueReminderCount, todayReminderCount]);

  const toggleDashboardReminderMutation = useMutation({
    mutationFn: async ({ reminder, nextCompleted }) => {
      const reminderId = resolveReminderSourceId(reminder);
      if (!reminderId) throw new Error('Reminder tidak sah.');

      const isRecurringToggle = isReminderRecurring(reminder) && Boolean(reminder?.occurrence_start_date);
      if (isRecurringToggle) {
        if (nextCompleted) {
          const { error } = await supabase
            .from('reminder_occurrences')
            .upsert([{
              user_id: userId,
              reminder_id: reminderId,
              occurrence_date: reminder.occurrence_start_date,
              status: 'completed',
            }], { onConflict: 'user_id,reminder_id,occurrence_date' });

          if (error) throw error;
          return;
        }

        const { error } = await supabase
          .from('reminder_occurrences')
          .delete()
          .eq('user_id', userId)
          .eq('reminder_id', reminderId)
          .eq('occurrence_date', reminder.occurrence_start_date);

        if (error) throw error;
        return;
      }

      const { error } = await supabase
        .from('reminders')
        .update({ is_completed: nextCompleted, updated_at: new Date().toISOString() })
        .eq('id', reminderId)
        .eq('user_id', userId);

      if (error) throw error;
    },
    onMutate: async ({ reminder, nextCompleted }) => {
      const reminderId = resolveReminderSourceId(reminder);
      const isRecurringToggle = isReminderRecurring(reminder) && Boolean(reminder?.occurrence_start_date);

      await queryClient.cancelQueries({ queryKey: dashboardReminderQueryKey });
      await queryClient.cancelQueries({ queryKey: dashboardReminderOccurrenceQueryKey });
      const previousRows = queryClient.getQueryData(dashboardReminderQueryKey);
      const previousOccurrenceRows = queryClient.getQueryData(dashboardReminderOccurrenceQueryKey);

      if (isRecurringToggle && reminderId) {
        queryClient.setQueryData(dashboardReminderOccurrenceQueryKey, (currentRows) => {
          const rows = Array.isArray(currentRows) ? [...currentRows] : [];
          const existingIndex = rows.findIndex((row) => (
            String(row?.reminder_id) === String(reminderId)
            && String(row?.occurrence_date) === String(reminder.occurrence_start_date)
            && String(row?.status || '').toLowerCase() === 'completed'
          ));

          if (nextCompleted) {
            if (existingIndex === -1) {
              rows.unshift({
                id: `optimistic-${reminderId}-${reminder.occurrence_start_date}`,
                reminder_id: reminderId,
                occurrence_date: reminder.occurrence_start_date,
                status: 'completed',
                created_at: new Date().toISOString(),
              });
            }
            return rows;
          }

          if (existingIndex >= 0) {
            rows.splice(existingIndex, 1);
          }
          return rows;
        });
      } else if (reminderId) {
        queryClient.setQueryData(dashboardReminderQueryKey, (currentRows) => {
          if (!Array.isArray(currentRows)) return [];
          if (nextCompleted === true) {
            return currentRows.filter((row) => row.id !== reminderId);
          }
          return currentRows.map((row) => (
            row.id === reminderId
              ? { ...row, is_completed: nextCompleted, updated_at: new Date().toISOString() }
              : row
          ));
        });
      }

      return { previousRows, previousOccurrenceRows };
    },
    onError: (error, _variables, context) => {
      if (context?.previousRows) {
        queryClient.setQueryData(dashboardReminderQueryKey, context.previousRows);
      }
      if (context?.previousOccurrenceRows) {
        queryClient.setQueryData(dashboardReminderOccurrenceQueryKey, context.previousOccurrenceRows);
      }
      toast({
        title: 'Gagal kemas kini reminder',
        description: error?.message || 'Sila cuba lagi.',
        variant: 'destructive',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-reminders-today', userId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-reminder-occurrences', userId] });
      queryClient.invalidateQueries({ queryKey: ['reminders', userId] });
      queryClient.invalidateQueries({ queryKey: ['reminder-occurrences', userId] });
    },
  });

  const handleToggleReminderFromDashboard = (reminder, nextCompleted) => {
    if (nextCompleted !== true || !userId) return;
    toggleDashboardReminderMutation.mutate({ reminder, nextCompleted: true });
  };

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
          invoices(
            *,
            invoice_fees(id, amount, amount_override),
            invoice_refunds(refund_type, type, amount, reason, note)
          )
        `)
        .order('created_at', { ascending: false });

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

  const { data: dashboardCategories = [] } = useQuery({
    queryKey: ['dashboard-categories', userId],
    queryFn: async () => {
      if (!userId) return [];

      const { data, error } = await supabase
        .from('categories')
        .select('name, color')
        .eq('user_id', userId);

      if (error) {
        console.error('[Dashboard] Error fetching categories:', error);
        return [];
      }

      return data || [];
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
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

    const soldQty30d = rows.reduce((sum, sale) => sum + getSaleLineNetQuantity(sale), 0);

    const categorySales30d = rows.reduce((acc, sale) => {
      const category = sale.is_manual ? 'Manual' : (sale.items?.category || 'Lain-lain');
      acc[category] = (acc[category] || 0) + getSaleLineItemSubtotal(sale);
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

  // Source-of-truth financial aggregation shared with Sales page.
  const financialMetrics = useMemo(
    () => buildFinancialMetricsFromSalesLines(filteredSales),
    [filteredSales]
  );

  const totalCost = financialMetrics.itemCostTotal;
  const shippingByInvoice = financialMetrics.invoiceShippingById;
  const platformFeeByInvoice = financialMetrics.invoicePlatformFeeById;
  const revenueByInvoice = financialMetrics.invoiceItemSubtotalById;
  const invoiceFinancialById = financialMetrics.invoiceCollectedById;

  const filteredStats = {
    totalRevenue: financialMetrics.revenueItem,
    totalCollected: financialMetrics.totalCollected,
    totalCost,
    totalExpenses: parseFloat(businessExpenses.total) || 0,
    totalShippingCharged: financialMetrics.shippingCharged,
    totalShippingCost: financialMetrics.shippingCost,
    totalShippingProfit: financialMetrics.shippingProfit,
    shippingPendingCount: financialMetrics.shippingPendingCount,
    totalRefunds: parseFloat(totalRefunds) || 0,
    totalAdjustments: financialMetrics.goodwillAdjustments,
    totalPlatformFees: financialMetrics.platformFeeTotal,
    totalItemProfit: financialMetrics.itemProfit,
    totalProfit: financialMetrics.netProfit,
    soldItemsCount: financialMetrics.soldInvoiceCount,
    totalQuantitySold: financialMetrics.totalQuantitySold,
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
  const itemProfitBeforePlatform = filteredStats.totalItemProfit;

  const categoryColorMap = useMemo(() => {
    const map = new Map();

    (dashboardCategories || []).forEach((category) => {
      const normalizedName = normalizeLowerText(category?.name);
      const normalizedColor = normalizeHexColor(category?.color);

      if (!normalizedName || !normalizedColor) return;
      map.set(normalizedName, normalizedColor);
    });

    return map;
  }, [dashboardCategories]);

  const categoryPalette = useMemo(() => {
    if (!(categoryColorMap instanceof Map)) return [];
    return Array.from(categoryColorMap.values());
  }, [categoryColorMap]);

  const { platformBarData, categoryBarData } = useMemo(() => {
    const platformStats = {};
    const categoryStats = {};

    filteredSales.forEach((sale) => {
      if (getSaleLineNetQuantity(sale) <= 0) return;

      const rawPlatformName = normalizeText(sale.invoices?.platform);
      const looksLikeFeeAggregateLabel = /^\d+\s+caj\s+platform$/i.test(rawPlatformName);
      const platformName = looksLikeFeeAggregateLabel ? 'Manual' : (rawPlatformName || 'Manual');
      platformStats[platformName] = (platformStats[platformName] || 0) + 1;

      const categoryName = sale.is_manual
        ? 'Manual'
        : (normalizeText(sale.items?.category) || 'Lain-lain');
      categoryStats[categoryName] = (categoryStats[categoryName] || 0) + 1;
    });

    const toBarData = (stats) => (
      Object.entries(stats)
        .map(([name, jumlah]) => ({ name, jumlah }))
        .sort((a, b) => {
          if (b.jumlah !== a.jumlah) return b.jumlah - a.jumlah;
          return a.name.localeCompare(b.name, 'ms', { sensitivity: 'base' });
        })
    );

    return {
      platformBarData: toBarData(platformStats),
      categoryBarData: toBarData(categoryStats),
    };
  }, [filteredSales]);
  
  const defaultColors = ['#3b82f6', '#10b981', '#f97316', '#a855f7', '#ef4444', '#6366f1', '#f43f5e'];

  const recentSales = filteredSales
    .filter((sale) => {
      const netQty = getSaleLineNetQuantity(sale);
      const netRevenue = getSaleLineItemSubtotal(sale);
      return netQty > 0 || Math.abs(netRevenue) > 0.0001;
    })
    .sort((a, b) => {
      const aTime = a.invoices?.invoice_date || a.invoices?.created_at || 0;
      const bTime = b.invoices?.invoice_date || b.invoices?.created_at || 0;
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

  const hasNoSalesInRange = filteredStats.soldItemsCount === 0;

  const heroSummaryText = useMemo(() => {
    if (hasNoSalesInRange) {
      return 'Tiada jualan dalam tempoh ini - cuba longgarkan tarikh atau semak stok aktif.';
    }

    if (pendingShippingCount > 0 || riskStockCount > 0) {
      return `Anda ada ${pendingShippingCount} pesanan perlu dihantar dan ${riskStockCount} stok berisiko.`;
    }

    return `Revenue tempoh ini ${formatRM(filteredStats.totalRevenue)} dan profit ${formatRM(filteredStats.totalProfit)}.`;
  }, [filteredStats.totalProfit, filteredStats.totalRevenue, hasNoSalesInRange, pendingShippingCount, riskStockCount]);

  const pendingShippingUrgency = getUrgency('pending_shipping', pendingShippingCount);
  const riskStockUrgency = getUrgency('risk_stock', riskStockCount);
  const clearanceUrgency = getUrgency('clearance_candidate', clearanceCount);
  const reminderStepConfig = useMemo(() => {
    if (isLoadingDashboardReminders || isLoadingDashboardReminderOccurrences) {
      return {
        description: 'Memuatkan status reminder...',
        value: '...',
        valueTone: 'neutral',
        valueAriaLabel: 'Semak Reminder, data masih dimuatkan',
      };
    }

    if (overdueReminderCount > 0) {
      return {
        description: 'Ada reminder lewat yang perlu tindakan.',
        valueCount: `${overdueReminderCount}`,
        valueLabel: 'lewat',
        valueTone: 'critical',
        valueAriaLabel: `Semak Reminder, ${overdueReminderCount} lewat`,
      };
    }

    if (todayReminderCount > 0) {
      return {
        description: 'Semak tugasan untuk hari ini.',
        valueCount: `${todayReminderCount}`,
        valueLabel: 'hari ini',
        valueTone: 'warning',
        valueAriaLabel: `Semak Reminder, ${todayReminderCount} hari ini`,
      };
    }

    return {
      description: 'Tiada reminder perlu tindakan sekarang.',
      value: 'Tiada',
      valueTone: 'neutral',
      valueAriaLabel: 'Semak Reminder, tiada reminder aktif',
    };
  }, [isLoadingDashboardReminderOccurrences, isLoadingDashboardReminders, overdueReminderCount, todayReminderCount]);

  const riskCountDisplay = isInventoryLoading ? '-' : `${riskStockCount}`;
  const clearanceCountDisplay = isInventoryLoading ? '-' : `${clearanceCount}`;

  const dashboardSteps = useMemo(() => ([
    {
      label: 'Buat Invois',
      description: 'Terus rekod jualan baru.',
      to: '/invoices/create',
      value: 'Go',
      valueTone: 'primary',
    },
    {
      label: 'Semak Reminder',
      description: reminderStepConfig.description,
      onClick: () => setIsReminderPreviewOpen(true),
      to: '/reminders',
      value: reminderStepConfig.value,
      valueCount: reminderStepConfig.valueCount,
      valueLabel: reminderStepConfig.valueLabel,
      valueAriaLabel: reminderStepConfig.valueAriaLabel,
      valueTone: reminderStepConfig.valueTone,
    },
    {
      label: 'Semak Stok Risiko',
      description: 'Item aging 60+ hari.',
      to: '/inventory?filter=risk',
      valueCount: riskCountDisplay,
      valueLabel: isInventoryLoading ? '' : riskStockUrgency.label,
      valueAriaLabel: isInventoryLoading
        ? 'Semak Stok Risiko, data belum dimuatkan'
        : `Semak Stok Risiko, ${riskStockCount}, ${riskStockUrgency.label.toLowerCase()}`,
      valueTone: isInventoryLoading ? 'neutral' : riskStockUrgency.variant,
      tooltip: 'Stok melebihi 60 hari tanpa jualan.',
    },
    {
      label: 'Cadang Clearance',
      description: 'Calon item untuk jualan pelepasan.',
      to: '/inventory?filter=aging_60',
      valueCount: clearanceCountDisplay,
      valueLabel: isInventoryLoading ? '' : clearanceUrgency.label,
      valueAriaLabel: isInventoryLoading
        ? 'Cadang Clearance, data belum dimuatkan'
        : `Cadang Clearance, ${clearanceCount}, ${clearanceUrgency.label.toLowerCase()}`,
      valueTone: isInventoryLoading ? 'neutral' : clearanceUrgency.variant,
    },
    {
      label: 'Semak Penghantaran',
      description: 'Lihat order yang belum dipos.',
      to: '/invoices?status=paid&shipping_state=pending',
      valueCount: `${pendingShippingCount}`,
      valueLabel: pendingShippingUrgency.label,
      valueAriaLabel: `Semak Penghantaran, ${pendingShippingCount}, ${pendingShippingUrgency.label.toLowerCase()}`,
      valueTone: pendingShippingUrgency.variant,
    },
  ]), [
    clearanceCount,
    clearanceCountDisplay,
    clearanceUrgency.label,
    clearanceUrgency.variant,
    isInventoryLoading,
    reminderStepConfig.description,
    reminderStepConfig.value,
    reminderStepConfig.valueAriaLabel,
    reminderStepConfig.valueCount,
    reminderStepConfig.valueLabel,
    reminderStepConfig.valueTone,
    pendingShippingCount,
    pendingShippingUrgency.label,
    pendingShippingUrgency.variant,
    riskCountDisplay,
    riskStockCount,
    riskStockUrgency.label,
    riskStockUrgency.variant,
  ]);

  const isDark = theme === 'dark';
  const tooltipBg = isDark ? '#1f2937' : '#ffffff';
  const tooltipBorder = isDark ? '#374151' : '#e5e7eb';
  const tooltipTextColor = isDark ? '#f3f4f6' : '#111827';

  return (
    <UiTooltipProvider delayDuration={120}>
      <div className="space-y-6">
        <DashboardHero
          userDisplayName={userDisplayName}
          summaryText={heroSummaryText}
          priorityLine={reminderHeroLine}
        />

        <DashboardKpiGrid
          filteredStats={filteredStats}
          netProfitPercentText={netProfitPercentText}
          businessWalletBalance={businessWalletBalance}
          totalUnitStock={totalUnitStock}
          soldUnitMovementPercent={soldUnitMovementPercent}
          onOpenProfitDetail={() => setIsNetProfitDetailOpen(true)}
        />

        <AlertDialog open={isNetProfitDetailOpen} onOpenChange={setIsNetProfitDetailOpen}>
          <AlertDialogContent className="max-w-md border-primary/20 bg-white">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-primary">Butiran Untung Bersih</AlertDialogTitle>
              <AlertDialogDescription>
                Formula: Untung Item + Untung Pos - Caj Platform - Pelarasan
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
                <span className="font-medium text-slate-700">Untung Item</span>
                <span className="font-semibold text-slate-900">{formatRM(itemProfitBeforePlatform)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
                <span className="font-medium text-slate-700">Caj Platform</span>
                <span className="font-semibold text-slate-900">{formatRM(filteredStats.totalPlatformFees)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
                <span className="font-medium text-slate-700">Pelarasan</span>
                <span className="font-semibold text-slate-900">{formatRM(filteredStats.totalAdjustments)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
                <span className="font-medium text-slate-700">Untung Pos</span>
                <span className="font-semibold text-slate-900">{formatRM(filteredStats.totalShippingProfit)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between rounded-lg border border-primary/30 bg-gradient-to-r from-cyan-50 to-teal-50 px-3 py-2.5 text-sm">
                <span className="font-semibold text-primary">Untung Bersih</span>
                <span className="font-bold text-primary">{formatRM(filteredStats.totalProfit)}</span>
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogAction className="border-0 text-white brand-gradient brand-gradient-hover">
                Tutup
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {hasNoSalesInRange ? (
          <GlassCard className="border-indigo-100/80">
            <CardContent className="p-2">
              <EmptyStateMini message="Tiada data untuk tempoh ini. Cuba longgarkan tarikh atau tambah jualan pertama." />
            </CardContent>
          </GlassCard>
        ) : null}

        <DashboardNextSteps steps={dashboardSteps} />

        <DashboardReminderPreviewModal
          open={isReminderPreviewOpen}
          onClose={() => setIsReminderPreviewOpen(false)}
          todayReminders={next3TodayReminders}
          overdueCount={overdueReminderCount}
          isToggling={toggleDashboardReminderMutation.isPending}
          onToggleCompleted={handleToggleReminderFromDashboard}
        />

        <DashboardFiltersBar
          dateRange={dateRange}
          setDateRange={setDateRange}
          isFiltersOpen={isFiltersOpen}
          setIsFiltersOpen={setIsFiltersOpen}
        />

        <DashboardOperations
          isLoadingSales={isLoadingSales}
          recentSales={recentSales}
          revenueByInvoice={revenueByInvoice}
          invoiceFinancialById={invoiceFinancialById}
          platformFeeByInvoice={platformFeeByInvoice}
          shippingByInvoice={shippingByInvoice}
          platformBarData={platformBarData}
          categoryBarData={categoryBarData}
          filteredSalesCount={filteredSales.length}
          defaultColors={defaultColors}
          categoryColorMap={categoryColorMap}
          categoryPalette={categoryPalette}
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

        {import.meta.env.DEV ? (
          <DashboardFinancialDebugPanel
            isOpen={isFinancialDebugOpen}
            onToggle={() => setIsFinancialDebugOpen((prev) => !prev)}
            metrics={financialMetrics}
          />
        ) : null}
      </div>
    </UiTooltipProvider>
  );
};

export default Dashboard;


