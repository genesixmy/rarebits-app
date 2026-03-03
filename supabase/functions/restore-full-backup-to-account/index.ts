import { createClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

type JsonObject = Record<string, unknown>;
type RestoreMode = "self" | "disaster";

type NormalizedMediaFile = {
  bucket: string;
  key: string;
  size: number | null;
  sha256: string | null;
};

type RestoreIssue = {
  table: string | null;
  bucket: string | null;
  key: string | null;
  message: string;
};

type MediaKeyMapping = {
  bucket: string;
  sourceKey: string;
  targetKey: string;
  sourcePublicUrl: string;
  targetPublicUrl: string;
};

type RestoreTableSpec = {
  exportKey: string;
  candidates: string[];
  onConflict?: string;
};

type RestorePayload = {
  bytes: Uint8Array;
  fileName: string;
  restoreModeRaw: string;
  modeRaw: string;
  idempotencyKeyRaw: string;
  dryRun: boolean;
  forceWipe: boolean;
};

type WriteRowsResult = {
  insertedCount: number;
  skippedExistingCount: number;
  failedCount: number;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_ERRORS = 20;
const MAX_CONFLICTS = 20;
const MAX_SAMPLE_PATHS = 10;
const MAX_ZIP_BYTES = 250 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10000;
const MAX_MEDIA_FILES = 5000;
const MAX_TOTAL_MEDIA_BYTES = 200 * 1024 * 1024;
const MAX_ROWS_PER_TABLE = 50000;
const MAX_TOTAL_DB_WRITES = 200000;
const MAX_DB_BATCH = 200;
const RESTORE_LOCK_TTL_SECONDS = 20 * 60;
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const IDEMPOTENCY_REPLAY_WINDOW_SECONDS = 15 * 60;
const ALLOWED_MEDIA_BUCKETS = new Set(["item_images", "avatars"]);
const TRUE_VALUES = new Set(["1", "true", "yes", "y", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "n", "off"]);
const LOCKED_INVOICE_STATUSES = new Set(["paid", "partially_returned", "returned"]);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_GLOBAL_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/ig;

const RESTORE_TABLE_SPECS: RestoreTableSpec[] = [
  { exportKey: "profiles", candidates: ["profiles"], onConflict: "id" },
  { exportKey: "settings", candidates: ["settings", "invoice_settings"], onConflict: "user_id" },
  { exportKey: "wallets", candidates: ["wallets"] },
  { exportKey: "customers", candidates: ["clients", "customers"], onConflict: "user_id,email" },
  { exportKey: "client_phones", candidates: ["client_phones"] },
  { exportKey: "client_addresses", candidates: ["client_addresses"] },
  { exportKey: "categories", candidates: ["categories"] },
  { exportKey: "inventory", candidates: ["inventory", "items"] },
  { exportKey: "item_media", candidates: ["item_media"] },
  { exportKey: "media_library", candidates: ["media_library"] },
  { exportKey: "platform_fee_rules", candidates: ["platform_fee_rules"] },
  { exportKey: "sales_channels", candidates: ["sales_channels"] },
  { exportKey: "shipments", candidates: ["shipments"] },
  { exportKey: "invoices", candidates: ["invoices"] },
  { exportKey: "shipment_invoices", candidates: ["shipment_invoices"] },
  { exportKey: "invoice_items", candidates: ["invoice_items"] },
  { exportKey: "invoice_adjustments", candidates: ["invoice_adjustments", "invoice_refunds"] },
  { exportKey: "invoice_item_returns", candidates: ["invoice_item_returns"] },
  { exportKey: "platform_fees", candidates: ["platform_fees", "invoice_fees"] },
  { exportKey: "wallet_transactions", candidates: ["wallet_transactions", "transactions"] },
  { exportKey: "inventory_reservations", candidates: ["inventory_reservations"] },
  { exportKey: "catalogs", candidates: ["catalogs"] },
  { exportKey: "catalog_cover_media", candidates: ["catalog_cover_media"] },
];

const DISASTER_ID_REMAP_TABLES = new Set([
  "wallets",
  "customers",
  "client_phones",
  "client_addresses",
  "categories",
  "inventory",
  "item_media",
  "media_library",
  "platform_fee_rules",
  "sales_channels",
  "shipments",
  "invoices",
  "shipment_invoices",
  "invoice_items",
  "invoice_adjustments",
  "invoice_item_returns",
  "platform_fees",
  "wallet_transactions",
  "inventory_reservations",
  "catalogs",
  "catalog_cover_media",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
};

class RestoreValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "RestoreValidationError";
    this.status = status;
  }
}

const jsonResponse = (payload: JsonObject, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });

const toString = (value: unknown): string => String(value ?? "").trim();
const normalizeNameKey = (value: unknown): string => toString(value).toLowerCase();
const normalizeEmailKey = (value: unknown): string => toString(value).toLowerCase();
const normalizePhoneKey = (value: unknown): string => toString(value).replace(/[^\d+]/g, "");
const normalizeAddressKey = (value: unknown): string => toString(value).replace(/\s+/g, " ").toLowerCase();

const toNumberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = toString(value).toLowerCase();
  if (!normalized) return fallback;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return fallback;
};

const normalizeIdempotencyKey = (value: unknown): string => {
  const raw = toString(value);
  if (!raw) return "";

  const compact = raw.replace(/\s+/g, "");
  if (!compact) return "";

  if (compact.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new RestoreValidationError(
      `idempotency_key melebihi had ${IDEMPOTENCY_KEY_MAX_LENGTH} aksara.`,
      400,
    );
  }

  if (!/^[A-Za-z0-9._:-]+$/.test(compact)) {
    throw new RestoreValidationError(
      "idempotency_key hanya benarkan huruf, nombor, titik, underscore, titik bertindih, dan dash.",
      400,
    );
  }

  return compact;
};

const buildAutoIdempotencyKey = (payload: {
  checksum: string;
  restoreMode: RestoreMode;
  dryRun: boolean;
  forceWipe: boolean;
}): string => {
  const key = [
    "auto",
    payload.restoreMode,
    payload.dryRun ? "dry" : "live",
    payload.forceWipe ? "wipe" : "safe",
    payload.checksum,
  ].join(":");

  return key.slice(0, IDEMPOTENCY_KEY_MAX_LENGTH);
};

const getSummaryCount = (summary: unknown, key: string): number => {
  if (!summary || typeof summary !== "object") return 0;
  const value = Number((summary as Record<string, unknown>)[key]);
  return Number.isFinite(value) ? value : 0;
};

const toMetricCount = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  return Math.trunc(parsed);
};

const decodeUriComponentSafe = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeStoragePath = (value: string): string => {
  const withoutQuery = value.split("?")[0].split("#")[0].replace(/\\/g, "/");
  const segments = withoutQuery
    .split("/")
    .map((segment) => decodeUriComponentSafe(segment.trim()))
    .filter((segment) => segment && segment !== "." && segment !== "..");
  return segments.join("/");
};

const isUuid = (value: unknown): value is string => UUID_REGEX.test(toString(value));

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const replaceAllSafe = (input: string, target: string, replacement: string): string => {
  if (!target) return input;
  return input.split(target).join(replacement);
};

const chunkValues = <T,>(values: T[], size: number): T[][] => {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
};

const pickFirstNonEmptyFromRow = (row: JsonObject, keys: string[]): string => {
  for (const key of keys) {
    const value = toString((row as Record<string, unknown>)[key]);
    if (value) return value;
  }
  return "";
};

const buildFallbackRowFingerprint = (row: JsonObject, ignoredKeys: Set<string>): string => {
  const parts = Object.entries(row as Record<string, unknown>)
    .filter(([key]) => !ignoredKeys.has(key))
    .map(([key, value]) => {
      const normalized = normalizeAddressKey(value);
      return normalized ? `${key}:${normalized}` : "";
    })
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  return parts.join("|");
};

const buildClientPhoneDedupeKey = (row: JsonObject): string => {
  const clientId = toString((row as Record<string, unknown>).client_id);
  if (!clientId) return "";

  const rawPhone = pickFirstNonEmptyFromRow(row, ["phone_number", "phone", "number", "value"]);
  const normalizedPhone = normalizePhoneKey(rawPhone);
  const fallback = buildFallbackRowFingerprint(
    row,
    new Set(["id", "user_id", "client_id", "created_at", "updated_at"]),
  );
  const keyPart = normalizedPhone || fallback;
  if (!keyPart) return "";

  return `${clientId}:${keyPart}`;
};

const buildClientAddressDedupeKey = (row: JsonObject): string => {
  const clientId = toString((row as Record<string, unknown>).client_id);
  if (!clientId) return "";

  const rawAddress = pickFirstNonEmptyFromRow(
    row,
    ["address", "address_line1", "address_line_1", "line1", "full_address", "street"],
  );
  const normalizedAddress = normalizeAddressKey(rawAddress);
  const fallback = buildFallbackRowFingerprint(
    row,
    new Set(["id", "user_id", "client_id", "created_at", "updated_at"]),
  );
  const keyPart = normalizedAddress || fallback;
  if (!keyPart) return "";

  return `${clientId}:${keyPart}`;
};

const extractUuidCandidates = (row: Record<string, unknown> | undefined, keys: string[]): string[] => {
  if (!row) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  keys.forEach((key) => {
    const value = toString(row[key]);
    if (!isUuid(value) || seen.has(value)) return;
    seen.add(value);
    output.push(value);
  });
  return output;
};

const isLikelyAlreadyExists = (message: string, code?: string): boolean => {
  const normalized = String(message || "").toLowerCase();
  const normalizedCode = String(code || "").toUpperCase();
  return normalizedCode === "23505"
    || normalized.includes("already exists")
    || normalized.includes("duplicate key")
    || normalized.includes("violates unique constraint")
    || normalized.includes("conflict");
};

const isMissingColumnError = (error: unknown): boolean => {
  const code = String((error as { code?: string })?.code ?? "").toUpperCase();
  const message = String((error as { message?: string })?.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("column");
};

const isTableMissingError = (error: unknown): boolean => {
  const code = String((error as { code?: string })?.code ?? "").toUpperCase();
  const message = String((error as { message?: string })?.message ?? "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("does not exist");
};

const normalizeMediaFiles = (files: unknown): NormalizedMediaFile[] => {
  if (!Array.isArray(files)) return [];

  return files
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const raw = entry as Record<string, unknown>;
      return {
        bucket: toString(raw.bucket),
        key: normalizeStoragePath(toString(raw.key)),
        size: toNumberOrNull(raw.size),
        sha256: toString(raw.sha256) || null,
      };
    })
    .filter((entry) => entry.bucket && entry.key);
};

const parseCsvRows = (
  csvText: string,
  options: { exportKey: string; maxRows: number },
): JsonObject[] => {
  const text = csvText.replace(/^\uFEFF/, "");
  if (!text.trim()) return [];

  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        currentCell += "\"";
        i += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        currentCell += char;
      }
      continue;
    }

    if (char === "\"") {
      if (currentCell.length > 0) {
        throw new RestoreValidationError(`CSV ${options.exportKey} tidak sah: petikan berada di tengah nilai.`);
      }
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if (char === "\n") {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    if (char === "\r") continue;

    currentCell += char;
  }

  if (inQuotes) {
    throw new RestoreValidationError(`CSV ${options.exportKey} tidak sah: petikan tidak ditutup.`);
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim());
  if (headers.length === 0 || headers.every((header) => !header)) return [];
  if (headers.some((header) => !header)) {
    throw new RestoreValidationError(`CSV ${options.exportKey} tidak sah: tajuk kolum kosong.`);
  }

  const parsedRows: JsonObject[] = [];
  rows.slice(1).forEach((row, index) => {
    if (!row.some((cell) => String(cell ?? "").trim() !== "")) return;

    if (row.length > headers.length) {
      throw new RestoreValidationError(`CSV ${options.exportKey} tidak sah: bilangan kolum tidak sepadan pada baris ${index + 2}.`);
    }

    const mapped: JsonObject = {};
    headers.forEach((header, columnIndex) => {
      const raw = String(row[columnIndex] ?? "");
      const trimmed = raw.trim();
      mapped[header] = trimmed ? trimmed : null;
    });

    parsedRows.push(mapped);
    if (parsedRows.length > options.maxRows) {
      throw new RestoreValidationError(
        `Table ${options.exportKey} melebihi had ${options.maxRows} rows.`,
        413,
      );
    }
  });

  return parsedRows;
};

const sha256Bytes = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hashBytes = new Uint8Array(digest);
  return Array.from(hashBytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const mimeTypeFromPath = (path: string): string | null => {
  const normalized = normalizeStoragePath(path);
  const lastSegment = normalized.split("/").pop() || "";
  const extension = lastSegment.includes(".")
    ? lastSegment.split(".").pop()?.toLowerCase() || ""
    : "";
  if (!extension) return null;
  return MIME_BY_EXTENSION[extension] || null;
};

const mimeTypeFromBytes = (bytes: Uint8Array): string | null => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) return "image/webp";
  if (bytes.length >= 6) {
    const gifHeader = String.fromCharCode(...bytes.slice(0, 6));
    if (gifHeader === "GIF87a" || gifHeader === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
  if (
    bytes.length >= 4
    && (
      (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
      || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
    )
  ) return "image/tiff";
  if (bytes.length >= 5) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 512)).trimStart().toLowerCase();
    if (text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))) return "image/svg+xml";
  }
  return null;
};

const resolveUploadMimeType = (path: string, bytes: Uint8Array): string => {
  return mimeTypeFromBytes(bytes) || mimeTypeFromPath(path) || "application/octet-stream";
};

const resolveRestoreMode = (restoreModeRaw: string, modeRaw: string): RestoreMode => {
  const normalizedRestore = toString(restoreModeRaw).toLowerCase();
  if (normalizedRestore === "self" || normalizedRestore === "disaster") return normalizedRestore as RestoreMode;

  const normalizedMode = toString(modeRaw).toLowerCase();
  if (normalizedMode === "self" || normalizedMode === "disaster") return normalizedMode as RestoreMode;
  if (normalizedMode === "dummy_restore") return "self";
  return "self";
};

const validateZipPayloadSize = (bytesLength: number): void => {
  if (bytesLength <= 0) {
    throw new RestoreValidationError("Fail ZIP kosong.");
  }
  if (bytesLength > MAX_ZIP_BYTES) {
    throw new RestoreValidationError(
      `Saiz ZIP melebihi had ${MAX_ZIP_BYTES} bytes.`,
      413,
    );
  }
};

const decodeBase64ToBytes = (value: string): Uint8Array => {
  const raw = value.includes(",") ? (value.split(",").pop() || "") : value;
  const normalized = raw.replace(/\s+/g, "");
  if (!normalized) {
    throw new RestoreValidationError("zip_base64 kosong.", 400);
  }

  let binary = "";
  try {
    binary = atob(normalized);
  } catch {
    throw new RestoreValidationError("zip_base64 tidak sah (base64 rosak).", 400);
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  validateZipPayloadSize(bytes.length);
  return bytes;
};

const readZipPayload = async (req: Request): Promise<RestorePayload | { error: string; status: number }> => {
  const contentType = String(req.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return { error: "multipart/form-data tidak sah.", status: 400 };
    }

    const fileEntry = formData.get("file") || formData.get("backup") || formData.get("zip");
    const restoreModeRaw = toString(formData.get("restore_mode"));
    const modeRaw = toString(formData.get("mode"));
    const idempotencyKeyRaw = toString(formData.get("idempotency_key"));
    const dryRun = parseBoolean(formData.get("dry_run"), false);
    const forceWipe = parseBoolean(formData.get("force_wipe"), false);

    if (fileEntry instanceof File) {
      try {
        if (fileEntry.size > MAX_ZIP_BYTES) {
          throw new RestoreValidationError(`Saiz ZIP melebihi had ${MAX_ZIP_BYTES} bytes.`, 413);
        }
        const bytes = new Uint8Array(await fileEntry.arrayBuffer());
        validateZipPayloadSize(bytes.length);
        return {
          bytes,
          fileName: fileEntry.name || "backup.zip",
          restoreModeRaw,
          modeRaw,
          idempotencyKeyRaw,
          dryRun,
          forceWipe,
        };
      } catch (error) {
        if (error instanceof RestoreValidationError) {
          return { error: error.message, status: error.status };
        }
        return { error: "Gagal membaca fail ZIP upload.", status: 400 };
      }
    }

    const base64Entry = formData.get("zip_base64") || formData.get("file_base64");
    if (typeof base64Entry === "string" && base64Entry.trim()) {
      try {
        const bytes = decodeBase64ToBytes(base64Entry);
        return {
          bytes,
          fileName: toString(formData.get("file_name")) || "backup.zip",
          restoreModeRaw,
          modeRaw,
          idempotencyKeyRaw,
          dryRun,
          forceWipe,
        };
      } catch (error) {
        if (error instanceof RestoreValidationError) {
          return { error: error.message, status: error.status };
        }
        return { error: "zip_base64 tidak sah.", status: 400 };
      }
    }

    return { error: "Fail ZIP tidak dijumpai dalam multipart form-data.", status: 400 };
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const base64Value = toString(body?.zip_base64 ?? body?.file_base64);
  if (!base64Value) {
    return { error: "Gunakan multipart/form-data (field `file`) atau JSON `zip_base64`.", status: 400 };
  }

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64ToBytes(base64Value);
  } catch (error) {
    if (error instanceof RestoreValidationError) {
      return { error: error.message, status: error.status };
    }
    return { error: "zip_base64 tidak sah.", status: 400 };
  }

  return {
    bytes,
    fileName: toString(body?.file_name) || "backup.zip",
    restoreModeRaw: toString(body?.restore_mode),
    modeRaw: toString(body?.mode),
    idempotencyKeyRaw: toString(body?.idempotency_key),
    dryRun: parseBoolean(body?.dry_run, false),
    forceWipe: parseBoolean(body?.force_wipe, false),
  };
};

const collectMediaZipEntries = (zip: JSZip): Map<string, JSZip.JSZipObject> => {
  const mediaEntryByBucketAndKey = new Map<string, JSZip.JSZipObject>();

  Object.entries(zip.files).forEach(([name, entry]) => {
    if (!entry || entry.dir) return;
    const normalizedName = normalizeStoragePath(name);
    if (!normalizedName.startsWith("media/")) return;

    const parts = normalizedName.split("/");
    if (parts.length < 4) return;

    const bucket = toString(parts[2]);
    const key = normalizeStoragePath(parts.slice(3).join("/"));
    if (!bucket || !key) return;

    const dedupeKey = `${bucket}/${key}`;
    if (!mediaEntryByBucketAndKey.has(dedupeKey)) {
      mediaEntryByBucketAndKey.set(dedupeKey, entry);
    }
  });

  return mediaEntryByBucketAndKey;
};

const checkObjectExists = async (
  serviceSupabase: ReturnType<typeof createClient>,
  bucket: string,
  key: string,
): Promise<{ exists: boolean; error: string | null }> => {
  const normalized = normalizeStoragePath(key);
  const segments = normalized.split("/");
  const fileName = segments.pop() || "";
  const folder = segments.join("/");
  if (!fileName) return { exists: false, error: "Nama fail kosong." };

  const { data, error } = await serviceSupabase.storage
    .from(bucket)
    .list(folder, { limit: 100, search: fileName });

  if (error) return { exists: false, error: error.message || "Gagal semak objek sedia ada." };
  const exists = Array.isArray(data) && data.some((entry) => entry?.name === fileName);
  return { exists, error: null };
};

const rewriteStorageKeyForDisaster = (key: string, oldUserId: string | null, newUserId: string): string => {
  const normalized = normalizeStoragePath(key);
  if (!normalized) return normalized;
  if (!oldUserId || !isUuid(oldUserId)) return normalized;
  const regex = new RegExp(escapeRegExp(oldUserId), "gi");
  return normalized.replace(regex, newUserId);
};

const keyBelongsToUser = (key: string, userId: string): boolean => {
  const normalizedKey = normalizeStoragePath(key).toLowerCase();
  const normalizedUserId = toString(userId).toLowerCase();
  if (!normalizedKey || !normalizedUserId) return false;
  return normalizedKey.includes(normalizedUserId);
};

const inferOldUserId = (
  backupTables: Record<string, JsonObject[]>,
  mediaFiles: NormalizedMediaFile[],
): string | null => {
  const frequency = new Map<string, number>();

  const addCandidate = (value: unknown) => {
    const normalized = toString(value).toLowerCase();
    if (!isUuid(normalized)) return;
    frequency.set(normalized, (frequency.get(normalized) || 0) + 1);
  };

  const profileRows = backupTables.profiles || [];
  if (profileRows.length > 0) addCandidate(profileRows[0]?.id);

  Object.values(backupTables).forEach((rows) => {
    rows.forEach((row) => {
      addCandidate((row as JsonObject).user_id);
      addCandidate((row as JsonObject).created_by);
      addCandidate((row as JsonObject).updated_by);
    });
  });

  mediaFiles.forEach((file) => {
    const matches = normalizeStoragePath(file.key).match(UUID_GLOBAL_REGEX);
    if (!matches) return;
    matches.forEach((match) => addCandidate(match));
  });

  let winner: string | null = null;
  let winnerCount = 0;
  frequency.forEach((count, userId) => {
    if (count > winnerCount) {
      winnerCount = count;
      winner = userId;
    }
  });

  return winner;
};

const validateZipStructure = (zip: JSZip): void => {
  const entries = Object.values(zip.files);
  if (entries.length === 0) {
    throw new RestoreValidationError("ZIP tidak mengandungi sebarang fail.");
  }

  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new RestoreValidationError(`ZIP mengandungi terlalu banyak fail (${entries.length}). Had ialah ${MAX_ZIP_ENTRIES}.`, 413);
  }

  const normalizedFileNames = new Set<string>();
  entries.forEach((entry) => {
    const rawName = String(entry.name || "").replace(/\\/g, "/");
    if (!rawName) {
      throw new RestoreValidationError("ZIP mengandungi nama fail kosong.");
    }
    if (rawName.includes("\0")) {
      throw new RestoreValidationError(`ZIP mengandungi nama fail berisiko: ${rawName}`);
    }

    const segments = rawName.split("/");
    if (segments.some((segment) => segment === "..")) {
      throw new RestoreValidationError(`ZIP mengandungi path traversal tidak dibenarkan: ${rawName}`);
    }

    if (entry.dir) return;

    const normalized = normalizeStoragePath(rawName);
    if (!normalized) {
      throw new RestoreValidationError(`Nama fail ZIP tidak sah: ${rawName}`);
    }

    const dedupeKey = normalized.toLowerCase();
    if (normalizedFileNames.has(dedupeKey)) {
      throw new RestoreValidationError(`ZIP mengandungi fail duplicate selepas normalisasi: ${normalized}`);
    }
    normalizedFileNames.add(dedupeKey);
  });
};

const findSingleZipEntry = (zip: JSZip, pattern: RegExp, label: string): JSZip.JSZipObject | null => {
  const entries = (zip.file(pattern) || [])
    .filter((entry, index, self) => self.findIndex((item) => item.name === entry.name) === index);

  if (entries.length > 1) {
    throw new RestoreValidationError(`ZIP mengandungi lebih daripada satu fail ${label}.`);
  }

  return entries[0] || null;
};

const findSingleTableEntry = (
  zip: JSZip,
  exportKey: string,
  format: "json" | "csv",
): JSZip.JSZipObject | null => {
  const candidates = format === "json"
    ? [
      new RegExp(`^json/${escapeRegExp(exportKey)}\\.json$`, "i"),
      new RegExp(`(^|/)json/${escapeRegExp(exportKey)}\\.json$`, "i"),
      new RegExp(`^${escapeRegExp(exportKey)}\\.json$`, "i"),
      new RegExp(`(^|/)${escapeRegExp(exportKey)}\\.json$`, "i"),
    ]
    : [
      new RegExp(`^csv/${escapeRegExp(exportKey)}\\.csv$`, "i"),
      new RegExp(`(^|/)csv/${escapeRegExp(exportKey)}\\.csv$`, "i"),
      new RegExp(`^${escapeRegExp(exportKey)}\\.csv$`, "i"),
      new RegExp(`(^|/)${escapeRegExp(exportKey)}\\.csv$`, "i"),
    ];

  const entries = candidates
    .flatMap((pattern) => zip.file(pattern) || [])
    .filter((entry, index, self) => self.findIndex((item) => item.name === entry.name) === index);

  if (entries.length > 1) {
    throw new RestoreValidationError(`Backup mengandungi lebih daripada satu fail ${format.toUpperCase()} untuk table ${exportKey}.`);
  }

  return entries[0] || null;
};

const normalizeJsonRows = (rows: unknown, exportKey: string): JsonObject[] => {
  if (!Array.isArray(rows)) {
    throw new RestoreValidationError(`JSON ${exportKey} tidak sah: format data rows bukan array.`);
  }

  return rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new RestoreValidationError(`JSON ${exportKey} tidak sah: row #${index + 1} bukan object.`);
    }
    return row as JsonObject;
  });
};

const extractRowsFromJson = (parsed: unknown, exportKey: string): JsonObject[] => {
  if (Array.isArray(parsed)) return normalizeJsonRows(parsed, exportKey);

  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.rows)) return normalizeJsonRows(record.rows, exportKey);
    if (Array.isArray(record.data)) return normalizeJsonRows(record.data, exportKey);

    const values = Object.values(record);
    if (values.length > 0 && values.every((value) => value && typeof value === "object" && !Array.isArray(value))) {
      return normalizeJsonRows(values, exportKey);
    }
  }

  throw new RestoreValidationError(`JSON ${exportKey} tidak sah: format tidak disokong.`);
};

const loadBackupJsonRows = async (
  zip: JSZip,
  exportKey: string,
  maxRowsPerTable: number,
): Promise<JsonObject[]> => {
  const jsonEntry = findSingleTableEntry(zip, exportKey, "json");

  if (jsonEntry) {
    let rawJson = "";
    try {
      rawJson = (await jsonEntry.async("string")).replace(/^\uFEFF/, "").trim();
    } catch {
      throw new RestoreValidationError(`Gagal membaca JSON untuk table ${exportKey}.`);
    }

    if (!rawJson) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new RestoreValidationError(`JSON ${exportKey} tidak sah (parse error).`);
    }

    const rows = extractRowsFromJson(parsed, exportKey);
    if (rows.length > maxRowsPerTable) {
      throw new RestoreValidationError(
        `Table ${exportKey} melebihi had ${maxRowsPerTable} rows.`,
        413,
      );
    }
    return rows;
  }

  const csvEntry = findSingleTableEntry(zip, exportKey, "csv");
  if (!csvEntry) return [];

  let csvText = "";
  try {
    csvText = await csvEntry.async("string");
  } catch {
    throw new RestoreValidationError(`Gagal membaca CSV untuk table ${exportKey}.`);
  }

  return parseCsvRows(csvText, { exportKey, maxRows: maxRowsPerTable });
};

const resolveMetadataSourceTable = (metadata: JsonObject, exportKey: string): string | null => {
  const exportedTables = (metadata.exported_tables && typeof metadata.exported_tables === "object")
    ? (metadata.exported_tables as Record<string, unknown>)
    : {};

  const row = exportedTables?.[exportKey];
  if (!row || typeof row !== "object") return null;
  const sourceTable = toString((row as Record<string, unknown>).source_table);
  return sourceTable || null;
};

const validateMetadataStructure = (metadata: unknown): JsonObject => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new RestoreValidationError("metadata.json tidak sah.");
  }

  const metadataObject = metadata as JsonObject;
  const checksum = toString(metadataObject.checksum);
  if (!checksum) {
    throw new RestoreValidationError("Checksum backup tiada dalam metadata.");
  }

  const exportedTables = metadataObject.exported_tables;
  if (!exportedTables || typeof exportedTables !== "object" || Array.isArray(exportedTables)) {
    throw new RestoreValidationError("metadata.json tidak sah: exported_tables tiada atau format salah.");
  }

  Object.entries(exportedTables as Record<string, unknown>).forEach(([tableKey, row]) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new RestoreValidationError(`metadata.json tidak sah: exported_tables.${tableKey} bukan object.`);
    }

    const rowCountRaw = (row as Record<string, unknown>).row_count;
    const rowCount = Number(rowCountRaw);
    if (!Number.isFinite(rowCount) || rowCount < 0 || !Number.isInteger(rowCount)) {
      throw new RestoreValidationError(`metadata.json tidak sah: row_count table ${tableKey} tidak sah.`);
    }
  });

  return metadataObject;
};

const validateAndNormalizeMediaManifest = (mediaManifest: unknown): NormalizedMediaFile[] => {
  if (!mediaManifest || typeof mediaManifest !== "object" || Array.isArray(mediaManifest)) {
    throw new RestoreValidationError("media_manifest.json tidak sah.");
  }

  const filesRaw = (mediaManifest as Record<string, unknown>).files;
  if (!Array.isArray(filesRaw)) {
    throw new RestoreValidationError("media_manifest.json tidak sah: `files` mesti array.");
  }

  const mediaFiles = normalizeMediaFiles(filesRaw);
  if (mediaFiles.length === 0) {
    throw new RestoreValidationError("media_manifest.json tidak mengandungi sebarang fail media.");
  }

  if (mediaFiles.length > MAX_MEDIA_FILES) {
    throw new RestoreValidationError(
      `Terlalu banyak fail media (${mediaFiles.length}). Had maksimum ialah ${MAX_MEDIA_FILES}.`,
      413,
    );
  }

  const dedupe = new Set<string>();
  let declaredTotalBytes = 0;

  mediaFiles.forEach((file, index) => {
    if (!ALLOWED_MEDIA_BUCKETS.has(file.bucket)) {
      throw new RestoreValidationError(`media_manifest.json tidak sah: bucket tidak dibenarkan pada entry #${index + 1}.`);
    }

    if (!file.key) {
      throw new RestoreValidationError(`media_manifest.json tidak sah: key kosong pada entry #${index + 1}.`);
    }

    const dedupeKey = `${file.bucket}/${file.key}`.toLowerCase();
    if (dedupe.has(dedupeKey)) {
      throw new RestoreValidationError(`media_manifest.json mempunyai duplicate key: ${file.bucket}/${file.key}`);
    }
    dedupe.add(dedupeKey);

    if (file.size !== null) {
      if (!Number.isInteger(file.size) || file.size < 0) {
        throw new RestoreValidationError(`media_manifest.json tidak sah: size tidak sah pada ${file.bucket}/${file.key}`);
      }
      declaredTotalBytes += file.size;
      if (declaredTotalBytes > MAX_TOTAL_MEDIA_BYTES) {
        throw new RestoreValidationError(
          `Jumlah saiz media dalam manifest melebihi had ${MAX_TOTAL_MEDIA_BYTES} bytes.`,
          413,
        );
      }
    }
  });

  return mediaFiles;
};

const validateMediaManifestCoverage = (
  mediaFiles: NormalizedMediaFile[],
  mediaZipEntries: Map<string, JSZip.JSZipObject>,
): void => {
  const missing: string[] = [];

  mediaFiles.forEach((file) => {
    const key = `${file.bucket}/${file.key}`;
    if (!mediaZipEntries.has(key) && missing.length < 10) {
      missing.push(key);
    }
  });

  if (missing.length > 0) {
    throw new RestoreValidationError(
      `Backup media tidak lengkap. Fail media tiada dalam /media/: ${missing.join(", ")}`,
    );
  }
};

const getMetadataTableRowCount = (metadata: JsonObject, exportKey: string): number | null => {
  const exportedTables = metadata.exported_tables as Record<string, unknown>;
  const row = exportedTables?.[exportKey];
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;

  const rowCountRaw = (row as Record<string, unknown>).row_count;
  const rowCount = Number(rowCountRaw);
  if (!Number.isFinite(rowCount) || rowCount < 0 || !Number.isInteger(rowCount)) {
    throw new RestoreValidationError(`metadata.json tidak sah: row_count table ${exportKey} tidak sah.`);
  }

  return rowCount;
};

const loadAndValidateBackupTables = async (
  zip: JSZip,
  metadata: JsonObject,
): Promise<{ backupTables: Record<string, JsonObject[]>; totalRows: number }> => {
  const backupTables: Record<string, JsonObject[]> = {};
  let totalRows = 0;

  for (const spec of RESTORE_TABLE_SPECS) {
    const rows = await loadBackupJsonRows(zip, spec.exportKey, MAX_ROWS_PER_TABLE);
    const metadataCount = getMetadataTableRowCount(metadata, spec.exportKey);
    if (metadataCount !== null && metadataCount !== rows.length) {
      throw new RestoreValidationError(
        `Backup tidak konsisten untuk table ${spec.exportKey} (metadata=${metadataCount}, data=${rows.length}).`,
      );
    }

    backupTables[spec.exportKey] = rows;
    totalRows += rows.length;
  }

  return { backupTables, totalRows };
};

const tableExists = async (
  serviceSupabase: ReturnType<typeof createClient>,
  tableName: string,
  cache: Map<string, boolean>,
): Promise<boolean> => {
  if (cache.has(tableName)) return Boolean(cache.get(tableName));

  const { error } = await serviceSupabase
    .from(tableName)
    .select("*", { head: true, count: "exact" })
    .limit(1);

  if (!error) {
    cache.set(tableName, true);
    return true;
  }

  if (isTableMissingError(error)) {
    cache.set(tableName, false);
    return false;
  }

  cache.set(tableName, true);
  return true;
};

const columnExists = async (
  serviceSupabase: ReturnType<typeof createClient>,
  tableName: string,
  columnName: string,
  cache: Map<string, boolean>,
): Promise<boolean> => {
  const cacheKey = `${tableName}.${columnName}`;
  if (cache.has(cacheKey)) return Boolean(cache.get(cacheKey));

  const { error } = await serviceSupabase
    .from(tableName)
    .select(columnName)
    .limit(1);

  if (!error) {
    cache.set(cacheKey, true);
    return true;
  }

  if (isTableMissingError(error) || isMissingColumnError(error)) {
    cache.set(cacheKey, false);
    return false;
  }

  cache.set(cacheKey, true);
  return true;
};

const isMissingFunctionError = (error: unknown): boolean => {
  const code = String((error as { code?: string })?.code ?? "").toUpperCase();
  const message = String((error as { message?: string })?.message ?? "").toLowerCase();
  return code === "PGRST202" || message.includes("could not find the function");
};

const tryAcquireRestoreLock = async (
  serviceSupabase: ReturnType<typeof createClient>,
  userId: string,
  restoreMode: RestoreMode,
): Promise<{ enabled: boolean; acquired: boolean; requestId: string | null }> => {
  const requestId = crypto.randomUUID();

  const { data, error } = await serviceSupabase.rpc("try_acquire_restore_lock", {
    p_user_id: userId,
    p_request_id: requestId,
    p_restore_mode: restoreMode,
    p_ttl_seconds: RESTORE_LOCK_TTL_SECONDS,
  });

  if (error) {
    if (isMissingFunctionError(error)) {
      // Backward compatibility for projects that have not run migration yet.
      return { enabled: false, acquired: true, requestId: null };
    }
    throw new Error(error.message || "Gagal mendapatkan restore lock.");
  }

  return {
    enabled: true,
    acquired: Boolean(data),
    requestId,
  };
};

const releaseRestoreLock = async (
  serviceSupabase: ReturnType<typeof createClient>,
  userId: string,
  requestId: string | null,
): Promise<void> => {
  if (!requestId) return;

  const { error } = await serviceSupabase.rpc("release_restore_lock", {
    p_user_id: userId,
    p_request_id: requestId,
  });

  if (!error || isMissingFunctionError(error)) return;
  throw new Error(error.message || "Gagal melepaskan restore lock.");
};

const findFirstExistingTable = async (
  serviceSupabase: ReturnType<typeof createClient>,
  candidates: string[],
  tableExistsCache: Map<string, boolean>,
): Promise<string | null> => {
  for (const candidate of candidates) {
    if (await tableExists(serviceSupabase, candidate, tableExistsCache)) return candidate;
  }
  return null;
};

const findRecentIdempotentRestoreEvent = async (
  serviceSupabase: ReturnType<typeof createClient>,
  tableExistsCache: Map<string, boolean>,
  columnExistsCache: Map<string, boolean>,
  payload: {
    userId: string;
    idempotencyKey: string;
    checksum: string;
    restoreMode: RestoreMode;
    dryRun: boolean;
    forceWipe: boolean;
  },
): Promise<Record<string, unknown> | null> => {
  if (!payload.idempotencyKey) return null;

  const hasRestoreEvents = await tableExists(serviceSupabase, "restore_events", tableExistsCache);
  if (!hasRestoreEvents) return null;

  const hasIdempotencyColumn = await columnExists(serviceSupabase, "restore_events", "idempotency_key", columnExistsCache);
  if (!hasIdempotencyColumn) return null;

  const replaySinceIso = new Date(Date.now() - (IDEMPOTENCY_REPLAY_WINDOW_SECONDS * 1000)).toISOString();
  const { data, error } = await serviceSupabase
    .from("restore_events")
    .select("id, created_at, summary")
    .eq("new_user_id", payload.userId)
    .eq("idempotency_key", payload.idempotencyKey)
    .eq("source_backup_checksum", payload.checksum)
    .eq("restore_mode", payload.restoreMode)
    .eq("dry_run", payload.dryRun)
    .eq("force_wipe", payload.forceWipe)
    .gte("created_at", replaySinceIso)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    if (isTableMissingError(error) || isMissingColumnError(error)) return null;
    throw new Error(error.message || "Gagal semak idempotency restore.");
  }

  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return null;

  const event = rows[0] as Record<string, unknown>;
  const summary = event.summary;
  const totalFailed = getSummaryCount(summary, "data_failed_count") + getSummaryCount(summary, "media_failed_count");
  if (totalFailed > 0) return null;

  return event;
};

const resolveTargetTable = async (
  serviceSupabase: ReturnType<typeof createClient>,
  spec: RestoreTableSpec,
  metadata: JsonObject,
  tableExistsCache: Map<string, boolean>,
): Promise<string | null> => {
  if (spec.exportKey === "customers") {
    // Legacy backups may label this table as "customers", but live relational FKs
    // point to "clients". Always prefer "clients" when available.
    if (await tableExists(serviceSupabase, "clients", tableExistsCache)) {
      return "clients";
    }
  }

  const metadataSource = resolveMetadataSourceTable(metadata, spec.exportKey);
  if (metadataSource && await tableExists(serviceSupabase, metadataSource, tableExistsCache)) {
    return metadataSource;
  }
  return await findFirstExistingTable(serviceSupabase, spec.candidates, tableExistsCache);
};

const remapMediaInString = (input: string, mappings: MediaKeyMapping[]): string => {
  let output = input;

  for (const mapping of mappings) {
    output = replaceAllSafe(output, mapping.sourcePublicUrl, mapping.targetPublicUrl);
    output = replaceAllSafe(
      output,
      `/storage/v1/object/public/${mapping.bucket}/${mapping.sourceKey}`,
      `/storage/v1/object/public/${mapping.bucket}/${mapping.targetKey}`,
    );
    if (output === mapping.sourceKey) output = mapping.targetKey;
    output = replaceAllSafe(
      output,
      `${mapping.bucket}/${mapping.sourceKey}`,
      `${mapping.bucket}/${mapping.targetKey}`,
    );
  }

  return output;
};

const remapRowForRestore = (
  exportKey: string,
  row: JsonObject,
  newUserId: string,
  oldUserId: string | null,
  mediaMappings: MediaKeyMapping[],
  idMappings: Map<string, string>,
): JsonObject => {
  const walk = (value: unknown, keyName: string | null): unknown => {
    if (Array.isArray(value)) return value.map((entry) => walk(entry, null));

    if (value && typeof value === "object") {
      const next: Record<string, unknown> = {};
      Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
        next[k] = walk(v, k);
      });
      return next;
    }

    if (typeof value === "string") {
      let remapped = remapMediaInString(value, mediaMappings);
      if (keyName === "user_id") remapped = newUserId;
      else if (keyName === "id" && exportKey === "profiles") remapped = newUserId;
      else if ((keyName === "created_by" || keyName === "updated_by") && oldUserId && value === oldUserId) remapped = newUserId;
      if (isUuid(remapped) && idMappings.has(remapped)) remapped = idMappings.get(remapped) || remapped;
      return remapped;
    }

    return value;
  };

  return walk(row, null) as JsonObject;
};

const pushIssue = (collection: RestoreIssue[], issue: RestoreIssue, maxSize: number): void => {
  if (collection.length >= maxSize) return;
  collection.push(issue);
};

const registerDisasterIdMappings = (
  exportKey: string,
  rows: JsonObject[],
  idMappings: Map<string, string>,
): void => {
  if (!DISASTER_ID_REMAP_TABLES.has(exportKey)) return;

  rows.forEach((row) => {
    const record = row as Record<string, unknown>;
    const sourceIds = exportKey === "customers"
      ? extractUuidCandidates(record, ["id", "client_id", "customer_id"])
      : extractUuidCandidates(record, ["id"]);
    if (sourceIds.length === 0) return;

    const firstMapped = sourceIds
      .map((sourceId) => idMappings.get(sourceId))
      .find((mapped) => isUuid(mapped));
    const nextId = firstMapped || crypto.randomUUID();

    sourceIds.forEach((sourceId) => {
      if (!idMappings.has(sourceId)) idMappings.set(sourceId, nextId);
    });
  });
};

const writeRowsWithFallback = async (
  serviceSupabase: ReturnType<typeof createClient>,
  tableName: string,
  rows: JsonObject[],
  onConflict: string | undefined,
  issues: RestoreIssue[],
): Promise<WriteRowsResult> => {
  let insertedCount = 0;
  let skippedExistingCount = 0;
  let failedCount = 0;

  const writeSingle = async (row: JsonObject): Promise<void> => {
    let error: { message?: string; code?: string } | null = null;

    if (onConflict) {
      const response = await serviceSupabase
        .from(tableName)
        .upsert(row, { onConflict });
      error = response.error;
    } else {
      const response = await serviceSupabase
        .from(tableName)
        .insert(row);
      error = response.error;
    }

    if (!error) {
      insertedCount += 1;
      return;
    }

    if (isLikelyAlreadyExists(error.message || "", error.code)) {
      skippedExistingCount += 1;
      return;
    }

    failedCount += 1;
    pushIssue(issues, {
      table: tableName,
      bucket: null,
      key: null,
      message: error.message || "Insert gagal.",
    }, MAX_ERRORS);
  };

  for (const chunk of chunkValues(rows, MAX_DB_BATCH)) {
    let error: { message?: string; code?: string } | null = null;

    if (onConflict) {
      const response = await serviceSupabase
        .from(tableName)
        .upsert(chunk, { onConflict });
      error = response.error;
    } else {
      const response = await serviceSupabase
        .from(tableName)
        .insert(chunk);
      error = response.error;
    }

    if (!error) {
      insertedCount += chunk.length;
      continue;
    }

    for (const row of chunk) {
      await writeSingle(row);
    }
  }

  return { insertedCount, skippedExistingCount, failedCount };
};

const countRowsByUser = async (
  serviceSupabase: ReturnType<typeof createClient>,
  tableName: string | null,
  userId: string,
): Promise<number> => {
  if (!tableName) return 0;

  const { count, error } = await serviceSupabase
    .from(tableName)
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (!error) return Number(count || 0);
  if (isTableMissingError(error) || isMissingColumnError(error)) return 0;
  throw new Error(error.message || `Gagal kira row untuk ${tableName}.`);
};

const fetchIdsByUser = async (
  serviceSupabase: ReturnType<typeof createClient>,
  tableName: string | null,
  userId: string,
): Promise<string[]> => {
  if (!tableName) return [];

  const { data, error } = await serviceSupabase
    .from(tableName)
    .select("id")
    .eq("user_id", userId)
    .limit(50000);

  if (!error) {
    return (Array.isArray(data) ? data : [])
      .map((row) => toString((row as Record<string, unknown>).id))
      .filter(Boolean);
  }

  if (isTableMissingError(error) || isMissingColumnError(error)) return [];
  throw new Error(error.message || `Gagal ambil ID dari ${tableName}.`);
};

const deleteByUser = async (
  serviceSupabase: ReturnType<typeof createClient>,
  tableName: string | null,
  userId: string,
): Promise<void> => {
  if (!tableName) return;
  const { error } = await serviceSupabase
    .from(tableName)
    .delete()
    .eq("user_id", userId);

  if (!error) return;
  if (isTableMissingError(error) || isMissingColumnError(error)) return;
  throw new Error(error.message || `Gagal delete by user untuk ${tableName}.`);
};

const deleteByIn = async (
  serviceSupabase: ReturnType<typeof createClient>,
  tableName: string | null,
  columnName: string,
  ids: string[],
): Promise<void> => {
  if (!tableName || ids.length === 0) return;

  for (const chunk of chunkValues(ids, MAX_DB_BATCH)) {
    const { error } = await serviceSupabase
      .from(tableName)
      .delete()
      .in(columnName, chunk);

    if (!error) continue;
    if (isTableMissingError(error) || isMissingColumnError(error)) return;
    throw new Error(error.message || `Gagal delete ${tableName} by ${columnName}.`);
  }
};

const wipeExistingBusinessData = async (
  serviceSupabase: ReturnType<typeof createClient>,
  userId: string,
  tableExistsCache: Map<string, boolean>,
): Promise<void> => {
  const itemsTable = await findFirstExistingTable(serviceSupabase, ["items", "inventory"], tableExistsCache);
  const customersTable = await findFirstExistingTable(serviceSupabase, ["clients", "customers"], tableExistsCache);
  const walletsTable = await findFirstExistingTable(serviceSupabase, ["wallets"], tableExistsCache);
  const invoicesTable = await findFirstExistingTable(serviceSupabase, ["invoices"], tableExistsCache);
  const shipmentsTable = await findFirstExistingTable(serviceSupabase, ["shipments"], tableExistsCache);
  const invoiceItemsTable = await findFirstExistingTable(serviceSupabase, ["invoice_items"], tableExistsCache);
  const invoiceAdjustmentsTable = await findFirstExistingTable(serviceSupabase, ["invoice_adjustments", "invoice_refunds"], tableExistsCache);
  const invoiceFeesTable = await findFirstExistingTable(serviceSupabase, ["platform_fees", "invoice_fees"], tableExistsCache);
  const walletTxTable = await findFirstExistingTable(serviceSupabase, ["wallet_transactions", "transactions"], tableExistsCache);
  const settingsTable = await findFirstExistingTable(serviceSupabase, ["settings", "invoice_settings"], tableExistsCache);

  const invoiceIds = await fetchIdsByUser(serviceSupabase, invoicesTable, userId);
  const itemIds = await fetchIdsByUser(serviceSupabase, itemsTable, userId);
  const customerIds = await fetchIdsByUser(serviceSupabase, customersTable, userId);
  const shipmentIds = await fetchIdsByUser(serviceSupabase, shipmentsTable, userId);

  let invoiceItemIds: string[] = [];
  if (invoiceItemsTable && invoiceIds.length > 0) {
    const { data, error } = await serviceSupabase
      .from(invoiceItemsTable)
      .select("id, invoice_id")
      .in("invoice_id", invoiceIds)
      .limit(50000);
    if (!error) {
      invoiceItemIds = (Array.isArray(data) ? data : [])
        .map((row) => toString((row as Record<string, unknown>).id))
        .filter(Boolean);
    }
  }

  await deleteByIn(serviceSupabase, await findFirstExistingTable(serviceSupabase, ["invoice_item_returns"], tableExistsCache), "invoice_item_id", invoiceItemIds);
  await deleteByIn(serviceSupabase, await findFirstExistingTable(serviceSupabase, ["invoice_item_returns"], tableExistsCache), "invoice_id", invoiceIds);
  await deleteByIn(serviceSupabase, invoiceAdjustmentsTable, "invoice_id", invoiceIds);
  await deleteByIn(serviceSupabase, invoiceFeesTable, "invoice_id", invoiceIds);
  await deleteByIn(serviceSupabase, await findFirstExistingTable(serviceSupabase, ["shipment_invoices"], tableExistsCache), "invoice_id", invoiceIds);
  await deleteByIn(serviceSupabase, await findFirstExistingTable(serviceSupabase, ["shipment_invoices"], tableExistsCache), "shipment_id", shipmentIds);
  await deleteByIn(serviceSupabase, invoiceItemsTable, "invoice_id", invoiceIds);
  await deleteByIn(serviceSupabase, await findFirstExistingTable(serviceSupabase, ["client_phones"], tableExistsCache), "client_id", customerIds);
  await deleteByIn(serviceSupabase, await findFirstExistingTable(serviceSupabase, ["client_addresses"], tableExistsCache), "client_id", customerIds);
  await deleteByIn(serviceSupabase, await findFirstExistingTable(serviceSupabase, ["item_media"], tableExistsCache), "item_id", itemIds);
  await deleteByIn(serviceSupabase, await findFirstExistingTable(serviceSupabase, ["inventory_reservations"], tableExistsCache), "item_id", itemIds);

  await deleteByUser(serviceSupabase, await findFirstExistingTable(serviceSupabase, ["catalog_cover_media"], tableExistsCache), userId);
  await deleteByUser(serviceSupabase, await findFirstExistingTable(serviceSupabase, ["catalogs"], tableExistsCache), userId);
  await deleteByUser(serviceSupabase, await findFirstExistingTable(serviceSupabase, ["media_library"], tableExistsCache), userId);
  await deleteByUser(serviceSupabase, walletTxTable, userId);
  await deleteByUser(serviceSupabase, await findFirstExistingTable(serviceSupabase, ["categories"], tableExistsCache), userId);
  await deleteByUser(serviceSupabase, settingsTable, userId);
  await deleteByUser(serviceSupabase, invoicesTable, userId);
  await deleteByUser(serviceSupabase, await findFirstExistingTable(serviceSupabase, ["sales_channels"], tableExistsCache), userId);
  await deleteByUser(serviceSupabase, await findFirstExistingTable(serviceSupabase, ["platform_fee_rules"], tableExistsCache), userId);
  await deleteByUser(serviceSupabase, shipmentsTable, userId);
  await deleteByUser(serviceSupabase, customersTable, userId);
  await deleteByUser(serviceSupabase, itemsTable, userId);
  await deleteByUser(serviceSupabase, walletsTable, userId);
};

const syncClientsFromCustomersIfNeeded = async (
  serviceSupabase: ReturnType<typeof createClient>,
  userId: string,
  tableExistsCache: Map<string, boolean>,
  issues: RestoreIssue[],
): Promise<void> => {
  const hasClients = await tableExists(serviceSupabase, "clients", tableExistsCache);
  const hasCustomers = await tableExists(serviceSupabase, "customers", tableExistsCache);
  if (!hasClients || !hasCustomers) return;

  const { data: existingClients, error: clientsError } = await serviceSupabase
    .from("clients")
    .select("id")
    .eq("user_id", userId)
    .limit(1);

  if (clientsError) {
    if (isTableMissingError(clientsError) || isMissingColumnError(clientsError)) return;
    throw new Error(clientsError.message || "Gagal semak clients semasa sync.");
  }

  if ((existingClients || []).length > 0) return;

  const { data: legacyCustomers, error: customersError } = await serviceSupabase
    .from("customers")
    .select("id, user_id, name, email")
    .eq("user_id", userId)
    .limit(5000);

  if (customersError) {
    if (isTableMissingError(customersError) || isMissingColumnError(customersError)) return;
    throw new Error(customersError.message || "Gagal baca customers semasa sync ke clients.");
  }

  const rows = (Array.isArray(legacyCustomers) ? legacyCustomers : [])
    .map((row) => {
      const record = row as Record<string, unknown>;
      const id = toString(record.id);
      if (!isUuid(id)) return null;
      const email = normalizeEmailKey(record.email);
      return {
        id,
        user_id: userId,
        name: toString(record.name) || "Pelanggan",
        email: email || null,
      } as JsonObject;
    })
    .filter((row): row is JsonObject => Boolean(row));

  if (rows.length === 0) return;

  const syncResult = await writeRowsWithFallback(
    serviceSupabase,
    "clients",
    rows,
    "id",
    issues,
  );

  if (syncResult.failedCount > 0) {
    pushIssue(issues, {
      table: "clients",
      bucket: null,
      key: null,
      message: "Sebahagian sync customers -> clients gagal.",
    }, MAX_ERRORS);
  }
};

const syncClientsFromInvoiceRefsIfNeeded = async (
  serviceSupabase: ReturnType<typeof createClient>,
  userId: string,
  tableExistsCache: Map<string, boolean>,
  issues: RestoreIssue[],
): Promise<void> => {
  const hasClients = await tableExists(serviceSupabase, "clients", tableExistsCache);
  const hasInvoices = await tableExists(serviceSupabase, "invoices", tableExistsCache);
  if (!hasClients || !hasInvoices) return;

  const { data: existingClients, error: clientsError } = await serviceSupabase
    .from("clients")
    .select("id")
    .eq("user_id", userId)
    .limit(50000);

  if (clientsError) {
    if (isTableMissingError(clientsError) || isMissingColumnError(clientsError)) return;
    throw new Error(clientsError.message || "Gagal semak clients semasa sync dari invoices.");
  }
  const existingClientIds = new Set(
    (Array.isArray(existingClients) ? existingClients : [])
      .map((row) => toString((row as Record<string, unknown>).id))
      .filter((id) => isUuid(id)),
  );

  const { data: invoiceRows, error: invoicesError } = await serviceSupabase
    .from("invoices")
    .select("client_id")
    .eq("user_id", userId)
    .not("client_id", "is", null)
    .limit(10000);

  if (invoicesError) {
    if (isTableMissingError(invoicesError) || isMissingColumnError(invoicesError)) return;
    throw new Error(invoicesError.message || "Gagal baca invoices semasa sync ke clients.");
  }

  const clientIds = Array.from(new Set(
    (Array.isArray(invoiceRows) ? invoiceRows : [])
      .map((row) => toString((row as Record<string, unknown>).client_id))
      .filter((id) => isUuid(id)),
  ));

  const missingClientIds = clientIds.filter((id) => !existingClientIds.has(id));
  if (missingClientIds.length === 0) return;

  const rows = missingClientIds.map((id) => ({
    id,
    user_id: userId,
    name: "Pelanggan Restore",
    email: null,
  })) as JsonObject[];

  const syncResult = await writeRowsWithFallback(
    serviceSupabase,
    "clients",
    rows,
    "id",
    issues,
  );

  if (syncResult.failedCount > 0) {
    pushIssue(issues, {
      table: "clients",
      bucket: null,
      key: null,
      message: "Sebahagian sync invoice client_id -> clients gagal.",
    }, MAX_ERRORS);
  }
};

const logRestoreEvent = async (
  serviceSupabase: ReturnType<typeof createClient>,
  tableExistsCache: Map<string, boolean>,
  columnExistsCache: Map<string, boolean>,
  payload: {
    checksum: string;
    idempotencyKey: string;
    oldUserId: string | null;
    newUserId: string;
    restoreMode: RestoreMode;
    forceWipe: boolean;
    dryRun: boolean;
    summary: JsonObject;
  },
): Promise<void> => {
  if (!await tableExists(serviceSupabase, "restore_events", tableExistsCache)) return;

  const hasIdempotencyColumn = payload.idempotencyKey
    ? await columnExists(serviceSupabase, "restore_events", "idempotency_key", columnExistsCache)
    : false;

  const eventRow: JsonObject = {
    source_backup_checksum: payload.checksum,
    old_user_id: isUuid(payload.oldUserId || "") ? payload.oldUserId : null,
    new_user_id: payload.newUserId,
    restore_mode: payload.restoreMode,
    force_wipe: payload.forceWipe,
    dry_run: payload.dryRun,
    summary: payload.summary,
    created_at: new Date().toISOString(),
  };
  if (hasIdempotencyColumn) {
    eventRow.idempotency_key = payload.idempotencyKey;
  }

  if (hasIdempotencyColumn) {
    const { data: existingRows, error: existingError } = await serviceSupabase
      .from("restore_events")
      .select("id")
      .eq("new_user_id", payload.newUserId)
      .eq("idempotency_key", payload.idempotencyKey)
      .eq("restore_mode", payload.restoreMode)
      .eq("source_backup_checksum", payload.checksum)
      .eq("dry_run", payload.dryRun)
      .eq("force_wipe", payload.forceWipe)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!existingError && Array.isArray(existingRows) && existingRows.length > 0) {
      const existingId = toString((existingRows[0] as Record<string, unknown>).id);
      if (existingId) {
        const { error: updateError } = await serviceSupabase
          .from("restore_events")
          .update(eventRow)
          .eq("id", existingId);

        if (!updateError) return;
        console.error("restore_events update failed", updateError);
      }
    } else if (existingError && !isMissingColumnError(existingError) && !isTableMissingError(existingError)) {
      console.error("restore_events lookup failed", existingError);
    }
  }

  const { error: insertError } = await serviceSupabase
    .from("restore_events")
    .insert(eventRow);

  if (!insertError) return;
  if (isLikelyAlreadyExists(insertError.message || "", insertError.code)) return;
  console.error("restore_events insert failed", insertError);
};

const restoreMedia = async (params: {
  serviceSupabase: ReturnType<typeof createClient>;
  zip: JSZip;
  mediaFiles: NormalizedMediaFile[];
  restoreMode: RestoreMode;
  oldUserId: string | null;
  newUserId: string;
  supabaseUrl: string;
  dryRun: boolean;
}): Promise<{
  uploadedCount: number;
  skippedExistingCount: number;
  failedCount: number;
  wouldUploadCount: number;
  sampleUploadedPaths: string[];
  conflicts: RestoreIssue[];
  issues: RestoreIssue[];
  mediaMappings: MediaKeyMapping[];
}> => {
  const {
    serviceSupabase,
    zip,
    mediaFiles,
    restoreMode,
    oldUserId,
    newUserId,
    supabaseUrl,
    dryRun,
  } = params;

  const mediaZipEntries = collectMediaZipEntries(zip);
  const sampleUploadedPaths: string[] = [];
  const conflicts: RestoreIssue[] = [];
  const issues: RestoreIssue[] = [];
  const mediaMappings: MediaKeyMapping[] = [];
  const seenBucketKeys = new Set<string>();

  let uploadedCount = 0;
  let skippedExistingCount = 0;
  let failedCount = 0;
  let wouldUploadCount = 0;
  let uploadedBytes = 0;

  for (const mediaFile of mediaFiles) {
    const bucket = toString(mediaFile.bucket);
    const sourceKey = normalizeStoragePath(mediaFile.key);

    if (!bucket || !sourceKey) {
      failedCount += 1;
      pushIssue(issues, { table: null, bucket: bucket || null, key: sourceKey || null, message: "Manifest entry bucket/key tidak sah." }, MAX_ERRORS);
      continue;
    }

    if (!ALLOWED_MEDIA_BUCKETS.has(bucket)) {
      failedCount += 1;
      pushIssue(issues, { table: null, bucket, key: sourceKey, message: "Bucket media tidak dibenarkan." }, MAX_ERRORS);
      continue;
    }

    const targetKey = restoreMode === "disaster"
      ? rewriteStorageKeyForDisaster(sourceKey, oldUserId, newUserId)
      : sourceKey;

    if (!keyBelongsToUser(targetKey, newUserId)) {
      failedCount += 1;
      pushIssue(issues, {
        table: null,
        bucket,
        key: targetKey,
        message: "Target path media tidak milik user semasa. Dihalang oleh safety guardrail.",
      }, MAX_ERRORS);
      continue;
    }

    const dedupeTarget = `${bucket}/${targetKey}`;
    if (seenBucketKeys.has(dedupeTarget)) continue;
    seenBucketKeys.add(dedupeTarget);

    const sourceLookupKey = `${bucket}/${sourceKey}`;
    const zipEntry = mediaZipEntries.get(sourceLookupKey) || null;
    if (!zipEntry) {
      failedCount += 1;
      pushIssue(issues, { table: null, bucket, key: sourceKey, message: "Fail media tiada dalam /media/ ZIP." }, MAX_ERRORS);
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = await zipEntry.async("uint8array");
    } catch (error) {
      failedCount += 1;
      pushIssue(issues, { table: null, bucket, key: sourceKey, message: error instanceof Error ? error.message : String(error) }, MAX_ERRORS);
      continue;
    }

    if (mediaFile.size !== null && mediaFile.size !== bytes.length) {
      failedCount += 1;
      pushIssue(issues, {
        table: null,
        bucket,
        key: sourceKey,
        message: `Saiz fail tidak sepadan (manifest=${mediaFile.size}, zip=${bytes.length}).`,
      }, MAX_ERRORS);
      continue;
    }

    if (mediaFile.sha256) {
      const actualSha256 = await sha256Bytes(bytes);
      if (actualSha256.toLowerCase() !== mediaFile.sha256.toLowerCase()) {
        failedCount += 1;
        pushIssue(issues, { table: null, bucket, key: sourceKey, message: "SHA-256 mismatch." }, MAX_ERRORS);
        continue;
      }
    }

    if (uploadedBytes + bytes.length > MAX_TOTAL_MEDIA_BYTES) {
      failedCount += 1;
      pushIssue(issues, { table: null, bucket, key: sourceKey, message: `Melebihi had total upload ${MAX_TOTAL_MEDIA_BYTES} bytes.` }, MAX_ERRORS);
      continue;
    }

    const mapping: MediaKeyMapping = {
      bucket,
      sourceKey,
      targetKey,
      sourcePublicUrl: `${supabaseUrl}/storage/v1/object/public/${bucket}/${sourceKey}`,
      targetPublicUrl: `${supabaseUrl}/storage/v1/object/public/${bucket}/${targetKey}`,
    };

    if (dryRun) {
      const existsCheck = await checkObjectExists(serviceSupabase, bucket, targetKey);
      if (existsCheck.error) {
        failedCount += 1;
        pushIssue(issues, { table: null, bucket, key: targetKey, message: existsCheck.error }, MAX_ERRORS);
        continue;
      }

      if (existsCheck.exists) {
        skippedExistingCount += 1;
        pushIssue(conflicts, { table: null, bucket, key: targetKey, message: "Objek sedia ada (dry_run)." }, MAX_CONFLICTS);
        mediaMappings.push(mapping);
        continue;
      }

      wouldUploadCount += 1;
      uploadedBytes += bytes.length;
      mediaMappings.push(mapping);
      continue;
    }

    const contentType = resolveUploadMimeType(targetKey, bytes);
    const { error: uploadError } = await serviceSupabase.storage
      .from(bucket)
      .upload(targetKey, bytes, {
        upsert: false,
        contentType,
      });

    if (uploadError) {
      const message = uploadError.message || "Upload gagal.";
      if (isLikelyAlreadyExists(message, uploadError.code)) {
        skippedExistingCount += 1;
        pushIssue(conflicts, { table: null, bucket, key: targetKey, message }, MAX_CONFLICTS);
        mediaMappings.push(mapping);
      } else {
        failedCount += 1;
        pushIssue(issues, { table: null, bucket, key: targetKey, message }, MAX_ERRORS);
      }
      continue;
    }

    uploadedCount += 1;
    uploadedBytes += bytes.length;
    mediaMappings.push(mapping);
    if (sampleUploadedPaths.length < MAX_SAMPLE_PATHS) {
      sampleUploadedPaths.push(`${bucket}/${targetKey}`);
    }
  }

  return {
    uploadedCount,
    skippedExistingCount,
    failedCount,
    wouldUploadCount,
    sampleUploadedPaths,
    conflicts,
    issues,
    mediaMappings,
  };
};

const restoreDataTables = async (params: {
  serviceSupabase: ReturnType<typeof createClient>;
  backupTables: Record<string, JsonObject[]>;
  metadata: JsonObject;
  oldUserId: string | null;
  newUserId: string;
  mediaMappings: MediaKeyMapping[];
  tableExistsCache: Map<string, boolean>;
  dryRun: boolean;
}): Promise<{
  insertedCount: number;
  skippedExistingCount: number;
  skippedMissingParentCount: number;
  skippedLockedCount: number;
  failedCount: number;
  wouldInsertCount: number;
  tableSummaries: JsonObject[];
  issues: RestoreIssue[];
}> => {
  const {
    serviceSupabase,
    backupTables,
    metadata,
    oldUserId,
    newUserId,
    mediaMappings,
    tableExistsCache,
    dryRun,
  } = params;

  const issues: RestoreIssue[] = [];
  const tableSummaries: JsonObject[] = [];
  const globalIdMappings = new Map<string, string>();
  const invoiceNumberSeed = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(2, 14) || `${Date.now()}`;
  let invoiceNumberCounter = 1;
  const salesChannelIds = new Set<string>();
  const salesChannelNameToId = new Map<string, string>();
  const salesChannelIdRemap = new Map<string, string>();
  const platformFeeRuleIds = new Set<string>();
  const platformFeeRuleNameToId = new Map<string, string>();
  const platformFeeRuleIdRemap = new Map<string, string>();
  const invoiceUserById = new Map<string, string>();
  const invoiceStatusById = new Map<string, string>();
  const invoiceIdsForUser = new Set<string>();
  const invoiceItemIdsForUser = new Set<string>();
  const shipmentIdsForUser = new Set<string>();
  let insertedCount = 0;
  let skippedExistingCount = 0;
  let skippedMissingParentCount = 0;
  let skippedLockedCount = 0;
  let failedCount = 0;
  let wouldInsertCount = 0;

  const salesChannelsTable = await findFirstExistingTable(serviceSupabase, ["sales_channels"], tableExistsCache);
  const platformFeeRulesTable = await findFirstExistingTable(serviceSupabase, ["platform_fee_rules"], tableExistsCache);
  const invoicesTable = await findFirstExistingTable(serviceSupabase, ["invoices"], tableExistsCache);
  const shipmentInvoicesTable = await findFirstExistingTable(serviceSupabase, ["shipment_invoices"], tableExistsCache);
  const invoiceItemsTable = await findFirstExistingTable(serviceSupabase, ["invoice_items"], tableExistsCache);
  const invoiceAdjustmentsTable = await findFirstExistingTable(serviceSupabase, ["invoice_adjustments", "invoice_refunds"], tableExistsCache);
  const invoiceItemReturnsTable = await findFirstExistingTable(serviceSupabase, ["invoice_item_returns"], tableExistsCache);
  const shipmentsTable = await findFirstExistingTable(serviceSupabase, ["shipments"], tableExistsCache);
  const customersTable = await findFirstExistingTable(serviceSupabase, ["clients", "customers"], tableExistsCache);
  const clientPhonesTable = await findFirstExistingTable(serviceSupabase, ["client_phones"], tableExistsCache);
  const clientAddressesTable = await findFirstExistingTable(serviceSupabase, ["client_addresses"], tableExistsCache);
  const existingCustomerIdByEmail = new Map<string, string>();
  const existingCustomerIds = new Set<string>();
  const existingClientPhoneKeys = new Set<string>();
  const existingClientAddressKeys = new Set<string>();

  const refreshSalesChannels = async (): Promise<void> => {
    salesChannelIds.clear();
    salesChannelNameToId.clear();
    if (!salesChannelsTable) return;

    const { data, error } = await serviceSupabase
      .from(salesChannelsTable)
      .select("id, name")
      .eq("user_id", newUserId)
      .limit(5000);

    if (error) {
      if (isTableMissingError(error) || isMissingColumnError(error)) return;
      throw new Error(error.message || "Gagal baca sales_channels semasa restore.");
    }

    (Array.isArray(data) ? data : []).forEach((row) => {
      const record = row as Record<string, unknown>;
      const channelId = toString(record.id);
      const nameKey = normalizeNameKey(record.name);
      if (channelId) salesChannelIds.add(channelId);
      if (channelId && nameKey) salesChannelNameToId.set(nameKey, channelId);
    });
  };

  const refreshPlatformFeeRules = async (): Promise<void> => {
    platformFeeRuleIds.clear();
    platformFeeRuleNameToId.clear();
    if (!platformFeeRulesTable) return;

    const { data, error } = await serviceSupabase
      .from(platformFeeRulesTable)
      .select("id, name")
      .eq("user_id", newUserId)
      .limit(5000);

    if (error) {
      if (isTableMissingError(error) || isMissingColumnError(error)) return;
      throw new Error(error.message || "Gagal baca platform_fee_rules semasa restore.");
    }

    (Array.isArray(data) ? data : []).forEach((row) => {
      const record = row as Record<string, unknown>;
      const ruleId = toString(record.id);
      const nameKey = normalizeNameKey(record.name);
      if (ruleId) platformFeeRuleIds.add(ruleId);
      if (ruleId && nameKey) platformFeeRuleNameToId.set(nameKey, ruleId);
    });
  };

  await refreshSalesChannels();
  await refreshPlatformFeeRules();

  const refreshExistingCustomersByEmail = async (): Promise<void> => {
    existingCustomerIdByEmail.clear();
    existingCustomerIds.clear();
    if (!customersTable) return;

    const { data, error } = await serviceSupabase
      .from(customersTable)
      .select("id, email")
      .eq("user_id", newUserId)
      .limit(50000);

    if (error) {
      if (isTableMissingError(error) || isMissingColumnError(error)) return;
      throw new Error(error.message || "Gagal baca clients/customers semasa restore.");
    }

    (Array.isArray(data) ? data : []).forEach((row) => {
      const id = toString((row as Record<string, unknown>).id);
      const emailKey = normalizeEmailKey((row as Record<string, unknown>).email);
      if (id) existingCustomerIds.add(id);
      if (!id || !emailKey) return;
      if (!existingCustomerIdByEmail.has(emailKey)) {
        existingCustomerIdByEmail.set(emailKey, id);
      }
    });
  };

  const refreshExistingClientContactKeys = async (): Promise<void> => {
    existingClientPhoneKeys.clear();
    existingClientAddressKeys.clear();
    if (!customersTable) return;

    const customerIds = await fetchIdsByUser(serviceSupabase, customersTable, newUserId);
    if (customerIds.length === 0) return;

    if (clientPhonesTable) {
      for (const chunk of chunkValues(customerIds, MAX_DB_BATCH)) {
        const { data, error } = await serviceSupabase
          .from(clientPhonesTable)
          .select("*")
          .in("client_id", chunk)
          .limit(50000);

        if (error) {
          if (isTableMissingError(error) || isMissingColumnError(error)) break;
          throw new Error(error.message || "Gagal baca client_phones semasa restore.");
        }

        (Array.isArray(data) ? data : []).forEach((entry) => {
          const key = buildClientPhoneDedupeKey(entry as JsonObject);
          if (key) existingClientPhoneKeys.add(key);
        });
      }
    }

    if (clientAddressesTable) {
      for (const chunk of chunkValues(customerIds, MAX_DB_BATCH)) {
        const { data, error } = await serviceSupabase
          .from(clientAddressesTable)
          .select("*")
          .in("client_id", chunk)
          .limit(50000);

        if (error) {
          if (isTableMissingError(error) || isMissingColumnError(error)) break;
          throw new Error(error.message || "Gagal baca client_addresses semasa restore.");
        }

        (Array.isArray(data) ? data : []).forEach((entry) => {
          const key = buildClientAddressDedupeKey(entry as JsonObject);
          if (key) existingClientAddressKeys.add(key);
        });
      }
    }
  };

  await refreshExistingCustomersByEmail();
  await refreshExistingClientContactKeys();

  const refreshInvoiceIdsForUser = async (): Promise<void> => {
    invoiceIdsForUser.clear();
    invoiceStatusById.clear();
    if (!invoicesTable) return;
    const { data, error } = await serviceSupabase
      .from(invoicesTable)
      .select("id, user_id, status")
      .eq("user_id", newUserId)
      .limit(5000);
    if (error) {
      if (isTableMissingError(error) || isMissingColumnError(error)) return;
      throw new Error(error.message || "Gagal baca invoices semasa restore.");
    }
    (Array.isArray(data) ? data : []).forEach((row) => {
      const invoiceId = toString((row as Record<string, unknown>).id);
      const status = toString((row as Record<string, unknown>).status).toLowerCase();
      if (invoiceId) {
        invoiceIdsForUser.add(invoiceId);
        invoiceUserById.set(invoiceId, newUserId);
        invoiceStatusById.set(invoiceId, status);
      }
    });
  };

  const refreshInvoiceItemIdsForUser = async (): Promise<void> => {
    invoiceItemIdsForUser.clear();
    if (!invoiceItemsTable || !invoicesTable) return;
    const { data, error } = await serviceSupabase
      .from(invoiceItemsTable)
      .select("id, invoice_id")
      .limit(10000);
    if (error) {
      if (isTableMissingError(error) || isMissingColumnError(error)) return;
      throw new Error(error.message || "Gagal baca invoice_items semasa restore.");
    }
    (Array.isArray(data) ? data : []).forEach((row) => {
      const record = row as Record<string, unknown>;
      const id = toString(record.id);
      const invoiceId = toString(record.invoice_id);
      if (id && invoiceId && invoiceIdsForUser.has(invoiceId)) {
        invoiceItemIdsForUser.add(id);
      }
    });
  };

  const refreshShipmentIdsForUser = async (): Promise<void> => {
    shipmentIdsForUser.clear();
    if (!shipmentsTable) return;
    const { data, error } = await serviceSupabase
      .from(shipmentsTable)
      .select("id")
      .eq("user_id", newUserId)
      .limit(5000);
    if (error) {
      if (isTableMissingError(error) || isMissingColumnError(error)) return;
      throw new Error(error.message || "Gagal baca shipments semasa restore.");
    }
    (Array.isArray(data) ? data : []).forEach((row) => {
      const shipmentId = toString((row as Record<string, unknown>).id);
      if (shipmentId) shipmentIdsForUser.add(shipmentId);
    });
  };

  await refreshInvoiceIdsForUser();
  await refreshShipmentIdsForUser();
  await refreshInvoiceItemIdsForUser();

  for (const spec of RESTORE_TABLE_SPECS) {
    const rawRows = backupTables[spec.exportKey] || [];
    if (rawRows.length === 0) continue;

    const targetTable = await resolveTargetTable(serviceSupabase, spec, metadata, tableExistsCache);
    if (!targetTable) {
      failedCount += rawRows.length;
      pushIssue(issues, {
        table: spec.exportKey,
        bucket: null,
        key: null,
        message: "Table target tidak dijumpai pada project semasa.",
      }, MAX_ERRORS);
      tableSummaries.push({
        export_key: spec.exportKey,
        target_table: null,
        source_rows: rawRows.length,
        inserted: 0,
        skipped_existing: 0,
        failed: rawRows.length,
      });
      continue;
    }

    registerDisasterIdMappings(spec.exportKey, rawRows, globalIdMappings);

    const remappedRows = rawRows.map((row) => remapRowForRestore(
      spec.exportKey,
      row,
      newUserId,
      oldUserId,
      mediaMappings,
      globalIdMappings,
    ));

    // Hard tenant ownership guard: any row carrying user_id must belong to
    // the target account in disaster restore.
    remappedRows.forEach((row) => {
      if (Object.prototype.hasOwnProperty.call(row, "user_id")) {
        row.user_id = newUserId;
      }
    });

    let rowsToWrite = remappedRows;
    let preSkippedExistingForTable = 0;
    let preSkippedMissingParentForTable = 0;
    let preSkippedLockedForTable = 0;
    const platformFeeStatusRestoreMap = new Map<string, string>();

    const applyClientReferenceFallback = async (): Promise<void> => {
      if (!["client_phones", "client_addresses", "inventory", "invoices"].includes(spec.exportKey)) return;
      const fallbackCustomerId = existingCustomerIds.size === 1 ? Array.from(existingCustomerIds)[0] : "";
      const missingClientIdsToSeed = new Set<string>();

      const filteredRows: JsonObject[] = [];
      rowsToWrite.forEach((row, index) => {
        const currentClientId = toString(row.client_id);
        if (!currentClientId) {
          filteredRows.push(row);
          return;
        }
        if (existingCustomerIds.has(currentClientId)) {
          filteredRows.push(row);
          return;
        }

        const sourceRow = rawRows[index] as Record<string, unknown> | undefined;
        const sourceClientId = toString(sourceRow?.client_id);

        if (fallbackCustomerId) {
          row.client_id = fallbackCustomerId;
          if (isUuid(sourceClientId)) globalIdMappings.set(sourceClientId, fallbackCustomerId);
          filteredRows.push(row);
          return;
        }

        if (isUuid(currentClientId) && customersTable) {
          missingClientIdsToSeed.add(currentClientId);
          if (isUuid(sourceClientId)) globalIdMappings.set(sourceClientId, currentClientId);
          filteredRows.push(row);
          return;
        }

        if (spec.exportKey === "inventory" || spec.exportKey === "invoices") {
          row.client_id = null;
          filteredRows.push(row);
          return;
        }

        preSkippedMissingParentForTable += 1;
        pushIssue(issues, {
          table: targetTable,
          bucket: null,
          key: null,
          message: `Client parent tidak ditemui untuk client_id=${currentClientId}.`,
        }, MAX_ERRORS);
      });

      rowsToWrite = filteredRows;

      if (missingClientIdsToSeed.size === 0 || !customersTable) return;

      const seedRows = Array.from(missingClientIdsToSeed).map((id) => ({
        id,
        user_id: newUserId,
        name: "Pelanggan Restore",
        email: null,
      })) as JsonObject[];

      await writeRowsWithFallback(
        serviceSupabase,
        customersTable,
        seedRows,
        "id",
        issues,
      );

      await refreshExistingCustomersByEmail();
    };

    if (spec.exportKey === "sales_channels") {
      const pendingNameToSourceId = new Map<string, string>();
      const filteredRows: JsonObject[] = [];

      remappedRows.forEach((row) => {
        if (!row.user_id) row.user_id = newUserId;
        const sourceId = toString(row.id);
        const nameKey = normalizeNameKey(row.name);

        if (sourceId && salesChannelIds.has(sourceId)) {
          salesChannelIdRemap.set(sourceId, sourceId);
          preSkippedExistingForTable += 1;
          return;
        }

        const existingByName = nameKey ? salesChannelNameToId.get(nameKey) : "";
        if (sourceId && existingByName) {
          salesChannelIdRemap.set(sourceId, existingByName);
          preSkippedExistingForTable += 1;
          return;
        }

        const pendingByName = nameKey ? pendingNameToSourceId.get(nameKey) : "";
        if (sourceId && pendingByName) {
          salesChannelIdRemap.set(sourceId, pendingByName);
          preSkippedExistingForTable += 1;
          return;
        }

        if (sourceId) salesChannelIdRemap.set(sourceId, sourceId);
        if (sourceId && nameKey) pendingNameToSourceId.set(nameKey, sourceId);
        filteredRows.push(row);
      });

      rowsToWrite = filteredRows;
    }

    if (spec.exportKey === "platform_fee_rules") {
      const pendingNameToSourceId = new Map<string, string>();
      const filteredRows: JsonObject[] = [];

      remappedRows.forEach((row) => {
        if (!row.user_id) row.user_id = newUserId;
        const sourceId = toString(row.id);
        const nameKey = normalizeNameKey(row.name);

        if (sourceId && platformFeeRuleIds.has(sourceId)) {
          platformFeeRuleIdRemap.set(sourceId, sourceId);
          preSkippedExistingForTable += 1;
          return;
        }

        const existingByName = nameKey ? platformFeeRuleNameToId.get(nameKey) : "";
        if (sourceId && existingByName) {
          platformFeeRuleIdRemap.set(sourceId, existingByName);
          preSkippedExistingForTable += 1;
          return;
        }

        const pendingByName = nameKey ? pendingNameToSourceId.get(nameKey) : "";
        if (sourceId && pendingByName) {
          platformFeeRuleIdRemap.set(sourceId, pendingByName);
          preSkippedExistingForTable += 1;
          return;
        }

        if (sourceId) platformFeeRuleIdRemap.set(sourceId, sourceId);
        if (sourceId && nameKey) pendingNameToSourceId.set(nameKey, sourceId);
        filteredRows.push(row);
      });

      rowsToWrite = filteredRows;
    }

    if (spec.exportKey === "customers") {
      const pendingEmailToId = new Map<string, string>();
      const filteredRows: JsonObject[] = [];

      remappedRows.forEach((row, index) => {
        if (!row.user_id) row.user_id = newUserId;

        const sourceRow = rawRows[index] as Record<string, unknown> | undefined;
        const sourceIdCandidates = extractUuidCandidates(sourceRow, ["id", "client_id", "customer_id"]);
        const sourceId = sourceIdCandidates[0] || "";

        if (!toString(row.id) && sourceId) {
          row.id = globalIdMappings.get(sourceId) || sourceId;
        }

        const remappedId = toString(row.id);
        const emailKey = normalizeEmailKey(row.email);

        if (Object.prototype.hasOwnProperty.call(row, "email")) {
          row.email = emailKey || null;
        }

        if (sourceIdCandidates.length > 0 && emailKey) {
          const existingId = existingCustomerIdByEmail.get(emailKey);
          if (existingId) {
            sourceIdCandidates.forEach((sourceClientId) => {
              globalIdMappings.set(sourceClientId, existingId);
            });
            preSkippedExistingForTable += 1;
            return;
          }

          const pendingId = pendingEmailToId.get(emailKey);
          if (pendingId) {
            sourceIdCandidates.forEach((sourceClientId) => {
              globalIdMappings.set(sourceClientId, pendingId);
            });
            preSkippedExistingForTable += 1;
            return;
          }
        }

        if (remappedId) {
          sourceIdCandidates.forEach((sourceClientId) => {
            globalIdMappings.set(sourceClientId, remappedId);
          });
        }
        if (emailKey && remappedId) {
          pendingEmailToId.set(emailKey, remappedId);
          if (!existingCustomerIdByEmail.has(emailKey)) {
            existingCustomerIdByEmail.set(emailKey, remappedId);
          }
        }

        filteredRows.push(row);
      });

      if (filteredRows.length === 0 && existingCustomerIds.size === 0 && remappedRows.length > 0) {
        // Safety net for legacy exports where customer key fields vary.
        const fallbackSource = rawRows[0] as Record<string, unknown> | undefined;
        const fallbackRow = { ...(remappedRows[0] as JsonObject) };
        const fallbackSourceId = extractUuidCandidates(fallbackSource, ["id", "client_id", "customer_id"])[0] || "";
        const fallbackMappedId = isUuid(fallbackSourceId)
          ? (globalIdMappings.get(fallbackSourceId) || crypto.randomUUID())
          : crypto.randomUUID();
        fallbackRow.id = fallbackMappedId;
        fallbackRow.user_id = newUserId;
        if (Object.prototype.hasOwnProperty.call(fallbackRow, "email")) {
          fallbackRow.email = normalizeEmailKey(fallbackRow.email) || null;
        }
        if (isUuid(fallbackSourceId)) globalIdMappings.set(fallbackSourceId, fallbackMappedId);
        filteredRows.push(fallbackRow);
        preSkippedExistingForTable = Math.max(preSkippedExistingForTable - 1, 0);
      }

      rowsToWrite = filteredRows;
    }

    await applyClientReferenceFallback();

    if (spec.exportKey === "client_phones") {
      const pendingPhoneKeys = new Set<string>();
      const filteredRows: JsonObject[] = [];

      rowsToWrite.forEach((row) => {
        const dedupeKey = buildClientPhoneDedupeKey(row);
        if (!dedupeKey) {
          filteredRows.push(row);
          return;
        }

        if (existingClientPhoneKeys.has(dedupeKey) || pendingPhoneKeys.has(dedupeKey)) {
          preSkippedExistingForTable += 1;
          return;
        }

        pendingPhoneKeys.add(dedupeKey);
        existingClientPhoneKeys.add(dedupeKey);
        filteredRows.push(row);
      });

      rowsToWrite = filteredRows;
    }

    if (spec.exportKey === "client_addresses") {
      const pendingAddressKeys = new Set<string>();
      const filteredRows: JsonObject[] = [];

      rowsToWrite.forEach((row) => {
        const dedupeKey = buildClientAddressDedupeKey(row);
        if (!dedupeKey) {
          filteredRows.push(row);
          return;
        }

        if (existingClientAddressKeys.has(dedupeKey) || pendingAddressKeys.has(dedupeKey)) {
          preSkippedExistingForTable += 1;
          return;
        }

        pendingAddressKeys.add(dedupeKey);
        existingClientAddressKeys.add(dedupeKey);
        filteredRows.push(row);
      });

      rowsToWrite = filteredRows;
    }

    // SAFETY: old backups may contain invoice sales_channel_id that no longer exists
    // (or was deduplicated by name). Null invalid values to avoid trigger failures.
    if (spec.exportKey === "invoices") {
      remappedRows.forEach((row) => {
        if (!row.user_id) row.user_id = newUserId;

        // SAFETY: prevent unique conflicts with source account invoice numbers.
        if (Object.prototype.hasOwnProperty.call(row, "invoice_number")) {
          row.invoice_number = `DR-${invoiceNumberSeed}-${String(invoiceNumberCounter).padStart(4, "0")}`;
          invoiceNumberCounter += 1;
        }

        const sourceSalesChannelId = toString(row.sales_channel_id);
        if (sourceSalesChannelId) {
          const remappedSalesChannelId = salesChannelIdRemap.get(sourceSalesChannelId) || sourceSalesChannelId;
          if (salesChannelIds.has(remappedSalesChannelId)) row.sales_channel_id = remappedSalesChannelId;
          else row.sales_channel_id = null;
        }

        const invoiceId = toString(row.id);
        if (invoiceId) {
          invoiceUserById.set(invoiceId, toString(row.user_id) || newUserId);
          invoiceStatusById.set(invoiceId, toString(row.status).toLowerCase());
        }
      });
    }

    if (spec.exportKey === "platform_fees") {
      const invoiceIds = Array.from(new Set(
        remappedRows
          .map((row) => toString(row.invoice_id))
          .filter(Boolean),
      ));

      const unresolvedInvoiceIds = invoiceIds.filter((invoiceId) => !invoiceUserById.has(invoiceId));
      if (invoicesTable && unresolvedInvoiceIds.length > 0) {
        for (const chunk of chunkValues(unresolvedInvoiceIds, MAX_DB_BATCH)) {
          const { data, error } = await serviceSupabase
            .from(invoicesTable)
            .select("id, user_id")
            .in("id", chunk);

          if (error) {
            if (isTableMissingError(error) || isMissingColumnError(error)) break;
            pushIssue(issues, {
              table: invoicesTable,
              bucket: null,
              key: null,
              message: error.message || "Gagal semak pemilikan invois untuk caj platform.",
            }, MAX_ERRORS);
            break;
          }

          (Array.isArray(data) ? data : []).forEach((record) => {
            const invoiceId = toString((record as Record<string, unknown>).id);
            const ownerId = toString((record as Record<string, unknown>).user_id);
            if (invoiceId && ownerId) invoiceUserById.set(invoiceId, ownerId);
          });
        }
      }

      // SAFETY: enforce fee owner + fee_rule linkage to the restored invoice owner.
      const feeRows = remappedRows.map((row) => {
        const invoiceId = toString(row.invoice_id);
        const invoiceOwnerId = invoiceUserById.get(invoiceId) || newUserId;
        row.user_id = invoiceOwnerId;
        const invoiceStatus = (invoiceStatusById.get(invoiceId) || "").toLowerCase();
        const isLocked = LOCKED_INVOICE_STATUSES.has(invoiceStatus);

        return {
          row,
          invoiceId,
          invoiceStatus,
          isLocked,
        };
      });

      const lockedOriginalStatusByInvoiceId = new Map<string, string>();
      feeRows.forEach((entry) => {
        if (!entry.isLocked || !entry.invoiceId) return;
        if (!lockedOriginalStatusByInvoiceId.has(entry.invoiceId)) {
          lockedOriginalStatusByInvoiceId.set(entry.invoiceId, entry.invoiceStatus);
        }
      });

      const lockedInvoiceIds = Array.from(lockedOriginalStatusByInvoiceId.keys());
      const unlockedInvoiceIds = new Set<string>();
      let unlockFailed = false;

      if (!dryRun && invoicesTable && lockedInvoiceIds.length > 0) {
        for (const chunk of chunkValues(lockedInvoiceIds, MAX_DB_BATCH)) {
          const { error } = await serviceSupabase
            .from(invoicesTable)
            .update({ status: "finalized" })
            .eq("user_id", newUserId)
            .in("id", chunk);

          if (error) {
            unlockFailed = true;
            pushIssue(issues, {
              table: invoicesTable,
              bucket: null,
              key: null,
              message: error.message || "Gagal buka lock invois untuk restore platform fees.",
            }, MAX_ERRORS);
            break;
          }

          chunk.forEach((invoiceId) => {
            unlockedInvoiceIds.add(invoiceId);
            invoiceStatusById.set(invoiceId, "finalized");
          });
        }

        if (unlockFailed && unlockedInvoiceIds.size > 0) {
          for (const invoiceId of Array.from(unlockedInvoiceIds)) {
            const originalStatus = lockedOriginalStatusByInvoiceId.get(invoiceId) || "draft";
            const { error } = await serviceSupabase
              .from(invoicesTable)
              .update({ status: originalStatus })
              .eq("user_id", newUserId)
              .eq("id", invoiceId);
            if (!error) {
              invoiceStatusById.set(invoiceId, originalStatus);
            }
          }
          unlockedInvoiceIds.clear();
        }
      }

      const filteredRows: JsonObject[] = [];
      feeRows.forEach(({ row, invoiceId }) => {
        const invoiceStatus = (invoiceStatusById.get(invoiceId) || "").toLowerCase();
        if (LOCKED_INVOICE_STATUSES.has(invoiceStatus)) {
          preSkippedLockedForTable += 1;
          return;
        }

        const sourceRuleId = toString(row.fee_rule_id);
        if (sourceRuleId) {
          const remappedRuleId = platformFeeRuleIdRemap.get(sourceRuleId) || sourceRuleId;
          if (platformFeeRuleIds.has(remappedRuleId)) row.fee_rule_id = remappedRuleId;
          else row.fee_rule_id = null;
        }

        filteredRows.push(row);
      });

      if (!dryRun) {
        unlockedInvoiceIds.forEach((invoiceId) => {
          const originalStatus = lockedOriginalStatusByInvoiceId.get(invoiceId);
          if (!originalStatus) return;
          platformFeeStatusRestoreMap.set(invoiceId, originalStatus);
        });
      }
      rowsToWrite = filteredRows;
    }

    if (["shipment_invoices", "invoice_items", "invoice_adjustments", "platform_fees", "invoice_item_returns"].includes(spec.exportKey)) {
      const filteredRows: JsonObject[] = [];

      rowsToWrite.forEach((row) => {
        const invoiceId = toString(row.invoice_id);
        if (!invoiceId) {
          preSkippedMissingParentForTable += 1;
          pushIssue(issues, {
            table: targetTable,
            bucket: null,
            key: null,
            message: "Invoice parent tidak ditemui kerana invoice_id kosong/tidak sah.",
          }, MAX_ERRORS);
          return;
        }

        if (!invoiceIdsForUser.has(invoiceId)) {
          preSkippedMissingParentForTable += 1;
          pushIssue(issues, {
            table: targetTable,
            bucket: null,
            key: null,
            message: `Invoice parent tidak ditemui untuk invoice_id=${invoiceId}.`,
          }, MAX_ERRORS);
          return;
        }

        if (spec.exportKey === "shipment_invoices") {
          const shipmentId = toString(row.shipment_id);
          if (shipmentId && !shipmentIdsForUser.has(shipmentId)) {
            preSkippedMissingParentForTable += 1;
            pushIssue(issues, {
              table: targetTable,
              bucket: null,
              key: null,
              message: `Shipment parent tidak ditemui untuk shipment_id=${shipmentId}.`,
            }, MAX_ERRORS);
            return;
          }
        }

        if (spec.exportKey === "invoice_item_returns") {
          const invoiceItemId = toString(row.invoice_item_id);
          if (invoiceItemId && !invoiceItemIdsForUser.has(invoiceItemId)) {
            preSkippedMissingParentForTable += 1;
            pushIssue(issues, {
              table: targetTable,
              bucket: null,
              key: null,
              message: `Invoice item parent tidak ditemui untuk invoice_item_id=${invoiceItemId}.`,
            }, MAX_ERRORS);
            return;
          }
        }

        filteredRows.push(row);
      });

      rowsToWrite = filteredRows;
    }

    if (dryRun) {
      wouldInsertCount += rowsToWrite.length;
      if (spec.exportKey === "customers") {
        rowsToWrite.forEach((row) => {
          const customerId = toString(row.id);
          const emailKey = normalizeEmailKey(row.email);
          if (customerId) existingCustomerIds.add(customerId);
          if (customerId && emailKey && !existingCustomerIdByEmail.has(emailKey)) {
            existingCustomerIdByEmail.set(emailKey, customerId);
          }
        });
      }
      if (spec.exportKey === "sales_channels") {
        rowsToWrite.forEach((row) => {
          const sourceId = toString(row.id);
          const nameKey = normalizeNameKey(row.name);
          if (sourceId) {
            salesChannelIds.add(sourceId);
            salesChannelIdRemap.set(sourceId, sourceId);
          }
          if (sourceId && nameKey) salesChannelNameToId.set(nameKey, sourceId);
        });
      }
      if (spec.exportKey === "platform_fee_rules") {
        rowsToWrite.forEach((row) => {
          const sourceId = toString(row.id);
          const nameKey = normalizeNameKey(row.name);
          if (sourceId) {
            platformFeeRuleIds.add(sourceId);
            platformFeeRuleIdRemap.set(sourceId, sourceId);
          }
          if (sourceId && nameKey) platformFeeRuleNameToId.set(nameKey, sourceId);
        });
      }
      tableSummaries.push({
        export_key: spec.exportKey,
        target_table: targetTable,
        source_rows: remappedRows.length,
        would_insert: rowsToWrite.length,
        would_skip_existing: preSkippedExistingForTable,
        would_skip_missing_parent: preSkippedMissingParentForTable,
        would_skip_locked: preSkippedLockedForTable,
      });
      continue;
    }

    let writeResult: WriteRowsResult = { insertedCount: 0, skippedExistingCount: 0, failedCount: 0 };
    try {
      writeResult = rowsToWrite.length > 0
        ? await writeRowsWithFallback(
          serviceSupabase,
          targetTable,
          rowsToWrite,
          spec.onConflict,
          issues,
        )
        : { insertedCount: 0, skippedExistingCount: 0, failedCount: 0 };
    } finally {
      if (!dryRun && spec.exportKey === "platform_fees" && invoicesTable && platformFeeStatusRestoreMap.size > 0) {
        for (const [invoiceId, originalStatus] of platformFeeStatusRestoreMap.entries()) {
          const { error } = await serviceSupabase
            .from(invoicesTable)
            .update({ status: originalStatus })
            .eq("user_id", newUserId)
            .eq("id", invoiceId);

          if (error) {
            pushIssue(issues, {
              table: invoicesTable,
              bucket: null,
              key: null,
              message: `Gagal pulihkan status invois ${invoiceId} selepas restore platform fees.`,
            }, MAX_ERRORS);
            continue;
          }

          invoiceStatusById.set(invoiceId, originalStatus);
        }
      }
    }

    if (spec.exportKey === "sales_channels") {
      await refreshSalesChannels();
      remappedRows.forEach((row) => {
        const sourceId = toString(row.id);
        const nameKey = normalizeNameKey(row.name);
        if (!sourceId) return;
        if (salesChannelIds.has(sourceId)) {
          salesChannelIdRemap.set(sourceId, sourceId);
          return;
        }
        const mappedByName = nameKey ? salesChannelNameToId.get(nameKey) : "";
        if (mappedByName) salesChannelIdRemap.set(sourceId, mappedByName);
      });
    }

    if (spec.exportKey === "platform_fee_rules") {
      await refreshPlatformFeeRules();
      remappedRows.forEach((row) => {
        const sourceId = toString(row.id);
        const nameKey = normalizeNameKey(row.name);
        if (!sourceId) return;
        if (platformFeeRuleIds.has(sourceId)) {
          platformFeeRuleIdRemap.set(sourceId, sourceId);
          return;
        }
        const mappedByName = nameKey ? platformFeeRuleNameToId.get(nameKey) : "";
        if (mappedByName) platformFeeRuleIdRemap.set(sourceId, mappedByName);
      });
    }

    if (spec.exportKey === "customers") {
      await refreshExistingCustomersByEmail();
      await refreshExistingClientContactKeys();
    }

    if (spec.exportKey === "invoices" || spec.exportKey === "shipment_invoices" || spec.exportKey === "invoice_items" || spec.exportKey === "invoice_item_returns") {
      await refreshInvoiceIdsForUser();
      await refreshShipmentIdsForUser();
      await refreshInvoiceItemIdsForUser();
    }

    insertedCount += writeResult.insertedCount;
    skippedExistingCount += writeResult.skippedExistingCount + preSkippedExistingForTable;
    skippedMissingParentCount += preSkippedMissingParentForTable;
    skippedLockedCount += preSkippedLockedForTable;
    failedCount += writeResult.failedCount;

    tableSummaries.push({
      export_key: spec.exportKey,
      target_table: targetTable,
      source_rows: remappedRows.length,
      inserted: writeResult.insertedCount,
      skipped_existing: writeResult.skippedExistingCount + preSkippedExistingForTable,
      skipped_missing_parent: preSkippedMissingParentForTable,
      skipped_locked: preSkippedLockedForTable,
      failed: writeResult.failedCount,
    });
  }

  return {
    insertedCount,
    skippedExistingCount,
    skippedMissingParentCount,
    skippedLockedCount,
    failedCount,
    wouldInsertCount,
    tableSummaries,
    issues,
  };
};

const buildReconciliationReport = (params: {
  backupTables: Record<string, JsonObject[]>;
  tableSummaries: JsonObject[];
  mediaSourceCount: number;
  mediaUploadedCount: number;
  mediaSkippedExistingCount: number;
  mediaFailedCount: number;
}): JsonObject => {
  const tableSummaryByExportKey = new Map<string, Record<string, unknown>>();
  params.tableSummaries.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const record = entry as Record<string, unknown>;
    const exportKey = toString(record.export_key);
    if (!exportKey) return;
    tableSummaryByExportKey.set(exportKey, record);
  });

  const dbByTable: JsonObject[] = [];
  const dbMismatchTables: JsonObject[] = [];
  let dbSourceRowsTotal = 0;
  let dbAccountedRowsTotal = 0;

  RESTORE_TABLE_SPECS.forEach((spec) => {
    const sourceRows = (params.backupTables[spec.exportKey] || []).length;
    const summary = tableSummaryByExportKey.get(spec.exportKey);

    const inserted = toMetricCount(summary?.inserted ?? summary?.would_insert);
    const skippedExisting = toMetricCount(summary?.skipped_existing ?? summary?.would_skip_existing);
    const skippedMissingParent = toMetricCount(summary?.skipped_missing_parent ?? summary?.would_skip_missing_parent);
    const skippedLocked = toMetricCount(summary?.skipped_locked ?? summary?.would_skip_locked);
    const failed = toMetricCount(summary?.failed);

    const accountedRows = inserted + skippedExisting + skippedMissingParent + skippedLocked + failed;
    const unaccountedRows = Math.max(sourceRows - accountedRows, 0);

    dbSourceRowsTotal += sourceRows;
    dbAccountedRowsTotal += accountedRows;

    const tableSummary: JsonObject = {
      export_key: spec.exportKey,
      source_rows: sourceRows,
      accounted_rows: accountedRows,
      unaccounted_rows: unaccountedRows,
      inserted,
      skipped_existing: skippedExisting,
      skipped_missing_parent: skippedMissingParent,
      skipped_locked: skippedLocked,
      failed,
    };
    dbByTable.push(tableSummary);

    if (unaccountedRows > 0) {
      dbMismatchTables.push({
        export_key: spec.exportKey,
        source_rows: sourceRows,
        accounted_rows: accountedRows,
        unaccounted_rows: unaccountedRows,
      });
    }
  });

  const dbUnaccountedRowsTotal = Math.max(dbSourceRowsTotal - dbAccountedRowsTotal, 0);

  const mediaSourceFilesTotal = toMetricCount(params.mediaSourceCount);
  const mediaUploadedCount = toMetricCount(params.mediaUploadedCount);
  const mediaSkippedExistingCount = toMetricCount(params.mediaSkippedExistingCount);
  const mediaFailedCount = toMetricCount(params.mediaFailedCount);
  const mediaAccountedFilesTotal = mediaUploadedCount + mediaSkippedExistingCount + mediaFailedCount;
  const mediaUnaccountedFilesTotal = Math.max(mediaSourceFilesTotal - mediaAccountedFilesTotal, 0);

  return {
    db: {
      source_rows_total: dbSourceRowsTotal,
      accounted_rows_total: dbAccountedRowsTotal,
      unaccounted_rows_total: dbUnaccountedRowsTotal,
      mismatch_table_count: dbMismatchTables.length,
      mismatch_tables: dbMismatchTables.slice(0, MAX_ERRORS),
      by_table: dbByTable,
    },
    media: {
      source_files_total: mediaSourceFilesTotal,
      accounted_files_total: mediaAccountedFilesTotal,
      unaccounted_files_total: mediaUnaccountedFilesTotal,
      uploaded_count: mediaUploadedCount,
      skipped_existing_count: mediaSkippedExistingCount,
      failed_count: mediaFailedCount,
    },
  };
};

// SAFETY-5:
// - restore_mode=self|disaster
// - disaster mode supports cross-account restore with user_id/media remap
// - no storage overwrite (upsert=false), optional force_wipe for non-empty account
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  const requestStartedAtMs = Date.now();
  const requestStartedAtIso = new Date(requestStartedAtMs).toISOString();
  let currentPhase = "request_start";
  let currentPhaseStartMs = requestStartedAtMs;
  const phaseDurationsMs: Record<string, number> = {};
  const trackPhase = (nextPhase: string): void => {
    const now = Date.now();
    phaseDurationsMs[currentPhase] = (phaseDurationsMs[currentPhase] || 0) + Math.max(0, now - currentPhaseStartMs);
    currentPhase = nextPhase;
    currentPhaseStartMs = now;
  };
  const getPhaseDurationsSnapshot = (): Record<string, number> => {
    const now = Date.now();
    return {
      ...phaseDurationsMs,
      [currentPhase]: (phaseDurationsMs[currentPhase] || 0) + Math.max(0, now - currentPhaseStartMs),
    };
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization");

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return jsonResponse({ error: "Missing Supabase environment variables." }, 500);
    }

    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const { data: userData, error: userError } = await userSupabase.auth.getUser();
    const userId = userData?.user?.id;
    if (userError || !userId) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    trackPhase("payload_read");
    const payload = await readZipPayload(req);
    if ("error" in payload) {
      return jsonResponse({ error: payload.error }, payload.status);
    }

    if (!payload.bytes.length) {
      return jsonResponse({ error: "Fail ZIP kosong." }, 400);
    }

    const restoreMode = resolveRestoreMode(payload.restoreModeRaw, payload.modeRaw);
    let explicitIdempotencyKey = "";
    try {
      explicitIdempotencyKey = normalizeIdempotencyKey(
        req.headers.get("idempotency-key")
          || req.headers.get("x-idempotency-key")
          || payload.idempotencyKeyRaw,
      );
    } catch (error) {
      if (error instanceof RestoreValidationError) {
        return jsonResponse({ error: error.message }, error.status);
      }
      throw error;
    }

    const serviceSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    const tableExistsCache = new Map<string, boolean>();
    const columnExistsCache = new Map<string, boolean>();
    trackPhase("lock_acquire");
    const lockState = await tryAcquireRestoreLock(serviceSupabase, userId, restoreMode);
    if (!lockState.acquired) {
      return jsonResponse({
        error: "Restore sedang berjalan untuk akaun ini. Sila tunggu sehingga proses semasa selesai.",
        restore_mode: restoreMode,
      }, 409);
    }

    try {
      let zip: JSZip;
      try {
        trackPhase("zip_load_validate");
        zip = await JSZip.loadAsync(payload.bytes, { checkCRC32: true });
        validateZipStructure(zip);
      } catch (error) {
        if (error instanceof RestoreValidationError) {
          return jsonResponse({ error: error.message }, error.status);
        }
        return jsonResponse({
          error: "Fail ZIP rosak atau tidak sah.",
          details: error instanceof Error ? error.message : String(error),
        }, 400);
      }

      const metadataEntry = findSingleZipEntry(zip, /^metadata\.json$/i, "metadata.json");
      if (!metadataEntry) {
        return jsonResponse({ error: "metadata.json tidak dijumpai dalam backup ZIP." }, 400);
      }

      let metadata: JsonObject;
      try {
        trackPhase("metadata_validate");
        const rawMetadata = JSON.parse(await metadataEntry.async("string"));
        metadata = validateMetadataStructure(rawMetadata);
      } catch (error) {
        if (error instanceof RestoreValidationError) {
          return jsonResponse({ error: error.message }, error.status);
        }
        return jsonResponse({ error: "metadata.json tidak sah." }, 400);
      }

      const checksum = toString(metadata.checksum);
      if (!checksum) {
        return jsonResponse({ error: "Checksum backup tiada dalam metadata." }, 400);
      }

      const effectiveIdempotencyKey = explicitIdempotencyKey || buildAutoIdempotencyKey({
        checksum,
        restoreMode,
        dryRun: payload.dryRun,
        forceWipe: payload.forceWipe,
      });

      if (restoreMode === "self") {
        trackPhase("self_mode_snapshot_match");
        const { data: matchedSnapshots, error: snapshotMatchError } = await serviceSupabase
          .from("business_snapshots")
          .select("id")
          .eq("user_id", userId)
          .eq("checksum", checksum)
          .limit(1);

        if (snapshotMatchError) {
          return jsonResponse({
            error: "Gagal sahkan pemilikan backup.",
            details: snapshotMatchError.message,
          }, 500);
        }

        if (!Array.isArray(matchedSnapshots) || matchedSnapshots.length === 0) {
          return jsonResponse({
            error: "Backup ini tidak sepadan dengan rekod snapshot user semasa.",
          }, 403);
        }
      }

      trackPhase("idempotency_replay_check");
      const replayEvent = await findRecentIdempotentRestoreEvent(
        serviceSupabase,
        tableExistsCache,
        columnExistsCache,
        {
          userId,
          idempotencyKey: effectiveIdempotencyKey,
          checksum,
          restoreMode,
          dryRun: payload.dryRun,
          forceWipe: payload.forceWipe,
        },
      );
      if (replayEvent) {
        trackPhase("response_build");
        const requestFinishedAtIso = new Date().toISOString();
        const durationTotalMs = Math.max(0, Date.now() - requestStartedAtMs);
        const phaseDurationsSnapshot = getPhaseDurationsSnapshot();
        const replaySummary = replayEvent.summary;
        return jsonResponse({
          ok: true,
          replayed: true,
          message: "Permintaan restore yang sama telah diproses baru-baru ini.",
          restore_mode: restoreMode,
          dry_run: payload.dryRun,
          force_wipe: payload.forceWipe,
          source_backup_checksum: checksum,
          old_user_id: null,
          new_user_id: userId,
          idempotency: {
            key: effectiveIdempotencyKey,
            replayed: true,
            replay_window_seconds: IDEMPOTENCY_REPLAY_WINDOW_SECONDS,
            source_event_id: toString(replayEvent.id) || null,
            source_event_created_at: toString(replayEvent.created_at) || null,
          },
          lock: {
            enabled: lockState.enabled,
            request_id: lockState.requestId,
          },
          media: {
            uploaded_count: getSummaryCount(replaySummary, "media_uploaded_count"),
            skipped_existing_count: getSummaryCount(replaySummary, "media_skipped_existing_count"),
            failed_count: getSummaryCount(replaySummary, "media_failed_count"),
            would_upload_count: 0,
            sample_uploaded_paths: [],
            conflicts: [],
            errors: [],
          },
          data: {
            enabled: restoreMode === "disaster",
            inserted_count: getSummaryCount(replaySummary, "data_inserted_count"),
            skipped_existing_count: getSummaryCount(replaySummary, "data_skipped_existing_count"),
            skipped_missing_parent_count: getSummaryCount(replaySummary, "data_skipped_missing_parent_count"),
            skipped_locked_count: getSummaryCount(replaySummary, "data_skipped_locked_count"),
            failed_count: getSummaryCount(replaySummary, "data_failed_count"),
            would_insert_count: 0,
            table_summaries: [],
            errors: [],
          },
          reconciliation: {
            db: {
              source_rows_total: getSummaryCount(replaySummary, "reconciliation_db_source_rows_total"),
              accounted_rows_total: getSummaryCount(replaySummary, "reconciliation_db_accounted_rows_total"),
              unaccounted_rows_total: getSummaryCount(replaySummary, "reconciliation_db_unaccounted_rows_total"),
              mismatch_table_count: getSummaryCount(replaySummary, "reconciliation_db_mismatch_table_count"),
              mismatch_tables: [],
              by_table: [],
            },
            media: {
              source_files_total: getSummaryCount(replaySummary, "reconciliation_media_source_files_total"),
              accounted_files_total: getSummaryCount(replaySummary, "reconciliation_media_accounted_files_total"),
              unaccounted_files_total: getSummaryCount(replaySummary, "reconciliation_media_unaccounted_files_total"),
              uploaded_count: getSummaryCount(replaySummary, "media_uploaded_count"),
              skipped_existing_count: getSummaryCount(replaySummary, "media_skipped_existing_count"),
              failed_count: getSummaryCount(replaySummary, "media_failed_count"),
            },
          },
          observability: {
            phase: "replayed",
            request_started_at: requestStartedAtIso,
            request_finished_at: requestFinishedAtIso,
            duration_total_ms: durationTotalMs,
            phase_durations_ms: phaseDurationsSnapshot,
          },
          manifest_file_count: 0,
          backup_file_name: payload.fileName,
        });
      }

      const mediaManifestEntry = findSingleZipEntry(zip, /^media_manifest\.json$/i, "media_manifest.json");
      if (!mediaManifestEntry) {
        return jsonResponse({ error: "media_manifest.json tidak dijumpai. Backup ini tiada media restore plan." }, 400);
      }

      let mediaFiles: NormalizedMediaFile[] = [];
      try {
        trackPhase("manifest_validate");
        const mediaManifest = JSON.parse(await mediaManifestEntry.async("string"));
        mediaFiles = validateAndNormalizeMediaManifest(mediaManifest);
      } catch (error) {
        if (error instanceof RestoreValidationError) {
          return jsonResponse({ error: error.message }, error.status);
        }
        return jsonResponse({ error: "media_manifest.json tidak sah." }, 400);
      }

      let backupTables: Record<string, JsonObject[]> = {};
      let totalBackupRows = 0;
      try {
        trackPhase("tables_load_validate");
        const parsedTables = await loadAndValidateBackupTables(zip, metadata);
        backupTables = parsedTables.backupTables;
        totalBackupRows = parsedTables.totalRows;
      } catch (error) {
        if (error instanceof RestoreValidationError) {
          return jsonResponse({ error: error.message }, error.status);
        }
        throw error;
      }

      if (restoreMode === "disaster" && totalBackupRows > MAX_TOTAL_DB_WRITES) {
        return jsonResponse({
          error: `Jumlah row restore melebihi had ${MAX_TOTAL_DB_WRITES}.`,
        }, 413);
      }

      try {
        trackPhase("manifest_coverage_validate");
        const mediaZipEntries = collectMediaZipEntries(zip);
        validateMediaManifestCoverage(mediaFiles, mediaZipEntries);
      } catch (error) {
        if (error instanceof RestoreValidationError) {
          return jsonResponse({ error: error.message }, error.status);
        }
        throw error;
      }

      const oldUserId = inferOldUserId(backupTables, mediaFiles);

      const itemsTable = await findFirstExistingTable(serviceSupabase, ["items", "inventory"], tableExistsCache);
      const walletsTable = await findFirstExistingTable(serviceSupabase, ["wallets"], tableExistsCache);
      const invoicesTable = await findFirstExistingTable(serviceSupabase, ["invoices"], tableExistsCache);

      trackPhase("account_state_check");
      const itemsCount = await countRowsByUser(serviceSupabase, itemsTable, userId);
      const invoicesCount = await countRowsByUser(serviceSupabase, invoicesTable, userId);
      const walletsCount = await countRowsByUser(serviceSupabase, walletsTable, userId);
      const isAccountEmptyForDisaster = itemsCount === 0 && invoicesCount === 0 && walletsCount <= 1;

      if (restoreMode === "disaster" && !isAccountEmptyForDisaster && !payload.forceWipe) {
        return jsonResponse({
          error: "Akaun semasa tidak kosong. Gunakan force_wipe=true untuk disaster restore.",
          restore_mode: restoreMode,
          account_state: {
            items_count: itemsCount,
            invoices_count: invoicesCount,
            wallets_count: walletsCount,
          },
        }, 409);
      }

      if (restoreMode === "disaster" && !payload.dryRun) {
        trackPhase("force_wipe");
        await wipeExistingBusinessData(serviceSupabase, userId, tableExistsCache);
      }

      trackPhase("media_restore");
      const mediaResult = await restoreMedia({
        serviceSupabase,
        zip,
        mediaFiles,
        restoreMode,
        oldUserId,
        newUserId: userId,
        supabaseUrl,
        dryRun: payload.dryRun,
      });

      let dataRestoreResult = {
        insertedCount: 0,
        skippedExistingCount: 0,
        skippedMissingParentCount: 0,
        skippedLockedCount: 0,
        failedCount: 0,
        wouldInsertCount: 0,
        tableSummaries: [] as JsonObject[],
        issues: [] as RestoreIssue[],
      };

      // SAFETY-5 scope: data restore only for disaster mode.
      if (restoreMode === "disaster") {
        trackPhase("data_restore");
        dataRestoreResult = await restoreDataTables({
          serviceSupabase,
          backupTables,
          metadata,
          oldUserId,
          newUserId: userId,
          mediaMappings: mediaResult.mediaMappings,
          tableExistsCache,
          dryRun: payload.dryRun,
        });

        if (!payload.dryRun) {
          await syncClientsFromCustomersIfNeeded(
            serviceSupabase,
            userId,
            tableExistsCache,
            dataRestoreResult.issues,
          );
          await syncClientsFromInvoiceRefsIfNeeded(
            serviceSupabase,
            userId,
            tableExistsCache,
            dataRestoreResult.issues,
          );
        }
      }

      trackPhase("reconciliation_build");
      const reconciliation = buildReconciliationReport({
        backupTables,
        tableSummaries: dataRestoreResult.tableSummaries,
        mediaSourceCount: mediaFiles.length,
        mediaUploadedCount: mediaResult.uploadedCount,
        mediaSkippedExistingCount: mediaResult.skippedExistingCount,
        mediaFailedCount: mediaResult.failedCount,
      });

      trackPhase("restore_event_log");
      const requestObservedAtIso = new Date().toISOString();
      const durationObservedMs = Math.max(0, Date.now() - requestStartedAtMs);
      await logRestoreEvent(serviceSupabase, tableExistsCache, columnExistsCache, {
        checksum,
        idempotencyKey: effectiveIdempotencyKey,
        oldUserId,
        newUserId: userId,
        restoreMode,
        forceWipe: payload.forceWipe,
        dryRun: payload.dryRun,
        summary: {
          lock_enabled: lockState.enabled,
          lock_request_id: lockState.requestId,
          idempotency_key: effectiveIdempotencyKey,
          media_uploaded_count: mediaResult.uploadedCount,
          media_skipped_existing_count: mediaResult.skippedExistingCount,
          media_failed_count: mediaResult.failedCount,
          data_inserted_count: dataRestoreResult.insertedCount,
          data_skipped_existing_count: dataRestoreResult.skippedExistingCount,
          data_skipped_missing_parent_count: dataRestoreResult.skippedMissingParentCount,
          data_skipped_locked_count: dataRestoreResult.skippedLockedCount,
          data_failed_count: dataRestoreResult.failedCount,
          reconciliation_db_source_rows_total: toMetricCount(
            (reconciliation.db as Record<string, unknown>)?.source_rows_total,
          ),
          reconciliation_db_accounted_rows_total: toMetricCount(
            (reconciliation.db as Record<string, unknown>)?.accounted_rows_total,
          ),
          reconciliation_db_unaccounted_rows_total: toMetricCount(
            (reconciliation.db as Record<string, unknown>)?.unaccounted_rows_total,
          ),
          reconciliation_db_mismatch_table_count: toMetricCount(
            (reconciliation.db as Record<string, unknown>)?.mismatch_table_count,
          ),
          reconciliation_media_source_files_total: toMetricCount(
            (reconciliation.media as Record<string, unknown>)?.source_files_total,
          ),
          reconciliation_media_accounted_files_total: toMetricCount(
            (reconciliation.media as Record<string, unknown>)?.accounted_files_total,
          ),
          reconciliation_media_unaccounted_files_total: toMetricCount(
            (reconciliation.media as Record<string, unknown>)?.unaccounted_files_total,
          ),
          phase_durations_ms: getPhaseDurationsSnapshot(),
          request_started_at: requestStartedAtIso,
          request_observed_at: requestObservedAtIso,
          duration_observed_ms: durationObservedMs,
        },
      });

      trackPhase("response_build");
      const requestFinishedAtIso = new Date().toISOString();
      const durationTotalMs = Math.max(0, Date.now() - requestStartedAtMs);
      const phaseDurationsSnapshot = getPhaseDurationsSnapshot();

      return jsonResponse({
        ok: true,
        restore_mode: restoreMode,
        dry_run: payload.dryRun,
        force_wipe: payload.forceWipe,
        source_backup_checksum: checksum,
        old_user_id: oldUserId,
        new_user_id: userId,
        idempotency: {
          key: effectiveIdempotencyKey,
          replayed: false,
          replay_window_seconds: IDEMPOTENCY_REPLAY_WINDOW_SECONDS,
        },
        lock: {
          enabled: lockState.enabled,
          request_id: lockState.requestId,
        },
        account_state_before: {
          items_count: itemsCount,
          invoices_count: invoicesCount,
          wallets_count: walletsCount,
          qualifies_as_empty: isAccountEmptyForDisaster,
        },
        media: {
          uploaded_count: mediaResult.uploadedCount,
          skipped_existing_count: mediaResult.skippedExistingCount,
          failed_count: mediaResult.failedCount,
          would_upload_count: mediaResult.wouldUploadCount,
          sample_uploaded_paths: mediaResult.sampleUploadedPaths,
          conflicts: mediaResult.conflicts,
          errors: mediaResult.issues,
        },
        data: {
          enabled: restoreMode === "disaster",
          inserted_count: dataRestoreResult.insertedCount,
          skipped_existing_count: dataRestoreResult.skippedExistingCount,
          skipped_missing_parent_count: dataRestoreResult.skippedMissingParentCount,
          skipped_locked_count: dataRestoreResult.skippedLockedCount,
          failed_count: dataRestoreResult.failedCount,
          would_insert_count: dataRestoreResult.wouldInsertCount,
          table_summaries: dataRestoreResult.tableSummaries,
          errors: dataRestoreResult.issues,
        },
        reconciliation,
        observability: {
          phase: "completed",
          request_started_at: requestStartedAtIso,
          request_finished_at: requestFinishedAtIso,
          duration_total_ms: durationTotalMs,
          phase_durations_ms: phaseDurationsSnapshot,
        },
        manifest_file_count: mediaFiles.length,
        backup_file_name: payload.fileName,
      });
    } finally {
      if (lockState.enabled) {
        try {
          await releaseRestoreLock(serviceSupabase, userId, lockState.requestId);
        } catch (releaseError) {
          console.error("release_restore_lock failed", releaseError);
        }
      }
    }
  } catch (error) {
    trackPhase("response_build");
    const requestFinishedAtIso = new Date().toISOString();
    const durationTotalMs = Math.max(0, Date.now() - requestStartedAtMs);
    const phaseDurationsSnapshot = getPhaseDurationsSnapshot();

    if (error instanceof RestoreValidationError) {
      return jsonResponse({
        error: error.message,
        phase: currentPhase,
        observability: {
          phase: currentPhase,
          request_started_at: requestStartedAtIso,
          request_finished_at: requestFinishedAtIso,
          duration_total_ms: durationTotalMs,
          phase_durations_ms: phaseDurationsSnapshot,
        },
      }, error.status);
    }

    return jsonResponse({
      error: "Failed to restore full backup to account.",
      details: error instanceof Error ? error.message : String(error),
      phase: currentPhase,
      observability: {
        phase: currentPhase,
        request_started_at: requestStartedAtIso,
        request_finished_at: requestFinishedAtIso,
        duration_total_ms: durationTotalMs,
        phase_durations_ms: phaseDurationsSnapshot,
      },
    }, 500);
  }
});
