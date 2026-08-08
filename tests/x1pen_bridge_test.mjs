import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { WebSocket } from 'ws';
import { X1PenBridge } from '../mcp/x1pen-bridge.mjs';
import {
  assertMethodCompatible,
  createMcpDescriptor,
  evaluateCompatibility,
  normalizeConnectorPair,
} from '../mcp/x1pen-compatibility.mjs';

const openBridges = new Set();
const openSockets = new Set();

afterEach(async () => {
  for (const socket of openSockets) socket.close();
  openSockets.clear();
  for (const bridge of openBridges) await bridge.close();
  openBridges.clear();
});

async function connectExtension(bridge, pair = {}) {
  const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}`, {
    origin: 'chrome-extension://x1pen-test',
  });
  openSockets.add(socket);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const paired = waitForMessage(socket, (message) => message.type === 'paired');
  socket.send(JSON.stringify({ type: 'pair', code: bridge.pairingCode, ...pair }));
  socket.pairedMessage = await paired;
  return socket;
}

function waitForMessage(socket, predicate) {
  return new Promise((resolve) => {
    const listener = (data) => {
      const message = JSON.parse(data.toString());
      if (!predicate(message)) return;
      socket.off('message', listener);
      resolve(message);
    };
    socket.on('message', listener);
  });
}

test('bridge rejects WebSocket connections from ordinary web pages', async () => {
  const bridge = new X1PenBridge({ startPort: 0, pairingCode: '123456', logger: () => {} });
  openBridges.add(bridge);
  await bridge.start();
  const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}`, {
    origin: 'https://example.test',
  });
  openSockets.add(socket);
  await assert.rejects(new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  }));
});

test('bridge pairs an extension and routes commands to one X1Pen tab', async () => {
  const bridge = new X1PenBridge({ startPort: 0, pairingCode: '123456', logger: () => {} });
  openBridges.add(bridge);
  await bridge.start();
  const socket = await connectExtension(bridge);
  socket.send(JSON.stringify({
    type: 'sessions',
    sessions: [{ sessionId: 'tab-a', title: 'X1Pen A', url: 'https://example.test/x1pen', active: true, revision: 4 }],
  }));
  await new Promise((resolve) => setTimeout(resolve, 10));

  const commandMessage = waitForMessage(socket, (message) => message.type === 'command');
  const commandPromise = bridge.sendCommand('getProgram');
  const command = await commandMessage;
  assert.equal(command.sessionId, 'tab-a');
  assert.equal(command.method, 'getProgram');
  socket.send(JSON.stringify({ type: 'result', id: command.id, ok: true, result: { revision: 4 } }));
  assert.deepEqual(await commandPromise, { revision: 4 });
});

test('bridge negotiates component metadata and computes effective capabilities', async () => {
  const bridge = new X1PenBridge({
    startPort: 0,
    pairingCode: '123456',
    logger: () => {},
    serverDescriptor: createMcpDescriptor('2.6.0'),
  });
  openBridges.add(bridge);
  await bridge.start();
  const socket = await connectExtension(bridge, {
    extensionVersion: '1.2.0',
    connector: {
      name: 'x1pen-connector', version: '1.2.0', protocolVersion: 2,
      features: ['automation.core', 'screen.capture', 'debugger.cpu', 'debugger.vram'],
    },
  });
  assert.equal(socket.pairedMessage.protocolVersion, 2);
  assert.equal(socket.pairedMessage.server.version, '2.6.0');

  socket.send(JSON.stringify({
    type: 'sessions',
    sessions: [{
      sessionId: 'tab-a', title: 'X1Pen', revision: 1,
      x1pen: {
        version: '0.8.0', automationApiVersion: 2,
        features: ['automation.core', 'screen.capture', 'debugger.cpu', 'debugger.vram'],
      },
    }],
  }));
  await new Promise((resolve) => setTimeout(resolve, 10));

  const info = bridge.connectionInfo();
  assert.equal(info.components.mcp.version, '2.6.0');
  assert.equal(info.components.connector.version, '1.2.0');
  assert.equal(info.compatibility.capabilities['debugger.vram'].state, 'available');
  const [session] = bridge.listSessions();
  assert.equal(session.x1pen.version, '0.8.0');
  assert.equal(session.compatibility.capabilities['debugger.cpu'].available, true);
});

test('legacy Connector inference is frozen and blocks unsupported debugger RPCs before sending', async () => {
  assert.equal(normalizeConnectorPair({ extensionVersion: '1.1.1' }).featureSource, 'legacy');
  assert.deepEqual(normalizeConnectorPair({ extensionVersion: '1.1.1' }).features,
    ['automation.core', 'screen.capture', 'debugger.cpu']);
  assert.equal(normalizeConnectorPair({ extensionVersion: '1.2.0' }).featureSource, 'unknown');

  const bridge = new X1PenBridge({ startPort: 0, pairingCode: '123456', logger: () => {} });
  openBridges.add(bridge);
  await bridge.start();
  const socket = await connectExtension(bridge, { extensionVersion: '1.1.1' });
  socket.send(JSON.stringify({
    type: 'sessions',
    sessions: [{
      sessionId: 'tab-a', title: 'X1Pen',
      x1pen: { version: '0.8.0', automationApiVersion: 2, features: ['debugger.cpu', 'debugger.vram'] },
    }],
  }));
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.throws(
    () => bridge.sendCommand('debuggerReadVram', { region: 'text', offset: 0, length: 1 }),
    (error) => error.code === 'CONNECTOR_UPDATE_REQUIRED' && error.component === 'connector' &&
      error.feature === 'debugger.vram' && error.currentVersion === '1.1.1' &&
      error.requiredVersion === '1.2.0',
  );
});

test('explicit feature advertisements are authoritative without semver inference', () => {
  const mcp = createMcpDescriptor('2.6.0');
  const connector = normalizeConnectorPair({
    extensionVersion: '9.0.0',
    connector: {
      name: 'x1pen-connector', version: '9.0.0', protocolVersion: 2,
      features: ['automation.core', 'screen.capture'],
    },
  });
  const x1pen = {
    name: 'x1pen', version: '0.8.0', automationApiVersion: 2,
    features: ['automation.core', 'screen.capture', 'debugger.cpu', 'debugger.vram'],
    featureSource: 'advertised',
  };
  const capabilities = evaluateCompatibility({ mcp, connector, x1pen });
  assert.equal(capabilities['debugger.vram'].state, 'unavailable');
  assert.throws(
    () => assertMethodCompatible('debuggerReadVram', capabilities, { mcp, connector, x1pen }),
    (error) => error.code === 'FEATURE_UNAVAILABLE' && error.component === 'connector' &&
      error.currentVersion === '9.0.0' && error.requiredVersion === undefined,
  );
});

test('bridge preserves structured command errors from the Connector', async () => {
  const bridge = new X1PenBridge({ startPort: 0, pairingCode: '123456', logger: () => {} });
  openBridges.add(bridge);
  await bridge.start();
  const socket = await connectExtension(bridge);
  socket.send(JSON.stringify({ type: 'sessions', sessions: [{ sessionId: 'tab-a', title: 'X1Pen' }] }));
  await new Promise((resolve) => setTimeout(resolve, 10));

  const commandMessage = waitForMessage(socket, (message) => message.type === 'command');
  const result = bridge.sendCommand('getStatus');
  const command = await commandMessage;
  socket.send(JSON.stringify({
    type: 'result', id: command.id, ok: false,
    error: { code: 'X1PEN_UPDATE_REQUIRED', component: 'x1pen', feature: 'automation.core', message: 'Reload X1Pen' },
  }));
  await assert.rejects(result, (error) => error.code === 'X1PEN_UPDATE_REQUIRED' &&
    error.component === 'x1pen' && error.feature === 'automation.core');
});

test('bridge requires explicit selection when multiple tabs are connected', async () => {
  const bridge = new X1PenBridge({ startPort: 0, pairingCode: '123456', logger: () => {} });
  openBridges.add(bridge);
  await bridge.start();
  const socket = await connectExtension(bridge);
  socket.send(JSON.stringify({
    type: 'sessions',
    sessions: [
      { sessionId: 'tab-a', title: 'A' },
      { sessionId: 'tab-b', title: 'B' },
    ],
  }));
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.throws(() => bridge.sendCommand('getStatus'), /Multiple X1Pen tabs/);
  bridge.selectSession('tab-b');
  const commandMessage = waitForMessage(socket, (message) => message.type === 'command');
  const commandPromise = bridge.sendCommand('getStatus');
  const command = await commandMessage;
  assert.equal(command.sessionId, 'tab-b');
  socket.send(JSON.stringify({ type: 'result', id: command.id, ok: true, result: { ready: true } }));
  await commandPromise;
});

test('a replacement extension rejects commands waiting on the old connection', async () => {
  const bridge = new X1PenBridge({ startPort: 0, pairingCode: '123456', logger: () => {} });
  openBridges.add(bridge);
  await bridge.start();
  const firstSocket = await connectExtension(bridge);
  firstSocket.send(JSON.stringify({
    type: 'sessions',
    sessions: [{ sessionId: 'tab-a', title: 'A' }],
  }));
  await new Promise((resolve) => setTimeout(resolve, 10));

  const waitingCommand = bridge.sendCommand('getStatus');
  const rejectedCommand = assert.rejects(waitingCommand, /connection was replaced/);
  await connectExtension(bridge);
  await rejectedCommand;
});
