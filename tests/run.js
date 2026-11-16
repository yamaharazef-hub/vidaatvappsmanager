/* Test suite: node tests/run.js
   1. ES5 syntax check (older VIDAA browsers can't parse ES2015+)
   2. Spatial navigation unit tests
   3. jsdom smoke test of the full UI driven by remote-control key codes */
'use strict';
var fs = require('fs');
var path = require('path');
var http = require('http');
var assert = require('assert');
var acorn = require('acorn');
var JSDOM = require('jsdom').JSDOM;

var ROOT = path.join(__dirname, '..');
var passed = 0, failed = 0;
var queue = [];
function test(name, fn) { queue.push({ name: name, fn: fn }); }

// ---------------------------------------------------------------------------
test('all browser JS is valid ES5', function () {
  ['js/app.js', 'js/spatial.js', 'js/defaults.js'].forEach(function (f) {
    acorn.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'), { ecmaVersion: 5, sourceType: 'script' });
  });
});

test('apps.json is valid and matches js/defaults.js', function () {
  var json = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps.json'), 'utf8'));
  var sandbox = {};
  new Function('window', fs.readFileSync(path.join(ROOT, 'js/defaults.js'), 'utf8'))(sandbox);
  assert.deepStrictEqual(sandbox.VL_DEFAULTS, json.apps);
  json.apps.forEach(function (a) { assert.ok(/^https:\/\//.test(a.url), a.url); });
});

// ---------------------------------------------------------------------------
var S = require('../js/spatial.js');
function R(l, t, w, h) { return { left: l, top: t, right: l + (w || 100), bottom: t + (h || 100) }; }

test('spatial: moves within a grid row and column', function () {
  var grid = [R(0, 0), R(120, 0), R(240, 0), R(0, 120), R(120, 120), R(240, 120)];
  assert.strictEqual(S.findBest(grid[0], grid, 'right'), 1);
  assert.strictEqual(S.findBest(grid[1], grid, 'left'), 0);
  assert.strictEqual(S.findBest(grid[1], grid, 'down'), 4);
  assert.strictEqual(S.findBest(grid[5], grid, 'up'), 2);
  assert.strictEqual(S.findBest(grid[0], grid, 'left'), -1);
  assert.strictEqual(S.findBest(grid[0], grid, 'up'), -1);
});

test('spatial: down from a short last row picks the nearest item', function () {
  var rects = [R(0, 0), R(120, 0), R(240, 0), R(360, 0), R(0, 120)];
  assert.strictEqual(S.findBest(rects[3], rects, 'down'), 4);
});

test('spatial: prefers aligned items over closer diagonal ones', function () {
  var from = R(0, 0, 100, 40);
  var rects = [from, R(110, 200, 100, 40) /* far diag */, R(400, 0, 100, 40) /* same row */];
  assert.strictEqual(S.findBest(from, rects, 'right'), 2);
});

test('spatial: up from a wide toolbar lands on the horizontally closest item', function () {
  var tabs = [R(600, 0, 140, 40), R(760, 0, 140, 40), R(920, 0, 140, 40)];
  var from = R(1600, 100, 200, 40);
  assert.strictEqual(S.findBest(from, tabs.concat([from]), 'up'), 2);
});

// ---------------------------------------------------------------------------
// jsdom harness with a fake layout engine (jsdom has no layout)
function serve(cb) {
  var types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
  var srv = http.createServer(function (req, res) {
    var p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (p.slice(-1) === '/') p += 'index.html';
    if (p.indexOf(ROOT) !== 0 || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  srv.listen(0, '127.0.0.1', function () { cb(srv, 'http://127.0.0.1:' + srv.address().port + '/'); });
}

function installFakeLayout(window) {
  var proto = window.HTMLElement.prototype;
  function hidden(el) {
    for (var n = el; n && n.classList; n = n.parentNode) if (n.classList.contains('hidden')) return true;
    return false;
  }
  Object.defineProperty(proto, 'offsetParent', { get: function () { return hidden(this) ? null : this.parentNode; } });
  window.Element.prototype.getBoundingClientRect = function () {
    var el = this, l, t, w = 100, h = 40;
    if (hidden(el)) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    if (el.classList.contains('tile')) {
      var i = Array.prototype.indexOf.call(el.parentNode.children, el);
      l = (i % 6) * 200; t = 200 + Math.floor(i / 6) * 200; w = h = 180;
    } else if (el.classList.contains('tab')) {
      l = 600 + Array.prototype.indexOf.call(el.parentNode.children, el) * 160; t = 0;
    } else {
      var all = Array.prototype.slice.call(window.document.querySelectorAll('*'));
      l = 0; t = 1000 + all.indexOf(el) * 50;
    }
    return { left: l, top: t, right: l + w, bottom: t + h, width: w, height: h };
  };
  window.open = function () { return {}; };
}

function load(url, storage, cb) {
  var dom;
  JSDOM.fromURL(url, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse: function (window) {
      installFakeLayout(window);
      if (storage) window.localStorage.setItem('vidaaLauncher.v1', storage);
    }
  }).then(function (d) {
    dom = d;
    var tries = 0;
    (function wait() {
      if (d.window.document.querySelectorAll('#grid .tile').length || tries++ > 100) return cb(d);
      setTimeout(wait, 20);
    })();
  }).catch(function (e) { cb(null, e); });
}

function key(window, code) {
  var target = window.document.activeElement || window.document.body;
  var ev = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'keyCode', { get: function () { return code; } });
  target.dispatchEvent(ev);
  return ev.defaultPrevented;
}

var BASE;
test('UI: first run loads apps.json and focuses the first tile', function (done) {
  load(BASE, null, function (d, err) {
    if (err) throw err;
    var w = d.window, doc = w.document;
    var tiles = doc.querySelectorAll('#grid .tile');
    assert.strictEqual(tiles.length, 11); // 10 apps + "Add app"
    assert.strictEqual(doc.activeElement, tiles[0]);
    assert.ok(w.localStorage.getItem('vidaaLauncher.v1'), 'saved to storage');
    // remote navigation
    key(w, 39); assert.strictEqual(doc.activeElement, tiles[1]);
    key(w, 40); assert.strictEqual(doc.activeElement.getAttribute('data-id'), tiles[7].getAttribute('data-id'));
    key(w, 38); key(w, 38);
    assert.ok(doc.activeElement.classList.contains('tab'), 'UP reaches tabs');
    assert.strictEqual(doc.activeElement.getAttribute('data-view'), 'apps', 'lands on the active tab');
    key(w, 39);
    assert.strictEqual(doc.activeElement.getAttribute('data-view'), 'media');
    assert.ok(!doc.getElementById('view-media').classList.contains('hidden'), 'focusing a tab switches view');
    assert.strictEqual(key(w, 8), true, 'BACK consumed: returns to Apps');
    assert.ok(!doc.getElementById('view-apps').classList.contains('hidden'));
    assert.ok(doc.activeElement.classList.contains('tile'), 'focus restored to a tile');
    d.window.close(); done();
  });
});

test('UI: add, edit, move and delete apps with the remote', function (done) {
  load(BASE, JSON.stringify({ apps: [
    { id: 'x1', name: 'One', url: 'https://one.example', color: '#dc2626' },
    { id: 'x2', name: 'Two', url: 'https://two.example', color: '#16a34a' },
    { id: 'x3', name: 'Three', url: 'https://three.example', color: '#2563eb' }
  ], settings: { openMode: 'same', icons: false, clock: true } }), function (d, err) {
    if (err) throw err;
    var w = d.window, doc = w.document, $ = function (id) { return doc.getElementById(id); };
    var stored = function () { return JSON.parse(w.localStorage.getItem('vidaaLauncher.v1')); };
    var names = function () { return stored().apps.map(function (a) { return a.name; }); };
    assert.strictEqual(doc.querySelectorAll('#grid img').length, 0, 'icons off');

    // GREEN → add app
    key(w, 404);
    assert.ok(!$('modal-editor').classList.contains('hidden'));
    assert.strictEqual(doc.activeElement, $('ed-name'));
    $('ed-name').value = 'Plex';
    $('ed-url').value = 'app.plex.tv';
    $('ed-save').click();
    assert.ok($('modal-editor').classList.contains('hidden'));
    assert.deepStrictEqual(names(), ['One', 'Two', 'Three', 'Plex']);
    assert.strictEqual(stored().apps[3].url, 'https://app.plex.tv');
    assert.strictEqual(doc.activeElement.textContent.indexOf('Plex') !== -1, true);

    // invalid URL is rejected
    key(w, 404);
    $('ed-url').value = 'javascript:alert(1)';
    $('ed-save').click();
    assert.ok(!$('modal-editor').classList.contains('hidden'), 'stays open');
    assert.strictEqual(key(w, 27), true); // BACK closes
    assert.ok($('modal-editor').classList.contains('hidden'));

    // RED on "Plex" → actions → Move to first
    key(w, 403);
    assert.ok(!$('modal-actions').classList.contains('hidden'));
    doc.querySelector('[data-act="first"]').click();
    assert.deepStrictEqual(names(), ['Plex', 'One', 'Two', 'Three']);

    // Move mode: move Plex right twice, OK to drop
    key(w, 403);
    doc.querySelector('[data-act="move"]').click();
    assert.ok(doc.querySelector('.tile.moving'));
    key(w, 39); key(w, 39); key(w, 13);
    assert.ok(!doc.querySelector('.tile.moving'));
    assert.deepStrictEqual(names(), ['One', 'Two', 'Plex', 'Three']);

    // Edit
    key(w, 403);
    doc.querySelector('[data-act="edit"]').click();
    assert.strictEqual($('ed-url').value, 'https://app.plex.tv');
    $('ed-name').value = 'Plex Media';
    doc.querySelectorAll('.swatch')[0].click();
    $('ed-save').click();
    assert.strictEqual(stored().apps[2].name, 'Plex Media');
    assert.strictEqual(stored().apps[2].color, '#dc2626');

    // Delete (confirm defaults to "No")
    key(w, 403);
    doc.querySelector('[data-act="delete"]').click();
    assert.strictEqual(doc.activeElement, $('confirm-no'));
    $('confirm-yes').click();
    assert.deepStrictEqual(names(), ['One', 'Two', 'Three']);

    // YELLOW toggles edit mode; BACK leaves it
    key(w, 405);
    assert.ok($('view-apps').classList.contains('editing'));
    key(w, 8);
    assert.ok(!$('view-apps').classList.contains('editing'));

    // BACK on the home screen is NOT consumed (lets the TV browser exit)
    assert.strictEqual(key(w, 8), false);

    // BLUE → settings, toggle open mode, export JSON
    key(w, 406);
    assert.ok(!$('view-settings').classList.contains('hidden'));
    $('set-open').click();
    assert.strictEqual(stored().settings.openMode, 'new');
    $('set-export').click();
    var exp = JSON.parse($('json-box').value);
    assert.strictEqual(exp.apps.length, 3);
    assert.ok(!('id' in exp.apps[0]), 'export has no internal ids');

    // Restore pasted JSON
    $('json-box').value = JSON.stringify([{ name: 'Only', url: 'only.example' }, { name: 'Bad', url: 'nope' }]);
    $('set-import').click();
    $('confirm-yes').click();
    assert.deepStrictEqual(names(), ['Only']);
    d.window.close(); done();
  });
});

test('UI: number keys quick-launch apps', function (done) {
  load(BASE, JSON.stringify({ apps: [
    { id: 'q1', name: 'A', url: 'https://a.example', color: '#dc2626' },
    { id: 'q2', name: 'B', url: 'https://b.example', color: '#dc2626' }
  ], settings: { openMode: 'new', icons: true, clock: true } }), function (d, err) {
    if (err) throw err;
    var w = d.window, opened = [];
    w.open = function (u) { opened.push(u); return {}; };
    assert.strictEqual(w.document.querySelectorAll('#grid img').length, 2, 'icons on');
    assert.strictEqual(key(w, 50), true); // "2"
    assert.strictEqual(key(w, 57), false); // "9" (no app 9)
    setTimeout(function () {
      assert.deepStrictEqual(opened, ['https://b.example']);
      d.window.close(); done();
    }, 300);
  });
});

test('UI: media list from link + player keys', function (done) {
  load(BASE, null, function (d, err) {
    if (err) throw err;
    var w = d.window, doc = w.document, $ = function (id) { return doc.getElementById(id); };
    var v = $('player-video');
    v.play = function () { this._paused = false; return { catch: function () {} }; };
    v.pause = function () { this._paused = true; };
    Object.defineProperty(v, 'paused', { get: function () { return this._paused !== false; } });
    v.load = function () {};
    doc.querySelector('.tab[data-view="media"]').focus();
    $('media-url').value = 'http://192.168.1.5:8000/movies/My%20Movie.mkv';
    $('btn-play-url').click();
    assert.ok(!$('player').classList.contains('hidden'));
    assert.strictEqual($('osd-title').textContent, 'My Movie.mkv');
    assert.strictEqual(v.paused, false);
    key(w, 13); assert.strictEqual(v.paused, true, 'OK pauses');
    key(w, 13); assert.strictEqual(v.paused, false, 'OK resumes');
    assert.strictEqual(key(w, 8), true);
    assert.ok($('player').classList.contains('hidden'), 'BACK closes player');
    assert.strictEqual(doc.querySelectorAll('.media-item').length, 1);
    assert.strictEqual(doc.activeElement, doc.querySelector('.media-item'));
    d.window.close(); done();
  });
});

test('helpers: URL normalising and media type detection', function (done) {
  load(BASE, null, function (d) {
    var T = d.window.VLTest;
    assert.strictEqual(T.normalizeUrl('youtube.com/tv'), 'https://youtube.com/tv');
    assert.strictEqual(T.normalizeUrl(' http://192.168.1.10:8096 '), 'http://192.168.1.10:8096');
    assert.strictEqual(T.normalizeUrl('javascript:alert(1)'), '');
    assert.strictEqual(T.normalizeUrl('ftp://x.example'), '');
    assert.strictEqual(T.normalizeUrl('hello world'), '');
    assert.strictEqual(T.normalizeUrl(''), '');
    assert.strictEqual(T.kindOf('a.MP3', ''), 'audio');
    assert.strictEqual(T.kindOf('a.jpeg', ''), 'image');
    assert.strictEqual(T.kindOf('a.bin', 'video/mp4'), 'video');
    assert.strictEqual(T.fmtTime(3725), '1:02:05');
    assert.strictEqual(T.fmtTime(65), '1:05');
    var list = T.sanitizeAppList({ apps: [{ url: 'x.example', color: 'red;}' }, { url: 'bad' }] });
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].name, 'x.example');
    assert.ok(/^#/.test(list[0].color), 'unsafe colour replaced');
    d.window.close(); done();
  });
});

// ---------------------------------------------------------------------------
serve(function (srv, base) {
  BASE = base;
  var i = 0;
  (function next() {
    if (i >= queue.length) {
      srv.close();
      console.log('\n' + passed + ' passed, ' + failed + ' failed');
      process.exit(failed ? 1 : 0);
    }
    var t = queue[i++], finished = false;
    function finish(err) {
      if (finished) return; finished = true;
      if (err) { failed++; console.log('  \u2717 ' + t.name + '\n    ' + (err.stack || err).toString().split('\n').filter(function (l) { return /run.js:/.test(l) || /Error/.test(l); }).slice(0, 3).join('\n    ')); }
      else { passed++; console.log('  \u2713 ' + t.name); }
      setImmediate(next);
    }
    var timer = setTimeout(function () { finish(new Error('timeout')); }, 8000);
    process.removeAllListeners('uncaughtException');
    process.on('uncaughtException', function (e) { clearTimeout(timer); finish(e); });
    try {
      if (t.fn.length) t.fn(function () { clearTimeout(timer); finish(); });
      else { t.fn(); clearTimeout(timer); finish(); }
    } catch (e) { clearTimeout(timer); finish(e); }
  })();
});
