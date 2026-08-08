export const FEATURE_IDS = Object.freeze([
  'automation.core',
  'screen.capture',
  'debugger.cpu',
  'debugger.vram',
]);

export const MCP_FEATURES = Object.freeze([...FEATURE_IDS]);

const FEATURE_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;
const LEGACY_CONNECTOR_FEATURES = Object.freeze({
  '1.0.1': ['automation.core', 'screen.capture'],
  '1.1.0': ['automation.core', 'screen.capture', 'debugger.cpu'],
  '1.1.1': ['automation.core', 'screen.capture', 'debugger.cpu'],
});

const METHOD_FEATURES = Object.freeze({
  getProgram: 'automation.core',
  setProgram: 'automation.core',
  validate: 'automation.core',
  run: 'automation.core',
  stop: 'automation.core',
  getStatus: 'automation.core',
  captureScreen: 'screen.capture',
  debuggerGetState: 'debugger.cpu',
  debuggerPause: 'debugger.cpu',
  debuggerResume: 'debugger.cpu',
  debuggerStep: 'debugger.cpu',
  debuggerSetBreakpoints: 'debugger.cpu',
  debuggerReadMemory: 'debugger.cpu',
  debuggerWaitForPause: 'debugger.cpu',
  debuggerGetVideoState: 'debugger.vram',
  debuggerReadVram: 'debugger.vram',
  debuggerWriteVram: 'debugger.vram',
});

const CONNECTOR_MINIMUMS = Object.freeze({
  'debugger.cpu': '1.1.0',
  'debugger.vram': '1.2.0',
});

export function normalizeFeatureList(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .slice(0, 64)
    .filter((feature) => typeof feature === 'string' && FEATURE_PATTERN.test(feature))));
}

export function createMcpDescriptor(version) {
  return {
    name: 'x1pen-mcp',
    version: String(version || 'unknown'),
    protocolVersion: 2,
    features: [...MCP_FEATURES],
  };
}

export function normalizeConnectorPair(message) {
  const advertised = message?.connector;
  const version = typeof advertised?.version === 'string'
    ? advertised.version
    : (typeof message?.extensionVersion === 'string' ? message.extensionVersion : null);
  const hasAdvertisedFeatures = Array.isArray(advertised?.features);
  const legacyFeatures = version ? LEGACY_CONNECTOR_FEATURES[version] : null;
  return {
    name: typeof advertised?.name === 'string' ? advertised.name : 'x1pen-connector',
    version,
    protocolVersion: Number.isInteger(advertised?.protocolVersion) ? advertised.protocolVersion : 1,
    features: hasAdvertisedFeatures
      ? normalizeFeatureList(advertised.features)
      : normalizeFeatureList(legacyFeatures),
    featureSource: hasAdvertisedFeatures ? 'advertised' : (legacyFeatures ? 'legacy' : 'unknown'),
  };
}

export function normalizeX1PenDescriptor(value) {
  if (!value || typeof value !== 'object') return null;
  const hasAdvertisedFeatures = Array.isArray(value.features);
  return {
    name: 'x1pen',
    version: typeof value.version === 'string' ? value.version : null,
    automationApiVersion: Number.isInteger(value.automationApiVersion) ? value.automationApiVersion : null,
    features: normalizeFeatureList(value.features),
    featureSource: hasAdvertisedFeatures ? 'advertised' : 'unknown',
  };
}

function componentFeatureState(component, feature, disconnected = false) {
  if (!component) return { state: 'unknown', reason: disconnected ? 'disconnected' : 'not-reported' };
  if (component.featureSource === 'unknown' || !Array.isArray(component.features)) {
    return { state: 'unknown', reason: 'not-reported' };
  }
  return component.features.includes(feature)
    ? { state: 'available' }
    : { state: 'unavailable', reason: 'not-advertised' };
}

export function evaluateCompatibility({ mcp, connector, x1pen, connected = true }) {
  const result = {};
  for (const feature of FEATURE_IDS) {
    const components = {
      mcp: componentFeatureState({ ...mcp, featureSource: 'advertised' }, feature),
      connector: componentFeatureState(connector, feature, !connected),
      x1pen: componentFeatureState(x1pen, feature),
    };
    const states = Object.values(components).map((entry) => entry.state);
    const state = states.includes('unavailable')
      ? 'unavailable'
      : (states.every((value) => value === 'available') ? 'available' : 'unknown');
    result[feature] = {
      state,
      available: state === 'available' ? true : (state === 'unavailable' ? false : null),
      components,
    };
  }
  return result;
}

export class X1PenCompatibilityError extends Error {
  constructor(details) {
    super(details.message);
    this.name = 'X1PenCompatibilityError';
    Object.assign(this, details);
  }
}

export function assertMethodCompatible(method, compatibility, components) {
  const feature = METHOD_FEATURES[method];
  if (!feature || compatibility[feature]?.state !== 'unavailable') return;
  const states = compatibility[feature].components;
  const component = ['mcp', 'connector', 'x1pen']
    .find((name) => states[name].state === 'unavailable') || 'connector';
  const current = components[component];
  if (component === 'connector' && current?.featureSource === 'legacy') {
    const requiredVersion = CONNECTOR_MINIMUMS[feature];
    throw new X1PenCompatibilityError({
      code: 'CONNECTOR_UPDATE_REQUIRED',
      component,
      feature,
      currentVersion: current?.version || 'unknown',
      requiredVersion,
      action: 'Update X1Pen Connector and reconnect this tab.',
      message: `${feature} requires X1Pen Connector ${requiredVersion} or later. ` +
        `Connected version: ${current?.version || 'unknown'}.`,
    });
  }
  if (component === 'connector' || component === 'x1pen') {
    throw new X1PenCompatibilityError({
      code: 'FEATURE_UNAVAILABLE',
      component,
      feature,
      currentVersion: current?.version || 'unknown',
      action: component === 'connector'
        ? 'Update X1Pen Connector and reconnect this tab.'
        : 'Reload or update X1Pen and reconnect this tab.',
      message: `${feature} is not advertised by the connected ${component === 'connector' ? 'Connector' : 'X1Pen'}.`,
    });
  }
  // Defensive for a future MCP release that deliberately omits a known feature.
  throw new X1PenCompatibilityError({
    code: 'MCP_UPDATE_REQUIRED',
    component,
    feature,
    currentVersion: current?.version || 'unknown',
    action: 'Restart the MCP client with x1pen-mcp@latest.',
    message: `${feature} is not available in this X1Pen MCP server.`,
  });
}

export function deserializeBridgeError(value) {
  if (!value || typeof value !== 'object') return new Error(String(value || 'X1Pen command failed'));
  const error = new Error(typeof value.message === 'string' ? value.message : 'X1Pen command failed');
  for (const key of ['code', 'component', 'feature', 'currentVersion', 'requiredVersion', 'action']) {
    if (typeof value[key] === 'string') error[key] = value[key];
  }
  return error;
}
