/* Spatial navigation for TV remotes (arrow keys).
   Pure geometry, no DOM dependencies, so it can be unit-tested in Node.
   ES5 only, to support older VIDAA browser engines. */
(function (root) {
  'use strict';

  // How strongly sideways offset is penalised compared with forward distance.
  var ORTHO_WEIGHT = 3;
  var TOLERANCE = 2; // px of overlap still counted as "in that direction"

  function overlap(a1, a2, b1, b2) {
    return Math.min(a2, b2) - Math.max(a1, b1);
  }

  /**
   * Pick the best candidate rect in a direction.
   * @param {{left,top,right,bottom}} from   rect of the focused element
   * @param {Array<{left,top,right,bottom}>} rects candidate rects
   * @param {'left'|'right'|'up'|'down'} dir
   * @returns {number} index into rects, or -1 when nothing lies that way
   */
  function findBest(from, rects, dir) {
    var best = -1, bestScore = Infinity;
    var fcx = (from.left + from.right) / 2;
    var fcy = (from.top + from.bottom) / 2;

    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (!r || (r.left === from.left && r.top === from.top && r.right === from.right && r.bottom === from.bottom)) continue;
      var primary, ortho, ov;
      var cx = (r.left + r.right) / 2;
      var cy = (r.top + r.bottom) / 2;

      if (dir === 'right' || dir === 'left') {
        primary = dir === 'right' ? r.left - from.right : from.left - r.right;
        // centre must also be on the correct side (handles overlapping rects)
        if (dir === 'right' ? cx <= fcx : cx >= fcx) continue;
        ov = overlap(from.top, from.bottom, r.top, r.bottom);
        ortho = ov > 0 ? 0 : Math.abs(cy - fcy);
      } else {
        primary = dir === 'down' ? r.top - from.bottom : from.top - r.bottom;
        if (dir === 'down' ? cy <= fcy : cy >= fcy) continue;
        ov = overlap(from.left, from.right, r.left, r.right);
        // prefer the element whose centre is horizontally closest
        ortho = ov > 0 ? Math.abs(cx - fcx) / 4 : Math.abs(cx - fcx);
      }
      if (primary < -TOLERANCE) continue;
      if (primary < 0) primary = 0;

      var score = primary + ortho * ORTHO_WEIGHT;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  var api = { findBest: findBest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VLSpatial = api;
})(this);
