import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';

export const DEFAULT_INVOICE_SETTINGS = {
  company_name: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  fax: '',
  logo_url: '',
  show_logo: true,
  show_logo_a4: true,
  show_logo_thermal: false,
  show_logo_paperang: false,
  qr_enabled_a4: false,
  qr_enabled_thermal: false,
  qr_enabled_paperang: false,
  qr_label: 'Scan untuk lihat katalog',
  qr_url: '',
  tax_number: '',
  show_tax: false,
  thermal_show_address: false,
  thermal_show_phone: true,
  thermal_show_email: false,
  thermal_show_website: true,
  thermal_show_tax: null,
  business_reg_no: '',
  footer_notes: '',
  show_generated_by: true,
  show_generated_by_a4: true,
  show_generated_by_thermal: false,
  show_generated_by_paperang: false,
};

const normalizeInvoiceSettings = (settings) => ({
  ...DEFAULT_INVOICE_SETTINGS,
  ...(settings || {}),
  show_logo: settings?.show_logo ?? DEFAULT_INVOICE_SETTINGS.show_logo,
  show_logo_a4: settings?.show_logo_a4 ?? settings?.show_logo ?? DEFAULT_INVOICE_SETTINGS.show_logo_a4,
  show_logo_thermal: settings?.show_logo_thermal ?? DEFAULT_INVOICE_SETTINGS.show_logo_thermal,
  show_logo_paperang: settings?.show_logo_paperang ?? DEFAULT_INVOICE_SETTINGS.show_logo_paperang,
  qr_enabled_a4: settings?.qr_enabled_a4 ?? DEFAULT_INVOICE_SETTINGS.qr_enabled_a4,
  qr_enabled_thermal: settings?.qr_enabled_thermal ?? DEFAULT_INVOICE_SETTINGS.qr_enabled_thermal,
  qr_enabled_paperang: settings?.qr_enabled_paperang ?? DEFAULT_INVOICE_SETTINGS.qr_enabled_paperang,
  qr_label: settings?.qr_label ?? DEFAULT_INVOICE_SETTINGS.qr_label,
  qr_url: settings?.qr_url ?? DEFAULT_INVOICE_SETTINGS.qr_url,
  show_tax: settings?.show_tax ?? DEFAULT_INVOICE_SETTINGS.show_tax,
  thermal_show_address: settings?.thermal_show_address ?? DEFAULT_INVOICE_SETTINGS.thermal_show_address,
  thermal_show_phone: settings?.thermal_show_phone ?? DEFAULT_INVOICE_SETTINGS.thermal_show_phone,
  thermal_show_email: settings?.thermal_show_email ?? DEFAULT_INVOICE_SETTINGS.thermal_show_email,
  thermal_show_website: settings?.thermal_show_website ?? DEFAULT_INVOICE_SETTINGS.thermal_show_website,
  thermal_show_tax: settings?.thermal_show_tax ?? null,
  show_generated_by: settings?.show_generated_by ?? DEFAULT_INVOICE_SETTINGS.show_generated_by,
  show_generated_by_a4: settings?.show_generated_by_a4 ?? settings?.show_generated_by ?? DEFAULT_INVOICE_SETTINGS.show_generated_by_a4,
  show_generated_by_thermal: settings?.show_generated_by_thermal ?? DEFAULT_INVOICE_SETTINGS.show_generated_by_thermal,
  show_generated_by_paperang: settings?.show_generated_by_paperang ?? DEFAULT_INVOICE_SETTINGS.show_generated_by_paperang,
});

export const useInvoiceSettings = (userIdProp) => {
  const queryClient = useQueryClient();
  const shouldFetchAuth = !userIdProp;

  const { data: authData } = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: shouldFetchAuth,
  });

  const userId = userIdProp || authData?.session?.user?.id;

  const invoiceSettingsQuery = useQuery({
    queryKey: ['invoice-settings', userId],
    queryFn: async () => {
      if (!userId) return DEFAULT_INVOICE_SETTINGS;

      const { data, error } = await supabase
        .from('invoice_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116' && error.code !== '42P01') {
        throw error;
      }

      return normalizeInvoiceSettings(data);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (payload) => {
      if (!userId) throw new Error('User tidak sah');

      const upsertPayload = {
        user_id: userId,
        ...payload,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('invoice_settings')
        .upsert(upsertPayload, { onConflict: 'user_id' })
        .select('*')
        .single();

      if (error) throw error;
      return normalizeInvoiceSettings(data);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['invoice-settings', userId], data);
    },
  });

  const saveSettings = async (payload) => saveSettingsMutation.mutateAsync(payload);

  return {
    settings: invoiceSettingsQuery.data || DEFAULT_INVOICE_SETTINGS,
    isLoading: invoiceSettingsQuery.isLoading,
    isFetching: invoiceSettingsQuery.isFetching,
    isSaving: saveSettingsMutation.isPending,
    error: invoiceSettingsQuery.error || saveSettingsMutation.error,
    saveSettings,
    refetch: invoiceSettingsQuery.refetch,
  };
};

export default useInvoiceSettings;
