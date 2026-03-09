# 🦅 Raven Market Auto-Trade Bot (Point Gen)

![Raven Bot Banner](https://img.shields.io/badge/Status-Active-brightgreen) ![Testnet](https://img.shields.io/badge/Network-Canton_Loop_Testnet-blue) ![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue)

Auto-Trade Bot untuk platform opsi terdesentralisasi **Raven Market** (yang berjalan di atas Canton Loop Network). Script ini dibuat untuk melakukan otomatisasi trading, dengan rutinitas khusus *Double Points Farming* guna memaksimalkan perolehan Poin Aktivitas untuk akun Anda.

> **Built by:** Noya-xen ([GitHub](https://github.com/Noya-xen))  
> **Follow me on X:** [@xinomixo](https://twitter.com/xinomixo)

---

## ✨ Fitur Utama
- **Multi-Account Support:** Mampu menjalankan putaran trading *unlimited* untuk banyak akun/wallet sekaligus melalui `accounts.json`.
- **Intelligent Rotation (Bypass Limit):** Sepenuhnya mengatasi penalti API server Canton SDK (Rate Limit 1 Request/Menit) dengan rotasi antrean waktu dan *Auto-Sleep 65 Detik*.
- **Anti-Sybil Randomization:** Mendiversifikasi jumlah kuantitas kontrak yang dibeli dan tipe sisi (PUT / CALL) secara acak setiap iterasi.
- **Double Points Strategy (Open & Close):** Bot ini tidak mengurangi modal CC (Canton Coin) testnet Anda. Ia mempraktikkan strategi Buka (BUY) -> Jeda -> Tutup (SELL) secara berurutan untuk mencetak **20 Poin ganda** pada setiap Wallet ID Anda tanpa menguras dompet! 💥
- **Self-Healing Error Handling:** Jika instruksi on-chain gagal atau dompet kehabisan saldo, bot secara mandiri akan melewatkan akun tersebut dan beralih ke dompet selanjutnya (Tidak pernah Force Close!).

---

## 🚀 Prasyarat Instalasi
1. Pastikan Anda telah menginstal [Node.js](https://nodejs.org/en) (Disarankan v16+).
2. Memiliki saldo testnet CC (Canton Coin) dan Loop `PRIVATE_KEY` serta `PARTY_ID`. (Dapatkan di [Loop Wallet](https://loop.fivenorth.io/)).

## 🛠️ Cara Setup & Menjalankan

### 1. Kloning Repositori
```bash
git clone https://github.com/Noya-xen/raven-auto-trade.git
cd raven-auto-trade
```

### 2. Install Dependensi
Karena script ini menggunakan SDK Canton `@fivenorth/loop-sdk` dan `axios`, jalankan instruksi NPM:
```bash
npm install
```

### 3. Konfigurasi Wallet (Sangat Penting!)
Script membutuhkan kredensial Anda untuk menandatangani pesan DAML secara lokal (Server-Side Signer). Fitur ini aman karena *Private Key* Anda tidak pernah terkirim ke internet luar.

Copy file sampel atau buat file baru bernama `accounts.json` di root folder:
```json
[
    {
        "PRIVATE_KEY": "ISI_PRIVATE_KEY_DOMPET_1_KAMU",
        "PARTY_ID": "DSO::ISI_PARTY_ID_DOMPET_1_KAMU"
    },
    {
        "PRIVATE_KEY": "ISI_PRIVATE_KEY_DOMPET_2_KAMU",
        "PARTY_ID": "DSO::ISI_PARTY_ID_DOMPET_2_KAMU"
    }
]
```
*(Catatan: Anda bebas menambahkan sebanyak apa pun jumlah Wallet di dalam array tersebut).*

### 4. Mulai Farming!
Gunakan command bawaan dari `package.json` yang akan membangun TS (menggunakan `esbuild`) dan membuka Main Loop:
```bash
npm run start
```

---

## 📡 Menjalankan 24/7 di VPS (Opsional)
Untuk memastikan bot berlari berhari-hari untuk menambang poin:
1. Install PM2: `npm install -g pm2`
2. Jalankan: `pm2 start npm --name "raven-bot" -- run start`
3. Cek log: `pm2 logs raven-bot`

---

## ⚠️ Disclaimer
Script otomasi (bot) ini disediakan "Sebagaimana Adanya" (*As Is*) secara Open Source untuk keperluan edukasi dan testing pada jaringan **Testnet**. Gunakan ini dengan tanggung jawab masing-masing.

**Happy Farming! 🦅**
