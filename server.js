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
        console.log(`\n[TURBO-FINAL] Scraping ${game_name} | ID: ${account_id}`);

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

        console.log('Menuju situs...');
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector(inputSelector, { visible: true, timeout: 15000 });
        
        await new Promise(r => setTimeout(r, 1200)); 

        console.log('[1/3] Mengetik ID...');
        await page.focus(inputSelector);
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace'); 

        await page.type(inputSelector, account_id, { delay: 40 });
        
        const checkValue = await page.$eval(inputSelector, el => el.value);
        if (checkValue !== account_id) {
            throw new Error('Ketikan ditolak oleh sistem web.');
        }

        await new Promise(r => setTimeout(r, 400)); 

        console.log('[2/3] Meminta data ke server...');
        await page.keyboard.press('Tab');
        
        console.log('[3/3] Memindai respons...');
        let accountName = '';
        let loopCount = 0;
        
        // Polling respons API Tokogame
        while (loopCount < 40) { 
            await new Promise(r => setTimeout(r, 200)); 
            
            accountName = await page.evaluate(() => {
                const popup = document.querySelector('.swal2-popup');
                if (popup) {
                    const text = popup.innerText || '';
                    const textLower = text.toLowerCase();
                    
                    if (textLower.includes('mencari') || textLower.includes('loading')) return 'LOADING';
                    
                    // DETEKSI ERROR DARI TOKOGAME: Jika web bilang salah/tidak ketemu, tangkap pesannya!
                    if (textLower.includes('tidak ditemukan') || textLower.includes('salah') || textLower.includes('gagal') || textLower.includes('not found') || textLower.includes('format')) {
                        return 'ERROR_WEB:' + text.replace(/\n/g, ' ').trim();
                    }

                    const lines = text.split('\n');
                    for (let line of lines) {
                        if (line.toLowerCase().includes('username') || line.toLowerCase().includes('nama')) {
                            let parts = line.split(':'); 
                            if (parts.length > 1) return parts[1].trim(); 
                        }
                    }
                    return lines.length > 1 ? lines[1].trim() : text.replace(/\n/g, ' ').trim();
                }

                // Fallback pencarian teks biasa
                const allDivs = document.querySelectorAll('div, span, p, b, strong');
                for (let el of allDivs) {
                    const txt = el.innerText || '';
                    const txtLower = txt.toLowerCase();

                    // Deteksi Error di teks biasa
                    if (txtLower.includes('tidak ditemukan') && (txtLower.includes('id') || txtLower.includes('pemain'))) {
                         return 'ERROR_WEB:' + txt.replace(/\n/g, ' ').trim();
                    }

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
        
        // TANGANI ERROR SPESIFIK DARI WEBSITE
        if (accountName.startsWith('ERROR_WEB:')) {
            const pesanError = accountName.replace('ERROR_WEB:', '');
            throw new Error(`Ditolak oleh Tokogame: ${pesanError}`);
        }

        if (accountName === 'LOADING' || accountName === '') {
            throw new Error('Timeout: Web tidak merespons. Mungkin sistem web sedang sibuk.');
        }
        
        const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[BERHASIL] ${accountName} (Durasi total: ${timeTaken} detik)`);

        res.json({ success: true, account_name: accountName, is_manual: false });
        
    } catch (error) {
        console.log(`[ERROR] ${error.message}`);
        // Kirim response error yang lebih informatif ke frontend Anda
        res.json({ success: false, is_manual: true, message: error.message.includes('Ditolak') ? error.message : "Gagal cek akun. Sistem sibuk atau timeout." });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Stealth Scraper Turbo-FINAL berjalan di port ${PORT}`);
});
