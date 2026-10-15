# E-Raport SMK 11 Maret Jakarta

Aplikasi web sederhana pengganti alur Excel raport:

- **Guru** dapat link + username + password → login → mengisi nilai di form yang
  **tampilannya mirip file Dafnil Excel** (No, NIS, NISN, Nama, Absensi, NH, PTS,
  NR otomatis). Wali kelas mengisi kehadiran (S/I/A/Terlambat), Catatan Kasus,
  Tindak Lanjut, dan Catatan Pembelajaran di form mirip sheet CAS.
- **Kurikulum (admin)** melihat **Legger** yang tersinkron otomatis — tampilannya
  mirip file Legger Excel (14 kolom mapel, Jumlah, Rata-rata, Rank, Kepribadian,
  Absensi, Catatan) — siap cetak (landscape).

## Rumus

- `NR = Absensi × 0,1 + NH × 0,6 + PTS × 0,3` (persis rumus `=E9*10%+F9*60%+G9*30%`
  di file Dafnil)
- Legger: `Jumlah = SUM(14 mapel)`, `Rat = AVERAGE(14 mapel)`,
  `Rank = peringkat per kelas` (persis rumus Excel)

## Jalankan lokal

```bash
npm install
node server.js   # http://localhost:3100
```

Login awal: username `admin`, password dari env `ADMIN_PASSWORD`
(default `admin123` — segera ganti).

Data awal (25 kelas, 855 siswa, wali kelas, 22 mapel, periode "Mid Ganjil
2026/2027") terisi otomatis dari `seed.json` saat database masih kosong.

## Deploy Railway

1. Push folder ini ke repo GitHub baru.
2. Di Railway: New Project → Deploy from GitHub.
3. Tambah **Volume** dan set `DB_PATH=/data/data.sqlite` (wajib, supaya data
   tidak hilang saat redeploy).
4. Set env `ADMIN_PASSWORD` dengan password admin yang kuat.
5. Buka link publik → login sebagai admin → buat akun guru → tugaskan mapel.

## Alur kerja tiap semester

1. Admin (kurikulum): buat akun guru di tab **Guru & Tugas**, tugaskan
   mapel × kelas, tautkan wali kelas.
2. Guru: login → **Isi Nilai** (per mapel per kelas) → **SIMPAN NILAI**.
   Wali kelas: **Isi Catatan**.
3. Admin: pantau di tab **Progres**, lihat/cetak di tab **Legger**.
4. Ganti semester: tab **Data & Backup** → tambah periode baru → **Aktifkan**.
   Nilai periode lama tetap tersimpan.
5. **Backup** rutin via tab Data & Backup (unduh JSON).

## Struktur

- `server.js` — Express + `node:sqlite` (tanpa kompilasi). Pragmas
  `journal_mode=WAL; synchronous=NORMAL; locking_mode=EXCLUSIVE` dipasang
  karena filesystem btrfs di VM dev membuat pola tulis standar macet.
- `public/login.html`, `public/guru.html`, `public/admin.html`, `public/style.css`
- `seed.json` — data awal hasil ekstraksi file Dafnil Excel.
- Prinsip: **update kode tidak pernah menghapus data** (skema dibuat dengan
  `IF NOT EXISTS`; backup/restore tersedia di panel admin).
