import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Save, Loader2, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';

const ClientFormModal = ({ client, onSave, onCancel }) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phones: [{ id: null, phone_number: '' }],
    addresses: [{ id: null, address: '' }],
  });

  useEffect(() => {
    if (client) {
      setFormData({
        name: client.name || '',
        email: client.email || '',
        phones: client.client_phones?.length > 0 ? client.client_phones : [{ id: null, phone_number: '' }],
        addresses: client.client_addresses?.length > 0 ? client.client_addresses : [{ id: null, address: '' }],
      });
    }
  }, [client]);

  const handleDynamicFieldChange = (index, field, value, type) => {
    const updatedFields = [...formData[type]];
    updatedFields[index][field] = value;
    setFormData(prev => ({ ...prev, [type]: updatedFields }));
  };

  const addDynamicField = (type) => {
    const newField = type === 'phones' ? { id: null, phone_number: '' } : { id: null, address: '' };
    setFormData(prev => ({ ...prev, [type]: [...prev[type], newField] }));
  };

  const removeDynamicField = (index, type) => {
    const updatedFields = formData[type].filter((_, i) => i !== index);
    setFormData(prev => ({ ...prev, [type]: updatedFields }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast({ title: "Ralat Pengesahan", description: "Sila isi nama pelanggan.", variant: "destructive" });
      return;
    }
    setLoading(true);

    try {
      let clientId = client?.id;
      // Save client details
      if (clientId) {
        const { error } = await supabase.from('clients').update({ name: formData.name, email: formData.email }).eq('id', clientId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('clients').insert({ name: formData.name, email: formData.email, user_id: user.id }).select().single();
        if (error) throw error;
        clientId = data.id;
      }

      // Handle phones
      const phonesToUpsert = formData.phones
        .filter(p => p.phone_number.trim())
        .map(p => {
          const { id, ...rest } = p;
          const phoneData = { ...rest, client_id: clientId };
          if (id) {
            phoneData.id = id;
          }
          return phoneData;
        });
      if (phonesToUpsert.length > 0) {
        const { error: phoneError } = await supabase.from('client_phones').upsert(phonesToUpsert);
        if (phoneError) throw phoneError;
      }
      if (client?.client_phones) {
        const phonesToDelete = client.client_phones.filter(oldPhone => !formData.phones.some(newPhone => newPhone.id === oldPhone.id)).map(p => p.id);
        if (phonesToDelete.length > 0) {
          await supabase.from('client_phones').delete().in('id', phonesToDelete);
        }
      }

      // Handle addresses
      const addressesToUpsert = formData.addresses
        .filter(a => a.address.trim())
        .map(a => {
          const { id, ...rest } = a;
          const addressData = { ...rest, client_id: clientId };
          if (id) {
            addressData.id = id;
          }
          return addressData;
        });
      if (addressesToUpsert.length > 0) {
        const { error: addressError } = await supabase.from('client_addresses').upsert(addressesToUpsert);
        if (addressError) throw addressError;
      }
      if (client?.client_addresses) {
        const addressesToDelete = client.client_addresses.filter(oldAddr => !formData.addresses.some(newAddr => newAddr.id === oldAddr.id)).map(a => a.id);
        if (addressesToDelete.length > 0) {
          await supabase.from('client_addresses').delete().in('id', addressesToDelete);
        }
      }
      
      const { data: savedClient, error: fetchError } = await supabase
        .from('clients')
        .select('*, client_phones(*), client_addresses(*)')
        .eq('id', clientId)
        .single();
      
      if (fetchError) throw fetchError;

      onSave(savedClient);
      toast({
        title: client ? "Pelanggan Dikemaskini" : "Pelanggan Ditambah",
        description: `${formData.name} telah berjaya disimpan.`
      });
    } catch (error) {
      toast({ title: "Gagal menyimpan pelanggan", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="w-full max-w-lg">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="gradient-text">{client ? 'Sunting Pelanggan' : 'Tambah Pelanggan Baharu'}</CardTitle>
            <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
          </CardHeader>
          <CardContent className="max-h-[80vh] overflow-y-auto pr-2">
            <form onSubmit={handleSubmit} className="space-y-6 pr-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Nama Pelanggan *</label>
                <Input value={formData.name} onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))} placeholder="cth: John Doe" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">E-mel</label>
                <Input type="email" value={formData.email} onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))} placeholder="cth: john.doe@email.com" />
              </div>
              
              <div className="space-y-4">
                <label className="block text-sm font-medium text-muted-foreground">Nombor Telefon</label>
                {formData.phones.map((phone, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input value={phone.phone_number} onChange={(e) => handleDynamicFieldChange(index, 'phone_number', e.target.value, 'phones')} placeholder="cth: 012-3456789" />
                    <Button type="button" variant="destructive" size="icon" onClick={() => removeDynamicField(index, 'phones')} disabled={formData.phones.length === 1}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => addDynamicField('phones')} className="flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Tambah Nombor
                </Button>
              </div>

              <div className="space-y-4">
                <label className="block text-sm font-medium text-muted-foreground">Alamat</label>
                {formData.addresses.map((address, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input value={address.address} onChange={(e) => handleDynamicFieldChange(index, 'address', e.target.value, 'addresses')} placeholder="cth: 123, Jalan ABC, 12345 Kuala Lumpur" />
                    <Button type="button" variant="destructive" size="icon" onClick={() => removeDynamicField(index, 'addresses')} disabled={formData.addresses.length === 1}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => addDynamicField('addresses')} className="flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Tambah Alamat
                </Button>
              </div>

              <div className="flex gap-3 pt-4">
                <Button type="submit" className="flex-1 brand-gradient brand-gradient-hover" disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  {client ? 'Kemas Kini' : 'Simpan'}
                </Button>
                <Button type="button" variant="secondary" onClick={onCancel} className="flex-1" disabled={loading}>Batal</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
};

export default ClientFormModal;