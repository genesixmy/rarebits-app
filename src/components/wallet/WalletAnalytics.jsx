import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Download, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import {
  TRANSACTION_CLASSIFICATIONS,
  classificationLabel,
  getTransactionDirection,
  resolveTransactionClassification,
} from './transactionClassification';

const RANGE_OPTIONS = [7, 30, 90];

const TYPE_LABEL = {
  sale: 'Jualan',
  topup: 'Top Up',
  transfer_in: 'Transfer Masuk',
  expense: 'Perbelanjaan',
  transfer_out: 'Transfer Keluar',
  adjustment: 'Pelarasan',
  other: 'Lain-lain',
};

const formatNumber = (value) => `RM ${Number(value || 0).toFixed(2)}`;
const WALLET_GRAPH_THEME = {
  inflow: '#22c1dd',
  inflowSoft: '#67e8f9',
  outflow: '#8b5cf6',
  outflowSoft: '#c4b5fd',
  axis: '#94a3b8',
  grid: '#e2e8f0',
  tooltipText: '#334155',
  tooltipBg: '#ffffff',
  tooltipBorder: '#e2e8f0',
  tooltipShadow: '0 10px 30px -16px rgba(15, 23, 42, 0.45)',
};

const getCurrentMonthValue = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${month}`;
};

const getMonthBounds = (monthValue) => {
  const [year, month] = monthValue.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return { start, end };
};

const buildLocalTrend = (transactions, selectedWalletId, days) => {
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);

  const startDate = new Date();
  startDate.setDate(endDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);

  const map = new Map();
  for (let cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
    const key = cursor.toISOString().split('T')[0];
    map.set(key, { tx_date: key, inflow: 0, outflow: 0 });
  }

  (transactions || []).forEach((tx) => {
    if (selectedWalletId !== 'all' && tx.wallet_id !== selectedWalletId) return;
    const dateKey = new Date(tx.created_at || tx.transaction_date || tx.updated_at).toISOString().split('T')[0];
    if (!map.has(dateKey)) return;

    const classification = resolveTransactionClassification(tx);
    const direction = getTransactionDirection(tx);
    const amount = Math.abs(parseFloat(tx.amount) || 0);
    const row = map.get(dateKey);

    if (
      classification === TRANSACTION_CLASSIFICATIONS.SALE ||
      classification === TRANSACTION_CLASSIFICATIONS.TOPUP ||
      classification === TRANSACTION_CLASSIFICATIONS.TRANSFER_IN
    ) {
      row.inflow += amount;
      return;
    }

    if (
      classification === TRANSACTION_CLASSIFICATIONS.EXPENSE ||
      classification === TRANSACTION_CLASSIFICATIONS.TRANSFER_OUT
    ) {
      row.outflow += amount;
      return;
    }

    if (classification === TRANSACTION_CLASSIFICATIONS.ADJUSTMENT) {
      if (direction < 0) {
        row.outflow += amount;
      } else {
        row.inflow += amount;
      }
    }
  });

  return Array.from(map.values());
};

const buildLocalBreakdown = (transactions, selectedWalletId, days) => {
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);

  const startDate = new Date();
  startDate.setDate(endDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);

  const inflowMap = new Map();
  const outflowMap = new Map();

  (transactions || []).forEach((tx) => {
    if (selectedWalletId !== 'all' && tx.wallet_id !== selectedWalletId) return;
    const createdAt = new Date(tx.created_at || tx.transaction_date || tx.updated_at);
    if (createdAt < startDate || createdAt >= endDate) return;

    const classification = resolveTransactionClassification(tx);
    const direction = getTransactionDirection(tx);
    const amount = Math.abs(parseFloat(tx.amount) || 0);
    if (!amount) return;

    if (
      classification === TRANSACTION_CLASSIFICATIONS.SALE ||
      classification === TRANSACTION_CLASSIFICATIONS.TOPUP ||
      classification === TRANSACTION_CLASSIFICATIONS.TRANSFER_IN
    ) {
      inflowMap.set(classification, (inflowMap.get(classification) || 0) + amount);
      return;
    }

    if (
      classification === TRANSACTION_CLASSIFICATIONS.EXPENSE ||
      classification === TRANSACTION_CLASSIFICATIONS.TRANSFER_OUT
    ) {
      outflowMap.set(classification, (outflowMap.get(classification) || 0) + amount);
      return;
    }

    if (classification === TRANSACTION_CLASSIFICATIONS.ADJUSTMENT) {
      if (direction < 0) {
        outflowMap.set(classification, (outflowMap.get(classification) || 0) + amount);
      } else {
        inflowMap.set(classification, (inflowMap.get(classification) || 0) + amount);
      }
    }
  });

  return {
    inflow: Array.from(inflowMap.entries()).map(([flow_type, total]) => ({ flow_type, total })),
    outflow: Array.from(outflowMap.entries()).map(([flow_type, total]) => ({ flow_type, total })),
  };
};

const buildLocalMonthlySummary = (transactions, walletId, monthValue) => {
  const { start, end } = getMonthBounds(monthValue);
  let inflow = 0;
  let outflow = 0;

  (transactions || []).forEach((tx) => {
    if (tx.wallet_id !== walletId) return;
    const createdAt = new Date(tx.created_at || tx.transaction_date || tx.updated_at);
    if (createdAt < start || createdAt >= end) return;

    const classification = resolveTransactionClassification(tx);
    const direction = getTransactionDirection(tx);
    const amount = Math.abs(parseFloat(tx.amount) || 0);
    if (!amount) return;

    if (
      classification === TRANSACTION_CLASSIFICATIONS.SALE ||
      classification === TRANSACTION_CLASSIFICATIONS.TOPUP ||
      classification === TRANSACTION_CLASSIFICATIONS.TRANSFER_IN
    ) {
      inflow += amount;
      return;
    }

    if (
      classification === TRANSACTION_CLASSIFICATIONS.EXPENSE ||
      classification === TRANSACTION_CLASSIFICATIONS.TRANSFER_OUT
    ) {
      outflow += amount;
      return;
    }

    if (classification === TRANSACTION_CLASSIFICATIONS.ADJUSTMENT) {
      if (direction < 0) {
        outflow += amount;
      } else {
        inflow += amount;
      }
    }
  });

  return {
    inflow,
    outflow,
    net: inflow - outflow,
  };
};

const buildLocalMonthlyTransactions = (transactions, walletId, monthValue) => {
  const { start, end } = getMonthBounds(monthValue);
  return (transactions || [])
    .filter((tx) => {
      if (tx.wallet_id !== walletId) return false;
      const createdAt = new Date(tx.created_at || tx.transaction_date || tx.updated_at);
      return createdAt >= start && createdAt < end;
    })
    .map((tx) => ({
      created_at: tx.created_at || tx.transaction_date || tx.updated_at,
      transaction_type: tx.transaction_type || '',
      legacy_type: tx.type || '',
      description: tx.description || '',
      category: tx.category || '',
      amount: parseFloat(tx.amount) || 0,
      wallet_id: tx.wallet_id,
      invoice_id: tx.invoice_id || null,
      transfer_id: tx.transfer_id || null,
    }))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
};

const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
};

const WalletAnalytics = ({ wallets = [], transactions = [] }) => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [days, setDays] = useState(30);
  const [chartWalletId, setChartWalletId] = useState('all');
  const [monthValue, setMonthValue] = useState(getCurrentMonthValue());
  const [summaryWalletId, setSummaryWalletId] = useState(wallets[0]?.id || '');

  const hasScopedWallets = wallets.length > 0;
  const chartWalletParam = chartWalletId === 'all' ? null : chartWalletId;
  const hasWalletSelector = wallets.length > 1;
  const selectedSummaryWallet = wallets.find((wallet) => wallet.id === summaryWalletId) || null;
  const canRunChartRpc = hasScopedWallets && chartWalletId !== 'all';
  const isSummaryWalletInScope = wallets.some((wallet) => wallet.id === summaryWalletId);

  useEffect(() => {
    if (chartWalletId === 'all') return;
    if (!wallets.some((wallet) => wallet.id === chartWalletId)) {
      setChartWalletId('all');
    }
  }, [wallets, chartWalletId]);

  useEffect(() => {
    if (summaryWalletId && wallets.some((wallet) => wallet.id === summaryWalletId)) return;
    setSummaryWalletId(wallets[0]?.id || '');
  }, [wallets, summaryWalletId]);

  const trendQuery = useQuery({
    queryKey: ['wallet-cashflow-trend', user?.id, chartWalletParam, days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_wallet_cashflow_trend', {
        p_user_id: user.id,
        p_wallet_id: chartWalletParam,
        p_days: days,
      });

      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id && canRunChartRpc,
  });

  const breakdownQuery = useQuery({
    queryKey: ['wallet-cashflow-breakdown', user?.id, chartWalletParam, days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_wallet_cashflow_breakdown', {
        p_user_id: user.id,
        p_wallet_id: chartWalletParam,
        p_days: days,
      });

      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id && canRunChartRpc,
  });

  const monthlySummaryQuery = useQuery({
    queryKey: ['wallet-monthly-summary', user?.id, summaryWalletId, monthValue],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_wallet_monthly_summary', {
        p_user_id: user.id,
        p_wallet_id: summaryWalletId,
        p_month_start: `${monthValue}-01`,
      });

      if (error) throw error;
      return data?.[0] || { inflow: 0, outflow: 0, net: 0 };
    },
    enabled: !!user?.id && !!summaryWalletId && isSummaryWalletInScope,
  });

  const monthlyTransactionsQuery = useQuery({
    queryKey: ['wallet-monthly-transactions-export', user?.id, summaryWalletId, monthValue],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_wallet_monthly_transactions_export', {
        p_user_id: user.id,
        p_wallet_id: summaryWalletId,
        p_month_start: `${monthValue}-01`,
      });

      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id && !!summaryWalletId && isSummaryWalletInScope,
  });

  const fallbackTrend = useMemo(
    () => buildLocalTrend(transactions, chartWalletId, days),
    [transactions, chartWalletId, days]
  );
  const fallbackBreakdown = useMemo(
    () => buildLocalBreakdown(transactions, chartWalletId, days),
    [transactions, chartWalletId, days]
  );
  const fallbackSummary = useMemo(
    () => buildLocalMonthlySummary(transactions, summaryWalletId, monthValue),
    [transactions, summaryWalletId, monthValue]
  );
  const fallbackMonthlyTransactions = useMemo(
    () => buildLocalMonthlyTransactions(transactions, summaryWalletId, monthValue),
    [transactions, summaryWalletId, monthValue]
  );

  // Prefer local transaction dataset from WalletPage for immediate UI consistency after mutations.
  // RPC remains as fallback when local dataset is empty.
  const hasLocalTransactions = Array.isArray(transactions) && transactions.length > 0;
  const useAnalyticsFallback =
    !canRunChartRpc || hasLocalTransactions || trendQuery.isError || breakdownQuery.isError;
  const useSummaryFallback =
    !hasScopedWallets ||
    !summaryWalletId ||
    !isSummaryWalletInScope ||
    hasLocalTransactions ||
    monthlySummaryQuery.isError ||
    monthlyTransactionsQuery.isError;

  const trendRows = useMemo(() => {
    const baseRows = useAnalyticsFallback ? fallbackTrend : (trendQuery.data || []);
    return baseRows.map((row) => {
      const dateValue = row.tx_date || row.date;
      const normalizedDate = new Date(dateValue);
      return {
        date: normalizedDate.toISOString().split('T')[0],
        label: normalizedDate.toLocaleDateString('ms-MY', { day: '2-digit', month: 'short' }),
        Masuk: parseFloat(row.inflow || 0),
        Keluar: parseFloat(row.outflow || 0),
      };
    });
  }, [fallbackTrend, trendQuery.data, useAnalyticsFallback]);

  const breakdownRows = useMemo(() => {
    if (useAnalyticsFallback) {
      return [
        ...fallbackBreakdown.inflow.map((row) => ({ flow_group: 'inflow', ...row })),
        ...fallbackBreakdown.outflow.map((row) => ({ flow_group: 'outflow', ...row })),
      ];
    }
    return breakdownQuery.data || [];
  }, [breakdownQuery.data, fallbackBreakdown, useAnalyticsFallback]);

  const inflowBreakdown = useMemo(
    () =>
      breakdownRows
        .filter((row) => row.flow_group === 'inflow')
        .map((row) => ({
          label: TYPE_LABEL[row.flow_type] || row.flow_type,
          total: parseFloat(row.total || 0),
        }))
        .sort((a, b) => b.total - a.total),
    [breakdownRows]
  );

  const outflowBreakdown = useMemo(
    () =>
      breakdownRows
        .filter((row) => row.flow_group === 'outflow')
        .map((row) => ({
          label: TYPE_LABEL[row.flow_type] || row.flow_type,
          total: parseFloat(row.total || 0),
        }))
        .sort((a, b) => b.total - a.total),
    [breakdownRows]
  );

  const summary = useMemo(() => {
    if (useSummaryFallback) {
      return fallbackSummary;
    }
    return {
      inflow: parseFloat(monthlySummaryQuery.data?.inflow || 0),
      outflow: parseFloat(monthlySummaryQuery.data?.outflow || 0),
      net: parseFloat(monthlySummaryQuery.data?.net || 0),
    };
  }, [fallbackSummary, monthlySummaryQuery.data, useSummaryFallback]);

  const monthlyRows = useMemo(
    () => (useSummaryFallback ? fallbackMonthlyTransactions : (monthlyTransactionsQuery.data || [])),
    [fallbackMonthlyTransactions, monthlyTransactionsQuery.data, useSummaryFallback]
  );

  const isAnalyticsLoading = !useAnalyticsFallback && (trendQuery.isLoading || breakdownQuery.isLoading);
  const isSummaryLoading = !useSummaryFallback && (monthlySummaryQuery.isLoading || monthlyTransactionsQuery.isLoading);
  const hasTrendData = trendRows.some((row) => row.Masuk > 0 || row.Keluar > 0);

  const handleExportMonthlyCsv = () => {
    if (!summaryWalletId) {
      toast({ title: 'Sila pilih wallet dahulu.', variant: 'destructive' });
      return;
    }
    if (!monthlyRows || monthlyRows.length === 0) {
      toast({ title: 'Tiada transaksi untuk bulan dipilih.', variant: 'destructive' });
      return;
    }

    const walletName = selectedSummaryWallet?.name || 'Wallet';
    const summaryLines = [
      ['Bulan', monthValue],
      ['Wallet', walletName],
      ['Masuk', summary.inflow.toFixed(2)],
      ['Keluar', summary.outflow.toFixed(2)],
      ['Net', summary.net.toFixed(2)],
      [],
    ];

    const headers = ['Date', 'Time', 'Type', 'Description', 'Amount', 'Wallet Name', 'Reference'];

    const rows = monthlyRows.map((tx) => {
      const normalizedTx = {
        transaction_type: tx.transaction_type,
        type: tx.legacy_type || tx.type,
        amount: tx.amount,
        category: tx.category,
        invoice_id: tx.invoice_id,
      };
      const classification = resolveTransactionClassification(normalizedTx);
      const direction = getTransactionDirection(normalizedTx);
      const amountValue = Math.abs(parseFloat(tx.amount) || 0) * (direction < 0 ? -1 : 1);
      const datetime = new Date(tx.created_at);
      const reference = tx.invoice_id || tx.transfer_id || '';

      return [
        datetime.toLocaleDateString('ms-MY'),
        datetime.toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' }),
        classificationLabel(classification),
        tx.description || tx.category || '-',
        amountValue.toFixed(2),
        walletName,
        reference,
      ];
    });

    const csvLines = [
      ...summaryLines.map((line) => line.map(csvCell).join(',')),
      headers.map(csvCell).join(','),
      ...rows.map((line) => line.map(csvCell).join(',')),
    ];

    const csvContent = `data:text/csv;charset=utf-8,${csvLines.join('\n')}`;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `ringkasan_wallet_${walletName.replace(/\s+/g, '_')}_${monthValue}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: 'CSV ringkasan bulanan berjaya dieksport.' });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <CardTitle>Ringkasan Bulanan</CardTitle>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={handleExportMonthlyCsv}
            disabled={!summaryWalletId || isSummaryLoading}
          >
            {isSummaryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export CSV
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs font-medium text-muted-foreground">Bulan</label>
              <Input
                type="date"
                value={`${monthValue}-01`}
                onChange={(event) => {
                  if (!event.target.value) return;
                  setMonthValue(event.target.value.slice(0, 7));
                }}
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-muted-foreground">Wallet</label>
              <Select
                value={summaryWalletId}
                onChange={(event) => setSummaryWalletId(event.target.value)}
                disabled={!wallets.length}
              >
                {wallets.length > 0 ? (
                  wallets.map((wallet) => (
                    <option key={wallet.id} value={wallet.id}>
                      {wallet.name}
                    </option>
                  ))
                ) : (
                  <option value="">Tiada wallet</option>
                )}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="text-xs font-medium text-green-700">Aliran Masuk</p>
              <p className="mt-1 text-xl font-bold text-green-700">{formatNumber(summary.inflow)}</p>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-xs font-medium text-red-700">Aliran Keluar</p>
              <p className="mt-1 text-xl font-bold text-red-700">{formatNumber(summary.outflow)}</p>
            </div>
            <div className={cn(
              'rounded-lg border p-4',
              summary.net >= 0 ? 'border-blue-200 bg-blue-50' : 'border-orange-200 bg-orange-50'
            )}>
              <p className={cn('text-xs font-medium', summary.net >= 0 ? 'text-blue-700' : 'text-orange-700')}>Net</p>
              <p className={cn('mt-1 text-xl font-bold', summary.net >= 0 ? 'text-blue-700' : 'text-orange-700')}>
                {formatNumber(summary.net)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {RANGE_OPTIONS.map((value) => (
              <Button
                key={value}
                type="button"
                variant={days === value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDays(value)}
                className={cn(days === value && 'brand-gradient text-white')}
              >
                {value} Hari
              </Button>
            ))}
          </div>
          {hasWalletSelector && (
            <div className="w-full md:w-64">
              <Select value={chartWalletId} onChange={(event) => setChartWalletId(event.target.value)}>
                <option value="all">Semua Wallet</option>
                {wallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Aliran Masuk vs Aliran Keluar</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Trend tunai {days} hari terakhir</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5 text-slate-600">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: WALLET_GRAPH_THEME.inflow }} />
                Aliran Masuk
              </span>
              <span className="inline-flex items-center gap-1.5 text-slate-600">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: WALLET_GRAPH_THEME.outflow }} />
                Aliran Keluar
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isAnalyticsLoading ? (
            <div className="flex h-[300px] items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !hasTrendData ? (
            <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
              Tiada transaksi untuk julat masa ini.
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-2.5">
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={trendRows} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="walletInflowFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={WALLET_GRAPH_THEME.inflow} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={WALLET_GRAPH_THEME.inflow} stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="walletOutflowFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={WALLET_GRAPH_THEME.outflow} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={WALLET_GRAPH_THEME.outflow} stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={WALLET_GRAPH_THEME.grid} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: WALLET_GRAPH_THEME.axis }}
                  />
                  <YAxis
                    tickFormatter={(value) => `RM${Number(value).toFixed(0)}`}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: WALLET_GRAPH_THEME.axis }}
                    width={44}
                  />
                  <Tooltip
                    labelStyle={{ color: WALLET_GRAPH_THEME.tooltipText, fontWeight: 600 }}
                    itemStyle={{ color: WALLET_GRAPH_THEME.tooltipText }}
                    contentStyle={{
                      backgroundColor: WALLET_GRAPH_THEME.tooltipBg,
                      border: `1px solid ${WALLET_GRAPH_THEME.tooltipBorder}`,
                      borderRadius: '0.75rem',
                      boxShadow: WALLET_GRAPH_THEME.tooltipShadow,
                    }}
                    formatter={(value, name) => [formatNumber(value), name]}
                  />
                  <Area
                    type="monotone"
                    dataKey="Masuk"
                    stroke={WALLET_GRAPH_THEME.inflow}
                    fill="url(#walletInflowFill)"
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 5, fill: WALLET_GRAPH_THEME.inflow, stroke: '#ffffff', strokeWidth: 2 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="Keluar"
                    stroke={WALLET_GRAPH_THEME.outflow}
                    fill="url(#walletOutflowFill)"
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 5, fill: WALLET_GRAPH_THEME.outflow, stroke: '#ffffff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pecahan Masuk</CardTitle>
          </CardHeader>
          <CardContent>
            {isAnalyticsLoading ? (
              <div className="flex h-[220px] items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : inflowBreakdown.length === 0 ? (
              <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">Tiada aliran masuk.</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={inflowBreakdown} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <defs>
                    <linearGradient id="walletBreakdownInflowFill" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor={WALLET_GRAPH_THEME.inflowSoft} stopOpacity={0.95} />
                      <stop offset="100%" stopColor={WALLET_GRAPH_THEME.inflow} stopOpacity={0.95} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={WALLET_GRAPH_THEME.grid} />
                  <XAxis
                    type="number"
                    tickFormatter={(value) => `RM${Number(value).toFixed(0)}`}
                    fontSize={12}
                    tick={{ fill: WALLET_GRAPH_THEME.axis }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={110}
                    fontSize={12}
                    tick={{ fill: WALLET_GRAPH_THEME.axis }}
                  />
                  <Tooltip
                    labelStyle={{ color: WALLET_GRAPH_THEME.tooltipText, fontWeight: 600 }}
                    itemStyle={{ color: WALLET_GRAPH_THEME.tooltipText }}
                    contentStyle={{
                      backgroundColor: WALLET_GRAPH_THEME.tooltipBg,
                      border: `1px solid ${WALLET_GRAPH_THEME.tooltipBorder}`,
                      borderRadius: '0.75rem',
                      boxShadow: WALLET_GRAPH_THEME.tooltipShadow,
                    }}
                    formatter={(value) => formatNumber(value)}
                  />
                  <Bar dataKey="total" fill="url(#walletBreakdownInflowFill)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pecahan Keluar</CardTitle>
          </CardHeader>
          <CardContent>
            {isAnalyticsLoading ? (
              <div className="flex h-[220px] items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : outflowBreakdown.length === 0 ? (
              <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">Tiada aliran keluar.</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={outflowBreakdown} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <defs>
                    <linearGradient id="walletBreakdownOutflowFill" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor={WALLET_GRAPH_THEME.outflowSoft} stopOpacity={0.95} />
                      <stop offset="100%" stopColor={WALLET_GRAPH_THEME.outflow} stopOpacity={0.95} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={WALLET_GRAPH_THEME.grid} />
                  <XAxis
                    type="number"
                    tickFormatter={(value) => `RM${Number(value).toFixed(0)}`}
                    fontSize={12}
                    tick={{ fill: WALLET_GRAPH_THEME.axis }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={110}
                    fontSize={12}
                    tick={{ fill: WALLET_GRAPH_THEME.axis }}
                  />
                  <Tooltip
                    labelStyle={{ color: WALLET_GRAPH_THEME.tooltipText, fontWeight: 600 }}
                    itemStyle={{ color: WALLET_GRAPH_THEME.tooltipText }}
                    contentStyle={{
                      backgroundColor: WALLET_GRAPH_THEME.tooltipBg,
                      border: `1px solid ${WALLET_GRAPH_THEME.tooltipBorder}`,
                      borderRadius: '0.75rem',
                      boxShadow: WALLET_GRAPH_THEME.tooltipShadow,
                    }}
                    formatter={(value) => formatNumber(value)}
                  />
                  <Bar dataKey="total" fill="url(#walletBreakdownOutflowFill)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default WalletAnalytics;
