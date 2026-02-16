import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Save, Upload, Trash2 } from 'lucide-react';
import { DEFAULT_INVOICE_SETTINGS, useInvoiceSettings } from '@/hooks/useInvoiceSettings';

const LOGO_BUCKET = 'item_images';

const extractStoragePath = (publicUrl, bucketName) => {
  if (!publicUrl) return null;

  const marker = `/${bucketName}/`;
  const markerIndex = publicUrl.indexOf(marker);
  if (markerIndex < 0) return null;

  const pathWithQuery = publicUrl.slice(markerIndex + marker.length);
  return decodeURIComponent(pathWithQuery.split('?')[0]);
};

const normalizeTextValue = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isValidHttpUrl = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_error) {
    return false;
  }
};

const normalizeMarketplaceUrl = (value) => {
  const normalized = normalizeTextValue(value);
  if (!normalized) return null;
  return isValidHttpUrl(normalized) ? normalized : null;
};

const normalizeQrMode = (mode, qrUrl) => {
  const normalizedMode = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
  if (normalizedMode === 'none' || normalizedMode === 'url') return normalizedMode;
  return normalizeTextValue(qrUrl) ? 'url' : 'none';
};

const extractCatalogCodeFromUrl = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) return '';
  try {
    const parsed = new URL(value.trim());
    const matched = parsed.pathname.match(/^\/(?:cat|c)\/([^/]+)\/?$/i);
    return matched?.[1] || '';
  } catch (_error) {
    return '';
  }
};

const mapSettingsToForm = (settings) => ({
  ...DEFAULT_INVOICE_SETTINGS,
  ...(settings || {}),
  company_name: settings?.company_name || '',
  address: settings?.address || '',
  phone: settings?.phone || '',
  email: settings?.email || '',
  website: settings?.website || '',
  shopee_url: settings?.shopee_url || '',
  tiktok_url: settings?.tiktok_url || '',
  lazada_url: settings?.lazada_url || '',
  carousell_url: settings?.carousell_url || '',
  show_marketplace_links: settings?.show_marketplace_links ?? true,
  fax: settings?.fax || '',
  logo_url: settings?.logo_url || '',
  tax_number: settings?.tax_number || '',
  business_reg_no: settings?.business_reg_no || '',
  footer_notes: settings?.footer_notes || '',
  show_logo: settings?.show_logo ?? true,
  show_logo_a4: settings?.show_logo_a4 ?? settings?.show_logo ?? true,
  show_logo_thermal: settings?.show_logo_thermal ?? false,
  show_logo_paperang: settings?.show_logo_paperang ?? false,
  qr_enabled_a4: settings?.qr_enabled_a4 ?? false,
  qr_enabled_thermal: settings?.qr_enabled_thermal ?? false,
  qr_enabled_paperang: settings?.qr_enabled_paperang ?? false,
  qr_mode: normalizeQrMode(settings?.qr_mode, settings?.qr_url),
  qr_label: settings?.qr_label || DEFAULT_INVOICE_SETTINGS.qr_label,
  qr_url: settings?.qr_url || '',
  show_tax: settings?.show_tax ?? false,
  thermal_show_address: settings?.thermal_show_address ?? false,
  thermal_show_phone: settings?.thermal_show_phone ?? true,
  thermal_show_email: settings?.thermal_show_email ?? false,
  thermal_show_website: settings?.thermal_show_website ?? true,
  thermal_show_tax: settings?.thermal_show_tax ?? (settings?.show_tax ?? false),
  show_generated_by: settings?.show_generated_by ?? true,
  show_generated_by_a4: settings?.show_generated_by_a4 ?? settings?.show_generated_by ?? true,
  show_generated_by_thermal: settings?.show_generated_by_thermal ?? false,
  show_generated_by_paperang: settings?.show_generated_by_paperang ?? false,
});

const InvoiceSettings = ({ userId }) => {
  const { toast } = useToast();
  const { settings, isLoading, isSaving, saveSettings } = useInvoiceSettings(userId);
  const [formData, setFormData] = useState(DEFAULT_INVOICE_SETTINGS);
  const [isReady, setIsReady] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [qrUrlSource, setQrUrlSource] = useState('custom');
  const [selectedCatalogCode, setSelectedCatalogCode] = useState('');

  const { data: catalogLinks = [], isLoading: isCatalogLinksLoading } = useQuery({
    queryKey: ['catalog-links-for-qr', userId],
    queryFn: async () => {
      if (!userId) return [];

      const { data, error } = await supabase
        .from('catalogs')
        .select('id, title, public_code')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        if (error.code === '42P01') return [];
        throw error;
      }

      return Array.isArray(data) ? data : [];
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const catalogLinkOptions = useMemo(
    () => catalogLinks.map((catalog) => ({
      ...catalog,
      url: `${window.location.origin}/cat/${catalog.public_code}`,
    })),
    [catalogLinks]
  );

  useEffect(() => {
    const nextForm = mapSettingsToForm(settings);
    setFormData(nextForm);

    const catalogCodeFromUrl = extractCatalogCodeFromUrl(nextForm.qr_url);
    setQrUrlSource(catalogCodeFromUrl ? 'catalog' : 'custom');
    setSelectedCatalogCode(catalogCodeFromUrl || '');
    setIsReady(true);
  }, [settings]);

  const isBusy = isSaving || isUploadingLogo;
  const hasLogo = useMemo(() => !!formData.logo_url, [formData.logo_url]);
  const isQrDisabled = formData.qr_mode === 'none';
  const qrUrlError = useMemo(() => {
    if (isQrDisabled) return '';
    if (!formData.qr_url || formData.qr_url.trim().length === 0) return '';
    return isValidHttpUrl(formData.qr_url)
      ? ''
      : 'URL tidak sah. Guna format penuh seperti https://example.com';
  }, [formData.qr_url, isQrDisabled]);
  const qrCatalogError = useMemo(() => {
    if (isQrDisabled) return '';
    if (qrUrlSource !== 'catalog') return '';
    if (catalogLinkOptions.length === 0) return 'Belum ada link katalog. Cipta katalog dahulu.';
    if (!selectedCatalogCode) return 'Sila pilih satu link katalog.';
    if (!catalogLinkOptions.some((option) => option.public_code === selectedCatalogCode)) {
      return 'Link katalog dipilih tidak ditemui.';
    }
    return '';
  }, [catalogLinkOptions, isQrDisabled, qrUrlSource, selectedCatalogCode]);
  const marketplaceUrlErrors = useMemo(() => {
    const entries = [
      { key: 'shopee_url', label: 'Shopee URL' },
      { key: 'tiktok_url', label: 'TikTok Shop URL' },
      { key: 'lazada_url', label: 'Lazada URL' },
      { key: 'carousell_url', label: 'Carousell URL' },
    ];

    return entries.reduce((acc, entry) => {
      const raw = formData?.[entry.key];
      if (typeof raw === 'string' && raw.trim().length > 0 && !isValidHttpUrl(raw)) {
        acc[entry.key] = `${entry.label} mesti bermula dengan http:// atau https://`;
      }
      return acc;
    }, {});
  }, [formData]);

  const setField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const buildSavePayload = (baseData) => ({
    company_name: normalizeTextValue(baseData.company_name),
    address: normalizeTextValue(baseData.address),
    phone: normalizeTextValue(baseData.phone),
    email: normalizeTextValue(baseData.email),
    website: normalizeTextValue(baseData.website),
    shopee_url: normalizeMarketplaceUrl(baseData.shopee_url),
    tiktok_url: normalizeMarketplaceUrl(baseData.tiktok_url),
    lazada_url: normalizeMarketplaceUrl(baseData.lazada_url),
    carousell_url: normalizeMarketplaceUrl(baseData.carousell_url),
    show_marketplace_links: Boolean(baseData.show_marketplace_links),
    fax: normalizeTextValue(baseData.fax),
    logo_url: normalizeTextValue(baseData.logo_url),
    show_logo: Boolean(baseData.show_logo_a4),
    show_logo_a4: Boolean(baseData.show_logo_a4),
    show_logo_thermal: Boolean(baseData.show_logo_thermal),
    show_logo_paperang: Boolean(baseData.show_logo_paperang),
    qr_enabled_a4: Boolean(baseData.qr_enabled_a4),
    qr_enabled_thermal: Boolean(baseData.qr_enabled_thermal),
    qr_enabled_paperang: Boolean(baseData.qr_enabled_paperang),
    qr_mode: normalizeQrMode(baseData.qr_mode, baseData.qr_url),
    qr_label: normalizeTextValue(baseData.qr_label) || DEFAULT_INVOICE_SETTINGS.qr_label,
    qr_url: normalizeTextValue(baseData.qr_url),
    tax_number: normalizeTextValue(baseData.tax_number),
    show_tax: Boolean(baseData.show_tax),
    thermal_show_address: Boolean(baseData.thermal_show_address),
    thermal_show_phone: Boolean(baseData.thermal_show_phone),
    thermal_show_email: Boolean(baseData.thermal_show_email),
    thermal_show_website: Boolean(baseData.thermal_show_website),
    thermal_show_tax: Boolean(baseData.thermal_show_tax),
    business_reg_no: normalizeTextValue(baseData.business_reg_no),
    footer_notes: normalizeTextValue(baseData.footer_notes),
    show_generated_by: Boolean(baseData.show_generated_by_a4),
    show_generated_by_a4: Boolean(baseData.show_generated_by_a4),
    show_generated_by_thermal: Boolean(baseData.show_generated_by_thermal),
    show_generated_by_paperang: Boolean(baseData.show_generated_by_paperang),
  });

  const removeLogoFile = async (logoUrl) => {
    const storagePath = extractStoragePath(logoUrl, LOGO_BUCKET);
    if (!storagePath) return;
    await supabase.storage.from(LOGO_BUCKET).remove([storagePath]);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!isQrDisabled && qrCatalogError) {
      toast({
        variant: 'destructive',
        title: 'Pilihan URL QR tidak lengkap',
        description: qrCatalogError,
      });
      return;
    }
    if (!isQrDisabled && qrUrlError) {
      toast({
        variant: 'destructive',
        title: 'URL QR tidak sah',
        description: qrUrlError,
      });
      return;
    }
    const firstMarketplaceError = Object.values(marketplaceUrlErrors)[0];
    if (firstMarketplaceError) {
      toast({
        variant: 'destructive',
        title: 'Pautan marketplace tidak sah',
        description: firstMarketplaceError,
      });
      return;
    }

    try {
      const saved = await saveSettings(buildSavePayload(formData));
      setFormData(mapSettingsToForm(saved));
      toast({ title: 'Tetapan invois berjaya disimpan' });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal menyimpan tetapan invois',
        description: error.message,
      });
    }
  };

  const handleQrModeChange = (nextModeRaw) => {
    const nextMode = nextModeRaw === 'none' ? 'none' : 'url';
    setField('qr_mode', nextMode);

    if (nextMode === 'url' && qrUrlSource === 'catalog') {
      const fallbackCode = selectedCatalogCode || catalogLinkOptions[0]?.public_code || '';
      setSelectedCatalogCode(fallbackCode);
      const selectedOption = catalogLinkOptions.find((option) => option.public_code === fallbackCode);
      if (selectedOption?.url) {
        setField('qr_url', selectedOption.url);
      }
    }
  };

  const handleQrSourceChange = (source) => {
    const nextSource = source === 'catalog' ? 'catalog' : 'custom';
    setQrUrlSource(nextSource);

    if (nextSource === 'catalog') {
      const fallbackCode = selectedCatalogCode || catalogLinkOptions[0]?.public_code || '';
      setSelectedCatalogCode(fallbackCode);
      const selectedOption = catalogLinkOptions.find((option) => option.public_code === fallbackCode);
      setField('qr_url', selectedOption?.url || '');
    }
  };

  const handleCatalogLinkChange = (publicCode) => {
    setSelectedCatalogCode(publicCode);
    const selectedOption = catalogLinkOptions.find((option) => option.public_code === publicCode);
    setField('qr_url', selectedOption?.url || '');
  };

  const handleUploadLogo = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        variant: 'destructive',
        title: 'Format fail tidak disokong',
        description: 'Sila pilih fail PNG atau JPG.',
      });
      return;
    }

    setIsUploadingLogo(true);

    try {
      if (formData.logo_url) {
        await removeLogoFile(formData.logo_url);
      }

      const fileExt = file.name.split('.').pop() || 'png';
      const filePath = `invoice_logos/${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(filePath, file, { upsert: false });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(filePath);
      const logoUrl = data?.publicUrl || '';

      const saved = await saveSettings({ logo_url: logoUrl });
      setFormData(mapSettingsToForm(saved));
      toast({ title: 'Logo berjaya dimuat naik' });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal muat naik logo',
        description: error.message,
      });
    } finally {
      setIsUploadingLogo(false);
      event.target.value = '';
    }
  };

  const handleRemoveLogo = async () => {
    if (!formData.logo_url) return;

    setIsUploadingLogo(true);
    try {
      await removeLogoFile(formData.logo_url);
      const saved = await saveSettings({ logo_url: null });
      setFormData(mapSettingsToForm(saved));
      toast({ title: 'Logo berjaya dibuang' });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal membuang logo',
        description: error.message,
      });
    } finally {
      setIsUploadingLogo(false);
    }
  };

  if (isLoading && !isReady) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Memuat tetapan invois...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Maklumat Syarikat / Kedai</CardTitle>
          <CardDescription>Maklumat ini akan dipaparkan pada invois A4 dan resit thermal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="company-name" className="mb-1 block text-sm font-medium text-muted-foreground">
              Nama Syarikat / Kedai
            </label>
            <Input
              id="company-name"
              value={formData.company_name}
              onChange={(event) => setField('company_name', event.target.value)}
              placeholder="Contoh: RareBits Enterprise"
            />
            <p className="mt-1 text-xs text-muted-foreground">Boleh dibiarkan kosong buat sementara.</p>
          </div>

          <div>
            <label htmlFor="company-address" className="mb-1 block text-sm font-medium text-muted-foreground">
              Alamat
            </label>
            <textarea
              id="company-address"
              value={formData.address}
              onChange={(event) => setField('address', event.target.value)}
              placeholder="No. 10, Jalan Contoh, 43000 Kajang"
              className="min-h-[90px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="company-phone" className="mb-1 block text-sm font-medium text-muted-foreground">
                Telefon
              </label>
              <Input
                id="company-phone"
                value={formData.phone}
                onChange={(event) => setField('phone', event.target.value)}
                placeholder="Contoh: 012-3456789"
              />
            </div>
            <div>
              <label htmlFor="company-email" className="mb-1 block text-sm font-medium text-muted-foreground">
                Emel
              </label>
              <Input
                id="company-email"
                value={formData.email}
                onChange={(event) => setField('email', event.target.value)}
                placeholder="Contoh: sales@kedai.com"
              />
            </div>
            <div>
              <label htmlFor="company-website" className="mb-1 block text-sm font-medium text-muted-foreground">
                Laman Web
              </label>
              <Input
                id="company-website"
                value={formData.website}
                onChange={(event) => setField('website', event.target.value)}
                placeholder="Contoh: www.kedai.com"
              />
            </div>
            <div>
              <label htmlFor="company-fax" className="mb-1 block text-sm font-medium text-muted-foreground">
                Fax
              </label>
              <Input
                id="company-fax"
                value={formData.fax}
                onChange={(event) => setField('fax', event.target.value)}
                placeholder="Contoh: 03-12345678"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <CardDescription>Muat naik logo untuk dipaparkan pada dokumen cetakan.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-lg border bg-muted/20">
              {hasLogo ? (
                <img src={formData.logo_url} alt="Logo syarikat" className="h-full w-full object-contain bg-white" />
              ) : (
                <p className="px-2 text-center text-xs text-muted-foreground">Tiada logo</p>
              )}
            </div>
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <Button asChild type="button" variant="outline" disabled={isUploadingLogo}>
                <label htmlFor="invoice-logo-upload" className="cursor-pointer">
                  {isUploadingLogo ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  {hasLogo ? 'Tukar Logo' : 'Muat Naik Logo'}
                </label>
              </Button>
              {hasLogo && (
                <Button type="button" variant="outline" onClick={handleRemoveLogo} disabled={isUploadingLogo}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Buang Logo
                </Button>
              )}
              <input
                id="invoice-logo-upload"
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                className="hidden"
                onChange={handleUploadLogo}
                disabled={isUploadingLogo}
              />
              <p className="w-full text-xs text-muted-foreground">Format disokong: PNG/JPG. Saiz imej sederhana dicadangkan.</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Tetapan paparan logo ikut template ada di bahagian A4 dan Thermal/Paperang di bawah.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pautan Marketplace (Optional)</CardTitle>
          <CardDescription>Pautan ini dipaparkan pada katalog awam sebagai ikon sahaja.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="marketplace-shopee" className="mb-1 block text-sm font-medium text-muted-foreground">
                Shopee URL
              </label>
              <Input
                id="marketplace-shopee"
                value={formData.shopee_url}
                onChange={(event) => setField('shopee_url', event.target.value)}
                placeholder="https://shopee.com.my/..."
              />
              <p className="mt-1 text-xs text-muted-foreground">Contoh: https://shopee.com.my/nama-kedai</p>
              {marketplaceUrlErrors.shopee_url && <p className="mt-1 text-xs text-red-600">{marketplaceUrlErrors.shopee_url}</p>}
            </div>

            <div>
              <label htmlFor="marketplace-tiktok" className="mb-1 block text-sm font-medium text-muted-foreground">
                TikTok Shop URL
              </label>
              <Input
                id="marketplace-tiktok"
                value={formData.tiktok_url}
                onChange={(event) => setField('tiktok_url', event.target.value)}
                placeholder="https://www.tiktok.com/@..."
              />
              <p className="mt-1 text-xs text-muted-foreground">Contoh: https://www.tiktok.com/@kedai</p>
              {marketplaceUrlErrors.tiktok_url && <p className="mt-1 text-xs text-red-600">{marketplaceUrlErrors.tiktok_url}</p>}
            </div>

            <div>
              <label htmlFor="marketplace-lazada" className="mb-1 block text-sm font-medium text-muted-foreground">
                Lazada URL
              </label>
              <Input
                id="marketplace-lazada"
                value={formData.lazada_url}
                onChange={(event) => setField('lazada_url', event.target.value)}
                placeholder="https://www.lazada.com.my/shop/..."
              />
              <p className="mt-1 text-xs text-muted-foreground">Contoh: https://www.lazada.com.my/shop/nama-kedai</p>
              {marketplaceUrlErrors.lazada_url && <p className="mt-1 text-xs text-red-600">{marketplaceUrlErrors.lazada_url}</p>}
            </div>

            <div>
              <label htmlFor="marketplace-carousell" className="mb-1 block text-sm font-medium text-muted-foreground">
                Carousell URL
              </label>
              <Input
                id="marketplace-carousell"
                value={formData.carousell_url}
                onChange={(event) => setField('carousell_url', event.target.value)}
                placeholder="https://carousell.app.link/..."
              />
              <p className="mt-1 text-xs text-muted-foreground">Contoh: https://www.carousell.com/u/nama-kedai</p>
              {marketplaceUrlErrors.carousell_url && <p className="mt-1 text-xs text-red-600">{marketplaceUrlErrors.carousell_url}</p>}
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border p-3">
            <Checkbox
              id="show-marketplace-links"
              checked={formData.show_marketplace_links}
              onCheckedChange={(checked) => setField('show_marketplace_links', checked === true)}
            />
            <div>
              <label htmlFor="show-marketplace-links" className="text-sm font-medium text-foreground">
                Papar ikon marketplace pada katalog awam
              </label>
              <p className="text-xs text-muted-foreground">Jika off, pautan disimpan tapi ikon tidak dipaparkan.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax / Registration</CardTitle>
          <CardDescription>Maklumat ini boleh dipaparkan jika perniagaan anda perlukan butiran cukai.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="tax-number" className="mb-1 block text-sm font-medium text-muted-foreground">
                No. Cukai
              </label>
              <Input
                id="tax-number"
                value={formData.tax_number}
                onChange={(event) => setField('tax_number', event.target.value)}
                placeholder="Contoh: SST123456"
              />
            </div>
            <div>
              <label htmlFor="business-reg-no" className="mb-1 block text-sm font-medium text-muted-foreground">
                No. Pendaftaran Perniagaan / SSM
              </label>
              <Input
                id="business-reg-no"
                value={formData.business_reg_no}
                onChange={(event) => setField('business_reg_no', event.target.value)}
                placeholder="Contoh: 202301012345"
              />
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border p-3">
            <Checkbox
              id="show-tax"
              checked={formData.show_tax}
              onCheckedChange={(checked) => setField('show_tax', checked === true)}
            />
            <div>
              <label htmlFor="show-tax" className="text-sm font-medium text-foreground">
                Papar maklumat cukai pada cetakan
              </label>
              <p className="text-xs text-muted-foreground">Sesuai jika anda perlu paparkan nombor cukai pada invois rasmi.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invois / Resit</CardTitle>
          <CardDescription>Tetapan cetakan untuk A4, Thermal, dan Paperang.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-semibold text-foreground">A4 Template</p>
              <p className="text-xs text-muted-foreground">Tetapan khusus untuk cetakan invois A4.</p>
            </div>
            <div className="flex items-start gap-3 rounded-lg border p-3">
              <Checkbox
                id="show-logo-a4"
                checked={formData.show_logo_a4}
                onCheckedChange={(checked) => setField('show_logo_a4', checked === true)}
              />
              <div>
                <label htmlFor="show-logo-a4" className="text-sm font-medium text-foreground">
                  Papar logo pada A4
                </label>
                <p className="text-xs text-muted-foreground">Sesuai untuk letterhead profesional.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border p-3">
              <Checkbox
                id="show-generated-by-a4"
                checked={formData.show_generated_by_a4}
                onCheckedChange={(checked) => setField('show_generated_by_a4', checked === true)}
              />
              <div>
                <label htmlFor="show-generated-by-a4" className="text-sm font-medium text-foreground">
                  Papar "Generated by RareBits" pada A4
                </label>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border p-3">
              <Checkbox
                id="qr-enabled-a4"
                checked={formData.qr_enabled_a4}
                onCheckedChange={(checked) => setField('qr_enabled_a4', checked === true)}
              />
              <div>
                <label htmlFor="qr-enabled-a4" className="text-sm font-medium text-foreground">
                  Papar QR pada A4
                </label>
                <p className="text-xs text-muted-foreground">QR akan diletak di bahagian bawah kanan dokumen A4.</p>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Thermal Template</p>
              <p className="text-xs text-muted-foreground">Tetapan khusus untuk cetakan thermal.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  id="show-logo-thermal"
                  checked={formData.show_logo_thermal}
                  onCheckedChange={(checked) => setField('show_logo_thermal', checked === true)}
                />
                <label htmlFor="show-logo-thermal" className="text-sm font-medium text-foreground">
                  Logo pada Thermal
                </label>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  id="qr-enabled-thermal"
                  checked={formData.qr_enabled_thermal}
                  onCheckedChange={(checked) => setField('qr_enabled_thermal', checked === true)}
                />
                <label htmlFor="qr-enabled-thermal" className="text-sm font-medium text-foreground">
                  QR pada Thermal
                </label>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  id="thermal-show-address"
                  checked={formData.thermal_show_address}
                  onCheckedChange={(checked) => setField('thermal_show_address', checked === true)}
                />
                <label htmlFor="thermal-show-address" className="text-sm font-medium text-foreground">
                  Papar alamat
                </label>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  id="thermal-show-phone"
                  checked={formData.thermal_show_phone}
                  onCheckedChange={(checked) => setField('thermal_show_phone', checked === true)}
                />
                <label htmlFor="thermal-show-phone" className="text-sm font-medium text-foreground">
                  Papar telefon
                </label>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  id="thermal-show-email"
                  checked={formData.thermal_show_email}
                  onCheckedChange={(checked) => setField('thermal_show_email', checked === true)}
                />
                <label htmlFor="thermal-show-email" className="text-sm font-medium text-foreground">
                  Papar emel
                </label>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  id="thermal-show-website"
                  checked={formData.thermal_show_website}
                  onCheckedChange={(checked) => setField('thermal_show_website', checked === true)}
                />
                <label htmlFor="thermal-show-website" className="text-sm font-medium text-foreground">
                  Papar website
                </label>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  id="thermal-show-tax"
                  checked={formData.thermal_show_tax}
                  onCheckedChange={(checked) => setField('thermal_show_tax', checked === true)}
                />
                <label htmlFor="thermal-show-tax" className="text-sm font-medium text-foreground">
                  Papar no. cukai
                </label>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  id="show-generated-by-thermal"
                  checked={formData.show_generated_by_thermal}
                  onCheckedChange={(checked) => setField('show_generated_by_thermal', checked === true)}
                />
                <label htmlFor="show-generated-by-thermal" className="text-sm font-medium text-foreground">
                  Generated by (Thermal)
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Paperang Template</p>
              <p className="text-xs text-muted-foreground">Tetapan khusus untuk export Paperang.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  id="show-logo-paperang"
                  checked={formData.show_logo_paperang}
                  onCheckedChange={(checked) => setField('show_logo_paperang', checked === true)}
                />
                <label htmlFor="show-logo-paperang" className="text-sm font-medium text-foreground">
                  Logo pada Paperang
                </label>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  id="qr-enabled-paperang"
                  checked={formData.qr_enabled_paperang}
                  onCheckedChange={(checked) => setField('qr_enabled_paperang', checked === true)}
                />
                <label htmlFor="qr-enabled-paperang" className="text-sm font-medium text-foreground">
                  QR pada Paperang
                </label>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3 md:col-span-2">
                <Checkbox
                  id="show-generated-by-paperang"
                  checked={formData.show_generated_by_paperang}
                  onCheckedChange={(checked) => setField('show_generated_by_paperang', checked === true)}
                />
                <label htmlFor="show-generated-by-paperang" className="text-sm font-medium text-foreground">
                  Generated by (Paperang)
                </label>
              </div>
            </div>

            <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Maklumat telefon/website/emel/alamat untuk Paperang ikut tetapan Thermal di atas.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kandungan QR</CardTitle>
          <CardDescription>Tetapan ini dikongsi untuk A4, Thermal, dan Paperang.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="qr-mode" className="mb-1 block text-sm font-medium text-muted-foreground">
              Kandungan QR
            </label>
            <Select
              id="qr-mode"
              value={formData.qr_mode || 'none'}
              onChange={(event) => handleQrModeChange(event.target.value)}
            >
              <option value="none">Tiada (Jangan letak QR)</option>
              <option value="url">Pautan (URL)</option>
            </Select>
          </div>

          {isQrDisabled ? (
            <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              QR tidak akan dipaparkan pada resit.
            </p>
          ) : (
            <>
              <div>
                <label htmlFor="qr-label" className="mb-1 block text-sm font-medium text-muted-foreground">
                  Label QR
                </label>
                <Input
                  id="qr-label"
                  value={formData.qr_label}
                  onChange={(event) => setField('qr_label', event.target.value)}
                  placeholder="Scan untuk lihat katalog"
                />
              </div>
              <div>
                <label htmlFor="qr-url-source" className="mb-1 block text-sm font-medium text-muted-foreground">
                  Sumber URL QR
                </label>
                <Select
                  id="qr-url-source"
                  value={qrUrlSource}
                  onChange={(event) => handleQrSourceChange(event.target.value)}
                >
                  <option value="custom">Custom URL</option>
                  <option value="catalog" disabled={catalogLinkOptions.length === 0}>
                    Link Katalog Sedia Ada
                  </option>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Hanya satu pilihan boleh digunakan pada satu masa.
                </p>
              </div>
              <div>
                <label htmlFor="qr-catalog-link" className="mb-1 block text-sm font-medium text-muted-foreground">
                  Pilih Link Katalog
                </label>
                <Select
                  id="qr-catalog-link"
                  value={selectedCatalogCode}
                  onChange={(event) => handleCatalogLinkChange(event.target.value)}
                  disabled={qrUrlSource !== 'catalog' || catalogLinkOptions.length === 0}
                >
                  <option value="">
                    {isCatalogLinksLoading ? 'Memuatkan link katalog...' : 'Pilih link katalog'}
                  </option>
                  {catalogLinkOptions.map((option) => (
                    <option key={option.id} value={option.public_code}>
                      {option.title || 'Katalog'} - {option.public_code}
                    </option>
                  ))}
                </Select>
                {qrCatalogError ? (
                  <p className="mt-1 text-xs text-red-600">{qrCatalogError}</p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Jika pilih katalog, URL QR auto ikut link katalog terpilih.
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="qr-url" className="mb-1 block text-sm font-medium text-muted-foreground">
                  URL QR
                </label>
                <Input
                  id="qr-url"
                  value={formData.qr_url}
                  onChange={(event) => setField('qr_url', event.target.value)}
                  placeholder="https://rarebits.my/catalog/xyz"
                  disabled={qrUrlSource !== 'custom'}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Contoh: https://rarebits.my/catalog/xyz atau https://wa.me/60123456789?text=Hai
                </p>
                {qrUrlError && <p className="mt-1 text-xs text-red-600">{qrUrlError}</p>}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Footer Notes</CardTitle>
          <CardDescription>Catatan ringkas untuk dipaparkan pada bahagian bawah resit/invois.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="footer-notes" className="mb-1 block text-sm font-medium text-muted-foreground">
              Catatan Footer
            </label>
            <textarea
              id="footer-notes"
              value={formData.footer_notes}
              onChange={(event) => setField('footer_notes', event.target.value)}
              placeholder="Contoh: Barangan yang dijual tidak boleh dipulangkan."
              className="min-h-[110px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" className="brand-gradient brand-gradient-hover text-white" disabled={isBusy}>
          {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Simpan
        </Button>
      </div>
    </form>
  );
};

export default InvoiceSettings;
