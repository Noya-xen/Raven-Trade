import puppeteer from 'puppeteer';
import * as fs from 'fs';
import { loop } from '@fivenorth/loop-sdk/server';
import { config } from './config';

async function loadFaucetAccounts() {
    try {
        if (!fs.existsSync('./faucet_accounts.txt')) {
            console.error("Error: File faucet_accounts.txt tidak ditemukan!");
            console.log("Membuat file sample faucet_accounts.txt... (Format: privateKey|partyId|@telegramHandle)");
            fs.writeFileSync('./faucet_accounts.txt', 'your_hex|your_party_id|@yourusername\n');
            process.exit(1);
        }
        const data = fs.readFileSync('./faucet_accounts.txt', 'utf8');
        const lines = data.split('\n').map(line => line.trim()).filter(line => line !== '' && !line.startsWith('#'));
        
        const accounts = [];
        for (const line of lines) {
            const parts = line.split('|');
            if (parts.length >= 3) {
                const privateKey = parts[0].trim();
                const partyId = parts[1].trim();
                let telegram = parts[2].trim();
                
                // Pastikan telegram mulai dengan @
                if (!telegram.startsWith('@')) telegram = '@' + telegram;

                accounts.push({
                    PRIVATE_KEY: privateKey,
                    PARTY_ID: partyId,
                    TELEGRAM: telegram
                });
            } else if (parts.length === 2 && parts[1].includes('@')) {
                accounts.push({
                    PARTY_ID: parts[0].trim(),
                    TELEGRAM: parts[1].trim()
                });
            }
        }
        
        if (accounts.length === 0) {
            console.error("Tidak ada akun valid yang ditemukan di faucet_accounts.txt");
            process.exit(1);
        }
        
        return accounts;
    } catch (e) {
        console.error("Gagal membaca faucet_accounts.txt", e);
        process.exit(1);
    }
}

async function sweepBalance(account: any, i: number) {
    if (!config.SWEEP_DESTINATION_PARTY_ID || config.SWEEP_DESTINATION_PARTY_ID.trim() === '') {
        return; // Skip if no destination
    }

    if (!account.PRIVATE_KEY) {
        console.log(`[!] Private Key untuk sweep Akun #${i + 1} tidak tersedia. Skip Sweep.`);
        return;
    }

    try {
        console.log(`\n[+] Memeriksa saldo Akun #${i + 1} untuk Sweep...`);
        loop.init({
            privateKey: account.PRIVATE_KEY,
            partyId: account.PARTY_ID,
            network: config.NETWORK as any,
        });

        console.log(`[+] Mengautentikasi wallet ke Loop Network...`);
        // Jeda untuk bypass limit VPS
        await new Promise(r => setTimeout(r, 5000));
        await loop.authenticate();

        console.log(`[+] Mengambil saldo saat ini...`);
        await new Promise(r => setTimeout(r, 5000));
        const provider = loop.getProvider();
        const balances = await provider.getHolding();
        const amuletBalance = balances.find((b: any) => b.instrument_id?.id === 'Amulet');
        const currentBalance = parseFloat(amuletBalance?.total_unlocked_coin || "0");
        
        console.log(`[+] Saldo saat ini: ${currentBalance} CC`);

        const amountToSweep = currentBalance - config.SWEEP_AMOUNT_TO_KEEP;

        if (amountToSweep > 0.1) { 
            console.log(`[+] Mengeksekusi Transfer (Sweep) sebesar ${amountToSweep.toFixed(8)} CC ke ${config.SWEEP_DESTINATION_PARTY_ID.substring(0, 15)}...`);
            
            const amountString = amountToSweep.toFixed(8).toString();
            // Create transfer payload
            const transferPayloadStructure = await provider.transfer(
                config.SWEEP_DESTINATION_PARTY_ID,
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

            console.log(`[!] Menunggu ${config.RATE_LIMIT_PENALTY_MS / 1000} detik sebelum pengecekan transaksi sweep...`);
            await new Promise(r => setTimeout(r, config.RATE_LIMIT_PENALTY_MS));

            let preparedPayload = null;
            for (let attempt = 1; attempt <= 5; attempt++) {
                console.log(`[+] Mengirim persiapan transaksi Sweep (Percobaan ${attempt}/5)...`);
                try {
                    preparedPayload = await (provider as any).prepareSubmission(transferPayloadStructure);

                    if (preparedPayload && preparedPayload.message && preparedPayload.message.includes("Rate Limited")) {
                        throw new Error("Rate Limited");
                    }

                    if (preparedPayload && preparedPayload.transaction_hash) {
                        break; 
                    } else {
                        throw new Error("Gagal mendapatkan kode konfirmasi transaksi hash");
                    }
                } catch (error) {
                    if (attempt === 5) {
                        throw new Error("Gagal mengirim sweep. Batas maksimum percobaan sudah dilampaui.");
                    }
                    console.log(`[!] Terkena Rate Limit Transaksi Canton. Menunggu 65 detik untuk bypass...`);
                    await new Promise(resolve => setTimeout(resolve, 65000));
                }
            }

            if (!preparedPayload || !preparedPayload.transaction_hash) {
                throw new Error("Batalkan sweep, gagal mendapatkan hash_transaction (kemungkinan jaringan sibuk).");
            }

            console.log(`[+] Menandatangani & Finalisasi transaksi SWEEP...`);
            const signedTransactionHash = loop.getSigner().signTransactionHash(preparedPayload.transaction_hash);

            const result = await (provider as any).executeSubmission({
                command_id: preparedPayload.command_id,
                transaction_data: preparedPayload.transaction_data,
                signature: signedTransactionHash,
            });

            console.log(`[✓] Sweep Berhasil dikumpulkan! Command ID: ${result.command_id || "Selesai"}`);
            // Wait penalty again before faucet or next action to leave some space.
            await new Promise(r => setTimeout(r, 10000));

        } else {
            console.log(`[!] Saldo terlalu sedikit untuk di-sweep (Sisasakan minimal ${config.SWEEP_AMOUNT_TO_KEEP} CC). Skip sweep fitur.`);
        }
        
    } catch (e: any) {
        console.error(`[X] Gagal melakukan sweep/pengumpulan hasil untuk akun #${i + 1}:`, e.response?.data || e.message);
    }
}

async function runAutoFaucet() {
    console.clear();
    console.log(`*==========================================*
|        RAVEN MARKET AUTO FAUCET          |
*==========================================*
  > Claim Faucet Otomatis + Auto Sweep
*==========================================*
`);

    const accounts = await loadFaucetAccounts();
    console.log(`[SYSTEM] Mengurai ${accounts.length} akun dari faucet_accounts.txt...`);
    if (config.SWEEP_DESTINATION_PARTY_ID) {
        console.log(`[SYSTEM] Mode KUMPULKAN (SWEEP) AKTIF. Tujuan: ${config.SWEEP_DESTINATION_PARTY_ID}`);
    } else {
        console.log(`[SYSTEM] Mode KUMPULKAN (SWEEP) TIDAK AKTIF.`);
    }
    
    let round = 1;

    while (true) {
        console.log(`\n\n--- [ Memulai Putaran Faucet ke-${round} ] ---`);
        const browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        try {
            for (let i = 0; i < accounts.length; i++) {
                const account = accounts[i];
                console.log(`\n\n======================================================`);
                console.log(`>>> [ Memproses Akun #${i + 1} | TG: ${account.TELEGRAM} ] <<<`);
                
                // 1. Eksekusi Sweep (jika ada sisa CC dari claim sebelumnya)
                await sweepBalance(account, i);

                // 2. Eksekusi Klaim Faucet
                console.log(`\n[+] Memulai proses klaim Faucet Google Form...`);
                const page = await browser.newPage();
                try {
                    console.log(`[+] Mengakses halaman form klaim...`);
                    await page.goto(config.FAUCET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
                    
                    let targetFrame: any = null;
                    const maxWait = 15000;
                    const startWaitTime = Date.now();
                    while (Date.now() - startWaitTime < maxWait) {
                        for (const f of page.frames()) {
                            try {
                                const tgHandle = await f.$('#tg');
                                if (tgHandle) {
                                    targetFrame = f;
                                    break;
                                }
                            } catch(e) {}
                        }
                        if (targetFrame) break;
                        await new Promise(r => setTimeout(r, 500));
                    }

                    if (!targetFrame) throw new Error("Iframe Google Form / elemen #tg tidak ditemukan");
                    
                    // Tunggu sampai input telegram muncul
                    await targetFrame.waitForSelector('#tg', { visible: true, timeout: 15000 });
                    
                    console.log(`[+] Mengisi field (TG: ${account.TELEGRAM}, Akun: ${account.PARTY_ID.substring(0,10)})...`);
                    await targetFrame.type('#tg', account.TELEGRAM, { delay: 50 });
                    await targetFrame.type('#pid', account.PARTY_ID, { delay: 50 });
                    
                    console.log(`[+] Mengirim request ke Server Faucet...`);
                    await targetFrame.click('#submit-btn');
                    
                    await targetFrame.waitForFunction(
                        `document.getElementById('global-err')?.classList.contains('show') || document.getElementById('success-view')?.classList.contains('show')`,
                        { timeout: 30000 }
                    );
                    
                    const isSuccess = await targetFrame.evaluate(() => {
                        const successView = document.getElementById('success-view');
                        return successView && successView.classList.contains('show');
                    });
                    
                    if (isSuccess) {
                        console.log(`[✓] BERHASIL! Saldo Faucet sukses dikreditkan.`);
                    } else {
                        const errMsg = await targetFrame.evaluate(() => {
                            const errView = document.getElementById('global-err');
                            return errView ? errView.textContent : "Unknown Error";
                        });
                        console.log(`[X] GAGAL: ${errMsg}`);
                    }
                    
                } catch (err: any) {
                    console.error(`[!] Terjadi kesalahan ketika akses bot Faucet: ${err.message}`);
                } finally {
                    await page.close();
                }
                
                if (i < accounts.length - 1) {
                    console.log(`[~] Jeda 5 detik sebelum melanjutkan ke Akun berikutnya...`);
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
        } finally {
            console.log(`\n[SYSTEM] Putaran klaim ke-${round} telah selesai. Menutup mesin perayap (browser)...`);
            await browser.close();
        }

        // Delay 24 hours + 5 minutes buffer
        const WAIT_TIME_MS = (24 * 60 * 60 * 1000) + (5 * 60 * 1000);
        console.log(`\n[SYSTEM] Menunggu 24 jam (plus 5 menit buffer) sebelum melakukan putaran selanjutnya...`);
        console.log(`[SYSTEM] PC/VPS harus tetap hidup agar timer berjalan.`);
        await new Promise(r => setTimeout(r, WAIT_TIME_MS));
        round++;
    }
}

runAutoFaucet().catch(console.error);
