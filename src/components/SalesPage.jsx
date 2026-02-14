import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Calendar, ChevronLeft, ChevronRight, CheckCircle, XCircle, Download, FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';

const getInitialDateRange = () => {
  return {
    startDate: '',
    endDate: ''
  };
};

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
          item:items(id, name, category, cost_price),
          invoice:invoices(id, invoice_date, status, user_id)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[SalesPage] Error fetching invoice items:', error);
        return [];
      }

      // Filter by user_id after fetching (client-side filtering)
      const filteredData = (data || []).filter(invItem => invItem.invoice?.user_id === userId);
      
      return filteredData;
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
      .filter(invItem => invItem.invoice && invItem.invoice.status === 'paid')
      .map(invItem => ({
        id: invItem.id,
        name: (invItem.is_manual || !invItem.item_id)
          ? (invItem.item_name || 'Item Manual')
          : (invItem.item?.name || 'Item'),
        cost_price: getEffectiveUnitCost(invItem),
        category: (invItem.is_manual || !invItem.item_id) ? 'Manual' : (invItem.item?.category || 'Lain-lain'),
        selling_price: invItem.unit_price,
        quantity_sold: invItem.quantity,
        actual_sold_amount: invItem.line_total,
        date_sold: invItem.invoice.invoice_date,
        invoice_id: invItem.invoice_id,
        status: invItem.invoice.status,
      }));
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
                      <th className="p-4 font-medium text-right">Harga Jualan</th>
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
                      const profit = totalRevenue - totalCost;
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
                           <td className="p-4 text-right font-semibold text-foreground">RM{totalRevenue.toFixed(2)}</td>
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
