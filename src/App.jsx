
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Helmet } from 'react-helmet';
import { motion, AnimatePresence } from 'framer-motion';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import Dashboard from '@/components/Dashboard';
import ItemList from '@/components/ItemList';
import AddItemForm from '@/components/AddItemForm';
import LoginPage from '@/components/LoginPage';
import SettingsPage from '@/components/SettingsPage';
import SalesPage from '@/components/SalesPage';
import ClientsPage from '@/components/clients/ClientsPage';
import ClientDetailPage from '@/components/clients/ClientDetailPage';
import WalletPage from '@/components/wallet/WalletPage';
import WalletAccountPage from '@/components/wallet/WalletAccountPage';
import Layout from '@/components/layout/Layout';
import { Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext.jsx';
import { ItemFormProvider } from '@/contexts/ItemFormContext';
import { useEditingState } from '@/contexts/EditingStateContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toSnakeCase } from '@/lib/utils';

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

const fetchItems = async (userId) => {
  const { data, error } = await supabase.from('items').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
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

  // State for UI control
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

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

  const { data: items = [], error: itemsError, isLoading: isLoadingItems } = useQuery({
    queryKey: ['items', user?.id],
    queryFn: () => fetchItems(user.id),
    enabled: !!user,
  });

  const { data: clients = [], error: clientsError } = useQuery({
    queryKey: ['clients', user?.id],
    queryFn: () => fetchClients(user.id),
    enabled: !!user,
  });
  
  const { data: wallets = [], error: walletsError } = useQuery({
    queryKey: ['wallets', user?.id],
    queryFn: () => fetchAllWallets(user.id),
    enabled: !!user,
  });

  useEffect(() => {
    if (profileError) toast({ title: "Gagal memuatkan profil", description: profileError.message, variant: "destructive" });
    if (categoriesError) toast({ title: "Gagal memuatkan kategori", description: categoriesError.message, variant: "destructive" });
    if (itemsError) toast({ title: "Gagal memuatkan item", description: itemsError.message, variant: "destructive" });
    if (clientsError) toast({ title: "Gagal memuatkan pelanggan", description: clientsError.message, variant: "destructive" });
    if (walletsError) toast({ title: "Gagal memuatkan wallet", description: walletsError.message, variant: "destructive" });
  }, [profileError, categoriesError, itemsError, clientsError, walletsError, toast]);

  // Auth state listener
  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') navigate('/login', { replace: true });
    });
    return () => authListener.subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (!authLoading && !user && location.pathname !== '/login') {
      navigate('/login', { replace: true });
    }
  }, [user, authLoading, location.pathname, navigate]);

  const forceRefetchAll = useCallback(async () => {
    console.log("forceRefetchAll: Invalidating ALL queries...");
    // This will invalidate ALL queries in the cache
    await queryClient.invalidateQueries();
    console.log("forceRefetchAll: All queries invalidated.");
  }, [queryClient]);

  // Mutations
  const itemMutation = useMutation({
    mutationFn: async ({ itemData, originalStatus }) => {
        const isEditing = !!itemData.id;
        const wasSold = originalStatus === 'terjual';
        const isNowSold = itemData.status === 'terjual';

        // Sanitize all data before processing
        const { wallet_id, ...sanitizedItemData } = {
            ...itemData,
            client_id: itemData.client_id === '' ? null : itemData.client_id,
            dateSold: itemData.dateSold === '' ? null : itemData.dateSold,
            sellingPrice: (itemData.sellingPrice === '' || itemData.sellingPrice === null) ? 0 : parseFloat(itemData.sellingPrice),
            costPrice: (itemData.costPrice === '' || itemData.costPrice === null) ? 0 : parseFloat(itemData.costPrice),
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
    onSuccess: (data) => {
        const messages = {
            sold: 'Jualan berjaya direkodkan!',
            updated_sale: 'Jualan berjaya dikemaskini!',
            reverted: 'Jualan berjaya dibatalkan!',
            created: 'Item baharu berjaya ditambah!',
            updated: 'Item berjaya dikemaskini!'
        };
        toast({ title: "Berjaya!", description: messages[data.action] });
        clearEditingState();
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
        await forceRefetchAll();
    }
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId) => {
      const itemToDelete = items.find(item => item.id === itemId);
      if (!itemToDelete) throw new Error("Item tidak ditemui untuk dipadam.");

      if (itemToDelete.status === 'terjual') {
        console.log("[deleteItemMutation] Item is sold, reverting sale before deletion...");
        
        // STEP 1: Find the transaction for this item
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
            
            // STEP 2: Reverse the wallet balance
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
            
            // STEP 3: Delete the transaction
            const { error: deleteTxError } = await supabase
                .from('transactions')
                .delete()
                .eq('id', transactions.id);
            
            if (deleteTxError) {
                throw new Error(`Gagal memadam transaksi: ${deleteTxError.message}`);
            }
            
            console.log("[deleteItemMutation] Transaction deleted and wallet reversed successfully");
        } else {
            console.log("[deleteItemMutation] No transaction found for this item");
        }
      }
      
      if (itemToDelete.image_url) {
        const filePath = itemToDelete.image_url.split('/item_images/')[1];
        if (filePath) {
            const { error: storageError } = await supabase.storage.from('item_images').remove([filePath]);
            if (storageError) console.warn(`Could not delete image from storage: ${storageError.message}`);
        }
      }

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

  const filteredItems = items.filter(item => 
    ((item.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || (item.category || '').toLowerCase().includes(searchTerm.toLowerCase())) &&
    (filterCategory === 'all' || item.category === filterCategory) &&
    (filterStatus === 'all' || item.status === filterStatus)
  );
  
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
    '/clients': 'Pelanggan', '/wallet': 'Wallet', '/settings': 'Tetapan'
  }[location.pathname] || 'Papan Pemuka';

  return (
    <>
      <Helmet><title>RareBits - {pageTitle}</title></Helmet>
      
      <Layout user={user} profile={profile} onSignOut={signOut} onAddItem={() => { setEditingItem(null); setShowAddForm(true); }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
          >
            <Routes>
              <Route path="/" element={<Dashboard items={items} categories={categories} />} />
              <Route path="/inventory" element={
                <div className="space-y-6">
                  <h1 className="page-title">Inventori</h1>
                   <div className="px-6 py-4 bg-background rounded-2xl shadow-sm">
                      <h2 className="text-lg font-semibold mb-4">Tapis Item</h2>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" /><Input placeholder="Cari item..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" /></div>
                        <Select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}><option value="all">Semua Kategori</option>{categories.map(cat => <option key={cat.id} value={cat.name}>{cat.name}</option>)}</Select>
                        <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}><option value="all">Semua Status</option><option value="tersedia">Tersedia</option><option value="reserved">Reserved</option><option value="terjual">Terjual</option></Select>
                      </div>
                    </div>
                  {isLoadingItems || itemMutation.isPending || deleteItemMutation.isPending ? <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin" /></div> : <ItemList items={filteredItems} onEdit={(item) => { setEditingItem(item); setShowAddForm(true); }} onDelete={deleteItemMutation.mutate} />}
                </div>
              } />
              <Route path="/sales" element={<SalesPage items={items} />} />
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/clients/:id" element={<ClientDetailPage />} />
              <Route path="/wallet" element={<WalletPage />} />
              <Route path="/wallet/account/:accountId" element={<WalletAccountPage />} />
              <Route path="/settings" element={<SettingsPage user={user} categories={categories} onUpdateCategories={() => queryClient.invalidateQueries({ queryKey: ['categories', user.id] })} onUpdateProfile={() => queryClient.invalidateQueries({ queryKey: ['profile', user.id] })} />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </Layout>

      <AnimatePresence>
        {(showAddForm || editingItem) && (
          <ItemFormProvider itemId={editingItem?.id} categories={categories} wallets={wallets.filter(w => w.account_type === 'Business')}>
            <AddItemForm 
              item={editingItem} 
              onSave={(data) => itemMutation.mutate({ itemData: data, originalStatus: editingItem?.status })}
              onCancel={() => { setShowAddForm(false); setEditingItem(null); }} 
              categories={categories}
              clients={clients}
              wallets={wallets.filter(w => w.account_type === 'Business')}
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
