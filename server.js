const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// VARIABEL GLOBAL, ANTRIAN, & STATISTIK
// ==========================================
let browser;
let isScraping = false;
const requestQueue = [];

const botStats = {
    server_started: new Date().toLocaleString('id-ID'),
    total_request: 0,
    success_count: 0,
    error_bot_count: 0,
    error_user_count: 0
};

// ==========================================
// ROUTES (STATISTIK & DEBUGGING)
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

app.get('/lihat-error', (req, res) => {
    res.sendFile(__dirname + '/error-screenshot.png');
});

// ==========================================
// MANAJEMEN BROWSER & ANTRIAN
// ==========================================
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
        console.log('[SISTEM] Browser siap menerima request.');
        
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
        if (!res.headersSent) res.json({ success: false, is_manual: true, message: "Kesalahan server internal." });
    } finally {
        isScraping = false;
        processQueue(); 
    }
};

app.post('/api/cek-akun', (req, res) => {
    const { account_id } = req.body;
    if (!account_id) return res.status(400).json({ success: false, message: "ID kosong" });

    botStats.total_request++;
    requestQueue.push({ req, res });
    console.log(`[ANTRIAN] ID: ${account_id} masuk antrian (${requestQueue.length} menunggu).`);
    
    processQueue();
});

// ==========================================
// MESIN SCRAPER (FAST MODE)
// ==========================================
const runScraper = async (req, res) => {
    const { game_name, account_id } = req.body;
    let targetUrl = '';

    if (game_name.includes('royal')) {
        targetUrl = 'https://www.tokogame.com/id-id/digital/royal-dream-coins-chips'; 
    } else if (game_name.includes('higgs') || game_name.includes('island')) {
        targetUrl = 'https://www.tokogame.com/id-id/digital/higgs-domino-koin-emas'; 
    } else {
        return res.json({ success: false, is_manual: true, message: "Game tidak didukung." });
    }

    let page;
    try {
        const startTime = Date.now();
        console.log(`\n[PROSES] Mulai Scraping ${game_name} | ID: ${account_id}`);

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            const url = req.url();
            
            // Optimasi Jaringan: Blokir gambar & tracker, biarkan CSS lewat agar boundingBox berfungsi
            if (
                ['image', 'media', 'font'].includes(resourceType) || 
                url.includes('google-analytics') || 
                url.includes('googletagmanager') || 
                url.includes('facebook') || 
                url.includes('tiktok')
            ) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // =================================================================
        // 1 & 2. CARI INPUT VISUAL, FOKUS PRESISI, & KETIK
        // =================================================================
        const exactSelector = 'input[name="userid"]'; 
        await page.waitForSelector(exactSelector, { visible: true, timeout: 15000 });

        // Jeda agar React selesai Hydration
        await new Promise(r => setTimeout(r, 800));

        // Cari input yang punya dimensi fisik di layar (bukan versi mobile yang di hide)
        const inputs = await page.$$(exactSelector);
        let targetInput = null;

        for (let el of inputs) {
            const box = await el.boundingBox();
            if (box && box.width > 0 && box.height > 0) {
                targetInput = el;
                break;
            }
        }

        if (!targetInput) throw new Error('Input field disembunyikan secara visual.');

        // Fokus dan Blok Teks
        await targetInput.click();
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');

        // Ketik ID
        await targetInput.type(account_id, { delay: 50 });

        // TRIGGER POPUP (Kombinasi Absolut)
        await page.keyboard.press('Enter');
        await page.keyboard.press('Tab');
        await page.evaluate(el => el.blur(), targetInput);
        await page.mouse.click(100, 250); 
        
        // =================================================================
        // 3. EKSTRAKSI HASIL DINAMIS (TANPA HARDCODED DELAY)
        // =================================================================
        let accountName = '';

        try {
            await page.waitForSelector('.swal2-popup', { visible: true, timeout: 8000 });

            for(let i = 0; i < 20; i++) { 
                await new Promise(r => setTimeout(r, 100));
                
                accountName = await page.evaluate((id) => {
                    const titleEl = document.querySelector('.swal2-title');
                    const bodyEl = document.querySelector('.swal2-html-container');
                    
                    if (!titleEl && !bodyEl) return 'LOADING';

                    const titleText = titleEl ? titleEl.innerText.toLowerCase() : '';
                    const bodyText = bodyEl ? bodyEl.innerText.toLowerCase() : '';

                    if (titleText.includes('mencari') || bodyText.includes('mencari') || bodyText.includes('loading')) {
                        return 'LOADING';
                    }

                    if (titleText.includes('username:')) return titleEl.innerText.split(/username:/i)[1].trim();
                    if (titleText.includes('nama:')) return titleEl.innerText.split(/nama:/i)[1].trim();

                    if (bodyText.includes('mohon pastikan sudah benar')) {
                        const match = bodyEl.innerText.match(/benar:\s*(.*?)(?:\.|$)/i);
                        if (match && match[1].trim() === id) {
                            return 'ERROR_WEB:ID tidak ditemukan (Sistem mengembalikan angka).';
                        }
                    }

                    if (bodyText.includes('tidak ditemukan') || bodyText.includes('salah')) {
                        return 'ERROR_WEB:ID Anda salah, cek User ID Anda.';
                    }
                    
                    return 'LOADING'; 
                }, account_id);
                
                if (accountName !== 'LOADING') break;
            }
        } catch (e) {
            throw new Error('Timeout: Web lambat merespons API.');
        }

        if (accountName.startsWith('ERROR_WEB:')) throw new Error(`Ditolak: ${accountName.replace('ERROR_WEB:', '')}`);
        if (accountName === 'LOADING' || accountName === '') throw new Error('Timeout: Gagal membaca isi Pop-up.');

        const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[BERHASIL] ${accountName} (Durasi: ${timeTaken}s)`);

        botStats.success_count++;
        if (!res.headersSent) res.json({ success: true, account_name: accountName, is_manual: false });

    } catch (error) {
        console.log(`[ERROR] ${error.message}`);
        if (page) await page.screenshot({ path: 'error-screenshot.png' }).catch(() => {});
        
        const isDitolak = error.message.includes('Ditolak');
        if (isDitolak) botStats.error_user_count++;
        else botStats.error_bot_count++;

        if (!res.headersSent) {
            res.json({ 
                success: false, 
                is_manual: !isDitolak, 
                message: isDitolak ? error.message.replace('Ditolak: ', '') : "Sistem sedang sibuk atau Timeout." 
            });
        }
    } finally {
        if (page && !page.isClosed()) {
            await page.close();
            console.log(`[STATS] Req: ${botStats.total_request} | Sukses: ${botStats.success_count} | ErrBot: ${botStats.error_bot_count} | ErrUser: ${botStats.error_user_count}\n`);
        }
    }
};

const PORT = 3000;
app.listen(PORT, async () => {
    await initBrowser();
    console.log(`🚀 Scraper WGS berjalan di port ${PORT}`);
});
