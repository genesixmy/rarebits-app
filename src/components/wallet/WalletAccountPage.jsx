import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Loader2, ArrowLeft, Wallet as WalletIcon, ChevronsUpDown, Briefcase, User, Plus, Repeat, Edit, Check, X, RefreshCw, Paperclip, Download } from 'lucide-react';
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
  isTransferLegacyType,
  manualTypeToLegacyType,
} from '@/components/wallet/transactionClassification';
import {
  applyTransactionReceiptChange,
  createTransactionReceiptSignedUrl,
  findLatestCreatedTransactionId,
  hasPendingReceiptChange,
} from '@/lib/walletTransactionReceipts';
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

const getReceiptPreviewKind = ({ receiptName, receiptMime }) => {
  const mime = String(receiptMime || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.includes('pdf')) return 'pdf';

  const lowerName = String(receiptName || '').toLowerCase();
  if (lowerName.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|webp|gif|bmp|svg)$/.test(lowerName)) return 'image';
  return 'unsupported';
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
  const [isReceiptPreviewOpen, setIsReceiptPreviewOpen] = useState(false);
  const [receiptPreviewTransaction, setReceiptPreviewTransaction] = useState(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState('');
  const [receiptPreviewKind, setReceiptPreviewKind] = useState('unsupported');
  const [receiptPreviewLoading, setReceiptPreviewLoading] = useState(false);
  const [receiptPreviewError, setReceiptPreviewError] = useState('');

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

  // Refetch data on component mount (for route navigation within same app)
  useEffect(() => {
    console.log('[WalletAccountPage] Component mounted, refetching data...');
    refetchWallet();
    refetchTransactions();
  }, [accountId]);

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

    const handleTransactionsUpdate = (payload) => {
        console.log('Transactions table updated in WalletAccountPage:', payload);
        // Refetch transactions immediately when transactions change
        refetchTransactions();
    };

    const itemsChannel = supabase
        .channel('public:items-account')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'items', filter: `user_id=eq.${user.id}` }, handleItemsUpdate)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'items', filter: `user_id=eq.${user.id}` }, handleItemsUpdate)
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'items', filter: `user_id=eq.${user.id}` }, handleItemsUpdate)
        .subscribe();

    const transactionsChannel = supabase
        .channel('public:transactions-account')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions', filter: `user_id=eq.${user.id}` }, handleTransactionsUpdate)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transactions', filter: `user_id=eq.${user.id}` }, handleTransactionsUpdate)
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'transactions', filter: `user_id=eq.${user.id}` }, handleTransactionsUpdate)
        .subscribe();

    return () => {
        supabase.removeChannel(itemsChannel);
        supabase.removeChannel(transactionsChannel);
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

  const handleViewReceipt = async (transaction) => {
    if (!transaction?.receipt_path) return;

    setIsReceiptPreviewOpen(true);
    setReceiptPreviewTransaction(transaction);
    setReceiptPreviewUrl('');
    setReceiptPreviewError('');
    setReceiptPreviewKind(getReceiptPreviewKind({
      receiptName: transaction?.receipt_name,
      receiptMime: transaction?.receipt_mime,
    }));
    setReceiptPreviewLoading(true);

    try {
      const signedUrl = await createTransactionReceiptSignedUrl({
        supabase,
        receiptPath: transaction.receipt_path,
        expiresInSec: 900,
      });
      setReceiptPreviewUrl(signedUrl);
    } catch (error) {
      console.error('[WalletAccountPage] Failed to prepare receipt preview:', error);
      setReceiptPreviewError(error.message || 'Gagal menyediakan pratonton resit.');
    } finally {
      setReceiptPreviewLoading(false);
    }
  };

  const handleDownloadReceipt = async (transaction) => {
    if (!transaction?.receipt_path) return;
    try {
      const signedUrl = await createTransactionReceiptSignedUrl({
        supabase,
        receiptPath: transaction.receipt_path,
        downloadFileName: transaction.receipt_name || `receipt-${transaction.id}`,
      });
      const link = document.createElement('a');
      link.href = signedUrl;
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('[WalletAccountPage] Failed to download receipt:', error);
      toast({ title: 'Gagal memuat turun resit', description: error.message, variant: 'destructive' });
    }
  };

  const handleReceiptPreviewDialogChange = (nextOpen) => {
    setIsReceiptPreviewOpen(nextOpen);
    if (!nextOpen) {
      setReceiptPreviewTransaction(null);
      setReceiptPreviewUrl('');
      setReceiptPreviewKind('unsupported');
      setReceiptPreviewError('');
      setReceiptPreviewLoading(false);
    }
  };

  const transactionMutation = useMutation({
    mutationFn: async ({ transactionData, isEditing }) => {
        const shouldHandleReceipt = hasPendingReceiptChange(transactionData);
        const mutationStartedAtIso = new Date().toISOString();
        let rpcName, params;
        let createdLegacyType = null;
        let createdAmount = null;
        if (isEditing) {
            rpcName = 'update_transaction_and_adjust_wallets';
            params = { p_transaction_id: transactionData.id, p_user_id: user.id, p_new_wallet_id: transactionData.wallet_id, p_new_amount: transactionData.amount, p_new_date: transactionData.transaction_date, p_new_description: transactionData.description, p_new_category: transactionData.category };
        } else {
            const parsedAmount = parseFloat(transactionData.amount);
            if (!Number.isFinite(parsedAmount)) {
              throw new Error('Jumlah transaksi tidak sah');
            }

            if (transactionData.type === 'adjustment') {
              if (shouldHandleReceipt) {
                throw new Error('Lampiran resit tidak disokong untuk pelarasan baki.');
              }
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
            createdLegacyType = manualTypeToLegacyType(transactionData.type, transactionData.adjustment_direction);
            createdAmount = Math.abs(parsedAmount);
            params = {
              p_user_id: user.id,
              p_wallet_id: transactionData.wallet_id,
              p_type: createdLegacyType,
              p_amount: createdAmount,
              p_description: transactionData.description,
              p_category: transactionData.category,
              p_transaction_date: transactionData.transaction_date,
              p_item_id: transactionData.item_id || null,
            };
        }
        const { error } = await supabase.rpc(rpcName, params);
        if (error) throw error;

        if (shouldHandleReceipt) {
          let transactionId = transactionData.id || null;
          if (!transactionId) {
            transactionId = await findLatestCreatedTransactionId({
              supabase,
              userId: user.id,
              walletId: transactionData.wallet_id,
              type: createdLegacyType,
              amount: createdAmount,
              transactionDate: transactionData.transaction_date,
              description: transactionData.description,
              category: transactionData.category,
              createdAfterIso: mutationStartedAtIso,
            });
          }
          if (!transactionId) {
            throw new Error('Transaksi telah disimpan tetapi lampiran resit tidak dapat dipautkan.');
          }
          await applyTransactionReceiptChange({
            supabase,
            userId: user.id,
            transactionId,
            transactionData,
          });
        }

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
        const isTransfer = isTransferLegacyType(transaction.type);
        const rpcName = isTransfer ? 'delete_transfer_transactions' : 'delete_transaction_and_adjust_wallet';
        const params = isTransfer ? { p_transfer_id: transaction.transfer_id, p_user_id: user.id } : { p_transaction_id: transaction.id, p_user_id: user.id };
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
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => navigate('/wallet/receipts')}>
              <Paperclip className="mr-2 h-4 w-4" /> Senarai Resit
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

        <TransactionList
          transactions={transactions}
          wallets={allWallets}
          onEdit={(tx) => { setEditingTransaction(tx); setIsTransactionModalOpen(true); }}
          onDelete={(tx) => setDeletingTransaction(tx)}
          onViewReceipt={handleViewReceipt}
          onDownloadReceipt={handleDownloadReceipt}
        />
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

      <AlertDialog open={isReceiptPreviewOpen} onOpenChange={handleReceiptPreviewDialogChange}>
        <AlertDialogContent className="max-h-[92vh] w-[96vw] max-w-5xl gap-0 overflow-hidden p-0">
          <AlertDialogHeader className="border-b px-4 py-3 text-left">
            <AlertDialogTitle className="text-base">Pratonton Resit</AlertDialogTitle>
            <AlertDialogDescription className="truncate text-xs">
              {receiptPreviewTransaction?.receipt_name || receiptPreviewTransaction?.description || 'Lampiran transaksi'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="h-[72vh] overflow-auto bg-slate-100 p-3">
            {receiptPreviewLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Menyediakan pratonton...
              </div>
            ) : receiptPreviewError ? (
              <div className="flex h-full items-center justify-center text-center text-sm text-destructive">
                {receiptPreviewError}
              </div>
            ) : !receiptPreviewUrl ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Tiada pautan pratonton tersedia.
              </div>
            ) : receiptPreviewKind === 'pdf' ? (
              <iframe
                title={`Pratonton ${receiptPreviewTransaction?.receipt_name || 'resit'}`}
                src={receiptPreviewUrl}
                className="h-full w-full rounded-md border bg-white"
              />
            ) : receiptPreviewKind === 'image' ? (
              <img
                src={receiptPreviewUrl}
                alt={receiptPreviewTransaction?.receipt_name || 'Resit'}
                className="mx-auto max-h-full w-auto rounded-md border bg-white shadow-sm"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <p>Format ini belum ada pratonton dalam modal.</p>
                <Button
                  size="sm"
                  onClick={() => receiptPreviewTransaction && handleDownloadReceipt(receiptPreviewTransaction)}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Muat Turun Fail
                </Button>
              </div>
            )}
          </div>

          <AlertDialogFooter className="border-t px-4 py-3">
            <Button
              size="sm"
              onClick={() => receiptPreviewTransaction && handleDownloadReceipt(receiptPreviewTransaction)}
              disabled={!receiptPreviewTransaction}
            >
              <Download className="mr-2 h-4 w-4" />
              Muat Turun
            </Button>
            <AlertDialogCancel className="mt-0">Tutup</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default WalletAccountPage;
