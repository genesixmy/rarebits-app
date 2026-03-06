// Central query key map for gradual migration.
// Use these helpers for new code and safe refactors.

export const queryKeys = {
  auth: () => ["auth"],
  user: () => ["user"],

  invoices: {
    all: () => ["invoices"],
    detail: (invoiceId) => ["invoice", invoiceId],
    itemsByUser: (userId) => ["invoice-items", userId],
    shipmentStatusList: (userId, shipmentIds = []) => [
      "invoice-list-shipment-statuses",
      userId,
      shipmentIds,
    ],
  },

  inventory: {
    itemsByUser: (userId) => ["items", userId],
    availableItemsByUser: (userId) => ["available-items", userId],
    uninvoicedByUser: (userId) => ["uninvoiced-items", userId],
    uninvoicedByClient: (clientId, userId) => ["uninvoiced-items", clientId, userId],
  },

  clients: {
    allByUser: (userId) => ["clients", userId],
    detail: (clientId) => ["client", clientId],
    // Legacy alias still exists in codebase; keep helper for transition only.
    legacyPelanggan: () => ["pelanggan"],
  },

  wallet: {
    allByUser: (userId) => ["wallets", userId],
    account: (accountId, userId) => ["wallet", accountId, userId],
    transactionsAllByUser: (userId) => ["transactions", userId, "all"],
    transactionsByAccount: (accountId, userId) => ["transactions", accountId, userId],
    receiptsByUser: (userId) => ["wallet-receipts", userId],
    allWalletsByUser: (userId) => ["allWallets", userId],
  },

  dashboard: {
    root: () => ["dashboard"],
    salesByUser: (userId) => ["dashboard-sales", userId],
    categoriesByUser: (userId) => ["dashboard-categories", userId],
    businessWalletsByUser: (userId) => ["business-wallets", userId],
    businessBalanceByUser: (userId) => ["dashboard-business-wallet-balance", userId],
    expensesByUserAndRange: (userId, walletCount, startDate, endDate) => [
      "dashboard-expenses",
      userId,
      walletCount,
      startDate,
      endDate,
    ],
    refundsByUserAndRange: (userId, startDate, endDate) => [
      "dashboard-refunds",
      userId,
      startDate,
      endDate,
    ],
  },

  reminders: {
    allByUser: (userId) => ["reminders", userId],
    occurrencesByUser: (userId) => ["reminder-occurrences", userId],
    dashboardTodayByUser: (userId) => ["dashboard-reminders-today", userId],
    dashboardOccurrencesByUser: (userId) => ["dashboard-reminder-occurrences", userId],
  },
};

