# 03 - Inventori Dan Item

## Screenshot Placeholder

![Placeholder - Inventori Dan Item](./assets/03-inventory-form.png)

`TODO`: Gantikan dengan screenshot item form dan bahagian platform iklan.

## Tujuan Modul Inventori

Inventori digunakan untuk:
- simpan data item sebelum dijual,
- jejak status item,
- rujuk kos/harga,
- sedia data asas untuk invois.

## Medan Item Penting

1. Nama item
- Gunakan nama spesifik dan konsisten.

2. Kategori
- Penting untuk analitik kategori di dashboard.

3. Harga kos / harga jual
- Asas kiraan margin.

4. Kuantiti
- Pastikan kemas kini tepat untuk elak oversell.

5. Status
- Contoh: available, reserved, sold (bergantung aliran sistem).

6. Platform Jualan (Tempat Iklan)
- Rekod di mana item diiklankan (fungsi reminder operasi).

7. Platform Tempat Terjual
- Rekod di mana item benar-benar terjual (metadata item).

8. Tag
- Mudahkan penapisan dan grouping item.

9. Media gambar
- Satu cover + gallery.

## Cara Kerja Platform Pada Item

`platforms` dan `sold_platforms` pada item bertujuan:
1. Rujukan cepat listing item.
2. Bantuan option platform semasa bina invois.

Nota:
- Platform graf dashboard utama datang daripada `invoices.platform` (platform semasa jualan), bukan semata-mata dari item.

## Langkah Guna Item Form (Disyorkan)

1. Isi maklumat asas item.
2. Pilih kategori yang betul.
3. Isi kos dan harga sasaran.
4. Pilih platform iklan item.
5. Upload gambar jelas (cover dahulu).
6. Simpan item.

## Bila Item Terjual

1. Cipta invois dari item tersebut.
2. Pilih platform jualan invois ikut transaksi sebenar.
3. Selepas settled, semak status item/kesinambungan stok.

## Amalan Data Bersih Inventori

1. Elak nama item terlalu umum.
2. Elak tukar kategori selepas item sudah banyak transaksi kecuali perlu.
3. Gunakan tag untuk label operasi (contoh: high-demand, clearance).
4. Pastikan gambar cover sentiasa relevan.
