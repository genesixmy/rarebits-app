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
const MAX_MEDIA_FILES = 5000;
const MAX_TOTAL_MEDIA_BYTES = 200 * 1024 * 1024;
const MAX_DB_BATCH = 200;
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
  { exportKey: "customers", candidates: ["customers", "clients"] },
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

const parseCsvRows = (csvText: string): JsonObject[] => {
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

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => header.trim());
  if (headers.length === 0) return [];

  return rows
    .slice(1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""))
    .map((row) => {
      const mapped: JsonObject = {};
      headers.forEach((header, index) => {
        const raw = String(row[index] ?? "");
        const trimmed = raw.trim();
        if (!header) return;
        if (!trimmed) {
          mapped[header] = null;
          return;
        }
        mapped[header] = trimmed;
      });
      return mapped;
    });
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

const readZipPayload = async (req: Request): Promise<RestorePayload | { error: string; status: number }> => {
  const contentType = String(req.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const fileEntry = formData.get("file") || formData.get("backup") || formData.get("zip");
    const restoreModeRaw = toString(formData.get("restore_mode"));
    const modeRaw = toString(formData.get("mode"));
    const dryRun = parseBoolean(formData.get("dry_run"), false);
    const forceWipe = parseBoolean(formData.get("force_wipe"), false);

    if (fileEntry instanceof File) {
      const bytes = new Uint8Array(await fileEntry.arrayBuffer());
      return {
        bytes,
        fileName: fileEntry.name || "backup.zip",
        restoreModeRaw,
        modeRaw,
        dryRun,
        forceWipe,
      };
    }

    const base64Entry = formData.get("zip_base64") || formData.get("file_base64");
    if (typeof base64Entry === "string" && base64Entry.trim()) {
      const raw = base64Entry.includes(",") ? (base64Entry.split(",").pop() || "") : base64Entry;
      const binary = atob(raw.replace(/\s+/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return {
        bytes,
        fileName: toString(formData.get("file_name")) || "backup.zip",
        restoreModeRaw,
        modeRaw,
        dryRun,
        forceWipe,
      };
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

  const raw = base64Value.includes(",") ? (base64Value.split(",").pop() || "") : base64Value;
  const binary = atob(raw.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  return {
    bytes,
    fileName: toString(body?.file_name) || "backup.zip",
    restoreModeRaw: toString(body?.restore_mode),
    modeRaw: toString(body?.mode),
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

const loadBackupJsonRows = async (zip: JSZip, exportKey: string): Promise<JsonObject[]> => {
  const jsonCandidates = [
    new RegExp(`^json/${escapeRegExp(exportKey)}\\.json$`, "i"),
    new RegExp(`(^|/)json/${escapeRegExp(exportKey)}\\.json$`, "i"),
    new RegExp(`^${escapeRegExp(exportKey)}\\.json$`, "i"),
    new RegExp(`(^|/)${escapeRegExp(exportKey)}\\.json$`, "i"),
  ];

  const jsonEntries = jsonCandidates
    .flatMap((pattern) => zip.file(pattern) || [])
    .filter((entry, index, self) => self.findIndex((item) => item.name === entry.name) === index)
    .sort((a, b) => a.name.length - b.name.length);

  const jsonEntry = jsonEntries[0] || null;

  if (jsonEntry) {
    try {
      const raw = (await jsonEntry.async("string")).replace(/^\uFEFF/, "").trim();
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((row) => row && typeof row === "object") as JsonObject[];
      }
      if (parsed && typeof parsed === "object") {
        const rows = (parsed as Record<string, unknown>).rows;
        if (Array.isArray(rows)) return rows.filter((row) => row && typeof row === "object") as JsonObject[];
        const data = (parsed as Record<string, unknown>).data;
        if (Array.isArray(data)) return data.filter((row) => row && typeof row === "object") as JsonObject[];
        const values = Object.values(parsed as Record<string, unknown>);
        if (values.length > 0 && values.every((value) => value && typeof value === "object" && !Array.isArray(value))) {
          return values as JsonObject[];
        }
      }
    } catch {
      // Fallback to CSV parsing below.
    }
  }

  const csvCandidates = [
    new RegExp(`^csv/${escapeRegExp(exportKey)}\\.csv$`, "i"),
    new RegExp(`(^|/)csv/${escapeRegExp(exportKey)}\\.csv$`, "i"),
    new RegExp(`^${escapeRegExp(exportKey)}\\.csv$`, "i"),
    new RegExp(`(^|/)${escapeRegExp(exportKey)}\\.csv$`, "i"),
  ];
  const csvEntries = csvCandidates
    .flatMap((pattern) => zip.file(pattern) || [])
    .filter((entry, index, self) => self.findIndex((item) => item.name === entry.name) === index)
    .sort((a, b) => a.name.length - b.name.length);

  const csvEntry = csvEntries[0] || null;
  if (!csvEntry) return [];

  try {
    const csvText = await csvEntry.async("string");
    return parseCsvRows(csvText);
  } catch {
    return [];
  }
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

const resolveTargetTable = async (
  serviceSupabase: ReturnType<typeof createClient>,
  spec: RestoreTableSpec,
  metadata: JsonObject,
  tableExistsCache: Map<string, boolean>,
): Promise<string | null> => {
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
    const sourceId = toString((row as Record<string, unknown>).id);
    if (!isUuid(sourceId) || idMappings.has(sourceId)) return;
    idMappings.set(sourceId, crypto.randomUUID());
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
  const customersTable = await findFirstExistingTable(serviceSupabase, ["customers", "clients"], tableExistsCache);
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

const logRestoreEvent = async (
  serviceSupabase: ReturnType<typeof createClient>,
  tableExistsCache: Map<string, boolean>,
  payload: {
    checksum: string;
    oldUserId: string | null;
    newUserId: string;
    restoreMode: RestoreMode;
    forceWipe: boolean;
    dryRun: boolean;
    summary: JsonObject;
  },
): Promise<void> => {
  if (!await tableExists(serviceSupabase, "restore_events", tableExistsCache)) return;

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

  await serviceSupabase
    .from("restore_events")
    .insert(eventRow);
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
  zip: JSZip;
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
    zip,
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
    const rawRows = await loadBackupJsonRows(zip, spec.exportKey);
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

    let rowsToWrite = remappedRows;
    let preSkippedExistingForTable = 0;
    let preSkippedMissingParentForTable = 0;
    let preSkippedLockedForTable = 0;

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
      const filteredRows: JsonObject[] = [];
      remappedRows.forEach((row) => {
        const invoiceId = toString(row.invoice_id);
        const invoiceOwnerId = invoiceUserById.get(invoiceId) || newUserId;
        row.user_id = invoiceOwnerId;

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
      rowsToWrite = filteredRows;
    }

    if (["shipment_invoices", "invoice_items", "invoice_adjustments", "platform_fees", "invoice_item_returns"].includes(spec.exportKey)) {
      const filteredRows: JsonObject[] = [];

      rowsToWrite.forEach((row) => {
        const invoiceId = toString(row.invoice_id);
        if (invoiceId && !invoiceIdsForUser.has(invoiceId)) {
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

    const writeResult = rowsToWrite.length > 0
      ? await writeRowsWithFallback(
        serviceSupabase,
        targetTable,
        rowsToWrite,
        spec.onConflict,
        issues,
      )
      : { insertedCount: 0, skippedExistingCount: 0, failedCount: 0 };

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

    const payload = await readZipPayload(req);
    if ("error" in payload) {
      return jsonResponse({ error: payload.error }, payload.status);
    }

    if (!payload.bytes.length) {
      return jsonResponse({ error: "Fail ZIP kosong." }, 400);
    }

    const restoreMode = resolveRestoreMode(payload.restoreModeRaw, payload.modeRaw);

    const serviceSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    const tableExistsCache = new Map<string, boolean>();

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(payload.bytes, { checkCRC32: true });
    } catch (error) {
      return jsonResponse({
        error: "Fail ZIP rosak atau tidak sah.",
        details: error instanceof Error ? error.message : String(error),
      }, 400);
    }

    const metadataEntry = zip.file(/^metadata\.json$/i)?.[0] || null;
    if (!metadataEntry) {
      return jsonResponse({ error: "metadata.json tidak dijumpai dalam backup ZIP." }, 400);
    }

    let metadata: JsonObject;
    try {
      metadata = JSON.parse(await metadataEntry.async("string"));
    } catch {
      return jsonResponse({ error: "metadata.json tidak sah." }, 400);
    }

    const checksum = toString(metadata.checksum);
    if (!checksum) {
      return jsonResponse({ error: "Checksum backup tiada dalam metadata." }, 400);
    }

    if (restoreMode === "self") {
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

    const mediaManifestEntry = zip.file(/^media_manifest\.json$/i)?.[0] || null;
    if (!mediaManifestEntry) {
      return jsonResponse({ error: "media_manifest.json tidak dijumpai. Backup ini tiada media restore plan." }, 400);
    }

    let mediaManifest: JsonObject;
    try {
      mediaManifest = JSON.parse(await mediaManifestEntry.async("string"));
    } catch {
      return jsonResponse({ error: "media_manifest.json tidak sah." }, 400);
    }

    const mediaFiles = normalizeMediaFiles(mediaManifest.files);
    if (mediaFiles.length === 0) {
      return jsonResponse({ error: "media_manifest.json tidak mengandungi sebarang fail media." }, 400);
    }

    if (mediaFiles.length > MAX_MEDIA_FILES) {
      return jsonResponse({
        error: `Terlalu banyak fail media (${mediaFiles.length}). Had maksimum ialah ${MAX_MEDIA_FILES}.`,
      }, 400);
    }

    const backupTables: Record<string, JsonObject[]> = {};
    for (const spec of RESTORE_TABLE_SPECS) {
      backupTables[spec.exportKey] = await loadBackupJsonRows(zip, spec.exportKey);
    }
    const oldUserId = inferOldUserId(backupTables, mediaFiles);

    const itemsTable = await findFirstExistingTable(serviceSupabase, ["items", "inventory"], tableExistsCache);
    const walletsTable = await findFirstExistingTable(serviceSupabase, ["wallets"], tableExistsCache);
    const invoicesTable = await findFirstExistingTable(serviceSupabase, ["invoices"], tableExistsCache);

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
      await wipeExistingBusinessData(serviceSupabase, userId, tableExistsCache);
    }

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
      dataRestoreResult = await restoreDataTables({
        serviceSupabase,
        zip,
        metadata,
        oldUserId,
        newUserId: userId,
        mediaMappings: mediaResult.mediaMappings,
        tableExistsCache,
        dryRun: payload.dryRun,
      });
    }

    await logRestoreEvent(serviceSupabase, tableExistsCache, {
      checksum,
      oldUserId,
      newUserId: userId,
      restoreMode,
      forceWipe: payload.forceWipe,
      dryRun: payload.dryRun,
      summary: {
        media_uploaded_count: mediaResult.uploadedCount,
        media_skipped_existing_count: mediaResult.skippedExistingCount,
        media_failed_count: mediaResult.failedCount,
        data_inserted_count: dataRestoreResult.insertedCount,
        data_skipped_existing_count: dataRestoreResult.skippedExistingCount,
        data_skipped_missing_parent_count: dataRestoreResult.skippedMissingParentCount,
        data_skipped_locked_count: dataRestoreResult.skippedLockedCount,
        data_failed_count: dataRestoreResult.failedCount,
      },
    });

    return jsonResponse({
      ok: true,
      restore_mode: restoreMode,
      dry_run: payload.dryRun,
      force_wipe: payload.forceWipe,
      source_backup_checksum: checksum,
      old_user_id: oldUserId,
      new_user_id: userId,
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
      manifest_file_count: mediaFiles.length,
      backup_file_name: payload.fileName,
    });
  } catch (error) {
    return jsonResponse({
      error: "Failed to restore full backup to account.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
