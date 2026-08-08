const portInput = document.getElementById('port');
const codeInput = document.getElementById('code');
const consentInput = document.getElementById('consent');
const connectButton = document.getElementById('connect');
const disconnectButton = document.getElementById('disconnect');
const statusElement = document.getElementById('status');
const sessionsElement = document.getElementById('sessions');
const connectorVersionElement = document.getElementById('connector-version');
const mcpVersionElement = document.getElementById('mcp-version');
const x1penVersionElement = document.getElementById('x1pen-version');

loadState();

consentInput.addEventListener('change', updateConnectButton);

connectButton.addEventListener('click', async () => {
  if (!consentInput.checked) return;
  setBusy(true);
  try {
    const response = await sendMessage({
      type: 'connect-active-tab',
      port: Number(portInput.value),
      code: codeInput.value,
    });
    showStatus(`Connected: ${response.session.title}`);
    await loadState();
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    setBusy(false);
  }
});

disconnectButton.addEventListener('click', async () => {
  setBusy(true);
  try {
    await sendMessage({ type: 'disconnect-active-tab' });
    showStatus('Disconnected');
    await loadState();
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    setBusy(false);
  }
});

async function loadState() {
  try {
    const state = await sendMessage({ type: 'get-state' });
    if (state.bridgeConfig) {
      portInput.value = state.bridgeConfig.port;
      codeInput.value = state.bridgeConfig.code;
    }
    connectorVersionElement.textContent = state.connector?.version || 'unknown';
    mcpVersionElement.textContent = state.server?.version || (state.paired ? 'legacy / unknown' : 'not connected');
    const x1penVersions = Array.from(new Set(state.sessions
      .map((session) => session.x1pen?.version)
      .filter(Boolean)));
    x1penVersionElement.textContent = x1penVersions.length ? x1penVersions.join(', ') : 'not connected';
    sessionsElement.replaceChildren(...state.sessions.map((session) => {
      const item = document.createElement('li');
      item.textContent = `${session.active ? 'Active: ' : ''}${session.title}`;
      return item;
    }));
    if (state.paired) showStatus(`${state.sessions.length} X1Pen tab(s) connected`);
  } catch (error) {
    showStatus(error.message, true);
  }
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response?.ok) {
        reject(new Error(response?.error || 'Extension request failed'));
      } else {
        resolve(response.result);
      }
    });
  });
}

function showStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle('error', isError);
}

function setBusy(busy) {
  connectButton.dataset.busy = busy ? 'true' : 'false';
  updateConnectButton();
  disconnectButton.disabled = busy;
}

function updateConnectButton() {
  connectButton.disabled = connectButton.dataset.busy === 'true' || !consentInput.checked;
}
