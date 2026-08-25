# ZISWAF Smart Inflow Converter — Lite (Client-Side Demo)

[![Deploy to GitHub Pages](https://github.com/wahyu/ziswafierlite/actions/workflows/deploy.yml/badge.svg)](https://github.com/wahyu/ziswafierlite/actions/workflows/deploy.yml)
![Architecture](https://img.shields.io/badge/Architecture-100%25%20Client--Side-10b981.svg)
![Database](https://img.shields.io/badge/Database-Zero%20Backend-0284c7.svg)
![PWA Ready](https://img.shields.io/badge/PWA-Ready-8b5cf6.svg)
![SEO Maximized](https://img.shields.io/badge/SEO-Optimized-f59e0b.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

> **Catatan Proyek**: Repositori ini merupakan **versi demo mandiri (Lite / Client-Side Edition)** dari sistem enterprise **[ZISWAF Smart Inflow Classifier & Reconciliation System](https://github.com/wahyu/ziswaf_classifier)** (`documents/project/ziswaf_classifier`). Dibuat untuk demonstrasi instan, evaluasi algoritma klasifikasi, dan penggunaan tanpa instalasi server backend.

---

## 📌 Daftar Isi

1. [Tentang Ziswafier Lite](#-tentang-ziswafier-lite)
2. [Perbandingan: Versi Lite (Demo) vs Versi Enterprise (Full)](#-perbandingan-versi-lite-demo-vs-versi-enterprise-full)
3. [Pipeline Klasifikasi 5-Lapis](#-pipeline-klasifikasi-5-lapis)
4. [Fitur Utama](#-fitur-utama)
5. [Setup & Deploy ke GitHub Pages (DevOps)](#️-setup--deploy-ke-github-pages-devops)
6. [Menjalankan di Komputer Lokal](#-menjalankan-di-komputer-lokal)
7. [Format Berkas Unggahan & Template](#-format-berkas-unggahan--template)
8. [Privasi & Keamanan Data](#-privasi--keamanan-data)

---

## 💡 Tentang Ziswafier Lite

Lembaga pengelola ZISWAF (Zakat, Infak, Sedekah, dan Wakaf) menerima ratusan hingga ribuan transaksi mutasi bank setiap bulan pada rekening penampungan. Memilah dan mencocokkan tiap transaksi ke kode akun (COA) secara manual memakan waktu berhari-hari serta berisiko *human error* pada dana syariah yang terikat akad.

**Ziswafier Lite** menghadirkan seluruh kecerdasan engine klasifikasi ZISWAF ke dalam **satu aplikasi web statis** yang berjalan 100% di browser Anda:
- ⚡ **Nol Instalasi Server**: Buka via browser atau GitHub Pages tanpa butuh Python, Node.js, atau database server.
- 🔒 **Privasi & Kerahasiaan Keuangan Mutlak**: File rekening koran / mutasi bank diproses secara lokal di RAM browser; tidak ada data finansial yang dikirim ke server mana pun.
- 🎯 **Akurasi & Kepatuhan Syariah**: Menghindari percampuran dana zakat, infak, dan wakaf dengan proteksi khusus (*special accounts*).

---

## ⚖️ Perbandingan: Versi Lite (Demo) vs Versi Enterprise (Full)

| Aspek / Fitur | Ziswafier Lite (Repositori Ini) | ZISWAF Classifier Enterprise (`ziswaf_classifier`) |
| :--- | :--- | :--- |
| **Arsitektur** | 100% Client-Side Single Page App (HTML5 / Vanilla JS) | Fullstack (FastAPI Python + SQLite/PostgreSQL + Tailwind UI) |
| **Penyimpanan Master Data** | `localStorage` browser lokal | Database Relasional Terpusat (Multi-User & Backup) |
| **Multi-User & Hak Akses** | Single User / Sesi Personal | Role-Based Access Control (Admin, Verifikator, Kadiv Keuangan) |
| **Tata Kelola Approval** | Review & Edit Langsung di Tabel | Alur 2-Tahap: Verifikasi Staf → Persetujuan Kadiv Keuangan |
| **Penyimpanan Bukti Transfer** | Tidak ada (Fokus pada konversi mutasi) | Brankas Bukti Transaksi + OCR Scanner Gambar/Struk/WA |
| **Integrasi Akuntansi (SIAK)** | Ekspor Jurnal Bersih `.xlsx` / `.csv` siap upload | Integrasi Langsung API Odoo / Jurnal SIAK Otomatis |
| **Konfirmasi Donatur (WA)** | Generate Tautan WhatsApp Web siap kirim | Gateway WhatsApp API Terotomatisasi (Notifikasi Otomatis) |
| **Hosting & Deployment** | GitHub Pages / Vercel / Static Hosting | Server Cloud, VPS, Docker Container |

---

## 🧠 Pipeline Klasifikasi 5-Lapis

Setiap baris mutasi bank diproses secara sekuensial dan deterministik melalui arsitektur 5 layer:

```
[ Baris Mutasi Bank: Tanggal | Keterangan | Pengirim | Nominal ]
                                |
                                v
 ┌─────────────────────────────────────────────────────────────┐
 │  LAYER 0: SANITIZER & PROFILE FILTER                        │
 │  - Pembersihan noise BI-FAST, RTGS, QRIS, token e-wallet   │
 │  - Eliminasi nama alias yayasan (cegah false-positive zakat)│
 │  - Ekstraksi otomatis nama pengirim dari teks transfer      │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                v
 ┌─────────────────────────────────────────────────────────────┐
 │  LAYER 1: OUTFLOW / EXPENSE FILTER                          │
 │  - Nominal < 0 ATAU Keterangan "TRF KE" / "Biaya"          │
 │  -> Auto-Route: 60100008 (Beban Lain-Lain)                  │
 └──────────────────────────────┬──────────────────────────────┘
                                │ (jika transaksi masuk / inflow)
                                v
 ┌─────────────────────────────────────────────────────────────┐
 │  LAYER 2: CAMPAIGN TAIL CODE MATCHING                       │
 │  - Pencocokan 3 digit unik ekor nominal (contoh: Rp 50.015) │
 │  -> Auto-Route: COA Program Kampanye Terkait                │
 └──────────────────────────────┬──────────────────────────────┘
                                │ (jika tidak cocok ekor)
                                v
 ┌─────────────────────────────────────────────────────────────┐
 │  LAYER 3: REGISTERED DONOR MATCHING                         │
 │  - Pencocokan nama pengirim ke database donatur tetap       │
 │  -> Auto-Route: Program Rutin Donatur / 40201001 Umum       │
 │  -> Flagging: Tersedia tombol konfirmasi WhatsApp           │
 └──────────────────────────────┬──────────────────────────────┘
                                │ (jika donatur belum terdaftar)
                                v
 ┌─────────────────────────────────────────────────────────────┐
 │  LAYER 4: KEYWORD & ALIAS DICTIONARY                        │
 │  - Pencocokan kata kunci: "fidyah", "wakaf", "gizi", "zakat"│
 │  -> Auto-Route: COA Program Terkait                         │
 └──────────────────────────────┬──────────────────────────────┘
                                │ (jika tidak ada kata kunci)
                                v
 ┌─────────────────────────────────────────────────────────────┐
 │  LAYER 5: AI SEMANTIC MATCHER (OPSIONAL)                    │
 │  - In-context routing via Ollama Lokal, Gemini, atau OpenAI │
 │  - Jika AI Non-Aktif / Low Confidence:                      │
 │  -> 40201000 (Penerimaan Belum Terotorisasi - Butuh Review) │
 └─────────────────────────────────────────────────────────────┘
```

---

## ✨ Fitur Utama

1. **Dashboard Interaktif & Modern**:
   - Pilihan tampilan **Mode Ringkas** (*compact view* untuk kecepatan audit) dan **Mode Detail**.
   - Filter cepat berdasarkan status (*Verified, Needs Review, Expense, WhatsApp Available*).
   - Pencarian cerdas, inline editing COA, dan fitur *Bulk Correction* dengan tombol *Undo*.
2. **Master Data Management**:
   - Pengaturan COA (Bagan Akun), Program Donasi, Donatur Tetap, dan Alias Yayasan.
   - Master data tersimpan persisten di `localStorage` peramban Anda.
   - Fitur Backup & Restore master data dalam format JSON.
3. **AI Semantic Routing (Opsional)**:
   - Dukungan koneksi ke **Ollama Lokal** (100% offline), **Google Gemini**, **OpenAI**, atau **OpenRouter**.
   - API key hanya disimpan di memori sesi sementara dan tidak pernah disimpan ke disk.
4. **Sapaan Donatur via WhatsApp**:
   - Membuat tautan pesan WhatsApp dengan sapaan sopan, detail nominal, dan konfirmasi alokasi dana donatur.
5. **Ekspor Jurnal SIAK**:
   - Menghasilkan berkas `.xlsx` dan `.csv` jurnal rapi yang kompatibel langsung dengan format impor software akuntansi.

---

## 🛠️ Setup & Deploy ke GitHub Pages (DevOps)

Repositori ini telah dilengkapi dengan workflow CI/CD otomatis di [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

### Langkah Aktivasi Deployment:
1. Hubungkan repository lokal Anda ke GitHub:
   ```powershell
   git remote add origin https://github.com/<username>/<repo>.git
   git branch -M main
   git push -u origin main
   ```
2. Buka repo Anda di GitHub → klik tab **Settings** → menu **Pages**.
3. Di bagian **Build and deployment**:
   - **Source**: Pilih **`GitHub Actions`**.
4. GitHub Actions akan otomatis memvalidasi unit test (`node test/run_tests.js`) dan mendistribusikan situs ke GitHub Pages.
5. Website Anda dapat diakses di: `https://<username>.github.io/<repo>/`.

---

## 💻 Menjalankan di Komputer Lokal

Anda dapat menjalankan project ini secara lokal menggunakan built-in web server tanpa instalasi library tambahan:

```powershell
# Menjalankan web server lokal (port 5173)
node serve.mjs

# Menjalankan rangkaian unit tests
node test/run_tests.js
```

Buka peramban di `http://localhost:5173`.

---

## 📄 Format Berkas Unggahan & Template

### 1. Berkas Mutasi Bank (`.xlsx` atau `.csv`)
Header kolom otomatis dideteksi dari berbagai variasi perbankan:
- **Tanggal**: `date`, `tanggal`, `tgl`
- **Keterangan**: `label`, `keterangan`, `deskripsi`, `uraian`
- **Nominal**: `amount`, `nominal`, `jumlah`, `mutasi`
- **Partner / Pengirim**: `partner`, `pengirim`, `nama`

### 2. Berkas Master Data
- **COA**: Kolom `NO AKUN`, `NAMA AKUN`, `KATEGORI` (opsional).
- **Program**: Kolom `ID`, `NAMA PROGRAM`, `COA`, `KODE EKOR`, `KEYWORDS`.
- **Donatur**: Kolom `NAMA`, `NO HP`, `PROGRAM DEFAULT`.
- **Alias**: Kolom `ALIAS`.

> 💡 Gunakan tombol **Template** pada setiap sub-tab Konfigurasi di dalam aplikasi untuk mengunduh contoh file Excel siap pakai.

---

## 🔒 Privasi & Keamanan Data

- **Zero-Data Transmission**: Seluruh logika sanitasi teks, pencocokan pola kata kunci, dan penyusunan jurnal dieksekusi di *V8 JavaScript Engine* pada peramban Anda.
- **Isolasi Memori**: Data mutasi rekening yang diunggah hanya tersimpan di memori sesi browser dan otomatis bersih saat tab ditutup.
- **Kepatuhan Regulasi Keuangan**: Lembaga keuangan dan amil dapat menguji efisiensi sistem tanpa melanggar NDA atau regulasi kerahasiaan data perbankan.

---

## 📜 Lisensi & Atribusi

Hak Cipta © 2026 ZISWAF Tech. Dilisensikan di bawah [MIT License](LICENSE).
Sistem induk dikembangkan dalam ekosistem **ZISWAF Smart Inflow Classifier & Reconciliation System**.
