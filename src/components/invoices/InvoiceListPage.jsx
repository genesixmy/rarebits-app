import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useInvoices } from '@/hooks/useInvoices';
import { supabase } from '@/lib/customSupabaseClient';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronRight, Plus, Search, ChevronDown, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { ms } from 'date-fns/locale';

const ALLOWED_STATUS_FILTERS = new Set(['draft', 'finalized', 'paid', 'partially_returned', 'returned', 'cancelled']);
const EMPTY_SHIPMENT_META_MAP = new Map();
const COMPLETED_DELIVERY_STATUSES = new Set(['delivered', 'completed']);

const normalizeStatusFilter = (value) => (ALLOWED_STATUS_FILTERS.has(value) ? value : '');
const normalizeShippingStateFilter = (value) => (value === 'pending' ? 'pending' : '');
const normalizeRangeFilter = (value) => (value === 'this_week' ? 'this_week' : '');
const normalizeHasRefundFilter = (value) => (value === '1' ? '1' : '');
const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeDeliveryStatus = (value) => normalizeText(value).toLowerCase();
const toTimestamp = (value) => {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const getCurrentWeekDateWindow = () => {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return { start, end };
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

const isPendingShippingInvoice = (invoice, shipmentMetaById) => {
  if (!Boolean(invoice?.shipping_required)) return false;

  const shipmentMeta = invoice?.shipment_id ? shipmentMetaById.get(invoice.shipment_id) : null;
  const trackingNo = normalizeText(shipmentMeta?.trackingNo);
  const deliveryStatus = normalizeDeliveryStatus(shipmentMeta?.deliveryStatus);

  return trackingNo.length === 0 && !COMPLETED_DELIVERY_STATUSES.has(deliveryStatus);
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
  const rangeFilter = normalizeRangeFilter(searchParams.get('range'));
  const hasRefundFilter = normalizeHasRefundFilter(searchParams.get('has_refund'));
  const thisWeekWindow = useMemo(() => getCurrentWeekDateWindow(), []);

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

  const { data: shipmentMetaById = EMPTY_SHIPMENT_META_MAP, isLoading: isLoadingShipmentMeta } = useQuery({
    queryKey: ['invoice-list-shipment-statuses', userId, shipmentIds],
    queryFn: async () => {
      if (!userId || shipmentIds.length === 0) return new Map();

      const { data, error: shipmentError } = await supabase
        .from('shipments')
        .select('id, tracking_no, ship_status')
        .eq('user_id', userId)
        .in('id', shipmentIds);

      if (shipmentError) throw shipmentError;

      return new Map(
        (data || []).map((shipment) => [
          shipment.id,
          {
            trackingNo: shipment.tracking_no || '',
            deliveryStatus: shipment.ship_status || '',
          },
        ])
      );
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
        rangeFilter === 'this_week'
          ? (invoiceDate >= thisWeekWindow.start && invoiceDate <= thisWeekWindow.end)
          : (
            (!dateRange.start || invoiceDate >= new Date(dateRange.start)) &&
            (!dateRange.end || invoiceDate <= new Date(dateRange.end))
          );

      const adjustmentTotal = parseFloat(invoice?.adjustment_total) || 0;
      const returnedTotal = parseFloat(invoice?.returned_total) || 0;
      const matchesRefundFilter = hasRefundFilter !== '1'
        ? true
        : (adjustmentTotal > 0 || returnedTotal > 0);

      const matchesShippingState =
        shippingStateFilter !== 'pending'
          ? true
          : isPendingShippingInvoice(invoice, shipmentMetaById);

      return matchesSearch && matchesStatus && matchesDateRange && matchesShippingState && matchesRefundFilter;
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
  }, [
    invoices,
    searchTerm,
    statusFilter,
    sortBy,
    dateRange,
    shippingStateFilter,
    shipmentMetaById,
    rangeFilter,
    hasRefundFilter,
    thisWeekWindow,
  ]);

  const clearShippingStateFilter = () => {
    updateUrlFilters({ nextStatus: statusFilter, nextShippingState: '' });
  };

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
    (shippingStateFilter === 'pending' && shipmentIds.length > 0 && isLoadingShipmentMeta)
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
          <h1 className="page-title">Senarai Invois</h1>
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

      {shippingStateFilter === 'pending' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
            Penghantaran: Pending
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-amber-800 hover:bg-amber-100 hover:text-amber-900"
            onClick={clearShippingStateFilter}
          >
            Clear
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-4">
          {/* Search */}
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-500" />
            <Input
              placeholder="Cari nombor invois atau pembeli..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-10 w-full rounded-full border-cyan-300 bg-white pl-10 pr-4 font-medium text-cyan-700 placeholder:text-slate-400 focus-visible:ring-cyan-300"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Status Filter - Dropdown */}
            <div className="relative w-full">
              <Button
                variant="outline"
                size="default"
                onClick={() => {
                  const nextIsOpen = !showStatusDropdown;
                  setShowStatusDropdown(nextIsOpen);
                  if (nextIsOpen) setShowSortDropdown(false);
                }}
                className="h-10 w-full justify-between rounded-full border-cyan-300 bg-white px-4 font-medium text-cyan-700 hover:bg-cyan-50 hover:text-cyan-700"
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
                <ChevronDown className="h-5 w-5 text-cyan-600" />
              </Button>
              {showStatusDropdown && (
                <div className="absolute left-0 top-full z-10 mt-1 w-full overflow-hidden rounded-2xl border border-cyan-200 bg-white shadow-lg">
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
                        setShowSortDropdown(false);
                      }}
                      className={`block w-full px-4 py-2 text-left text-sm hover:bg-cyan-50 ${
                        statusFilter === option.value ? 'bg-cyan-50 font-medium text-cyan-700' : 'text-slate-700'
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
                onClick={() => {
                  const nextIsOpen = !showSortDropdown;
                  setShowSortDropdown(nextIsOpen);
                  if (nextIsOpen) setShowStatusDropdown(false);
                }}
                className="h-10 w-full justify-between rounded-full border-cyan-300 bg-white px-4 font-medium text-cyan-700 hover:bg-cyan-50 hover:text-cyan-700"
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
                <ChevronDown className="h-5 w-5 text-cyan-600" />
              </Button>
              {showSortDropdown && (
                <div className="absolute right-0 top-full z-10 mt-1 w-full overflow-hidden rounded-2xl border border-cyan-200 bg-white shadow-lg">
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
                        setShowStatusDropdown(false);
                      }}
                      className={`block w-full px-4 py-2 text-left text-sm hover:bg-cyan-50 ${
                        sortBy === option.value ? 'bg-cyan-50 font-medium text-cyan-700' : 'text-slate-700'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Date Range */}
        <div className="flex flex-col sm:flex-row gap-4 w-full">
          <Input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            placeholder="Dari Tarikh"
            className="h-10 flex-1 rounded-full border-cyan-300 bg-white px-4 font-medium text-cyan-700 focus-visible:ring-cyan-300"
          />
          <Input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            placeholder="Hingga Tarikh"
            className="h-10 flex-1 rounded-full border-cyan-300 bg-white px-4 font-medium text-cyan-700 focus-visible:ring-cyan-300"
          />
          <Button
            variant="outline"
            size="default"
            onClick={() => setDateRange({ start: '', end: '' })}
            className="h-10 w-full whitespace-nowrap rounded-full border-cyan-300 bg-white px-4 font-medium text-cyan-700 hover:bg-cyan-50 hover:text-cyan-700 sm:w-auto"
          >
            Kosongkan Tarikh
          </Button>
        </div>

        {(rangeFilter === 'this_week' || hasRefundFilter === '1') && (
          <div className="flex flex-col gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-indigo-800">
              Penapis aktif:
              {rangeFilter === 'this_week' ? ' Minggu ini.' : ''}
              {hasRefundFilter === '1' ? ' Ada refund/adjustment.' : ''}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-100"
              onClick={() => {
                const nextParams = new URLSearchParams(searchParams);
                nextParams.delete('range');
                nextParams.delete('has_refund');
                setSearchParams(nextParams, { replace: true });
              }}
            >
              Buang Penapis Ini
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
          <p className="mb-4 text-gray-600">
            {shippingStateFilter === 'pending'
              ? 'Tiada invois yang perlu dipos untuk tempoh ini.'
              : 'Tiada invois ditemui'}
          </p>
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
                className="group relative grid grid-cols-12 gap-4 px-4 py-4 cursor-pointer items-center overflow-hidden"
                onClick={() => handleViewInvoice(invoice.id)}
              >
                {/* Invoice Number & Client */}
                <div className="col-span-4 min-w-0 md:col-span-3">
                  <div className="absolute left-0 top-0 h-full w-1 bg-primary scale-y-0 transition-transform origin-center duration-300 group-hover:scale-y-100" />
                  <div className="transition-transform duration-300 group-hover:translate-x-2">
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
                  <ChevronRight className="h-4 w-4 text-gray-400 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-primary" />
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
