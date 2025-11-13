
import React from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#a4de6c', '#d0ed57', '#ffc658'];

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="p-2 text-sm bg-background/90 backdrop-blur-sm border rounded-lg shadow-lg">
        <p className="label font-bold">{`${label}`}</p>
        {payload.map((p, index) => (
          <p key={index} style={{ color: p.color }}>
            {`${p.name}: RM ${p.value.toFixed(2)}`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const WalletAnalytics = ({ transactions, wallets }) => {
  if (transactions.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-12">
          <p className="text-muted-foreground">Tiada data transaksi untuk dipaparkan dalam analitik.</p>
        </CardContent>
      </Card>
    );
  }

  // 1. Expense Structure Data
  const expenseData = transactions
    .filter(tx => tx.type === 'perbelanjaan' && tx.category)
    .reduce((acc, tx) => {
      const category = tx.category;
      if (!acc[category]) {
        acc[category] = 0;
      }
      acc[category] += parseFloat(tx.amount);
      return acc;
    }, {});
  
  const expenseStructureData = Object.entries(expenseData)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // 2. Balance Trend & Forecast Data
  const sortedTransactions = [...transactions].sort((a, b) => new Date(a.transaction_date) - new Date(b.transaction_date));
  const dailyBalanceChanges = sortedTransactions.reduce((acc, tx) => {
    const date = tx.transaction_date;
    if (!acc[date]) acc[date] = 0;
    
    let amount = parseFloat(tx.amount);
    if (tx.type === 'perbelanjaan' || tx.type === 'pemindahan_keluar') {
      amount = -amount;
    } else if (tx.type !== 'jualan' && tx.type !== 'pendapatan' && tx.type !== 'pemindahan_masuk') {
      amount = 0; // Ignore other types for balance trend
    }
    acc[date] += amount;
    return acc;
  }, {});

  const balanceTrendData = [];
  if (sortedTransactions.length > 0) {
    let runningBalance = wallets.reduce((sum, wallet) => sum + parseFloat(wallet.balance), 0);
    // To get starting balance, we revert all transactions
    let startingBalance = runningBalance - Object.values(dailyBalanceChanges).reduce((sum, change) => sum + change, 0);
    
    const startDate = new Date(sortedTransactions[0].transaction_date);
    const endDate = new Date();
    
    for (let d = startDate; d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateString = d.toISOString().split('T')[0];
      runningBalance += (dailyBalanceChanges[dateString] || 0);
      balanceTrendData.push({ date: dateString, Baki: runningBalance });
    }
  }

  // Simple Linear Regression for Forecast
  const forecastData = [...balanceTrendData];
  if (balanceTrendData.length > 1) {
    const n = balanceTrendData.length;
    const last30Days = balanceTrendData.slice(-30);
    const m = last30Days.length;

    const sumX = last30Days.reduce((acc, _, i) => acc + i, 0);
    const sumY = last30Days.reduce((acc, p) => acc + p.Baki, 0);
    const sumXY = last30Days.reduce((acc, p, i) => acc + i * p.Baki, 0);
    const sumX2 = last30Days.reduce((acc, _, i) => acc + i * i, 0);

    const slope = (m * sumXY - sumX * sumY) / (m * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / m;

    const lastDate = new Date(balanceTrendData[n - 1].date);
    for (let i = 1; i <= 30; i++) {
      const futureDate = new Date(lastDate);
      futureDate.setDate(lastDate.getDate() + i);
      const forecastValue = intercept + slope * (m - 1 + i);
      forecastData.push({ date: futureDate.toISOString().split('T')[0], Ramalan: forecastValue });
    }
  }

  // 3. Cash Flow Trend Data (Inflow vs Outflow)
  const weeklyFlows = transactions.reduce((acc, tx) => {
    const date = new Date(tx.transaction_date);
    const year = date.getFullYear();
    const week = Math.ceil((((date - new Date(year, 0, 1)) / 86400000) + new Date(year, 0, 1).getDay() + 1) / 7);
    const weekLabel = `W${week} '${String(year).slice(2)}`;

    if (!acc[weekLabel]) {
      acc[weekLabel] = { week: weekLabel, Masuk: 0, Keluar: 0, date: date };
    }

    const amount = parseFloat(tx.amount);
    if (tx.type === 'jualan' || tx.type === 'pendapatan' || tx.type === 'pemindahan_masuk') {
      acc[weekLabel].Masuk += amount;
    } else if (tx.type === 'perbelanjaan' || tx.type === 'pemindahan_keluar') {
      acc[weekLabel].Keluar += amount;
    }
    return acc;
  }, {});

  const cashFlowTrendData = Object.values(weeklyFlows).sort((a, b) => a.date - b.date);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Expense Structure */}
      <Card>
        <CardHeader>
          <CardTitle>Struktur Perbelanjaan</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={expenseStructureData}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
                nameKey="name"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {expenseStructureData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `RM ${value.toFixed(2)}`} />
              <Legend iconSize={10} wrapperStyle={{fontSize: "12px"}}/>
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Balance Trend & Forecast */}
      <Card>
        <CardHeader>
          <CardTitle>Trend & Ramalan Baki</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={forecastData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(str) => new Date(str).toLocaleDateString('ms-MY', { month: 'short', day: 'numeric' })} />
              <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `RM${(value/1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend iconSize={10} wrapperStyle={{fontSize: "12px"}}/>
              <Line type="monotone" dataKey="Baki" stroke="#0088FE" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Ramalan" stroke="#00C49F" strokeWidth={2} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Cash Flow Trend */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Trend Aliran Tunai (Mingguan)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={cashFlowTrendData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `RM${(value/1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend iconSize={10} wrapperStyle={{fontSize: "12px"}}/>
              <Bar dataKey="Masuk" fill="#22c55e" radius={[4, 4, 0, 0]} name="Aliran Masuk" />
              <Bar dataKey="Keluar" fill="#ef4444" radius={[4, 4, 0, 0]} name="Aliran Keluar" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};

export default WalletAnalytics;
