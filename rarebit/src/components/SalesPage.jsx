import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Calendar, ChevronLeft, ChevronRight, CheckCircle, XCircle, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';

const getInitialDateRange = () => {
  return {
    startDate: '',
    endDate: ''
  };
};

const SalesPage = ({ items }) => {
  const { toast } = useToast();
  const [dateRange, setDateRange] = useState(getInitialDateRange());
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const soldItems = useMemo(() => 
    items.filter(item => item.status === 'terjual' && item.date_sold), 
    [items]
  );

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
    const rows = filteredSoldItems.map(item => [
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
      
      <div className="px-6 py-4 bg-background rounded-2xl shadow-sm">
        <h2 className="text-lg font-semibold leading-none tracking-tight mb-4">Tapis Tarikh Jualan</h2>
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex-1">
            <label htmlFor="start-date" className="text-xs text-muted-foreground mb-1">Tarikh Mula</label>
            <Input id="start-date" type="date" value={dateRange.startDate} onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))} className="w-full bg-white rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" />
          </div>
          <div className="flex-1">
            <label htmlFor="end-date" className="text-xs text-muted-foreground mb-1">Tarikh Akhir</label>
            <Input id="end-date" type="date" value={dateRange.endDate} onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))} className="w-full bg-white rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" />
          </div>
          <Button variant="secondary" onClick={() => setDateRange({ startDate: '', endDate: '' })} className="h-10">Set Semula</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Hasil Jualan</CardTitle>
          <Button variant="outline" onClick={exportToCSV} disabled={!filteredSoldItems || filteredSoldItems.length === 0}>
            <Download className="w-4 h-4 mr-2" /> Eksport CSV
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-sm text-muted-foreground">
                  <th className="p-4 font-medium">Item</th>
                  <th className="p-4 font-medium">Tarikh</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium text-right">Harga Jualan</th>
                </tr>
              </thead>
              <tbody>
                {currentItems.map(item => {
                  const profit = (parseFloat(item.selling_price) || 0) - (parseFloat(item.cost_price) || 0);
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
                })}
              </tbody>
            </table>
          </div>
          {filteredSoldItems.length === 0 && (
            <p className="text-center text-muted-foreground p-8">Tiada jualan ditemui untuk julat tarikh ini.</p>
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