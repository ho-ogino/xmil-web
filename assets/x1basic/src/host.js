'use strict';
// Embedders configure X1Host before this script. Electron supplies desktop.
(() => {
  const injected=window.X1Host!=null;
  window.X1Host = window.X1Host ?? window.desktop;
  if (!window.X1Host) throw Error('X1 BASIC Editor requires a host. Set window.X1Host before loading host.js.');
  document.querySelectorAll('[data-command="new"],[data-command="save-as"]').forEach(button=>{button.hidden=injected;});
})();
