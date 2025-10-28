
import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Plus, MoreVertical, Edit, Trash2, Wallet as WalletIcon, ArrowRightLeft, Repeat, ChevronRight, Briefcase, User, BarChart2, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Link, useNavigate } from 'react-router-dom';
import WalletFormModal from '@/components/wallet/WalletFormModal';
import TransactionFormModal from '@/components/wallet/TransactionFormModal';
import TransferFormModal from '@/components/wallet/TransferFormModal';
import TransactionList from '@/components/wallet/TransactionList';
import WalletAnalytics from '@/components/wallet/WalletAnalytics';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";


const fetchWallets = async (userId) => {
  const { data, error } = await supabase.from('wallets').select('*').eq('user_id', userId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
};

const fetchTransactions = async (userId) => {
  const { data, error } = await supabase.from('transactions').select('*, wallets(name, account_type)').eq('user_id', userId).order('transaction_date', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
};

const AccountTypeFilter = ({ filter, setFilter }) => (
    <div className="flex items-center gap-2 bg-muted p-1 rounded-lg">
      <Button
        variant={filter === 'Business' ? 'default' : 'ghost'}
        size="sm"
        className="flex-1"
        onClick={() => setFilter('Business')}
      >
        <Briefcase className="mr-2 h-4 w-4" />
        Business
      </Button>
      <Button
        variant={filter === 'Personal' ? 'default' : 'ghost'}
        size="sm"
        className="flex-1"
        onClick={() => setFilter('Personal')}
      >
        <User className="mr-2 h-4 w-4" />
        Personal
      </Button>
      <Button
        variant={filter === 'All' ? 'default' : 'ghost'}
        size="sm"
        className="flex-1"
        onClick={() => setFilter('All')}
      >
        Semua
      </Button>
    </div>
);


const WalletPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [editingWallet, setEditingWallet] = useState(null);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [deletingWallet, setDeletingWallet] = useState(null);
  const [deletingTransaction, setDeletingTransaction] = useState(null);
  const [accountTypeFilter, setAccountTypeFilter] = useState('Business');
  const [displayLimit, setDisplayLimit] = useState(20);

  const { data: allWallets = [], isLoading: isLoadingWallets, isError: isWalletsError, refetch: refetchWallets, isRefetching: isRefetchingWallets } = useQuery({
    queryKey: ['wallets', user?.id],
    queryFn: () => fetchWallets(user.id),
    enabled: !!user,
  });

  const { data: allTransactions = [], isLoading: isLoadingTransactions, isError: isTransactionsError, refetch: refetchTransactions, isRefetching: isRefetchingTransactions } = useQuery({
    queryKey: ['transactions', user?.id, 'all'],
    queryFn: () => fetchTransactions(user.id),
    enabled: !!user,
  });

  // Supabase Realtime Subscription
  useEffect(() => {
    if (!user) return;

    const handleRealtimeUpdate = (source) => (payload) => {
        console.log(`Realtime update from ${source}:`, payload);
        toast({
            title: 'Data dikemas kini!',
            description: 'Perubahan data telah disegerakkan.',
        });
        queryClient.invalidateQueries({ queryKey: ['wallets', user.id] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
    };

    const handleItemsUpdate = (payload) => {
        console.log('Items table updated:', payload);
        // When items change (especially status changes), invalidate wallet queries
        queryClient.invalidateQueries({ queryKey: ['wallets', user.id] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        queryClient.invalidateQueries({ queryKey: ['wallet'] });
    };

    const walletsChannel = supabase
        .channel('public:wallets')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wallets' }, handleRealtimeUpdate('wallets'))
        .subscribe();
    
    const transactionsChannel = supabase
        .channel('public:transactions')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, handleRealtimeUpdate('transactions'))
        .subscribe();

    const itemsChannel = supabase
        .channel('public:items')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, handleItemsUpdate)
        .subscribe();

    return () => {
        supabase.removeChannel(walletsChannel);
        supabase.removeChannel(transactionsChannel);
        supabase.removeChannel(itemsChannel);
    };
  }, [user, queryClient, toast]);

  const handleRefresh = () => {
    toast({ title: 'Memuat semula data...' });
    queryClient.invalidateQueries({ queryKey: ['wallets', user?.id] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
  }

  const filteredWallets = useMemo(() => {
    if (accountTypeFilter === 'All') return allWallets;
    return allWallets.filter(w => w.account_type === accountTypeFilter);
  }, [allWallets, accountTypeFilter]);
  
  const filteredWalletIds = useMemo(() => new Set(filteredWallets.map(w => w.id)), [filteredWallets]);

  const filteredTransactions = useMemo(() => {
    if (accountTypeFilter === 'All') {
        return allTransactions;
    }
    
    const walletIdToTypeMap = new Map(allWallets.map(w => [w.id, w.account_type]));

    return allTransactions.filter(tx => {
        const txWalletType = walletIdToTypeMap.get(tx.wallet_id);

        if (tx.type === 'pemindahan_keluar' || tx.type === 'pemindahan_masuk') {
            const relatedTransferTx = allTransactions.find(otherTx => otherTx.transfer_id === tx.transfer_id && otherTx.id !== tx.id);
            if (!relatedTransferTx) return false; // Incomplete transfer data

            const sourceWalletType = walletIdToTypeMap.get(tx.type === 'pemindahan_keluar' ? tx.wallet_id : relatedTransferTx.wallet_id);
            const destWalletType = walletIdToTypeMap.get(tx.type === 'pemindahan_masuk' ? tx.wallet_id : relatedTransferTx.wallet_id);
            
            return sourceWalletType === accountTypeFilter || destWalletType === accountTypeFilter;
        }
        
        return txWalletType === accountTypeFilter;
    });
  }, [allTransactions, allWallets, accountTypeFilter]);
  
  const transactionsToDisplay = useMemo(() => filteredTransactions.slice(0, displayLimit), [filteredTransactions, displayLimit]);

  const walletMutation = useMutation({
    mutationFn: async (walletData) => {
      const isEditing = !!walletData.id;
      const { error } = await supabase.rpc('handle_wallet_upsert', {
          p_id: isEditing ? walletData.id : null,
          p_user_id: user.id,
          p_name: walletData.name,
          p_balance: walletData.balance,
          p_account_type: walletData.account_type
      });
      if (error) throw error;
      return isEditing;
    },
    onSuccess: (isEditing) => {
      queryClient.invalidateQueries({ queryKey: ['wallets', user.id] });
      toast({ title: `Wallet ${isEditing ? 'dikemaskini' : 'disimpan'}!` });
      setIsWalletModalOpen(false);
      setEditingWallet(null);
    },
    onError: (error, variables) => {
      const isEditing = !!variables.id;
      toast({ title: `Gagal ${isEditing ? 'mengemas kini' : 'menyimpan'} wallet`, description: error.message, variant: "destructive" });
    },
  });

  const transactionMutation = useMutation({
    mutationFn: async ({ transactionData, isEditing }) => {
        let rpcName, params;
        if (isEditing) {
            rpcName = 'update_transaction_and_adjust_wallets';
            params = {
                p_transaction_id: transactionData.id,
                p_user_id: user.id,
                p_new_wallet_id: transactionData.wallet_id,
                p_new_amount: transactionData.amount,
                p_new_date: transactionData.transaction_date,
                p_new_description: transactionData.description,
                p_new_category: transactionData.category
            };
        } else {
            rpcName = 'add_transaction_and_update_wallet';
            params = {
                p_user_id: user.id,
                p_wallet_id: transactionData.wallet_id,
                p_type: transactionData.type,
                p_amount: transactionData.amount,
                p_description: transactionData.description,
                p_category: transactionData.category,
                p_transaction_date: transactionData.transaction_date
            };
        }
        const { error } = await supabase.rpc(rpcName, params);
        if (error) throw error;
        return isEditing;
    },
    onSuccess: (isEditing) => {
        queryClient.invalidateQueries({ queryKey: ['wallets', user.id] });
        queryClient.invalidateQueries({ queryKey: ['transactions', user.id, 'all'] });
        toast({ title: `Transaksi berjaya ${isEditing ? 'dikemaskini' : 'disimpan'}!` });
        setIsTransactionModalOpen(false);
        setEditingTransaction(null);
    },
    onError: (error, variables) => {
        toast({ title: `Gagal ${variables.isEditing ? 'mengemas kini' : 'menyimpan'} transaksi`, description: error.message, variant: "destructive" });
    },
});

  const deleteTransactionMutation = useMutation({
    mutationFn: async (transaction) => {
        const rpcName = transaction.type.startsWith('pemindahan') ? 'delete_transfer_transactions' : 'delete_transaction_and_adjust_wallet';
        const params = transaction.type.startsWith('pemindahan') ? { p_transfer_id: transaction.transfer_id, p_user_id: user.id } : { p_transaction_id: transaction.id, p_user_id: user.id };
        const { error } = await supabase.rpc(rpcName, params);
        if (error) throw error;
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['wallets', user.id] });
        queryClient.invalidateQueries({ queryKey: ['transactions', user.id, 'all'] });
        toast({ title: "Transaksi dipadam!" });
        setDeletingTransaction(null);
    },
    onError: (error) => {
        toast({ title: "Gagal memadam transaksi", description: error.message, variant: "destructive" });
        setDeletingTransaction(null);
    },
  });

  const transferFundsMutation = useMutation({
    mutationFn: async (transferData) => {
      const { error } = await supabase.rpc('transfer_funds_between_wallets', {
        p_user_id: user.id,
        p_source_wallet_id: transferData.source_wallet_id,
        p_destination_wallet_id: transferData.destination_wallet_id,
        p_amount: transferData.amount,
        p_transaction_date: transferData.transaction_date,
        p_description: transferData.description,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallets', user.id] });
      queryClient.invalidateQueries({ queryKey: ['transactions', user.id, 'all'] });
      toast({ title: "Pemindahan dana berjaya!" });
      setIsTransferModalOpen(false);
    },
    onError: (error) => {
      toast({ title: "Gagal memindahkan dana", description: error.message, variant: "destructive" });
    },
  });

  const deleteWalletMutation = useMutation({
    mutationFn: async (walletId) => {
      const { error } = await supabase.from('wallets').delete().eq('id', walletId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallets', user.id] });
      queryClient.invalidateQueries({ queryKey: ['transactions', user.id, 'all'] });
      toast({ title: "Wallet dipadam!" });
      setDeletingWallet(null);
    },
    onError: (error) => {
      toast({ title: "Gagal memadam wallet", description: error.message, variant: "destructive" });
      setDeletingWallet(null);
    },
  });
  
  const walletsForTransactionForm = useMemo(() => {
    if (accountTypeFilter === 'All') {
      return allWallets;
    }
    return allWallets.filter(w => w.account_type === accountTypeFilter);
  }, [allWallets, accountTypeFilter]);

  const totalBalance = filteredWallets.reduce((sum, wallet) => sum + parseFloat(wallet.balance), 0);

  if (isLoadingWallets || isLoadingTransactions) {
    return (
      <div className="flex justify-center items-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isWalletsError || isTransactionsError) {
    return <div className="text-center py-12 text-destructive">Gagal memuatkan data. Sila cuba lagi.</div>;
  }
  
  const isActionDisabled = accountTypeFilter === 'All';
  const actionButtonTooltip = "Sila pilih penapis 'Business' atau 'Personal' untuk meneruskan.";

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h1 className="page-title">Wallet</h1>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <Button onClick={handleRefresh} variant="outline" className="w-full sm:w-auto">
              <RefreshCw className={cn("mr-2 h-4 w-4", (isRefetchingWallets || isRefetchingTransactions) && "animate-spin")} /> Muat Semula
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-full sm:w-auto">
                  <Button onClick={() => setIsTransferModalOpen(true)} variant="outline" disabled={allWallets.length < 2 || isActionDisabled} className="w-full sm:w-auto">
                    <Repeat className="mr-2 h-4 w-4" /> Pindah Dana
                  </Button>
                </div>
              </TooltipTrigger>
              {isActionDisabled && <TooltipContent>{actionButtonTooltip}</TooltipContent>}
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-full sm:w-auto">
                  <Button onClick={() => { setEditingTransaction(null); setIsTransactionModalOpen(true); }} disabled={walletsForTransactionForm.length === 0 || isActionDisabled} className="w-full sm:w-auto">
                    <Plus className="mr-2 h-4 w-4" /> Tambah Transaksi
                  </Button>
                </div>
              </TooltipTrigger>
              {isActionDisabled && <TooltipContent>{actionButtonTooltip}</TooltipContent>}
            </Tooltip>
          </div>
        </div>

        <AccountTypeFilter filter={accountTypeFilter} setFilter={setAccountTypeFilter} />

        <Card className="brand-gradient text-white">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white/90">Jumlah Baki ({accountTypeFilter})</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold">RM {totalBalance.toFixed(2)}</p>
            <p className="text-sm text-white/80 mt-1">Dari {filteredWallets.length} akaun</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Senarai Wallet ({accountTypeFilter})</CardTitle>
            <Button onClick={() => { setEditingWallet(null); setIsWalletModalOpen(true); }} variant="ghost" size="sm">
                <Plus className="mr-2 h-4 w-4" /> Tambah
            </Button>
          </CardHeader>
          <CardContent>
            {filteredWallets.length > 0 ? (
              <ul className="space-y-1">
                {filteredWallets.map(wallet => (
                  <li key={wallet.id}>
                      <div className="flex items-center justify-between p-2 -m-2 rounded-lg hover:bg-muted/50 transition-colors group">
                      <Link to={`/wallet/account/${wallet.id}`} className="flex-1">
                        <div className="flex items-center gap-3">
                          <WalletIcon className="w-5 h-5 text-primary" />
                          <div>
                            <p className="font-semibold flex items-center gap-2">
                              {wallet.name}
                              <span className={cn(
                                  "text-xs font-semibold px-2 py-0.5 rounded-full",
                                  wallet.account_type === 'Business' ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800"
                              )}>
                                  {wallet.account_type === 'Business' ? <Briefcase className='inline w-3 h-3 mr-1' /> : <User className='inline w-3 h-3 mr-1' />}
                                  {wallet.account_type}
                              </span>
                            </p>
                            <p className="text-sm text-muted-foreground">RM {parseFloat(wallet.balance).toFixed(2)}</p>
                          </div>
                        </div>
                      </Link>
                      <div className='flex items-center'>
                        <ChevronRight className="w-5 h-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setEditingWallet(wallet); setIsWalletModalOpen(true); }}>
                                <Edit className="mr-2 h-4 w-4" /> Sunting
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setDeletingWallet(wallet)} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                                <Trash2 className="mr-2 h-4 w-4" /> Padam
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-center py-4">Tiada wallet ditemui untuk penapis ini.</p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <TransactionList 
            transactions={transactionsToDisplay}
            wallets={allWallets}
            onEdit={(tx) => { setEditingTransaction(tx); setIsTransactionModalOpen(true); }}
            onDelete={(tx) => setDeletingTransaction(tx)}
          />
          {filteredTransactions.length > displayLimit && (
            <Button variant="outline" className="w-full" onClick={() => setDisplayLimit(prev => prev + 20)}>
              Muat Lagi
            </Button>
          )}
        </div>

        <div className="pt-6">
            <WalletAnalytics transactions={filteredTransactions} wallets={filteredWallets} />
        </div>
        
        {allWallets.length === 0 && !isLoadingWallets && (
          <div className="text-center py-12 border-2 border-dashed rounded-lg mt-6">
            <WalletIcon className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">Tiada akaun wallet</h3>
            <p className="mt-1 text-sm text-muted-foreground">Sila tambah akaun wallet untuk mula merekod transaksi.</p>
            <div className="mt-6">
              <Button onClick={() => { setEditingWallet(null); setIsWalletModalOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" /> Tambah Wallet
              </Button>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {isWalletModalOpen && (
          <WalletFormModal
            wallet={editingWallet}
            onSave={(data) => walletMutation.mutate(data)}
            onCancel={() => { setIsWalletModalOpen(false); setEditingWallet(null); }}
            isSaving={walletMutation.isPending}
          />
        )}
        {isTransactionModalOpen && (
          <TransactionFormModal
            transaction={editingTransaction}
            wallets={walletsForTransactionForm}
            onSave={(data) => {
              transactionMutation.mutate({ transactionData: data, isEditing: !!editingTransaction });
            }}
            onCancel={() => { setIsTransactionModalOpen(false); setEditingTransaction(null); }}
            isSaving={transactionMutation.isPending}
          />
        )}
        {isTransferModalOpen && (
          <TransferFormModal
            wallets={allWallets}
            onSave={(data) => transferFundsMutation.mutate(data)}
            onCancel={() => setIsTransferModalOpen(false)}
            isSaving={transferFundsMutation.isPending}
          />
        )}
      </AnimatePresence>

      <AlertDialog open={!!deletingWallet} onOpenChange={() => setDeletingWallet(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Adakah anda pasti?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini akan memadamkan akaun wallet "{deletingWallet?.name}" dan semua transaksinya secara kekal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteWalletMutation.mutate(deletingWallet.id)} disabled={deleteWalletMutation.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteWalletMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Padam'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      <AlertDialog open={!!deletingTransaction} onOpenChange={() => setDeletingTransaction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Adakah anda pasti?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini akan memadamkan transaksi ini secara kekal dan mengemas kini baki wallet anda.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTransactionMutation.mutate(deletingTransaction)} disabled={deleteTransactionMutation.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
               {deletingTransaction?.type.startsWith('pemindahan') ? 'Padam Pemindahan' : (deleteTransactionMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Padam')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
};

export default WalletPage;
