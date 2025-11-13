import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, MoreVertical, Edit, Trash2, ArrowRightLeft, ArrowRight, ArrowLeft, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TransactionList = ({ transactions, wallets, onEdit, onDelete }) => {
  const getWalletName = (walletId) => {
    const wallet = wallets.find(w => w.id === walletId);
    return wallet ? wallet.name : 'Akaun Dipadam';
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Transaksi Terkini</CardTitle>
      </CardHeader>
      <CardContent>
        {transactions.length > 0 ? (
          <ul className="space-y-2">
            {transactions.map(tx => {
              const isSale = tx.type === 'jualan';
              const isExpense = tx.type === 'perbelanjaan';
              const isTransferOut = tx.type === 'pemindahan_keluar';
              const isTransferIn = tx.type === 'pemindahan_masuk';
              const isAdjustment = tx.type === 'pelarasan_manual_tambah' || tx.type === 'pelarasan_manual_kurang';

              let icon, colorClass, title, subtitle, amountPrefix, amountClass, isEditable = true, isDeletable = true;

              if (isSale) {
                icon = <TrendingUp className="w-5 h-5 text-green-600 dark:text-green-400" />;
                colorClass = 'bg-green-100 dark:bg-green-900/50';
                title = tx.description || 'Jualan';
                subtitle = tx.wallets?.name || 'Akaun Dipadam';
                amountPrefix = '+';
                amountClass = 'text-green-600 dark:text-green-400';
              } else if (isExpense) {
                icon = <TrendingDown className="w-5 h-5 text-red-600 dark:text-red-400" />;
                colorClass = 'bg-red-100 dark:bg-red-900/50';
                title = tx.category || 'Perbelanjaan';
                subtitle = tx.wallets?.name || 'Akaun Dipadam';
                amountPrefix = '-';
                amountClass = 'text-red-600 dark:text-red-400';
              } else if (isTransferOut) {
                icon = <ArrowRight className="w-5 h-5 text-orange-600 dark:text-orange-400" />;
                colorClass = 'bg-orange-100 dark:bg-orange-900/50';
                title = tx.category || 'Pemindahan Keluar';
                subtitle = tx.wallets?.name || 'Akaun Dipadam';
                amountPrefix = '-';
                amountClass = 'text-orange-600 dark:text-orange-400';
                isEditable = false;
              } else if (isTransferIn) {
                 icon = <ArrowLeft className="w-5 h-5 text-blue-600 dark:text-blue-400" />;
                colorClass = 'bg-blue-100 dark:bg-blue-900/50';
                title = tx.category || 'Pemindahan Masuk';
                subtitle = tx.wallets?.name || 'Akaun Dipadam';
                amountPrefix = '+';
                amountClass = 'text-blue-600 dark:text-blue-400';
                isEditable = false;
              } else if (isAdjustment) {
                 icon = <Settings2 className="w-5 h-5 text-slate-600 dark:text-slate-400" />;
                colorClass = 'bg-slate-100 dark:bg-slate-900/50';
                title = tx.description || 'Pelarasan Baki';
                subtitle = tx.wallets?.name || 'Akaun Dipadam';
                amountPrefix = tx.type === 'pelarasan_manual_tambah' ? '+' : '-';
                amountClass = tx.type === 'pelarasan_manual_tambah' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
                isEditable = false;
                isDeletable = true; // Manual adjustments are deletable
              }


              return (
                <li key={tx.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={cn("p-2 rounded-full", colorClass)}>
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{title}</p>
                      <p className="text-sm text-muted-foreground truncate">{new Date(tx.transaction_date).toLocaleDateString()} • {subtitle}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-2">
                    <p className={cn("font-bold text-right", amountClass)}>
                      {amountPrefix}RM {parseFloat(tx.amount).toFixed(2)}
                    </p>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {isEditable && (
                          <DropdownMenuItem onClick={() => onEdit(tx)}>
                            <Edit className="mr-2 h-4 w-4" /> Sunting
                          </DropdownMenuItem>
                        )}
                        {isDeletable && (
                          <DropdownMenuItem onClick={() => onDelete(tx)} className="text-destructive focus:text-destructive focus:bg-destructive/10">
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
          <div className="text-center py-8">
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