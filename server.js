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

    // ==========================================
    // 1. KONFIGURASI ROYAL DREAM (VIA TOKOGAME)
    // ==========================================
    if (game_name.includes('royal')) {
        targetUrl = 'https://www.tokogame.com/id-id/digital/royal-dream-coins-chips'; 
        inputSelector = 'input[name="userid"]';              
        btnSelector = 'h2[id="Koin Emas"]';                                  
    } 
    // ==========================================
    // 2. KONFIGURASI HIGGS DOMINO (VIA TOKOGAME)
    // ==========================================
    else if (game_name.includes('higgs') || game_name.includes('island')) {
        targetUrl = 'https://www.tokogame.com/id-id/digital/higgs-domino-koin-resmi'; 
        inputSelector = 'input[name="userid"]';
        btnSelector = 'h2[id="Kartu Emas (Tukar ke Koin Emas)"]';
    } 
    else {
        return res.json({ success: false, is_manual: true, message: "Game tidak didukung otomatis." });
    }

    let browser;
    let page; // Dideklarasikan di luar try agar bisa diakses oleh catch untuk screenshot
    
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
        page = await browser.newPage();
        
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
        
        // 1. Tunggu dan Ketik ID
        console.log('Menunggu elemen input ID...');
        await page.waitForSelector(inputSelector, { timeout: 15000 });
        await page.type(inputSelector, account_id);
        
        // Jeda 1 detik agar script Tokogame mendeteksi bahwa ada ID yang diketik
        await new Promise(r => setTimeout(r, 1000));
        
        // 2. Klik tombol kotak nominal dengan Javascript Evaluation (Anti-Gagal)
        console.log('Mengklik kotak nominal...');
        await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            if (element) {
                element.click();
            } else {
                throw new Error(`Tombol nominal ${selector} tidak ditemukan!`);
            }
        }, btnSelector);
        
        // 3. Tunggu popup SweetAlert2 muncul secara keseluruhan
        console.log('Menunggu popup konfirmasi nama muncul...');
        await page.waitForSelector('.swal2-popup', { timeout: 15000 });
        
        // Jeda setengah detik agar animasi popup selesai dan teks termuat sempurna
        await new Promise(r => setTimeout(r, 500));
        
        // 4. Ekstrak nama dari seluruh teks di dalam popup
        const accountName = await page.evaluate(() => {
            const popup = document.querySelector('.swal2-popup');
            if (!popup) return '';
            
            const text = popup.innerText || '';
            const lines = text.split('\n');
            
            for (let line of lines) {
                // Cari baris yang mengandung kata "Username" atau "Nama" (huruf kecil/besar bebas)
                if (line.toLowerCase().includes('username') || line.toLowerCase().includes('nama')) {
                    let parts = line.split(':'); 
                    if (parts.length > 1) {
                        return parts[1].trim(); 
                    }
                }
            }
            
            // Jika tidak ada kata "Username:", ambil baris ke-2 atau gabungkan semua teks
            return lines.length > 1 ? lines[1].trim() : text.replace(/\n/g, ' ').trim();
        });
        
        console.log(`[BERHASIL] Nama ditemukan: ${accountName}`);

        res.json({ success: true, account_name: accountName, is_manual: false });

    } catch (error) {
        console.log(`[ERROR] ${error.message}`);
        
        // Ambil screenshot jika terjadi error untuk proses debugging
        if (page) {
            try {
                await page.screenshot({ path: 'error-screenshot.png' });
                console.log('[INFO] Screenshot halaman error disimpan sebagai error-screenshot.png');
            } catch (screenshotError) {
                console.log('Gagal mengambil screenshot.');
            }
        }

        res.json({ success: false, is_manual: true, message: "Sistem antri/sibuk karena proteksi Cloudflare atau web berubah." });
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
