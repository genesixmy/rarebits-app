import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2,
  Package, 
  TrendingUp, 
  TrendingDown,
  BarChart3,
  Calendar,
  Wallet,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeProvider';
import { supabase } from '@/lib/customSupabaseClient';
import { resolveTransactionClassification, TRANSACTION_CLASSIFICATIONS } from '@/components/wallet/transactionClassification';

const StatCard = ({ title, value, icon, subtext, delay, isHighlighted = false, tone = 'sky' }) => {
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
            : "border-slate-200/80 bg-card shadow-sm hover:-translate-y-0.5 hover:shadow-lg"
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "inline-flex h-10 w-10 items-center justify-center rounded-full",
                  isHighlighted ? "bg-white/95 text-sky-500" : toneStyle.iconWrap
                )}
              >
                {React.cloneElement(icon, { className: cn('h-4 w-4', isHighlighted ? 'text-sky-500' : toneStyle.icon) })}
              </span>
              <CardTitle className={cn("text-base md:text-base font-semibold", isHighlighted ? 'text-white' : 'text-foreground')}>
                {title}
              </CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className={cn("text-xl md:text-2xl font-bold leading-none tracking-tight", isHighlighted ? 'text-white' : 'text-foreground')}>
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
            <p className={cn("text-xs font-medium", isHighlighted ? 'text-white/90' : 'text-muted-foreground')}>
              {subtext}
            </p>
          </div>
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

const Dashboard = ({ items, categories }) => {
  const { toast } = useToast();
  const { theme } = useTheme();
  const [dateRange, setDateRange] = useState(getInitialDateRange());
  const [userId, setUserId] = useState(null);

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
          invoices(id, invoice_date, status, platform, user_id, created_at, updated_at)
        `);

      if (error) {
        console.error('[Dashboard] Error fetching invoice items:', error);
        return [];
      }

      // Filter to only current user's invoices with paid status
      return (data || []).filter(invItem => 
        invItem.invoices && 
        invItem.invoices.user_id === userId &&
        invItem.invoices.status === 'paid'
      );
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
  const { data: businessExpenses = 0 } = useQuery({
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
        .select('amount, type, transaction_type, category, invoice_id')
        .eq('user_id', userId)
        .in('wallet_id', businessWalletIds)
        .gte('transaction_date', dateRange.startDate)
        .lte('transaction_date', endDateISO);
      
      if (error) {
        console.error('[Dashboard] Error fetching expenses:', error);
        return 0;
      }
      
      const total = (data || []).reduce((sum, tx) => {
        const classification = resolveTransactionClassification(tx);
        if (classification !== TRANSACTION_CLASSIFICATIONS.EXPENSE) {
          return sum;
        }
        return sum + Math.abs(parseFloat(tx.amount) || 0);
      }, 0);
      console.log('[Dashboard] Expenses fetched:', { count: data?.length || 0, total, data });
      return total;
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

  // Calculate stats from invoice_items
  const totalCost = filteredSales.reduce((sum, sale) => {
    const costPrice = getEffectiveCostPrice(sale);
    const cost = costPrice * (sale.quantity || 1);
    return sum + cost;
  }, 0);

  const filteredStats = {
    totalRevenue: filteredSales.reduce((sum, sale) => {
      return sum + (parseFloat(sale.line_total) || 0);
    }, 0),
    totalCost: totalCost,
    totalExpenses: parseFloat(businessExpenses) || 0,
    totalRefunds: parseFloat(totalRefunds) || 0,
    totalProfit: filteredSales.reduce((sum, sale) => {
      const revenue = parseFloat(sale.line_total) || 0;
      const costPrice = getEffectiveCostPrice(sale);
      const cost = costPrice * (sale.quantity || 1);
      return sum + (revenue - cost);
    }, 0) - (parseFloat(businessExpenses) || 0) - (parseFloat(totalRefunds) || 0),
    soldItemsCount: filteredSales.length,
    totalQuantitySold: filteredSales.reduce((sum, sale) => {
      return sum + (sale.quantity || 0);
    }, 0)
  };

  const profitMargin = filteredStats.totalRevenue > 0 ? ((filteredStats.totalProfit / filteredStats.totalRevenue) * 100).toFixed(1) : 0;

  const globalStats = {
    totalItems: items.length,
    availableItems: items.filter(item => ['tersedia', 'reserved'].includes(item.status)).length,
    soldItems: items.filter(item => item.status === 'terjual').length,
  };

  const categoryStats = filteredSales.reduce((acc, sale) => {
    const category = sale.is_manual ? 'Manual' : (sale.items?.category || 'Lain-lain');
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});

  // Calculate platform stats from invoice platform field
  const platformStats = filteredSales.reduce((acc, sale) => {
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
    <div className="space-y-6">
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
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Jumlah Item"
          value={globalStats.totalItems}
          icon={<Package />}
          subtext={`${globalStats.availableItems} tersedia`}
          delay={0.2}
          tone="sky"
        />
        <StatCard
          title="Kuantiti Terjual"
          value={filteredStats.totalQuantitySold}
          icon={<CheckCircle />}
          subtext={`Daripada ${filteredStats.soldItemsCount} item`}
          delay={0.3}
          tone="amber"
        />
        <StatCard
          title="Jumlah Hasil"
          value={`RM ${filteredStats.totalRevenue.toFixed(2)}`}
          icon={<Wallet />}
          subtext={`Daripada ${filteredStats.soldItemsCount} jualan`}
          delay={0.4}
          tone="emerald"
        />
        <StatCard
          title="Jumlah Perbelanjaan"
          value={`RM ${filteredStats.totalExpenses.toFixed(2)}`}
          icon={<TrendingDown />}
          subtext="Perbelanjaan perniagaan"
          delay={0.45}
          tone="fuchsia"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatCard
          title="Jumlah Pemulangan"
          value={`RM ${filteredStats.totalRefunds.toFixed(2)}`}
          icon={<TrendingDown />}
          subtext="Dana yang dikembalikan"
          delay={0.47}
          tone="rose"
        />
        <StatCard
          title="Baki Business"
          value={`RM ${parseFloat(businessWalletBalance?.balance || 0).toFixed(2)}`}
          icon={<Wallet />}
          subtext={businessWalletBalance?.name ? `${businessWalletBalance.name} (live)` : 'Belum ada wallet Business'}
          delay={0.49}
          tone="indigo"
        />
        <StatCard
          title="Keuntungan Bersih"
          value={`RM ${filteredStats.totalProfit.toFixed(2)}`}
          icon={<TrendingUp />}
          subtext={`${profitMargin}% margin`}
          delay={0.5}
          isHighlighted={true}
          tone="lime"
        />
      </div>

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
                    const profit = totalRevenue - totalCost;
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
  );
};

export default Dashboard;
