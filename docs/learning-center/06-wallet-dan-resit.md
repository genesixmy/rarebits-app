# 06 - Wallet Dan Resit

## Screenshot Placeholder

![Placeholder - Wallet Dan Resit](./assets/06-wallet-receipts.png)

`TODO`: Gantikan dengan screenshot wallet account + halaman Senarai Resit Wallet.

## Tujuan Modul Wallet

Wallet digunakan untuk rekod aliran tunai operasi:
- duit masuk jualan,
- duit keluar belanja,
- topup/transfer/adjustment,
- lampiran resit sebagai bukti transaksi.

## Struktur Wallet

1. Banyak akaun wallet boleh diwujudkan.
2. Setiap wallet boleh diurus secara berasingan.
3. Ringkasan baki dipaparkan pada page wallet.

## Jenis Transaksi

Jenis utama yang lazim:
1. Sale
2. Expense
3. Topup
4. Transfer in / Transfer out
5. Adjustment

Gunakan jenis yang betul untuk pastikan laporan kewangan konsisten.

## Lampiran Resit (Opsyenal)

Anda boleh upload resit semasa cipta/sunting transaksi.

Peraturan semasa:
1. Imej akan dikompres automatik untuk jimat storan.
2. PDF kekal asal (tidak dikompres).
3. Sesetengah jenis transaksi boleh hadkan lampiran ikut aturan sistem.

## Cara Guna Resit Dengan Praktikal

1. Lampirkan resit terutama untuk expense penting.
2. Gunakan nama fail jelas (contoh: `postage-2026-03-04.jpg`).
3. Simpan bukti transaksi yang berisiko dipertikaikan.

## Halaman Senarai Resit Wallet

Fungsi:
1. Papar semua transaksi yang ada lampiran resit.
2. Filter ikut wallet, tarikh, carian teks.
3. Preview resit dalam modal.
4. Muat turun resit individu.
5. Muat turun semua ikut filter sebagai ZIP + manifest CSV.

## Aliran Audit Ringkas

Setiap hujung minggu:
1. Filter minggu semasa.
2. Muat turun ZIP resit.
3. Simpan salinan luar sistem (cloud drive/private archive).
4. Semak transaksi tanpa resit yang sepatutnya ada bukti.

## Best Practice Wallet

1. Rekod transaksi pada hari sama, jangan bertangguh lama.
2. Elak adjustment tanpa nota sebab.
3. Asingkan wallet Business vs Personal jika perlu.
4. Semak baki wallet dengan dashboard secara berkala.
