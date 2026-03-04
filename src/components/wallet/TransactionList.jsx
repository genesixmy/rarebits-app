import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, MoreVertical, Edit, Trash2, ArrowRightLeft, ArrowRight, ArrowLeft, Settings2, Paperclip, Eye, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  TRANSACTION_CLASSIFICATIONS,
  classificationBadgeClass,
  classificationLabel,
  getTransactionDirection,
  isTransferLegacyType,
  resolveTransactionClassification,
} from './transactionClassification';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TransactionList = ({ transactions, wallets, onEdit, onDelete, onViewReceipt, onDownloadReceipt }) => {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Transaksi Terkini</CardTitle>
      </CardHeader>
      <CardContent>
        {transactions.length > 0 ? (
          <ul className="space-y-2">
            {transactions.map((tx) => {
              const classification = resolveTransactionClassification(tx);
              const direction = getTransactionDirection(tx);
              const isSale = classification === TRANSACTION_CLASSIFICATIONS.SALE;
              const isExpense = classification === TRANSACTION_CLASSIFICATIONS.EXPENSE;
              const isTopup = classification === TRANSACTION_CLASSIFICATIONS.TOPUP;
              const isTransferOut = classification === TRANSACTION_CLASSIFICATIONS.TRANSFER_OUT;
              const isTransferIn = classification === TRANSACTION_CLASSIFICATIONS.TRANSFER_IN;
              const isAdjustment = classification === TRANSACTION_CLASSIFICATIONS.ADJUSTMENT;
              const isRefund = tx.type === 'refund' || tx.type === 'refund_adjustment' || tx.type === 'goodwill_adjustment';
              const isLegacyInvoicePayment = tx.type === 'pembayaran_invois';
              const isLegacyManualSale = tx.type === 'item_manual';
              const shipmentReference = tx.reference_type === 'shipment' && tx.reference_id
                ? `Shipment ${String(tx.reference_id).slice(0, 8)}`
                : '';

              const amountPrefix = direction < 0 ? '-' : '+';
              const amountClass = direction < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400';
              const hasReceipt = Boolean(tx.receipt_path);

              let icon;
              let colorClass;
              let title;
              let subtitle = tx.wallets?.name || 'Akaun Dipadam';
              let isEditable = true;
              let isDeletable = true;

              if (isSale) {
                icon = <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />;
                colorClass = 'bg-emerald-100 dark:bg-emerald-900/50';
                title = tx.description || 'Jualan';
                isEditable = false;
              } else if (isExpense) {
                icon = <TrendingDown className="w-5 h-5 text-red-600 dark:text-red-400" />;
                colorClass = 'bg-red-100 dark:bg-red-900/50';
                title = (tx.description && tx.description.startsWith('Pembalikan'))
                  ? tx.description
                  : (tx.category || tx.description || 'Perbelanjaan');
                if (shipmentReference) {
                  title = `${title} (${shipmentReference})`;
                }
              } else if (isTransferOut) {
                icon = <ArrowRight className="w-5 h-5 text-orange-600 dark:text-orange-400" />;
                colorClass = 'bg-orange-100 dark:bg-orange-900/50';
                title = tx.category || tx.description || 'Pemindahan Keluar';
                isEditable = false;
              } else if (isTransferIn) {
                icon = <ArrowLeft className="w-5 h-5 text-blue-600 dark:text-blue-400" />;
                colorClass = 'bg-blue-100 dark:bg-blue-900/50';
                title = tx.category || tx.description || 'Pemindahan Masuk';
                isEditable = false;
              } else if (isTopup) {
                icon = <TrendingUp className="w-5 h-5 text-teal-600 dark:text-teal-400" />;
                colorClass = 'bg-teal-100 dark:bg-teal-900/50';
                title = tx.description || tx.category || 'Tambah Modal';
              } else if (isAdjustment) {
                icon = <Settings2 className="w-5 h-5 text-slate-600 dark:text-slate-400" />;
                colorClass = 'bg-slate-100 dark:bg-slate-900/50';
                title = tx.description || tx.category || 'Pelarasan Baki';
                isEditable = false;
              } else {
                icon = <ArrowRightLeft className="w-5 h-5 text-slate-600 dark:text-slate-400" />;
                colorClass = 'bg-slate-100 dark:bg-slate-900/50';
                title = tx.description || 'Transaksi';
              }

              if (isLegacyInvoicePayment || isLegacyManualSale || isTransferLegacyType(tx.type)) {
                isEditable = false;
              }

              if (isRefund) {
                isEditable = false;
                isDeletable = false;
                title = tx.description || 'Pelarasan Harga';
              }

              const typeBadgeLabel = classificationLabel(classification);
              const typeBadgeClass = classificationBadgeClass(classification);

              return (
                <li key={tx.id} className="group relative flex items-center justify-between overflow-hidden rounded-lg p-2">
                  <div className="absolute left-0 top-0 h-full w-1 bg-primary scale-y-0 transition-transform origin-center duration-300 group-hover:scale-y-100" />
                  <div className="flex min-w-0 flex-1 items-center gap-3 transition-transform duration-300 group-hover:translate-x-2">
                    <div className={cn("rounded-full p-2", colorClass)}>
                      {icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate font-semibold">{title}</p>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", typeBadgeClass)}>
                          {typeBadgeLabel}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                            hasReceipt
                              ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                          )}
                        >
                          <span className="inline-flex items-center gap-1">
                            <Paperclip className="h-3 w-3" />
                            {hasReceipt ? 'Ada Resit' : 'Tiada Resit'}
                          </span>
                        </span>
                      </div>
                      <p className="truncate text-sm text-muted-foreground">
                        {new Date(tx.transaction_date).toLocaleDateString()} - {subtitle}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-2">
                    <p className={cn("text-right font-bold", amountClass)}>
                      {amountPrefix}RM {Math.abs(parseFloat(tx.amount) || 0).toFixed(2)}
                    </p>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {hasReceipt && (
                          <DropdownMenuItem onClick={() => onViewReceipt?.(tx)}>
                            <Eye className="mr-2 h-4 w-4" /> Lihat Resit
                          </DropdownMenuItem>
                        )}
                        {hasReceipt && (
                          <DropdownMenuItem onClick={() => onDownloadReceipt?.(tx)}>
                            <Download className="mr-2 h-4 w-4" /> Muat Turun Resit
                          </DropdownMenuItem>
                        )}
                        {isEditable && (
                          <DropdownMenuItem onClick={() => onEdit(tx)}>
                            <Edit className="mr-2 h-4 w-4" /> Sunting
                          </DropdownMenuItem>
                        )}
                        {isDeletable && (
                          <DropdownMenuItem onClick={() => onDelete(tx)} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
                            <Trash2 className="mr-2 h-4 w-4" /> Padam
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="py-8 text-center">
            <ArrowRightLeft className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">Tiada transaksi lagi</h3>
            <p className="mt-1 text-sm text-muted-foreground">Tambah transaksi baharu untuk melihatnya di sini.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TransactionList;
