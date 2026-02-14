import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Hook to fetch all invoices for the current user
 */
export const useInvoices = (filters = {}) => {
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  const userId = authData?.session?.user?.id;

  return useQuery({
    queryKey: ['invoices', userId, filters],
    queryFn: async () => {
      if (!userId) return [];

      let query = supabase
        .from('invoices')
        .select(
          `
          *,
          client:clients(id, name, email),
          invoice_items(
            id,
            item_id,
            quantity,
            unit_price,
            line_total,
            item:items(id, name, category)
          ),
          refunds(id, amount, reason, notes, issued_at, created_at)
        `
        )
        .eq('user_id', userId)
        .order('invoice_date', { ascending: false });

      // Apply filters
      if (filters.clientId) {
        query = query.eq('client_id', filters.clientId);
      }

      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      if (filters.startDate && filters.endDate) {
        query = query
          .gte('invoice_date', filters.startDate)
          .lte('invoice_date', filters.endDate);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

/**
 * Hook to fetch a single invoice with details
 */
export const useInvoiceDetail = (invoiceId) => {
  return useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: async () => {
      if (!invoiceId) return null;

      console.log('[useInvoiceDetail] Fetching invoice details for:', invoiceId);

      const { data, error } = await supabase
        .from('invoices')
        .select(
          `
          *,
          client:clients(
            id,
            name,
            email,
            client_phones(phone_number),
            client_addresses(address)
          ),
          invoice_items(
            id,
            item_id,
            quantity,
            unit_price,
            line_total,
            is_manual,
            item_name,
            item:items(id, name, category, image_url)
          ),
          refunds(id, amount, reason, notes, issued_at, created_at)
        `
        )
        .eq('id', invoiceId)
        .single();

      if (error) {
        // Handle the "0 rows" error gracefully (invoice was deleted)
        if (error.code === 'PGRST116' || error.message?.includes('0 rows')) {
          console.warn('[useInvoiceDetail] Invoice not found (may have been deleted):', invoiceId);
          return null;
        }
        if (error.code !== 'PGRST116' && !error.message?.includes('0 rows')) { console.error('[useInvoiceDetail] Query error:', error); }
        throw error;
      }

      console.log('[useInvoiceDetail] Retrieved invoice data:', data);
      return data;
    },
    enabled: !!invoiceId,
    staleTime: 0, // Always consider data stale so fresh data is fetched
    gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes after not used
  });
};

/**
 * Hook to get uninvoiced items for a specific client
 */
export const useUninvoicedItemsByClient = (clientId) => {
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  const userId = authData?.session?.user?.id;

  return useQuery({
    queryKey: ['uninvoiced-items', clientId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .eq('user_id', userId)
        .eq('client_id', clientId)
        .is('invoice_id', null)
        .eq('status', 'terjual')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId && !!userId,
  });
};

/**
 * Hook to get all uninvoiced items
 */
export const useUninvoicedItems = () => {
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  const userId = authData?.session?.user?.id;

  return useQuery({
    queryKey: ['uninvoiced-items', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select('*, client:clients(id, name, email)')
        .eq('user_id', userId)
        .is('invoice_id', null)
        .eq('status', 'terjual')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
  });
};

/**
 * Mutation to create a new invoice
 */
export const useCreateInvoice = () => {
  const queryClient = useQueryClient();
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  const userId = authData?.session?.user?.id;

  return useMutation({
    mutationFn: async ({ clientId, selectedItems = [], notes = '', manualItems = [], platform = 'Manual' }) => {
      if (!userId) throw new Error('User not authenticated');

      // Generate invoice number
      const { data: invoiceNumber, error: numberError } = await supabase.rpc(
        'generate_invoice_number',
        { p_user_id: userId }
      );

      if (numberError) throw numberError;

      // Create invoice with platform
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          user_id: userId,
          invoice_number: invoiceNumber,
          client_id: clientId || null,
          invoice_date: new Date().toISOString().split('T')[0],
          notes,
          platform,
          status: 'draft',
        })
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      // Add inventory items to invoice
      let totalAmount = 0;
      await Promise.all(
        selectedItems.map(async (selectedItem) => {
          const itemId = selectedItem.id;
          const itemQuantity = selectedItem.quantity || 1;
          const unitPrice = selectedItem.unit_price || selectedItem.selling_price;

          console.log('[useCreateInvoice] Adding inventory item to invoice:', { itemId, itemQuantity, unitPrice });

          totalAmount += unitPrice * itemQuantity;

          const { data: rpcResult, error: rpcError } = await supabase.rpc('add_item_to_invoice', {
            p_invoice_id: invoice.id,
            p_item_id: itemId,
            p_quantity: itemQuantity,
            p_unit_price: unitPrice,
            p_user_id: userId,
          });

          if (rpcError) {
            console.error('[useCreateInvoice] RPC error adding item:', rpcError);
            throw new Error(`Failed to add item ${itemId}: ${rpcError.message}`);
          }

          if (!rpcResult || rpcResult.length === 0) {
            throw new Error(`Failed to add item ${itemId}: No response from server`);
          }

          if (!rpcResult[0]?.success) {
            throw new Error(`Failed to add item ${itemId}: ${rpcResult[0]?.message || 'Unknown error'}`);
          }

          return {
            success: rpcResult[0].success,
            message: rpcResult[0].message,
          };
        })
      );

      // Add manual items to invoice
      await Promise.all(
        manualItems.map(async (manualItem) => {
          console.log('[useCreateInvoice] Adding manual item to invoice:', manualItem);

          const itemPrice = parseFloat(manualItem.selling_price) || 0;
          const itemQuantity = manualItem.quantity || 1;
          totalAmount += itemPrice * itemQuantity;

          console.log('[useCreateInvoice] RPC parameters:', {
            p_invoice_id: invoice.id,
            p_item_name: manualItem.name,
            p_unit_price: itemPrice,
            p_user_id: userId,
          });

          const { data: rpcResult, error: rpcError } = await supabase.rpc('add_manual_item_to_invoice', {
            p_invoice_id: invoice.id,
            p_item_name: manualItem.name,
            p_unit_price: itemPrice.toString(),
            p_user_id: userId,
          });

          if (rpcError) {
            console.error('[useCreateInvoice] RPC error adding manual item:', rpcError);
            throw new Error(`Failed to add manual item "${manualItem.name}": ${rpcError.message}`);
          }

          if (!rpcResult || rpcResult.length === 0) {
            throw new Error(`Failed to add manual item "${manualItem.name}": No response from server`);
          }

          if (!rpcResult[0]?.success) {
            throw new Error(`Failed to add manual item "${manualItem.name}": ${rpcResult[0]?.message || 'Unknown error'}`);
          }

          return {
            success: rpcResult[0].success,
            message: rpcResult[0].message,
          };
        })
      );

      // Update invoice with total
      await supabase
        .from('invoices')
        .update({
          subtotal: totalAmount,
          total_amount: totalAmount,
        })
        .eq('id', invoice.id);

      return { ...invoice, subtotal: totalAmount, total_amount: totalAmount };
    },
    onSuccess: async () => {
      // Invalidate all related queries
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['uninvoiced-items'] });
      queryClient.invalidateQueries({ queryKey: ['available-items'] });

      // Add delay to ensure server-side operations complete before refetch
      // Don't wait for refetch, let it happen in background

      // Force refetch of all queries to ensure UI updates
      queryClient.refetchQueries({ type: 'all' });
    },
    onError: (error) => {
      console.error('[useCreateInvoice] Error:', error);
    },
  });
};

/**
 * Mutation to add item to invoice
 */
export const useAddItemToInvoice = () => {
  const queryClient = useQueryClient();
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  const userId = authData?.session?.user?.id;

  return useMutation({
    mutationFn: async ({ invoiceId, itemId }) => {
      if (!userId) throw new Error('User not authenticated');

      const { data, error } = await supabase.rpc('add_item_to_invoice', {
        p_invoice_id: invoiceId,
        p_item_id: itemId,
        p_user_id: userId,
      });

      if (error) throw error;
      if (!data[0]?.success) throw new Error(data[0]?.message || 'Failed to add item');

      return data[0];
    },
    onSuccess: (_, { invoiceId }) => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['uninvoiced-items'] });
    },
  });
};

/**
 * Mutation to remove item from invoice
 */
export const useRemoveItemFromInvoice = () => {
  const queryClient = useQueryClient();
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  const userId = authData?.session?.user?.id;

  return useMutation({
    mutationFn: async ({ invoiceId, itemId }) => {
      if (!userId) throw new Error('User not authenticated');

      const { data, error } = await supabase.rpc('remove_item_from_invoice', {
        p_invoice_id: invoiceId,
        p_item_id: itemId,
        p_user_id: userId,
      });

      if (error) throw error;
      if (!data[0]?.success) throw new Error(data[0]?.message || 'Failed to remove item');

      return data[0];
    },
    onSuccess: async (_, { invoiceId }) => {
      console.log('[useRemoveItemFromInvoice] Invalidating queries after item removal...');

      // Remove invoice detail from cache and don't refetch it
      queryClient.removeQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.removeQueries({ queryKey: ['invoiceDetail', invoiceId] });

      // Invalidate invoice list and items
      queryClient.removeQueries({ queryKey: ['invoice'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });

      // Invalidate available/uninvoiced items queries - use partial matching
      queryClient.invalidateQueries({
        queryKey: ['uninvoiced-items'],
        exact: false
      });
      queryClient.invalidateQueries({
        queryKey: ['available-items'],
        exact: false
      });

      // Invalidate wallet and transaction queries
      queryClient.invalidateQueries({ queryKey: ['wallets'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });

      // Invalidate pelanggan queries - try both patterns
      queryClient.invalidateQueries({ queryKey: ['pelanggan'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });

      // Invalidate dashboard data
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      // Invalidate sales data
      queryClient.invalidateQueries({ queryKey: ['sales'] });

      // Add delay to ensure server-side operations complete before refetch
      // Don't wait for refetch, let it happen in background

      // Refetch specific queries (but NOT invoice detail to avoid 0-rows error)
      queryClient.refetchQueries({ queryKey: ['invoices'] });
      queryClient.refetchQueries({ queryKey: ['items'] });
      queryClient.refetchQueries({
        queryKey: ['available-items'],
        exact: false
      });
      queryClient.refetchQueries({
        queryKey: ['uninvoiced-items'],
        exact: false
      });
      queryClient.refetchQueries({ queryKey: ['dashboard'] });
      queryClient.refetchQueries({ queryKey: ['wallets'] });
      queryClient.refetchQueries({ queryKey: ['clients'] });
      queryClient.refetchQueries({ queryKey: ['pelanggan'] });
    },
    onError: (error) => {
      console.error('[useRemoveItemFromInvoice] Error:', error);
    },
  });
};

/**
 * Mutation to update invoice status
 */
export const useUpdateInvoiceStatus = () => {
  const queryClient = useQueryClient();
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  const userId = authData?.session?.user?.id ?? null;

  return useMutation({
    mutationFn: async ({ invoiceId, status }) => {
      if (!userId) throw new Error('User not authenticated');

      const { data, error } = await supabase.rpc('update_invoice_status', {
        p_invoice_id: invoiceId,
        p_user_id: userId,
        p_status: status,
      });

      if (error) throw error;
      if (!data[0]?.success) throw new Error(data[0]?.message || 'Failed to update status');

      // If status is "finalized", update items table with quantities from invoice_items
      if (status === 'finalized') {
        console.log('[useUpdateInvoiceStatus] Status changed to finalized, updating items table...');
        
        // Get all invoice items for this invoice
        const { data: invoiceItems, error: itemsError } = await supabase
          .from('invoice_items')
          .select('item_id, quantity, line_total')
          .eq('invoice_id', invoiceId);

        if (itemsError) {
          console.error('[useUpdateInvoiceStatus] Error fetching invoice items:', itemsError);
          throw itemsError;
        }

        // Update each item with invoice_quantity and actual_sold_amount
        if (invoiceItems && invoiceItems.length > 0) {
          for (const invItem of invoiceItems) {
            // Skip manual items (item_id is null) - they don't exist in items table
            if (!invItem.item_id) {
              console.log('[useUpdateInvoiceStatus] Skipping manual item (no item_id)');
              continue;
            }

            const { error: updateError } = await supabase
              .from('items')
              .update({
                invoice_quantity: invItem.quantity,
                actual_sold_amount: invItem.line_total
              })
              .eq('id', invItem.item_id);

            if (updateError) {
              console.error('[useUpdateInvoiceStatus] Error updating item:', updateError);
              throw updateError;
            }
          }
          console.log('[useUpdateInvoiceStatus] Items updated successfully');
        }
      }

      return data[0];
    },
    onSuccess: async (_, { invoiceId }) => {
      console.log('[useUpdateInvoiceStatus] Invalidating queries after status update...');

      // Invalidate all related queries
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });

      // Invalidate wallet and transaction queries
      queryClient.invalidateQueries({ queryKey: ['wallets', userId] });
      queryClient.invalidateQueries({ queryKey: ['transactions', userId, 'all'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-sales', userId] });
      queryClient.invalidateQueries({ queryKey: ['invoice-items', userId] });

      // Invalidate dashboard and client queries
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['pelanggan'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });

      // Add delay to ensure server-side operations complete before refetch
      // Don't wait for refetch, let it happen in background

      console.log('[useUpdateInvoiceStatus] Starting targeted refetch...');

      // Refetch specific important queries instead of all
      try {
        queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
      } catch (e) {
        console.log('[useUpdateInvoiceStatus] Invoice detail refetch skipped');
      }

      try {
        queryClient.refetchQueries({ queryKey: ['invoices'] });
      } catch (e) {
        console.log('[useUpdateInvoiceStatus] Invoices list refetch skipped');
      }

      try {
        console.log('[useUpdateInvoiceStatus] Refetching wallets for userId:', userId);
        queryClient.refetchQueries({ queryKey: ['wallets', userId] });
        console.log('[useUpdateInvoiceStatus] Wallets refetched successfully');
      } catch (e) {
        console.log('[useUpdateInvoiceStatus] Wallets refetch skipped');
      }

      try {
        console.log('[useUpdateInvoiceStatus] Refetching transactions for userId:', userId);
        queryClient.refetchQueries({ queryKey: ['transactions', userId, 'all'] });
        console.log('[useUpdateInvoiceStatus] Transactions refetched successfully');
      } catch (e) {
        console.log('[useUpdateInvoiceStatus] Transactions refetch skipped');
      }

      try {
        queryClient.refetchQueries({ queryKey: ['dashboard'] });
      } catch (e) {
        console.log('[useUpdateInvoiceStatus] Dashboard refetch skipped');
      }

      try {
        queryClient.refetchQueries({ queryKey: ['clients'] });
      } catch (e) {
        console.log('[useUpdateInvoiceStatus] Clients refetch skipped');
      }

      console.log('[useUpdateInvoiceStatus] Refetch complete');
    },
    onError: (error) => {
      console.error('[useUpdateInvoiceStatus] Error:', error);
    },
  });
};

/**
 * Mutation to delete invoice
 */
export const useDeleteInvoice = () => {
  const queryClient = useQueryClient();
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  const userId = authData?.session?.user?.id;

  return useMutation({
    mutationFn: async ({ invoiceId }) => {
      if (!userId) throw new Error('User not authenticated');

      console.log('[useDeleteInvoice] Starting deletion for invoice:', invoiceId);

      // Use RPC function for atomic deletion with proper cleanup
      const { data, error } = await supabase.rpc('delete_invoice', {
        p_invoice_id: invoiceId,
        p_user_id: userId,
      });

      if (error) {
        console.error('[useDeleteInvoice] RPC error:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        throw new Error('No response from server');
      }

      const response = data[0];
      if (!response.success) {
        throw new Error(response.message || 'Failed to delete invoice');
      }

      console.log('[useDeleteInvoice] Invoice deleted successfully:', response);
      return response;
    },
    onSuccess: async (_, { invoiceId }) => {
      console.log('[useDeleteInvoice] Invalidating queries after deletion...');

      // Remove the deleted invoice from cache immediately to prevent fetch errors
      queryClient.removeQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.removeQueries({ queryKey: ['invoiceDetail', invoiceId] });
      queryClient.removeQueries({ queryKey: ['invoice'], exact: false });

      // Invalidate all related queries across the platform
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      // CRITICAL: Use correct query keys that match App.jsx
      queryClient.invalidateQueries({ queryKey: ['items', userId] });
      queryClient.invalidateQueries({ queryKey: ['clients', userId] });
      queryClient.invalidateQueries({ queryKey: ['wallets', userId] });
      queryClient.invalidateQueries({ queryKey: ['transactions', userId, 'all'] });

      console.log('[useDeleteInvoice] Starting critical refetch of items, clients, wallets...');

      // CRITICAL FIX: Force immediate refetch with correct query keys
      try {
        await Promise.all([
          queryClient.refetchQueries({ queryKey: ['items', userId] }),
          queryClient.refetchQueries({ queryKey: ['clients', userId] }),
          queryClient.refetchQueries({ queryKey: ['wallets', userId] }),
          queryClient.refetchQueries({ queryKey: ['transactions', userId, 'all'] }),
          queryClient.refetchQueries({ queryKey: ['invoices'] })
        ]);
        console.log('[useDeleteInvoice] Critical refetches complete');
      } catch (e) {
        console.log('[useDeleteInvoice] Refetch completed with some errors:', e);
      }

      // Refetch secondary queries
      try {
        await Promise.all([
          queryClient.refetchQueries({
            queryKey: ['available-items'],
            exact: false
          }),
          queryClient.refetchQueries({
            queryKey: ['uninvoiced-items'],
            exact: false
          }),
          queryClient.refetchQueries({ queryKey: ['dashboard'] }),
          queryClient.refetchQueries({ queryKey: ['pelanggan'] }),
          queryClient.refetchQueries({ queryKey: ['sales'] })
        ]);
        console.log('[useDeleteInvoice] Secondary refetches complete');
      } catch (e) {
        console.log('[useDeleteInvoice] Secondary refetch error:', e);
      }

      // Refetch individual client detail pages (if user has them open)
      try {
        queryClient.refetchQueries({ queryKey: ['client'], exact: false });
        console.log('[useDeleteInvoice] Client detail pages refetched successfully');
      } catch (e) {
        console.log('[useDeleteInvoice] Client detail refetch skipped');
      }
    },
    onError: (error) => {
      console.error('[useDeleteInvoice] Error:', error);
    },
  });
};

/**
 * Function to trigger auto-invoice when item is marked as SOLD
 */
export const createAutoInvoiceForSoldItem = async (itemId, userId) => {
  console.log('[createAutoInvoiceForSoldItem] Creating invoice for item:', itemId, 'userId:', userId);

  try {
    console.log('[createAutoInvoiceForSoldItem] Calling RPC with params:', { p_item_id: itemId, p_user_id: userId });

    const { data, error } = await supabase.rpc(
      'create_or_update_invoice_for_sold_item',
      {
        p_item_id: itemId,
        p_user_id: userId,
      }
    );

    console.log('[createAutoInvoiceForSoldItem] RPC Response - data:', data, 'error:', error);

    if (error) {
      console.error('[createAutoInvoiceForSoldItem] RPC Error:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      console.warn('[createAutoInvoiceForSoldItem] No data returned from RPC');
      return null;
    }

    console.log('[createAutoInvoiceForSoldItem] Success! Data:', data);
    return data[0];
  } catch (error) {
    console.error('[createAutoInvoiceForSoldItem] Exception:', error.message, error);
    throw error;
  }
};

/**
 * Mutation to mark invoice as paid and update wallet, dashboard, and client records
 */
export const useMarkInvoiceAsPaid = () => {
  const queryClient = useQueryClient();
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  const userId = authData?.session?.user?.id;

  return useMutation({
    mutationFn: async ({ invoiceId }) => {
      if (!userId) throw new Error('User not authenticated');

      const { data, error } = await supabase.rpc('mark_invoice_as_paid', {
        p_invoice_id: invoiceId,
        p_user_id: userId,
      });

      if (error) {
        console.error('[useMarkInvoiceAsPaid] RPC error:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        throw new Error('No response from server');
      }

      const response = data[0];
      if (!response.success) {
        throw new Error(response.message || 'Failed to mark invoice as paid');
      }

      console.log('[useMarkInvoiceAsPaid] Success:', response);
      return response;
    },
    onSuccess: async (response, { invoiceId }) => {
      console.log('[useMarkInvoiceAsPaid] Payment success response:', response);
      console.log('[useMarkInvoiceAsPaid] New balance from RPC:', response.new_balance);
      console.log('[useMarkInvoiceAsPaid] UserId for queries:', userId);
      console.log('[useMarkInvoiceAsPaid] Invalidating queries...');

      // Invalidate all related queries across the platform
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      // CRITICAL: Use correct query keys that match App.jsx
      queryClient.invalidateQueries({ queryKey: ['items', userId] });
      queryClient.invalidateQueries({ queryKey: ['clients', userId] });
      queryClient.invalidateQueries({ queryKey: ['wallets', userId] });
      queryClient.invalidateQueries({ queryKey: ['transactions', userId, 'all'] });

      console.log('[useMarkInvoiceAsPaid] Starting refetch of critical data...');

      // CRITICAL FIX: Refetch items which will trigger Dashboard/Sales re-render via prop change
      // refetchQueries returns a promise that resolves when all queries are fetched
      try {
        console.log('[useMarkInvoiceAsPaid] Refetching items for userId:', userId);
        await queryClient.refetchQueries({ queryKey: ['items', userId] });
        console.log('[useMarkInvoiceAsPaid] Items refetched - Dashboard/Sales should re-render now');

        console.log('[useMarkInvoiceAsPaid] Refetching wallets...');
        await queryClient.refetchQueries({ queryKey: ['wallets', userId] });
        console.log('[useMarkInvoiceAsPaid] Wallets refetched');

        console.log('[useMarkInvoiceAsPaid] Refetching transactions...');
        await queryClient.refetchQueries({ queryKey: ['transactions', userId, 'all'] });
        console.log('[useMarkInvoiceAsPaid] Transactions refetched');

        console.log('[useMarkInvoiceAsPaid] Refetching invoice details...');
        await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
        console.log('[useMarkInvoiceAsPaid] Invoice refetched');

        console.log('[useMarkInvoiceAsPaid] Refetching clients...');
        await queryClient.refetchQueries({ queryKey: ['clients', userId] });
        console.log('[useMarkInvoiceAsPaid] Clients refetched - Pelanggan should update now');

        console.log('[useMarkInvoiceAsPaid] Refetching dashboard sales...');
        await queryClient.refetchQueries({ queryKey: ['dashboard-sales', userId] });
        console.log('[useMarkInvoiceAsPaid] Dashboard sales refetched');

        console.log('[useMarkInvoiceAsPaid] Refetching invoice items...');
        await queryClient.refetchQueries({ queryKey: ['invoice-items', userId] });
        console.log('[useMarkInvoiceAsPaid] Invoice items refetched');

        console.log('[useMarkInvoiceAsPaid] ✅ Critical refetches complete');
      } catch (e) {
        console.error('[useMarkInvoiceAsPaid] ❌ Error during critical refetch:', e);
      }

      // Add small delay to ensure state updates propagate
      await new Promise(resolve => setTimeout(resolve, 500));

      // Refetch other queries in parallel (less critical for immediate UI update)
      try {
        console.log('[useMarkInvoiceAsPaid] Refetching invoices list...');
        await queryClient.refetchQueries({ queryKey: ['invoices'] });
        console.log('[useMarkInvoiceAsPaid] Invoices list refetched');
      } catch (e) {
        console.error('[useMarkInvoiceAsPaid] Error refetching invoices:', e);
      }

      console.log('[useMarkInvoiceAsPaid] ✅ All refetches complete - dashboard, sales, pelanggan should now be updated');
    },
    onError: (error) => {
      console.error('[useMarkInvoiceAsPaid] Error:', error);
    },
  });
};

/**
 * Mutation to reverse payment and revert invoice to finalized status
 */
export const useReverseInvoicePayment = () => {
  const queryClient = useQueryClient();
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  const userId = authData?.session?.user?.id;

  return useMutation({
    mutationFn: async ({ invoiceId }) => {
      if (!userId) throw new Error('User not authenticated');

      const { data, error } = await supabase.rpc('reverse_invoice_payment', {
        p_invoice_id: invoiceId,
        p_user_id: userId,
      });

      if (error) {
        console.error('[useReverseInvoicePayment] RPC error:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        throw new Error('No response from server');
      }

      const response = data[0];
      if (!response.success) {
        throw new Error(response.message || 'Failed to reverse payment');
      }

      console.log('[useReverseInvoicePayment] Success:', response);
      return response;
    },
    onSuccess: async (response, { invoiceId }) => {
      console.log('[useReverseInvoicePayment] Payment reversal success:', response);
      console.log('[useReverseInvoicePayment] New balance from RPC:', response.new_balance);
      console.log('[useReverseInvoicePayment] Invalidating queries...');

      // Invalidate all related queries across the platform
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      // Be specific with user ID for wallet and transaction queries
      queryClient.invalidateQueries({ queryKey: ['wallets', userId] });
      queryClient.invalidateQueries({ queryKey: ['transactions', userId, 'all'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['pelanggan'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });

      console.log('[useReverseInvoicePayment] Starting refetch of invoice detail, wallets and transactions...');

      // CRITICAL FIX: Force immediate refetch and AWAIT the promises
      // This ensures wallets and transactions are updated before the UI is re-rendered
      try {
        await Promise.all([
          queryClient.refetchQueries({ queryKey: ['wallets', userId] }),
          queryClient.refetchQueries({ queryKey: ['transactions', userId, 'all'] }),
          queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] })
        ]);
        console.log('[useReverseInvoicePayment] Critical refetches complete');
      } catch (e) {
        console.error('[useReverseInvoicePayment] Error during critical refetch:', e);
      }

      // Refetch other queries in parallel (less critical for immediate UI update)
      try {
        await Promise.all([
          queryClient.refetchQueries({ queryKey: ['invoices'] }),
          queryClient.refetchQueries({ queryKey: ['dashboard'] }),
          queryClient.refetchQueries({ queryKey: ['clients'] }),
          queryClient.refetchQueries({ queryKey: ['pelanggan'] }),
          queryClient.refetchQueries({ queryKey: ['sales'] })
        ]);
        console.log('[useReverseInvoicePayment] Secondary refetches complete');
      } catch (e) {
        console.error('[useReverseInvoicePayment] Error during secondary refetch:', e);
      }

      console.log('[useReverseInvoicePayment] All refetches complete - wallet should now be updated');
    },
    onError: (error) => {
      console.error('[useReverseInvoicePayment] Error:', error);
    },
  });
};

/**
 * Mutation to process refund for a paid invoice
 * Pattern B: Non-destructive refund that keeps invoice as paid
 */
export const useProcessRefund = () => {
  const queryClient = useQueryClient();
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  const userId = authData?.session?.user?.id;

  return useMutation({
    mutationFn: async ({ invoiceId, refundAmount, reason, notes }) => {
      if (!userId) throw new Error('User not authenticated');

      console.log('[useProcessRefund] Processing refund:', { invoiceId, refundAmount, reason, notes });

      const { data, error } = await supabase.rpc('process_refund', {
        p_invoice_id: invoiceId,
        p_user_id: userId,
        p_refund_amount: refundAmount,
        p_reason: reason,
        p_notes: notes,
      });

      if (error) {
        console.error('[useProcessRefund] RPC error:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        throw new Error('No response from server');
      }

      const response = data[0];
      if (!response.success) {
        throw new Error(response.message || 'Failed to process refund');
      }

      console.log('[useProcessRefund] Success:', response);
      return response;
    },
    onSuccess: async (response, { invoiceId }) => {
      console.log('[useProcessRefund] Refund success response:', response);
      console.log('[useProcessRefund] New balance from RPC:', response.new_balance);
      console.log('[useProcessRefund] Invalidating queries...');

      // Invalidate all related queries (same strategy as mark_invoice_as_paid)
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['items', userId] });
      queryClient.invalidateQueries({ queryKey: ['wallets', userId] });
      queryClient.invalidateQueries({ queryKey: ['transactions', userId, 'all'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-sales', userId] });
      
      // Dashboard queries with multiple key parameters - use predicate for fuzzy matching
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'dashboard-refunds' && query.queryKey[1] === userId
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'dashboard-expenses' && query.queryKey[1] === userId
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'business-wallets' && query.queryKey[1] === userId
      });

      console.log('[useProcessRefund] Starting refetch of critical data...');

      try {
        console.log('[useProcessRefund] Refetching wallets...');
        await queryClient.refetchQueries({ queryKey: ['wallets', userId] });
        console.log('[useProcessRefund] Wallets refetched');

        console.log('[useProcessRefund] Refetching transactions...');
        await queryClient.refetchQueries({ queryKey: ['transactions', userId, 'all'] });
        console.log('[useProcessRefund] Transactions refetched');

        console.log('[useProcessRefund] Refetching invoice details...');
        await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
        console.log('[useProcessRefund] Invoice refetched');

        console.log('[useProcessRefund] Refetching items...');
        await queryClient.refetchQueries({ queryKey: ['items', userId] });
        console.log('[useProcessRefund] Items refetched');

        console.log('[useProcessRefund] Refetching dashboard refunds...');
        await queryClient.refetchQueries({
          predicate: (query) => query.queryKey[0] === 'dashboard-refunds' && query.queryKey[1] === userId
        });
        console.log('[useProcessRefund] Dashboard refunds refetched');

        console.log('[useProcessRefund] Refetching dashboard expenses...');
        await queryClient.refetchQueries({
          predicate: (query) => query.queryKey[0] === 'dashboard-expenses' && query.queryKey[1] === userId
        });
        console.log('[useProcessRefund] Dashboard expenses refetched');

        console.log('[useProcessRefund] Refetching business wallets...');
        await queryClient.refetchQueries({
          predicate: (query) => query.queryKey[0] === 'business-wallets' && query.queryKey[1] === userId
        });
        console.log('[useProcessRefund] Business wallets refetched');

        console.log('[useProcessRefund] ✅ Critical refetches complete');
      } catch (e) {
        console.error('[useProcessRefund] ❌ Error during critical refetch:', e);
      }

      // Add small delay to ensure state updates propagate
      await new Promise(resolve => setTimeout(resolve, 500));
    },
    onError: (error) => {
      console.error('[useProcessRefund] Error:', error);
    },
  });
};

export default {
  useInvoices,
  useInvoiceDetail,
  useUninvoicedItemsByClient,
  useUninvoicedItems,
  useCreateInvoice,
  useAddItemToInvoice,
  useRemoveItemFromInvoice,
  useUpdateInvoiceStatus,
  useDeleteInvoice,
  useMarkInvoiceAsPaid,
  useReverseInvoicePayment,
  useProcessRefund,
  createAutoInvoiceForSoldItem,
};
