const express = require('express');
const cors = require('cors');

// Gunakan Puppeteer Extra & Stealth Plugin untuk menembus Cloudflare
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/cek-akun', async (req, res) => {
    const { game_name, account_id, server_id } = req.body;

    if (!account_id) return res.status(400).json({ success: false, message: "ID kosong" });

    let targetUrl = '';
    let inputSelector = '';
    let btnSelector = '';
    let resultSelector = '';

    // ==========================================
    // 1. KONFIGURASI ROYAL DREAM (VIA TOKOGAME)
    // ==========================================
    // ==========================================
    // 1. KONFIGURASI ROYAL DREAM (VIA TOKOGAME)
    // ==========================================
    if (game_name.includes('royal')) {
        targetUrl = 'https://www.tokogame.com/id-id/digital/royal-dream-coins-chips'; 
        inputSelector = 'input[name="userid"]'; // <--- INI YANG BENAR           
        btnSelector = '[id="Koin Emas"]';                 
        resultSelector = '#swal2-title';                 
    } 
    // ==========================================
    // 2. KONFIGURASI HIGGS DOMINO (VIA TOKOGAME)
    // ==========================================
    else if (game_name.includes('higgs') || game_name.includes('island')) {
        targetUrl = 'https://www.tokogame.com/id-id/digital/higgs-domino-koin-resmi'; 
        inputSelector = 'input[name="userid"]';
        btnSelector = '[id="Kartu Emas (Tukar ke Koin Emas)"]';
        resultSelector = '#swal2-title';
    } 
    else {
        return res.json({ success: false, is_manual: true, message: "Game tidak didukung otomatis." });
    }

    let browser;
    try {
        console.log(`[START] Scraping ${game_name} | ID: ${account_id} (STEALTH MODE)`);

        browser = await puppeteer.launch({ 
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled' // Mencegah deteksi robot
            ]
        });
        const page = await browser.newPage();
        
        // Randomize User-Agent agar terlihat seperti pengguna PC Windows biasa
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Blokir gambar/css/font agar loading web Tokogame jauh lebih cepat
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if(['image', 'stylesheet', 'font'].includes(req.resourceType())){
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log(`Bypass Cloudflare menuju: ${targetUrl}`);
        // Tunggu domcontentloaded agar tidak perlu menunggu tracking web Tokogame selesai
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // 1. Ketik ID
        await page.type(inputSelector, account_id);
        
        // Jeda 1 detik agar script Tokogame mendeteksi bahwa ada ID yang diketik
        await new Promise(r => setTimeout(r, 1000));
        
        // 2. Klik tombol kotak nominal (Koin Emas / Kartu Emas)
        console.log('Mengklik kotak nominal...');
        await page.click(btnSelector);
        
        // 3. Tunggu popup SweetAlert2 muncul
        console.log('Menunggu popup konfirmasi nama muncul...');
        await page.waitForSelector(resultSelector, { timeout: 10000 });
        
        // 4. Ekstrak nama dan buang tulisan "Username:"
        const accountName = await page.$eval(resultSelector, el => {
            let text = el.innerText || ''; // Contoh format dari web: "Username: KakekMerah"
            let parts = text.split(':'); 
            if (parts.length > 1) {
                return parts[1].trim(); // Ambil kata setelah titik dua, hasilnya: "KakekMerah"
            }
            return text.trim();
        });
        
        console.log(`[BERHASIL] Nama ditemukan: ${accountName}`);

        res.json({ success: true, account_name: accountName, is_manual: false });

    } catch (error) {
        console.log(`[ERROR] ${error.message}`);
        res.json({ success: false, is_manual: true, message: "Sistem antri/sibuk karena proteksi Cloudflare." });
    } finally {
        if (browser) {
            await browser.close();
            console.log('[SELESAI] Browser ditutup untuk menghemat memori.');
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Stealth Scraper WGS berjalan di port ${PORT}`);
});
