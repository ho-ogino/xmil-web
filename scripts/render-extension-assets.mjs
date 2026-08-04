import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iconSource = resolve(repoRoot, 'extension/icons/icon-source.svg');
const promoSource = resolve(repoRoot, 'extension/store/small-promo-source.svg');
const marqueeSource = resolve(repoRoot, 'extension/store/marquee-promo-source.svg');
const systemBrowsers = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = systemBrowsers.find(existsSync);

function svgDataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function renderSvg(browser, source, output, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  const url = svgDataUrl(await readFile(source, 'utf8'));
  await page.setContent(`<style>*{margin:0}html,body,img{width:${width}px;height:${height}px}</style><img src="${url}">`);
  await page.locator('img').waitFor({ state: 'visible' });
  await page.screenshot({ path: output });
  await page.close();
}

const browser = await chromium.launch({ headless: true, executablePath });
try {
  const iconUrl = svgDataUrl(await readFile(iconSource, 'utf8'));
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>*{margin:0}html,body,img{width:${size}px;height:${size}px}</style><img src="${iconUrl}">`);
    await page.locator('img').waitFor({ state: 'visible' });
    await page.screenshot({
      path: resolve(repoRoot, `extension/icons/icon-${size}.png`),
      omitBackground: true,
    });
    await page.close();
  }

  await mkdir(resolve(repoRoot, 'extension/store'), { recursive: true });
  await renderSvg(
    browser,
    promoSource,
    resolve(repoRoot, 'extension/store/small-promo-440x280.png'),
    440,
    280,
  );
  await renderSvg(
    browser,
    marqueeSource,
    resolve(repoRoot, 'extension/store/marquee-promo-1400x560.png'),
    1400,
    560,
  );
} finally {
  await browser.close();
}
