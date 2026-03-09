import { loop } from '@fivenorth/loop-sdk/server';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
dotenv.config();

const NETWORK = 'testnet'; // Jaringan Canton Loop
const RATE_LIMIT_PENALTY_MS = 65000; // 65 Detik cooldown
const VALID_SERIES_IDS = [21]; 

function getRandomTradeParams() {
    const sides = ["PUT", "CALL"];
    const randomSide = sides[Math.floor(Math.random() * sides.length)];
    const randomQuantity = Math.floor(Math.random() * 15) + 5; // 5 -> 19 Contracts
    const randomSeries = VALID_SERIES_IDS[Math.floor(Math.random() * VALID_SERIES_IDS.length)];
    
    return {
        seriesId: randomSeries,
        side: randomSide,
        quantity: randomQuantity
    };
}

async function getMarketQuote(walletId: string, seriesId: any, side: any, quantity: any) {
    console.log(`[+] Mengambil harga quote dari Raven Market untuk ${side} ${quantity} (Series: ${seriesId})...`);
    
    const response = await axios.post(`https://testapi.raven.market/quote`, {
        series_id: seriesId,
        trade_type: "BUY",
        side: side,
        quantity: quantity
    }, {
        headers: {
            'Content-Type': 'application/json',
            'wallet_id': walletId 
        }
    });

    if(!response.data || (!response.data.total_cost && response.data.total_cost !== 0)) {
        console.error("[DEBUG] Raw Raven API Response:", JSON.stringify(response.data, null, 2));
        throw new Error("Gagal mendapatkan harga dari Raven Market API");
    }

    return { ...response.data, series_id: seriesId, side: side, quantity: quantity };
}

async function executeTrade(quoteData: any, walletId: string) {
    console.log(`[+] Memulai transaksi DAML via Transfer Amulet (Total Biaya: ${quoteData.total_cost} CC)...`);
    const provider = loop.getProvider();

    try {
        console.log(`[+] Menyiapkan data transfer ke Kas Raven Market...`);
        
        // Destinasi transfer adalah Treasury Raven Market (dilihat dari raw request payload frontend user)
        const ravenTreasuryId = "google-oauth2_007c114003659902327548245::12206d5dbed87522889b28486cea3dd6b6c1fc4b3ca156d2c4f31318710fcba57be3";
        // Convert CC to decimals as a string (e.g. "2.07960728")
        const amountString = quoteData.total_cost.toString();

        // Minta Loop SDK backend untuk menyiapkan Transfer Payload 
        // Ini akan memanggil endpoint Canton `/api/v1/.connect/pair/transfer`
        // Yang mengembalikan JSON "commands" DAML lengkap
        const transferPayloadStructure = await provider.transfer(
            ravenTreasuryId, 
            amountString,
            {
                instrument_admin: "DSO::1220f22a8b8f2d813c25b9a684dc4dd52b532a0174d8e73a13cdf2baabfff7518337",
                instrument_id: "Amulet"
            },
            {
                requestedAt: new Date(),
                executeBefore: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours
            }
        );
        
        console.log(`[+] Menyiapkan Submission interaktif untuk Canton...`);
        
        // Jeda WAJIB sebelum Hit Endpoint Prepare Submission (Bypass IP Rate Limit VPS)
        console.log(`[!] Menunggu ${RATE_LIMIT_PENALTY_MS/1000} detik sebelum prepareSubmission untuk memastikan Canton API siap...`);
        await new Promise(r => setTimeout(r, RATE_LIMIT_PENALTY_MS));

        // Kita menggunakan retry loop karena Canton Server (server_sdk) kadang mempunyai window rate limit yang bertumpuk
        let preparedPayload = null;
        for (let attempt = 1; attempt <= 5; attempt++) {
            console.log(`[+] Mencoba prepareSubmission (Percobaan ${attempt}/5)...`);
            try {
                // panggil prepareSubmission
                preparedPayload = await (provider as any).prepareSubmission(transferPayloadStructure);
                
                if (preparedPayload && preparedPayload.message && preparedPayload.message.includes("Rate Limited")) {
                     throw new Error("Rate Limited");
                }
                
                if (preparedPayload && preparedPayload.transaction_hash) {
                     break; // Sukses!
                } else {
                     console.log(`[DEBUG] Raw Prepare Response tidak valid:`, JSON.stringify(preparedPayload, null, 2));
                     throw new Error("Gagal mendapatkan transaction_hash");
                }
            } catch (error) {
                if (attempt === 5) {
                    throw new Error("Gagal mengeksekusi prepareSubmission setelah 5 percobaan. Mohon tunggu beberapa saat sebelum menjalankan script lagi.");
                }
                console.log(`[!] Terkena Rate Limit dari Loop Server. Menunggu 65 detik agar penalti reset sebelum mencoba lagi...`);
                await new Promise(resolve => setTimeout(resolve, 65000));
            }
        }

        if (!preparedPayload || !preparedPayload.transaction_hash) {
            throw new Error("Gagal mendapatkan transaction_hash dari tiket prepare-transaction.");
        }

        console.log(`[+] Menandatangani & mengirim transaksi TRADING ke Canton Ledger...`);
        const signedTransactionHash = loop.getSigner().signTransactionHash(preparedPayload.transaction_hash);
        
        // Mengkonversi type ke any karena RpcProvider tidak terexpose dengan benar di TS types
        const result = await (provider as any).executeSubmission({
            command_id: preparedPayload.command_id,
            transaction_data: preparedPayload.transaction_data,
            signature: signedTransactionHash,
        });

        console.log(`[✓] Transaksi TRADING (via Transfer) berhasil dieksekusi! ID:`, result.command_id || "Sukses");

        // Tahap 3: Memberitahu Backend Raven Market agar trade tercatat di History Web
        console.log(`[+] Memberitahu Raven Market Backend untuk mencatat History...`);
        let positionId = null;
        let pointsEarned = 0;
        try {
            const tradeRes = await axios.post('https://testapi.raven.market/trade', {
                series_id: quoteData.series_id || 21,
                trade_type: "BUY",
                side: quoteData.side || "PUT",
                quantity: quoteData.quantity || 10,
                wallet_id: walletId
            }, {
                headers: { 'Content-Type': 'application/json', 'wallet_id': walletId }
            });
            console.log(`[✓] History berhasil dicatat! Data:`, JSON.stringify(tradeRes.data));
            positionId = tradeRes.data.position_id;
            pointsEarned = tradeRes.data.points_earned || 0;
            console.log(`[!] POIN TERKUMPUL DARI TRANSAKSI BUKA: ${pointsEarned} Points!`);
        } catch (apiError: any) {
            console.error(`[!] Peringatan: Transaksi blockchain berhasil, namun gagal mencatat History di Web Raven Market:`, apiError.response?.data || apiError.message);
        }

        return { result, positionId, pointsEarned };
    } catch (error) {
        console.error(`[X] Gagal melakukan transaksi DAML/Transfer:`, error);
        throw error;
    }
}

async function loadAccounts() {
    try {
        if (!fs.existsSync('./accounts.json')) {
            console.error("Error: File accounts.json tidak ditemukan!");
            console.log("Membuat file sample accounts.json...");
            fs.writeFileSync('./accounts.json', JSON.stringify([{"PRIVATE_KEY": "hex", "PARTY_ID": "id"}], null, 4));
            process.exit(1);
        }
        const data = fs.readFileSync('./accounts.json', 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error("Gagal membaca accounts.json", e);
        process.exit(1);
    }
}

async function runAutoTrade() {
    console.clear();
    console.log(`*==========================================*
|  RAVEN MARKET AUTO-TRADE BOT (Point Gen) |
*==========================================*
  > Built by Noya-xen (Github)
  > Follow me on X  : @xinomixo
*==========================================*
`);
    
    const accounts = await loadAccounts();
    console.log(`[SYSTEM] Mengurai ${accounts.length} dompet dari accounts.json...`);
    console.log(`[SYSTEM] Menjalankan Rotasi Tanpa Batas (Infinite Loop)...`);
    
    let round = 1;

    // Loop tanpa batas untuk farming
    while (true) {
        console.log(`\n\n--- [ Memulai Putaran ke-${round} ] ---`);
        for (let i = 0; i < accounts.length; i++) {
            const account = accounts[i];
            
            if (!account.PRIVATE_KEY || account.PRIVATE_KEY === "hex" || !account.PARTY_ID) {
                console.log(`[!] Melewati Akun #${i+1} : Konfigurasi Kosong/Sample.`);
                continue;
            }

            console.log(`\n>>> [ Akun #${i+1} : ${account.PARTY_ID.substring(0, 15)}... ] <<<`);
            
            try {
                // 1. Inisialisasi Ulang Loop SDK per Akun
                loop.init({
                    privateKey: account.PRIVATE_KEY,
                    partyId: account.PARTY_ID,
                    network: NETWORK,
                });

                console.log("[+] Menunggu 5 detik sebelum autentikasi (Bypass Limit VPS)...");
                await new Promise(r => setTimeout(r, 5000));
                console.log("[+] Mengautentikasi wallet ke Loop Network...");
                await loop.authenticate();
                
                // 2. Tampilkan balance terkini
                console.log("[+] Menunggu 5 detik sebelum mengambil saldo...");
                await new Promise(r => setTimeout(r, 5000));
                const provider = loop.getProvider();
                const balances = await provider.getHolding();
                const amuletBalance = balances.find((b: any) => b.instrument_id?.id === 'Amulet');
                console.log(`[+] Saldo Akun #${i+1}: ${amuletBalance?.total_unlocked_coin || 0} CC Unlocked`);

                // 3. Bangun strategi acak
                const { seriesId, side, quantity } = getRandomTradeParams();
                
                // 4. Eksekusi proses trading BUKA (OPEN)
                console.log(`\n--- [ FASE 1: BUKA POSISI (OPEN) ] ---`);
                const quote = await getMarketQuote(account.PARTY_ID, seriesId, side, quantity);
                const openTradeData = await executeTrade(quote, account.PARTY_ID);
                
                // 5. Eksekusi proses trading TUTUP (CLOSE) untuk menggandakan poin
                if (openTradeData && openTradeData.positionId) {
                    console.log(`\n--- [ FASE 2: TUTUP POSISI (CLOSE) ] ---`);
                    console.log(`[~] Menunggu ${RATE_LIMIT_PENALTY_MS/1000} detik sebelum mengeksekusi Close demi mematuhi Canton API...`);
                    await new Promise(r => setTimeout(r, RATE_LIMIT_PENALTY_MS));
                    
                    console.log(`[+] Menjual / Menutup Posisi #${openTradeData.positionId} (Series: ${seriesId}, Side: ${side}, Qty: ${quantity})`);
                    
                    // Kita bisa hit API /trade dengan trade_type: "SELL" untuk menutup posisi
                    try {
                        const closeRes = await axios.post('https://testapi.raven.market/trade', {
                            series_id: seriesId,
                            trade_type: "SELL",
                            side: side,
                            quantity: quantity,
                            wallet_id: account.PARTY_ID,
                            position_id: openTradeData.positionId
                        }, {
                            headers: { 'Content-Type': 'application/json', 'wallet_id': account.PARTY_ID }
                        });
                        
                        console.log(`[✓] Posisi berhasil ditutup! Data:`, JSON.stringify(closeRes.data));
                        console.log(`[!] POIN TERKUMPUL DARI TRANSAKSI TUTUP: ${closeRes.data.points_earned || 0} Points!`);
                        console.log(`[🌟] TOTAL POIN DIPEROLEH AKUN INI: ${openTradeData.pointsEarned + (closeRes.data.points_earned || 0)} Poin`);
                    } catch (closeErr: any) {
                         console.error(`[X] Gagal menutup posisi. API Error:`, closeErr.response?.data || closeErr.message);
                    }
                }
                
                console.log(`\n[✓] Akun #${i+1} Selesai bertrading dan memanen poin untuk putaran ini.`);
                
            } catch (err: any) {
                console.error(`[X] Terjadi kesalahan saat memproses Akun #${i+1}:`, err.message);
                // Lanjut ke akun selanjutnya
            }

            // 6. Jeda sebelum pindah ke Akun Berikutnya
            console.log(`[~] Menunggu ${RATE_LIMIT_PENALTY_MS/1000} detik sebelum pindah iterasi akun berikutnya...`);
            await new Promise(r => setTimeout(r, RATE_LIMIT_PENALTY_MS));
        }
        
        round++;
    }
}

// Jalankan Bot
runAutoTrade().catch(console.error);
