import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Calendar, ChevronLeft, ChevronRight, CheckCircle, XCircle, Download, FileText, Loader2, Wallet, Truck, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import { COURIER_PAYMENT_MODES, resolveCourierPaymentModeForInvoice } from '@/lib/shipping';

const getInitialDateRange = () => {
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const formatDate = (date) => {
    const d = new Date(date);
    let month = '' + (d.getMonth() + 1);
    let day = '' + d.getDate();
    const year = d.getFullYear();

    if (month.length < 2) month = `0${month}`;
    if (day.length < 2) day = `0${day}`;

    return [year, month, day].join('-');
  };

  return {
    startDate: formatDate(firstDayOfMonth),
    endDate: formatDate(today),
  };
};

const SETTLED_INVOICE_STATUSES = new Set(['paid', 'partially_returned', 'returned']);

const SalesPage = ({ items }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [dateRange, setDateRange] = useState(getInitialDateRange());
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Get current user
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  const userId = authData?.session?.user?.id;

  // Fetch all invoice items (sales records)
  const { data: invoiceItems = [], isLoading } = useQuery({
    queryKey: ['invoice-items', userId],
    queryFn: async () => {
      if (!userId) return [];

      const { data, error } = await supabase
        .from('invoice_items')
        .select(`
          id,
          invoice_id,
          item_id,
          quantity,
          unit_price,
          cost_price,
          line_total,
          is_manual,
          item_name,
          invoice_item_returns(returned_quantity, refund_amount),
          item:items(id, name, category, cost_price),
          invoice:invoices(id, invoice_date, status, user_id, shipping_charged, shipment_id, channel_fee_amount, courier_payment_mode, adjustment_total)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[SalesPage] Error fetching invoice items:', error);
        return [];
      }

      // Filter by user_id after fetching (client-side filtering)
      const filteredData = (data || []).filter(invItem => invItem.invoice?.user_id === userId);

      const shipmentIds = [...new Set(
        filteredData
          .map((row) => row?.invoice?.shipment_id)
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
          console.error('[SalesPage] Error fetching shipments:', shipmentError);
        } else {
          (shipmentRows || []).forEach((shipment) => {
            shipmentById.set(shipment.id, shipment);
          });
        }
      }

      return filteredData.map((row) => ({
        ...row,
        invoice: {
          ...row.invoice,
          shipment: row?.invoice?.shipment_id
            ? (shipmentById.get(row.invoice.shipment_id) || null)
            : null,
        },
      }));
    },
    enabled: !!userId,
  });

  // Transform invoice items to sales records format
  const soldItems = useMemo(() => {
    const getEffectiveUnitCost = (invItem) => {
      const isManual = invItem.is_manual || !invItem.item_id;
      const snapshotUnitCost = parseFloat(invItem.cost_price);
      const fallbackItemUnitCost = parseFloat(invItem.item?.cost_price);

      const hasSnapshotCost = Number.isFinite(snapshotUnitCost) && snapshotUnitCost > 0;
      if (hasSnapshotCost) return snapshotUnitCost;

      if (!isManual && Number.isFinite(fallbackItemUnitCost) && fallbackItemUnitCost >= 0) {
        return fallbackItemUnitCost;
      }

      if (Number.isFinite(snapshotUnitCost) && snapshotUnitCost >= 0) {
        return snapshotUnitCost;
      }

      return 0;
    };

    return invoiceItems
      .filter(invItem => invItem.invoice && SETTLED_INVOICE_STATUSES.has(invItem.invoice.status))
      .map(invItem => {
        const returnEntries = Array.isArray(invItem.invoice_item_returns) ? invItem.invoice_item_returns : [];
        const returnedQty = returnEntries.reduce((sum, entry) => (
          sum + Math.max(parseFloat(entry?.returned_quantity) || 0, 0)
        ), 0);
        const returnedRefund = returnEntries.reduce((sum, entry) => (
          sum + Math.max(parseFloat(entry?.refund_amount) || 0, 0)
        ), 0);

        const baseQty = Math.max(parseFloat(invItem.quantity) || 0, 0);
        const netQty = Math.max(baseQty - returnedQty, 0);
        const baseRevenue = parseFloat(invItem.line_total) || 0;
        const netRevenue = baseRevenue - returnedRefund;

        return ({
          id: invItem.id,
          name: (invItem.is_manual || !invItem.item_id)
            ? (invItem.item_name || 'Item Manual')
            : (invItem.item?.name || 'Item'),
          cost_price: getEffectiveUnitCost(invItem),
          category: (invItem.is_manual || !invItem.item_id) ? 'Manual' : (invItem.item?.category || 'Lain-lain'),
          selling_price: invItem.unit_price,
          quantity_sold: netQty,
          actual_sold_amount: netRevenue,
          date_sold: invItem.invoice.invoice_date,
          invoice_id: invItem.invoice_id,
          status: invItem.invoice.status,
          invoice_shipping_charged: Math.max(parseFloat(invItem.invoice?.shipping_charged) || 0, 0),
          invoice_shipping_cost: Math.max(parseFloat(invItem.invoice?.shipment?.shipping_cost) || 0, 0),
          invoice_shipping_cost_recorded: Boolean(invItem.invoice?.shipment?.courier_paid),
          invoice_channel_fee: Math.max(parseFloat(invItem.invoice?.channel_fee_amount) || 0, 0),
          invoice_courier_payment_mode: resolveCourierPaymentModeForInvoice(invItem.invoice),
          invoice_adjustment_total: Math.max(parseFloat(invItem.invoice?.adjustment_total) || 0, 0),
        });
      })
      .filter((row) => row.quantity_sold > 0 || Math.abs(row.actual_sold_amount) > 0.0001);
  }, [invoiceItems]);

  const filteredSoldItems = useMemo(() => {
    let filtered = soldItems;
    if (dateRange.startDate && dateRange.endDate) {
      const start = new Date(dateRange.startDate);
      const end = new Date(dateRange.endDate);
      end.setHours(23, 59, 59, 999);

      filtered = soldItems.filter(item => {
        const soldDate = new Date(item.date_sold);
        return soldDate >= start && soldDate <= end;
      });
    }
    return filtered.sort((a, b) => new Date(b.date_sold) - new Date(a.date_sold));
  }, [soldItems, dateRange]);

  const revenueByInvoice = useMemo(() => {
    return filteredSoldItems.reduce((acc, item) => {
      if (!item.invoice_id) return acc;
      const revenue = item.actual_sold_amount
        ? parseFloat(item.actual_sold_amount)
        : (parseFloat(item.selling_price) || 0) * (item.quantity_sold || item.invoice_quantity || 1);
      acc.set(item.invoice_id, (acc.get(item.invoice_id) || 0) + (Number.isFinite(revenue) ? revenue : 0));
      return acc;
    }, new Map());
  }, [filteredSoldItems]);

  const salesSummary = useMemo(() => {
    const shippingByInvoice = new Map();
    const channelFeeByInvoice = new Map();
    const adjustmentByInvoice = new Map();
    let revenueItem = 0;
    let itemProfit = 0;

    filteredSoldItems.forEach((item) => {
      const quantitySold = item.quantity_sold || item.invoice_quantity || 1;
      const costPrice = parseFloat(item.cost_price) || 0;
      const totalCost = costPrice * quantitySold;
      const totalRevenue = item.actual_sold_amount
        ? parseFloat(item.actual_sold_amount)
        : (parseFloat(item.selling_price) || 0) * quantitySold;

      revenueItem += totalRevenue;
      itemProfit += totalRevenue - totalCost;

      if (item.invoice_id && !shippingByInvoice.has(item.invoice_id)) {
        const isPlatformMode = item.invoice_courier_payment_mode === COURIER_PAYMENT_MODES.PLATFORM;
        shippingByInvoice.set(item.invoice_id, {
          charged: isPlatformMode ? 0 : Math.max(parseFloat(item.invoice_shipping_charged) || 0, 0),
          cost: isPlatformMode ? 0 : Math.max(parseFloat(item.invoice_shipping_cost) || 0, 0),
          costRecorded: isPlatformMode ? true : Boolean(item.invoice_shipping_cost_recorded),
        });
      }

      if (item.invoice_id && !channelFeeByInvoice.has(item.invoice_id)) {
        channelFeeByInvoice.set(item.invoice_id, Math.max(parseFloat(item.invoice_channel_fee) || 0, 0));
      }

      if (item.invoice_id && !adjustmentByInvoice.has(item.invoice_id)) {
        adjustmentByInvoice.set(item.invoice_id, Math.max(parseFloat(item.invoice_adjustment_total) || 0, 0));
      }
    });

    const shippingCollected = Array.from(shippingByInvoice.values()).reduce((sum, value) => sum + value.charged, 0);
    const shippingCost = Array.from(shippingByInvoice.values()).reduce(
      (sum, value) => sum + (value.costRecorded ? value.cost : 0),
      0
    );
    const shippingProfit = shippingCollected - shippingCost;
    const shippingPending = Array.from(shippingByInvoice.values()).filter(
      (value) => value.charged > 0 && !value.costRecorded
    ).length;
    const totalChannelFees = Array.from(channelFeeByInvoice.values()).reduce((sum, fee) => sum + fee, 0);
    const totalAdjustments = Array.from(adjustmentByInvoice.values()).reduce((sum, amount) => sum + amount, 0);

    return {
      revenueItem: Math.max(revenueItem - totalAdjustments, 0),
      shippingCollected,
      shippingCost,
      shippingProfit,
      totalChannelFees,
      totalAdjustments,
      netProfit: itemProfit - totalChannelFees + shippingProfit - totalAdjustments,
      shippingPending,
      itemProfit,
    };
  }, [filteredSoldItems]);

  const totalPages = Math.ceil(filteredSoldItems.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredSoldItems.slice(indexOfFirstItem, indexOfLastItem);

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleItemsPerPageChange = (e) => {
    setItemsPerPage(Number(e.target.value));
    setCurrentPage(1);
  };

  const exportToCSV = () => {
    if (!filteredSoldItems || filteredSoldItems.length === 0) {
      toast({ title: "Tiada data untuk dieksport", variant: "destructive" });
      return;
    }
    const headers = ['Tarikh Jual', 'Nama Item', 'Harga Jual (RM)', 'Platform', 'Kategori'];
    const rows = filteredSoldItems.map(item => {
      const actualRevenue = parseFloat(item.actual_sold_amount) || parseFloat(item.selling_price) || 0;
      return [
        item.date_sold,
        `"${item.name.replace(/"/g, '""')}"`,
        actualRevenue.toFixed(2),
        `"${(item.sold_platforms || []).join(', ')}"`,
        `"${item.category}"`
      ];
    });

    let csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `senarai_jualan.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "Senarai jualan berjaya dieksport." });
  };

  return (
    <motion.div 
      className="space-y-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <h1 className="page-title">Senarai Jualan</h1>
      
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Tapis Tarikh Jualan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 w-full">
            <div className="flex-1">
              <label htmlFor="start-date" className="block text-xs font-medium text-muted-foreground mb-2">Tarikh Mula</label>
              <Input id="start-date" type="date" value={dateRange.startDate} onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))} className="w-full h-10" />
            </div>
            <div className="flex-1">
              <label htmlFor="end-date" className="block text-xs font-medium text-muted-foreground mb-2">Tarikh Akhir</label>
              <Input id="end-date" type="date" value={dateRange.endDate} onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))} className="w-full h-10" />
            </div>
            <div className="flex items-end">
              <Button 
                variant="outline"
                size="default"
                onClick={() => setDateRange({ startDate: '', endDate: '' })} 
                className="whitespace-nowrap w-full sm:w-auto h-10"
              >
                Tetapkan Semula
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100">
                <Wallet className="h-4 w-4 text-emerald-600" />
              </span>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Revenue Item</p>
                <p className="text-lg font-semibold">RM{salesSummary.revenueItem.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-sky-100">
                <Truck className="h-4 w-4 text-sky-600" />
              </span>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Caj Pos Dikutip</p>
                <p className="text-lg font-semibold">RM{salesSummary.shippingCollected.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-100">
                <Truck className="h-4 w-4 text-amber-600" />
              </span>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Kos Pos</p>
                <p className="text-lg font-semibold">RM{salesSummary.shippingCost.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-100">
                <Truck className="h-4 w-4 text-amber-600" />
              </span>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Untung Pos</p>
                <p className="text-lg font-semibold">RM{salesSummary.shippingProfit.toFixed(2)}</p>
                {salesSummary.shippingPending > 0 && (
                  <p className="text-[11px] text-muted-foreground">{salesSummary.shippingPending} belum final</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-violet-100">
                <TrendingUp className="h-4 w-4 text-violet-600" />
              </span>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Untung Bersih</p>
                <p className="text-lg font-semibold">RM{salesSummary.netProfit.toFixed(2)}</p>
                <p className="text-[11px] text-muted-foreground">
                  Item RM{salesSummary.itemProfit.toFixed(2)} | Fee RM{salesSummary.totalChannelFees.toFixed(2)} | Pelarasan RM{salesSummary.totalAdjustments.toFixed(2)} | Pos RM{salesSummary.shippingProfit.toFixed(2)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <CardTitle>Hasil Jualan</CardTitle>
          <Button 
            variant="outline" 
            size="default"
            onClick={exportToCSV} 
            disabled={!filteredSoldItems || filteredSoldItems.length === 0}
            className="gap-2 h-10 flex-1 sm:flex-initial"
          >
            <Download className="w-5 h-5" /> 
            <span>Eksport CSV</span>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : (
            <div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-sm text-muted-foreground">
                      <th className="p-4 font-medium">Item</th>
                      <th className="p-4 font-medium">Tarikh</th>
                      <th className="p-4 font-medium">Status</th>
                      <th className="p-4 font-medium">Invois</th>
                      <th className="p-4 font-medium text-right">Item Total</th>
                      <th className="p-4 font-medium text-right">Pos (Caj/Kos)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentItems.map(item => {
                      const quantitySold = item.quantity_sold || item.invoice_quantity || 1;
                      const costPrice = parseFloat(item.cost_price) || 0;
                      const totalCost = costPrice * quantitySold;
                      // If actual_sold_amount exists, it's already the total for all units
                      // If not, multiply selling_price by quantity
                      const totalRevenue = item.actual_sold_amount ? parseFloat(item.actual_sold_amount) : (parseFloat(item.selling_price) || 0) * quantitySold;
                      const invoiceRevenue = item.invoice_id ? (revenueByInvoice.get(item.invoice_id) || 0) : 0;
                      const invoiceChannelFee = Math.max(parseFloat(item.invoice_channel_fee) || 0, 0);
                      const invoiceAdjustment = Math.max(parseFloat(item.invoice_adjustment_total) || 0, 0);
                      const channelFeeShare = invoiceRevenue > 0
                        ? (totalRevenue / invoiceRevenue) * invoiceChannelFee
                        : 0;
                      const shippingCharged = Math.max(parseFloat(item.invoice_shipping_charged) || 0, 0);
                      const isPlatformMode = item.invoice_courier_payment_mode === COURIER_PAYMENT_MODES.PLATFORM;
                      const shippingCostPaid = item.invoice_shipping_cost_recorded
                        ? Math.max(parseFloat(item.invoice_shipping_cost) || 0, 0)
                        : 0;
                      const effectiveShippingCharged = isPlatformMode ? 0 : shippingCharged;
                      const effectiveShippingCostPaid = isPlatformMode ? 0 : shippingCostPaid;
                      const shippingChargedShare = invoiceRevenue > 0
                        ? (totalRevenue / invoiceRevenue) * effectiveShippingCharged
                        : 0;
                      const shippingCostShare = invoiceRevenue > 0
                        ? (totalRevenue / invoiceRevenue) * effectiveShippingCostPaid
                        : 0;
                      const shippingProfitShare = shippingChargedShare - shippingCostShare;
                      const adjustmentShare = invoiceRevenue > 0
                        ? (totalRevenue / invoiceRevenue) * invoiceAdjustment
                        : 0;
                      const netRevenueAfterAdjustment = totalRevenue - adjustmentShare;
                      const profit = netRevenueAfterAdjustment - totalCost - channelFeeShare + shippingProfitShare;
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
                           <td className="p-4">
                             {item.invoice_id ? (
                               <Button
                                 size="sm"
                                 variant="outline"
                                 onClick={() => navigate(`/invoices/${item.invoice_id}`)}
                                 className="gap-2"
                               >
                                 <FileText className="w-4 h-4" />
                                 Lihat
                               </Button>
                             ) : (
                               <span className="text-muted-foreground text-xs">-</span>
                             )}
                           </td>
                          <td className="p-4 text-right font-semibold text-foreground">RM{netRevenueAfterAdjustment.toFixed(2)}</td>
                           <td className="p-4 text-right text-xs text-muted-foreground">
                             <div>Caj RM{effectiveShippingCharged.toFixed(2)}</div>
                             <div>Kos RM{effectiveShippingCostPaid.toFixed(2)}</div>
                           </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filteredSoldItems.length === 0 && (
                <p className="text-center text-muted-foreground p-8">Tiada jualan ditemui untuk julat tarikh ini.</p>
              )}
            </div>
          )}
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
    </motion.div>
  );
};

export default SalesPage;
