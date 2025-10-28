import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Upload, Save } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

const ProfileSettings = ({ user, onUpdateProfile }) => {
  const { toast } = useToast();
  const [profileLoading, setProfileLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  const getProfile = useCallback(async () => {
    try {
      setProfileLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select(`username, avatar_url`)
        .eq('id', user.id)
        .maybeSingle();
      
      if (error) throw error;

      if (data) {
        setUsername(data.username);
        setAvatarUrl(data.avatar_url);
      }
    } catch (error) {
      toast({ variant: 'destructive', title: 'Gagal memuatkan profil', description: error.message });
    } finally {
      setProfileLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    getProfile();
  }, [getProfile]);

  const updateProfile = async (e) => {
    e.preventDefault();
    try {
      setProfileLoading(true);
      const { error } = await supabase.from('profiles').upsert({
        id: user.id,
        username,
        avatar_url: avatarUrl,
        updated_at: new Date(),
      });
      if (error) throw error;
      toast({ title: 'Profil berjaya dikemaskini!' });
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
      
      if (avatarUrl) {
        const oldFilePath = avatarUrl.split('/avatars/')[1];
        if (oldFilePath) {
          await supabase.storage.from('avatars').remove([oldFilePath]);
        }
      }

      const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, file);
      if (uploadError) throw uploadError;
      
      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
      const newAvatarUrl = data.publicUrl;
      setAvatarUrl(newAvatarUrl);
      
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
      if (password !== confirmPassword) {
          toast({ variant: 'destructive', title: 'Kata laluan tidak sepadan!' });
          return;
      }
      if (password.length < 6) {
          toast({ variant: 'destructive', title: 'Kata laluan mesti sekurang-kurangnya 6 aksara.' });
          return;
      }
      setPasswordLoading(true);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
          toast({ variant: 'destructive', title: 'Gagal menukar kata laluan', description: error.message });
      } else {
          toast({ title: 'Kata laluan berjaya ditukar!' });
          setPassword('');
          setConfirmPassword('');
      }
      setPasswordLoading(false);
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
                <AvatarImage src={avatarUrl} alt="Avatar" />
                <AvatarFallback className="text-3xl">{username ? username.charAt(0).toUpperCase() : 'A'}</AvatarFallback>
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
              <Input id="username" type="text" value={username || ''} onChange={(e) => setUsername(e.target.value)} disabled={profileLoading} />
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
                      <Input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Sekurang-kurangnya 6 aksara" />
                  </div>
                  <div>
                      <label htmlFor="confirm-password" className="block text-sm font-medium text-muted-foreground mb-1">Sahkan Kata Laluan Baru</label>
                      <Input id="confirm-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Taip semula kata laluan baru" />
                  </div>
                  <Button type="submit" disabled={passwordLoading} className="brand-gradient brand-gradient-hover text-white">
                      {passwordLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                      Tukar Kata Laluan
                  </Button>
              </form>
          </CardContent>
      </Card>
    </div>
  );
};

export default ProfileSettings;