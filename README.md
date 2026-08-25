# ZISWAF Smart Inflow Converter — Demo (Client-Side)

[![Deploy to GitHub Pages](https://github.com/wahyu/ziswafierlite/actions/workflows/deploy.yml/badge.svg)](https://github.com/wahyu/ziswafierlite/actions/workflows/deploy.yml)
![Client-Side](https://img.shields.io/badge/Architecture-100%25%20Client--Side-10b981.svg)
![No Database](https://img.shields.io/badge/Database-Zero%20Backend-0284c7.svg)
![PWA Ready](https://img.shields.io/badge/PWA-Ready-8b5cf6.svg)
![SEO Maximized](https://img.shields.io/badge/SEO-Maximized-f59e0b.svg)

Aplikasi web client-side untuk otomatisasi klasifikasi transaksi mutasi bank rekening ZISWAF (Zakat, Infak, Sedekah, Wakaf). Berjalan 100% di browser pengguna — tanpa server backend, tanpa database, aman, dan siap di-host langsung di **GitHub Pages**.

---

## 🚀 Fitur Utama

- **5-Layer Classification Engine**:
  1. *L1 Expense Layer*: Deteksi transaksi pengeluaran (nominal negatif / keterangan `TRF KE`).
  2. *L2 Tail Code Matching*: Deteksi nominal unik program kampanye donasi (contoh: Rp 50.024 -> Program Wakaf Quran).
  3. *L3 Registered Donor*: Deteksi nama pengirim dari database donatur tetap.
  4. *L4 Keyword / Alias*: Deteksi kata kunci rekening, infak umum, atau alias yayasan.
  5. *L5 AI Semantic Matching (Opsional)*: Pencocokan kontekstual via Ollama Lokal, Google Gemini, OpenAI, atau OpenRouter.
- **Tampilan Interaktif**: Mode Ringkas (Compact) & Detail, filter status, inline editing COA, dan Bulk Action dengan Undo.
- **Template & Konfigurasi Fleksibel**: Master data COA, Program, Donatur, dan Alias Lembaga tersimpan persisten di `localStorage`.
- **Ekspor SIAK Ready**: Konversi langsung ke jurnal Excel (`.xlsx`) atau `.csv` siap upload ke software akuntansi.
- **Konfirmasi WhatsApp**: Generate tautan sapaan dan konfirmasi langsung ke nomor donatur terdaftar.

---

## 🛠️ Setup & Deploy ke GitHub Pages (DevOps)

Repository ini telah dikonfigurasi dengan workflow otomatisasi **GitHub Actions** (`.github/workflows/deploy.yml`) yang menjalankan unit testing dan deployment instan.

### Langkah Aktivasi di GitHub:
1. Push / Fork repository ini ke akun GitHub Anda:
   ```bash
   git remote add origin https://github.com/<USERNAME>/<REPO>.git
   git branch -M main
   git push -u origin main
   ```
2. Buka repository di browser → klik menu **Settings** → tab **Pages**.
3. Di bagian **Build and deployment**:
   - **Source**: Pilih **`GitHub Actions`**.
4. Workflow akan otomatis berjalan setiap kali ada push ke branch `main` atau `master`.
5. Website Anda akan live di: `https://<USERNAME>.github.io/<REPO>/`.

---

## 🔍 SEO & PWA Optimization

Project ini telah dioptimalkan secara komprehensif untuk Search Engine Optimization (SEO) & Social Sharing:
- **Meta Tags Lengkap**: Open Graph (Facebook, WhatsApp, LinkedIn) dan Twitter Cards (`summary_large_image`).
- **Structured Data (JSON-LD)**: Schema standard `@type: WebApplication` untuk rich snippet mesin pencari.
- **Robots & Sitemap**: Termasuk `robots.txt` dan `sitemap.xml` untuk indexing Google/Bing.
- **PWA & Mobile Ready**: Dilengkapi `site.webmanifest`, SVG favicons, squircle icons, dan safe viewport headers.
- **Social Banner**: Dilengkapi `og-preview.svg` (1200x630px high resolution vector).

---

## 💻 Menjalankan Lokal

Jalankan built-in HTTP server tanpa dependensi pihak ketiga:

```bash
node serve.mjs
# Buka http://localhost:5173 di browser
```

Menjalankan Unit Tests:
```bash
node test/run_tests.js
```

---

## 🔒 Keamanan & Penyimpanan Data

| Data | Lokasi Penyimpanan | Keterangan |
|------|--------------------|------------|
| Master data (COA, Program, Donatur, Alias, Pengaturan) | `localStorage` browser | **Persisten** di perangkat lokal Anda |
| Transaksi hasil klasifikasi | Memori RAM sesi browser | **Volatile** (selalu ekspor sebelum tutup tab) |
| API Key AI (jika menggunakan Gemini / OpenAI) | Memori sesi browser | **Tidak disimpan** ke disk atau dikirim ke server pihak ketiga |

---

## 📄 Format File Import

### 1. Mutasi Bank
| Kolom | Header yang Didukung |
|-------|----------------------|
| Tanggal | `date`, `tanggal`, `tgl` |
| Keterangan | `label`, `keterangan`, `deskripsi`, `uraian` |
| Nominal | `amount`, `nominal`, `jumlah`, `mutasi` |
| Partner | `partner`, `pengirim`, `nama` |

### 2. Master Data
- **COA**: Kolom wajib `NO AKUN`, `NAMA AKUN`. Opsional: `KATEGORI`.
- **Program**: Kolom wajib `ID`, `NAMA PROGRAM`. Opsional: `COA`, `KODE EKOR`, `KEYWORDS`, `DESKRIPSI`.
- **Donatur**: Kolom wajib `NAMA`. Opsional: `NO HP`, `PROGRAM DEFAULT`.
- **Alias**: Kolom wajib `ALIAS`.

> 💡 Gunakan tombol **Template** di masing-masing sub-tab Konfigurasi untuk mengunduh contoh format file `.xlsx`.

