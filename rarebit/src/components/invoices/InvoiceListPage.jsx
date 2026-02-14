import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useInvoices } from '@/hooks/useInvoices';
import { supabase } from '@/lib/customSupabaseClient';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronRight, Plus, Search, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { ms } from 'date-fns/locale';

const InvoiceListPage = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('date-desc');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);

  // Get current user
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  // Fetch all invoices
  const { data: invoices = [], isLoading, error } = useInvoices({
    clientId: '',
    status: statusFilter || undefined,
  });

  // Filter and sort invoices
  const filteredInvoices = useMemo(() => {
    let filtered = invoices.filter((invoice) => {
      const matchesSearch =
        invoice.invoice_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoice.client?.name?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = !statusFilter || invoice.status === statusFilter;

      const invoiceDate = new Date(invoice.invoice_date);
      const matchesDateRange =
        (!dateRange.start || invoiceDate >= new Date(dateRange.start)) &&
        (!dateRange.end || invoiceDate <= new Date(dateRange.end));

      return matchesSearch && matchesStatus && matchesDateRange;
    });

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date-desc':
          return new Date(b.invoice_date) - new Date(a.invoice_date);
        case 'date-asc':
          return new Date(a.invoice_date) - new Date(b.invoice_date);
        case 'amount-desc':
          return b.total_amount - a.total_amount;
        case 'amount-asc':
          return a.total_amount - b.total_amount;
        case 'buyer-asc':
          return (a.client?.name || '').localeCompare(b.client?.name || '');
        case 'buyer-desc':
          return (b.client?.name || '').localeCompare(a.client?.name || '');
        default:
          return 0;
      }
    });

    return filtered;
  }, [invoices, searchTerm, statusFilter, sortBy, dateRange]);

  const handleCreateInvoice = () => {
    navigate('/invoices/create');
  };

  const handleViewInvoice = (invoiceId) => {
    navigate(`/invoices/${invoiceId}`);
  };

  const getStatusBadgeColor = (status) => {
    const statusColors = {
      draft: 'bg-gray-100 text-gray-800',
      finalized: 'bg-blue-100 text-blue-800',
      paid: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    return statusColors[status] || 'bg-gray-100 text-gray-800';
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="text-center">Sedang memuatkan invois...</div>
      </div>
    );
  }

  return (
    <div style={{width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1.5rem'}}>
      {/* Header */}
      <div style={{display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', width: '100%', boxSizing: 'border-box'}}>
        <div style={{flex: 1}}>
          <h1 className="text-3xl font-bold">Senarai Invois</h1>
          <p className="mt-2 text-gray-600">Urus dan lihat semua invois anda</p>
        </div>
        <div style={{whiteSpace: 'nowrap'}}>
          <Button onClick={handleCreateInvoice} size="sm" style={{display: 'flex', gap: '0.5rem'}}>
            <Plus className="h-4 w-4" />
            Invois
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div style={{width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '0.75rem', borderRadius: '0.5rem', border: '1px solid var(--border)', backgroundColor: 'white', padding: '1rem'}}>
        {/* Search */}
        <div className="relative" style={{width: '100%', boxSizing: 'border-box'}}>
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Cari nombor invois atau pembeli..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            style={{width: '100%', boxSizing: 'border-box'}}
          />
        </div>

        {/* Status Filter - Dropdown */}
        <div style={{position: 'relative', width: '100%', boxSizing: 'border-box', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0}}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowStatusDropdown(!showStatusDropdown)}
            className="w-full"
            style={{display: 'flex', width: '100%', boxSizing: 'border-box', minWidth: 0, justifyContent: 'space-between', padding: '0.5rem 0.75rem'}}
          >
            <span className="text-xs">
              {statusFilter === '' && 'Semua'}
              {statusFilter === 'draft' && 'Draf'}
              {statusFilter === 'finalized' && 'Muktamad'}
              {statusFilter === 'paid' && 'Dibayar'}
              {statusFilter === 'cancelled' && 'Dibatalkan'}
            </span>
            <ChevronDown className="h-4 w-4" />
          </Button>
          {showStatusDropdown && (
            <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-lg border bg-white shadow-lg">
              {[
                { value: '', label: 'Semua' },
                { value: 'draft', label: 'Draf' },
                { value: 'finalized', label: 'Muktamad' },
                { value: 'paid', label: 'Dibayar' },
                { value: 'cancelled', label: 'Dibatalkan' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setStatusFilter(option.value);
                    setShowStatusDropdown(false);
                  }}
                  className={`block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 first:rounded-t-lg last:rounded-b-lg ${
                    statusFilter === option.value ? 'bg-blue-50 font-medium text-blue-600' : ''
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Date Range */}
        <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%', boxSizing: 'border-box', minWidth: 0}} className="md:flex-row md:items-center">
          <div style={{flex: 1, width: '100%', boxSizing: 'border-box'}}>
            <Input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              placeholder="Dari Tarikh"
              style={{width: '100%', boxSizing: 'border-box'}}
            />
          </div>
          <div style={{flex: 1, width: '100%', boxSizing: 'border-box'}}>
            <Input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              placeholder="Hingga Tarikh"
              style={{width: '100%', boxSizing: 'border-box'}}
            />
          </div>
          
          {/* Clear Date Button */}
          <div style={{position: 'relative', flex: 1, boxSizing: 'border-box', minWidth: 0, width: '100%', display: 'flex'}}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDateRange({ start: '', end: '' })}
              className="w-full"
              style={{display: 'flex', width: '100%', boxSizing: 'border-box', minWidth: 0, whiteSpace: 'nowrap', justifyContent: 'center', padding: '0.5rem 0.75rem'}}
            >
              Kosongkan Tarikh
            </Button>
          </div>
        </div>
        
        {/* Sort Row */}
        <div style={{position: 'relative', width: '100%', boxSizing: 'border-box', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0}}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSortDropdown(!showSortDropdown)}
            className="w-full"
            style={{display: 'flex', width: '100%', boxSizing: 'border-box', minWidth: 0, justifyContent: 'space-between', padding: '0.5rem 0.75rem'}}
          >
            <span className="text-xs">
              {[
                { value: 'date-desc', label: 'Terbaru' },
                { value: 'date-asc', label: 'Tertua' },
                { value: 'amount-desc', label: 'Tertinggi' },
                { value: 'amount-asc', label: 'Terendah' },
                { value: 'buyer-asc', label: 'Pembeli A-Z' },
                { value: 'buyer-desc', label: 'Pembeli Z-A' },
              ].find((opt) => opt.value === sortBy)?.label || 'Isihan'}
            </span>
            <ChevronDown className="h-4 w-4" />
          </Button>
          {showSortDropdown && (
            <div className="absolute right-0 top-full z-10 mt-1 w-full rounded-lg border bg-white shadow-lg">
              {[
                { value: 'date-desc', label: 'Terbaru' },
                { value: 'date-asc', label: 'Tertua' },
                { value: 'amount-desc', label: 'Tertinggi' },
                { value: 'amount-asc', label: 'Terendah' },
                { value: 'buyer-asc', label: 'Pembeli A-Z' },
                { value: 'buyer-desc', label: 'Pembeli Z-A' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setSortBy(option.value);
                    setShowSortDropdown(false);
                  }}
                  className={`block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 first:rounded-t-lg last:rounded-b-lg ${
                    sortBy === option.value ? 'bg-blue-50 font-medium text-blue-600' : ''
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Results Info */}
      <div className="text-sm text-gray-600">
        Menunjukkan {filteredInvoices.length} dari {invoices.length} invois
      </div>

      {/* Invoices List */}
      {filteredInvoices.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-white p-8 text-center">
          <p className="mb-4 text-gray-600">Tiada invois ditemui</p>
          <div className="flex justify-center">
            <Button onClick={handleCreateInvoice} variant="outline" style={{display: 'flex'}}>
              Buat Invois Pertama Anda
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-white overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-4 bg-gray-50 px-4 py-3 border-b text-xs font-medium text-gray-700">
            <div className="col-span-4 md:col-span-3">Nombor Invois</div>
            <div className="col-span-0 md:col-span-2 hidden md:block">Tarikh</div>
            <div className="col-span-0 lg:col-span-2 hidden lg:block">Item</div>
            <div className="col-span-4 md:col-span-2 text-right">Jumlah</div>
            <div className="col-span-3 md:col-span-2 text-right">Status</div>
            <div className="col-span-1 text-right"></div>
          </div>

          {/* Table Rows */}
          <div className="divide-y">
            {filteredInvoices.map((invoice) => (
              <div
                key={invoice.id}
                className="grid grid-cols-12 gap-4 px-4 py-4 cursor-pointer items-center hover:bg-gray-50 transition-colors"
                onClick={() => handleViewInvoice(invoice.id)}
              >
                {/* Invoice Number & Client */}
                <div className="col-span-4 md:col-span-3">
                  <p className="font-medium text-sm">{invoice.invoice_number}</p>
                  <p className="text-xs text-gray-600">{invoice.client?.name || '-'}</p>
                </div>

                {/* Date */}
                <div className="col-span-0 md:col-span-2 hidden md:block">
                  <p className="text-sm text-gray-600">
                    {format(new Date(invoice.invoice_date), 'dd MMM yyyy', {
                      locale: ms,
                    })}
                  </p>
                </div>

                {/* Item Count */}
                <div className="col-span-0 lg:col-span-2 hidden lg:block">
                  <p className="text-sm text-gray-600">
                    {invoice.invoice_items?.length || 0} item{(invoice.invoice_items?.length || 0) !== 1 ? 's' : ''}
                  </p>
                </div>

                {/* Amount */}
                <div className="col-span-4 md:col-span-2 text-right">
                  <p className="font-semibold text-sm">
                    {formatCurrency(invoice.total_amount)}
                  </p>
                </div>

                {/* Status */}
                <div className="col-span-3 md:col-span-2 text-right">
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${getStatusBadgeColor(invoice.status)}`}>
                    {invoice.status === 'draft' && 'Draf'}
                    {invoice.status === 'finalized' && 'Muktamad'}
                    {invoice.status === 'paid' && 'Dibayar'}
                    {invoice.status === 'cancelled' && 'Dibatalkan'}
                  </span>
                </div>

                {/* Chevron */}
                <div className="col-span-1 text-right">
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoiceListPage;
