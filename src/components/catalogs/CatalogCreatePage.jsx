import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { formatCurrency } from '@/lib/utils';
import { supabase } from '@/lib/customSupabaseClient';
import imageCompression from 'browser-image-compression';
import { ArrowLeft, CheckCircle2, Copy, ExternalLink, ImagePlus, Link2, Loader2, Search, Trash2 } from 'lucide-react';

const ACCESS_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CATALOG_COVER_BUCKET = 'item_images';
const COVER_ACCEPTED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const COVER_MAX_BYTES = 2 * 1024 * 1024;
const COVER_MAX_MB_TEXT = '2MB';
const COVER_TARGET_BYTES = 250 * 1024;
const COVER_TARGET_TEXT = '200-250KB';

const extractStoragePathFromPublicUrl = (url) => {
  if (typeof url !== 'string') return '';
  const marker = '/item_images/';
  const markerIndex = url.indexOf(marker);
  if (markerIndex < 0) return '';
  const rawPath = url.slice(markerIndex + marker.length);
  return rawPath.split('?')[0].split('#')[0];
};

const generateAccessCode = (length = 8) => {
  const charLength = ACCESS_CODE_CHARS.length;
  let result = '';

  const browserCrypto = typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues
    ? globalThis.crypto
    : null;

  if (browserCrypto) {
    const bytes = new Uint32Array(length);
    browserCrypto.getRandomValues(bytes);
    for (let index = 0; index < length; index += 1) {
      result += ACCESS_CODE_CHARS[bytes[index] % charLength];
    }
    return result;
  }

  for (let index = 0; index < length; index += 1) {
    result += ACCESS_CODE_CHARS[Math.floor(Math.random() * charLength)];
  }
  return result;
};

const getCatalogStatus = (catalog) => {
  if (!catalog?.is_active) {
    return { label: 'Tidak Aktif', className: 'bg-slate-200 text-slate-700' };
  }

  if (catalog?.expires_at) {
    const expiresAtDate = new Date(catalog.expires_at);
    if (!Number.isNaN(expiresAtDate.getTime()) && expiresAtDate <= new Date()) {
      return { label: 'Tamat Tempoh', className: 'bg-amber-100 text-amber-800' };
    }
  }

  return { label: 'Aktif', className: 'bg-emerald-100 text-emerald-800' };
};

const getReservedQuantity = (item) => {
  const reservations = Array.isArray(item?.inventory_reservations) ? item.inventory_reservations : [];
  if (reservations.length > 0) {
    return reservations.reduce((sum, reservation) => {
      const qty = parseInt(reservation.quantity_reserved, 10);
      return sum + (Number.isNaN(qty) ? 0 : qty);
    }, 0);
  }

  const legacyReserved = parseInt(item?.quantity_reserved, 10);
  return Number.isNaN(legacyReserved) ? 0 : legacyReserved;
};

const getAvailableQuantity = (item) => {
  const total = parseInt(item?.quantity, 10);
  const totalQty = Number.isNaN(total) ? 0 : total;
  return Math.max(totalQty - getReservedQuantity(item), 0);
};

const CatalogCreatePage = ({ userId, items = [], categories = [] }) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { catalogId } = useParams();
  const isEditMode = Boolean(catalogId);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectionMode, setSelectionMode] = useState('all');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [manualSearch, setManualSearch] = useState('');
  const [manualSelectedItemIds, setManualSelectedItemIds] = useState([]);
  const [visibility, setVisibility] = useState('public');
  const [accessCode, setAccessCode] = useState('');
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [createdCatalog, setCreatedCatalog] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [coverInputKey, setCoverInputKey] = useState(0);
  const [updatingCoverCatalogId, setUpdatingCoverCatalogId] = useState(null);
  const [removingCoverCatalogId, setRemovingCoverCatalogId] = useState(null);
  const [didHydrateEditState, setDidHydrateEditState] = useState(false);

  useEffect(() => {
    if (!coverFile) {
      setCoverPreviewUrl('');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(coverFile);
    setCoverPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [coverFile]);

  const categoryOptions = useMemo(() => {
    const names = new Set(
      [...categories.map((category) => category?.name), ...items.map((item) => item?.category)]
        .map((name) => (typeof name === 'string' ? name.trim() : ''))
        .filter(Boolean)
    );
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [categories, items]);

  const manualFilteredItems = useMemo(() => {
    const keyword = manualSearch.trim().toLowerCase();
    if (!keyword) return items;

    return items.filter((item) => {
      const itemName = (item?.name || '').toLowerCase();
      const itemCategory = (item?.category || '').toLowerCase();
      return itemName.includes(keyword) || itemCategory.includes(keyword);
    });
  }, [items, manualSearch]);

  const selectedItemIds = useMemo(() => {
    if (selectionMode === 'all') {
      return items.map((item) => item.id);
    }

    if (selectionMode === 'categories') {
      if (selectedCategories.length === 0) return [];
      const categorySet = new Set(selectedCategories);
      return items
        .filter((item) => item?.category && categorySet.has(item.category))
        .map((item) => item.id);
    }

    return manualSelectedItemIds;
  }, [items, manualSelectedItemIds, selectedCategories, selectionMode]);

  const selectedItemCount = selectedItemIds.length;
  const currentCoverPreview = coverPreviewUrl || coverImageUrl || '';

  const resetPendingCover = () => {
    setCoverFile(null);
    setCoverInputKey((prev) => prev + 1);
  };

  const validateCoverFile = (file) => {
    if (!file) return false;

    if (!COVER_ACCEPTED_TYPES.has(file.type)) {
      toast({
        title: 'Format gambar tidak disokong',
        description: 'Hanya JPG, PNG dan WEBP dibenarkan.',
        variant: 'destructive',
      });
      return false;
    }

    if ((file.size || 0) > COVER_MAX_BYTES) {
      toast({
        title: 'Saiz gambar terlalu besar',
        description: `Maksimum saiz fail ${COVER_MAX_MB_TEXT}.`,
        variant: 'destructive',
      });
      return false;
    }

    return true;
  };

  const compressCatalogCoverForTarget = async (file) => {
    const compressionProfiles = [
      { maxWidthOrHeight: 1920, initialQuality: 0.9 },
      { maxWidthOrHeight: 1600, initialQuality: 0.86 },
      { maxWidthOrHeight: 1440, initialQuality: 0.82 },
      { maxWidthOrHeight: 1280, initialQuality: 0.78 },
      { maxWidthOrHeight: 1080, initialQuality: 0.74 },
    ];

    let bestCandidate = null;

    for (const profile of compressionProfiles) {
      const candidate = await imageCompression(file, {
        maxSizeMB: COVER_TARGET_BYTES / (1024 * 1024),
        maxWidthOrHeight: profile.maxWidthOrHeight,
        useWebWorker: true,
        initialQuality: profile.initialQuality,
        maxIteration: 12,
        fileType: 'image/jpeg',
      });

      if (!bestCandidate || (candidate?.size || 0) < (bestCandidate?.size || Number.POSITIVE_INFINITY)) {
        bestCandidate = candidate;
      }

      if ((candidate?.size || 0) <= COVER_TARGET_BYTES) {
        bestCandidate = candidate;
        break;
      }
    }

    if (!bestCandidate) {
      throw new Error('Gagal memproses gambar cover.');
    }

    if ((bestCandidate.size || 0) > COVER_TARGET_BYTES) {
      throw new Error(
        `Gambar terlalu detail untuk target ${COVER_TARGET_TEXT}. Cuba crop lebih fokus atau guna gambar lebih ringkas.`
      );
    }

    return bestCandidate;
  };

  const uploadCatalogCover = async ({ catalogId, file }) => {
    const compressedFile = await compressCatalogCoverForTarget(file);

    const storagePath = `catalog-covers/${userId}/${catalogId}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(CATALOG_COVER_BUCKET)
      .upload(storagePath, compressedFile, {
        upsert: true,
        contentType: 'image/jpeg',
        cacheControl: '0',
      });

    if (uploadError) {
      throw new Error(`Gagal muat naik cover: ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabase.storage
      .from(CATALOG_COVER_BUCKET)
      .getPublicUrl(storagePath);

    const nextUrl = publicUrlData?.publicUrl || '';
    if (!nextUrl) {
      throw new Error('URL cover tidak dapat dijana.');
    }

    return nextUrl;
  };

  const removeCatalogCoverFromStorage = async (coverUrl) => {
    const storagePath = extractStoragePathFromPublicUrl(coverUrl);
    if (!storagePath) return;

    const { error } = await supabase.storage
      .from(CATALOG_COVER_BUCKET)
      .remove([storagePath]);

    if (error && !/not found/i.test(error.message || '')) {
      throw new Error(`Gagal buang cover dari storage: ${error.message}`);
    }
  };

  const {
    data: catalogList = [],
    isLoading: isCatalogListLoading,
    refetch: refetchCatalogList,
  } = useQuery({
    queryKey: ['catalog-list', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('catalogs')
        .select('id, title, description, cover_image_url, public_code, selection_type, selected_categories, visibility, access_code, expires_at, is_active, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const {
    data: editCatalogData,
    isLoading: isEditCatalogLoading,
  } = useQuery({
    queryKey: ['catalog-edit', userId, catalogId],
    queryFn: async () => {
      if (!userId || !catalogId) return null;

      const { data: catalog, error: catalogError } = await supabase
        .from('catalogs')
        .select('id, title, description, cover_image_url, selection_type, selected_categories, visibility, access_code, expires_at, is_active')
        .eq('id', catalogId)
        .eq('user_id', userId)
        .maybeSingle();

      if (catalogError) throw catalogError;
      if (!catalog) return null;

      const { data: mappings, error: mappingError } = await supabase
        .from('catalog_items')
        .select('item_id')
        .eq('catalog_id', catalogId);

      if (mappingError) throw mappingError;

      return {
        ...catalog,
        item_ids: (mappings || []).map((entry) => entry.item_id).filter(Boolean),
      };
    },
    enabled: isEditMode && !!userId && !!catalogId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!isEditMode || !editCatalogData || didHydrateEditState) return;

    const normalizedSelectionTypeRaw = (editCatalogData.selection_type || 'manual').toLowerCase();
    const normalizedSelectionType = normalizedSelectionTypeRaw === 'category'
      ? 'categories'
      : normalizedSelectionTypeRaw;
    const itemIds = Array.isArray(editCatalogData.item_ids) ? editCatalogData.item_ids : [];
    const categoryRules = Array.isArray(editCatalogData.selected_categories)
      ? editCatalogData.selected_categories.filter((name) => typeof name === 'string' && name.trim())
      : [];

    if (normalizedSelectionType === 'categories' && categoryRules.length === 0 && itemIds.length > 0 && items.length === 0) {
      return;
    }

    setTitle(editCatalogData.title || '');
    setDescription(editCatalogData.description || '');
    setSelectionMode(normalizedSelectionType);
    setVisibility(editCatalogData.visibility === 'unlisted' ? 'unlisted' : 'public');
    setAccessCode(editCatalogData.access_code || '');
    setHasExpiry(Boolean(editCatalogData.expires_at));
    setExpiresAt(editCatalogData.expires_at ? new Date(editCatalogData.expires_at).toISOString().slice(0, 16) : '');
    setCoverImageUrl(editCatalogData.cover_image_url || '');
    setCoverFile(null);
    setCoverInputKey((prev) => prev + 1);

    if (normalizedSelectionType === 'manual') {
      setManualSelectedItemIds(itemIds);
      setSelectedCategories([]);
    } else if (normalizedSelectionType === 'categories') {
      const derivedCategories = categoryRules.length > 0
        ? categoryRules
        : Array.from(new Set(
          items
            .filter((item) => itemIds.includes(item.id))
            .map((item) => (typeof item?.category === 'string' ? item.category.trim() : ''))
            .filter(Boolean)
        ));
      setSelectedCategories(derivedCategories);
      setManualSelectedItemIds(itemIds);
    } else {
      setSelectedCategories([]);
      setManualSelectedItemIds(itemIds);
    }

    setDidHydrateEditState(true);
  }, [didHydrateEditState, editCatalogData, isEditMode, items]);

  useEffect(() => {
    setDidHydrateEditState(false);
  }, [catalogId]);

  const createCatalogMutation = useMutation({
    mutationFn: async () => {
      const normalizedTitle = title.trim();
      const normalizedDescription = description.trim();
      const normalizedVisibility = visibility === 'unlisted' ? 'unlisted' : 'public';
      const normalizedSelectionType = selectionMode === 'category' ? 'categories' : selectionMode;
      const normalizedAccessCode = normalizedVisibility === 'unlisted'
        ? (accessCode.trim().toUpperCase() || generateAccessCode())
        : null;
      const normalizedExpiresAt = hasExpiry ? expiresAt : null;
      const normalizedSelectedCategories = normalizedSelectionType === 'categories'
        ? selectedCategories
            .map((name) => (typeof name === 'string' ? name.trim() : ''))
            .filter(Boolean)
        : [];

      if (!userId) throw new Error('Sesi pengguna tidak sah');
      if (!normalizedTitle) throw new Error('Tajuk katalog diperlukan');
      if (selectedItemIds.length === 0) throw new Error('Pilih sekurang-kurangnya satu item');
      if (normalizedVisibility === 'unlisted' && normalizedAccessCode.length < 6) {
        throw new Error('Access code unlisted mesti sekurang-kurangnya 6 aksara.');
      }
      if (hasExpiry && !normalizedExpiresAt) {
        throw new Error('Sila pilih tarikh tamat tempoh.');
      }

      const { data: catalogData, error: catalogError } = await supabase
        .from('catalogs')
        .insert({
          user_id: userId,
          title: normalizedTitle,
          description: normalizedDescription || null,
          selection_type: normalizedSelectionType,
          selected_categories: normalizedSelectedCategories,
          visibility: normalizedVisibility,
          access_code: normalizedAccessCode,
          expires_at: normalizedExpiresAt || null,
          is_active: true,
        })
        .select('id, title, description, cover_image_url, public_code, selection_type, selected_categories, visibility, access_code, expires_at, is_active, created_at')
        .single();

      if (catalogError) {
        if (catalogError.code === '23505') {
          throw new Error('Kod pautan telah digunakan. Sila guna kod lain.');
        }
        throw new Error(`Gagal mencipta katalog: ${catalogError.message}`);
      }

      let uploadedCoverUrl = null;
      if (coverFile) {
        uploadedCoverUrl = await uploadCatalogCover({
          catalogId: catalogData.id,
          file: coverFile,
        });

        const { error: coverUpdateError } = await supabase
          .from('catalogs')
          .update({ cover_image_url: uploadedCoverUrl })
          .eq('id', catalogData.id)
          .eq('user_id', userId);

        if (coverUpdateError) {
          try {
            await removeCatalogCoverFromStorage(uploadedCoverUrl);
          } catch (cleanupError) {
            console.error('[CatalogCreatePage] Failed to cleanup cover after update error:', cleanupError);
          }
          throw new Error(`Cover berjaya dimuat naik tetapi gagal disimpan: ${coverUpdateError.message}`);
        }

        catalogData.cover_image_url = uploadedCoverUrl;
      }

      const mappings = selectedItemIds.map((itemId) => ({
        catalog_id: catalogData.id,
        item_id: itemId,
      }));

      const { error: mapError } = await supabase
        .from('catalog_items')
        .insert(mappings);

      if (mapError) {
        if (uploadedCoverUrl) {
          try {
            await removeCatalogCoverFromStorage(uploadedCoverUrl);
          } catch (cleanupError) {
            console.error('[CatalogCreatePage] Failed to cleanup uploaded cover:', cleanupError);
          }
        }
        await supabase.from('catalogs').delete().eq('id', catalogData.id);
        throw new Error(`Katalog dicipta tetapi item gagal ditambah: ${mapError.message}`);
      }

      return {
        ...catalogData,
        item_count: mappings.length,
      };
    },
    onSuccess: (catalog) => {
      setCreatedCatalog(catalog);
      resetPendingCover();
      queryClient.invalidateQueries({ queryKey: ['catalog-list', userId] });
      refetchCatalogList();
      toast({
        title: 'Katalog berjaya dicipta',
        description: `${catalog.item_count} item dimasukkan ke dalam katalog.`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Gagal mencipta katalog',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateCatalogMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !catalogId) throw new Error('Katalog tidak sah');
      if (!didHydrateEditState) throw new Error('Data katalog belum siap dimuatkan');

      const normalizedTitle = title.trim();
      const normalizedDescription = description.trim();
      const normalizedSelectionType = selectionMode === 'category' ? 'categories' : selectionMode;
      const normalizedSelectedCategories = normalizedSelectionType === 'categories'
        ? selectedCategories
            .map((name) => (typeof name === 'string' ? name.trim() : ''))
            .filter(Boolean)
        : [];
      const normalizedVisibility = visibility === 'unlisted' ? 'unlisted' : 'public';
      const normalizedAccessCode = normalizedVisibility === 'unlisted'
        ? (accessCode.trim().toUpperCase() || generateAccessCode())
        : null;
      const normalizedExpiresAt = hasExpiry ? expiresAt : null;

      if (!normalizedTitle) throw new Error('Tajuk katalog diperlukan');
      if (selectedItemIds.length === 0) throw new Error('Pilih sekurang-kurangnya satu item');

      const originalCoverUrl = editCatalogData?.cover_image_url || '';
      let nextCoverUrl = coverImageUrl || null;
      let shouldDeleteOriginalCoverAfterSave = false;
      const shouldCleanupUploadedCoverOnFailure = Boolean(coverFile) && !originalCoverUrl;

      if (coverFile) {
        nextCoverUrl = await uploadCatalogCover({
          catalogId,
          file: coverFile,
        });
      } else if (!nextCoverUrl && originalCoverUrl) {
        shouldDeleteOriginalCoverAfterSave = true;
      }
      try {
        const rpcItemIds = normalizedSelectionType === 'manual' ? selectedItemIds : [];
        const { data: rpcRows, error: rpcError } = await supabase.rpc('update_catalog_with_items', {
          p_catalog_id: catalogId,
          p_user_id: userId,
          p_title: normalizedTitle,
          p_description: normalizedDescription || null,
          p_selection_type: normalizedSelectionType,
          p_selected_categories: normalizedSelectedCategories,
          p_item_ids: rpcItemIds,
          p_visibility: normalizedVisibility,
          p_access_code: normalizedAccessCode,
          p_expires_at: normalizedExpiresAt || null,
          p_cover_image_url: nextCoverUrl || null,
        });

        if (rpcError) {
          throw new Error(`Gagal kemas kini katalog: ${rpcError.message}`);
        }

        const rpcResult = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
        if (!rpcResult?.success) {
          throw new Error(rpcResult?.message || 'Gagal kemas kini katalog');
        }

        if (shouldDeleteOriginalCoverAfterSave) {
          try {
            await removeCatalogCoverFromStorage(originalCoverUrl);
          } catch (cleanupError) {
            console.warn('[CatalogCreatePage] Failed to cleanup old cover after save:', cleanupError);
          }
        }

        return {
          ...rpcResult,
          cover_image_url: nextCoverUrl || null,
        };
      } catch (error) {
        if (shouldCleanupUploadedCoverOnFailure && nextCoverUrl) {
          try {
            await removeCatalogCoverFromStorage(nextCoverUrl);
          } catch (cleanupError) {
            console.warn('[CatalogCreatePage] Failed to cleanup uploaded cover after save error:', cleanupError);
          }
        }
        throw error;
      }
    },
    onSuccess: (result) => {
      setCoverImageUrl(result?.cover_image_url || '');
      resetPendingCover();
      queryClient.invalidateQueries({ queryKey: ['catalog-list', userId] });
      queryClient.invalidateQueries({ queryKey: ['catalog-edit', userId, catalogId] });
      toast({
        title: 'Katalog berjaya dikemaskini',
        description: `${result?.item_count ?? selectedItemIds.length} item dalam katalog.`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Gagal kemas kini katalog',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const deleteCatalogMutation = useMutation({
    mutationFn: async ({ catalogId }) => {
      if (!userId) throw new Error('Sesi pengguna tidak sah');
      const { error } = await supabase
        .from('catalogs')
        .delete()
        .eq('id', catalogId)
        .eq('user_id', userId);

      if (error) {
        throw new Error(`Gagal memadam katalog: ${error.message}`);
      }
      return catalogId;
    },
    onSuccess: (deletedId) => {
      if (createdCatalog?.id === deletedId) {
        setCreatedCatalog(null);
      }
      queryClient.invalidateQueries({ queryKey: ['catalog-list', userId] });
      refetchCatalogList();
      toast({ title: 'Link katalog berjaya dipadam' });
    },
    onError: (error) => {
      toast({
        title: 'Gagal memadam link katalog',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const shareUrl = createdCatalog ? `${window.location.origin}/cat/${createdCatalog.public_code}` : '';
  const deletingCatalogId = deleteCatalogMutation.isPending ? deleteCatalogMutation.variables?.catalogId : null;

  const toggleCategory = (categoryName) => {
    setSelectedCategories((prev) => (
      prev.includes(categoryName)
        ? prev.filter((name) => name !== categoryName)
        : [...prev, categoryName]
    ));
  };

  const toggleManualItem = (itemId) => {
    setManualSelectedItemIds((prev) => (
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId]
    ));
  };

  const selectAllFilteredManual = () => {
    setManualSelectedItemIds((prev) => {
      const next = new Set(prev);
      manualFilteredItems.forEach((item) => next.add(item.id));
      return Array.from(next);
    });
  };

  const clearFilteredManual = () => {
    const filteredIds = new Set(manualFilteredItems.map((item) => item.id));
    setManualSelectedItemIds((prev) => prev.filter((id) => !filteredIds.has(id)));
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({ title: 'Pautan berjaya disalin' });
    } catch (error) {
      toast({
        title: 'Gagal menyalin pautan',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleCopySpecificLink = async (publicCode) => {
    const url = `${window.location.origin}/cat/${publicCode}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Pautan berjaya disalin' });
    } catch (error) {
      toast({
        title: 'Gagal menyalin pautan',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleDeleteCatalog = (catalog) => {
    if (!catalog?.id) return;

    const confirmed = window.confirm(
      `Padam link katalog "${catalog.title || 'Katalog'}"? Tindakan ini tidak boleh dibatalkan.`
    );

    if (!confirmed) return;

    deleteCatalogMutation.mutate({ catalogId: catalog.id });
  };

  const handleEditCatalog = (catalog) => {
    if (!catalog?.id) return;
    navigate(`/inventory/catalogs/${catalog.id}/edit`);
  };

  const handleVisibilityChange = (nextVisibility) => {
    const normalized = nextVisibility === 'unlisted' ? 'unlisted' : 'public';
    setVisibility(normalized);

    if (normalized === 'unlisted' && !accessCode) {
      setAccessCode(generateAccessCode());
    }

    if (normalized === 'public') {
      setAccessCode('');
    }
  };

  const handleGenerateAccessCode = () => {
    setAccessCode(generateAccessCode());
  };

  const handleCopyAccessCode = async (codeValue) => {
    const nextCode = (codeValue || '').trim();
    if (!nextCode) return;

    try {
      await navigator.clipboard.writeText(nextCode);
      toast({ title: 'Access code berjaya disalin' });
    } catch (error) {
      toast({
        title: 'Gagal menyalin access code',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handlePendingCoverChange = (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;

    if (!validateCoverFile(file)) {
      event.target.value = '';
      return;
    }

    setCoverFile(file);
  };

  const handleReplaceCatalogCover = async (catalog, file) => {
    if (!catalog?.id || !file) return;
    if (!validateCoverFile(file)) return;

    setUpdatingCoverCatalogId(catalog.id);
    try {
      const nextCoverUrl = await uploadCatalogCover({
        catalogId: catalog.id,
        file,
      });

      const { error: updateError } = await supabase
        .from('catalogs')
        .update({ cover_image_url: nextCoverUrl })
        .eq('id', catalog.id)
        .eq('user_id', userId);

      if (updateError) {
        throw new Error(`Gagal kemas kini cover: ${updateError.message}`);
      }

      if (createdCatalog?.id === catalog.id) {
        setCreatedCatalog((prev) => (prev ? { ...prev, cover_image_url: nextCoverUrl } : prev));
      }

      queryClient.invalidateQueries({ queryKey: ['catalog-list', userId] });
      refetchCatalogList();
      toast({ title: 'Cover katalog berjaya dikemaskini' });
    } catch (error) {
      toast({
        title: 'Gagal kemas kini cover katalog',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setUpdatingCoverCatalogId(null);
    }
  };

  const handleRemoveCatalogCover = async (catalog) => {
    if (!catalog?.id || !catalog?.cover_image_url) return;

    const confirmed = window.confirm(`Buang cover untuk katalog "${catalog.title || 'Katalog'}"?`);
    if (!confirmed) return;

    setRemovingCoverCatalogId(catalog.id);
    try {
      await removeCatalogCoverFromStorage(catalog.cover_image_url);

      const { error: updateError } = await supabase
        .from('catalogs')
        .update({ cover_image_url: null })
        .eq('id', catalog.id)
        .eq('user_id', userId);

      if (updateError) {
        throw new Error(`Gagal buang cover: ${updateError.message}`);
      }

      if (createdCatalog?.id === catalog.id) {
        setCreatedCatalog((prev) => (prev ? { ...prev, cover_image_url: null } : prev));
      }

      queryClient.invalidateQueries({ queryKey: ['catalog-list', userId] });
      refetchCatalogList();
      toast({ title: 'Cover katalog dibuang' });
    } catch (error) {
      toast({
        title: 'Gagal buang cover katalog',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setRemovingCoverCatalogId(null);
    }
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/inventory');
  };

  if (isEditMode && isEditCatalogLoading) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">Edit Katalog</h1>
        <Card>
          <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuatkan katalog...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isEditMode && !isEditCatalogLoading && !editCatalogData) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">Edit Katalog</h1>
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm text-muted-foreground">Katalog tidak ditemui atau anda tiada akses.</p>
            <Button type="button" variant="outline" onClick={handleBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Kembali
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (createdCatalog) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">Katalog</h1>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
              Katalog Berjaya Dicipta
            </CardTitle>
            <CardDescription>
              Kongsi pautan ini untuk paparkan katalog kepada pelanggan tanpa login.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pautan Katalog</p>
              <p className="mt-2 break-all text-sm font-medium text-foreground">{shareUrl}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-1 font-medium ${createdCatalog?.visibility === 'unlisted' ? 'bg-violet-100 text-violet-800' : 'bg-sky-100 text-sky-800'}`}>
                  {createdCatalog?.visibility === 'unlisted' ? 'Unlisted' : 'Public'}
                </span>
                {createdCatalog?.expires_at && (
                  <span className="rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-800">
                    Tamat: {new Date(createdCatalog.expires_at).toLocaleString('ms-MY')}
                  </span>
                )}
              </div>
              {createdCatalog?.visibility === 'unlisted' && createdCatalog?.access_code && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold tracking-wider text-slate-700">
                    Code: {createdCatalog.access_code}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleCopyAccessCode(createdCatalog.access_code)}
                  >
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    Salin Code
                  </Button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Kembali
              </Button>
              <Button type="button" variant="outline" onClick={handleCopyLink}>
                <Copy className="mr-2 h-4 w-4" />
                Salin Pautan
              </Button>
              <Button type="button" variant="outline" onClick={() => window.open(shareUrl, '_blank', 'noopener,noreferrer')}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Buka Katalog
              </Button>
                <Button
                type="button"
                onClick={() => {
                  setCreatedCatalog(null);
                  setTitle('');
                  setDescription('');
                  setSelectionMode('all');
                  setSelectedCategories([]);
                  setManualSearch('');
                  setManualSelectedItemIds([]);
                  setVisibility('public');
                  setAccessCode('');
                  setHasExpiry(false);
                  setExpiresAt('');
                  setCoverImageUrl('');
                  resetPendingCover();
                }}
              >
                Cipta Katalog Baru
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Senarai Link Katalog</CardTitle>
          </CardHeader>
          <CardContent>
            {isCatalogListLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Memuatkan senarai katalog...
              </div>
            ) : catalogList.length === 0 ? (
              <p className="rounded border border-dashed p-4 text-sm text-muted-foreground">
                Belum ada katalog dicipta.
              </p>
            ) : (
              <div className="space-y-3">
                {catalogList.map((catalog) => {
                  const publicUrl = `${window.location.origin}/cat/${catalog.public_code}`;
                  const catalogStatus = getCatalogStatus(catalog);
                  const isUpdatingCover = updatingCoverCatalogId === catalog.id;
                  const isRemovingCover = removingCoverCatalogId === catalog.id;
                  return (
                    <div
                      key={catalog.id}
                      className="flex flex-col gap-3 rounded-lg border bg-muted/10 p-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                          <div className="h-16 w-full overflow-hidden rounded-lg border bg-muted/20 sm:w-28">
                            {catalog.cover_image_url ? (
                              <img
                                src={catalog.cover_image_url}
                                alt={`Cover ${catalog.title || 'Katalog'}`}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                                Tiada Cover
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{catalog.title}</p>
                            <p className="truncate text-xs text-muted-foreground">{publicUrl}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                              <span className={`rounded-full px-2 py-0.5 font-medium ${catalog.visibility === 'unlisted' ? 'bg-violet-100 text-violet-800' : 'bg-sky-100 text-sky-800'}`}>
                                {catalog.visibility === 'unlisted' ? 'Unlisted' : 'Public'}
                              </span>
                              <span className={`rounded-full px-2 py-0.5 font-medium ${catalogStatus.className}`}>
                                {catalogStatus.label}
                              </span>
                              {catalog.expires_at ? (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                                  Tamat: {new Date(catalog.expires_at).toLocaleString('ms-MY')}
                                </span>
                              ) : null}
                            </div>
                            {catalog.visibility === 'unlisted' && catalog.access_code ? (
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                                <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold tracking-wider text-slate-700">
                                  Code: {catalog.access_code}
                                </span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCopyAccessCode(catalog.access_code)}
                                >
                                  <Copy className="mr-1 h-3.5 w-3.5" />
                                  Salin Code
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <input
                          id={`catalog-cover-upload-${catalog.id}`}
                          type="file"
                          className="hidden"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (!file) return;
                            handleReplaceCatalogCover(catalog, file);
                          }}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => document.getElementById(`catalog-cover-upload-${catalog.id}`)?.click()}
                          disabled={isUpdatingCover || isRemovingCover}
                        >
                          {isUpdatingCover ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ImagePlus className="mr-1 h-3.5 w-3.5" />
                          )}
                          {catalog.cover_image_url ? 'Ganti Cover' : 'Tambah Cover'}
                        </Button>
                        {catalog.cover_image_url ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => handleRemoveCatalogCover(catalog)}
                            disabled={isUpdatingCover || isRemovingCover}
                          >
                            {isRemovingCover ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="mr-1 h-3.5 w-3.5" />
                            )}
                            Buang Cover
                          </Button>
                        ) : null}
                        <Button type="button" size="sm" variant="outline" onClick={() => handleEditCatalog(catalog)}>
                          Edit
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => handleCopySpecificLink(catalog.public_code)}>
                          <Copy className="mr-1 h-3.5 w-3.5" />
                          Salin
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(publicUrl, '_blank', 'noopener,noreferrer')}
                        >
                          <ExternalLink className="mr-1 h-3.5 w-3.5" />
                          Buka
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => handleDeleteCatalog(catalog)}
                          disabled={deleteCatalogMutation.isPending}
                        >
                          {deletingCatalogId === catalog.id ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                          )}
                          Padam
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">{isEditMode ? 'Edit Katalog' : 'Cipta Katalog'}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{isEditMode ? 'Kemaskini Maklumat Katalog' : 'Maklumat Katalog'}</CardTitle>
          <CardDescription>
            {isEditMode
              ? 'Kemaskini metadata, cover dan peraturan pemilihan item katalog.'
              : 'Pilih item inventori untuk dijadikan katalog awam.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="catalog-title" className="mb-1 block text-sm font-medium text-muted-foreground">
              Tajuk Katalog
            </label>
            <Input
              id="catalog-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Contoh: Katalog Mainan Februari 2026"
            />
          </div>

          <div>
            <label htmlFor="catalog-description" className="mb-1 block text-sm font-medium text-muted-foreground">
              Deskripsi (Opsyenal)
            </label>
            <textarea
              id="catalog-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Ringkasan pendek untuk pelanggan."
              className="min-h-[90px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Background Katalog (Optional)</p>
              <p className="text-xs text-muted-foreground">
                Gambar ini akan dipaparkan di bahagian atas katalog sebagai identiti kedai.
              </p>
            </div>

            {currentCoverPreview ? (
              <div className="overflow-hidden rounded-lg border bg-muted/20">
                <img
                  src={currentCoverPreview}
                  alt="Pratonton background katalog"
                  className="h-32 w-full object-cover"
                />
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center rounded-lg border border-dashed bg-muted/20 text-sm text-muted-foreground">
                Tiada background dipilih
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <label
                htmlFor="catalog-cover-upload"
                className="inline-flex cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
              >
                <ImagePlus className="mr-2 h-4 w-4" />
                {currentCoverPreview ? 'Ganti Gambar' : 'Muat Naik Gambar'}
              </label>
              {currentCoverPreview ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    resetPendingCover();
                    setCoverImageUrl('');
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Buang
                </Button>
              ) : null}
              <Input
                key={`catalog-cover-${coverInputKey}`}
                id="catalog-cover-upload"
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePendingCoverChange}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Format: JPG, PNG, WEBP. Maksimum {COVER_MAX_MB_TEXT}. Auto compress target {COVER_TARGET_TEXT} untuk kekalkan visual tajam.
            </p>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-sm font-medium text-foreground">Akses Katalog</p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="cursor-pointer rounded-lg border p-3 text-sm">
                <input
                  type="radio"
                  name="catalog-visibility"
                  value="public"
                  checked={visibility === 'public'}
                  onChange={(event) => handleVisibilityChange(event.target.value)}
                  className="mr-2"
                />
                Public
              </label>
              <label className="cursor-pointer rounded-lg border p-3 text-sm">
                <input
                  type="radio"
                  name="catalog-visibility"
                  value="unlisted"
                  checked={visibility === 'unlisted'}
                  onChange={(event) => handleVisibilityChange(event.target.value)}
                  className="mr-2"
                />
                Unlisted (guna access code)
              </label>
            </div>

            {visibility === 'unlisted' && (
              <div className="space-y-2">
                <label htmlFor="catalog-access-code" className="block text-xs font-medium text-muted-foreground">
                  Access Code
                </label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="catalog-access-code"
                    value={accessCode}
                    onChange={(event) => setAccessCode(event.target.value.toUpperCase())}
                    placeholder="Access code"
                    className="max-w-xs"
                  />
                  <Button type="button" variant="outline" onClick={handleGenerateAccessCode}>
                    Jana Semula Code
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Buyer perlu masukkan code ini untuk buka katalog.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={hasExpiry}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setHasExpiry(checked);
                    if (!checked) {
                      setExpiresAt('');
                    }
                  }}
                />
                Set tamat tempoh
              </label>
              {hasExpiry && (
                <Input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  className="max-w-xs"
                />
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">Link katalog dijana automatik dengan kod rawak untuk keselamatan.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pilih Item</CardTitle>
          <CardDescription>
            Pilih mode pemilihan item: semua, ikut kategori, atau manual.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="cursor-pointer rounded-lg border p-3 text-sm">
              <input
                type="radio"
                name="catalog-selection-mode"
                value="all"
                checked={selectionMode === 'all'}
                onChange={(event) => setSelectionMode(event.target.value)}
                className="mr-2"
              />
              Semua Item
            </label>
            <label className="cursor-pointer rounded-lg border p-3 text-sm">
              <input
                type="radio"
                name="catalog-selection-mode"
                value="categories"
                checked={selectionMode === 'categories'}
                onChange={(event) => setSelectionMode(event.target.value)}
                className="mr-2"
              />
              Ikut Kategori
            </label>
            <label className="cursor-pointer rounded-lg border p-3 text-sm">
              <input
                type="radio"
                name="catalog-selection-mode"
                value="manual"
                checked={selectionMode === 'manual'}
                onChange={(event) => setSelectionMode(event.target.value)}
                className="mr-2"
              />
              Pilih Manual
            </label>
          </div>

          {selectionMode === 'all' && (
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              Semua item inventori akan dimasukkan. Jumlah item: <span className="font-semibold">{items.length}</span>
            </div>
          )}

          {selectionMode === 'categories' && (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm font-medium">Pilih satu atau lebih kategori</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {categoryOptions.map((categoryName) => (
                  <label key={categoryName} className="flex items-start gap-2 rounded border p-2 text-sm">
                    <Checkbox
                      checked={selectedCategories.includes(categoryName)}
                      onCheckedChange={() => toggleCategory(categoryName)}
                    />
                    <span>{categoryName}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {selectionMode === 'manual' && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={manualSearch}
                  onChange={(event) => setManualSearch(event.target.value)}
                  placeholder="Cari item atau kategori..."
                  className="pl-9"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={selectAllFilteredManual}>
                  Select All Filtered
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={clearFilteredManual}>
                  Clear Filtered
                </Button>
              </div>

              <div className="max-h-80 space-y-2 overflow-auto pr-1">
                {manualFilteredItems.map((item) => (
                  <label key={item.id} className="flex items-start justify-between gap-3 rounded border p-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <Checkbox
                        checked={manualSelectedItemIds.includes(item.id)}
                        onCheckedChange={() => toggleManualItem(item.id)}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{item.category || 'Tiada kategori'}</p>
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <p className="font-semibold">RM {formatCurrency(item.selling_price || 0)}</p>
                      <p className="text-muted-foreground">Avail: {getAvailableQuantity(item)}</p>
                    </div>
                  </label>
                ))}
                {manualFilteredItems.length === 0 && (
                  <p className="rounded border border-dashed p-4 text-center text-sm text-muted-foreground">
                    Tiada item sepadan carian.
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Jumlah item dipilih</p>
            <p className="text-2xl font-bold">{selectedItemCount}</p>
          </div>
          <Button
            type="button"
            className="brand-gradient brand-gradient-hover text-white"
            onClick={() => {
              if (isEditMode) {
                updateCatalogMutation.mutate();
                return;
              }
              createCatalogMutation.mutate();
            }}
            disabled={createCatalogMutation.isPending || updateCatalogMutation.isPending}
          >
            {createCatalogMutation.isPending || updateCatalogMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isEditMode ? 'Menyimpan Perubahan...' : 'Mencipta Katalog...'}
              </>
            ) : (
              <>
                <Link2 className="mr-2 h-4 w-4" />
                {isEditMode ? 'Simpan Perubahan Katalog' : 'Cipta Katalog & Dapatkan Pautan'}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Senarai Link Katalog</CardTitle>
          <CardDescription>Semua link katalog yang telah dicipta.</CardDescription>
        </CardHeader>
        <CardContent>
          {isCatalogListLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Memuatkan senarai katalog...
            </div>
          ) : catalogList.length === 0 ? (
            <p className="rounded border border-dashed p-4 text-sm text-muted-foreground">
              Belum ada katalog dicipta.
            </p>
          ) : (
            <div className="space-y-3">
              {catalogList.map((catalog) => {
                const publicUrl = `${window.location.origin}/cat/${catalog.public_code}`;
                const catalogStatus = getCatalogStatus(catalog);
                const isUpdatingCover = updatingCoverCatalogId === catalog.id;
                const isRemovingCover = removingCoverCatalogId === catalog.id;
                return (
                  <div
                    key={catalog.id}
                    className="flex flex-col gap-3 rounded-lg border bg-muted/10 p-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                        <div className="h-16 w-full overflow-hidden rounded-lg border bg-muted/20 sm:w-28">
                          {catalog.cover_image_url ? (
                            <img
                              src={catalog.cover_image_url}
                              alt={`Cover ${catalog.title || 'Katalog'}`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                              Tiada Cover
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{catalog.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{publicUrl}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                            <span className={`rounded-full px-2 py-0.5 font-medium ${catalog.visibility === 'unlisted' ? 'bg-violet-100 text-violet-800' : 'bg-sky-100 text-sky-800'}`}>
                              {catalog.visibility === 'unlisted' ? 'Unlisted' : 'Public'}
                            </span>
                            <span className={`rounded-full px-2 py-0.5 font-medium ${catalogStatus.className}`}>
                              {catalogStatus.label}
                            </span>
                            {catalog.expires_at ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                                Tamat: {new Date(catalog.expires_at).toLocaleString('ms-MY')}
                              </span>
                            ) : null}
                          </div>
                          {catalog.visibility === 'unlisted' && catalog.access_code ? (
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                              <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold tracking-wider text-slate-700">
                                Code: {catalog.access_code}
                              </span>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => handleCopyAccessCode(catalog.access_code)}
                              >
                                <Copy className="mr-1 h-3.5 w-3.5" />
                                Salin Code
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        id={`catalog-cover-upload-${catalog.id}`}
                        type="file"
                        className="hidden"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          if (!file) return;
                          handleReplaceCatalogCover(catalog, file);
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => document.getElementById(`catalog-cover-upload-${catalog.id}`)?.click()}
                        disabled={isUpdatingCover || isRemovingCover}
                      >
                        {isUpdatingCover ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ImagePlus className="mr-1 h-3.5 w-3.5" />
                        )}
                        {catalog.cover_image_url ? 'Ganti Cover' : 'Tambah Cover'}
                      </Button>
                      {catalog.cover_image_url ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => handleRemoveCatalogCover(catalog)}
                          disabled={isUpdatingCover || isRemovingCover}
                        >
                          {isRemovingCover ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                          )}
                          Buang Cover
                        </Button>
                      ) : null}
                      <Button type="button" size="sm" variant="outline" onClick={() => handleEditCatalog(catalog)}>
                        Edit
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => handleCopySpecificLink(catalog.public_code)}>
                        <Copy className="mr-1 h-3.5 w-3.5" />
                        Salin
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(publicUrl, '_blank', 'noopener,noreferrer')}
                      >
                        <ExternalLink className="mr-1 h-3.5 w-3.5" />
                        Buka
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => handleDeleteCatalog(catalog)}
                        disabled={deleteCatalogMutation.isPending}
                      >
                        {deletingCatalogId === catalog.id ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                        )}
                        Padam
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CatalogCreatePage;
