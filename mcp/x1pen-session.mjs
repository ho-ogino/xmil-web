import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.d88': 'application/octet-stream',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.xmst': 'application/octet-stream',
};

export class X1PenSession {
  constructor(options = {}) {
    this.distDir = resolve(options.distDir || process.env.X1PEN_DIST_DIR || join(projectRoot, 'dist'));
    this.browserExecutable = options.browserExecutable || process.env.X1PEN_BROWSER_EXECUTABLE;
    this.headless = options.headless ?? process.env.X1PEN_HEADLESS !== '0';
    this.logger = options.logger || ((message) => console.error(`[x1pen-mcp] ${message}`));
    this.startPromise = null;
    this.operationQueue = Promise.resolve();
    this.httpServer = null;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.baseUrl = null;
  }

  async ensureStarted() {
    if (!this.startPromise) {
      this.startPromise = this.start().catch(async (error) => {
        await this.close();
        this.startPromise = null;
        throw error;
      });
    }
    return this.startPromise;
  }

  async start() {
    const entryPoint = join(this.distDir, 'x1pen.html');
    if (!existsSync(entryPoint)) {
      throw new Error(`X1Pen build not found at ${entryPoint}. Run ./build.sh first.`);
    }

    await this.startStaticServer();
    this.browser = await this.launchBrowser();
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 900 },
      serviceWorkers: 'block',
    });
    this.page = await this.context.newPage();
    this.page.on('pageerror', (error) => this.logger(`page error: ${error.message}`));
    await this.page.goto(`${this.baseUrl}/x1pen.html`, { waitUntil: 'domcontentloaded' });
    await this.page.waitForFunction(() => window.X1PenAutomation?.version >= 1, null, { timeout: 15_000 });
    let readyTimeout;
    let status;
    try {
      status = await Promise.race([
        this.page.evaluate(() => window.X1PenAutomation.ready()),
        new Promise((_, reject) => {
          readyTimeout = setTimeout(() => reject(new Error('X1Pen initialization timed out after 30 seconds')), 30_000);
        }),
      ]);
    } finally {
      clearTimeout(readyTimeout);
    }
    if (!status.ready) throw new Error(`X1Pen initialization failed: ${status.status || status.state}`);
    this.logger(`session ready at ${this.baseUrl}`);
  }

  async startStaticServer() {
    await new Promise((resolvePromise, reject) => {
      this.httpServer = createServer((request, response) => this.serveFile(request, response));
      this.httpServer.once('error', reject);
      this.httpServer.listen(0, '127.0.0.1', () => {
        const address = this.httpServer.address();
        this.baseUrl = `http://127.0.0.1:${address.port}`;
        resolvePromise();
      });
    });
  }

  serveFile(request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    } catch {
      response.writeHead(400).end('Bad request');
      return;
    }
    const filePath = resolve(this.distDir, `.${pathname === '/' ? '/index.html' : pathname}`);
    const relativePath = relative(this.distDir, filePath);
    if (relativePath.startsWith('..') || isAbsolute(relativePath) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }

    response.setHeader('Content-Type', mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'HEAD') {
      response.writeHead(200).end();
      return;
    }
    const stream = createReadStream(filePath);
    stream.on('error', () => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
    stream.pipe(response);
  }

  async launchBrowser() {
    if (this.browserExecutable) {
      return chromium.launch({ executablePath: this.browserExecutable, headless: this.headless });
    }
    try {
      return await chromium.launch({ headless: this.headless });
    } catch (bundledError) {
      for (const channel of ['chrome', 'msedge']) {
        try {
          return await chromium.launch({ channel, headless: this.headless });
        } catch { /* try next installed browser */ }
      }
      throw new Error(`Chromium could not be launched. Run "npx playwright install chromium" or set X1PEN_BROWSER_EXECUTABLE. ${bundledError.message}`);
    }
  }

  enqueue(operation) {
    const result = this.operationQueue.then(async () => {
      await this.ensureStarted();
      return operation(this.page);
    });
    this.operationQueue = result.catch(() => {});
    return result;
  }

  getProgram() {
    return this.enqueue((page) => page.evaluate(() => window.X1PenAutomation.getProgram()));
  }

  setProgram(program) {
    return this.enqueue((page) => page.evaluate((value) => window.X1PenAutomation.setProgram(value), program));
  }

  validate() {
    return this.enqueue((page) => page.evaluate(() => window.X1PenAutomation.validate()));
  }

  run(waitMs = 500) {
    return this.enqueue(async (page) => {
      const result = await page.evaluate(() => window.X1PenAutomation.run());
      if (waitMs > 0) await page.waitForTimeout(waitMs);
      return { ...result, state: await page.evaluate(() => window.X1PenAutomation.getStatus()) };
    });
  }

  stop() {
    return this.enqueue((page) => page.evaluate(() => window.X1PenAutomation.stop()));
  }

  getStatus() {
    return this.enqueue((page) => page.evaluate(() => window.X1PenAutomation.getStatus()));
  }

  captureScreen() {
    return this.enqueue(async (page) => {
      const dataUrl = await page.evaluate(() => {
        const canvas = document.getElementById('canvas');
        if (!canvas) throw new Error('X1Pen canvas not found');
        return canvas.toDataURL('image/png');
      });
      return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    });
  }

  async close() {
    const resources = [this.context, this.browser];
    this.page = null;
    this.context = null;
    this.browser = null;
    for (const resource of resources) {
      if (resource) await resource.close().catch(() => {});
    }
    if (this.httpServer) {
      const server = this.httpServer;
      this.httpServer = null;
      await new Promise((resolvePromise) => server.close(resolvePromise));
    }
    this.baseUrl = null;
  }
}
