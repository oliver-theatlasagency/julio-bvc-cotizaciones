import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const source = 'https://www.bolsadecaracas.com/';
const duration = process.env.CAPTURE_SECONDS === '15' ? 15 : 300;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const response = await page.goto(source, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (!response || !response.ok()) throw new Error(`Página no disponible: ${response?.status()}`);
  try {
    // Carousel elements may exist before the active slide becomes visible.
    await page.waitForSelector('[data-precio-style]', { state: 'attached', timeout: 90000 });
  } catch (error) {
    const title = await page.title();
    if (/just a moment|challenge|access denied|captcha/i.test(title)) throw error;
    const retry = await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!retry || !retry.ok()) throw new Error(`Página no disponible: ${retry?.status()}`);
    await page.waitForSelector('[data-precio-style]', { state: 'attached', timeout: 90000 });
  }
  const end = Date.now() + duration * 1000;
  let last = null;
  do {
    const sample = await page.evaluate(() => {
      const found = new Map();
      for (const p of document.querySelectorAll('[data-precio-style]')) {
        const card = p.closest('.border-right');
        const symbol = card?.querySelector('[data-simbolo-style]')?.textContent?.trim();
        const price = p.textContent?.trim();
        const volume = card?.querySelector('[data-volumen-style]')?.textContent?.trim();
        const variation = card?.querySelector('[data-variacion-style]')?.textContent?.trim();
        if (symbol && price && volume && variation && /^[A-Z0-9.]+$/.test(symbol) && /^[\d.,]+$/.test(price) && /^[\d.,]+$/.test(volume) && /^-?[\d.,]+%$/.test(variation)) found.set(symbol, { symbol, price, volume, variation });
      }
      for (const a of document.querySelectorAll('a[href*="resumen-mercado/?simb="]')) {
        const symbol = a.querySelector('strong')?.textContent?.trim();
        const price = a.querySelector('h5')?.textContent?.trim();
        const volume = a.querySelector('.justify-content-between .text-right')?.textContent?.trim();
        let variation = a.querySelector('.align-self-center')?.textContent?.trim();
        if (variation && a.querySelector('img[src*="icon-down"]') && !variation.startsWith('-')) variation = '-' + variation;
        if (symbol && price && volume && variation && /^[A-Z0-9.]+$/.test(symbol) && /^[0-9.,]+$/.test(price) && /^[0-9.,]+$/.test(volume) && /^-?[0-9.,]+%$/.test(variation)) found.set(symbol, { symbol, price, volume, variation });
      }
      const headerText = document.querySelector('#header-primary')?.innerText || '';
      const status = headerText.match(/SITUACIÓN DEL MERCADO:\s*(ABIERTO|CERRADO)\s*(\d{2}-\d{2}-\d{4})/i);
      return { items: [...found.values()], marketStatus: status?.[1] ?? null, marketDate: status?.[2] ?? null };
    });
    if (sample.items.length >= 1 && sample.marketDate && sample.marketStatus) last = { ...sample, capturedAt: new Date().toISOString(), source };
    const remaining = end - Date.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(30000, remaining)));
  } while (Date.now() < end);
  if (!last) throw new Error('No se obtuvo una captura válida; se conserva la anterior.');
  await writeFile('cotizaciones.json', JSON.stringify(last, null, 2) + '\n');
  console.log(`Capturados ${last.items.length} símbolos; fecha de mercado ${last.marketDate}`);
} finally { await browser.close(); }

