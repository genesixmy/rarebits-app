
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

  // State for UI control
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

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
    console.log("forceRefetchAll: Invalidating queries...");
    await queryClient.invalidateQueries({ queryKey: ['items', user?.id] });
    await queryClient.invalidateQueries({ queryKey: ['wallets', user?.id] });
    await queryClient.invalidateQueries({ queryKey: ['transactions'] });
    // Invalidate all wallet-related queries with wildcard patterns
    await queryClient.invalidateQueries({ queryKey: ['wallet'] });
    await queryClient.invalidateQueries({ queryKey: ['transactions', user?.id] });
    console.log("forceRefetchAll: Queries invalidated.");
  }, [queryClient, user?.id]);

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
                const reversalParams = { p_item_id: upsertedItem.id, p_user_id: user.id };
                console.log("Reversal params:", reversalParams);
                const { error: reversalError } = await supabase.rpc('handle_item_sale_reversal', reversalParams);
                if (reversalError) throw new Error(`Gagal membatalkan jualan lama: ${reversalError.message}`);
                console.log("Step 2a SUCCESS: Existing sale reversed.");
                
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
            console.log("Step 2: Sale REVERTED. Calling handle_item_sale_reversal...");
            const reversalParams = { p_item_id: upsertedItem.id, p_user_id: user.id };
            console.log("Reversal params:", reversalParams);
            const { error } = await supabase.rpc('handle_item_sale_reversal', reversalParams);
            if (error) throw new Error(`Item dikemas kini, tetapi pembatalan jualan gagal: ${error.message}`);
            console.log("Step 2 SUCCESS: handle_item_sale_reversal called.");
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
        setShowAddForm(false);
        setEditingItem(null);
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
        const { error: reversalError } = await supabase.rpc('handle_item_sale_reversal', { p_item_id: itemId, p_user_id: user.id });
        if (reversalError) throw new Error(`Gagal membatalkan jualan sebelum memadam: ${reversalError.message}`);
      }
      
      if (itemToDelete.image_url) {
        const filePath = itemToDelete.image_url.split('/item_images/')[1];
        if (filePath) {
            const { error: storageError } = await supabase.storage.from('item_images').remove([filePath]);
            if (storageError) console.warn(`Could not delete image from storage: ${storageError.message}`);
        }
      }

      const { error: deleteError } = await supabase.from('items').delete().eq('id', itemId);
      if (deleteError) throw new Error(`Gagal memadam item dari pangkalan data: ${deleteError.message}`);
    },
    onSuccess: () => {
      toast({ title: 'Item berjaya dipadam secara kekal!' });
    },
    onError: (error) => {
      toast({ title: "Gagal memadam item", description: error.message, variant: "destructive", duration: 9000 });
    },
    onSettled: async () => {
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
        )}
      </AnimatePresence>
    </>
  );
}

export default App;
