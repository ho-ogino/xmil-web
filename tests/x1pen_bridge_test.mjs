import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { WebSocket } from 'ws';
import { X1PenBridge } from '../mcp/x1pen-bridge.mjs';

const openBridges = new Set();
const openSockets = new Set();

afterEach(async () => {
  for (const socket of openSockets) socket.close();
  openSockets.clear();
  for (const bridge of openBridges) await bridge.close();
  openBridges.clear();
});

async function connectExtension(bridge) {
  const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}`, {
    origin: 'chrome-extension://x1pen-test',
  });
  openSockets.add(socket);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const paired = waitForMessage(socket, (message) => message.type === 'paired');
  socket.send(JSON.stringify({ type: 'pair', code: bridge.pairingCode }));
  await paired;
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
