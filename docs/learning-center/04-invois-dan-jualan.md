# 04 - Invois Dan Jualan

## Screenshot Placeholder

![Placeholder - Invois Dan Jualan](./assets/04-invoice-create.png)

`TODO`: Gantikan dengan screenshot borang invois (platform, caj platform, dan action utama).

## Tujuan Modul Invois

Invois ialah pusat rekod jualan:
- item yang dijual,
- harga dan kuantiti,
- pelanggan,
- platform jualan,
- caj platform,
- status bayaran,
- penghantaran.

## Aliran Asas Invois

1. Pilih pelanggan (atau tanpa pelanggan jika perlu).
2. Tambah item inventori atau item manual.
3. Tetapkan platform jualan invois.
4. Tetapkan penghantaran (walk-in/courier, seller/platform).
5. Pilih caj platform (opsyenal).
6. Simpan invois.
7. Tukar status ikut transaksi sebenar (paid/returned dan lain-lain).

## Platform Jualan Invois

Tujuan:
- Menentukan sumber jualan sebenar.
- Digunakan untuk graf platform dashboard.

Penting:
- Platform invois tidak wajib terikat dengan platform item.
- Ini beri fleksibiliti jika item terjual di channel lain.

## Caj Platform (Opsyen)

Anda boleh aktifkan lebih dari satu rule fee:
1. Percentage (%)
2. Flat (RM)
3. Basis kiraan (harga barang / caj pos / jumlah kutipan)

Kegunaan:
- Kiraan untung bersih lebih realistik.

## Mode Penghantaran

1. Seller uruskan courier
- Caj pos dan kos penghantaran direkod dalam aliran biasa.

2. Platform uruskan courier
- Aliran shipping tertentu dilaras supaya rekod konsisten.

Gunakan mode ini ikut transaksi sebenar supaya margin tidak tersasar.

## Status Invois

Umumnya meliputi:
1. Draft
2. Paid
3. Partially returned
4. Returned

Pastikan status sentiasa dikemas kini kerana ia memberi kesan pada:
- dashboard,
- wallet,
- laporan pelanggan.

## Fungsi Pada Invoice Detail

1. Cetak A4
- Untuk format profesional.

2. Cetak Thermal
- Untuk resit ringkas.

3. Export Paperang
- Untuk kegunaan printer mini/portable.

4. Send WhatsApp
- Hantar mesej invois dengan pautan/attachment flow yang disokong.

5. Tindakan operasi
- Mark paid, update shipment, mark courier paid, return/cancel item (ikut status).

## Best Practice Invois

1. Satu transaksi pelanggan = satu invois, jika practical.
2. Elak backdate tanpa sebab operasi jelas.
3. Isi platform jualan dengan konsisten.
4. Semak total/caj platform sebelum mark paid.
5. Guna nota untuk exception case.
