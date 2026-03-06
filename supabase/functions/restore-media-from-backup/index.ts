import { createClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

type JsonObject = Record<string, unknown>;

type NormalizedMediaFile = {
  bucket: string;
  key: string;
  size: number | null;
  sha256: string | null;
};

type RestoreError = {
  bucket: string | null;
  key: string | null;
  message: string;
};

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const normalizeOrigin = (value: string): string =>
  value.trim().replace(/^['"]|['"]$/g, "").replace(/\/+$/, "");

const parseAllowedOrigins = (): string[] => {
  const raw = Deno.env.get("ALLOWED_ORIGINS") ?? "";
  return raw
    .split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter(Boolean);
};

const resolveCorsHeaders = (req?: Request): Record<string, string> => {
  const allowedOrigins = parseAllowedOrigins();
  const requestOrigin = normalizeOrigin(req?.headers.get("origin") ?? "");
  const allowOrigin = allowedOrigins.length === 0
    ? "*"
    : (requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0]);

  return {
    ...BASE_CORS_HEADERS,
    "Access-Control-Allow-Origin": allowOrigin,
    ...(allowOrigin === "*" ? {} : { "Vary": "Origin" }),
  };
};

const isOriginAllowed = (req: Request): boolean => {
  const allowedOrigins = parseAllowedOrigins();
  if (allowedOrigins.length === 0) return true;

  const requestOrigin = normalizeOrigin(req.headers.get("origin") ?? "");
  if (!requestOrigin) return true;
  return allowedOrigins.includes(requestOrigin);
};

const MAX_ERRORS = 10;
const MAX_SAMPLE_PATHS = 10;
const MAX_MEDIA_FILES = 5000;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const ALLOWED_MEDIA_BUCKETS = new Set(["item_images", "avatars"]);
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

const jsonResponse = (payload: JsonObject, status = 200, req?: Request) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...resolveCorsHeaders(req),
      "Content-Type": "application/json",
    },
  });

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

const toString = (value: unknown): string => String(value ?? "").trim();

const toNumberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

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
  ) {
    return "image/png";
  }

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
  ) {
    return "image/webp";
  }

  if (bytes.length >= 6) {
    const gifHeader = String.fromCharCode(...bytes.slice(0, 6));
    if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
      return "image/gif";
    }
  }

  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp";
  }

  if (
    bytes.length >= 4
    && (
      (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
      || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
    )
  ) {
    return "image/tiff";
  }

  if (bytes.length >= 5) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 512)).trimStart().toLowerCase();
    if (text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))) {
      return "image/svg+xml";
    }
  }

  return null;
};

const resolveUploadMimeType = (path: string, bytes: Uint8Array): string => {
  return mimeTypeFromBytes(bytes) || mimeTypeFromPath(path) || "application/octet-stream";
};

const readZipBytesFromRequest = async (req: Request): Promise<{
  bytes: Uint8Array;
  fileName: string;
} | {
  error: string;
  status: number;
}> => {
  const contentType = String(req.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const fileEntry =
      formData.get("file")
      || formData.get("backup")
      || formData.get("zip");

    if (fileEntry instanceof File) {
      const bytes = new Uint8Array(await fileEntry.arrayBuffer());
      return {
        bytes,
        fileName: fileEntry.name || "backup.zip",
      };
    }

    const base64Entry = formData.get("zip_base64") || formData.get("file_base64");
    if (typeof base64Entry === "string" && base64Entry.trim()) {
      const raw = base64Entry.includes(",") ? (base64Entry.split(",").pop() || "") : base64Entry;
      const binary = atob(raw.replace(/\s+/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return {
        bytes,
        fileName: String(formData.get("file_name") || "backup.zip"),
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
    return {
      error: "Gunakan multipart/form-data (field `file`) atau JSON `zip_base64`.",
      status: 400,
    };
  }

  const raw = base64Value.includes(",") ? (base64Value.split(",").pop() || "") : base64Value;
  const binary = atob(raw.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return {
    bytes,
    fileName: toString(body?.file_name) || "backup.zip",
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

const isLikelyAlreadyExists = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return normalized.includes("already exists")
    || normalized.includes("duplicate")
    || normalized.includes("conflict");
};

// Sandbox restore only; DB remap / overwrite flow is intentionally not implemented here.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: resolveCorsHeaders(req) });
  }

  if (!isOriginAllowed(req)) {
    return jsonResponse({ error: "Origin tidak dibenarkan." }, 403, req);
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405, req);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization");

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return jsonResponse({
        error: "Missing Supabase environment variables.",
      }, 500);
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
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const { data: userData, error: userError } = await userSupabase.auth.getUser();
    const userId = userData?.user?.id;
    if (userError || !userId) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const zipPayload = await readZipBytesFromRequest(req);
    if ("error" in zipPayload) {
      return jsonResponse({ error: zipPayload.error }, zipPayload.status);
    }

    if (!zipPayload.bytes.length) {
      return jsonResponse({ error: "Fail ZIP kosong." }, 400);
    }

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(zipPayload.bytes, { checkCRC32: true });
    } catch (error) {
      return jsonResponse({
        error: "Fail ZIP rosak atau tidak sah.",
        details: error instanceof Error ? error.message : String(error),
      }, 400);
    }

    const metadataEntry = zip.file(/^metadata\.json$/i)?.[0] || null;
    if (!metadataEntry) {
      return jsonResponse({
        error: "metadata.json tidak dijumpai dalam backup ZIP.",
      }, 400);
    }

    let metadata: Record<string, unknown>;
    try {
      metadata = JSON.parse(await metadataEntry.async("string"));
    } catch {
      return jsonResponse({ error: "metadata.json tidak sah." }, 400);
    }

    const checksum = toString(metadata?.checksum);
    if (!checksum) {
      return jsonResponse({
        error: "Checksum backup tiada. Tidak boleh sahkan pemilikan backup.",
      }, 400);
    }

    const serviceSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

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

    const mediaManifestEntry = zip.file(/^media_manifest\.json$/i)?.[0] || null;
    if (!mediaManifestEntry) {
      return jsonResponse({
        error: "media_manifest.json tidak dijumpai. Backup ini tiada media restore plan.",
      }, 400);
    }

    let mediaManifest: Record<string, unknown>;
    try {
      mediaManifest = JSON.parse(await mediaManifestEntry.async("string"));
    } catch {
      return jsonResponse({ error: "media_manifest.json tidak sah." }, 400);
    }

    const manifestFiles = normalizeMediaFiles(mediaManifest.files);
    if (manifestFiles.length > MAX_MEDIA_FILES) {
      return jsonResponse({
        error: `Terlalu banyak fail media (${manifestFiles.length}). Had maksimum ialah ${MAX_MEDIA_FILES}.`,
      }, 400);
    }

    const mediaZipEntries = collectMediaZipEntries(zip);
    const restoreTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sandboxPrefix = `restore_sandbox/${restoreTimestamp}`;

    let uploadedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let totalUploadedBytes = 0;

    const sampleUploadedPaths: string[] = [];
    const errors: RestoreError[] = [];
    const seenBucketKeys = new Set<string>();

    const pushError = (error: RestoreError) => {
      if (errors.length < MAX_ERRORS) {
        errors.push(error);
      }
    };

    for (const mediaFile of manifestFiles) {
      const bucket = toString(mediaFile.bucket);
      const key = normalizeStoragePath(mediaFile.key);

      if (!bucket || !key) {
        failedCount += 1;
        pushError({
          bucket: bucket || null,
          key: key || null,
          message: "Manifest entry bucket/key tidak sah.",
        });
        continue;
      }

      if (!ALLOWED_MEDIA_BUCKETS.has(bucket)) {
        failedCount += 1;
        pushError({
          bucket,
          key,
          message: "Bucket media tidak dibenarkan untuk restore sandbox.",
        });
        continue;
      }

      const dedupeKey = `${bucket}/${key}`;
      if (seenBucketKeys.has(dedupeKey)) {
        skippedCount += 1;
        continue;
      }
      seenBucketKeys.add(dedupeKey);

      const zipEntry = mediaZipEntries.get(dedupeKey) || null;
      if (!zipEntry) {
        failedCount += 1;
        pushError({
          bucket,
          key,
          message: "Fail media tiada dalam folder /media/ ZIP.",
        });
        continue;
      }

      let bytes: Uint8Array;
      try {
        bytes = await zipEntry.async("uint8array");
      } catch (error) {
        failedCount += 1;
        pushError({
          bucket,
          key,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (mediaFile.size !== null && mediaFile.size !== bytes.length) {
        failedCount += 1;
        pushError({
          bucket,
          key,
          message: `Saiz fail tidak sepadan (manifest=${mediaFile.size}, zip=${bytes.length}).`,
        });
        continue;
      }

      if (mediaFile.sha256) {
        const actualSha256 = await sha256Bytes(bytes);
        if (actualSha256.toLowerCase() !== mediaFile.sha256.toLowerCase()) {
          failedCount += 1;
          pushError({
            bucket,
            key,
            message: "SHA-256 mismatch.",
          });
          continue;
        }
      }

      if (totalUploadedBytes + bytes.length > MAX_TOTAL_BYTES) {
        failedCount += 1;
        pushError({
          bucket,
          key,
          message: `Melebihi had total upload ${MAX_TOTAL_BYTES} bytes.`,
        });
        continue;
      }

      const sandboxKey = `${sandboxPrefix}/${key}`;
      const contentType = resolveUploadMimeType(key, bytes);
      const { error: uploadError } = await serviceSupabase
        .storage
        .from(bucket)
        .upload(sandboxKey, bytes, {
          upsert: false,
          contentType,
        });

      if (uploadError) {
        const message = uploadError.message || "Upload gagal.";
        if (isLikelyAlreadyExists(message)) {
          skippedCount += 1;
        } else {
          failedCount += 1;
          pushError({ bucket, key, message });
        }
        continue;
      }

      uploadedCount += 1;
      totalUploadedBytes += bytes.length;

      if (sampleUploadedPaths.length < MAX_SAMPLE_PATHS) {
        sampleUploadedPaths.push(`${bucket}/${sandboxKey}`);
      }
    }

    return jsonResponse({
      ok: true,
      mode: "sandbox_restore_only",
      // Sandbox restore only; DB remap / overwrite is intentionally not implemented.
      sandbox_prefix: sandboxPrefix,
      uploaded_count: uploadedCount,
      skipped_count: skippedCount,
      failed_count: failedCount,
      sample_uploaded_paths: sampleUploadedPaths,
      errors,
      backup_file_name: zipPayload.fileName,
      manifest_file_count: manifestFiles.length,
    });
  } catch (error) {
    return jsonResponse({
      error: "Failed to restore media from backup.",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
