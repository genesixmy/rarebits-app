import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Select } from '@/components/ui/select';
import { SwitchToggle } from '@/components/ui/switch-toggle';
import { Trash2, Plus, X, ChevronLeft, ChevronDown, ChevronUp, Star } from 'lucide-react';
import { format } from 'date-fns';
import { ms } from 'date-fns/locale';
import toast from 'react-hot-toast';
import {
  PLATFORM_FEE_TYPES,
  buildInvoiceFeeSnapshots,
  calculatePlatformFeeAmount,
  formatPlatformFeeRuleLabel,
  getPlatformFeeAppliesToLabel,
  getPlatformFeeBaseAmount,
  normalizePlatformFeeAppliesTo,
  normalizePlatformFeeType,
} from '@/lib/platformFees';
import {
  COURIER_PAYMENT_MODES,
  isDeliveryRequired,
  normalizeCourierPaymentMode,
  resolveCourierPaymentModeForInvoice,
  resolveShippingMethodForInvoice,
  SHIPPING_METHODS,
} from '@/lib/shipping';

const getReservedQuantityFromItem = (item) => {
  const reservations = Array.isArray(item?.inventory_reservations) ? item.inventory_reservations : [];
  if (reservations.length > 0) {
    return reservations.reduce((sum, reservation) => {
      const qty = parseInt(reservation.quantity_reserved, 10);
      return sum + (Number.isNaN(qty) ? 0 : qty);
    }, 0);
  }

  const legacyReserved = parseInt(item?.quantity_reserved, 10);
  return Number.isNaN(legacyReserved) ? 0 : legacyReserved;
};

const getAvailableQuantityFromItem = (item) => {
  const rawTotal = parseInt(item?.quantity, 10);
  const totalQuantity = Number.isNaN(rawTotal) ? 1 : rawTotal;
  const reservedQuantity = getReservedQuantityFromItem(item);
  return Math.max(totalQuantity - reservedQuantity, 0);
};

const getClientAwareAvailability = (item, clientId) => {
  const rawTotal = parseInt(item?.quantity, 10);
  const totalQuantity = Number.isNaN(rawTotal) ? 1 : rawTotal;
  const reservations = Array.isArray(item?.inventory_reservations) ? item.inventory_reservations : [];

  if (reservations.length === 0) {
    const legacyReserved = parseInt(item?.quantity_reserved, 10);
    const reservedTotal = Number.isNaN(legacyReserved) ? 0 : legacyReserved;
    return Math.max(totalQuantity - reservedTotal, 0);
  }

  const reservedTotal = reservations.reduce((sum, reservation) => {
    const qty = parseInt(reservation.quantity_reserved, 10);
    return sum + (Number.isNaN(qty) ? 0 : qty);
  }, 0);

  if (!clientId) {
    return Math.max(totalQuantity - reservedTotal, 0);
  }

  const reservedForClient = reservations.reduce((sum, reservation) => {
    const qty = parseInt(reservation.quantity_reserved, 10);
    if (Number.isNaN(qty)) return sum;
    return reservation.customer_id === clientId ? sum + qty : sum;
  }, 0);

  const reservedByOthers = Math.max(reservedTotal - reservedForClient, 0);
  return Math.max(totalQuantity - reservedByOthers, 0);
};

const parseNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(parsed, 0);
};

const roundCurrencyAmount = (value) => Math.round(parseNonNegativeNumber(value, 0) * 100) / 100;
const SHIPPING_CHARGED_CAP = 9999;
const SETTLED_INVOICE_STATUSES = new Set(['paid', 'partially_returned', 'returned']);
const INVOICE_READ_SYNC_MAX_ATTEMPTS = 6;
const INVOICE_READ_SYNC_DELAY_MS = 180;

const getLineQuantity = (item) => Math.max(parseInt(item?.quantity, 10) || 1, 1);

const getLineUnitPrice = (item) => {
  if (item?.unit_price === null || item?.unit_price === undefined || item?.unit_price === '') {
    return parseNonNegativeNumber(item?.selling_price, 0);
  }
  return parseNonNegativeNumber(item.unit_price, 0);
};

const LOW_STOCK_THRESHOLD = 2;
const HIGH_RESERVED_RATIO = 0.6;

const resolveReservationName = (reservation, clientNameById) => {
  if (reservation?.customer_name) return reservation.customer_name;
  if (reservation?.customer_id && clientNameById?.has(reservation.customer_id)) {
    return clientNameById.get(reservation.customer_id);
  }
  return 'Tanpa pelanggan';
};

const getReservationBreakdown = (item, clientNameById) => {
  const reservations = Array.isArray(item?.inventory_reservations) ? item.inventory_reservations : [];
  if (reservations.length === 0) return [];

  const summary = new Map();
  reservations.forEach((reservation) => {
    const qty = parseInt(reservation.quantity_reserved, 10);
    if (Number.isNaN(qty) || qty <= 0) return;
    const name = resolveReservationName(reservation, clientNameById);
    summary.set(name, (summary.get(name) || 0) + qty);
  });

  return Array.from(summary.entries()).map(([name, quantity]) => ({ name, quantity }));
};

const getReservationSummaryByCustomer = (item, clientNameById) => {
  const reservations = Array.isArray(item?.inventory_reservations) ? item.inventory_reservations : [];
  if (reservations.length === 0) {
    return { total: 0, entries: [] };
  }

  let total = 0;
  const map = new Map();

  reservations.forEach((reservation) => {
    const qty = parseInt(reservation.quantity_reserved, 10);
    if (Number.isNaN(qty) || qty <= 0) return;
    total += qty;

    const name = resolveReservationName(reservation, clientNameById);
    const key = reservation.customer_id || `name:${name}`;
    const existing = map.get(key) || { name, quantity: 0, customer_id: reservation.customer_id || null };
    existing.quantity += qty;
    map.set(key, existing);
  });

  return { total, entries: Array.from(map.values()) };
};

const formatRM = (value) => `RM ${formatCurrency(value)}`;

const DEFAULT_INVOICE_PLATFORM_OPTIONS = [
  'Manual',
  'Carousell',
  'Shopee',
  'TikTok Shop',
  'Lazada',
  'Facebook Marketplace',
  'Instagram',
  'Mudah.my',
  'Website',
  'Event',
  'Kedai/Stor',
];

const normalizePlatformLabel = (value) => String(value || '').trim();

const normalizeInvoiceFeeSnapshot = (snapshot, baseAmounts) => {
  const feeType = normalizePlatformFeeType(snapshot?.fee_type);
  const appliesTo = normalizePlatformFeeAppliesTo(snapshot?.applies_to);
  const feeValue = roundCurrencyAmount(snapshot?.fee_value);
  const normalizedBaseAmount = getPlatformFeeBaseAmount(appliesTo, baseAmounts);
  const amount = calculatePlatformFeeAmount(normalizedBaseAmount, {
    fee_type: feeType,
    fee_value: feeValue,
  });

  return {
    fee_rule_id: snapshot?.fee_rule_id || null,
    name: String(snapshot?.name || '').trim() || 'Platform Fee',
    fee_type: feeType,
    applies_to: appliesTo,
    fee_value: feeValue,
    base_amount: normalizedBaseAmount,
    amount,
  };
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildFeeOverrideMap = (snapshots = []) => (
  (Array.isArray(snapshots) ? snapshots : []).reduce((acc, snapshot) => {
    const ruleId = snapshot?.fee_rule_id;
    const parsedOverride = Number.parseFloat(snapshot?.amount_override);
    if (!ruleId || !Number.isFinite(parsedOverride) || parsedOverride < 0) return acc;
    acc[ruleId] = roundCurrencyAmount(parsedOverride);
    return acc;
  }, {})
);

const getEffectiveFeeAmount = (snapshot) => {
  const parsedOverride = Number.parseFloat(snapshot?.amount_override);
  if (Number.isFinite(parsedOverride) && parsedOverride >= 0) {
    return roundCurrencyAmount(parsedOverride);
  }
  return roundCurrencyAmount(snapshot?.amount);
};

const InvoiceFormPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { invoiceId } = useParams();
  const [selectedClientId, setSelectedClientId] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedFeeRuleIds, setSelectedFeeRuleIds] = useState([]);
  const [savedInvoiceFees, setSavedInvoiceFees] = useState([]);
  const [feeOverridesByRuleId, setFeeOverridesByRuleId] = useState({});
  const [editingFeeOverrideRuleId, setEditingFeeOverrideRuleId] = useState(null);
  const [feeOverrideInput, setFeeOverrideInput] = useState('');
  const [shippingMethod, setShippingMethod] = useState(SHIPPING_METHODS.WALK_IN);
  const [courierPaymentMode, setCourierPaymentMode] = useState(COURIER_PAYMENT_MODES.SELLER);
  const [shippingChargedInput, setShippingChargedInput] = useState('0.00');
  const [shippingChargedError, setShippingChargedError] = useState('');
  const [invoicePlatform, setInvoicePlatform] = useState('Manual');
  const [selectedItems, setSelectedItems] = useState([]);
  const [manualItems, setManualItems] = useState([]);
  const [showItemSelector, setShowItemSelector] = useState(false);
  const [showManualItemForm, setShowManualItemForm] = useState(false);
  const [manualItemName, setManualItemName] = useState('');
  const [manualItemQuantity, setManualItemQuantity] = useState('1');
  const [manualItemPrice, setManualItemPrice] = useState('');
  const [manualItemCost, setManualItemCost] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [initialItemLoaded, setInitialItemLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedItemIds, setExpandedItemIds] = useState([]);
  const [quickAddSkippedCount, setQuickAddSkippedCount] = useState(0);
  const customerFieldFocusRef = useRef(null);
  const selectedFeeRuleIdsRef = useRef([]);
  const feeOverridesByRuleIdRef = useRef({});

  // Get current user
  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
  });

  const userId = authData?.session?.user?.id;

  // Fetch configured platform fee rules for the user.
  const { data: platformFeeRules = [] } = useQuery({
    queryKey: ['platform-fee-rules', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_fee_rules')
        .select('id, name, fee_type, applies_to, fee_value, is_active')
        .eq('user_id', userId);

      if (error) throw error;
      return (data || []).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ms'));
    },
    enabled: !!userId,
  });

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

  const selectedClient = selectedClientId
    ? clients.find((client) => client.id === selectedClientId)
    : null;
  const selectedClientName = selectedClient?.name || '';
  const clientNameById = useMemo(() => {
    const map = new Map();
    clients.forEach((client) => {
      if (client?.id) {
        map.set(client.id, client.name || 'Tanpa pelanggan');
      }
    });
    return map;
  }, [clients]);

  // Build quick-add payload from navigation state (bulk + single + legacy fallback).
  const quickAddPayloadById = useMemo(() => {
    const map = new Map();

    const applyPayloadEntry = (entry, fallbackId = null) => {
      const itemId = entry?.id || fallbackId;
      if (!itemId) return;

      const parsedAvailableQty = parseInt(entry?.available_qty, 10);
      const safeAvailableQty = Number.isNaN(parsedAvailableQty)
        ? null
        : Math.max(parsedAvailableQty, 0);

      const existing = map.get(itemId);
      if (existing) {
        map.set(itemId, {
          ...existing,
          quantity_seed: existing.quantity_seed + 1,
          // Preserve the smaller availability cap if both exist.
          available_qty:
            safeAvailableQty === null
              ? existing.available_qty
              : existing.available_qty === null
                ? safeAvailableQty
                : Math.min(existing.available_qty, safeAvailableQty),
        });
        return;
      }

      map.set(itemId, {
        id: itemId,
        name: entry?.name || '',
        selling_price: entry?.selling_price ?? null,
        available_qty: safeAvailableQty,
        quantity_seed: 1,
      });
    };

    const bulkItems = Array.isArray(location.state?.quickAddItems)
      ? location.state.quickAddItems
      : [];
    bulkItems.forEach((entry) => applyPayloadEntry(entry));

    const hasStructuredQuickAdd = bulkItems.length > 0 || Boolean(location.state?.quickAddItem);
    if (location.state?.quickAddItem) {
      applyPayloadEntry(location.state.quickAddItem);
    }

    // `itemId` is legacy fallback only. Avoid double-counting when
    // modern quick-add payload (`quickAddItem` / `quickAddItems`) already exists.
    if (!hasStructuredQuickAdd && location.state?.itemId) {
      applyPayloadEntry(null, location.state.itemId);
    }

    return map;
  }, [location.state]);

  const quickAddItemIds = useMemo(
    () => Array.from(quickAddPayloadById.keys()),
    [quickAddPayloadById]
  );

  const { data: stateItems = [], isLoading: isLoadingStateItems } = useQuery({
    queryKey: ['invoice-quick-add-items', userId, quickAddItemIds],
    queryFn: async () => {
      if (!userId || quickAddItemIds.length === 0) return [];

      const { data, error } = await supabase
        .from('items')
        .select('*, client:clients(id, name), inventory_reservations(id, quantity_reserved, customer_id, customer_name, created_at)')
        .eq('user_id', userId)
        .in('id', quickAddItemIds);

      if (error) {
        console.error('[InvoiceFormPage] Error fetching quick-add items:', error);
        throw error;
      }

      const itemById = new Map((data || []).map((item) => [item.id, item]));
      return quickAddItemIds.map((id) => itemById.get(id)).filter(Boolean);
    },
    enabled: !!userId && quickAddItemIds.length > 0,
  });

  // Fetch available items (exclude sold)
  const { data: uninvoicedItems = [] } = useQuery({
    queryKey: ['available-items', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select('*, client:clients(id, name), inventory_reservations(id, quantity_reserved, customer_id, customer_name, created_at)')
        .eq('user_id', userId)
        .neq('status', 'terjual')
        .order('is_favorite', { ascending: false })
        .order('created_at', { ascending: false });

      console.log('[InvoiceFormPage] Available items query result:', { data, error, count: data?.length });
      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });

  // Fetch existing invoice if editing
  const { data: existingInvoice } = useInvoiceDetail(invoiceId);

  // Initialize form with existing invoice data
  useEffect(() => {
    if (existingInvoice) {
      setSelectedClientId(existingInvoice.client_id);
      setNotes(existingInvoice.notes || '');
      setShippingMethod(resolveShippingMethodForInvoice(existingInvoice));
      setCourierPaymentMode(resolveCourierPaymentModeForInvoice(existingInvoice));
      setShippingChargedInput(roundCurrencyAmount(existingInvoice.shipping_charged || 0).toFixed(2));
      setShippingChargedError('');
      setInvoicePlatform(normalizePlatformLabel(existingInvoice.platform) || 'Manual');
      const existingFees = Array.isArray(existingInvoice.invoice_fees)
        ? [...existingInvoice.invoice_fees].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
        : [];
      setSavedInvoiceFees(existingFees);
      const initialFeeRuleIds = [...new Set(existingFees.map((fee) => fee.fee_rule_id).filter(Boolean))];
      const initialOverrides = buildFeeOverrideMap(existingFees);
      selectedFeeRuleIdsRef.current = initialFeeRuleIds;
      feeOverridesByRuleIdRef.current = initialOverrides;
      setSelectedFeeRuleIds(initialFeeRuleIds);
      setFeeOverridesByRuleId(initialOverrides);
      setEditingFeeOverrideRuleId(null);
      setFeeOverrideInput('');
      const existingInvoiceItems = Array.isArray(existingInvoice.invoice_items)
        ? existingInvoice.invoice_items
        : [];

      const existingInventoryItems = existingInvoiceItems
        .filter((ii) => !ii?.is_manual && ii?.item_id)
        .map((ii) => ({
          ...(ii.item || {}),
          id: ii.item_id,
          name: ii.item?.name || ii.item_name || 'Item',
          invoice_item_id: ii.id,
          unit_price: parseNonNegativeNumber(ii.unit_price, 0),
          selling_price: parseNonNegativeNumber(ii.unit_price, 0),
          cost_price: parseNonNegativeNumber(ii.cost_price, 0),
          quantity: Math.max(parseInt(ii.quantity, 10) || 1, 1),
          line_total: roundCurrencyAmount(ii.line_total || 0),
        }));

      const existingManualItems = existingInvoiceItems
        .filter((ii) => ii?.is_manual || !ii?.item_id)
        .map((ii, index) => ({
          id: `manual-row-${ii.id || index}`,
          invoice_item_id: ii.id,
          name: ii.item_name || ii.item?.name || 'Manual Item',
          selling_price: parseNonNegativeNumber(ii.unit_price, 0),
          cost_price: parseNonNegativeNumber(ii.cost_price, 0),
          quantity: Math.max(parseInt(ii.quantity, 10) || 1, 1),
          category: 'Manual',
          is_manual: true,
        }));

      setSelectedItems(existingInventoryItems);
      setManualItems(existingManualItems);
    }
  }, [existingInvoice]);

  // Initialize form with quick-add items from inventory (single or bulk).
  useEffect(() => {
    if (invoiceId || initialItemLoaded || quickAddItemIds.length === 0 || isLoadingStateItems) return;

    const stateItemById = new Map(stateItems.map((item) => [item.id, item]));
    let skippedCount = 0;
    let addedCount = 0;
    let defaultClientId = null;

    setSelectedItems((prevItems) => {
      const nextItems = [...prevItems];

      quickAddItemIds.forEach((itemId) => {
        const payload = quickAddPayloadById.get(itemId);
        const requestedQuantity = Math.max(parseInt(payload?.quantity_seed, 10) || 1, 1);
        const liveItem = stateItemById.get(itemId);

        if (!liveItem) {
          skippedCount += requestedQuantity;
          return;
        }

        const availabilityClientId = liveItem.client_id || selectedClientId || null;
        const liveAvailableQuantity = getClientAwareAvailability(liveItem, availabilityClientId);
        const stateAvailableQuantity = Number.isFinite(parseInt(payload?.available_qty, 10))
          ? Math.max(parseInt(payload?.available_qty, 10), 0)
          : null;

        const availableQuantity = stateAvailableQuantity === null
          ? liveAvailableQuantity
          : Math.min(liveAvailableQuantity, stateAvailableQuantity);

        if (availableQuantity <= 0) {
          skippedCount += requestedQuantity;
          return;
        }

        const maxQuantity = Math.max(availableQuantity, 1);
        const existingIndex = nextItems.findIndex((item) => item.id === itemId && !item.is_manual);

        if (existingIndex >= 0) {
          const currentQuantity = Math.max(parseInt(nextItems[existingIndex].quantity, 10) || 1, 1);
          const mergedQuantity = Math.min(currentQuantity + requestedQuantity, maxQuantity);
          nextItems[existingIndex] = {
            ...nextItems[existingIndex],
            maxQuantity,
            availableQuantity,
            quantity: mergedQuantity,
            unit_price: nextItems[existingIndex].unit_price ?? liveItem.selling_price,
            isQuickAdded: true,
          };
          addedCount += Math.max(mergedQuantity - currentQuantity, 0);
          return;
        }

        const newQuantity = Math.min(requestedQuantity, maxQuantity);
        nextItems.push({
          ...liveItem,
          quantity: newQuantity,
          unit_price: liveItem.selling_price,
          maxQuantity,
          availableQuantity,
          isQuickAdded: true,
        });
        addedCount += newQuantity;

        if (!defaultClientId && liveItem.client_id) {
          defaultClientId = liveItem.client_id;
        }
      });

      return nextItems;
    });

    if (!selectedClientId && defaultClientId) {
      setSelectedClientId(defaultClientId);
    }

    setQuickAddSkippedCount(skippedCount);
    setInitialItemLoaded(true);

    if (addedCount > 0) {
      toast.success(`${addedCount} item ditambah dari Inventory`);
    }

    if (skippedCount > 0) {
      toast.error(`${skippedCount} item tidak dapat ditambah (stok habis atau item tidak ditemui).`);
    }

    window.requestAnimationFrame(() => {
      customerFieldFocusRef.current?.focus();
    });
  }, [
    invoiceId,
    initialItemLoaded,
    isLoadingStateItems,
    quickAddItemIds,
    quickAddPayloadById,
    selectedClientId,
    stateItems,
  ]);

  const selectedInventoryIds = selectedItems
    .filter((item) => item?.id && !item.is_manual)
    .map((item) => item.id)
    .sort()
    .join('|');

  useEffect(() => {
    if (!userId || !selectedInventoryIds) return;

    const fetchAvailability = async () => {
      const ids = selectedInventoryIds.split('|').filter(Boolean);
      if (ids.length === 0) return;

      const { data, error } = await supabase
        .from('items')
        .select('id, name, quantity, quantity_reserved, inventory_reservations(quantity_reserved, customer_id)')
        .in('id', ids);

      if (error) {
        console.error('[InvoiceFormPage] Error fetching availability:', error);
        return;
      }

      const availabilityById = new Map(
        (data || []).map((item) => [
          item.id,
          getClientAwareAvailability(item, selectedClientId || null),
        ])
      );

      setSelectedItems((prevItems) => {
        let updated = false;
        const nextItems = prevItems.map((item) => {
          if (!item?.id || item.is_manual) return item;
          const availableQuantity = availabilityById.get(item.id);
          if (availableQuantity === undefined) return item;

          const maxQuantity = Math.max(availableQuantity, 1);
          const nextQuantity = Math.min(item.quantity || 1, maxQuantity);

          if (
            item.maxQuantity === maxQuantity &&
            item.availableQuantity === availableQuantity &&
            item.quantity === nextQuantity
          ) {
            return item;
          }

          updated = true;
          return {
            ...item,
            maxQuantity,
            availableQuantity,
            quantity: nextQuantity,
          };
        });

        return updated ? nextItems : prevItems;
      });
    };

    fetchAvailability();
  }, [userId, selectedInventoryIds, selectedClientId]);

  // Mutations
  const createInvoice = useCreateInvoice();
  const addItemToInvoice = useAddItemToInvoice();
  const removeItemFromInvoice = useRemoveItemFromInvoice();

  // REMOVED: Auto-fill client's items when client is selected
  // User should explicitly add items via "Tambah Item" button
  // This gives user more control over which items to include in invoice

  // Filter available items
  const filteredAvailableItems = uninvoicedItems.filter((item) => {
    const availableQuantity = getClientAwareAvailability(item, selectedClientId || null);
    return (
      availableQuantity > 0 &&
      !selectedItems.find((si) => si.id === item.id) &&
      (!searchTerm ||
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.category?.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  });

  const reservedForClientByItemId = useMemo(() => {
    if (!selectedClientId) return new Map();
    const map = new Map();
    filteredAvailableItems.forEach((item) => {
      const { entries } = getReservationSummaryByCustomer(item, clientNameById);
      const reservedForClient = entries.reduce((sum, entry) => {
        if (entry.customer_id === selectedClientId) {
          return sum + entry.quantity;
        }
        return sum;
      }, 0);
      if (reservedForClient > 0) {
        map.set(item.id, reservedForClient);
      }
    });
    return map;
  }, [filteredAvailableItems, selectedClientId, clientNameById]);

  const suggestedAvailableItems = useMemo(() => {
    if (!selectedClientId) return [];
    return filteredAvailableItems
      .map((item) => ({
        item,
        reservedForClient: reservedForClientByItemId.get(item.id) || 0,
      }))
      .filter((entry) => entry.reservedForClient > 0)
      .sort((a, b) => b.reservedForClient - a.reservedForClient);
  }, [filteredAvailableItems, selectedClientId, reservedForClientByItemId]);

  const baseSortedAvailableItems = useMemo(() => {
    if (!selectedClientId || reservedForClientByItemId.size === 0) return filteredAvailableItems;
    const suggestedIds = reservedForClientByItemId;
    return [...filteredAvailableItems].sort((a, b) => {
      const aSuggested = suggestedIds.has(a.id);
      const bSuggested = suggestedIds.has(b.id);
      if (aSuggested !== bSuggested) return aSuggested ? -1 : 1;
      if (aSuggested && bSuggested) {
        return (suggestedIds.get(b.id) || 0) - (suggestedIds.get(a.id) || 0);
      }
      return 0;
    });
  }, [filteredAvailableItems, selectedClientId, reservedForClientByItemId]);

  const sortedAvailableItems = useMemo(() => {
    return baseSortedAvailableItems
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const aFavorite = Boolean(a.item.is_favorite);
        const bFavorite = Boolean(b.item.is_favorite);

        if (aFavorite !== bFavorite) return aFavorite ? -1 : 1;
        return a.index - b.index;
      })
      .map((entry) => entry.item);
  }, [baseSortedAvailableItems]);

  // Calculate totals
  const subtotal = selectedItems.reduce((sum, item) => (
    sum + (getLineUnitPrice(item) * getLineQuantity(item))
  ), 0) + manualItems.reduce((sum, item) => (
    sum + (getLineUnitPrice(item) * getLineQuantity(item))
  ), 0);

  const totalCostPreview = selectedItems.reduce((sum, item) => (
    sum + (parseNonNegativeNumber(item?.cost_price, 0) * getLineQuantity(item))
  ), 0) + manualItems.reduce((sum, item) => (
    sum + (parseNonNegativeNumber(item?.cost_price, 0) * getLineQuantity(item))
  ), 0);

  const normalizedCourierPaymentMode = normalizeCourierPaymentMode(courierPaymentMode);
  const shippingCharged = normalizedCourierPaymentMode === COURIER_PAYMENT_MODES.PLATFORM
    ? 0
    : roundCurrencyAmount(shippingChargedInput);
  const deliveryRequired = isDeliveryRequired({
    shippingMethod,
    shippingCharged,
  });
  const platformFeeBaseAmounts = useMemo(() => ({
    item_subtotal: roundCurrencyAmount(subtotal),
    shipping_charged: roundCurrencyAmount(shippingCharged),
    total_collected: roundCurrencyAmount(subtotal + shippingCharged),
  }), [shippingCharged, subtotal]);
  const total = platformFeeBaseAmounts.total_collected;
  const feeRuleById = useMemo(
    () => new Map((platformFeeRules || []).map((rule) => [rule.id, rule])),
    [platformFeeRules]
  );
  const selectedFeeRules = useMemo(
    () => selectedFeeRuleIds.map((ruleId) => feeRuleById.get(ruleId)).filter(Boolean),
    [selectedFeeRuleIds, feeRuleById]
  );
  useEffect(() => {
    selectedFeeRuleIdsRef.current = selectedFeeRuleIds;
  }, [selectedFeeRuleIds]);
  useEffect(() => {
    feeOverridesByRuleIdRef.current = feeOverridesByRuleId;
  }, [feeOverridesByRuleId]);
  const selectableFeeRules = useMemo(
    () => (platformFeeRules || []).filter((rule) => Boolean(rule.is_active) || selectedFeeRuleIds.includes(rule.id)),
    [platformFeeRules, selectedFeeRuleIds]
  );
  const computedFeeSnapshots = useMemo(
    () => buildInvoiceFeeSnapshots(selectedFeeRules, platformFeeBaseAmounts),
    [platformFeeBaseAmounts, selectedFeeRules]
  );
  const isSettledInvoice = SETTLED_INVOICE_STATUSES.has(existingInvoice?.status || '');
  const liveFeeBreakdownRows = useMemo(
    () => computedFeeSnapshots.map((snapshot) => {
      const ruleId = snapshot?.fee_rule_id;
      const overrideValue = ruleId ? feeOverridesByRuleId[ruleId] : null;
      const hasOverride = Number.isFinite(overrideValue) && overrideValue >= 0;
      const amountOverride = hasOverride ? roundCurrencyAmount(overrideValue) : null;
      return {
        ...snapshot,
        amount_override: amountOverride,
        effective_amount: amountOverride ?? roundCurrencyAmount(snapshot.amount),
      };
    }),
    [computedFeeSnapshots, feeOverridesByRuleId]
  );
  const feeBreakdownRows = useMemo(() => {
    if (isSettledInvoice && Array.isArray(savedInvoiceFees) && savedInvoiceFees.length > 0) {
      return savedInvoiceFees.map((snapshot) => {
        const effectiveAmount = getEffectiveFeeAmount(snapshot);
        return {
          ...snapshot,
          amount: roundCurrencyAmount(snapshot?.amount),
          amount_override: Number.isFinite(Number.parseFloat(snapshot?.amount_override))
            ? roundCurrencyAmount(snapshot.amount_override)
            : null,
          effective_amount: effectiveAmount,
        };
      });
    }
    if (isSettledInvoice) {
      const legacyFeeAmount = roundCurrencyAmount(existingInvoice?.channel_fee_amount);
      if (legacyFeeAmount > 0) {
        return [{
          fee_rule_id: null,
          name: 'Caj Platform',
          fee_type: PLATFORM_FEE_TYPES.FLAT,
          applies_to: 'item_subtotal',
          fee_value: legacyFeeAmount,
          base_amount: roundCurrencyAmount(existingInvoice?.subtotal || 0),
          amount: legacyFeeAmount,
          amount_override: null,
          effective_amount: legacyFeeAmount,
        }];
      }
    }
    return liveFeeBreakdownRows;
  }, [
    existingInvoice?.channel_fee_amount,
    existingInvoice?.subtotal,
    isSettledInvoice,
    liveFeeBreakdownRows,
    savedInvoiceFees,
  ]);
  const platformFeeTotal = useMemo(
    () => roundCurrencyAmount(
      (feeBreakdownRows || []).reduce(
        (sum, snapshot) => sum + parseNonNegativeNumber(snapshot?.effective_amount, 0),
        0
      )
    ),
    [feeBreakdownRows]
  );
  const invoicePlatformOptions = useMemo(() => {
    const options = [...DEFAULT_INVOICE_PLATFORM_OPTIONS];
    const keySet = new Set(options.map((entry) => entry.toLowerCase()));

    const addOption = (rawValue) => {
      const normalized = normalizePlatformLabel(rawValue);
      if (!normalized) return;
      const key = normalized.toLowerCase();
      if (keySet.has(key)) return;
      keySet.add(key);
      options.push(normalized);
    };

    selectedItems.forEach((item) => {
      const soldPlatforms = Array.isArray(item?.sold_platforms) ? item.sold_platforms : [];
      const listingPlatforms = Array.isArray(item?.platforms) ? item.platforms : [];
      const source = soldPlatforms.length > 0 ? soldPlatforms : listingPlatforms;
      source.forEach(addOption);
    });

    addOption(invoicePlatform);
    return options;
  }, [selectedItems, invoicePlatform]);
  const platformLabel = useMemo(() => {
    const current = normalizePlatformLabel(invoicePlatform);
    return current || 'Manual';
  }, [invoicePlatform]);
  const grossProfitPreview = subtotal - totalCostPreview;
  const netProfitPreview = grossProfitPreview - platformFeeTotal;

  const handleAddItem = (item, quantityOverride = 1, options = { closeSelector: true }) => {
    // Start with quantity 1, max is item's available quantity
    const availableQuantity = getClientAwareAvailability(item, selectedClientId || null);

    if (availableQuantity <= 0) {
      toast.error(`Stok tidak mencukupi untuk ${item.name}. Available: ${availableQuantity}`);
      return;
    }

    const desiredQuantity = Math.max(1, parseInt(quantityOverride, 10) || 1);
    const maxQuantity = Math.max(availableQuantity, 1);
    const initialQuantity = Math.min(desiredQuantity, maxQuantity);
    if (desiredQuantity > maxQuantity) {
      toast.error(`Maximum kuantiti untuk item ini: ${maxQuantity}`);
    }

    const newItem = {
      ...item,
      quantity: initialQuantity,
      unit_price: parseNonNegativeNumber(item.selling_price, 0),
      maxQuantity,
      availableQuantity,
    };
    console.log('[InvoiceFormPage] handleAddItem - Adding item:', {
      itemId: item.id,
      itemName: item.name,
      availableQuantity,
      newItemMaxQuantity: newItem.maxQuantity,
      fullNewItem: newItem
    });
    setSelectedItems((prev) => [...prev, newItem]);
    if (options?.closeSelector) {
      setShowItemSelector(false);
      setSearchTerm('');
    }
  };

  const handleAddAllSuggested = () => {
    if (suggestedAvailableItems.length === 0) return;

    const newItems = suggestedAvailableItems.map(({ item, reservedForClient }) => {
      const availableQuantity = getClientAwareAvailability(item, selectedClientId || null);
      const maxQuantity = Math.max(availableQuantity, 1);
      const desiredQuantity = Math.max(1, reservedForClient || 1);
      const initialQuantity = Math.min(desiredQuantity, maxQuantity);

      return {
        ...item,
        quantity: initialQuantity,
        unit_price: parseNonNegativeNumber(item.selling_price, 0),
        maxQuantity,
        availableQuantity,
      };
    });

    setSelectedItems((prev) => [...prev, ...newItems]);
    setShowItemSelector(false);
    setSearchTerm('');
  };

  const toggleItemExpand = (itemId) => {
    setExpandedItemIds((prev) => (
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    ));
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
          const maxQty = item.maxQuantity ?? item.availableQuantity ?? item.quantity ?? 1;
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

  const handleUpdateUnitPrice = (itemId, nextPriceValue) => {
    setSelectedItems((prevItems) => prevItems.map((item) => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        unit_price: parseNonNegativeNumber(nextPriceValue, 0),
      };
    }));
  };

  const normalizeShippingChargedInput = (value) => {
    const raw = value === null || value === undefined ? '' : String(value);
    const cleaned = raw.replace(/,/g, '').replace(/\s+/g, '');

    if (!cleaned) {
      return { ok: true, value: 0, display: '0.00' };
    }

    const parsed = Number.parseFloat(cleaned);
    if (!Number.isFinite(parsed)) {
      return { ok: false, message: 'Caj pos tidak sah.' };
    }

    if (parsed < 0) {
      return { ok: false, message: 'Caj pos mesti 0 atau lebih.' };
    }

    if (parsed > SHIPPING_CHARGED_CAP) {
      return { ok: false, message: 'Nombor terlalu besar - semak semula.' };
    }

    const rounded = roundCurrencyAmount(parsed);
    return { ok: true, value: rounded, display: rounded.toFixed(2) };
  };

  const handleShippingMethodChange = (nextMethod) => {
    if (nextMethod === shippingMethod) return;

    if (nextMethod === SHIPPING_METHODS.WALK_IN && shippingCharged > 0) {
      const confirmed = window.confirm(
        'Caj pos akan diset kepada 0 dan info penghantaran akan disembunyikan. Teruskan?'
      );
      if (!confirmed) return;
      setShippingChargedInput('0.00');
      setShippingChargedError('');
    }

    setShippingMethod(nextMethod);
    if (nextMethod !== SHIPPING_METHODS.COURIER) {
      setCourierPaymentMode(COURIER_PAYMENT_MODES.SELLER);
    }
  };

  const handleCourierPaymentModeChange = (nextModeRaw) => {
    const nextMode = normalizeCourierPaymentMode(nextModeRaw);
    if (nextMode === normalizedCourierPaymentMode) return;

    if (nextMode === COURIER_PAYMENT_MODES.PLATFORM && shippingCharged > 0) {
      const confirmed = window.confirm(
        'Caj pos akan diset kepada RM0 kerana platform uruskan penghantaran. Teruskan?'
      );
      if (!confirmed) return;
    }

    setCourierPaymentMode(nextMode);
    setShippingChargedError('');

    if (nextMode === COURIER_PAYMENT_MODES.PLATFORM) {
      setShippingChargedInput('0.00');
    }
  };

  const handleShippingChargedBlur = () => {
    if (normalizedCourierPaymentMode === COURIER_PAYMENT_MODES.PLATFORM) {
      setShippingChargedInput('0.00');
      setShippingChargedError('');
      return true;
    }

    const normalized = normalizeShippingChargedInput(shippingChargedInput);
    if (!normalized.ok) {
      setShippingChargedError(normalized.message);
      return false;
    }

    setShippingChargedError('');
    setShippingChargedInput(normalized.display);

    if (normalized.value > 0 && shippingMethod !== SHIPPING_METHODS.COURIER) {
      setShippingMethod(SHIPPING_METHODS.COURIER);
      toast('Caj pos > 0, kaedah serahan ditukar ke Courier.');
    }

    return true;
  };

  const handleAddManualItem = () => {
    const cleanedName = manualItemName.trim();
    const parsedQuantity = parseInt(manualItemQuantity, 10);
    const parsedSellingPrice = parseFloat(manualItemPrice);
    const parsedCostPrice = manualItemCost === '' ? 0 : parseFloat(manualItemCost);

    if (!cleanedName) {
      toast.error('Sila isi nama item manual');
      return;
    }

    if (!Number.isFinite(parsedQuantity) || parsedQuantity < 1) {
      toast.error('Kuantiti manual mesti sekurang-kurangnya 1');
      return;
    }

    if (!Number.isFinite(parsedSellingPrice) || parsedSellingPrice < 0) {
      toast.error('Harga jual manual mesti 0 atau lebih');
      return;
    }

    if (!Number.isFinite(parsedCostPrice) || parsedCostPrice < 0) {
      toast.error('Kos manual mesti 0 atau lebih');
      return;
    }

    const newManualItem = {
      id: `manual-${Date.now()}`,
      name: cleanedName,
      selling_price: parsedSellingPrice,
      cost_price: parsedCostPrice,
      quantity: parsedQuantity,
      category: 'Manual',
      is_manual: true,
    };

    setManualItems([...manualItems, newManualItem]);
    setManualItemName('');
    setManualItemQuantity('1');
    setManualItemPrice('');
    setManualItemCost('');
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

  const validateInventoryAvailability = async () => {
    const inventoryItems = selectedItems.filter((item) => item?.id && !item.is_manual);
    if (inventoryItems.length === 0) return { ok: true };

    const itemIds = [...new Set(inventoryItems.map((item) => item.id))];
    const { data, error } = await supabase
      .from('items')
      .select('id, name, quantity, quantity_reserved, inventory_reservations(quantity_reserved, customer_id)')
      .in('id', itemIds);

    if (error) {
      console.error('[InvoiceFormPage] Error validating availability:', error);
      toast.error('Gagal menyemak stok. Sila cuba lagi.');
      return { ok: false };
    }

    const availabilityById = new Map(
      (data || []).map((item) => [
        item.id,
        {
          available: getClientAwareAvailability(item, selectedClientId || null),
          name: item.name || 'Item',
        },
      ])
    );

    const shortages = [];
    inventoryItems.forEach((item) => {
      const availability = availabilityById.get(item.id);
      const requested = parseInt(item.quantity, 10) || 1;
      const available = availability?.available ?? 0;
      const name = availability?.name || item.name || 'Item';

      if (!availability) {
        shortages.push({ name, available: 0, requested });
        return;
      }

      if (requested > available) {
        shortages.push({ name, available, requested });
      }
    });

    if (shortages.length > 0) {
      const first = shortages[0];
      toast.error(`Stok tidak mencukupi untuk ${first.name}. Available: ${first.available}, Requested: ${first.requested}`);
      return { ok: false, shortages };
    }

    return { ok: true };
  };

  const handleFeeRuleToggle = (ruleId, checked) => {
    if (!ruleId || isSettledInvoice) return;
    setSelectedFeeRuleIds((prev) => {
      let nextIds = prev;
      if (checked) {
        nextIds = prev.includes(ruleId) ? prev : [...prev, ruleId];
      } else {
        nextIds = prev.filter((id) => id !== ruleId);
        setFeeOverridesByRuleId((prevOverrides) => {
          if (!(ruleId in prevOverrides)) return prevOverrides;
          const nextOverrides = { ...prevOverrides };
          delete nextOverrides[ruleId];
          feeOverridesByRuleIdRef.current = nextOverrides;
          return nextOverrides;
        });
        if (editingFeeOverrideRuleId === ruleId) {
          setEditingFeeOverrideRuleId(null);
          setFeeOverrideInput('');
        }
      }
      selectedFeeRuleIdsRef.current = nextIds;
      return nextIds;
    });
  };

  const handleOpenFeeOverrideEditor = (snapshot) => {
    if (isSettledInvoice) return;
    const ruleId = snapshot?.fee_rule_id;
    if (!ruleId) return;
    const currentEffective = getEffectiveFeeAmount(snapshot);
    setEditingFeeOverrideRuleId(ruleId);
    setFeeOverrideInput(currentEffective.toFixed(2));
  };

  const handleSaveFeeOverride = () => {
    if (!editingFeeOverrideRuleId || isSettledInvoice) return;
    const parsed = Number.parseFloat(String(feeOverrideInput).replace(/,/g, '.').trim());
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error('Amaun override mesti 0 atau lebih.');
      return;
    }

    const normalized = roundCurrencyAmount(parsed);
    setFeeOverridesByRuleId((prev) => {
      const next = { ...prev, [editingFeeOverrideRuleId]: normalized };
      feeOverridesByRuleIdRef.current = next;
      return next;
    });
    setEditingFeeOverrideRuleId(null);
    setFeeOverrideInput('');
  };

  const handleResetFeeOverride = (ruleId) => {
    if (!ruleId || isSettledInvoice) return;
    setFeeOverridesByRuleId((prev) => {
      if (!(ruleId in prev)) return prev;
      const next = { ...prev };
      delete next[ruleId];
      feeOverridesByRuleIdRef.current = next;
      return next;
    });
    if (editingFeeOverrideRuleId === ruleId) {
      setEditingFeeOverrideRuleId(null);
      setFeeOverrideInput('');
    }
  };

  const syncInvoiceItemsForEdit = async (targetInvoiceId) => {
    if (!targetInvoiceId || !userId) return;

    const { data: existingRows, error: existingRowsError } = await supabase
      .from('invoice_items')
      .select('id, item_id, is_manual')
      .eq('invoice_id', targetInvoiceId);

    if (existingRowsError) throw existingRowsError;

    const rows = Array.isArray(existingRows) ? existingRows : [];
    const existingRowById = new Map(rows.map((row) => [row.id, row]));
    const keptRowIds = new Set();

    const normalizedInventoryLines = selectedItems
      .filter((item) => item?.id && !item.is_manual)
      .map((item) => {
        const quantity = Math.max(parseInt(item?.quantity, 10) || 1, 1);
        const unitPrice = parseNonNegativeNumber(item?.unit_price, 0);
        return {
          invoice_item_id: item?.invoice_item_id || null,
          item_id: item.id,
          quantity,
          unit_price: unitPrice,
          cost_price: parseNonNegativeNumber(item?.cost_price, 0),
          line_total: roundCurrencyAmount(unitPrice * quantity),
        };
      });

    for (const line of normalizedInventoryLines) {
      const rowId = line.invoice_item_id;
      if (rowId && existingRowById.has(rowId)) {
        keptRowIds.add(rowId);
        const { error: updateLineError } = await supabase
          .from('invoice_items')
          .update({
            quantity: line.quantity,
            unit_price: line.unit_price,
            cost_price: line.cost_price,
            line_total: line.line_total,
          })
          .eq('id', rowId)
          .eq('invoice_id', targetInvoiceId);

        if (updateLineError) throw updateLineError;
        continue;
      }

      const { data: addResult, error: addError } = await supabase.rpc('add_item_to_invoice', {
        p_invoice_id: targetInvoiceId,
        p_item_id: line.item_id,
        p_quantity: line.quantity,
        p_unit_price: line.unit_price,
        p_user_id: userId,
      });

      if (addError) throw addError;
      if (!addResult?.[0]?.success) {
        throw new Error(addResult?.[0]?.message || 'Gagal tambah item ke invois.');
      }
    }

    const normalizedManualLines = manualItems.map((item) => {
      const quantity = Math.max(parseInt(item?.quantity, 10) || 1, 1);
      const unitPrice = parseNonNegativeNumber(item?.selling_price, 0);
      return {
        invoice_item_id: item?.invoice_item_id || null,
        name: String(item?.name || '').trim() || 'Manual Item',
        quantity,
        unit_price: unitPrice,
        cost_price: parseNonNegativeNumber(item?.cost_price, 0),
        line_total: roundCurrencyAmount(unitPrice * quantity),
      };
    });

    for (const line of normalizedManualLines) {
      const rowId = line.invoice_item_id;
      if (rowId && existingRowById.has(rowId)) {
        keptRowIds.add(rowId);
        const { error: updateLineError } = await supabase
          .from('invoice_items')
          .update({
            item_id: null,
            is_manual: true,
            item_name: line.name,
            quantity: line.quantity,
            unit_price: line.unit_price,
            cost_price: line.cost_price,
            line_total: line.line_total,
          })
          .eq('id', rowId)
          .eq('invoice_id', targetInvoiceId);

        if (updateLineError) throw updateLineError;
        continue;
      }

      const { data: addResult, error: addError } = await supabase.rpc('add_manual_item_to_invoice', {
        p_invoice_id: targetInvoiceId,
        p_item_name: line.name,
        p_quantity: line.quantity,
        p_unit_price: line.unit_price,
        p_cost_price: line.cost_price,
        p_user_id: userId,
      });

      if (addError) throw addError;
      if (!addResult?.[0]?.success) {
        throw new Error(addResult?.[0]?.message || 'Gagal tambah item manual ke invois.');
      }
    }

    const rowsToDelete = rows.filter((row) => !keptRowIds.has(row.id));
    const inventoryRowsToDelete = rowsToDelete.filter((row) => row?.item_id);
    const manualRowIdsToDelete = rowsToDelete
      .filter((row) => !row?.item_id)
      .map((row) => row.id);

    for (const row of inventoryRowsToDelete) {
      const { data: removeResult, error: removeError } = await supabase.rpc('remove_item_from_invoice', {
        p_invoice_id: targetInvoiceId,
        p_item_id: row.item_id,
        p_user_id: userId,
      });

      if (removeError) throw removeError;
      if (!removeResult?.[0]?.success) {
        throw new Error(removeResult?.[0]?.message || 'Gagal padam item dari invois.');
      }
    }

    if (manualRowIdsToDelete.length > 0) {
      const { error: deleteManualRowsError } = await supabase
        .from('invoice_items')
        .delete()
        .eq('invoice_id', targetInvoiceId)
        .in('id', manualRowIdsToDelete);

      if (deleteManualRowsError) throw deleteManualRowsError;
    }
  };

  const replaceInvoiceFeeSnapshots = async (targetInvoiceId) => {
    if (!targetInvoiceId || !userId) return;

    const { data: invoiceRow, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, subtotal, shipping_charged, status')
      .eq('id', targetInvoiceId)
      .eq('user_id', userId)
      .single();

    if (invoiceError) throw invoiceError;
    if (SETTLED_INVOICE_STATUSES.has(invoiceRow.status)) {
      throw new Error('Invois dibayar tidak boleh ubah caj platform.');
    }

    const normalizedSubtotal = roundCurrencyAmount(invoiceRow.subtotal || 0);
    const normalizedShippingCharged = roundCurrencyAmount(invoiceRow.shipping_charged || 0);
    const baseAmounts = {
      item_subtotal: normalizedSubtotal,
      shipping_charged: normalizedShippingCharged,
      total_collected: roundCurrencyAmount(normalizedSubtotal + normalizedShippingCharged),
    };
    const selectedRuleIds = selectedFeeRuleIdsRef.current || [];
    const selectedRules = selectedRuleIds
      .map((ruleId) => feeRuleById.get(ruleId))
      .filter(Boolean);
    const baseSnapshots = buildInvoiceFeeSnapshots(selectedRules, baseAmounts);
    const overrides = feeOverridesByRuleIdRef.current || {};
    const snapshotsToStore = baseSnapshots.map((snapshot) => {
      const normalizedSnapshot = normalizeInvoiceFeeSnapshot(snapshot, baseAmounts);
      const ruleId = normalizedSnapshot.fee_rule_id;
      const overrideValue = ruleId ? overrides[ruleId] : null;
      const hasOverride = Number.isFinite(overrideValue) && overrideValue >= 0;
      return {
        ...normalizedSnapshot,
        amount_override: hasOverride ? roundCurrencyAmount(overrideValue) : null,
      };
    });
    const feeTotal = roundCurrencyAmount(
      snapshotsToStore.reduce((sum, snapshot) => sum + getEffectiveFeeAmount(snapshot), 0)
    );

    const { error: deleteError } = await supabase
      .from('invoice_fees')
      .delete()
      .eq('invoice_id', targetInvoiceId)
      .eq('user_id', userId);

    if (deleteError) throw deleteError;

    if (snapshotsToStore.length > 0) {
      const payload = snapshotsToStore.map((snapshot) => ({
        invoice_id: targetInvoiceId,
        user_id: userId,
        fee_rule_id: snapshot.fee_rule_id,
        name: snapshot.name,
        fee_type: snapshot.fee_type,
        applies_to: snapshot.applies_to,
        fee_value: snapshot.fee_value,
        base_amount: snapshot.base_amount,
        amount: snapshot.amount,
        amount_override: snapshot.amount_override,
      }));

      const { error: insertError } = await supabase
        .from('invoice_fees')
        .insert(payload);

      if (insertError) throw insertError;
    }

    const { error: invoiceUpdateError } = await supabase
      .from('invoices')
      .update({
        channel_fee_amount: feeTotal,
        updated_at: new Date().toISOString(),
      })
      .eq('id', targetInvoiceId)
      .eq('user_id', userId)
      .select('id')
      .single();

    if (invoiceUpdateError) throw invoiceUpdateError;

    setSavedInvoiceFees(snapshotsToStore);
    setSelectedFeeRuleIds(
      [...new Set(snapshotsToStore.map((snapshot) => snapshot.fee_rule_id).filter(Boolean))]
    );
    const persistedOverrides = buildFeeOverrideMap(snapshotsToStore);
    feeOverridesByRuleIdRef.current = persistedOverrides;
    setFeeOverridesByRuleId(persistedOverrides);
  };

  const waitForInvoiceReadConsistency = async (targetInvoiceId, expected = {}) => {
    if (!targetInvoiceId || !userId) return;

    const expectedShipping = roundCurrencyAmount(expected.shippingCharged);
    const expectedFeeTotal = roundCurrencyAmount(expected.channelFeeAmount);
    const expectedTotalAmount = Number.isFinite(expected.totalAmount)
      ? roundCurrencyAmount(expected.totalAmount)
      : null;
    const expectedFeeCount = Number.isFinite(expected.feeCount) ? Math.max(Math.trunc(expected.feeCount), 0) : null;

    for (let attempt = 0; attempt < INVOICE_READ_SYNC_MAX_ATTEMPTS; attempt += 1) {
      const { data, error } = await supabase
        .from('invoices')
        .select('id, shipping_charged, channel_fee_amount, total_amount, invoice_fees(id)')
        .eq('id', targetInvoiceId)
        .eq('user_id', userId)
        .single();

      if (!error && data) {
        const shippingMatched = roundCurrencyAmount(data.shipping_charged || 0) === expectedShipping;
        const feeTotalMatched = roundCurrencyAmount(data.channel_fee_amount || 0) === expectedFeeTotal;
        const totalMatched = expectedTotalAmount === null
          ? true
          : roundCurrencyAmount(data.total_amount || 0) === expectedTotalAmount;
        const feeRows = Array.isArray(data.invoice_fees) ? data.invoice_fees : [];
        const feeCountMatched = expectedFeeCount === null ? true : feeRows.length === expectedFeeCount;

        if (shippingMatched && feeTotalMatched && feeCountMatched && totalMatched) {
          return;
        }
      }

      await wait(INVOICE_READ_SYNC_DELAY_MS * (attempt + 1));
    }

    console.warn('[InvoiceFormPage] Timed out waiting for invoice read consistency', {
      invoiceId: targetInvoiceId,
      expectedShipping,
      expectedFeeTotal,
      expectedTotalAmount,
      expectedFeeCount,
    });
  };

  const handleSaveInvoice = async () => {
    if (invoiceId && isSettledInvoice) {
      toast.error('Invois dibayar tidak boleh disunting');
      return;
    }

    if (selectedItems.length === 0 && manualItems.length === 0) {
      toast.error('Sila tambahkan sekurang-kurangnya satu item');
      return;
    }

    // Prevent double submission
    if (isSaving) {
      toast.error('Sedang menyimpan... Sila tunggu');
      return;
    }

    const availabilityCheck = await validateInventoryAvailability();
    if (!availabilityCheck.ok) {
      return;
    }

    const selectedMode = normalizeCourierPaymentMode(courierPaymentMode);
    const normalizedShipping = selectedMode === COURIER_PAYMENT_MODES.PLATFORM
      ? { ok: true, value: 0, display: '0.00' }
      : normalizeShippingChargedInput(shippingChargedInput);
    if (!normalizedShipping.ok) {
      setShippingChargedError(normalizedShipping.message);
      toast.error(normalizedShipping.message);
      return;
    }

    setShippingChargedError('');
    setShippingChargedInput(normalizedShipping.display);

    const resolvedShippingMethod = normalizedShipping.value > 0
      ? SHIPPING_METHODS.COURIER
      : shippingMethod;
    const resolvedCourierPaymentMode = resolvedShippingMethod === SHIPPING_METHODS.COURIER
      ? selectedMode
      : COURIER_PAYMENT_MODES.SELLER;
    const resolvedShippingRequired = isDeliveryRequired({
      shippingMethod: resolvedShippingMethod,
      shippingCharged: normalizedShipping.value,
    });
    const invoiceTaxAmount = roundCurrencyAmount(existingInvoice?.tax_amount || 0);
    const expectedTotalAmount = roundCurrencyAmount(subtotal + normalizedShipping.value + invoiceTaxAmount);
    if (resolvedShippingMethod !== shippingMethod) {
      setShippingMethod(resolvedShippingMethod);
    }
    if (resolvedCourierPaymentMode !== normalizedCourierPaymentMode) {
      setCourierPaymentMode(resolvedCourierPaymentMode);
    }

    setIsSaving(true);

    try {
      if (invoiceId) {
        if (!userId) {
          throw new Error('User tidak sah');
        }

        await syncInvoiceItemsForEdit(invoiceId);

        const { data: updatedInvoiceRow, error: updateInvoiceError } = await supabase
          .from('invoices')
          .update({
            client_id: selectedClientId || null,
            notes,
            platform: platformLabel,
            sales_channel_id: null,
            channel_fee_amount: platformFeeTotal,
            shipping_method: resolvedShippingMethod,
            courier_payment_mode: resolvedCourierPaymentMode,
            shipping_required: resolvedShippingRequired,
            shipping_charged: normalizedShipping.value,
            updated_at: new Date().toISOString(),
          })
          .eq('id', invoiceId)
          .eq('user_id', userId)
          .select('id, status, shipping_charged, channel_fee_amount, updated_at')
          .single();

        if (updateInvoiceError) {
          throw updateInvoiceError;
        }
        if (!updatedInvoiceRow?.id) {
          throw new Error('Gagal kemaskini invois: tiada rekod dikemaskini.');
        }

        const { data: recalcResult, error: recalcError } = await supabase.rpc('recalculate_invoice_totals', {
          p_invoice_id: invoiceId,
          p_user_id: userId,
        });
        if (recalcError) {
          throw recalcError;
        }
        if (!recalcResult?.[0]?.success) {
          throw new Error(recalcResult?.[0]?.message || 'Gagal kemaskini jumlah invois.');
        }

        await replaceInvoiceFeeSnapshots(invoiceId);
        await waitForInvoiceReadConsistency(invoiceId, {
          shippingCharged: normalizedShipping.value,
          channelFeeAmount: platformFeeTotal,
          totalAmount: expectedTotalAmount,
          feeCount: selectedFeeRuleIdsRef.current.length,
        });
        queryClient.removeQueries({ queryKey: ['invoice', invoiceId] });
        queryClient.invalidateQueries({ queryKey: ['invoices'] });
        toast.success('Invois dikemaskini');
        navigate(`/invoices/${invoiceId}`);
      } else {
        // Create new invoice with platform
        const result = await createInvoice.mutateAsync({
          clientId: selectedClientId,
          selectedItems,
          notes,
          manualItems,
          platform: platformLabel,
          salesChannelId: null,
          channelFeeAmount: platformFeeTotal,
          shippingMethod: resolvedShippingMethod,
          courierPaymentMode: resolvedCourierPaymentMode,
          shippingCharged: normalizedShipping.value,
          shippingRequired: resolvedShippingRequired,
        });

        if (result?.id) {
          await replaceInvoiceFeeSnapshots(result.id);
          await waitForInvoiceReadConsistency(result.id, {
            shippingCharged: normalizedShipping.value,
            channelFeeAmount: platformFeeTotal,
            totalAmount: expectedTotalAmount,
            feeCount: selectedFeeRuleIdsRef.current.length,
          });
          queryClient.removeQueries({ queryKey: ['invoice', result.id] });
        }
        queryClient.invalidateQueries({ queryKey: ['invoices'] });

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
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 overflow-x-hidden p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:gap-0 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="w-fit h-fit sm:h-10 sm:w-10"
            onClick={() => navigate('/invoices')}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold">
              {invoiceId ? 'Sunting Invois' : 'Buat Invois Baru'}
            </h1>
            <p className="mt-2 text-gray-600 text-sm">
              {invoiceId ? 'Kemaskini butiran invois' : 'Buat invois untuk pembeli anda'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Form Section */}
        <div className="space-y-6 lg:col-span-2">
          {/* Client Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Maklumat Pembeli</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Pilih Pembeli (Opsyon)</label>
                {clients.length === 0 ? (
                  <div className="text-center py-4 text-gray-500" ref={customerFieldFocusRef} tabIndex={-1}>
                    Tiada pembeli tersedia
                  </div>
                ) : (
                  <div className="max-h-60 space-y-2 overflow-y-auto border rounded-lg p-3" ref={customerFieldFocusRef} tabIndex={-1}>
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
                        <p className="font-medium break-words">{client.name}</p>
                        <p className="text-sm text-gray-600 break-all">{client.email || '-'}</p>
                      </button>
                    ))}
                  </div>
                )}
                {selectedClientId && (
                  <Button
                    variant="outline"
                    size="default"
                    onClick={() => setSelectedClientId('')}
                    className="mt-2 w-full h-10"
                  >
                    Padam Pilihan (Invois Tetamu)
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Shipping Method */}
          <Card>
            <CardHeader>
              <CardTitle>Kaedah Serahan</CardTitle>
              <CardDescription>
                Tetapkan sama ada invois ini perlukan penghantaran.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant={shippingMethod === SHIPPING_METHODS.WALK_IN ? 'default' : 'outline'}
                  onClick={() => handleShippingMethodChange(SHIPPING_METHODS.WALK_IN)}
                  className="h-10"
                >
                  Walk-in / Pickup
                </Button>
                <Button
                  type="button"
                  variant={shippingMethod === SHIPPING_METHODS.COURIER ? 'default' : 'outline'}
                  onClick={() => handleShippingMethodChange(SHIPPING_METHODS.COURIER)}
                  className="h-10"
                >
                  Courier / Penghantaran
                </Button>
              </div>

              {!deliveryRequired && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  Tiada penghantaran diperlukan.
                </div>
              )}

              {deliveryRequired && (
                <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <label className="block text-sm font-medium">Bayaran Penghantaran</label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant={normalizedCourierPaymentMode === COURIER_PAYMENT_MODES.SELLER ? 'default' : 'outline'}
                      onClick={() => handleCourierPaymentModeChange(COURIER_PAYMENT_MODES.SELLER)}
                      className="h-10"
                    >
                      Seller kutip & bayar courier
                    </Button>
                    <Button
                      type="button"
                      variant={normalizedCourierPaymentMode === COURIER_PAYMENT_MODES.PLATFORM ? 'default' : 'outline'}
                      onClick={() => handleCourierPaymentModeChange(COURIER_PAYMENT_MODES.PLATFORM)}
                      className="h-10"
                    >
                      Platform uruskan
                    </Button>
                  </div>

                  {normalizedCourierPaymentMode === COURIER_PAYMENT_MODES.PLATFORM ? (
                    <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                      Pembeli bayar penghantaran kepada platform. Tidak direkod sebagai jualan/duit masuk.
                    </div>
                  ) : (
                    <>
                      <label className="block text-sm font-medium">Caj Pos Dikutip (RM)</label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={shippingChargedInput}
                        onChange={(event) => {
                          setShippingChargedInput(event.target.value);
                          if (shippingChargedError) setShippingChargedError('');
                        }}
                        onBlur={handleShippingChargedBlur}
                        className="h-10"
                      />
                      {shippingChargedError && (
                        <p className="text-xs text-red-600">{shippingChargedError}</p>
                      )}
                    </>
                  )}

                  <p className="text-xs text-muted-foreground">
                    {normalizedCourierPaymentMode === COURIER_PAYMENT_MODES.PLATFORM
                      ? 'Penghantaran tetap perlu diurus (tracking/status), tetapi aliran tunai pos dikecualikan.'
                      : 'Masukkan caj pos yang dibayar pembeli (jika ada).'}
                  </p>
                  <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Butiran Delivery (courier/tracking/status) boleh diurus selepas invois disimpan di halaman butiran invois.
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Items Selection */}
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <CardTitle>Item Invois</CardTitle>
                <CardDescription>
                  {selectedItems.length + manualItems.length} item ({selectedItems.length} invois + {manualItems.length} manual)
                </CardDescription>
                <p className="mt-2 text-xs text-muted-foreground">
                  Harga boleh diubah untuk jualan ini sahaja.
                </p>
                {selectedItems.some((item) => item.isQuickAdded) && (
                  <p className="mt-2 inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
                    Item ditambah dari Inventory
                  </p>
                )}
                {quickAddSkippedCount > 0 && (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                    {quickAddSkippedCount} item tidak dimasukkan kerana stok habis atau item sudah tiada.
                  </p>
                )}
              </div>
              <div className="flex gap-3 flex-col sm:flex-row w-full sm:w-auto">
                <Button
                  variant="default"
                  size="default"
                  onClick={() => setShowItemSelector(true)}
                  className="gap-2 flex-1 sm:flex-initial h-10 px-4 py-2"
                >
                  <Plus className="h-5 w-5" />
                  <span>Tambah Item</span>
                </Button>
                <Button
                  variant="default"
                  size="default"
                  onClick={() => setShowManualItemForm(true)}
                  className="gap-2 flex-1 sm:flex-initial h-10 px-4 py-2"
                >
                  <Plus className="h-5 w-5" />
                  <span>Tambah Manual</span>
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
                    const effectiveMax = item.maxQuantity ?? item.availableQuantity ?? item.quantity ?? 1;
                    const displayAvailable = item.availableQuantity ?? effectiveMax;
                    const { total: reservedTotal, entries: reservationEntries } = getReservationSummaryByCustomer(item, clientNameById);

                    const reservedForClient = reservationEntries.reduce((sum, entry) => {
                      if (selectedClientId && entry.customer_id === selectedClientId) {
                        return sum + entry.quantity;
                      }
                      return sum;
                    }, 0);

                    const otherReservations = reservationEntries.filter((entry) => {
                      if (selectedClientId && entry.customer_id === selectedClientId) return false;
                      return true;
                    });

                    const otherReservedTotal = otherReservations.reduce((sum, entry) => sum + entry.quantity, 0);
                    const topOtherReservations = otherReservations
                      .slice()
                      .sort((a, b) => b.quantity - a.quantity)
                      .slice(0, 3);
                    const otherSummaryText = topOtherReservations
                      .map((entry) => `${entry.name} (${entry.quantity})`)
                      .join(', ');
                    const lineUnitPrice = getLineUnitPrice(item);
                    const lineQuantity = getLineQuantity(item);
                    const lineTotal = lineUnitPrice * lineQuantity;
                    console.log(`[InvoiceFormPage] Rendering item ${item.id} (${item.name}):`, {
                      quantity: item.quantity,
                      maxQuantity: item.maxQuantity,
                      effectiveMax,
                      allItemProps: item
                    });
                    return (
                      <div
                        key={item.id}
                        className="rounded-lg border p-3"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium break-words">{item.name}</p>
                            <p className="text-sm text-gray-600 break-words">{item.category}</p>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap sm:justify-end">
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  min="1"
                                  max={effectiveMax}
                                  value={item.quantity || 1}
                                  onChange={(e) => handleUpdateQuantity(item.id, e.target.value)}
                                  className="w-14 sm:w-16"
                                  title={`Maximum: ${displayAvailable}`}
                                  disabled={displayAvailable <= 1}
                                />
                                <span className="whitespace-nowrap text-xs text-gray-500">
                                  / {displayAvailable}
                                </span>
                              </div>
                              <span className="text-sm">×</span>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={lineUnitPrice}
                                onChange={(e) => handleUpdateUnitPrice(item.id, e.target.value)}
                                className="w-24 sm:w-28 text-right"
                                inputMode="decimal"
                              />
                            </div>
                            <div className="min-w-[80px] whitespace-nowrap text-right font-semibold sm:w-24">
                              {formatCurrency(lineTotal)}
                            </div>
                            <button
                              onClick={() => handleRemoveItem(item.id)}
                              className="text-red-600 hover:text-red-800 sm:ml-2"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        {reservedTotal > 0 && !selectedClientId && (
                          <div className="mt-3 rounded-md border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
                            Item ini ada reservation ({reservedTotal} unit). Pilih pelanggan untuk semak konflik.
                          </div>
                        )}

                        {reservedTotal > 0 && selectedClientId && reservedForClient > 0 && (
                          <div className="mt-3 rounded-md border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-900">
                            Reservation pelanggan ini: {reservedForClient} unit (boleh guna).
                          </div>
                        )}

                        {reservedTotal > 0 && selectedClientId && otherReservedTotal > 0 && (
                          <div className="mt-2 rounded-md border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
                            Ada reservation pelanggan lain: {otherSummaryText}. Pastikan sebelum jual.
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Manual Items */}
                  {manualItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-3 rounded-lg border bg-blue-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium break-words">{item.name}</p>
                        <p className="text-sm text-gray-600">Manual Item</p>
                        <p className="text-xs text-gray-500">
                          Kos: {formatCurrency(item.cost_price || 0)} / unit
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap sm:justify-end">
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity || 1}
                            onChange={(e) => handleUpdateManualItemQuantity(item.id, e.target.value)}
                            className="w-14 sm:w-16"
                          />
                          <span className="text-sm">×</span>
                          <span className="min-w-[70px] whitespace-nowrap text-right sm:w-20">
                            {formatCurrency(item.selling_price)}
                          </span>
                        </div>
                        <div className="min-w-[80px] whitespace-nowrap text-right font-semibold sm:w-24">
                          {formatCurrency(item.selling_price * (item.quantity || 1))}
                        </div>
                        <button
                          onClick={() => handleRemoveManualItem(item.id)}
                          className="text-red-600 hover:text-red-800 sm:ml-2"
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

          {/* Item Selector Card */}
          {showItemSelector && (
            <Card className="mt-10 border-blue-200 bg-blue-50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Pilih Item</CardTitle>
                      <CardDescription>
                        Cari dan pilih item untuk ditambahkan ke invois
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowItemSelector(false)}
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
                  {selectedClientId && suggestedAvailableItems.length > 1 && (
                    <div className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-900">
                      <span>
                        {suggestedAvailableItems.length} item reserved untuk pelanggan ini.
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleAddAllSuggested}
                        className="h-7 px-3 text-xs"
                      >
                        Tambah semua reserved
                      </Button>
                    </div>
                  )}

                  <div className="max-h-96 space-y-2 overflow-y-auto">
                    {sortedAvailableItems.length === 0 ? (
                      <div className="py-8 text-center text-gray-500">
                        Tiada item tersedia. Semua item mungkin sudah mempunyai invois.
                      </div>
                    ) : (
                      sortedAvailableItems.map((item) => {
                        const totalQuantity = parseInt(item.quantity, 10) || 0;
                        const reservedQuantity = getReservedQuantityFromItem(item);
                        const availableQuantity = getClientAwareAvailability(item, selectedClientId || null);
                        const { entries: reservationEntries } = getReservationSummaryByCustomer(item, clientNameById);
                        const reservedForClient = reservedForClientByItemId.get(item.id) || 0;
                        const reservedRatio = totalQuantity > 0 ? reservedQuantity / totalQuantity : 0;
                        const isLowStock = availableQuantity <= LOW_STOCK_THRESHOLD;
                        const isHighReserved = totalQuantity > 0 && reservedRatio >= HIGH_RESERVED_RATIO;
                        const isFullyReserved = availableQuantity <= 0;
                        const isExpanded = expandedItemIds.includes(item.id);
                        const availabilityLabel = selectedClientId
                          ? `Available untuk ${selectedClientName || 'pelanggan'}`
                          : 'Available';
                        const isSuggested = reservedForClient > 0;

                        return (
                          <div
                            key={item.id}
                            className={`rounded-lg border p-3 hover:bg-gray-50 ${
                              isSuggested ? 'border-emerald-200 bg-emerald-50/40' : ''
                            }`}
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="font-medium break-words">{item.name}</p>
                                  {item.is_favorite ? (
                                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                                      <Star className="mr-1 h-3 w-3 fill-amber-500 text-amber-500" />
                                      Favorite
                                    </span>
                                  ) : null}
                                </div>
                                <p className="text-sm text-gray-600 break-words">{item.category}</p>
                                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                                    Total: {totalQuantity}
                                  </span>
                                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                                    Reserved: {reservedQuantity}
                                  </span>
                                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                                    {availabilityLabel}: {availableQuantity}
                                  </span>
                                  {isSuggested && (
                                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">
                                      Suggested
                                    </span>
                                  )}
                                </div>
                                {!selectedClientId && reservedQuantity > 0 && (
                                  <div className="mt-1 text-[11px] text-amber-700">
                                    Pilih pelanggan untuk kira reserved yang betul.
                                  </div>
                                )}
                                {selectedClientId && reservedForClient > 0 && (
                                  <div className="mt-1 text-[11px] text-emerald-700">
                                    Reserved pelanggan ini: {reservedForClient} unit
                                  </div>
                                )}
                                {(isFullyReserved || isLowStock || isHighReserved) && (
                                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                                    {isFullyReserved && (
                                      <span
                                        className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-700"
                                        title="Stok penuh di-reserve."
                                      >
                                        Fully Reserved
                                      </span>
                                    )}
                                    {!isFullyReserved && isLowStock && (
                                      <span
                                        className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800"
                                        title="Baki sedikit, cepat habis."
                                      >
                                        Low Stock
                                      </span>
                                    )}
                                    {!isFullyReserved && isHighReserved && (
                                      <span
                                        className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700"
                                        title="Kebanyakan stok sedang di-hold."
                                      >
                                        High Reserved
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                                <span className="whitespace-nowrap font-semibold">
                                  {formatCurrency(item.selling_price)}
                                </span>
                                {isSuggested && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleAddItem(item, reservedForClient, { closeSelector: false })}
                                    className="gap-1"
                                  >
                                    Tambah reserved ({reservedForClient})
                                  </Button>
                                )}
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

                            {reservedQuantity > 0 && reservationEntries.length > 0 && (
                              <div className="mt-3 rounded-md border border-amber-100 bg-amber-50/40 px-3 py-2 text-xs text-amber-900">
                                <button
                                  type="button"
                                  onClick={() => toggleItemExpand(item.id)}
                                  className="flex w-full items-center justify-between text-left font-medium"
                                >
                                  <span>Reserved By</span>
                                  {isExpanded ? (
                                    <ChevronUp className="h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4" />
                                  )}
                                </button>
                                {isExpanded && (
                                  <div className="mt-2 space-y-1">
                                    {reservationEntries.map((entry, idx) => (
                                      <div key={`${item.id}-res-${idx}`} className="flex items-center justify-between">
                                        <span className="text-amber-900/90">{entry.name}</span>
                                        <span className="font-medium">{entry.quantity} unit</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

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
                  <label className="block text-sm font-medium mb-1">Kuantiti</label>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={manualItemQuantity}
                    onChange={(e) => setManualItemQuantity(e.target.value)}
                    placeholder="1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Harga Jual (RM)</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={manualItemPrice}
                    onChange={(e) => setManualItemPrice(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Kos (RM)</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={manualItemCost}
                    onChange={(e) => setManualItemCost(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="flex gap-2 flex-col sm:flex-row w-full">
                  <Button
                    onClick={handleAddManualItem}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 w-full"
                  >
                    Tambah Item
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowManualItemForm(false);
                      setManualItemName('');
                      setManualItemQuantity('1');
                      setManualItemPrice('');
                      setManualItemCost('');
                    }}
                    className="flex-1 w-full"
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

          <Card>
            <CardHeader>
              <CardTitle>Platform Jualan Invois</CardTitle>
              <CardDescription>Digunakan untuk pecahan graf platform di Dashboard.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select
                value={platformLabel}
                onChange={(event) => setInvoicePlatform(event.target.value)}
                disabled={isSettledInvoice}
              >
                {invoicePlatformOptions.map((platformOption) => (
                  <option key={platformOption} value={platformOption}>
                    {platformOption}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Nilai ini tidak mengubah platform item asal, hanya label platform untuk invois ini.
              </p>
            </CardContent>
          </Card>

          {/* Platform Fee Multi Select */}
          <Card>
            <CardHeader>
              <CardTitle>Caj Platform (Opsyen)</CardTitle>
              <CardDescription>
                Pilih lebih daripada satu rule. Setiap fee boleh dikira ikut harga barang, caj pos, atau jumlah kutipan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectableFeeRules.length === 0 ? (
                <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  Tiada rule caj platform.{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/settings')}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Tambah fee di Settings
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectableFeeRules.map((rule) => {
                    const checked = selectedFeeRuleIds.includes(rule.id);
                    const isInactive = !rule.is_active;
                    return (
                      <label
                        key={rule.id}
                        className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${checked ? 'border-primary/40 bg-primary/5' : 'border-border/70'} ${isSettledInvoice ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium break-words">
                            {rule.name}
                            {isInactive ? ' (Tidak aktif)' : ''}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {formatPlatformFeeRuleLabel(rule)} | {getPlatformFeeAppliesToLabel(rule.applies_to)}
                          </span>
                        </span>
                        <SwitchToggle
                          id={`fee-rule-${rule.id}`}
                          checked={checked}
                          onCheckedChange={(next) => handleFeeRuleToggle(rule.id, next)}
                          disabled={isSettledInvoice}
                          className="mt-0.5 shrink-0"
                        />
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="rounded-lg border bg-secondary/30 p-3">
                <p className="text-xs text-muted-foreground">Pecahan Caj Platform</p>
                {feeBreakdownRows.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">Tiada caj dipilih.</p>
                ) : (
                  <div className="mt-2 space-y-1.5 text-sm">
                    {feeBreakdownRows.map((snapshot, index) => {
                      const feeType = normalizePlatformFeeType(snapshot.fee_type);
                      const appliesTo = normalizePlatformFeeAppliesTo(snapshot.applies_to);
                      const baseLabel = getPlatformFeeAppliesToLabel(appliesTo);
                      const lineKey = `${snapshot.fee_rule_id || snapshot.name}-${index}`;
                      const baseAmount = roundCurrencyAmount(snapshot.base_amount);
                      const autoAmount = roundCurrencyAmount(snapshot.amount);
                      const hasOverride = Number.isFinite(Number.parseFloat(snapshot?.amount_override));
                      const manualAmount = hasOverride ? roundCurrencyAmount(snapshot.amount_override) : null;
                      const effectiveAmount = roundCurrencyAmount(snapshot?.effective_amount ?? autoAmount);
                      const canEditOverride = !isSettledInvoice && Boolean(snapshot?.fee_rule_id);
                      const isEditingOverride = editingFeeOverrideRuleId === snapshot?.fee_rule_id;
                      return (
                        <div key={lineKey} className="rounded-md border border-border/60 bg-background/80 p-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="break-words font-medium text-foreground/90">{snapshot.name}</p>
                              <p className="text-xs text-muted-foreground break-words">
                                {feeType === PLATFORM_FEE_TYPES.PERCENTAGE
                                  ? `${snapshot.fee_value}% x ${baseLabel} ${formatRM(baseAmount)}`
                                  : `${formatRM(snapshot.fee_value)} x ${baseLabel} ${formatRM(baseAmount)}`
                                } = {formatRM(autoAmount)}
                              </p>
                              {hasOverride && (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  Auto {formatRM(autoAmount)} -> Manual {formatRM(manualAmount)}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {hasOverride && (
                                <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                                  Manual
                                </span>
                              )}
                              <span className="font-semibold text-foreground">{formatRM(effectiveAmount)}</span>
                              {canEditOverride && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => handleOpenFeeOverrideEditor(snapshot)}
                                >
                                  Ubah
                                </Button>
                              )}
                            </div>
                          </div>
                          {canEditOverride && isEditingOverride && (
                            <div className="mt-2 rounded-md border border-border/70 bg-secondary/30 p-2">
                              <p className="text-xs font-medium">Amaun sebenar (RM)</p>
                              <p className="mb-2 text-xs text-muted-foreground">
                                Gunakan jika platform potong amaun berbeza.
                              </p>
                              <div className="flex flex-wrap items-center gap-2">
                                <Input
                                  value={feeOverrideInput}
                                  onChange={(event) => setFeeOverrideInput(event.target.value)}
                                  inputMode="decimal"
                                  className="h-8 w-32"
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-8 px-3 text-xs"
                                  onClick={handleSaveFeeOverride}
                                >
                                  Simpan
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-3 text-xs"
                                  onClick={() => handleResetFeeOverride(snapshot.fee_rule_id)}
                                >
                                  Reset ke Auto
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="mt-2 text-sm font-semibold">
                  Jumlah Caj Platform: {formatRM(platformFeeTotal)}
                </p>
              </div>
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
                  <span>Caj Platform:</span>
                  <span className="font-medium">- {formatCurrency(platformFeeTotal)}</span>
                </div>
                {shippingCharged > 0 ? (
                  <div className="flex justify-between text-sm">
                    <span>Caj Pos Dikutip:</span>
                    <span className="font-medium">{formatCurrency(shippingCharged)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between text-sm">
                  <span>Kos Anggaran:</span>
                  <span className="font-medium">{formatCurrency(totalCostPreview)}</span>
                </div>
              </div>
              <div className="flex justify-between text-lg font-bold">
                <span>Jumlah:</span>
                <span>{formatCurrency(total)}</span>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-sm">
                <div className="flex justify-between">
                  <span>Untung Kasar:</span>
                  <span className="font-medium">{formatCurrency(grossProfitPreview)}</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span>Untung Selepas Caj Platform:</span>
                  <span className="font-semibold">{formatCurrency(netProfitPreview)}</span>
                </div>
              </div>

              {selectedClientId && (
                <div className="rounded-lg bg-blue-50 p-3 text-sm">
                    <p className="font-medium break-words">
                      {clients.find((c) => c.id === selectedClientId)?.name}
                    </p>
                    {clients.find((c) => c.id === selectedClientId)?.email && (
                      <p className="break-all text-gray-600">
                        {clients.find((c) => c.id === selectedClientId)?.email}
                      </p>
                    )}
                </div>
              )}

              <div className="space-y-2 pt-4 flex flex-col gap-2 w-full">
                <Button
                  onClick={handleSaveInvoice}
                  disabled={(selectedItems.length === 0 && manualItems.length === 0) || isSaving || isSettledInvoice}
                  className="w-full"
                >
                  {isSaving ? 'Menyimpan...' : isSettledInvoice ? 'Invois Dibayar (Read-only)' : (invoiceId ? 'Kemaskini Invois' : 'Simpan Invois')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate('/invoices')}
                  className="w-full"
                >
                  Batal
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default InvoiceFormPage;
