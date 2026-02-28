import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import {
  useInvoiceDetail,
  useCreateInvoice,
  useAddItemToInvoice,
  useRemoveItemFromInvoice,
} from '@/hooks/useInvoices';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Trash2, Plus, X, ChevronLeft } from 'lucide-react';
import { format } from 'date-fns';
import { ms } from 'date-fns/locale';
import toast from 'react-hot-toast';

const InvoiceFormPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { invoiceId } = useParams();
  const [selectedClientId, setSelectedClientId] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedItems, setSelectedItems] = useState([]);
  const [manualItems, setManualItems] = useState([]);
  const [showItemSelector, setShowItemSelector] = useState(false);
  const [showManualItemForm, setShowManualItemForm] = useState(false);
  const [manualItemName, setManualItemName] = useState('');
  const [manualItemPrice, setManualItemPrice] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [initialItemLoaded, setInitialItemLoaded] = useState(false);

  // Get current user
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  const userId = authData?.session?.user?.id;

  // Fetch clients
  const { data: clients = [] } = useQuery({
    queryKey: ['clients', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, email')
        .eq('user_id', userId)
        .order('name');

      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
  });

  // Fetch the specific item from navigation state (if navigating from inventory)
  const itemIdFromState = location.state?.itemId;
  console.log('[InvoiceFormPage] itemIdFromState:', itemIdFromState);

  const { data: itemFromState, isLoading: isLoadingItem, error: itemError } = useQuery({
    queryKey: ['item-detail', itemIdFromState],
    queryFn: async () => {
      console.log('[InvoiceFormPage] Fetching item:', itemIdFromState);
      const { data, error } = await supabase
        .from('items')
        .select('*, client:clients(id, name)')
        .eq('id', itemIdFromState)
        .single();

      if (error) {
        console.error('[InvoiceFormPage] Error fetching item:', error);
        throw error;
      }

      console.log('[InvoiceFormPage] Item fetched successfully:', data);
      return data;
    },
    enabled: !!itemIdFromState,
  });

  // Fetch available items (not invoiced yet and not sold)
  const { data: uninvoicedItems = [] } = useQuery({
    queryKey: ['available-items', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select('*, client:clients(id, name)')
        .eq('user_id', userId)
        .is('invoice_id', null)
        .neq('status', 'terjual')
        .order('created_at', { ascending: false });

      console.log('[InvoiceFormPage] Available items query result:', { data, error, count: data?.length });
      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
    staleTime: 0,
    cacheTime: 0,
  });

  // Fetch existing invoice if editing
  const { data: existingInvoice } = useInvoiceDetail(invoiceId);

  // Initialize form with existing invoice data
  useEffect(() => {
    if (existingInvoice) {
      setSelectedClientId(existingInvoice.client_id);
      setNotes(existingInvoice.notes || '');
      setSelectedItems(
        existingInvoice.invoice_items?.map((ii) => ({
          ...ii.item,
          invoice_item_id: ii.id,
          unit_price: ii.unit_price,
          quantity: ii.quantity,
          line_total: ii.line_total,
        })) || []
      );
    }
  }, [existingInvoice]);

  // Initialize form with item from navigation state (from inventory)
  useEffect(() => {
    console.log('[InvoiceFormPage] Effect running - itemFromState:', itemFromState, 'initialItemLoaded:', initialItemLoaded, 'invoiceId:', invoiceId);

    if (itemFromState && !initialItemLoaded && !invoiceId) {
      console.log('[InvoiceFormPage] Setting up item, itemFromState data:', {
        id: itemFromState.id,
        name: itemFromState.name,
        status: itemFromState.status,
        client_id: itemFromState.client_id,
        selling_price: itemFromState.selling_price,
        cost_price: itemFromState.cost_price
      });

      // Pre-populate the sold item with available quantity
      setSelectedItems([
        {
          ...itemFromState,
          quantity: itemFromState.quantity || 1,
          unit_price: itemFromState.selling_price,
        },
      ]);

      // Auto-select the client if the item has one
      if (itemFromState.client_id) {
        console.log('[InvoiceFormPage] Setting client:', itemFromState.client_id);
        setSelectedClientId(itemFromState.client_id);
      }

      setInitialItemLoaded(true);
      console.log('[InvoiceFormPage] Item from inventory loaded:', itemFromState.name);
    } else {
      console.log('[InvoiceFormPage] Conditions not met:', {
        hasItemFromState: !!itemFromState,
        initialItemLoaded,
        hasInvoiceId: !!invoiceId
      });
    }
  }, [itemFromState, initialItemLoaded, invoiceId]);

  // Mutations
  const createInvoice = useCreateInvoice();
  const addItemToInvoice = useAddItemToInvoice();
  const removeItemFromInvoice = useRemoveItemFromInvoice();

  // REMOVED: Auto-fill client's items when client is selected
  // User should explicitly add items via "Tambah Item" button
  // This gives user more control over which items to include in invoice

  // Filter available items
  const filteredAvailableItems = uninvoicedItems.filter(
    (item) =>
      !selectedItems.find((si) => si.id === item.id) &&
      (!searchTerm ||
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.category?.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Calculate totals
  const subtotal = selectedItems.reduce(
    (sum, item) => sum + ((item.unit_price || item.selling_price) * (item.quantity || 1)),
    0
  ) + manualItems.reduce(
    (sum, item) => sum + ((item.unit_price || item.selling_price) * (item.quantity || 1)),
    0
  );
  const tax = 0;
  const total = subtotal + tax;

  const handleAddItem = (item) => {
    // Start with quantity 1, max is item's available quantity
    const inventoryQuantity = item.quantity || 1;
    const newItem = { ...item, quantity: 1, unit_price: item.selling_price, maxQuantity: inventoryQuantity };
    console.log('[InvoiceFormPage] handleAddItem - Adding item:', {
      itemId: item.id,
      itemName: item.name,
      inventoryQuantity,
      newItemMaxQuantity: newItem.maxQuantity,
      fullNewItem: newItem
    });
    setSelectedItems([
      ...selectedItems,
      newItem,
    ]);
    setShowItemSelector(false);
    setSearchTerm('');
  };

  const handleRemoveItem = async (itemId) => {
    try {
      // Find the item being removed
      const itemToRemove = selectedItems.find((item) => item.id === itemId);

      // If editing an existing invoice and item has invoice_item_id, call RPC to remove it
      if (invoiceId && itemToRemove?.invoice_item_id) {
        console.log('[InvoiceFormPage] Removing item from invoice via RPC:', itemId);
        await removeItemFromInvoice.mutateAsync({
          invoiceId,
          itemId
        });
        console.log('[InvoiceFormPage] Item removed successfully');
        toast.success('Item dihapus dari invois, status dikembalikan ke tersedia');
      } else {
        // For new invoices or unlinked items, just remove from local state
        console.log('[InvoiceFormPage] Removing item from local state:', itemId);
        toast.success('Item dihapus dari invois');
      }

      // Remove from local state
      setSelectedItems(selectedItems.filter((item) => item.id !== itemId));
    } catch (error) {
      console.error('[InvoiceFormPage] Error removing item:', error);
      toast.error('Ralat: ' + (error.message || 'Gagal memadam item'));
    }
  };

  const handleUpdateQuantity = (itemId, quantity) => {
    console.log('[InvoiceFormPage] handleUpdateQuantity called:', { itemId, quantity, receivedType: typeof quantity });
    setSelectedItems(
      selectedItems.map((item) => {
        if (item.id === itemId) {
          const newQty = Math.max(1, parseInt(quantity) || 1);
          const maxQty = item.maxQuantity || item.quantity || 1;
          console.log('[InvoiceFormPage] Updating item:', {
            itemId,
            currentQuantity: item.quantity,
            itemMaxQuantity: item.maxQuantity,
            itemInventoryQuantity: item.quantity,
            parsedInputValue: newQty,
            maxQty,
            willCapTo: Math.min(newQty, maxQty)
          });
          // Cap quantity at available stock
          const cappedQty = Math.min(newQty, maxQty);
          if (newQty > maxQty) {
            toast.error(`Maximum kuantiti untuk item ini: ${maxQty}`);
          }
          return { ...item, quantity: cappedQty };
        }
        return item;
      })
    );
  };

  const handleAddManualItem = () => {
    if (!manualItemName.trim() || !manualItemPrice) {
      toast.error('Sila isi nama dan harga item');
      return;
    }

    const newManualItem = {
      id: `manual-${Date.now()}`,
      name: manualItemName,
      selling_price: parseFloat(manualItemPrice),
      quantity: 1,
      category: 'Manual',
      is_manual: true,
    };

    setManualItems([...manualItems, newManualItem]);
    setManualItemName('');
    setManualItemPrice('');
    setShowManualItemForm(false);
    toast.success('Item manual ditambah');
  };

  const handleRemoveManualItem = (itemId) => {
    setManualItems(manualItems.filter((item) => item.id !== itemId));
  };

  const handleUpdateManualItemQuantity = (itemId, quantity) => {
    setManualItems(
      manualItems.map((item) =>
        item.id === itemId ? { ...item, quantity: Math.max(1, parseInt(quantity) || 1) } : item
      )
    );
  };

  const handleSaveInvoice = async () => {
    if (selectedItems.length === 0 && manualItems.length === 0) {
      toast.error('Sila tambahkan sekurang-kurangnya satu item');
      return;
    }

    try {
      if (invoiceId) {
        // Update existing invoice - for now just save notes
        // In a real app, you'd have a full update mutation
        toast.success('Invois dikemaskini');
        navigate(`/invoices/${invoiceId}`);
      } else {
        // Create new invoice
        const result = await createInvoice.mutateAsync({
          clientId: selectedClientId,
          selectedItems,
          notes,
          manualItems,
        });
        toast.success('Invois berjaya dibuat');
        // Navigate to the newly created invoice details page
        if (result?.id) {
          navigate(`/invoices/${result.id}`);
        } else {
          navigate('/invoices');
        }
      }
    } catch (error) {
      console.error('[InvoiceFormPage] Error:', error);
      toast.error('Ralat: ' + (error.message || 'Gagal menyimpan invois'));
    }
  };

  return (
    <div className="space-y-6 p-6" style={{width: '100%', maxWidth: '100%', boxSizing: 'border-box'}}>
      {/* Header */}
      <div style={{display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: '1rem', width: '100%', boxSizing: 'border-box'}}>
        <Button
          variant="ghost"
          size="icon"
          className="w-fit h-fit flex-shrink-0"
          onClick={() => navigate('/invoices')}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div style={{minWidth: 0, width: '100%'}}>
          <h1 className="text-3xl font-bold break-words">
            {invoiceId ? 'Sunting Invois' : 'Buat Invois Baru'}
          </h1>
          <p className="mt-2 text-gray-600 text-sm">
            {invoiceId ? 'Kemaskini butiran invois' : 'Buat invois untuk pembeli anda'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 w-full min-w-0">
        {/* Form Section */}
        <div className="space-y-6 lg:col-span-2 min-w-0">
          {/* Client Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Maklumat Pembeli</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Pilih Pembeli (Opsyon)</label>
                {clients.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">
                    Tiada pembeli tersedia
                  </div>
                ) : (
                  <div className="max-h-60 space-y-2 overflow-y-auto border rounded-lg p-3">
                    {clients.map((client) => (
                      <button
                        key={client.id}
                        onClick={() => setSelectedClientId(client.id)}
                        className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                          selectedClientId === client.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <p className="font-medium">{client.name}</p>
                        <p className="text-sm text-gray-600">{client.email || '-'}</p>
                      </button>
                    ))}
                  </div>
                )}
                {selectedClientId && (
                  <div className="flex justify-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedClientId('')}
                      style={{display: 'flex', marginTop: '0.5rem'}}
                    >
                      Padam Pilihan (Tetamu)
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Items Selection */}
          <Card className="overflow-hidden" style={{width: '100%', boxSizing: 'border-box'}}>
            <CardHeader style={{display: 'flex', flexDirection: 'row', gap: '1rem', width: '100%', boxSizing: 'border-box', alignItems: 'flex-start', justifyContent: 'space-between'}}>
              <div style={{minWidth: 0, flex: 1}}>
                <CardTitle>Item Invois</CardTitle>
                <CardDescription>
                  {selectedItems.length + manualItems.length} item ({selectedItems.length} invois + {manualItems.length} manual)
                </CardDescription>
              </div>
              <div style={{display: 'flex', gap: '0.5rem', whiteSpace: 'nowrap', flexShrink: 0}}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowItemSelector(true)}
                  style={{display: 'flex', gap: '0.5rem'}}
                >
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Tambah Item</span>
                  <span className="sm:hidden">Item</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowManualItemForm(true)}
                  style={{display: 'flex', gap: '0.5rem'}}
                >
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Manual</span>
                  <span className="sm:hidden">+</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {selectedItems.length === 0 && manualItems.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  Tiada item dipilih. Klik "Tambah Item" atau "Tambah Item Manual" untuk memulakan.
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedItems.map((item) => {
                    const effectiveMax = item.maxQuantity || 1;
                    console.log(`[InvoiceFormPage] Rendering item ${item.id} (${item.name}):`, {
                      quantity: item.quantity,
                      maxQuantity: item.maxQuantity,
                      effectiveMax,
                      allItemProps: item
                    });
                    return (
                    <div
                      key={item.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-lg border p-3 gap-3"
                    >
                      <div className="flex-1">
                        <p className="font-medium">{item.name}</p>
                        <p className="text-sm text-gray-600">{item.category}</p>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min="1"
                              max={effectiveMax}
                              value={item.quantity || 1}
                              onChange={(e) => handleUpdateQuantity(item.id, e.target.value)}
                              className="w-16"
                              title={`Maximum: ${effectiveMax}`}
                            />
                            <span className="text-xs text-gray-500">
                              / {item.maxQuantity || 1}
                            </span>
                          </div>
                          <span className="text-sm">×</span>
                          <span className="w-20 text-right">
                            {formatCurrency(item.selling_price)}
                          </span>
                        </div>
                        <div className="w-24 text-right font-semibold sm:text-left">
                          {formatCurrency(item.selling_price * (item.quantity || 1))}
                        </div>
                        <button
                          onClick={() => handleRemoveItem(item.id)}
                          className="ml-2 text-red-600 hover:text-red-800 self-start"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    );
                  })}

                  {/* Manual Items */}
                  {manualItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-lg border p-3 bg-blue-50 gap-3"
                    >
                      <div className="flex-1">
                        <p className="font-medium">{item.name}</p>
                        <p className="text-sm text-gray-600">Manual Item</p>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity || 1}
                            onChange={(e) => handleUpdateManualItemQuantity(item.id, e.target.value)}
                            className="w-16"
                          />
                          <span className="text-sm">×</span>
                          <span className="w-20 text-right">
                            {formatCurrency(item.selling_price)}
                          </span>
                        </div>
                        <div className="w-24 text-right font-semibold sm:text-left">
                          {formatCurrency(item.selling_price * (item.quantity || 1))}
                        </div>
                        <button
                          onClick={() => handleRemoveManualItem(item.id)}
                          className="ml-2 text-red-600 hover:text-red-800 self-start"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Manual Item Form Modal */}
          {showManualItemForm && (
            <Card className="border-blue-200 bg-blue-50">
              <CardHeader>
                <CardTitle>Tambah Item Manual</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Nama Item / Perkhidmatan</label>
                  <Input
                    value={manualItemName}
                    onChange={(e) => setManualItemName(e.target.value)}
                    placeholder="cth: Pos Laju, Konsultasi, dll"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Harga (RM)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={manualItemPrice}
                    onChange={(e) => setManualItemPrice(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="flex gap-2 flex-col sm:flex-row w-full">
                  <Button
                    onClick={handleAddManualItem}
                    className="w-full"
                    style={{display: 'flex', backgroundColor: '#2563eb', color: 'white', flex: 1, width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '0.5rem 0.75rem'}}
                  >
                    Tambah Item
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowManualItemForm(false);
                      setManualItemName('');
                      setManualItemPrice('');
                    }}
                    className="w-full"
                    style={{display: 'flex', flex: 1, width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '0.5rem 0.75rem'}}
                  >
                    Batal
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle>Nota Tambahan</CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan atau keterangan tambahan..."
                className="min-h-[100px] w-full rounded-lg border p-3 text-sm"
              />
            </CardContent>
          </Card>
        </div>

        {/* Summary Section */}
        <div>
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle>Ringkasan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3 border-b pb-4">
                <div className="flex justify-between text-sm">
                  <span>Subtotal:</span>
                  <span className="font-medium">{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Cukai:</span>
                  <span className="font-medium">{formatCurrency(tax)}</span>
                </div>
              </div>
              <div className="flex justify-between text-lg font-bold">
                <span>Jumlah:</span>
                <span>{formatCurrency(total)}</span>
              </div>

              {selectedClientId && (
                <div className="rounded-lg bg-blue-50 p-3 text-sm">
                  <p className="font-medium">
                    {clients.find((c) => c.id === selectedClientId)?.name}
                  </p>
                  {clients.find((c) => c.id === selectedClientId)?.email && (
                    <p className="text-gray-600">
                      {clients.find((c) => c.id === selectedClientId)?.email}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2 pt-4 flex flex-col gap-2 sm:flex-row w-full">
                <Button
                  onClick={handleSaveInvoice}
                  disabled={selectedItems.length === 0 && manualItems.length === 0}
                  className="w-full"
                  style={{display: 'flex', flex: 1, width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '0.5rem 0.75rem'}}
                >
                  {invoiceId ? 'Kemaskini Invois' : 'Simpan Invois'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate('/invoices')}
                  className="w-full"
                  style={{display: 'flex', flex: 1, width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '0.5rem 0.75rem'}}
                >
                  Batal
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Item Selector Card */}
      {showItemSelector && (
        <Card className="mt-6 border-blue-200 bg-blue-50 overflow-hidden" style={{width: '100%', maxWidth: '100%', boxSizing: 'border-box'}}>
          <CardHeader style={{width: '100%', boxSizing: 'border-box'}}>
            <div style={{display: 'flex', flexDirection: 'row', gap: '0.75rem', width: '100%', boxSizing: 'border-box', alignItems: 'center', justifyContent: 'space-between'}}>
              <div style={{minWidth: 0, flex: 1}}>
                <CardTitle>Pilih Item</CardTitle>
                <CardDescription>
                  Cari dan pilih item untuk ditambahkan ke invois
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowItemSelector(false)}
                style={{display: 'flex', whiteSpace: 'nowrap', flexShrink: 0}}
              >
                Tutup
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Search */}
            <Input
              placeholder="Cari nama item atau kategori..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />

            {/* Items List */}
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {filteredAvailableItems.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  Tiada item tersedia. Semua item mungkin sudah mempunyai invois.
                </div>
              ) : (
                filteredAvailableItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-lg border p-3 hover:bg-gray-50 gap-3"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-sm text-gray-600">{item.category}</p>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <span className="font-semibold">
                        {formatCurrency(item.selling_price)}
                      </span>
                      <Button
                        size="sm"
                        onClick={() => handleAddItem(item)}
                        className="gap-2"
                      >
                        <Plus className="h-4 w-4" />
                        Tambah
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default InvoiceFormPage;
