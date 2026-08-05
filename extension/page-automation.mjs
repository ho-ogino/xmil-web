export async function invokeX1PenInPage(requestedMethod, requestedParams) {
  const api = window.X1PenAutomation;
  if (!api || api.version < 2) throw new Error('This tab does not provide X1Pen Automation API v2');
  if (requestedMethod === 'probe') return api.ready();
  if (requestedMethod === 'connection') {
    return api.setConnectionState(requestedParams.connected, requestedParams.connected ? 'MCP Connected' : '');
  }

  const requireDebugger = () => {
    const capability = api.getStatus().capabilities?.debugger;
    if (!api.debugger || !capability?.available) {
      throw new Error('The connected X1Pen does not provide the debugger API');
    }
    return api.debugger;
  };
  const runDebuggerControl = async (operation) => {
    const deadline = Date.now() + 10_000;
    while (true) {
      const debuggerApi = requireDebugger();
      const runPending = api.getStatus().capabilities.debugger.runPending;
      if (!runPending) {
        try {
          return await debuggerApi[operation]();
        } catch (error) {
          if (error?.code !== 'RUN_PENDING') throw error;
        }
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting to ${operation} while X1Pen Run setup is pending`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  const lockLabels = {
    setProgram: 'AI is updating the program...',
    validate: 'AI is validating the program...',
    run: 'AI is running the program...',
    stop: 'AI is stopping the program...',
    debuggerPause: 'AI is pausing the debugger...',
    debuggerResume: 'AI is resuming the debugger...',
    debuggerStep: 'AI is stepping the debugger...',
    debuggerSetBreakpoints: 'AI is updating breakpoints...',
  };
  const shouldLock = Object.prototype.hasOwnProperty.call(lockLabels, requestedMethod);
  if (shouldLock) api.setInteractionLocked(true, lockLabels[requestedMethod]);
  try {
    if (requestedMethod === 'getProgram') return api.getProgram();
    if (requestedMethod === 'setProgram') return await api.setProgram(requestedParams.program, requestedParams.expectedRevision);
    if (requestedMethod === 'validate') return await api.validate();
    if (requestedMethod === 'run') {
      const result = await api.run();
      if (requestedParams.waitMs > 0) await new Promise((resolve) => setTimeout(resolve, requestedParams.waitMs));
      return { ...result, state: api.getStatus() };
    }
    if (requestedMethod === 'stop') return await api.stop();
    if (requestedMethod === 'getStatus') return api.getStatus();
    if (requestedMethod === 'captureScreen') return api.captureScreen();
    if (requestedMethod === 'debuggerGetState') return requireDebugger().getState();
    if (requestedMethod === 'debuggerPause') return await runDebuggerControl('pause');
    if (requestedMethod === 'debuggerResume') return await runDebuggerControl('resume');
    if (requestedMethod === 'debuggerStep') {
      const count = requestedParams.count === undefined ? 1 : requestedParams.count;
      if (!Number.isInteger(count) || count < 1 || count > 100) {
        throw new Error('Debugger step count must be an integer from 1 to 100');
      }
      let state;
      for (let index = 0; index < count; index++) {
        try {
          state = await runDebuggerControl('step');
        } catch (error) {
          throw new Error(`Debugger step failed after ${index} of ${count} instructions: ${error?.message || String(error)}`);
        }
      }
      return { ...state, stepsExecuted: count };
    }
    if (requestedMethod === 'debuggerSetBreakpoints') {
      return await requireDebugger().setBreakpoints(requestedParams.addresses);
    }
    if (requestedMethod === 'debuggerReadMemory') {
      return requireDebugger().readMemory(requestedParams.address, requestedParams.length);
    }
    if (requestedMethod === 'debuggerWaitForPause') {
      return requireDebugger().waitForPause(requestedParams);
    }
    throw new Error(`Unsupported X1Pen method: ${requestedMethod}`);
  } finally {
    if (shouldLock) api.setInteractionLocked(false);
  }
}
