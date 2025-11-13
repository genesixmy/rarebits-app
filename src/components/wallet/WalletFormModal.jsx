import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Save, X, Briefcase, User } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

const DRAFT_KEY = 'rarebits-wallet-form-draft';

const WalletFormModal = ({ wallet, onSave, onCancel, isSaving }) => {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: '',
    balance: '',
    account_type: 'Business', // Default to Business
  });

  useEffect(() => {
    if (wallet) {
      setFormData({
        name: wallet.name,
        balance: wallet.balance.toString(),
        account_type: wallet.account_type || 'Business',
      });
      localStorage.removeItem(DRAFT_KEY); // Clear draft when editing
    } else {
      const savedDraft = localStorage.getItem(DRAFT_KEY);
      if (savedDraft) {
        setFormData(JSON.parse(savedDraft));
      } else {
        setFormData({ name: '', balance: '', account_type: 'Business' });
      }
    }
  }, [wallet]);

  useEffect(() => {
    // Save to draft only when creating a new wallet
    if (!wallet) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(formData));
    }
  }, [formData, wallet]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim() || formData.balance === '') {
      toast({
        title: "Ralat Pengesahan",
        description: "Sila isi nama dan baki wallet.",
        variant: "destructive",
      });
      return;
    }
    await onSave({ ...wallet, ...formData, balance: parseFloat(formData.balance) });
    localStorage.removeItem(DRAFT_KEY);
  };

  const handleCancel = () => {
    localStorage.removeItem(DRAFT_KEY);
    onCancel();
  };

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
        className="relative w-full max-w-md bg-card rounded-2xl shadow-lg border"
      >
        <div className="p-6">
          <h2 className="text-xl font-bold gradient-text mb-1">{wallet ? 'Sunting Wallet' : 'Tambah Wallet Baharu'}</h2>
          <p className="text-muted-foreground mb-6">Masukkan butiran untuk akaun wallet anda.</p>
          
          <form onSubmit={handleSubmit} className="space-y-4">
             <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Jenis Akaun *</label>
              <div className="grid grid-cols-2 gap-2">
                <Button 
                  type="button" 
                  variant="outline"
                  onClick={() => setFormData(prev => ({ ...prev, account_type: 'Business' }))}
                  className={cn("justify-start", formData.account_type === 'Business' && "ring-2 ring-primary")}
                >
                  <Briefcase className="mr-2 h-4 w-4" /> Business
                </Button>
                 <Button 
                  type="button" 
                  variant="outline"
                  onClick={() => setFormData(prev => ({ ...prev, account_type: 'Personal' }))}
                  className={cn("justify-start", formData.account_type === 'Personal' && "ring-2 ring-primary")}
                >
                  <User className="mr-2 h-4 w-4" /> Personal
                </Button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Nama Wallet *</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="cth: Maybank, CIMB, TnG eWallet"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">Baki Mula *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-primary font-medium">RM</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.balance}
                  onChange={(e) => setFormData(prev => ({ ...prev, balance: e.target.value }))}
                  placeholder="0.00"
                  className="pl-12"
                  required
                  readOnly={!!wallet} // Balance can only be set on creation
                />
              </div>
               {wallet && <p className="text-xs text-muted-foreground mt-1">Baki hanya boleh diubah melalui transaksi.</p>}
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="submit" className="flex-1 brand-gradient brand-gradient-hover" disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                {wallet ? 'Kemas Kini' : 'Simpan'}
              </Button>
              <Button type="button" variant="outline" onClick={handleCancel} className="sm:w-auto sm:flex-1" disabled={isSaving}>
                <X className="w-4 h-4 mr-2" />
                Batal
              </Button>
            </div>
          </form>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default WalletFormModal;