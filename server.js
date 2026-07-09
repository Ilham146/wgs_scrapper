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

// Route baru untuk melihat screenshot berdasarkan percobaan
app.get('/lihat-error/:attempt', (req, res) => {
    const attempt = req.params.attempt;
    const filePath = __dirname + `/error-screenshot-attempt-${attempt}.png`;
    
    res.sendFile(filePath, (err) => {
        if (err) {
            res.status(404).send("Screenshot tidak ditemukan atau belum ada error.");
        }
    });
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
// MESIN SCRAPER (LEVEL 1: NETWORK INTERCEPTOR)
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
    
    const MAX_RETRIES = 2; 

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        let page;
        let context; 

        try {
            if (attempt > 1) console.log(`[RETRY] Mencoba ulang ID: ${account_id} (Percobaan ke-${attempt})`);
            
            context = await browser.createBrowserContext(); 
            page = await context.newPage();
            
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setRequestInterception(true);
            
            page.on('request', (req) => {
                const resourceType = req.resourceType();
                const url = req.url();
                if (['image', 'media', 'font'].includes(resourceType) || url.includes('google') || url.includes('facebook') || url.includes('tiktok')) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            
            const exactSelector = 'input[placeholder*="User ID"], input[name="userid"]'; 
            await page.waitForSelector(exactSelector, { visible: true, timeout: 8000 });
            
            await new Promise(r => setTimeout(r, 1000)); // Wajib tunggu 1 detik agar React siap

            const inputs = await page.$$(exactSelector);
            let targetInput = null;

            for (let el of inputs) {
                const isVisible = await page.evaluate(e => {
                    const rect = e.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0 && rect.top >= 0;
                }, el);
                if (isVisible) {
                    targetInput = el;
                    break;
                }
            }

            if (!targetInput) throw new Error('Input field disembunyikan secara visual.');

            // Bersihkan input menggunakan metode seleksi natural
            await targetInput.click();
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            await new Promise(r => setTimeout(r, 300));

            // Ketik ID dengan tempo yang pas untuk state React
            await targetInput.type(account_id, { delay: 80 });
            await new Promise(r => setTimeout(r, 500)); // Jeda agar React menyerap value

            // Cek sinkronisasi Keyboard
            let typedValue = await page.evaluate(el => el.value, targetInput);
            if (typedValue !== account_id) {
                console.log(`[KOREKSI] State belum sinkron. Mengetik ulang via Keyboard...`);
                
                await targetInput.click();
                await page.keyboard.down('Control');
                await page.keyboard.press('A');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');
                await new Promise(r => setTimeout(r, 400));
                
                await targetInput.type(account_id, { delay: 150 });
                await new Promise(r => setTimeout(r, 500));
            }

            // =================================================================
            // [OPTIMASI LEVEL 1] JALUR CEPAT (NETWORK INTERCEPTION)
            // =================================================================
            
            // 1. Pasang alat penyadap Network SEBELUM menekan Enter
            const responsePromise = page.waitForResponse(
                (response) => response.url().includes('/validate-order') && response.request().method() !== 'OPTIONS',
                { timeout: 5000 }
            ).catch(() => null);

            // 2. Trigger pengiriman form
            await page.keyboard.press('Enter');
            await page.keyboard.press('Tab');
            
            // 3. Bot langsung menangkap JSON (Mengabaikan UI pop-up di layar)
            const apiResponse = await responsePromise;

            if (!apiResponse) {
                throw new Error('Timeout: API Tokogame lambat merespons atau terputus.');
            }

            const responseData = await apiResponse.json();

            // Membaca langsung dari struktur JSON backend
            if (responseData.code === "SUCCESS" && responseData.data && responseData.data.username) {
                accountName = responseData.data.username;
            } else {
                // Jika API membalas error atau ID ngawur
                isDitolak = true;
                throw new Error(`Ditolak: ID Anda salah atau tidak ditemukan.`);
            }

            success = true;
            break; 

        } catch (error) { 
            errorMessage = error.message;
            if (page) await page.screenshot({ path: `error-screenshot-attempt-${attempt}.png` }).catch(() => {});
            if (isDitolak) break;
            if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 1000));
        } finally { 
            if (page && !page.isClosed()) await page.close();
            if (context) await context.close(); 
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
        if (!res.headersSent) res.json({ success: false, is_manual: !isDitolak, message: isDitolak ? errorMessage.replace('Ditolak: ', '') : "Sistem sedang sibuk atau Timeout." });
    }

    console.log(`[STATS] Req: ${botStats.total_request} | Sukses: ${botStats.success_count} | ErrBot: ${botStats.error_bot_count} | ErrUser: ${botStats.error_user_count}\n`);
};


const PORT = 3000;
app.listen(PORT, async () => {
    await initBrowser();
    console.log(`🚀 Scraper WGS berjalan di port ${PORT}`);
});
