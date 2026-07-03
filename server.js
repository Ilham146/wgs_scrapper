const express = require('express');
const cors = require('cors');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// VARIABEL GLOBAL BROWSER, ANTRIAN, & STATISTIK
// ==========================================
let browser; 
let isScraping = false;
const requestQueue = [];

// 🚀 FITUR BARU: Objek untuk menyimpan statistik kinerja bot
const botStats = {
    server_started: new Date().toLocaleString('id-ID'),
    total_request: 0,
    success_count: 0,
    error_bot_count: 0, // Gagal karena timeout/selector berubah
    error_user_count: 0 // Gagal karena ID salah dari sananya
};

// ==========================================
// ROUTE UNTUK MELIHAT STATISTIK (EVALUASI)
// ==========================================
app.get('/api/stats', (req, res) => {
    const successRate = botStats.total_request === 0 ? 0 : ((botStats.success_count / botStats.total_request) * 100).toFixed(1);
    const botErrorRate = botStats.total_request === 0 ? 0 : ((botStats.error_bot_count / botStats.total_request) * 100).toFixed(1);

    res.json({
        success: true,
        data: {
            ...botStats,
            success_rate: `${successRate}%`,
            bot_error_rate: `${botErrorRate}%`
        }
    });
});

const initBrowser = async () => {
    try {
        console.log('[SISTEM] Memulai browser...');
        browser = await puppeteer.launch({ 
            headless: true, 
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        });
        console.log('[SISTEM] Browser berhasil diluncurkan dan siap menerima request.');
        
        browser.on('disconnected', () => {
            console.log('[SISTEM] Browser terputus! Melakukan restart...');
            initBrowser();
        });
    } catch (error) {
        console.error('[ERROR] Gagal memuat browser:', error.message);
    }
};

const processQueue = async () => {
    if (isScraping || requestQueue.length === 0 || !browser) return;
    
    isScraping = true;
    const { req, res } = requestQueue.shift();
    
    try {
        await runScraper(req, res);
    } catch (error) {
        if (!res.headersSent) {
            res.json({ success: false, is_manual: true, message: "Terjadi kesalahan internal server." });
        }
    } finally {
        isScraping = false;
        processQueue(); 
    }
};

app.post('/api/cek-akun', (req, res) => {
    const { account_id } = req.body;
    if (!account_id) return res.status(400).json({ success: false, message: "ID kosong" });

    // 🚀 Update statistik total request
    botStats.total_request++;

    requestQueue.push({ req, res });
    console.log(`[ANTRIAN] ID: ${account_id} masuk antrian. Menunggu giliran: ${requestQueue.length} request.`);
    
    processQueue();
});

const runScraper = async (req, res) => {
    const { game_name, account_id, server_id } = req.body;

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

    let page; 
    
    try {
        const startTime = Date.now();
        console.log(`\n[PROSES] Mulai Scraping ${game_name} | ID: ${account_id}`);

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector(inputSelector, { visible: true, timeout: 15000 });
        
        await new Promise(r => setTimeout(r, 1200)); 

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
        await page.keyboard.press('Tab');
        
        let accountName = '';
        let loopCount = 0;
        
        while (loopCount < 40) { 
            await new Promise(r => setTimeout(r, 200)); 
            
            accountName = await page.evaluate(() => {
                const popup = document.querySelector('.swal2-popup');
                if (popup) {
                    const text = popup.innerText || '';
                    const textLower = text.toLowerCase();
                    
                    if (textLower.includes('mencari') || textLower.includes('loading')) return 'LOADING';
                    
                    const isInfoIcon = popup.querySelector('.swal2-info');
                    const isErrorIcon = popup.querySelector('.swal2-error');
                    
                    if (isInfoIcon || isErrorIcon || textLower.includes('tidak ditemukan') || textLower.includes('salah') || textLower.includes('gagal')) {
                        return 'ERROR_WEB:ID Anda salah, cek User ID Anda.';
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

                const allDivs = document.querySelectorAll('div, span, p, b, strong');
                for (let el of allDivs) {
                    const txt = el.innerText || '';
                    const txtLower = txt.toLowerCase();

                    if (txtLower.includes('tidak ditemukan') && (txtLower.includes('id') || txtLower.includes('pemain'))) {
                         return 'ERROR_WEB:ID Anda salah, cek User ID Anda.';
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
        
        if (accountName.startsWith('ERROR_WEB:')) {
            const pesanError = accountName.replace('ERROR_WEB:', '');
            throw new Error(`Ditolak: ${pesanError}`);
        }

        if (accountName === 'LOADING' || accountName === '') {
            throw new Error('Timeout: Web tidak merespons. Mungkin sistem web sedang sibuk.');
        }
        
        const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[BERHASIL] ${accountName} (Durasi total: ${timeTaken} detik)`);

        // 🚀 Update statistik: Sukses
        botStats.success_count++;

        res.json({ success: true, account_name: accountName, is_manual: false });
        
    } catch (error) {
        console.log(`[ERROR] ${error.message}`);
        const isDitolak = error.message.includes('Ditolak');
        
        // 🚀 Update statistik: Gagal
        if (isDitolak) {
            botStats.error_user_count++; // Gagal karena ID dari pembeli memang salah
        } else {
            botStats.error_bot_count++; // Gagal karena scraper timeout / ada perubahan web
        }

        res.json({ 
            success: false, 
            is_manual: !isDitolak, 
            message: isDitolak ? error.message.replace('Ditolak: ', '') : "Sistem sedang sibuk, silakan input manual username Anda." 
        });
    } finally {
        if (page && !page.isClosed()) {
            await page.close();
            
            // 🚀 Tampilkan rekap cepat di terminal setelah setiap request selesai
            console.log(`[STATISTIK SEMENTARA] Req: ${botStats.total_request} | Sukses: ${botStats.success_count} | Error Bot: ${botStats.error_bot_count} | Error User: ${botStats.error_user_count}`);
            console.log(`[SELESAI] Tab ditutup. Lanjut antrian...\n`);
        }
    }
};

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    await initBrowser();
    console.log(`🚀 Stealth Scraper Turbo dengan Sistem Antrian berjalan di port ${PORT}`);
});
