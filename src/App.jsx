
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Helmet } from 'react-helmet';
import { motion, AnimatePresence } from 'framer-motion';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import Dashboard from '@/components/Dashboard';
import ItemList from '@/components/ItemList';
import AddItemForm from '@/components/AddItemForm';
import LoginPage from '@/components/LoginPage';
import SettingsPage from '@/components/SettingsPage';
import SalesPage from '@/components/SalesPage';
import RemindersPage from '@/components/reminders/RemindersPage';
import ClientsPage from '@/components/clients/ClientsPage';
import ClientDetailPage from '@/components/clients/ClientDetailPage';
import WalletPage from '@/components/wallet/WalletPage';
import WalletAccountPage from '@/components/wallet/WalletAccountPage';
import WalletReceiptsPage from '@/components/wallet/WalletReceiptsPage';
import InvoiceListPage from '@/components/invoices/InvoiceListPage';
import InvoiceFormPage from '@/components/invoices/InvoiceFormPage';
import InvoiceDetailsPage from '@/components/invoices/InvoiceDetailsPage';
import InvoiceShareRedirectPage from '@/components/invoices/InvoiceShareRedirectPage';
import CatalogCreatePage from '@/components/catalogs/CatalogCreatePage';
import CatalogPublicPage from '@/components/catalogs/CatalogPublicPage';
import KnowledgeBasePage from '@/components/KnowledgeBasePage';
import Layout from '@/components/layout/Layout';
import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext.jsx';
import { ItemFormProvider } from '@/contexts/ItemFormContext';
import { useEditingState } from '@/contexts/EditingStateContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toSnakeCase } from '@/lib/utils';
import { createAutoInvoiceForSoldItem } from '@/hooks/useInvoices';

// Functions to fetch data, now outside the component
const fetchProfile = async (userId) => {
  const { data, error } = await supabase.from('profiles').select('username, avatar_url').eq('id', userId).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
};

const fetchCategories = async (userId) => {
  const { data, error } = await supabase.from('categories').select('*').eq('user_id', userId).order('name', { ascending: true });
  if (error) throw error;
  return data;
};

const sortItemMedia = (mediaList = []) => {
  const normalized = (Array.isArray(mediaList) ? mediaList : [])
    .filter((media) => media?.url)
    .map((media, index) => ({
      ...media,
      position: Number.isInteger(media.position) ? media.position : index,
      is_cover: Boolean(media.is_cover),
    }));

  normalized.sort((a, b) => {
    const aPosition = Number.isInteger(a.position) ? a.position : 0;
    const bPosition = Number.isInteger(b.position) ? b.position : 0;
    if (aPosition !== bPosition) return aPosition - bPosition;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  return normalized;
};

const resolveCoverImageUrl = (legacyImageUrl, mediaList = []) => {
  const sortedMedia = sortItemMedia(mediaList);
  const coverMedia = sortedMedia.find((media) => media.is_cover) || sortedMedia[0] || null;
  return coverMedia?.url || legacyImageUrl || '';
};

const getReservedQuantityForItem = (item) => {
  const reservations = Array.isArray(item?.inventory_reservations) ? item.inventory_reservations : [];

  if (reservations.length > 0) {
    return reservations.reduce((sum, reservation) => {
      const qty = parseInt(reservation?.quantity_reserved, 10);
      return sum + (Number.isNaN(qty) ? 0 : Math.max(qty, 0));
    }, 0);
  }

  const legacyReserved = parseInt(item?.quantity_reserved, 10);
  return Number.isNaN(legacyReserved) ? 0 : Math.max(legacyReserved, 0);
};

const getAvailableQuantityForItem = (item) => {
  const totalQuantityRaw = parseInt(item?.quantity, 10);
  const totalQuantity = Number.isNaN(totalQuantityRaw) ? 1 : Math.max(totalQuantityRaw, 0);
  return Math.max(totalQuantity - getReservedQuantityForItem(item), 0);
};

const getItemAgingMeta = (item, todayUtcMs) => {
  const availableQuantity = getAvailableQuantityForItem(item);
  if ((item?.status || '').toLowerCase() === 'terjual' || availableQuantity <= 0 || !item?.created_at) {
    return {
      available_quantity: availableQuantity,
      aging_days: null,
      aging_status: null,
    };
  }

  const createdAt = new Date(item.created_at);
  if (Number.isNaN(createdAt.getTime())) {
    return {
      available_quantity: availableQuantity,
      aging_days: null,
      aging_status: null,
    };
  }

  const createdUtcMs = Date.UTC(
    createdAt.getUTCFullYear(),
    createdAt.getUTCMonth(),
    createdAt.getUTCDate()
  );
  const diffDays = Math.max(Math.floor((todayUtcMs - createdUtcMs) / (1000 * 60 * 60 * 24)), 0);

  let agingStatus = 'normal';
  if (diffDays >= 60) agingStatus = 'aging_risk';
  else if (diffDays >= 30) agingStatus = 'slow_moving';

  return {
    available_quantity: availableQuantity,
    aging_days: diffDays,
    aging_status: agingStatus,
  };
};

const INVENTORY_QUICK_FILTERS = new Set(['risk', 'aging_60', 'new_stock', 'low_margin']);
const LOW_MARGIN_THRESHOLD_PCT = 20;
const NEW_STOCK_MAX_AGE_DAYS = 14;

const normalizeInventoryQuickFilter = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'aging') return 'aging_60';
  if (INVENTORY_QUICK_FILTERS.has(normalized)) return normalized;
  return '';
};

const EMPTY_FAST_SELL_SUGGESTIONS = Object.freeze([]);

const areSetsEqual = (left, right) => {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
};

const fetchItems = async (userId) => {
  const { data, error } = await supabase
    .from('items')
    .select(`
      *,
      invoices!invoice_id (
        invoice_number
      ),
      item_media (
        id,
        url,
        position,
        is_cover,
        created_at
      ),
      inventory_reservations (
        id,
        quantity_reserved,
        customer_id,
        customer_name,
        note,
        created_at
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  // Flatten the invoice data to make it easier to access
  return data.map(item => ({
    ...item,
    item_media: sortItemMedia(item.item_media),
    image_url: resolveCoverImageUrl(item.image_url, item.item_media),
    invoice_number: item.invoices?.invoice_number || null
  }));
};

const fetchClients = async (userId) => {
  const { data, error } = await supabase.from('clients').select('*, client_phones(*), client_addresses(*)').eq('user_id', userId).order('name', { ascending: true });
  if (error) throw error;
  return data;
};

const fetchAllWallets = async (userId) => {
  const { data, error } = await supabase.from('wallets').select('*').eq('user_id', userId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
};

// Main App Component
function App() {
  const { user, signOut, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { editingItem, showAddForm, setEditingItem, setShowAddForm, clearEditingState } = useEditingState();
  const isPublicCatalogRoute = location.pathname.startsWith('/c/') || location.pathname.startsWith('/cat/');
  const isPublicInvoiceShareRoute = location.pathname.startsWith('/i/');
  const isPublicRoute = isPublicCatalogRoute || isPublicInvoiceShareRoute;
  const isKnowledgeBaseRoute = location.pathname === '/knowledge-base';

  // State for UI control
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterAgingStatus, setFilterAgingStatus] = useState('all');
  const [inventorySort, setInventorySort] = useState('default');
  const [favoriteUpdatingIds, setFavoriteUpdatingIds] = useState(new Set());
  const [isSuggestFavoritesOpen, setIsSuggestFavoritesOpen] = useState(false);
  const [selectedSuggestedFavoriteIds, setSelectedSuggestedFavoriteIds] = useState(new Set());
  const inventoryRefetchTimeoutRef = useRef(null);
  const previousPathRef = useRef(location.pathname);

  // CRITICAL: Restore form state when page visibility changes or on mount
  useEffect(() => {
    const restoreFormState = () => {
      console.log('[App] Restoring form state from sessionStorage...');
      try {
        const savedItem = sessionStorage.getItem('rarebit_editing_item');
        const savedShowForm = sessionStorage.getItem('rarebit_show_form');
        
        if (savedShowForm === 'true') {
          setShowAddForm(true);
          console.log('[App] Form visibility restored: true');
        }
        
        if (savedItem) {
          const parsedItem = JSON.parse(savedItem);
          setEditingItem(parsedItem);
          console.log('[App] Editing item restored:', parsedItem);
        }
      } catch (error) {
        console.error('[App] Error restoring form state:', error);
      }
    };

    // On initial mount
    restoreFormState();

    // On page visibility change (CRITICAL FOR TAB SWITCH)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[App] Page became visible, restoring form state...');
        setTimeout(restoreFormState, 100);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [setShowAddForm, setEditingItem]);

  // React Query for data fetching
  const { data: profile, error: profileError } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: () => fetchProfile(user.id),
    enabled: !!user,
  });

  const { data: categories = [], error: categoriesError } = useQuery({
    queryKey: ['categories', user?.id],
    queryFn: () => fetchCategories(user.id),
    enabled: !!user,
  });

  const { data: items = [], error: itemsError, isLoading: isLoadingItems, refetch: refetchItems } = useQuery({
    queryKey: ['items', user?.id],
    queryFn: () => fetchItems(user.id),
    enabled: !!user,
    staleTime: 0,
    gcTime: 1000 * 60 * 5,
  });

  const {
    data: fastSellSuggestionsData,
    error: fastSellSuggestionsError,
    isLoading: isLoadingFastSellSuggestions,
  } = useQuery({
    queryKey: ['fast-sell-suggestions', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_fast_sell_suggestions', {
        p_days: 30,
        p_min_sold: 3,
        p_limit: 20,
      });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    enabled: !!user && isSuggestFavoritesOpen,
    staleTime: 0,
    gcTime: 1000 * 60 * 5,
  });

  const fastSellSuggestions = useMemo(
    () => (Array.isArray(fastSellSuggestionsData) ? fastSellSuggestionsData : EMPTY_FAST_SELL_SUGGESTIONS),
    [fastSellSuggestionsData]
  );

  const { data: clients = [], error: clientsError } = useQuery({
    queryKey: ['clients', user?.id],
    queryFn: () => fetchClients(user.id),
    enabled: !!user,
    staleTime: 0,
    gcTime: 1000 * 60 * 5,
  });
  
  const { data: wallets = [], error: walletsError } = useQuery({
    queryKey: ['wallets', user?.id],
    queryFn: () => fetchAllWallets(user.id),
    enabled: !!user,
  });

  const businessWallets = useMemo(
    () => wallets.filter((wallet) => wallet.account_type === 'Business'),
    [wallets]
  );

  const scheduleInventoryRefetch = useCallback(() => {
    if (!user || location.pathname !== '/inventory') return;

    if (inventoryRefetchTimeoutRef.current) {
      clearTimeout(inventoryRefetchTimeoutRef.current);
    }

    inventoryRefetchTimeoutRef.current = setTimeout(() => {
      inventoryRefetchTimeoutRef.current = null;
      if (!user || location.pathname !== '/inventory') return;
      refetchItems();
    }, 400);
  }, [user, location.pathname, refetchItems]);

  useEffect(() => {
    const handleWindowFocus = () => scheduleInventoryRefetch();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleInventoryRefetch();
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [scheduleInventoryRefetch]);

  useEffect(() => {
    const previousPath = previousPathRef.current;
    if (location.pathname === '/inventory' && previousPath !== '/inventory') {
      scheduleInventoryRefetch();
    }
    previousPathRef.current = location.pathname;
  }, [location.pathname, scheduleInventoryRefetch]);

  useEffect(() => {
    return () => {
      if (inventoryRefetchTimeoutRef.current) {
        clearTimeout(inventoryRefetchTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (profileError) toast({ title: "Gagal memuatkan profil", description: profileError.message, variant: "destructive" });
    if (categoriesError) toast({ title: "Gagal memuatkan kategori", description: categoriesError.message, variant: "destructive" });
    if (itemsError) toast({ title: "Gagal memuatkan item", description: itemsError.message, variant: "destructive" });
    if (fastSellSuggestionsError) toast({ title: "Gagal memuatkan cadangan favorite", description: fastSellSuggestionsError.message, variant: "destructive" });
    if (clientsError) toast({ title: "Gagal memuatkan pelanggan", description: clientsError.message, variant: "destructive" });
    if (walletsError) toast({ title: "Gagal memuatkan wallet", description: walletsError.message, variant: "destructive" });
  }, [profileError, categoriesError, itemsError, fastSellSuggestionsError, clientsError, walletsError, toast]);

  // Auth state listener
  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') navigate('/login', { replace: true });
    });
    return () => authListener.subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (!authLoading && !user && location.pathname !== '/login') {
      if (!isPublicRoute) {
        navigate('/login', { replace: true });
      }
    }
  }, [user, authLoading, location.pathname, navigate, isPublicRoute]);

  const forceRefetchAll = useCallback(async () => {
    console.log("forceRefetchAll: Invalidating ALL queries...");
    // Invalidate all queries with refetch enabled
    await queryClient.invalidateQueries({ refetchType: 'all' });
    console.log("forceRefetchAll: All queries invalidated and refetching...");
  }, [queryClient]);

  // Mutations
  const itemMutation = useMutation({
    mutationFn: async ({ itemData, originalStatus }) => {
        const isEditing = !!itemData.id;
        const wasSold = originalStatus === 'terjual';
        const isNowSold = itemData.status === 'terjual';

        // Sanitize all data before processing
        const rawReservations = Array.isArray(itemData.reservations) ? itemData.reservations : [];
        const normalizedReservations = rawReservations
            .map((reservation) => ({
                quantity_reserved: parseInt(reservation.quantity, 10) || 0,
                customer_id: reservation.customerId || null,
                customer_name: reservation.customerName || null,
                note: reservation.note || null,
            }))
            .filter((reservation) => reservation.quantity_reserved > 0);
        const totalReservedQuantity = normalizedReservations.reduce((sum, reservation) => sum + reservation.quantity_reserved, 0);
        const computedStatus = itemData.status === 'terjual'
            ? 'terjual'
            : (totalReservedQuantity > 0 ? 'reserved' : 'tersedia');
        const isReservedStatus = computedStatus === 'reserved';

        const rawMedia = Array.isArray(itemData.media) ? itemData.media : [];
        const mediaWithFallback = rawMedia.length > 0
            ? rawMedia
            : ((itemData.image_url || '').trim()
                ? [{
                    url: itemData.image_url,
                    isCover: true,
                    position: 0,
                  }]
                : []);

        const normalizedMedia = mediaWithFallback
            .map((media, index) => ({
                url: typeof media?.url === 'string' ? media.url.trim() : '',
                position: Number.isInteger(media?.position) ? media.position : index,
                is_cover: Boolean(media?.isCover),
            }))
            .filter((media) => media.url)
            .slice(0, 10)
            .sort((a, b) => a.position - b.position)
            .map((media, index) => ({
                ...media,
                position: index,
            }));

        if (normalizedMedia.length > 0) {
            const coverIndex = normalizedMedia.findIndex((media) => media.is_cover);
            const normalizedCoverIndex = coverIndex >= 0 ? coverIndex : 0;
            normalizedMedia.forEach((media, index) => {
                media.is_cover = index === normalizedCoverIndex;
            });
        }
        const coverImageUrl = normalizedMedia.find((media) => media.is_cover)?.url || '';

        const hasTagPayload = Array.isArray(itemData.tag_ids);
        const desiredTagIds = hasTagPayload
            ? Array.from(new Set(itemData.tag_ids.filter(Boolean)))
            : null;

        const { wallet_id, reservations, media: _media, tag_ids: _tagIds, ...sanitizedItemData } = {
            ...itemData,
            status: computedStatus,
            client_id: itemData.client_id === '' ? null : itemData.client_id,
            sku: itemData.sku?.trim() || null,
            description: itemData.description?.trim() || null,
            rackLocation: itemData.rackLocation?.trim() || null,
            dateSold: itemData.dateSold === '' ? null : itemData.dateSold,
            sellingPrice: (itemData.sellingPrice === '' || itemData.sellingPrice === null) ? 0 : parseFloat(itemData.sellingPrice),
            costPrice: (itemData.costPrice === '' || itemData.costPrice === null) ? 0 : parseFloat(itemData.costPrice),
            quantityReserved: isReservedStatus ? totalReservedQuantity : 0,
            image_url: coverImageUrl,
            reservedCustomerId: null,
            reservedCustomerName: null,
            reservedNote: null,
        };
        const snakeCaseData = toSnakeCase(sanitizedItemData);

        // === STEP 1: UPSERT ITEM RECORD ===
        console.log("Step 1: Upserting item with data:", snakeCaseData);
        let upsertedItem;
        if (isEditing) {
            const { data, error } = await supabase.from('items').update(snakeCaseData).eq('id', itemData.id).select().single();
            if (error) throw new Error(`Gagal mengemas kini item: ${error.message}`);
            upsertedItem = data;
        } else {
            const { data, error } = await supabase.from('items').insert({ ...snakeCaseData, user_id: user.id }).select().single();
            if (error) throw new Error(`Gagal mencipta item: ${error.message}`);
            upsertedItem = data;
        }
        console.log("Step 1 SUCCESS. Upserted item:", upsertedItem);

        // === STEP 1.25: SYNC ITEM MEDIA (REPLACE ALL) ===
        try {
            const { error: deleteMediaError } = await supabase
                .from('item_media')
                .delete()
                .eq('item_id', upsertedItem.id);

            if (deleteMediaError) {
                throw new Error(`Gagal memadam media lama: ${deleteMediaError.message}`);
            }

            if (normalizedMedia.length > 0) {
                const mediaPayload = normalizedMedia.map((media) => ({
                    item_id: upsertedItem.id,
                    url: media.url,
                    position: media.position,
                    is_cover: media.is_cover,
                }));

                const { error: insertMediaError } = await supabase
                    .from('item_media')
                    .insert(mediaPayload);

                if (insertMediaError) {
                    throw new Error(`Gagal menyimpan media item: ${insertMediaError.message}`);
                }
            }
        } catch (mediaError) {
            console.error('[App] Item media sync failed:', mediaError);
            throw mediaError;
        }

        // === STEP 1.5: SYNC RESERVATIONS (REPLACE ALL) ===
        try {
            const { error: deleteReservationsError } = await supabase
                .from('inventory_reservations')
                .delete()
                .eq('item_id', upsertedItem.id);

            if (deleteReservationsError) {
                throw new Error(`Gagal memadam reservation lama: ${deleteReservationsError.message}`);
            }

            if (isReservedStatus && normalizedReservations.length > 0) {
                const reservationsPayload = normalizedReservations.map((reservation) => ({
                    item_id: upsertedItem.id,
                    ...reservation,
                }));

                const { error: insertReservationsError } = await supabase
                    .from('inventory_reservations')
                    .insert(reservationsPayload);

                if (insertReservationsError) {
                    throw new Error(`Gagal menyimpan reservation: ${insertReservationsError.message}`);
                }
            }
        } catch (reservationError) {
            console.error('[App] Reservation sync failed:', reservationError);
            throw reservationError;
        }

        // === STEP 1.75: SYNC ITEM TAGS (DIFF UPDATE) ===
        if (desiredTagIds !== null) {
            try {
                const { data: existingTagRows, error: existingTagsError } = await supabase
                    .from('item_tags')
                    .select('tag_id')
                    .eq('item_id', upsertedItem.id);

                if (existingTagsError) {
                    if (existingTagsError.code === '42P01') {
                        console.warn('[App] item_tags table not found, skipping tag sync.');
                    } else {
                        throw new Error(`Gagal mendapatkan tag item: ${existingTagsError.message}`);
                    }
                } else {
                    const existingTagIds = (existingTagRows || [])
                        .map((row) => row.tag_id)
                        .filter(Boolean);

                    const tagsToDelete = existingTagIds.filter((tagId) => !desiredTagIds.includes(tagId));
                    const tagsToInsert = desiredTagIds.filter((tagId) => !existingTagIds.includes(tagId));

                    if (tagsToDelete.length > 0) {
                        const { error: deleteTagsError } = await supabase
                            .from('item_tags')
                            .delete()
                            .eq('item_id', upsertedItem.id)
                            .in('tag_id', tagsToDelete);

                        if (deleteTagsError) {
                            throw new Error(`Gagal membuang tag item: ${deleteTagsError.message}`);
                        }
                    }

                    if (tagsToInsert.length > 0) {
                        const insertRows = tagsToInsert.map((tagId) => ({
                            item_id: upsertedItem.id,
                            tag_id: tagId,
                        }));

                        const { error: insertTagsError } = await supabase
                            .from('item_tags')
                            .insert(insertRows);

                        if (insertTagsError) {
                            throw new Error(`Gagal menyimpan tag item: ${insertTagsError.message}`);
                        }
                    }
                }
            } catch (tagSyncError) {
                console.error('[App] Tag sync failed:', tagSyncError);
                throw tagSyncError;
            }
        }


        // === STEP 2: HANDLE WALLET LOGIC (SALE OR REVERSAL) ===

        // --- CASE A: Item is now sold ---
        if (isNowSold) {
            // Check if this is a new sale or updating an existing sale
            if (!wasSold) {
                // New sale - create transaction
                console.log("Step 2: NEW SALE. Calling handle_item_sale...");
                const saleParams = {
                    p_item_id: upsertedItem.id,
                    p_user_id: user.id,
                    p_wallet_id: wallet_id,
                    p_selling_price: sanitizedItemData.sellingPrice,
                    p_date_sold: sanitizedItemData.dateSold
                };
                console.log("Sale params:", saleParams);
                const { error } = await supabase.rpc('handle_item_sale', saleParams);
                if (error) throw new Error(`Item dikemas kini, tetapi jualan gagal direkod: ${error.message}`);
                console.log("Step 2 SUCCESS: handle_item_sale called.");

                // === STEP 2.1: AUTO-INVOICE FOR SOLD ITEM ===
                console.log("Step 2.1: Creating auto-invoice for sold item...");
                try {
                    const invoiceResult = await createAutoInvoiceForSoldItem(upsertedItem.id, user.id);
                    console.log("Step 2.1 SUCCESS: Auto-invoice created:", invoiceResult);
                } catch (invoiceError) {
                    console.warn("Step 2.1 WARNING: Auto-invoice failed (non-critical):", invoiceError.message);
                    // Don't throw - invoice failure shouldn't block item sale
                }

                return { action: 'sold' };
            } else {
                // Item was already sold, now updating sale details
                // First reverse the existing sale, then create new one
                console.log("Step 2: UPDATING EXISTING SALE. First reversing existing sale...");
                
                // STEP 2A.1: Find the transaction for this item
                const { data: existingTransaction, error: txFindError } = await supabase
                    .from('transactions')
                    .select('*')
                    .eq('item_id', upsertedItem.id)
                    .single();
                
                if (txFindError && txFindError.code !== 'PGRST116') {
                    throw new Error(`Gagal mencari transaksi lama: ${txFindError.message}`);
                }
                
                if (existingTransaction) {
                    console.log("Step 2A.1: Found existing transaction:", existingTransaction);
                    
                    // STEP 2A.2: Reverse the wallet balance for old transaction
                    const { data: wallet, error: walletError } = await supabase
                        .from('wallets')
                        .select('balance')
                        .eq('id', existingTransaction.wallet_id)
                        .single();
                    
                    if (walletError) {
                        throw new Error(`Gagal mencari wallet lama: ${walletError.message}`);
                    }
                    
                    const newBalance = parseFloat(wallet.balance) - parseFloat(existingTransaction.amount);
                    console.log("Step 2A.2: Reversing old balance from", wallet.balance, "to", newBalance);
                    
                    const { error: updateWalletError } = await supabase
                        .from('wallets')
                        .update({ balance: newBalance })
                        .eq('id', existingTransaction.wallet_id);
                    
                    if (updateWalletError) {
                        throw new Error(`Gagal mengemas kini wallet lama: ${updateWalletError.message}`);
                    }
                    
                    // STEP 2A.3: Delete the old transaction
                    const { error: deleteTxError } = await supabase
                        .from('transactions')
                        .delete()
                        .eq('id', existingTransaction.id);
                    
                    if (deleteTxError) {
                        throw new Error(`Gagal memadam transaksi lama: ${deleteTxError.message}`);
                    }
                    
                    console.log("Step 2a SUCCESS: Existing sale reversed.");
                } else {
                    console.log("Step 2a: No existing transaction found (edge case)");
                }
                
                // Now create the new sale with updated details
                console.log("Step 2b: Creating updated sale...");
                const saleParams = {
                    p_item_id: upsertedItem.id,
                    p_user_id: user.id,
                    p_wallet_id: wallet_id, 
                    p_selling_price: sanitizedItemData.sellingPrice,
                    p_date_sold: sanitizedItemData.dateSold
                };
                console.log("Updated sale params:", saleParams);
                const { error: saleError } = await supabase.rpc('handle_item_sale', saleParams);
                if (saleError) throw new Error(`Gagal mencipta jualan baru: ${saleError.message}`);
                console.log("Step 2b SUCCESS: Updated sale created.");
                return { action: 'updated_sale' };
            }
        }
        
        // --- CASE B: Item was sold, but is now NOT sold (Reversal) ---
        if (wasSold && !isNowSold) {
            console.log("Step 2: Sale REVERTED. Manually reversing sale...");
            
            // STEP 2B.1: Find the transaction for this item
            const { data: transactions, error: txFindError } = await supabase
                .from('transactions')
                .select('*')
                .eq('item_id', upsertedItem.id)
                .single();
            
            if (txFindError && txFindError.code !== 'PGRST116') {
                throw new Error(`Gagal mencari transaksi: ${txFindError.message}`);
            }
            
            if (transactions) {
                console.log("Step 2B.1: Found transaction:", transactions);
                
                // STEP 2B.2: Reverse the wallet balance
                const { data: wallet, error: walletError } = await supabase
                    .from('wallets')
                    .select('balance')
                    .eq('id', transactions.wallet_id)
                    .single();
                
                if (walletError) {
                    throw new Error(`Gagal mencari wallet: ${walletError.message}`);
                }
                
                const newBalance = parseFloat(wallet.balance) - parseFloat(transactions.amount);
                console.log("Step 2B.2: Reversing balance from", wallet.balance, "to", newBalance);
                
                const { error: updateWalletError } = await supabase
                    .from('wallets')
                    .update({ balance: newBalance })
                    .eq('id', transactions.wallet_id);
                
                if (updateWalletError) {
                    throw new Error(`Gagal mengemas kini wallet: ${updateWalletError.message}`);
                }
                
                // STEP 2B.3: Delete the transaction
                const { error: deleteTxError } = await supabase
                    .from('transactions')
                    .delete()
                    .eq('id', transactions.id);
                
                if (deleteTxError) {
                    throw new Error(`Gagal memadam transaksi: ${deleteTxError.message}`);
                }
                
                console.log("Step 2B.3: Transaction deleted successfully");
            } else {
                console.log("Step 2B: No transaction found for this item (might be edge case)");
            }
            
            console.log("Step 2 SUCCESS: Sale reversed manually.");
            return { action: 'reverted' };
        }

        // --- CASE C: Standard update, no sale or reversal involved ---
        console.log("Step 2: Standard update, no wallet action needed.");
        return { action: isEditing ? 'updated' : 'created' };
    },
    onSuccess: async (data) => {
        const messages = {
            sold: 'Jualan berjaya direkodkan!',
            updated_sale: 'Jualan berjaya dikemaskini!',
            reverted: 'Jualan berjaya dibatalkan!',
            created: 'Item baharu berjaya ditambah!',
            updated: 'Item berjaya dikemaskini!'
        };
        toast({ title: "Berjaya!", description: messages[data.action] });
        clearEditingState();

        // Invalidate relevant queries to trigger real-time updates
        await queryClient.invalidateQueries({ queryKey: ['items'] });
        await queryClient.invalidateQueries({ queryKey: ['clients'] });
        await queryClient.invalidateQueries({ queryKey: ['invoices'] });
        await queryClient.invalidateQueries({ queryKey: ['uninvoiced-items'] });
        await queryClient.invalidateQueries({ queryKey: ['available-items'] });
    },
    onError: (error) => {
        toast({
            title: "Operasi Gagal",
            description: `Ralat: ${error.message}`,
            variant: "destructive",
            duration: 9000,
        });
        console.error("Mutation failed:", error);
    },
    onSettled: async () => {
        console.log("Mutation settled. Forcing refetch...");
        // Add a small delay to ensure all server-side operations are complete
        await new Promise(resolve => setTimeout(resolve, 500));
        await forceRefetchAll();
    }
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId) => {
      const itemToDelete = items.find(item => item.id === itemId);
      if (!itemToDelete) throw new Error("Item tidak ditemui untuk dipadam.");

      console.log("[deleteItemMutation] Starting deletion process for item:", itemId);

      // === STEP 1: HANDLE WALLET & TRANSACTION CLEANUP (if item was sold) ===
      if (itemToDelete.status === 'terjual') {
        console.log("[deleteItemMutation] Item is sold, reverting sale before deletion...");

        const { data: transactions, error: txFindError } = await supabase
            .from('transactions')
            .select('*')
            .eq('item_id', itemId)
            .single();

        if (txFindError && txFindError.code !== 'PGRST116') {
            throw new Error(`Gagal mencari transaksi: ${txFindError.message}`);
        }

        if (transactions) {
            console.log("[deleteItemMutation] Found transaction:", transactions);

            // Reverse the wallet balance
            const { data: wallet, error: walletError } = await supabase
                .from('wallets')
                .select('balance')
                .eq('id', transactions.wallet_id)
                .single();

            if (walletError) {
                throw new Error(`Gagal mencari wallet: ${walletError.message}`);
            }

            const newBalance = parseFloat(wallet.balance) - parseFloat(transactions.amount);
            console.log("[deleteItemMutation] Reversing balance from", wallet.balance, "to", newBalance);

            const { error: updateWalletError } = await supabase
                .from('wallets')
                .update({ balance: newBalance })
                .eq('id', transactions.wallet_id);

            if (updateWalletError) {
                throw new Error(`Gagal mengemas kini wallet: ${updateWalletError.message}`);
            }

            // Delete the transaction
            const { error: deleteTxError } = await supabase
                .from('transactions')
                .delete()
                .eq('id', transactions.id);

            if (deleteTxError) {
                throw new Error(`Gagal memadam transaksi: ${deleteTxError.message}`);
            }

            console.log("[deleteItemMutation] Wallet reversed and transaction deleted successfully");
        } else {
            console.log("[deleteItemMutation] No transaction found for this item");
        }
      }

      // === STEP 2: HANDLE INVOICE CLEANUP (if item is in draft invoice) ===
      if (itemToDelete.invoice_id) {
        console.log("[deleteItemMutation] Item is linked to invoice:", itemToDelete.invoice_id);

        // Get the invoice to check its status
        const { data: invoice, error: invoiceError } = await supabase
            .from('invoices')
            .select('*')
            .eq('id', itemToDelete.invoice_id)
            .single();

        if (invoiceError && invoiceError.code !== 'PGRST116') {
            throw new Error(`Gagal mencari invois: ${invoiceError.message}`);
        }

        if (invoice) {
            console.log("[deleteItemMutation] Invoice status:", invoice.status);

            // Only proceed if invoice is NOT finalized/paid
            if (invoice.status === 'draft' || invoice.status === 'cancelled') {
                console.log("[deleteItemMutation] Invoice is draft/cancelled, removing item from invoice...");

                // Remove the item from invoice_items
                const { error: removeItemError } = await supabase
                    .from('invoice_items')
                    .delete()
                    .eq('invoice_id', itemToDelete.invoice_id)
                    .eq('item_id', itemId);

                if (removeItemError) {
                    throw new Error(`Gagal memadam item dari invois: ${removeItemError.message}`);
                }

                console.log("[deleteItemMutation] Item removed from invoice_items");

                // Check if invoice has any remaining items
                const { data: remainingItems, error: checkError } = await supabase
                    .from('invoice_items')
                    .select('id')
                    .eq('invoice_id', itemToDelete.invoice_id);

                if (checkError) {
                    throw new Error(`Gagal memeriksa item sisa dalam invois: ${checkError.message}`);
                }

                // If no items left, delete the empty invoice
                if (!remainingItems || remainingItems.length === 0) {
                    console.log("[deleteItemMutation] No items left in invoice, deleting empty invoice...");

                    const { error: deleteInvoiceError } = await supabase
                        .from('invoices')
                        .delete()
                        .eq('id', itemToDelete.invoice_id);

                    if (deleteInvoiceError) {
                        throw new Error(`Gagal memadam invois kosong: ${deleteInvoiceError.message}`);
                    }

                    console.log("[deleteItemMutation] Empty invoice deleted successfully");
                } else {
                    // Recalculate using server-side source of truth.
                    console.log("[deleteItemMutation] Recalculating invoice totals via RPC...");

                    const { data: recalcResult, error: recalcError } = await supabase.rpc(
                        'recalculate_invoice_totals',
                        {
                            p_invoice_id: itemToDelete.invoice_id,
                            p_user_id: user.id
                        }
                    );

                    if (recalcError) {
                        throw new Error(`Gagal mengemas kini jumlah invois: ${recalcError.message}`);
                    }

                    const recalcResponse = Array.isArray(recalcResult) ? recalcResult[0] : null;
                    if (!recalcResponse?.success) {
                        throw new Error(recalcResponse?.message || 'Gagal mengemas kini jumlah invois');
                    }

                    console.log("[deleteItemMutation] Invoice totals recalculated");
                }
            } else {
                console.warn("[deleteItemMutation] Invoice is finalized/paid - cannot delete item from finalized invoice");
                throw new Error("Tidak boleh memadam item dari invois yang sudah muktamad atau dibayar");
            }
        } else {
            console.log("[deleteItemMutation] Invoice not found (may have been deleted already)");
        }
      }

      // === STEP 3: DELETE ITEM ===
      // Media files are managed by Media Library and can be reused by multiple items.
      // Do not delete storage objects here to avoid breaking shared image URLs.
      console.log("[deleteItemMutation] Deleting item from database...");
      const { error: deleteError } = await supabase.from('items').delete().eq('id', itemId);
      if (deleteError) throw new Error(`Gagal memadam item dari pangkalan data: ${deleteError.message}`);
      console.log("[deleteItemMutation] Item deleted successfully");
    },
    onSuccess: () => {
      toast({ title: 'Item berjaya dipadam secara kekal!' });
    },
    onError: (error) => {
      toast({ title: "Gagal memadam item", description: error.message, variant: "destructive", duration: 9000 });
    },
    onSettled: async () => {
      console.log("[deleteItemMutation] onSettled: Forcing refetch...");
      await forceRefetchAll();
    }
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: async ({ itemId, nextValue }) => {
      const { data, error } = await supabase
        .from('items')
        .update({ is_favorite: nextValue })
        .eq('id', itemId)
        .eq('user_id', user.id)
        .select('id, is_favorite')
        .single();

      if (error) throw error;
      return data;
    },
    onMutate: async ({ itemId, nextValue }) => {
      await queryClient.cancelQueries({ queryKey: ['items', user.id] });

      const previousItems = queryClient.getQueryData(['items', user.id]);

      queryClient.setQueryData(['items', user.id], (currentItems = []) =>
        currentItems.map((item) =>
          item.id === itemId ? { ...item, is_favorite: nextValue } : item
        )
      );

      setFavoriteUpdatingIds((prev) => {
        const next = new Set(prev);
        next.add(itemId);
        return next;
      });

      return { previousItems };
    },
    onError: (error, variables, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(['items', user.id], context.previousItems);
      }
      toast({
        title: "Gagal kemas kini kegemaran",
        description: error.message,
        variant: "destructive"
      });
    },
    onSettled: (_data, _error, variables) => {
      setFavoriteUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(variables.itemId);
        return next;
      });

      queryClient.invalidateQueries({ queryKey: ['items', user.id] });
      queryClient.invalidateQueries({ queryKey: ['available-items', user.id] });
    }
  });

  const handleToggleFavorite = useCallback((item) => {
    if (!item?.id) return;

    toggleFavoriteMutation.mutate({
      itemId: item.id,
      nextValue: !Boolean(item.is_favorite),
    });
  }, [toggleFavoriteMutation]);

  const applySuggestedFavoritesMutation = useMutation({
    mutationFn: async (itemIds) => {
      if (!user?.id) throw new Error('User tidak sah');
      if (!Array.isArray(itemIds) || itemIds.length === 0) return 0;

      const uniqueIds = Array.from(new Set(itemIds.filter(Boolean)));
      if (uniqueIds.length === 0) return 0;

      const { error } = await supabase
        .from('items')
        .update({ is_favorite: true })
        .eq('user_id', user.id)
        .in('id', uniqueIds);

      if (error) throw error;
      return uniqueIds.length;
    },
    onSuccess: async (updatedCount) => {
      setIsSuggestFavoritesOpen(false);
      setSelectedSuggestedFavoriteIds(new Set());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['items', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['available-items', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['fast-sell-suggestions', user.id] }),
      ]);
      toast({
        title: 'Favorite dikemas kini',
        description: updatedCount > 0
          ? `${updatedCount} item ditandakan sebagai favorite.`
          : 'Tiada item dikemas kini.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Gagal kemas kini favorite',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  useEffect(() => {
    if (!isSuggestFavoritesOpen) {
      setSelectedSuggestedFavoriteIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

    const nextSelected = new Set(
      fastSellSuggestions
        .filter((suggestion) => !suggestion.is_favorite)
        .map((suggestion) => suggestion.item_id)
    );
    setSelectedSuggestedFavoriteIds((prev) => (areSetsEqual(prev, nextSelected) ? prev : nextSelected));
  }, [isSuggestFavoritesOpen, fastSellSuggestions]);

  const handleApplySuggestedFavorites = useCallback(() => {
    const itemIds = Array.from(selectedSuggestedFavoriteIds);
    if (itemIds.length === 0) {
      toast({
        title: 'Tiada item dipilih',
        description: 'Pilih sekurang-kurangnya satu item.',
      });
      return;
    }

    applySuggestedFavoritesMutation.mutate(itemIds);
  }, [selectedSuggestedFavoriteIds, applySuggestedFavoritesMutation, toast]);

  const toggleSuggestedFavoriteSelection = useCallback((itemId, checked) => {
    setSelectedSuggestedFavoriteIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }, []);

  const itemsWithAging = useMemo(() => {
    const now = new Date();
    const todayUtcMs = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    );

    return items.map((item) => ({
      ...item,
      ...getItemAgingMeta(item, todayUtcMs),
    }));
  }, [items]);

  const inventoryQuickFilter = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return normalizeInventoryQuickFilter(params.get('filter'));
  }, [location.search]);

  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    const filtered = itemsWithAging.filter((item) => {
      const itemName = (item.name || '').toLowerCase();
      const itemCategory = (item.category || '').toLowerCase();
      const itemSku = (item.sku || '').toLowerCase();
      const itemDescription = (item.description || '').toLowerCase();
      const itemRackLocation = (item.rack_location || '').toLowerCase();
      const itemAvailableQty = Number.isFinite(item.available_quantity)
        ? Math.max(item.available_quantity, 0)
        : getAvailableQuantityForItem(item);
      const matchesKeyword = !normalizedSearchTerm
        || itemName.includes(normalizedSearchTerm)
        || itemCategory.includes(normalizedSearchTerm)
        || itemSku.includes(normalizedSearchTerm)
        || itemDescription.includes(normalizedSearchTerm)
        || itemRackLocation.includes(normalizedSearchTerm);
      const matchesAgingStatus = filterAgingStatus === 'all'
        || item.aging_status === filterAgingStatus;
      const matchesQuickFilter = (() => {
        if (!inventoryQuickFilter) return true;

        if (inventoryQuickFilter === 'risk' || inventoryQuickFilter === 'aging_60') {
          return itemAvailableQty > 0 && Number.isInteger(item.aging_days) && item.aging_days >= 60;
        }

        if (inventoryQuickFilter === 'new_stock') {
          return itemAvailableQty > 0
            && Number.isInteger(item.aging_days)
            && item.aging_days >= 0
            && item.aging_days <= NEW_STOCK_MAX_AGE_DAYS;
        }

        if (inventoryQuickFilter === 'low_margin') {
          if (itemAvailableQty <= 0) return false;
          const sellingPrice = parseFloat(item?.selling_price);
          const costPrice = parseFloat(item?.cost_price);
          if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) return false;
          if (!Number.isFinite(costPrice) || costPrice < 0) return false;
          const marginPct = ((sellingPrice - costPrice) / sellingPrice) * 100;
          return Number.isFinite(marginPct) && marginPct <= LOW_MARGIN_THRESHOLD_PCT;
        }

        return true;
      })();

      return matchesKeyword
        && (filterCategory === 'all' || item.category === filterCategory)
        && (filterStatus === 'all' || item.status === filterStatus)
        && matchesAgingStatus
        && matchesQuickFilter;
    });

    if (inventorySort === 'aging_desc') {
      filtered.sort((a, b) => {
        const aAgingDays = Number.isInteger(a.aging_days) ? a.aging_days : -1;
        const bAgingDays = Number.isInteger(b.aging_days) ? b.aging_days : -1;
        if (bAgingDays !== aAgingDays) return bAgingDays - aAgingDays;
        return (a.name || '').localeCompare(b.name || '');
      });
    }

    return filtered;
  }, [
    itemsWithAging,
    normalizedSearchTerm,
    filterCategory,
    filterStatus,
    filterAgingStatus,
    inventorySort,
    inventoryQuickFilter,
  ]);
  const suggestedNonFavoriteCount = useMemo(
    () => (fastSellSuggestions || []).filter((suggestion) => !suggestion.is_favorite).length,
    [fastSellSuggestions]
  );
  
  if (isPublicRoute) {
    return (
      <>
        <Helmet><title>RareBits - Public Link</title></Helmet>
        <Routes>
          <Route path="/c/:publicCode" element={<CatalogPublicPage />} />
          <Route path="/cat/:publicCode" element={<CatalogPublicPage />} />
          <Route path="/i/:shareCode" element={<InvoiceShareRedirectPage />} />
        </Routes>
      </>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Helmet><title>Log Masuk - RareBits</title></Helmet>
        <Routes><Route path="*" element={<LoginPage />} /></Routes>
      </>
    );
  }

  const pageTitle = {
    '/': 'Papan Pemuka', '/inventory': 'Inventori', '/sales': 'Jualan',
    '/invoices': 'Invois', '/catalogs': 'Katalog', '/inventory/catalogs': 'Katalog',
    '/clients': 'Pelanggan', '/wallet': 'Wallet', '/wallet/receipts': 'Resit Wallet', '/knowledge-base': 'Panduan', '/settings': 'Tetapan', '/reminders': 'Peringatan'
  }[location.pathname] || 'Papan Pemuka';

  return (
    <>
      <Helmet><title>RareBits - {pageTitle}</title></Helmet>
      
      <Layout user={user} profile={profile} onSignOut={signOut} onAddItem={() => { setEditingItem(null); setShowAddForm(true); }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={isKnowledgeBaseRoute ? { opacity: 0 } : { opacity: 0, y: 20 }}
            animate={isKnowledgeBaseRoute ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={isKnowledgeBaseRoute ? { opacity: 0 } : { opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
          >
            <Routes>
              <Route
                path="/"
                element={
                  <Dashboard
                    items={items}
                    categories={categories}
                    user={user}
                    profile={profile}
                    isInventoryLoading={isLoadingItems}
                  />
                }
              />
              <Route path="/inventory" element={
                <div className="space-y-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h1 className="page-title">Inventori</h1>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsSuggestFavoritesOpen(true)}
                      className="w-full sm:w-auto"
                    >
                      Suggest Favorites
                    </Button>
                  </div>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg font-semibold">Tapis Item</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                        <div className="flex flex-col gap-2">
                          <label className="text-xs font-medium text-muted-foreground">Cari Item</label>
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-cyan-500" />
                            <Input
                              placeholder="Cari nama, SKU, kategori atau lokasi..."
                              value={searchTerm}
                              onChange={(e) => setSearchTerm(e.target.value)}
                              className="h-10 rounded-full border-cyan-300 bg-white pl-10 pr-4 font-medium text-cyan-700 placeholder:text-slate-400 focus-visible:ring-cyan-300"
                            />
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-xs font-medium text-muted-foreground">Kategori</label>
                          <Select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                            <option value="all">Semua Kategori</option>
                            {categories.map(cat => <option key={cat.id} value={cat.name}>{cat.name}</option>)}
                          </Select>
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-xs font-medium text-muted-foreground">Status</label>
                          <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                            <option value="all">Semua Status</option>
                            <option value="tersedia">Tersedia</option>
                            <option value="reserved">Reserved</option>
                            <option value="terjual">Terjual</option>
                          </Select>
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-xs font-medium text-muted-foreground">Aging Status</label>
                          <Select value={filterAgingStatus} onChange={(e) => setFilterAgingStatus(e.target.value)}>
                            <option value="all">Semua</option>
                            <option value="normal">Normal (&lt;30 hari)</option>
                            <option value="slow_moving">Slow Moving (30-59 hari)</option>
                            <option value="aging_risk">Aging Risk (60+ hari)</option>
                          </Select>
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-xs font-medium text-muted-foreground">Susunan</label>
                          <Select value={inventorySort} onChange={(e) => setInventorySort(e.target.value)}>
                            <option value="default">Terbaharu</option>
                            <option value="aging_desc">Paling Lama Dalam Stok</option>
                          </Select>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  {inventoryQuickFilter ? (
                    <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
                      Filter pantas aktif:{' '}
                      <span className="font-semibold">
                        {inventoryQuickFilter === 'risk' && 'Stok Risiko 60+ hari'}
                        {inventoryQuickFilter === 'aging_60' && 'Stok Aging 60+ hari'}
                        {inventoryQuickFilter === 'new_stock' && 'Stok Baru (14 hari)'}
                        {inventoryQuickFilter === 'low_margin' && `Margin Rendah (<= ${LOW_MARGIN_THRESHOLD_PCT}%)`}
                      </span>
                    </div>
                  ) : null}
                  {isLoadingItems || itemMutation.isPending || deleteItemMutation.isPending ? <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin" /></div> : <ItemList items={filteredItems} categories={categories} clients={clients} onEdit={(item) => { setEditingItem(item); setShowAddForm(true); }} onDelete={deleteItemMutation.mutate} onToggleFavorite={handleToggleFavorite} favoriteUpdatingIds={favoriteUpdatingIds} onBulkDelete={async (itemIds) => {
                    console.log('[App] Bulk deleting items:', itemIds);
                    for (const itemId of itemIds) {
                      await new Promise((resolve) => {
                        deleteItemMutation.mutate(itemId, {
                          onSuccess: () => resolve(),
                          onError: () => resolve()
                        });
                      });
                    }
                    toast({
                      title: "Item Dipadam",
                      description: `${itemIds.length} item telah dikeluarkan daripada inventori.`
                    });
                  }} />}
                </div>
              } />
              <Route path="/sales" element={<SalesPage items={items} />} />
              <Route path="/reminders" element={<RemindersPage user={user} />} />
              <Route path="/invoices" element={<InvoiceListPage />} />
              <Route path="/invoices/create" element={<InvoiceFormPage />} />
              <Route path="/invoices/:invoiceId" element={<InvoiceDetailsPage />} />
              <Route path="/invoices/:invoiceId/edit" element={<InvoiceFormPage />} />
              <Route path="/catalogs" element={<CatalogCreatePage userId={user.id} items={items} categories={categories} />} />
              <Route path="/catalogs/create" element={<CatalogCreatePage userId={user.id} items={items} categories={categories} />} />
              <Route path="/catalogs/:catalogId/edit" element={<CatalogCreatePage userId={user.id} items={items} categories={categories} />} />
              <Route path="/inventory/catalogs" element={<CatalogCreatePage userId={user.id} items={items} categories={categories} />} />
              <Route path="/inventory/catalogs/:catalogId/edit" element={<CatalogCreatePage userId={user.id} items={items} categories={categories} />} />
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/clients/:id" element={<ClientDetailPage />} />
              <Route path="/wallet" element={<WalletPage />} />
              <Route path="/wallet/account/:accountId" element={<WalletAccountPage />} />
              <Route path="/wallet/receipts" element={<WalletReceiptsPage />} />
              <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
              <Route path="/settings" element={<SettingsPage user={user} categories={categories} onUpdateCategories={() => queryClient.invalidateQueries({ queryKey: ['categories', user.id] })} onUpdateProfile={() => queryClient.invalidateQueries({ queryKey: ['profile', user.id] })} />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </Layout>

      <AlertDialog open={isSuggestFavoritesOpen} onOpenChange={setIsSuggestFavoritesOpen}>
        <AlertDialogContent className="max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Suggest Favorites</AlertDialogTitle>
            <AlertDialogDescription>
              Cadangan item fast sell berdasarkan jualan invois dibayar dalam 30 hari terakhir (minimum 3x).
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {isLoadingFastSellSuggestions ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Memuatkan cadangan...
              </div>
            ) : fastSellSuggestions.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Tiada cadangan fast sell buat masa ini.
              </div>
            ) : (
              fastSellSuggestions.map((suggestion) => {
                const checked = suggestion.is_favorite || selectedSuggestedFavoriteIds.has(suggestion.item_id);
                const disabled = suggestion.is_favorite || applySuggestedFavoritesMutation.isPending;
                return (
                  <label
                    key={suggestion.item_id}
                    className="flex items-start gap-3 rounded-lg border p-3"
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(value) => toggleSuggestedFavoriteSelection(suggestion.item_id, value === true)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{suggestion.item_name || 'Item'}</p>
                        {suggestion.is_favorite ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            Sudah Favorite
                          </span>
                        ) : (
                          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                            Fast Sell
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Terjual {suggestion.sold_qty || 0}x / 30 hari • Available {suggestion.available_qty || 0}
                      </p>
                    </div>
                  </label>
                );
              })
            )}
          </div>

          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={applySuggestedFavoritesMutation.isPending}>
              Batal
            </AlertDialogCancel>
            <Button
              type="button"
              onClick={handleApplySuggestedFavorites}
              disabled={
                applySuggestedFavoritesMutation.isPending
                || selectedSuggestedFavoriteIds.size === 0
                || suggestedNonFavoriteCount === 0
              }
            >
              {applySuggestedFavoritesMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Mengemaskini...
                </>
              ) : (
                'Tandakan Favorite'
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AnimatePresence>
        {(showAddForm || editingItem) && (
          <ItemFormProvider itemId={editingItem?.id} categories={categories} wallets={businessWallets}>
            <AddItemForm 
              item={editingItem} 
              onSave={(data) => itemMutation.mutateAsync({ itemData: data, originalStatus: editingItem?.status })}
              onCancel={() => { setShowAddForm(false); setEditingItem(null); }} 
              categories={categories}
              clients={clients}
              wallets={businessWallets}
              isSaving={itemMutation.isPending}
              onClientAdded={() => queryClient.invalidateQueries({ queryKey: ['clients', user.id]})}
            />
          </ItemFormProvider>
        )}
      </AnimatePresence>
    </>
  );
}

export default App;
