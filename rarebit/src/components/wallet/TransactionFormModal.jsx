
import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Loader2, Save, X, TrendingUp, TrendingDown } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

const DRAFT_KEY_PREFIX = 'rarebits-transaction-form-draft';

const INCOME_CATEGORIES = [
  'Gaji/Pendapatan Tetap',
  'Pendapatan Sampingan',
  'Bonus/Insentif',
  'Dividen/Keuntungan Pelaburan',
  'Jualan Barang Terpakai',
  'Elaun',
  'Hadiah/Sumbangan',
  'Lain-lain',
];

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

const TransactionFormModal = ({ transaction, wallets, onSave, onCancel, isSaving }) => {
  const { toast } = useToast();
  
  const isEditing = !!transaction?.id;
  
  const [formData, setFormData] = useState({
    wallet_id: '',
    amount: '',
    transaction_date: new Date().toISOString().split('T')[0],
    description: '',
    category: '',
  });

  const selectedWallet = useMemo(() => wallets.find(w => w.id === formData.wallet_id), [wallets, formData.wallet_id]);
  const isPersonalAccount = selectedWallet?.account_type === 'Personal';

  const [type, setType] = useState('jualan');

  const DRAFT_KEY = `${DRAFT_KEY_PREFIX}-${transaction?.id || 'new'}`;

  useEffect(() => {
    const initialWallet = wallets.find(w => w.id === transaction?.wallet_id) || wallets[0];
    const savedDraft = !isEditing ? localStorage.getItem(DRAFT_KEY) : null;
    
    if (savedDraft) {
        const draft = JSON.parse(savedDraft);
        setFormData(draft.formData);
        setType(draft.type);
    } else if (transaction) {
        const personal = initialWallet?.account_type === 'Personal';
        setType(isEditing ? transaction.type : (personal ? 'pendapatan' : 'jualan'));
        setFormData({
            wallet_id: transaction.wallet_id || wallets[0]?.id || '',
            amount: isEditing ? transaction.amount.toString() : '',
            transaction_date: isEditing ? transaction.transaction_date : new Date().toISOString().split('T')[0],
            description: transaction.description || '',
            category: transaction.category || '',
        });
        if(isEditing) localStorage.removeItem(DRAFT_KEY);
    } else if (wallets.length > 0) {
        const initialWalletId = wallets[0]?.id || '';
        const initialWalletIsPersonal = wallets.find(w => w.id === initialWalletId)?.account_type === 'Personal';
        setFormData({
            wallet_id: initialWalletId,
            amount: '',
            transaction_date: new Date().toISOString().split('T')[0],
            description: '',
            category: '',
        });
        setType(initialWalletIsPersonal ? 'pendapatan' : 'jualan');
    }
}, [transaction, wallets, DRAFT_KEY, isEditing]);


  useEffect(() => {
    if (!isEditing) {
      const draft = { type, formData };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }
  }, [type, formData, isEditing, DRAFT_KEY]);
  
  useEffect(() => {
    if (!isEditing) {
      const newType = isPersonalAccount ? 'pendapatan' : 'jualan';
      if (type !== 'perbelanjaan') {
        setType(newType);
      }
      setFormData(prev => ({ ...prev, category: '', description: '' }));
    }
  }, [formData.wallet_id, isPersonalAccount, isEditing]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.wallet_id || !formData.amount || !formData.transaction_date) {
      toast({ title: "Ralat Pengesahan", description: "Sila isi semua medan yang diperlukan.", variant: "destructive" });
      return;
    }
    if ((type === 'perbelanjaan' || type === 'pendapatan') && !formData.category) {
      toast({ title: "Ralat Pengesahan", description: "Sila pilih kategori.", variant: "destructive" });
      return;
    }

    const dataToSave = {
      ...formData,
      id: transaction?.id,
      type,
    };
    
    await onSave(dataToSave);
    if (!isEditing) localStorage.removeItem(DRAFT_KEY);
  };
  
  const handleCancel = () => {
    if (!isEditing) localStorage.removeItem(DRAFT_KEY);
    onCancel();
  };

  const handleTypeChange = (newType) => {
    setType(newType);
    setFormData(prev => ({
      ...prev,
      description: '',
      category: '',
    }));
  };
  
  const currentExpenseCategories = isPersonalAccount ? EXPENSE_CATEGORIES_PERSONAL : EXPENSE_CATEGORIES_BUSINESS;
  const positiveFlowType = isPersonalAccount ? 'pendapatan' : 'jualan';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="relative w-full max-w-lg bg-card rounded-2xl shadow-lg border"
      >
        <div className="p-6">
          <h2 className="text-xl font-bold gradient-text mb-2">{isEditing ? 'Sunting' : 'Tambah'} Transaksi</h2>
          
          <div className="grid grid-cols-2 gap-2 mb-6">
            <Button 
              variant={type === positiveFlowType ? 'default' : 'secondary'} 
              onClick={() => handleTypeChange(positiveFlowType)} 
              className={cn("justify-center", type === positiveFlowType && "brand-gradient")}
              disabled={isEditing && transaction?.type !== positiveFlowType}
            >
              <TrendingUp className="mr-2 h-4 w-4" /> {isPersonalAccount ? 'Pendapatan' : 'Jualan'}
            </Button>
            <Button 
              variant={type === 'perbelanjaan' ? 'default' : 'secondary'} 
              onClick={() => handleTypeChange('perbelanjaan')}
              className={cn("justify-center", type === 'perbelanjaan' && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
              disabled={isEditing && transaction?.type !== 'perbelanjaan'}
            >
              <TrendingDown className="mr-2 h-4 w-4" /> Perbelanjaan
            </Button>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Akaun Wallet *</label>
                <Select value={formData.wallet_id} onChange={(e) => setFormData(prev => ({...prev, wallet_id: e.target.value}))} required>
                  {wallets.length > 0 ? (
                      wallets.map(w => <option key={w.id} value={w.id}>{w.name} ({w.account_type})</option>)
                  ) : (
                      <option value="" disabled>Tiada wallet tersedia</option>
                  )}
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Jumlah *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-primary font-medium">RM</span>
                  <Input type="number" step="0.01" min="0" value={formData.amount} onChange={(e) => setFormData(prev => ({...prev, amount: e.target.value}))} placeholder="0.00" className="pl-12" required />
                </div>
              </div>
            </div>

            {type === 'jualan' && !isPersonalAccount ? (
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Keterangan</label>
                <Input value={formData.description} onChange={(e) => setFormData(prev => ({...prev, description: e.target.value}))} placeholder="cth: Jualan Kamen Rider A" />
              </div>
            ) : type === 'pendapatan' && isPersonalAccount ? (
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Kategori Pendapatan *</label>
                <Select value={formData.category} onChange={(e) => setFormData(prev => ({...prev, category: e.target.value}))} required>
                  <option value="" disabled>Pilih kategori...</option>
                  {INCOME_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
            ) : type === 'perbelanjaan' ? (
               <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Kategori Perbelanjaan *</label>
                <Select value={formData.category} onChange={(e) => setFormData(prev => ({...prev, category: e.target.value}))} required>
                  <option value="" disabled>Pilih kategori...</option>
                  {currentExpenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
            ) : null}

             <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Tarikh Transaksi *</label>
              <Input type="date" value={formData.transaction_date} onChange={(e) => setFormData(prev => ({...prev, transaction_date: e.target.value}))} required />
            </div>
            
            <div className="flex gap-3 pt-4">
              <Button type="submit" className="flex-1" variant={type !== 'perbelanjaan' ? 'default' : 'destructive'} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
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
