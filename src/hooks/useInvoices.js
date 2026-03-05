import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import {
  COURIER_PAYMENT_MODES,
  isDeliveryRequiredForInvoice,
  resolveCourierPaymentModeForInvoice,
} from '@/lib/shipping';

const SHIPPING_VALUE_CAP = 9999;
const COURIER_MAX_LENGTH = 50;
const TRACKING_NO_MAX_LENGTH = 64;
const TRACKING_NO_PATTERN = /^[A-Za-z0-9\- ]*$/;
const SHIPMENT_NOTES_MAX_LENGTH = 500;

const normalizeTextInput = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeCurrencyAmount = (value, { label = 'Nilai', allowEmptyAsZero = true } = {}) => {
  const rawValue = value === null || value === undefined ? '' : String(value);
  const cleaned = rawValue.replace(/,/g, '').replace(/\s+/g, '');

  if (!cleaned) {
    if (allowEmptyAsZero) {
      return { ok: true, value: 0 };
    }
    return { ok: false, message: `${label} diperlukan.` };
  }

  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) {
    return { ok: false, message: `${label} tidak sah.` };
  }

  const rounded = Math.round(parsed * 100) / 100;
  if (rounded < 0) {
    return { ok: false, message: `${label} mesti 0 atau lebih.` };
  }

  if (rounded > SHIPPING_VALUE_CAP) {
    return { ok: false, message: 'Nombor terlalu besar - semak semula.' };
  }

  return { ok: true, value: rounded };
};

const validateShipmentTextFields = ({ courier, trackingNo }) => {
  const normalizedCourier = normalizeTextInput(courier);
  const normalizedTrackingNo = normalizeTextInput(trackingNo);

  if (normalizedCourier.length > COURIER_MAX_LENGTH) {
    return {
      ok: false,
      message: `Nama courier maksimum ${COURIER_MAX_LENGTH} aksara.`,
    };
  }

  if (normalizedTrackingNo.length > TRACKING_NO_MAX_LENGTH) {
    return {
      ok: false,
      message: `Tracking no maksimum ${TRACKING_NO_MAX_LENGTH} aksara.`,
    };
  }

  if (normalizedTrackingNo && !TRACKING_NO_PATTERN.test(normalizedTrackingNo)) {
    return {
      ok: false,
      message: 'Tracking no hanya boleh guna huruf, nombor, dash dan ruang.',
    };
  }

  return {
    ok: true,
    courier: normalizedCourier,
    trackingNo: normalizedTrackingNo,
  };
};

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
            cost_price,
            line_total,
            item:items(id, name, category)
          ),
          refunds(id, amount, reason, notes, issued_at, created_at),
          invoice_refunds(
            id,
            type,
            refund_type,
            amount,
            reason,
            note,
            affects_inventory,
            inventory_restocked,
            legacy_refund_id,
            legacy_return_id,
            created_at
          ),
          invoice_item_returns(
            id,
            invoice_item_id,
            item_id,
            return_item_name,
            returned_quantity,
            refund_amount,
            reason,
            notes,
            created_at
          ),
          invoice_fees(
            id,
            fee_rule_id,
            name,
            fee_type,
            applies_to,
            fee_value,
            base_amount,
            amount,
            amount_override,
            created_at
          )
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
            cost_price,
            line_total,
            is_manual,
            item_name,
            item:items(id, name, category, image_url)
          ),
          refunds(id, amount, reason, notes, issued_at, created_at),
          invoice_refunds(
            id,
            type,
            refund_type,
            amount,
            reason,
            note,
            affects_inventory,
            inventory_restocked,
            legacy_refund_id,
            legacy_return_id,
            created_at
          ),
          invoice_item_returns(
            id,
            invoice_item_id,
            item_id,
            return_item_name,
            returned_quantity,
            refund_amount,
            reason,
            notes,
            created_at
          ),
          invoice_fees(
            id,
            fee_rule_id,
            name,
            fee_type,
            applies_to,
            fee_value,
            base_amount,
            amount,
            amount_override,
            created_at
          )
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
    mutationFn: async ({
      clientId,
      selectedItems = [],
      notes = '',
      manualItems = [],
      platform = 'Manual',
      salesChannelId = null,
      channelFeeAmount = 0,
      shippingMethod = 'walk_in',
      courierPaymentMode = 'seller',
      shippingCharged = 0,
      shippingRequired = false,
    }) => {
      if (!userId) throw new Error('User not authenticated');

      // Generate invoice number
      const { data: invoiceNumber, error: numberError } = await supabase.rpc(
        'generate_invoice_number',
        { p_user_id: userId }
      );

      if (numberError) throw numberError;

      const normalizedChannelFeeAmount = (() => {
        const parsed = Number(channelFeeAmount);
        if (!Number.isFinite(parsed)) return 0;
        return Math.max(parsed, 0);
      })();

      const normalizedShippingCharged = (() => {
        const parsed = Number(shippingCharged);
        if (!Number.isFinite(parsed)) return 0;
        return Math.max(parsed, 0);
      })();

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
          sales_channel_id: salesChannelId || null,
          channel_fee_amount: normalizedChannelFeeAmount,
          shipping_method: shippingMethod || 'walk_in',
          courier_payment_mode: courierPaymentMode === 'platform' ? 'platform' : 'seller',
          shipping_charged: normalizedShippingCharged,
          shipping_required: Boolean(shippingRequired),
          status: 'draft',
        })
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      // Add inventory items to invoice
      await Promise.all(
        selectedItems.map(async (selectedItem) => {
          const itemId = selectedItem.id;
          const itemQuantity = Math.max(1, parseInt(selectedItem.quantity, 10) || 1);
          const unitPrice = (() => {
            const rawValue = selectedItem.unit_price ?? selectedItem.selling_price ?? 0;
            const parsed = Number.parseFloat(rawValue);
            if (!Number.isFinite(parsed)) return 0;
            return Math.max(parsed, 0);
          })();

          console.log('[useCreateInvoice] Adding inventory item to invoice:', { itemId, itemQuantity, unitPrice });

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
          const itemCost = parseFloat(manualItem.cost_price) || 0;
          const itemQuantity = Math.max(1, parseInt(manualItem.quantity, 10) || 1);

          console.log('[useCreateInvoice] RPC parameters:', {
            p_invoice_id: invoice.id,
            p_item_name: manualItem.name,
            p_quantity: itemQuantity,
            p_unit_price: itemPrice,
            p_cost_price: itemCost,
            p_user_id: userId,
          });

          const { data: rpcResult, error: rpcError } = await supabase.rpc('add_manual_item_to_invoice', {
            p_invoice_id: invoice.id,
            p_item_name: manualItem.name,
            p_quantity: itemQuantity,
            p_unit_price: itemPrice,
            p_cost_price: itemCost,
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

      // Re-apply selected sales channel after invoice items are inserted.
      // Some legacy flows update invoice subtotal after insert, so we enforce
      // channel snapshot once more on the final draft state.
      const { error: reapplySalesChannelError } = await supabase
        .from('invoices')
        .update({
          sales_channel_id: salesChannelId || null,
          channel_fee_amount: normalizedChannelFeeAmount,
          shipping_method: shippingMethod || 'walk_in',
          courier_payment_mode: courierPaymentMode === 'platform' ? 'platform' : 'seller',
          shipping_charged: normalizedShippingCharged,
          shipping_required: Boolean(shippingRequired),
        })
        .eq('id', invoice.id)
        .eq('user_id', userId);

      if (reapplySalesChannelError) {
        throw reapplySalesChannelError;
      }

      const { data: recalcData, error: recalcError } = await supabase.rpc('recalculate_invoice_totals', {
        p_invoice_id: invoice.id,
        p_user_id: userId,
      });

      if (recalcError) {
        throw recalcError;
      }

      if (!recalcData?.[0]?.success) {
        throw new Error(recalcData?.[0]?.message || 'Failed to recalculate invoice totals');
      }

      const { data: refreshedInvoice, error: refreshError } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoice.id)
        .single();

      if (refreshError) throw refreshError;

      return refreshedInvoice || invoice;
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

      const { data: invoiceExists, error: invoiceExistsError } = await supabase
        .from('invoices')
        .select('id')
        .eq('id', invoiceId)
        .eq('user_id', userId)
        .maybeSingle();

      if (invoiceExistsError) throw invoiceExistsError;

      if (invoiceExists?.id) {
        const { data: recalcData, error: recalcError } = await supabase.rpc('recalculate_invoice_totals', {
          p_invoice_id: invoiceId,
          p_user_id: userId,
        });

        if (recalcError) throw recalcError;
        if (!recalcData?.[0]?.success) {
          throw new Error(recalcData?.[0]?.message || 'Failed to recalculate invoice total');
        }
      }

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

      const { data: invoiceMeta, error: invoiceMetaError } = await supabase
        .from('invoices')
        .select('id, status')
        .eq('id', invoiceId)
        .eq('user_id', userId)
        .maybeSingle();

      if (invoiceMetaError) {
        console.error('[useDeleteInvoice] Failed to fetch invoice metadata:', invoiceMetaError);
        throw invoiceMetaError;
      }

      if (!invoiceMeta?.id) {
        throw new Error('Invois tidak ditemui');
      }

      // Draft invoices do not deduct stock from inventory.
      // Delete via direct table operations to avoid legacy RPC stock restoration.
      if (invoiceMeta.status === 'draft') {
        const { data: invoiceItemsRows, error: invoiceItemsFetchError } = await supabase
          .from('invoice_items')
          .select('id')
          .eq('invoice_id', invoiceId);

        if (invoiceItemsFetchError) {
          throw invoiceItemsFetchError;
        }

        const deletedItemsCount = invoiceItemsRows?.length || 0;

        const { error: deleteInvoiceItemsError } = await supabase
          .from('invoice_items')
          .delete()
          .eq('invoice_id', invoiceId);

        if (deleteInvoiceItemsError) {
          throw deleteInvoiceItemsError;
        }

        // Clear legacy linkage only. Do not change quantity for draft deletion.
        const { error: clearItemLinksError } = await supabase
          .from('items')
          .update({ invoice_id: null })
          .eq('user_id', userId)
          .eq('invoice_id', invoiceId);

        if (clearItemLinksError) {
          throw clearItemLinksError;
        }

        // Safety cleanup for any orphan refund rows (usually none on draft).
        const { error: deleteRefundsError } = await supabase
          .from('refunds')
          .delete()
          .eq('invoice_id', invoiceId);

        if (deleteRefundsError) {
          throw deleteRefundsError;
        }

        const { error: deleteInvoiceError } = await supabase
          .from('invoices')
          .delete()
          .eq('id', invoiceId)
          .eq('user_id', userId);

        if (deleteInvoiceError) {
          throw deleteInvoiceError;
        }

        const localResponse = {
          success: true,
          message: `Invois dihapus. ${deletedItemsCount} item dihapus dari invois, 0 item kuantiti dikembalikan.`,
          invoice_id: invoiceId,
        };

        console.log('[useDeleteInvoice] Draft invoice deleted via direct flow:', localResponse);
        return localResponse;
      }

      // Non-draft invoices keep RPC path (wallet/stock reversal logic server-side).
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
      queryClient.invalidateQueries({ queryKey: ['available-items', userId] });
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

        console.log('[useMarkInvoiceAsPaid] Refetching available invoice items...');
        await queryClient.refetchQueries({ queryKey: ['available-items', userId] });
        console.log('[useMarkInvoiceAsPaid] Available invoice items refetched');

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
 * Mutation to process non-stock invoice adjustments (goodwill/correction/cancel)
 * Pattern B: Non-destructive adjustment that keeps invoice as paid
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
    mutationFn: async ({ invoiceId, refundAmount, reason, notes, adjustmentType }) => {
      if (!userId) throw new Error('User not authenticated');
      const normalizedAdjustmentType = String(adjustmentType || '').trim().toLowerCase();
      if (!normalizedAdjustmentType) {
        throw new Error('Jenis adjustment wajib dipilih.');
      }

      console.log('[useProcessRefund] Processing refund:', {
        invoiceId,
        refundAmount,
        reason,
        notes,
        adjustmentType: normalizedAdjustmentType,
      });

      const { data, error } = await supabase.rpc('process_refund', {
        p_invoice_id: invoiceId,
        p_user_id: userId,
        p_refund_amount: refundAmount,
        p_reason: reason,
        p_notes: notes,
        p_adjustment_type: normalizedAdjustmentType,
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
        throw new Error(response.message || 'Failed to process adjustment');
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
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'client'
      });
      queryClient.invalidateQueries({ queryKey: ['wallets', userId] });
      queryClient.invalidateQueries({ queryKey: ['transactions', userId, 'all'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['allWallets'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-receipts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-sales', userId] });
      queryClient.invalidateQueries({ queryKey: ['invoice-items', userId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['pelanggan'] });
      
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
        await queryClient.refetchQueries({ queryKey: ['transactions'] });
        await queryClient.refetchQueries({ queryKey: ['wallet'] });
        await queryClient.refetchQueries({ queryKey: ['allWallets'] });

        console.log('[useProcessRefund] Refetching invoice details...');
        await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
        console.log('[useProcessRefund] Invoice refetched');
        await queryClient.refetchQueries({ queryKey: ['invoices'] });
        await queryClient.refetchQueries({ queryKey: ['clients'] });
        await queryClient.refetchQueries({ queryKey: ['pelanggan'] });

        console.log('[useProcessRefund] Refetching items...');
        await queryClient.refetchQueries({ queryKey: ['items', userId] });
        console.log('[useProcessRefund] Items refetched');
        await queryClient.refetchQueries({ queryKey: ['invoice-items', userId] });
        await queryClient.refetchQueries({ queryKey: ['dashboard-sales', userId] });

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
        console.log('[useProcessRefund] Refetching wallet analytics...');
        await queryClient.refetchQueries({
          predicate: (query) => query.queryKey[0] === 'wallet-cashflow-trend' && query.queryKey[1] === userId
        });
        await queryClient.refetchQueries({
          predicate: (query) => query.queryKey[0] === 'wallet-cashflow-breakdown' && query.queryKey[1] === userId
        });
        await queryClient.refetchQueries({
          predicate: (query) => query.queryKey[0] === 'wallet-monthly-summary' && query.queryKey[1] === userId
        });
        await queryClient.refetchQueries({
          predicate: (query) => query.queryKey[0] === 'wallet-monthly-transactions-export' && query.queryKey[1] === userId
        });
        await queryClient.refetchQueries({ queryKey: ['dashboard'] });
        await queryClient.refetchQueries({ queryKey: ['sales'] });
        console.log('[useProcessRefund] Wallet analytics refetched');

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

/**
 * Mutation to process physical item return (restore stock + reverse sale value)
 */
export const useProcessInvoiceReturn = () => {
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
    mutationFn: async ({
      invoiceId,
      invoiceItemId,
      returnQuantity,
      refundAmount,
      reason,
      notes,
    }) => {
      if (!userId) throw new Error('User not authenticated');

      console.log('[useProcessInvoiceReturn] Processing return:', {
        invoiceId,
        invoiceItemId,
        returnQuantity,
        refundAmount,
        reason,
        notes,
      });

      const { data, error } = await supabase.rpc('process_invoice_return', {
        p_invoice_id: invoiceId,
        p_user_id: userId,
        p_invoice_item_id: invoiceItemId,
        p_return_quantity: returnQuantity,
        p_refund_amount: refundAmount,
        p_reason: reason,
        p_notes: notes,
      });

      if (error) {
        console.error('[useProcessInvoiceReturn] RPC error:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        throw new Error('No response from server');
      }

      const response = data[0];
      if (!response.success) {
        throw new Error(response.message || 'Failed to process return');
      }

      console.log('[useProcessInvoiceReturn] Success:', response);
      return response;
    },
    onSuccess: async (_response, { invoiceId }) => {
      // Broad invalidation (same pattern as payment/refund flows)
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['items', userId] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['wallets', userId] });
      queryClient.invalidateQueries({ queryKey: ['transactions', userId, 'all'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['allWallets'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-receipts'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-sales', userId] });
      queryClient.invalidateQueries({ queryKey: ['invoice-items', userId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['pelanggan'] });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'client'
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'dashboard-refunds' && query.queryKey[1] === userId
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'dashboard-expenses' && query.queryKey[1] === userId
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'business-wallets' && query.queryKey[1] === userId
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'wallet-cashflow-trend' && query.queryKey[1] === userId
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'wallet-cashflow-breakdown' && query.queryKey[1] === userId
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'wallet-monthly-summary' && query.queryKey[1] === userId
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'wallet-monthly-transactions-export' && query.queryKey[1] === userId
      });

      try {
        await queryClient.refetchQueries({ queryKey: ['invoice', invoiceId] });
        await queryClient.refetchQueries({ queryKey: ['invoices'] });
        await queryClient.refetchQueries({ queryKey: ['items', userId] });
        await queryClient.refetchQueries({ queryKey: ['clients'] });
        await queryClient.refetchQueries({ queryKey: ['pelanggan'] });
        await queryClient.refetchQueries({ queryKey: ['wallets', userId] });
        await queryClient.refetchQueries({ queryKey: ['transactions', userId, 'all'] });
        await queryClient.refetchQueries({ queryKey: ['transactions'] });
        await queryClient.refetchQueries({ queryKey: ['wallet'] });
        await queryClient.refetchQueries({ queryKey: ['allWallets'] });
        await queryClient.refetchQueries({ queryKey: ['dashboard-sales', userId] });
        await queryClient.refetchQueries({ queryKey: ['invoice-items', userId] });
        await queryClient.refetchQueries({
          predicate: (query) => query.queryKey[0] === 'dashboard-refunds' && query.queryKey[1] === userId
        });
        await queryClient.refetchQueries({
          predicate: (query) => query.queryKey[0] === 'dashboard-expenses' && query.queryKey[1] === userId
        });
        await queryClient.refetchQueries({
          predicate: (query) => query.queryKey[0] === 'business-wallets' && query.queryKey[1] === userId
        });
        await queryClient.refetchQueries({
          predicate: (query) => query.queryKey[0] === 'wallet-cashflow-trend' && query.queryKey[1] === userId
        });
        await queryClient.refetchQueries({
          predicate: (query) => query.queryKey[0] === 'wallet-cashflow-breakdown' && query.queryKey[1] === userId
        });
        await queryClient.refetchQueries({
          predicate: (query) => query.queryKey[0] === 'wallet-monthly-summary' && query.queryKey[1] === userId
        });
        await queryClient.refetchQueries({
          predicate: (query) => query.queryKey[0] === 'wallet-monthly-transactions-export' && query.queryKey[1] === userId
        });
        await queryClient.refetchQueries({ queryKey: ['dashboard'] });
        await queryClient.refetchQueries({ queryKey: ['sales'] });
      } catch (e) {
        console.error('[useProcessInvoiceReturn] Error during critical refetch:', e);
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    onError: (error) => {
      console.error('[useProcessInvoiceReturn] Error:', error);
    },
  });
};

/**
 * Mutation to update invoice shipping charged safely
 */
export const useUpdateInvoiceShippingCharged = () => {
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
    mutationFn: async ({ invoiceId, shippingCharged }) => {
      if (!userId) throw new Error('User not authenticated');
      if (!invoiceId) throw new Error('Invoice ID is required');

      const normalizedShipping = normalizeCurrencyAmount(shippingCharged, {
        label: 'Caj pos',
        allowEmptyAsZero: true,
      });

      if (!normalizedShipping.ok) {
        throw new Error(normalizedShipping.message);
      }

      const { data, error } = await supabase.rpc('update_invoice_shipping_charged', {
        p_invoice_id: invoiceId,
        p_user_id: userId,
        p_shipping_charged: normalizedShipping.value,
      });

      if (error) throw error;

      const response = Array.isArray(data) ? data[0] : null;
      if (!response?.success) {
        throw new Error(response?.message || 'Gagal kemaskini caj pos');
      }

      return response;
    },
    onSuccess: (_, { invoiceId }) => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });
};

/**
 * Hook to fetch shipment details linked to an invoice
 */
export const useInvoiceShipment = (invoiceId) => {
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  const userId = authData?.session?.user?.id;

  return useQuery({
    queryKey: ['invoice-shipment', invoiceId, userId],
    queryFn: async () => {
      if (!invoiceId || !userId) return null;

      const { data: invoiceData, error: invoiceError } = await supabase
        .from('invoices')
        .select('id, user_id, shipment_id')
        .eq('id', invoiceId)
        .eq('user_id', userId)
        .maybeSingle();

      if (invoiceError) throw invoiceError;
      if (!invoiceData?.shipment_id) return null;

      const { data: shipmentData, error: shipmentError } = await supabase
        .from('shipments')
        .select('id, user_id, courier, tracking_no, ship_status, shipped_at, delivered_at, shipping_cost, courier_paid, courier_paid_at, notes, created_at, updated_at')
        .eq('id', invoiceData.shipment_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (shipmentError) throw shipmentError;
      return shipmentData || null;
    },
    enabled: !!invoiceId && !!userId,
    staleTime: 0,
  });
};

/**
 * Mutation to create/update shipment tracking info for an invoice
 */
export const useSaveInvoiceShipment = () => {
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
    mutationFn: async ({ invoiceId, courier, trackingNo }) => {
      if (!userId) throw new Error('User not authenticated');
      if (!invoiceId) throw new Error('Invoice ID is required');

      const shipmentTextValidation = validateShipmentTextFields({ courier, trackingNo });
      if (!shipmentTextValidation.ok) {
        throw new Error(shipmentTextValidation.message);
      }

      const cleanCourier = shipmentTextValidation.courier;
      const cleanTrackingNo = shipmentTextValidation.trackingNo;

      const { data: invoiceData, error: invoiceError } = await supabase
        .from('invoices')
        .select('id, user_id, shipment_id, shipping_method, shipping_charged, courier_payment_mode')
        .eq('id', invoiceId)
        .eq('user_id', userId)
        .single();

      if (invoiceError) throw invoiceError;

      let shipmentId = invoiceData.shipment_id;
      const deliveryRequired = isDeliveryRequiredForInvoice(invoiceData);
      const isPlatformMode = resolveCourierPaymentModeForInvoice(invoiceData) === COURIER_PAYMENT_MODES.PLATFORM;

      if (!deliveryRequired && !shipmentId) {
        throw new Error('Penghantaran tidak diperlukan untuk invois ini.');
      }

      if (!shipmentId) {
        const { data: insertedShipment, error: insertShipmentError } = await supabase
          .from('shipments')
          .insert({
            user_id: userId,
            courier: cleanCourier || null,
            tracking_no: cleanTrackingNo || null,
            ship_status: 'pending',
            shipping_cost: 0,
            courier_paid: isPlatformMode,
            courier_paid_at: isPlatformMode ? new Date().toISOString() : null,
          })
          .select('id')
          .single();

        if (insertShipmentError) throw insertShipmentError;

        shipmentId = insertedShipment.id;

        const { error: updateInvoiceError } = await supabase
          .from('invoices')
          .update({ shipment_id: shipmentId })
          .eq('id', invoiceId)
          .eq('user_id', userId);

        if (updateInvoiceError) throw updateInvoiceError;

        const { error: upsertLinkError } = await supabase
          .from('shipment_invoices')
          .upsert(
            { shipment_id: shipmentId, invoice_id: invoiceId },
            { onConflict: 'shipment_id,invoice_id', ignoreDuplicates: true }
          );

        if (upsertLinkError) throw upsertLinkError;
      }

      const shipmentUpdatePayload = {
        courier: cleanCourier || null,
        tracking_no: cleanTrackingNo || null,
      };
      if (isPlatformMode) {
        shipmentUpdatePayload.shipping_cost = 0;
        shipmentUpdatePayload.courier_paid = true;
        shipmentUpdatePayload.courier_paid_at = new Date().toISOString();
      }

      const { data: shipmentData, error: updateShipmentError } = await supabase
        .from('shipments')
        .update(shipmentUpdatePayload)
        .eq('id', shipmentId)
        .eq('user_id', userId)
        .select('id, user_id, courier, tracking_no, ship_status, shipped_at, delivered_at, shipping_cost, courier_paid, courier_paid_at, notes, created_at, updated_at')
        .single();

      if (updateShipmentError) throw updateShipmentError;
      return shipmentData;
    },
    onSuccess: (_, { invoiceId }) => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoice-shipment', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-items', userId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-sales', userId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-pending-shipping', userId] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });
};

/**
 * Mutation to update shipment status for an invoice
 */
export const useUpdateInvoiceShipmentStatus = () => {
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
    mutationFn: async ({ invoiceId, shipStatus, courier, trackingNo }) => {
      if (!userId) throw new Error('User not authenticated');
      if (!invoiceId) throw new Error('Invoice ID is required');

      const allowedStatuses = new Set(['not_required', 'pending', 'shipped', 'delivered', 'returned', 'cancelled']);
      if (!allowedStatuses.has(shipStatus)) {
        throw new Error('Status penghantaran tidak sah');
      }

      const shipmentTextValidation = validateShipmentTextFields({ courier, trackingNo });
      if (!shipmentTextValidation.ok) {
        throw new Error(shipmentTextValidation.message);
      }

      const cleanCourier = shipmentTextValidation.courier;
      const cleanTrackingNo = shipmentTextValidation.trackingNo;

      const { data: invoiceData, error: invoiceError } = await supabase
        .from('invoices')
        .select('id, user_id, shipment_id, shipping_method, shipping_charged, courier_payment_mode')
        .eq('id', invoiceId)
        .eq('user_id', userId)
        .single();

      if (invoiceError) throw invoiceError;

      let shipmentId = invoiceData.shipment_id;
      const deliveryRequired = isDeliveryRequiredForInvoice(invoiceData);
      const isPlatformMode = resolveCourierPaymentModeForInvoice(invoiceData) === COURIER_PAYMENT_MODES.PLATFORM;

      if (!deliveryRequired && !shipmentId) {
        throw new Error('Penghantaran tidak diperlukan untuk invois ini.');
      }

      if (!shipmentId) {
        const { data: insertedShipment, error: insertShipmentError } = await supabase
          .from('shipments')
          .insert({
            user_id: userId,
            ship_status: shipStatus,
            courier: cleanCourier || null,
            tracking_no: cleanTrackingNo || null,
            shipped_at: shipStatus === 'shipped' ? new Date().toISOString() : null,
            delivered_at: shipStatus === 'delivered' ? new Date().toISOString() : null,
            shipping_cost: 0,
            courier_paid: isPlatformMode,
            courier_paid_at: isPlatformMode ? new Date().toISOString() : null,
          })
          .select('id')
          .single();

        if (insertShipmentError) throw insertShipmentError;
        shipmentId = insertedShipment.id;

        const { error: updateInvoiceError } = await supabase
          .from('invoices')
          .update({ shipment_id: shipmentId })
          .eq('id', invoiceId)
          .eq('user_id', userId);

        if (updateInvoiceError) throw updateInvoiceError;
      }

      const nextValues = {
        ship_status: shipStatus,
      };

      if (cleanCourier) nextValues.courier = cleanCourier;
      if (cleanTrackingNo) nextValues.tracking_no = cleanTrackingNo;
      if (shipStatus === 'shipped') nextValues.shipped_at = new Date().toISOString();
      if (shipStatus === 'delivered') {
        nextValues.delivered_at = new Date().toISOString();
        nextValues.shipped_at = nextValues.shipped_at || new Date().toISOString();
      }
      if (isPlatformMode) {
        nextValues.shipping_cost = 0;
        nextValues.courier_paid = true;
        nextValues.courier_paid_at = new Date().toISOString();
      }

      const { data: shipmentData, error: updateShipmentError } = await supabase
        .from('shipments')
        .update(nextValues)
        .eq('id', shipmentId)
        .eq('user_id', userId)
        .select('id, user_id, courier, tracking_no, ship_status, shipped_at, delivered_at, shipping_cost, courier_paid, courier_paid_at, notes, created_at, updated_at')
        .single();

      if (updateShipmentError) throw updateShipmentError;

      const { error: upsertLinkError } = await supabase
        .from('shipment_invoices')
        .upsert(
          { shipment_id: shipmentId, invoice_id: invoiceId },
          { onConflict: 'shipment_id,invoice_id', ignoreDuplicates: true }
        );

      if (upsertLinkError) throw upsertLinkError;

      return shipmentData;
    },
    onSuccess: (_, { invoiceId }) => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoice-shipment', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-items', userId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-sales', userId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-pending-shipping', userId] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });
};

/**
 * Mutation to mark courier as paid and deduct wallet balance
 */
export const useMarkShipmentCourierPaid = () => {
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
    mutationFn: async ({ invoiceId, shippingCost, walletId = null, paidAt = null, notes = '' }) => {
      if (!userId) throw new Error('User not authenticated');
      if (!invoiceId) throw new Error('Invoice ID is required');

      const { data: invoiceMeta, error: invoiceMetaError } = await supabase
        .from('invoices')
        .select('id, user_id, courier_payment_mode')
        .eq('id', invoiceId)
        .eq('user_id', userId)
        .maybeSingle();

      if (invoiceMetaError) throw invoiceMetaError;
      if (!invoiceMeta?.id) throw new Error('Invois tidak ditemui');

      const isPlatformMode = resolveCourierPaymentModeForInvoice(invoiceMeta) === COURIER_PAYMENT_MODES.PLATFORM;
      if (isPlatformMode) {
        throw new Error('Mode platform: bayaran courier tidak direkodkan di wallet.');
      }

      const normalizedCost = normalizeCurrencyAmount(shippingCost, {
        label: 'Kos courier',
        allowEmptyAsZero: false,
      });
      if (!normalizedCost.ok) {
        throw new Error(normalizedCost.message);
      }

      const normalizedNotes = normalizeTextInput(notes);
      if (normalizedNotes.length > SHIPMENT_NOTES_MAX_LENGTH) {
        throw new Error(`Catatan maksimum ${SHIPMENT_NOTES_MAX_LENGTH} aksara.`);
      }

      let paidAtIso = null;
      if (paidAt !== null && paidAt !== undefined && String(paidAt).trim() !== '') {
        const parsedPaidAt = new Date(paidAt);
        if (Number.isNaN(parsedPaidAt.getTime())) {
          throw new Error('Tarikh bayaran tidak sah.');
        }
        paidAtIso = parsedPaidAt.toISOString();
      }

      const { data, error } = await supabase.rpc('mark_shipment_courier_paid', {
        p_invoice_id: invoiceId,
        p_user_id: userId,
        p_shipping_cost: normalizedCost.value,
        p_wallet_id: walletId,
        p_paid_at: paidAtIso,
        p_notes: normalizedNotes || null,
      });

      if (error) {
        throw error;
      }

      const response = Array.isArray(data) ? data[0] : null;
      if (!response?.success) {
        throw new Error(response?.message || 'Gagal rekod bayaran courier');
      }

      return response;
    },
    onSuccess: (_, { invoiceId }) => {
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoice-shipment', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-items', userId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-sales', userId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-pending-shipping', userId] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['wallets', userId] });
      queryClient.invalidateQueries({ queryKey: ['transactions', userId, 'all'] });
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'transactions' && query.queryKey.includes(userId),
      });
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'wallet-cashflow-trend' && query.queryKey[1] === userId,
      });
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'wallet-cashflow-breakdown' && query.queryKey[1] === userId,
      });
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'wallet-monthly-summary' && query.queryKey[1] === userId,
      });
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'wallet-monthly-transactions-export' && query.queryKey[1] === userId,
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'dashboard-expenses' && query.queryKey[1] === userId
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'business-wallets' && query.queryKey[1] === userId
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'wallet-cashflow-trend' && query.queryKey[1] === userId
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'wallet-cashflow-breakdown' && query.queryKey[1] === userId
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'wallet-monthly-summary' && query.queryKey[1] === userId
      });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'wallet-monthly-transactions-export' && query.queryKey[1] === userId
      });
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
  useProcessInvoiceReturn,
  useUpdateInvoiceShippingCharged,
  useInvoiceShipment,
  useSaveInvoiceShipment,
  useUpdateInvoiceShipmentStatus,
  useMarkShipmentCourierPaid,
  createAutoInvoiceForSoldItem,
};
