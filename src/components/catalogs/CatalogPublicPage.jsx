import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Loader2, PackageOpen, Search, Send } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { formatCurrency } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const normalizeWhatsAppPhone = (phoneValue) => {
  if (typeof phoneValue !== 'string') return '';
  const trimmed = phoneValue.trim();
  if (!trimmed) return '';

  const keepDigitsAndPlus = trimmed.replace(/[^\d+]/g, '');
  const withoutLeadingPlus = keepDigitsAndPlus.startsWith('+')
    ? keepDigitsAndPlus.slice(1)
    : keepDigitsAndPlus;

  return withoutLeadingPlus.replace(/\D/g, '');
};

const getItemAvailableQuantity = (item) => {
  const rawValue = parseInt(item?.available_quantity, 10);
  return Number.isNaN(rawValue) ? 0 : Math.max(rawValue, 0);
};

const getContrastTextColor = (hexColor) => {
  if (typeof hexColor !== 'string') return '#ffffff';
  const normalized = hexColor.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return '#ffffff';

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);
  return luminance > 150 ? '#111827' : '#ffffff';
};

const buildWhatsAppMessage = ({ selectedItems, catalogUrl }) => {
  const lines = [
    'Hi! Saya berminat dengan item dalam katalog:',
    '',
    ...selectedItems.map((item, index) => (
      `${index + 1}) ${item.name} - Qty: ${item.quantity} - Harga: RM${formatCurrency(item.selling_price || 0)}`
    )),
    '',
    `Link katalog: ${catalogUrl}`,
    '',
    'Boleh confirm stok & cara pembelian?',
  ];

  return lines.join('\n');
};

const CatalogItemCard = ({ item, isSelected, selectedQty, onToggle, onQuantityChange }) => {
  const [imageFailed, setImageFailed] = useState(false);
  const hasImage = Boolean(item?.image_url) && !imageFailed;
  const availableQty = getItemAvailableQuantity(item);
  const canAdjustQty = isSelected && availableQty > 1;
  const isUnavailable = availableQty <= 0;
  const hasCategoryColor = typeof item?.category_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.category_color.trim());
  const categoryTagStyle = hasCategoryColor
    ? { backgroundColor: item.category_color, color: getContrastTextColor(item.category_color) }
    : undefined;

  return (
    <article
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
        isSelected ? 'border-emerald-300 ring-1 ring-emerald-100' : 'border-slate-200'
      } ${isUnavailable ? 'opacity-70' : ''}`}
    >
      <div className="relative h-44 bg-slate-100">
        {hasImage ? (
          <img
            src={item.image_url}
            alt={item.name || 'Item'}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm font-medium text-slate-500">
            Tiada Gambar
          </div>
        )}
        <span className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold ${
          isUnavailable ? 'bg-slate-700 text-white' : 'bg-black/75 text-white'
        }`}>
          Qty: {availableQty}
        </span>
      </div>
      <div className="space-y-2 p-4">
        <h3 className="line-clamp-2 text-base font-semibold text-slate-900">{item.name || 'Item'}</h3>
        <p className="text-xl font-bold text-slate-900">RM {formatCurrency(item.selling_price || 0)}</p>
        <div>
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
              hasCategoryColor ? '' : 'bg-slate-100 text-slate-600'
            }`}
            style={categoryTagStyle}
          >
            {item.category || 'Tanpa Kategori'}
          </span>
        </div>

        <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <label className={`flex cursor-pointer items-center gap-2 text-sm font-medium ${isUnavailable ? 'text-slate-400' : 'text-slate-700'}`}>
            <Checkbox
              checked={isSelected}
              disabled={isUnavailable}
              onCheckedChange={(checked) => onToggle(item.item_id, checked === true)}
            />
            Pilih item
          </label>

          {isUnavailable && (
            <p className="text-xs text-amber-700">Item ini tidak tersedia buat masa ini.</p>
          )}

          {canAdjustQty && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-600">Kuantiti (maks {availableQty})</p>
              <Input
                type="number"
                min={1}
                max={availableQty}
                value={selectedQty}
                onChange={(event) => onQuantityChange(item.item_id, event.target.value, availableQty)}
                className="h-8 w-24 text-right text-sm"
              />
            </div>
          )}
        </div>
      </div>
    </article>
  );
};

const CatalogPublicPage = () => {
  const { publicCode } = useParams();
  const sessionAccessKey = `catalog-access-${publicCode || ''}`;
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [submittedAccessCode, setSubmittedAccessCode] = useState('');
  const [accessAttempted, setAccessAttempted] = useState(false);

  useEffect(() => {
    if (!publicCode) return;
    const savedCode = sessionStorage.getItem(sessionAccessKey) || '';
    setAccessCodeInput(savedCode);
    setSubmittedAccessCode(savedCode);
    setAccessAttempted(false);
  }, [publicCode, sessionAccessKey]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['catalog-public', publicCode, submittedAccessCode],
    queryFn: async () => {
      if (!publicCode) {
        return {
          notFound: true,
          title: '',
          description: '',
          items: [],
          contact: null,
          requiresAccess: false,
          accessGranted: false,
          isExpired: false,
          isInactive: false,
        };
      }

      const normalizedAccessCode = submittedAccessCode.trim() || null;

      const { data: catalogRows, error: catalogError } = await supabase.rpc('get_catalog_public', {
        p_public_code: publicCode,
        p_access_code: normalizedAccessCode,
      });

      if (catalogError) throw catalogError;

      const catalogHeader = Array.isArray(catalogRows) ? catalogRows[0] : catalogRows;
      if (!catalogHeader) {
        return {
          notFound: true,
          title: '',
          description: '',
          items: [],
          contact: null,
          requiresAccess: false,
          accessGranted: false,
          isExpired: false,
          isInactive: false,
        };
      }

      const requiresAccess = Boolean(catalogHeader.requires_access && !catalogHeader.access_granted);
      const isExpired = Boolean(catalogHeader.is_expired);
      const isInactive = catalogHeader.is_active === false;
      const accessGranted = Boolean(catalogHeader.access_granted);

      let itemRows = [];
      let contactRows = null;

      if (!requiresAccess && !isExpired && !isInactive) {
        const [
          { data: fetchedItemRows, error: itemsError },
          { data: fetchedContactRows, error: contactError },
        ] = await Promise.all([
          supabase.rpc('get_catalog_items_public', {
            p_public_code: publicCode,
            p_access_code: normalizedAccessCode,
          }),
          supabase.rpc('get_catalog_contact_public', {
            p_public_code: publicCode,
            p_access_code: normalizedAccessCode,
          }),
        ]);

        if (itemsError) throw itemsError;
        if (contactError && contactError.code !== 'PGRST202' && contactError.code !== '42883') {
          throw contactError;
        }

        itemRows = Array.isArray(fetchedItemRows) ? fetchedItemRows : [];
        contactRows = fetchedContactRows;
      }

      const contact = Array.isArray(contactRows) ? contactRows[0] : contactRows;

      return {
        notFound: false,
        title: catalogHeader.title || 'Katalog',
        description: catalogHeader.description || '',
        items: itemRows,
        contact: contact || null,
        visibility: catalogHeader.visibility || 'public',
        requiresAccess,
        accessGranted,
        isExpired,
        isInactive,
        expiresAt: catalogHeader.expires_at || null,
      };
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const [selectedItems, setSelectedItems] = useState({});
  const [availabilityWarning, setAvailabilityWarning] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('latest');

  const itemById = useMemo(() => {
    const map = new Map();
    (data?.items || []).forEach((item) => map.set(item.item_id, item));
    return map;
  }, [data?.items]);

  const selectedItemList = useMemo(() => {
    return Object.entries(selectedItems)
      .map(([itemId, quantity]) => {
        const item = itemById.get(itemId);
        if (!item) return null;
        return {
          item_id: itemId,
          name: item.name || 'Item',
          selling_price: item.selling_price || 0,
          quantity,
        };
      })
      .filter(Boolean);
  }, [itemById, selectedItems]);

  const selectedCount = selectedItemList.length;
  const selectedTotalQty = selectedItemList.reduce((sum, entry) => sum + (entry.quantity || 0), 0);
  const normalizedPhone = normalizeWhatsAppPhone(data?.contact?.whatsapp_phone || '');
  const isWhatsAppReady = normalizedPhone.length > 0;
  const isCatalogExpired = Boolean(data?.isExpired);
  const isCatalogInactive = Boolean(data?.isInactive);
  const isAccessLocked = Boolean(
    data?.requiresAccess && !data?.accessGranted && !isCatalogExpired && !isCatalogInactive
  );

  useEffect(() => {
    if (!publicCode) return;
    if (data?.accessGranted && submittedAccessCode.trim()) {
      sessionStorage.setItem(sessionAccessKey, submittedAccessCode.trim());
      setAccessAttempted(false);
    }
  }, [data?.accessGranted, publicCode, sessionAccessKey, submittedAccessCode]);

  const categoryOptions = useMemo(() => {
    const names = new Set();
    let hasNoCategory = false;

    (data?.items || []).forEach((item) => {
      const name = typeof item?.category === 'string' ? item.category.trim() : '';
      if (name) {
        names.add(name);
      } else {
        hasNoCategory = true;
      }
    });

    return {
      list: Array.from(names).sort((a, b) => a.localeCompare(b)),
      hasNoCategory,
    };
  }, [data?.items]);

  const filteredItems = useMemo(() => {
    const baseItems = Array.isArray(data?.items) ? data.items : [];
    const keyword = searchTerm.trim().toLowerCase();

    let nextItems = baseItems.filter((item) => {
      if (!keyword) return true;
      const itemName = (item?.name || '').toLowerCase();
      const itemCategory = (item?.category || '').toLowerCase();
      return itemName.includes(keyword) || itemCategory.includes(keyword);
    });

    if (categoryFilter !== 'all') {
      if (categoryFilter === '__no_category__') {
        nextItems = nextItems.filter((item) => !item?.category || !item.category.trim());
      } else {
        nextItems = nextItems.filter((item) => item?.category === categoryFilter);
      }
    }

    const sortedItems = [...nextItems];
    sortedItems.sort((a, b) => {
      if (sortBy === 'name_asc') {
        return (a.name || '').localeCompare(b.name || '');
      }
      if (sortBy === 'price_low') {
        return Number(a.selling_price || 0) - Number(b.selling_price || 0);
      }
      if (sortBy === 'price_high') {
        return Number(b.selling_price || 0) - Number(a.selling_price || 0);
      }
      if (sortBy === 'qty_high') {
        return getItemAvailableQuantity(b) - getItemAvailableQuantity(a);
      }
      return 0;
    });

    return sortedItems;
  }, [categoryFilter, data?.items, searchTerm, sortBy]);

  useEffect(() => {
    if (!data?.items?.length) {
      if (Object.keys(selectedItems).length > 0) {
        setSelectedItems({});
      }
      setAvailabilityWarning('');
      return;
    }

    const next = {};
    let changed = false;
    let adjusted = false;

    Object.entries(selectedItems).forEach(([itemId, selectedQty]) => {
      const item = itemById.get(itemId);
      if (!item) {
        changed = true;
        adjusted = true;
        return;
      }

      const maxQty = getItemAvailableQuantity(item);
      if (maxQty <= 0) {
        changed = true;
        adjusted = true;
        return;
      }

      const normalizedQty = Math.min(Math.max(parseInt(selectedQty, 10) || 1, 1), maxQty);
      if (normalizedQty !== selectedQty) {
        changed = true;
        adjusted = true;
      }
      next[itemId] = normalizedQty;
    });

    if (changed) {
      setSelectedItems(next);
    }
    setAvailabilityWarning(adjusted ? 'Kuantiti dipilih diselaraskan ikut stok semasa.' : '');
  }, [data?.items, itemById, selectedItems]);

  const handleToggleItem = (itemId, checked) => {
    const item = itemById.get(itemId);
    const maxQty = getItemAvailableQuantity(item);
    if (maxQty <= 0) return;

    setSelectedItems((prev) => {
      if (!checked) {
        if (!Object.prototype.hasOwnProperty.call(prev, itemId)) return prev;
        const next = { ...prev };
        delete next[itemId];
        return next;
      }

      const currentQty = parseInt(prev[itemId], 10) || 1;
      return {
        ...prev,
        [itemId]: Math.min(Math.max(currentQty, 1), maxQty),
      };
    });
  };

  const handleQuantityChange = (itemId, rawValue, maxQty) => {
    setSelectedItems((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, itemId)) return prev;
      const parsed = parseInt(rawValue, 10);
      const safeQty = Number.isNaN(parsed) ? 1 : Math.min(Math.max(parsed, 1), maxQty);
      return { ...prev, [itemId]: safeQty };
    });
  };

  const handleSendWhatsApp = () => {
    if (!isWhatsAppReady || selectedItemList.length === 0) return;

    const catalogUrl = window.location.href;
    const message = buildWhatsAppMessage({
      selectedItems: selectedItemList,
      catalogUrl,
    });

    const encodedText = encodeURIComponent(message);
    const primaryUrl = `https://wa.me/${normalizedPhone}?text=${encodedText}`;
    const fallbackUrl = `https://api.whatsapp.com/send?phone=${normalizedPhone}&text=${encodedText}`;

    const popup = window.open(primaryUrl, '_blank', 'noopener,noreferrer');
    if (!popup) {
      const fallbackPopup = window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
      if (!fallbackPopup) {
        window.location.href = fallbackUrl;
      }
    }
  };

  const handleClearAllSelection = () => {
    setSelectedItems({});
    setAvailabilityWarning('');
  };

  const handleUnlockCatalog = () => {
    const normalizedCode = accessCodeInput.trim();
    if (!normalizedCode) {
      setAccessAttempted(false);
      return;
    }

    setAccessAttempted(true);
    setSubmittedAccessCode(normalizedCode);
  };

  const pageTitle = data?.notFound ? 'Katalog Tidak Ditemui' : `${data?.title || 'Katalog'} - RareBits`;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f8fafc,_#e2e8f0_60%)] px-4 py-8 pb-28">
      <Helmet>
        <title>{pageTitle}</title>
      </Helmet>

      <div className="mx-auto w-full max-w-6xl">
        {isLoading && (
          <div className="rounded-2xl border border-slate-200 bg-white/80 p-10 text-center shadow-sm backdrop-blur">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-500" />
            <p className="mt-3 text-sm text-slate-600">Memuatkan katalog...</p>
          </div>
        )}

        {!isLoading && (isError || data?.notFound) && (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <PackageOpen className="mx-auto h-9 w-9 text-slate-400" />
            <h1 className="mt-3 text-xl font-semibold text-slate-900">Katalog tidak ditemui</h1>
            <p className="mt-2 text-sm text-slate-600">Pautan mungkin tidak sah atau katalog telah dipadam.</p>
          </div>
        )}

        {!isLoading && !isError && !data?.notFound && (
          <div className="space-y-6">
            {isCatalogExpired ? (
              <div className="rounded-2xl border border-amber-300 bg-white p-8 text-center shadow-sm">
                <PackageOpen className="mx-auto h-9 w-9 text-amber-500" />
                <h1 className="mt-3 text-xl font-semibold text-slate-900">Katalog tamat tempoh</h1>
                <p className="mt-2 text-sm text-slate-600">
                  Pautan ini sudah melepasi tempoh yang ditetapkan oleh penjual.
                </p>
              </div>
            ) : isCatalogInactive ? (
              <div className="rounded-2xl border border-slate-300 bg-white p-8 text-center shadow-sm">
                <PackageOpen className="mx-auto h-9 w-9 text-slate-400" />
                <h1 className="mt-3 text-xl font-semibold text-slate-900">Katalog tidak aktif</h1>
                <p className="mt-2 text-sm text-slate-600">
                  Katalog ini telah dinyahaktifkan oleh penjual.
                </p>
              </div>
            ) : isAccessLocked ? (
              <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-slate-700" />
                  <h1 className="text-lg font-semibold text-slate-900">Katalog Unlisted</h1>
                </div>
                <p className="text-sm text-slate-600">
                  Masukkan access code untuk lihat kandungan katalog ini.
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <Input
                    value={accessCodeInput}
                    onChange={(event) => {
                      setAccessCodeInput(event.target.value.toUpperCase());
                      setAccessAttempted(false);
                    }}
                    placeholder="Contoh: A1B2C3D4"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        handleUnlockCatalog();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    className="brand-gradient brand-gradient-hover text-white"
                    onClick={handleUnlockCatalog}
                    disabled={!accessCodeInput.trim()}
                  >
                    Buka Katalog
                  </Button>
                </div>
                {accessAttempted && (
                  <p className="mt-3 text-sm text-red-600">
                    Access code tidak sah. Sila cuba lagi.
                  </p>
                )}
              </div>
            ) : (
              <>
                <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Public Catalog</p>
                  <h1 className="mt-2 text-3xl font-bold text-slate-900">{data.title}</h1>
                  {data.description ? (
                    <p className="mt-3 max-w-3xl text-sm text-slate-600">{data.description}</p>
                  ) : null}
                  <p className="mt-4 text-sm text-slate-500">
                    {filteredItems.length} daripada {data.items.length} item dipaparkan
                  </p>

                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="relative md:col-span-2">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder="Cari nama item atau kategori..."
                        className="pl-9"
                      />
                    </div>

                    <Select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                      <option value="all">Semua Kategori</option>
                      {categoryOptions.list.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                      {categoryOptions.hasNoCategory ? (
                        <option value="__no_category__">Tanpa Kategori</option>
                      ) : null}
                    </Select>

                    <Select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                      <option value="latest">Default</option>
                      <option value="name_asc">Nama A-Z</option>
                      <option value="price_low">Harga Rendah</option>
                      <option value="price_high">Harga Tinggi</option>
                      <option value="qty_high">Stok Tertinggi</option>
                    </Select>
                  </div>
                </header>

                {data.items.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
                    Tiada item dalam katalog ini.
                  </div>
                ) : filteredItems.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
                    Tiada item sepadan dengan carian atau filter.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredItems.map((item) => (
                      <CatalogItemCard
                        key={item.item_id}
                        item={item}
                        isSelected={Object.prototype.hasOwnProperty.call(selectedItems, item.item_id)}
                        selectedQty={selectedItems[item.item_id] || 1}
                        onToggle={handleToggleItem}
                        onQuantityChange={handleQuantityChange}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {!isLoading && !isError && !data?.notFound && !isAccessLocked && !isCatalogExpired && !isCatalogInactive && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">{selectedCount} item dipilih</p>
              <p className="text-xs text-slate-600">
                Jumlah kuantiti: {selectedTotalQty}
                {!isWhatsAppReady ? ' - Penjual belum set nombor WhatsApp.' : ''}
              </p>
              {availabilityWarning && (
                <p className="mt-1 text-xs text-amber-700">{availabilityWarning}</p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={selectedCount === 0}
                onClick={handleClearAllSelection}
              >
                Clear Pilihan
              </Button>
              <Button
                type="button"
                className="brand-gradient brand-gradient-hover text-white"
                disabled={selectedCount === 0 || !isWhatsAppReady}
                onClick={handleSendWhatsApp}
              >
                <Send className="mr-2 h-4 w-4" />
                Hantar ke WhatsApp
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CatalogPublicPage;
