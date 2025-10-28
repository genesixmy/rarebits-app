
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { X, Save, Upload, Loader2, Image as ImageIcon, Trash2, Plus } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext.jsx';
import { supabase } from '@/lib/customSupabaseClient';
import ClientFormModal from '@/components/clients/ClientFormModal';

const AddItemForm = ({ item, onSave, onCancel, categories, clients, wallets, onClientAdded, isSaving }) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  
  const getInitialFormData = (item) => ({
      id: item?.id || undefined,
      name: item?.name || '',
      category: item?.category || (categories?.[0]?.name || ''),
      costPrice: item?.cost_price || '',
      sellingPrice: item?.selling_price || '',
      status: item?.status || 'tersedia',
      dateBought: item?.date_bought || new Date().toISOString().split('T')[0],
      dateSold: item?.date_sold || '',
      platforms: item?.platforms || [],
      sold_platforms: item?.sold_platforms || [],
      image_url: item?.image_url || '',
      client_id: item?.client_id || '',
      wallet_id: (item?.status === 'terjual' && wallets.length > 0) ? (item.wallet_id || wallets[0].id) : '',
  });

  const [formData, setFormData] = useState(() => getInitialFormData(item));

  // Effect to re-initialize form when the `item` prop changes (e.g., opening the form)
  useEffect(() => {
    setFormData(getInitialFormData(item));
  }, [item, categories, clients, wallets]);
  
  // Effect to manage form state when `status` changes
  useEffect(() => {
    // When an item is marked as SOLD, set the dateSold if it's empty
    if (formData.status === 'terjual') {
        setFormData(prev => ({
            ...prev,
            dateSold: prev.dateSold || new Date().toISOString().split('T')[0],
            wallet_id: prev.wallet_id || (wallets.length > 0 ? wallets[0].id : ''),
        }));
    }
    // When an item is NOT marked as sold, clear all sales-related data
    else {
        setFormData(prev => ({
            ...prev,
            dateSold: '',
            sellingPrice: '',
            sold_platforms: [],
            client_id: '',
            wallet_id: '' // Clear wallet_id as it's not relevant
        }));
    }
  }, [formData.status, wallets]);


  const platformOptions = [
    'Carousell', 'Shopee', 'TikTok Shop', 'Lazada', 
    'Facebook Marketplace', 'Instagram', 'Mudah.my'
  ];

  const handlePlatformChange = (platform, checked) => {
    setFormData(prev => ({
      ...prev,
      platforms: checked 
        ? [...prev.platforms, platform]
        : prev.platforms.filter(p => p !== platform)
    }));
  };

  const handleSoldPlatformChange = (platform, checked) => {
    setFormData(prev => ({
      ...prev,
      sold_platforms: checked 
        ? [...prev.sold_platforms, platform]
        : prev.sold_platforms.filter(p => p !== platform)
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.costPrice) {
      toast({ title: "Ralat Pengesahan", description: "Sila isi semua medan yang bertanda *.", variant: "destructive" });
      return;
    }
    
    // Strict validation for sold items
    if (formData.status === 'terjual') {
        if (!formData.sellingPrice || !formData.dateSold || !formData.wallet_id) {
            toast({ title: "Ralat Pengesahan Jualan", description: "Untuk item terjual, sila isi Harga Jual, Tarikh Jual, dan pilih Akaun Wallet.", variant: "destructive" });
            return;
        }
    }

    onSave(formData);
  };

  const handleImageUpload = async (event) => {
    const file = event.target.files[0];
    if (!file || !user) return;

    setUploading(true);
    const fileExt = file.name.split('.').pop();
    const filePath = `${user.id}/${Date.now()}.${fileExt}`;
    
    try {
      const { error: uploadError } = await supabase.storage
        .from('item_images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('item_images')
        .getPublicUrl(filePath);

      setFormData(prev => ({ ...prev, image_url: urlData.publicUrl }));
      toast({ title: "Gambar berjaya dimuat naik!" });
    } catch (error) {
      toast({ title: "Gagal memuat naik gambar", description: error.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const removeImage = async () => {
    if (!formData.image_url) return;
    const filePath = formData.image_url.split('/item_images/')[1];
    if (!filePath) {
      toast({ title: "Gagal memadam gambar", description: "Path gambar tidak sah.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      await supabase.storage.from('item_images').remove([filePath]);
      setFormData(prev => ({ ...prev, image_url: '' }));
      toast({ title: "Gambar berjaya dipadam" });
    } catch (error) {
      toast({ title: "Gagal memadam gambar", description: error.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleClientChange = (e) => {
    if (e.target.value === 'add_new') {
      setShowClientModal(true);
    } else {
      setFormData(prev => ({ ...prev, client_id: e.target.value }));
    }
  };

  const handleClientSaved = (newClient) => {
    onClientAdded(newClient);
    setFormData(prev => ({ ...prev, client_id: newClient.id }));
    setShowClientModal(false);
  };
  
  const isSold = formData.status === 'terjual';

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="w-full max-w-3xl">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="gradient-text">{item ? 'Sunting Item' : 'Tambah Item Baharu'}</CardTitle>
              <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
            </CardHeader>
            <CardContent className="max-h-[80vh] overflow-y-auto pr-2">
              <form onSubmit={handleSubmit} className="space-y-6 pr-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-muted-foreground mb-2">Nama Item *</label>
                    <Input value={formData.name} onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))} placeholder="cth: DX Gokaioh" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">Kategori *</label>
                    <Select value={formData.category} onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}>
                      {categories && categories.length > 0 ? (
                          categories.map(cat => (
                              <option key={cat.id} value={cat.name}>{cat.name}</option>
                          ))
                      ) : (
                          <option value="" disabled>Tiada kategori. Sila tambah di Tetapan.</option>
                      )}
                    </Select>
                  </div>
                   <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">Harga Kos *</label>
                    <div className="relative"><span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-primary font-medium">RM</span><Input type="number" step="0.01" min="0" value={formData.costPrice} onChange={(e) => setFormData(prev => ({ ...prev, costPrice: e.target.value }))} placeholder="0.00" className="pl-12" required /></div>
                  </div>
                   <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">Tarikh Beli *</label>
                    <Input type="date" value={formData.dateBought} onChange={(e) => setFormData(prev => ({ ...prev, dateBought: e.target.value }))} required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">Status</label>
                    <Select value={formData.status} onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value }))}>
                      <option value="tersedia">Tersedia</option>
                      <option value="reserved">Reserved</option>
                      <option value="terjual">Terjual</option>
                    </Select>
                  </div>
                  
                  {isSold && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-2">Harga Jual *</label>
                        <div className="relative"><span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-primary font-medium">RM</span><Input type="number" step="0.01" min="0" value={formData.sellingPrice} onChange={(e) => setFormData(prev => ({ ...prev, sellingPrice: e.target.value }))} placeholder="0.00" className="pl-12" required={isSold} /></div>
                      </div>
                       <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-2">Tarikh Jual *</label>
                        <Input type="date" value={formData.dateSold} onChange={(e) => setFormData(prev => ({ ...prev, dateSold: e.target.value }))} required={isSold} />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-muted-foreground mb-2">Akaun Wallet (Perniagaan) *</label>
                        <Select value={formData.wallet_id} onChange={(e) => setFormData(prev => ({...prev, wallet_id: e.target.value}))} required={isSold}>
                          <option value="">-- Sila pilih akaun --</option>
                          {wallets && wallets.length > 0 ? (
                              wallets.map(wallet => (
                                  <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
                              ))
                          ) : (
                              <option value="" disabled>Tiada akaun perniagaan.</option>
                          )}
                        </Select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-2">Pelanggan (Pilihan)</label>
                        <Select value={formData.client_id} onChange={handleClientChange}>
                          <option value="">Tiada Pelanggan</option>
                          {clients && clients.map(client => (
                            <option key={client.id} value={client.id}>{client.name}</option>
                          ))}
                          <option value="add_new" className="font-bold text-primary">
                            + Tambah Pelanggan Baharu
                          </option>
                        </Select>
                      </div>
                    </>
                  )}


                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-muted-foreground mb-2">Gambar Item</label>
                    {formData.image_url ? (
                      <div className="relative group w-48 h-48">
                        <img src={formData.image_url} alt="Pratonton item" className="w-full h-full object-cover rounded-md border" />
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button type="button" variant="destructive" size="icon" onClick={removeImage} disabled={uploading}>
                            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="w-full h-32 border-2 border-dashed rounded-md flex flex-col items-center justify-center">
                        {uploading ? (
                          <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        ) : (
                          <>
                            <ImageIcon className="w-8 h-8 text-muted-foreground mb-2" />
                            <Button type="button" variant="link" asChild><label htmlFor="image-upload" className="cursor-pointer">Muat Naik Gambar</label></Button>
                            <Input id="image-upload" type="file" className="hidden" accept="image/png, image/jpeg, image/webp" onChange={handleImageUpload} />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-muted-foreground mb-3">Platform Jualan (Tempat Iklan)</label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {platformOptions.map((platform) => (
                        <div key={platform} className="flex items-center space-x-2">
                          <Checkbox id={platform} checked={formData.platforms.includes(platform)} onCheckedChange={(checked) => handlePlatformChange(platform, checked)} />
                          <label htmlFor={platform} className="text-sm font-medium leading-none">{platform}</label>
                        </div>
                      ))}
                    </div>
                  </div>
                  {isSold && (
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-muted-foreground mb-3">Platform Tempat Terjual</label>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {formData.platforms.map((platform) => (
                          <div key={`sold-${platform}`} className="flex items-center space-x-2">
                            <Checkbox id={`sold-${platform}`} checked={formData.sold_platforms.includes(platform)} onCheckedChange={(checked) => handleSoldPlatformChange(platform, checked)} />
                            <label htmlFor={`sold-${platform}`} className="text-sm font-medium leading-none">{platform}</label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-3 pt-4">
                  <Button type="submit" className="flex-1 brand-gradient brand-gradient-hover" disabled={isSaving || uploading}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    <span className="whitespace-nowrap">{item ? 'Kemas Kini' : 'Tambah'}</span>
                  </Button>
                  <Button type="button" variant="destructive" onClick={onCancel} className="sm:w-auto sm:flex-1" disabled={isSaving || uploading}>
                    <X className="w-4 h-4 sm:hidden" />
                    <span className="hidden sm:inline">Batal</span>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
      {showClientModal && (
        <ClientFormModal 
          onSave={handleClientSaved}
          onCancel={() => {
            setShowClientModal(false);
            setFormData(prev => ({ ...prev, client_id: '' }));
          }}
        />
      )}
    </>
  );
};

export default AddItemForm;
