# 12 - Advanced Guide

Panduan ini untuk pengguna yang sudah stabil dengan aliran asas dan mahu naikkan kualiti operasi.

## Screenshot Placeholder

![Placeholder - Advanced Guide](./assets/12-advanced-ops.png)

`TODO`: Gantikan dengan screenshot gabungan dashboard + wallet + data safety.

## Fokus Advanced

1. Data quality discipline.
2. Margin-aware pricing dan platform analysis.
3. SOP backup/restore yang konsisten.
4. Audit mingguan dan monthly close.

## A) Data Quality Discipline

1. Standardkan format nama item
- Elak variasi ejaan yang mengganggu carian.

2. Standardkan platform invois
- Guna label konsisten untuk graf platform yang bersih.

3. Pastikan setiap transaksi penting ada resit
- Terutama expense dan adjustment berisiko.

4. Guna nota untuk kes special
- Contoh diskaun luar biasa atau return separa.

## B) Margin-Aware Operations

1. Semak net profit, bukan revenue sahaja.
2. Aktifkan platform fee rules yang benar-benar digunakan.
3. Pantau kesan `courier mode` pada margin.
4. Asingkan item high-margin vs low-margin dengan tag/kategori.

## C) Advanced Invois Practice

1. Gunakan platform invois sebagai source of truth jualan.
2. Gunakan return/refund flow rasmi, jangan edit angka raw.
3. Lock disiplin status invois:
- draft -> paid -> (jika perlu) partially_returned/returned.

## D) Wallet Governance

1. Pisahkan wallet mengikut tujuan (contoh: Business / Reserve).
2. Elak adjustment kerap tanpa sebab dokumentasi.
3. Buat reconciliation mini:
- sample 20 transaksi terakhir lawan bukti resit.

## E) Backup & Restore SOP

1. Backup mingguan wajib.
2. Simpan salinan di lokasi luar aplikasi.
3. Uji restore sandbox berkala.
4. Disaster restore hanya ikut runbook dan checklist.

## F) Weekly Ops Review (Cadangan 30-45 Minit)

1. Dashboard:
- trend jualan,
- trend net profit,
- caj platform.

2. Inventori:
- stok aging,
- item slow-moving,
- item perlu clearance.

3. Wallet:
- expense luar biasa,
- transaksi tanpa resit.

4. Pelanggan:
- top buyer,
- pelanggan dormant.

## G) Monthly Close Ringkas

1. Tetapkan tempoh bulan penuh.
2. Kunci input data tertangguh.
3. Export data utama untuk arkib dalaman.
4. Snapshot backup akhir bulan.
5. Catat ringkasan keputusan operasi bulan tersebut.

## H) Anti-Pattern Yang Perlu Elak

1. Mengubah data lama tanpa jejak sebab.
2. Tidak membezakan platform item vs platform invois.
3. Mark paid lewat terlalu lama selepas transaksi sebenar.
4. Simpan resit di luar sistem sahaja tanpa pautan rekod.
