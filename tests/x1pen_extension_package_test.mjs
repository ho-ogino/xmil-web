import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options });
}

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function pngFormat(buffer) {
  return { bitDepth: buffer[24], colorType: buffer[25] };
}

test('X1Pen Connector store package is complete and minimally scoped', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'x1pen-connector-package-'));
  try {
    const zipPath = join(tempRoot, 'connector.zip');
    run('sh', ['scripts/package-x1pen-connector.sh', zipPath], { cwd: repoRoot });
    const files = run('unzip', ['-Z1', zipPath]).trim().split('\n').sort();
    assert.deepEqual(files, [
      '_locales/',
      '_locales/en/',
      '_locales/en/messages.json',
      '_locales/ja/',
      '_locales/ja/messages.json',
      'compatibility.mjs',
      'icons/',
      'icons/icon-128.png',
      'icons/icon-16.png',
      'icons/icon-32.png',
      'icons/icon-48.png',
      'manifest.json',
      'page-automation.mjs',
      'popup.css',
      'popup.html',
      'popup.js',
      'service-worker.js',
      'update-coordinator.mjs',
    ]);

    const manifest = JSON.parse(run('unzip', ['-p', zipPath, 'manifest.json']));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, '1.3.0');
    assert.equal(manifest.default_locale, 'ja');
    assert.equal(manifest.name, '__MSG_extensionName__');
    assert.equal(manifest.description, '__MSG_extensionDescription__');
    assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
    assert.equal(manifest.host_permissions, undefined);
    assert.match(manifest.content_security_policy.extension_pages, /ws:\/\/127\.0\.0\.1:\*/);
    assert.doesNotMatch(manifest.content_security_policy.extension_pages, /https?:\/\//);

    const serviceWorker = run('unzip', ['-p', zipPath, 'service-worker.js']);
    assert.match(serviceWorker, /chrome\.runtime\.onUpdateAvailable\.addListener/);
    assert.match(serviceWorker, /updateCoordinator\.run/);
    assert.match(serviceWorker, /connector:\s*connectorDescriptor\(\)/);
    assert.match(serviceWorker, /normalizeMcpServerDescriptor/);

    const jaMessages = JSON.parse(run('unzip', ['-p', zipPath, '_locales/ja/messages.json']));
    const enMessages = JSON.parse(run('unzip', ['-p', zipPath, '_locales/en/messages.json']));
    assert.match(jaMessages.extensionDescription.message, /FuzzyBASIC/);
    assert.ok(jaMessages.extensionDescription.message.length <= 132);
    assert.match(enMessages.extensionDescription.message, /local MCP server/);
    assert.ok(enMessages.extensionDescription.message.length <= 132);

    for (const size of [16, 32, 48, 128]) {
      const icon = await readFile(join(repoRoot, `extension/icons/icon-${size}.png`));
      assert.deepEqual(pngDimensions(icon), { width: size, height: size });
    }
    const promo = await readFile(join(repoRoot, 'extension/store/small-promo-440x280.png'));
    assert.deepEqual(pngDimensions(promo), { width: 440, height: 280 });
    const marquee = await readFile(join(repoRoot, 'extension/store/marquee-promo-1400x560.png'));
    assert.deepEqual(pngDimensions(marquee), { width: 1400, height: 560 });
    assert.deepEqual(pngFormat(marquee), { bitDepth: 8, colorType: 2 });
    const screenshot = await readFile(join(repoRoot, 'extension/store/screenshot-1280x800.png'));
    assert.deepEqual(pngDimensions(screenshot), { width: 1280, height: 800 });
    assert.ok(screenshot.length > 40_000, 'Store screenshot should contain the rendered X1Pen UI');

    const privacy = await readFile(join(repoRoot, 'html/x1pen-connector-privacy.html'), 'utf8');
    assert.match(privacy, /127\.0\.0\.1/);
    assert.match(privacy, /program source/i);
    assert.match(privacy, /debugger state/i);
    assert.match(privacy, /video memory/i);
    assert.match(privacy, /AI provider/i);
    const buildScript = await readFile(join(repoRoot, 'build.sh'), 'utf8');
    assert.match(buildScript, /html\/x1pen-connector-privacy\.html.*DIST_DIR/);

    const popup = await readFile(join(repoRoot, 'extension/popup.html'), 'utf8');
    assert.match(popup, /id="consent" type="checkbox"/);
    assert.match(popup, /debug programs/);
    assert.match(popup, /video memory/);
    assert.match(popup, /x1pen-connector-privacy\.html/);
    assert.match(popup, /id="connect" disabled/);
    assert.match(popup, /id="connector-version"/);
    assert.match(popup, /id="mcp-version"/);
    assert.match(popup, /id="x1pen-version"/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('X1Pen product version is declared once and copied into browser builds', async () => {
  const versionSource = await readFile(join(repoRoot, 'html/x1pen-version.js'), 'utf8');
  assert.match(versionSource, /version:\s*'0\.10\.0'/);
  assert.match(versionSource, /name:\s*'x1pen'/);

  const x1penHtml = await readFile(join(repoRoot, 'html/x1pen.html'), 'utf8');
  assert.match(x1penHtml, /<script src="x1pen-version\.js"><\/script>\s*<script src="x1pen\.js"><\/script>/);

  const buildScript = await readFile(join(repoRoot, 'build.sh'), 'utf8');
  assert.match(buildScript, /html\/x1pen-version\.js.*\.\/x1pen-version\.js/);
  assert.match(buildScript, /html\/x1pen-version\.js.*DIST_DIR/);
  assert.match(buildScript, /XMIL_VERSION=.*html\/x1pen-version\.js/);

  const cmake = await readFile(join(repoRoot, 'CMakeLists.txt'), 'utf8');
  assert.match(cmake, /file\(READ .*html\/x1pen-version\.js/);
  assert.match(cmake, /set\(XMIL_VERSION "\$\{CMAKE_MATCH_1\}"\)/);
});
