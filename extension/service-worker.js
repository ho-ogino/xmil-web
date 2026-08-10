import { invokeX1PenInPage } from './page-automation.mjs';
import { createUpdateCoordinator } from './update-coordinator.mjs';
import {
  assertMcpProtocolSupported,
  createConnectorDescriptor,
  normalizeMcpServerDescriptor,
  normalizeX1PenDescriptor,
  serializeExtensionError,
} from './compatibility.mjs';

const connectedTabs = new Map();
let bridgeConfig = null;
let socket = null;
let paired = false;
let connectPromise = null;
let reconnectTimer = null;
let serverDescriptor = null;

function connectorDescriptor() {
  return createConnectorDescriptor(chrome.runtime.getManifest().version);
}

function sessionFromStatus(status, base = {}) {
  return {
    ...base,
    sessionId: base.sessionId || status.instanceId,
    title: status.title,
    url: status.url,
    revision: status.revision,
    revisionEpoch: status.revisionEpoch,
    x1pen: normalizeX1PenDescriptor(status),
  };
}

function bridgeSession(session) {
  return {
    sessionId: session.sessionId,
    title: session.title,
    url: session.url,
    active: !!session.active,
    revision: session.revision,
    revisionEpoch: session.revisionEpoch,
    x1pen: session.x1pen,
  };
}

const updateCoordinator = createUpdateCoordinator({
  prepare: prepareForUpdate,
  reload: () => chrome.runtime.reload(),
  onError: (error) => console.warn('Failed to cleanly disconnect before extension update:', error),
});

chrome.runtime.onUpdateAvailable.addListener(() => updateCoordinator.requestUpdate());
updateCoordinator.run(initialize).catch(() => {});

async function initialize() {
  const stored = await chrome.storage.local.get('bridgeConfig');
  bridgeConfig = stored.bridgeConfig || null;
  const session = await chrome.storage.session.get('connectedTabs');
  for (const item of session.connectedTabs || []) connectedTabs.set(item.sessionId, item);
  updateBadge();
  if (bridgeConfig && connectedTabs.size > 0) {
    connectBridge().then(refreshSessions).then(sendSessions).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  updateCoordinator.run(() => handlePopupMessage(message)).then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: error.message || String(error) }),
  );
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [sessionId, session] of connectedTabs) {
    if (session.tabId === tabId) connectedTabs.delete(sessionId);
  }
  persistSessions().then(sendSessions).catch(() => {});
});

async function handlePopupMessage(message) {
  if (message.type === 'get-state') {
    await refreshSessions();
    return {
      bridgeConfig,
      paired,
      connector: connectorDescriptor(),
      server: serverDescriptor,
      sessions: Array.from(connectedTabs.values(), bridgeSession),
    };
  }
  if (message.type === 'connect-active-tab') {
    const port = Number(message.port);
    const code = String(message.code || '').trim();
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid bridge port');
    if (!/^\d{6}$/.test(code)) throw new Error('Pairing code must be 6 digits');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active browser tab');
    const status = await invokeX1Pen(tab.id, 'probe', {});
    bridgeConfig = { port, code };
    await chrome.storage.local.set({ bridgeConfig });
    connectedTabs.set(status.instanceId, sessionFromStatus(status, {
      tabId: tab.id,
      active: true,
    }));
    await persistSessions();
    try {
      await connectBridge();
      await invokeX1Pen(tab.id, 'connection', { connected: true });
      await refreshSessions();
      sendSessions();
      return { paired: true, session: bridgeSession(connectedTabs.get(status.instanceId)) };
    } catch (error) {
      connectedTabs.delete(status.instanceId);
      await persistSessions();
      throw error;
    }
  }
  if (message.type === 'disconnect-active-tab') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return { disconnected: false };
    for (const [sessionId, session] of connectedTabs) {
      if (session.tabId !== tab.id) continue;
      await invokeX1Pen(tab.id, 'connection', { connected: false }).catch(() => {});
      connectedTabs.delete(sessionId);
    }
    await persistSessions();
    sendSessions();
    return { disconnected: true };
  }
  throw new Error('Unknown extension request');
}

async function connectBridge() {
  if (!bridgeConfig) throw new Error('Bridge configuration is missing');
  if (socket?.readyState === WebSocket.OPEN && paired) return;
  if (connectPromise) return connectPromise;

  connectPromise = new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${bridgeConfig.port}`);
    let didPair = false;
    socket = ws;
    paired = false;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timed out connecting to the local MCP bridge'));
    }, 8_000);

    ws.onopen = () => ws.send(JSON.stringify({
      type: 'pair',
      code: bridgeConfig.code,
      extensionVersion: chrome.runtime.getManifest().version,
      connector: connectorDescriptor(),
    }));
    ws.onmessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'paired') {
        clearTimeout(timeout);
        didPair = true;
        paired = true;
        serverDescriptor = normalizeMcpServerDescriptor(message);
        try {
          assertMcpProtocolSupported(serverDescriptor);
        } catch (error) {
          paired = false;
          serverDescriptor = null;
          ws.close(1002, 'Unsupported MCP bridge protocol');
          reject(error);
          return;
        }
        sendSessions();
        resolve();
      } else if (message.type === 'command') {
        updateCoordinator.run(() => handleCommand(message)).catch(() => {});
      } else if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: message.timestamp }));
      }
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Could not connect to the local MCP bridge'));
    };
    ws.onclose = (event) => {
      clearTimeout(timeout);
      if (!didPair) reject(new Error(event.reason || `Bridge closed the connection (${event.code})`));
      if (socket === ws) {
        socket = null;
        paired = false;
        serverDescriptor = null;
        for (const session of connectedTabs.values()) {
          invokeX1Pen(session.tabId, 'connection', { connected: false }).catch(() => {});
        }
        scheduleReconnect();
      }
    };
  }).finally(() => {
    connectPromise = null;
  });
  return connectPromise;
}

function scheduleReconnect() {
  if (updateCoordinator.isUpdatePending() || !bridgeConfig || connectedTabs.size === 0 || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    updateCoordinator.run(async () => {
      await connectBridge();
      for (const session of connectedTabs.values()) {
        await invokeX1Pen(session.tabId, 'connection', { connected: true }).catch(() => {});
      }
      await refreshSessions();
      sendSessions();
    }).catch(() => {
      if (!updateCoordinator.isUpdatePending()) scheduleReconnect();
    });
  }, 2_000);
}

async function prepareForUpdate() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  await Promise.allSettled(Array.from(connectedTabs.values(), (session) =>
    invokeX1Pen(session.tabId, 'connection', { connected: false })));
  const activeSocket = socket;
  socket = null;
  paired = false;
  if (activeSocket) activeSocket.close(1012, 'Applying X1Pen Connector update');
}

async function handleCommand(message) {
  const session = connectedTabs.get(message.sessionId);
  if (!session) {
    send({ type: 'result', id: message.id, ok: false, error: {
      code: 'SESSION_NOT_FOUND',
      component: 'connector',
      message: 'X1Pen tab is no longer connected',
    } });
    return;
  }
  try {
    const result = await invokeX1Pen(session.tabId, message.method, message.params || {});
    if (message.method === 'recoverStalled' && result?.ok && result.reloadRequired) {
      send({ type: 'result', id: message.id, ok: true, result });
      setTimeout(() => {
        chrome.tabs.reload(session.tabId).catch((error) => {
          console.warn('Failed to reload stalled X1Pen tab:', error);
        });
      }, 0);
      return;
    }
    await refreshSessions();
    send({ type: 'result', id: message.id, ok: true, result });
    sendSessions();
  } catch (error) {
    if (!error?.code && /execution context|frame was removed|tab (?:was )?closed|No tab with id/i.test(error?.message || '')) {
      error.code = 'TAB_RELOADED';
      error.component = 'connector';
      error.action = 'Wait for X1Pen to reload, then call x1pen_get_status.';
    }
    send({ type: 'result', id: message.id, ok: false, error: serializeExtensionError(error) });
  }
}

async function invokeX1Pen(tabId, method, params) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [method, params],
    func: invokeX1PenInPage,
  });
  if (!results.length) throw new Error('X1Pen tab did not return a result');
  return results[0].result;
}

async function refreshSessions() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  for (const [sessionId, session] of Array.from(connectedTabs)) {
    try {
      const status = await invokeX1Pen(session.tabId, 'getStatus', {});
      connectedTabs.set(sessionId, sessionFromStatus(status, {
        ...session,
        active: session.tabId === activeTab?.id,
      }));
    } catch {
      connectedTabs.delete(sessionId);
    }
  }
  await persistSessions();
}

function sendSessions() {
  send({ type: 'sessions', sessions: Array.from(connectedTabs.values(), bridgeSession) });
  updateBadge();
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN && paired) socket.send(JSON.stringify(message));
}

async function persistSessions() {
  await chrome.storage.session.set({ connectedTabs: Array.from(connectedTabs.values()) });
  updateBadge();
}

function updateBadge() {
  chrome.action.setBadgeBackgroundColor({ color: '#0d7a47' });
  chrome.action.setBadgeText({ text: connectedTabs.size ? String(connectedTabs.size) : '' });
}
