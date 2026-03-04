import imageCompression from 'browser-image-compression';

export const WALLET_RECEIPT_BUCKET = 'wallet_receipts';
export const RECEIPT_ACCEPT_ATTR = 'image/jpeg,image/png,image/webp,application/pdf';
export const RECEIPT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const RECEIPT_PDF_MAX_BYTES = 10 * 1024 * 1024;

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const PDF_MIME_TYPES = new Set([
  'application/pdf',
]);

const normalizeString = (value) => String(value ?? '').trim();

const sanitizeFileName = (value, fallback = 'receipt') => {
  const normalized = normalizeString(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return normalized || fallback;
};

const getFileExtension = (fileName) => {
  const sanitized = sanitizeFileName(fileName);
  const parts = sanitized.split('.');
  if (parts.length < 2) return '';
  return parts[parts.length - 1].toLowerCase();
};

const isPdfByExtension = (fileName) => getFileExtension(fileName) === 'pdf';

export const isPdfFile = (file) => {
  if (!file) return false;
  if (PDF_MIME_TYPES.has(file.type)) return true;
  return isPdfByExtension(file.name);
};

export const isImageFile = (file) => {
  if (!file) return false;
  if (IMAGE_MIME_TYPES.has(file.type)) return true;
  return file.type.startsWith('image/');
};

export const formatFileSize = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / (1024 ** power);
  return `${size.toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
};

export const hasPendingReceiptChange = (transactionData) => (
  Boolean(transactionData?.receipt_file) || Boolean(transactionData?.remove_receipt)
);

export const prepareReceiptUploadFile = async (rawFile) => {
  if (!rawFile) {
    throw new Error('Fail resit tidak ditemui.');
  }

  const originalSize = Number(rawFile.size) || 0;
  const originalType = normalizeString(rawFile.type).toLowerCase();
  const originalName = normalizeString(rawFile.name) || 'receipt';

  if (isPdfFile(rawFile)) {
    if (originalSize > RECEIPT_PDF_MAX_BYTES) {
      throw new Error(`Saiz PDF terlalu besar (${formatFileSize(originalSize)}). Had maksimum ${formatFileSize(RECEIPT_PDF_MAX_BYTES)}.`);
    }
    return {
      file: rawFile,
      meta: {
        original_name: originalName,
        original_mime: originalType || 'application/pdf',
        original_size_bytes: originalSize,
        final_size_bytes: originalSize,
        final_mime: originalType || 'application/pdf',
        compressed: false,
      },
    };
  }

  if (!isImageFile(rawFile)) {
    throw new Error('Format fail tidak disokong. Hanya imej (JPG/PNG/WEBP) atau PDF dibenarkan.');
  }

  if (originalSize > RECEIPT_IMAGE_MAX_BYTES) {
    throw new Error(`Saiz imej terlalu besar (${formatFileSize(originalSize)}). Had maksimum ${formatFileSize(RECEIPT_IMAGE_MAX_BYTES)}.`);
  }

  let candidateFile = rawFile;
  try {
    const compressed = await imageCompression(rawFile, {
      maxSizeMB: 1.0,
      maxWidthOrHeight: 1800,
      initialQuality: 0.78,
      useWebWorker: true,
      fileType: originalType && originalType.startsWith('image/') ? originalType : 'image/jpeg',
    });
    if (compressed && Number(compressed.size) > 0) {
      const reductionRatio = Number(compressed.size) / Math.max(originalSize, 1);
      candidateFile = reductionRatio <= 0.9 ? compressed : rawFile;
    }
  } catch (error) {
    console.warn('[walletTransactionReceipts] Image compression failed, using original file:', error);
    candidateFile = rawFile;
  }

  const selectedName = sanitizeFileName(rawFile.name || 'receipt-image');
  const fileForUpload = candidateFile instanceof File
    ? new File([candidateFile], selectedName, {
      type: candidateFile.type || originalType || 'image/jpeg',
      lastModified: Date.now(),
    })
    : rawFile;
  const finalSize = Number(fileForUpload.size) || originalSize;

  return {
    file: fileForUpload,
    meta: {
      original_name: originalName,
      original_mime: originalType || 'image/jpeg',
      original_size_bytes: originalSize,
      final_size_bytes: finalSize,
      final_mime: fileForUpload.type || originalType || 'image/jpeg',
      compressed: finalSize < originalSize,
    },
  };
};

const deleteReceiptObjectIfExists = async ({ supabase, receiptPath }) => {
  if (!normalizeString(receiptPath)) return;
  const { error } = await supabase
    .storage
    .from(WALLET_RECEIPT_BUCKET)
    .remove([receiptPath]);
  if (error) {
    console.warn('[walletTransactionReceipts] Failed to remove previous receipt object:', error);
  }
};

const uploadReceiptObject = async ({ supabase, userId, transactionId, file }) => {
  const safeUserId = normalizeString(userId);
  const safeTransactionId = normalizeString(transactionId);
  if (!safeUserId || !safeTransactionId) {
    throw new Error('Maklumat transaksi tidak lengkap untuk upload resit.');
  }

  const fileName = sanitizeFileName(file?.name || 'receipt');
  const objectPath = `${safeUserId}/${safeTransactionId}/${Date.now()}-${fileName}`;

  const { error: uploadError } = await supabase.storage.from(WALLET_RECEIPT_BUCKET).upload(objectPath, file, {
    upsert: true,
    cacheControl: '3600',
    contentType: file?.type || 'application/octet-stream',
  });

  if (uploadError) {
    throw new Error(`Upload resit gagal: ${uploadError.message || 'Unknown error'}`);
  }

  return objectPath;
};

const clearReceiptColumns = async ({ supabase, userId, transactionId }) => {
  const { error } = await supabase
    .from('transactions')
    .update({
      receipt_path: null,
      receipt_name: null,
      receipt_mime: null,
      receipt_size_bytes: null,
      receipt_original_size_bytes: null,
      receipt_compressed: false,
      receipt_uploaded_at: null,
    })
    .eq('id', transactionId)
    .eq('user_id', userId);
  if (error) throw error;
};

export const applyTransactionReceiptChange = async ({
  supabase,
  userId,
  transactionId,
  transactionData,
}) => {
  if (!transactionId || !userId) {
    throw new Error('Transaksi tidak ditemui untuk lampiran resit.');
  }

  const shouldRemove = Boolean(transactionData?.remove_receipt);
  const nextFile = transactionData?.receipt_file || null;
  const receiptMeta = transactionData?.receipt_upload_meta || null;
  const existingReceiptPath = normalizeString(transactionData?.existing_receipt_path);

  if (!shouldRemove && !nextFile) return;

  if (shouldRemove && !nextFile) {
    await deleteReceiptObjectIfExists({ supabase, receiptPath: existingReceiptPath });
    await clearReceiptColumns({ supabase, userId, transactionId });
    return;
  }

  const uploadedPath = await uploadReceiptObject({
    supabase,
    userId,
    transactionId,
    file: nextFile,
  });

  if (existingReceiptPath && existingReceiptPath !== uploadedPath) {
    await deleteReceiptObjectIfExists({ supabase, receiptPath: existingReceiptPath });
  }

  const finalMime = normalizeString(nextFile?.type || receiptMeta?.final_mime) || null;
  const finalName = normalizeString(receiptMeta?.original_name || nextFile?.name) || null;
  const finalSize = Number(receiptMeta?.final_size_bytes ?? nextFile?.size ?? 0);
  const originalSize = Number(receiptMeta?.original_size_bytes ?? finalSize);
  const compressed = Boolean(receiptMeta?.compressed && finalSize > 0 && originalSize > finalSize);

  const { error } = await supabase
    .from('transactions')
    .update({
      receipt_path: uploadedPath,
      receipt_name: finalName,
      receipt_mime: finalMime,
      receipt_size_bytes: Number.isFinite(finalSize) && finalSize > 0 ? finalSize : null,
      receipt_original_size_bytes: Number.isFinite(originalSize) && originalSize > 0 ? originalSize : null,
      receipt_compressed: compressed,
      receipt_uploaded_at: new Date().toISOString(),
    })
    .eq('id', transactionId)
    .eq('user_id', userId);

  if (error) throw error;
};

export const findLatestCreatedTransactionId = async ({
  supabase,
  userId,
  walletId,
  type,
  amount,
  transactionDate,
  description,
  category,
  createdAfterIso,
}) => {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, wallet_id, type, amount, transaction_date, description, category, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) throw error;

  const targetAmount = Math.abs(parseFloat(amount) || 0);
  const safeDescription = normalizeString(description);
  const safeCategory = normalizeString(category);
  const createdAfterTime = createdAfterIso ? new Date(createdAfterIso).getTime() - 5000 : 0;

  const candidate = (data || []).find((tx) => {
    const createdAtTime = tx?.created_at ? new Date(tx.created_at).getTime() : 0;
    if (createdAfterTime && createdAtTime && createdAtTime < createdAfterTime) return false;
    if (normalizeString(tx?.wallet_id) !== normalizeString(walletId)) return false;
    if (normalizeString(tx?.type) !== normalizeString(type)) return false;
    if (normalizeString(tx?.transaction_date) !== normalizeString(transactionDate)) return false;
    if (Math.abs((parseFloat(tx?.amount) || 0) - targetAmount) > 0.0001) return false;

    if (safeDescription && normalizeString(tx?.description) !== safeDescription) return false;
    if (safeCategory && normalizeString(tx?.category) !== safeCategory) return false;
    return true;
  });

  return candidate?.id || null;
};

export const createTransactionReceiptSignedUrl = async ({
  supabase,
  receiptPath,
  downloadFileName = null,
  expiresInSec = 300,
}) => {
  const safePath = normalizeString(receiptPath);
  if (!safePath) {
    throw new Error('Path resit tidak sah.');
  }

  const options = {};
  if (normalizeString(downloadFileName)) {
    options.download = sanitizeFileName(downloadFileName, 'receipt');
  }

  const { data, error } = await supabase
    .storage
    .from(WALLET_RECEIPT_BUCKET)
    .createSignedUrl(safePath, expiresInSec, options);

  if (error || !data?.signedUrl) {
    throw new Error(`Gagal jana link resit: ${error?.message || 'Unknown error'}`);
  }

  return data.signedUrl;
};
