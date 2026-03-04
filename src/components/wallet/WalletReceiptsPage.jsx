import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ms } from 'date-fns/locale';
import { Eye, Download, Loader2, ArrowLeft, Paperclip, Wallet } from 'lucide-react';
import JSZip from 'jszip';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  createTransactionReceiptSignedUrl,
  formatFileSize,
} from '@/lib/walletTransactionReceipts';

const fetchReceiptTransactions = async (userId) => {
  const { data, error } = await supabase
    .from('transactions')
    .select(`
      id,
      wallet_id,
      transaction_date,
      created_at,
      description,
      category,
      amount,
      type,
      receipt_path,
      receipt_name,
      receipt_mime,
      receipt_size_bytes,
      receipt_original_size_bytes,
      receipt_compressed,
      receipt_uploaded_at,
      wallets(name, account_type)
    `)
    .eq('user_id', userId)
    .not('receipt_path', 'is', null)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

const sanitizeFileName = (value, fallback = 'receipt') => {
  const next = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
  return next || fallback;
};

const getFileExtensionFromMime = (mimeValue) => {
  const mime = String(mimeValue || '').toLowerCase();
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  return '';
};

const buildUniqueFileName = (usedNames, rawName) => {
  const safe = sanitizeFileName(rawName, 'receipt');
  if (!usedNames.has(safe)) {
    usedNames.add(safe);
    return safe;
  }

  const dotIndex = safe.lastIndexOf('.');
  const base = dotIndex > 0 ? safe.slice(0, dotIndex) : safe;
  const ext = dotIndex > 0 ? safe.slice(dotIndex) : '';
  let counter = 2;
  while (counter <= 9999) {
    const candidate = `${base}-${counter}${ext}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    counter += 1;
  }
  const fallback = `${base}-${Date.now()}${ext}`;
  usedNames.add(fallback);
  return fallback;
};

const downloadBlob = (blob, fileName) => {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
};

const toCsv = (rows) => rows
  .map((row) => row
    .map((cell) => {
      const value = String(cell ?? '');
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    })
    .join(','))
  .join('\n');

const getPreviewKind = ({ receiptName, receiptMime }) => {
  const mime = String(receiptMime || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.includes('pdf')) return 'pdf';

  const lowerName = String(receiptName || '').toLowerCase();
  if (lowerName.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|webp|gif|bmp|svg)$/.test(lowerName)) return 'image';
  return 'unsupported';
};

const WalletReceiptsPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterWallet, setFilterWallet] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [isDownloadingFiltered, setIsDownloadingFiltered] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewTransaction, setPreviewTransaction] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewKind, setPreviewKind] = useState('unsupported');
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const {
    data: receiptTransactions = [],
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['wallet-receipts', user?.id],
    queryFn: () => fetchReceiptTransactions(user.id),
    enabled: Boolean(user?.id),
    staleTime: 0,
    gcTime: 1000 * 60 * 5,
  });

  const walletOptions = useMemo(() => {
    const map = new Map();
    receiptTransactions.forEach((tx) => {
      if (!tx.wallet_id) return;
      if (!map.has(tx.wallet_id)) {
        map.set(tx.wallet_id, tx.wallets?.name || 'Wallet');
      }
    });
    return Array.from(map.entries());
  }, [receiptTransactions]);

  const filteredTransactions = useMemo(() => {
    const needle = String(searchTerm || '').trim().toLowerCase();
    return receiptTransactions.filter((tx) => {
      if (filterWallet !== 'all' && tx.wallet_id !== filterWallet) return false;
      if (filterDateFrom && String(tx.transaction_date || '') < filterDateFrom) return false;
      if (filterDateTo && String(tx.transaction_date || '') > filterDateTo) return false;

      if (!needle) return true;
      const haystack = [
        tx.description,
        tx.category,
        tx.receipt_name,
        tx.wallets?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [
    receiptTransactions,
    searchTerm,
    filterWallet,
    filterDateFrom,
    filterDateTo,
  ]);

  const resetFilters = () => {
    setSearchTerm('');
    setFilterWallet('all');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  const handleViewReceipt = async (transaction) => {
    if (!transaction?.receipt_path) return;

    setIsPreviewOpen(true);
    setPreviewTransaction(transaction);
    setPreviewUrl('');
    setPreviewError('');
    setPreviewKind(getPreviewKind({
      receiptName: transaction?.receipt_name,
      receiptMime: transaction?.receipt_mime,
    }));
    setIsPreviewLoading(true);

    try {
      const signedUrl = await createTransactionReceiptSignedUrl({
        supabase,
        receiptPath: transaction.receipt_path,
        expiresInSec: 900,
      });
      setPreviewUrl(signedUrl);
    } catch (viewError) {
      console.error('[WalletReceiptsPage] Failed to prepare receipt preview:', viewError);
      setPreviewError(viewError.message || 'Gagal menyediakan pratonton resit.');
    } finally {
      setIsPreviewLoading(false);
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
      const popup = window.open(signedUrl, '_blank', 'noopener,noreferrer');
      if (!popup) {
        toast({
          title: 'Popup disekat',
          description: 'Benarkan popup untuk muat turun resit.',
          variant: 'destructive',
        });
      }
    } catch (downloadError) {
      console.error('[WalletReceiptsPage] Failed to download receipt:', downloadError);
      toast({
        title: 'Gagal muat turun resit',
        description: downloadError.message,
        variant: 'destructive',
      });
    }
  };

  const handlePreviewDialogChange = (nextOpen) => {
    setIsPreviewOpen(nextOpen);
    if (!nextOpen) {
      setPreviewTransaction(null);
      setPreviewUrl('');
      setPreviewKind('unsupported');
      setPreviewError('');
      setIsPreviewLoading(false);
    }
  };

  const handleDownloadFilteredReceipts = async () => {
    if (filteredTransactions.length === 0) {
      toast({
        title: 'Tiada resit untuk dimuat turun',
        description: 'Ubah penapis atau semak data dahulu.',
        variant: 'destructive',
      });
      return;
    }

    setIsDownloadingFiltered(true);
    try {
      const zip = new JSZip();
      const usedNames = new Set();
      const csvRows = [[
        'transaction_id',
        'transaction_date',
        'wallet',
        'description',
        'category',
        'amount',
        'receipt_name',
        'receipt_mime',
        'receipt_size_bytes',
        'receipt_compressed',
      ]];

      let successCount = 0;
      let failCount = 0;

      for (const tx of filteredTransactions) {
        try {
          const extension = getFileExtensionFromMime(tx.receipt_mime);
          const fallbackName = extension
            ? `receipt-${tx.id}.${extension}`
            : `receipt-${tx.id}`;
          const desiredName = sanitizeFileName(tx.receipt_name || fallbackName, fallbackName);

          const signedUrl = await createTransactionReceiptSignedUrl({
            supabase,
            receiptPath: tx.receipt_path,
            downloadFileName: desiredName,
            expiresInSec: 900,
          });

          const response = await fetch(signedUrl);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const blob = await response.blob();
          const uniqueName = buildUniqueFileName(usedNames, desiredName);
          zip.file(`receipts/${uniqueName}`, blob);

          csvRows.push([
            tx.id,
            tx.transaction_date || '',
            tx.wallets?.name || '',
            tx.description || '',
            tx.category || '',
            tx.amount ?? '',
            tx.receipt_name || uniqueName,
            tx.receipt_mime || '',
            tx.receipt_size_bytes ?? '',
            tx.receipt_compressed ? 'yes' : 'no',
          ]);
          successCount += 1;
        } catch (downloadError) {
          failCount += 1;
          console.warn('[WalletReceiptsPage] Skip receipt from bulk download:', tx.id, downloadError);
        }
      }

      if (successCount === 0) {
        throw new Error('Semua fail gagal dimuat turun.');
      }

      zip.file('manifest.csv', toCsv(csvRows));
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipName = `wallet-receipts-${format(new Date(), 'yyyyMMdd-HHmm')}.zip`;
      downloadBlob(zipBlob, zipName);

      if (failCount > 0) {
        toast({
          title: `Muat turun siap (${successCount} berjaya, ${failCount} gagal)`,
          description: 'Semak manifest.csv dalam ZIP untuk rujukan.',
        });
      } else {
        toast({
          title: `Muat turun siap (${successCount} resit)`,
          description: 'Fail ZIP dimuat turun ikut penapis semasa.',
        });
      }
    } catch (errorDownloadAll) {
      console.error('[WalletReceiptsPage] Failed to download filtered receipts:', errorDownloadAll);
      toast({
        title: 'Gagal muat turun ikut penapis',
        description: errorDownloadAll.message || 'Sila cuba lagi.',
        variant: 'destructive',
      });
    } finally {
      setIsDownloadingFiltered(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-3 py-8 text-center">
        <p className="text-destructive">Gagal memuatkan senarai resit.</p>
        <p className="text-sm text-muted-foreground">{error?.message}</p>
        <Button onClick={() => refetch()} variant="outline">
          Cuba Lagi
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => navigate('/wallet')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="page-title">Senarai Resit Wallet</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleDownloadFilteredReceipts} disabled={isDownloadingFiltered}>
            {isDownloadingFiltered ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Muat Turun Ikut Filter
          </Button>
          <Button onClick={() => refetch()} variant="outline">
            {isRefetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Muat Semula
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tapis Resit</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <Input
              className="lg:flex-1"
              placeholder="Cari deskripsi, kategori atau nama fail..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <Select className="lg:flex-1" value={filterWallet} onChange={(event) => setFilterWallet(event.target.value)}>
              <option value="all">Semua Wallet</option>
              {walletOptions.map(([walletId, walletName]) => (
                <option key={walletId} value={walletId}>{walletName}</option>
              ))}
            </Select>
            <div className="flex flex-col gap-2 sm:flex-row lg:flex-1">
              <Input
                className="sm:flex-1"
                type="date"
                value={filterDateFrom}
                onChange={(event) => setFilterDateFrom(event.target.value)}
              />
              <Input
                className="sm:flex-1"
                type="date"
                value={filterDateTo}
                onChange={(event) => setFilterDateTo(event.target.value)}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-10 w-fit self-start border-cyan-200 bg-transparent px-3 text-cyan-700 hover:bg-cyan-50 hover:text-cyan-800 lg:shrink-0"
              onClick={resetFilters}
            >
              Reset
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="text-sm text-muted-foreground">
              {filteredTransactions.length} daripada {receiptTransactions.length} resit dipaparkan
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Paperclip className="h-4 w-4" />
            Semua Resit
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredTransactions.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              Tiada resit ditemui untuk penapis ini.
            </div>
          ) : (
            <ul className="space-y-3">
              {filteredTransactions.map((tx) => (
                <li key={tx.id} className="rounded-lg border p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {tx.description || tx.category || 'Transaksi'}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {tx.wallets?.name || 'Wallet'} - {tx.transaction_date ? format(new Date(tx.transaction_date), 'dd MMM yyyy', { locale: ms }) : '-'}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {tx.receipt_name || 'receipt'} - {formatFileSize(tx.receipt_size_bytes)}
                        {tx.receipt_compressed ? ' - compressed' : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => navigate(`/wallet/account/${tx.wallet_id}`)}>
                        <Wallet className="mr-2 h-4 w-4" />
                        Buka Wallet
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleViewReceipt(tx)}>
                        <Eye className="mr-2 h-4 w-4" />
                        Lihat
                      </Button>
                      <Button size="sm" onClick={() => handleDownloadReceipt(tx)}>
                        <Download className="mr-2 h-4 w-4" />
                        Muat Turun
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={isPreviewOpen} onOpenChange={handlePreviewDialogChange}>
        <AlertDialogContent className="max-h-[92vh] w-[96vw] max-w-5xl gap-0 overflow-hidden p-0">
          <AlertDialogHeader className="border-b px-4 py-3 text-left">
            <AlertDialogTitle className="text-base">Pratonton Resit</AlertDialogTitle>
            <AlertDialogDescription className="truncate text-xs">
              {previewTransaction?.receipt_name || previewTransaction?.description || 'Lampiran transaksi'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="h-[72vh] overflow-auto bg-slate-100 p-3">
            {isPreviewLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Menyediakan pratonton...
              </div>
            ) : previewError ? (
              <div className="flex h-full items-center justify-center text-center text-sm text-destructive">
                {previewError}
              </div>
            ) : !previewUrl ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Tiada pautan pratonton tersedia.
              </div>
            ) : previewKind === 'pdf' ? (
              <iframe
                title={`Pratonton ${previewTransaction?.receipt_name || 'resit'}`}
                src={previewUrl}
                className="h-full w-full rounded-md border bg-white"
              />
            ) : previewKind === 'image' ? (
              <img
                src={previewUrl}
                alt={previewTransaction?.receipt_name || 'Resit'}
                className="mx-auto max-h-full w-auto rounded-md border bg-white shadow-sm"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <p>Format ini belum ada pratonton dalam modal.</p>
                <Button size="sm" onClick={() => previewTransaction && handleDownloadReceipt(previewTransaction)}>
                  <Download className="mr-2 h-4 w-4" />
                  Muat Turun Fail
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
            <Button
              size="sm"
              onClick={() => previewTransaction && handleDownloadReceipt(previewTransaction)}
              disabled={!previewTransaction}
            >
              <Download className="mr-2 h-4 w-4" />
              Muat Turun
            </Button>
            <AlertDialogCancel className="mt-0">Tutup</AlertDialogCancel>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default WalletReceiptsPage;
