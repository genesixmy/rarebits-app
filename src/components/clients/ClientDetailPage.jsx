import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2, ArrowLeft, Mail, Phone, MapPin, Edit, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { useTheme } from '@/contexts/ThemeProvider';
import { useToast } from '@/components/ui/use-toast';
import ClientFormModal from './ClientFormModal';
import { COURIER_PAYMENT_MODES, resolveCourierPaymentModeForInvoice } from '@/lib/shipping';

const resolveInvoiceTotals = (invoiceLike, fallbackOriginal = 0) => {
  const fallback = Math.max(parseFloat(fallbackOriginal) || 0, 0);
  const totalAmountRaw = parseFloat(invoiceLike?.total_amount);
  const totalAmount = Number.isFinite(totalAmountRaw) && totalAmountRaw >= 0
    ? totalAmountRaw
    : fallback;

  const adjustmentRaw = parseFloat(invoiceLike?.adjustment_total);
  const adjustmentTotal = Number.isFinite(adjustmentRaw) && adjustmentRaw > 0
    ? adjustmentRaw
    : 0;

  const returnedRaw = parseFloat(invoiceLike?.returned_total);
  const returnedTotal = Number.isFinite(returnedRaw) && returnedRaw > 0
    ? returnedRaw
    : 0;

  const finalRaw = parseFloat(invoiceLike?.final_total);
  const finalTotal = Number.isFinite(finalRaw)
    ? Math.max(Math.min(finalRaw, totalAmount), 0)
    : Math.max(totalAmount - adjustmentTotal - returnedTotal, 0);

  return {
    totalAmount,
    adjustmentTotal,
    returnedTotal,
    finalTotal,
  };
};

const fetchClientDetails = async (clientId) => {
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('*, client_phones(*), client_addresses(*)')
    .eq('id', clientId)
    .single();
  if (clientError) throw clientError;

  const { data: invoiceItems, error: invoiceItemsError } = await supabase
    .from('invoice_items')
    .select(`
      id,
      item_id,
      item_name,
      is_manual,
      quantity,
      unit_price,
      cost_price,
      line_total,
      item:items(id, name, category, cost_price),
      invoice:invoices(*)
    `)
    .order('created_at', { ascending: false });

  if (invoiceItemsError) throw invoiceItemsError;

  const paidItems = (invoiceItems || [])
    .filter((invItem) =>
      invItem.invoice?.client_id === clientId &&
      ['paid', 'partially_returned', 'returned'].includes(invItem.invoice?.status) &&
      invItem.invoice?.user_id === client.user_id
    );

  const paidInvoiceIds = [...new Set(paidItems.map((invItem) => invItem.invoice?.id).filter(Boolean))];
  const returnedQtyByInvoice = {};

  if (paidInvoiceIds.length > 0) {
    const { data: returnRows, error: returnRowsError } = await supabase
      .from('invoice_item_returns')
      .select('invoice_id, returned_quantity')
      .eq('user_id', client.user_id)
      .in('invoice_id', paidInvoiceIds);

    if (returnRowsError) throw returnRowsError;

    (returnRows || []).forEach((row) => {
      const invoiceId = row?.invoice_id;
      if (!invoiceId) return;
      const qty = parseFloat(row?.returned_quantity) || 0;
      returnedQtyByInvoice[invoiceId] = (returnedQtyByInvoice[invoiceId] || 0) + Math.max(qty, 0);
    });
  }

  const invoiceSummaryById = paidItems.reduce((acc, invItem) => {
    const invoice = invItem.invoice;
    const invoiceId = invoice?.id;
    if (!invoiceId) return acc;

    const quantity = parseInt(invItem.quantity, 10) || 1;
    const unitPrice = parseFloat(invItem.unit_price) || 0;
    const lineTotal = parseFloat(invItem.line_total);
    const totalRevenue = Number.isFinite(lineTotal) ? lineTotal : unitPrice * quantity;

    if (!acc.has(invoiceId)) {
      const shippingCharged = Math.max(parseFloat(invoice?.shipping_charged) || 0, 0);
      const paymentMode = resolveCourierPaymentModeForInvoice(invoice);
      const shippingCollected = paymentMode === COURIER_PAYMENT_MODES.SELLER && shippingCharged > 0
        ? shippingCharged
        : 0;

      acc.set(invoiceId, {
        invoice_id: invoiceId,
        invoice_number: invoice?.invoice_number || invoiceId,
        invoice_date: invoice?.invoice_date,
        items_amount: 0,
        shipping_collected: shippingCollected,
        total_amount: parseFloat(invoice?.total_amount),
        adjustment_total: parseFloat(invoice?.adjustment_total),
        returned_total: parseFloat(invoice?.returned_total),
        final_total: parseFloat(invoice?.final_total),
      });
    }

    const current = acc.get(invoiceId);
    current.items_amount += totalRevenue;

    return acc;
  }, new Map());

  const revenueByInvoice = new Map(
    Array.from(invoiceSummaryById.entries()).map(([invoiceId, summary]) => [invoiceId, summary.items_amount])
  );

  const items = paidItems
    .map(invItem => {
      const quantity = parseInt(invItem.quantity, 10) || 1;
      const unitPrice = parseFloat(invItem.unit_price) || 0;
      const lineTotal = parseFloat(invItem.line_total);
      const totalRevenue = Number.isFinite(lineTotal) ? lineTotal : unitPrice * quantity;

      const isManual = invItem.is_manual || !invItem.item_id;
      const snapshotUnitCost = parseFloat(invItem.cost_price);
      const fallbackItemUnitCost = parseFloat(invItem.item?.cost_price);
      const hasSnapshotCost = Number.isFinite(snapshotUnitCost) && snapshotUnitCost > 0;
      const hasFallbackCost = Number.isFinite(fallbackItemUnitCost) && fallbackItemUnitCost >= 0;

      const unitCost = hasSnapshotCost
        ? snapshotUnitCost
        : (!isManual && hasFallbackCost)
          ? fallbackItemUnitCost
          : (Number.isFinite(snapshotUnitCost) && snapshotUnitCost >= 0 ? snapshotUnitCost : 0);
      const totalCost = unitCost * quantity;
      const name = isManual ? (invItem.item_name || 'Item Manual') : (invItem.item?.name || 'Item');
      const category = isManual ? 'Manual' : (invItem.item?.category || 'Lain-lain');
      const invoiceId = invItem.invoice?.id;
      const invoiceRevenue = invoiceId ? (revenueByInvoice.get(invoiceId) || 0) : 0;
      const invoiceChannelFee = Math.max(parseFloat(invItem.invoice?.channel_fee_amount) || 0, 0);
      const channelFeeShare = invoiceRevenue > 0
        ? (totalRevenue / invoiceRevenue) * invoiceChannelFee
        : 0;
      const profitAmount = totalRevenue - totalCost - channelFeeShare;

      return {
        id: invItem.id,
        name,
        category,
        cost_price: totalCost,
        selling_price: totalRevenue,
        profit_amount: profitAmount,
        sold_platforms: invItem.invoice?.platform ? [invItem.invoice.platform] : [],
        date_sold: invItem.invoice?.invoice_date,
      };
    })
    .sort((a, b) => new Date(b.date_sold || 0) - new Date(a.date_sold || 0));

  const purchases = Array.from(invoiceSummaryById.values())
    .map((summary) => {
      const fallbackOriginal = summary.items_amount + summary.shipping_collected;
      const totals = resolveInvoiceTotals(summary, fallbackOriginal);

      return {
        ...summary,
        total_amount: totals.totalAmount,
        adjustment_total: totals.adjustmentTotal,
        returned_total: totals.returnedTotal,
        total_paid: totals.finalTotal,
        returned_qty: returnedQtyByInvoice[summary.invoice_id] || 0,
      };
    })
    .sort((a, b) => new Date(b.invoice_date || 0) - new Date(a.invoice_date || 0));

  return { ...client, items, purchases };
};

const fetchCategories = async (userId) => {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return data;
};

const ClientDetailPage = () => {
  const { id } = useParams();
  const { theme } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showEditModal, setShowEditModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
    staleTime: Infinity,
  });

  const { data: client, isLoading: isLoadingClient, error: clientError } = useQuery({
    queryKey: ['client', id],
    queryFn: () => fetchClientDetails(id),
  });

  const { data: categories, isLoading: isLoadingCategories } = useQuery({
    queryKey: ['categories', user?.id],
    queryFn: () => fetchCategories(user.id),
    enabled: !!user,
  });

  const stats = useMemo(() => {
    if (!client?.items) {
      return {
        totalPaidToSeller: 0,
        totalItemsAmount: 0,
        shippingCollected: 0,
        platformBreakdown: [],
        categoryBreakdown: [],
      };
    }

    const purchases = client.purchases || [];
    const totalItemsAmount = purchases.reduce((sum, purchase) => sum + (parseFloat(purchase.items_amount) || 0), 0);
    const shippingCollected = purchases.reduce((sum, purchase) => sum + (parseFloat(purchase.shipping_collected) || 0), 0);
    const totalPaidToSeller = purchases.reduce((sum, purchase) => sum + (parseFloat(purchase.total_paid) || 0), 0);

    const platformBreakdown = client.items.reduce((acc, item) => {
      (item.sold_platforms || []).forEach(platform => {
        const existing = acc.find(p => p.name === platform);
        if (existing) {
          existing.value += 1;
        } else {
          acc.push({ name: platform, value: 1 });
        }
      });
      return acc;
    }, []);

    const categoryMap = new Map((categories || []).map(cat => [cat.name, cat.color]));

    const categoryBreakdown = client.items.reduce((acc, item) => {
      const categoryName = item.category || 'Lain-lain';
      const existing = acc.find(c => c.name === categoryName);
      if (existing) {
        existing.value += 1;
      } else {
        acc.push({ 
          name: categoryName, 
          value: 1,
          color: categoryMap.get(categoryName) || '#808080'
        });
      }
      return acc;
    }, []);

    return {
      totalPaidToSeller,
      totalItemsAmount,
      shippingCollected,
      platformBreakdown,
      categoryBreakdown,
    };
  }, [client, categories]);

  const totalPages = Math.ceil((client?.purchases?.length || 0) / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentPurchaseHistory = client?.purchases?.slice(indexOfFirstItem, indexOfLastItem) || [];

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleItemsPerPageChange = (e) => {
    setItemsPerPage(Number(e.target.value));
    setCurrentPage(1);
  };

  const handleSaveClient = () => {
    queryClient.invalidateQueries({ queryKey: ['client', id] });
    queryClient.invalidateQueries({ queryKey: ['clients'] });
    setShowEditModal(false);
  };

  const exportToCSV = () => {
    if (!client?.items || client.items.length === 0) {
      toast({ title: "Tiada data untuk dieksport", variant: "destructive" });
      return;
    }
    const headers = ['Tarikh Jual', 'Nama Item', 'Harga Jual (RM)', 'Platform', 'Kategori'];
    const rows = client.items.map(item => [
      item.date_sold,
      `"${item.name.replace(/"/g, '""')}"`,
      item.selling_price,
      `"${(item.sold_platforms || []).join(', ')}"`,
      `"${item.category}"`
    ]);

    let csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `sejarah_pembelian_${client.name.replace(/\s/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "Sejarah pembelian berjaya dieksport." });
  };

  const isDark = theme === 'dark';
  const tickColor = isDark ? '#9ca3af' : '#6b7281';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
  const tooltipBg = isDark ? '#1f2937' : '#ffffff';
  const tooltipBorder = isDark ? '#374151' : '#e5e7eb';
  const tooltipTextColor = isDark ? '#f3f4f6' : '#111827';
  const defaultPlatformColors = ['#3b82f6', '#10b981', '#f97316', '#a855f7', '#ef4444', '#6366f1', '#f43f5e'];

  if (isLoadingClient || isLoadingCategories) return <div className="flex justify-center items-center h-64"><Loader2 className="w-12 h-12 animate-spin text-primary" /></div>;
  if (clientError) return <div className="text-center text-red-500">Gagal memuatkan butiran pelanggan: {clientError.message}</div>;

  return (
    <>
      <div className="space-y-6">
        <Button asChild variant="ghost" className="pl-0">
          <Link to="/clients" className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Kembali ke Senarai Pelanggan
          </Link>
        </Button>

        <Card>
          <CardHeader className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">{client.name}</h1>
              <div className="flex items-center gap-4 text-muted-foreground mt-2">
                <div className="flex items-center gap-2"><Mail className="w-4 h-4" /><span>{client.email || 'Tiada e-mel'}</span></div>
              </div>
            </div>
            <Button onClick={() => setShowEditModal(true)}>
              <Edit className="w-4 h-4 mr-2" /> Sunting Profil
            </Button>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold mb-3 flex items-center gap-2"><Phone className="w-4 h-4 text-primary" /> Nombor Telefon</h3>
              <div className="flex flex-wrap gap-2">
                {client.client_phones.length > 0 ? (
                  client.client_phones.map(p => (
                    <div key={p.id} className="bg-secondary text-secondary-foreground rounded-lg px-3 py-1.5 text-sm">
                      {p.phone_number}
                    </div>
                  ))
                ) : <p className="text-muted-foreground text-sm">Tiada nombor telefon.</p>}
              </div>
            </div>
            <div>
              <h3 className="font-semibold mb-3 flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" /> Alamat</h3>
              <div className="flex flex-col gap-2">
                {client.client_addresses.length > 0 ? (
                  client.client_addresses.map(a => (
                    <div key={a.id} className="bg-secondary text-secondary-foreground rounded-lg px-3 py-1.5 text-sm">
                      {a.address}
                    </div>
                  ))
                ) : <p className="text-muted-foreground text-sm">Tiada alamat.</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle>Jumlah Dibayar</CardTitle></CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-primary">RM{stats.totalPaidToSeller.toFixed(2)}</p>
              {stats.shippingCollected > 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Termasuk caj pos: RM{stats.shippingCollected.toFixed(2)}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Jumlah Barang</CardTitle></CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-primary">RM{stats.totalItemsAmount.toFixed(2)}</p>
              <p className="mt-2 text-sm text-muted-foreground">Tidak termasuk caj pos.</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2">
            <Card className="h-full flex flex-col">
              <CardHeader><CardTitle>Pecahan Kategori</CardTitle></CardHeader>
              <CardContent className="flex-1 flex items-center justify-center">
                {stats.categoryBreakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={stats.categoryBreakdown} cx="50%" cy="50%" innerRadius={60} outerRadius={90} fill="#8884d8" paddingAngle={2} dataKey="value" nameKey="name">
                        {stats.categoryBreakdown.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, borderRadius: '0.5rem' }} itemStyle={{ color: tooltipTextColor }} />
                      <Legend iconType="circle" wrapperStyle={{ color: tickColor, fontSize: '12px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-muted-foreground text-center py-4">Tiada data.</p>}
              </CardContent>
            </Card>
          </div>
          <div className="lg:col-span-3">
            <Card className="h-full flex flex-col">
              <CardHeader><CardTitle>Pecahan Platform</CardTitle></CardHeader>
              <CardContent className="flex-1 flex items-center justify-center">
                {stats.platformBreakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                     <BarChart data={stats.platformBreakdown} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                      <XAxis dataKey="name" stroke={tickColor} tick={{ fill: tickColor, fontSize: 12 }} />
                      <YAxis stroke={tickColor} tick={{ fill: tickColor, fontSize: 12 }} allowDecimals={false} />
                      <Tooltip cursor={{ fill: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)' }} contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, borderRadius: '0.5rem' }} itemStyle={{ color: tooltipTextColor }} />
                      <Bar dataKey="value" name="Jumlah" barSize={30} radius={[4, 4, 0, 0]}>
                         {stats.platformBreakdown.map((entry, index) => <Cell key={`cell-${index}`} fill={defaultPlatformColors[index % defaultPlatformColors.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="text-muted-foreground text-center py-4">Tiada data.</p>}
              </CardContent>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Sejarah Pembelian</CardTitle>
            <Button variant="outline" onClick={exportToCSV} disabled={!client?.items || client.items.length === 0}>
              <Download className="w-4 h-4 mr-2" /> Eksport CSV
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-muted-foreground">
                    <th className="p-4 font-medium">Invois</th>
                    <th className="p-4 font-medium">Tarikh</th>
                    <th className="p-4 font-medium text-right">Jumlah Barang</th>
                  </tr>
                </thead>
                <tbody>
                  {currentPurchaseHistory.length > 0 ? (
                    currentPurchaseHistory.map((purchase) => (
                      <tr key={purchase.invoice_id} className="border-t relative group overflow-hidden">
                        <td className="p-4 font-semibold text-foreground flex items-center gap-3">
                           <div className="absolute left-0 top-0 h-full w-1 bg-primary scale-y-0 group-hover:scale-y-100 transition-transform origin-center duration-300" />
                           <div className="transition-transform duration-300 group-hover:translate-x-2">
                             {purchase.invoice_number || purchase.invoice_id}
                           </div>
                         </td>
                         <td className="p-4 text-muted-foreground">
                           {purchase.invoice_date ? new Date(purchase.invoice_date).toLocaleDateString() : '-'}
                         </td>
                         <td className="p-4 text-right font-semibold text-foreground">
                           RM{(parseFloat(purchase.items_amount) || 0).toFixed(2)}
                           {(parseFloat(purchase.shipping_collected) || 0) > 0 && (
                             <div className="mt-2 inline-flex rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                               Caj Pos RM{(parseFloat(purchase.shipping_collected) || 0).toFixed(2)}
                             </div>
                           )}
                           {(parseFloat(purchase.adjustment_total) || 0) > 0 && (
                             <p className="mt-1 text-xs font-medium text-red-600">
                               Price Adjustment (-RM{(parseFloat(purchase.adjustment_total) || 0).toFixed(2)})
                             </p>
                           )}
                           {(parseFloat(purchase.returned_total) || 0) > 0 && (
                             <p className="mt-1 text-xs font-medium text-rose-600">
                               Item Returned ({Math.round(parseFloat(purchase.returned_qty) || 0)} unit) -RM{(parseFloat(purchase.returned_total) || 0).toFixed(2)}
                             </p>
                           )}
                         </td>
                        </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="3" className="text-muted-foreground text-center py-8">Tiada rekod pembelian.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
          {totalPages > 1 && (
            <CardFooter className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Item per halaman:</span>
                <Select value={itemsPerPage} onChange={handleItemsPerPageChange} className="h-9">
                  <option value="10">10</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </Select>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground">
                  Halaman {currentPage} dari {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardFooter>
          )}
        </Card>
      </div>
      {showEditModal && (
        <ClientFormModal
          client={client}
          onSave={handleSaveClient}
          onCancel={() => setShowEditModal(false)}
        />
      )}
    </>
  );
};

export default ClientDetailPage;
