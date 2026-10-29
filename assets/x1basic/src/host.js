'use strict';
// Embedders configure X1Host before this script. Electron supplies desktop.
(() => {
  const injected=window.X1Host!=null;
  const standaloneDesktop=!injected&&window.desktop!=null;
  window.X1Host = window.X1Host ?? window.desktop;
  if (!window.X1Host) throw Error('X1 BASIC Editor requires a host. Set window.X1Host before loading host.js.');
  document.documentElement.dataset.hostMode=standaloneDesktop?'desktop':'embedded';
  const documentBar=document.getElementById('document-bar');
  if(documentBar)documentBar.hidden=!standaloneDesktop;
  document.querySelectorAll('[data-command="new"],[data-command="save-as"]').forEach(button=>{button.hidden=injected;});
  document.querySelectorAll('[data-command="open"]').forEach(button=>{button.textContent=injected?'インポート…':'開く…';});
  document.querySelectorAll('[data-command="save"]').forEach(button=>{button.textContent=injected?'エクスポート':'保存';});
  const hint=document.getElementById('empty-file-hint');
  if(hint)hint.textContent=injected?'BASIC ファイルをインポートして編集を始める':'BASIC ファイルを開いて編集を始める';
})();
