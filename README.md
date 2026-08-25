# ZISWAF Smart Inflow Converter — Demo (Client-Side)

Versi client-side dari ZISWAF Smart Inflow Classifier. Berjalan sepenuhnya di browser — tanpa server, tanpa database, tanpa login. Dapat di-host di GitHub Pages.

## Fitur
- Upload mutasi bank `.xlsx` / `.csv` dan klasifikasi otomatis (5 Layer Engine)
- Mode Ringkas / Detail pada tabel transaksi
- Inline koreksi COA + aksi massal dengan Undo
- Konfirmasi WhatsApp untuk donatur tetap
- Ekspor jurnal bersih `.xlsx` / `.csv`
- Konfigurasi master data: COA, Program, Donatur, Alias Yayasan
- Akun Default Sistem dapat dikustomisasi (Unauthorized / Infak Umum / Beban)
- AI Semantic Matcher opsional (Ollama lokal / Gemini / OpenAI)

## Penyimpanan Data
| Data | Penyimpanan |
|------|-------------|
| Master data (COA, Program, Donatur, Alias, Pengaturan) | `localStorage` browser — **persisten** |
| Transaksi hasil klasifikasi | Memori sesi — **hilang saat refresh** |
| API Key AI | Memori sesi saja — tidak disimpan |

> Selalu ekspor jurnal sebelum menutup/me-refresh tab.

## Cara Deploy ke GitHub Pages

1. Fork atau push repo ini ke GitHub
2. Buka **Settings → Pages**
3. Source: pilih **GitHub Actions**
4. Workflow sudah tersedia di `.github/workflows/deploy-pages.yml`
5. Push ke branch `main` → otomatis deploy ke `https://<username>.github.io/<repo>/`

## Cara Menjalankan Lokal

```bash
node demo/serve.mjs
# Buka http://localhost:5173
```

## Format File Import

### Mutasi Bank
| Kolom | Alias yang Diterima |
|-------|-------------------|
| Tanggal | `date`, `tanggal`, `tgl` |
| Keterangan | `label`, `keterangan`, `deskripsi`, `uraian` |
| Nominal | `amount`, `nominal`, `jumlah`, `mutasi` |
| Partner | `partner`, `pengirim`, `nama` |

### COA
Kolom wajib: `NO AKUN`, `NAMA AKUN`. Opsional: `KATEGORI`.

### Program
Kolom wajib: `ID`, `NAMA PROGRAM`. Opsional: `COA`, `KODE EKOR`, `KEYWORDS`, `DESKRIPSI`.

### Donatur
Kolom wajib: `NAMA`. Opsional: `NO HP`, `PROGRAM DEFAULT`.

> Gunakan tombol **Template** di tiap sub-tab untuk mengunduh contoh file xlsx.
