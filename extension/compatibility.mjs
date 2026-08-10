export const CONNECTOR_PROTOCOL_VERSION = 2;
export const CONNECTOR_FEATURES = Object.freeze([
  'automation.core',
  'automation.run-recovery',
  'automation.source-sync',
  'screen.capture',
  'input.keyboard',
  'input.pad',
  'debugger.cpu',
  'debugger.vram',
]);

const FEATURE_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;

export function normalizeFeatureList(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .slice(0, 64)
    .filter((feature) => typeof feature === 'string' && FEATURE_PATTERN.test(feature))));
}

export function createConnectorDescriptor(version) {
  return {
    name: 'x1pen-connector',
    version: String(version || 'unknown'),
    protocolVersion: CONNECTOR_PROTOCOL_VERSION,
    features: [...CONNECTOR_FEATURES],
  };
}

export function normalizeX1PenDescriptor(status) {
  const advertised = status?.x1pen;
  const features = normalizeFeatureList(advertised?.features);
  if (!Array.isArray(advertised?.features)) {
    features.push('automation.core', 'screen.capture');
    if (status?.capabilities?.debugger?.available) features.push('debugger.cpu');
    if (status?.capabilities?.debugger?.vram?.available) features.push('debugger.vram');
  }
  return {
    name: 'x1pen',
    version: typeof advertised?.version === 'string' ? advertised.version : null,
    automationApiVersion: Number.isInteger(advertised?.automationApiVersion)
      ? advertised.automationApiVersion
      : 2,
    features: normalizeFeatureList(features),
  };
}

export function normalizeMcpServerDescriptor(message) {
  const server = message?.server;
  return {
    name: typeof server?.name === 'string' ? server.name : 'x1pen-mcp',
    version: typeof server?.version === 'string' ? server.version : null,
    protocolVersion: Number.isInteger(message?.protocolVersion) ? message.protocolVersion : 1,
    features: normalizeFeatureList(server?.features),
  };
}

export function assertMcpProtocolSupported(server) {
  if (server.protocolVersion >= 1 && server.protocolVersion <= CONNECTOR_PROTOCOL_VERSION) return;
  const error = new Error(
    `MCP bridge protocol ${server.protocolVersion} is not supported by this X1Pen Connector`,
  );
  error.code = 'BRIDGE_PROTOCOL_UNSUPPORTED';
  error.component = 'mcp';
  error.currentVersion = server.version || 'unknown';
  error.action = 'Update X1Pen Connector and reconnect this tab.';
  throw error;
}

export function serializeExtensionError(error) {
  const serialized = {
    message: String(error?.message || error).slice(0, 1_024),
  };
  if (typeof error?.code === 'string') serialized.code = error.code.slice(0, 128);
  if (['mcp', 'connector', 'x1pen'].includes(error?.component)) serialized.component = error.component;
  if (typeof error?.feature === 'string') serialized.feature = error.feature.slice(0, 64);
  if (typeof error?.currentVersion === 'string') serialized.currentVersion = error.currentVersion.slice(0, 64);
  if (typeof error?.requiredVersion === 'string') serialized.requiredVersion = error.requiredVersion.slice(0, 64);
  if (typeof error?.action === 'string') serialized.action = error.action.slice(0, 512);
  for (const key of ['expectedRevision', 'currentRevision', 'conflictRevision', 'observedRevision']) {
    if (Number.isSafeInteger(error?.[key]) && error[key] >= 0) serialized[key] = error[key];
  }
  for (const key of [
    'expectedRevisionEpoch', 'currentRevisionEpoch', 'conflictRevisionEpoch',
    'observedRevisionEpoch', 'instanceId',
  ]) {
    if (typeof error?.[key] === 'string' && error[key].length <= 128) serialized[key] = error[key];
  }
  if (typeof error?.metadataAvailable === 'boolean') serialized.metadataAvailable = error.metadataAvailable;
  return serialized;
}
