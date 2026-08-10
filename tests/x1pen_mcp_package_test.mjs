import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { test } from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function runNpm(args, options = {}) {
  if (process.env.npm_execpath) {
    return run(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  return run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    shell: process.platform === 'win32',
    ...options,
  });
}

test('packed x1pen-mcp installs and serves tools without the repository', { timeout: 120_000 }, async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'x1pen-mcp-package-'));
  const npmCache = join(tempRoot, 'npm-cache');
  let client;
  try {
    const packOutput = JSON.parse(runNpm([
      'pack', './mcp', '--json', '--pack-destination', tempRoot, '--cache', npmCache,
    ], { cwd: repoRoot }));
    const packResult = Array.isArray(packOutput)
      ? packOutput[0]
      : packOutput['x1pen-mcp'];
    assert.ok(packResult, 'npm pack did not return x1pen-mcp package metadata');
    assert.deepEqual(packResult.files.map((file) => file.path).sort(), [
      'LICENSE',
      'README.md',
      'THIRD_PARTY_LICENSES.md',
      'package.json',
      'reference/fuzzybasic.json',
      'reference/manifest.json',
      'reference/slang-catalogs.json',
      'reference/slang.json',
      'reference/x1-hardware.json',
      'reference/z80asm.json',
      'x1pen-bridge.mjs',
      'x1pen-compatibility.mjs',
      'x1pen-reference.mjs',
      'x1pen-server.mjs',
    ]);

    const installRoot = join(tempRoot, 'consumer');
    await mkdir(installRoot);
    await writeFile(join(installRoot, 'package.json'), '{"private":true}\n');
    const tarball = join(tempRoot, packResult.filename);
    runNpm([
      'install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', npmCache, tarball,
    ], { cwd: installRoot });

    const packageRoot = join(installRoot, 'node_modules', 'x1pen-mcp');
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    assert.equal(manifest.name, 'x1pen-mcp');
    assert.equal(manifest.version, '2.7.0');
    assert.deepEqual(manifest.bin, { 'x1pen-mcp': 'x1pen-server.mjs' });

    const serverPath = join(packageRoot, 'x1pen-server.mjs');
    assert.equal(run(process.execPath, [serverPath, '--version']).trim(), manifest.version);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      cwd: installRoot,
      stderr: 'pipe',
    });
    client = new Client({ name: 'x1pen-package-test', version: '1.0.0' });
    await client.connect(transport);
    assert.match(client.getInstructions(), /built-in Z80 assembler have implementation-specific contracts/);
    assert.match(client.getInstructions(), /separate CPU-memory, I\/O-port and video-memory spaces/);
    assert.match(client.getInstructions(), /x1pen_search_reference/);

    const tools = await client.listTools();
    assert.equal(tools.tools.length, 29);
    assert.ok(tools.tools.some((tool) => tool.name === 'x1pen_apply_edits'));
    assert.ok(tools.tools.some((tool) => tool.name === 'x1pen_debug_get_state'));
    assert.ok(tools.tools.some((tool) => tool.name === 'x1pen_debug_read_vram'));
    assert.ok(tools.tools.some((tool) => tool.name === 'x1pen_search_reference'));
    assert.ok(tools.tools.some((tool) => tool.name === 'x1pen_send_key'));
    assert.ok(tools.tools.some((tool) => tool.name === 'x1pen_set_pad'));
    const connection = await client.callTool({ name: 'x1pen_connection_info', arguments: {} });
    const info = JSON.parse(connection.content[0].text);
    assert.equal(info.host, '127.0.0.1');
    assert.ok(Number.isInteger(info.port));
    assert.match(info.pairingCode, /^\d{6}$/);
    assert.equal(info.components.mcp.version, '2.7.0');
    assert.deepEqual(info.components.mcp.features,
      ['automation.core', 'automation.run-recovery', 'screen.capture', 'input.keyboard', 'input.pad', 'debugger.cpu', 'debugger.vram']);
    assert.equal(info.components.connector, null);

    const reference = await client.callTool({
      name: 'x1pen_search_reference',
      arguments: { query: 'PROC LOCAL' },
    });
    const matches = JSON.parse(reference.content[0].text);
    assert.equal(matches.matches[0].id, 'fuzzybasic.subroutines.proc');

    const hardwareReference = await client.callTool({
      name: 'x1pen_search_reference',
      arguments: { language: 'x1', query: 'バンクメモリ VRAM' },
    });
    const hardwareMatches = JSON.parse(hardwareReference.content[0].text);
    assert.ok(hardwareMatches.matches.some((match) => match.language === 'x1'));

    const assemblerReference = await client.callTool({
      name: 'x1pen_search_reference',
      arguments: { language: 'z80asm', query: '条件アセンブル' },
    });
    const assemblerMatches = JSON.parse(assemblerReference.content[0].text);
    assert.equal(assemblerMatches.matches[0].id, 'z80asm.preprocessor.conditionals');
  } finally {
    if (client) await client.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
