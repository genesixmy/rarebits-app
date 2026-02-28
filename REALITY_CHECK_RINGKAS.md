# Reality Check (Ringkas)

Dokumen ini menerangkan cara modul `Reality Check - Minggu Ini` dikira dan ayat yang digunakan di UI.

## 1) Tujuan
- Beri ringkasan cepat prestasi 7 hari terkini berbanding 7 hari sebelumnya.
- Tunjuk isu paling penting (maksimum 2 insight) dengan cadangan tindakan.

## 2) Sumber Data
- `invoice_items` + `invoices` + `invoice_item_returns`
- `inventoryItems` (untuk kira modal restock minggu ini)
- Hanya invois status:
  - `paid`
  - `partially_returned`
  - `returned`

Rujukan kod:
- `src/lib/dashboardRealityCheck.js`
- `src/components/Dashboard.jsx`

## 3) Window Tarikh
- `thisWeek`: hari ini hingga 6 hari lepas (7 hari).
- `prevWeek`: 7 hari sebelum `thisWeek`.

## 4) Formula Utama
- `itemRevenueTotal` = jumlah line revenue selepas tolak refund return per line.
- `costTotal` = kos unit * kuantiti bersih terjual.
- `platformFeeTotal` = jumlah `channel_fee_amount` ikut invoice.
- `shippingProfitTotal` = `shippingChargedTotal - shippingCostTotal`.
- `adjustmentTotal` = jumlah `invoice.adjustment_total`.
- `profitTotal` = `(itemRevenueTotal - costTotal - platformFeeTotal) + shippingProfitTotal - adjustmentTotal`.
- `revenueTotal` = `(itemRevenueTotal + shippingChargedTotal) - adjustmentTotal`.
- `shippingCoverageRatio` = `shippingCostTotal / shippingChargedTotal` (jika ada caj pos).

## 5) Rule Insight (Trigger)
- `no_sales` (ALERT):
  - Jika `thisWeek.revenueTotal <= 0`
- `revenue_profit_gap` (ALERT):
  - Jika revenue naik tapi profit naik lebih perlahan
- `profit_drop_with_sales` (ALERT):
  - Jika masih ada jualan, tapi profit minggu ini < minggu lepas
- `shipping_margin_pressure` (ALERT):
  - Jika `shippingCoverageRatio > 0.7`
- `restock_spike_low_sales` (INFO):
  - Jika modal stok baru tinggi, tapi jualan semasa rendah
- `healthy_movement` (GOOD):
  - Fallback bila tiada trigger di atas

Kemudian:
- Disusun ikut `priority`
- Ambil maksimum `2` insight

## 6) Severity Overall
- Jika ada insight `ALERT` -> `overallSeverity = ALERT`
- Jika tiada `ALERT` tapi ada `GOOD` -> `overallSeverity = GOOD`
- Selain itu -> `INFO`

## 7) Copy/UI Text (Ayat Tetap)
- Tajuk:
  - `Reality Check - Minggu Ini`
- Label dalam kad insight:
  - `Apa berlaku:`
  - `Kesan:`
  - `Cadangan:`
  - `Tip: fokus 1 tindakan dulu - perubahan kecil pun beri kesan.`
- Empty state:
  - `Tiada perubahan besar minggu ini. Teruskan pantau jualan dan margin.`
- Onboarding (bila minggu lepas belum cukup data):
  - `Ini minggu pertama data direkod. Reality Check akan mula memberi analisis selepas cukup sejarah jualan.`

## 8) Senarai Template Insight Semasa
- `Jualan Tiada`
- `Margin Tidak Ikut Jualan`
- `Keuntungan Menurun`
- `Caj Pos Terlalu Ketat`
- `Modal Baru Belum Bergerak`
- `Pergerakan Sihat`

Setiap template ada:
- `observation` (Apa berlaku)
- `impact` (Kesan)
- `suggestion` (Cadangan)

## 9) Nota Penting
- Reality Check guna model `net` (ambil kira return/refund, caj, fee, adjustment), jadi nilainya tidak sama dengan jumlah jualan kasar.
- UI hanya paparkan 2 insight paling penting untuk elak clutter.

## 10) Dead Capital (Ringkas)
### Tujuan
- Ukur berapa banyak modal stok yang “terkunci” dalam item lama tidak bergerak.

### Ambang
- Default: `60 hari` (`DEAD_CAPITAL_THRESHOLD_DAYS`).

### Cara Kira
- Untuk setiap item:
  - `qtyStuck = availableQty + reservedQty` (reserved masih kira modal terkunci).
  - `stockValue = costPerUnit * qtyStuck`.
  - Item dikira `dead` jika `ageDays >= thresholdDays`.
- Agregat:
  - `deadValue` = jumlah `stockValue` item dead.
  - `activeValue` = jumlah `stockValue` item aktif.
  - `totalStockValue = deadValue + activeValue`.
  - `deadPercent = deadValue / totalStockValue * 100`.
- Paparan bar:
  - Gaya “health” songsang: bar penuh = lebih sihat.
  - Lebar bar = `100 - deadPercent`.

### Output UI utama
- `X% modal sedang tidur`
- `RM deadValue / RM totalStockValue`
- Label tone:
  - `Tinggi` (>20%)
  - `Waspada` (>=10%)
  - `Sihat` (<10%)
- Tambahan:
  - `missingCostItemsCount` (item tiada kos, dikira RM0)
  - `topDeadItems` (maksimum 5 item nilai dead tertinggi)

### Ayat tetap di tooltip Dead Capital
- `Dead capital = modal terkunci dalam stok yang tidak terjual >= {threshold} hari.`
- `Kiraan: (Cost x Kuantiti tersedia) untuk item lama >= {threshold} hari.`
- `Termasuk unit reserved kerana modal masih terkunci.`
- `Kenapa ini penting: modal beku -> susah pusing stok & cashflow.`

## 11) Business Health (Ringkas)
### Tujuan
- Beri skor kesihatan bisnes (0–100) berdasarkan cash buffer, stok beku, kelajuan jualan, dan kategori underperform.

### Formula Skor
- Komponen:
  - `cashBufferDays = walletBalance / avgDailyExpenses30d`
  - `sellThrough30d = soldQty30d / activeStockQty`
  - `ratioStuck = stuckCapital60d / totalStockCostValue`
  - `underperformingCategoriesCount`:
    - kategori dengan stok bernilai tinggi (`>= threshold`)
    - tetapi jualan 30 hari = 0
- Point / deduction:
  - Cash buffer: max 30 point
  - Sell-through: max 25 point
  - Stuck capital: deduction max 30
  - Underperform category: deduction max 15
- Skor akhir:
  - `finalScore = clamp(100 - cashBufferPenalty - stuckCapitalDeduction - sellThroughPenalty - underperformDeduction, 0, 100)`

### Label Health
- `0-39`: `Critical`
- `40-59`: `Weak`
- `60-79`: `Stable`
- `80-100`: `Strong`

### Sebab utama (reasons) yang dipaparkan
- `stuck_capital`
- `underperform_categories`
- `cash_buffer_low`
- `sell_through_low`

### Output UI utama
- Tajuk: `Business Health`
- Nilai: `{score}%`
- Subtext: `Cash cover {cashBufferDays} hari`
- Fallback teks: `Tiada isu utama dikesan.`
