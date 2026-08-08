import { randomInt, randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import {
  assertMethodCompatible,
  createMcpDescriptor,
  deserializeBridgeError,
  evaluateCompatibility,
  normalizeConnectorPair,
  normalizeX1PenDescriptor,
} from './x1pen-compatibility.mjs';

const DEFAULT_START_PORT = 43110;
const DEFAULT_END_PORT = 43119;
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

function createPairingCode() {
  return String(randomInt(100000, 1000000));
}

function isExtensionOrigin(origin) {
  return typeof origin === 'string' && origin.startsWith('chrome-extension://');
}

export class X1PenBridge {
  constructor(options = {}) {
    this.host = '127.0.0.1';
    const configuredPort = process.env.X1PEN_BRIDGE_PORT ? Number(process.env.X1PEN_BRIDGE_PORT) : DEFAULT_START_PORT;
    this.startPort = options.startPort ?? configuredPort;
    this.endPort = options.endPort ?? (this.startPort === DEFAULT_START_PORT ? DEFAULT_END_PORT : this.startPort);
    this.pairingCode = options.pairingCode || createPairingCode();
    this.commandTimeoutMs = options.commandTimeoutMs || 60_000;
    this.allowOrigin = options.allowOrigin || isExtensionOrigin;
    this.logger = options.logger || ((message) => console.error(`[x1pen-mcp] ${message}`));
    this.server = null;
    this.socket = null;
    this.port = null;
    this.sessions = new Map();
    this.selectedSessionId = null;
    this.pendingCommands = new Map();
    this.keepAliveTimer = null;
    this.serverDescriptor = options.serverDescriptor || createMcpDescriptor('unknown');
    this.connectorDescriptor = null;
  }

  async start() {
    if (this.server) return this.connectionInfo();
    let lastError;
    for (let port = this.startPort; port <= this.endPort; port++) {
      try {
        await this.listen(port);
        this.port = this.server.address().port;
        this.keepAliveTimer = setInterval(() => {
          if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
          }
        }, 20_000);
        this.logger(`browser bridge listening on ws://${this.host}:${this.port}`);
        this.logger(`pairing code: ${this.pairingCode}`);
        return this.connectionInfo();
      } catch (error) {
        lastError = error;
        if (error.code !== 'EADDRINUSE') throw error;
      }
    }
    throw new Error(`No X1Pen bridge port available (${this.startPort}-${this.endPort}): ${lastError?.message || 'unknown error'}`);
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({
        host: this.host,
        port,
        maxPayload: MAX_MESSAGE_BYTES,
        verifyClient: ({ origin }) => this.allowOrigin(origin),
      });
      const onError = (error) => {
        server.close();
        reject(error);
      };
      server.once('error', onError);
      server.once('listening', () => {
        server.off('error', onError);
        server.on('error', (error) => this.logger(`bridge error: ${error.message}`));
        server.on('connection', (socket) => this.handleConnection(socket));
        this.server = server;
        resolve();
      });
    });
  }

  handleConnection(socket) {
    let authenticated = false;
    const authTimeout = setTimeout(() => socket.close(1008, 'Pairing timeout'), 10_000);

    socket.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        socket.close(1007, 'Invalid JSON');
        return;
      }

      if (!authenticated) {
        if (message.type !== 'pair' || message.code !== this.pairingCode) {
          socket.close(1008, 'Invalid pairing code');
          return;
        }
        clearTimeout(authTimeout);
        authenticated = true;
        if (this.socket && this.socket !== socket) {
          this.rejectPending(new Error('X1Pen browser extension connection was replaced'));
          this.socket.close(1012, 'Replaced by a new extension connection');
        }
        this.socket = socket;
        this.connectorDescriptor = normalizeConnectorPair(message);
        this.sessions.clear();
        this.selectedSessionId = null;
        socket.send(JSON.stringify({
          type: 'paired',
          protocolVersion: this.serverDescriptor.protocolVersion,
          server: this.serverDescriptor,
        }));
        this.logger('browser extension paired');
        return;
      }

      if (this.socket === socket) this.handleMessage(message);
    });

    socket.on('close', () => {
      clearTimeout(authTimeout);
      if (this.socket !== socket) return;
      this.socket = null;
      this.connectorDescriptor = null;
      this.sessions.clear();
      this.selectedSessionId = null;
      this.rejectPending(new Error('X1Pen browser extension disconnected'));
      this.logger('browser extension disconnected');
    });
  }

  handleMessage(message) {
    if (message.type === 'sessions' && Array.isArray(message.sessions)) {
      this.sessions.clear();
      for (const session of message.sessions.slice(0, 16)) {
        if (!session || typeof session.sessionId !== 'string') continue;
        this.sessions.set(session.sessionId, {
          sessionId: session.sessionId,
          title: String(session.title || 'X1Pen'),
          url: String(session.url || ''),
          active: !!session.active,
          revision: Number.isInteger(session.revision) ? session.revision : 0,
          x1pen: normalizeX1PenDescriptor(session.x1pen),
        });
      }
      if (this.selectedSessionId && !this.sessions.has(this.selectedSessionId)) this.selectedSessionId = null;
      if (!this.selectedSessionId && this.sessions.size === 1) this.selectedSessionId = this.sessions.keys().next().value;
      return;
    }
    if (message.type === 'result' && typeof message.id === 'string') {
      const pending = this.pendingCommands.get(message.id);
      if (!pending) return;
      this.pendingCommands.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(deserializeBridgeError(message.error));
    }
  }

  connectionInfo() {
    return {
      host: this.host,
      port: this.port,
      pairingCode: this.pairingCode,
      extensionConnected: !!this.socket,
      sessionCount: this.sessions.size,
      selectedSessionId: this.selectedSessionId,
      components: {
        mcp: this.serverDescriptor,
        connector: this.connectorDescriptor,
      },
      compatibility: this.selectedSessionId && this.sessions.has(this.selectedSessionId)
        ? this.getSessionCompatibility(this.selectedSessionId)
        : null,
    };
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((session) => ({
      ...session,
      selected: session.sessionId === this.selectedSessionId,
      compatibility: this.getSessionCompatibility(session.sessionId),
    }));
  }

  selectSession(sessionId) {
    if (!this.sessions.has(sessionId)) throw new Error(`X1Pen session not found: ${sessionId}`);
    this.selectedSessionId = sessionId;
    const session = this.sessions.get(sessionId);
    return { ...session, selected: true, compatibility: this.getSessionCompatibility(sessionId) };
  }

  resolveSession(sessionId) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('X1Pen browser extension is not connected. Call x1pen_connection_info and pair the extension first.');
    }
    const resolved = sessionId || this.selectedSessionId;
    if (resolved && this.sessions.has(resolved)) return resolved;
    if (this.sessions.size === 1) return this.sessions.keys().next().value;
    if (this.sessions.size === 0) throw new Error('No X1Pen tab is connected. Use the extension popup on an X1Pen tab.');
    throw new Error('Multiple X1Pen tabs are connected. Call x1pen_list_sessions and x1pen_select_session first.');
  }

  sendCommand(method, params = {}, sessionId) {
    const resolvedSessionId = this.resolveSession(sessionId);
    const compatibility = this.getSessionCompatibility(resolvedSessionId);
    assertMethodCompatible(method, compatibility.capabilities, compatibility.components);
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`X1Pen command timed out: ${method}`));
      }, this.commandTimeoutMs);
      this.pendingCommands.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({
        type: 'command',
        id,
        sessionId: resolvedSessionId,
        method,
        params,
      }), (error) => {
        if (!error) return;
        clearTimeout(timeout);
        this.pendingCommands.delete(id);
        reject(error);
      });
    });
  }

  getSessionCompatibility(sessionId) {
    let resolvedSessionId = sessionId || this.selectedSessionId;
    if (!resolvedSessionId && this.sessions.size === 1) resolvedSessionId = this.sessions.keys().next().value;
    const session = this.sessions.get(resolvedSessionId);
    if (!session) throw new Error(`X1Pen session not found: ${sessionId || 'not selected'}`);
    const components = {
      mcp: this.serverDescriptor,
      connector: this.connectorDescriptor,
      x1pen: session.x1pen,
    };
    return {
      components,
      capabilities: evaluateCompatibility({
        ...components,
        connected: !!this.socket,
      }),
    };
  }

  rejectPending(error) {
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingCommands.clear();
  }

  async close() {
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
    this.rejectPending(new Error('X1Pen bridge closed'));
    if (this.socket) this.socket.close(1001, 'Server shutting down');
    this.socket = null;
    this.connectorDescriptor = null;
    if (this.server) {
      const server = this.server;
      this.server = null;
      await new Promise((resolve) => server.close(resolve));
    }
    this.port = null;
  }
}
