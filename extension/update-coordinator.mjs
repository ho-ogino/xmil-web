export function createUpdateCoordinator({ prepare, reload, schedule, onError }) {
  const scheduleTask = schedule || ((callback) => setTimeout(callback, 0));
  const reportError = onError || (() => {});
  let updatePending = false;
  let activeOperations = 0;
  let applyScheduled = false;
  let applyingUpdate = false;

  const applyWhenIdle = async () => {
    applyScheduled = false;
    if (!updatePending || activeOperations > 0 || applyingUpdate) return;
    applyingUpdate = true;
    try {
      await prepare();
    } catch (error) {
      reportError(error);
    } finally {
      reload();
    }
  };

  const scheduleApply = () => {
    if (!updatePending || applyScheduled || applyingUpdate) return;
    applyScheduled = true;
    scheduleTask(applyWhenIdle);
  };

  return Object.freeze({
    run: async (operation) => {
      activeOperations++;
      try {
        return await operation();
      } finally {
        activeOperations--;
        scheduleApply();
      }
    },
    requestUpdate: () => {
      updatePending = true;
      scheduleApply();
    },
    isUpdatePending: () => updatePending,
  });
}
