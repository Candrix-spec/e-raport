// E-Raport SMK 11 Maret Jakarta
// Guru mengisi nilai via web (tampilan mirip file Dafnil Excel) -> otomatis tersinkron ke Legger.
// Stack: Express + node:sqlite (tanpa kompilasi, tanpa dependency native).
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3100;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
// Pragmas agar SQLite stabil di semua filesystem (termasuk btrfs di VM ini,
// yang membuat pola tulis journal-mode standar macet di level kernel):
// WAL = tulis sequential, NORMAL = fsync lebih jarang, EXCLUSIVE = aman karena
// hanya satu proses Node yang memegang DB ini.
db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA synchronous=NORMAL');
db.exec('PRAGMA locking_mode=EXCLUSIVE');

// ---------- util ----------
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const nowISO = () => new Date().toISOString();
function round2(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  if (!isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}
function hitungNR(vals, bobot) {
  // vals: {absensi, nh, pts} ; bobot: [{key, bobot}]
  let total = 0, ada = false;
  for (const b of bobot) {
    const v = vals[b.key];
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (!isFinite(n)) continue;
    ada = true;
    total += n * b.bobot;
  }
  return ada ? round2(total) : null;
}

// ---------- skema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  nama TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'guru',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL,
  tahun TEXT NOT NULL,
  semester TEXT NOT NULL,
  kolom TEXT NOT NULL,
  aktif INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kode TEXT NOT NULL,
  nama TEXT NOT NULL,
  jurusan TEXT NOT NULL DEFAULT 'UMUM',
  urutan INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT UNIQUE NOT NULL,
  tingkat TEXT NOT NULL,
  jurusan TEXT NOT NULL,
  wali TEXT NOT NULL DEFAULT '',
  wali_user_id INTEGER
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nis TEXT NOT NULL,
  nisn TEXT NOT NULL DEFAULT '',
  nama TEXT NOT NULL,
  class_id INTEGER NOT NULL,
  no_urut INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  class_id INTEGER NOT NULL,
  UNIQUE(user_id, subject_id, class_id)
);
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  absensi REAL,
  nh REAL,
  pts REAL,
  nr REAL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER,
  UNIQUE(period_id, student_id, subject_id)
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  s INTEGER DEFAULT 0,
  i INTEGER DEFAULT 0,
  a INTEGER DEFAULT 0,
  terlambat INTEGER DEFAULT 0,
  kasus TEXT DEFAULT '',
  tindak_lanjut TEXT DEFAULT '',
  catatan TEXT DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by INTEGER,
  UNIQUE(period_id, student_id)
);
`);

// ---------- seed ----------
function jurusanDariKelas(nama) {
  const n = (nama || '').toLowerCase();
  if (n.includes('akuntansi')) return 'AK';
  if (n.includes('perkantoran')) return 'AP';
  if (n.includes('jaringan')) return 'TKJ';
  return 'UMUM';
}
function seed() {
  const nUser = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (nUser > 0) return;
  console.log('[seed] database kosong, mengisi data awal...');
  db.prepare('INSERT INTO users (username,password,nama,role,created_at) VALUES (?,?,?,?,?)')
    .run('admin', sha256(ADMIN_PASSWORD), 'Administrator (Kurikulum)', 'admin', nowISO());
  const kolomMid = JSON.stringify([
    { key: 'absensi', label: 'Absensi', bobot: 0.1 },
    { key: 'nh', label: 'NH', bobot: 0.6 },
    { key: 'pts', label: 'PTS', bobot: 0.3 },
  ]);
  const p = db.prepare('INSERT INTO periods (nama,tahun,semester,kolom,aktif,created_at) VALUES (?,?,?,?,?,?)')
    .run('Mid Ganjil', '2026/2027', 'GANJIL', kolomMid, 1, nowISO());
  console.log('[seed] periode aktif id =', p.lastInsertRowid);
  // mapel sesuai kolom Legger
  const mapel = [
    ['PAI','PAI','UMUM'], ['PPKn','PPKn','UMUM'], ['B.Indo','B.Indo','UMUM'], ['Penjas','Penjas','UMUM'],
    ['Sejarah','Sejarah','UMUM'], ['Seni Budaya','Seni Budaya','UMUM'], ['Matematika','Matematika','UMUM'],
    ['Bhs Inggris','Bhs Inggris','UMUM'],
    ['AK.Pes.Jasa','AK.Pes.Jasa','AK'], ['Ak.Lembaga','Ak.Lembaga','AK'], ['AK.Keuangan','AK.Keuangan','AK'],
    ['Komp.AK','Komp.AK','AK'], ['Adm.Pajak','Adm.Pajak','AK'],
    ['Adm.Pegawai','Adm.Pegawai','AP'], ['Adm.Keuangan','Adm.Keuangan','AP'], ['Adm.Sarpras','Adm.Sarpras','AP'],
    ['Adm.Humas','Adm.Humas','AP'],
    ['WAN','WAN','TKJ'], ['TIJ','TIJ','TKJ'], ['ASJ','ASJ','TKJ'], ['TLJ','TLJ','TKJ'],
    ['Produk Kreatif','Produk Kreatif','ALL'],
  ];
  const insS = db.prepare('INSERT INTO subjects (kode,nama,jurusan,urutan) VALUES (?,?,?,?)');
  mapel.forEach((m, i) => insS.run(m[0], m[1], m[2], i));
  // kelas + siswa dari seed.json
  try {
    const seedData = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));
    const insC = db.prepare('INSERT INTO classes (nama,tingkat,jurusan,wali) VALUES (?,?,?,?)');
    const classId = {};
    for (const k of seedData.classes) {
      const r = insC.run(k.nama, k.tingkat, jurusanDariKelas(k.nama), k.wali || '');
      classId[k.nama] = r.lastInsertRowid;
    }
    const insSt = db.prepare('INSERT INTO students (nis,nisn,nama,class_id,no_urut) VALUES (?,?,?,?,?)');
    let n = 0;
    for (const s of seedData.students) {
      if (!classId[s.kelas]) continue;
      insSt.run(s.nis || '', s.nisn || '', s.nama || '', classId[s.kelas], s.no || 0);
      n++;
    }
    console.log(`[seed] ${seedData.classes.length} kelas, ${n} siswa`);
  } catch (e) {
    console.log('[seed] seed.json tidak ditemukan, lewati:', e.message);
  }
  if (ADMIN_PASSWORD === 'admin123') {
    console.log('[seed] PENTING: password admin = "admin123". Ganti via env ADMIN_PASSWORD sebelum deploy / via panel admin.');
  }
}
seed();

function periodeAktif() {
  return db.prepare('SELECT * FROM periods WHERE aktif=1 ORDER BY id DESC').get()
      || db.prepare('SELECT * FROM periods ORDER BY id DESC').get();
}
function mapelUntukKelas(jurusan) {
  // 8 umum + mapel jurusan + Produk Kreatif (urutan seperti Legger)
  return db.prepare(`SELECT * FROM subjects WHERE jurusan IN ('UMUM', ?) OR jurusan='ALL' ORDER BY urutan`).all(jurusan);
}

// ---------- sesi ----------
const sessions = new Map();
function buatSesi(userId) {
  const t = crypto.randomBytes(24).toString('hex');
  sessions.set(t, { userId, dibuat: Date.now() });
  return t;
}
function userDariReq(req) {
  const c = req.headers.cookie || '';
  const m = c.match(/(?:^|;\s*)sesi=([a-f0-9]+)/);
  if (!m) return null;
  const s = sessions.get(m[1]);
  if (!s) return null;
  return db.prepare('SELECT id,username,nama,role FROM users WHERE id=?').get(s.userId) || null;
}
function perluLogin(req, res, next) {
  const u = userDariReq(req);
  if (!u) return res.status(401).json({ ok: false, error: 'belum login' });
  req.user = u;
  next();
}
function perluAdmin(req, res, next) {
  const u = userDariReq(req);
  if (!u || u.role !== 'admin') return res.status(403).json({ ok: false, error: 'khusus admin' });
  req.user = u;
  next();
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '5mb' }));

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || '').trim());
  if (!u || u.password !== sha256(password || '')) {
    return res.status(401).json({ ok: false, error: 'Username atau password salah' });
  }
  const t = buatSesi(u.id);
  res.setHeader('Set-Cookie', `sesi=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  res.json({ ok: true, user: { id: u.id, username: u.username, nama: u.nama, role: u.role } });
});
app.post('/api/logout', (req, res) => {
  const c = req.headers.cookie || '';
  const m = c.match(/(?:^|;\s*)sesi=([a-f0-9]+)/);
  if (m) sessions.delete(m[1]);
  res.setHeader('Set-Cookie', 'sesi=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => {
  const u = userDariReq(req);
  res.json({ ok: true, user: u });
});
app.get('/api/periode', perluLogin, (req, res) => {
  const p = periodeAktif();
  res.json({ ok: true, periode: p ? { ...p, kolom: JSON.parse(p.kolom) } : null });
});

// ---------- guru ----------
app.get('/api/tugas', perluLogin, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, s.id subject_id, s.kode mapel, c.id class_id, c.nama kelas, c.wali, c.tingkat
    FROM assignments a
    JOIN subjects s ON s.id=a.subject_id
    JOIN classes c ON c.id=a.class_id
    WHERE a.user_id=?
    ORDER BY c.tingkat, c.nama, s.urutan`).all(req.user.id);
  res.json({ ok: true, tugas: rows });
});
app.get('/api/tugas/:id', perluLogin, (req, res) => {
  const t = db.prepare(`
    SELECT a.id, s.id subject_id, s.kode mapel, c.id class_id, c.nama kelas, c.wali, c.tingkat
    FROM assignments a
    JOIN subjects s ON s.id=a.subject_id
    JOIN classes c ON c.id=a.class_id
    WHERE a.id=?`).get(req.params.id);
  if (!t) return res.status(404).json({ ok: false, error: 'tugas tidak ditemukan' });
  if (req.user.role !== 'admin') {
    const own = db.prepare('SELECT id FROM assignments WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!own) return res.status(403).json({ ok: false, error: 'bukan tugas Anda' });
  }
  const p = periodeAktif();
  const kolom = JSON.parse(p.kolom);
  const siswa = db.prepare(`
    SELECT st.id, st.no_urut no, st.nis, st.nisn, st.nama, g.absensi, g.nh, g.pts, g.nr
    FROM students st
    LEFT JOIN grades g ON g.student_id=st.id AND g.period_id=? AND g.subject_id=?
    WHERE st.class_id=? ORDER BY st.no_urut, st.nama`).all(p.id, t.subject_id, t.class_id);
  res.json({ ok: true, tugas: t, periode: { id: p.id, nama: p.nama, tahun: p.tahun, semester: p.semester, kolom }, siswa });
});
app.post('/api/nilai', perluLogin, (req, res) => {
  const { assignment_id, rows } = req.body || {};
  const t = db.prepare('SELECT * FROM assignments WHERE id=?').get(assignment_id);
  if (!t) return res.status(404).json({ ok: false, error: 'tugas tidak ditemukan' });
  if (req.user.role !== 'admin') {
    if (t.user_id !== req.user.id) return res.status(403).json({ ok: false, error: 'bukan tugas Anda' });
  }
  const p = periodeAktif();
  const kolom = JSON.parse(p.kolom);
  const up = db.prepare(`INSERT INTO grades (period_id,student_id,subject_id,absensi,nh,pts,nr,updated_at,updated_by)
    VALUES (?,?,?,?,?,?,?, ?, ?)
    ON CONFLICT(period_id,student_id,subject_id) DO UPDATE SET
      absensi=excluded.absensi, nh=excluded.nh, pts=excluded.pts, nr=excluded.nr,
      updated_at=excluded.updated_at, updated_by=excluded.updated_by`);
  const cekSiswa = db.prepare('SELECT id FROM students WHERE id=? AND class_id=?');
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const r of (rows || [])) {
      if (!cekSiswa.get(r.student_id, t.class_id)) continue;
      const vals = {};
      for (const k of kolom) {
        const v = r[k.key];
        vals[k.key] = (v === '' || v === null || v === undefined) ? null : round2(v);
      }
      const nr = hitungNR(vals, kolom);
      up.run(p.id, r.student_id, t.subject_id, vals.absensi ?? null, vals.nh ?? null, vals.pts ?? null, nr, nowISO(), req.user.id);
      n++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true, tersimpan: n });
});

// catatan wali kelas (mirip sheet CAS)
app.get('/api/wali', perluLogin, (req, res) => {
  const rows = db.prepare('SELECT id class_id, nama kelas, tingkat, wali FROM classes WHERE wali_user_id=? ORDER BY tingkat, nama').all(req.user.id);
  res.json({ ok: true, kelas: rows });
});
app.get('/api/wali/:class_id', perluLogin, (req, res) => {
  const k = db.prepare('SELECT * FROM classes WHERE id=?').get(req.params.class_id);
  if (!k) return res.status(404).json({ ok: false });
  if (req.user.role !== 'admin' && k.wali_user_id !== req.user.id)
    return res.status(403).json({ ok: false, error: 'Anda bukan wali kelas ini' });
  const p = periodeAktif();
  const siswa = db.prepare(`
    SELECT st.id, st.no_urut no, st.nis, st.nisn, st.nama,
           n.s, n.i, n.a, n.terlambat, n.kasus, n.tindak_lanjut, n.catatan
    FROM students st LEFT JOIN notes n ON n.student_id=st.id AND n.period_id=?
    WHERE st.class_id=? ORDER BY st.no_urut, st.nama`).all(p.id, k.id);
  res.json({ ok: true, kelas: k, periode: { id: p.id, nama: p.nama, tahun: p.tahun, semester: p.semester }, siswa });
});
app.post('/api/catatan', perluLogin, (req, res) => {
  const { class_id, rows } = req.body || {};
  const k = db.prepare('SELECT * FROM classes WHERE id=?').get(class_id);
  if (!k) return res.status(404).json({ ok: false });
  if (req.user.role !== 'admin' && k.wali_user_id !== req.user.id)
    return res.status(403).json({ ok: false, error: 'Anda bukan wali kelas ini' });
  const p = periodeAktif();
  const up = db.prepare(`INSERT INTO notes (period_id,student_id,s,i,a,terlambat,kasus,tindak_lanjut,catatan,updated_at,updated_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(period_id,student_id) DO UPDATE SET
      s=excluded.s, i=excluded.i, a=excluded.a, terlambat=excluded.terlambat,
      kasus=excluded.kasus, tindak_lanjut=excluded.tindak_lanjut, catatan=excluded.catatan,
      updated_at=excluded.updated_at, updated_by=excluded.updated_by`);
  const cek = db.prepare('SELECT id FROM students WHERE id=? AND class_id=?');
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const r of (rows || [])) {
      if (!cek.get(r.student_id, class_id)) continue;
      const intv = (v) => { const x = parseInt(v, 10); return isFinite(x) && x >= 0 ? x : 0; };
      up.run(p.id, r.student_id, intv(r.s), intv(r.i), intv(r.a), intv(r.terlambat),
        String(r.kasus || ''), String(r.tindak_lanjut || ''), String(r.catatan || ''), nowISO(), req.user.id);
      n++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true, tersimpan: n });
});

// ---------- admin ----------
app.get('/api/admin/dashboard', perluAdmin, (req, res) => {
  const p = periodeAktif();
  const kelas = db.prepare('SELECT * FROM classes ORDER BY tingkat, nama').all();
  const out = kelas.map(k => {
    const mapel = mapelUntukKelas(k.jurusan);
    const nSiswa = db.prepare('SELECT COUNT(*) c FROM students WHERE class_id=?').get(k.id).c;
    const terisi = {};
    for (const m of mapel) {
      terisi[m.id] = db.prepare(
        'SELECT COUNT(*) c FROM grades WHERE period_id=? AND subject_id=? AND student_id IN (SELECT id FROM students WHERE class_id=?) AND nr IS NOT NULL'
      ).get(p.id, m.id, k.id).c;
    }
    return { id: k.id, nama: k.nama, tingkat: k.tingkat, jurusan: k.jurusan, wali: k.wali, nSiswa, mapel: mapel.map(m => ({ id: m.id, kode: m.kode })), terisi };
  });
  const guru = db.prepare(`SELECT u.id, u.username, u.nama,
      (SELECT COUNT(*) FROM assignments a WHERE a.user_id=u.id) n_tugas
    FROM users u WHERE u.role='guru' ORDER BY u.nama`).all();
  res.json({ ok: true, periode: { id: p.id, nama: p.nama, tahun: p.tahun }, kelas: out, guru });
});

function bangunLegger(tingkat) {
  const p = periodeAktif();
  const kelas = db.prepare('SELECT * FROM classes WHERE tingkat=? ORDER BY nama').all(tingkat);
  const baris = [];
  for (const k of kelas) {
    const mapel = mapelUntukKelas(k.jurusan);
    const siswa = db.prepare(`
      SELECT st.id, st.no_urut no, st.nis, st.nisn, st.nama,
             n.s, n.i, n.a, n.terlambat, n.kasus, n.tindak_lanjut, n.catatan
      FROM students st LEFT JOIN notes n ON n.student_id=st.id AND n.period_id=?
      WHERE st.class_id=? ORDER BY st.no_urut, st.nama`).all(p.id, k.id);
    const gAll = db.prepare('SELECT student_id, subject_id, nr FROM grades WHERE period_id=? AND student_id IN (SELECT id FROM students WHERE class_id=?)').all(p.id, k.id);
    const gmap = {};
    for (const g of gAll) gmap[g.student_id + ':' + g.subject_id] = g.nr;
    const rows = siswa.map(s => {
      const nilai = mapel.map(m => gmap[s.id + ':' + m.id] ?? null);
      const isi = nilai.filter(v => v !== null && v !== undefined);
      const jumlah = isi.length ? round2(isi.reduce((a, b) => a + b, 0)) : 0;
      const rat = isi.length ? round2(jumlah / isi.length) : null;
      return { ...s, kelas: k.nama, wali: k.wali, nilai, jumlah, rat, rank: 0 };
    });
    // rank per kelas (mirip RANK Excel: sama = rank sama, lanjut lompat)
    const urut = [...rows].sort((a, b) => b.jumlah - a.jumlah);
    let lastJ = null, lastR = 0;
    urut.forEach((r, i) => {
      if (r.jumlah !== lastJ) { lastR = i + 1; lastJ = r.jumlah; }
      r.rank = lastR;
    });
    baris.push({ kelas: k, mapel: mapel.map(m => ({ id: m.id, kode: m.kode })), siswa: rows });
  }
  return { periode: { id: p.id, nama: p.nama, tahun: p.tahun, semester: p.semester }, tingkat, kelas: baris };
}
app.get('/api/admin/legger', perluAdmin, (req, res) => {
  const tingkat = String(req.query.tingkat || 'X').toUpperCase();
  res.json({ ok: true, ...bangunLegger(tingkat) });
});

// kelola user & tugas
app.get('/api/admin/users', perluAdmin, (req, res) => {
  res.json({ ok: true, users: db.prepare('SELECT id,username,nama,role,created_at FROM users ORDER BY role, nama').all() });
});
app.post('/api/admin/users', perluAdmin, (req, res) => {
  const { username, password, nama, role } = req.body || {};
  if (!username || !password || !nama) return res.status(400).json({ ok: false, error: 'username, password, nama wajib diisi' });
  try {
    const r = db.prepare('INSERT INTO users (username,password,nama,role,created_at) VALUES (?,?,?,?,?)')
      .run(String(username).trim(), sha256(password), nama, role === 'admin' ? 'admin' : 'guru', nowISO());
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ ok: false, error: 'username sudah dipakai' });
  }
});
app.put('/api/admin/users/:id', perluAdmin, (req, res) => {
  const { nama, password } = req.body || {};
  if (nama) db.prepare('UPDATE users SET nama=? WHERE id=?').run(nama, req.params.id);
  if (password) db.prepare('UPDATE users SET password=? WHERE id=?').run(sha256(password), req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/users/:id', perluAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ ok: false, error: 'tidak bisa hapus diri sendiri' });
  db.prepare('DELETE FROM assignments WHERE user_id=?').run(req.params.id);
  db.prepare('UPDATE classes SET wali_user_id=NULL WHERE wali_user_id=?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.get('/api/admin/assignments', perluAdmin, (req, res) => {
  res.json({
    ok: true,
    assignments: db.prepare(`
      SELECT a.id, u.nama guru, s.kode mapel, c.nama kelas, c.tingkat
      FROM assignments a JOIN users u ON u.id=a.user_id
      JOIN subjects s ON s.id=a.subject_id JOIN classes c ON c.id=a.class_id
      ORDER BY c.tingkat, c.nama, s.urutan`).all()
  });
});
app.post('/api/admin/assignments', perluAdmin, (req, res) => {
  const { user_id, subject_id, class_id } = req.body || {};
  try {
    const r = db.prepare('INSERT INTO assignments (user_id,subject_id,class_id) VALUES (?,?,?)').run(user_id, subject_id, class_id);
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ ok: false, error: 'tugas ini sudah ada' });
  }
});
app.delete('/api/admin/assignments/:id', perluAdmin, (req, res) => {
  db.prepare('DELETE FROM assignments WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.get('/api/admin/subjects', perluAdmin, (req, res) => {
  res.json({ ok: true, subjects: db.prepare('SELECT * FROM subjects ORDER BY urutan').all() });
});
app.get('/api/admin/classes', perluAdmin, (req, res) => {
  const kelas = db.prepare(`SELECT c.*, u.nama wali_akun, u.username wali_username
    FROM classes c LEFT JOIN users u ON u.id=c.wali_user_id ORDER BY c.tingkat, c.nama`).all();
  for (const k of kelas) k.nSiswa = db.prepare('SELECT COUNT(*) c FROM students WHERE class_id=?').get(k.id).c;
  res.json({ ok: true, classes: kelas });
});
app.post('/api/admin/wali', perluAdmin, (req, res) => {
  const { class_id, user_id } = req.body || {};
  db.prepare('UPDATE classes SET wali_user_id=? WHERE id=?').run(user_id || null, class_id);
  res.json({ ok: true });
});
app.get('/api/admin/periods', perluAdmin, (req, res) => {
  res.json({
    ok: true,
    periods: db.prepare('SELECT * FROM periods ORDER BY id DESC').all().map(p => ({ ...p, kolom: JSON.parse(p.kolom) }))
  });
});
app.post('/api/admin/periods', perluAdmin, (req, res) => {
  const { nama, tahun, semester, kolom } = req.body || {};
  if (!nama || !tahun || !Array.isArray(kolom) || !kolom.length)
    return res.status(400).json({ ok: false, error: 'nama, tahun, dan kolom nilai wajib diisi' });
  const r = db.prepare('INSERT INTO periods (nama,tahun,semester,kolom,aktif,created_at) VALUES (?,?,?,?,0,?)')
    .run(nama, tahun, semester || '', JSON.stringify(kolom), nowISO());
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.post('/api/admin/periods/:id/aktifkan', perluAdmin, (req, res) => {
  db.prepare('UPDATE periods SET aktif=0').run();
  db.prepare('UPDATE periods SET aktif=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// backup & restore (prinsip: data tidak boleh hilang saat update)
app.get('/api/admin/backup', perluAdmin, (req, res) => {
  const dump = {};
  for (const t of ['users', 'periods', 'subjects', 'classes', 'students', 'assignments', 'grades', 'notes']) {
    dump[t] = db.prepare(`SELECT * FROM ${t}`).all();
  }
  // jangan sertakan hash password apa adanya? tetap perlu untuk restore; hanya admin yang bisa unduh
  res.setHeader('Content-Disposition', 'attachment; filename="backup-e-raport.json"');
  res.json({ ok: true, tanggal: nowISO(), data: dump });
});
app.post('/api/admin/restore', perluAdmin, (req, res) => {
  const dump = (req.body || {}).data;
  if (!dump || typeof dump !== 'object') return res.status(400).json({ ok: false, error: 'file backup tidak valid' });
  db.exec('BEGIN');
  try {
    for (const t of ['notes', 'grades', 'assignments', 'students', 'classes', 'subjects', 'periods', 'users']) {
      if (!Array.isArray(dump[t])) continue;
      db.prepare(`DELETE FROM ${t}`).run();
      for (const row of dump[t]) {
        const keys = Object.keys(row);
        const ph = keys.map(() => '?').join(',');
        db.prepare(`INSERT INTO ${t} (${keys.join(',')}) VALUES (${ph})`).run(...keys.map(k => row[k]));
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true });
});

// ---------- static ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.listen(PORT, () => console.log(`E-Raport jalan di port ${PORT} | DB: ${DB_PATH}`));
