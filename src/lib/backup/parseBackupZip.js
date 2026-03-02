import JSZip from 'jszip';

const ZIP_EXTENSION_REGEX = /\.zip$/i;
const CHECKSUM_FORMAT_REGEX = /^[a-f0-9]{16,128}$/i;

class BackupZipParseError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BackupZipParseError';
    this.code = code;
  }
}

const normalizeWarnings = (warnings) => {
  if (!Array.isArray(warnings)) return [];
  return warnings.map((warning, index) => {
    if (warning && typeof warning === 'object') {
      return {
        id: `${warning.code || warning.exportKey || 'warning'}-${index}`,
        code: warning.code || null,
        message: warning.message || null,
        exportKey: warning.exportKey || null,
        table: warning.table || null,
      };
    }

    return {
      id: `warning-${index}`,
      code: null,
      message: String(warning),
      exportKey: null,
      table: null,
    };
  });
};

const normalizeExportedTables = (exportedTables) => {
  if (!exportedTables || typeof exportedTables !== 'object') return [];

  return Object.entries(exportedTables).map(([key, value]) => {
    const tableInfo = value && typeof value === 'object' ? value : {};
    const rowCountRaw = Number(tableInfo.row_count);
    return {
      key,
      source_table: tableInfo.source_table || null,
      row_count: Number.isFinite(rowCountRaw) ? rowCountRaw : 0,
    };
  });
};

const normalizeMediaManifestWarnings = (warnings) => {
  if (!Array.isArray(warnings)) return [];

  return warnings.map((warning, index) => {
    if (warning && typeof warning === 'object') {
      const bucket = typeof warning.bucket === 'string' ? warning.bucket : null;
      const key = typeof warning.key === 'string' ? warning.key : null;
      const source = typeof warning.source === 'string' ? warning.source : null;
      const category = typeof warning.category === 'string' ? warning.category : null;
      const message = warning.message ? String(warning.message) : 'Unknown media warning';
      return {
        id: `media-warning-${index}`,
        bucket,
        key,
        source,
        category,
        message,
      };
    }

    return {
      id: `media-warning-${index}`,
      bucket: null,
      key: null,
      source: null,
      category: null,
      message: String(warning),
    };
  });
};

const normalizeMediaManifestFiles = (files) => {
  if (!Array.isArray(files)) return [];

  return files
    .filter((file) => file && typeof file === 'object')
    .map((file) => {
      const sizeRaw = Number(file.size);
      return {
        bucket: typeof file.bucket === 'string' ? file.bucket : null,
        key: typeof file.key === 'string' ? file.key : null,
        size: Number.isFinite(sizeRaw) ? sizeRaw : null,
        sha256: typeof file.sha256 === 'string' ? file.sha256 : null,
      };
    });
};

const normalizeMediaFailureList = (warnings) => {
  return warnings.map((warning, index) => ({
    id: `media-failure-${index}`,
    bucket: warning.bucket || null,
    key: warning.key || null,
    message: warning.message || 'Unknown failure',
  }));
};

const detectZipErrorMessage = (rawError) => {
  const message = String(rawError?.message || rawError || '').toLowerCase();

  if (message.includes('crc') || message.includes('corrupt') || message.includes('invalid zip') || message.includes('end of central directory')) {
    return 'Fail zip rosak / tidak lengkap (CRC). Sila download semula backup.';
  }

  if (message.includes('unsupported') || message.includes('encrypted')) {
    return 'Format zip tidak disokong. Pastikan fail backup RareBits tidak dienkrip.';
  }

  return 'Fail zip tidak boleh dibaca. Sila cuba semula dengan fail backup yang sah.';
};

const isIsoDateLike = (value) => {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
};

// Preview only; restore not implemented.
export async function parseBackupZip(file) {
  if (!(file instanceof File || file instanceof Blob)) {
    throw new BackupZipParseError('Sila pilih fail backup .zip yang sah.', 'INVALID_FILE');
  }

  if (file.name && !ZIP_EXTENSION_REGEX.test(file.name)) {
    throw new BackupZipParseError('Hanya fail .zip disokong untuk preview backup.', 'INVALID_EXTENSION');
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(file, { checkCRC32: true });
  } catch (error) {
    throw new BackupZipParseError(detectZipErrorMessage(error), 'ZIP_PARSE_FAILED');
  }

  const metadataFile = zip.file(/^metadata\.json$/i)?.[0] || null;
  if (!metadataFile) {
    throw new BackupZipParseError('Ini bukan backup RareBits. metadata.json tidak dijumpai.', 'MISSING_METADATA');
  }

  let rawMetadataText = '';
  let metadata;
  try {
    rawMetadataText = await metadataFile.async('string');
    metadata = JSON.parse(rawMetadataText);
  } catch (error) {
    throw new BackupZipParseError('metadata.json tidak sah. Sila gunakan fail backup yang betul.', 'INVALID_METADATA');
  }

  const exportedTables = normalizeExportedTables(metadata?.exported_tables);
  const warnings = normalizeWarnings(metadata?.warnings);

  const mediaManifestFile = zip.file(/^media_manifest\.json$/i)?.[0] || null;
  let mediaManifest = null;
  let mediaManifestParseError = null;
  if (mediaManifestFile) {
    try {
      mediaManifest = JSON.parse(await mediaManifestFile.async('string'));
    } catch (_error) {
      mediaManifestParseError = 'media_manifest.json tidak sah.';
    }
  }

  const zipMediaFileNames = Object.entries(zip.files)
    .filter(([name, entry]) => name.startsWith('media/') && entry && !entry.dir)
    .map(([name]) => name)
    .filter((name) => !name.endsWith('/.keep'));

  const mediaManifestWarnings = normalizeMediaManifestWarnings(mediaManifest?.warnings);
  const mediaManifestFiles = normalizeMediaManifestFiles(mediaManifest?.files);
  const mediaMissingOrFailed = normalizeMediaFailureList(mediaManifestWarnings);
  const mediaManifestExists = Boolean(mediaManifestFile);
  const hasMediaFolderFiles = zipMediaFileNames.length > 0;
  const mediaFilesCount = mediaManifestFiles.length > 0
    ? mediaManifestFiles.length
    : zipMediaFileNames.length;
  const mediaWarningsCount = mediaManifestWarnings.length;
  const mediaMissingCount = mediaMissingOrFailed.length;

  let mediaStatus = 'not_included';
  if (mediaManifestExists) {
    mediaStatus = mediaWarningsCount > 0 ? 'included_with_warnings' : 'included';
  } else if (hasMediaFolderFiles) {
    mediaStatus = 'included_with_warnings';
  }

  const mediaSummary = {
    status: mediaStatus,
    manifest_exists: mediaManifestExists,
    has_media_folder_files: hasMediaFolderFiles,
    media_export_timestamp: mediaManifest?.export_timestamp || null,
    files_count: mediaFilesCount,
    warnings_count: mediaWarningsCount,
    missing_count: mediaMissingCount,
    warnings: mediaManifestWarnings,
    missing_or_failed: mediaMissingOrFailed,
    manifest_parse_error: mediaManifestParseError,
  };

  if (mediaManifestParseError) {
    warnings.push({
      id: 'media-manifest-parse-error',
      code: 'MEDIA_MANIFEST_INVALID',
      message: mediaManifestParseError,
      exportKey: null,
      table: null,
    });
  }

  const hasChecksum = Boolean(String(metadata?.checksum || '').trim());
  const checksumLooksValid = hasChecksum
    ? CHECKSUM_FORMAT_REGEX.test(String(metadata?.checksum || '').trim())
    : false;

  const summary = {
    export_timestamp: metadata?.export_timestamp || null,
    export_timestamp_valid: isIsoDateLike(metadata?.export_timestamp),
    date_range_active_filter: metadata?.date_range_active_filter ?? null,
    revenue_item: metadata?.revenue_item ?? null,
    shipping_charged: metadata?.shipping_charged ?? null,
    net_profit_current: metadata?.net_profit_current ?? metadata?.total_profit ?? null,
    total_profit: metadata?.total_profit ?? metadata?.net_profit_current ?? null,
    total_revenue: metadata?.total_revenue ?? null,
    total_expense: metadata?.total_expense ?? null,
    wallet_balance: metadata?.wallet_balance ?? null,
    invoice_count: metadata?.invoice_count ?? null,
    inventory_value: metadata?.inventory_value ?? null,
    row_count_total: metadata?.row_count_total ?? null,
  };

  return {
    metadata,
    rawMetadata: rawMetadataText,
    summary,
    media: mediaSummary,
    exported_tables: exportedTables,
    warnings,
    hasCsvFolder: Object.keys(zip.files).some((name) => name.startsWith('csv/')),
    hasJsonFolder: Object.keys(zip.files).some((name) => name.startsWith('json/')),
    integrity: {
      zipParsed: true,
      metadataExists: true,
      checksumPresent: hasChecksum,
      checksumFormatValid: checksumLooksValid,
    },
  };
}

export { BackupZipParseError };
