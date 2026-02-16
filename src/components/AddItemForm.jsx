
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { X, Save, Loader2, Image as ImageIcon, Trash2, Plus, Edit, User, MessageSquare, Star, GripVertical, ArrowUp, ArrowDown, Package2, BadgeDollarSign, ClipboardList, Copy, Download, FileText, ExternalLink } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext.jsx';
import { supabase } from '@/lib/customSupabaseClient';
import ClientFormModal from '@/components/clients/ClientFormModal';
import { useItemForm } from '@/contexts/ItemFormContext';
import imageCompression from 'browser-image-compression';

const MAX_MEDIA_IMAGES = 10;
const MEDIA_LIBRARY_PAGE_SIZE = 30;
const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const DRAFT_SCHEMA_VERSION = 1;
const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const DRAFT_AUTOSAVE_DELAY_MS = 800;

const formatBytes = (bytes = 0) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
};

const extractFileNameFromPath = (storagePath = '') => {
  if (!storagePath) return '';
  const parts = storagePath.split('/');
  return parts[parts.length - 1] || storagePath;
};

const normalizeMediaEntries = (mediaList = []) => {
  const normalized = (Array.isArray(mediaList) ? mediaList : [])
    .map((media, index) => ({
      id: media?.id || `media-${index}-${Date.now()}`,
      url: typeof media?.url === 'string' ? media.url : '',
      isCover: Boolean(media?.isCover),
      position: Number.isInteger(media?.position) ? media.position : index,
      createdAt: media?.createdAt || null,
    }))
    .filter((media) => media.url);

  if (normalized.length === 0) return [];

  normalized.sort((a, b) => {
    const aPosition = Number.isInteger(a.position) ? a.position : 0;
    const bPosition = Number.isInteger(b.position) ? b.position : 0;
    if (aPosition !== bPosition) return aPosition - bPosition;
    return String(a.id).localeCompare(String(b.id));
  });

  let hasCover = false;
  const withSingleCover = normalized.map((media, index) => {
    const isCover = media.isCover && !hasCover;
    if (isCover) hasCover = true;
    return {
      ...media,
      position: index,
      isCover,
    };
  });

  if (!hasCover && withSingleCover.length > 0) {
    withSingleCover[0].isCover = true;
  }

  return withSingleCover;
};

const extractItemImageStoragePath = (publicUrl) => {
  if (!publicUrl || typeof publicUrl !== 'string') return null;
  const marker = '/item_images/';
  const index = publicUrl.indexOf(marker);
  if (index < 0) return null;
  return publicUrl.slice(index + marker.length);
};

const buildDraftStorageKey = (userId, itemId) => {
  if (!userId) return null;
  if (itemId) return `rarebits:itemDraft:edit:${userId}:${itemId}`;
  return `rarebits:itemDraft:new:${userId}`;
};

const isDraftFresh = (updatedAtMs) => {
  if (!Number.isFinite(updatedAtMs)) return false;
  return Date.now() - updatedAtMs <= DRAFT_MAX_AGE_MS;
};

const normalizeTagName = (value) => (typeof value === 'string' ? value.trim() : '');

const buildSafeFileSlug = (value, fallback = 'rarebits-item') => {
  const normalized = (value || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return normalized || fallback;
};

const AddItemForm = ({ item, onSave, onCancel, categories, clients, wallets, onClientAdded, isSaving }) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { formData, updateFormField, updateFormData, initializeFromItem, handleStatusChange, clearDraft } = useItemForm();
  const [uploading, setUploading] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [isEditingReservations, setIsEditingReservations] = useState(false);
  const [draftReservations, setDraftReservations] = useState([]);
  const [draggingMediaId, setDraggingMediaId] = useState(null);
  const [mediaActionMode, setMediaActionMode] = useState('library');
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [libraryItems, setLibraryItems] = useState([]);
  const [libraryPage, setLibraryPage] = useState(0);
  const [libraryHasMore, setLibraryHasMore] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryUploading, setLibraryUploading] = useState(false);
  const [libraryDeletingId, setLibraryDeletingId] = useState(null);
  const [librarySearchTerm, setLibrarySearchTerm] = useState('');
  const [selectedLibraryUrls, setSelectedLibraryUrls] = useState([]);
  const [hasSubmitAttempted, setHasSubmitAttempted] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState([]);
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [showListingNoteModal, setShowListingNoteModal] = useState(false);
  const [showDownloadImagesModal, setShowDownloadImagesModal] = useState(false);
  const [selectedDownloadImageIds, setSelectedDownloadImageIds] = useState([]);
  const [isDownloadingImages, setIsDownloadingImages] = useState(false);
  const [downloadImagesWarning, setDownloadImagesWarning] = useState('');
  const [draftPrompt, setDraftPrompt] = useState(null);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState(null);
  const lastInitializedItemIdRef = useRef(null);
  const autosaveTimeoutRef = useRef(null);
  const baselineSnapshotRef = useRef(null);
  const galleryInputRef = useRef(null);
  const libraryCameraInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const hydratedTagItemIdRef = useRef(null);
  const initializeFromItemRef = useRef(initializeFromItem);

  const { data: userTags = [], isLoading: isTagsLoading } = useQuery({
    queryKey: ['user-tags', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data: rpcTags, error: rpcError } = await supabase.rpc('get_user_tags');
      if (!rpcError) {
        return Array.isArray(rpcTags) ? rpcTags : [];
      }

      const isMissingRpc = rpcError.code === 'PGRST202' || rpcError.code === '42883';
      if (!isMissingRpc) throw rpcError;

      const { data: fallbackTags, error: fallbackError } = await supabase
        .from('tags')
        .select('id, name, color, created_at, updated_at')
        .eq('user_id', user.id)
        .order('name', { ascending: true });

      if (fallbackError) throw fallbackError;
      return fallbackTags || [];
    },
    enabled: !!user?.id,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const { data: currentItemTagIds = [], isLoading: isItemTagsLoading } = useQuery({
    queryKey: ['item-tags', user?.id, item?.id],
    queryFn: async () => {
      if (!user?.id || !item?.id) return [];
      const { data, error } = await supabase
        .from('item_tags')
        .select('tag_id')
        .eq('item_id', item.id);

      if (error) throw error;

      return (data || []).map((row) => row.tag_id).filter(Boolean);
    },
    enabled: !!user?.id && !!item?.id,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!item?.id) {
      hydratedTagItemIdRef.current = null;
      setSelectedTagIds([]);
      return;
    }

    if (hydratedTagItemIdRef.current !== item.id) {
      setSelectedTagIds([]);
    }
  }, [item?.id]);

  useEffect(() => {
    if (!item?.id || isItemTagsLoading) return;
    if (hydratedTagItemIdRef.current === item.id) return;

    const nextSelectedTagIds = Array.from(new Set((currentItemTagIds || []).filter(Boolean)));
    setSelectedTagIds(nextSelectedTagIds);
    hydratedTagItemIdRef.current = item.id;
  }, [item?.id, isItemTagsLoading, currentItemTagIds]);

  useEffect(() => {
    initializeFromItemRef.current = initializeFromItem;
  }, [initializeFromItem]);

  const isMobileDevice = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  }, []);

  const isIosSafari = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const isIos = /iPad|iPhone|iPod/.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIos) return false;
    return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser/i.test(ua);
  }, []);

  // Initialize form when item prop changes (opening edit modal)
  // ALWAYS initialize from server data first - this ensures details load immediately
  // ItemFormContext will override with draft data if it exists
  useLayoutEffect(() => {
    if (!item) {
      console.log('[AddItemForm] New item, initializing from null');
      initializeFromItemRef.current(null);
      lastInitializedItemIdRef.current = null;
      return;
    }
    
    // Only initialize once per item ID
    if (lastInitializedItemIdRef.current !== item.id) {
      console.log('[AddItemForm] First time opening item:', item.id, '- initializing from server');
      initializeFromItemRef.current(item);
      lastInitializedItemIdRef.current = item.id;
    } else {
      console.log('[AddItemForm] Already initialized this item:', item.id);
    }
  }, [item?.id]);

  useEffect(() => {
    setIsEditingReservations(false);
    setDraftReservations([]);
    setHasSubmitAttempted(false);
  }, [formData.id]);

  // Ensure category is set for new items once categories are available
  useEffect(() => {
    if (!formData.id && (!formData.category || formData.category === '') && categories && categories.length > 0) {
      updateFormField('category', categories[0].name);
    }
  }, [formData.id, formData.category, categories, updateFormField]);

  const mediaFromForm = Array.isArray(formData.media) ? formData.media : [];
  const mediaFromItem = Array.isArray(item?.item_media)
    ? item.item_media.map((media, index) => ({
        id: media.id || `media-item-${index}`,
        url: media.url || '',
        isCover: Boolean(media.is_cover),
        position: Number.isInteger(media.position) ? media.position : index,
      }))
    : [];
  const mediaWithFallback = mediaFromForm.length > 0
    ? mediaFromForm
    : (mediaFromItem.length > 0
        ? mediaFromItem
        : ((formData.image_url || item?.image_url)
            ? [{
                id: `media-fallback-${formData.id || item?.id || 'new'}`,
                url: formData.image_url || item?.image_url,
                isCover: true,
                position: 0,
              }]
            : []));
  const mediaItems = normalizeMediaEntries(mediaWithFallback);
  const activeDraftKey = useMemo(
    () => buildDraftStorageKey(user?.id, item?.id),
    [user?.id, item?.id]
  );
  const serverUpdatedAtMs = useMemo(() => {
    if (!item?.updated_at) return null;
    const parsed = new Date(item.updated_at).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }, [item?.updated_at]);
  const autosaveLabel = useMemo(() => {
    if (!lastDraftSavedAt) return null;
    return new Date(lastDraftSavedAt).toLocaleTimeString('ms-MY', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [lastDraftSavedAt]);

  const buildDraftFormSnapshot = useCallback((sourceData) => {
    const normalizedMedia = normalizeMediaEntries(sourceData?.media?.length ? sourceData.media : mediaItems)
      .map((media, index) => ({
        id: media.id || `media-${index}`,
        url: media.url,
        position: Number.isInteger(media.position) ? media.position : index,
        isCover: Boolean(media.isCover),
      }));
    const coverUrl = normalizedMedia.find((media) => media.isCover)?.url || sourceData?.image_url || '';
    const normalizedReservations = Array.isArray(sourceData?.reservations)
      ? sourceData.reservations.map((reservation, index) => ({
          id: reservation?.id || `draft-res-${index}`,
          quantity: parseInt(reservation?.quantity, 10) || 0,
          customerId: reservation?.customerId || '',
          customerName: reservation?.customerName || '',
          note: reservation?.note || '',
          createdAt: reservation?.createdAt || null,
        }))
      : [];

    return {
      ...sourceData,
      media: normalizedMedia,
      image_url: coverUrl,
      reservations: normalizedReservations,
    };
  }, [mediaItems]);

  const clearCurrentDraft = useCallback(() => {
    if (!activeDraftKey) return;
    localStorage.removeItem(activeDraftKey);
    setDraftPrompt(null);
    setLastDraftSavedAt(null);
  }, [activeDraftKey]);

  useEffect(() => {
    if (!activeDraftKey) return;

    setDraftPrompt(null);
    setLastDraftSavedAt(null);
    baselineSnapshotRef.current = null;

    let parsedDraft = null;
    try {
      const rawDraft = localStorage.getItem(activeDraftKey);
      if (!rawDraft) return;
      parsedDraft = JSON.parse(rawDraft);
    } catch (error) {
      console.error('[AddItemForm] Draft parse failed, removing draft:', error);
      localStorage.removeItem(activeDraftKey);
      return;
    }

    if (!parsedDraft || typeof parsedDraft !== 'object') return;
    if (!isDraftFresh(parsedDraft.updated_at)) {
      localStorage.removeItem(activeDraftKey);
      return;
    }
    if (item?.id && parsedDraft.item_id !== item.id) {
      localStorage.removeItem(activeDraftKey);
      return;
    }
    if (item?.id && serverUpdatedAtMs && parsedDraft.updated_at <= serverUpdatedAtMs) {
      return;
    }
    if (!parsedDraft.form_data || typeof parsedDraft.form_data !== 'object') {
      localStorage.removeItem(activeDraftKey);
      return;
    }

    setDraftPrompt({
      key: activeDraftKey,
      mode: item?.id ? 'edit' : 'new',
      payload: parsedDraft,
    });
    setLastDraftSavedAt(parsedDraft.updated_at);
  }, [activeDraftKey, item?.id, serverUpdatedAtMs]);

  useEffect(() => {
    if (!activeDraftKey) return;
    if (item?.id && formData.id !== item.id) return;
    if (baselineSnapshotRef.current !== null) return;

    baselineSnapshotRef.current = JSON.stringify(buildDraftFormSnapshot(formData));
  }, [activeDraftKey, item?.id, formData, buildDraftFormSnapshot]);

  const persistDraftNow = useCallback(() => {
    if (!activeDraftKey) return;
    if (draftPrompt) return;
    if (item?.id && formData.id !== item.id) return;

    const snapshot = buildDraftFormSnapshot(formData);
    const serializedSnapshot = JSON.stringify(snapshot);
    if (baselineSnapshotRef.current === null) {
      baselineSnapshotRef.current = serializedSnapshot;
      return;
    }
    if (serializedSnapshot === baselineSnapshotRef.current) return;

    const payload = {
      schema_version: DRAFT_SCHEMA_VERSION,
      updated_at: Date.now(),
      item_id: item?.id || null,
      form_data: snapshot,
    };
    localStorage.setItem(activeDraftKey, JSON.stringify(payload));
    setLastDraftSavedAt(payload.updated_at);
  }, [activeDraftKey, draftPrompt, item?.id, formData, buildDraftFormSnapshot]);

  useEffect(() => {
    if (!activeDraftKey) return;
    if (draftPrompt) return;
    if (item?.id && formData.id !== item.id) return;

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }
    autosaveTimeoutRef.current = setTimeout(() => {
      persistDraftNow();
    }, DRAFT_AUTOSAVE_DELAY_MS);

    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }
    };
  }, [activeDraftKey, draftPrompt, item?.id, formData, persistDraftNow]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      persistDraftNow();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [persistDraftNow]);

  const handleRestoreDraft = useCallback(() => {
    if (!draftPrompt?.payload?.form_data) return;
    const restoredData = buildDraftFormSnapshot(draftPrompt.payload.form_data);
    updateFormData(restoredData);
    baselineSnapshotRef.current = JSON.stringify(restoredData);
    setDraftPrompt(null);
    setLastDraftSavedAt(draftPrompt.payload.updated_at || Date.now());
    toast({
      title: 'Draf dipulihkan',
      description: 'Perubahan anda berjaya dipulihkan.',
    });
  }, [draftPrompt, buildDraftFormSnapshot, updateFormData, toast]);

  const handleIgnoreDraft = useCallback(() => {
    setDraftPrompt(null);
  }, []);

  const handleDiscardDraft = useCallback(() => {
    clearCurrentDraft();
    toast({
      title: 'Draf dibuang',
      description: 'Draf tempatan telah dipadam.',
    });
  }, [clearCurrentDraft, toast]);

  const normalizedLibrarySearch = librarySearchTerm.trim().toLowerCase();
  const filteredLibraryItems = useMemo(() => {
    if (!normalizedLibrarySearch) return libraryItems;
    return libraryItems.filter((libraryItem) => {
      const filename = (libraryItem.original_filename || '').toLowerCase();
      const storagePath = (libraryItem.storage_path || '').toLowerCase();
      return filename.includes(normalizedLibrarySearch) || storagePath.includes(normalizedLibrarySearch);
    });
  }, [libraryItems, normalizedLibrarySearch]);

  useEffect(() => {
    if (!isMobileDevice && mediaActionMode === 'camera') {
      setMediaActionMode('library');
    }
  }, [isMobileDevice, mediaActionMode]);

  useEffect(() => {
    const hasMediaArray = Array.isArray(formData.media) && formData.media.length > 0;
    if (hasMediaArray) return;
    if (mediaItems.length === 0) return;

    updateFormData({
      media: mediaItems,
      image_url: formData.image_url || mediaItems[0]?.url || '',
    });
  }, [formData.media, formData.image_url, mediaItems, updateFormData]);


  const platformOptions = [
    'Carousell', 'Shopee', 'TikTok Shop', 'Lazada', 
    'Facebook Marketplace', 'Instagram', 'Mudah.my'
  ];

  const handlePlatformChange = (platform, checked) => {
    updateFormField('platforms', checked 
      ? [...formData.platforms, platform]
      : formData.platforms.filter(p => p !== platform)
    );
  };

  const handleSoldPlatformChange = (platform, checked) => {
    updateFormField('sold_platforms', checked 
      ? [...formData.sold_platforms, platform]
      : formData.sold_platforms.filter(p => p !== platform)
    );
  };

  const normalizedUserTags = useMemo(() => {
    if (!Array.isArray(userTags)) return [];
    return userTags
      .filter((tag) => tag?.id && normalizeTagName(tag?.name))
      .map((tag) => ({
        ...tag,
        name: normalizeTagName(tag.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [userTags]);

  const normalizedTagSearch = normalizeTagName(tagSearch);
  const normalizedTagSearchLower = normalizedTagSearch.toLowerCase();
  const selectedTagIdSet = useMemo(() => new Set(selectedTagIds), [selectedTagIds]);

  const filteredTagOptions = useMemo(() => {
    if (!normalizedTagSearchLower) return normalizedUserTags;
    return normalizedUserTags.filter((tag) => tag.name.toLowerCase().includes(normalizedTagSearchLower));
  }, [normalizedUserTags, normalizedTagSearchLower]);

  const selectedTagPills = useMemo(() => {
    if (selectedTagIds.length === 0) return [];
    const tagLookup = new Map(normalizedUserTags.map((tag) => [tag.id, tag]));
    return selectedTagIds
      .map((tagId) => tagLookup.get(tagId))
      .filter(Boolean);
  }, [selectedTagIds, normalizedUserTags]);

  const hasExactTagMatch = useMemo(() => {
    if (!normalizedTagSearchLower) return false;
    return normalizedUserTags.some((tag) => tag.name.toLowerCase() === normalizedTagSearchLower);
  }, [normalizedUserTags, normalizedTagSearchLower]);

  const shouldShowCreateTagAction = Boolean(normalizedTagSearch) && !hasExactTagMatch;

  const toggleTagSelection = useCallback((tagId, forcedState) => {
    if (!tagId) return;
    setSelectedTagIds((prev) => {
      const hasTag = prev.includes(tagId);
      const shouldSelect = typeof forcedState === 'boolean' ? forcedState : !hasTag;

      if (shouldSelect && !hasTag) {
        return [...prev, tagId];
      }

      if (!shouldSelect && hasTag) {
        return prev.filter((id) => id !== tagId);
      }

      return prev;
    });
  }, []);

  const handleCreateTagFromSearch = useCallback(async () => {
    const newTagName = normalizeTagName(tagSearch);
    if (!newTagName || !user?.id || isCreatingTag) return;

    const existingTag = normalizedUserTags.find(
      (tag) => tag.name.toLowerCase() === newTagName.toLowerCase()
    );
    if (existingTag?.id) {
      toggleTagSelection(existingTag.id, true);
      setTagSearch('');
      return;
    }

    setIsCreatingTag(true);
    try {
      const { data: createdTag, error: createTagError } = await supabase
        .from('tags')
        .insert({
          user_id: user.id,
          name: newTagName,
        })
        .select('id, name, color, created_at, updated_at')
        .single();

      if (createTagError) {
        if (createTagError.code === '23505') {
          const { data: duplicateMatch, error: duplicateError } = await supabase
            .from('tags')
            .select('id, name, color, created_at, updated_at')
            .eq('user_id', user.id)
            .ilike('name', newTagName)
            .limit(1);

          if (duplicateError) throw duplicateError;

          const existingDuplicateTag = duplicateMatch?.[0];
          if (existingDuplicateTag?.id) {
            queryClient.setQueryData(['user-tags', user.id], (prev = []) => {
              const alreadyExists = prev.some((tag) => tag.id === existingDuplicateTag.id);
              if (alreadyExists) return prev;
              return [...prev, existingDuplicateTag]
                .sort((a, b) => normalizeTagName(a.name).localeCompare(normalizeTagName(b.name), undefined, { sensitivity: 'base' }));
            });
            toggleTagSelection(existingDuplicateTag.id, true);
            setTagSearch('');
            return;
          }
        }

        throw createTagError;
      }

      queryClient.setQueryData(['user-tags', user.id], (prev = []) => {
        const alreadyExists = prev.some((tag) => tag.id === createdTag.id);
        if (alreadyExists) return prev;
        return [...prev, createdTag]
          .sort((a, b) => normalizeTagName(a.name).localeCompare(normalizeTagName(b.name), undefined, { sensitivity: 'base' }));
      });

      toggleTagSelection(createdTag.id, true);
      setTagSearch('');
      toast({
        title: 'Tag ditambah',
        description: `"${createdTag.name}" berjaya ditambah.`,
      });
    } catch (error) {
      toast({
        title: 'Gagal tambah tag',
        description: error.message || 'Tidak dapat mencipta tag baharu.',
        variant: 'destructive',
      });
    } finally {
      setIsCreatingTag(false);
    }
  }, [
    tagSearch,
    user?.id,
    isCreatingTag,
    normalizedUserTags,
    queryClient,
    toggleTagSelection,
    toast,
  ]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setHasSubmitAttempted(true);
    if (!formData.name.trim() || !formData.costPrice) {
      toast({ title: "Ralat Pengesahan", description: "Sila isi semua medan yang bertanda *.", variant: "destructive" });
      return;
    }

    if (!formData.category || formData.category === '') {
      toast({ title: "Ralat Pengesahan", description: "Sila pilih kategori.", variant: "destructive" });
      return;
    }
    
    if (isReserved) {
      if (isEditingReservations) {
        toast({ title: "Ralat Pengesahan", description: "Sila simpan atau batal perubahan reservation terlebih dahulu.", variant: "destructive" });
        return;
      }

      const hasInvalidReservation = reservations.some((reservation) => (parseInt(reservation.quantity, 10) || 0) <= 0);

      if (reservations.length === 0) {
        toast({ title: "Ralat Pengesahan", description: "Sila tambah sekurang-kurangnya satu reservation.", variant: "destructive" });
        return;
      }
      if (hasInvalidReservation) {
        toast({ title: "Ralat Pengesahan", description: "Kuantiti reservation mesti lebih daripada 0.", variant: "destructive" });
        return;
      }
      if (totalReservedQuantity > totalQuantity) {
        toast({ title: "Ralat Pengesahan", description: "Jumlah reservation tidak boleh melebihi jumlah stok.", variant: "destructive" });
        return;
      }
    }

    // Strict validation for sold items
    if (formData.status === 'terjual') {
        if (!formData.sellingPrice || !formData.dateSold || !formData.wallet_id) {
            toast({ title: "Ralat Pengesahan Jualan", description: "Untuk item terjual, sila isi Harga Jual, Tarikh Jual, dan pilih Akaun Wallet.", variant: "destructive" });
            return;
        }
    }

    if (item?.id && hydratedTagItemIdRef.current !== item.id) {
      toast({
        title: 'Tag masih dimuatkan',
        description: 'Sila cuba simpan semula selepas tag item selesai dimuatkan.',
        variant: 'destructive',
      });
      return;
    }

    const mediaForSubmit = normalizeMediaEntries(mediaItems).slice(0, MAX_MEDIA_IMAGES);
    const submitCover = mediaForSubmit.find((media) => media.isCover) || mediaForSubmit[0] || null;
    const normalizedSelectedTagIds = Array.from(new Set(selectedTagIds.filter(Boolean)));

    try {
      await onSave({
        ...formData,
        media: mediaForSubmit,
        image_url: submitCover?.url || '',
        tag_ids: normalizedSelectedTagIds,
      });
      clearCurrentDraft();
      clearDraft();
    } catch (error) {
      console.error('[AddItemForm] Save failed, draft retained:', error);
    }
  };

  const resetMediaInputs = () => {
    if (galleryInputRef.current) {
      galleryInputRef.current.value = '';
    }
    if (libraryCameraInputRef.current) {
      libraryCameraInputRef.current.value = '';
    }
    if (cameraInputRef.current) {
      cameraInputRef.current.value = '';
    }
  };

  const upsertLibraryStateRecord = useCallback((record) => {
    if (!record?.url || !record?.storage_path) return;
    setLibraryItems((prev) => {
      const index = prev.findIndex(
        (entry) => entry.id === record.id || entry.storage_path === record.storage_path
      );
      if (index < 0) {
        return [record, ...prev];
      }
      const next = [...prev];
      next[index] = {
        ...next[index],
        ...record,
      };
      return next;
    });
  }, []);

  const saveMediaToLibrary = useCallback(
    async ({ publicUrl, storagePath, originalFilename, mimeType, sizeBytes }) => {
      if (!user || !publicUrl || !storagePath) return null;

      const payload = {
        user_id: user.id,
        storage_path: storagePath,
        url: publicUrl,
        original_filename: originalFilename || extractFileNameFromPath(storagePath),
        mime_type: mimeType || null,
        size_bytes: Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : null,
      };

      const { data, error } = await supabase
        .from('media_library')
        .upsert(payload, { onConflict: 'storage_path' })
        .select('id, storage_path, url, original_filename, mime_type, size_bytes, created_at')
        .single();

      if (error) {
        console.warn('[AddItemForm] Failed to upsert media_library:', error.message);
        return null;
      }

      if (data) {
        upsertLibraryStateRecord(data);
      }

      return data || null;
    },
    [user, upsertLibraryStateRecord]
  );

  const fetchLibraryPage = useCallback(
    async ({ page = 0, replace = false } = {}) => {
      if (!user) return;

      setLibraryLoading(true);
      const from = page * MEDIA_LIBRARY_PAGE_SIZE;
      const to = from + MEDIA_LIBRARY_PAGE_SIZE - 1;

      try {
        const { data, error } = await supabase
          .from('media_library')
          .select('id, storage_path, url, original_filename, mime_type, size_bytes, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .range(from, to);

        if (error) throw error;

        const rows = (data || []).filter((entry) => entry?.url && entry?.storage_path);
        setLibraryHasMore(rows.length === MEDIA_LIBRARY_PAGE_SIZE);
        setLibraryPage(page);
        setLibraryItems((prev) => {
          if (replace) return rows;
          const existingIds = new Set(prev.map((entry) => entry.id));
          const merged = [...prev];
          rows.forEach((row) => {
            if (!existingIds.has(row.id)) {
              merged.push(row);
            }
          });
          return merged;
        });
      } catch (error) {
        toast({
          title: 'Gagal memuat Media Library',
          description: error.message,
          variant: 'destructive',
        });
      } finally {
        setLibraryLoading(false);
      }
    },
    [user, toast]
  );

  const openMediaLibrary = () => {
    setShowLibraryModal(true);
    setSelectedLibraryUrls([]);
    setLibrarySearchTerm('');
    fetchLibraryPage({ page: 0, replace: true });
  };

  const loadMoreLibrary = () => {
    if (libraryLoading || !libraryHasMore) return;
    fetchLibraryPage({ page: libraryPage + 1, replace: false });
  };

  const toggleLibrarySelection = (imageUrl) => {
    if (!imageUrl) return;
    setSelectedLibraryUrls((prev) =>
      prev.includes(imageUrl) ? prev.filter((url) => url !== imageUrl) : [...prev, imageUrl]
    );
  };

  const handleAddSelectedLibraryImages = () => {
    if (selectedLibraryUrls.length === 0) {
      toast({
        title: 'Tiada gambar dipilih',
        description: 'Sila pilih sekurang-kurangnya satu gambar dari library.',
        variant: 'destructive',
      });
      return;
    }

    const availableSlots = MAX_MEDIA_IMAGES - mediaItems.length;
    if (availableSlots <= 0) {
      toast({
        title: 'Had gambar dicapai',
        description: `Maksimum ${MAX_MEDIA_IMAGES} gambar untuk satu item.`,
        variant: 'destructive',
      });
      return;
    }

    const existingUrls = new Set(mediaItems.map((media) => media.url));
    const selectedItems = libraryItems.filter((libraryItem) =>
      selectedLibraryUrls.includes(libraryItem.url)
    );
    const uniqueSelectedItems = selectedItems.filter((libraryItem) => !existingUrls.has(libraryItem.url));

    if (uniqueSelectedItems.length === 0) {
      toast({
        title: 'Gambar sudah ada',
        description: 'Semua gambar dipilih telah ada pada item ini.',
      });
      return;
    }

    const itemsToAppend = uniqueSelectedItems.slice(0, availableSlots).map((libraryItem, index) => ({
      id: `media-library-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      url: libraryItem.url,
      isCover: false,
      position: mediaItems.length + index,
    }));

    applyMediaList([...mediaItems, ...itemsToAppend]);

    if (uniqueSelectedItems.length > availableSlots) {
      toast({
        title: 'Sebahagian gambar ditambah',
        description: `${availableSlots} gambar ditambah kerana had maksimum.`,
      });
    } else {
      toast({
        title: 'Gambar dari library ditambah',
        description: `${itemsToAppend.length} gambar ditambah ke item.`,
      });
    }

    setSelectedLibraryUrls([]);
    setShowLibraryModal(false);
  };

  const handleDeleteLibraryImage = async (libraryItem) => {
    if (!libraryItem?.id || !libraryItem?.url) return;

    const confirmDelete = window.confirm('Padam gambar ini dari Media Library?');
    if (!confirmDelete) return;

    setLibraryDeletingId(libraryItem.id);
    try {
      const usedInCurrentForm = mediaItems.some((media) => media.url === libraryItem.url);
      if (usedInCurrentForm) {
        toast({
          title: 'Tidak boleh dipadam',
          description: 'Gambar ini sedang digunakan oleh item semasa. Buang dari item dahulu.',
          variant: 'destructive',
        });
        return;
      }

      const { count, error: usageError } = await supabase
        .from('item_media')
        .select('item_id', { count: 'exact', head: true })
        .eq('url', libraryItem.url);

      if (usageError) throw usageError;

      if ((count || 0) > 0) {
        toast({
          title: 'Tidak boleh dipadam',
          description: `Gambar ini sedang digunakan oleh ${count} item. Buang dari item dahulu.`,
          variant: 'destructive',
        });
        return;
      }

      const storagePath = libraryItem.storage_path || extractItemImageStoragePath(libraryItem.url);
      if (storagePath) {
        const { error: storageError } = await supabase.storage.from('item_images').remove([storagePath]);
        if (storageError && !/not found/i.test(storageError.message || '')) {
          throw storageError;
        }
      }

      const { error: deleteError } = await supabase
        .from('media_library')
        .delete()
        .eq('id', libraryItem.id)
        .eq('user_id', user.id);

      if (deleteError) throw deleteError;

      setLibraryItems((prev) => prev.filter((entry) => entry.id !== libraryItem.id));
      setSelectedLibraryUrls((prev) => prev.filter((url) => url !== libraryItem.url));
      toast({ title: 'Gambar dipadam dari Media Library' });
    } catch (error) {
      toast({
        title: 'Gagal memadam gambar library',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLibraryDeletingId(null);
    }
  };

  const applyMediaList = (nextMediaList) => {
    const reindexed = (Array.isArray(nextMediaList) ? nextMediaList : []).map((media, index) => ({
      ...media,
      position: index,
    }));
    const normalized = normalizeMediaEntries(reindexed).slice(0, MAX_MEDIA_IMAGES);
    const nextCover = normalized.find((media) => media.isCover) || normalized[0] || null;
    updateFormData({
      media: normalized,
      image_url: nextCover?.url || '',
    });
  };

  const uploadAndIndexFiles = async (filesToUpload = []) => {
    const uploadedMedia = [];
    const uploadedLibraryRecords = [];
    let failedUploads = 0;
    let totalOriginalBytes = 0;
    let totalCompressedBytes = 0;

    for (const file of filesToUpload) {
      try {
        totalOriginalBytes += file.size || 0;
        const options = {
          maxSizeMB: 0.5,
          maxWidthOrHeight: 1024,
          useWebWorker: true,
          quality: 0.8,
        };
        const compressedFile = await imageCompression(file, options);
        totalCompressedBytes += compressedFile?.size || file.size || 0;
        const fileExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const filePath = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('item_images')
          .upload(filePath, compressedFile);
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('item_images')
          .getPublicUrl(filePath);

        const libraryRecord = await saveMediaToLibrary({
          publicUrl: urlData.publicUrl,
          storagePath: filePath,
          originalFilename: file.name,
          mimeType: compressedFile.type || file.type,
          sizeBytes: compressedFile.size || file.size,
        });

        uploadedMedia.push({
          id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url: urlData.publicUrl,
          isCover: false,
          position: uploadedMedia.length,
        });

        uploadedLibraryRecords.push(
          libraryRecord || {
            id: `library-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            storage_path: filePath,
            url: urlData.publicUrl,
            original_filename: file.name,
            mime_type: compressedFile.type || file.type,
            size_bytes: compressedFile.size || file.size || null,
            created_at: new Date().toISOString(),
          }
        );
      } catch (error) {
        failedUploads += 1;
        console.error('[AddItemForm] Upload media failed:', error);
      }
    }

    const canShowCompression = totalOriginalBytes > 0 && totalCompressedBytes > 0;
    const compressionSaved = canShowCompression ? Math.max(totalOriginalBytes - totalCompressedBytes, 0) : 0;
    const compressionPct = canShowCompression && totalOriginalBytes > 0
      ? Math.round((compressionSaved / totalOriginalBytes) * 100)
      : 0;
    const compressionSummary = canShowCompression
      ? `Auto compress: ${formatBytes(totalOriginalBytes)} -> ${formatBytes(totalCompressedBytes)}${compressionSaved > 0 ? ` (jimat ${compressionPct}%)` : ''}.`
      : '';

    return {
      uploadedMedia,
      uploadedLibraryRecords,
      failedUploads,
      compressionSummary,
    };
  };

  const handleImageUpload = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (!user || selectedFiles.length === 0) return;

    const invalidFiles = selectedFiles.filter((file) => !ACCEPTED_IMAGE_TYPES.has(file.type));
    const validFiles = selectedFiles.filter((file) => ACCEPTED_IMAGE_TYPES.has(file.type));

    if (invalidFiles.length > 0) {
      toast({
        title: 'Fail tidak disokong',
        description: 'Hanya PNG, JPG, JPEG dan WEBP dibenarkan.',
        variant: 'destructive',
      });
    }

    const remainingSlots = MAX_MEDIA_IMAGES - mediaItems.length;
    if (remainingSlots <= 0) {
      toast({
        title: 'Had gambar dicapai',
        description: `Maksimum ${MAX_MEDIA_IMAGES} gambar untuk satu item.`,
        variant: 'destructive',
      });
      resetMediaInputs();
      return;
    }

    const filesToUpload = validFiles.slice(0, remainingSlots);
    if (validFiles.length > remainingSlots) {
      toast({
        title: 'Sebahagian gambar tidak dimuat naik',
        description: `Hanya ${remainingSlots} gambar lagi boleh ditambah.`,
      });
    }

    if (filesToUpload.length === 0) {
      resetMediaInputs();
      return;
    }

    setUploading(true);
    const { uploadedMedia, failedUploads, compressionSummary } = await uploadAndIndexFiles(filesToUpload);

    if (uploadedMedia.length > 0) {
      const rebased = uploadedMedia.map((media, index) => ({
        ...media,
        position: mediaItems.length + index,
      }));
      applyMediaList([...mediaItems, ...rebased]);
    }

    if (uploadedMedia.length > 0 && failedUploads === 0) {
      toast({
        title: 'Gambar berjaya dimuat naik',
        description: `${uploadedMedia.length} gambar ditambah.${compressionSummary ? ` ${compressionSummary}` : ''}`,
      });
    } else if (uploadedMedia.length > 0 && failedUploads > 0) {
      toast({
        title: 'Sebahagian gambar berjaya dimuat naik',
        description: `${uploadedMedia.length} berjaya, ${failedUploads} gagal.${compressionSummary ? ` ${compressionSummary}` : ''}`,
      });
    } else {
      toast({
        title: 'Gagal memuat naik gambar',
        description: 'Sila cuba semula.',
        variant: 'destructive',
      });
    }

    setUploading(false);
    resetMediaInputs();
  };

  const handleLibraryUpload = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (!user || selectedFiles.length === 0) return;

    const invalidFiles = selectedFiles.filter((file) => !ACCEPTED_IMAGE_TYPES.has(file.type));
    const validFiles = selectedFiles.filter((file) => ACCEPTED_IMAGE_TYPES.has(file.type));

    if (invalidFiles.length > 0) {
      toast({
        title: 'Fail tidak disokong',
        description: 'Hanya PNG, JPG, JPEG dan WEBP dibenarkan.',
        variant: 'destructive',
      });
    }

    if (validFiles.length === 0) {
      resetMediaInputs();
      return;
    }

    setLibraryUploading(true);
    const { uploadedLibraryRecords, failedUploads, compressionSummary } = await uploadAndIndexFiles(validFiles);

    if (uploadedLibraryRecords.length > 0) {
      const uploadedUrls = uploadedLibraryRecords.map((record) => record.url).filter(Boolean);
      setSelectedLibraryUrls((prev) => {
        const merged = new Set([...prev, ...uploadedUrls]);
        return Array.from(merged);
      });
    }

    if (uploadedLibraryRecords.length > 0 && failedUploads === 0) {
      toast({
        title: 'Gambar berjaya dimuat naik ke library',
        description: `${uploadedLibraryRecords.length} gambar tersedia untuk dipilih.${compressionSummary ? ` ${compressionSummary}` : ''}`,
      });
    } else if (uploadedLibraryRecords.length > 0 && failedUploads > 0) {
      toast({
        title: 'Sebahagian gambar berjaya dimuat naik',
        description: `${uploadedLibraryRecords.length} berjaya, ${failedUploads} gagal.${compressionSummary ? ` ${compressionSummary}` : ''}`,
      });
    } else {
      toast({
        title: 'Gagal memuat naik ke library',
        description: 'Sila cuba semula.',
        variant: 'destructive',
      });
    }

    setLibraryUploading(false);
    resetMediaInputs();
  };

  const removeImage = async (mediaId) => {
    const targetMedia = mediaItems.find((media) => media.id === mediaId);
    if (!targetMedia) return;

    setUploading(true);
    try {
      const nextMedia = mediaItems.filter((media) => media.id !== mediaId);
      applyMediaList(nextMedia);
      toast({ title: "Gambar dibuang dari item" });
    } catch (error) {
      toast({ title: "Gagal membuang gambar", description: error.message, variant: "destructive" });
    } finally {
      setUploading(false);
      resetMediaInputs();
    }
  };

  const handleSetCoverImage = (mediaId) => {
    const nextMedia = mediaItems.map((media) => ({
      ...media,
      isCover: media.id === mediaId,
    }));
    applyMediaList(nextMedia);
  };

  const handleDragStart = (event, mediaId) => {
    setDraggingMediaId(mediaId);
    if (event?.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', mediaId);
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    if (event?.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  };

  const moveMediaByOffset = (mediaId, offset) => {
    const sourceIndex = mediaItems.findIndex((media) => media.id === mediaId);
    if (sourceIndex < 0) return;

    const targetIndex = sourceIndex + offset;
    if (targetIndex < 0 || targetIndex >= mediaItems.length) return;

    const reordered = [...mediaItems];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    applyMediaList(reordered);
  };

  const handleDrop = (event, targetMediaId) => {
    event.preventDefault();
    const sourceMediaId = draggingMediaId || event?.dataTransfer?.getData('text/plain');
    if (!sourceMediaId || sourceMediaId === targetMediaId) {
      setDraggingMediaId(null);
      return;
    }

    const sourceIndex = mediaItems.findIndex((media) => media.id === sourceMediaId);
    const targetIndex = mediaItems.findIndex((media) => media.id === targetMediaId);

    if (sourceIndex < 0 || targetIndex < 0) {
      setDraggingMediaId(null);
      return;
    }

    const reordered = [...mediaItems];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    applyMediaList(reordered);
    setDraggingMediaId(null);
  };

  const handleClientChange = (e) => {
    if (e.target.value === 'add_new') {
      setShowClientModal(true);
    } else {
      updateFormField('client_id', e.target.value);
    }
  };

  const handleClientSaved = (newClient) => {
    onClientAdded(newClient);
    updateFormField('client_id', newClient.id);
    setShowClientModal(false);
  };
  
  const isSold = formData.status === 'terjual';
  const isReserved = formData.status === 'reserved';
  const reservations = Array.isArray(formData.reservations) ? formData.reservations : [];
  const totalQuantity = parseInt(formData.quantity, 10) || 0;
  const totalReservedQuantity = reservations.reduce((sum, reservation) => {
    const qty = parseInt(reservation.quantity, 10) || 0;
    return sum + qty;
  }, 0);
  const availableQuantity = Math.max(totalQuantity - totalReservedQuantity, 0);
  const buyerCount = reservations.filter((reservation) => (parseInt(reservation.quantity, 10) || 0) > 0).length;

  const draftTotalReserved = draftReservations.reduce((sum, reservation) => {
    const qty = parseInt(reservation.quantity, 10) || 0;
    return sum + qty;
  }, 0);
  const draftBuyerCount = draftReservations.filter((reservation) => (parseInt(reservation.quantity, 10) || 0) > 0).length;
  const isOverReservedDraft = draftTotalReserved > totalQuantity;
  const summaryReserved = isEditingReservations ? draftTotalReserved : totalReservedQuantity;
  const summaryBuyerCount = isEditingReservations ? draftBuyerCount : buyerCount;
  const summaryAvailable = Math.max(totalQuantity - summaryReserved, 0);
  const summarySku = (formData.sku || '').trim();
  const summaryRackLocation = (formData.rackLocation || '').trim() || '-';
  const listingTitle = (formData.name || '').trim();
  const parsedSellingPrice = Number.parseFloat(formData.sellingPrice);
  const hasSellingPrice = Number.isFinite(parsedSellingPrice) && parsedSellingPrice >= 0;
  const listingPrice = hasSellingPrice ? `RM${parsedSellingPrice.toFixed(2)}` : '';
  const listingDescription = (formData.description || '').trim();
  const listingCategory = (formData.category || '').trim();
  const listingSku = (formData.sku || '').trim();
  const listingRackLocation = (formData.rackLocation || '').trim();
  const listingTags = selectedTagPills
    .map((tag) => normalizeTagName(tag?.name))
    .filter(Boolean)
    .join(', ');
  const listingInfoLines = useMemo(() => {
    const lines = [];
    if (listingCategory) lines.push({ label: 'Kategori', value: listingCategory, exportLabel: 'CATEGORY' });
    if (listingTags) lines.push({ label: 'Tags', value: listingTags, exportLabel: 'TAGS' });
    if (Number.isFinite(summaryAvailable)) lines.push({ label: 'Stok', value: String(summaryAvailable), exportLabel: 'STOCK' });
    if (listingRackLocation) lines.push({ label: 'Rak', value: listingRackLocation, exportLabel: 'RACK' });
    if (listingSku) lines.push({ label: 'SKU', value: listingSku, exportLabel: 'SKU' });
    return lines;
  }, [listingCategory, listingTags, summaryAvailable, listingRackLocation, listingSku]);
  const listingInfoText = useMemo(
    () => listingInfoLines.map((line) => `${line.exportLabel}:\n${line.value}`).join('\n\n'),
    [listingInfoLines]
  );
  const listingNoteText = useMemo(() => {
    const blocks = [];
    if (listingTitle) blocks.push(`TITLE:\n${listingTitle}`);
    if (listingPrice) blocks.push(`PRICE:\n${listingPrice}`);
    if (listingDescription) blocks.push(`DESCRIPTION:\n${listingDescription}`);
    if (listingInfoLines.length > 0) {
      listingInfoLines.forEach((line) => {
        blocks.push(`${line.exportLabel}:\n${line.value}`);
      });
    }
    return blocks.join('\n\n');
  }, [listingTitle, listingPrice, listingDescription, listingInfoLines]);
  const itemPhotoBaseSlug = useMemo(
    () => buildSafeFileSlug(summarySku || listingTitle || 'item-photo', 'item-photo'),
    [summarySku, listingTitle]
  );
  const hasMultipleMediaImages = mediaItems.length > 1;
  const selectedDownloadMediaItems = useMemo(
    () => mediaItems.filter((media) => selectedDownloadImageIds.includes(media.id)),
    [mediaItems, selectedDownloadImageIds]
  );

  useEffect(() => {
    if (!showDownloadImagesModal) return;

    setDownloadImagesWarning('');
    if (hasMultipleMediaImages) {
      setSelectedDownloadImageIds(mediaItems.map((media) => media.id));
      return;
    }

    setSelectedDownloadImageIds(mediaItems[0]?.id ? [mediaItems[0].id] : []);
  }, [showDownloadImagesModal, hasMultipleMediaImages, mediaItems]);

  const copyTextToClipboard = useCallback(async (text) => {
    const safeText = typeof text === 'string' ? text : '';
    if (!safeText.trim()) return false;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(safeText);
        return true;
      }
    } catch (error) {
      console.warn('[AddItemForm] Clipboard API failed, fallback to execCommand:', error);
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = safeText;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (error) {
      console.error('[AddItemForm] Clipboard fallback failed:', error);
      return false;
    }
  }, []);

  const handleCopyListingSection = useCallback(async (content, successTitle = 'Listing disalin') => {
    const copied = await copyTextToClipboard(content);
    if (copied) {
      toast({ title: successTitle });
      return;
    }
    toast({
      title: 'Gagal salin listing',
      description: 'Sila salin manual menggunakan long-press.',
      variant: 'destructive',
    });
  }, [copyTextToClipboard, toast]);

  const handleDownloadListingTxt = useCallback(() => {
    if (!listingNoteText.trim()) {
      toast({
        title: 'Tiada kandungan listing',
        description: 'Isi sekurang-kurangnya satu maklumat untuk muat turun.',
        variant: 'destructive',
      });
      return;
    }

    const safeSlug = buildSafeFileSlug(listingSku || listingTitle || 'listing-note', 'listing-note');

    const blob = new Blob([listingNoteText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `rarebits-${safeSlug}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);

    toast({ title: 'Fail listing dimuat turun' });
  }, [listingNoteText, listingSku, listingTitle, toast]);

  const triggerImageDownload = useCallback((url, filename) => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }, []);

  const getItemPhotoFilename = useCallback((mediaId) => {
    const mediaIndex = mediaItems.findIndex((media) => media.id === mediaId);
    const safeIndex = mediaIndex >= 0 ? mediaIndex + 1 : 1;
    const paddedIndex = String(safeIndex).padStart(2, '0');
    return `${itemPhotoBaseSlug}-${paddedIndex}.jpg`;
  }, [itemPhotoBaseSlug, mediaItems]);

  const delayImageDownload = useCallback((ms) => (
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    })
  ), []);

  const downloadSingleImageWithFallback = useCallback(async (media, options = {}) => {
    const suppressSuccessToast = options?.suppressSuccessToast === true;
    if (!media?.url) return false;

    const fileName = getItemPhotoFilename(media.id);

    try {
      const normalizedUrl = new URL(media.url, window.location.href);
      const isSameOrigin = normalizedUrl.origin === window.location.origin;

      if (isSameOrigin) {
        triggerImageDownload(normalizedUrl.href, fileName);
      } else {
        try {
          const response = await fetch(normalizedUrl.href, { mode: 'cors', credentials: 'omit' });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          triggerImageDownload(blobUrl, fileName);
          setTimeout(() => {
            URL.revokeObjectURL(blobUrl);
          }, 1500);
        } catch (fetchError) {
          console.warn('[AddItemForm] download fallback to direct URL:', fetchError);
          triggerImageDownload(normalizedUrl.href, fileName);
        }
      }

      if (!suppressSuccessToast) {
        toast({ title: 'Gambar dimuat turun' });
      }
      return true;
    } catch (error) {
      console.error('[AddItemForm] Gagal muat turun gambar:', error);
      toast({
        title: 'Gagal muat turun gambar',
        description: 'Cuba semula atau gunakan butang Open.',
        variant: 'destructive',
      });
      return false;
    }
  }, [getItemPhotoFilename, toast, triggerImageDownload]);

  const handleDownloadSingleImage = useCallback(async (media) => {
    setDownloadImagesWarning('');
    setIsDownloadingImages(true);
    const didDownload = await downloadSingleImageWithFallback(media);
    setIsDownloadingImages(false);

    if (!didDownload) {
      setDownloadImagesWarning(
        'Browser mungkin menyekat muat turun. Gunakan butang Open untuk simpan manual jika perlu.'
      );
    }
  }, [downloadSingleImageWithFallback]);

  const handleOpenImageForManualSave = useCallback((media) => {
    if (!media?.url) return;
    window.open(media.url, '_blank', 'noopener,noreferrer');
  }, []);

  const handleToggleDownloadImageSelection = useCallback((mediaId, checked) => {
    setSelectedDownloadImageIds((prev) => {
      if (checked) {
        if (prev.includes(mediaId)) return prev;
        return [...prev, mediaId];
      }
      return prev.filter((id) => id !== mediaId);
    });
  }, []);

  const handleSelectAllDownloadImages = useCallback(() => {
    setSelectedDownloadImageIds(mediaItems.map((media) => media.id));
  }, [mediaItems]);

  const handleClearDownloadImages = useCallback(() => {
    setSelectedDownloadImageIds([]);
  }, []);

  const handleDownloadSelectedImages = useCallback(async () => {
    const targetMedia = hasMultipleMediaImages
      ? selectedDownloadMediaItems
      : (mediaItems[0] ? [mediaItems[0]] : []);

    if (targetMedia.length === 0) {
      toast({
        title: 'Tiada gambar dipilih',
        description: 'Pilih sekurang-kurangnya satu gambar untuk dimuat turun.',
        variant: 'destructive',
      });
      return;
    }

    setDownloadImagesWarning('');
    setIsDownloadingImages(true);

    let failedCount = 0;
    for (let index = 0; index < targetMedia.length; index += 1) {
      const didDownload = await downloadSingleImageWithFallback(targetMedia[index], { suppressSuccessToast: true });
      if (!didDownload) failedCount += 1;
      if (index < targetMedia.length - 1) {
        await delayImageDownload(280);
      }
    }

    setIsDownloadingImages(false);

    if (failedCount === 0) {
      toast({
        title: targetMedia.length > 1 ? `${targetMedia.length} gambar dimuat turun` : 'Gambar dimuat turun',
      });
    } else {
      toast({
        title: 'Sebahagian gambar gagal dimuat turun',
        description: `${failedCount} fail tidak berjaya dimuat turun.`,
        variant: 'destructive',
      });
    }

    if (failedCount > 0 || (isIosSafari && targetMedia.length > 1)) {
      setDownloadImagesWarning(
        'Browser menyekat muat turun banyak fail. Sila benarkan multiple downloads atau muat turun satu per satu.'
      );
    }
  }, [
    delayImageDownload,
    downloadSingleImageWithFallback,
    hasMultipleMediaImages,
    isIosSafari,
    mediaItems,
    selectedDownloadMediaItems,
    toast,
  ]);

  const closeDownloadImagesModal = useCallback(() => {
    if (isDownloadingImages) return;
    setShowDownloadImagesModal(false);
    setDownloadImagesWarning('');
  }, [isDownloadingImages]);
  const hasSummaryReservations = summaryReserved > 0;
  const nameError = hasSubmitAttempted && !formData.name?.trim();
  const categoryError = hasSubmitAttempted && !formData.category;
  const costError = hasSubmitAttempted && !formData.costPrice;
  const quantityError = hasSubmitAttempted && totalQuantity <= 0;
  const soldDateError = hasSubmitAttempted && isSold && !formData.dateSold;
  const soldWalletError = hasSubmitAttempted && isSold && !formData.wallet_id;
  const statusLabelMap = {
    tersedia: 'Tersedia',
    reserved: 'Reserved',
    terjual: 'Terjual',
  };
  const summaryStatusLabel = statusLabelMap[formData.status] || 'Tidak ditetapkan';

  useEffect(() => {
    if (!isReserved && reservations.length > 0) {
      updateFormField('reservations', []);
    }

    if (!isReserved) {
      if (isEditingReservations) setIsEditingReservations(false);
      if (draftReservations.length > 0) setDraftReservations([]);
    }

    if (formData.quantityReserved !== totalReservedQuantity) {
      updateFormField('quantityReserved', totalReservedQuantity);
    }
  }, [
    isReserved,
    reservations.length,
    totalReservedQuantity,
    formData.quantityReserved,
    isEditingReservations,
    draftReservations.length,
    updateFormField
  ]);

  const startEditReservations = (seedNew = false) => {
    const snapshot = reservations.map((reservation) => ({ ...reservation }));
    const seededSnapshot = seedNew || snapshot.length === 0
      ? [{
          id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          quantity: 1,
          customerId: '',
          customerName: '',
          note: '',
          createdAt: null,
        }]
      : snapshot;
    setDraftReservations(seededSnapshot);
    setIsEditingReservations(true);
  };

  const handleSaveReservations = () => {
    const hasInvalidReservation = draftReservations.some((reservation) => (parseInt(reservation.quantity, 10) || 0) <= 0);

    if (draftReservations.length === 0) {
      toast({ title: "Ralat Pengesahan", description: "Sila tambah sekurang-kurangnya satu reservation.", variant: "destructive" });
      return;
    }

    if (hasInvalidReservation) {
      toast({ title: "Ralat Pengesahan", description: "Kuantiti reservation mesti lebih daripada 0.", variant: "destructive" });
      return;
    }

    if (isOverReservedDraft) {
      toast({ title: "Ralat Pengesahan", description: "Jumlah reservation tidak boleh melebihi jumlah stok.", variant: "destructive" });
      return;
    }

    updateFormField('reservations', draftReservations);
    setIsEditingReservations(false);
    setDraftReservations([]);
    toast({ title: "Reservations dikemaskini" });
  };

  const handleCancelReservations = () => {
    setDraftReservations([]);
    setIsEditingReservations(false);
  };

  const handleAddReservation = () => {
    const nextReservations = [
      ...draftReservations,
      {
        id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        quantity: 1,
        customerId: '',
        customerName: '',
        note: '',
        createdAt: null,
      }
    ];
    setDraftReservations(nextReservations);
  };

  const handleUpdateReservation = (reservationId, updates) => {
    const nextReservations = draftReservations.map((reservation) =>
      reservation.id === reservationId ? { ...reservation, ...updates } : reservation
    );
    setDraftReservations(nextReservations);
  };

  const handleRemoveReservation = (reservationId) => {
    const nextReservations = draftReservations.filter((reservation) => reservation.id !== reservationId);
    setDraftReservations(nextReservations);
  };

  const getReservationCustomerSelectValue = (reservation) => {
    if (reservation.customerId) return reservation.customerId;
    if (reservation.customerName) return '__manual__';
    return '';
  };

  const handleReservationCustomerChange = (reservationId, value) => {
    if (value === '') {
      handleUpdateReservation(reservationId, { customerId: '', customerName: '' });
      return;
    }

    if (value === '__manual__') {
      handleUpdateReservation(reservationId, { customerId: '', customerName: '' });
      return;
    }

    handleUpdateReservation(reservationId, { customerId: value, customerName: '' });
  };

  const formatReservationDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('ms-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getReservationDisplayInfo = (reservation) => {
    const matchedClient = reservation.customerId
      ? clients?.find((client) => client.id === reservation.customerId)
      : null;
    const resolvedName = (reservation.customerName || matchedClient?.name || '').trim();
    const hasCustomer = resolvedName.length > 0;
    const phoneNumber = matchedClient?.client_phones?.[0]?.phone_number || '';
    const isExistingCustomer = Boolean(reservation.customerId);
    const isManualCustomer = !isExistingCustomer && Boolean(reservation.customerName?.trim());
    return {
      resolvedName: hasCustomer ? resolvedName : 'Tanpa pelanggan',
      hasCustomer,
      phoneNumber,
      isExistingCustomer,
      isManualCustomer,
    };
  };

  // Keep draft on cancel to avoid data loss.
  const handleCancel = () => {
    setHasSubmitAttempted(false);
    onCancel();
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="w-full max-w-6xl h-[calc(100dvh-1rem)] sm:h-[min(92vh,960px)]">
          <Card className="h-full overflow-hidden flex flex-col bg-slate-50/95">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="gradient-text">{item ? 'Sunting Item' : 'Tambah Item Baharu'}</CardTitle>
              <Button variant="ghost" size="icon" onClick={handleCancel}><X className="w-5 h-5" /></Button>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 p-4 sm:p-6 bg-slate-50/80">
              <form onSubmit={handleSubmit} className="h-full flex flex-col">
                {draftPrompt ? (
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p>
                        {draftPrompt.mode === 'edit'
                          ? 'Draf suntingan ditemui. Pulihkan perubahan?'
                          : 'Draf ditemui. Pulihkan?'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" onClick={handleRestoreDraft}>
                          Pulihkan
                        </Button>
                        {draftPrompt.mode === 'edit' ? (
                          <Button type="button" size="sm" variant="outline" onClick={handleIgnoreDraft}>
                            Abaikan
                          </Button>
                        ) : null}
                        <Button type="button" size="sm" variant="ghost" onClick={handleDiscardDraft}>
                          Buang draf
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
                {autosaveLabel ? (
                  <p className="mb-2 text-xs text-muted-foreground">
                    Disimpan automatik: {autosaveLabel}
                  </p>
                ) : null}
                <div className="flex-1 overflow-y-auto pr-1 sm:pr-2">
                  <div className="pb-4">
                  <div className="space-y-4">
                    <Card className="border-border/80 bg-background shadow-sm">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <ClipboardList className="h-4 w-4" />
                          </span>
                          Ringkasan Cepat
                        </CardTitle>
                        <CardDescription>Lihat status item semasa sebelum teruskan suntingan.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 sm:gap-3">
                          <div className="rounded-lg border border-violet-200/80 bg-violet-50/70 px-3 py-2 text-violet-900 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200">
                            <div className="text-[10px] font-semibold tracking-wide text-violet-700/80 dark:text-violet-200/80">STATUS</div>
                            <div className="text-base font-semibold">{summaryStatusLabel}</div>
                          </div>
                          <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-slate-900 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-200">
                            <div className="text-[10px] font-semibold tracking-wide text-slate-600 dark:text-slate-200/80">JUMLAH STOK</div>
                            <div className="text-base font-semibold">{totalQuantity}</div>
                          </div>
                          <div className="rounded-lg border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                            <div className="text-[10px] font-semibold tracking-wide text-amber-700/80 dark:text-amber-200/80">RESERVED</div>
                            <div className="text-base font-semibold">{summaryReserved} unit</div>
                          </div>
                          <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/70 px-3 py-2 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                            <div className="text-[10px] font-semibold tracking-wide text-emerald-700/80 dark:text-emerald-200/80">AVAILABLE</div>
                            <div className="text-base font-semibold">{summaryAvailable} unit</div>
                          </div>
                          <div className="rounded-lg border border-indigo-200/80 bg-indigo-50/70 px-3 py-2 text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
                            <div className="text-[10px] font-semibold tracking-wide text-indigo-700/80 dark:text-indigo-200/80">LOKASI</div>
                            <div className="text-base font-semibold truncate" title={summaryRackLocation}>{summaryRackLocation}</div>
                          </div>
                          <div className="rounded-lg border border-sky-200/80 bg-sky-50/70 px-3 py-2 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
                            <div className="text-[10px] font-semibold tracking-wide text-sky-700/80 dark:text-sky-200/80">GAMBAR</div>
                            <div className="text-base font-semibold">{mediaItems.length}/{MAX_MEDIA_IMAGES}</div>
                          </div>
                        </div>
                        {summarySku ? (
                          <p className="mt-3 text-xs text-muted-foreground">
                            SKU: <span className="font-medium text-foreground">{summarySku}</span>
                          </p>
                        ) : null}
                      </CardContent>
                    </Card>
                    <Card className="border-border/80 bg-background shadow-sm">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <Package2 className="h-4 w-4" />
                          </span>
                          Butiran Item
                        </CardTitle>
                        <CardDescription>Susun maklumat item dengan cepat sebelum simpan.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-foreground/85 mb-2">Nama Item *</label>
                            <Input
                              value={formData.name}
                              onChange={(e) => updateFormField('name', e.target.value)}
                              placeholder="cth: DX Gokaioh"
                              required
                              className={`h-10 border-border/80 focus-visible:ring-primary/40 ${nameError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                            />
                            {nameError ? <p className="mt-1 text-xs text-red-500">Nama item wajib diisi.</p> : null}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-foreground/85 mb-2">Kategori *</label>
                            <Select
                              value={formData.category}
                              onChange={(e) => updateFormField('category', e.target.value)}
                              className={`h-10 border-border/80 focus-visible:ring-primary/40 ${categoryError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                            >
                              {categories && categories.length > 0 ? (
                                categories.map(cat => (
                                  <option key={cat.id} value={cat.name}>{cat.name}</option>
                                ))
                              ) : (
                                <option value="" disabled>Tiada kategori. Sila tambah di Tetapan.</option>
                              )}
                            </Select>
                            {categoryError ? <p className="mt-1 text-xs text-red-500">Kategori wajib dipilih.</p> : null}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-foreground/85 mb-2">Status</label>
                            <Select value={formData.status} onChange={(e) => handleStatusChange(e.target.value)} className="h-10 border-border/80 focus-visible:ring-primary/40">
                              <option value="tersedia">Tersedia</option>
                              <option value="reserved">Reserved</option>
                              <option value="terjual" disabled hidden={!isSold}>Terjual (Auto)</option>
                            </Select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-foreground/85 mb-2">SKU (Optional)</label>
                            <Input
                              value={formData.sku || ''}
                              onChange={(e) => updateFormField('sku', e.target.value)}
                              placeholder="Contoh: RB-00045 / GEATS-01"
                              className="h-10 border-border/80 focus-visible:ring-primary/40"
                            />
                            <p className="mt-1 text-xs text-muted-foreground">Kod dalaman untuk cari item dengan cepat.</p>
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-foreground/85 mb-2">Deskripsi (Optional)</label>
                            <textarea
                              value={formData.description || ''}
                              onChange={(e) => updateFormField('description', e.target.value)}
                              placeholder="Tulis condition, set lengkap, defect, remark, dll."
                              className="min-h-[96px] w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                            />
                            <p className="mt-1 text-xs text-muted-foreground">Digunakan untuk Listing Note dan rujukan.</p>
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-foreground/85 mb-2">Tags</label>
                            <div className="space-y-2">
                              <Input
                                value={tagSearch}
                                onChange={(event) => setTagSearch(event.target.value)}
                                placeholder="Cari tag atau cipta tag baru"
                                className="h-10 border-border/80 focus-visible:ring-primary/40"
                              />

                              {selectedTagPills.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {selectedTagPills.map((tag) => (
                                    <button
                                      key={tag.id}
                                      type="button"
                                      onClick={() => toggleTagSelection(tag.id, false)}
                                      className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/5 px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-primary/10"
                                    >
                                      <span
                                        className="h-2 w-2 rounded-full"
                                        style={{ backgroundColor: tag.color || '#94a3b8' }}
                                      />
                                      <span>{tag.name}</span>
                                      <X className="h-3 w-3" />
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">Belum ada tag dipilih.</p>
                              )}

                              <div className="max-h-40 overflow-y-auto rounded-lg border border-border/80 bg-muted/10 p-2">
                                {isTagsLoading ? (
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Memuatkan tag...
                                  </div>
                                ) : filteredTagOptions.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">Tiada tag ditemui.</p>
                                ) : (
                                  <div className="space-y-1">
                                    {filteredTagOptions.map((tag) => {
                                      const isSelected = selectedTagIdSet.has(tag.id);
                                      return (
                                        <label
                                          key={tag.id}
                                          className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition ${
                                            isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
                                          }`}
                                        >
                                          <Checkbox
                                            checked={isSelected}
                                            onCheckedChange={(checked) => toggleTagSelection(tag.id, Boolean(checked))}
                                          />
                                          <span
                                            className="h-2.5 w-2.5 rounded-full"
                                            style={{ backgroundColor: tag.color || '#94a3b8' }}
                                          />
                                          <span>{tag.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              {shouldShowCreateTagAction ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={handleCreateTagFromSearch}
                                  disabled={isCreatingTag}
                                  className="w-full sm:w-fit"
                                >
                                  {isCreatingTag ? (
                                    <>
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      Menambah Tag...
                                    </>
                                  ) : (
                                    <>
                                      <Plus className="mr-2 h-4 w-4" />
                                      + Tambah "{normalizedTagSearch}"
                                    </>
                                  )}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                   <div>
                    <label className="block text-sm font-medium text-foreground/85 mb-2">Tarikh Beli *</label>
                    <Input type="date" value={formData.dateBought} onChange={(e) => updateFormField('dateBought', e.target.value)} required className="h-10 border-border/80 focus-visible:ring-primary/40" />
                  </div>
                  {isSold && (
                    <>
                       <div>
                        <label className="block text-sm font-medium text-foreground/85 mb-2">Tarikh Jual *</label>
                        <Input
                          type="date"
                          value={formData.dateSold}
                          onChange={(e) => updateFormField('dateSold', e.target.value)}
                          required={isSold}
                          className={`h-10 border-border/80 focus-visible:ring-primary/40 ${soldDateError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                        />
                        {soldDateError ? <p className="mt-1 text-xs text-red-500">Tarikh jual diperlukan untuk item terjual.</p> : null}
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-foreground/85 mb-2">Akaun Wallet (Perniagaan) *</label>
                        <Select
                          value={formData.wallet_id}
                          onChange={(e) => updateFormField('wallet_id', e.target.value)}
                          required={isSold}
                          className={`h-10 border-border/80 focus-visible:ring-primary/40 ${soldWalletError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                        >
                          <option value="">-- Sila pilih akaun --</option>
                          {wallets && wallets.length > 0 ? (
                              wallets.map(wallet => (
                                  <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
                              ))
                          ) : (
                              <option value="" disabled>Tiada akaun perniagaan.</option>
                          )}
                        </Select>
                        {soldWalletError ? <p className="mt-1 text-xs text-red-500">Sila pilih akaun wallet.</p> : null}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground/85 mb-2">Pelanggan (Pilihan)</label>
                        <Select value={formData.client_id} onChange={handleClientChange} className="h-10 border-border/80 focus-visible:ring-primary/40">
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
                        </div>
                      </CardContent>
                    </Card>

                  {(isReserved || reservations.length > 0) && (
                    <Card className="border-amber-200/70 bg-amber-50/40 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-200">
                            <ClipboardList className="h-4 w-4" />
                          </span>
                          Reservation
                        </CardTitle>
                        <CardDescription>Urus pelanggan dan kuantiti item yang di-reserve.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
                            <ClipboardList className="h-4 w-4" />
                            Reservation
                          </div>
                          {hasSummaryReservations ? (
                            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                              <div className="rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                                <div className="text-[10px] font-semibold tracking-wide text-amber-700/80 dark:text-amber-200/80">RESERVED</div>
                                <div className="text-lg font-semibold">{summaryReserved} unit</div>
                              </div>
                              <div className="rounded-lg border border-slate-200/70 bg-slate-50/70 px-3 py-2 text-slate-900 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-200">
                                <div className="text-[10px] font-semibold tracking-wide text-slate-600 dark:text-slate-200/70">PEMBELI</div>
                                <div className="text-lg font-semibold">{summaryBuyerCount}</div>
                              </div>
                              <div className="rounded-lg border border-emerald-200/70 bg-emerald-50/60 px-3 py-2 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                                <div className="text-[10px] font-semibold tracking-wide text-emerald-700/80 dark:text-emerald-200/80">AVAILABLE</div>
                                <div className="text-lg font-semibold">{summaryAvailable} unit</div>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-slate-200/70 bg-slate-50/70 px-3 py-1 text-[11px] text-slate-600 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-200/80">
                                Tiada reservation
                              </span>
                              <div className="rounded-lg border border-emerald-200/70 bg-emerald-50/60 px-3 py-2 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                                <div className="text-[10px] font-semibold tracking-wide text-emerald-700/80 dark:text-emerald-200/80">AVAILABLE</div>
                                <div className="text-lg font-semibold">{summaryAvailable} unit</div>
                              </div>
                            </div>
                          )}
                          {isEditingReservations && isOverReservedDraft && (
                            <div className="text-xs text-red-500 mt-1">
                              Jumlah reservation melebihi stok.
                            </div>
                          )}
                        </div>
                        {!isEditingReservations ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => startEditReservations()}
                            className="gap-2"
                          >
                            <Edit className="w-4 h-4" />
                            Sunting
                          </Button>
                        ) : (
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleCancelReservations}
                              className="gap-2"
                            >
                              <X className="w-4 h-4" />
                              Batal
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={handleSaveReservations}
                              className="gap-2"
                              disabled={
                                draftReservations.length === 0
                                || isOverReservedDraft
                                || draftReservations.some((reservation) => (parseInt(reservation.quantity, 10) || 0) <= 0)
                              }
                            >
                              <Save className="w-4 h-4" />
                              Simpan
                            </Button>
                          </div>
                        )}
                      </div>

                      {isEditingReservations ? (
                        <>
                          {draftReservations.length === 0 ? (
                            <div className="text-xs text-muted-foreground border border-dashed rounded-md p-3">
                              Tiada reservation. Klik "Tambah Reservation" untuk mula.
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {draftReservations.map((reservation) => {
                                const customerSelectValue = getReservationCustomerSelectValue(reservation);
                                return (
                                  <div key={reservation.id} className="rounded-xl border bg-slate-50/60 dark:bg-slate-900/30 p-3 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
                                        <div>
                                          <label className="block text-xs font-medium text-muted-foreground mb-1">Pelanggan (Pilihan)</label>
                                          <Select
                                            value={customerSelectValue}
                                            onChange={(e) => handleReservationCustomerChange(reservation.id, e.target.value)}
                                          >
                                            <option value="">Tiada pelanggan</option>
                                            <option value="__manual__">Isi nama manual</option>
                                            {clients && clients.map(client => (
                                              <option key={client.id} value={client.id}>{client.name}</option>
                                            ))}
                                          </Select>
                                          {customerSelectValue === '__manual__' && (
                                            <Input
                                              className="mt-2"
                                              placeholder="Contoh: Ali / Cikgu Siti"
                                              value={reservation.customerName || ''}
                                              onChange={(e) => handleUpdateReservation(reservation.id, { customerName: e.target.value })}
                                            />
                                          )}
                                        </div>
                                        <div>
                                          <label className="block text-xs font-medium text-muted-foreground mb-1">Kuantiti *</label>
                                          <Input
                                            type="number"
                                            min="1"
                                            step="1"
                                            max={formData.quantity || 1}
                                            value={reservation.quantity ?? 1}
                                            onChange={(e) => {
                                              const nextValue = parseInt(e.target.value, 10);
                                              const safeValue = Number.isNaN(nextValue) ? 0 : Math.min(nextValue, totalQuantity);
                                              handleUpdateReservation(reservation.id, { quantity: safeValue });
                                            }}
                                            placeholder="1"
                                            required
                                          />
                                        </div>
                                      </div>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleRemoveReservation(reservation.id)}
                                        className="mt-6"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </Button>
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-muted-foreground mb-1">Nota (Pilihan)</label>
                                      <textarea
                                        value={reservation.note || ''}
                                        onChange={(e) => handleUpdateReservation(reservation.id, { note: e.target.value })}
                                        placeholder="Catatan ringkas untuk reservation ini..."
                                        className="min-h-[70px] w-full rounded-lg border p-3 text-sm"
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleAddReservation}
                            className="w-full gap-2 border-dashed"
                          >
                            <Plus className="w-4 h-4" />
                            Tambah Reservation
                          </Button>
                        </>
                      ) : (
                        <>
                          {reservations.length === 0 ? (
                            <div className="flex flex-col items-start gap-3 border border-dashed rounded-lg p-4 text-xs text-muted-foreground bg-slate-50/40 dark:bg-slate-900/20">
                              Tiada reservation lagi. Klik Sunting untuk mula.
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => startEditReservations(true)}
                                className="gap-2 border-dashed"
                              >
                                <Plus className="w-4 h-4" />
                                Tambah Reservation
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {reservations.map((reservation) => {
                                const {
                                  resolvedName,
                                  hasCustomer,
                                  phoneNumber,
                                  isExistingCustomer,
                                  isManualCustomer,
                                } = getReservationDisplayInfo(reservation);
                                const badgeLabel = isExistingCustomer
                                  ? 'Pelanggan sedia ada'
                                  : isManualCustomer
                                    ? 'Manual'
                                    : '';
                                const createdLabel = formatReservationDate(reservation.createdAt);
                                return (
                                  <div key={reservation.id} className="rounded-xl border bg-slate-50/60 dark:bg-slate-900/30 p-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <User className="w-4 h-4 text-muted-foreground" />
                                          <div className="font-semibold text-foreground truncate">{resolvedName}</div>
                                          {badgeLabel && (
                                            <span className="rounded-full border border-slate-200/70 bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-500/30 dark:bg-slate-900/40 dark:text-slate-200/70">
                                              {badgeLabel}
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                          {!hasCustomer ? 'Pelanggan: (tiada)' : (phoneNumber ? phoneNumber : 'Telefon: (tiada)')}
                                        </div>
                                        {!hasCustomer && (
                                          <div className="text-[11px] text-muted-foreground mt-1">
                                            Sesuai untuk hold stok sementara
                                          </div>
                                        )}
                                      </div>
                                      <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-900 text-xs font-semibold px-3 py-1 dark:bg-amber-500/20 dark:text-amber-200">
                                        {reservation.quantity || 0} unit
                                      </span>
                                    </div>
                                    {reservation.note && (
                                      <div className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
                                        <MessageSquare className="w-3.5 h-3.5 mt-0.5" />
                                        <span className="line-clamp-2">{reservation.note}</span>
                                      </div>
                                    )}
                                    {createdLabel && (
                                      <div className="text-[10px] text-muted-foreground mt-2">Dibuat: {createdLabel}</div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                      </CardContent>
                    </Card>
                  )}

                  <div>
                    <Card className="border-border/80 bg-slate-100/65 shadow-sm">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <BadgeDollarSign className="h-4 w-4" />
                          </span>
                          Stok & Harga
                        </CardTitle>
                        <CardDescription>Semak harga jual dan platform sebelum simpan.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="rounded-xl border border-border/70 bg-background/95 p-3">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-2">Kuantiti (Stok) *</label>
                            <Input
                              type="number"
                              min="1"
                              step="1"
                              value={formData.quantity}
                              onChange={(e) => updateFormField('quantity', parseInt(e.target.value, 10) || 1)}
                              placeholder="1"
                              required
                              className={`h-10 border-border/80 focus-visible:ring-primary/40 ${quantityError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                            />
                            {quantityError ? <p className="mt-1 text-xs text-red-500">Kuantiti mestilah sekurang-kurangnya 1.</p> : null}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-2">Harga Kos *</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-primary font-medium">RM</span>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={formData.costPrice}
                                onChange={(e) => updateFormField('costPrice', e.target.value)}
                                placeholder="0.00"
                                className={`h-10 pl-12 border-border/80 focus-visible:ring-primary/40 ${costError ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                                required
                              />
                            </div>
                            {costError ? <p className="mt-1 text-xs text-red-500">Harga kos wajib diisi.</p> : null}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-2">Harga Jual *</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-primary font-medium">RM</span>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={formData.sellingPrice}
                                onChange={(e) => updateFormField('sellingPrice', e.target.value)}
                                placeholder="0.00"
                                className="h-10 pl-12 border-border/80 focus-visible:ring-primary/40"
                                required
                              />
                            </div>
                          </div>
                          <div className="md:col-span-3">
                            <label className="block text-sm font-medium text-muted-foreground mb-2">Lokasi Simpanan</label>
                            <Input
                              type="text"
                              value={formData.rackLocation || ''}
                              onChange={(e) => updateFormField('rackLocation', e.target.value)}
                              placeholder="Contoh: Rack A3 / Kotak 2 / Stor Belakang"
                              className="h-10 border-border/80 focus-visible:ring-primary/40"
                            />
                            <p className="mt-1 text-xs text-muted-foreground">Nyatakan lokasi fizikal barang untuk mudah dicari.</p>
                          </div>
                          </div>
                        </div>
                        <div>
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
                          <div>
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
                      </CardContent>
                    </Card>
                    <Card className="border-border/80 bg-slate-100/70 shadow-sm">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <ImageIcon className="h-4 w-4" />
                          </span>
                          Gambar Item
                        </CardTitle>
                        <CardDescription>Pilih dari library, muat naik, atau guna kamera.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex rounded-lg border bg-muted/20 p-1">
                          <Button
                            type="button"
                            variant={mediaActionMode === 'library' ? 'secondary' : 'ghost'}
                            size="sm"
                            className="h-8"
                            onClick={() => setMediaActionMode('library')}
                          >
                            Library
                          </Button>
                          {isMobileDevice ? (
                            <Button
                              type="button"
                              variant={mediaActionMode === 'camera' ? 'secondary' : 'ghost'}
                              size="sm"
                              className="h-8"
                              onClick={() => setMediaActionMode('camera')}
                            >
                              Kamera
                            </Button>
                          ) : null}
                        </div>
                        {mediaActionMode === 'library' ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploading || libraryLoading || libraryUploading}
                            onClick={openMediaLibrary}
                          >
                            Buka Library
                          </Button>
                        ) : null}
                        {isMobileDevice && mediaActionMode === 'camera' ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploading || mediaItems.length >= MAX_MEDIA_IMAGES}
                            onClick={() => cameraInputRef.current?.click()}
                          >
                            Ambil Gambar
                          </Button>
                        ) : null}
                        </div>
                    </div>

                    <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
                      <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
                        <p className="font-medium text-foreground">Notis Gambar</p>
                        <p>
                          Maksimum {MAX_MEDIA_IMAGES} gambar per item. Gunakan Library untuk muat naik/pilih semula
                          gambar.
                        </p>
                        <p>
                          Auto compress aktif semasa upload untuk kecilkan saiz gambar tanpa menjejaskan kualiti
                          dengan ketara.
                        </p>
                      </div>
                    </div>

                    {isMobileDevice ? (
                      <Input
                        id="image-upload-camera"
                        ref={cameraInputRef}
                        type="file"
                        className="hidden"
                        accept="image/*"
                        capture="environment"
                        onChange={handleImageUpload}
                      />
                    ) : null}

                    {uploading && (
                      <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Memproses gambar...
                      </div>
                    )}

                    {mediaItems.length === 0 ? (
                      <div className="w-full h-32 border-2 border-dashed rounded-md flex flex-col items-center justify-center">
                        <ImageIcon className="w-8 h-8 text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">Belum ada gambar dimuat naik</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        {mediaItems.map((media) => (
                          <div
                            key={media.id}
                            draggable
                            onDragStart={(event) => handleDragStart(event, media.id)}
                            onDragOver={handleDragOver}
                            onDrop={(event) => handleDrop(event, media.id)}
                            onDragEnd={() => setDraggingMediaId(null)}
                            className={`relative group overflow-hidden rounded-lg border bg-background cursor-grab active:cursor-grabbing ${draggingMediaId === media.id ? 'opacity-60' : ''}`}
                          >
                            <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-2">
                              <div className="flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">
                                <GripVertical className="h-3 w-3" />
                                Drag
                              </div>
                              {media.isCover ? (
                                <span className="rounded-full bg-amber-500 px-2 py-1 text-[10px] font-semibold text-white">
                                  Cover
                                </span>
                              ) : null}
                            </div>

                            <img
                              src={media.url}
                              alt="Item media"
                              className="h-28 w-full object-cover"
                              draggable={false}
                            />

                            <div className="space-y-2 p-2">
                              <Button
                                type="button"
                                size="sm"
                                variant={media.isCover ? 'secondary' : 'outline'}
                                className="w-full justify-center gap-1 text-xs"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  handleSetCoverImage(media.id);
                                }}
                                disabled={media.isCover}
                              >
                                <Star className="h-3.5 w-3.5" />
                                {media.isCover ? 'Cover' : 'Set as Cover'}
                              </Button>
                              <div className="grid grid-cols-2 gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="justify-center gap-1 text-xs"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    moveMediaByOffset(media.id, -1);
                                  }}
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                  Naik
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="justify-center gap-1 text-xs"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    moveMediaByOffset(media.id, 1);
                                  }}
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                  Turun
                                </Button>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                className="w-full justify-center gap-1 text-xs"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  removeImage(media.id);
                                }}
                                disabled={uploading}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Padam
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                      </CardContent>
                    </Card>

                  </div>

                  </div>
                </div>
                </div>
                <div
                  className="sticky bottom-0 z-20 mt-4 border-t bg-card/95 pt-3 shadow-[0_-10px_24px_-14px_rgba(15,23,42,0.45)] backdrop-blur supports-[backdrop-filter]:bg-card/85"
                  style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0.75rem)' }}
                >
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowDownloadImagesModal(true)}
                      className="w-full sm:w-auto"
                      disabled={mediaItems.length === 0}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download Gambar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowListingNoteModal(true)}
                      className="w-full sm:w-auto"
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      Listing Note
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleCancel}
                      className="w-full sm:w-auto"
                      disabled={isSaving || uploading}
                    >
                      Batal
                    </Button>
                    <Button
                      type="submit"
                      className="w-full sm:w-auto"
                      disabled={isSaving || uploading}
                    >
                      {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                      <span className="whitespace-nowrap">{item ? 'Kemas Kini' : 'Tambah'}</span>
                    </Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
      {showListingNoteModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[65] flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setShowListingNoteModal(false)}
        >
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            className="w-full sm:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[90vh]"
            onClick={(event) => event.stopPropagation()}
          >
            <Card className="h-full sm:h-auto sm:max-h-[90vh] overflow-hidden flex flex-col rounded-none sm:rounded-xl">
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="gradient-text">Listing Note</CardTitle>
                    <CardDescription>Salin teks listing dengan sekali tekan untuk platform jualan.</CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowListingNoteModal(false)}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 overflow-y-auto space-y-3 pb-24 sm:pb-4">
                {!listingNoteText.trim() ? (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    Isi sekurang-kurangnya tajuk, harga, atau deskripsi untuk jana Listing Note.
                  </div>
                ) : (
                  <>
                    {listingTitle ? (
                      <div className="rounded-lg border bg-background p-3">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-foreground">Tajuk</h3>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopyListingSection(listingTitle, 'Tajuk disalin')}
                            className="gap-1.5"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copy
                          </Button>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm select-text">{listingTitle}</p>
                      </div>
                    ) : null}

                    {listingPrice ? (
                      <div className="rounded-lg border bg-background p-3">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-foreground">Harga</h3>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopyListingSection(listingPrice, 'Harga disalin')}
                            className="gap-1.5"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copy
                          </Button>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm select-text">{listingPrice}</p>
                      </div>
                    ) : null}

                    {listingDescription ? (
                      <div className="rounded-lg border bg-background p-3">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-foreground">Deskripsi</h3>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopyListingSection(listingDescription, 'Deskripsi disalin')}
                            className="gap-1.5"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copy
                          </Button>
                        </div>
                        <pre className="mt-2 whitespace-pre-wrap break-words text-sm select-text font-sans">{listingDescription}</pre>
                      </div>
                    ) : null}

                    {listingInfoLines.length > 0 ? (
                      <div className="rounded-lg border bg-background p-3">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-foreground">Info Tambahan</h3>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopyListingSection(listingInfoText, 'Info tambahan disalin')}
                            className="gap-1.5"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copy
                          </Button>
                        </div>
                        <div className="mt-2 space-y-2 text-sm">
                          {listingInfoLines.map((line) => (
                            <div key={line.label} className="flex items-start justify-between gap-4">
                              <span className="text-muted-foreground">{line.label}</span>
                              <span className="text-right font-medium text-foreground break-words">{line.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </CardContent>
              <div
                className="sticky bottom-0 z-20 shrink-0 border-t bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/85"
                style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0.75rem)' }}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    className="w-full sm:w-auto gap-2"
                    onClick={() => handleCopyListingSection(listingNoteText, 'Listing disalin')}
                    disabled={!listingNoteText.trim()}
                  >
                    <Copy className="h-4 w-4" />
                    Copy Semua
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto gap-2"
                    onClick={handleDownloadListingTxt}
                    disabled={!listingNoteText.trim()}
                  >
                    <Download className="h-4 w-4" />
                    Download .txt
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      )}
      {showDownloadImagesModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[66] flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={closeDownloadImagesModal}
        >
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            className="w-full sm:max-w-4xl h-[100dvh] sm:h-auto sm:max-h-[90vh]"
            onClick={(event) => event.stopPropagation()}
          >
            <Card className="h-full sm:h-auto sm:max-h-[90vh] overflow-hidden flex flex-col rounded-none sm:rounded-xl">
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="gradient-text">Gambar Item</CardTitle>
                    <CardDescription>Muat turun gambar item satu per satu atau secara pilihan.</CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={closeDownloadImagesModal}
                    disabled={isDownloadingImages}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
                {isIosSafari ? (
                  <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    Jika download tidak berfungsi, tekan Open dan Save Image.
                  </p>
                ) : null}
              </CardHeader>

              <CardContent className="flex-1 min-h-0 overflow-y-auto space-y-3 pb-24 sm:pb-4">
                {mediaItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    Tiada gambar untuk dimuat turun.
                  </div>
                ) : (
                  <>
                    {hasMultipleMediaImages ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-3">
                        <div className="text-sm text-muted-foreground">
                          {selectedDownloadMediaItems.length}/{mediaItems.length} dipilih
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleSelectAllDownloadImages}
                            disabled={isDownloadingImages}
                          >
                            Select All
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleClearDownloadImages}
                            disabled={isDownloadingImages}
                          >
                            Clear
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {mediaItems.map((media) => {
                        const isSelected = selectedDownloadImageIds.includes(media.id);
                        return (
                          <div key={media.id} className="overflow-hidden rounded-lg border bg-background">
                            <div className="relative h-32 w-full bg-muted/20">
                              <img
                                src={media.url}
                                alt="Item media"
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                              {hasMultipleMediaImages ? (
                                <label className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[11px] font-semibold text-white">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(event) => handleToggleDownloadImageSelection(media.id, event.target.checked)}
                                    disabled={isDownloadingImages}
                                  />
                                  Pilih
                                </label>
                              ) : null}
                            </div>
                            <div className={`grid gap-2 p-2 ${hasMultipleMediaImages || isIosSafari ? 'grid-cols-2' : 'grid-cols-1'}`}>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="gap-1 text-xs"
                                onClick={() => handleDownloadSingleImage(media)}
                                disabled={isDownloadingImages}
                              >
                                <Download className="h-3.5 w-3.5" />
                                Download
                              </Button>
                              {(hasMultipleMediaImages || isIosSafari) ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="gap-1 text-xs"
                                  onClick={() => handleOpenImageForManualSave(media)}
                                  disabled={isDownloadingImages}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  Open
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {downloadImagesWarning ? (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {downloadImagesWarning}
                      </p>
                    ) : null}
                  </>
                )}
              </CardContent>

              <div
                className="sticky bottom-0 z-20 shrink-0 border-t bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/85"
                style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0.75rem)' }}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    onClick={handleDownloadSelectedImages}
                    disabled={
                      isDownloadingImages
                      || mediaItems.length === 0
                      || (hasMultipleMediaImages && selectedDownloadMediaItems.length === 0)
                    }
                    className="w-full sm:w-auto gap-2"
                  >
                    {isDownloadingImages ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    {hasMultipleMediaImages ? 'Download Dipilih' : 'Download Gambar'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeDownloadImagesModal}
                    disabled={isDownloadingImages}
                    className="w-full sm:w-auto"
                  >
                    Tutup
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      )}
      {showLibraryModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto"
          style={{
            paddingTop: 'max(env(safe-area-inset-top, 0px), 0.75rem)',
            paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 4.25rem)',
          }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="w-full max-w-5xl h-full min-h-0"
          >
            <Card className="h-full overflow-hidden flex flex-col">
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="gradient-text">Media Library</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Pilih gambar sedia ada untuk digunakan semula pada item lain.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => {
                      setShowLibraryModal(false);
                      setSelectedLibraryUrls([]);
                    }}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
                <div className="flex w-full flex-wrap gap-2 sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={isMobileDevice ? 'w-full sm:w-auto' : ''}
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={libraryUploading}
                  >
                    {libraryUploading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Memuat Naik...
                      </>
                    ) : (
                      'Muat Naik ke Library'
                    )}
                  </Button>
                  {isMobileDevice ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex-1 sm:flex-none"
                      onClick={() => libraryCameraInputRef.current?.click()}
                      disabled={libraryUploading}
                    >
                      Kamera
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={isMobileDevice ? 'flex-1 sm:flex-none' : ''}
                    onClick={() => fetchLibraryPage({ page: 0, replace: true })}
                    disabled={libraryLoading || libraryDeletingId || libraryUploading}
                  >
                    Muat Semula
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 flex-1 min-h-0 overflow-hidden flex flex-col">
                <Input
                  id="media-library-upload"
                  ref={galleryInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept="image/*"
                  onChange={handleLibraryUpload}
                />
                {isMobileDevice ? (
                  <Input
                    id="media-library-camera-upload"
                    ref={libraryCameraInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*"
                    capture="environment"
                    onChange={handleLibraryUpload}
                  />
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Input
                    value={librarySearchTerm}
                    onChange={(event) => setLibrarySearchTerm(event.target.value)}
                    placeholder="Cari mengikut nama fail..."
                    className="w-full sm:max-w-sm"
                  />
                  <div className="text-xs text-muted-foreground">
                    {selectedLibraryUrls.length} dipilih
                  </div>
                </div>

                {libraryLoading && libraryItems.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Memuatkan Media Library...
                  </div>
                ) : null}

                {filteredLibraryItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {libraryItems.length === 0
                      ? 'Media Library masih kosong. Muat naik gambar dahulu.'
                      : 'Tiada gambar sepadan dengan carian.'}
                  </div>
                ) : (
                  <div
                    className="min-h-0 flex-1 overflow-y-auto pr-1"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                  >
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                      {filteredLibraryItems.map((libraryItem) => {
                        const isSelected = selectedLibraryUrls.includes(libraryItem.url);
                        const displayFilename =
                          libraryItem.original_filename ||
                          extractFileNameFromPath(libraryItem.storage_path) ||
                          'gambar';
                        return (
                          <div
                            key={libraryItem.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleLibrarySelection(libraryItem.url)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                toggleLibrarySelection(libraryItem.url);
                              }
                            }}
                            className={`relative overflow-hidden rounded-lg border text-left transition-colors cursor-pointer ${
                              isSelected ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-primary/40'
                            }`}
                          >
                            <div className="absolute left-2 top-2 z-10 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
                              {isSelected ? 'Dipilih' : 'Pilih'}
                            </div>
                            <Button
                              type="button"
                              size="icon"
                              variant="destructive"
                              className="absolute right-2 top-2 z-10 h-7 w-7"
                              disabled={libraryDeletingId === libraryItem.id}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                handleDeleteLibraryImage(libraryItem);
                              }}
                            >
                              {libraryDeletingId === libraryItem.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            <img
                              src={libraryItem.url}
                              alt={displayFilename}
                              className="h-28 w-full object-cover"
                              loading="lazy"
                              draggable={false}
                            />
                            <div className="space-y-1 p-2">
                              <p className="truncate text-xs font-medium text-foreground" title={displayFilename}>
                                {displayFilename}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {formatBytes(libraryItem.size_bytes || 0)}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {libraryItem.created_at
                                  ? new Date(libraryItem.created_at).toLocaleDateString()
                                  : '-'}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
              <div
                className="sticky bottom-0 z-20 shrink-0 flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85"
                style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0.75rem)' }}
              >
                <div>
                  {libraryHasMore ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={loadMoreLibrary}
                      disabled={libraryLoading}
                    >
                      {libraryLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Memuat...
                        </>
                      ) : (
                        'Muat Lagi'
                      )}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Tiada lagi gambar.</span>
                  )}
                </div>
                <div className="flex w-full sm:w-auto gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1 sm:flex-none"
                    onClick={() => {
                      setShowLibraryModal(false);
                      setSelectedLibraryUrls([]);
                    }}
                  >
                    Batal
                  </Button>
                  <Button
                    type="button"
                    className="brand-gradient brand-gradient-hover flex-1 sm:flex-none"
                    onClick={handleAddSelectedLibraryImages}
                    disabled={selectedLibraryUrls.length === 0}
                  >
                    Tambah ke Item
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      )}
      {showClientModal && (
        <ClientFormModal 
          onSave={handleClientSaved}
          onCancel={() => {
            setShowClientModal(false);
            updateFormField('client_id', '');
          }}
        />
      )}
    </>
  );
};

export default AddItemForm;
