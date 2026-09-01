export const DEFAULT_MASTER_DATA = {
  coaList: [
    { code: 40100000, name: "Penerimaan Zakat Tanpa Pembatasan - Baseline", category: "ZAKAT" },
    { code: 40100101, name: "Zakat Maal Individu / Penghasilan", category: "ZAKAT" },
    { code: 40100102, name: "Zakat Fitrah", category: "ZAKAT" },
    { code: 40100103, name: "Zakat Profesi / Perniagaan Badan", category: "ZAKAT" },
    { code: 40201000, name: "Penerimaan Infak & Sedekah Tanpa Pembatasan - Unauthorized", category: "INFAK / SEDEKAH" },
    { code: 40201001, name: "Penerimaan Infak & Sedekah Tanpa Pembatasan - Umum", category: "INFAK / SEDEKAH" },
    { code: 40201002, name: "Penerimaan Infak & Sedekah Terikat", category: "INFAK / SEDEKAH" },
    { code: 40202101, name: "Infak Kebencanaan & Kemanusiaan", category: "INFAK / SEDEKAH" },
    { code: 40202104, name: "Santunan Yatim Dhuafa & Penghafal Al-Qur'an", category: "INFAK / SEDEKAH" },
    { code: 40202201, name: "Infak Beasiswa Pendidikan Dhuafa", category: "INFAK / SEDEKAH" },
    { code: 40202301, name: "Infak Layanan Kesehatan Gratis", category: "INFAK / SEDEKAH" },
    { code: 40202302, name: "Bantuan Gizi Santri & Pangan Dhuafa", category: "INFAK / SEDEKAH" },
    { code: 40202401, name: "Infak Pemberdayaan Ekonomi Ummat", category: "INFAK / SEDEKAH" },
    { code: 40202501, name: "Sedekah Al-Qur'an & Sarana Ibadah", category: "INFAK / SEDEKAH" },
    { code: 40202502, name: "Infak Pengadaan Sarana Air Bersih & Sumur", category: "INFAK / SEDEKAH" },
    { code: 40202601, name: "Tebar Qurban Berkah", category: "DSKL" },
    { code: 40202602, name: "Penerimaan Fidyah & Kafarat", category: "DSKL" },
    { code: 40301000, name: "Penerimaan Wakaf Tanpa Pembatasan", category: "WAKAF" },
    { code: 40203110, name: "Penerimaan Wakaf Uang - Tunai", category: "WAKAF" },
    { code: 40203201, name: "Wakaf Pembangunan Sarana Ibadah & Pesantren", category: "WAKAF" },
    { code: 60100008, name: "Beban Lain-Lain (Pengeluaran Bank)", category: "BEBAN" }
  ],

  // Programs ordered: SPECIFIC programs first, GENERIC programs last
  // L4 keyword matching checks programs in array order — first match wins
  programs: [
    // === SPECIFIC PROGRAMS (checked first) ===
    {
      id: "prog-gizi",
      name: "Bantuan Gizi Santri & Pangan Dhuafa",
      coaCode: 40202302,
      tailCode: "302",
      parentCoaCode: null,
      hiddenKeywords: [],
      keywords: ["ggs", "gizi", "gebyar gizi", "gzi", "gizi santri", "makan santri", "beras santri", "dapur santri", "pangan", "sembako dhuafa"],
      description: "Penyediaan beras, lauk pauk bergizi, dan paket sembako pangan harian santri pondok serta keluarga dhuafa."
    },
    {
      id: "prog-yatim",
      name: "Santunan Yatim Dhuafa & Penghafal Al-Qur'an",
      coaCode: 40202104,
      tailCode: "104",
      parentCoaCode: null,
      hiddenKeywords: [],
      keywords: ["yatim", "ytim", "ytm", "ya tim", "yaatim", "festifal yatim", "adek yatim", "asuh yatim", "yatim dhuafa", "santunan yatim", "penghafal quran", "tahfidz yatim"],
      description: "Santunan biaya hidup bulanan dan uang saku santri yatim dhuafa serta anak penghafal Al-Qur'an."
    },
    {
      id: "prog-bencana",
      name: "Tanggap Bencana & Kemanusiaan",
      coaCode: 40202101,
      tailCode: "202",
      parentCoaCode: null,
      hiddenKeywords: [],
      keywords: ["palestina", "palestin", "plestin", "palestine", "pales tina", "bencana", "banjir", "gempa", "longsor", "tsunami", "erupsi", "peduli cianjur", "tanggap bencana", "relawan", "logistik darurat"],
      description: "Donasi tanggap darurat bencana alam berupa logistik pengungsian, dapur umum, dan relawan kemanusiaan."
    },
    {
      id: "prog-buka",
      name: "Buka Berbahagia",
      coaCode: 40202105,
      tailCode: "",
      parentCoaCode: null,
      hiddenKeywords: [],
      keywords: ["iftor", "berbuka", "untuk buka", "buka berbahagia", "ifthar", "untuk buka ramadhan"],
      description: "Berbuka puasa bersama bagi yang berpuasa di bulan Ramadhan."
    },
    {
      id: "prog-quran",
      name: "Sedekah Al-Qur'an & Sarana Ibadah",
      coaCode: 40202501,
      tailCode: "501",
      parentCoaCode: null,
      hiddenKeywords: [],
      keywords: [
        "sedekah qran", "mushaf", "braile", "quran isyarat", "infaq quran", "wakaf quran", "segedah quran",
        "quran", "al-quran", "alquran", "al quran", "mushaf", "wakaf quran", "sedekah quran",
        "karpet masjid", "sarana ibadah", "infaq alquran", "infaq al-quran"
      ],
      description: "Distribusi mushaf Al-Qur'an ke pelosok negeri serta penyediaan karpet dan sarana tempat ibadah."
    },
    {
      id: "prog-subuh",
      name: "Infaq Subuh",
      coaCode: 40201001,
      tailCode: "",
      parentCoaCode: null,
      hiddenKeywords: [],
      keywords: ["infaq subuh", "infak subuh", "subuh", "sbuh"],
      description: "Infaq rutin waktu subuh dari jamaah."
    },
    {
      id: "prog-sdq-jumat",
      name: "Sedekah Jumat",
      coaCode: 40201001,
      tailCode: "",
      parentCoaCode: null,
      hiddenKeywords: [],
      keywords: ["jumat", "jum'at", "berbagi jumat", "sedekah jumat", "jumat berkah"],
      description: "Sedekah rutin hari Jumat."
    },
    {
      id: "prog-zkt-fitrah",
      name: "Zakat Fitrah",
      coaCode: 40100103,
      tailCode: "007",
      parentCoaCode: 40100000,
      hiddenKeywords: [],
      keywords: ["fitrah", "zkt fitrah", "z fitrah", "zakat f", "zakat fitrah", "beras fitrah", "fidyah fitrah", "zkt fitr", "zakat fitri"],
      description: "Penerimaan zakat fitrah beras atau uang kewajiban Ramadhan yang disalurkan kepada asnaf fakir miskin."
    },
    {
      id: "prog-qurban",
      name: "Qurban Berbahagia",
      coaCode: 40202601,
      tailCode: "003",
      parentCoaCode: null,
      hiddenKeywords: [],
      keywords: ["qurban", "kurban", "qur ban", "sapi kurban", "kurban kambing", "domba", "hewan qurban", "sapi qurban", "kambing kurban", "tebar qurban"],
      description: "Penerimaan tabungan dan penyaluran hewan qurban Idul Adha untuk daging dibagikan kepada mustahik."
    },
    {
      id: "prog-zkt-maal",
      name: "Zakat Maal",
      coaCode: 40100101,
      tailCode: "101",
      parentCoaCode: 40100000,
      hiddenKeywords: [],
      keywords: ["z maal", "zakat harta", "zakat mal", "zkt mal", "pembersihan harta", "maal", "mal", "zakat maal", "zakat penghasilan", "iph", "zakat profesi", "penghasilan", "gaji", "profesi", "tabungan", "zakat emas"],
      description: "Zakat harta dan penghasilan 2.5% dari gaji bulanan, tabungan, perniagaan, atau emas perorangan."
    },
    {
      id: "prog-wakaf-kawasan",
      name: "Bantu Bangun Kawasan",
      coaCode: 40203110,
      tailCode: "",
      parentCoaCode: 40301000,
      hiddenKeywords: [],
      keywords: ["bangun masjid", "kawasan", "pembangunan", "wakaf kawasan", "wakaf pembangunan", "bangunan"],
      description: "Wakaf untuk pembangunan masjid dan kawasan pesantren."
    },
    {
      id: "prog-sarana-fisik",
      name: "Sarana Fisik",
      coaCode: 40202502,
      tailCode: "205",
      keywords: ["sarana fisik", "alat pondok", "sound system", "toa masjid", "peralatan"],
      description: "Pengadaan sarana fisik pendukung operasional pesantren."
    },
    {
      id: "prog-wakaf-uang",
      name: "Wakaf Umum",
      coaCode: 40203000,
      tailCode: "",
      keywords: ["wakaf", "wkf", "waakaf", "wakf", "wakaf uang", "wakaf tunai", "sertifikat wakaf", "wakaf produktif", "wakaf berkelanjutan"],
      description: "Wakaf umum untuk kegiatan sosial."
    },
    {
      id: "prog-fidyah",
      name: "Penerimaan Fidyah & Kafarat",
      coaCode: 40202602,
      tailCode: "602",
      keywords: ["fidyah", "fidiah", "kafarat", "fidya", "bayar fidyah", "ganti puasa", "denda kafarat", "kafarat sumpah"],
      description: "Pembayaran fidyah puasa Ramadhan dan denda kafarat syariah yang disalurkan sebagai pangan kaum dhuafa."
    },
    {
      id: "prog-beasiswa",
      name: "Beasiswa Yatim & Dhuafa Berprestasi",
      coaCode: 40202201,
      tailCode: "203",
      keywords: ["beasiswa", "spp", "sekolah", "pendidikan", "uang sekolah", "biaya kuliah"],
      description: "Beasiswa pendidikan formal bagi anak yatim dan dhuafa berprestasi meliputi SPP hingga biaya kuliah."
    },
    {
      id: "prog-kesehatan",
      name: "Layanan Ambulans & Kesehatan Dhuafa",
      coaCode: 40202301,
      tailCode: "204",
      keywords: ["ambulans", "kesehatan", "klinik", "obat", "jenazah", "ambulan gratis"],
      description: "Operasional layanan ambulans gratis, klinik kesehatan dhuafa, dan pengobatan pasien tidak mampu."
    },
    {
      id: "prog-ekonomi",
      name: "Pemberdayaan Ekonomi Ummat",
      coaCode: 40202401,
      tailCode: "401",
      keywords: ["umkm", "modal usaha", "gerobak berkah", "pemberdayaan", "pelatihan usaha", "wirausaha"],
      description: "Penguatan ekonomi mustahik melalui modal usaha mikro, gerobak berkah, dan pelatihan wirausaha mandiri."
    },
    {
      id: "prog-sumur",
      name: "Sarana Air Bersih & Sumur Bor",
      coaCode: 40202502,
      tailCode: "205",
      keywords: ["sumur", "sumur bor", "air bersih", "sarana air", "pipanisasi", "tandon air"],
      description: "Pembangunan sumur bor, tandon, dan pipanisasi air bersih untuk desa-desa daerah kekeringan."
    },
    {
      id: "prog-wakaf-pesantren",
      name: "Wakaf Pembangunan Gedung Pesantren",
      coaCode: 40203201,
      tailCode: "301",
      keywords: ["wakaf pesantren", "gedung", "asrama", "semen", "pasir", "masjid", "pesantren", "ruang kelas"],
      description: "Wakaf pembangunan fisik asrama santri, ruang belajar tahfidz, dan sarana masjid pesantren."
    },

    // === GENERIC PROGRAMS (checked LAST) ===
    {
      id: "prog-sdq-subuh",
      name: "Bantu Operasional Santri",
      coaCode: 40201001,
      tailCode: "",
      keywords: ["makan", "makan santri", "makan pondok", "mkan santri", "alhamdulillah", "bismillah",
        "hamba allah", "untuk penghafal quran", "program pondok", "beasiswa santri",
        "yayasan islam center", "doa", "untuk santri", "operasional pondok", "untuk masjid",
        "untuk pesantren", "semoga berkah", "semoga bermanfaat",
        "donasi", "sedekah", "sodaqoh", "shadaqah", "infaq", "infak",
        "sedekah subuh", "sodaqoh subuh"],
      description: "Semua yang berkaitan dengan kebutuhan pendidikan, operasional dan hidup santri di pondok pesantren."
    }
  ],

  donors: [
    { id: "dnr-titik-sunarni", name: "Titik Sunarni", phone: "081298765432", defaultProgramId: "prog-sdq-subuh", defaultCoa: 40201001 },
    { id: "dnr-sinta-patimah", name: "Sinta Patimah", phone: "081234998877", defaultProgramId: "prog-sdq-subuh", defaultCoa: 40201001 },
    { id: "dnr-bambang-soediro", name: "H. Bambang Soediro", phone: "081345678901", defaultProgramId: "prog-zkt-maal", defaultCoa: 40100101 },
    { id: "dnr-siti-aminah", name: "Hj. Siti Aminah", phone: "081567890123", defaultProgramId: "prog-beasiswa", defaultCoa: 40202201 },
    { id: "dnr-hendra-gunawan", name: "Dr. Hendra Gunawan", phone: "081234567891", defaultProgramId: "prog-zkt-fitrah", defaultCoa: 40100103 },
    { id: "dnr-agus-setiawan", name: "Ir. Agus Setiawan", phone: "081678901234", defaultProgramId: "prog-wakaf-kawasan", defaultCoa: 40203110 }
  ],

  companyAliases: [
    "Yayasan Amil Zakat Kebumen",
    "yayasan",
    "amil zakat",
    "lazis",
    "lazismu",
    "baznas",
    "baas kebumen"
  ],

  settings: {
    defaultUnauthorizedCoa: 40201000,
    defaultBaselineCoa: 40201001,
    expenseCoa: 60100008,
    aiMode: "OFF",
    aiApiKey: "",
    ollamaEndpoint: "http://localhost:11434/api/chat",
    confidenceThreshold: 0.70
  }
};

export default DEFAULT_MASTER_DATA;
