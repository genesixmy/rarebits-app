import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Package, 
  TrendingUp, 
  BarChart3,
  Calendar,
  Wallet,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area } from 'recharts';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeProvider';

const StatCard = ({ title, value, icon, subtext, delay, isHighlighted = false, chartData }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const chartColor = isHighlighted ? '#fff' : (isDark ? '#a78bfa' : '#8b5cf6');

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <Card className={cn("relative overflow-hidden", isHighlighted && 'brand-gradient text-white')}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className={cn("text-sm font-medium", isHighlighted ? 'text-white/80' : 'text-muted-foreground')}>
            {title}
          </CardTitle>
          {React.cloneElement(icon, { className: cn('h-5 w-5', isHighlighted ? 'text-white/80' : 'text-muted-foreground') })}
        </CardHeader>
        <CardContent>
          <div className={cn("text-2xl font-bold", isHighlighted ? 'text-white' : 'text-foreground')}>
            {value}
          </div>
          <p className={cn("text-xs mt-1", isHighlighted ? 'text-white/80' : 'text-muted-foreground')}>
            {subtext}
          </p>
        </CardContent>
        <div className="absolute bottom-0 left-0 right-0 h-16 opacity-50">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id={`color${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColor} stopOpacity={0.4}/>
                  <stop offset="95%" stopColor={chartColor} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="value" stroke={chartColor} strokeWidth={2} fillOpacity={1} fill={`url(#color${title.replace(/\s/g, '')})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
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
  
  const getFilteredItems = () => {
    if (dateRange.startDate && dateRange.endDate) {
      const start = new Date(dateRange.startDate);
      const end = new Date(dateRange.endDate);
      end.setHours(23, 59, 59, 999);

      return items.filter(item => {
        if (item.status === 'terjual' && item.date_sold) {
          const soldDate = new Date(item.date_sold);
          return soldDate >= start && soldDate <= end;
        }
        return false;
      });
    }
    return items.filter(item => item.status === 'terjual');
  };
  
  const filteredSoldItems = getFilteredItems();

  const filteredStats = {
    totalRevenue: filteredSoldItems.reduce((sum, item) => sum + (parseFloat(item.selling_price) || 0), 0),
    totalProfit: filteredSoldItems.reduce((sum, item) => sum + ((parseFloat(item.selling_price) || 0) - (parseFloat(item.cost_price) || 0)), 0),
    soldItemsCount: filteredSoldItems.length
  };
  
  const profitMargin = filteredStats.totalRevenue > 0 ? ((filteredStats.totalProfit / filteredStats.totalRevenue) * 100).toFixed(1) : 0;

  const globalStats = {
    totalItems: items.length,
    availableItems: items.filter(item => ['tersedia', 'reserved'].includes(item.status)).length,
    soldItems: items.filter(item => item.status === 'terjual').length,
  };

  const categoryStats = filteredSoldItems.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});

  const platformStats = filteredSoldItems.reduce((acc, item) => {
    (item.sold_platforms || []).forEach(platform => {
      acc[platform] = (acc[platform] || 0) + 1;
    });
    return acc;
  }, {});

  const categoryPieData = Object.entries(categoryStats).map(([name, value]) => ({ name, value }));
  const platformBarData = Object.entries(platformStats).map(([name, value]) => ({ name, jumlah: value }));
  
  const categoryColorMap = categories.reduce((acc, cat) => {
    acc[cat.name] = cat.color;
    return acc;
  }, {});
  
  const defaultColors = ['#3b82f6', '#10b981', '#f97316', '#a855f7', '#ef4444', '#6366f1', '#f43f5e'];

  const recentSales = items
    .filter(item => item.status === 'terjual' && item.date_sold)
    .sort((a, b) => new Date(b.date_sold) - new Date(a.date_sold))
    .slice(0, 5);

  const isDark = theme === 'dark';
  const tickColor = isDark ? '#9ca3af' : '#6b7281';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
  const tooltipBg = isDark ? '#1f2937' : '#ffffff';
  const tooltipBorder = isDark ? '#374151' : '#e5e7eb';
  const tooltipTextColor = isDark ? '#f3f4f6' : '#111827';

  const dummyChartData = [
    { name: 'A', value: 400 }, { name: 'B', value: 300 }, { name: 'C', value: 600 },
    { name: 'D', value: 500 }, { name: 'E', value: 800 }, { name: 'F', value: 700 },
  ];

  return (
    <div className="space-y-6">
      <h1 className="page-title">Papan Pemuka</h1>
      
      <div className="px-6 py-4 bg-background rounded-2xl shadow-sm">
        <h2 className="text-lg font-semibold leading-none tracking-tight mb-4">Tapis Tarikh Jualan</h2>
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex-1">
            <label className="block text-sm text-muted-foreground mb-1">Tarikh Mula</label>
            <Input type="date" value={dateRange.startDate} onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))} className="bg-white rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" />
          </div>
          <div className="flex-1">
            <label className="block text-sm text-muted-foreground mb-1">Tarikh Akhir</label>
            <Input type="date" value={dateRange.endDate} onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))} className="bg-white rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" />
          </div>
          <Button variant="secondary" onClick={() => setDateRange({ startDate: '', endDate: '' })} className="h-10">Lihat Semua</Button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Jumlah Item" value={globalStats.totalItems} icon={<Package />} subtext={`${globalStats.availableItems} tersedia`} delay={0.2} chartData={dummyChartData} />
        <StatCard title="Item Terjual" value={filteredStats.soldItemsCount} icon={<CheckCircle />} subtext={`${globalStats.totalItems > 0 ? ((globalStats.soldItems / globalStats.totalItems) * 100).toFixed(1) : 0}% terjual`} delay={0.3} chartData={dummyChartData.slice().reverse()} />
        <StatCard title="Jumlah Hasil" value={`RM ${filteredStats.totalRevenue.toFixed(2)}`} icon={<Wallet />} subtext={`Daripada ${filteredStats.soldItemsCount} jualan`} delay={0.4} chartData={dummyChartData} />
        <StatCard title="Jumlah Keuntungan" value={`RM ${filteredStats.totalProfit.toFixed(2)}`} icon={<TrendingUp />} subtext={`${profitMargin}% margin`} delay={0.5} isHighlighted={true} chartData={dummyChartData.slice().reverse()} />
      </div>

      <Card>
        <CardHeader className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full">
            <CardTitle className="text-lg font-semibold">Jualan Terkini</CardTitle>
            <p className="text-sm text-muted-foreground">Senarai Jualan Semua Platform</p>
          </div>
          {items.filter(i => i.status === 'terjual').length > 5 && (
            <div className="w-full sm:w-auto flex justify-start sm:justify-end">
              <Button asChild variant="secondary" size="sm" className="whitespace-nowrap bg-foreground text-background hover:bg-foreground/90">
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
                {recentSales.length > 0 ? (
                  recentSales.map((item, index) => {
                    const profit = (parseFloat(item.selling_price) - parseFloat(item.cost_price));
                    const isLoss = profit < 0;
                    return (
                      <tr key={item.id} className="border-t relative group overflow-hidden">
                        <td className="p-4 font-semibold text-foreground flex items-center gap-3">
                          <div className="absolute left-0 top-0 h-full w-1 bg-primary scale-y-0 group-hover:scale-y-100 transition-transform origin-center duration-300" />
                          <div className="transition-transform duration-300 group-hover:translate-x-2">
                            {item.name}
                          </div>
                        </td>
                        <td className="p-4 text-muted-foreground">{new Date(item.date_sold).toLocaleDateString()}</td>
                        <td className="p-4">
                          <div className={cn("inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium", isLoss ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700")}>
                            {isLoss ? <XCircle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                            RM {Math.abs(profit).toFixed(2)}
                          </div>
                        </td>
                        <td className="p-4 text-right font-semibold text-foreground">RM{parseFloat(item.selling_price).toFixed(2)}</td>
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