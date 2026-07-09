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
let requestsSinceLastRestart = 0;
const MAX_REQUESTS = 50; // Restart browser setiap 50 antrian selesai
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
                '--disable-blink-features=AutomationControlled',
                '--disable-gpu', // Mematikan akselerasi GPU
                '--no-zygote', // Mempercepat proses pembuatan page baru
                '--disable-software-rasterizer',
                '--mute-audio',
                '--disable-extensions'
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
        requestsSinceLastRestart++;
        
        setTimeout(async () => {
            // Cek apakah sudah waktunya mencuci memori browser
            if (requestsSinceLastRestart >= MAX_REQUESTS && requestQueue.length === 0) {
                console.log(`[MAINTENANCE] Melakukan restart browser untuk mencegah Memory Leak...`);
                await browser.close(); 
                // initBrowser() akan otomatis terpanggil karena kita punya event 'disconnected'
                requestsSinceLastRestart = 0;
                
                // Beri jeda ekstra agar browser baru siap
                setTimeout(() => {
                    isScraping = false;
                    processQueue(); 
                }, 3000);
            } else {
                isScraping = false;
                processQueue(); 
            }
        }, 1500); 
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
// MESIN SCRAPER (FAST MODE + AUTO-RETRY)
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

    const startTime = Date.now();
    console.log(`\n[PROSES] Mulai Scraping ${game_name} | ID: ${account_id}`);

    let accountName = '';
    let isDitolak = false;
    let errorMessage = "Sistem sedang sibuk atau Timeout.";
    let success = false;
    
    const MAX_RETRIES = 2; // Batas maksimal percobaan

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // DEKLARASI AMAN DI SINI (Di luar blok try)
        let page;
        let context; 

        try {
            if (attempt > 1) {
                console.log(`[RETRY] Mencoba ulang ID: ${account_id} (Percobaan ke-${attempt})`);
            }
            
            // Perhatikan: Tidak ada kata 'let' atau 'const' di sini!
            context = await browser.createBrowserContext(); 
            page = await context.newPage();
            
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const resourceType = req.resourceType();
                const url = req.url();
                
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

            // [OPTIMASI] Gunakan networkidle2 alih-alih domcontentloaded
            await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            
            const exactSelector = 'input[name="userid"]'; 
            await page.waitForSelector(exactSelector, { visible: true, timeout: 15000 });

            // Hydration delay 
            await new Promise(r => setTimeout(r, 1000));

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
            // 3. EKSTRAKSI HASIL DINAMIS
            // =================================================================
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

            // Validasi Hasil
            if (accountName.startsWith('ERROR_WEB:')) {
                isDitolak = true; 
                throw new Error(`Ditolak: ${accountName.replace('ERROR_WEB:', '')}`);
            }
            if (accountName === 'LOADING' || accountName === '') throw new Error('Timeout: Gagal membaca isi Pop-up.');

            // Jika sampai di baris ini, berarti SUKSES. Keluar dari loop Retry.
            success = true;
            break; 

        } catch (error) {
            errorMessage = error.message;
            if (page) await page.screenshot({ path: `error-screenshot-attempt-${attempt}.png` }).catch(() => {});
            
            // JANGAN retry jika errornya adalah ID salah
            if (isDitolak) break;

            // Beri jeda sebelum mengulang
            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 2000));
            }
        } finally {
            // TUTUP DENGAN AMAN
            if (page && !page.isClosed()) {
                await page.close();
            }
            if (context) {
                await context.close(); 
            }
        }
    }

    // =================================================================
    // PENYELESAIAN & PENGIRIMAN RESPONSE FINAL
    // =================================================================
    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);

    if (success) {
        console.log(`[BERHASIL] ${accountName} (Durasi Total: ${timeTaken}s)`);
        botStats.success_count++;
        if (!res.headersSent) res.json({ success: true, account_name: accountName, is_manual: false });
    } else {
        console.log(`[ERROR FINAL] ${errorMessage}`);
        
        if (isDitolak) botStats.error_user_count++;
        else botStats.error_bot_count++;

        if (!res.headersSent) {
            res.json({ 
                success: false, 
                is_manual: !isDitolak, 
                message: isDitolak ? errorMessage.replace('Ditolak: ', '') : "Sistem sedang sibuk atau Timeout." 
            });
        }
    }

    console.log(`[STATS] Req: ${botStats.total_request} | Sukses: ${botStats.success_count} | ErrBot: ${botStats.error_bot_count} | ErrUser: ${botStats.error_user_count}\n`);
};

    

const PORT = 3000;
app.listen(PORT, async () => {
    await initBrowser();
    console.log(`🚀 Scraper WGS berjalan di port ${PORT}`);
});
