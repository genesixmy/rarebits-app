import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const ItemFormContext = createContext();
const LEGACY_STORAGE_KEY_PREFIX = 'rarebit_item_form_draft';

const normalizeItemMedia = (mediaList = []) => {
  const prepared = (Array.isArray(mediaList) ? mediaList : [])
    .map((media, index) => ({
      id: media?.id || `media-${index}-${Date.now()}`,
      url: typeof media?.url === 'string' ? media.url : '',
      position: Number.isInteger(media?.position) ? media.position : index,
      isCover: Boolean(media?.isCover),
      createdAt: media?.createdAt || null,
    }))
    .filter((media) => media.url);

  if (prepared.length === 0) return [];

  prepared.sort((a, b) => {
    const aPos = Number.isInteger(a.position) ? a.position : 0;
    const bPos = Number.isInteger(b.position) ? b.position : 0;
    if (aPos !== bPos) return aPos - bPos;
    return String(a.id).localeCompare(String(b.id));
  });

  let coverFound = false;
  const normalized = prepared.map((media, index) => {
    const isCover = media.isCover && !coverFound;
    if (isCover) coverFound = true;
    return {
      ...media,
      position: index,
      isCover,
    };
  });

  if (!coverFound && normalized.length > 0) {
    normalized[0].isCover = true;
  }

  return normalized;
};

const getDefaultFormData = (categories = []) => ({
  id: undefined,
  name: '',
  category: categories.length > 0 ? categories[0].name : '',
  sku: '',
  description: '',
  rackLocation: '',
  costPrice: '',
  sellingPrice: '',
  status: 'tersedia',
  dateBought: new Date().toISOString().split('T')[0],
  dateSold: '',
  platforms: [],
  sold_platforms: [],
  image_url: '',
  media: [],
  client_id: '',
  wallet_id: '',
  quantity: 1,
  quantityReserved: 0,
  reservations: [],
});

export const ItemFormProvider = ({ children, itemId, categories = [], wallets = [] }) => {
  const [formData, setFormData] = useState(() => getDefaultFormData(categories));
  const lastItemIdRef = useRef(itemId ?? null);

  useEffect(() => {
    const normalizedItemId = itemId ?? null;
    const hasItemContextChanged = lastItemIdRef.current !== normalizedItemId;
    if (!hasItemContextChanged) return;

    lastItemIdRef.current = normalizedItemId;

    if (!normalizedItemId) {
      setFormData(getDefaultFormData(categories));
    }
  }, [itemId, categories]);

  const updateFormField = useCallback((field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const updateFormData = useCallback((newData) => {
    setFormData((prev) => ({
      ...prev,
      ...newData,
    }));
  }, []);

  const initializeFromItem = useCallback((item) => {
    if (!item) {
      setFormData(getDefaultFormData(categories));
      return;
    }

    const defaultCategory = categories.length > 0 ? categories[0].name : '';
    const defaultWalletId = wallets.length > 0 ? wallets[0].id : '';
    const statusValue = item.status || 'tersedia';
    const reservedValue = statusValue === 'reserved' && item.quantity_reserved !== undefined && item.quantity_reserved !== null
      ? (parseInt(item.quantity_reserved, 10) || 0)
      : 0;

    const reservationsFromItem = Array.isArray(item.inventory_reservations) ? item.inventory_reservations : [];
    const mappedReservations = reservationsFromItem.map((reservation) => ({
      id: reservation.id || `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      quantity: parseInt(reservation.quantity_reserved, 10) || 0,
      customerId: reservation.customer_id || '',
      customerName: reservation.customer_name || '',
      note: reservation.note || '',
      createdAt: reservation.created_at || null,
    }));

    const legacyReservation = reservedValue > 0 || item.reserved_customer_id || item.reserved_customer_name || item.reserved_note
      ? [{
          id: `legacy-${item.id || Date.now()}`,
          quantity: reservedValue || 1,
          customerId: item.reserved_customer_id || '',
          customerName: item.reserved_customer_name || '',
          note: item.reserved_note || '',
          createdAt: null,
        }]
      : [];

    const mediaFromRelation = Array.isArray(item.item_media)
      ? item.item_media.map((media, index) => ({
          id: media.id || `media-rel-${index}`,
          url: media.url || '',
          position: Number.isInteger(media.position) ? media.position : index,
          isCover: Boolean(media.is_cover),
          createdAt: media.created_at || null,
        }))
      : [];

    const mediaWithLegacyFallback = mediaFromRelation.length > 0
      ? mediaFromRelation
      : (item.image_url
          ? [{
              id: `media-legacy-${item.id || Date.now()}`,
              url: item.image_url,
              position: 0,
              isCover: true,
              createdAt: null,
            }]
          : []);

    const normalizedMedia = normalizeItemMedia(mediaWithLegacyFallback);
    const coverMedia = normalizedMedia.find((media) => media.isCover) || normalizedMedia[0];

    setFormData({
      id: item.id || undefined,
      name: item.name || '',
      category: item.category || defaultCategory,
      sku: item.sku || '',
      description: item.description || '',
      rackLocation: item.rack_location || '',
      costPrice: item.cost_price ? String(parseFloat(item.cost_price).toFixed(2)) : '',
      sellingPrice: item.selling_price ? String(parseFloat(item.selling_price).toFixed(2)) : '',
      status: statusValue,
      dateBought: item.date_bought || new Date().toISOString().split('T')[0],
      dateSold: item.date_sold || '',
      platforms: item.platforms || [],
      sold_platforms: item.sold_platforms || [],
      image_url: coverMedia?.url || item.image_url || '',
      media: normalizedMedia,
      client_id: item.client_id || '',
      wallet_id: statusValue === 'terjual' ? (item.wallet_id || defaultWalletId) : '',
      quantity: item.quantity || 1,
      quantityReserved: reservedValue,
      reservations: mappedReservations.length > 0 ? mappedReservations : legacyReservation,
    });
  }, [categories, wallets]);

  const clearDraft = useCallback(() => {
    try {
      if (itemId) {
        localStorage.removeItem(`${LEGACY_STORAGE_KEY_PREFIX}_${itemId}`);
      }
      sessionStorage.removeItem('rarebit_form_data_backup');
    } catch (error) {
      console.error('Failed to clear item form draft:', error);
    }
  }, [itemId]);

  const handleStatusChange = useCallback((newStatus) => {
    updateFormField('status', newStatus);

    if (newStatus === 'terjual') {
      setFormData((prev) => ({
        ...prev,
        status: newStatus,
        dateSold: prev.dateSold || new Date().toISOString().split('T')[0],
        wallet_id: prev.wallet_id || (wallets.length > 0 ? wallets[0].id : ''),
        quantity: prev.quantity || 1,
      }));
      return;
    }

    setFormData((prev) => {
      const totalQuantity = prev.quantity || 1;
      const currentReserved = parseInt(prev.quantityReserved, 10);
      const safeReserved = Number.isNaN(currentReserved) ? 0 : currentReserved;
      const nextReserved = newStatus === 'reserved'
        ? Math.min(Math.max(safeReserved || 0, 0), totalQuantity)
        : 0;
      const nextReservations = newStatus === 'reserved'
        ? (Array.isArray(prev.reservations) ? prev.reservations : [])
        : [];

      return {
        ...prev,
        status: newStatus,
        dateSold: '',
        sellingPrice: '',
        sold_platforms: [],
        client_id: '',
        wallet_id: '',
        quantity: totalQuantity,
        quantityReserved: nextReserved,
        reservations: nextReservations,
      };
    });
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
