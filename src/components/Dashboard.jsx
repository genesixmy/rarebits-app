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
  Tag,
  TrendingUp, 
  TrendingDown,
  BarChart3,
  Wallet,
  CheckCircle,
  XCircle,
  AlertTriangle,
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
  isDeliveryRequiredForInvoice,
  resolveCourierPaymentModeForInvoice,
} from '@/lib/shipping';
import { useTheme } from '@/contexts/ThemeProvider';
import { supabase } from '@/lib/customSupabaseClient';
import { resolveTransactionClassification, TRANSACTION_CLASSIFICATIONS } from '@/components/wallet/transactionClassification';
import { calculateBusinessHealth, getItemAvailableQuantity } from '@/lib/dashboardHealth';
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
      label: 'Berisiko',
      chipClass: 'border-rose-200 bg-rose-100 text-rose-700',
      fillClass: 'bg-rose-500',
      trackClass: 'border-rose-200 bg-rose-50/70',
    };
  }

  if (deadCapitalPct >= 10) {
    return {
      label: 'Perlu perhatian',
      chipClass: 'border-amber-200 bg-amber-100 text-amber-700',
      fillClass: 'bg-amber-500',
      trackClass: 'border-amber-200 bg-amber-50/70',
    };
  }

  return {
    label: 'Sihat',
    chipClass: 'border-emerald-200 bg-emerald-100 text-emerald-700',
    fillClass: 'bg-emerald-500',
    trackClass: 'border-emerald-200 bg-emerald-50/70',
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

const getRealityGapChipTone = (tone) => {
  if (tone === 'danger') return 'bg-rose-100 text-rose-700 border-rose-200';
  if (tone === 'warn') return 'bg-amber-100 text-amber-700 border-amber-200';
  if (tone === 'success') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (tone === 'info') return 'bg-sky-100 text-sky-700 border-sky-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
};

const getRealityReasonRowTone = (severity) => {
  if (severity === 'danger') {
    return {
      row: 'border-rose-200 bg-rose-50/70',
      iconWrap: 'bg-rose-100 text-rose-700',
    };
  }
  if (severity === 'warn') {
    return {
      row: 'border-amber-200 bg-amber-50/70',
      iconWrap: 'bg-amber-100 text-amber-700',
    };
  }
  return {
    row: 'border-slate-200 bg-slate-50/70',
    iconWrap: 'bg-slate-100 text-slate-700',
  };
};

const getRealityReasonIcon = (type) => {
  if (type === 'shipping') return Truck;
  if (type === 'platform') return Tag;
  if (type === 'cost') return Package;
  if (type === 'adjustment') return TrendingDown;
  return Info;
};

const getRealityReasonImpactBadge = (reason) => {
  const impactAmount = Number.parseFloat(reason?.impactAmount) || 0;

  if (reason?.type === 'cost') {
    return {
      label: 'Margin ↓',
      className: 'bg-amber-100 text-amber-700 border-amber-200',
    };
  }

  if (reason?.type === 'shipping') {
    if (impactAmount > 0) {
      return {
        label: `-RM${impactAmount.toFixed(2)}`,
        className: 'bg-rose-100 text-rose-700 border-rose-200',
      };
    }
    return {
      label: 'Kos ↑',
      className: 'bg-amber-100 text-amber-700 border-amber-200',
    };
  }

  if (reason?.type === 'platform') {
    if (impactAmount > 0) {
      return {
        label: `-RM${impactAmount.toFixed(2)}`,
        className: 'bg-amber-100 text-amber-700 border-amber-200',
      };
    }
    return {
      label: 'Fi ↑',
      className: 'bg-slate-100 text-slate-700 border-slate-200',
    };
  }

  if (reason?.type === 'adjustment') {
    if (impactAmount > 0) {
      return {
        label: `-RM${impactAmount.toFixed(2)}`,
        className: 'bg-rose-100 text-rose-700 border-rose-200',
      };
    }
    return {
      label: 'Pelarasan',
      className: 'bg-slate-100 text-slate-700 border-slate-200',
    };
  }

  return {
    label: 'Info',
    className: 'bg-slate-100 text-slate-700 border-slate-200',
  };
};

const getRealityStatusPill = ({ hasComparison, reasons = [] }) => {
  if (!hasComparison) {
    return {
      label: 'Info',
      className: 'bg-slate-100 text-slate-700 border-slate-200',
    };
  }

  if (reasons.some((reason) => reason.severity === 'danger')) {
    return {
      label: 'Alert',
      className: 'bg-rose-100 text-rose-700 border-rose-200',
    };
  }

  if (reasons.some((reason) => reason.severity === 'warn')) {
    return {
      label: 'Alert',
      className: 'bg-amber-100 text-amber-700 border-amber-200',
    };
  }

  return {
    label: 'Stable',
    className: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  };
};

const getRealityInsightText = ({
  hasComparison,
  revenueChangePct,
  profitChangePct,
  isSlowWeek,
}) => {
  if (!hasComparison) {
    return 'Ringkasan awal minggu ini - trend akan lebih jelas bila ada bandingan.';
  }

  if (revenueChangePct > 0 && profitChangePct > -5 && profitChangePct < (revenueChangePct - 3)) {
    return 'Busy tapi margin ketat - profit tak ikut revenue.';
  }

  if (profitChangePct > (revenueChangePct + 3)) {
    return 'Profit lebih laju dari revenue.';
  }

  if (isSlowWeek) {
    return 'Minggu ini perlahan - fokus pada item fast sell.';
  }

  if (revenueChangePct < 0) {
    return 'Jualan perlahan minggu ini, kawal kos supaya margin kekal sihat.';
  }

  return 'Revenue dan profit bergerak seimbang minggu ini.';
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

const ActionRow = ({ label, description, value, to }) => (
  <Link
    to={to}
    className="group flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-slate-100/70"
  >
    <div className="min-w-0">
      <p className="text-sm font-semibold text-slate-900">{label}</p>
      <p className="truncate text-xs text-slate-500">{description}</p>
    </div>
    <div className="inline-flex shrink-0 items-center gap-1.5">
      <span className="rounded-full border border-white/80 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 shadow-sm">
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
            to={step.to}
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
  deadCapitalSegmentCount,
  deadCapitalFilledSegments,
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
}) => (
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
          {deadCapitalMetrics.hasActiveStock ? (
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
            <UiTooltipContent side="top" className="max-w-[240px] text-xs leading-relaxed">
              <p className="font-semibold text-slate-900">Apa itu Dead Capital?</p>
              <p className="mt-1 text-slate-600">Modal barang yang tidak terjual melebihi 60 hari.</p>
              <p className="mt-1 text-slate-600">Barang baru masuk belum dianggap tidur.</p>
            </UiTooltipContent>
          </UiTooltip>
        </div>
      }
    >
      <div className="space-y-2">
        {deadCapitalMetrics.hasActiveStock ? (
          <>
            <p className="text-xl font-semibold leading-none text-slate-900">{deadCapitalMetrics.deadCapitalPctRounded}%</p>
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: deadCapitalSegmentCount }).map((_, index) => (
                <span
                  key={`dead-capital-segment-${index}`}
                  className={cn(
                    'h-2 rounded-full',
                    index < deadCapitalFilledSegments ? deadCapitalTone.fillClass : 'bg-slate-200'
                  )}
                />
              ))}
            </div>
            <p className="text-xs text-slate-500">
              {formatRM(deadCapitalMetrics.deadCapital)} / {formatRM(deadCapitalMetrics.totalStockCapital)}
            </p>
          </>
        ) : (
          <p className="text-xs text-slate-500">Belum ada stok aktif.</p>
        )}
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
  realityStatusPill,
  realityRevenueChipLabel,
  realityProfitChipLabel,
  realityInsightText,
  realityTopReasons,
  getRealityReasonIcon,
  getRealityReasonRowTone,
  getRealityReasonImpactBadge,
  healthTone,
  healthData,
  healthReasons,
  healthScorePercent,
  deadCapitalMetrics,
  deadCapitalTone,
  deadCapitalSegmentCount,
  deadCapitalFilledSegments,
  isDeadCapitalTooltipOpen,
  setIsDeadCapitalTooltipOpen,
}) => (
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
              <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold", realityStatusPill.className)}>
                {realityStatusPill.label}
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

          {!realityCheckData.hasComparison ? (
            <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              Tiada data minggu lepas untuk banding
            </span>
          ) : null}

          <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", getRealityGapChipTone(realityCheckData.gapIndicator.tone))}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="leading-snug font-medium">{realityInsightText}</p>
          </div>

          <div className="space-y-1.5">
            {realityTopReasons.slice(0, 2).map((reason) => {
              const Icon = getRealityReasonIcon(reason.type);
              const tone = getRealityReasonRowTone(reason.severity);
              const impactBadge = getRealityReasonImpactBadge(reason);
              return (
                <div key={reason.key} className={cn("flex items-start gap-2 rounded-lg border px-2.5 py-2", tone.row)}>
                  <span className={cn("mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md", tone.iconWrap)}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-900">{reason.label}</p>
                    <p className="line-clamp-1 text-xs text-slate-500">{reason.explanation}</p>
                  </div>
                  <span className={cn("inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold", impactBadge.className)}>
                    {impactBadge.label}
                  </span>
                </div>
              );
            })}
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
      deadCapitalSegmentCount={deadCapitalSegmentCount}
      deadCapitalFilledSegments={deadCapitalFilledSegments}
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

const Dashboard = ({ items }) => {
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
          .select('id, user_id, shipping_cost, courier_paid')
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

  const { data: pendingShippingCount = 0 } = useQuery({
    queryKey: ['dashboard-pending-shipping', userId],
    queryFn: async () => {
      if (!userId) return 0;

      const { data: paidInvoices, error: invoiceError } = await supabase
        .from('invoices')
        .select('id, status, shipment_id, shipping_method, shipping_charged')
        .eq('user_id', userId)
        .in('status', Array.from(SETTLED_INVOICE_STATUSES));

      if (invoiceError) {
        console.error('[Dashboard] Error fetching paid invoices for shipping reminder:', invoiceError);
        return 0;
      }

      const shipmentIds = [...new Set((paidInvoices || []).map((invoice) => invoice?.shipment_id).filter(Boolean))];
      const shipmentStatusById = new Map();

      if (shipmentIds.length > 0) {
        const { data: shipmentRows, error: shipmentError } = await supabase
          .from('shipments')
          .select('id, ship_status')
          .eq('user_id', userId)
          .in('id', shipmentIds);

        if (shipmentError) {
          console.error('[Dashboard] Error fetching shipment statuses for reminder:', shipmentError);
        } else {
          (shipmentRows || []).forEach((row) => {
            shipmentStatusById.set(row.id, row.ship_status);
          });
        }
      }

      return (paidInvoices || []).reduce((count, invoice) => {
        if (invoice?.status === 'returned') return count;
        if (!isDeliveryRequiredForInvoice(invoice)) return count;

        const shipmentId = invoice?.shipment_id;
        if (!shipmentId) return count + 1;

        const shipStatus = shipmentStatusById.get(shipmentId);
        if (!shipStatus || shipStatus === 'pending') return count + 1;

        return count;
      }, 0);
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
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

  // Fetch refunds (implicitly Business-only since refunds come from invoices)
  // RLS policies handle user filtering automatically - no need for explicit user_id check
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
        .from('refunds')
        .select('amount')
        // RLS security: user can only see refunds from their own invoices
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
    const deadCapital = Number.parseFloat(healthData?.metrics?.stuckCapital60d) || 0;
    const totalStockCapital = Number.parseFloat(healthData?.metrics?.totalStockCostValue) || 0;
    const hasActiveStock = totalStockCapital > 0;
    const deadCapitalPctRaw = hasActiveStock ? (deadCapital / totalStockCapital) * 100 : 0;
    const deadCapitalPct = Math.max(0, Math.min(deadCapitalPctRaw, 100));

    return {
      deadCapital,
      totalStockCapital,
      deadCapitalPct,
      deadCapitalPctRounded: Math.round(deadCapitalPct),
      hasActiveStock,
    };
  }, [healthData?.metrics?.stuckCapital60d, healthData?.metrics?.totalStockCostValue]);
  const deadCapitalTone = getDeadCapitalTone(deadCapitalMetrics.deadCapitalPct);
  const deadCapitalSegmentCount = 7;
  const deadCapitalFilledSegments = deadCapitalMetrics.hasActiveStock
    ? Math.max(
      1,
      Math.min(
        deadCapitalSegmentCount,
        Math.ceil((deadCapitalMetrics.deadCapitalPct / 100) * deadCapitalSegmentCount)
      )
    )
    : 0;
  const realityCheckData = useMemo(() => (
    calculateRealityCheck({
      invoiceItems,
    })
  ), [invoiceItems]);
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
  const realityStatusPill = getRealityStatusPill({
    hasComparison: hasRealityComparison,
    reasons: realityCheckData.reasons,
  });
  const realityInsightText = getRealityInsightText({
    hasComparison: hasRealityComparison,
    revenueChangePct: realityCheckData.revenueChangePct,
    profitChangePct: realityCheckData.profitChangePct,
    isSlowWeek: realityCheckData.isSlowWeek,
  });
  const realityTopReasons = (realityCheckData.reasons || []).slice(0, 2);

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

  const stockSignals = useMemo(() => {
    const now = new Date();
    return items.reduce((acc, item) => {
      const availableQty = getItemAvailableQuantity(item);
      if (availableQty <= 0) return acc;

      const createdDate = item?.created_at ? new Date(item.created_at) : null;
      if (!createdDate || Number.isNaN(createdDate.getTime())) return acc;

      const agingDays = Math.max(0, Math.floor((now - createdDate) / (1000 * 60 * 60 * 24)));
      if (agingDays >= 60) acc.riskCount += 1;
      return acc;
    }, { riskCount: 0 });
  }, [items]);

  const hasNoSalesInRange = filteredSales.length === 0;

  const heroSummaryText = useMemo(() => {
    if (hasNoSalesInRange) {
      return 'Tiada jualan dalam tempoh ini - cuba longgarkan tarikh atau semak stok aktif.';
    }

    if (pendingShippingCount > 0 || stockSignals.riskCount > 0) {
      return `Anda ada ${pendingShippingCount} pesanan perlu dihantar dan ${stockSignals.riskCount} stok berisiko.`;
    }

    return `Revenue tempoh ini ${formatRM(filteredStats.totalRevenue)} dan profit ${formatRM(filteredStats.totalProfit)}.`;
  }, [filteredStats.totalProfit, filteredStats.totalRevenue, hasNoSalesInRange, pendingShippingCount, stockSignals.riskCount]);

  const priorityLine = useMemo(
    () => `Hari ini: ${filteredStats.soldItemsCount} jualan | ${pendingShippingCount || 0} perlu pos | ${stockSignals.riskCount || 0} stok risiko`,
    [filteredStats.soldItemsCount, pendingShippingCount, stockSignals.riskCount]
  );

  const dashboardSteps = useMemo(() => ([
    {
      label: 'Buat Invois',
      description: 'Terus rekod jualan baru.',
      to: '/invoices/create',
      value: 'Go',
    },
    {
      label: 'Semak Stok Risiko',
      description: 'Item aging 60+ hari.',
      to: '/inventory?filter=risk',
      value: stockSignals.riskCount || 0,
    },
    {
      label: 'Cipta Katalog',
      description: 'Susun item untuk jualan cepat.',
      to: '/catalogs/create',
      value: 'Go',
    },
    {
      label: 'Semak Penghantaran',
      description: 'Lihat order yang belum dipos.',
      to: '/invoices?status=paid&shipping_state=pending',
      value: pendingShippingCount || 0,
    },
  ]), [pendingShippingCount, stockSignals.riskCount]);

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
          realityStatusPill={realityStatusPill}
          realityRevenueChipLabel={realityRevenueChipLabel}
          realityProfitChipLabel={realityProfitChipLabel}
          realityInsightText={realityInsightText}
          realityTopReasons={realityTopReasons}
          getRealityReasonIcon={getRealityReasonIcon}
          getRealityReasonRowTone={getRealityReasonRowTone}
          getRealityReasonImpactBadge={getRealityReasonImpactBadge}
          healthTone={healthTone}
          healthData={healthData}
          healthReasons={healthReasons}
          healthScorePercent={healthScorePercent}
          deadCapitalMetrics={deadCapitalMetrics}
          deadCapitalTone={deadCapitalTone}
          deadCapitalSegmentCount={deadCapitalSegmentCount}
          deadCapitalFilledSegments={deadCapitalFilledSegments}
          isDeadCapitalTooltipOpen={isDeadCapitalTooltipOpen}
          setIsDeadCapitalTooltipOpen={setIsDeadCapitalTooltipOpen}
        />
      </div>
    </UiTooltipProvider>
  );
};

export default Dashboard;

