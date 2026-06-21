const express = require('express');
const cors = require('cors');

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
    let inputSelector = 'input[placeholder="Masukkan User ID"]';

    if (game_name.includes('royal')) {
        targetUrl = 'https://www.tokogame.com/id-id/digital/royal-dream-coins-chips'; 
    } 
    else if (game_name.includes('higgs') || game_name.includes('island')) {
        targetUrl = 'https://www.tokogame.com/id-id/digital/higgs-domino-koin-emas'; 
    } 
    else {
        return res.json({ success: false, is_manual: true, message: "Game tidak didukung otomatis." });
    }

    let browser;
    let page; 
    
    try {
        const startTime = Date.now();
        console.log(`\n[TURBO-V3] Scraping ${game_name} | ID: ${account_id}`);

        browser = await puppeteer.launch({ 
            headless: true, 
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        });
        page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // FITUR BLOKIR GAMBAR DIHAPUS AGAR CLOUDFLARE API TIDAK CURIGA
        
        console.log('Menuju situs...');
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Tunggu form muncul
        await page.waitForSelector(inputSelector, { visible: true, timeout: 15000 });
        
        // Jeda untuk memastikan React Hydration dan background script Cloudflare selesai
        await new Promise(r => setTimeout(r, 1200)); 

        console.log('[1/3] Mengetik ID...');
        await page.focus(inputSelector);
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace'); 

        // Ketik dengan kecepatan semi-turbo
        await page.type(inputSelector, account_id, { delay: 40 });
        
        const checkValue = await page.$eval(inputSelector, el => el.value);
        if (checkValue !== account_id) {
            throw new Error('Ketikan ditolak oleh sistem web.');
        }

        // Jeda agar state React tersimpan sebelum form kehilangan fokus
        await new Promise(r => setTimeout(r, 400)); 

        console.log('[2/3] Meminta data ke server...');
        await page.keyboard.press('Tab');
        
        console.log('[3/3] Memindai respons nama...');
        let accountName = '';
        let loopCount = 0;
        
        // Polling cepat: Maksimal tunggu 8 detik (40 x 200ms)
        while (loopCount < 40) { 
            await new Promise(r => setTimeout(r, 200)); 
            
            accountName = await page.evaluate(() => {
                const popup = document.querySelector('.swal2-popup');
                if (popup) {
                    const text = popup.innerText || '';
                    if (text.toLowerCase().includes('mencari') || text.toLowerCase().includes('loading')) return 'LOADING';
                    const lines = text.split('\n');
                    for (let line of lines) {
                        if (line.toLowerCase().includes('username') || line.toLowerCase().includes('nama')) {
                            let parts = line.split(':'); 
                            if (parts.length > 1) return parts[1].trim(); 
                        }
                    }
                    return lines.length > 1 ? lines[1].trim() : text.replace(/\n/g, ' ').trim();
                }

                // Fallback pencarian teks biasa jika desain web berubah
                const allDivs = document.querySelectorAll('div, span, p, b, strong');
                for (let el of allDivs) {
                    const txt = el.innerText || '';
                    if (txt.includes('Username') || txt.includes('Nama')) {
                        const lines = txt.split('\n');
                        for (let line of lines) {
                            if ((line.toLowerCase().includes('username') || line.toLowerCase().includes('nama')) && line.includes(':')) {
                                let parts = line.split(':');
                                if (parts[1] && parts[1].trim() !== '') return parts[1].trim();
                            }
                        }
                    }
                }
                return '';
            });

            if (accountName !== 'LOADING' && accountName !== '') break; 
            loopCount++;
        }
        
        if (accountName === 'LOADING' || accountName === '') {
            throw new Error('Timeout: Web tidak merespons atau ID salah.');
        }
        
        const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[BERHASIL] ${accountName} (Durasi total: ${timeTaken} detik)`);

        res.json({ success: true, account_name: accountName, is_manual: false });
        
    } catch (error) {
        console.log(`[ERROR] ${error.message}`);
        res.json({ success: false, is_manual: true, message: "Gagal cek akun. ID salah atau timeout." });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Stealth Scraper Turbo-V3 berjalan di port ${PORT}`);
});
