const express = require('express');
const cors = require('cors');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());

app.get('/lihat-error', (req, res) => {
    res.sendFile(__dirname + '/error-screenshot.png');
});

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

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if(['image', 'media', 'font'].includes(req.resourceType())){
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log(`Bypass Cloudflare menuju: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        
        // 1. Tunggu Elemen Input
        console.log('Menunggu elemen input ID...');
        await page.waitForSelector(inputSelector, { visible: true, timeout: 15000 });
        
       // 2. KETIK ID DENGAN BYPASS REACT STATE (ANTI-HAPUS)
        console.log('Mencoba mengetik ID dan mengunci state...');
        
        await page.waitForSelector(inputSelector, { visible: true });
        await page.focus(inputSelector);
        await new Promise(r => setTimeout(r, 500));
        
        // Eksekusi injeksi native untuk memaksa React menerima input bot
        await page.evaluate((sel, id) => {
            const el = document.querySelector(sel);
            if (el) {
                // Trik mem-bypass internal tracker React
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                nativeInputValueSetter.call(el, id);
                
                // Tembakkan event seolah-olah ada ketikan nyata
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, inputSelector, account_id);

        // Lakukan pancingan fisik agar UI benar-benar merespons
        await page.focus(inputSelector);
        await page.keyboard.press('Space');
        await page.keyboard.press('Backspace');
        
        // TEKAN ENTER: Langkah krusial untuk mengunci input di form modern
        await page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 1000));

        // Verifikasi terakhir sebelum klik keluar
        const finalValue = await page.$eval(inputSelector, el => el.value);
        console.log(`[Verifikasi] Web berhasil mengunci input sebagai: "${finalValue}"`);

        if (!finalValue) {
             throw new Error('Gagal: Web kembali menghapus input bot.');
        }

        // 3. KLIK SEMBARANG UNTUK MEMICU POPUP NAMA
        console.log('Mengklik sembarang (body) untuk memicu pencarian nama...');
        // Gunakan Tab untuk memindahkan fokus secara natural sebelum klik
        await page.keyboard.press('Tab'); 
        await new Promise(r => setTimeout(r, 500));
        
        // Klik koordinat aman di pojok atas, lalu klik body
        await page.mouse.click(10, 10); 
        await page.click('body');
        
        // 4. Tunggu popup SweetAlert2 muncul
        console.log('Menunggu popup konfirmasi...');
        await page.waitForSelector('.swal2-popup', { visible: true, timeout: 15000 });
        
        // 5. SMART POLLING (Ekstrak Nama)
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
            throw new Error('Nama gagal termuat dari popup.');
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

        res.json({ success: false, is_manual: true, message: "Gagal cek akun. Sistem sibuk atau ID salah." });
    } finally {
        if (browser) {
            await browser.close();
            console.log('[SELESAI] Browser ditutup.');
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Stealth Scraper WGS berjalan di port ${PORT}`);
});
