export const config = {
    // Pengaturan Jaringan
    NETWORK: 'testnet',
    
    // Jeda Penalti Rate Limit Canton API
    RATE_LIMIT_PENALTY_MS: 65000,
    
    // Faucet URL untuk Google Scripts
    FAUCET_URL: 'https://script.google.com/macros/s/AKfycbwgiMxbheDNADq2NRCox1kmyF6sysyB16n6rMMFfrCxdEwboz9Z8qLqBf359SwbloUc/exec',
    
    // Alamat Party ID tujuan untuk pengumpulan (sweep) hasil klaim Faucet
    // Kosongkan jika tidak ingin melakukan fitur kirim otomatis
    SWEEP_DESTINATION_PARTY_ID: '', 
    
    // Sisa Saldo CC yang disisakan pada akun faucet (sebagai fee transaksi) minimal 0.5
    SWEEP_AMOUNT_TO_KEEP: 0.5
};
