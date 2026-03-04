import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SwitchToggle } from '@/components/ui/switch-toggle';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import RestorePreviewSection from '@/components/RestorePreviewSection';

const LAST_BACKUP_KEY = 'rarebits_full_backup_last_downloaded_at';

const formatTimestamp = (isoString) => {
  if (!isoString) return 'Belum pernah';
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return 'Belum pernah';
  return new Intl.DateTimeFormat('ms-MY', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
};

const toDownloadBlob = (value) => {
  if (value instanceof Blob) return value;
  if (value instanceof ArrayBuffer) return new Blob([value], { type: 'application/zip' });
  if (value instanceof Uint8Array) return new Blob([value], { type: 'application/zip' });
  return null;
};

const isMethodNotAllowed = (value) => /method not allowed/i.test(String(value || ''));

const DataSafetySettings = () => {
  const { toast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);
  const [includeMedia, setIncludeMedia] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState(null);
  const [lastAutoBackupAt, setLastAutoBackupAt] = useState(null);

  const refreshSnapshotStatusFromDb = useCallback(async () => {
    const { data, error } = await supabase
      .from('business_snapshots')
      .select('exported_at, metadata')
      .order('exported_at', { ascending: false })
      .limit(30);

    if (error || !Array.isArray(data) || data.length === 0) {
      return null;
    }

    const latestAny = data[0]?.exported_at || null;
    const latestAuto = data.find((row) => {
      const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : null;
      const trigger = String(metadata?.trigger || '').toLowerCase();
      const mode = String(metadata?.mode || '').toLowerCase();
      return trigger === 'auto_daily' || mode === 'auto_snapshot';
    })?.exported_at || null;

    return {
      latestAny,
      latestAuto,
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    const hydrateLastBackup = async () => {
      const saved = localStorage.getItem(LAST_BACKUP_KEY);
      if (saved && isActive) {
        setLastBackupAt(saved);
      }

      const status = await refreshSnapshotStatusFromDb();
      if (status?.latestAny && isActive) {
        setLastBackupAt(status.latestAny);
        localStorage.setItem(LAST_BACKUP_KEY, status.latestAny);
      }
      if (status?.latestAuto && isActive) {
        setLastAutoBackupAt(status.latestAuto);
      }
    };

    hydrateLastBackup();
    return () => {
      isActive = false;
    };
  }, [refreshSnapshotStatusFromDb]);

  const lastBackupLabel = useMemo(() => formatTimestamp(lastBackupAt), [lastBackupAt]);
  const lastAutoBackupLabel = useMemo(() => formatTimestamp(lastAutoBackupAt), [lastAutoBackupAt]);

  const downloadViaDirectFetch = useCallback(async (includeMedia = false) => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      throw new Error(sessionError.message || 'Gagal sahkan sesi pengguna.');
    }

    const accessToken = sessionData?.session?.access_token;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!accessToken || !supabaseUrl) {
      throw new Error('Sesi tidak sah atau URL Supabase tiada.');
    }

    const endpoint = `${supabaseUrl}/functions/v1/export-full-backup`;
    let usedLegacyMethodFallback = false;
    let response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ includeMedia }),
    });

    if (response.status === 405) {
      usedLegacyMethodFallback = true;
      response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Muat turun backup gagal.');
    }

    return {
      blob: await response.blob(),
      usedLegacyMethodFallback,
    };
  }, []);

  const handleDownload = async () => {
    try {
      setIsDownloading(true);
      const invokeBackup = async (method) => (
        supabase.functions.invoke('export-full-backup', {
          method,
          ...(method === 'POST' ? { body: { includeMedia } } : {}),
        })
      );

      let blob = null;
      let usedLegacyMethodFallback = false;
      let { data, error } = await invokeBackup('POST');
      if (error && isMethodNotAllowed(error?.message)) {
        usedLegacyMethodFallback = true;
        ({ data, error } = await invokeBackup('GET'));
      }

      if (!error) {
        blob = toDownloadBlob(data);
      }

      if (!blob) {
        const response = await downloadViaDirectFetch(includeMedia);
        blob = response.blob;
        usedLegacyMethodFallback = usedLegacyMethodFallback || response.usedLegacyMethodFallback;
      }

      if (error && !blob) {
        throw new Error(error.message || 'Muat turun backup gagal.');
      }

      const filename = `rarebits-backup-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.zip`;

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(objectUrl);

      const nowIso = new Date().toISOString();
      localStorage.setItem(LAST_BACKUP_KEY, nowIso);
      setLastBackupAt(nowIso);

      const status = await refreshSnapshotStatusFromDb();
      if (status?.latestAny) {
        localStorage.setItem(LAST_BACKUP_KEY, status.latestAny);
        setLastBackupAt(status.latestAny);
      }
      if (status?.latestAuto) {
        setLastAutoBackupAt(status.latestAuto);
      }

      toast({
        title: 'Backup berjaya dimuat turun',
        description: filename,
      });

      if (includeMedia && usedLegacyMethodFallback) {
        toast({
          title: 'Gambar tidak disertakan',
          description: 'Server backup masih guna mode lama (GET). Deploy function terbaru untuk includeMedia.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Gagal muat turun backup',
        description: error?.message || 'Sila cuba semula.',
        variant: 'destructive',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Archive className="h-5 w-5 text-primary" />
          Data Safety
        </CardTitle>
        <CardDescription>
          Muat turun salinan penuh data perniagaan dalam format ZIP (CSV + JSON).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">Backup terakhir:</span>{' '}
            <span>{lastBackupLabel}</span>
          </div>
          <div>
            <span className="font-medium text-foreground">Auto backup:</span>{' '}
            <span>ON (Daily)</span>
          </div>
          <div>
            <span className="font-medium text-foreground">Auto run terakhir:</span>{' '}
            <span>{lastAutoBackupLabel}</span>
          </div>
          <div>
            <span className="font-medium text-foreground">Retention:</span>{' '}
            <span>Simpan 7 snapshot terbaru.</span>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-background px-4 py-3">
          <div className="flex items-start gap-3">
            <SwitchToggle
              id="include-media-backup"
              checked={includeMedia}
              disabled={isDownloading}
              onCheckedChange={(checked) => setIncludeMedia(checked === true)}
            />
            <div className="space-y-1">
              <label htmlFor="include-media-backup" className="text-sm font-medium text-foreground">
                Sertakan gambar dalam backup (Storage)
              </label>
              <p className="text-xs text-muted-foreground">
                OFF = lebih laju. ON = tambah folder `media/` + `media_manifest.json`.
              </p>
            </div>
          </div>
        </div>

        <Button
          type="button"
          onClick={handleDownload}
          disabled={isDownloading}
          className="h-10 rounded-xl px-4"
        >
          {isDownloading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Menjana Backup...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Download Full Backup
            </>
          )}
        </Button>

        <RestorePreviewSection />
      </CardContent>
    </Card>
  );
};

export default DataSafetySettings;
