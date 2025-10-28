import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Loader2, Save, Repeat } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const TransferFormModal = ({ wallets, onSave, onCancel, isSaving, initialSourceWalletId }) => {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    source_wallet_id: '',
    destination_wallet_id: '',
    amount: '',
    transaction_date: new Date().toISOString().split('T')[0],
    description: 'Pemindahan Dana',
  });

  useEffect(() => {
    const sourceId = initialSourceWalletId || (wallets.length > 0 ? wallets[0].id : '');
    const destinationWallets = wallets.filter(w => w.id !== sourceId);
    const destinationId = destinationWallets.length > 0 ? destinationWallets[0].id : '';

    setFormData(prev => ({
      ...prev,
      source_wallet_id: sourceId,
      destination_wallet_id: destinationId,
    }));
  }, [wallets, initialSourceWalletId]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.source_wallet_id || !formData.destination_wallet_id || !formData.amount) {
      toast({ title: "Ralat", description: "Sila isi semua medan.", variant: "destructive" });
      return;
    }
    if (formData.source_wallet_id === formData.destination_wallet_id) {
      toast({ title: "Ralat", description: "Akaun sumber dan destinasi tidak boleh sama.", variant: "destructive" });
      return;
    }
    onSave(formData);
  };

  const availableDestinationWallets = wallets.filter(w => w.id !== formData.source_wallet_id);

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
          <h2 className="text-xl font-bold gradient-text mb-6">Pindah Dana Antara Wallet</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Dari Akaun *</label>
                <Select value={formData.source_wallet_id} onChange={(e) => setFormData(prev => ({...prev, source_wallet_id: e.target.value}))} required>
                  {wallets.map(w => <option key={w.id} value={w.id}>{w.name} (RM{parseFloat(w.balance).toFixed(2)})</option>)}
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Ke Akaun *</label>
                <Select value={formData.destination_wallet_id} onChange={(e) => setFormData(prev => ({...prev, destination_wallet_id: e.target.value}))} required>
                  {availableDestinationWallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">Jumlah *</label>
                    <div className="relative">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-primary font-medium">RM</span>
                    <Input type="number" step="0.01" min="0" value={formData.amount} onChange={(e) => setFormData(prev => ({...prev, amount: e.target.value}))} placeholder="0.00" className="pl-12" required />
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">Tarikh *</label>
                    <Input type="date" value={formData.transaction_date} onChange={(e) => setFormData(prev => ({...prev, transaction_date: e.target.value}))} required />
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Keterangan</label>
                <Input value={formData.description} onChange={(e) => setFormData(prev => ({...prev, description: e.target.value}))} placeholder="cth: Pindah ke akaun simpanan" />
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="submit" className="flex-1" disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Repeat className="w-4 h-4 mr-2" />}
                Pindahkan
              </Button>
              <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
                Batal
              </Button>
            </div>
          </form>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default TransferFormModal;