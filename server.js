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
                '--disable-blink-features=AutomationControlled',
                '--window-size=1280,720' // Set ukuran layar yang stabil
            ],
            defaultViewport: null
        });
        page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log(`Bypass Cloudflare menuju: ${targetUrl}`);
        // Tunggu sampai network benar-benar tenang
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        
        console.log('Menunggu elemen input ID...');
        await page.waitForSelector(inputSelector, { visible: true, timeout: 15000 });
        
        // ==========================================
        // STRATEGI KETIK MURNI KEYBOARD (ANTI-RESET)
        // ==========================================
        console.log('Fokus ke kotak input...');
        await page.focus(inputSelector);
        await new Promise(r => setTimeout(r, 500)); 

        // Blok semua teks pakai Ctrl+A lalu hapus pakai Backspace (Jauh lebih aman dari triple-click mouse)
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace'); 
        await new Promise(r => setTimeout(r, 500));

        console.log(`Mengetik ID: ${account_id}...`);
        await page.type(inputSelector, account_id, { delay: 150 });
        await new Promise(r => setTimeout(r, 500));

        // Verifikasi apakah ketikan menempel
        const checkValue = await page.$eval(inputSelector, el => el.value);
        console.log(`[Verifikasi] Web menerima input: "${checkValue}"`);
        if (checkValue !== account_id) throw new Error('Ketikan gagal menempel di form.');

        console.log('Menekan TAB untuk memicu pencarian (Tanpa klik mouse)...');
        // TAB akan melepaskan fokus (blur) secara natural dan memicu fungsi pencarian web
        await page.keyboard.press('Tab');
        
        // ==========================================
        // PENCARIAN POPUP NAMA
        // ==========================================
        console.log('Menunggu popup konfirmasi...');
        
        // Kita gunakan try-catch kecil di sini agar kalau swal2-popup tidak ada, bot tetap mengecek HTML mentahnya
        let isPopupMuncul = false;
        try {
            await page.waitForSelector('.swal2-popup', { visible: true, timeout: 10000 });
            isPopupMuncul = true;
        } catch (err) {
            console.log('[INFO] Popup .swal2-popup tidak ditemukan, mungkin web menggunakan desain popup baru.');
        }

        console.log('Mengekstrak nama akun...');
        let accountName = '';
        let loopCount = 0;
        
        while (loopCount < 15) { 
            await new Promise(r => setTimeout(r, 800)); // Delay sedikit diperlama agar API web sempat merespons
            
            accountName = await page.evaluate((isSwal) => {
                // Jika web pakai sweetalert2
                if (isSwal) {
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
                } 
                // JIKA WEB GANTI DESAIN: Cari kata "Username" di seluruh halaman
                else {
                    const allDivs = document.querySelectorAll('div, span, p');
                    for (let el of allDivs) {
                        const txt = el.innerText || '';
                        // Cari pola teks yang mengandung "Username : NamaAkun"
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
                }
                return '';
            }, isPopupMuncul);

            if (accountName !== 'LOADING' && accountName !== '') {
                break; 
            }
            loopCount++;
        }
        
        if (accountName === 'LOADING' || accountName === '') {
            throw new Error('Nama tidak ditemukan. Web tidak memunculkan nama atau strukturnya berubah.');
        }
        
        console.log(`[BERHASIL] Nama ditemukan: ${accountName}`);

        res.json({ success: true, account_name: accountName, is_manual: false });
        
    } catch (error) {
        console.log(`[ERROR] ${error.message}`);
        
        if (page) {
            try {
                // Simpan screenshot DAN Kode HTML untuk analisis jika masih gagal
                await page.screenshot({ path: 'error-screenshot.png' });
                const fs = require('fs');
                const html = await page.content();
                fs.writeFileSync('error-dom.html', html);
                console.log('[INFO] Screenshot dan HTML Web telah disimpan untuk debugging.');
            } catch (debugError) {
                console.log('Gagal menyimpan file debug.');
            }
        }

        res.json({ success: false, is_manual: true, message: "Gagal cek akun. ID salah atau sistem sibuk." });
    } finally {
        if (browser) {
            await browser.close();
            console.log('[SELESAI] Browser ditutup.\n');
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Stealth Scraper WGS berjalan di port ${PORT}`);
});
