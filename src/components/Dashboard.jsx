import React, { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
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
  Info
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
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

const StatCard = ({ title, value, icon, subtext, subtextSecondary = '', delay, isHighlighted = false, tone = 'sky', size = 'default', helperText = '' }) => {
  const [isHelperOpen, setIsHelperOpen] = useState(false);
  const toneMap = {
    sky: {
      iconWrap: 'bg-sky-100',
      icon: 'text-sky-600',
      trendWrap: 'bg-sky-100',
      trendIcon: 'text-sky-600',
    },
    amber: {
      iconWrap: 'bg-amber-100',
      icon: 'text-amber-600',
      trendWrap: 'bg-amber-100',
      trendIcon: 'text-amber-600',
    },
    emerald: {
      iconWrap: 'bg-emerald-100',
      icon: 'text-emerald-600',
      trendWrap: 'bg-emerald-100',
      trendIcon: 'text-emerald-600',
    },
    fuchsia: {
      iconWrap: 'bg-fuchsia-100',
      icon: 'text-fuchsia-600',
      trendWrap: 'bg-fuchsia-100',
      trendIcon: 'text-fuchsia-600',
    },
    rose: {
      iconWrap: 'bg-rose-100',
      icon: 'text-rose-600',
      trendWrap: 'bg-rose-100',
      trendIcon: 'text-rose-600',
    },
    indigo: {
      iconWrap: 'bg-indigo-100',
      icon: 'text-indigo-600',
      trendWrap: 'bg-indigo-100',
      trendIcon: 'text-indigo-600',
    },
    lime: {
      iconWrap: 'bg-lime-100',
      icon: 'text-lime-600',
      trendWrap: 'bg-lime-100',
      trendIcon: 'text-lime-600',
    },
  };
  const toneStyle = toneMap[tone] || toneMap.sky;
  const isHero = size === 'hero';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <Card
        className={cn(
          "overflow-hidden rounded-3xl border transition-all duration-300",
          isHighlighted
            ? "border-transparent bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-[0_20px_45px_-22px_rgba(124,58,237,0.8)]"
            : cn(
                "border-slate-200/80 bg-card shadow-sm hover:-translate-y-0.5 hover:shadow-lg",
                isHero && "border-slate-300/80 shadow-md"
              )
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "inline-flex items-center justify-center rounded-full",
                  isHero ? "h-11 w-11" : "h-10 w-10",
                  isHighlighted ? "bg-white/95 text-sky-500" : toneStyle.iconWrap
                )}
              >
                {React.cloneElement(icon, { className: cn(isHero ? 'h-5 w-5' : 'h-4 w-4', isHighlighted ? 'text-sky-500' : toneStyle.icon) })}
              </span>
              <CardTitle className={cn("text-base", "font-semibold", isHighlighted ? 'text-white' : 'text-foreground')}>
                <span className="inline-flex items-center gap-2">
                  <span>{title}</span>
                  {helperText ? (
                    <UiTooltip open={isHelperOpen} onOpenChange={setIsHelperOpen}>
                      <UiTooltipTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors",
                            isHighlighted
                              ? "bg-white/20 text-white hover:bg-white/30"
                              : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                          )}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setIsHelperOpen((prev) => !prev);
                          }}
                          aria-label={helperText}
                        >
                          <Info className="h-5 w-5" />
                        </button>
                      </UiTooltipTrigger>
                      <UiTooltipContent side="top" className="max-w-[240px] text-xs leading-relaxed">
                        {helperText}
                      </UiTooltipContent>
                    </UiTooltip>
                  ) : null}
                </span>
              </CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className={cn("text-2xl", "font-bold leading-none tracking-tight", isHighlighted ? 'text-white' : 'text-foreground')}>
            {value}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span
              className={cn(
                "inline-flex h-4 w-4 items-center justify-center rounded-md",
                isHighlighted ? "bg-white/20 text-white" : toneStyle.trendWrap
              )}
            >
              <BarChart3 className={cn("h-3 w-3", isHighlighted ? 'text-white' : toneStyle.trendIcon)} />
            </span>
            <p className={cn("text-sm font-medium", isHighlighted ? 'text-white/90' : 'text-muted-foreground')}>
              {subtext}
            </p>
          </div>
          {subtextSecondary ? (
            <p className={cn("mt-1 text-xs", isHighlighted ? 'text-white/80' : 'text-muted-foreground')}>
              {subtextSecondary}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </motion.div>
  );
};

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
    return 'Ringkasan awal minggu ini — trend akan lebih jelas bila ada bandingan.';
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

const Dashboard = ({ items, categories }) => {
  const { toast } = useToast();
  const { theme } = useTheme();
  const [dateRange, setDateRange] = useState(getInitialDateRange());
  const [userId, setUserId] = useState(null);
  const [isDeadCapitalTooltipOpen, setIsDeadCapitalTooltipOpen] = useState(false);

  // Get current user ID
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id);
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

  const globalStats = {
    totalItems: items.length,
    availableItems: items.filter(item => ['tersedia', 'reserved'].includes(item.status)).length,
    soldItems: items.filter(item => item.status === 'terjual').length,
  };

  const categoryStats = filteredSales.reduce((acc, sale) => {
    if (getNetSoldQuantityForSale(sale) <= 0) return acc;
    const category = sale.is_manual ? 'Manual' : (sale.items?.category || 'Lain-lain');
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});

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

  const categoryPieData = Object.entries(categoryStats).map(([name, value]) => ({ name, value }));
  const platformBarData = Object.entries(platformStats).map(([name, value]) => ({ name, jumlah: value }));
  
  const categoryColorMap = categories.reduce((acc, cat) => {
    acc[cat.name] = cat.color;
    return acc;
  }, {});
  
  const defaultColors = ['#3b82f6', '#10b981', '#f97316', '#a855f7', '#ef4444', '#6366f1', '#f43f5e'];

  const recentSales = filteredSales
    .filter((sale) => getNetSoldQuantityForSale(sale) > 0)
    .sort((a, b) => {
      const aTime = a.invoices?.updated_at || a.invoices?.created_at || a.invoices?.invoice_date || 0;
      const bTime = b.invoices?.updated_at || b.invoices?.created_at || b.invoices?.invoice_date || 0;
      return new Date(bTime) - new Date(aTime);
    })
    .slice(0, 5);

  const isDark = theme === 'dark';
  const tickColor = isDark ? '#9ca3af' : '#6b7281';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
  const tooltipBg = isDark ? '#1f2937' : '#ffffff';
  const tooltipBorder = isDark ? '#374151' : '#e5e7eb';
  const tooltipTextColor = isDark ? '#f3f4f6' : '#111827';

  return (
    <UiTooltipProvider delayDuration={120}>
      <div className="space-y-5">
      <h1 className="page-title">Papan Pemuka</h1>
      
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Tapis Tarikh Jualan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 w-full">
            <div className="flex-1">
              <label className="block text-xs font-medium text-muted-foreground mb-2">Tarikh Mula</label>
              <Input 
                type="date" 
                value={dateRange.startDate} 
                onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))} 
                className="w-full h-10"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-muted-foreground mb-2">Tarikh Akhir</label>
              <Input 
                type="date" 
                value={dateRange.endDate} 
                onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))} 
                className="w-full h-10"
              />
            </div>
            <div className="flex items-end">
              <Button 
                variant="outline"
                size="default"
                onClick={() => setDateRange(getInitialDateRange())} 
                className="whitespace-nowrap w-full sm:w-auto h-10"
              >
                Tetapkan Semula
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {pendingShippingCount > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32 }}
        >
          <Card className="border-amber-400/80 bg-gradient-to-r from-amber-100 to-orange-100 shadow-md ring-1 ring-amber-300/70">
            <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="inline-flex items-center gap-2 text-base font-bold text-amber-950 md:text-lg">
                  <Package className="h-5 w-5" />
                  Perlu Dihantar
                </p>
                <p className="text-sm font-medium text-amber-900 md:text-base">{pendingShippingCount} pesanan menunggu penghantaran</p>
              </div>
              <Button asChild size="sm" className="w-full bg-amber-700 text-white hover:bg-amber-800 sm:w-auto">
                <Link to="/invoices?status=paid&shipping_state=pending">Lihat Senarai</Link>
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : null}

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Performance</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <StatCard
            title="Jualan Barang"
            value={`RM ${filteredStats.totalRevenue.toFixed(2)}`}
            icon={<Wallet />}
            subtext={`Daripada ${filteredStats.soldItemsCount} jualan`}
            delay={0.2}
            tone="emerald"
            size="hero"
          />
          <StatCard
            title="Untung Sebenar"
            value={`RM ${filteredStats.totalProfit.toFixed(2)}`}
            icon={<TrendingUp />}
            subtext={netProfitPercentText}
            delay={0.25}
            isHighlighted={true}
            tone="lime"
            size="hero"
            helperText="Untung selepas semua kos termasuk caj platform dan penghantaran."
          />
          <StatCard
            title="Baki Duit Semasa"
            value={`RM ${parseFloat(businessWalletBalance?.balance || 0).toFixed(2)}`}
            icon={<Wallet />}
            subtext={businessWalletBalance?.name ? `${businessWalletBalance.name} (live)` : 'Belum ada wallet Business'}
            delay={0.3}
            tone="indigo"
            size="hero"
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="space-y-2 lg:col-span-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operations</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <StatCard
              title="Unit Terjual"
              value={filteredStats.totalQuantitySold}
              icon={<CheckCircle />}
              subtext={`${filteredStats.totalQuantitySold} / ${totalUnitStock} unit`}
              subtextSecondary={`${soldUnitMovementPercent.toFixed(1)}% stok telah bergerak`}
              delay={0.42}
              tone="amber"
              size="hero"
            />
            <StatCard
              title="Jumlah Item"
              value={globalStats.totalItems}
              icon={<Package />}
              subtext={`${globalStats.availableItems} tersedia`}
              delay={0.46}
              tone="sky"
              size="hero"
            />
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cash</h2>
          <div className="grid grid-cols-1 gap-4">
            <StatCard
              title="Kos Operasi"
              value={`RM ${filteredStats.totalExpenses.toFixed(2)}`}
              icon={<TrendingDown />}
              subtext="Perbelanjaan perniagaan"
              delay={0.5}
              tone="fuchsia"
            />
          </div>
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Insights</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.34 }}
          >
            <Card className="rounded-3xl border border-slate-200/80 bg-card shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base font-semibold">Business Health</CardTitle>
                  <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", healthTone.chipClass)}>
                    {healthData.label}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="flex items-end justify-between gap-3">
                  <p className="text-2xl font-bold leading-none">{healthScorePercent}%</p>
                  <p className="text-sm font-medium text-muted-foreground">
                    Cash cover {healthData.metrics.cashBufferDays.toFixed(1)} hari
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className={cn("relative h-3 flex-1 overflow-hidden rounded-full border bg-muted", healthTone.batteryClass)}>
                    <div
                      className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-300", healthTone.fillClass)}
                      style={{ width: `${healthScorePercent}%` }}
                    />
                  </div>
                  <span className={cn("h-2 w-1.5 rounded-sm border", healthTone.batteryClass)} />
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-muted-foreground">Masalah utama:</p>
                  {healthReasons.length > 0 ? (
                    healthReasons.map((reason, index) => (
                      <p key={`health-reason-${index}`} className="text-sm text-foreground">
                        {`\u2022 ${reason}`}
                      </p>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">Tiada isu utama dikesan.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38 }}
          >
            <Card className="rounded-3xl border border-slate-200/80 bg-card shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <CardTitle className="text-base font-semibold">Dead Capital</CardTitle>
                    <UiTooltip open={isDeadCapitalTooltipOpen} onOpenChange={setIsDeadCapitalTooltipOpen}>
                      <UiTooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setIsDeadCapitalTooltipOpen((prev) => !prev);
                          }}
                          aria-label="Apa itu Dead Capital?"
                        >
                          <Info className="h-5 w-5" />
                        </button>
                      </UiTooltipTrigger>
                      <UiTooltipContent side="top" className="max-w-[240px] text-xs leading-relaxed">
                        <p className="font-semibold text-foreground">Apa itu Dead Capital?</p>
                        <p className="mt-1 text-muted-foreground">
                          Dead Capital ialah modal barang yang tidak terjual melebihi 60 hari.
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          Barang yang baru masuk atau masih aktif dijual belum dianggap "tidur".
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          Ia akan mula dikira selepas 60 hari tanpa jualan.
                        </p>
                      </UiTooltipContent>
                    </UiTooltip>
                  </div>
                  {deadCapitalMetrics.hasActiveStock ? (
                    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold", deadCapitalTone.chipClass)}>
                      {deadCapitalTone.label}
                    </span>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {deadCapitalMetrics.hasActiveStock ? (
                  <>
                    <div className="flex items-baseline gap-1.5">
                      <p className="text-2xl font-bold leading-none text-foreground">
                        {deadCapitalMetrics.deadCapitalPctRounded}%
                      </p>
                      <p className="text-sm font-medium text-muted-foreground">modal tidur</p>
                    </div>
                    <div className="space-y-1.5">
                      <div className="rounded-full border border-slate-200 bg-slate-50 p-1">
                        <div className="grid grid-cols-7 gap-2">
                          {Array.from({ length: deadCapitalSegmentCount }).map((_, index) => (
                            <span
                              key={`dead-capital-segment-${index}`}
                              className={cn(
                                "h-3 rounded-full transition-colors duration-300",
                                index < deadCapitalFilledSegments ? deadCapitalTone.fillClass : "bg-slate-200"
                              )}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        Target sihat: &lt;10%
                      </span>
                      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        RM {deadCapitalMetrics.deadCapital.toFixed(2)} daripada RM {deadCapitalMetrics.totalStockCapital.toFixed(2)}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-muted-foreground">Tiada stok aktif</p>
                    <p className="text-sm text-muted-foreground">Dead capital akan muncul bila ada stok tersedia.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </section>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.34 }}
      >
        <Card className="overflow-hidden border-slate-200/80 bg-card shadow-sm">
          <CardHeader className="p-4 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-lg font-semibold">Reality Check - Minggu Ini</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {realityCheckData.windows.thisWeek.startDate} - {realityCheckData.windows.thisWeek.endDate}
                </span>
                <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold", realityStatusPill.className)}>
                  {realityStatusPill.label}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-indigo-200/70 bg-indigo-50/60 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Revenue</p>
                <p className="mt-1 text-2xl font-bold leading-none text-indigo-900">RM {realityCheckData.thisWeek.revenueTotal.toFixed(2)}</p>
                <span className={cn("mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold", getRevenueChipTone(realityCheckData.revenueChangePct))}>
                  {realityRevenueChipLabel}
                </span>
              </div>
              <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/60 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Profit</p>
                <p className="mt-1 text-2xl font-bold leading-none text-emerald-900">RM {realityCheckData.thisWeek.profitTotal.toFixed(2)}</p>
                <span className={cn("mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold", getProfitChipTone(realityCheckData.profitChangePct))}>
                  {realityProfitChipLabel}
                </span>
              </div>
            </div>

            <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", getRealityGapChipTone(realityCheckData.gapIndicator.tone))}>
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <p className="min-w-0 whitespace-normal leading-snug font-medium">{realityInsightText}</p>
            </div>

            <div className="h-px w-full bg-slate-200" />

            <div className="space-y-2">
              {realityTopReasons.length > 0 ? (
                <div className="space-y-2">
                  {realityTopReasons.map((reason) => {
                    const Icon = getRealityReasonIcon(reason.type);
                    const tone = getRealityReasonRowTone(reason.severity);
                    const impactBadge = getRealityReasonImpactBadge(reason);
                    return (
                      <div key={reason.key} className={cn("flex items-start gap-2.5 rounded-lg border px-2.5 py-2", tone.row)}>
                        <span className={cn("mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md", tone.iconWrap)}>
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="text-sm font-semibold leading-tight text-foreground">{reason.label}</p>
                          <p className="text-sm leading-snug text-muted-foreground sm:truncate">{reason.explanation}</p>
                        </div>
                        <span className={cn("inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold", impactBadge.className)}>
                          {impactBadge.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Tiada kebocoran margin utama dikesan minggu ini.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
      <Card>
        <CardHeader className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full">
            <CardTitle className="text-lg font-semibold">Jualan Terkini</CardTitle>
            <p className="text-sm text-muted-foreground">Senarai Jualan Semua Platform</p>
          </div>
          {filteredSales.length > 5 && (
            <div className="w-full sm:w-auto flex justify-start sm:justify-end">
              <Button asChild variant="secondary" size="default" className="h-10 gap-2 whitespace-nowrap bg-foreground text-background hover:bg-foreground/90">
                <Link to="/sales">Lihat Semua</Link>
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-muted-foreground">
                  <th className="p-4 font-medium">Item</th>
                  <th className="p-4 font-medium">Tarikh</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium text-right">Harga Jualan</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingSales ? (
                  <tr>
                    <td colSpan="4" className="text-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto" />
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
                    const invoiceAdjustment = invoiceId
                      ? (invoiceFinancialById.get(invoiceId)?.adjustmentTotal || 0)
                      : 0;
                    const invoiceChannelFee = invoiceId ? (channelFeeByInvoice.get(invoiceId) || 0) : 0;
                    const channelFeeShare = invoiceRevenue > 0
                      ? (totalRevenue / invoiceRevenue) * invoiceChannelFee
                      : 0;
                    const shippingInvoice = invoiceId ? shippingByInvoice.get(invoiceId) : null;
                    const shippingCharged = Math.max(parseFloat(shippingInvoice?.shippingCharged) || 0, 0);
                    const shippingCostPaid = Math.max(parseFloat(shippingInvoice?.shippingCostPaid) || 0, 0);
                    const shippingChargedShare = invoiceRevenue > 0
                      ? (totalRevenue / invoiceRevenue) * shippingCharged
                      : 0;
                    const shippingCostShare = invoiceRevenue > 0
                      ? (totalRevenue / invoiceRevenue) * shippingCostPaid
                      : 0;
                    const shippingProfitShare = shippingChargedShare - shippingCostShare;
                    const adjustmentShare = invoiceRevenue > 0
                      ? (totalRevenue / invoiceRevenue) * invoiceAdjustment
                      : 0;
                    const profit = totalRevenue - totalCost - channelFeeShare + shippingProfitShare - adjustmentShare;
                    const isLoss = profit < 0;
                    return (
                      <tr key={`${sale.id}-${index}`} className="border-t relative group overflow-hidden">
                        <td className="p-4 font-semibold text-foreground flex items-center gap-3">
                          <div className="absolute left-0 top-0 h-full w-1 bg-primary scale-y-0 group-hover:scale-y-100 transition-transform origin-center duration-300" />
                          <div className="transition-transform duration-300 group-hover:translate-x-2">
                            {sale.is_manual ? (sale.item_name || 'Item Manual') : (sale.items?.name || 'Item Tidak Dikenali')}
                          </div>
                        </td>
                        <td className="p-4 text-muted-foreground">{new Date(sale.invoices?.invoice_date || new Date()).toLocaleDateString()}</td>
                        <td className="p-4">
                          <div className={cn("inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium", isLoss ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700")}>
                            {isLoss ? <XCircle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                            RM {Math.abs(profit).toFixed(2)}
                          </div>
                        </td>
                        <td className="p-4 text-right font-semibold text-foreground">RM{totalRevenue.toFixed(2)}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="4" className="text-muted-foreground text-center py-8">Tiada jualan lagi.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6"> {/* Corrected for side-by-side on lg screens */}
        <motion.div className="lg:col-span-2" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Pecahan Kategori</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex items-center justify-center">
              {categoryPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={categoryPieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} fill="#8884d8" paddingAngle={2} dataKey="value" nameKey="name">
                      {categoryPieData.map((entry, index) => <Cell key={`cell-${index}`} fill={categoryColorMap[entry.name] || defaultColors[index % defaultColors.length]} />)}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, borderRadius: '0.5rem' }} 
                      itemStyle={{ color: tooltipTextColor }}
                      labelStyle={{ color: tooltipTextColor, fontWeight: 'bold' }}
                      formatter={(value, name) => [`${value} item`, name]} 
                    />
                    <Legend iconType="circle" wrapperStyle={{ color: tickColor, fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-muted-foreground text-center py-4">Tiada data.</p>}
            </CardContent>
          </Card>
        </motion.div>
        <motion.div className="lg:col-span-3" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Platform Jualan Teratas</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex items-center justify-center">
              {platformBarData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                   <BarChart data={platformBarData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                    <XAxis dataKey="name" stroke={tickColor} tick={{ fill: tickColor, fontSize: 12 }} />
                    <YAxis stroke={tickColor} tick={{ fill: tickColor, fontSize: 12 }} allowDecimals={false} />
                    <Tooltip 
                      cursor={{ fill: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)' }}
                      contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, borderRadius: '0.5rem' }}
                      itemStyle={{ color: tooltipTextColor }}
                      labelStyle={{ color: tooltipTextColor, fontWeight: 'bold' }}
                      formatter={(value) => [`${value} jualan`]}
                    />
                    <Bar dataKey="jumlah" barSize={30} radius={[4, 4, 0, 0]}>
                       {platformBarData.map((entry, index) => <Cell key={`cell-${index}`} fill={defaultColors[index % defaultColors.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-muted-foreground text-center py-4">Tiada data platform untuk dipaparkan.</p>}
            </CardContent>
          </Card>
        </motion.div>
      </div>
      </div>
    </UiTooltipProvider>
  );
};

export default Dashboard;

