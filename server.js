const express = require('express');
const cors = require('cors');

// Gunakan Puppeteer Extra & Stealth Plugin untuk menembus Cloudflare
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

// Route untuk melihat screenshot jika terjadi error
app.get('/lihat-error', (req, res) => {
    res.sendFile(__dirname + '/error-screenshot.png');
});

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
        inputSelector = 'input[placeholder="Masukkan User ID"]';           
        btnSelector = 'h2[id="Koin Emas"]';                                  
    } 
    // ==========================================
    // 2. KONFIGURASI HIGGS DOMINO (VIA TOKOGAME)
    // ==========================================
    else if (game_name.includes('higgs') || game_name.includes('island')) {
        targetUrl = 'https://www.tokogame.com/id-id/digital/higgs-domino-koin-emas'; 
        inputSelector = 'input[placeholder="Masukkan User ID"]';
        btnSelector = 'h2[id="Kartu Emas (Tukar ke Koin Emas)"]';
    } 
    else {
        return res.json({ success: false, is_manual: true, message: "Game tidak didukung otomatis." });
    }

    let browser;
    let page; // Dideklarasikan di luar try agar bisa diakses oleh catch untuk screenshot
    
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

        // OPTIMASI 1: Blokir gambar & font untuk mempercepat loading web, tapi CSS dibiarkan agar tidak error
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if(['image', 'media', 'font'].includes(req.resourceType())){
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log(`Bypass Cloudflare menuju: ${targetUrl}`);
        // OPTIMASI 2: Ubah networkidle2 menjadi domcontentloaded agar tidak perlu menunggu tracking web selesai
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        
        // 1. Tunggu dan Ketik ID
        console.log('Menunggu elemen input ID...');
        await page.waitForSelector(inputSelector, { visible: true, timeout: 15000 });
        
        // Jeda dipercepat menjadi 1 detik
        await new Promise(r => setTimeout(r, 1000));
        
        console.log('Fokus pada kotak input...');
        await page.evaluate((sel) => {
            const inputs = document.querySelectorAll(sel);
            for (let el of inputs) {
                if (el.offsetWidth > 0 && el.offsetHeight > 0) {
                    el.focus();
                    el.click();
                    el.value = ''; 
                    return; 
                }
            }
        }, inputSelector);
        
        // OPTIMASI 3: Ketik lebih cepat (50ms per huruf)
        console.log('Mengetik ID...');
        await page.keyboard.type(account_id, { delay: 50 });
        
        // Jeda dipercepat menjadi 1 detik
        await new Promise(r => setTimeout(r, 1000));
        
        // 2. Klik sembarang di layar
        console.log('Mengklik layar...');
        await page.mouse.click(10, 10);
        await page.click('body');
        
        // 3. Tunggu popup SweetAlert2 muncul
        console.log('Menunggu popup konfirmasi...');
        await page.waitForSelector('.swal2-popup', { timeout: 15000 });
        
        // OPTIMASI 4: SMART POLLING (Cek nama setiap 0.5 detik, tidak perlu diam 4 detik penuh)
        console.log('Mengekstrak nama akun...');
        let accountName = '';
        let loopCount = 0;
        
        while (loopCount < 10) { // Maksimal 10 x 500ms = 5 detik
            await new Promise(r => setTimeout(r, 500));
            
            accountName = await page.evaluate(() => {
                const popup = document.querySelector('.swal2-popup');
                if (!popup) return '';
                
                const text = popup.innerText || '';
                
                // Jika masih ada kata "Mencari", beri kode LOADING agar loop terus berjalan
                if (text.toLowerCase().includes('mencari')) {
                    return 'LOADING';
                }
                
                const lines = text.split('\n');
                for (let line of lines) {
                    if (line.toLowerCase().includes('username') || line.toLowerCase().includes('nama')) {
                        let parts = line.split(':'); 
                        if (parts.length > 1) return parts[1].trim(); 
                    }
                }
                return lines.length > 1 ? lines[1].trim() : text.replace(/\n/g, ' ').trim();
            });

            // Jika bot berhasil mendapat nama selain "LOADING" atau kosong, langsung hentikan loop!
            if (accountName !== 'LOADING' && accountName !== '') {
                break; 
            }
            loopCount++;
        }
        
        // Jika karena suatu hal nama gagal didapat dan masih "LOADING", anggap manual
        if (accountName === 'LOADING' || accountName === '') {
            throw new Error('Nama gagal termuat atau ID tidak ditemukan.');
        }
        
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
