# 01 - Pengenalan Dan Aliran Kerja

## Screenshot Placeholder

![Placeholder - Pengenalan Dan Aliran](./assets/01-overview-flow.png)

`TODO`: Gantikan dengan screenshot aliran utama Rarebits (Dashboard -> Inventori -> Invois -> Wallet).

## Rarebits Untuk Siapa

Rarebits sesuai untuk peniaga kecil yang perlukan rekod operasi yang teratur:
- jual beli item fizikal,
- mahu tahu untung/rugi sebenar,
- simpan bukti transaksi dan resit,
- mahu sistem ringkas tanpa proses akaun kompleks.

## Konsep Teras: Operational Truth

Prinsip utama Rarebits:
1. Rekod transaksi sebenar, bukan anggaran.
2. Satu sumber kebenaran untuk operasi harian.
3. Setiap angka dashboard mesti boleh dijejak semula ke data asas.

## Struktur Data Ringkas

Aliran data utama:
1. `Item` dicipta dalam Inventori.
2. Item dimasukkan ke `Invois` apabila terjual.
3. Invois (bila paid/settled) mempengaruhi rekod `Wallet`.
4. Invois juga memaut kepada `Pelanggan`.
5. `Dashboard` merumuskan data item/invois/wallet.

## Setup Hari Pertama (Checklist)

1. Tetapkan profil syarikat
- Nama syarikat, alamat, telefon, emel.

2. Wujudkan kategori item
- Contoh: Figure, Card, Sealed, Loose, Accessories.

3. Cipta wallet utama
- Sekurang-kurangnya satu wallet Business.

4. Semak tetapan invois
- Brand, logo, format cetak, QR (jika guna), pautan marketplace.

5. Sediakan platform fee rules (jika perlu)
- Contoh: 2% dari harga barang, atau fixed RM4.

6. Masukkan beberapa item contoh
- Untuk uji aliran item -> invois -> wallet.

7. Buat satu invois percubaan
- Pastikan angka, status, dan paparan dashboard masuk betul.

## Rutin Operasi Disyorkan

## Harian

1. Kemas kini item baru / stok masuk.
2. Rekod invois untuk setiap jualan.
3. Lengkapkan transaksi expense/topup/adjustment di wallet.
4. Lampirkan resit untuk transaksi yang relevan.

## Mingguan

1. Semak dashboard 30 hari.
2. Semak item slow-moving/aging.
3. Semak reminder tertunggak.
4. Muat turun backup penuh.

## Bulanan

1. Semak untung bersih, caj platform, refund/adjustment.
2. Export data jualan/wallet untuk rujukan dalaman.
3. Audit sampel: 5-10 transaksi pastikan bukti resit lengkap.

## Prinsip Data Bersih

1. Jangan gabung beberapa jualan dalam satu invois tanpa sebab.
2. Platform jualan isi pada invois sebenar (source of sale).
3. Elak edit retrospektif tanpa nota sebab perubahan.
4. Simpan lampiran resit untuk transaksi outflow penting.
