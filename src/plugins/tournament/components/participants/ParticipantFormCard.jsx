import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  CHECK_IN_STATUS,
  CHECK_IN_STATUS_OPTIONS,
  PAYMENT_STATUS,
  PAYMENT_STATUS_OPTIONS,
  REGISTRATION_STATUS,
  REGISTRATION_STATUS_OPTIONS,
} from '@/plugins/tournament/config/participantStatuses';

export const getInitialParticipantFormValues = (participant = null) => ({
  display_name: participant?.display_name || '',
  phone_number: participant?.phone_number || '',
  registration_status: participant?.registration_status || REGISTRATION_STATUS.REGISTERED,
  payment_status: participant?.payment_status || PAYMENT_STATUS.UNPAID,
  check_in_status: participant?.check_in_status || CHECK_IN_STATUS.NOT_CHECKED_IN,
  notes: participant?.notes || '',
});

const ParticipantFormCard = ({
  mode = 'create',
  initialValues,
  onSubmit,
  onCancel,
  isSubmitting = false,
  className,
}) => {
  const [values, setValues] = useState(() => getInitialParticipantFormValues(initialValues));
  const [nameError, setNameError] = useState('');

  useEffect(() => {
    setValues(getInitialParticipantFormValues(initialValues));
    setNameError('');
  }, [initialValues]);

  const formTitle = useMemo(
    () => (mode === 'edit' ? 'Edit Participant' : 'Add Participant'),
    [mode]
  );

  const handleChange = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (key === 'display_name' && nameError) {
      setNameError('');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmedName = String(values.display_name || '').trim();
    if (!trimmedName) {
      setNameError('Nama peserta wajib diisi.');
      return;
    }

    await onSubmit({
      ...values,
      display_name: trimmedName,
      phone_number: String(values.phone_number || '').trim(),
      notes: String(values.notes || '').trim(),
    });
  };

  return (
    <Card className={cn('border-primary/20', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{formTitle}</CardTitle>
        <CardDescription>
          Simpan maklumat asas peserta untuk persediaan bracket/seeding seterusnya.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Display Name</label>
              <Input
                value={values.display_name}
                onChange={(event) => handleChange('display_name', event.target.value)}
                placeholder="Nama peserta"
              />
              {nameError ? (
                <p className="text-xs font-medium text-rose-600">{nameError}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phone (Optional)</label>
              <Input
                value={values.phone_number}
                onChange={(event) => handleChange('phone_number', event.target.value)}
                placeholder="Contoh: 60123456789"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment Status</label>
              <Select
                value={values.payment_status}
                onChange={(event) => handleChange('payment_status', event.target.value)}
              >
                {PAYMENT_STATUS_OPTIONS.map((option) => (
                  <option key={`payment-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Check-In Status</label>
              <Select
                value={values.check_in_status}
                onChange={(event) => handleChange('check_in_status', event.target.value)}
              >
                {CHECK_IN_STATUS_OPTIONS.map((option) => (
                  <option key={`checkin-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Registration Status</label>
              <Select
                value={values.registration_status}
                onChange={(event) => handleChange('registration_status', event.target.value)}
              >
                {REGISTRATION_STATUS_OPTIONS.map((option) => (
                  <option key={`registration-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes (Optional)</label>
              <textarea
                className="min-h-[96px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm"
                value={values.notes}
                onChange={(event) => handleChange('notes', event.target.value)}
                placeholder="Catatan tambahan peserta"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" className="brand-gradient brand-gradient-hover text-white" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : (mode === 'edit' ? 'Save Changes' : 'Add Participant')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

export default ParticipantFormCard;
