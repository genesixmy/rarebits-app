import React, { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';

const ItemFormContext = createContext();

const STORAGE_KEY = 'rarebit_item_form_draft';

export const ItemFormProvider = ({ children, itemId, categories = [], wallets = [] }) => {
  // Default empty form structure
  const getDefaultFormData = () => ({
    id: undefined,
    name: '',
    category: '',
    costPrice: '',
    sellingPrice: '',
    status: 'tersedia',
    dateBought: new Date().toISOString().split('T')[0],
    dateSold: '',
    platforms: [],
    sold_platforms: [],
    image_url: '',
    client_id: '',
    wallet_id: '',
  });

  const [formData, setFormData] = useState(getDefaultFormData());
  
  // Track if we've already initialized to prevent redundant calls
  const initializedItemIdRef = useRef(null);

  // Load from storage when itemId changes (and itemId is valid)
  // IMPORTANT: Only load from storage if data exists. Do NOT reset to defaults here.
  // AddItemForm.initializeFromItem will handle populating form data from server.
  useLayoutEffect(() => {
    if (!itemId) {
      console.log('[ItemFormContext] itemId is null/undefined, clearing form');
      return;
    }

    console.log(`[ItemFormContext] 🔄 itemId changed to ${itemId}, attempting to load from storage`);
    
    // Try localStorage first - this is where AddItemForm saves the draft
    try {
      const storageKey = `rarebit_item_form_draft_${itemId}`;
      const savedData = localStorage.getItem(storageKey);
      console.log(`[ItemFormContext] Checking localStorage for key: "${storageKey}"`);
      
      if (savedData) {
        const parsed = JSON.parse(savedData);
        console.log(`[ItemFormContext] ✅ Found draft in localStorage!`, parsed);
        setFormData(parsed);
        return;
      } else {
        console.log(`[ItemFormContext] ❌ No draft found in localStorage, will use server data via AddItemForm.initializeFromItem()`);
      }
    } catch (error) {
      console.error('[ItemFormContext] Error loading from localStorage:', error);
    }
    
    // Try sessionStorage backup (for tab switch scenarios)
    try {
      const backup = sessionStorage.getItem('rarebit_form_data_backup');
      if (backup) {
        const parsed = JSON.parse(backup);
        console.log(`[ItemFormContext] ✅ Found in sessionStorage backup!`, parsed);
        setFormData(parsed);
        return;
      } else {
        console.log(`[ItemFormContext] ❌ Not found in sessionStorage backup`);
      }
    } catch (error) {
      console.error('[ItemFormContext] Error loading from sessionStorage:', error);
    }
    
    // CRITICAL FIX: Do NOT reset to defaults here!
    // If no saved data exists, AddItemForm.initializeFromItem will handle population.
    // Resetting here causes a race condition that overwrites server data.
    console.log(`[ItemFormContext] No saved data found. Letting AddItemForm.initializeFromItem set the data.`);
  }, [itemId]);

  // Reset form to defaults when itemId becomes null/undefined (form closing)
  useEffect(() => {
    if (!itemId) {
      console.log('[ItemFormContext] itemId is null/undefined, resetting form to defaults');
      setFormData(getDefaultFormData());
    }
  }, [itemId]);



  // Listen for visibility changes (browser tab switch)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log(`[ItemFormContext] Tab became visible, checking for saved data for itemId ${itemId}`);
        
        if (!itemId) return;
        
        // Try to restore form data from storage
        try {
          const savedData = localStorage.getItem(`${STORAGE_KEY}_${itemId}`);
          if (savedData) {
            const parsed = JSON.parse(savedData);
            console.log(`[ItemFormContext] Restored from localStorage after tab switch:`, parsed);
            setFormData(parsed);
            return;
          }
        } catch (error) {
          console.error('[ItemFormContext] Error loading from localStorage:', error);
        }
        
        // Try sessionStorage backup
        try {
          const backup = sessionStorage.getItem('rarebit_form_data_backup');
          if (backup) {
            const parsed = JSON.parse(backup);
            console.log(`[ItemFormContext] Restored from sessionStorage backup after tab switch:`, parsed);
            setFormData(parsed);
          }
        } catch (error) {
          console.error('[ItemFormContext] Error loading from sessionStorage:', error);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [itemId]);

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

  // Initialize form from item data (server data)
  // IMPORTANT: Keep dependencies minimal to avoid unnecessary re-renders
  // We use the categories and wallets from the closure, but don't depend on them
  // to avoid breaking AddItemForm's useLay outEffect when props change
  const initializeFromItem = useCallback((item) => {
    console.log('[ItemFormContext.initializeFromItem] Called with item:', item?.id, 'image:', item?.image_url);
    
    if (!item) {
      // New item - reset to defaults
      const defaultCategory = categories.length > 0 ? categories[0].name : '';
      console.log('[ItemFormContext.initializeFromItem] Resetting to defaults (new item)');
      setFormData({
        id: undefined,
        name: '',
        category: defaultCategory,
        costPrice: '',
        sellingPrice: '',
        status: 'tersedia',
        dateBought: new Date().toISOString().split('T')[0],
        dateSold: '',
        platforms: [],
        sold_platforms: [],
        image_url: '',
        client_id: '',
        wallet_id: '',
      });
    } else {
      // Editing existing item - load from server
      const defaultCategory = categories.length > 0 ? categories[0].name : '';
      const defaultWalletId = wallets.length > 0 ? wallets[0].id : '';
      
      const newFormData = {
        id: item.id || undefined,
        name: item.name || '',
        category: item.category || defaultCategory,
        costPrice: item.cost_price ? String(parseFloat(item.cost_price).toFixed(2)) : '',
        sellingPrice: item.selling_price ? String(parseFloat(item.selling_price).toFixed(2)) : '',
        status: item.status || 'tersedia',
        dateBought: item.date_bought || new Date().toISOString().split('T')[0],
        dateSold: item.date_sold || '',
        platforms: item.platforms || [],
        sold_platforms: item.sold_platforms || [],
        image_url: item.image_url || '',
        client_id: item.client_id || '',
        wallet_id: (item.status === 'terjual') ? (item.wallet_id || defaultWalletId) : '',
      };
      console.log('[ItemFormContext.initializeFromItem] Setting form data for editing:', newFormData);
      setFormData(newFormData);
    }
    // NOTE: Don't clear localStorage here - let AddItemForm handle persistence
    // The draft will be cleared after successful save via clearDraft()
  }, []);

  // Clear draft (called after successful save or when canceling)
  const clearDraft = useCallback(() => {
    try {
      // Remove localStorage draft (if itemId is available)
      if (itemId) {
        const key = `${STORAGE_KEY}_${itemId}`;
        localStorage.removeItem(key);
        console.log(`[ItemFormContext.clearDraft] Removed localStorage key: ${key}`);
      }
      
      // Also remove sessionStorage backup (doesn't need itemId)
      sessionStorage.removeItem('rarebit_form_data_backup');
      console.log('[ItemFormContext.clearDraft] Removed sessionStorage backup');
    } catch (error) {
      console.error('Failed to clear item form draft:', error);
    }
  }, [itemId]);

  // Reset status and related fields based on status change
  const handleStatusChange = useCallback((newStatus) => {
    updateFormField('status', newStatus);
    
    if (newStatus === 'terjual') {
      // Mark as sold - ensure date is set
      setFormData(prev => ({
        ...prev,
        status: newStatus,
        dateSold: prev.dateSold || new Date().toISOString().split('T')[0],
        wallet_id: prev.wallet_id || (wallets.length > 0 ? wallets[0].id : ''),
      }));
    } else {
      // Mark as NOT sold - clear sales data
      setFormData(prev => ({
        ...prev,
        status: newStatus,
        dateSold: '',
        sellingPrice: '',
        sold_platforms: [],
        client_id: '',
        wallet_id: '',
      }));
    }
  }, [wallets, updateFormField]);

  return (
    <ItemFormContext.Provider
      value={{
        formData,
        updateFormField,
        updateFormData,
        initializeFromItem,
        clearDraft,
        handleStatusChange,
      }}
    >
      {children}
    </ItemFormContext.Provider>
  );
};

export const useItemForm = () => {
  const context = useContext(ItemFormContext);
  if (!context) {
    throw new Error('useItemForm must be used within ItemFormProvider');
  }
  return context;
};
