import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Loader2, Save } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import {
  TRANSACTION_CLASSIFICATIONS,
  resolveTransactionClassification,
} from './transactionClassification';

const DRAFT_KEY_PREFIX = 'rarebits-transaction-form-draft';

const EXPENSE_CATEGORIES_PERSONAL = [
  'Makanan & Minuman',
  'Pengangkutan/Kenderaan',
  'Sewa/Rumah',
  'Utiliti (Elektrik, Air, Internet)',
  'Pendidikan',
  'Perubatan/Kesihatan',
  'Hiburan/Rekreasi',
  'Pembayaran Pinjaman',
  'Pakaian/Barangan Peribadi',
  'Tabungan/Derma',
  'Lain-lain',
];

const EXPENSE_CATEGORIES_BUSINESS = ['Stok Baru', 'Pemasaran', 'Peralatan', 'Pos & Penghantaran', 'Lain-lain'];

const MANUAL_TYPE_OPTIONS = [
  { value: TRANSACTION_CLASSIFICATIONS.EXPENSE, label: 'Perbelanjaan' },
  { value: TRANSACTION_CLASSIFICATIONS.TOPUP, label: 'Tambah Modal' },
  { value: TRANSACTION_CLASSIFICATIONS.ADJUSTMENT, label: 'Pelarasan' },
];

const TransactionFormModal = ({ transaction, wallets, onSave, onCancel, isSaving }) => {
  const { toast } = useToast();

  const isEditing = !!transaction?.id;
  const [type, setType] = useState(TRANSACTION_CLASSIFICATIONS.EXPENSE);
  const [adjustmentDirection, setAdjustmentDirection] = useState('increase');
  const [formData, setFormData] = useState({
    wallet_id: '',
    amount: '',
    transaction_date: new Date().toISOString().split('T')[0],
    description: '',
    category: '',
  });

  const selectedWallet = useMemo(
    () => wallets.find((w) => w.id === formData.wallet_id),
    [wallets, formData.wallet_id]
  );
  const isPersonalAccount = selectedWallet?.account_type === 'Personal';
  const currentExpenseCategories = isPersonalAccount ? EXPENSE_CATEGORIES_PERSONAL : EXPENSE_CATEGORIES_BUSINESS;

  const DRAFT_KEY = `${DRAFT_KEY_PREFIX}-${transaction?.id || 'new'}`;

  useEffect(() => {
    const initialWallet = wallets.find((w) => w.id === transaction?.wallet_id) || wallets[0];
    const savedDraft = !isEditing ? localStorage.getItem(DRAFT_KEY) : null;

    if (savedDraft) {
      const draft = JSON.parse(savedDraft);
      setFormData(draft.formData);
      setType(draft.type || TRANSACTION_CLASSIFICATIONS.EXPENSE);
      setAdjustmentDirection(draft.adjustmentDirection || 'increase');
      return;
    }

    if (transaction) {
      const classification = resolveTransactionClassification(transaction);
      const parsedAmount = Math.abs(parseFloat(transaction.amount) || 0);
      const nextType = MANUAL_TYPE_OPTIONS.some((option) => option.value === classification)
        ? classification
        : TRANSACTION_CLASSIFICATIONS.EXPENSE;
      setType(nextType);
      setAdjustmentDirection(
        transaction.type === 'perbelanjaan' || transaction.type === 'pelarasan_manual_kurang'
          ? 'decrease'
          : 'increase'
      );
      setFormData({
        wallet_id: transaction.wallet_id || wallets[0]?.id || '',
        amount: parsedAmount ? parsedAmount.toString() : '',
        transaction_date: transaction.transaction_date || new Date().toISOString().split('T')[0],
        description: transaction.description || '',
        category: transaction.category || (nextType === TRANSACTION_CLASSIFICATIONS.ADJUSTMENT ? 'Pelarasan' : ''),
      });
      if (isEditing) localStorage.removeItem(DRAFT_KEY);
      return;
    }

    if (wallets.length > 0) {
      setFormData({
        wallet_id: wallets[0]?.id || '',
        amount: '',
        transaction_date: new Date().toISOString().split('T')[0],
        description: '',
        category: '',
      });
      setType(TRANSACTION_CLASSIFICATIONS.EXPENSE);
      setAdjustmentDirection('increase');
    }
  }, [transaction, wallets, DRAFT_KEY, isEditing]);

  useEffect(() => {
    if (!isEditing) {
      const draft = { type, adjustmentDirection, formData };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }
  }, [type, adjustmentDirection, formData, isEditing, DRAFT_KEY]);

  useEffect(() => {
    if (!isEditing && type !== TRANSACTION_CLASSIFICATIONS.EXPENSE) {
      setFormData((prev) => ({
        ...prev,
        category: type === TRANSACTION_CLASSIFICATIONS.ADJUSTMENT ? 'Pelarasan' : '',
      }));
    }
  }, [type, isEditing]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.wallet_id || !formData.amount || !formData.transaction_date) {
      toast({ title: "Ralat Pengesahan", description: "Sila isi semua medan yang diperlukan.", variant: "destructive" });
      return;
    }

    const parsedAmount = parseFloat(formData.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast({ title: "Ralat Pengesahan", description: "Jumlah mesti lebih besar daripada 0.", variant: "destructive" });
      return;
    }

    if (type === TRANSACTION_CLASSIFICATIONS.EXPENSE && !formData.category) {
      toast({ title: "Ralat Pengesahan", description: "Sila pilih kategori perbelanjaan.", variant: "destructive" });
      return;
    }

    const dataToSave = {
      ...formData,
      id: transaction?.id,
      type,
      amount: Math.abs(parsedAmount),
      category: type === TRANSACTION_CLASSIFICATIONS.ADJUSTMENT ? 'Pelarasan' : formData.category,
      adjustment_direction: type === TRANSACTION_CLASSIFICATIONS.ADJUSTMENT ? adjustmentDirection : undefined,
    };

    await onSave(dataToSave);
    if (!isEditing) localStorage.removeItem(DRAFT_KEY);
  };

  const handleCancel = () => {
    if (!isEditing) localStorage.removeItem(DRAFT_KEY);
    onCancel();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="relative w-full max-w-lg rounded-2xl border bg-card shadow-lg"
      >
        <div className="p-6">
          <h2 className="mb-2 text-xl font-bold gradient-text">{isEditing ? 'Sunting' : 'Tambah'} Transaksi</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-muted-foreground">Jenis Transaksi *</label>
              <Select
                value={type}
                onChange={(e) => setType(e.target.value)}
                disabled={isEditing}
                required
              >
                {MANUAL_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              {isEditing && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Jenis transaksi tidak boleh diubah selepas disimpan.
                </p>
              )}
            </div>

            {type === TRANSACTION_CLASSIFICATIONS.ADJUSTMENT && (
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">Arah Pelarasan *</label>
                <Select
                  value={adjustmentDirection}
                  onChange={(e) => setAdjustmentDirection(e.target.value)}
                  disabled={isEditing}
                >
                  <option value="increase">Tambah Baki</option>
                  <option value="decrease">Kurang Baki</option>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">Akaun Wallet *</label>
                <Select
                  value={formData.wallet_id}
                  onChange={(e) => setFormData((prev) => ({ ...prev, wallet_id: e.target.value }))}
                  required
                >
                  {wallets.length > 0 ? (
                    wallets.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.account_type})
                      </option>
                    ))
                  ) : (
                    <option value="" disabled>Tiada wallet tersedia</option>
                  )}
                </Select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">Jumlah *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 transform font-medium text-primary">RM</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={formData.amount}
                    onChange={(e) => setFormData((prev) => ({ ...prev, amount: e.target.value }))}
                    placeholder="0.00"
                    className="pl-12"
                    required
                  />
                </div>
              </div>
            </div>

            {type === TRANSACTION_CLASSIFICATIONS.EXPENSE && (
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">Kategori Perbelanjaan *</label>
                <Select
                  value={formData.category}
                  onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value }))}
                  required
                >
                  <option value="" disabled>Pilih kategori...</option>
                  {currentExpenseCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm font-medium text-muted-foreground">Keterangan</label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                placeholder={type === TRANSACTION_CLASSIFICATIONS.TOPUP ? 'cth: Tambah modal bulan ini' : 'cth: Catatan transaksi'}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-muted-foreground">Tarikh Transaksi *</label>
              <Input
                type="date"
                value={formData.transaction_date}
                onChange={(e) => setFormData((prev) => ({ ...prev, transaction_date: e.target.value }))}
                required
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                type="submit"
                className="flex-1"
                variant={type === TRANSACTION_CLASSIFICATIONS.EXPENSE ? 'destructive' : 'default'}
                disabled={isSaving}
              >
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {isEditing ? 'Kemas Kini' : 'Simpan'}
              </Button>
              <Button type="button" variant="outline" onClick={handleCancel} disabled={isSaving}>
                Batal
              </Button>
            </div>
          </form>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default TransactionFormModal;
