import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useInvoices } from '@/hooks/useInvoices';
import { supabase } from '@/lib/customSupabaseClient';
import { formatCurrency } from '@/lib/utils';
import { isDeliveryRequiredForInvoice } from '@/lib/shipping';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronRight, Plus, Search, ChevronDown, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { ms } from 'date-fns/locale';

const ALLOWED_STATUS_FILTERS = new Set(['draft', 'finalized', 'paid', 'partially_returned', 'returned', 'cancelled']);
const EMPTY_SHIPMENT_STATUS_MAP = new Map();

const normalizeStatusFilter = (value) => (ALLOWED_STATUS_FILTERS.has(value) ? value : '');
const normalizeShippingStateFilter = (value) => (value === 'pending' ? 'pending' : '');
const toTimestamp = (value) => {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const getDisplayInvoiceTotal = (invoice) => {
  const totalAmountRaw = parseFloat(invoice?.total_amount);
  const totalAmount = Number.isFinite(totalAmountRaw) && totalAmountRaw >= 0 ? totalAmountRaw : 0;

  const adjustmentRaw = parseFloat(invoice?.adjustment_total);
  const adjustmentTotal = Number.isFinite(adjustmentRaw) && adjustmentRaw > 0 ? adjustmentRaw : 0;

  const returnedRaw = parseFloat(invoice?.returned_total);
  const returnedTotal = Number.isFinite(returnedRaw) && returnedRaw > 0 ? returnedRaw : 0;

  const finalRaw = parseFloat(invoice?.final_total);
  if (Number.isFinite(finalRaw)) {
    return Math.max(Math.min(finalRaw, totalAmount), 0);
  }

  return Math.max(totalAmount - adjustmentTotal - returnedTotal, 0);
};

const InvoiceListPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('date-desc');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const statusFilter = normalizeStatusFilter(searchParams.get('status'));
  const shippingStateFilter = normalizeShippingStateFilter(searchParams.get('shipping_state'));

  // Get current user
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });
  const userId = authData?.session?.user?.id ?? null;

  // Fetch all invoices
  const { data: invoices = [], isLoading, error } = useInvoices({
    clientId: '',
    status: statusFilter || undefined,
  });

  const shipmentIds = useMemo(
    () => [...new Set(invoices.map((invoice) => invoice?.shipment_id).filter(Boolean))],
    [invoices]
  );

  const { data: shipmentStatusById = EMPTY_SHIPMENT_STATUS_MAP, isLoading: isLoadingShipmentStatuses } = useQuery({
    queryKey: ['invoice-list-shipment-statuses', userId, shipmentIds],
    queryFn: async () => {
      if (!userId || shipmentIds.length === 0) return new Map();

      const { data, error: shipmentError } = await supabase
        .from('shipments')
        .select('id, ship_status')
        .eq('user_id', userId)
        .in('id', shipmentIds);

      if (shipmentError) throw shipmentError;

      return new Map((data || []).map((shipment) => [shipment.id, shipment.ship_status]));
    },
    enabled: !!userId && shippingStateFilter === 'pending' && shipmentIds.length > 0,
    staleTime: 30 * 1000,
  });

  const updateUrlFilters = ({ nextStatus, nextShippingState }) => {
    const normalizedStatus = normalizeStatusFilter(nextStatus);
    const normalizedShippingState =
      normalizedStatus === 'paid' ? normalizeShippingStateFilter(nextShippingState) : '';
    const nextParams = new URLSearchParams(searchParams);

    if (normalizedStatus) {
      nextParams.set('status', normalizedStatus);
    } else {
      nextParams.delete('status');
    }

    if (normalizedShippingState) {
      nextParams.set('shipping_state', normalizedShippingState);
    } else {
      nextParams.delete('shipping_state');
    }

    setSearchParams(nextParams, { replace: true });
  };

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

      const matchesShippingState =
        shippingStateFilter !== 'pending'
          ? true
          : (() => {
              if (invoice.status !== 'paid') return false;
              if (!isDeliveryRequiredForInvoice(invoice)) return false;
              if (!invoice.shipment_id) return true;
              const shipStatus = shipmentStatusById.get(invoice.shipment_id);
              return !shipStatus || shipStatus === 'pending';
            })();

      return matchesSearch && matchesStatus && matchesDateRange && matchesShippingState;
    });

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date-desc': {
          const invoiceDateDiff = toTimestamp(b.invoice_date) - toTimestamp(a.invoice_date);
          if (invoiceDateDiff !== 0) return invoiceDateDiff;
          return toTimestamp(b.created_at) - toTimestamp(a.created_at);
        }
        case 'date-asc': {
          const invoiceDateDiff = toTimestamp(a.invoice_date) - toTimestamp(b.invoice_date);
          if (invoiceDateDiff !== 0) return invoiceDateDiff;
          return toTimestamp(a.created_at) - toTimestamp(b.created_at);
        }
        case 'amount-desc':
          return getDisplayInvoiceTotal(b) - getDisplayInvoiceTotal(a);
        case 'amount-asc':
          return getDisplayInvoiceTotal(a) - getDisplayInvoiceTotal(b);
        case 'buyer-asc':
          return (a.client?.name || '').localeCompare(b.client?.name || '');
        case 'buyer-desc':
          return (b.client?.name || '').localeCompare(a.client?.name || '');
        default:
          return 0;
      }
    });

    return filtered;
  }, [invoices, searchTerm, statusFilter, sortBy, dateRange, shippingStateFilter, shipmentStatusById]);

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
      partially_returned: 'bg-amber-100 text-amber-800',
      returned: 'bg-rose-100 text-rose-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    return statusColors[status] || 'bg-gray-100 text-gray-800';
  };

  if (
    isLoading ||
    (shippingStateFilter === 'pending' && shipmentIds.length > 0 && isLoadingShipmentStatuses)
  ) {
    return (
      <div className="p-6">
        <div className="text-center">Sedang memuatkan invois...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Senarai Invois</h1>
          <p className="mt-2 text-gray-600">Urus dan lihat semua invois anda</p>
        </div>
        <Button 
          onClick={handleCreateInvoice} 
          className="gap-2 h-11 px-6 py-2 flex-1 sm:flex-initial"
        >
          <Plus className="h-5 w-5" />
          <span>Buat Invois</span>
        </Button>
      </div>

      {/* Filters */}
      <div className="space-y-4 rounded-lg border bg-white p-4">
        <div className="grid grid-cols-1 gap-4">
          {/* Search */}
          <div className="relative w-full">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Cari nombor invois atau pembeli..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 w-full"
            />
          </div>

          {/* Status Filter - Dropdown */}
          <div className="relative w-full">
            <Button
              variant="outline"
              size="default"
              onClick={() => setShowStatusDropdown(!showStatusDropdown)}
              className="w-full justify-between h-10"
            >
              <span className="text-sm">
                {statusFilter === '' && 'Semua'}
                {statusFilter === 'draft' && 'Draf'}
                {statusFilter === 'finalized' && 'Muktamad'}
                {statusFilter === 'paid' && 'Dibayar'}
                {statusFilter === 'partially_returned' && 'Separa Pulang'}
                {statusFilter === 'returned' && 'Dipulangkan'}
                {statusFilter === 'cancelled' && 'Dibatalkan'}
              </span>
              <ChevronDown className="h-5 w-5" />
            </Button>
            {showStatusDropdown && (
              <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-lg border bg-white shadow-lg">
                {[
                  { value: '', label: 'Semua' },
                  { value: 'draft', label: 'Draf' },
                  { value: 'finalized', label: 'Muktamad' },
                  { value: 'paid', label: 'Dibayar' },
                  { value: 'partially_returned', label: 'Separa Pulang' },
                  { value: 'returned', label: 'Dipulangkan' },
                  { value: 'cancelled', label: 'Dibatalkan' },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      updateUrlFilters({
                        nextStatus: option.value,
                        nextShippingState: option.value === 'paid' ? shippingStateFilter : '',
                      });
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

          {/* Sort - Dropdown */}
          <div className="relative w-full">
            <Button
              variant="outline"
              size="default"
              onClick={() => setShowSortDropdown(!showSortDropdown)}
              className="w-full justify-between h-10"
            >
              <span className="text-sm">
                {[
                  { value: 'date-desc', label: 'Terbaru' },
                  { value: 'date-asc', label: 'Tertua' },
                  { value: 'amount-desc', label: 'Tertinggi' },
                  { value: 'amount-asc', label: 'Terendah' },
                  { value: 'buyer-asc', label: 'Pembeli A-Z' },
                  { value: 'buyer-desc', label: 'Pembeli Z-A' },
                ].find((opt) => opt.value === sortBy)?.label || 'Isihan'}
              </span>
              <ChevronDown className="h-5 w-5" />
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

        {/* Date Range */}
        <div className="flex flex-col sm:flex-row gap-4 w-full">
          <Input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            placeholder="Dari Tarikh"
            className="flex-1"
          />
          <Input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            placeholder="Hingga Tarikh"
            className="flex-1"
          />
          <Button
            variant="outline"
            size="default"
            onClick={() => setDateRange({ start: '', end: '' })}
            className="whitespace-nowrap w-full sm:w-auto h-10"
          >
            Kosongkan Tarikh
          </Button>
        </div>

        {shippingStateFilter === 'pending' && (
          <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-amber-800">
              Penapis aktif: invois dibayar yang masih menunggu penghantaran.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-amber-800 hover:bg-amber-100 hover:text-amber-900"
              onClick={() => updateUrlFilters({ nextStatus: statusFilter, nextShippingState: '' })}
            >
              Buang Penapis Penghantaran
            </Button>
          </div>
        )}
      </div>

      {/* Results Info */}
      <div className="text-sm text-gray-600">
        Menunjukkan {filteredInvoices.length} dari {invoices.length} invois
      </div>

      {/* Invoices List */}
      {filteredInvoices.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-white p-8 text-center">
          <p className="mb-4 text-gray-600">Tiada invois ditemui</p>
          <Button 
            onClick={handleCreateInvoice} 
            variant="default"
            size="default"
            className="h-10 px-6"
          >
            Buat Invois Pertama Anda
          </Button>
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
                <div className="col-span-4 min-w-0 md:col-span-3">
                  <p className="font-medium text-sm break-words">
                    {invoice.refunds && invoice.refunds.length > 0 && (
                      <span
                        aria-hidden="true"
                        className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-500 align-middle"
                      />
                    )}
                    {invoice.invoice_number}
                  </p>
                  <p className="text-xs text-gray-600 break-words">{invoice.client?.name || '-'}</p>
                  <p className="text-[11px] leading-tight text-gray-500 break-all md:hidden">
                    {invoice.client?.email || '-'}
                  </p>
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
                    {formatCurrency(getDisplayInvoiceTotal(invoice))}
                  </p>
                </div>

                {/* Status & Adjustment Badge */}
                <div className="col-span-3 md:col-span-2 text-right flex flex-col gap-1 items-end">
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${getStatusBadgeColor(invoice.status)}`}>
                    {invoice.status === 'draft' && 'Draf'}
                    {invoice.status === 'finalized' && 'Muktamad'}
                    {invoice.status === 'paid' && 'Dibayar'}
                    {invoice.status === 'partially_returned' && 'Separa Pulang'}
                    {invoice.status === 'returned' && 'Dipulangkan'}
                    {invoice.status === 'cancelled' && 'Dibatalkan'}
                  </span>
                  {invoice.refunds && invoice.refunds.length > 0 && (
                    <span className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                      <AlertCircle className="h-3 w-3" />
                      <span>{invoice.refunds.length}</span>
                      <span className="hidden md:inline">Adjustment{invoice.refunds.length !== 1 ? 's' : ''}</span>
                    </span>
                  )}
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
