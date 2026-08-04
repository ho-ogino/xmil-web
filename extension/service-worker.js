const connectedTabs = new Map();
let bridgeConfig = null;
let socket = null;
let paired = false;
let connectPromise = null;
let reconnectTimer = null;

initialize();

async function initialize() {
  const stored = await chrome.storage.local.get('bridgeConfig');
  bridgeConfig = stored.bridgeConfig || null;
  const session = await chrome.storage.session.get('connectedTabs');
  for (const item of session.connectedTabs || []) connectedTabs.set(item.sessionId, item);
  updateBadge();
  if (bridgeConfig && connectedTabs.size > 0) connectBridge().catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handlePopupMessage(message).then(
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
    return { bridgeConfig, paired, sessions: Array.from(connectedTabs.values()) };
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
    connectedTabs.set(status.instanceId, {
      sessionId: status.instanceId,
      tabId: tab.id,
      title: status.title,
      url: status.url,
      active: true,
      revision: status.revision,
    });
    await persistSessions();
    try {
      await connectBridge();
      await invokeX1Pen(tab.id, 'connection', { connected: true });
      await refreshSessions();
      sendSessions();
      return { paired: true, session: connectedTabs.get(status.instanceId) };
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
    }));
    ws.onmessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'paired') {
        clearTimeout(timeout);
        didPair = true;
        paired = true;
        sendSessions();
        resolve();
      } else if (message.type === 'command') {
        handleCommand(message);
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
  if (!bridgeConfig || connectedTabs.size === 0 || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectBridge().then(async () => {
      for (const session of connectedTabs.values()) {
        await invokeX1Pen(session.tabId, 'connection', { connected: true }).catch(() => {});
      }
      await refreshSessions();
      sendSessions();
    }).catch(scheduleReconnect);
  }, 2_000);
}

async function handleCommand(message) {
  const session = connectedTabs.get(message.sessionId);
  if (!session) {
    send({ type: 'result', id: message.id, ok: false, error: 'X1Pen tab is no longer connected' });
    return;
  }
  try {
    const result = await invokeX1Pen(session.tabId, message.method, message.params || {});
    await refreshSessions();
    send({ type: 'result', id: message.id, ok: true, result });
    sendSessions();
  } catch (error) {
    send({ type: 'result', id: message.id, ok: false, error: error.message || String(error) });
  }
}

async function invokeX1Pen(tabId, method, params) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [method, params],
    func: async (requestedMethod, requestedParams) => {
      const api = window.X1PenAutomation;
      if (!api || api.version < 2) throw new Error('This tab does not provide X1Pen Automation API v2');
      if (requestedMethod === 'probe') return api.ready();
      if (requestedMethod === 'connection') {
        return api.setConnectionState(requestedParams.connected, requestedParams.connected ? 'MCP Connected' : '');
      }

      const lockLabels = {
        setProgram: 'AI is updating the program...',
        validate: 'AI is validating the program...',
        run: 'AI is running the program...',
        stop: 'AI is stopping the program...',
      };
      const shouldLock = Object.prototype.hasOwnProperty.call(lockLabels, requestedMethod);
      if (shouldLock) api.setInteractionLocked(true, lockLabels[requestedMethod]);
      try {
        if (requestedMethod === 'getProgram') return api.getProgram();
        if (requestedMethod === 'setProgram') return api.setProgram(requestedParams.program, requestedParams.expectedRevision);
        if (requestedMethod === 'validate') return api.validate();
        if (requestedMethod === 'run') {
          const result = await api.run();
          if (requestedParams.waitMs > 0) await new Promise((resolve) => setTimeout(resolve, requestedParams.waitMs));
          return { ...result, state: api.getStatus() };
        }
        if (requestedMethod === 'stop') return api.stop();
        if (requestedMethod === 'getStatus') return api.getStatus();
        if (requestedMethod === 'captureScreen') return api.captureScreen();
        throw new Error(`Unsupported X1Pen method: ${requestedMethod}`);
      } finally {
        if (shouldLock) api.setInteractionLocked(false);
      }
    },
  });
  if (!results.length) throw new Error('X1Pen tab did not return a result');
  return results[0].result;
}

async function refreshSessions() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  for (const [sessionId, session] of Array.from(connectedTabs)) {
    try {
      const status = await invokeX1Pen(session.tabId, 'getStatus', {});
      connectedTabs.set(sessionId, {
        ...session,
        title: status.title,
        url: status.url,
        revision: status.revision,
        active: session.tabId === activeTab?.id,
      });
    } catch {
      connectedTabs.delete(sessionId);
    }
  }
  await persistSessions();
}

function sendSessions() {
  send({ type: 'sessions', sessions: Array.from(connectedTabs.values()) });
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
