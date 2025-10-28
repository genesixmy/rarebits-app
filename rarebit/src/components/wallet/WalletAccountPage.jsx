import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Loader2, ArrowLeft, Wallet as WalletIcon, ChevronsUpDown, Briefcase, User, Plus, Repeat, Edit, Check, X, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import TransactionList from '@/components/wallet/TransactionList';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from '@/components/ui/use-toast';
import { AnimatePresence } from 'framer-motion';
import TransactionFormModal from '@/components/wallet/TransactionFormModal';
import TransferFormModal from '@/components/wallet/TransferFormModal';
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

const fetchWalletDetails = async (walletId, userId) => {
  const { data, error } = await supabase.from('wallets').select('*').eq('id', walletId).eq('user_id', userId).single();
  if (error) throw error;
  return data;
};

const fetchWalletTransactions = async (walletId, userId) => {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, wallets(name, account_type)')
    .eq('user_id', userId)
    .eq('wallet_id', walletId)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error("Supabase fetch error:", error);
    throw error;
  }
  
  return data;
};


const fetchAllWallets = async (userId) => {
  const { data, error } = await supabase.from('wallets').select('*').eq('user_id', userId).order('created_at');
  if (error) throw error;
  return data;
};

const BalanceEditor = ({ wallet, onSave }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [balance, setBalance] = useState(wallet.balance);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setBalance(wallet.balance);
    }, [wallet.balance]);

    const handleSave = async () => {
        setIsSaving(true);
        await onSave(balance);
        setIsSaving(false);
        setIsEditing(false);
    }

    if (isEditing) {
        return (
            <div className="flex items-center gap-2 mt-1">
                 <div className="relative flex-grow">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-primary-foreground/80 font-medium">RM</span>
                  <Input 
                    type="number"
                    value={balance}
                    onChange={(e) => setBalance(e.target.value)}
                    className="pl-12 pr-3 bg-transparent text-4xl font-bold border-2 border-primary-foreground/50 h-auto py-2 text-white"
                    autoFocus
                  />
                </div>
                <Button size="icon" onClick={handleSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                </Button>
                <Button size="icon" variant="destructive" onClick={() => setIsEditing(false)} disabled={isSaving}>
                    <X className="w-5 h-5" />
                </Button>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2">
            <p className="text-4xl font-bold">RM {parseFloat(wallet.balance).toFixed(2)}</p>
            <Button variant="ghost" size="icon" onClick={() => setIsEditing(true)} className="flex-shrink-0 text-white/70 hover:bg-white/10">
                <Edit className="w-6 h-6" />
            </Button>
        </div>
    );
};

const WalletAccountPage = () => {
  const { accountId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [deletingTransaction, setDeletingTransaction] = useState(null);

  const { data: wallet, isLoading: isLoadingWallet, isError: isWalletError, error: walletError, refetch: refetchWallet, isRefetching: isRefetchingWallet } = useQuery({
    queryKey: ['wallet', accountId, user?.id],
    queryFn: () => fetchWalletDetails(accountId, user.id),
    enabled: !!accountId && !!user,
  });

  const { data: transactions = [], isLoading: isLoadingTransactions, isError: isTransactionsError, error: transactionsError, refetch: refetchTransactions, isRefetching: isRefetchingTransactions } = useQuery({
    queryKey: ['transactions', accountId, user?.id],
    queryFn: () => fetchWalletTransactions(accountId, user.id),
    enabled: !!accountId && !!user,
  });

  const { data: allWallets = [] } = useQuery({
    queryKey: ['allWallets', user?.id],
    queryFn: () => fetchAllWallets(user.id),
    enabled: !!user,
  });

  useEffect(() => {
    if (user && accountId) {
      const walletQueryState = queryClient.getQueryState(['wallet', accountId, user.id]);
      const transactionsQueryState = queryClient.getQueryState(['transactions', accountId, user.id]);

      if (!walletQueryState || walletQueryState.status === 'pending') {
        refetchWallet();
      }
      if (!transactionsQueryState || transactionsQueryState.status === 'pending') {
        refetchTransactions();
      }
    }
  }, [user, accountId, queryClient, refetchWallet, refetchTransactions]);

  // Supabase Realtime Subscription for items table changes
  useEffect(() => {
    if (!user) return;

    const handleItemsUpdate = (payload) => {
        console.log('Items table updated in WalletAccountPage:', payload);
        // When items change (especially status changes), refetch wallet and transaction data
        refetchWallet();
        refetchTransactions();
        queryClient.invalidateQueries({ queryKey: ['wallets', user.id] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
    };

    const itemsChannel = supabase
        .channel('public:items-account')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, handleItemsUpdate)
        .subscribe();

    return () => {
        supabase.removeChannel(itemsChannel);
    };
  }, [user, queryClient, refetchWallet, refetchTransactions]);

  const refetchData = () => {
    refetchWallet();
    refetchTransactions();
    queryClient.invalidateQueries({ queryKey: ['wallets', user.id] });
    queryClient.invalidateQueries({ queryKey: ['transactions', user.id, 'all'] });
  }

  const handleRefresh = () => {
    toast({ title: 'Memuat semula data...' });
    refetchData();
  }

  const transactionMutation = useMutation({
    mutationFn: async ({ transactionData, isEditing }) => {
        let rpcName, params;
        if (isEditing) {
            rpcName = 'update_transaction_and_adjust_wallets';
            params = { p_transaction_id: transactionData.id, p_user_id: user.id, p_new_wallet_id: transactionData.wallet_id, p_new_amount: transactionData.amount, p_new_date: transactionData.transaction_date, p_new_description: transactionData.description, p_new_category: transactionData.category };
        } else {
            rpcName = 'add_transaction_and_update_wallet';
            params = { p_user_id: user.id, p_wallet_id: transactionData.wallet_id, p_type: transactionData.type, p_amount: transactionData.amount, p_description: transactionData.description, p_category: transactionData.category, p_transaction_date: transactionData.transaction_date };
        }
        const { error } = await supabase.rpc(rpcName, params);
        if (error) throw error;
        return isEditing;
    },
    onSuccess: (isEditing) => {
        refetchData();
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
        refetchData();
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
      const { error } = await supabase.rpc('transfer_funds_between_wallets', { p_user_id: user.id, p_source_wallet_id: transferData.source_wallet_id, p_destination_wallet_id: transferData.destination_wallet_id, p_amount: transferData.amount, p_transaction_date: transferData.transaction_date, p_description: transferData.description });
      if (error) throw error;
    },
    onSuccess: () => {
      refetchData();
      toast({ title: "Pemindahan dana berjaya!" });
      setIsTransferModalOpen(false);
    },
    onError: (error) => {
      toast({ title: "Gagal memindahkan dana", description: error.message, variant: "destructive" });
    },
  });

  const adjustBalanceMutation = useMutation({
      mutationFn: async (newBalance) => {
          const { error } = await supabase.rpc('adjust_wallet_balance_manually', { p_user_id: user.id, p_wallet_id: accountId, p_new_balance: newBalance });
          if (error) throw error;
      },
      onSuccess: () => {
          refetchData();
          toast({ title: "Baki berjaya dilaraskan!" });
      },
      onError: (error) => {
          toast({ title: "Gagal melaraskan baki", description: error.message, variant: "destructive" });
      },
  });


  const isLoading = isLoadingWallet || isLoadingTransactions;
  const isError = isWalletError || isTransactionsError;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !wallet) {
    return (
      <div className="text-center py-12">
        <p className="text-destructive">Gagal memuatkan data akaun atau akaun tidak ditemui.</p>
        <p className="text-sm text-muted-foreground">{walletError?.message || transactionsError?.message}</p>
        <Button onClick={() => navigate('/wallet')} className="mt-4">
          <ArrowLeft className="mr-2 h-4 w-4"/> Kembali ke Wallet
        </Button>
      </div>
    );
  }

  const defaultTransaction = { wallet_id: accountId };
  
  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-9 w-9 flex-shrink-0" onClick={() => navigate('/wallet')}>
                  <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="flex flex-col">
                <h1 className="page-title truncate">{wallet.name}</h1>
                <span className={cn( "text-xs font-semibold px-2 py-0.5 rounded-full self-start", wallet.account_type === 'Business' ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800" )}>
                    {wallet.account_type === 'Business' ? <Briefcase className='inline w-3 h-3 mr-1' /> : <User className='inline w-3 h-3 mr-1' />} {wallet.account_type}
                </span>
              </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <Button onClick={handleRefresh} variant="outline" className="w-full sm:w-auto">
              <RefreshCw className={cn("mr-2 h-4 w-4", (isRefetchingWallet || isRefetchingTransactions) && "animate-spin")} /> Muat Semula
            </Button>
            <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="outline" className="w-full sm:w-auto"><ChevronsUpDown className="h-4 w-4 mr-2" /> Tukar Akaun</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">{allWallets.map(w => (<DropdownMenuItem key={w.id} onClick={() => navigate(`/wallet/account/${w.id}`)} disabled={w.id === accountId}>{w.name}</DropdownMenuItem>))}</DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => setIsTransferModalOpen(true)} variant="outline" className="w-full sm:w-auto">
              <Repeat className="mr-2 h-4 w-4" /> Pindah Dana
            </Button>
            <Button onClick={() => { setEditingTransaction(null); setIsTransactionModalOpen(true); }} className="w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" /> Tambah Transaksi
            </Button>
          </div>
        </div>

        <Card className="brand-gradient text-white">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white/90 flex items-center gap-2"><WalletIcon/>Baki Semasa</CardTitle>
          </CardHeader>
          <CardContent>
            <BalanceEditor wallet={wallet} onSave={(newBalance) => adjustBalanceMutation.mutate(newBalance)} />
          </CardContent>
        </Card>

        <TransactionList transactions={transactions} wallets={allWallets} onEdit={(tx) => { setEditingTransaction(tx); setIsTransactionModalOpen(true); }} onDelete={(tx) => setDeletingTransaction(tx)}/>
      </div>

      <AnimatePresence>
        {isTransactionModalOpen && (<TransactionFormModal transaction={editingTransaction || defaultTransaction} wallets={allWallets} onSave={(data) => { transactionMutation.mutate({ transactionData: data, isEditing: !!editingTransaction }); }} onCancel={() => { setIsTransactionModalOpen(false); setEditingTransaction(null); }} isSaving={transactionMutation.isPending}/>)}
        {isTransferModalOpen && (<TransferFormModal wallets={allWallets} initialSourceWalletId={accountId} onSave={(data) => transferFundsMutation.mutate(data)} onCancel={() => setIsTransferModalOpen(false)} isSaving={transferFundsMutation.isPending}/>)}
      </AnimatePresence>

      <AlertDialog open={!!deletingTransaction} onOpenChange={() => setDeletingTransaction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Adakah anda pasti?</AlertDialogTitle>
            <AlertDialogDescription>Tindakan ini akan memadamkan transaksi ini secara kekal dan mengemas kini baki wallet anda.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTransactionMutation.mutate(deletingTransaction)} disabled={deleteTransactionMutation.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
               {deleteTransactionMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Padam'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default WalletAccountPage;