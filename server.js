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

    // ==========================================
    // 1. KONFIGURASI ROYAL DREAM (VIA TOKOGAME)
    // ==========================================
    if (game_name.includes('royal')) {
        targetUrl = 'https://www.tokogame.com/id-id/digital/royal-dream-coins-chips'; 
        inputSelector = 'input[placeholder="Masukkan User ID"]';            
    } 
    // ==========================================
    // 2. KONFIGURASI HIGGS DOMINO (VIA TOKOGAME)
    // ==========================================
    else if (game_name.includes('higgs') || game_name.includes('island')) {
        targetUrl = 'https://www.tokogame.com/id-id/digital/higgs-domino-koin-emas'; 
        inputSelector = 'input[placeholder="Masukkan User ID"]';
    } 
    else {
        return res.json({ success: false, is_manual: true, message: "Game tidak didukung otomatis." });
    }

    let browser;
    let page; 
    
    try {
        console.log(`\n[START] Scraping ${game_name} | ID: ${account_id}`);

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

        // OPTIMASI: Blokir gambar, media, dan font untuk mempercepat loading web
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if(['image', 'media', 'font'].includes(req.resourceType())){
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log(`Bypass Cloudflare menuju: ${targetUrl}`);
        // WAJIB networkidle2 agar Cloudflare selesai memproses challenge-nya
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        
        // 1. Tunggu Elemen Input
        console.log('Menunggu elemen input ID...');
        await page.waitForSelector(inputSelector, { visible: true, timeout: 15000 });
        
        // 2. FOKUS DAN INJEKSI ID (REACT-SAFE BYPASS)
        console.log('Menginjeksi ID ke dalam sistem web...');
        await page.evaluate((selector, id) => {
            const input = document.querySelector(selector);
            if (input) {
                // Memotong jalur React State agar input bot terbaca
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                nativeInputValueSetter.call(input, id);
                
                // Memicu event secara manual
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, inputSelector, account_id);

        // Beri jeda sejenak agar web selesai memproses state UI-nya
        await new Promise(r => setTimeout(r, 1000));
        
        // Pancing dengan Spasi lalu Backspace untuk memastikan form web mendeteksi input
        await page.focus(inputSelector);
        await page.keyboard.press('Space');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Enter');

        // 3. KLIK KARTU/PAKET (CARI BERDASARKAN TEKS)
        console.log('Mengklik kartu/area verifikasi...');
        await page.evaluate((game) => {
            const searchText = (game.includes('higgs') || game.includes('island')) ? 'Kartu Emas' : 'Koin Emas';
            const allElements = document.querySelectorAll('h2, div, span, p');
            
            for (let el of allElements) {
                if (el.innerText && el.innerText.includes(searchText)) {
                    if (el.parentElement) el.parentElement.click();
                    el.click();
                    return;
                }
            }
        }, game_name);

        // Jeda untuk menunggu animasi web selesai sebelum mencari popup
        await new Promise(r => setTimeout(r, 1500));
        
        // 4. Tunggu popup SweetAlert2 muncul
        console.log('Menunggu popup konfirmasi...');
        await page.waitForSelector('.swal2-popup', { visible: true, timeout: 15000 });
        
        // 5. SMART POLLING (Cek nama setiap 0.5 detik)
        console.log('Mengekstrak nama akun...');
        let accountName = '';
        let loopCount = 0;
        
        while (loopCount < 15) { 
            await new Promise(r => setTimeout(r, 500));
            
            accountName = await page.evaluate(() => {
                const popup = document.querySelector('.swal2-popup');
                if (!popup) return '';
                
                const text = popup.innerText || '';
                
                if (text.toLowerCase().includes('mencari') || text.toLowerCase().includes('loading')) {
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

            if (accountName !== 'LOADING' && accountName !== '') {
                break; 
            }
            loopCount++;
        }
        
        if (accountName === 'LOADING' || accountName === '') {
            throw new Error('Nama gagal termuat atau ID tidak ditemukan di server game.');
        }
        
        console.log(`[BERHASIL] Nama ditemukan: ${accountName}`);

        res.json({ success: true, account_name: accountName, is_manual: false });
        
    } catch (error) {
        console.log(`[ERROR] ${error.message}`);
        
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
            console.log('[SELESAI] Browser ditutup.');
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Stealth Scraper berjalan di port ${PORT}`);
});
