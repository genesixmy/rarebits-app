import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback } from 'react';

const ProfileFormContext = createContext();

const STORAGE_KEY = 'rarebit_profile_form_draft';

export const ProfileFormProvider = ({ children, userId }) => {
  // Default empty form structure
  const getDefaultFormData = () => ({
    username: '',
    avatarUrl: null,
    password: '',
    confirmPassword: '',
  });

  const [formData, setFormData] = useState(getDefaultFormData());

  // Load from storage when userId changes (and userId is valid)
  useLayoutEffect(() => {
    if (!userId) {
      console.log('[ProfileFormContext] userId is null/undefined, skipping load');
      return;
    }

    console.log(`[ProfileFormContext] 🔄 userId changed to ${userId}, attempting to load from storage`);
    
    // Try localStorage first
    try {
      const storageKey = `${STORAGE_KEY}_${userId}`;
      const savedData = localStorage.getItem(storageKey);
      console.log(`[ProfileFormContext] Checking localStorage for key: "${storageKey}"`);
      
      if (savedData) {
        const parsed = JSON.parse(savedData);
        console.log(`[ProfileFormContext] ✅ Found in localStorage!`, parsed);
        setFormData(parsed);
        return;
      } else {
        console.log(`[ProfileFormContext] ❌ Not found in localStorage`);
      }
    } catch (error) {
      console.error('[ProfileFormContext] Error loading from localStorage:', error);
    }
    
    // Try sessionStorage backup
    try {
      const backup = sessionStorage.getItem('rarebit_profile_form_backup');
      if (backup) {
        const parsed = JSON.parse(backup);
        console.log(`[ProfileFormContext] ✅ Found in sessionStorage backup!`, parsed);
        setFormData(parsed);
        return;
      } else {
        console.log(`[ProfileFormContext] ❌ Not found in sessionStorage backup`);
      }
    } catch (error) {
      console.error('[ProfileFormContext] Error loading from sessionStorage:', error);
    }
    
    // No saved data found - reset to defaults
    console.log(`[ProfileFormContext] No saved data found, using defaults`);
    setFormData(getDefaultFormData());
  }, [userId]);

  // Listen for visibility changes (browser tab switch)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log(`[ProfileFormContext] Tab became visible, checking for saved data for userId ${userId}`);
        
        if (!userId) return;
        
        // Try to restore form data from storage
        try {
          const savedData = localStorage.getItem(`${STORAGE_KEY}_${userId}`);
          if (savedData) {
            const parsed = JSON.parse(savedData);
            console.log(`[ProfileFormContext] Restored from localStorage after tab switch:`, parsed);
            setFormData(parsed);
            return;
          }
        } catch (error) {
          console.error('[ProfileFormContext] Error loading from localStorage:', error);
        }
        
        // Try sessionStorage backup
        try {
          const backup = sessionStorage.getItem('rarebit_profile_form_backup');
          if (backup) {
            const parsed = JSON.parse(backup);
            console.log(`[ProfileFormContext] Restored from sessionStorage backup after tab switch:`, parsed);
            setFormData(parsed);
          }
        } catch (error) {
          console.error('[ProfileFormContext] Error loading from sessionStorage:', error);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [userId]);

  // Update individual form fields
  const updateFormField = useCallback((field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  // Update multiple fields at once
  const updateFormData = useCallback((newData) => {
    setFormData(prev => ({
      ...prev,
      ...newData,
    }));
  }, []);

  // Clear draft (called after successful save)
  const clearDraft = useCallback(() => {
    setFormData({
      username: '',
      avatarUrl: null,
      password: '',
      confirmPassword: '',
    });
    try {
      localStorage.removeItem(`${STORAGE_KEY}_${userId}`);
    } catch (error) {
      console.error('Failed to clear form draft:', error);
    }
  }, [userId]);

  // Reset form to initial state (from server)
  // This is called when loading profile data - but does NOT clear the draft
  const resetToInitial = useCallback((initialData) => {
    setFormData({
      username: initialData.username || '',
      avatarUrl: initialData.avatarUrl || null,
      password: '',
      confirmPassword: '',
    });
    // NOTE: Don't clear localStorage here - ProfileSettings handles persistence
    // The draft will be cleared after successful save via clearDraft()
  }, []);

  return (
    <ProfileFormContext.Provider
      value={{
        formData,
        updateFormField,
        updateFormData,
        clearDraft,
        resetToInitial,
      }}
    >
      {children}
    </ProfileFormContext.Provider>
  );
};

export const useProfileForm = () => {
  const context = useContext(ProfileFormContext);
  if (!context) {
    throw new Error('useProfileForm must be used within ProfileFormProvider');
  }
  return context;
};
