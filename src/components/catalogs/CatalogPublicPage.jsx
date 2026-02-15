import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Globe, ImageIcon, KeyRound, Loader2, PackageOpen, Phone, Search, Send, X } from 'lucide-react';
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

const normalizeWebsiteUrl = (websiteValue) => {
  if (typeof websiteValue !== 'string') return '';
  const trimmed = websiteValue.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const normalizeHttpUrl = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch (_error) {
    return '';
  }
};

const getInitials = (nameValue) => {
  if (typeof nameValue !== 'string') return 'RB';
  const words = nameValue
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return 'RB';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
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

const formatActiveSinceLabel = (createdAtValue) => {
  if (!createdAtValue) return '';
  const date = new Date(createdAtValue);
  if (Number.isNaN(date.getTime())) return '';

  return `Aktif sejak ${date.toLocaleDateString('ms-MY', { month: 'short', year: 'numeric' })}`;
};

const formatCatalogUpdatedLabel = (updatedAtValue) => {
  if (!updatedAtValue) return '';
  const updatedAt = new Date(updatedAtValue);
  if (Number.isNaN(updatedAt.getTime())) return '';

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfUpdated = new Date(
    updatedAt.getFullYear(),
    updatedAt.getMonth(),
    updatedAt.getDate()
  ).getTime();
  const diffDays = Math.floor((startOfToday - startOfUpdated) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Dikemaskini Hari ini';
  if (diffDays < 7) return `Dikemaskini ${diffDays} hari lalu`;
  if (diffDays < 30) return `Dikemaskini ${Math.max(1, Math.floor(diffDays / 7))} minggu lalu`;
  if (diffDays < 365) return `Dikemaskini ${Math.max(1, Math.floor(diffDays / 30))} bulan lalu`;
  return `Dikemaskini ${Math.max(1, Math.floor(diffDays / 365))} tahun lalu`;
};

const normalizeItemImageUrls = (item) => {
  const rawUrls = [
    ...(Array.isArray(item?.images) ? item.images : []),
    ...(Array.isArray(item?.image_urls) ? item.image_urls : []),
  ];
  const orderedUrls = rawUrls
    .map((url) => (typeof url === 'string' ? url.trim() : ''))
    .filter(Boolean);
  const normalizedCover = (typeof item?.cover_image_url === 'string' ? item.cover_image_url.trim() : '')
    || (typeof item?.image_url === 'string' ? item.image_url.trim() : '');

  let next = orderedUrls;
  if (normalizedCover) {
    if (!next.includes(normalizedCover)) {
      next = [normalizedCover, ...next];
    } else if (next[0] !== normalizedCover) {
      next = [normalizedCover, ...next.filter((url) => url !== normalizedCover)];
    }
  }

  return Array.from(new Set(next)).slice(0, 10);
};

const CatalogItemCard = ({ item, isSelected, selectedQty, onToggle, onQuantityChange, onOpenGallery }) => {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrls = normalizeItemImageUrls(item);
  const coverImageUrl = imageUrls[0] || '';
  const hasImage = Boolean(coverImageUrl) && !imageFailed;
  const totalPhotos = imageUrls.length;
  const extraPhotos = Math.max(totalPhotos - 1, 0);
  const availableQty = getItemAvailableQuantity(item);
  const canAdjustQty = isSelected && availableQty > 1;
  const isUnavailable = availableQty <= 0;
  const hasCategoryColor = typeof item?.category_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.category_color.trim());
  const categoryTagStyle = hasCategoryColor
    ? { backgroundColor: item.category_color, color: getContrastTextColor(item.category_color) }
    : undefined;

  useEffect(() => {
    setImageFailed(false);
  }, [coverImageUrl]);

  return (
    <article
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
        isSelected ? 'border-violet-300 ring-1 ring-violet-100' : 'border-slate-200'
      } ${isUnavailable ? 'opacity-70' : ''}`}
    >
      <div className="group relative h-44 bg-slate-100">
        {hasImage ? (
          <button
            type="button"
            className="h-full w-full cursor-zoom-in"
            onClick={() => onOpenGallery(item.item_id, 0)}
            aria-label={`Lihat foto ${item.name || 'item'}`}
          >
            <img
              src={coverImageUrl}
              alt={item.name || 'Item'}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          </button>
        ) : (
          <div className="flex h-full items-center justify-center text-sm font-medium text-slate-500">
            Tiada Gambar
          </div>
        )}
        {totalPhotos > 1 && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white">
            <ImageIcon className="h-3.5 w-3.5" />
            +{extraPhotos}
          </span>
        )}
        <span className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold ${
          isUnavailable ? 'bg-slate-700 text-white' : 'bg-violet-700 text-white'
        }`}>
          Qty: {availableQty}
        </span>
      </div>
      <div className="space-y-2 p-4">
        <h3 className="line-clamp-2 text-base font-semibold text-slate-900">{item.name || 'Item'}</h3>
        <p className="text-xl font-bold text-violet-700">RM {formatCurrency(item.selling_price || 0)}</p>
        <div>
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
              hasCategoryColor ? '' : 'bg-violet-50 text-violet-700'
            }`}
            style={categoryTagStyle}
          >
            {item.category || 'Tanpa Kategori'}
          </span>
        </div>
        {totalPhotos > 0 && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:text-violet-800"
            onClick={() => onOpenGallery(item.item_id, 0)}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Lihat Foto ({totalPhotos})
          </button>
        )}

        <div className="mt-3 space-y-2 rounded-xl border border-violet-100 bg-violet-50/60 p-3">
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
              <p className="text-xs text-slate-600">Kuantiti: {selectedQty} / {availableQty}</p>
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
          coverImageUrl: '',
          updatedAt: null,
          sellerCreatedAt: null,
          itemCount: 0,
          items: [],
          company: null,
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
          coverImageUrl: '',
          updatedAt: null,
          sellerCreatedAt: null,
          itemCount: 0,
          items: [],
          company: null,
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
      let companyRows = null;

      if (!requiresAccess && !isExpired && !isInactive) {
        const [
          { data: fetchedItemRows, error: itemsError },
          { data: fetchedCompanyRows, error: companyError },
        ] = await Promise.all([
          supabase.rpc('get_catalog_items_public', {
            p_public_code: publicCode,
            p_access_code: normalizedAccessCode,
          }),
          supabase.rpc('get_catalog_company_public', {
            p_public_code: publicCode,
            p_access_code: normalizedAccessCode,
          }),
        ]);

        if (itemsError) throw itemsError;
        itemRows = Array.isArray(fetchedItemRows) ? fetchedItemRows : [];
        companyRows = fetchedCompanyRows;

        if (companyError) {
          const isMissingCompanyRpc = companyError.code === 'PGRST202' || companyError.code === '42883';
          if (!isMissingCompanyRpc) {
            throw companyError;
          }

          // Backward compatibility while DB migration is rolling out.
          const { data: fallbackContactRows, error: fallbackContactError } = await supabase.rpc('get_catalog_contact_public', {
            p_public_code: publicCode,
            p_access_code: normalizedAccessCode,
          });

          if (
            fallbackContactError
            && fallbackContactError.code !== 'PGRST202'
            && fallbackContactError.code !== '42883'
          ) {
            throw fallbackContactError;
          }

          const fallbackContact = Array.isArray(fallbackContactRows)
            ? fallbackContactRows[0]
            : fallbackContactRows;

          companyRows = fallbackContact
            ? [{
              company_name: fallbackContact.display_name || 'Penjual',
              logo_url: '',
              phone: fallbackContact.whatsapp_phone || '',
              website: '',
              footer_notes: '',
              show_marketplace_links: true,
              shopee_url: '',
              tiktok_url: '',
              lazada_url: '',
              carousell_url: '',
            }]
            : null;
        }
      }

      const company = Array.isArray(companyRows) ? companyRows[0] : companyRows;
      const normalizedItemRows = (itemRows || []).map((row) => {
        const imageUrls = normalizeItemImageUrls(row);
        const coverImageUrl = imageUrls[0] || '';
        return {
          ...row,
          images: imageUrls,
          image_urls: imageUrls,
          cover_image_url: coverImageUrl,
          image_url: coverImageUrl,
        };
      });

      return {
        notFound: false,
        title: catalogHeader.title || 'Katalog',
        description: catalogHeader.description || '',
        coverImageUrl: catalogHeader.cover_image_url || '',
        updatedAt: catalogHeader.updated_at || null,
        sellerCreatedAt: catalogHeader.seller_created_at || null,
        itemCount: Number.parseInt(catalogHeader.item_count, 10) || 0,
        items: normalizedItemRows,
        company: company || null,
        visibility: catalogHeader.visibility || 'public',
        requiresAccess,
        accessGranted,
        isExpired,
        isInactive,
        expiresAt: catalogHeader.expires_at || null,
      };
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const [selectedItems, setSelectedItems] = useState({});
  const [availabilityWarning, setAvailabilityWarning] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('latest');
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [galleryItemId, setGalleryItemId] = useState(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const galleryTouchStartXRef = useRef(null);
  const galleryDialogRef = useRef(null);

  const itemById = useMemo(() => {
    const map = new Map();
    (data?.items || []).forEach((item) => map.set(item.item_id, item));
    return map;
  }, [data?.items]);

  const activeGalleryItem = galleryItemId ? itemById.get(galleryItemId) : null;
  const galleryImages = useMemo(
    () => normalizeItemImageUrls(activeGalleryItem),
    [activeGalleryItem]
  );
  const activeGalleryImage = galleryImages[galleryIndex] || '';

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
  const companyName = (data?.company?.company_name || '').trim() || 'Penjual';
  const sellerDescription = (data?.description || '').trim();
  const companyLogoUrl = (data?.company?.logo_url || '').trim();
  const catalogCoverImageUrl = (data?.coverImageUrl || '').trim();
  const activeSinceLabel = formatActiveSinceLabel(data?.sellerCreatedAt);
  const updatedLabel = formatCatalogUpdatedLabel(data?.updatedAt);
  const itemAvailableLabel = `${Number.isFinite(data?.itemCount) ? data.itemCount : 0} item tersedia`;
  const companyWebsiteRaw = (data?.company?.website || '').trim();
  const companyWebsiteUrl = normalizeWebsiteUrl(companyWebsiteRaw);
  const normalizedPhone = normalizeWhatsAppPhone(data?.company?.phone || '');
  const showMarketplaceLinks = data?.company?.show_marketplace_links !== false;
  const marketplaceLinks = useMemo(() => {
    if (!showMarketplaceLinks) return [];
    const candidates = [
      {
        key: 'shopee',
        label: 'Shopee',
        url: normalizeHttpUrl(data?.company?.shopee_url),
        className: 'border-[#EE4D2D]/30 bg-[#FFF3F0] text-[#EE4D2D] hover:bg-[#FFE8E1]',
      },
      {
        key: 'tiktok',
        label: 'TikTok Shop',
        url: normalizeHttpUrl(data?.company?.tiktok_url),
        className: 'border-[#111827]/25 bg-[#F3F4F6] text-[#111827] hover:bg-[#E5E7EB]',
      },
      {
        key: 'lazada',
        label: 'Lazada',
        url: normalizeHttpUrl(data?.company?.lazada_url),
        className: 'border-[#3C2AA8]/30 bg-[#F2EFFF] text-[#3C2AA8] hover:bg-[#E8E1FF]',
      },
      {
        key: 'carousell',
        label: 'Carousell',
        url: normalizeHttpUrl(data?.company?.carousell_url),
        className: 'border-[#FF5A5F]/30 bg-[#FFF1F2] text-[#E34147] hover:bg-[#FFE3E5]',
      },
    ];

    return candidates.filter((entry) => Boolean(entry.url));
  }, [
    data?.company?.carousell_url,
    data?.company?.lazada_url,
    data?.company?.shopee_url,
    data?.company?.tiktok_url,
    showMarketplaceLinks,
  ]);
  const isWhatsAppReady = normalizedPhone.length > 0;
  const [isCompanyLogoBroken, setIsCompanyLogoBroken] = useState(false);
  const isCatalogExpired = Boolean(data?.isExpired);
  const isCatalogInactive = Boolean(data?.isInactive);
  const isAccessLocked = Boolean(
    data?.requiresAccess && !data?.accessGranted && !isCatalogExpired && !isCatalogInactive
  );

  useEffect(() => {
    setIsCompanyLogoBroken(false);
  }, [companyLogoUrl]);

  const catalogHeaderBackgroundStyle = useMemo(() => {
    if (catalogCoverImageUrl) {
      return {
        backgroundImage: `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.35)), url(${catalogCoverImageUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      };
    }

    return {
      backgroundImage: 'linear-gradient(135deg,#4f46e5,#7c3aed)',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    };
  }, [catalogCoverImageUrl]);

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
    if (!isGalleryOpen) return;
    if (galleryImages.length === 0) {
      setIsGalleryOpen(false);
      return;
    }

    if (galleryIndex >= galleryImages.length) {
      setGalleryIndex(0);
    }
  }, [galleryImages, galleryIndex, isGalleryOpen]);

  useEffect(() => {
    if (!isGalleryOpen) return;

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsGalleryOpen(false);
        return;
      }
      if (galleryImages.length <= 1) return;
      if (event.key === 'ArrowLeft') {
        setGalleryIndex((prev) => (prev - 1 + galleryImages.length) % galleryImages.length);
        return;
      }
      if (event.key === 'ArrowRight') {
        setGalleryIndex((prev) => (prev + 1) % galleryImages.length);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    requestAnimationFrame(() => {
      galleryDialogRef.current?.focus();
    });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [galleryImages.length, isGalleryOpen]);

  useEffect(() => {
    if (!isGalleryOpen || galleryImages.length === 0) return;

    const previousIndex = (galleryIndex - 1 + galleryImages.length) % galleryImages.length;
    const nextIndex = (galleryIndex + 1) % galleryImages.length;
    const indexesToPreload = Array.from(new Set([galleryIndex, previousIndex, nextIndex]));

    indexesToPreload.forEach((index) => {
      const src = galleryImages[index];
      if (!src) return;
      const preloader = new Image();
      preloader.decoding = 'async';
      preloader.src = src;
    });
  }, [galleryImages, galleryIndex, isGalleryOpen]);

  const openItemGallery = (itemId, initialIndex = 0) => {
    const item = itemById.get(itemId);
    const images = normalizeItemImageUrls(item);
    if (images.length === 0) return;

    const safeIndex = Math.min(Math.max(initialIndex, 0), images.length - 1);
    setGalleryItemId(itemId);
    setGalleryIndex(safeIndex);
    setIsGalleryOpen(true);
  };

  const closeItemGallery = () => {
    setIsGalleryOpen(false);
    setGalleryItemId(null);
    setGalleryIndex(0);
  };

  const goToPreviousGalleryImage = () => {
    if (galleryImages.length <= 1) return;
    setGalleryIndex((prev) => (prev - 1 + galleryImages.length) % galleryImages.length);
  };

  const goToNextGalleryImage = () => {
    if (galleryImages.length <= 1) return;
    setGalleryIndex((prev) => (prev + 1) % galleryImages.length);
  };

  const handleGalleryTouchStart = (event) => {
    galleryTouchStartXRef.current = event.changedTouches?.[0]?.clientX ?? null;
  };

  const handleGalleryTouchEnd = (event) => {
    const startX = galleryTouchStartXRef.current;
    const endX = event.changedTouches?.[0]?.clientX;
    galleryTouchStartXRef.current = null;

    if (startX == null || endX == null || galleryImages.length <= 1) return;
    const deltaX = endX - startX;
    const SWIPE_THRESHOLD = 40;

    if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;
    if (deltaX > 0) {
      goToPreviousGalleryImage();
    } else {
      goToNextGalleryImage();
    }
  };

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

  const openWhatsAppThread = (messageText) => {
    if (!isWhatsAppReady) return;
    const message = messageText || 'Hi! Saya berminat dengan item anda.';
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

  const handleSendWhatsApp = () => {
    if (selectedItemList.length === 0) return;
    const catalogUrl = window.location.href;
    openWhatsAppThread(buildWhatsAppMessage({
      selectedItems: selectedItemList,
      catalogUrl,
    }));
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
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-8 pb-28">
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
                <header className="space-y-5">
                  <div className="relative">
                    <div
                      className="h-[160px] w-full rounded-3xl md:h-[240px]"
                      style={catalogHeaderBackgroundStyle}
                    />

                    <div className="relative -mt-12 px-2 sm:px-4">
                      <div className="mx-auto max-w-[900px] rounded-[16px] bg-white p-4 shadow-[0_20px_40px_rgba(15,23,42,0.12)] sm:p-5">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-[56px_minmax(0,1fr)] md:items-start">
                          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-slate-100">
                            {companyLogoUrl && !isCompanyLogoBroken ? (
                              <img
                                src={companyLogoUrl}
                                alt={`Logo ${companyName}`}
                                className="h-full w-full object-cover"
                                loading="lazy"
                                onError={() => setIsCompanyLogoBroken(true)}
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-slate-700">
                                {getInitials(companyName)}
                              </div>
                            )}
                          </div>

                          <div className="min-w-0">
                            <h1 className="text-[22px] font-semibold leading-tight text-slate-900">
                              {companyName}
                            </h1>
                            {sellerDescription ? (
                              <p className="mt-1 text-sm text-slate-500">
                                {sellerDescription}
                              </p>
                            ) : null}

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {activeSinceLabel ? (
                                <span className="inline-flex items-center rounded-full border border-emerald-100 bg-emerald-50 px-[10px] py-[4px] text-[12px] text-emerald-700">
                                  {activeSinceLabel}
                                </span>
                              ) : null}
                              {updatedLabel ? (
                                <span className="inline-flex items-center rounded-full border border-emerald-100 bg-emerald-50 px-[10px] py-[4px] text-[12px] text-emerald-700">
                                  {updatedLabel}
                                </span>
                              ) : null}
                              <span className="inline-flex items-center rounded-full border border-emerald-100 bg-emerald-50 px-[10px] py-[4px] text-[12px] text-emerald-700">
                                {itemAvailableLabel}
                              </span>
                            </div>

                            <div className="mt-4 flex flex-wrap items-center gap-2">
                              {isWhatsAppReady ? (
                                <Button
                                  type="button"
                                  className="h-10 rounded-full bg-[#4f46e5] px-5 text-white hover:bg-[#4338ca]"
                                  onClick={() => openWhatsAppThread(`Hi ${companyName}, saya berminat dengan katalog anda.`)}
                                >
                                  <Phone className="mr-2 h-4 w-4" />
                                  {normalizedPhone}
                                </Button>
                              ) : null}
                              {companyWebsiteUrl ? (
                                <a
                                  href={companyWebsiteUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex h-10 items-center gap-2 rounded-full border border-[#4f46e5] px-5 text-sm font-medium text-[#4f46e5] transition hover:bg-indigo-50"
                                >
                                  <Globe className="h-4 w-4" />
                                  <span className="max-w-[200px] truncate">{companyWebsiteRaw}</span>
                                </a>
                              ) : null}
                              {!isWhatsAppReady && !companyWebsiteUrl ? (
                                <p className="text-xs text-slate-500">
                                  Nombor telefon dan laman web belum disediakan.
                                </p>
                              ) : null}
                            </div>
                            {marketplaceLinks.length > 0 && (
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                {marketplaceLinks.map((entry) => (
                                  <a
                                    key={entry.key}
                                    href={entry.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={entry.label}
                                    aria-label={`Buka ${entry.label}`}
                                    className={`inline-flex h-9 items-center justify-center rounded-full border px-3 text-xs font-semibold transition ${entry.className}`}
                                  >
                                    {entry.label}
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white p-5 shadow-sm sm:p-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h2 className="text-2xl font-bold text-slate-900">{data.title}</h2>
                      </div>
                      <p className="text-sm font-medium text-violet-700">
                        {filteredItems.length} / {data.items.length} produk dipaparkan
                      </p>
                    </div>
                  </div>
                </header>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                  <aside className="h-fit rounded-2xl bg-white p-4 shadow-sm lg:sticky lg:top-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Filters</h3>
                      <button
                        type="button"
                        className="text-xs font-medium text-violet-700 hover:text-violet-800"
                        onClick={() => {
                          setSearchTerm('');
                          setCategoryFilter('all');
                          setSortBy('latest');
                        }}
                      >
                        Reset
                      </button>
                    </div>

                    <div className="mt-3 space-y-3">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          value={searchTerm}
                          onChange={(event) => setSearchTerm(event.target.value)}
                          placeholder="Cari produk..."
                          className="border-slate-200 pl-9 focus-visible:ring-violet-500"
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

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-violet-50 p-2 text-center">
                        <p className="text-[11px] uppercase tracking-wide text-violet-500">Produk</p>
                        <p className="text-base font-semibold text-violet-700">{data.items.length}</p>
                      </div>
                      <div className="rounded-xl bg-violet-50 p-2 text-center">
                        <p className="text-[11px] uppercase tracking-wide text-violet-500">Pilih</p>
                        <p className="text-base font-semibold text-violet-700">{selectedCount}</p>
                      </div>
                      <div className="rounded-xl bg-violet-50 p-2 text-center">
                        <p className="text-[11px] uppercase tracking-wide text-violet-500">Qty</p>
                        <p className="text-base font-semibold text-violet-700">{selectedTotalQty}</p>
                      </div>
                    </div>
                  </aside>

                  <section>
                    {data.items.length === 0 ? (
                      <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-600 shadow-sm">
                        Tiada item dalam katalog ini.
                      </div>
                    ) : filteredItems.length === 0 ? (
                      <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-600 shadow-sm">
                        Tiada item sepadan dengan carian atau filter.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {filteredItems.map((item) => (
                          <CatalogItemCard
                            key={item.item_id}
                            item={item}
                            isSelected={Object.prototype.hasOwnProperty.call(selectedItems, item.item_id)}
                            selectedQty={selectedItems[item.item_id] || 1}
                            onToggle={handleToggleItem}
                            onQuantityChange={handleQuantityChange}
                            onOpenGallery={openItemGallery}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {isGalleryOpen && galleryImages.length > 0 && (
        <div className="fixed inset-0 z-[80] bg-slate-950/85 backdrop-blur-sm">
          <div
            className="flex h-full w-full items-stretch justify-center p-0 sm:items-center sm:p-6"
            onClick={closeItemGallery}
          >
            <div
              ref={galleryDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Galeri gambar item"
              tabIndex={-1}
              className="relative flex h-full w-full flex-col bg-black outline-none sm:h-auto sm:max-h-[92vh] sm:max-w-5xl sm:overflow-hidden sm:rounded-2xl sm:border sm:border-slate-700/80"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="grid grid-cols-[auto_1fr_auto] items-center border-b border-slate-800 px-4 py-3 sm:px-5">
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/10"
                  onClick={closeItemGallery}
                  aria-label="Tutup galeri"
                >
                  <X className="h-4 w-4" />
                </button>
                <p className="text-center text-sm font-semibold text-white">
                  {galleryIndex + 1} / {galleryImages.length}
                </p>
                <p className="max-w-[180px] truncate text-right text-xs text-slate-300 sm:max-w-[280px]">
                  {activeGalleryItem?.name || 'Gambar Item'}
                </p>
              </div>

              <div
                className="relative flex min-h-0 flex-1 items-center justify-center px-3 py-4 sm:px-6 sm:py-6"
                onTouchStart={handleGalleryTouchStart}
                onTouchEnd={handleGalleryTouchEnd}
              >
                <img
                  key={activeGalleryImage}
                  src={activeGalleryImage}
                  alt={`${activeGalleryItem?.name || 'Item'} (${galleryIndex + 1}/${galleryImages.length})`}
                  className="max-h-full w-auto max-w-full rounded-md object-contain"
                  loading="eager"
                />

                {galleryImages.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="absolute left-4 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white transition hover:bg-black/70 md:flex"
                      onClick={goToPreviousGalleryImage}
                      aria-label="Gambar sebelumnya"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      className="absolute right-4 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white transition hover:bg-black/70 md:flex"
                      onClick={goToNextGalleryImage}
                      aria-label="Gambar seterusnya"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                )}
              </div>

              {galleryImages.length > 1 && (
                <div className="flex items-center justify-center gap-1.5 border-t border-slate-800 px-4 py-3">
                  {galleryImages.map((_, index) => (
                    <button
                      key={`gallery-dot-${index}`}
                      type="button"
                      className={`h-2 w-2 rounded-full transition ${
                        index === galleryIndex ? 'bg-white' : 'bg-white/35 hover:bg-white/55'
                      }`}
                      onClick={() => setGalleryIndex(index)}
                      aria-label={`Lihat gambar ${index + 1}`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
