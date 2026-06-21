const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Aktifkan Stealth Plugin agar tidak mudah terdeteksi Cloudflare
puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

// Route untuk melihat screenshot jika terjadi error (DEBUGGING)
app.get('/lihat-error', (req, res) => {
    res.sendFile(__dirname + '/error-screenshot.png');
});

app.post('/api/cek-akun', async (req, res) => {
    const { game_name, account_id, server_id } = req.body;

    if (!account_id) return res.status(400).json({ success: false, message: "ID kosong" });

    let targetUrl = '';
    const inputSelector = 'input[placeholder="Masukkan User ID"]'; // Selektor universal Tokogame
    
    // Konfigurasi target
    if (game_name.includes('royal')) {
        targetUrl = 'https://www.tokogame.com/id-id/digital/royal-dream-coins-chips'; 
    } else if (game_name.includes('higgs') || game_name.includes('island')) {
        targetUrl = 'https://www.tokogame.com/id-id/digital/higgs-domino-koin-resmi'; 
    } else {
        return res.json({ success: false, is_manual: true, message: "Game tidak didukung." });
    }

    let browser;
    let page;
    
    try {
        console.log(`[START] Scraping ${game_name} | ID: ${account_id} (FAST MODE)`);

        browser = await puppeteer.launch({ 
            headless: "new",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        });
        
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Optimasi: Blokir request gambar/media/font agar web Tokogame jauh lebih ringan & cepat
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if(['image', 'media', 'font'].includes(req.resourceType())) req.abort();
            else req.continue();
        });

        console.log(`Bypass Cloudflare menuju: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        
        // 1. Ketik ID dengan simulasi keyboard (Anti-Bot Check)
        await page.waitForSelector(inputSelector, { visible: true, timeout: 15000 });
        await new Promise(r => setTimeout(r, 1000));
        
        await page.evaluate((sel) => {
            const inputs = document.querySelectorAll(sel);
            for (let el of inputs) {
                if (el.offsetWidth > 0 && el.offsetHeight > 0) {
                    el.focus(); el.click(); el.value = ''; return;
                }
            }
        }, inputSelector);
        
        await page.keyboard.type(account_id, { delay: 50 });
        await new Promise(r => setTimeout(r, 1000));
        
        // 2. Klik layar untuk memicu Tokogame memproses input
        console.log('Mengklik layar untuk memicu pengecekan...');
        await page.mouse.click(10, 10);
        await page.click('body');
        
        // 3. Smart Polling: Tunggu popup muncul, cek setiap 500ms
        console.log('Menunggu popup konfirmasi...');
        await page.waitForSelector('.swal2-popup', { timeout: 15000 });
        
        let accountName = '';
        for(let i = 0; i < 15; i++) { // Max coba cek 15 kali (7.5 detik)
            await new Promise(r => setTimeout(r, 500));
            accountName = await page.evaluate(() => {
                const popup = document.querySelector('.swal2-popup');
                if (!popup) return '';
                const text = popup.innerText || '';
                
                // Jika masih ada kata "Mencari", berarti masih loading
                if (text.toLowerCase().includes('mencari')) return 'LOADING';
                
                const lines = text.split('\n');
                for (let line of lines) {
                    if (line.toLowerCase().includes('username') || line.toLowerCase().includes('nama')) {
                        let parts = line.split(':');
                        if (parts.length > 1) return parts[1].trim();
                    }
                }
                return lines.length > 1 ? lines[1].trim() : text.replace(/\n/g, ' ').trim();
            });
            
            // Jika sudah dapat nama yang valid, langsung break loop
            if (accountName !== 'LOADING' && accountName !== '') break;
        }
        
        if (accountName === 'LOADING' || accountName === '') throw new Error('Gagal memuat nama.');
        
        console.log(`[BERHASIL] Nama ditemukan: ${accountName}`);
        res.json({ success: true, account_name: accountName, is_manual: false });

    } catch (error) {
        console.log(`[ERROR] ${error.message}`);
        if (page) await page.screenshot({ path: 'error-screenshot.png' });
        res.json({ success: false, is_manual: true, message: "Sistem antri/sibuk." });
    } finally {
        if (browser) await browser.close();
        console.log('[SELESAI] Browser ditutup.');
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Stealth Scraper WGS berjalan di port ${PORT}`));
