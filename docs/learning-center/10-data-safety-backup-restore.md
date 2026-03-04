# 10 - Data Safety, Backup Dan Restore

## Screenshot Placeholder

![Placeholder - Data Safety Backup Restore](./assets/10-backup-restore.png)

`TODO`: Gantikan dengan screenshot Data Safety dan panel hasil restore.

## Tujuan

Data Safety memastikan data bisnes boleh dipulihkan jika berlaku:
- human error,
- kerosakan data,
- isu deployment,
- kehilangan media penting.

## Fungsi Utama Data Safety

1. Full backup export
- Muat turun backup data.
- Opsyen termasuk media.

2. Restore Media Sandbox
- Uji restore media dalam ruang sandbox tanpa overwrite produksi.

3. Disaster Restore (cross-account)
- Restore data + media dengan kawalan keselamatan tambahan.

4. Observability restore
- Papar phase, duration, reconciliation, conflict, error summary.

5. Idempotency replay
- Request restore sama boleh replay result tanpa jalankan proses penuh semula.

## Cadangan SOP Backup

## Kekerapan

1. Harian (jika transaksi aktif tinggi)
2. Mingguan (minimum untuk operasi kecil)
3. Sebelum perubahan besar sistem/deploy

## Polisi Simpanan

1. Simpan backup sekurang-kurangnya di 2 lokasi.
2. Label backup dengan tarikh dan konteks.
3. Simpan satu salinan “known good snapshot”.

## Aliran Restore Selamat

1. Gunakan sandbox restore dahulu (media test).
2. Semak hasil:
- conflicts,
- missing parent,
- failed count,
- reconciliation totals.
3. Hanya teruskan disaster restore jika checklist lulus.
4. Untuk akaun tidak kosong, gunakan `force_wipe` hanya selepas sahkan risiko.

## Semakan Selepas Restore

1. Kiraan row utama
- clients/customers, invoices, invoice_items, wallets, transactions.

2. Semakan UI
- Dashboard, Pelanggan, Invois, Wallet.

3. Semakan media
- Cover image item dan attachment penting.

4. Semakan random spot-check
- 5 invois lama dan 5 transaksi wallet.

## Risiko Yang Perlu Faham

1. Disaster restore boleh overwrite konteks akaun sasaran.
2. Duplicate request restore tanpa idempotency boleh sebabkan data berganda.
3. Restored media mungkin conflict jika path sama sudah wujud.

## Prinsip Production Safe

1. Backup dulu sebelum restore.
2. Jangan skip validation output restore.
3. Dokumentasikan setiap restore event (masa, mode, outcome).
