import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const EditingStateContext = createContext();

const EDITING_ITEM_STORAGE_KEY = 'rarebit_editing_item';
const SHOW_FORM_STORAGE_KEY = 'rarebit_show_form';

export const EditingStateProvider = ({ children }) => {
  const [editingItem, setEditingItem] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const hasLoadedRef = useRef(false);

  // Load from sessionStorage ONCE on mount only
  useEffect(() => {
    if (hasLoadedRef.current) return;
    
    try {
      console.log('[EditingStateContext] Initial load from sessionStorage');
      const savedEditingItem = sessionStorage.getItem(EDITING_ITEM_STORAGE_KEY);
      const savedShowForm = sessionStorage.getItem(SHOW_FORM_STORAGE_KEY);
      
      if (savedEditingItem) {
        setEditingItem(JSON.parse(savedEditingItem));
        console.log('[EditingStateContext] Restored editingItem from storage');
      }
      if (savedShowForm === 'true') {
        setShowAddForm(true);
        console.log('[EditingStateContext] Restored showAddForm=true from storage');
      }
      
      hasLoadedRef.current = true;
    } catch (error) {
      console.error('[EditingStateContext] Failed to load from sessionStorage:', error);
      hasLoadedRef.current = true;
    }
  }, []);

  // Listen for visibility changes (browser tab switch) - CRITICAL FIX
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[EditingStateContext] Tab became visible, reloading from sessionStorage');
        try {
          const savedEditingItem = sessionStorage.getItem(EDITING_ITEM_STORAGE_KEY);
          const savedShowForm = sessionStorage.getItem(SHOW_FORM_STORAGE_KEY);
          
          if (savedEditingItem) {
            setEditingItem(JSON.parse(savedEditingItem));
            console.log('[EditingStateContext] Restored editingItem after tab visibility');
          }
          if (savedShowForm === 'true') {
            setShowAddForm(true);
            console.log('[EditingStateContext] Restored showAddForm after tab visibility');
          }
        } catch (error) {
          console.error('[EditingStateContext] Error restoring on visibility change:', error);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Persist editingItem to sessionStorage whenever it changes
  useEffect(() => {
    try {
      if (editingItem) {
        sessionStorage.setItem(EDITING_ITEM_STORAGE_KEY, JSON.stringify(editingItem));
        console.log('[EditingStateContext] Saved editingItem to sessionStorage:', editingItem.id);
      } else {
        sessionStorage.removeItem(EDITING_ITEM_STORAGE_KEY);
        console.log('[EditingStateContext] Cleared editingItem from sessionStorage');
      }
    } catch (error) {
      console.error('[EditingStateContext] Failed to save editing item:', error);
    }
  }, [editingItem]);

  // Persist showAddForm to sessionStorage whenever it changes
  useEffect(() => {
    try {
      if (showAddForm) {
        sessionStorage.setItem(SHOW_FORM_STORAGE_KEY, 'true');
        console.log('[EditingStateContext] Saved showAddForm=true to sessionStorage');
      } else {
        sessionStorage.removeItem(SHOW_FORM_STORAGE_KEY);
        console.log('[EditingStateContext] Cleared showAddForm from sessionStorage');
      }
    } catch (error) {
      console.error('[EditingStateContext] Failed to save form visibility:', error);
    }
  }, [showAddForm]);

  const updateEditingItem = useCallback((item) => {
    console.log('[EditingStateContext] updateEditingItem called with:', item?.id);
    setEditingItem(item);
  }, []);

  const setFormVisibility = useCallback((visible) => {
    console.log('[EditingStateContext] setFormVisibility called with:', visible);
    setShowAddForm(visible);
  }, []);

  const clearEditingState = useCallback(() => {
    console.log('[EditingStateContext] clearEditingState called');
    setEditingItem(null);
    setShowAddForm(false);
    try {
      sessionStorage.removeItem(EDITING_ITEM_STORAGE_KEY);
      sessionStorage.removeItem(SHOW_FORM_STORAGE_KEY);
    } catch (error) {
      console.error('[EditingStateContext] Failed to clear editing state:', error);
    }
  }, []);

  return (
    <EditingStateContext.Provider
      value={{
        editingItem,
        showAddForm,
        setEditingItem: updateEditingItem,
        setShowAddForm: setFormVisibility,
        clearEditingState,
      }}
    >
      {children}
    </EditingStateContext.Provider>
  );
};

export const useEditingState = () => {
  const context = useContext(EditingStateContext);
  if (!context) {
    throw new Error('useEditingState must be used within EditingStateProvider');
  }
  return context;
};
