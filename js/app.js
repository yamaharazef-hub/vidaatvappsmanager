/* VIDAA Launcher — remote-controlled web-app launcher for VIDAA TVs.
   Plain ES5, no dependencies, so it runs on older TV browser engines. */
(function () {
  'use strict';

  var STORAGE_KEY = 'vidaaLauncher.v1';
  var COLORS = ['#dc2626', '#ea580c', '#f59e0b', '#ca8a04', '#16a34a', '#22c55e', '#0891b2',
                '#2563eb', '#1d4ed8', '#7c3aed', '#c026d3', '#db2777', '#475569', '#0f172a'];

  // Remote key codes (VIDAA / HbbTV / common TV browsers + PC keyboard for testing)
  var K = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412
  };
  var BACK_KEYS = [8, 27, 461, 10009];
  var PLAYPAUSE_KEYS = [10252, 179, 463];
  var DIRS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function qsa(sel, rootEl) { return Array.prototype.slice.call((rootEl || document).querySelectorAll(sel)); }
  function inArr(arr, v) { return arr.indexOf(v) !== -1; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /** Normalise a user-typed address. Only http(s) is allowed. Returns '' if invalid. */
  function normalizeUrl(raw) {
    var u = String(raw || '').replace(/^\s+|\s+$/g, '');
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.\-]*:/i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
    if (!/^https?:\/\/[^\s\/?#]+\.[^\s\/?#]+|^https?:\/\/(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?/i.test(u)) return '';
    if (/\s/.test(u)) return '';
    return u;
  }
  function hostOf(url) {
    var m = /^https?:\/\/([^\/?#:]+)/i.exec(url || '');
    return m ? m[1].replace(/^www\./, '') : '';
  }
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var mm = (h && m < 10 ? '0' : '') + m, ss = (sec < 10 ? '0' : '') + sec;
    return (h ? h + ':' : '') + mm + ':' + ss;
  }
  function fmtSize(b) {
    if (!b) return '';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i ? b.toFixed(1) : b) + ' ' + u[i];
  }
  function getJSON(url, ok, fail) {
    var x = new XMLHttpRequest();
    x.open('GET', url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now(), true);
    x.timeout = 10000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      if (x.status >= 200 && x.status < 300 || (x.status === 0 && x.responseText)) {
        try { ok(JSON.parse(x.responseText)); } catch (e) { fail('The file is not valid JSON.'); }
      } else fail('Could not download (HTTP ' + x.status + ').');
    };
    x.ontimeout = function () { fail('Download timed out.'); };
    try { x.send(); } catch (e) { fail('Download failed.'); }
  }

  /** Accepts {apps:[...]} or [...]; returns a clean app array or null. */
  function sanitizeAppList(data) {
    var list = data && data.apps ? data.apps : data;
    if (!list || typeof list.length !== 'number') return null;
    var out = [];
    for (var i = 0; i < list.length && out.length < 200; i++) {
      var a = list[i] || {};
      var url = normalizeUrl(a.url);
      if (!url) continue;
      var icon = a.icon ? normalizeUrl(a.icon) : '';
      out.push({
        id: uid() + i,
        name: String(a.name || hostOf(url)).slice(0, 40),
        url: url,
        icon: icon,
        color: /^#[0-9a-f]{3,8}$/i.test(a.color || '') ? a.color : COLORS[i % COLORS.length]
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // State & storage
  // ---------------------------------------------------------------------------
  var state = {
    apps: [],
    settings: { openMode: 'same', icons: true, clock: true },
    view: 'apps',
    editMode: false,
    movingId: null,
    media: [],
    lastFocus: {}
  };

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ apps: state.apps, settings: state.settings }));
    } catch (e) { /* storage full or disabled */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (d.settings) for (var k in state.settings) if (d.settings.hasOwnProperty(k)) state.settings[k] = d.settings[k];
      if (d.apps && d.apps.length !== undefined) { state.apps = d.apps; return true; }
    } catch (e) { /* corrupted */ }
    return false;
  }
  function builtInDefaults() { return sanitizeAppList(window.VL_DEFAULTS || []) || []; }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------
  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2800);
  }

  // ---------------------------------------------------------------------------
  // Focus management
  // ---------------------------------------------------------------------------
  var modalStack = [];

  function isVisible(el) {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function focusScope() {
    if (modalStack.length) return [modalStack[modalStack.length - 1].el];
    return [$('tabs'), $('view-' + state.view)];
  }
  function focusables() {
    var out = [];
    focusScope().forEach(function (s) { out = out.concat(qsa('.f', s).filter(isVisible)); });
    return out;
  }
  function current() {
    var a = document.activeElement;
    return a && a.classList && a.classList.contains('f') ? a : null;
  }

  /** Scroll a clipped container (overflow:hidden) so el is fully visible. */
  function ensureVisible(el) {
    var p = el.parentNode;
    while (p && p !== document.body) {
      if (p.scrollHeight > p.clientHeight + 1 && /hidden|auto|scroll/.test(getComputedStyle(p).overflowY)) {
        var pr = p.getBoundingClientRect(), r = el.getBoundingClientRect();
        var pad = 24;
        if (r.top < pr.top + pad) p.scrollTop -= (pr.top + pad - r.top);
        else if (r.bottom > pr.bottom - pad) p.scrollTop += (r.bottom - pr.bottom + pad);
        return;
      }
      p = p.parentNode;
    }
  }
  function focusEl(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    ensureVisible(el);
    if (!modalStack.length && !el.classList.contains('tab')) state.lastFocus[state.view] = el.getAttribute('data-id') || el.id;
  }
  function focusFirst(force) {
    var list = focusables();
    var cur = current();
    if (!force && cur && list.indexOf(cur) !== -1) return;
    // restore last focus in this view, if any
    var key = state.lastFocus[state.view];
    if (!modalStack.length && key) {
      var prev = document.querySelector('#view-' + state.view + ' [data-id="' + key + '"]') || $(key);
      if (prev && list.indexOf(prev) !== -1) { focusEl(prev); return; }
    }
    var scope = focusScope();
    var main = qsa('.f', scope[scope.length - 1]).filter(isVisible);
    if (!modalStack.length && state.view === 'apps') main = qsa('#grid .f').concat(main); // start on the first app
    focusEl(main[0] || list[0]);
  }
  function rectOf(el) { var r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }

  function move(dir) {
    var list = focusables();
    var cur = current();
    if (!cur || list.indexOf(cur) === -1) { focusFirst(); return; }
    var idx = window.VLSpatial.findBest(rectOf(cur), list.map(rectOf), dir);
    if (idx === -1) return;
    var target = list[idx];
    // Entering the tab bar from content always lands on the active tab,
    // so pressing UP never switches views by accident.
    if (target.classList.contains('tab') && !cur.classList.contains('tab')) {
      target = document.querySelector('.tab.active') || target;
    }
    focusEl(target);
  }

  // ---------------------------------------------------------------------------
  // Modals
  // ---------------------------------------------------------------------------
  function openModal(id, opts) {
    var el = $(id);
    modalStack.push({ el: el, returnTo: current(), onClose: opts && opts.onClose });
    el.classList.remove('hidden');
    var target = opts && opts.focus ? $(opts.focus) : qsa('.f', el).filter(isVisible)[0];
    focusEl(target);
    updateHints();
  }
  function closeModal() {
    var m = modalStack.pop();
    if (!m) return;
    m.el.classList.add('hidden');
    if (m.onClose) m.onClose();
    if (m.returnTo && document.body.contains(m.returnTo) && isVisible(m.returnTo)) focusEl(m.returnTo);
    else focusFirst();
    updateHints();
  }
  function confirmBox(title, msg, onYes) {
    $('confirm-title').textContent = title;
    $('confirm-msg').textContent = msg || '';
    $('confirm-yes').onclick = function () { closeModal(); onYes(); };
    $('confirm-no').onclick = closeModal;
    openModal('modal-confirm', { focus: 'confirm-no' });
  }

  // ---------------------------------------------------------------------------
  // Views / tabs
  // ---------------------------------------------------------------------------
  function showView(name, keepFocusOnTab) {
    if (state.movingId) stopMoving();
    state.view = name;
    qsa('.view').forEach(function (v) { v.classList.toggle('hidden', v.id !== 'view-' + name); });
    qsa('.tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-view') === name); });
    if (name === 'settings') renderSettings();
    if (keepFocusOnTab) focusEl(document.querySelector('.tab[data-view="' + name + '"]'));
    else focusFirst(true);
    updateHints();
  }

  function updateHints() {
    var h = '';
    if (modalStack.length) h = '<span class="key">OK</span>Select<span class="key">BACK</span>Close';
    else if (state.movingId) h = '<span class="key">◀ ▲ ▼ ▶</span>Move app<span class="key">OK</span>Done<span class="key">BACK</span>Done';
    else if (state.view === 'apps') {
      h = state.editMode
        ? '<span class="key">OK</span>App options<span class="key yellow">YELLOW</span>Finish editing<span class="key">BACK</span>Finish editing'
        : '<span class="key">OK</span>Open<span class="key red">RED</span>Options<span class="key green">GREEN</span>Add app<span class="key yellow">YELLOW</span>Edit mode<span class="key">1-9</span>Quick launch';
    } else if (state.view === 'media') h = '<span class="key">OK</span>Play<span class="key">BACK</span>Apps';
    else h = '<span class="key">OK</span>Select<span class="key">BACK</span>Apps';
    $('hintbar').innerHTML = h;
  }

  // ---------------------------------------------------------------------------
  // Apps grid
  // ---------------------------------------------------------------------------
  function iconUrl(app) {
    if (app.icon) return app.icon;
    if (!state.settings.icons) return '';
    return 'https://www.google.com/s2/favicons?sz=128&domain_url=' + encodeURIComponent(app.url);
  }
  function findApp(id) {
    for (var i = 0; i < state.apps.length; i++) if (state.apps[i].id === id) return i;
    return -1;
  }

  function renderGrid() {
    var html = '';
    state.apps.forEach(function (a, i) {
      var ic = iconUrl(a);
      html += '<button class="tile f' + (state.movingId === a.id ? ' moving' : '') + '" data-id="' + esc(a.id) + '">' +
        '<div class="tile-icon" style="background:' + esc(a.color) + '">' +
          esc((a.name || '?').charAt(0).toUpperCase()) +
          (ic ? '<img src="' + esc(ic) + '" alt="">' : '') +
        '</div>' +
        '<div class="tile-name">' + esc(a.name) + '</div>' +
        (i < 10 ? '<span class="tile-num">' + ((i + 1) % 10) + '</span>' : '') +
      '</button>';
    });
    html += '<button class="tile add f" data-id="__add"><div class="tile-icon">+</div><div class="tile-name">Add app</div></button>';
    var grid = $('grid');
    grid.innerHTML = html;
    qsa('img', grid).forEach(function (img) {
      img.onerror = function () { img.parentNode && img.parentNode.removeChild(img); };
    });
    $('view-apps').classList.toggle('editing', state.editMode);
    $('btn-edit').textContent = state.editMode ? 'Done editing' : 'Edit mode';
    $('btn-edit').classList.toggle('on', state.editMode);
    $('apps-title').textContent = state.apps.length ? 'My Apps' : 'My Apps (empty: add one!)';
  }

  function openApp(app) {
    toast('Opening ' + app.name + '…');
    setTimeout(function () {
      if (state.settings.openMode === 'new') {
        var w = window.open(app.url, '_blank');
        if (!w) window.location.href = app.url;
      } else {
        window.location.href = app.url;
      }
    }, 150);
  }

  function onTileClick(tile) {
    var id = tile.getAttribute('data-id');
    if (id === '__add') { openEditor(null); return; }
    if (state.movingId) { stopMoving(); return; }
    var i = findApp(id);
    if (i === -1) return;
    if (state.editMode) openActions(state.apps[i]);
    else openApp(state.apps[i]);
  }

  function setEditMode(on) {
    if (state.movingId) stopMoving();
    state.editMode = on;
    var cur = current();
    var curId = cur && cur.getAttribute('data-id');
    renderGrid();
    if (curId) focusEl(document.querySelector('#grid [data-id="' + curId + '"]'));
    else if (on) focusFirst();
    updateHints();
    if (on) toast('Edit mode: press OK on an app to edit, move or delete it');
  }

  // ----- Moving apps around -----
  function startMoving(id) {
    state.movingId = id;
    renderGrid();
    focusEl(document.querySelector('#grid [data-id="' + id + '"]'));
    updateHints();
  }
  function stopMoving() {
    var id = state.movingId;
    state.movingId = null;
    save();
    renderGrid();
    if (id) focusEl(document.querySelector('#grid [data-id="' + id + '"]'));
    updateHints();
  }
  function moveTile(dir) {
    var id = state.movingId;
    var tiles = qsa('#grid .tile:not(.add)');
    var cur = document.querySelector('#grid [data-id="' + id + '"]');
    if (!cur) return;
    var others = tiles.filter(function (t) { return t !== cur; });
    var idx = window.VLSpatial.findBest(rectOf(cur), others.map(rectOf), dir);
    if (idx === -1) return;
    var from = findApp(id), to = findApp(others[idx].getAttribute('data-id'));
    var item = state.apps.splice(from, 1)[0];
    state.apps.splice(to, 0, item);
    renderGrid();
    focusEl(document.querySelector('#grid [data-id="' + id + '"]'));
  }

  // ----- Action menu -----
  var actionApp = null;
  function openActions(app) {
    actionApp = app;
    $('actions-title').textContent = app.name;
    $('actions-url').textContent = app.url;
    openModal('modal-actions');
  }
  function onAction(act) {
    var app = actionApp;
    closeModal();
    if (!app) return;
    var i = findApp(app.id);
    if (i === -1) return;
    if (act === 'open') openApp(app);
    else if (act === 'edit') openEditor(app);
    else if (act === 'move') startMoving(app.id);
    else if (act === 'first') {
      state.apps.splice(i, 1); state.apps.unshift(app); save(); renderGrid();
      focusEl(document.querySelector('#grid [data-id="' + app.id + '"]'));
      toast(app.name + ' moved to first');
    } else if (act === 'delete') deleteApp(app);
  }
  function deleteApp(app) {
    confirmBox('Delete "' + app.name + '"?', app.url, function () {
      var i = findApp(app.id);
      if (i === -1) return;
      state.apps.splice(i, 1);
      save(); renderGrid();
      var tiles = qsa('#grid .tile');
      focusEl(tiles[Math.min(i, tiles.length - 1)]);
      toast('Deleted ' + app.name);
    });
  }

  // ----- Editor -----
  var editing = null, editColor = COLORS[7];
  function renderSwatches() {
    $('ed-swatches').innerHTML = COLORS.map(function (c) {
      return '<button class="swatch f' + (c === editColor ? ' selected' : '') + '" data-color="' + c +
        '" style="background:' + c + '" aria-label="Colour ' + c + '"></button>';
    }).join('');
  }
  function openEditor(app) {
    editing = app;
    $('editor-title').textContent = app ? 'Edit app' : 'Add app';
    $('ed-name').value = app ? app.name : '';
    $('ed-url').value = app ? app.url : '';
    $('ed-icon').value = app && app.icon ? app.icon : '';
    editColor = app ? app.color : COLORS[state.apps.length % COLORS.length];
    renderSwatches();
    $('ed-delete').classList.toggle('hidden', !app);
    openModal('modal-editor', { focus: 'ed-name' });
  }
  function saveEditor() {
    var url = normalizeUrl($('ed-url').value);
    if (!url) { toast('Please enter a valid website address'); focusEl($('ed-url')); return; }
    var iconRaw = $('ed-icon').value.replace(/^\s+|\s+$/g, '');
    var icon = iconRaw ? normalizeUrl(iconRaw) : '';
    if (iconRaw && !icon) { toast('Icon link is not valid'); focusEl($('ed-icon')); return; }
    var name = $('ed-name').value.replace(/^\s+|\s+$/g, '') || hostOf(url);
    var id;
    if (editing) {
      var i = findApp(editing.id);
      if (i !== -1) { state.apps[i].name = name; state.apps[i].url = url; state.apps[i].icon = icon; state.apps[i].color = editColor; }
      id = editing.id;
    } else {
      id = uid();
      state.apps.push({ id: id, name: name, url: url, icon: icon, color: editColor });
    }
    save();
    closeModal();
    if (state.view !== 'apps') showView('apps');
    renderGrid();
    focusEl(document.querySelector('#grid [data-id="' + id + '"]'));
    toast(editing ? 'Saved' : 'Added ' + name);
    editing = null;
  }

  // ---------------------------------------------------------------------------
  // Media (USB files + links)
  // ---------------------------------------------------------------------------
  var EXT = {
    video: /\.(mp4|m4v|mkv|webm|mov|avi|ts|m2ts|mpg|mpeg|wmv|flv|3gp|m3u8)(\?|$)/i,
    audio: /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|wma)(\?|$)/i,
    image: /\.(jpe?g|png|gif|webp|bmp|heic)(\?|$)/i
  };
  function kindOf(name, mime) {
    if (mime) { var m = /^(video|audio|image)\//.exec(mime); if (m) return m[1]; }
    if (EXT.video.test(name)) return 'video';
    if (EXT.audio.test(name)) return 'audio';
    if (EXT.image.test(name)) return 'image';
    return 'video';
  }
  function renderMedia() {
    var html = state.media.map(function (m, i) {
      return '<button class="media-item f" data-idx="' + i + '" data-id="m' + i + '">' +
        '<span class="media-kind">' + m.kind + '</span>' +
        '<span class="media-name">' + esc(m.name) + '</span>' +
        '<span class="media-size">' + esc(m.size ? fmtSize(m.size) : '') + '</span></button>';
    }).join('');
    $('media-list').innerHTML = html;
    $('media-empty').classList.toggle('hidden', state.media.length > 0);
  }
  function addFiles(files) {
    var added = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      state.media.push({ name: f.name, kind: kindOf(f.name, f.type), size: f.size, src: URL.createObjectURL(f), blob: true });
      added++;
    }
    renderMedia();
    if (added) { toast(added + ' file' + (added > 1 ? 's' : '') + ' added'); focusEl(document.querySelector('#media-list .f')); }
  }
  function clearMedia() {
    state.media.forEach(function (m) { if (m.blob) try { URL.revokeObjectURL(m.src); } catch (e) {} });
    state.media = [];
    renderMedia();
    focusEl($('btn-pick'));
  }

  // ----- Player -----
  var player = { open: false, idx: 0, osdTimer: null, tick: null };
  function playerShowOsd() {
    var o = $('osd');
    o.classList.remove('faded');
    clearTimeout(player.osdTimer);
    player.osdTimer = setTimeout(function () {
      var v = $('player-video');
      if (state.media[player.idx] && state.media[player.idx].kind !== 'audio' && !v.paused) o.classList.add('faded');
    }, 3500);
  }
  function playerUpdate() {
    var v = $('player-video'), m = state.media[player.idx];
    if (!m) return;
    if (m.kind === 'image') {
      $('osd-time').textContent = (player.idx + 1) + ' / ' + state.media.length;
      $('osd-fill').style.width = ((player.idx + 1) / state.media.length * 100) + '%';
      return;
    }
    var d = v.duration, t = v.currentTime;
    $('osd-time').textContent = fmtTime(t) + ' / ' + (isFinite(d) ? fmtTime(d) : 'LIVE') + (v.paused ? '  (paused)' : '');
    $('osd-fill').style.width = (isFinite(d) && d > 0 ? (t / d * 100) : 0) + '%';
  }
  function playerLoad(i) {
    if (i < 0 || i >= state.media.length) return false;
    player.idx = i;
    var m = state.media[i], v = $('player-video'), img = $('player-image');
    $('osd-title').textContent = m.name;
    if (m.kind === 'image') {
      v.pause(); v.removeAttribute('src'); try { v.load(); } catch (e) {}
      v.classList.add('hidden'); $('player-audio-art').classList.add('hidden');
      img.src = m.src; img.classList.remove('hidden');
    } else {
      img.classList.add('hidden'); img.removeAttribute('src');
      v.classList.remove('hidden');
      $('player-audio-art').classList.toggle('hidden', m.kind !== 'audio');
      v.src = m.src;
      var p = v.play();
      if (p && p.catch) p.catch(function () { toast('Press OK to play'); });
    }
    playerUpdate(); playerShowOsd();
    return true;
  }
  function playerOpen(i) {
    player.open = true;
    $('player').classList.remove('hidden');
    playerLoad(i);
    clearInterval(player.tick);
    player.tick = setInterval(playerUpdate, 500);
  }
  function playerClose() {
    var v = $('player-video');
    v.pause(); v.removeAttribute('src'); try { v.load(); } catch (e) {}
    $('player').classList.add('hidden');
    clearInterval(player.tick);
    player.open = false;
    focusEl(document.querySelector('#media-list [data-idx="' + player.idx + '"]'));
  }
  function playerKey(k) {
    var v = $('player-video'), m = state.media[player.idx];
    playerShowOsd();
    if (inArr(BACK_KEYS, k) || k === K.STOP) { playerClose(); return true; }
    if (!m) return true;
    var isImg = m.kind === 'image';
    if (k === K.ENTER || inArr(PLAYPAUSE_KEYS, k) || k === K.PLAY || k === K.PAUSE) {
      if (isImg) return true;
      if (k === K.PLAY || (k !== K.PAUSE && v.paused)) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
      else v.pause();
      playerUpdate();
      return true;
    }
    if (k === K.LEFT || k === K.RW) {
      if (isImg) playerLoad(player.idx - 1); else { v.currentTime = Math.max(0, v.currentTime - 10); }
      playerUpdate(); return true;
    }
    if (k === K.RIGHT || k === K.FF) {
      if (isImg) playerLoad(player.idx + 1); else if (isFinite(v.duration)) { v.currentTime = Math.min(v.duration - 0.5, v.currentTime + 10); }
      playerUpdate(); return true;
    }
    if (k === K.UP) { if (!playerLoad(player.idx - 1)) toast('First item'); return true; }
    if (k === K.DOWN) { if (!playerLoad(player.idx + 1)) toast('Last item'); return true; }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  function renderSettings() {
    var s = state.settings;
    $('set-open').textContent = s.openMode === 'new' ? 'New window' : 'Same window';
    $('set-icons').textContent = s.icons ? 'On' : 'Off';
    $('set-icons').classList.toggle('on', s.icons);
    $('set-clock').textContent = s.clock ? 'On' : 'Off';
    $('set-clock').classList.toggle('on', s.clock);
    $('clock').classList.toggle('hidden', !s.clock);
  }
  function replaceApps(list, msg) {
    state.apps = list;
    state.editMode = false;
    save(); renderGrid();
    toast(msg);
  }
  function importData(data, source) {
    var list = sanitizeAppList(data);
    if (!list || !list.length) { toast('No valid apps found in ' + source); return; }
    confirmBox('Replace your app list?', 'Import ' + list.length + ' apps from ' + source + '. Your current ' + state.apps.length + ' apps will be replaced.', function () {
      replaceApps(list, 'Imported ' + list.length + ' apps');
    });
  }
  function exportJson() {
    return JSON.stringify({
      version: 1,
      apps: state.apps.map(function (a) {
        var o = { name: a.name, url: a.url, color: a.color };
        if (a.icon) o.icon = a.icon;
        return o;
      })
    }, null, 2);
  }

  // ---------------------------------------------------------------------------
  // Clock
  // ---------------------------------------------------------------------------
  function tickClock() {
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    $('clock').textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  // ---------------------------------------------------------------------------
  // Keyboard / remote handling
  // ---------------------------------------------------------------------------
  function isTextField(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && /^(text|url|search|email|password|number|tel)$/i.test(el.type || 'text');
  }
  function caretAllowsMove(el, dir) {
    if (dir === 'up' || dir === 'down') {
      if (el.tagName !== 'TEXTAREA') return true;
      try {
        var v = el.value, p = el.selectionStart;
        if (dir === 'up') return v.lastIndexOf('\n', p - 1) === -1;
        return v.indexOf('\n', p) === -1;
      } catch (e) { return true; }
    }
    try {
      var pos = el.selectionStart, end = el.selectionEnd;
      if (pos == null || !el.value) return true;
      if (dir === 'left') return pos === 0 && end === 0;
      return pos === el.value.length;
    } catch (e) { return true; }
  }

  /** Returns true if Back was consumed (otherwise the browser handles it: go back / exit). */
  function handleBack() {
    if (modalStack.length) { closeModal(); return true; }
    if (state.movingId) { stopMoving(); return true; }
    if (state.editMode) { setEditMode(false); return true; }
    if (state.view !== 'apps') { showView('apps'); return true; }
    var cur = current();
    if (cur && cur.classList.contains('tab')) { focusFirst(); return true; }
    return false;
  }

  function onKeyDown(e) {
    var k = e.keyCode || e.which;
    var t = e.target;
    var text = isTextField(t);

    if (player.open) { if (playerKey(k)) e.preventDefault(); return; }

    if (inArr(BACK_KEYS, k)) {
      if (text && k === 8) return; // Backspace deletes text inside fields
      if (text && k === 27) { t.blur(); focusEl(t); }
      if (handleBack()) e.preventDefault();
      return;
    }

    var dir = DIRS[k];
    if (dir) {
      if (state.movingId && !modalStack.length) { e.preventDefault(); moveTile(dir); return; }
      if (text && !caretAllowsMove(t, dir)) return; // let caret move inside the field
      e.preventDefault();
      move(dir);
      return;
    }

    if (k === K.ENTER) {
      if (state.movingId && !modalStack.length) { e.preventDefault(); stopMoving(); return; }
      var cur = current();
      if (!cur) { e.preventDefault(); focusFirst(); return; }
      // Buttons/inputs activate natively; anything else gets a synthetic click.
      if (cur.tagName !== 'BUTTON' && cur.tagName !== 'INPUT' && cur.tagName !== 'TEXTAREA') { e.preventDefault(); cur.click(); }
      // OK on an empty field is left alone so the TV can open its on-screen keyboard.
      // OK on a filled field submits / moves to the next field.
      if (cur.tagName === 'INPUT' && cur.value) {
        e.preventDefault();
        if (cur.id === 'media-url') playUrl();
        else if (cur.id === 'import-url') importFromUrl();
        else if (cur.id === 'ed-name') focusEl($('ed-url'));
        else if (cur.id === 'ed-url' || cur.id === 'ed-icon') saveEditor();
      }
      return;
    }

    if (modalStack.length || text) return;

    // Colour buttons (also R/G/Y/B on a PC keyboard for testing)
    if (k === K.RED || k === 82) {
      var c = current();
      var id = c && c.classList.contains('tile') && c.getAttribute('data-id');
      if (id && id !== '__add') { e.preventDefault(); openActions(state.apps[findApp(id)]); }
      return;
    }
    if (k === K.GREEN || k === 71) { e.preventDefault(); openEditor(null); return; }
    if (k === K.YELLOW || k === 89) { e.preventDefault(); if (state.view !== 'apps') showView('apps'); setEditMode(!state.editMode); return; }
    if (k === K.BLUE || k === 66) { e.preventDefault(); showView('settings'); return; }

    // 1..9, 0 → quick-launch app 1..10
    if (k >= 48 && k <= 57 && state.view === 'apps' && !state.editMode) {
      var n = k === 48 ? 9 : k - 49;
      if (state.apps[n]) { e.preventDefault(); openApp(state.apps[n]); }
    }
  }

  function playUrl() {
    var url = normalizeUrl($('media-url').value);
    if (!url) { toast('Please enter a valid http(s) link'); return; }
    var name = decodeURIComponent((url.split('?')[0].split('/').pop()) || url) || url;
    state.media.push({ name: name, kind: kindOf(url, ''), src: url, blob: false });
    $('media-url').value = '';
    renderMedia();
    playerOpen(state.media.length - 1);
  }
  function importFromUrl() {
    var url = normalizeUrl($('import-url').value);
    if (!url) { toast('Please enter a valid link'); return; }
    toast('Downloading…');
    getJSON(url, function (d) { importData(d, 'the link'); }, toast);
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  function bind() {
    document.addEventListener('keydown', onKeyDown, true);

    qsa('.tab').forEach(function (t) {
      t.addEventListener('click', function () { showView(t.getAttribute('data-view'), true); });
    });
    // Focusing a tab with the remote switches to it (like most TV UIs).
    qsa('.tab').forEach(function (t) {
      t.addEventListener('focus', function () {
        var v = t.getAttribute('data-view');
        if (v !== state.view && !modalStack.length) showView(v, true);
      });
    });

    $('grid').addEventListener('click', function (e) {
      var el = e.target;
      while (el && el !== this && !(el.classList && el.classList.contains('tile'))) el = el.parentNode;
      if (el && el !== this) onTileClick(el);
    });
    $('btn-add').onclick = function () { openEditor(null); };
    $('btn-edit').onclick = function () { setEditMode(!state.editMode); };

    qsa('#modal-actions [data-act]').forEach(function (b) {
      b.onclick = function () { onAction(b.getAttribute('data-act')); };
    });
    $('ed-swatches').addEventListener('click', function (e) {
      var c = e.target.getAttribute && e.target.getAttribute('data-color');
      if (!c) return;
      editColor = c;
      qsa('.swatch', this).forEach(function (s) { s.classList.toggle('selected', s.getAttribute('data-color') === c); });
    });
    $('ed-save').onclick = saveEditor;
    $('ed-cancel').onclick = closeModal;
    $('ed-delete').onclick = function () { var a = editing; closeModal(); if (a) deleteApp(a); };
    qsa('.modal-backdrop').forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    });

    // Media
    $('btn-pick').onclick = function () { $('file-input').click(); };
    $('file-input').onchange = function () { addFiles(this.files || []); this.value = ''; };
    $('btn-clear-media').onclick = function () {
      if (state.media.length) confirmBox('Clear media list?', '', clearMedia);
    };
    $('btn-play-url').onclick = playUrl;
    $('media-list').addEventListener('click', function (e) {
      var el = e.target;
      while (el && el !== this && !el.getAttribute('data-idx')) el = el.parentNode;
      if (el && el !== this) playerOpen(parseInt(el.getAttribute('data-idx'), 10));
    });
    var v = $('player-video');
    v.addEventListener('ended', function () { if (!playerLoad(player.idx + 1)) playerClose(); });
    v.addEventListener('error', function () {
      if (player.open && v.getAttribute('src')) toast('This file format is not supported by the TV browser');
    });
    $('player').addEventListener('click', function () { playerKey(K.ENTER); });

    // Settings
    $('set-open').onclick = function () {
      state.settings.openMode = state.settings.openMode === 'new' ? 'same' : 'new'; save(); renderSettings();
    };
    $('set-icons').onclick = function () { state.settings.icons = !state.settings.icons; save(); renderSettings(); renderGrid(); };
    $('set-clock').onclick = function () { state.settings.clock = !state.settings.clock; save(); renderSettings(); };
    $('set-load-json').onclick = function () {
      toast('Loading apps.json…');
      getJSON('apps.json', function (d) { importData(d, 'apps.json'); }, toast);
    };
    $('set-import-url').onclick = importFromUrl;
    $('set-export').onclick = function () { $('json-box').value = exportJson(); toast('Backup shown. Copy it somewhere safe.'); };
    $('set-import').onclick = function () {
      var raw = $('json-box').value;
      if (!raw.replace(/\s/g, '')) { toast('Paste a JSON app list first'); return; }
      try { importData(JSON.parse(raw), 'the pasted text'); } catch (e) { toast('That is not valid JSON'); }
    };
    $('set-reset').onclick = function () {
      confirmBox('Reset to default apps?', 'Your current app list will be replaced.', function () {
        getJSON('apps.json', function (d) {
          replaceApps(sanitizeAppList(d) || builtInDefaults(), 'Reset to defaults');
        }, function () { replaceApps(builtInDefaults(), 'Reset to defaults'); });
      });
    };

    // Mouse users (e.g. TV pointer remotes): hovering moves focus.
    document.addEventListener('mouseover', function (e) {
      var el = e.target;
      while (el && el !== document && !(el.classList && el.classList.contains('f'))) el = el.parentNode;
      if (el && el !== document && el !== current() && !el.classList.contains('tab') &&
          !isTextField(current()) && focusables().indexOf(el) !== -1) {
        try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
      }
    });
    // Keep focus inside the UI if something steals it.
    window.addEventListener('focus', function () { setTimeout(function () { focusFirst(); }, 50); });
  }

  function start() {
    var had = load();
    bind();
    renderMedia();
    renderSettings();
    tickClock();
    setInterval(tickClock, 15000);

    function ready() {
      renderGrid();
      showView('apps');
    }
    if (had) ready();
    else {
      getJSON('apps.json', function (d) {
        state.apps = sanitizeAppList(d) || builtInDefaults(); save(); ready();
      }, function () { state.apps = builtInDefaults(); save(); ready(); });
    }
  }

  // Expose a few pure helpers for tests.
  window.VLTest = { normalizeUrl: normalizeUrl, sanitizeAppList: sanitizeAppList, kindOf: kindOf, fmtTime: fmtTime, state: state };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
