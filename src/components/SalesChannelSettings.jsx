import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit, Save, Trash2, X, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  SALES_CHANNEL_FEE_TYPES,
  formatSalesChannelFeeLabel,
  normalizeSalesChannelFeeType,
} from '@/lib/salesChannels';

const DEFAULT_FORM = {
  name: '',
  fee_type: SALES_CHANNEL_FEE_TYPES.NONE,
  fee_value: '0',
};

const formatFeeValueForInput = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return '0';
  return String(parsed);
};

const SalesChannelSettings = ({ userId }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newChannel, setNewChannel] = useState(DEFAULT_FORM);
  const [editingChannel, setEditingChannel] = useState(null);

  const { data: channels = [], isLoading } = useQuery({
    queryKey: ['sales-channels', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_channels')
        .select('id, name, fee_type, fee_value, created_at, updated_at')
        .eq('user_id', userId)
        .order('name', { ascending: true });

      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
  });

  const channelCountText = useMemo(() => {
    if (channels.length === 0) return 'Belum ada platform jualan.';
    if (channels.length === 1) return '1 platform jualan.';
    return `${channels.length} platform jualan.`;
  }, [channels.length]);

  const sanitizePayload = (form) => {
    const name = String(form?.name || '').trim();
    const feeType = normalizeSalesChannelFeeType(form?.fee_type);
    const parsedFee = Number(form?.fee_value);
    const safeFeeValue = Number.isFinite(parsedFee) ? Math.max(parsedFee, 0) : 0;

    if (!name) {
      throw new Error('Nama platform diperlukan');
    }

    if (feeType === SALES_CHANNEL_FEE_TYPES.PERCENTAGE && safeFeeValue > 100) {
      throw new Error('Caj peratus mesti 0 hingga 100');
    }

    return {
      name,
      fee_type: feeType,
      fee_value: feeType === SALES_CHANNEL_FEE_TYPES.NONE ? 0 : safeFeeValue,
    };
  };

  const invalidateChannels = () => {
    queryClient.invalidateQueries({ queryKey: ['sales-channels', userId] });
  };

  const handleCreateChannel = async (event) => {
    event.preventDefault();
    if (!userId || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const payload = sanitizePayload(newChannel);
      const { error } = await supabase
        .from('sales_channels')
        .insert({
          user_id: userId,
          ...payload,
        });

      if (error) throw error;

      toast({ title: 'Platform jualan ditambah' });
      setNewChannel(DEFAULT_FORM);
      invalidateChannels();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal tambah platform',
        description: error?.message || 'Sila cuba lagi.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEdit = (channel) => {
    setEditingChannel({
      ...channel,
      fee_type: normalizeSalesChannelFeeType(channel.fee_type),
      fee_value: formatFeeValueForInput(channel.fee_value),
    });
  };

  const handleSaveEdit = async (event) => {
    event.preventDefault();
    if (!editingChannel || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const payload = sanitizePayload(editingChannel);
      const { error } = await supabase
        .from('sales_channels')
        .update(payload)
        .eq('id', editingChannel.id)
        .eq('user_id', userId);

      if (error) throw error;

      toast({ title: 'Platform jualan dikemaskini' });
      setEditingChannel(null);
      invalidateChannels();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal kemaskini platform',
        description: error?.message || 'Sila cuba lagi.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteChannel = async (channelId) => {
    if (!channelId || isSubmitting) return;
    if (!window.confirm('Padam platform jualan ini?')) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('sales_channels')
        .delete()
        .eq('id', channelId)
        .eq('user_id', userId);

      if (error) throw error;

      toast({ title: 'Platform jualan dipadam' });
      if (editingChannel?.id === channelId) {
        setEditingChannel(null);
      }
      invalidateChannels();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal padam platform',
        description: error?.message || 'Platform ini mungkin sedang digunakan dalam invois.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Tambah Platform Jualan</CardTitle>
          <CardDescription>
            Tetapkan caj platform untuk kiraan untung bersih automatik.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleCreateChannel}>
            <div>
              <label htmlFor="sales-channel-name" className="mb-1 block text-sm font-medium text-muted-foreground">
                Nama Platform
              </label>
              <Input
                id="sales-channel-name"
                value={newChannel.name}
                onChange={(event) => setNewChannel((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="cth: Shopee, Walk-in, TikTok"
                disabled={isSubmitting}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[170px_1fr]">
              <div>
                <label htmlFor="sales-channel-fee-type" className="mb-1 block text-sm font-medium text-muted-foreground">
                  Jenis Caj
                </label>
                <Select
                  id="sales-channel-fee-type"
                  value={newChannel.fee_type}
                  onChange={(event) => setNewChannel((prev) => ({ ...prev, fee_type: event.target.value }))}
                  disabled={isSubmitting}
                >
                  <option value={SALES_CHANNEL_FEE_TYPES.NONE}>Tiada</option>
                  <option value={SALES_CHANNEL_FEE_TYPES.PERCENTAGE}>Peratus (%)</option>
                  <option value={SALES_CHANNEL_FEE_TYPES.FIXED}>Tetap (RM)</option>
                </Select>
              </div>
              <div>
                <label htmlFor="sales-channel-fee-value" className="mb-1 block text-sm font-medium text-muted-foreground">
                  Nilai Caj
                </label>
                <Input
                  id="sales-channel-fee-value"
                  type="number"
                  min="0"
                  step="0.01"
                  value={newChannel.fee_value}
                  onChange={(event) => setNewChannel((prev) => ({ ...prev, fee_value: event.target.value }))}
                  disabled={isSubmitting || newChannel.fee_type === SALES_CHANNEL_FEE_TYPES.NONE}
                  placeholder="0.00"
                />
              </div>
            </div>
            <Button type="submit" disabled={isSubmitting} className="berry-gradient berry-gradient-hover text-white">
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Tambah Platform
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Urus Platform Jualan</CardTitle>
          <CardDescription>{channelCountText}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Memuatkan platform...
            </div>
          ) : channels.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Tambah platform pertama anda untuk mula kira caj automatik.
            </div>
          ) : (
            <div className="space-y-2">
              {channels.map((channel) => {
                const isEditing = editingChannel?.id === channel.id;
                if (isEditing) {
                  return (
                    <form
                      key={channel.id}
                      onSubmit={handleSaveEdit}
                      className="space-y-3 rounded-lg border bg-secondary/30 p-3"
                    >
                      <Input
                        value={editingChannel.name}
                        onChange={(event) => setEditingChannel((prev) => ({ ...prev, name: event.target.value }))}
                        placeholder="Nama platform"
                        disabled={isSubmitting}
                      />
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[170px_1fr]">
                        <Select
                          value={editingChannel.fee_type}
                          onChange={(event) =>
                            setEditingChannel((prev) => ({ ...prev, fee_type: event.target.value }))
                          }
                          disabled={isSubmitting}
                        >
                          <option value={SALES_CHANNEL_FEE_TYPES.NONE}>Tiada</option>
                          <option value={SALES_CHANNEL_FEE_TYPES.PERCENTAGE}>Peratus (%)</option>
                          <option value={SALES_CHANNEL_FEE_TYPES.FIXED}>Tetap (RM)</option>
                        </Select>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editingChannel.fee_value}
                          onChange={(event) =>
                            setEditingChannel((prev) => ({ ...prev, fee_value: event.target.value }))
                          }
                          disabled={isSubmitting || editingChannel.fee_type === SALES_CHANNEL_FEE_TYPES.NONE}
                          placeholder="0.00"
                        />
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <Button type="submit" size="sm" disabled={isSubmitting}>
                          <Save className="mr-1 h-4 w-4" />
                          Simpan
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingChannel(null)}
                          disabled={isSubmitting}
                        >
                          <X className="mr-1 h-4 w-4" />
                          Batal
                        </Button>
                      </div>
                    </form>
                  );
                }

                return (
                  <div key={channel.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium break-words">{channel.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatSalesChannelFeeLabel(channel)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleStartEdit(channel)}
                        disabled={isSubmitting}
                        aria-label={`Sunting ${channel.name}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-600"
                        onClick={() => handleDeleteChannel(channel.id)}
                        disabled={isSubmitting}
                        aria-label={`Padam ${channel.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
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

export default SalesChannelSettings;
