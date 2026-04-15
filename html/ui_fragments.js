// ui_fragments.js — 共通 DOM フラグメント注入
// shell.html / x1pen.html で共有するパネル HTML を一箇所で管理する。
// 制約: body 末尾の <script> 群に配置し、disk_editor.js より前に読み込むこと。

(function() {
    'use strict';
    if (document.querySelector('[data-xmil-shared-panels]')) return;

    var container = document.createElement('div');
    container.setAttribute('data-xmil-shared-panels', '1');
    container.innerHTML =

    // ── ファイルライブラリ パネル ──
    '<div id="library-panel" class="library-panel hidden">' +
    '    <div class="library-panel-inner">' +
    '        <div class="lib-panel-header">' +
    '            <span class="lib-panel-title">\u30D5\u30A1\u30A4\u30EB\u30E9\u30A4\u30D6\u30E9\u30EA</span>' +
    '            <button class="lib-close-btn" id="lib-close-btn">\u2715 \u9589\u3058\u308B</button>' +
    '        </div>' +
    '        <div class="lib-filters">' +
    '            <button class="lib-filter active" data-type="all">ALL</button>' +
    '            <button class="lib-filter" data-type="fdd">FDD</button>' +
    '            <button class="lib-filter" data-type="hdd">HDD</button>' +
    '            <button class="lib-filter" data-type="cmt">CMT</button>' +
    '            <button class="lib-filter" data-type="emm">EMM</button>' +
    '            <button class="lib-fav-filter" id="lib-fav-filter" title="\u304A\u6C17\u306B\u5165\u308A\u306E\u307F\u8868\u793A">\u2606</button>' +
    '            <button class="lib-drive-pick-btn hidden" id="btn-drive-pick"' +
    '                    title="\u30A2\u30D7\u30EA\u304C\u4FDD\u5B58\u6E08\u307F\u306E\u30D5\u30A1\u30A4\u30EB\u3092\u4E00\u89A7\u8868\u793A">\u2601 \u4FDD\u5B58\u6E08\u307F</button>' +
    '            <button class="lib-add-btn" id="lib-add-btn">\uFF0B \u8FFD\u52A0</button>' +
    '        </div>' +
    '        <div class="lib-toolbar" id="lib-toolbar">' +
    '            <input type="text" class="lib-search-input" id="lib-search-input"' +
    '                   placeholder="\u30D5\u30A1\u30A4\u30EB\u540D\u3067\u691C\u7D22..." autocomplete="off" />' +
    '            <select class="lib-sort-select" id="lib-sort-select">' +
    '                <option value="name">\u540D\u524D\u9806</option>' +
    '                <option value="type-name">\u30BF\u30A4\u30D7\u2192\u540D\u524D</option>' +
    '                <option value="date-desc">\u8FFD\u52A0\u65E5(\u65B0\u3057\u3044\u9806)</option>' +
    '                <option value="size-desc">\u30B5\u30A4\u30BA(\u5927\u304D\u3044\u9806)</option>' +
    '            </select>' +
    '        </div>' +
    '        <div id="library-list" class="lib-list"></div>' +
    '        <div id="drive-status" class="hidden"></div>' +
    '        <div id="library-capacity" class="lib-capacity"></div>' +
    '    </div>' +
    '</div>' +

    // ── EMM 作成ダイアログ ──
    '<div id="emm-create-dialog" class="library-panel hidden">' +
    '    <div class="library-panel-inner" style="max-width: 420px;">' +
    '        <div class="lib-panel-header">' +
    '            <span>EMM \u30D5\u30A1\u30A4\u30EB\u65B0\u898F\u4F5C\u6210</span>' +
    '            <button class="lib-close-btn" id="emm-create-close">\u2715 \u9589\u3058\u308B</button>' +
    '        </div>' +
    '        <div style="padding: 12px 16px; display: flex; flex-direction: column; gap: 12px;">' +
    '            <div>' +
    '                <label style="color: #999; font-size: 0.85em; display: block; margin-bottom: 4px;">\u30B9\u30ED\u30C3\u30C8</label>' +
    '                <select id="emm-create-slot" style="width: 100%; padding: 6px 8px; background: #1a1a1a; color: #ccc; border: 1px solid #444; border-radius: 4px; font-family: inherit;">' +
    '                    <option value="0">EMM0</option><option value="1">EMM1</option>' +
    '                    <option value="2">EMM2</option><option value="3">EMM3</option>' +
    '                    <option value="4">EMM4</option><option value="5">EMM5</option>' +
    '                    <option value="6">EMM6</option><option value="7">EMM7</option>' +
    '                    <option value="8">EMM8</option><option value="9">EMM9</option>' +
    '                </select>' +
    '            </div>' +
    '            <div>' +
    '                <label style="color: #999; font-size: 0.85em; display: block; margin-bottom: 4px;">\u30B5\u30A4\u30BA</label>' +
    '                <div id="emm-size-presets" style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">' +
    '                    <label class="emm-size-radio"><input type="radio" name="emm-size" value="327680"><span class="emm-size-led"></span><span class="emm-size-label">320KB</span></label>' +
    '                    <label class="emm-size-radio"><input type="radio" name="emm-size" value="524288"><span class="emm-size-led"></span><span class="emm-size-label">512KB</span></label>' +
    '                    <label class="emm-size-radio"><input type="radio" name="emm-size" value="1048576" checked><span class="emm-size-led"></span><span class="emm-size-label">1MB</span></label>' +
    '                    <label class="emm-size-radio"><input type="radio" name="emm-size" value="2097152"><span class="emm-size-led"></span><span class="emm-size-label">2MB</span></label>' +
    '                    <label class="emm-size-radio"><input type="radio" name="emm-size" value="4194304"><span class="emm-size-led"></span><span class="emm-size-label">4MB</span></label>' +
    '                    <label class="emm-size-radio"><input type="radio" name="emm-size" value="8388608"><span class="emm-size-led"></span><span class="emm-size-label">8MB</span></label>' +
    '                    <label class="emm-size-radio"><input type="radio" name="emm-size" value="16777216"><span class="emm-size-led"></span><span class="emm-size-label">16MB</span></label>' +
    '                    <label class="emm-size-radio"><input type="radio" name="emm-size" value="custom"><span class="emm-size-led"></span><span class="emm-size-label">custom</span></label>' +
    '                    <span style="display: inline-flex; align-items: center; gap: 4px;">' +
    '                        <input type="number" id="emm-custom-size" class="emm-custom-input" min="1" max="16384" step="1" value="1024" disabled>' +
    '                        <span style="color: #666; font-size: 0.7em;">KB</span>' +
    '                    </span>' +
    '                </div>' +
    '            </div>' +
    '            <button class="hw-state-btn" id="emm-create-confirm" style="align-self: flex-end; margin-top: 4px;">\u4F5C\u6210\u3057\u3066\u30DE\u30A6\u30F3\u30C8</button>' +
    '        </div>' +
    '    </div>' +
    '</div>' +

    // ── ディスクエディタパネル ──
    '<div id="disk-editor-panel" class="library-panel hidden">' +
    '    <div class="library-panel-inner" style="max-width:750px">' +
    '        <div class="lib-panel-header">' +
    '            <span class="lib-panel-title" id="disk-editor-title">\u30C7\u30A3\u30B9\u30AF\u7DE8\u96C6</span>' +
    '            <button class="lib-close-btn" id="disk-editor-close">\u2715</button>' +
    '        </div>' +
    '        <div id="disk-editor-info" class="disk-editor-info"></div>' +
    '        <div class="disk-editor-toolbar">' +
    '            <button id="disk-editor-add-btn" class="disk-editor-tool-btn">\uFF0B \u30D5\u30A1\u30A4\u30EB\u8FFD\u52A0</button>' +
    '            <input type="file" id="disk-editor-file-input" style="display:none" multiple>' +
    '        </div>' +
    '        <div id="disk-editor-list" class="lib-list"></div>' +
    '        <div class="disk-editor-footer">' +
    '            <button id="disk-editor-save-btn" class="disk-editor-tool-btn">\u9589\u3058\u308B</button>' +
    '        </div>' +
    '    </div>' +
    '</div>' +

    // ── 隠しファイル入力 (ライブラリ追加用) ──
    // iOS/iPadOS では独自拡張子 (.d88 等) を accept に指定するとファイルが
    // グレーアウトして選択できない。ファイル形式は addToLibrary() 側で
    // detectFileType() により検証しているため、accept は省略する。
    '<input type="file" id="file-add-to-library" multiple style="display:none">';

    document.body.appendChild(container);
})();
