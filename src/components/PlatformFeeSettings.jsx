import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit, Save, Trash2, X, Loader2, Power, ChevronDown } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  PLATFORM_FEE_APPLIES_TO,
  PLATFORM_FEE_TYPES,
  getPlatformFeeAppliesToLabel,
  formatPlatformFeeRuleLabel,
  normalizePlatformFeeAppliesTo,
  normalizePlatformFeeType,
} from '@/lib/platformFees';

const DEFAULT_FORM = {
  name: '',
  fee_type: PLATFORM_FEE_TYPES.PERCENTAGE,
  applies_to: PLATFORM_FEE_APPLIES_TO.ITEM_SUBTOTAL,
  fee_value: '0',
};

const FEE_TYPE_OPTIONS = [
  { value: PLATFORM_FEE_TYPES.PERCENTAGE, label: 'Peratus (%)' },
  { value: PLATFORM_FEE_TYPES.FLAT, label: 'Tetap (RM)' },
];

const APPLIES_TO_OPTIONS = [
  { value: PLATFORM_FEE_APPLIES_TO.ITEM_SUBTOTAL, label: 'Harga barang sahaja' },
  { value: PLATFORM_FEE_APPLIES_TO.SHIPPING_CHARGED, label: 'Caj pos pelanggan' },
  { value: PLATFORM_FEE_APPLIES_TO.TOTAL_COLLECTED, label: 'Jumlah kutipan (barang + pos)' },
];

const ThemedSelect = ({
  id,
  value,
  options,
  onValueChange,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const selectedLabel = options.find((option) => option.value === value)?.label || '';

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-full border border-cyan-300 bg-white px-4 py-2 text-sm font-medium text-cyan-700 transition-colors',
          'hover:border-primary/40 hover:bg-white hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <span className="truncate text-left">{selectedLabel}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-2xl border border-cyan-200 bg-white shadow-lg">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'block w-full px-4 py-2 text-left text-sm transition-colors',
                  'hover:bg-primary/10 hover:text-primary',
                  isSelected ? 'bg-primary/10 font-medium text-primary' : 'text-slate-700'
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

const formatFeeValueForInput = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return '0';
  return String(parsed);
};

const PlatformFeeSettings = ({ userId }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newRule, setNewRule] = useState(DEFAULT_FORM);
  const [editingRule, setEditingRule] = useState(null);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['platform-fee-rules', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_fee_rules')
        .select('id, name, fee_type, applies_to, fee_value, is_active, created_at')
        .eq('user_id', userId)
        .order('name', { ascending: true });

      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
  });

  const ruleCountText = useMemo(() => {
    if (rules.length === 0) return 'Belum ada rule caj platform.';
    if (rules.length === 1) return '1 rule caj platform.';
    return `${rules.length} rule caj platform.`;
  }, [rules.length]);

  const sanitizePayload = (form) => {
    const name = String(form?.name || '').trim();
    const feeType = normalizePlatformFeeType(form?.fee_type);
    const appliesTo = normalizePlatformFeeAppliesTo(form?.applies_to);
    const parsedFee = Number(form?.fee_value);
    const safeFeeValue = Number.isFinite(parsedFee) ? Math.max(parsedFee, 0) : 0;

    if (!name) {
      throw new Error('Nama fee diperlukan');
    }

    if (feeType === PLATFORM_FEE_TYPES.PERCENTAGE && safeFeeValue > 100) {
      throw new Error('Fee peratus mesti 0 hingga 100');
    }

    return {
      name,
      fee_type: feeType,
      applies_to: appliesTo,
      fee_value: safeFeeValue,
    };
  };

  const invalidateRules = () => {
    queryClient.invalidateQueries({ queryKey: ['platform-fee-rules', userId] });
  };

  const handleCreateRule = async (event) => {
    event.preventDefault();
    if (!userId || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const payload = sanitizePayload(newRule);
      const { error } = await supabase
        .from('platform_fee_rules')
        .insert({
          user_id: userId,
          ...payload,
          is_active: true,
        });

      if (error) throw error;

      toast({ title: 'Rule caj platform ditambah' });
      setNewRule(DEFAULT_FORM);
      invalidateRules();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal tambah rule',
        description: error?.message || 'Sila cuba lagi.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEdit = (rule) => {
    setEditingRule({
      ...rule,
      fee_type: normalizePlatformFeeType(rule.fee_type),
      applies_to: normalizePlatformFeeAppliesTo(rule.applies_to),
      fee_value: formatFeeValueForInput(rule.fee_value),
    });
  };

  const handleSaveEdit = async (event) => {
    event.preventDefault();
    if (!editingRule || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const payload = sanitizePayload(editingRule);
      const { error } = await supabase
        .from('platform_fee_rules')
        .update(payload)
        .eq('id', editingRule.id)
        .eq('user_id', userId);

      if (error) throw error;

      toast({ title: 'Rule caj platform dikemaskini' });
      setEditingRule(null);
      invalidateRules();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal kemaskini rule',
        description: error?.message || 'Sila cuba lagi.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleRule = async (rule) => {
    if (!rule?.id || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('platform_fee_rules')
        .update({ is_active: !rule.is_active })
        .eq('id', rule.id)
        .eq('user_id', userId);

      if (error) throw error;

      toast({ title: rule.is_active ? 'Rule dinyahaktifkan' : 'Rule diaktifkan' });
      invalidateRules();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal tukar status rule',
        description: error?.message || 'Sila cuba lagi.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (!ruleId || isSubmitting) return;
    if (!window.confirm('Padam rule caj platform ini?')) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('platform_fee_rules')
        .delete()
        .eq('id', ruleId)
        .eq('user_id', userId);

      if (error) throw error;

      toast({ title: 'Rule caj platform dipadam' });
      if (editingRule?.id === ruleId) {
        setEditingRule(null);
      }
      invalidateRules();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal padam rule',
        description: error?.message || 'Rule mungkin masih dirujuk dalam invois lama.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Tambah Caj Platform</CardTitle>
          <CardDescription>
            Rule ini digunakan sebagai checkbox multi-select dalam borang invois.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleCreateRule}>
            <div>
              <label htmlFor="platform-fee-name" className="mb-1 block text-sm font-medium text-muted-foreground">
                Nama Caj
              </label>
              <Input
                id="platform-fee-name"
                value={newRule.name}
                onChange={(event) => setNewRule((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="cth: Shopee Service Fee"
                disabled={isSubmitting}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[170px_1fr_1fr]">
              <div>
                <label htmlFor="platform-fee-type" className="mb-1 block text-sm font-medium text-muted-foreground">
                  Jenis Caj
                </label>
                <ThemedSelect
                  id="platform-fee-type"
                  value={newRule.fee_type}
                  onValueChange={(nextValue) => setNewRule((prev) => ({ ...prev, fee_type: nextValue }))}
                  options={FEE_TYPE_OPTIONS}
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label htmlFor="platform-fee-applies-to" className="mb-1 block text-sm font-medium text-muted-foreground">
                  Kira Berdasarkan
                </label>
                <ThemedSelect
                  id="platform-fee-applies-to"
                  value={newRule.applies_to}
                  onValueChange={(nextValue) => setNewRule((prev) => ({ ...prev, applies_to: nextValue }))}
                  options={APPLIES_TO_OPTIONS}
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label htmlFor="platform-fee-value" className="mb-1 block text-sm font-medium text-muted-foreground">
                  Nilai Caj
                </label>
                <Input
                  id="platform-fee-value"
                  type="number"
                  min="0"
                  step="0.01"
                  value={newRule.fee_value}
                  onChange={(event) => setNewRule((prev) => ({ ...prev, fee_value: event.target.value }))}
                  disabled={isSubmitting}
                  placeholder="0.00"
                />
              </div>
            </div>
            <Button type="submit" disabled={isSubmitting} className="berry-gradient berry-gradient-hover text-white">
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Tambah Fee
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Senarai Caj Platform</CardTitle>
          <CardDescription>{ruleCountText}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Memuatkan rule...
            </div>
          ) : rules.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Tambah rule pertama untuk guna caj platform dalam invois.
            </div>
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => {
                const isEditing = editingRule?.id === rule.id;
                if (isEditing) {
                  return (
                    <form
                      key={rule.id}
                      onSubmit={handleSaveEdit}
                      className="space-y-3 rounded-lg border bg-secondary/30 p-3"
                    >
                      <Input
                        value={editingRule.name}
                        onChange={(event) => setEditingRule((prev) => ({ ...prev, name: event.target.value }))}
                        placeholder="Nama caj"
                        disabled={isSubmitting}
                      />
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[170px_1fr_1fr]">
                        <ThemedSelect
                          value={editingRule.fee_type}
                          onValueChange={(nextValue) => setEditingRule((prev) => ({ ...prev, fee_type: nextValue }))}
                          options={FEE_TYPE_OPTIONS}
                          disabled={isSubmitting}
                        />
                        <ThemedSelect
                          value={editingRule.applies_to}
                          onValueChange={(nextValue) => setEditingRule((prev) => ({ ...prev, applies_to: nextValue }))}
                          options={APPLIES_TO_OPTIONS}
                          disabled={isSubmitting}
                        />
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editingRule.fee_value}
                          onChange={(event) =>
                            setEditingRule((prev) => ({ ...prev, fee_value: event.target.value }))
                          }
                          disabled={isSubmitting}
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
                          onClick={() => setEditingRule(null)}
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
                  <div key={rule.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium break-words">{rule.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatPlatformFeeRuleLabel(rule)} | {getPlatformFeeAppliesToLabel(rule.applies_to)} | {rule.is_active ? 'Aktif' : 'Tidak aktif'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleRule(rule)}
                        disabled={isSubmitting}
                        aria-label={`${rule.is_active ? 'Nyahaktifkan' : 'Aktifkan'} ${rule.name}`}
                      >
                        <Power className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleStartEdit(rule)}
                        disabled={isSubmitting}
                        aria-label={`Sunting ${rule.name}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-600"
                        onClick={() => handleDeleteRule(rule.id)}
                        disabled={isSubmitting}
                        aria-label={`Padam ${rule.name}`}
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

export default PlatformFeeSettings;
