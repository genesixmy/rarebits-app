# 11 - FAQ Dan Troubleshooting

## Screenshot Placeholder

![Placeholder - FAQ Dan Troubleshooting](./assets/11-faq-debug-flow.png)

`TODO`: Gantikan dengan screenshot contoh ralat + langkah semak.

## 1) Kenapa graf platform dashboard tidak ikut platform item?

Sebab graf platform utama dikira daripada `platform` pada **invois** (sumber jualan sebenar), bukan semata-mata `platforms` item.

Semakan:
1. Buka invois berkaitan.
2. Pastikan field platform invois diisi betul.

## 2) Platform baru tidak muncul semasa invois?

Semak:
1. Nilai platform item (jika mahu guna cadangan dari item).
2. Pilihan platform invois semasa create/edit.
3. Simpan invois selepas perubahan.

## 3) Kenapa pelanggan nampak duplicate?

Punca biasa:
1. Restore berulang tanpa dedupe.
2. Data lama dengan emel/telefon sama tetapi ID berbeza.

Tindakan:
1. Audit duplicate berdasarkan emel/telefon.
2. Dedupe ikut SQL selamat.
3. Semak semula integriti FK invois -> client.

## 4) Kenapa nilai belanja pelanggan jadi 0?

Punca biasa:
1. Invois tidak linked kepada `client_id` yang betul.
2. Status invois bukan status settled yang dikira.

Tindakan:
1. Semak invois berkaitan client.
2. Semak status invois.
3. Semak query aggregation pelanggan.

## 5) Kenapa preview/send invois ke WhatsApp tidak seperti jangkaan?

Semak:
1. Mode fallback share (native share vs deep link).
2. Link share invois/short link tersedia.
3. Tetapan brand A4/thermal yang digunakan semasa render.

## 6) Kenapa resit wallet tidak boleh preview?

Semak:
1. Jenis fail disokong preview (imej/PDF).
2. Signed URL boleh dijana.
3. Ralat permission bucket/policy.

## 7) Bagaimana audit data mingguan dengan cepat?

Cadangan:
1. Semak dashboard 30 hari.
2. Semak 20 transaksi wallet terbaru + resit.
3. Semak 10 invois terakhir (platform, status, total).
4. Muat turun backup penuh.

## 8) Bila perlu guna disaster restore?

Guna bila:
1. Akaun sasaran perlu dipulihkan dari backup penuh.
2. Ujian sandbox sudah lulus.
3. Anda faham implikasi `force_wipe`.

## 9) Checklist cepat sebelum lapor bug

1. Nyatakan modul terlibat.
2. Nyatakan ID rekod (invoice_id/transaction_id/item_id).
3. Sertakan langkah ulang ralat.
4. Sertakan screenshot + output error ringkas.
5. Nyatakan waktu kejadian.
