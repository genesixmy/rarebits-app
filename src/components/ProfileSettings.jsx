import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Upload, Save } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useProfileForm } from '@/contexts/ProfileFormContext';

const ProfileSettings = ({ user, onUpdateProfile }) => {
  const { toast } = useToast();
  const { formData, updateFormField, clearDraft, resetToInitial } = useProfileForm();
  const [profileLoading, setProfileLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const lastLoadedUserIdRef = useRef(null);

  // CRITICAL: Save profile form data to sessionStorage AND localStorage
  useEffect(() => {
    console.log('[ProfileSettings] Save effect triggered. userId:', user?.id, 'formData.username:', formData.username);
    if (formData) {
      try {
        // Save to sessionStorage (quick access)
        sessionStorage.setItem('rarebit_profile_form_backup', JSON.stringify(formData));
        
        // ALSO save to localStorage (used by ProfileFormContext)
        const storageKey = `rarebit_profile_form_draft_${user.id}`;
        localStorage.setItem(storageKey, JSON.stringify(formData));
        
        // Verify it was saved
        const saved = localStorage.getItem(storageKey);
        console.log(`[ProfileSettings] ✅ Saved to localStorage key: ${storageKey}`);
        console.log('[ProfileSettings] Saved data:', JSON.parse(saved));
      } catch (error) {
        console.error('[ProfileSettings] Error saving profile to storage:', error);
      }
    }
  }, [formData, user.id]);

  const getProfile = useCallback(async () => {
    try {
      setProfileLoading(true);
      
      // Only load from server if we haven't loaded for this user yet
      // OR if a draft doesn't exist
      const storageKey = `rarebit_profile_form_draft_${user.id}`;
      const hasDraft = localStorage.getItem(storageKey) !== null;
      const alreadyLoaded = lastLoadedUserIdRef.current === user.id;
      
      console.log(`[ProfileSettings] getProfile called. hasDraft=${hasDraft}, alreadyLoaded=${alreadyLoaded}`);
      
      if (hasDraft && alreadyLoaded) {
        console.log('[ProfileSettings] Draft exists and already loaded, skipping server fetch');
        setProfileLoading(false);
        return;
      }
      
      // Load from server
      const { data, error } = await supabase
        .from('profiles')
        .select(`username, avatar_url`)
        .eq('id', user.id)
        .maybeSingle();
      
      if (error) throw error;

      if (data) {
        console.log('[ProfileSettings] Loaded profile from server:', data);
        resetToInitial({ 
          username: data.username, 
          avatarUrl: data.avatar_url 
        });
      }
      
      lastLoadedUserIdRef.current = user.id;
    } catch (error) {
      toast({ variant: 'destructive', title: 'Gagal memuatkan profil', description: error.message });
    } finally {
      setProfileLoading(false);
    }
  }, [user, toast, resetToInitial]);

  useEffect(() => {
    getProfile();
  }, [getProfile]);

  const updateProfile = async (e) => {
    e.preventDefault();
    try {
      setProfileLoading(true);
      const { error } = await supabase.from('profiles').upsert({
        id: user.id,
        username: formData.username,
        avatar_url: formData.avatarUrl,
        updated_at: new Date(),
      });
      if (error) throw error;
      toast({ title: 'Profil berjaya dikemaskini!' });
      clearDraft();
      if (onUpdateProfile) {
        onUpdateProfile();
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Gagal mengemaskini profil', description: error.message });
    } finally {
      setProfileLoading(false);
    }
  };

  const uploadAvatar = async (event) => {
    try {
      setUploading(true);
      if (!event.target.files || event.target.files.length === 0) {
        throw new Error('Anda mesti memilih imej untuk dimuat naik.');
      }
      const file = event.target.files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;
      
      if (formData.avatarUrl) {
        const oldFilePath = formData.avatarUrl.split('/avatars/')[1];
        if (oldFilePath) {
          await supabase.storage.from('avatars').remove([oldFilePath]);
        }
      }

      const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, file);
      if (uploadError) throw uploadError;
      
      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
      const newAvatarUrl = data.publicUrl;
      updateFormField('avatarUrl', newAvatarUrl);
      
      const { error: updateError } = await supabase.from('profiles').upsert({
        id: user.id,
        avatar_url: newAvatarUrl,
        updated_at: new Date(),
      });
      if (updateError) throw updateError;

      toast({ title: 'Avatar berjaya dikemaskini!' });
      if (onUpdateProfile) {
        onUpdateProfile();
      }

    } catch (error) {
      toast({ variant: 'destructive', title: 'Gagal muatnaik avatar', description: error.message });
    } finally {
      setUploading(false);
    }
  };
  
  const handlePasswordChange = async (e) => {
      e.preventDefault();
      if (formData.password !== formData.confirmPassword) {
          toast({ variant: 'destructive', title: 'Kata laluan tidak sepadan!' });
          return;
      }
      if (formData.password.length < 6) {
          toast({ variant: 'destructive', title: 'Kata laluan mesti sekurang-kurangnya 6 aksara.' });
          return;
      }
      setProfileLoading(true);
      const { error } = await supabase.auth.updateUser({ password: formData.password });
      if (error) {
          toast({ variant: 'destructive', title: 'Gagal menukar kata laluan', description: error.message });
      } else {
          toast({ title: 'Kata laluan berjaya ditukar!' });
          updateFormField('password', '');
          updateFormField('confirmPassword', '');
      }
      setProfileLoading(false);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profil Awam</CardTitle>
          <CardDescription>Kemas kini nama pengguna dan avatar anda.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={updateProfile} className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="w-24 h-24">
                <AvatarImage src={formData.avatarUrl} alt="Avatar" />
                <AvatarFallback className="text-3xl">{formData.username ? formData.username.charAt(0).toUpperCase() : 'A'}</AvatarFallback>
              </Avatar>
               <Button asChild variant="outline">
                <label htmlFor="single" className="cursor-pointer flex items-center">
                  {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                  Muat Naik
                </label>
              </Button>
              <input style={{ display: 'none' }} type="file" id="single" accept="image/*" onChange={uploadAvatar} disabled={uploading} />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-muted-foreground mb-1">Emel</label>
              <Input id="email" type="text" value={user.email} disabled />
            </div>
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-muted-foreground mb-1">Nama Pengguna</label>
              <Input id="username" type="text" value={formData.username || ''} onChange={(e) => updateFormField('username', e.target.value)} disabled={profileLoading} />
            </div>
            <div>
              <Button type="submit" disabled={profileLoading || uploading} className="brand-gradient brand-gradient-hover text-white">
                {profileLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Kemas Kini Profil
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      
      <Card>
          <CardHeader>
              <CardTitle>Tukar Kata Laluan</CardTitle>
              <CardDescription>Masukkan kata laluan baharu anda di bawah.</CardDescription>
          </CardHeader>
          <CardContent>
              <form onSubmit={handlePasswordChange} className="space-y-4">
                  <div>
                      <label htmlFor="new-password" className="block text-sm font-medium text-muted-foreground mb-1">Kata Laluan Baru</label>
                      <Input id="new-password" type="password" value={formData.password} onChange={(e) => updateFormField('password', e.target.value)} placeholder="Sekurang-kurangnya 6 aksara" />
                  </div>
                  <div>
                      <label htmlFor="confirm-password" className="block text-sm font-medium text-muted-foreground mb-1">Sahkan Kata Laluan Baru</label>
                      <Input id="confirm-password" type="password" value={formData.confirmPassword} onChange={(e) => updateFormField('confirmPassword', e.target.value)} placeholder="Taip semula kata laluan baru" />
                  </div>
                  <Button type="submit" disabled={profileLoading} className="brand-gradient brand-gradient-hover text-white">
                      {profileLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                      Tukar Kata Laluan
                  </Button>
              </form>
          </CardContent>
      </Card>
    </div>
  );
};

export default ProfileSettings;