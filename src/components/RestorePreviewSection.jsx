import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, ImagePlus, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { parseBackupZip } from '@/lib/backup/parseBackupZip';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';

const formatTimestamp = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return new Intl.DateTimeFormat('ms-MY', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
};

const formatNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '-';
  return new Intl.NumberFormat('ms-MY', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(parsed);
};

const formatDateRange = (filterValue) => {
  if (!filterValue || filterValue === 'all_time') return 'Semua masa';
  if (typeof filterValue !== 'object') return String(filterValue);

  const startDate = filterValue.startDate || filterValue.start_date || null;
  const endDate = filterValue.endDate || filterValue.end_date || null;

  if (!startDate && !endDate) return 'Semua masa';
  if (startDate && endDate) return `${startDate} hingga ${endDate}`;
  if (startDate) return `Dari ${startDate}`;
  return `Sehingga ${endDate}`;
};

const statusChipClass = (status) => {
  if (status === 'pass') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'warn') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-rose-200 bg-rose-50 text-rose-700';
};

const mediaStatusChipClass = (status) => {
  if (status === 'included') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'included_with_warnings') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-rose-200 bg-rose-50 text-rose-700';
};

const safeParseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const resolveRestoreMediaFunctionUrl = () => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL tiada.');
  }
  return `${supabaseUrl}/functions/v1/restore-media-from-backup`;
};

const resolveRestoreMediaRealPathFunctionUrl = () => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL tiada.');
  }
  return `${supabaseUrl}/functions/v1/restore-full-backup-to-account`;
};

const RestorePreviewSection = () => {
  const { toast } = useToast();
  const inputRef = useRef(null);
  const [isParsing, setIsParsing] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [showMediaDetails, setShowMediaDetails] = useState(false);
  const [isRestoreConfirmOpen, setIsRestoreConfirmOpen] = useState(false);
  const [isRestoringMedia, setIsRestoringMedia] = useState(false);
  const [mediaRestoreResult, setMediaRestoreResult] = useState(null);
  const [mediaRestoreError, setMediaRestoreError] = useState('');
  const [isDummyRestoreConfirmOpen, setIsDummyRestoreConfirmOpen] = useState(false);
  const [isRestoringDummyMedia, setIsRestoringDummyMedia] = useState(false);
  const [dummyMediaRestoreResult, setDummyMediaRestoreResult] = useState(null);
  const [dummyMediaRestoreError, setDummyMediaRestoreError] = useState('');
  const [forceWipeDisaster, setForceWipeDisaster] = useState(false);

  const hasPreview = Boolean(preview);
  const exportedTables = preview?.exported_tables || [];
  const warnings = preview?.warnings || [];
  const media = preview?.media || null;

  const totals = useMemo(() => {
    if (!preview?.summary) return [];
    const summary = preview.summary;
    const hasRevenueItem = summary.revenue_item !== null && summary.revenue_item !== undefined;
    const raw = [
      { key: 'net_profit_current', label: 'Untung Bersih', value: summary.net_profit_current ?? summary.total_profit },
      ...(hasRevenueItem
        ? [{ key: 'revenue_item', label: 'Revenue Item (Barang Sahaja)', value: summary.revenue_item }]
        : []),
      {
        key: 'total_revenue',
        label: 'Total Revenue (Item + Caj Pos)',
        value: summary.total_revenue,
        helperText: hasRevenueItem ? null : 'Termasuk caj pos',
      },
      { key: 'total_expense', label: 'Jumlah Expense', value: summary.total_expense },
      { key: 'wallet_balance', label: 'Baki Wallet', value: summary.wallet_balance },
      { key: 'invoice_count', label: 'Bil. Invois', value: summary.invoice_count },
      { key: 'inventory_value', label: 'Nilai Inventori', value: summary.inventory_value },
    ];

    return raw.filter((item) => item.value !== null && item.value !== undefined);
  }, [preview]);

  const integrityChecks = useMemo(() => {
    if (!preview?.integrity) return [];

    return [
      {
        key: 'zip-parsed',
        label: 'ZIP parsed',
        status: preview.integrity.zipParsed ? 'pass' : 'fail',
        text: preview.integrity.zipParsed ? 'ZIP berjaya dibaca.' : 'ZIP gagal dibaca.',
      },
      {
        key: 'metadata',
        label: 'metadata.json exists',
        status: preview.integrity.metadataExists ? 'pass' : 'fail',
        text: preview.integrity.metadataExists ? 'metadata.json dijumpai.' : 'metadata.json tidak dijumpai.',
      },
      {
        key: 'checksum',
        label: 'checksum present',
        status: preview.integrity.checksumPresent ? 'pass' : 'warn',
        text: preview.integrity.checksumPresent
          ? (preview.integrity.checksumFormatValid ? 'Checksum tersedia.' : 'Checksum ada tetapi format tidak standard.')
          : 'Checksum tiada dalam metadata.',
      },
      {
        key: 'timestamp',
        label: 'export_timestamp valid',
        status: preview.summary?.export_timestamp_valid ? 'pass' : 'warn',
        text: preview.summary?.export_timestamp_valid
          ? 'Tarikh export sah.'
          : 'Tarikh export tidak sah atau tiada.',
      },
    ];
  }, [preview]);

  const restorePlan = useMemo(() => {
    const included = exportedTables
      .filter((table) => table.source_table)
      .map((table) => table.key);
    const missing = exportedTables
      .filter((table) => !table.source_table)
      .map((table) => table.key);

    return { included, missing };
  }, [exportedTables]);

  const mediaCoverage = useMemo(() => {
    if (!media) {
      return {
        status: 'not_included',
        label: 'Not included',
        subtext: 'Backup ini tidak menyertakan gambar. Ia hanya simpan URL/path sahaja.',
      };
    }

    const filesCount = Number.isFinite(Number(media.files_count)) ? Number(media.files_count) : 0;
    const missingCount = Number.isFinite(Number(media.missing_count)) ? Number(media.missing_count) : 0;

    if (media.status === 'included') {
      return {
        status: 'included',
        label: `Included (${filesCount} files)`,
        subtext: 'Gambar boleh dipulihkan semula semasa restore.',
      };
    }

    if (media.status === 'included_with_warnings') {
      return {
        status: 'included_with_warnings',
        label: `Included with warnings (${filesCount} files, ${missingCount} missing)`,
        subtext: media.manifest_exists
          ? 'Sebahagian fail media tidak lengkap. Semak detail amaran.'
          : 'Folder media ada, tetapi media_manifest.json tiada. Semakan mungkin tidak lengkap.',
      };
    }

    return {
      status: 'not_included',
      label: 'Not included',
      subtext: 'Backup ini tidak menyertakan gambar. Ia hanya simpan URL/path sahaja.',
    };
  }, [media]);

  const mediaWarningsPreview = useMemo(() => {
    if (!Array.isArray(media?.warnings)) return [];
    return media.warnings.slice(0, 10);
  }, [media]);

  const mediaRestoreErrorsPreview = useMemo(() => {
    if (!Array.isArray(mediaRestoreResult?.errors)) return [];
    return mediaRestoreResult.errors.slice(0, 10);
  }, [mediaRestoreResult]);

  const dummyMediaConflictsPreview = useMemo(() => {
    if (!Array.isArray(dummyMediaRestoreResult?.media?.conflicts)) return [];
    return dummyMediaRestoreResult.media.conflicts.slice(0, 20);
  }, [dummyMediaRestoreResult]);

  const dummyMediaErrorsPreview = useMemo(() => {
    const mediaErrors = Array.isArray(dummyMediaRestoreResult?.media?.errors)
      ? dummyMediaRestoreResult.media.errors
      : [];
    const dataErrors = Array.isArray(dummyMediaRestoreResult?.data?.errors)
      ? dummyMediaRestoreResult.data.errors
      : [];
    return [...mediaErrors, ...dataErrors].slice(0, 20);
  }, [dummyMediaRestoreResult]);

  const canShowMediaDetails = Boolean(
    media?.manifest_parse_error
      || (Array.isArray(media?.warnings) && media.warnings.length > 0)
      || (media && media.status === 'included_with_warnings' && !media.manifest_exists),
  );

  const showRestoreMediaButton = mediaCoverage.status !== 'not_included';
  const canRestoreMedia = Boolean(
    showRestoreMediaButton
      && media?.manifest_exists
      && selectedFile
      && !isParsing
      && !isRestoringMedia
      && !isRestoringDummyMedia,
  );

  const canRestoreDummyMedia = Boolean(
    showRestoreMediaButton
      && media?.manifest_exists
      && selectedFile
      && !isParsing
      && !isRestoringMedia
      && !isRestoringDummyMedia,
  );

  const restoreMediaDisabledReason = !selectedFile
    ? 'Sila upload backup ZIP dahulu.'
    : !media?.manifest_exists
      ? 'media_manifest.json tiada. Restore media sandbox perlukan manifest.'
      : null;

  const restoreDummyMediaDisabledReason = !selectedFile
    ? 'Sila upload backup ZIP dahulu.'
    : !media?.manifest_exists
      ? 'media_manifest.json tiada. Restore disaster perlukan manifest.'
      : null;

  const handleCopyMediaErrors = async () => {
    if (!media) return;

    const lines = [];
    if (media.manifest_parse_error) {
      lines.push(`MEDIA_MANIFEST_INVALID: ${media.manifest_parse_error}`);
    }

    if (Array.isArray(media.warnings) && media.warnings.length > 0) {
      media.warnings.forEach((warning, index) => {
        const location = warning.bucket && warning.key ? `${warning.bucket}/${warning.key}` : '-';
        lines.push(`${index + 1}. ${location} :: ${warning.message || 'Unknown warning'}`);
      });
    }

    if (lines.length === 0) {
      lines.push('Tiada media error/warning.');
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast({
        title: 'Senarai media warning disalin',
        description: `${lines.length} baris`,
      });
    } catch (_error) {
      toast({
        title: 'Gagal salin senarai warning',
        description: 'Clipboard tidak dibenarkan oleh browser.',
        variant: 'destructive',
      });
    }
  };

  const handleRestoreMediaSandbox = async () => {
    if (!selectedFile) {
      setMediaRestoreError('Sila pilih fail backup .zip dahulu.');
      return;
    }

    setIsRestoringMedia(true);
    setMediaRestoreError('');
    setMediaRestoreResult(null);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw new Error(sessionError.message || 'Gagal sahkan sesi pengguna.');
      }

      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        throw new Error('Sesi pengguna tidak sah.');
      }

      const endpoint = resolveRestoreMediaFunctionUrl();
      const formData = new FormData();
      formData.append('file', selectedFile, selectedFile.name || 'backup.zip');
      if (preview?.metadata?.checksum) {
        formData.append('backup_checksum', String(preview.metadata.checksum));
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      });

      const rawBody = await response.text();
      const parsedBody = safeParseJson(rawBody);
      if (!response.ok) {
        const serverError = parsedBody?.error || parsedBody?.details || rawBody || 'Restore media gagal.';
        throw new Error(serverError);
      }

      const result = parsedBody && typeof parsedBody === 'object' ? parsedBody : {};
      setMediaRestoreResult(result);

      const failedCount = (Number(result?.media?.failed_count) || 0) + (Number(result?.data?.failed_count) || 0);
      const uploadedCount = Number(result.uploaded_count) || 0;
      toast({
        title: failedCount > 0 ? 'Restore media selesai dengan amaran' : 'Restore media sandbox berjaya',
        description: `Uploaded: ${uploadedCount}, Failed: ${failedCount}`,
        variant: failedCount > 0 ? 'destructive' : 'default',
      });
    } catch (error) {
      const message = error?.message || 'Restore media gagal.';
      setMediaRestoreError(message);
      toast({
        title: 'Restore media sandbox gagal',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsRestoringMedia(false);
    }
  };

  const handleRestoreMediaDummyAccount = async () => {
    if (!selectedFile) {
      setDummyMediaRestoreError('Sila pilih fail backup .zip dahulu.');
      return;
    }

    setIsRestoringDummyMedia(true);
    setDummyMediaRestoreError('');
    setDummyMediaRestoreResult(null);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw new Error(sessionError.message || 'Gagal sahkan sesi pengguna.');
      }

      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        throw new Error('Sesi pengguna tidak sah.');
      }

      const endpoint = resolveRestoreMediaRealPathFunctionUrl();
      const formData = new FormData();
      formData.append('file', selectedFile, selectedFile.name || 'backup.zip');
      formData.append('restore_mode', 'disaster');
      formData.append('force_wipe', forceWipeDisaster ? 'true' : 'false');
      if (preview?.metadata?.checksum) {
        formData.append('backup_checksum', String(preview.metadata.checksum));
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      });

      const rawBody = await response.text();
      const parsedBody = safeParseJson(rawBody);
      if (!response.ok) {
        const serverError = parsedBody?.error || parsedBody?.details || rawBody || 'Disaster restore gagal.';
        throw new Error(serverError);
      }

      const result = parsedBody && typeof parsedBody === 'object' ? parsedBody : {};
      setDummyMediaRestoreResult(result);

      const mediaFailedCount = Number(result?.media?.failed_count) || 0;
      const dataFailedCount = Number(result?.data?.failed_count) || 0;
      const failedCount = mediaFailedCount + dataFailedCount;
      const uploadedCount = Number(result?.media?.uploaded_count ?? result.uploaded_count) || 0;
      const skippedExistingCount = Number(result?.media?.skipped_existing_count ?? result.skipped_existing_count) || 0;
      const skippedMissingParentCount = Number(result?.data?.skipped_missing_parent_count) || 0;
      const skippedLockedCount = Number(result?.data?.skipped_locked_count) || 0;
      const insertedCount = Number(result?.data?.inserted_count) || 0;
      toast({
        title: failedCount > 0 ? 'Disaster restore selesai dengan amaran' : 'Disaster restore berjaya',
        description: `Media uploaded: ${uploadedCount}, Skipped existing: ${skippedExistingCount}, Data inserted: ${insertedCount}, Skip missing parent: ${skippedMissingParentCount}, Skip locked: ${skippedLockedCount}, Failed: ${failedCount}`,
        variant: failedCount > 0 ? 'destructive' : 'default',
      });
    } catch (error) {
      const message = error?.message || 'Disaster restore gagal.';
      setDummyMediaRestoreError(message);
      toast({
        title: 'Disaster restore gagal',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsRestoringDummyMedia(false);
    }
  };

  const handleClear = () => {
    setPreview(null);
    setErrorMessage('');
    setSelectedFileName('');
    setSelectedFile(null);
    setShowMediaDetails(false);
    setMediaRestoreResult(null);
    setMediaRestoreError('');
    setDummyMediaRestoreResult(null);
    setDummyMediaRestoreError('');
    setForceWipeDisaster(false);
    setIsRestoreConfirmOpen(false);
    setIsDummyRestoreConfirmOpen(false);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setSelectedFile(file);
    setSelectedFileName(file.name);
    setErrorMessage('');
    setPreview(null);
    setShowMediaDetails(false);
    setMediaRestoreResult(null);
    setMediaRestoreError('');
    setDummyMediaRestoreResult(null);
    setDummyMediaRestoreError('');

    try {
      const parsed = await parseBackupZip(file);
      setPreview(parsed);
      toast({
        title: 'Preview backup siap',
        description: file.name,
      });
    } catch (error) {
      const message = error?.message || 'Gagal membaca fail backup.';
      setErrorMessage(message);
      toast({
        title: 'Preview backup gagal',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsParsing(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white/80 p-4 space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Restore (Preview)</h3>
        <p className="text-sm text-muted-foreground">
          Muat naik fail backup (.zip) untuk semak kandungan sebelum restore.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button asChild variant="outline" className="h-10 rounded-xl">
          <label htmlFor="restore-preview-upload" className="cursor-pointer">
            <FileUp className="mr-2 h-4 w-4" />
            Upload Backup (.zip)
          </label>
        </Button>
        <input
          ref={inputRef}
          id="restore-preview-upload"
          type="file"
          accept=".zip"
          className="sr-only"
          onChange={handleFileChange}
          disabled={isParsing}
        />

        {(selectedFileName || hasPreview || errorMessage) && (
          <Button type="button" variant="ghost" className="h-10 rounded-xl" onClick={handleClear} disabled={isParsing || isRestoringMedia || isRestoringDummyMedia}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Clear
          </Button>
        )}
      </div>

      {selectedFileName && (
        <p className="text-xs text-muted-foreground">
          Fail dipilih: <span className="font-medium text-foreground">{selectedFileName}</span>
        </p>
      )}

      {isParsing && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary">
          <Loader2 className="h-4 w-4 animate-spin" />
          Membaca kandungan ZIP...
        </div>
      )}

      {errorMessage && !isParsing && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <div className="flex items-start gap-2">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Preview gagal</p>
              <p>{errorMessage}</p>
            </div>
          </div>
        </div>
      )}

      {hasPreview && !isParsing && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <h4 className="text-sm font-semibold text-foreground">Backup Summary</h4>
            <div className="mt-2 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              <p>
                <span className="font-medium text-foreground">Export timestamp:</span>{' '}
                {formatTimestamp(preview.summary?.export_timestamp)}
              </p>
              <p>
                <span className="font-medium text-foreground">Date range:</span>{' '}
                {formatDateRange(preview.summary?.date_range_active_filter)}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Media Backup</h4>
                <p className="mt-1 text-sm text-muted-foreground">{mediaCoverage.subtext}</p>
                {media?.media_export_timestamp && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    media_export_timestamp: {formatTimestamp(media.media_export_timestamp)}
                  </p>
                )}
              </div>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${mediaStatusChipClass(mediaCoverage.status)}`}>
                {mediaCoverage.label}
              </span>
            </div>

            {showRestoreMediaButton && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 rounded-lg px-3 text-xs"
                    onClick={() => setIsRestoreConfirmOpen(true)}
                    disabled={!canRestoreMedia}
                  >
                    {isRestoringMedia ? (
                      <>
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        Restoring...
                      </>
                    ) : (
                      <>
                        <ImagePlus className="mr-1 h-3.5 w-3.5" />
                        Restore Media (Sandbox)
                      </>
                    )}
                  </Button>
                  {!canRestoreMedia && restoreMediaDisabledReason && (
                    <p className="text-xs text-muted-foreground">{restoreMediaDisabledReason}</p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Sandbox restore only; DB remap/overwrite belum diimplementasi.
                </p>
              </div>
            )}

            {showRestoreMediaButton && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 rounded-lg px-3 text-xs"
                    onClick={() => setIsDummyRestoreConfirmOpen(true)}
                    disabled={!canRestoreDummyMedia}
                  >
                    {isRestoringDummyMedia ? (
                      <>
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        Restoring...
                      </>
                    ) : (
                      <>
                        <ImagePlus className="mr-1 h-3.5 w-3.5" />
                        Disaster Restore (Cross-Account)
                      </>
                    )}
                  </Button>
                  {!canRestoreDummyMedia && restoreDummyMediaDisabledReason && (
                    <p className="text-xs text-muted-foreground">{restoreDummyMediaDisabledReason}</p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Disaster mode: media di-remap ke user semasa, no-overwrite (`upsert=false`), dan data restore hanya dibenarkan jika akaun kosong atau `force_wipe=true`.
                </p>
              </div>
            )}

            {isRestoringMedia && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Upload media ke folder sandbox sedang berjalan...
              </div>
            )}

            {mediaRestoreError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <p className="font-medium">Restore media gagal</p>
                <p>{mediaRestoreError}</p>
              </div>
            )}

            {mediaRestoreResult && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-muted-foreground space-y-2">
                <p className="font-semibold text-foreground">Media Sandbox Restore Result</p>
                <p>
                  Sandbox prefix: <span className="font-medium text-foreground">{mediaRestoreResult.sandbox_prefix || '-'}</span>
                </p>
                <p>
                  Uploaded: <span className="font-medium text-foreground">{formatNumber(mediaRestoreResult.uploaded_count || 0)}</span>
                  {' '}| Skipped: <span className="font-medium text-foreground">{formatNumber(mediaRestoreResult.skipped_count || 0)}</span>
                  {' '}| Failed: <span className="font-medium text-foreground">{formatNumber(mediaRestoreResult.failed_count || 0)}</span>
                </p>

                {Array.isArray(mediaRestoreResult.sample_uploaded_paths) && mediaRestoreResult.sample_uploaded_paths.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground">Sample uploaded paths</p>
                    <ul className="mt-1 space-y-1">
                      {mediaRestoreResult.sample_uploaded_paths.slice(0, 10).map((pathValue, index) => (
                        <li key={`${pathValue}-${index}`} className="rounded-md border border-slate-200 bg-white px-2 py-1 break-all">
                          {String(pathValue)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {mediaRestoreErrorsPreview.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground">Errors (first 10)</p>
                    <ul className="mt-1 space-y-1">
                      {mediaRestoreErrorsPreview.map((entry, index) => (
                        <li key={`${entry?.bucket || '-'}-${entry?.key || '-'}-${index}`} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                          {(entry?.bucket && entry?.key) ? `${entry.bucket}/${entry.key}` : '-'} - {entry?.message || 'Unknown error'}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {isRestoringDummyMedia && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Disaster restore sedang berjalan...
              </div>
            )}

            {dummyMediaRestoreError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <p className="font-medium">Disaster restore gagal</p>
                <p>{dummyMediaRestoreError}</p>
              </div>
            )}

            {dummyMediaRestoreResult && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-muted-foreground space-y-2">
                <p className="font-semibold text-foreground">Disaster Recovery Restore Result</p>
                <p>
                  Restore mode: <span className="font-medium text-foreground">{dummyMediaRestoreResult.restore_mode || '-'}</span>
                </p>
                <p>
                  Media uploaded: <span className="font-medium text-foreground">{formatNumber(dummyMediaRestoreResult?.media?.uploaded_count || 0)}</span>
                  {' '}| Media skipped existing: <span className="font-medium text-foreground">{formatNumber(dummyMediaRestoreResult?.media?.skipped_existing_count || 0)}</span>
                  {' '}| Data inserted: <span className="font-medium text-foreground">{formatNumber(dummyMediaRestoreResult?.data?.inserted_count || 0)}</span>
                  {' '}| Data skip missing parent: <span className="font-medium text-foreground">{formatNumber(dummyMediaRestoreResult?.data?.skipped_missing_parent_count || 0)}</span>
                  {' '}| Data skip locked: <span className="font-medium text-foreground">{formatNumber(dummyMediaRestoreResult?.data?.skipped_locked_count || 0)}</span>
                </p>

                {Array.isArray(dummyMediaRestoreResult?.media?.sample_uploaded_paths) && dummyMediaRestoreResult.media.sample_uploaded_paths.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground">Sample uploaded paths</p>
                    <ul className="mt-1 space-y-1">
                      {dummyMediaRestoreResult.media.sample_uploaded_paths.slice(0, 10).map((pathValue, index) => (
                        <li key={`${pathValue}-${index}`} className="rounded-md border border-slate-200 bg-white px-2 py-1 break-all">
                          {String(pathValue)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {dummyMediaConflictsPreview.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground">Conflicts (first 20)</p>
                    <ul className="mt-1 space-y-1">
                      {dummyMediaConflictsPreview.map((entry, index) => (
                        <li key={`${entry?.bucket || '-'}-${entry?.key || '-'}-${index}`} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                          {(entry?.bucket && entry?.key) ? `${entry.bucket}/${entry.key}` : '-'} - {entry?.message || 'Conflict'}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {dummyMediaErrorsPreview.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground">Errors (first 20)</p>
                    <ul className="mt-1 space-y-1">
                      {dummyMediaErrorsPreview.map((entry, index) => (
                        <li key={`${entry?.table || '-'}-${entry?.bucket || '-'}-${entry?.key || '-'}-${index}`} className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-rose-800">
                          {entry?.table || (entry?.bucket && entry?.key ? `${entry.bucket}/${entry.key}` : '-')} - {entry?.message || 'Unknown error'}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray(dummyMediaRestoreResult?.data?.table_summaries) && dummyMediaRestoreResult.data.table_summaries.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground">Data table summary</p>
                    <ul className="mt-1 space-y-1">
                      {dummyMediaRestoreResult.data.table_summaries.map((item, index) => (
                        <li key={`${item?.export_key || 'table'}-${index}`} className="rounded-md border border-slate-200 bg-white px-2 py-1">
                          {String(item?.export_key || '-')} - inserted {formatNumber(item?.inserted || 0)}, skipped existing {formatNumber(item?.skipped_existing || 0)}, skipped missing parent {formatNumber(item?.skipped_missing_parent || 0)}, skipped locked {formatNumber(item?.skipped_locked || 0)}, failed {formatNumber(item?.failed || 0)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {canShowMediaDetails && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 rounded-lg px-3 text-xs"
                    onClick={() => setShowMediaDetails((prev) => !prev)}
                  >
                    {showMediaDetails ? 'Hide details' : 'Show details'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 rounded-lg px-3 text-xs"
                    onClick={handleCopyMediaErrors}
                  >
                    Copy error list
                  </Button>
                </div>

                {showMediaDetails && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-muted-foreground">
                    <p>
                      Files: <span className="font-medium text-foreground">{formatNumber(media?.files_count || 0)}</span>
                    </p>
                    <p>
                      Warnings: <span className="font-medium text-foreground">{formatNumber(media?.warnings_count || 0)}</span>
                    </p>
                    {media?.manifest_parse_error && (
                      <p className="mt-2 text-rose-700">{media.manifest_parse_error}</p>
                    )}
                    {mediaWarningsPreview.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {mediaWarningsPreview.map((warning) => (
                          <li key={warning.id} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                            {(warning.bucket && warning.key) ? `${warning.bucket}/${warning.key}` : '-'} - {warning.message}
                          </li>
                        ))}
                      </ul>
                    )}
                    {Array.isArray(media?.warnings) && media.warnings.length > 10 && (
                      <p className="mt-2">+{media.warnings.length - 10} warning lagi disembunyikan.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {totals.length > 0 && (
            <div className="rounded-lg border border-slate-200 px-3 py-3">
              <h4 className="text-sm font-semibold text-foreground">Key Totals</h4>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {totals.map((item) => (
                  <div key={item.key} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{item.label}</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{formatNumber(item.value)}</p>
                    {item.helperText && (
                      <p className="mt-1 text-xs text-muted-foreground">{item.helperText}</p>
                    )}
                  </div>
                ))}
              </div>
              {preview?.summary?.total_revenue !== null && preview?.summary?.total_revenue !== undefined &&
                (preview?.summary?.revenue_item === null || preview?.summary?.revenue_item === undefined) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Revenue Item hanya dipaparkan jika ada dalam metadata backup versi baru.
                  </p>
              )}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 px-3 py-3">
            <h4 className="text-sm font-semibold text-foreground">Integrity Checks</h4>
            <div className="mt-3 space-y-2">
              {integrityChecks.map((check) => (
                <div key={check.key} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{check.label}</p>
                    <p className="text-xs text-muted-foreground">{check.text}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${statusChipClass(check.status)}`}>
                    {check.status === 'pass' ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                    {check.status === 'pass' ? 'Pass' : check.status === 'warn' ? 'Warn' : 'Fail'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 px-3 py-3">
            <h4 className="text-sm font-semibold text-foreground">Tables Included</h4>
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Key</th>
                    <th className="px-3 py-2">Source Table</th>
                    <th className="px-3 py-2 text-right">Row Count</th>
                  </tr>
                </thead>
                <tbody>
                  {exportedTables.length === 0 ? (
                    <tr>
                      <td colSpan="3" className="px-3 py-3 text-sm text-muted-foreground">Tiada info exported_tables dalam metadata.</td>
                    </tr>
                  ) : (
                    exportedTables.map((table) => (
                      <tr key={table.key} className="border-t border-slate-200">
                        <td className="px-3 py-2 font-medium text-foreground">{table.key}</td>
                        <td className="px-3 py-2">
                          {table.source_table ? (
                            <span className="text-foreground">{table.source_table}</span>
                          ) : (
                            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                              Not included
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-foreground">{formatNumber(table.row_count)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
              <h4 className="text-sm font-semibold text-amber-800">Warnings</h4>
              <ul className="mt-2 space-y-2 text-sm text-amber-800">
                {warnings.map((warning) => (
                  <li key={warning.id} className="rounded-md border border-amber-200 bg-white/70 px-2 py-2">
                    <p className="font-medium">
                      {warning.code || 'WARNING'}
                      {warning.exportKey ? ` - ${warning.exportKey}` : ''}
                    </p>
                    <p className="text-xs">
                      {warning.message || 'Amaran tanpa mesej.'}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <h4 className="text-sm font-semibold text-foreground">Apa akan berlaku bila restore nanti</h4>
            <p className="mt-2 text-sm text-muted-foreground">
              Restore data DB penuh hanya berjalan dalam `restore_mode=disaster` (cross-account). Akaun sasaran mesti kosong, atau anda perlu sahkan `force_wipe=true`.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Table terlibat</p>
                <p className="mt-1 text-sm text-foreground">
                  {restorePlan.included.length > 0 ? restorePlan.included.join(', ') : '-'}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Table tiada dalam backup</p>
                <p className="mt-1 text-sm text-foreground">
                  {restorePlan.missing.length > 0 ? restorePlan.missing.join(', ') : '-'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={isRestoreConfirmOpen} onOpenChange={setIsRestoreConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore Media (Sandbox)</AlertDialogTitle>
            <AlertDialogDescription>
              Media akan diupload ke sandbox folder dan tidak overwrite gambar sedia ada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRestoringMedia}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canRestoreMedia || isRestoringMedia}
              onClick={(event) => {
                event.preventDefault();
                setIsRestoreConfirmOpen(false);
                handleRestoreMediaSandbox();
              }}
            >
              {isRestoringMedia ? 'Memproses...' : 'Teruskan'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDummyRestoreConfirmOpen} onOpenChange={setIsDummyRestoreConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disaster Restore (Cross-Account)</AlertDialogTitle>
            <AlertDialogDescription>
              Mode ini akan restore media + data backup ke akaun semasa. Jika akaun tidak kosong, set `force_wipe=true` untuk teruskan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={forceWipeDisaster}
                onChange={(event) => setForceWipeDisaster(event.target.checked)}
                disabled={isRestoringDummyMedia}
              />
              Saya faham risiko. Gunakan `force_wipe=true` jika akaun sasaran ada data.
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRestoringDummyMedia}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canRestoreDummyMedia || isRestoringDummyMedia}
              onClick={(event) => {
                event.preventDefault();
                setIsDummyRestoreConfirmOpen(false);
                handleRestoreMediaDummyAccount();
              }}
            >
              {isRestoringDummyMedia ? 'Memproses...' : 'Teruskan'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default RestorePreviewSection;
