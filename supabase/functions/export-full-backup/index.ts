import { createClient } from "npm:@supabase/supabase-js@2";

type JsonObject = Record<string, unknown>;

type TableExportResult = {
  exportKey: string;
  sourceTable: string | null;
  rows: JsonObject[];
};

type SnapshotMetrics = {
  totalRevenue: number;
  totalExpense: number;
  netProfitCurrent: number;
  totalProfit: number;
  walletBalance: number;
  invoiceCount: number;
  inventoryValue: number;
  checksum: string;
};

type DateRangeMode = "all_time" | "last_30_days" | "custom";

type DateRangeFilter = {
  mode: DateRangeMode;
  startAt: Date | null;
  endAt: Date | null;
  metadata: JsonObject | "all_time";
};

type FinancialSummary = {
  revenue_item: number;
  shipping_charged: number;
  total_revenue: number;
  item_cost_total: number;
  shipping_cost_total: number;
  platform_fees_total: number;
  goodwill_adjustments_total: number;
  total_expense: number;
  net_profit_current: number;
  sold_invoice_count: number;
  settled_invoice_count: number;
};

type FetchFilter =
  | { type: "user_id"; userId: string }
  | { type: "in"; column: string; values: string[] };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const CSV_BOM = "\uFEFF";
const SETTLED_STATUSES = new Set(["paid", "partially_returned", "returned"]);
const GOODWILL_TYPES = new Set(["goodwill", "cancel", "correction"]);
const INVOICE_ADJUSTMENT_TYPES = new Set(["goodwill", "return", "cancel", "correction"]);
const COURIER_PAYMENT_MODE_PLATFORM = "platform";
const EPSILON = 0.0001;
const CHUNK_SIZE = 200;
const PAGE_SIZE = 1000;

const TABLE_SPECS: Array<{
  exportKey: string;
  candidates: string[];
  filterType: "user_id" | "in";
  relationExportKey?: "invoices" | "invoice_items" | "customers" | "inventory";
  inColumn?: string;
}> = [
  { exportKey: "invoices", candidates: ["invoices"], filterType: "user_id" },
  { exportKey: "invoice_items", candidates: ["invoice_items"], filterType: "in", relationExportKey: "invoices", inColumn: "invoice_id" },
  { exportKey: "invoice_adjustments", candidates: ["invoice_adjustments", "invoice_refunds"], filterType: "in", relationExportKey: "invoices", inColumn: "invoice_id" },
  { exportKey: "invoice_item_returns", candidates: ["invoice_item_returns"], filterType: "in", relationExportKey: "invoice_items", inColumn: "invoice_item_id" },
  { exportKey: "shipments", candidates: ["shipments"], filterType: "user_id" },
  { exportKey: "shipment_invoices", candidates: ["shipment_invoices"], filterType: "in", relationExportKey: "invoices", inColumn: "invoice_id" },
  { exportKey: "inventory", candidates: ["inventory", "items"], filterType: "user_id" },
  { exportKey: "inventory_reservations", candidates: ["inventory_reservations"], filterType: "in", relationExportKey: "inventory", inColumn: "item_id" },
  { exportKey: "wallet_transactions", candidates: ["wallet_transactions", "transactions"], filterType: "user_id" },
  { exportKey: "wallets", candidates: ["wallets"], filterType: "user_id" },
  { exportKey: "customers", candidates: ["customers", "clients"], filterType: "user_id" },
  { exportKey: "client_phones", candidates: ["client_phones"], filterType: "in", relationExportKey: "customers", inColumn: "client_id" },
  { exportKey: "client_addresses", candidates: ["client_addresses"], filterType: "in", relationExportKey: "customers", inColumn: "client_id" },
  { exportKey: "platform_fees", candidates: ["platform_fees", "invoice_fees"], filterType: "in", relationExportKey: "invoices", inColumn: "invoice_id" },
  { exportKey: "platform_fee_rules", candidates: ["platform_fee_rules"], filterType: "user_id" },
  { exportKey: "sales_channels", candidates: ["sales_channels"], filterType: "user_id" },
  { exportKey: "settings", candidates: ["settings", "invoice_settings"], filterType: "user_id" },
  { exportKey: "profiles", candidates: ["profiles"], filterType: "user_id" },
  { exportKey: "categories", candidates: ["categories"], filterType: "user_id" },
];

const textEncoder = new TextEncoder();

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toNonNegative = (value: unknown): number => Math.max(toNumber(value, 0), 0);

const round2 = (value: number): number => Math.round(value * 100) / 100;

const normalizeAdjustmentType = (value: unknown): string => String(value ?? "").trim().toLowerCase();

const looksLikeGoodwillText = (value: unknown): boolean => {
  const normalized = String(value ?? "").toLowerCase();
  if (!normalized) return false;
  return ["courtesy", "gerak budi", "diskaun", "price adjustment", "kompensasi"]
    .some((keyword) => normalized.includes(keyword));
};

const isTableMissingError = (error: unknown): boolean => {
  const message = String((error as { message?: string })?.message ?? "").toLowerCase();
  const code = String((error as { code?: string })?.code ?? "").toUpperCase();
  return code === "PGRST205" || code === "42P01" || message.includes("does not exist") || message.includes("could not find");
};

const isMissingColumnError = (error: unknown): boolean => {
  const message = String((error as { message?: string })?.message ?? "").toLowerCase();
  const code = String((error as { code?: string })?.code ?? "").toUpperCase();
  return code === "PGRST204" || code === "42703" || message.includes("could not find the") || message.includes("column");
};

const chunkValues = <T,>(values: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    result.push(values.slice(i, i + size));
  }
  return result;
};

const uniqueStringIds = (values: unknown[]): string[] => {
  const set = new Set<string>();
  values.forEach((value) => {
    const normalized = String(value ?? "").trim();
    if (normalized) set.add(normalized);
  });
  return Array.from(set);
};

const normalizeScalar = (value: unknown): string | number | boolean => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const toCsvCell = (value: unknown): string => {
  const normalized = String(normalizeScalar(value));
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
};

const toCsv = (rows: JsonObject[]): string => {
  if (!Array.isArray(rows) || rows.length === 0) return CSV_BOM;

  const columns: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row ?? {}).forEach((key) => {
      if (seen.has(key)) return;
      seen.add(key);
      columns.push(key);
    });
  });

  if (columns.length === 0) return CSV_BOM;

  const header = columns.map((column) => toCsvCell(column)).join(",");
  const body = rows.map((row) => columns.map((column) => toCsvCell(row[column])).join(",")).join("\n");
  return `${CSV_BOM}${header}\n${body}`;
};

const concatBytes = (parts: Uint8Array[]): Uint8Array => {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

const buildCrcTable = (): Uint32Array => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
};

const CRC_TABLE = buildCrcTable();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

const toDosDateTime = (date: Date): { dosDate: number; dosTime: number } => {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
    dosTime: (hours << 11) | (minutes << 5) | seconds,
  };
};

const toBytes = (content: string | Uint8Array): Uint8Array => {
  if (content instanceof Uint8Array) return content;
  return textEncoder.encode(content);
};

const createZip = (entries: Array<{ name: string; content: string | Uint8Array }>): Uint8Array => {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  const now = new Date();
  const { dosDate, dosTime } = toDosDateTime(now);

  entries.forEach((entry) => {
    const fileName = String(entry.name || "").replace(/^\/+/, "");
    if (!fileName) return;

    const nameBytes = textEncoder.encode(fileName);
    const dataBytes = toBytes(entry.content);
    const checksum = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034B50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, dataBytes.length, true);
    localView.setUint32(22, dataBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014B50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, dataBytes.length, true);
    centralView.setUint32(24, dataBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    localOffset += localHeader.length + dataBytes.length;
  });

  const centralDirectory = concatBytes(centralParts);
  const localFileSection = concatBytes(localParts);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054B50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, centralParts.length, true);
  endView.setUint16(10, centralParts.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, localFileSection.length, true);
  endView.setUint16(20, 0, true);

  return concatBytes([localFileSection, centralDirectory, endRecord]);
};

const toDateKey = (date: Date): string => {
  return date.toISOString().slice(0, 10);
};

const parseDateBoundary = (value: string | null, boundary: "start" | "end"): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const bounded = new Date(parsed);
  if (boundary === "start") {
    bounded.setHours(0, 0, 0, 0);
  } else {
    bounded.setHours(23, 59, 59, 999);
  }
  return bounded;
};

const normalizeDateRangeMode = (value: string | null): DateRangeMode | null => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "all_time") return "all_time";
  if (normalized === "last_30_days" || normalized === "last30" || normalized === "rolling_30") {
    return "last_30_days";
  }
  if (normalized === "custom") return "custom";
  return null;
};

const resolveDateRangeFilter = (requestUrl: URL): DateRangeFilter => {
  const startDateParam = requestUrl.searchParams.get("startDate");
  const endDateParam = requestUrl.searchParams.get("endDate");
  const modeParam = normalizeDateRangeMode(
    requestUrl.searchParams.get("range")
    || requestUrl.searchParams.get("dateRange")
    || requestUrl.searchParams.get("date_range"),
  );

  if (startDateParam || endDateParam) {
    const startAt = parseDateBoundary(startDateParam, "start");
    const endAt = parseDateBoundary(endDateParam, "end");
    return {
      mode: "custom",
      startAt,
      endAt,
      metadata: {
        mode: "custom",
        startDate: startAt ? toDateKey(startAt) : (startDateParam || null),
        endDate: endAt ? toDateKey(endAt) : (endDateParam || null),
      },
    };
  }

  if (modeParam === "last_30_days") {
    const endAt = new Date();
    endAt.setHours(23, 59, 59, 999);
    const startAt = new Date(endAt);
    startAt.setDate(endAt.getDate() - 29);
    startAt.setHours(0, 0, 0, 0);

    return {
      mode: "last_30_days",
      startAt,
      endAt,
      metadata: {
        mode: "last_30_days",
        startDate: toDateKey(startAt),
        endDate: toDateKey(endAt),
      },
    };
  }

  return {
    mode: "all_time",
    startAt: null,
    endAt: null,
    metadata: "all_time",
  };
};

const isInvoiceWithinDateRange = (invoice: JsonObject, dateRange: DateRangeFilter): boolean => {
  if (dateRange.mode === "all_time") return true;

  const rawInvoiceDate = String(invoice.invoice_date ?? "").trim();
  if (!rawInvoiceDate) return false;

  const invoiceDate = new Date(rawInvoiceDate);
  if (Number.isNaN(invoiceDate.getTime())) return false;

  if (dateRange.startAt && invoiceDate < dateRange.startAt) return false;
  if (dateRange.endAt && invoiceDate > dateRange.endAt) return false;
  return true;
};

const normalizeCourierPaymentMode = (value: unknown): string => {
  return String(value ?? "").trim().toLowerCase() || "seller";
};

const resolveAdjustmentTypeFromRow = (row: JsonObject): string => {
  const normalizedType = normalizeAdjustmentType(row.refund_type ?? row.type);
  if (INVOICE_ADJUSTMENT_TYPES.has(normalizedType)) return normalizedType;

  const amount = toNumber(row.amount, 0);
  if (amount < 0) return "goodwill";

  const hint = `${row.reason ?? ""} ${row.note ?? ""} ${row.notes ?? ""}`.trim();
  if (looksLikeGoodwillText(hint)) return "goodwill";

  return "";
};

const resolveGoodwillFromAdjustmentRow = (row: JsonObject): number => {
  const adjustmentType = resolveAdjustmentTypeFromRow(row);
  if (GOODWILL_TYPES.has(adjustmentType)) {
    return Math.abs(toNumber(row.amount, 0));
  }
  return 0;
};

const resolveLineUnitCost = (
  line: JsonObject,
  inventoryCostByItemId: Map<string, number>,
): number => {
  const lineCost = Number.parseFloat(String(line.cost_price ?? ""));
  if (Number.isFinite(lineCost) && lineCost > 0) return lineCost;

  const isManual = Boolean(line.is_manual);
  if (!isManual) {
    const itemId = String(line.item_id ?? "").trim();
    const inventoryCost = itemId ? inventoryCostByItemId.get(itemId) : null;
    if (typeof inventoryCost === "number" && Number.isFinite(inventoryCost) && inventoryCost >= 0) {
      return inventoryCost;
    }
  }

  if (Number.isFinite(lineCost) && lineCost >= 0) return lineCost;
  return 0;
};

const resolveLineNetQuantity = (
  line: JsonObject,
  returnedQtyByItemId: Map<string, number>,
): number => {
  const explicitNetQty = Number.parseFloat(String(line.quantity_sold ?? ""));
  if (Number.isFinite(explicitNetQty)) return Math.max(explicitNetQty, 0);

  const soldQty = toNonNegative(line.quantity ?? line.invoice_quantity);
  const lineId = String(line.id ?? "").trim();
  const returnedQty = lineId ? (returnedQtyByItemId.get(lineId) || 0) : 0;
  return Math.max(soldQty - returnedQty, 0);
};

const buildLegacyFinancialSummary = (
  tables: Record<string, TableExportResult>,
  dateRange: DateRangeFilter,
): Pick<FinancialSummary, "total_revenue" | "total_expense" | "net_profit_current"> => {
  const invoices = tables.invoices?.rows ?? [];
  const invoiceItems = tables.invoice_items?.rows ?? [];
  const invoiceItemReturns = tables.invoice_item_returns?.rows ?? [];
  const invoiceAdjustments = tables.invoice_adjustments?.rows ?? [];
  const shipments = tables.shipments?.rows ?? [];
  const platformFees = tables.platform_fees?.rows ?? [];

  const itemsByInvoiceId = new Map<string, JsonObject[]>();
  const returnedByItemId = new Map<string, number>();
  const shipmentByInvoiceId = new Map<string, JsonObject>();
  const shipmentById = new Map<string, JsonObject>();
  const feesByInvoiceId = new Map<string, number>();
  const adjustmentsByInvoiceId = new Map<string, number>();

  invoiceItems.forEach((row) => {
    const invoiceId = String(row.invoice_id ?? "").trim();
    if (!invoiceId) return;
    if (!itemsByInvoiceId.has(invoiceId)) itemsByInvoiceId.set(invoiceId, []);
    itemsByInvoiceId.get(invoiceId)!.push(row);
  });

  invoiceItemReturns.forEach((row) => {
    const itemId = String(row.invoice_item_id ?? "").trim();
    if (!itemId) return;
    returnedByItemId.set(itemId, (returnedByItemId.get(itemId) || 0) + toNonNegative(row.refund_amount));
  });

  shipments.forEach((row) => {
    const invoiceId = String(row.invoice_id ?? "").trim();
    if (invoiceId) shipmentByInvoiceId.set(invoiceId, row);
    const shipmentId = String(row.id ?? "").trim();
    if (shipmentId) shipmentById.set(shipmentId, row);
  });

  platformFees.forEach((row) => {
    const invoiceId = String(row.invoice_id ?? "").trim();
    if (!invoiceId) return;
    const overrideValue = Number.parseFloat(String(row.amount_override ?? ""));
    const effectiveAmount = Number.isFinite(overrideValue) && overrideValue >= 0
      ? overrideValue
      : toNonNegative(row.amount);
    feesByInvoiceId.set(invoiceId, (feesByInvoiceId.get(invoiceId) || 0) + effectiveAmount);
  });

  invoiceAdjustments.forEach((row) => {
    const invoiceId = String(row.invoice_id ?? "").trim();
    if (!invoiceId) return;
    adjustmentsByInvoiceId.set(invoiceId, (adjustmentsByInvoiceId.get(invoiceId) || 0) + resolveGoodwillFromAdjustmentRow(row));
  });

  let totalRevenue = 0;
  let totalExpense = 0;
  let netProfit = 0;

  invoices.forEach((invoice) => {
    const status = String(invoice.status ?? "").trim().toLowerCase();
    if (!SETTLED_STATUSES.has(status)) return;
    if (!isInvoiceWithinDateRange(invoice, dateRange)) return;

    const invoiceId = String(invoice.id ?? "").trim();
    if (!invoiceId) return;

    const lines = itemsByInvoiceId.get(invoiceId) || [];
    const itemSubtotal = lines.reduce((sum, line) => {
      const lineId = String(line.id ?? "").trim();
      const returned = lineId ? (returnedByItemId.get(lineId) || 0) : 0;
      const explicitActual = Number.parseFloat(String(line.actual_sold_amount ?? ""));
      const lineRevenue = Number.isFinite(explicitActual)
        ? explicitActual
        : toNumber(line.line_total, 0) - returned;
      return sum + lineRevenue;
    }, 0);

    const itemCost = lines.reduce((sum, line) => {
      const explicitNetQty = Number.parseFloat(String(line.quantity_sold ?? ""));
      const quantity = Math.max(Number.isFinite(explicitNetQty) ? explicitNetQty : toNumber(line.quantity, 0), 0);
      return sum + (toNonNegative(line.cost_price) * quantity);
    }, 0);

    const shipment = shipmentByInvoiceId.get(invoiceId)
      || shipmentById.get(String(invoice.shipment_id ?? "").trim());
    const shippingCharged = toNonNegative(invoice.shipping_charged);
    const shippingCost = shipment?.courier_paid ? toNonNegative(shipment.shipping_cost) : 0;

    const platformFee = feesByInvoiceId.has(invoiceId)
      ? (feesByInvoiceId.get(invoiceId) || 0)
      : toNonNegative(invoice.channel_fee_amount);

    const goodwill = (() => {
      const directAdjustment = toNonNegative(invoice.adjustment_total);
      if (directAdjustment > 0) return directAdjustment;
      return adjustmentsByInvoiceId.get(invoiceId) || 0;
    })();

    const revenue = itemSubtotal + shippingCharged;
    const expense = itemCost + shippingCost + platformFee + goodwill;
    totalRevenue += revenue;
    totalExpense += expense;
    netProfit += (revenue - expense);
  });

  return {
    total_revenue: round2(totalRevenue),
    total_expense: round2(totalExpense),
    net_profit_current: round2(netProfit),
  };
};

const buildFinancialSummary = (
  tables: Record<string, TableExportResult>,
  dateRange: DateRangeFilter,
): FinancialSummary => {
  const invoices = tables.invoices?.rows ?? [];
  const invoiceItems = tables.invoice_items?.rows ?? [];
  const invoiceItemReturns = tables.invoice_item_returns?.rows ?? [];
  const invoiceAdjustments = tables.invoice_adjustments?.rows ?? [];
  const shipments = tables.shipments?.rows ?? [];
  const platformFees = tables.platform_fees?.rows ?? [];
  const inventory = tables.inventory?.rows ?? [];

  const invoiceById = new Map<string, JsonObject>();
  const shipmentByInvoiceId = new Map<string, JsonObject>();
  const shipmentById = new Map<string, JsonObject>();
  const feesByInvoiceId = new Map<string, number>();
  const adjustmentsByInvoiceId = new Map<string, number>();
  const returnedQtyByItemId = new Map<string, number>();
  const returnedRefundByItemId = new Map<string, number>();
  const inventoryCostByItemId = new Map<string, number>();
  const soldInvoiceIds = new Set<string>();

  invoices.forEach((invoice) => {
    const status = String(invoice.status ?? "").trim().toLowerCase();
    if (!SETTLED_STATUSES.has(status)) return;
    if (!isInvoiceWithinDateRange(invoice, dateRange)) return;

    const invoiceId = String(invoice.id ?? "").trim();
    if (!invoiceId) return;
    invoiceById.set(invoiceId, invoice);
  });

  inventory.forEach((row) => {
    const itemId = String(row.id ?? "").trim();
    if (!itemId) return;
    inventoryCostByItemId.set(itemId, toNonNegative(row.cost_price));
  });

  invoiceItemReturns.forEach((row) => {
    const itemId = String(row.invoice_item_id ?? "").trim();
    if (!itemId) return;
    returnedQtyByItemId.set(itemId, (returnedQtyByItemId.get(itemId) || 0) + toNonNegative(row.returned_quantity));
    returnedRefundByItemId.set(itemId, (returnedRefundByItemId.get(itemId) || 0) + toNonNegative(row.refund_amount));
  });

  shipments.forEach((row) => {
    const invoiceId = String(row.invoice_id ?? "").trim();
    if (invoiceId) shipmentByInvoiceId.set(invoiceId, row);

    const shipmentId = String(row.id ?? "").trim();
    if (shipmentId) shipmentById.set(shipmentId, row);
  });

  platformFees.forEach((row) => {
    const invoiceId = String(row.invoice_id ?? "").trim();
    if (!invoiceId) return;
    const overrideValue = Number.parseFloat(String(row.amount_override ?? ""));
    const effectiveAmount = Number.isFinite(overrideValue) && overrideValue >= 0
      ? overrideValue
      : toNonNegative(row.amount);
    feesByInvoiceId.set(invoiceId, (feesByInvoiceId.get(invoiceId) || 0) + effectiveAmount);
  });

  invoiceAdjustments.forEach((row) => {
    const invoiceId = String(row.invoice_id ?? "").trim();
    if (!invoiceId) return;
    adjustmentsByInvoiceId.set(invoiceId, (adjustmentsByInvoiceId.get(invoiceId) || 0) + resolveGoodwillFromAdjustmentRow(row));
  });

  let revenueItem = 0;
  let itemCostTotal = 0;
  let shippingChargedTotal = 0;
  let shippingCostTotal = 0;
  let platformFeeTotal = 0;
  let goodwillAdjustmentsTotal = 0;

  invoiceItems.forEach((line) => {
    const invoiceId = String(line.invoice_id ?? "").trim();
    if (!invoiceId || !invoiceById.has(invoiceId)) return;

    const lineNetQty = resolveLineNetQuantity(line, returnedQtyByItemId);
    const lineId = String(line.id ?? "").trim();
    const returnedRefund = lineId ? (returnedRefundByItemId.get(lineId) || 0) : 0;
    const explicitActual = Number.parseFloat(String(line.actual_sold_amount ?? ""));
    const lineTotalRaw = Number.parseFloat(String(line.line_total ?? ""));
    const lineSubtotal = Number.isFinite(explicitActual)
      ? explicitActual
      : (Number.isFinite(lineTotalRaw)
        ? lineTotalRaw - returnedRefund
        : ((toNumber(line.unit_price ?? line.selling_price, 0) * lineNetQty) - returnedRefund));

    const unitCost = resolveLineUnitCost(line, inventoryCostByItemId);
    const lineCost = unitCost * lineNetQty;

    revenueItem += lineSubtotal;
    itemCostTotal += lineCost;

    if (lineNetQty > 0 || Math.abs(lineSubtotal) > EPSILON) {
      soldInvoiceIds.add(invoiceId);
    }
  });

  invoiceById.forEach((invoice, invoiceId) => {
    const shipment = shipmentByInvoiceId.get(invoiceId)
      || shipmentById.get(String(invoice.shipment_id ?? "").trim());
    const isPlatformMode = normalizeCourierPaymentMode(invoice.courier_payment_mode) === COURIER_PAYMENT_MODE_PLATFORM;

    const shippingCharged = isPlatformMode ? 0 : toNonNegative(invoice.shipping_charged);
    const shippingCost = isPlatformMode ? 0 : toNonNegative(shipment?.shipping_cost);
    const isCourierPaid = isPlatformMode ? true : Boolean(shipment?.courier_paid);
    const shippingCostPaid = isCourierPaid ? shippingCost : 0;

    const platformFee = feesByInvoiceId.has(invoiceId)
      ? (feesByInvoiceId.get(invoiceId) || 0)
      : toNonNegative(invoice.channel_fee_amount);

    const directAdjustment = toNonNegative(invoice.adjustment_total);
    const goodwill = directAdjustment > 0
      ? directAdjustment
      : (adjustmentsByInvoiceId.get(invoiceId) || 0);

    shippingChargedTotal += shippingCharged;
    shippingCostTotal += shippingCostPaid;
    platformFeeTotal += platformFee;
    goodwillAdjustmentsTotal += goodwill;
  });

  const totalRevenue = revenueItem + shippingChargedTotal;
  const totalExpense = itemCostTotal + shippingCostTotal + platformFeeTotal + goodwillAdjustmentsTotal;
  const netProfitCurrent = totalRevenue - totalExpense;

  return {
    // `revenue_item` matches Dashboard (item lines only), while `total_revenue` includes shipping charged.
    revenue_item: round2(revenueItem),
    shipping_charged: round2(shippingChargedTotal),
    total_revenue: round2(totalRevenue),
    item_cost_total: round2(itemCostTotal),
    shipping_cost_total: round2(shippingCostTotal),
    platform_fees_total: round2(platformFeeTotal),
    goodwill_adjustments_total: round2(goodwillAdjustmentsTotal),
    total_expense: round2(totalExpense),
    net_profit_current: round2(netProfitCurrent),
    sold_invoice_count: soldInvoiceIds.size,
    settled_invoice_count: invoiceById.size,
  };
};

const calculateWalletBalance = (walletRows: JsonObject[] = []): number => {
  return round2(walletRows.reduce((sum, row) => {
    const balance =
      Number.parseFloat(String(row.current_balance ?? "")) ||
      Number.parseFloat(String(row.balance ?? "")) ||
      Number.parseFloat(String(row.amount ?? "")) ||
      0;
    return sum + (Number.isFinite(balance) ? balance : 0);
  }, 0));
};

const calculateInventoryValue = (inventoryRows: JsonObject[] = []): number => {
  return round2(inventoryRows.reduce((sum, row) => {
    const explicitAvailable = Number.parseFloat(String(row.available_quantity ?? ""));
    const totalQuantity = Number.parseFloat(String(row.quantity ?? ""));
    const reservedRaw = Number.parseFloat(String(row.quantity_reserved ?? ""));
    const availableQty = Number.isFinite(explicitAvailable)
      ? Math.max(explicitAvailable, 0)
      : Math.max((Number.isFinite(totalQuantity) ? totalQuantity : 0) - (Number.isFinite(reservedRaw) ? reservedRaw : 0), 0);
    const costPerUnit = toNonNegative(row.cost_price);
    return sum + (costPerUnit * availableQty);
  }, 0));
};

const sha256Hex = async (value: string): Promise<string> => {
  const inputBytes = textEncoder.encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", inputBytes);
  const hashBytes = new Uint8Array(hashBuffer);
  return Array.from(hashBytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const fetchRowsPaged = async (
  supabase: ReturnType<typeof createClient>,
  table: string,
  filter: FetchFilter,
): Promise<{ rows: JsonObject[]; error: unknown | null }> => {
  const rows: JsonObject[] = [];

  if (filter.type === "in" && filter.values.length === 0) {
    return { rows, error: null };
  }

  const segments = filter.type === "in" ? chunkValues(filter.values, CHUNK_SIZE) : [[]];

  for (const segment of segments) {
    let offset = 0;
    while (true) {
      let query = supabase.from(table).select("*").range(offset, offset + PAGE_SIZE - 1);

      if (filter.type === "user_id") {
        query = query.eq("user_id", filter.userId);
      } else {
        query = query.in(filter.column, segment);
      }

      const { data, error } = await query;
      if (error) {
        return { rows: [], error };
      }

      const batch = Array.isArray(data) ? (data as JsonObject[]) : [];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  return { rows, error: null };
};

const fetchFromCandidates = async (
  supabase: ReturnType<typeof createClient>,
  exportKey: string,
  candidates: string[],
  filter: FetchFilter,
  warnings: JsonObject[],
): Promise<TableExportResult> => {
  for (const table of candidates) {
    const { rows, error } = await fetchRowsPaged(supabase, table, filter);
    if (!error) {
      return { exportKey, sourceTable: table, rows };
    }

    if (isTableMissingError(error)) {
      continue;
    }

    warnings.push({
      exportKey,
      table,
      code: (error as { code?: string })?.code || null,
      message: (error as { message?: string })?.message || String(error),
    });

    return { exportKey, sourceTable: table, rows: [] };
  }

  warnings.push({
    exportKey,
    table: candidates.join(","),
    code: "TABLE_NOT_FOUND",
    message: "No candidate table found.",
  });
  return { exportKey, sourceTable: null, rows: [] };
};

const maybeInsertBusinessSnapshot = async (
  supabase: ReturnType<typeof createClient>,
  userId: string,
  fileName: string,
  metadata: JsonObject,
  snapshotMetrics: SnapshotMetrics,
  tableCounts: Record<string, number>,
  warnings: JsonObject[],
) => {
  const rowCountTotal = Object.values(tableCounts).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  const basePayload = {
    user_id: userId,
    snapshot_type: "full_backup",
    file_name: fileName,
    row_count_total: rowCountTotal,
    table_counts: tableCounts,
    metadata,
    net_profit_current: snapshotMetrics.netProfitCurrent,
    total_revenue: snapshotMetrics.totalRevenue,
    total_expense: snapshotMetrics.totalExpense,
  };

  const extendedPayload = {
    ...basePayload,
    total_profit: snapshotMetrics.totalProfit,
    wallet_balance: snapshotMetrics.walletBalance,
    invoice_count: snapshotMetrics.invoiceCount,
    inventory_value: snapshotMetrics.inventoryValue,
    checksum: snapshotMetrics.checksum,
  };

  const { error: primaryError } = await supabase
    .from("business_snapshots")
    .insert(extendedPayload);

  if (!primaryError) return;
  if (isTableMissingError(primaryError)) return;

  if (isMissingColumnError(primaryError)) {
    const { error: fallbackError } = await supabase
      .from("business_snapshots")
      .insert(basePayload);

    if (!fallbackError) {
      warnings.push({
        exportKey: "business_snapshots",
        table: "business_snapshots",
        code: "FALLBACK_INSERT",
        message: "Snapshot inserted using base payload because extended columns are not available.",
      });
      return;
    }

    console.error("[export-full-backup] fallback snapshot insert failed", fallbackError);
    warnings.push({
      exportKey: "business_snapshots",
      table: "business_snapshots",
      code: (fallbackError as { code?: string })?.code || null,
      message: (fallbackError as { message?: string })?.message || String(fallbackError),
    });
    return;
  }

  console.error("[export-full-backup] snapshot insert failed", primaryError);
  warnings.push({
    exportKey: "business_snapshots",
    table: "business_snapshots",
    code: (primaryError as { code?: string })?.code || null,
    message: (primaryError as { message?: string })?.message || String(primaryError),
  });
};

const isProductionEnvironment = (): boolean => {
  const value = String(
    Deno.env.get("APP_ENV")
    || Deno.env.get("SUPABASE_ENV")
    || Deno.env.get("NODE_ENV")
    || "",
  ).trim().toLowerCase();
  return value === "production" || value === "prod";
};

const maybeLogFinancialDelta = (
  dateRangeMode: DateRangeMode,
  legacySummary: Pick<FinancialSummary, "total_revenue" | "total_expense" | "net_profit_current">,
  alignedSummary: FinancialSummary,
) => {
  if (isProductionEnvironment()) return;

  console.info("[export-full-backup] financial delta (legacy -> aligned)", {
    date_range_mode: dateRangeMode,
    delta_total_revenue: round2(alignedSummary.total_revenue - legacySummary.total_revenue),
    delta_total_expense: round2(alignedSummary.total_expense - legacySummary.total_expense),
    delta_net_profit: round2(alignedSummary.net_profit_current - legacySummary.net_profit_current),
  });
};

const jsonResponse = (payload: JsonObject, status = 200): Response => {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const authHeader = req.headers.get("Authorization");

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({ error: "Missing Supabase environment variables." }, 500);
    }

    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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

    const { data: userData, error: userError } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (userError || !userId) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const warnings: JsonObject[] = [];
    const tables: Record<string, TableExportResult> = {};

    for (const spec of TABLE_SPECS) {
      let filter: FetchFilter;
      if (spec.filterType === "user_id") {
        filter = { type: "user_id", userId };
      } else {
        const baseRows = tables[spec.relationExportKey || ""]?.rows || [];
        const values = uniqueStringIds(baseRows.map((row) => row.id));
        filter = { type: "in", column: spec.inColumn || "id", values };
      }

      tables[spec.exportKey] = await fetchFromCandidates(
        supabase,
        spec.exportKey,
        spec.candidates,
        filter,
        warnings,
      );
    }

    const requestUrl = new URL(req.url);
    const dateRangeFilter = resolveDateRangeFilter(requestUrl);
    const financialSummary = buildFinancialSummary(tables, dateRangeFilter);
    const legacyFinancialSummary = buildLegacyFinancialSummary(tables, dateRangeFilter);
    maybeLogFinancialDelta(dateRangeFilter.mode, legacyFinancialSummary, financialSummary);
    const exportedAt = new Date().toISOString();
    const fileDateStamp = exportedAt.slice(0, 10).replace(/-/g, "");
    const fileName = `rarebits-backup-${fileDateStamp}.zip`;

    const tableCounts = Object.fromEntries(
      Object.entries(tables).map(([key, value]) => [key, value.rows.length]),
    ) as Record<string, number>;

    const revenueItem = toNumber(financialSummary.revenue_item, 0);
    const shippingCharged = toNumber(financialSummary.shipping_charged, 0);
    const totalRevenue = toNumber(financialSummary.total_revenue, 0);
    const itemCostTotal = toNumber(financialSummary.item_cost_total, 0);
    const shippingCostTotal = toNumber(financialSummary.shipping_cost_total, 0);
    const platformFeesTotal = toNumber(financialSummary.platform_fees_total, 0);
    const goodwillAdjustmentsTotal = toNumber(financialSummary.goodwill_adjustments_total, 0);
    const totalExpense = toNumber(financialSummary.total_expense, 0);
    const netProfitCurrent = toNumber(financialSummary.net_profit_current, 0);
    const invoiceCount = Math.max(Math.trunc(toNumber(financialSummary.sold_invoice_count, 0)), 0);
    const settledInvoiceCount = Math.max(Math.trunc(toNumber(financialSummary.settled_invoice_count, 0)), 0);
    const walletBalance = calculateWalletBalance(tables.wallets?.rows || []);
    const inventoryValue = calculateInventoryValue(tables.inventory?.rows || []);
    const metadataWithoutChecksum: JsonObject = {
      export_timestamp: exportedAt,
      trigger: "manual",
      schedule: null,
      date_range_active_filter: dateRangeFilter.metadata,
      // `revenue_item` follows dashboard "Revenue Item", `total_revenue` adds shipping charged.
      revenue_item: revenueItem,
      shipping_charged: shippingCharged,
      item_cost_total: itemCostTotal,
      shipping_cost_total: shippingCostTotal,
      platform_fees_total: platformFeesTotal,
      goodwill_adjustments_total: goodwillAdjustmentsTotal,
      net_profit_current: netProfitCurrent,
      total_profit: netProfitCurrent,
      total_revenue: totalRevenue,
      total_expense: totalExpense,
      wallet_balance: walletBalance,
      invoice_count: invoiceCount,
      settled_invoice_count: settledInvoiceCount,
      inventory_value: inventoryValue,
      exported_tables: Object.fromEntries(
        Object.entries(tables).map(([key, value]) => [
          key,
          {
            source_table: value.sourceTable,
            row_count: value.rows.length,
          },
        ]),
      ),
      warnings,
    };

    const checksumPayload = {
      table_counts: tableCounts,
      metadata: metadataWithoutChecksum,
    };
    const checksum = await sha256Hex(JSON.stringify(checksumPayload));

    const metadata: JsonObject = {
      ...metadataWithoutChecksum,
      checksum,
    };

    await maybeInsertBusinessSnapshot(
      supabase,
      userId,
      fileName,
      metadata,
      {
        totalRevenue,
        totalExpense,
        netProfitCurrent,
        totalProfit: netProfitCurrent,
        walletBalance,
        invoiceCount,
        inventoryValue,
        checksum,
      },
      tableCounts,
      warnings,
    );

    const zipEntries: Array<{ name: string; content: string | Uint8Array }> = [];
    Object.values(tables).forEach((result) => {
      zipEntries.push({
        name: `csv/${result.exportKey}.csv`,
        content: toCsv(result.rows),
      });
      zipEntries.push({
        name: `json/${result.exportKey}.json`,
        content: `${JSON.stringify(result.rows, null, 2)}\n`,
      });
    });
    zipEntries.push({
      name: "metadata.json",
      content: `${JSON.stringify(metadata, null, 2)}\n`,
    });

    const zipBytes = createZip(zipEntries);

    return new Response(zipBytes, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "Failed to generate full backup.",
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
