import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProfileSettings from '@/components/ProfileSettings';
import CategorySettings from '@/components/CategorySettings';
import { User, Tag } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';

const PROFILE_FORM_STORAGE_KEY = 'rarebits_profile_form_draft';

const SettingsPage = ({ user, categories, onUpdateCategories, onUpdateProfile }) => {
  // Persistent form state for ProfileSettings
  const [profileFormData, setProfileFormData] = useState({
    username: '',
    avatarUrl: null,
    password: '',
    confirmPassword: ''
  });
  const [isProfileLoaded, setIsProfileLoaded] = useState(false);

  // Load profile data from Supabase on mount
  const loadProfile = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        // Try to load from localStorage first (draft changes)
        const savedDraft = localStorage.getItem(PROFILE_FORM_STORAGE_KEY);
        if (savedDraft) {
          try {
            const draft = JSON.parse(savedDraft);
            // Only use draft if it's for the same user
            if (draft.userId === user.id) {
              setProfileFormData({
                username: draft.username || data.username,
                avatarUrl: draft.avatarUrl || data.avatar_url,
                password: draft.password || '',
                confirmPassword: draft.confirmPassword || ''
              });
              setIsProfileLoaded(true);
              return;
            }
          } catch (e) {
            // Invalid draft, ignore
            localStorage.removeItem(PROFILE_FORM_STORAGE_KEY);
          }
        }

        // No valid draft, use database data
        setProfileFormData({
          username: data.username,
          avatarUrl: data.avatar_url,
          password: '',
          confirmPassword: ''
        });
      }
      setIsProfileLoaded(true);
    } catch (error) {
      console.error('Failed to load profile:', error);
      setIsProfileLoaded(true);
    }
  }, [user.id]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Save form data to localStorage whenever it changes
  useEffect(() => {
    if (isProfileLoaded) {
      const draft = {
        userId: user.id,
        ...profileFormData
      };
      localStorage.setItem(PROFILE_FORM_STORAGE_KEY, JSON.stringify(draft));
    }
  }, [profileFormData, user.id, isProfileLoaded]);

  // Clear localStorage draft after successful save
  const handleProfileSaved = () => {
    localStorage.removeItem(PROFILE_FORM_STORAGE_KEY);
    setProfileFormData(prev => ({
      ...prev,
      password: '',
      confirmPassword: ''
    }));
    if (onUpdateProfile) {
      onUpdateProfile();
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="page-title">Tetapan</h1>
      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="profile" className="gap-2">
            <User className="w-4 h-4" /> Profil
          </TabsTrigger>
          <TabsTrigger value="categories" className="gap-2">
            <Tag className="w-4 h-4" /> Kategori
          </TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-6">
          <ProfileSettings
            user={user}
            onUpdateProfile={handleProfileSaved}
            formData={profileFormData}
            setFormData={setProfileFormData}
            isLoaded={isProfileLoaded}
          />
        </TabsContent>
        <TabsContent value="categories" className="mt-6">
          <CategorySettings
            categories={categories}
            onUpdate={onUpdateCategories}
            userId={user.id}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SettingsPage;