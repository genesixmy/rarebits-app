import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { formatCurrency } from '@/lib/utils';
import { supabase } from '@/lib/customSupabaseClient';
import { ArrowLeft, CheckCircle2, Copy, ExternalLink, Link2, Loader2, Search, Trash2 } from 'lucide-react';

const ACCESS_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

    if (selectionMode === 'category') {
      if (selectedCategories.length === 0) return [];
      const categorySet = new Set(selectedCategories);
      return items
        .filter((item) => item?.category && categorySet.has(item.category))
        .map((item) => item.id);
    }

    return manualSelectedItemIds;
  }, [items, manualSelectedItemIds, selectedCategories, selectionMode]);

  const selectedItemCount = selectedItemIds.length;

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
        .select('id, title, description, public_code, selection_type, visibility, access_code, expires_at, is_active, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const createCatalogMutation = useMutation({
    mutationFn: async () => {
      const normalizedTitle = title.trim();
      const normalizedDescription = description.trim();
      const normalizedVisibility = visibility === 'unlisted' ? 'unlisted' : 'public';
      const normalizedAccessCode = normalizedVisibility === 'unlisted'
        ? (accessCode.trim().toUpperCase() || generateAccessCode())
        : null;
      const normalizedExpiresAt = hasExpiry ? expiresAt : null;

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
          selection_type: selectionMode,
          visibility: normalizedVisibility,
          access_code: normalizedAccessCode,
          expires_at: normalizedExpiresAt || null,
          is_active: true,
        })
        .select('id, title, description, public_code, visibility, access_code, expires_at, is_active, created_at')
        .single();

      if (catalogError) {
        if (catalogError.code === '23505') {
          throw new Error('Kod pautan telah digunakan. Sila guna kod lain.');
        }
        throw new Error(`Gagal mencipta katalog: ${catalogError.message}`);
      }

      const mappings = selectedItemIds.map((itemId) => ({
        catalog_id: catalogData.id,
        item_id: itemId,
      }));

      const { error: mapError } = await supabase
        .from('catalog_items')
        .insert(mappings);

      if (mapError) {
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

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/inventory');
  };

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
                  return (
                    <div
                      key={catalog.id}
                      className="flex flex-col gap-3 rounded-lg border bg-muted/10 p-3 md:flex-row md:items-center md:justify-between"
                    >
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
                      <div className="flex flex-wrap gap-2">
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
      <h1 className="page-title">Cipta Katalog</h1>

      <Card>
        <CardHeader>
          <CardTitle>Maklumat Katalog</CardTitle>
          <CardDescription>Pilih item inventori untuk dijadikan katalog awam.</CardDescription>
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
                value="category"
                checked={selectionMode === 'category'}
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

          {selectionMode === 'category' && (
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
            onClick={() => createCatalogMutation.mutate()}
            disabled={createCatalogMutation.isPending}
          >
            {createCatalogMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Mencipta Katalog...
              </>
            ) : (
              <>
                <Link2 className="mr-2 h-4 w-4" />
                Cipta Katalog & Dapatkan Pautan
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
                return (
                  <div
                    key={catalog.id}
                    className="flex flex-col gap-3 rounded-lg border bg-muted/10 p-3 md:flex-row md:items-center md:justify-between"
                  >
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
                    <div className="flex flex-wrap gap-2">
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
