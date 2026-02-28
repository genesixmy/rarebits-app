
import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Plus, MoreVertical, Edit, Trash2, Wallet as WalletIcon, ArrowRightLeft, Repeat, Briefcase, User, BarChart2, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import WalletFormModal from '@/components/wallet/WalletFormModal';
import TransactionFormModal from '@/components/wallet/TransactionFormModal';
import TransferFormModal from '@/components/wallet/TransferFormModal';
import TransactionList from '@/components/wallet/TransactionList';
import WalletAnalytics from '@/components/wallet/WalletAnalytics';
import {
  isTransferLegacyType,
  isTransferOutLegacyType,
  manualTypeToLegacyType,
  resolveTransactionClassification,
  TRANSACTION_CLASSIFICATIONS,
} from '@/components/wallet/transactionClassification';
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

const WALLET_PREVIEW_THEMES = [
  'from-cyan-500 via-sky-500 to-cyan-600',
  'from-orange-400 via-orange-500 to-amber-500',
  'from-emerald-400 via-green-500 to-emerald-600',
  'from-teal-500 via-cyan-500 to-teal-600',
];

const getWalletPreviewTheme = (index) => (
  WALLET_PREVIEW_THEMES[index % WALLET_PREVIEW_THEMES.length]
);

const WalletPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [editingWallet, setEditingWallet] = useState(null);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [deletingWallet, setDeletingWallet] = useState(null);
  const [deletingTransaction, setDeletingTransaction] = useState(null);
  const [accountTypeFilter, setAccountTypeFilter] = useState('Business');
  const [walletSort, setWalletSort] = useState('newest');
  const [displayLimit, setDisplayLimit] = useState(20);
  const tabFilter = searchParams.get('tab') === 'expenses' ? 'expenses' : '';

  const { data: allWallets = [], isLoading: isLoadingWallets, isError: isWalletsError, refetch: refetchWallets, isRefetching: isRefetchingWallets } = useQuery({
    queryKey: ['wallets', user?.id],
    queryFn: () => fetchWallets(user.id),
    enabled: !!user,
    staleTime: 0, // Consider data always stale so refetch updates display
    gcTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const { data: allTransactions = [], isLoading: isLoadingTransactions, isError: isTransactionsError, refetch: refetchTransactions, isRefetching: isRefetchingTransactions } = useQuery({
    queryKey: ['transactions', user?.id, 'all'],
    queryFn: () => fetchTransactions(user.id),
    enabled: !!user,
    staleTime: 0, // Consider data always stale
    gcTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  // Supabase Realtime Subscription
  useEffect(() => {
    if (!user) return;

    const handleRealtimeUpdate = (source) => (payload) => {
        console.log(`[WalletPage] Realtime update from ${source}:`, payload);
        console.log(`[WalletPage] Invalidating queries for source: ${source}`);
        toast({
            title: 'Data dikemas kini!',
            description: 'Perubahan data telah disegerakkan.',
        });
        queryClient.invalidateQueries({ queryKey: ['wallets', user.id] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        // CRITICAL: Also invalidate the specific transaction query key used in this page
        queryClient.invalidateQueries({ queryKey: ['transactions', user.id, 'all'] });
        console.log(`[WalletPage] Query invalidation complete for source: ${source}`);
    };

    const handleItemsUpdate = (payload) => {
        console.log('[WalletPage] Items table updated:', payload);
        // When items change (especially status changes), invalidate wallet queries
        console.log('[WalletPage] Invalidating wallet and transaction queries due to item update');
        queryClient.invalidateQueries({ queryKey: ['wallets', user.id] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        // CRITICAL: Also invalidate the specific transaction query key used in this page
        queryClient.invalidateQueries({ queryKey: ['transactions', user.id, 'all'] });
        queryClient.invalidateQueries({ queryKey: ['wallet'] });
        console.log('[WalletPage] Query invalidation complete for item update');
    };

    const walletsChannel = supabase
        .channel('public:wallets')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wallets', filter: `user_id=eq.${user.id}` }, handleRealtimeUpdate('wallets'))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wallets', filter: `user_id=eq.${user.id}` }, handleRealtimeUpdate('wallets'))
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'wallets', filter: `user_id=eq.${user.id}` }, handleRealtimeUpdate('wallets'))
        .subscribe();
    
    const transactionsChannel = supabase
        .channel('public:transactions')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions', filter: `user_id=eq.${user.id}` }, handleRealtimeUpdate('transactions'))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transactions', filter: `user_id=eq.${user.id}` }, handleRealtimeUpdate('transactions'))
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'transactions', filter: `user_id=eq.${user.id}` }, handleRealtimeUpdate('transactions'))
        .subscribe();

    const itemsChannel = supabase
        .channel('public:items')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'items', filter: `user_id=eq.${user.id}` }, handleItemsUpdate)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'items', filter: `user_id=eq.${user.id}` }, handleItemsUpdate)
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'items', filter: `user_id=eq.${user.id}` }, handleItemsUpdate)
        .subscribe();

    return () => {
        supabase.removeChannel(walletsChannel);
        supabase.removeChannel(transactionsChannel);
        supabase.removeChannel(itemsChannel);
    };
  }, [user, queryClient, toast]);

  // Refetch data when page becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[WalletPage] Page became visible, refetching data...');
        refetchWallets();
        refetchTransactions();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refetchWallets, refetchTransactions]);

  // Refetch data on component mount (for route navigation within same app)
  useEffect(() => {
    console.log('[WalletPage] Component mounted, refetching data...');
    refetchWallets();
    refetchTransactions();
  }, []);

  const handleRefresh = () => {
    toast({ title: 'Memuat semula data...' });
    queryClient.invalidateQueries({ queryKey: ['wallets', user?.id] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    // CRITICAL: Also invalidate the specific transaction query key used in this page
    queryClient.invalidateQueries({ queryKey: ['transactions', user?.id, 'all'] });
  }

  const filteredWallets = useMemo(() => {
    if (accountTypeFilter === 'All') return allWallets;
    return allWallets.filter(w => w.account_type === accountTypeFilter);
  }, [allWallets, accountTypeFilter]);

  const sortedFilteredWallets = useMemo(() => (
    [...filteredWallets].sort((left, right) => {
      const leftCreatedAt = new Date(left?.created_at || 0).getTime();
      const rightCreatedAt = new Date(right?.created_at || 0).getTime();
      const leftBalance = parseFloat(left?.balance) || 0;
      const rightBalance = parseFloat(right?.balance) || 0;

      if (walletSort === 'oldest' && leftCreatedAt !== rightCreatedAt) {
        return leftCreatedAt - rightCreatedAt;
      }
      if (walletSort === 'balance_high' && leftBalance !== rightBalance) {
        return rightBalance - leftBalance;
      }
      if (walletSort === 'balance_low' && leftBalance !== rightBalance) {
        return leftBalance - rightBalance;
      }
      if (walletSort === 'newest' && leftCreatedAt !== rightCreatedAt) {
        return rightCreatedAt - leftCreatedAt;
      }
      return String(left?.name || '').localeCompare(String(right?.name || ''), 'ms', { sensitivity: 'base' });
    })
  ), [filteredWallets, walletSort]);
  
  const filteredWalletIds = useMemo(() => new Set(filteredWallets.map(w => w.id)), [filteredWallets]);

  const filteredTransactions = useMemo(() => {
    const walletIdToTypeMap = new Map(allWallets.map(w => [w.id, w.account_type]));

    const accountScopedTransactions = accountTypeFilter === 'All'
      ? allTransactions
      : allTransactions.filter(tx => {
          const txWalletType = walletIdToTypeMap.get(tx.wallet_id);

          if (isTransferLegacyType(tx.type)) {
              const relatedTransferTx = allTransactions.find(otherTx => otherTx.transfer_id === tx.transfer_id && otherTx.id !== tx.id);
              if (!relatedTransferTx) return false; // Incomplete transfer data

              const sourceWalletType = walletIdToTypeMap.get(isTransferOutLegacyType(tx.type) ? tx.wallet_id : relatedTransferTx.wallet_id);
              const destWalletType = walletIdToTypeMap.get(isTransferOutLegacyType(tx.type) ? relatedTransferTx.wallet_id : tx.wallet_id);
              
              return sourceWalletType === accountTypeFilter || destWalletType === accountTypeFilter;
          }
          
          return txWalletType === accountTypeFilter;
      });

    if (tabFilter !== 'expenses') {
      return accountScopedTransactions;
    }

    return accountScopedTransactions.filter((tx) => {
      const classification = resolveTransactionClassification(tx);
      if (classification === TRANSACTION_CLASSIFICATIONS.EXPENSE) return true;
      return tx.type === 'sales_return' || tx.type === 'refund' || tx.type === 'refund_adjustment' || tx.type === 'goodwill_adjustment';
    });
  }, [allTransactions, allWallets, accountTypeFilter, tabFilter]);
  
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
            const parsedAmount = parseFloat(transactionData.amount);
            if (!Number.isFinite(parsedAmount)) {
              throw new Error('Jumlah transaksi tidak sah');
            }

            if (transactionData.type === 'adjustment') {
              const { data: walletSnapshot, error: walletError } = await supabase
                .from('wallets')
                .select('balance')
                .eq('id', transactionData.wallet_id)
                .eq('user_id', user.id)
                .single();

              if (walletError || !walletSnapshot) {
                throw new Error('Wallet tidak ditemui untuk pelarasan');
              }

              const delta = transactionData.adjustment_direction === 'decrease'
                ? -Math.abs(parsedAmount)
                : Math.abs(parsedAmount);
              const nextBalance = (parseFloat(walletSnapshot.balance) || 0) + delta;
              if (nextBalance < 0) {
                throw new Error('Pelarasan menyebabkan baki negatif');
              }

              const { error: adjustmentError } = await supabase.rpc('adjust_wallet_balance_manually', {
                p_user_id: user.id,
                p_wallet_id: transactionData.wallet_id,
                p_new_balance: nextBalance,
              });

              if (adjustmentError) throw adjustmentError;
              return isEditing;
            }

            rpcName = 'add_transaction_and_update_wallet';
            params = {
                p_user_id: user.id,
                p_wallet_id: transactionData.wallet_id,
                p_type: manualTypeToLegacyType(transactionData.type, transactionData.adjustment_direction),
                p_amount: Math.abs(parsedAmount),
                p_description: transactionData.description,
                p_category: transactionData.category,
                p_transaction_date: transactionData.transaction_date,
                p_item_id: transactionData.item_id || null
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
        const isTransfer = isTransferLegacyType(transaction.type);
        const rpcName = isTransfer ? 'delete_transfer_transactions' : 'delete_transaction_and_adjust_wallet';
        const params = isTransfer ? { p_transfer_id: transaction.transfer_id, p_user_id: user.id } : { p_transaction_id: transaction.id, p_user_id: user.id };
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
      console.log('[WalletPage] Starting transfer:', {
        source: transferData.source_wallet_id,
        destination: transferData.destination_wallet_id,
        amount: transferData.amount,
      });

      const { data, error } = await supabase.rpc('transfer_funds_between_wallets', {
        p_user_id: user.id,
        p_source_wallet_id: transferData.source_wallet_id,
        p_destination_wallet_id: transferData.destination_wallet_id,
        p_amount: parseFloat(transferData.amount),
        p_transaction_date: transferData.transaction_date,
        p_description: transferData.description,
      });

      console.log('[WalletPage] Transfer RPC response:', { data, error });

      if (error) {
        console.error('[WalletPage] Transfer RPC error:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        console.error('[WalletPage] No response from transfer function');
        throw new Error('No response from server');
      }

      const response = data[0];
      console.log('[WalletPage] Transfer result:', response);

      // Log debug info if available
      if (response.debug_info) {
        console.log('[WalletPage] Debug info:', response.debug_info);
      }

      if (!response.success) {
        const errorMsg = response.message || 'Transfer failed';
        if (response.debug_info) {
          console.error('[WalletPage] Transfer error with debug:', errorMsg, response.debug_info);
        }
        throw new Error(errorMsg);
      }

      return response;
    },
    onSuccess: async (response) => {
      console.log('[WalletPage] Transfer successful:', response);

      // Invalidate queries to mark as stale
      queryClient.invalidateQueries({ queryKey: ['wallets', user.id] });
      queryClient.invalidateQueries({ queryKey: ['transactions', user.id, 'all'] });

      // Force immediate refetch to update UI
      console.log('[WalletPage] Forcing refetch of wallets and transactions');
      await Promise.all([
        refetchWallets(),
        refetchTransactions()
      ]);

      toast({ title: "Pemindahan dana berjaya!", description: response.message });
      setIsTransferModalOpen(false);
    },
    onError: (error) => {
      console.error('[WalletPage] Transfer mutation error:', error);
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

        {tabFilter === 'expenses' && (
          <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-amber-800">
              Penapis aktif: paparan transaksi perbelanjaan dan refund.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-amber-300 bg-white text-amber-700 hover:bg-amber-100"
              onClick={() => {
                const nextParams = new URLSearchParams(searchParams);
                nextParams.delete('tab');
                setSearchParams(nextParams, { replace: true });
              }}
            >
              Buang Penapis Ini
            </Button>
          </div>
        )}

        <Card className="overflow-hidden rounded-3xl border border-transparent bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-[0_20px_45px_-22px_rgba(8,145,178,0.65)]">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-cyan-600">
                <WalletIcon className="h-4 w-4 text-cyan-600" />
              </span>
              <CardTitle className="text-base font-semibold text-white">Jumlah Baki ({accountTypeFilter})</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xl font-bold leading-none tracking-tight md:text-2xl">RM {totalBalance.toFixed(2)}</p>
            <div className="mt-3 flex items-center gap-2">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-md bg-white/20 text-white">
                <BarChart2 className="h-3 w-3 text-white" />
              </span>
              <p className="text-xs font-medium text-white/90">Dari {filteredWallets.length} akaun</p>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-slate-200/80 bg-slate-50/70 shadow-sm">
          <CardHeader className="border-b border-slate-200/80 pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-lg font-semibold text-slate-900">Senarai Wallet</CardTitle>
                <p className="mt-1 text-sm text-slate-500">
                  {sortedFilteredWallets.length} akaun dipaparkan ({accountTypeFilter})
                </p>
              </div>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <Button
                  onClick={() => { setEditingWallet(null); setIsWalletModalOpen(true); }}
                  className="w-full rounded-full bg-cyan-500 text-white hover:bg-cyan-600 sm:w-auto"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Tambah Wallet
                </Button>
                <select
                  value={walletSort}
                  onChange={(event) => setWalletSort(event.target.value)}
                  className="h-10 rounded-full border border-cyan-200 bg-white px-4 text-sm font-medium text-cyan-700 outline-none transition focus:border-cyan-400"
                >
                  <option value="newest">Terbaharu</option>
                  <option value="oldest">Terlama</option>
                  <option value="balance_high">Baki Tertinggi</option>
                  <option value="balance_low">Baki Terendah</option>
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {sortedFilteredWallets.length > 0 ? (
              <div className="divide-y divide-slate-200/80">
                {sortedFilteredWallets.map((wallet, walletIndex) => (
                  <div key={wallet.id} className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-[132px_minmax(0,1fr)_auto] sm:items-center">
                    <Link
                      to={`/wallet/account/${wallet.id}`}
                      className={cn(
                        'group relative block h-[74px] overflow-hidden rounded-2xl bg-gradient-to-br p-3 shadow-sm transition hover:shadow-md',
                        getWalletPreviewTheme(walletIndex)
                      )}
                    >
                      <span className="pointer-events-none absolute -left-5 top-4 h-14 w-14 rounded-full bg-white/10" />
                      <span className="pointer-events-none absolute -right-3 -top-5 h-16 w-16 rounded-full bg-white/10" />
                      <span className="pointer-events-none absolute bottom-0 right-0 h-10 w-16 rounded-tl-3xl bg-white/10" />
                      <div className="relative z-10 flex h-full flex-col justify-between text-white">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/80">Wallet</p>
                        <p className="truncate text-sm font-semibold">{wallet.name}</p>
                      </div>
                    </Link>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-3">
                      <div className="min-w-0">
                        <p className="text-xs text-slate-500">Jenis Akaun</p>
                        <p className="truncate text-sm font-semibold text-slate-900">{wallet.account_type}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-slate-500">Nama Wallet</p>
                        <p className="truncate text-sm font-semibold text-slate-900">{wallet.name}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-slate-500">Baki</p>
                        <p className="truncate text-sm font-semibold text-emerald-700">RM {parseFloat(wallet.balance).toFixed(2)}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-1.5">
                      <Button asChild variant="ghost" size="sm" className="text-cyan-700 hover:bg-cyan-50 hover:text-cyan-800">
                        <Link to={`/wallet/account/${wallet.id}`}>Lihat Akaun</Link>
                      </Button>
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
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-muted-foreground">Tiada wallet ditemui untuk penapis ini.</p>
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
              {deleteTransactionMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {isTransferLegacyType(deletingTransaction?.type) ? 'Padam Pemindahan' : 'Padam'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
};

export default WalletPage;
