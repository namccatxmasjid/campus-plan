/* NAMCC parking + patio concept: a small self-contained WebGL2 walk-around.
   No libraries, no network. All settings come from window.NAMCC_CONFIG
   (the config block at the top of index.html).

   Site coordinates (feet): x = east along the south property line,
   y = north. World coordinates used for drawing: X = x, Y = up, Z = -y. */
(function () {
  'use strict';

  var C = window.NAMCC_CONFIG;
  var DEG = Math.PI / 180;
  var Q = (function () {
    var o = {};
    location.search.replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      o[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });
    return o;
  })();
  function qn(k, d) { return (k in Q && !isNaN(parseFloat(Q[k]))) ? parseFloat(Q[k]) : d; }

  /* ------------------------------------------------------------------ */
  /* small helpers                                                      */
  /* ------------------------------------------------------------------ */
  function hex(s) {
    s = s.replace('#', '');
    return [parseInt(s.substr(0, 2), 16) / 255, parseInt(s.substr(2, 2), 16) / 255, parseInt(s.substr(4, 2), 16) / 255];
  }
  function mul3(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
  function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function rngMake(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash2(ix, iy, seed) {
    var h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 362437) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, seed, period) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    var w = function (i) { return period ? ((i % period) + period) % period : i; };
    var a = hash2(w(ix), w(iy), seed), b = hash2(w(ix + 1), w(iy), seed);
    var c = hash2(w(ix), w(iy + 1), seed), d = hash2(w(ix + 1), w(iy + 1), seed);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  }
  function W(x, y, h) { return [x, h, -y]; }                 // site -> world
  function yawFor(dx, dy) { return Math.atan2(dx, -dy); }    // local +Z points along site (dx,dy)
  function polyArea(p) {
    var a = 0;
    for (var i = 0; i < p.length; i++) { var q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
    return a / 2;
  }
  function inPoly(p, x, y) {
    var c = false;
    for (var i = 0, j = p.length - 1; i < p.length; j = i++) {
      var xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }
  function inRect(r, x, y, m) { m = m || 0; return x > r[0] - m && x < r[2] + m && y > r[1] - m && y < r[3] + m; }
  function rectPoly(r) { return [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]; }

  function triangulate(pts) {
    var n = pts.length, idx = [], i;
    for (i = 0; i < n; i++) idx.push(i);
    if (polyArea(pts) < 0) idx.reverse();
    var out = [], guard = 0;
    function cr(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
    function inTri(p, a, b, c) { return cr(a, b, p) >= -1e-9 && cr(b, c, p) >= -1e-9 && cr(c, a, p) >= -1e-9; }
    while (idx.length > 3 && guard++ < 20000) {
      var found = false;
      for (i = 0; i < idx.length; i++) {
        var i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
        var a = pts[i0], b = pts[i1], c = pts[i2];
        if (cr(a, b, c) <= 1e-7) continue;
        var ok = true;
        for (var j = 0; j < idx.length; j++) {
          var k = idx[j];
          if (k === i0 || k === i1 || k === i2) continue;
          if (inTri(pts[k], a, b, c)) { ok = false; break; }
        }
        if (!ok) continue;
        out.push([i0, i1, i2]); idx.splice(i, 1); found = true; break;
      }
      if (!found) {
        var best = 0, bv = Infinity;       // drop the flattest corner and carry on
        for (i = 0; i < idx.length; i++) {
          var v = Math.abs(cr(pts[idx[(i + idx.length - 1) % idx.length]], pts[idx[i]], pts[idx[(i + 1) % idx.length]]));
          if (v < bv) { bv = v; best = i; }
        }
        idx.splice(best, 1);
      }
    }
    if (idx.length === 3) out.push(idx.slice());
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* geometry builder (flat shaded triangles)                           */
  /* ------------------------------------------------------------------ */
  function Geo() { this.v = []; this.c = []; }
  Geo.prototype.raw = function (a, b, c, n, ca, cb, cc) {
    this.v.push(a[0], a[1], a[2], n[0], n[1], n[2], b[0], b[1], b[2], n[0], n[1], n[2], c[0], c[1], c[2], n[0], n[1], n[2]);
    var cs = [ca, cb, cc];
    for (var i = 0; i < 3; i++) {
      var k = cs[i];
      this.c.push(clamp(k[0], 0, 1) * 255, clamp(k[1], 0, 1) * 255, clamp(k[2], 0, 1) * 255, (k.length > 3 ? clamp(k[3], 0, 1) : 1) * 255);
    }
  };
  // triangle, auto-oriented so its normal agrees with "hint"
  Geo.prototype.tri = function (a, b, c, col, hint, cb, cc) {
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    var l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l;
    cb = cb || col; cc = cc || col;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) this.raw(a, c, b, [-nx, -ny, -nz], col, cc, cb);
    else this.raw(a, b, c, [nx, ny, nz], col, cb, cc);
  };
  Geo.prototype.quad = function (a, b, c, d, col, hint, cols) {
    if (cols) { this.tri(a, b, c, cols[0], hint, cols[1], cols[2]); this.tri(a, c, d, cols[0], hint, cols[2], cols[3]); }
    else { this.tri(a, b, c, col, hint); this.tri(a, c, d, col, hint); }
  };
  // axis-aligned box in WORLD coordinates
  Geo.prototype.box = function (x0, y0, z0, x1, y1, z1, col, o) {
    o = o || {};
    var top = o.top || col, bot = o.bottom || mul3(col, 0.7);
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], top, [0, 1, 0]);
    if (!o.noBottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], bot, [0, -1, 0]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, [0, 0, 1]);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], col, [0, 0, -1]);
    this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], col, [1, 0, 0]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, [-1, 0, 0]);
  };
  // box given in SITE coordinates (x0,y0)-(x1,y1), heights h0-h1
  Geo.prototype.sbox = function (x0, y0, x1, y1, h0, h1, col, o) { this.box(x0, h0, -y1, x1, h1, -y0, col, o); };
  // extruded polygon (site coords): top face + side walls
  Geo.prototype.prism = function (pts, h0, h1, colTop, colSide, noTop) {
    var i, n = pts.length;
    if (!noTop) {
      var t = triangulate(pts);
      for (i = 0; i < t.length; i++) {
        this.tri(W(pts[t[i][0]][0], pts[t[i][0]][1], h1), W(pts[t[i][1]][0], pts[t[i][1]][1], h1), W(pts[t[i][2]][0], pts[t[i][2]][1], h1), colTop, [0, 1, 0]);
      }
    }
    if (h1 > h0 && colSide) {
      var s = polyArea(pts) < 0 ? -1 : 1;
      for (i = 0; i < n; i++) {
        var a = pts[i], b = pts[(i + 1) % n];
        var hint = [(b[1] - a[1]) * s, 0, (b[0] - a[0]) * s];   // outward, in world axes
        this.quad(W(a[0], a[1], h0), W(b[0], b[1], h0), W(b[0], b[1], h1), W(a[0], a[1], h1), colSide, hint);
      }
    }
  };
  // soft-edged flat rectangle (site coords), alpha fades to 0 across "f" feet
  Geo.prototype.softRect = function (x0, y0, x1, y1, h, f, alpha, col) {
    col = col || [0.04, 0.06, 0.05];
    var xs = [x0 - f, x0 + f, x1 - f, x1 + f], ys = [y0 - f, y0 + f, y1 - f, y1 + f];
    if (xs[2] < xs[1]) xs[1] = xs[2] = (x0 + x1) / 2;
    if (ys[2] < ys[1]) ys[1] = ys[2] = (y0 + y1) / 2;
    function al(i, j) { return (i === 1 || i === 2) && (j === 1 || j === 2) ? alpha : 0; }
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
      var cs = [[col[0], col[1], col[2], al(i, j)], [col[0], col[1], col[2], al(i + 1, j)], [col[0], col[1], col[2], al(i + 1, j + 1)], [col[0], col[1], col[2], al(i, j + 1)]];
      this.quad(W(xs[i], ys[j], h), W(xs[i + 1], ys[j], h), W(xs[i + 1], ys[j + 1], h), W(xs[i], ys[j + 1], h), null, [0, 1, 0], cs);
    }
  };
  // append another Geo, turned "deg" (counter-clockwise in plan) and moved to site (cx, cy), lifted by h
  Geo.prototype.add = function (o, cx, cy, deg, h) {
    var a = (deg || 0) * DEG, c = Math.cos(a), s = Math.sin(a), v = o.v, i;
    h = h || 0;
    for (i = 0; i < v.length; i += 6) {
      this.v.push(cx + v[i] * c + v[i + 2] * s, v[i + 1] + h, -cy - v[i] * s + v[i + 2] * c,
        v[i + 3] * c + v[i + 5] * s, v[i + 4], -v[i + 3] * s + v[i + 5] * c);
    }
    for (i = 0; i < o.c.length; i++) this.c.push(o.c[i]);
  };
  // simple pitched-roof building centred on the origin, ridge along x (use Geo.add to place it)
  function gableBlock(L, Wd, wallH, rise, wallCol, roofCol) {
    var g = new Geo(), x0 = -L / 2, x1 = L / 2, y0 = -Wd / 2, y1 = Wd / 2, ov = 1.2, th = 0.35, sl = rise / (Wd / 2), i;
    g.prism(rectPoly([x0, y0, x1, y1]), 0, wallH, wallCol, wallCol, true);
    [x0, x1].forEach(function (x, k) { g.tri(W(x, y0, wallH), W(x, y1, wallH), W(x, 0, wallH + rise), wallCol, [k ? 1 : -1, 0, 0]); });
    var soffit = mul3(roofCol, 0.72);
    [[y0 - ov, 1], [y1 + ov, -1]].forEach(function (e) {
      var he = wallH - sl * ov + th, hr = wallH + rise + th;
      var a = W(x0 - ov, e[0], he), b = W(x1 + ov, e[0], he), c = W(x1 + ov, 0, hr), d = W(x0 - ov, 0, hr);
      g.quad(a, b, c, d, roofCol, [0, 1, 0]);
      g.quad([a[0], a[1] - th, a[2]], [b[0], b[1] - th, b[2]], [c[0], c[1] - th, c[2]], [d[0], d[1] - th, d[2]], soffit, [0, -1, 0]);
      g.quad(a, b, [b[0], b[1] - th, b[2]], [a[0], a[1] - th, a[2]], soffit, [0, 0, e[1]]);
    });
    var glass = [0.2, 0.27, 0.32], trim = [0.93, 0.92, 0.88], n = Math.max(1, Math.floor(L / 11));
    for (i = 0; i < n; i++) {
      var cx = x0 + (i + 0.5) * L / n;
      [[y0, -1], [y1, 1]].forEach(function (s) {
        var b0 = s[0] - s[1] * 0.05, a1 = s[0] + s[1] * 0.08, a2 = s[0] + s[1] * 0.15;
        g.sbox(cx - 1.9, Math.min(b0, a1), cx + 1.9, Math.max(b0, a1), 2.7, 7.1, trim);
        g.sbox(cx - 1.6, Math.min(b0, a2), cx + 1.6, Math.max(b0, a2), 3, 6.8, glass);
      });
    }
    return g;
  }

  var ICO = (function () {
    var t = (1 + Math.sqrt(5)) / 2;
    var v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    v = v.map(function (p) { var l = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]); return [p[0] / l, p[1] / l, p[2] / l]; });
    var f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    return { v: v, f: f };
  })();
  Geo.prototype.blob = function (cx, cy, cz, rx, ry, rz, col, rnd, jit) {
    var vs = ICO.v.map(function (p) {
      var k = 1 + (rnd() - 0.5) * 2 * jit;
      return [cx + p[0] * rx * k, cy + p[1] * ry * k, cz + p[2] * rz * k];
    });
    for (var i = 0; i < ICO.f.length; i++) {
      var f = ICO.f[i], a = vs[f[0]], b = vs[f[1]], c = vs[f[2]];
      var hint = [(a[0] + b[0] + c[0]) / 3 - cx, (a[1] + b[1] + c[1]) / 3 - cy, (a[2] + b[2] + c[2]) / 3 - cz];
      var k2 = 0.9 + rnd() * 0.2;
      this.tri(a, b, c, [col[0] * k2, col[1] * k2, col[2] * k2, col.length > 3 ? col[3] : 1], hint);
    }
  };
  Geo.prototype.cyl = function (cx, cz, y0, y1, r0, r1, n, col) {
    for (var i = 0; i < n; i++) {
      var a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      var p0 = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0], p1 = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0];
      var p2 = [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1], p3 = [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1];
      this.quad(p0, p1, p2, p3, col, [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)]);
    }
  };

  /* ------------------------------------------------------------------ */
  /* site layout derived from the config                                */
  /* ------------------------------------------------------------------ */
  var S = C.site, PK = C.parking, PT = C.patio, HS = C.house, COL = {};
  Object.keys(C.colors).forEach(function (k) { COL[k] = hex(C.colors[k]); });

  var PAVE_H = 0.2;
  var bandDepth = PK.stallDepth + PK.aisleWidth;                     // south row + aisle
  var legW = 2 * PK.stallDepth + PK.aisleWidth;                      // 61 ft
  var patioR = [PT.x, PT.y, PT.x + PT.length, PT.y + PT.width];

  var houseRects = HS.blocks.map(function (b) { return b.rect; });
  if (HS.porch) houseRects.push(HS.porch);
  if (HS.woodBuilding && HS.woodBuilding.show) houseRects.push(HS.woodBuilding.rect);

  // --- stall rows -> pieces (runs of stalls) ---
  var pieces = [], stallCount = 0;
  PK.rows.forEach(function (r) {
    var ax = r.from[0], ay = r.from[1], bx = r.to[0], by = r.to[1];
    var L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L;
    var nx = r.side > 0 ? -uy : uy, ny = r.side > 0 ? ux : -ux;
    var runs = [[0, L, false]];
    if (r.avoidHouse) {
      var tmin = Infinity, tmax = -Infinity;
      for (var t = 0; t <= L; t += 0.1) {
        for (var d = 0; d <= PK.stallDepth; d += 1) {
          var px = ax + ux * t + nx * d, py = ay + uy * t + ny * d;
          for (var k = 0; k < houseRects.length; k++) {
            if (inRect(houseRects[k], px, py, HS.clearance)) { tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); }
          }
        }
      }
      if (tmin <= tmax) runs = [[0, tmin, false], [tmax, L, true]];
    }
    var left = r.maxStalls == null ? Infinity : r.maxStalls;
    runs.forEach(function (run) {
      var len = run[1] - run[0], n = Math.min(left, Math.floor(len / PK.stallWidth + 0.03));
      if (n < 1) return;
      left -= n;
      var used = n * PK.stallWidth, t0 = run[2] ? run[1] - used : run[0];
      pieces.push({ x: ax + ux * t0, y: ay + uy * t0, ux: ux, uy: uy, nx: nx, ny: ny, n: n, len: used, name: r.name });
      stallCount += n;
    });
  });

  // --- pavement polygons (site coords) ---
  var pavePolys = [];
  pavePolys.push(rectPoly([PK.leg.x0, PK.leg.y0, PK.leg.x0 + legW, PK.leg.y1]));
  pavePolys.push(rectPoly([PK.band.x0, 0, PK.band.x1, bandDepth]));
  pavePolys.push(C.driveway.outline);
  pieces.forEach(function (p) {
    var d = PK.stallDepth;
    pavePolys.push([[p.x, p.y], [p.x + p.ux * p.len, p.y + p.uy * p.len],
      [p.x + p.ux * p.len + p.nx * d, p.y + p.uy * p.len + p.ny * d], [p.x + p.nx * d, p.y + p.ny * d]]);
  });
  function onPavement(x, y) {
    for (var i = 0; i < pavePolys.length; i++) if (inPoly(pavePolys[i], x, y)) return true;
    return false;
  }

  // --- N Lamar Blvd frame ---
  var LA = S.lamarAngleDeg * DEG, lr = [Math.cos(LA), Math.sin(LA)], ln = [-Math.sin(LA), Math.cos(LA)];
  var CP = C.driveway.curbPoint;
  function R(s, t) { return [CP[0] + s * lr[0] + t * ln[0], CP[1] + s * lr[1] + t * ln[1]]; }
  function toRoad(x, y) { var dx = x - CP[0], dy = y - CP[1]; return [dx * lr[0] + dy * lr[1], dx * ln[0] + dy * ln[1]]; }
  var ROAD_W = 66;

  // --- patio columns and tables ---
  var colXs = [], colYs = [], columns = [], tables = [];
  (function () {
    var Lx = PT.length - 2 * PT.columnInset, Ly = PT.width - 2 * PT.columnInset;
    var nx = Math.max(1, Math.round(Lx / PT.columnSpacing)), ny = Math.max(1, Math.round(Ly / PT.columnSpacing));
    var i, j;
    for (i = 0; i <= nx; i++) colXs.push(PT.x + PT.columnInset + i * Lx / nx);
    for (j = 0; j <= ny; j++) colYs.push(PT.y + PT.columnInset + j * Ly / ny);
    for (i = 0; i <= nx; i++) for (j = 0; j <= ny; j++) columns.push([colXs[i], colYs[j]]);
    var hx = 2.75, hy = PT.tableLength / 2;
    for (j = 0; j < PT.tableRows; j++) for (i = 0; i < PT.tablesPerRow; i++) {
      var tx = PT.x + PT.columnInset + (i + 0.5) * Lx / PT.tablesPerRow;
      var ty = PT.y + PT.columnInset + (j + 0.5) * Ly / PT.tableRows;
      var hit = false;
      for (var k = 0; k < columns.length; k++) {
        if (Math.abs(tx - columns[k][0]) < hx + PT.columnSize / 2 + 0.2 && Math.abs(ty - columns[k][1]) < hy + PT.columnSize / 2 + 0.2) { hit = true; break; }
      }
      if (!hit) tables.push([tx, ty]);
    }
  })();

  // --- fence helper: x of the driveway fence at a given y ---
  var FR = C.fence.runs[2];
  function fenceX(y) { var t = (y - FR[0][1]) / (FR[1][1] - FR[0][1]); return FR[0][0] + (FR[1][0] - FR[0][0]) * t; }
  function eastX(y) { return S.eastLineX0 + S.eastLineSlope * y; }

  // --- existing campus (scenery; walkable only when walkWholeCampus is true) ---
  var CA = C.campus || null, NAV = C.navigation || {};
  var wholeCampus = C.walkWholeCampus === true || NAV.limitToNewLot === false;
  var navLimit = (Q.limit === '0' || Q.campus === '1') ? false : (Q.limit === '1' ? true : !wholeCampus);
  function withBB(p) {
    var bb = [Infinity, Infinity, -Infinity, -Infinity];
    p.forEach(function (q) { bb[0] = Math.min(bb[0], q[0]); bb[1] = Math.min(bb[1], q[1]); bb[2] = Math.max(bb[2], q[0]); bb[3] = Math.max(bb[3], q[1]); });
    p.bb = bb; return p;
  }
  function inAny(list, x, y) {
    for (var i = 0; i < list.length; i++) {
      var b = list[i].bb;
      if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && inPoly(list[i], x, y)) return true;
    }
    return false;
  }
  function rotRect(c, sz, deg) {
    var a = (deg || 0) * DEG, cs = Math.cos(a), sn = Math.sin(a), hx = sz[0] / 2, hy = sz[1] / 2;
    return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(function (p) { return [c[0] + p[0] * cs - p[1] * sn, c[1] + p[0] * sn + p[1] * cs]; });
  }
  var campusSolid = [], campusNoTrunk = [], campusHard = [], campusArea = null, courtGate = null;
  if (CA) {
    campusSolid.push(withBB(CA.masjid.hall.outline), withBB(CA.masjid.wing.outline));
    CA.buildings.forEach(function (b) { campusSolid.push(withBB(rotRect(b.center, b.size, b.angle))); });
    campusNoTrunk = campusSolid.concat([withBB(CA.garageDeck.outline), withBB(rectPoly(CA.basketball.apron)), withBB(rectPoly(CA.volleyball.sand))]);
    campusHard = campusNoTrunk.concat(CA.asphalt.map(withBB), CA.concrete.map(withBB));
    campusArea = withBB(CA.walkArea);
    courtGate = [CA.basketball.apron[1] + 5, CA.basketball.apron[1] + 11];     // gap in the east fence
  }

  // --- trees ---
  var trees = [];           // {x,y,r,far}
  (function () {
    var rnd = rngMake(C.trees.seed);
    function rectDist(r, x, y) {
      var dx = Math.max(r[0] - x, 0, x - r[2]), dy = Math.max(r[1] - y, 0, y - r[3]);
      return Math.hypot(dx, dy);
    }
    // largest canopy radius that keeps clear of the patio roof and the house (0 = no room)
    function roomFor(x, y, r) {
      var d = rectDist(patioR, x, y) - PT.roofOverhang;
      for (var h = 0; h < houseRects.length; h++) d = Math.min(d, rectDist(houseRects[h], x, y) - 1.5);
      return Math.min(r, (d - 1) / 1.16);
    }
    // trunk and most of the canopy stay off the pavement, the road and the sidewalk
    function clear(x, y, m) {
      for (var k = 0; k < 17; k++) {
        var a = k * Math.PI / 8;
        var px = k === 16 ? x : x + Math.cos(a) * m, py = k === 16 ? y : y + Math.sin(a) * m;
        if (onPavement(px, py)) return false;
        if (campusHard.length && inAny(campusHard, px, py)) return false;
        var rt = toRoad(px, py);
        if (rt[1] < 12 && rt[1] > -ROAD_W - 14) return false;
      }
      return true;
    }
    function spaced(x, y, r) {
      for (var i = 0; i < trees.length; i++) {
        var t = trees[i], d = Math.hypot(t.x - x, t.y - y);
        if (d < (t.r + r) * 0.62) return false;
      }
      return true;
    }
    C.trees.placed.forEach(function (p) {
      var r = roomFor(p[0], p[1], p[2]);
      if (r >= 6 && clear(p[0], p[1], r * 0.8 + 2)) trees.push({ x: p[0], y: p[1], r: r, far: false });
    });
    function scatter(count, rmin, rmax, far, sampler, onCampus) {
      var made = 0, tries = 0;
      while (made < count && tries++ < count * 60) {
        var p = sampler(), r = roomFor(p[0], p[1], lerp(rmin, rmax, rnd()));
        if (r < 6) continue;
        var m = far ? r * 0.55 + 3 : r * 0.8 + 2;
        if (!clear(p[0], p[1], m)) {                       // try a smaller tree before giving up
          r = Math.min(r, rmin * 0.8); m = far ? r * 0.55 + 3 : r * 0.8 + 2;
          if (r < 6 || !clear(p[0], p[1], m)) continue;
        }
        if (!spaced(p[0], p[1], r)) continue;
        // keep distant trees off our side of the fences
        if (far && p[0] > 0 && p[0] < eastX(p[1]) && p[1] > 0 && p[1] < S.northLimit) continue;
        if (far && !onCampus && campusArea && inAny([campusArea], p[0], p[1])) continue;
        trees.push({ x: p[0], y: p[1], r: r, far: !!far });
        made++;
      }
    }
    function runZone(z) {
      scatter(z.count, z.radius[0], z.radius[1], z.far, function () {
        return [lerp(z.rect[0], z.rect[2], rnd()), lerp(z.rect[1], z.rect[3], rnd())];
      }, z.onCampus);
    }
    C.trees.zones.forEach(function (z) { if (!z.late) runZone(z); });
    // surveyed campus trees: skip any that would stand in a building or court, trim canopies near walls
    if (CA) (CA.trees || []).forEach(function (p) {
      var r = roomFor(p[0], p[1], clamp(p[2], 6, 20) * 0.95), k, q;
      if (r < 5 || onPavement(p[0], p[1]) || inAny(campusNoTrunk, p[0], p[1])) return;
      for (k = 0; k < 8; k++) if (inAny(campusNoTrunk, p[0] + Math.cos(k * Math.PI / 4) * 4, p[1] + Math.sin(k * Math.PI / 4) * 4)) return;
      for (q = 6; q < r; q += 2) {
        for (k = 0; k < 12; k++) if (inAny(campusSolid, p[0] + Math.cos(k * Math.PI / 6) * q, p[1] + Math.sin(k * Math.PI / 6) * q)) break;
        if (k < 12) { r = q - 1; break; }
      }
      trees.push({ x: p[0], y: p[1], r: r, far: false, campus: true });
    });
    C.trees.zones.forEach(function (z) { if (z.late) runZone(z); });
    var al = C.trees.acrossLamar;
    if (al) scatter(al.count, al.radius[0], al.radius[1], true, function () {
      return R(lerp(-640, 640, rnd()), lerp(-ROAD_W - 22, -ROAD_W - 150, rnd()));
    });
  })();

  // --- colliders and walkable area ---
  var solidRects = [], solidCircles = [], solidPolys = campusSolid;
  houseRects.forEach(function (r) { solidRects.push([r[0] - 1.4, r[1] - 1.4, r[2] + 1.4, r[3] + 1.4]); });
  columns.forEach(function (c) { solidCircles.push([c[0], c[1], PT.columnSize / 2 + 1.1]); });
  tables.forEach(function (t) { solidRects.push([t[0] - 3.1, t[1] - PT.tableLength / 2 - 0.5, t[0] + 3.1, t[1] + PT.tableLength / 2 + 0.5]); });
  trees.forEach(function (t) { if (!t.far) solidCircles.push([t.x, t.y, t.r * 0.085 + 1.3]); });
  if (CA) (function () {
    var a = CA.basketball.apron, m = 1.2, s = CA.volleyball.sand, my = (s[1] + s[3]) / 2;
    solidRects.push([a[0] - m, a[1] - m, a[2] + m, a[1] + m], [a[0] - m, a[3] - m, a[2] + m, a[3] + m],
      [a[0] - m, a[1] - m, a[0] + m, a[3] + m], [a[2] - m, a[1] - m, a[2] + m, courtGate[0]], [a[2] - m, courtGate[1], a[2] + m, a[3] + m]);
    solidRects.push([s[0] - 1.5, my - 1, s[2] + 1.5, my + 1]);                 // volleyball net
  })();

  // The part of the property that was just bought: new lot, patio and driveway.
  function inNewLot(x, y) {
    if (y >= 1.5) return !(y > S.northLimit || x < 1.5 || x > eastX(y) + 3.5);
    var rt = toRoad(x, y);
    if (rt[1] > 1.4 && rt[1] < C.driveway.rowDepth + 1 && Math.abs(rt[0]) < 70) return true;   // sidewalk at the entrance
    if (rt[1] < 1.4) return false;
    if (y > FR[1][1] && x < fenceX(y) + 1.6) return false;
    // the whole driveway strip, grass beside the curves included, so nothing snags on the way through
    if (y > -398 && y < -4 && x > fenceX(y) + 1.6 && x < (y > -110 ? 345.5 : 376)) return true;
    var D = C.driveway.outline;
    return inPoly(D, x, y) || inPoly(D, x - 3, y) || inPoly(D, x - 6, y) || inPoly(D, x + 1.5, y);
  }
  // The existing campus. Only used when walkWholeCampus is true.
  function inCampus(x, y) {
    if (!CA) return false;
    var rt = toRoad(x, y), f = CA.ironFence, i;
    if (rt[1] < 1.4 || !inPoly(campusArea, x, y)) return false;
    if (f && Math.abs(rt[1] - f.setback) < 1.3) {
      for (i = 0; i < f.runs.length; i++) if (rt[0] > f.runs[i][0] - 1 && rt[0] < f.runs[i][1] + 1) return false;
    }
    return true;
  }
  function walkable(x, y) {
    var i;
    if (!(inNewLot(x, y) || (!navLimit && inCampus(x, y)))) return false;
    for (i = 0; i < solidRects.length; i++) if (inRect(solidRects[i], x, y, 0)) return false;
    for (i = 0; i < solidCircles.length; i++) {
      var c = solidCircles[i], dx = x - c[0], dy = y - c[1];
      if (dx * dx + dy * dy < c[2] * c[2]) return false;
    }
    for (i = 0; i < solidPolys.length; i++) {
      var p = solidPolys[i], b = p.bb;
      if (x < b[0] - 2 || x > b[2] + 2 || y < b[1] - 2 || y > b[3] + 2) continue;
      if (inPoly(p, x, y) || inPoly(p, x + 1.4, y) || inPoly(p, x - 1.4, y) || inPoly(p, x, y + 1.4) || inPoly(p, x, y - 1.4)) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* WebGL                                                              */
  /* ------------------------------------------------------------------ */
  var canvas = document.getElementById('view');
  var stage = document.getElementById('stage');
  var gl = canvas.getContext('webgl2', { antialias: !!C.kiosk.antialias, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance' });
  if (!gl) {
    var f = document.getElementById('fatal');
    f.style.display = 'flex';
    f.textContent = 'This screen needs WebGL 2 (hardware acceleration). Open chrome://gpu in Chromium to check that it is enabled.';
    return;
  }

  function shader(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs, attribs) {
    var p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    attribs.forEach(function (a, i) { gl.bindAttribLocation(p, i, a); });
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p: p, u: u };
  }

  var MAIN = program(
    '#version 300 es\n' +
    'in vec3 aPos; in vec3 aNor; in vec4 aCol; in vec4 iOff; in vec3 iScale; in vec3 iTint;\n' +
    'uniform mat4 uVP; uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSkyCol; uniform vec3 uGndCol;\n' +
    'out vec4 vCol; out vec3 vP;\n' +
    'void main(){\n' +
    '  float c=cos(iOff.w), s=sin(iOff.w);\n' +
    '  vec3 p=aPos*iScale; p=vec3(c*p.x+s*p.z, p.y, -s*p.x+c*p.z)+iOff.xyz;\n' +
    '  vec3 n=aNor/iScale; n=normalize(vec3(c*n.x+s*n.z, n.y, -s*n.x+c*n.z));\n' +
    '  vec3 amb=mix(uGndCol,uSkyCol,n.y*0.5+0.5);\n' +
    '  vec3 base=aCol.rgb*mix(vec3(1.0),iTint,aCol.a);\n' +
    '  vCol=vec4(base*(amb+uSunCol*max(dot(n,uSun),0.0)), aCol.a);\n' +
    '  vP=p; gl_Position=uVP*vec4(p,1.0);\n' +
    '}',
    '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec4 vCol; in vec3 vP; uniform vec3 uCam; uniform vec3 uFogCol; uniform float uFog2; uniform float uShadow;\n' +
    'out vec4 o;\n' +
    'void main(){\n' +
    '  vec3 d=vP-uCam; float f=exp(-uFog2*dot(d,d));\n' +
    '  if(uShadow>0.5) o=vec4(vCol.rgb, vCol.a*f);\n' +
    '  else o=vec4(mix(uFogCol,vCol.rgb,f),1.0);\n' +
    '}',
    ['aPos', 'aNor', 'aCol', 'iOff', 'iScale', 'iTint']);

  var SKY = program(
    '#version 300 es\n' +
    'in vec2 aPos; out vec2 vN; void main(){ vN=aPos; gl_Position=vec4(aPos,1.0,1.0); }',
    '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec2 vN; uniform mat4 uInv; uniform vec3 uCam; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uSun;\n' +
    'uniform sampler2D uCloud; uniform float uTime; uniform float uClouds; out vec4 o;\n' +
    'void main(){\n' +
    '  vec4 w=uInv*vec4(vN,1.0,1.0); vec3 d=normalize(w.xyz/w.w-uCam);\n' +
    '  float t=clamp(d.y,0.0,1.0);\n' +
    '  vec3 col=mix(uHor,uZen,pow(t,0.6));\n' +
    '  float s=max(dot(d,uSun),0.0); col+=vec3(1.0,0.93,0.78)*(pow(s,64.0)*0.55+pow(s,7.0)*0.10);\n' +
    '  if(uClouds>0.5 && d.y>0.015){\n' +
    '    vec2 uv=d.xz/(d.y+0.16)*0.085+vec2(uTime*0.0016,uTime*0.0005);\n' +
    '    float c=texture(uCloud,uv).r*0.62+texture(uCloud,uv*2.7+vec2(0.37,0.11)).r*0.38;\n' +
    '    c=smoothstep(0.50,0.74,c)*smoothstep(0.015,0.16,d.y);\n' +
    '    col=mix(col,vec3(1.0,1.0,0.99),c*0.9);\n' +
    '  }\n' +
    '  o=vec4(col,1.0);\n' +
    '}',
    ['aPos']);

  var triCount = 0;
  function makeMesh(geo, inst) {
    var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    var vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geo.v), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    var cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(geo.c), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 4, 0);
    var m = { vao: vao, count: geo.v.length / 6, inst: 0 };
    if (inst) {
      var ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(inst), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 40, 0); gl.vertexAttribDivisor(3, 1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 3, gl.FLOAT, false, 40, 16); gl.vertexAttribDivisor(4, 1);
      gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 3, gl.FLOAT, false, 40, 28); gl.vertexAttribDivisor(5, 1);
      m.inst = inst.length / 10; m.ib = ib;
    }
    gl.bindVertexArray(null);
    triCount += (m.count / 3) * (m.inst || 1);
    return m;
  }
  function drawMesh(m) {
    gl.bindVertexArray(m.vao);
    if (m.inst) gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, m.inst);
    else gl.drawArrays(gl.TRIANGLES, 0, m.count);
  }
  // instance record: world position, yaw, scale xyz, tint rgb
  function inst(arr, x, y, h, yaw, sx, sy, sz, tint) {
    tint = tint || [1, 1, 1];
    arr.push(x, h, -y, yaw, sx, sy, sz, tint[0], tint[1], tint[2]);
  }

  var opaque = [], decals = [], shadows = [], sheer = [];

  /* ------------------------------------------------------------------ */
  /* build the scene                                                    */
  /* ------------------------------------------------------------------ */
  var sunAz = C.sun.fromDeg * DEG, sunEl = C.sun.heightDeg * DEG;
  var sunSite = [Math.sin(sunAz), Math.cos(sunAz)];                       // toward the sun (plan)
  var SUN = [sunSite[0] * Math.cos(sunEl), Math.sin(sunEl), -sunSite[1] * Math.cos(sunEl)];
  var shOff = [-sunSite[0] / Math.tan(sunEl), -sunSite[1] / Math.tan(sunEl)]; // shadow shift per foot of height

  (function buildGround() {
    var g = new Geo(), x0 = -260, x1 = 960, y0 = -680, y1 = 420, st = 10;
    var patches = [[84, 82, 24], [112, 122, 20], [152, 92, 22], [150, 150, 18], [60, 152, 16], [262, 152, 18], [305, 58, 10]];
    function colAt(x, y) {
      var n = vnoise(x / 46, y / 46, 3) * 0.6 + vnoise(x / 13, y / 13, 7) * 0.4;
      var edge = Math.min(x - x0, x1 - x, y - y0, y1 - y) / 90;
      n = lerp(0.5, n, clamp(edge, 0, 1));
      var c = mix3(COL.grassA, COL.grassB, n);
      c = mul3(c, 0.88 + 0.24 * vnoise(x / 7, y / 7, 11));
      var d = 0;
      for (var i = 0; i < patches.length; i++) {
        var p = patches[i], q = Math.hypot(x - p[0], y - p[1]) / p[2];
        d = Math.max(d, (1 - smooth(q)) * (0.45 + 0.4 * vnoise(x / 9, y / 9, 5)));
      }
      if (d > 0) c = mix3(c, COL.dirt, clamp(d, 0, 0.8));
      return c;
    }
    for (var x = x0; x < x1; x += st) for (var y = y0; y < y1; y += st) {
      g.quad(W(x, y, 0), W(x + st, y, 0), W(x + st, y + st, 0), W(x, y + st, 0), null, [0, 1, 0],
        [colAt(x, y), colAt(x + st, y), colAt(x + st, y + st), colAt(x, y + st)]);
    }
    var far = mix3(COL.grassA, COL.grassB, 0.5), B = 9000;
    g.quad([-B, -0.25, B], [B, -0.25, B], [B, -0.25, -B], [-B, -0.25, -B], far, [0, 1, 0]);
    opaque.push(makeMesh(g));
  })();

  (function buildHardscape() {
    var g = new Geo(), side = mul3(COL.concrete, 0.8), i;
    pavePolys.forEach(function (p) {
      g.prism(p, 0, PAVE_H, COL.concrete, null);
      g.prism(p, 0, PAVE_H - 0.03, null, side, true);     // edge faces sit just under the surface so overlapping pieces show no seams
    });
    // landscaped islands with a concrete curb
    PK.islands.forEach(function (r) {
      g.sbox(r[0], r[1], r[2], r[3], 0, PAVE_H + 0.45, mul3(COL.concrete, 0.93), { noBottom: true });
      g.sbox(r[0] + 0.5, r[1] + 0.5, r[2] - 0.5, r[3] - 0.5, 0, PAVE_H + 0.5, mix3(COL.grassA, COL.grassB, 0.3), { noBottom: true });
    });
    // patio slab
    g.sbox(patioR[0], patioR[1], patioR[2], patioR[3], 0, PT.slabHeight, COL.slab, { noBottom: true });

    // N Lamar Blvd: asphalt, curbs, sidewalk
    function strip(s0, s1, t0, t1, h0, h1, top, sidec) { g.prism([R(s0, t0), R(s1, t0), R(s1, t1), R(s0, t1)], h0, h1, top, sidec); }
    strip(-1400, 1400, -ROAD_W, 0, 0, 0.06, COL.asphalt, null);
    var cc = mul3(COL.sidewalk, 0.9);
    strip(-1400, -11, 0, 0.7, 0, 0.55, cc, mul3(cc, 0.8));
    var gap = CA && CA.lamarEntrance;
    if (gap) { strip(11, gap[0], 0, 0.7, 0, 0.55, cc, mul3(cc, 0.8)); strip(gap[1], 1400, 0, 0.7, 0, 0.55, cc, mul3(cc, 0.8)); }
    else strip(11, 1400, 0, 0.7, 0, 0.55, cc, mul3(cc, 0.8));
    strip(-1400, 1400, -ROAD_W - 0.7, -ROAD_W, 0, 0.55, cc, mul3(cc, 0.8));
    strip(-1400, 1400, 2.5, 9.5, 0, PAVE_H, COL.sidewalk, mul3(COL.sidewalk, 0.8));
    opaque.push(makeMesh(g));

    // painted lines (drawn as decals so they never flicker against the concrete)
    var line = new Geo();
    line.quad([-0.5, 0, 0], [-0.5, 0, 1], [0.5, 0, 1], [0.5, 0, 0], [1, 1, 1], [0, 1, 0]);
    var arr = [], d = PK.stallDepth, lw = PK.lineWidth;
    pieces.forEach(function (p) {
      for (i = 0; i <= p.n; i++) {
        var t = i * PK.stallWidth;
        inst(arr, p.x + p.ux * t, p.y + p.uy * t, PAVE_H + 0.02, yawFor(p.nx, p.ny), lw, 1, d, COL.stallLine);
      }
    });
    // road markings: two solid yellow lines around the centre turn lane, white lane dashes
    var yaw = yawFor(lr[0], lr[1]);
    [-27, -39].forEach(function (t) { var a = R(-1400, t); inst(arr, a[0], a[1], 0.09, yaw, 0.45, 1, 2800, COL.roadYellow); });
    [-15.5, -50.5].forEach(function (t) {
      for (var s = -1400; s < 1400; s += 40) { var a = R(s, t); inst(arr, a[0], a[1], 0.09, yaw, 0.4, 1, 10, [0.93, 0.93, 0.9]); }
    });
    decals.push(makeMesh(line, arr));
  })();

  (function buildCampus() {
    if (!CA) return;
    var g = new Geo(), sh = new Geo(), sheerG = new Geo(), posts = [], lines = [], i;
    var asph = COL.campusAsphalt, walk = COL.sidewalk, iron = COL.ironFence, GLASS = [0.17, 0.24, 0.3];
    var grass = mix3(COL.grassA, COL.grassB, 0.3);
    var ub = new Geo(); ub.box(-0.5, 0, -0.5, 0.5, 1, 0.5, [1, 1, 1], { noBottom: true });
    var lineGeo = new Geo(); lineGeo.quad([-0.5, 0, 0], [-0.5, 0, 1], [0.5, 0, 1], [0.5, 0, 0], [1, 1, 1], [0, 1, 0]);
    function colOf(v, d) { return v ? (v.charAt(0) === '#' ? hex(v) : COL[v]) : COL[d]; }
    function ccw(p) { return polyArea(p) < 0 ? p.slice().reverse() : p; }
    function seg(ax, ay, bx, by, h, w, col) { inst(lines, ax, ay, h, yawFor(bx - ax, by - ay), w, 1, Math.hypot(bx - ax, by - ay), col); }
    function panel(a, b, h0, h1, col) { sheerG.quad(W(a[0], a[1], h0), W(b[0], b[1], h0), W(b[0], b[1], h1), W(a[0], a[1], h1), col, null); }
    function fenceRun(a, b, H, spacing, alpha) {
      var L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / spacing)), k;
      for (k = 0; k <= n; k++) inst(posts, lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n), 0, 0, 0.22, H, 0.22, iron);
      panel(a, b, 0.3, H - 0.1, [iron[0], iron[1], iron[2], alpha]);
      var f = new Geo(); f.sbox(0, -0.07, L, 0.07, H - 0.18, H, iron);
      g.add(f, a[0], a[1], Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG);
    }
    // soft shadow on the side of a footprint that faces away from the sun
    function edgeShadow(poly, H) {
      var ox = shOff[0] * H * 0.45, oy = shOff[1] * H * 0.45, n = poly.length, c0 = [0.04, 0.06, 0.05, 0.3], c1 = [0.04, 0.06, 0.05, 0];
      for (var k = 0; k < n; k++) {
        var a = poly[k], b = poly[(k + 1) % n];
        sh.quad(W(a[0], a[1], 0.2), W(b[0], b[1], 0.2), W(b[0] + ox, b[1] + oy, 0.2), W(a[0] + ox, a[1] + oy, 0.2), null, [0, 1, 0], [c0, c0, c1, c1]);
      }
    }

    // ---- paving ----
    CA.asphalt.forEach(function (p) { g.prism(p, 0, 0.1, asph, null); });
    CA.concrete.forEach(function (p) { g.prism(p, 0, 0.14, walk, mul3(walk, 0.8)); });
    (CA.islands || []).forEach(function (s) {
      var L = s[2] / 2, w = s[3] / 2, c = Math.min(w, L) * 0.6, f = new Geo(), curb = mul3(COL.concrete, 0.95);
      function oct(L2, w2, c2) { return [[-L2 + c2, -w2], [L2 - c2, -w2], [L2, -w2 + c2], [L2, w2 - c2], [L2 - c2, w2], [-L2 + c2, w2], [-L2, w2 - c2], [-L2, -w2 + c2]]; }
      f.prism(oct(L, w, c), 0, 0.6, curb, mul3(curb, 0.8));
      f.prism(oct(L - 0.6, w - 0.6, c * 0.9), 0, 0.68, grass, null);
      g.add(f, s[0], s[1], s[4] || 0);
    });

    // ---- masjid ----
    var M = CA.masjid, hall = ccw(M.hall.outline), wing = ccw(M.wing.outline);
    function archPanel(f, cx, w, h0, hs, depth, col) {
      var r = w / 2, n = 6, k;
      f.sbox(cx - r, -depth, cx + r, 0.05, h0, hs, col);
      for (k = 0; k < n; k++) {
        var a0 = k / n * Math.PI, a1 = (k + 1) / n * Math.PI;
        f.tri(W(cx, -depth, hs), W(cx + r * Math.cos(a0), -depth, hs + r * Math.sin(a0)), W(cx + r * Math.cos(a1), -depth, hs + r * Math.sin(a1)), col, [0, 0, 1]);
      }
    }
    // dress every outside wall: base band, cornice, windows, and stone piers on the south-facing fronts
    function facade(pts, H, tall) {
      var n = pts.length, door = [0.3, 0.22, 0.18], awning = mul3(COL.masjidStone, 0.55);
      for (var e = 0; e < n; e++) {
        var a = pts[e], b = pts[(e + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 4) continue;
        var f = new Geo(), south = -(b[0] - a[0]) / L < -0.55, k;
        f.sbox(0, -0.25, L, 0.05, 0, 3.4, COL.masjidBase);
        f.sbox(0, -0.3, L, 0.05, H - 2.3, H - 1.3, COL.trim);
        if (L >= 18) {
          var nb = Math.max(1, Math.round(L / (tall ? 15 : 14))), bw = L / nb, mid = Math.floor(nb / 2);
          for (k = 0; k < nb; k++) {
            var cx = (k + 0.5) * bw, isDoor = south && k === mid;
            if (tall) {
              archPanel(f, cx, 6.2, 19.4, 27, 0.08, COL.trim); archPanel(f, cx, 5, 20, 27, 0.16, GLASS);
              if (isDoor) {
                archPanel(f, cx, 8.4, 0, 9.4, 0.1, COL.trim); archPanel(f, cx, 7, 0, 9.4, 0.2, door);
                f.sbox(cx - 7, -5, cx + 7, 0.05, 14.4, 15, awning);
              } else {
                f.sbox(cx - 2.9, -0.08, cx + 2.9, 0.05, 4.6, 12.2, COL.trim); f.sbox(cx - 2.5, -0.16, cx + 2.5, 0.05, 5, 11.8, GLASS);
              }
            } else if (isDoor) {
              f.sbox(cx - 3.6, -0.1, cx + 3.6, 0.05, 0, 8.6, COL.trim); f.sbox(cx - 3.1, -0.2, cx + 3.1, 0.05, 0, 8.2, door);
              f.sbox(cx - 6, -4.5, cx + 6, 0.05, 9.6, 10.2, awning);
            } else {
              f.sbox(cx - 2.6, -0.08, cx + 2.6, 0.05, 3.8, 10.4, COL.trim); f.sbox(cx - 2.2, -0.16, cx + 2.2, 0.05, 4.2, 10, GLASS);
            }
          }
          if (south) for (k = 0; k <= nb; k++) {
            var px = clamp(k * bw, 2.2, L - 2.2);
            f.sbox(px - 2.2, -0.9, px + 2.2, 0.05, 0, H + (tall ? 2.5 : 1.5), COL.masjidStone);
          }
        }
        g.add(f, a[0], a[1], Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG);
      }
    }
    g.prism(wing, 0, M.wing.height, COL.masjidRoof, COL.masjidWall);
    g.prism(hall, 0, M.hall.height, COL.masjidRoof, COL.masjidWall);
    facade(wing, M.wing.height, false);
    facade(hall, M.hall.height, true);
    edgeShadow(wing, M.wing.height); edgeShadow(hall, M.hall.height);
    // dome on a short drum, with a gold finial
    (function () {
      var D = M.dome, R = D.radius, base = M.hall.height, hb = base + D.drumHeight, n = 16, m = 5, x = D.x, y = D.y, ii, jj;
      g.cyl(x, -y, base, hb, R * 0.96, R * 0.96, n, COL.trim);
      function P(th, ph) { return [x + R * Math.cos(ph) * Math.cos(th), hb + R * 1.08 * Math.sin(ph), -y + R * Math.cos(ph) * Math.sin(th)]; }
      for (ii = 0; ii < m; ii++) for (jj = 0; jj < n; jj++) {
        var p0 = ii / m * Math.PI / 2, p1 = (ii + 1) / m * Math.PI / 2, t0 = jj / n * 2 * Math.PI, t1 = (jj + 1) / n * 2 * Math.PI;
        var tm = (t0 + t1) / 2, pm = (p0 + p1) / 2, hint = [Math.cos(pm) * Math.cos(tm), Math.sin(pm), Math.cos(pm) * Math.sin(tm)];
        if (ii === m - 1) g.tri(P(t0, p0), P(t1, p0), P(tm, p1), COL.dome, hint);
        else g.quad(P(t0, p0), P(t1, p0), P(t1, p1), P(t0, p1), COL.dome, hint);
      }
      g.cyl(x, -y, hb + R * 1.08 - 0.2, hb + R * 1.08 + 3.4, 0.4, 0.12, 5, COL.domeGold);
    })();
    // roof-top air-conditioning units
    (function () {
      var rr = rngMake(77), ang = Math.atan2(hall[1][1] - hall[0][1], hall[1][0] - hall[0][0]) / DEG;
      function units(poly, H, count) {
        var bb = withBB(poly).bb, made = 0, tries = 0, k;
        while (made < count && tries++ < 500) {
          var x = lerp(bb[0], bb[2], rr()), y = lerp(bb[1], bb[3], rr()), ok = inPoly(poly, x, y);
          for (k = 0; ok && k < 8; k++) if (!inPoly(poly, x + Math.cos(k * Math.PI / 4) * 9, y + Math.sin(k * Math.PI / 4) * 9)) ok = false;
          if (!ok || Math.hypot(x - M.dome.x, y - M.dome.y) < M.dome.radius + 9) continue;
          if (poly === wing && inPoly(hall, x, y)) continue;
          var u = new Geo(); u.box(-2.6, 0, -1.8, 2.6, 2.6, 1.8, [0.74, 0.75, 0.76], { noBottom: true });
          g.add(u, x, y, ang, H); made++;
        }
      }
      units(hall, M.hall.height, 7); units(wing, M.wing.height, 6);
    })();

    // ---- parking garage top deck ----
    (function () {
      var D = CA.garageDeck, o = D.outline, n = o.length;
      g.prism(o, 0, 0.16, COL.slab, null);
      (D.wallEdges || []).forEach(function (e) {
        var a = o[e], b = o[(e + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), f = new Geo();
        f.sbox(0, -0.35, L, 0.35, 0, D.wallHeight, mul3(COL.concrete, 0.92));
        g.add(f, a[0], a[1], Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG);
      });
    })();

    // ---- smaller buildings ----
    CA.buildings.forEach(function (b, k) {
      var wh = b.wallHeight || 9, rs = b.roofRise || 5;
      g.add(gableBlock(b.size[0], b.size[1], wh, rs, colOf(b.wall, 'schoolWall'), colOf(b.roof, 'schoolRoof')), b.center[0], b.center[1], b.angle || 0);
      edgeShadow(campusSolid[k + 2], wh);
    });

    // ---- basketball court ----
    (function () {
      var B = CA.basketball, a = B.apron, sf = B.surface, ct = B.court, FH = B.fenceHeight || 10;
      var cx = (ct[0] + ct[2]) / 2, cy = (ct[1] + ct[3]) / 2, hl = 0.5, lw = 0.3, wht = [0.96, 0.96, 0.96];
      g.sbox(a[0], a[1], a[2], a[3], 0, 0.15, walk, { noBottom: true });
      g.sbox(sf[0], sf[1], sf[2], sf[3], 0, 0.3, COL.courtGreen, { noBottom: true });
      g.sbox(ct[0], ct[1], ct[2], ct[3], 0, 0.45, COL.courtBlue, { noBottom: true });
      function arc(x, y, r, a0, a1, n) {
        for (var k = 0; k < n; k++) {
          var p0 = a0 + (a1 - a0) * k / n, p1 = a0 + (a1 - a0) * (k + 1) / n;
          seg(x + Math.cos(p0) * r, y + Math.sin(p0) * r, x + Math.cos(p1) * r, y + Math.sin(p1) * r, hl, lw, wht);
        }
      }
      [[ct[1], 1], [ct[3], -1]].forEach(function (e) { seg(cx, e[0], cx, e[0] + e[1] * 19, 0.47, 12, COL.courtGreen); });   // painted keys
      seg(ct[0], ct[1], ct[2], ct[1], hl, lw, wht); seg(ct[0], ct[3], ct[2], ct[3], hl, lw, wht);
      seg(ct[0], ct[1], ct[0], ct[3], hl, lw, wht); seg(ct[2], ct[1], ct[2], ct[3], hl, lw, wht);
      seg(ct[0], cy, ct[2], cy, hl, lw, wht); arc(cx, cy, 6, 0, Math.PI * 2, 16);
      [[ct[1], 1], [ct[3], -1]].forEach(function (e) {
        var yb = e[0], d = e[1], yk = yb + d * 19, py = yb - d * 2.5, yo = yb + d * 3;
        seg(cx - 6, yb, cx - 6, yk, hl, lw, wht); seg(cx + 6, yb, cx + 6, yk, hl, lw, wht); seg(cx - 6, yk, cx + 6, yk, hl, lw, wht);
        arc(cx, yk, 6, d > 0 ? 0 : Math.PI, d > 0 ? Math.PI : Math.PI * 2, 8);
        arc(cx, yb + d * 4, 17.5, d > 0 ? 0.1 : Math.PI + 0.1, d > 0 ? Math.PI - 0.1 : Math.PI * 2 - 0.1, 14);
        // hoop: post, arm, backboard, rim
        g.sbox(cx - 0.3, py - 0.3, cx + 0.3, py + 0.3, 0, 11.2, iron);
        g.sbox(cx - 0.2, Math.min(py, yo), cx + 0.2, Math.max(py, yo), 10.8, 11.2, iron);
        g.sbox(cx - 3, yo - 0.1, cx + 3, yo + 0.1, 9.6, 13.2, [0.95, 0.95, 0.95]);
        g.sbox(cx - 0.8, Math.min(yo, yo + d * 1.7), cx + 0.8, Math.max(yo, yo + d * 1.7), 10.4, 10.52, [0.92, 0.42, 0.16]);
      });
      fenceRun([a[0], a[1]], [a[2], a[1]], FH, 10, 0.2); fenceRun([a[0], a[3]], [a[2], a[3]], FH, 10, 0.2);
      fenceRun([a[0], a[1]], [a[0], a[3]], FH, 10, 0.2);
      fenceRun([a[2], a[1]], [a[2], courtGate[0]], FH, 10, 0.2); fenceRun([a[2], courtGate[1]], [a[2], a[3]], FH, 10, 0.2);
    })();

    // ---- sand volleyball court ----
    (function () {
      var s = CA.volleyball.sand, NH = CA.volleyball.netHeight || 8, my = (s[1] + s[3]) / 2, wood = mul3(COL.fence, 0.85), b = 0.5;
      g.sbox(s[0], s[1], s[2], s[3], 0, 0.25, COL.sand, { noBottom: true });
      g.sbox(s[0] - b, s[1] - b, s[2] + b, s[1], 0, 0.7, wood, { noBottom: true }); g.sbox(s[0] - b, s[3], s[2] + b, s[3] + b, 0, 0.7, wood, { noBottom: true });
      g.sbox(s[0] - b, s[1], s[0], s[3], 0, 0.7, wood, { noBottom: true }); g.sbox(s[2], s[1], s[2] + b, s[3], 0, 0.7, wood, { noBottom: true });
      [s[0] - 1, s[2] + 1].forEach(function (x) { g.sbox(x - 0.18, my - 0.18, x + 0.18, my + 0.18, 0, NH + 0.4, iron); });
      panel([s[0] - 1, my], [s[2] + 1, my], NH - 3.2, NH, [0.97, 0.97, 0.97, 0.3]);
      g.sbox(s[0] - 1, my - 0.05, s[2] + 1, my + 0.05, NH - 0.12, NH + 0.06, [0.97, 0.97, 0.97]);
    })();

    // ---- iron fence along N Lamar Blvd ----
    if (CA.ironFence) CA.ironFence.runs.forEach(function (r) {
      fenceRun(R(r[0], CA.ironFence.setback), R(r[1], CA.ironFence.setback), CA.ironFence.height, 8, 0.18);
    });

    // ---- painted stall lines in the existing lot ----
    (CA.stallLines || []).forEach(function (r) {
      for (var k = 0; k < r.count; k++) {
        var x = r.start[0] + k * r.step[0], y = r.start[1] + k * r.step[1];
        seg(x, y, x + r.line[0], y + r.line[1], 0.12, 0.33, COL.campusLine);
      }
    });

    opaque.push(makeMesh(g));
    opaque.push(makeMesh(ub, posts));
    decals.push(makeMesh(lineGeo, lines));
    shadows.push(makeMesh(sh));
    sheer.push(makeMesh(sheerG));
  })();

  (function buildPatio() {
    var slab = PT.slabHeight, eave = slab + PT.eaveHeight, ov = PT.roofOverhang, th = 0.7;
    var cy = PT.y + PT.width / 2, half = PT.width / 2, slope = PT.roofRise / half;
    function roofH(y) { return eave + PT.roofRise - slope * Math.abs(y - cy); }      // top surface
    var g = new Geo(), x0 = patioR[0] - ov, x1 = patioR[2] + ov, ys = patioR[1] - ov, yn = patioR[3] + ov;
    var top = COL.roof, under = COL.roofUnder, fascia = mul3(COL.roof, 0.72);
    if (Q.noroof !== '1') [[ys, cy], [cy, yn]].forEach(function (pr) {
      var a = pr[0], b = pr[1];
      g.quad(W(x0, a, roofH(a)), W(x1, a, roofH(a)), W(x1, b, roofH(b)), W(x0, b, roofH(b)), top, [0, 1, 0]);
      g.quad(W(x0, a, roofH(a) - th), W(x1, a, roofH(a) - th), W(x1, b, roofH(b) - th), W(x0, b, roofH(b) - th), under, [0, -1, 0]);
      // gable-end fascia on the west and east edges
      g.quad(W(x0, a, roofH(a) - th), W(x0, b, roofH(b) - th), W(x0, b, roofH(b)), W(x0, a, roofH(a)), fascia, [-1, 0, 0]);
      g.quad(W(x1, a, roofH(a) - th), W(x1, b, roofH(b) - th), W(x1, b, roofH(b)), W(x1, a, roofH(a)), fascia, [1, 0, 0]);
    });
    if (Q.noroof !== '1') {
      g.quad(W(x0, ys, roofH(ys) - th), W(x1, ys, roofH(ys) - th), W(x1, ys, roofH(ys)), W(x0, ys, roofH(ys)), fascia, [0, 0, 1]);
      g.quad(W(x0, yn, roofH(yn) - th), W(x1, yn, roofH(yn) - th), W(x1, yn, roofH(yn)), W(x0, yn, roofH(yn)), fascia, [0, 0, -1]);
    }
    // a beam along the top of each column row
    var beam = mul3(COL.column, 1.15);
    colYs.forEach(function (y) {
      var h = roofH(y) - th - slope * 0.4;
      g.sbox(colXs[0] - 0.5, y - 0.3, colXs[colXs.length - 1] + 0.5, y + 0.3, h - 0.9, h, beam);
    });
    opaque.push(makeMesh(g));

    // columns (instanced)
    var cg = new Geo(); cg.box(-0.5, 0, -0.5, 0.5, 1, 0.5, [1, 1, 1], { noBottom: true });
    var ca = [];
    columns.forEach(function (c) {
      inst(ca, c[0], c[1], slab, 0, PT.columnSize, roofH(c[1]) - th - slope * 0.4 - 0.9 - slab, PT.columnSize, COL.column);
    });
    opaque.push(makeMesh(cg, ca));

    // picnic tables (instanced)
    var tg = new Geo(), wood = [1, 1, 1], dark = [0.62, 0.6, 0.58], L = PT.tableLength / 2;
    tg.box(-1.25, 2.42, -L, 1.25, 2.58, L, wood);
    tg.box(-2.6, 1.38, -L, -1.75, 1.5, L, wood);
    tg.box(1.75, 1.38, -L, 2.6, 1.5, L, wood);
    [-L + 0.8, L - 0.8].forEach(function (z) {
      tg.box(-2.5, 1.1, z - 0.15, 2.5, 1.38, z + 0.15, dark);
      tg.box(-1.05, 0, z - 0.15, -0.75, 2.42, z + 0.15, dark, { noBottom: true });
      tg.box(0.75, 0, z - 0.15, 1.05, 2.42, z + 0.15, dark, { noBottom: true });
    });
    var ta = [], rnd = rngMake(5), sh = new Geo();
    tables.forEach(function (t) {
      inst(ta, t[0], t[1], slab, 0, 1, 1, 1, mul3(COL.table, 0.9 + rnd() * 0.2));
      sh.softRect(t[0] - 2.9, t[1] - L - 0.3, t[0] + 2.9, t[1] + L + 0.3, slab + 0.03, 0.9, 0.2);
    });
    if (tables.length) opaque.push(makeMesh(tg, ta));
    // shade under the roof, shifted a little away from the sun
    var dx = shOff[0] * PT.eaveHeight * 0.35, dy = shOff[1] * PT.eaveHeight * 0.35;
    sh.softRect(x0 + dx, ys + dy, x1 + dx, yn + dy, slab + 0.02, 5, 0.3);
    sh.softRect(x0 + dx - 4, ys + dy - 4, x1 + dx + 4, yn + dy + 4, 0.04, 6, 0.22);
    shadows.push(makeMesh(sh));
  })();

  (function buildHouse() {
    var g = new Geo(), sh = new Geo();
    var glass = [0.2, 0.27, 0.32];
    function gable(r, wallH, rise, ridge, wallCol, roofCol, details) {
      var x0 = r[0], y0 = r[1], x1 = r[2], y1 = r[3], ov = 1.4, th = 0.35;
      g.prism(rectPoly(r), 0, wallH, wallCol, wallCol, true);
      var soffit = mul3(COL.trim, 0.85), rc = roofCol;
      if (ridge === 'y') {
        var xm = (x0 + x1) / 2, sl = rise / (xm - x0);
        [y0, y1].forEach(function (y, i) { g.tri(W(x0, y, wallH), W(x1, y, wallH), W(xm, y, wallH + rise), wallCol, [0, 0, i ? -1 : 1]); });
        [[x0 - ov, -1], [x1 + ov, 1]].forEach(function (e) {
          var he = wallH - sl * ov + th, hr = wallH + rise + th;
          var a = W(e[0], y0 - ov, he), b = W(e[0], y1 + ov, he), c = W(xm, y1 + ov, hr), d = W(xm, y0 - ov, hr);
          g.quad(a, b, c, d, rc, [0, 1, 0]);
          g.quad([a[0], a[1] - th, a[2]], [b[0], b[1] - th, b[2]], [c[0], c[1] - th, c[2]], [d[0], d[1] - th, d[2]], soffit, [0, -1, 0]);
          g.quad(a, b, [b[0], b[1] - th, b[2]], [a[0], a[1] - th, a[2]], soffit, [e[1], 0, 0]);
        });
      } else {
        var ym = (y0 + y1) / 2, sl2 = rise / (ym - y0);
        [x0, x1].forEach(function (x, i) { g.tri(W(x, y0, wallH), W(x, y1, wallH), W(x, ym, wallH + rise), wallCol, [i ? 1 : -1, 0, 0]); });
        [[y0 - ov, 1], [y1 + ov, -1]].forEach(function (e) {
          var he = wallH - sl2 * ov + th, hr = wallH + rise + th;
          var a = W(x0 - ov, e[0], he), b = W(x1 + ov, e[0], he), c = W(x1 + ov, ym, hr), d = W(x0 - ov, ym, hr);
          g.quad(a, b, c, d, rc, [0, 1, 0]);
          g.quad([a[0], a[1] - th, a[2]], [b[0], b[1] - th, b[2]], [c[0], c[1] - th, c[2]], [d[0], d[1] - th, d[2]], soffit, [0, -1, 0]);
          g.quad(a, b, [b[0], b[1] - th, b[2]], [a[0], a[1] - th, a[2]], soffit, [0, 0, e[1]]);
        });
      }
      if (details) {
        // windows on every wall that faces outdoors
        var walls = [[x0, y0, x1, y0, 0, -1], [x1, y0, x1, y1, 1, 0], [x1, y1, x0, y1, 0, 1], [x0, y1, x0, y0, -1, 0]];
        walls.forEach(function (w) {
          var len = Math.hypot(w[2] - w[0], w[3] - w[1]), n = Math.floor(len / 11);
          for (var i = 0; i < n; i++) {
            var t = (i + 0.5) / n, cx = lerp(w[0], w[2], t), cy = lerp(w[1], w[3], t);
            var ox = cx + w[4] * 1.2, oy = cy + w[5] * 1.2, blocked = false;
            houseRects.forEach(function (o) { if (o !== r && inRect(o, ox, oy, 0.3)) blocked = true; });
            if (blocked) continue;
            var hw = 1.6, tx = Math.abs(w[5]) * hw, ty = Math.abs(w[4]) * hw, px = w[4] * 0.1, py = w[5] * 0.1;
            g.sbox(cx - tx - 0.3 * Math.abs(w[5]) + Math.min(0, px), cy - ty - 0.3 * Math.abs(w[4]) + Math.min(0, py),
              cx + tx + 0.3 * Math.abs(w[5]) + Math.max(0, px), cy + ty + 0.3 * Math.abs(w[4]) + Math.max(0, py), 2.9, 7.1, COL.trim);
            g.sbox(cx - tx + Math.min(0, px * 1.8), cy - ty + Math.min(0, py * 1.8), cx + tx + Math.max(0, px * 1.8), cy + ty + Math.max(0, py * 1.8), 3.2, 6.8, glass);
          }
        });
      }
      // soft shadow on the side away from the sun
      var dx = shOff[0] * wallH * 0.5, dy = shOff[1] * wallH * 0.5;
      sh.softRect(x0 + Math.min(0, dx) - 1, y0 + Math.min(0, dy) - 1, x1 + Math.max(0, dx) + 1, y1 + Math.max(0, dy) + 1, 0.05, 3.5, 0.3);
    }
    HS.blocks.forEach(function (b) {
      gable(b.rect, b.wallHeight || HS.wallHeight, b.roofRise || HS.roofRise, b.ridge, COL.stone, COL.houseRoof, true);
    });
    var m = HS.blocks[0].rect;
    // stone chimney on the west wall of the main block
    var chy = lerp(m[1], m[3], 0.45);
    g.sbox(m[0] - 2.2, chy - 1.8, m[0] + 0.3, chy + 1.8, 0, HS.wallHeight + HS.roofRise * 0.55 + 3, mul3(COL.stone, 0.82));
    if (HS.porch) {
      var p = HS.porch;
      g.sbox(p[0], p[1], p[2], p[3], 0, 0.4, COL.slab, { noBottom: true });
      g.sbox(p[0] - 0.6, p[1] - 0.8, p[2] + 0.6, p[3], 7.5, 7.9, COL.houseRoof, { bottom: mul3(COL.trim, 0.85) });
      [[p[0] + 0.4, p[1] + 0.4], [p[2] - 0.4, p[1] + 0.4]].forEach(function (q) {
        g.sbox(q[0] - 0.2, q[1] - 0.2, q[0] + 0.2, q[1] + 0.2, 0.4, 7.5, COL.trim);
      });
      // front door onto the porch
      var dxm = (p[0] + p[2]) / 2;
      g.sbox(dxm - 1.6, p[3] - 0.12, dxm + 1.6, p[3] + 0.05, 0.4, 7.2, COL.trim);
      g.sbox(dxm - 1.3, p[3] - 0.2, dxm + 1.3, p[3] + 0.05, 0.4, 6.9, [0.36, 0.25, 0.2]);
    }
    if (HS.woodBuilding && HS.woodBuilding.show) {
      gable(HS.woodBuilding.rect, 8.5, 4, 'x', COL.trim, mul3(COL.houseRoof, 0.9), true);
    }
    opaque.push(makeMesh(g));
    shadows.push(makeMesh(sh));
  })();

  (function buildFence() {
    var F = C.fence, pg = new Geo(), N = 14, rnd = rngMake(21), i;
    for (i = 0; i < N; i++) {
      var a = -0.5 + i / N, b = -0.5 + (i + 1) / N, k = 0.86 + rnd() * 0.24, h = i % 2 ? 0.985 : 1;
      var lo = [k * 0.8, k * 0.8, k * 0.8], hi = [k, k, k];
      pg.quad([a, 0, 0.5], [b, 0, 0.5], [b, h, 0.5], [a, h, 0.5], null, [0, 0, 1], [lo, lo, hi, hi]);
      pg.quad([a, 0, -0.5], [b, 0, -0.5], [b, h, -0.5], [a, h, -0.5], null, [0, 0, -1], [lo, lo, hi, hi]);
    }
    pg.quad([-0.5, 0.985, -0.5], [-0.5, 0.985, 0.5], [0.5, 0.985, 0.5], [0.5, 0.985, -0.5], [0.8, 0.8, 0.8], [0, 1, 0]);
    var post = new Geo(); post.box(-0.5, 0, -0.5, 0.5, 1, 0.5, [1, 1, 1], { noBottom: true });
    var pa = [], po = [], sh = new Geo(), dark = mul3(COL.fence, 0.72), r2 = rngMake(9);
    F.runs.forEach(function (run) {
      var ax = run[0][0], ay = run[0][1], bx = run[1][0], by = run[1][1];
      var L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(L / F.panelLength)), pl = L / n;
      var ux = (bx - ax) / L, uy = (by - ay) / L, yaw = Math.atan2(uy, ux);
      for (var k = 0; k < n; k++) {
        var cx = ax + ux * pl * (k + 0.5), cy = ay + uy * pl * (k + 0.5);
        inst(pa, cx, cy, 0, yaw, pl, F.height, 0.14, mul3(COL.fence, 0.92 + r2() * 0.16));
        inst(po, ax + ux * pl * k, ay + uy * pl * k, 0, yaw, 0.42, F.height + 0.3, 0.42, dark);
      }
      inst(po, bx, by, 0, yaw, 0.42, F.height + 0.3, 0.42, dark);
      // soft shadow strip on the side away from the sun
      var w = Math.abs(shOff[0] * -uy + shOff[1] * ux) * F.height;
      var sx = (shOff[0] * -uy + shOff[1] * ux) >= 0 ? -uy : uy, sy = (shOff[0] * -uy + shOff[1] * ux) >= 0 ? ux : -ux;
      if (w > 0.8) {
        var cs0 = [0.04, 0.06, 0.05, 0.3], cs1 = [0.04, 0.06, 0.05, 0];
        sh.quad(W(ax, ay, PAVE_H + 0.05), W(bx, by, PAVE_H + 0.05), W(bx + sx * w, by + sy * w, PAVE_H + 0.05), W(ax + sx * w, ay + sy * w, PAVE_H + 0.05),
          null, [0, 1, 0], [cs0, cs0, cs1, cs1]);
      }
    });
    opaque.push(makeMesh(pg, pa));
    opaque.push(makeMesh(post, po));
    shadows.push(makeMesh(sh));
  })();

  (function buildTrees() {
    var rnd = rngMake(C.trees.seed + 100);
    function trunk(g, n) { g.cyl(0, 0, 0, 1.05, 0.085, 0.055, n, [COL.trunk[0], COL.trunk[1], COL.trunk[2], 0]); }
    var W1 = [1, 1, 1, 1];
    var gA = new Geo(); trunk(gA, 6);
    gA.blob(0, 1.38, 0, 1.0, 0.6, 1.0, W1, rnd, 0.14);
    gA.blob(0.48, 1.16, 0.3, 0.7, 0.48, 0.7, [0.93, 0.93, 0.93, 1], rnd, 0.14);
    gA.blob(-0.42, 1.2, -0.36, 0.72, 0.5, 0.72, [0.96, 0.96, 0.96, 1], rnd, 0.14);
    var gB = new Geo(); trunk(gB, 6);
    gB.blob(0, 1.3, 0, 0.86, 0.7, 0.86, W1, rnd, 0.15);
    gB.blob(0.1, 1.86, 0.06, 0.56, 0.5, 0.56, [0.95, 0.95, 0.95, 1], rnd, 0.15);
    var gF = new Geo(); trunk(gF, 5);
    gF.blob(0, 1.34, 0, 1.0, 0.68, 1.0, W1, rnd, 0.16);
    var gF2 = new Geo(); trunk(gF2, 5);
    gF2.blob(0, 1.5, 0, 0.82, 0.92, 0.82, W1, rnd, 0.16);

    var disc = new Geo(), n = 10, i;
    for (i = 0; i < n; i++) {
      var a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      disc.tri([0, 0, 0], [Math.cos(a0), 0, Math.sin(a0)], [Math.cos(a1), 0, Math.sin(a1)], [0.04, 0.07, 0.04, 0.42], [0, 1, 0], [0.04, 0.07, 0.04, 0], [0.04, 0.07, 0.04, 0]);
    }
    var iA = [], iB = [], iF = [], iF2 = [], iS = [];
    var tints = [COL.treeA, COL.treeB, COL.treeC];
    trees.forEach(function (t) {
      var tint = mul3(mix3(tints[Math.floor(rnd() * 3)], tints[Math.floor(rnd() * 3)], rnd()), 0.88 + rnd() * 0.24);
      if (t.far) tint = mix3(tint, hex(C.colors.skyHorizon), 0.08);
      var yaw = rnd() * Math.PI * 2, tall = rnd() < 0.3;
      var hs = tall ? t.r * (1.25 + rnd() * 0.35) : t.r * (0.82 + rnd() * 0.28);
      var rr = tall ? t.r * 0.8 : t.r;
      if (t.far) inst(tall ? iF2 : iF, t.x, t.y, 0, yaw, rr, hs, rr, tint);
      else inst(tall ? iB : iA, t.x, t.y, 0, yaw, rr, hs, rr, tint);
      inst(iS, t.x + shOff[0] * hs * 0.55, t.y + shOff[1] * hs * 0.55, t.campus ? 0.24 : 0.04, 0, rr * 1.15, 1, rr * 1.15);
    });
    if (iA.length) opaque.push(makeMesh(gA, iA));
    if (iB.length) opaque.push(makeMesh(gB, iB));
    if (iF.length) opaque.push(makeMesh(gF, iF));
    if (iF2.length) opaque.push(makeMesh(gF2, iF2));
    shadows.push(makeMesh(disc, iS));
  })();

  // sky quad + cloud texture
  var skyVao = gl.createVertexArray();
  (function () {
    gl.bindVertexArray(skyVao);
    var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    var N = 128, data = new Uint8Array(N * N);
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var v = vnoise(x / 32, y / 32, 1, 4) * 0.5 + vnoise(x / 16, y / 16, 2, 8) * 0.28 + vnoise(x / 8, y / 8, 3, 16) * 0.15 + vnoise(x / 4, y / 4, 4, 32) * 0.07;
      data[y * N + x] = clamp(v, 0, 1) * 255;
    }
    var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, N, N, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  })();

  /* ------------------------------------------------------------------ */
  /* matrices                                                           */
  /* ------------------------------------------------------------------ */
  function perspective(fovy, asp, n, f) {
    var t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
    return o;
  }
  function ortho(l, r, b, t, n, f) {
    var o = new Float32Array(16);
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1;
    return o;
  }
  function lookDir(e, fwd, up) {
    var fx = fwd[0], fy = fwd[1], fz = fwd[2];
    var sx = fy * up[2] - fz * up[1], sy = fz * up[0] - fx * up[2], sz = fx * up[1] - fy * up[0];
    var l = Math.hypot(sx, sy, sz); sx /= l; sy /= l; sz /= l;
    var ux = sy * fz - sz * fy, uy = sz * fx - sx * fz, uz = sx * fy - sy * fx;
    var o = new Float32Array(16);
    o[0] = sx; o[4] = sy; o[8] = sz; o[12] = -(sx * e[0] + sy * e[1] + sz * e[2]);
    o[1] = ux; o[5] = uy; o[9] = uz; o[13] = -(ux * e[0] + uy * e[1] + uz * e[2]);
    o[2] = -fx; o[6] = -fy; o[10] = -fz; o[14] = fx * e[0] + fy * e[1] + fz * e[2];
    o[15] = 1;
    return o;
  }
  function mmul(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  function minv(m) {
    var o = new Float32Array(16),
      a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7],
      a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15],
      b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
      b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
      b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  }

  /* ------------------------------------------------------------------ */
  /* camera, modes, input                                               */
  /* ------------------------------------------------------------------ */
  var K = C.kiosk, V = C.views;
  var cam = { x: V.entrance.x, y: V.entrance.y, yaw: V.entrance.lookDeg * DEG, pitch: -2 * DEG, lift: PAVE_H };
  var orbit = { az: V.aerial.fromDeg * DEG, el: V.aerial.heightDeg * DEG, dist: V.aerial.distance, tx: V.aerial.targetX, ty: V.aerial.targetY };
  var mode = 'walk', trans = null, attract = false, topView = null;
  var lastInput = performance.now(), hintUntil = lastInput + 12000;
  var idleMs = qn('idle', K.idleSeconds) * 1000;
  var move = { fwd: false, back: false, left: false, right: false, sl: false, sr: false, tl: false, tr: false, run: false };

  function poseWalk() { return { e: [cam.x, K.eyeHeight + cam.lift, -cam.y], yaw: cam.yaw, pitch: cam.pitch }; }
  var small = window.matchMedia ? window.matchMedia('(max-width: 900px), (max-height: 600px)') : { matches: false };
  var aerialFit = 1;
  function fovY(asp) {                       // wider on portrait screens so the scene is not a narrow slot
    var f = K.fieldOfView * DEG, minH = (K.minHorizontalFov || 58) * DEG;
    if (2 * Math.atan(Math.tan(f / 2) * asp) < minH) f = Math.min(100 * DEG, 2 * Math.atan(Math.tan(minH / 2) / asp));
    return f;
  }
  function poseAerial() {
    var ce = Math.cos(orbit.el), dist = orbit.dist * aerialFit;
    return {
      e: [orbit.tx + dist * ce * Math.sin(orbit.az), dist * Math.sin(orbit.el), -(orbit.ty + dist * ce * Math.cos(orbit.az))],
      yaw: orbit.az + Math.PI, pitch: -orbit.el
    };
  }
  function currentPose() {
    if (trans) {
      var s = smooth(trans.t), a = trans.from, b = trans.to;
      var dy = b.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      return { e: [lerp(a.e[0], b.e[0], s), lerp(a.e[1], b.e[1], s), lerp(a.e[2], b.e[2], s)], yaw: a.yaw + dy * s, pitch: lerp(a.pitch, b.pitch, s) };
    }
    return mode === 'aerial' ? poseAerial() : poseWalk();
  }
  function fly(to, done) {
    var from = currentPose();
    var d = Math.hypot(to.e[0] - from.e[0], to.e[1] - from.e[1], to.e[2] - from.e[2]);
    trans = { from: from, to: to, t: 0, dur: clamp(d / 190, 1.2, 3.6), done: done };
  }
  function goAerial() {
    if (mode === 'aerial' && !trans) return;
    goal = null; orbit.el = V.aerial.heightDeg * DEG; orbit.dist = V.aerial.distance;
    mode = 'flying';
    fly(poseAerial(), function () { mode = 'aerial'; });
  }
  function goWalk() {
    mode = 'flying';
    fly(poseWalk(), function () { mode = 'walk'; });
  }
  function goEntrance() {
    cam.x = V.entrance.x; cam.y = V.entrance.y; cam.yaw = V.entrance.lookDeg * DEG; cam.pitch = -2 * DEG; cam.lift = PAVE_H;
    goal = null; vel[0] = vel[1] = 0;
    goWalk();
  }

  var elHint = document.getElementById('hint'), elAttract = document.getElementById('attract');
  var btnAerial = document.getElementById('btnAerial'), btnEntrance = document.getElementById('btnEntrance');
  function activity() {
    lastInput = performance.now();
    if (attract) { attract = false; hintUntil = lastInput + 9000; }
  }

  // drag to look (each finger tracked on its own, so walking and looking work together)
  var drags = {}, lastTap = null, goal = null, wheelPush = 0, vel = [0, 0];
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault(); activity();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    drags[e.pointerId] = [e.clientX, e.clientY, e.clientX, e.clientY, performance.now(), false];
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', function (e) {
    var d = drags[e.pointerId]; if (!d) return;
    var dx = e.clientX - d[0], dy = e.clientY - d[1]; d[0] = e.clientX; d[1] = e.clientY;
    if (Math.hypot(e.clientX - d[2], e.clientY - d[3]) > 12) d[5] = true;       // a real drag, not a tap
    activity();
    var k = K.dragSensitivity * DEG * (K.invertDrag ? -1 : 1);
    if (trans) return;
    if (mode === 'walk') {
      cam.yaw -= dx * k; cam.pitch = clamp(cam.pitch + dy * k, -55 * DEG, 55 * DEG);
    } else if (mode === 'aerial') {
      orbit.az -= dx * k; orbit.el = clamp(orbit.el + dy * k, 14 * DEG, 86 * DEG);
    }
  });
  function endDrag(e) {
    var d = drags[e.pointerId]; delete drags[e.pointerId];
    if (!Object.keys(drags).length) canvas.classList.remove('dragging');
    if (!d || e.type !== 'pointerup' || K.tapToGo === false) return;
    var now = performance.now();
    if (d[5] || now - d[4] > 400) return;                                       // drag or long press
    if (lastTap && now - lastTap[2] < 450 && Math.hypot(e.clientX - lastTap[0], e.clientY - lastTap[1]) < 45) {
      lastTap = null; goTo(e.clientX, e.clientY);                               // second tap: go there
    } else lastTap = [e.clientX, e.clientY, now];
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);

  // double-tap / double-click: glide to the spot under the finger (or drop in there from the aerial view)
  function groundAt(x, y) { return inRect(patioR, x, y, 0) ? PT.slabHeight : PAVE_H; }
  function nearestWalkable(x, y) {
    if (walkable(x, y)) return [x, y];
    for (var r = 3; r <= 600; r += 3) for (var k = 0; k < 32; k++) {
      var a = k * Math.PI / 16, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (walkable(px, py)) return [px, py];
    }
    return null;
  }
  function goTo(clientX, clientY) {
    if (trans || topView) return;
    var rc = canvas.getBoundingClientRect(), pose = currentPose(), e = pose.e;
    var nx = (clientX - rc.left) / rc.width * 2 - 1, ny = 1 - (clientY - rc.top) / rc.height * 2;
    var asp = rc.width / rc.height, tf = Math.tan(fovY(asp) / 2);
    var cp = Math.cos(pose.pitch), sp = Math.sin(pose.pitch), sy = Math.sin(pose.yaw), cw = Math.cos(pose.yaw);
    var dx = sy * cp + cw * nx * tf * asp - sy * sp * ny * tf;                  // ray through the tapped pixel
    var dv = sp + cp * ny * tf;
    var dz = -cw * cp + sy * nx * tf * asp + cw * sp * ny * tf;
    if (mode === 'aerial') {
      if (dv > -0.05) return;
      var t = (PAVE_H - e[1]) / dv, p = nearestWalkable(e[0] + dx * t, -(e[2] + dz * t));
      if (!p) return;
      cam.x = p[0]; cam.y = p[1]; cam.yaw = pose.yaw; cam.pitch = -3 * DEG; cam.lift = groundAt(p[0], p[1]);
      goal = null; vel[0] = vel[1] = 0; goWalk();
      return;
    }
    if (mode !== 'walk') return;
    var maxD = K.tapGoMaxDistance || 260, hl = Math.hypot(dx, dz) || 1e-6;
    var dist = dv < -0.02 ? Math.min(maxD, (e[1] - PAVE_H) / -dv * hl) : Math.min(maxD, 90);
    goal = { x: cam.x + dx / hl * dist, y: cam.y - dz / hl * dist, v: 0, vmax: clamp(dist / 1.3, 28, 130), stuck: 0, stall: 0 };
    wheelPush = 0;
  }

  function padStart() {
    activity();
    if (mode === 'aerial' && !trans) goWalk();
  }
  Array.prototype.forEach.call(document.querySelectorAll('.pad'), function (b) {
    var key = b.getAttribute('data-move');
    function on(e) {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      move[key] = true; b.classList.add('pressed'); padStart();
    }
    function off() { move[key] = false; b.classList.remove('pressed'); }
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('lostpointercapture', off);
  });
  function press(btn, fn) {
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault(); activity(); btn.classList.add('pressed'); fn();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { btn.addEventListener(n, function () { btn.classList.remove('pressed'); }); });
  }
  press(btnAerial, goAerial);
  press(btnEntrance, goEntrance);

  document.addEventListener('pointerdown', activity, true);     // a touch anywhere (banner too) counts
  canvas.addEventListener('webglcontextlost', function (e) {   // recover by itself if the GPU resets
    e.preventDefault(); setTimeout(function () { location.reload(); }, 1500);
  });

  var KEYS = { KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right', KeyA: 'sl', KeyD: 'sr',
    KeyQ: 'tl', KeyE: 'tr', ShiftLeft: 'run', ShiftRight: 'run' };
  window.addEventListener('keydown', function (e) {
    var k = KEYS[e.code]; if (!k) return;
    e.preventDefault(); if (!move[k] && k !== 'run') padStart(); move[k] = true;
  });
  window.addEventListener('keyup', function (e) { var k = KEYS[e.code]; if (k) move[k] = false; });
  window.addEventListener('blur', function () { for (var k in move) move[k] = false; });
  ['contextmenu', 'gesturestart', 'dblclick', 'selectstart', 'dragstart'].forEach(function (n) {
    document.addEventListener(n, function (e) { e.preventDefault(); });
  });
  document.addEventListener('wheel', function (e) {                // mouse wheel: step forward / back, or zoom the aerial view
    e.preventDefault(); activity();
    if (e.ctrlKey || trans || !e.deltaY) return;
    var dir = e.deltaY > 0 ? -1 : 1;
    if (mode === 'walk') { goal = null; wheelPush = clamp(wheelPush + dir * (K.mouseWheelStep || 9), -54, 54); }
    else if (mode === 'aerial') orbit.dist = clamp(orbit.dist * (dir > 0 ? 0.92 : 1.085), 180, 1100);
  }, { passive: false });
  // the pointer stays hidden for touch, and shows while a real mouse is in use
  var cursorTimer = 0;
  function hideCursor() { if (K.hideCursor && Q.ui !== '0') document.body.classList.add('nocursor'); }
  function showCursor() {
    document.body.classList.remove('nocursor'); clearTimeout(cursorTimer);
    cursorTimer = setTimeout(hideCursor, (K.mouseCursorSeconds || 20) * 1000);
  }
  ['pointermove', 'pointerdown'].forEach(function (n) {
    window.addEventListener(n, function (e) {
      if (e.pointerType === 'mouse') { if (K.showCursorForMouse !== false) showCursor(); }
      else { clearTimeout(cursorTimer); hideCursor(); }
    }, true);
  });
  document.addEventListener('touchmove', function (e) {            // the open info sheet on a phone may scroll
    if (!(document.body.classList.contains('info-open') && e.target.closest && e.target.closest('#banner'))) e.preventDefault();
  }, { passive: false });
  (function () {                                                    // phone / tablet: banner collapses to a bar with an Info button
    var t = document.getElementById('bToggle');
    if (!t) return;
    t.addEventListener('click', function () {
      var open = document.body.classList.toggle('info-open');
      t.textContent = open ? 'Close' : 'Info'; activity();
    });
  })();

  // move by (dx, dy) if nothing is in the way, sliding along whatever is; returns the distance moved
  function tryMove(dx, dy) {
    if (walkable(cam.x + dx, cam.y + dy)) { cam.x += dx; cam.y += dy; return Math.hypot(dx, dy); }
    if (dx && walkable(cam.x + dx, cam.y)) { cam.x += dx; return Math.abs(dx); }
    if (dy && walkable(cam.x, cam.y + dy)) { cam.y += dy; return Math.abs(dy); }
    return 0;
  }
  function stepWalk(dt) {
    var f = (move.fwd ? 1 : 0) - (move.back ? 1 : 0), s = (move.sr ? 1 : 0) - (move.sl ? 1 : 0);
    var side = (move.right ? 1 : 0) - (move.left ? 1 : 0), tx = 0, ty = 0;
    if (K.dpadSideButtons === 'turn') cam.yaw += side * 75 * DEG * dt; else s += side;
    cam.yaw += ((move.tr ? 1 : 0) - (move.tl ? 1 : 0)) * 75 * DEG * dt;
    if (f || s) {
      goal = null; wheelPush = 0;
      var l = Math.hypot(f, s), sp = K.walkSpeed * (move.run ? (K.runMultiplier || 1.6) : 1) / l;
      tx = (Math.sin(cam.yaw) * f + Math.cos(cam.yaw) * s) * sp;
      ty = (Math.cos(cam.yaw) * f - Math.sin(cam.yaw) * s) * sp;
    }
    var ease = Math.min(1, dt * 9);                                            // short ease in and out
    vel[0] += (tx - vel[0]) * ease; vel[1] += (ty - vel[1]) * ease;
    if (Math.abs(vel[0]) + Math.abs(vel[1]) > 0.05 && !tryMove(vel[0] * dt, vel[1] * dt)) vel[0] = vel[1] = 0;
    if (wheelPush) {                                                           // mouse wheel
      var st = (wheelPush > 0 ? 1 : -1) * Math.min(Math.abs(wheelPush), 48 * dt);
      wheelPush -= st;
      if (!tryMove(Math.sin(cam.yaw) * st, Math.cos(cam.yaw) * st)) wheelPush = 0;
    }
    if (goal && Q.hold !== '1') {                                              // double-tap destination (hold=1 is a test switch)
      var gx = goal.x - cam.x, gy = goal.y - cam.y, d = Math.hypot(gx, gy);
      if (d < 1.5) goal = null;
      else {
        goal.v += (Math.min(goal.vmax, d * 2.2 + 8) - goal.v) * Math.min(1, dt * 6);
        var stp = Math.min(d, goal.v * dt), mv = tryMove(gx / d * stp, gy / d * stp);
        var d2 = Math.hypot(goal.x - cam.x, goal.y - cam.y);
        goal.stuck = mv < stp * 0.3 ? goal.stuck + dt : 0;                     // blocked
        goal.stall = d2 > d - stp * 0.15 ? goal.stall + dt : 0;                // sliding but not getting closer
        if (goal.stuck > 0.3 || goal.stall > 0.6) goal = null;
      }
    }
    var target = groundAt(cam.x, cam.y);
    cam.lift += (target - cam.lift) * Math.min(1, dt * 8);
  }

  /* ------------------------------------------------------------------ */
  /* banner + labels                                                    */
  /* ------------------------------------------------------------------ */
  (function banner() {
    var B = C.banner;
    document.documentElement.style.setProperty('--banner-w', B.widthPercent + '%');
    document.getElementById('bEyebrow').textContent = B.eyebrow || '';
    document.getElementById('bTitle').textContent = B.title || '';
    var m = document.getElementById('bMessage');
    (B.message || []).forEach(function (t) { var p = document.createElement('p'); p.textContent = t; m.appendChild(p); });
    var facts = document.getElementById('bFacts');
    if (B.showFacts) {
      [[stallCount, 'new parking stalls'], [PT.length + "' x " + PT.width + "'", 'covered patio'], [tables.length, 'picnic tables']].forEach(function (f) {
        var li = document.createElement('li'), b = document.createElement('b'), s = document.createElement('span');
        b.textContent = f[0]; s.textContent = f[1]; li.appendChild(b); li.appendChild(s); facts.appendChild(li);
      });
    }
    var q = document.getElementById('bQr');
    if (B.qrImage) { var im = document.createElement('img'); im.src = B.qrImage; im.alt = ''; q.appendChild(im); q.classList.add('has-img'); }
    else {
      var r = rngMake(42), n = 21, s = '<svg viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges">';
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
        var eye = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13), on;
        if (eye) { var ex = x > 13 ? x - 14 : x, ey = y > 13 ? y - 14 : y; on = ex === 0 || ex === 6 || ey === 0 || ey === 6 || (ex > 1 && ex < 5 && ey > 1 && ey < 5); }
        else on = r() < 0.45;
        if (on) s += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="#0f3b2e" opacity="0.35"/>';
      }
      q.innerHTML = s + '</svg><div class="ph">QR CODE HERE</div>';
    }
    document.getElementById('bQrCap').textContent = B.qrCaption || '';
    document.getElementById('bFooter').textContent = B.footer || '';
    if (K.hideCursor && Q.ui !== '0') document.body.classList.add('nocursor');
    if (Q.ui === '0') document.body.classList.add('bare');
  })();

  var tags = [];
  (function () {
    if (!K.aerialLabels) return;
    var host = document.getElementById('labels');
    var hb = HS.blocks[0].rect, lm = R(-150, -ROAD_W / 2);
    [
      [PT.x + PT.length / 2, PT.y + PT.width / 2, PT.eaveHeight + PT.roofRise + 8, 'Covered community patio', PT.length + "' x " + PT.width + "'"],
      [PK.band.x0 + (PK.band.x1 - PK.band.x0) * 0.42, bandDepth / 2, 4, 'New parking', stallCount + ' stalls'],
      [(hb[0] + hb[2]) / 2, (hb[1] + hb[3]) / 2, 22, 'Existing house', 'stays'],
      [348, -250, 4, 'New driveway', 'to N Lamar Blvd'],
      [lm[0], lm[1], 4, 'N Lamar Blvd', '']
    ].concat(CA ? [
      [CA.masjid.dome.x + 25, CA.masjid.dome.y + 40, CA.masjid.hall.height + 22, 'Masjid', 'existing'],
      [(CA.basketball.court[0] + CA.basketball.court[2]) / 2, (CA.basketball.court[1] + CA.basketball.court[3]) / 2, 16, 'Basketball court', ''],
      [(CA.volleyball.sand[0] + CA.volleyball.sand[2]) / 2, (CA.volleyball.sand[1] + CA.volleyball.sand[3]) / 2, 14, 'Volleyball court', ''],
      [460, -245, 6, 'Existing parking', '']
    ] : []).forEach(function (t) {
      var d = document.createElement('div'); d.className = 'tag';
      d.textContent = t[3];
      if (t[4]) { var s = document.createElement('small'); s.textContent = t[4]; d.appendChild(s); }
      host.appendChild(d);
      tags.push({ el: d, p: W(t[0], t[1], t[2]) });
    });
  })();

  /* ------------------------------------------------------------------ */
  /* render loop                                                        */
  /* ------------------------------------------------------------------ */
  var renderScale = 1, fpsEma = 60, lowSince = 0, elFps = document.getElementById('fps');
  if (K.showFps || Q.fps === '1') elFps.style.display = 'block';
  function resize() {
    // the kiosk renders at pixel ratio 1; phones and tablets may go up to kiosk.mobilePixelRatio
    var pr = small.matches ? Math.min(window.devicePixelRatio || 1, K.mobilePixelRatio || 2) : 1;
    var cw = stage.clientWidth, ch = stage.clientHeight, asp = cw / Math.max(1, ch);
    var w = Math.max(2, Math.round(cw * renderScale * pr)), h = Math.max(2, Math.round(ch * renderScale * pr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    aerialFit = clamp(Math.tan(K.fieldOfView * DEG / 2) * 1.457 / (Math.tan(fovY(asp) / 2) * asp), 1, 1.2);   // keep the whole site in view
  }
  if (Q.view === 'top') topView = { cx: qn('cx', 170), cy: qn('cy', -130), ppf: qn('ppf', 1.5) };
  if (Q.view === 'aerial') { mode = 'aerial'; orbit.az = qn('az', V.aerial.fromDeg) * DEG; }
  if (Q.view === 'walk') { cam.x = qn('x', cam.x); cam.y = qn('y', cam.y); cam.yaw = qn('yaw', 0) * DEG; cam.pitch = qn('pitch', 0) * DEG; }

  var FOG = hex(C.colors.skyHorizon), ZEN = hex(C.colors.skyTop);
  var SUNCOL = [0.52, 0.49, 0.43], SKYAMB = [0.57, 0.61, 0.68], GNDAMB = [0.48, 0.47, 0.43];
  gl.vertexAttrib4f(3, 0, 0, 0, 0); gl.vertexAttrib3f(4, 1, 1, 1); gl.vertexAttrib3f(5, 1, 1, 1);

  // gold ring that shows where a double-tap is taking you
  var marker = (function () {
    var g = new Geo(), n = 24, c = [0.98, 0.82, 0.3, 0.95], c2 = [0.98, 0.82, 0.3, 0.22];
    function P(r, a) { return [Math.cos(a) * r, 0, Math.sin(a) * r]; }
    for (var k = 0; k < n; k++) {
      var a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2;
      g.quad(P(0.7, a0), P(0.7, a1), P(1, a1), P(1, a0), null, [0, 1, 0], [c, c, c, c]);
      g.tri([0, 0, 0], P(0.7, a0), P(0.7, a1), c2, [0, 1, 0]);
    }
    return makeMesh(g, [0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
  })();
  var markerData = new Float32Array(10);

  var tPrev = performance.now(), frames = 0, tClock = 0;
  function frame(now) {
    var dt = Math.min(0.25, (now - tPrev) / 1000); tPrev = now; tClock += dt; frames++;

    // idle -> aerial orbit
    if (!topView && Q.freeze !== '1') {
      if (!attract && now - lastInput > idleMs) { attract = true; if (mode !== 'aerial') goAerial(); }
      if (attract && mode === 'aerial' && !trans) orbit.az += Math.PI * 2 / K.orbitSecondsPerLap * dt;
    }
    if (trans) {
      trans.t += dt / trans.dur;
      if (trans.t >= 1) { var done = trans.done; trans = null; if (done) done(); }
    } else if (mode === 'walk') {
      for (var left = dt; left > 1e-4; left -= 0.05) stepWalk(Math.min(0.05, left));   // small steps keep collisions solid at any frame rate
    }

    resize();
    var w = canvas.width, h = canvas.height, pose = currentPose(), e = pose.e, vp, fog;
    gl.viewport(0, 0, w, h);
    if (topView) {
      var hw = w / 2 / topView.ppf, hh = h / 2 / topView.ppf;
      e = [topView.cx, 2000, -topView.cy];
      vp = mmul(ortho(-hw, hw, -hh, hh, 1, 4000), lookDir(e, [0, -1, 0], [0, 0, -1]));
      fog = 0;
    } else {
      var k = clamp((e[1] - K.eyeHeight) / 220, 0, 1);
      fog = lerp(C.fog.walk, C.fog.aerial, k);
      var cp = Math.cos(pose.pitch), fwd = [Math.sin(pose.yaw) * cp, Math.sin(pose.pitch), -Math.cos(pose.yaw) * cp];
      vp = mmul(perspective(fovY(w / h), w / h, lerp(0.6, 6, k), 9000), lookDir(e, fwd, [0, 1, 0]));
    }

    gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
    gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (!topView) {
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.depthMask(false);
      gl.useProgram(SKY.p);
      gl.uniformMatrix4fv(SKY.u.uInv, false, minv(vp));
      gl.uniform3fv(SKY.u.uCam, e); gl.uniform3fv(SKY.u.uZen, ZEN); gl.uniform3fv(SKY.u.uHor, FOG); gl.uniform3fv(SKY.u.uSun, SUN);
      gl.uniform1f(SKY.u.uTime, tClock); gl.uniform1f(SKY.u.uClouds, C.clouds ? 1 : 0); gl.uniform1i(SKY.u.uCloud, 0);
      gl.bindVertexArray(skyVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
    }

    gl.useProgram(MAIN.p);
    gl.uniformMatrix4fv(MAIN.u.uVP, false, vp);
    gl.uniform3fv(MAIN.u.uSun, SUN); gl.uniform3fv(MAIN.u.uSunCol, SUNCOL);
    gl.uniform3fv(MAIN.u.uSkyCol, SKYAMB); gl.uniform3fv(MAIN.u.uGndCol, GNDAMB);
    gl.uniform3fv(MAIN.u.uCam, e); gl.uniform3fv(MAIN.u.uFogCol, FOG); gl.uniform1f(MAIN.u.uFog2, fog * fog);
    gl.uniform1f(MAIN.u.uShadow, 0);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND);
    var i;
    for (i = 0; i < opaque.length; i++) drawMesh(opaque[i]);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -4);
    for (i = 0; i < decals.length; i++) drawMesh(decals[i]);
    gl.uniform1f(MAIN.u.uShadow, 1);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    if (Q.noshadow !== '1') for (i = 0; i < shadows.length; i++) drawMesh(shadows[i]);
    if (goal && mode === 'walk' && !trans) {
      var ms = 2.3 + 0.35 * Math.sin(tClock * 9);
      markerData.set([goal.x, groundAt(goal.x, goal.y) + 0.06, -goal.y, 0, ms, 1, ms, 1, 1, 1]);
      gl.bindBuffer(gl.ARRAY_BUFFER, marker.ib); gl.bufferSubData(gl.ARRAY_BUFFER, 0, markerData);
      drawMesh(marker);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.disable(gl.CULL_FACE);              // see-through fences and nets
    for (i = 0; i < sheer.length; i++) drawMesh(sheer[i]);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true); gl.disable(gl.BLEND);
    gl.bindVertexArray(null);

    // overlays
    var showTags = mode === 'aerial' && !trans && !topView, placed = [];
    for (i = 0; i < tags.length; i++) {
      var t = tags[i], p = t.p;
      var cx = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12], cy = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
      var cw = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
      t.vis = showTags && cw > 1;
      if (t.vis) {
        if (!t.w) { t.w = t.el.offsetWidth; t.h = t.el.offsetHeight; }
        t.sx = (cx / cw * 0.5 + 0.5) * stage.clientWidth; t.sy = (1 - (cy / cw * 0.5 + 0.5)) * stage.clientHeight;
        placed.push(t);
      }
      if (t.on !== t.vis) { t.on = t.vis; t.el.classList.toggle('on', t.vis); }
    }
    placed.sort(function (a, b) { return a.sy - b.sy; });
    for (i = 0; i < placed.length; i++) {            // nudge a tag down if it would cover another one
      var a = placed[i];
      for (var j = 0; j < i; j++) {
        var b = placed[j];
        if (Math.abs(a.sx - b.sx) < (a.w + b.w) / 2 + 8 && a.sy - a.h < b.sy + 6 && a.sy > b.sy - b.h - 6) a.sy = b.sy + a.h + 8;
      }
      a.el.style.transform = 'translate(' + a.sx.toFixed(1) + 'px,' + a.sy.toFixed(1) + 'px) translate(-50%,-100%)';
    }
    var hintOn = !attract && now < hintUntil && mode !== 'flying';
    if (elHint._on !== hintOn) { elHint._on = hintOn; elHint.classList.toggle('on', hintOn); }
    if (elHint._m !== mode) { elHint._m = mode; elHint.textContent = mode === 'aerial' ? 'Drag to turn the view. Double-tap a spot to walk there.' : 'Drag to look. Hold an arrow to walk. Double-tap a spot to go there.'; }
    if (elAttract._on !== attract) { elAttract._on = attract; elAttract.classList.toggle('on', attract); }
    var aer = mode === 'aerial';
    if (btnAerial._a !== aer) { btnAerial._a = aer; btnAerial.classList.toggle('active', aer); }

    // frame rate watchdog
    if (dt > 0) fpsEma = fpsEma * 0.95 + (1 / dt) * 0.05;
    if (K.autoQuality && !topView) {
      if (fpsEma < 27 && frames > 120) {
        if (!lowSince) lowSince = now;
        else if (now - lowSince > 4000 && renderScale > 0.55) { renderScale -= 0.15; lowSince = 0; fpsEma = 40; }
      } else lowSince = 0;
    }
    if (elFps.style.display === 'block' && frames % 20 === 0) elFps.textContent = fpsEma.toFixed(0) + ' fps  ' + Math.round(triCount / 1000) + 'k tris  x' + renderScale.toFixed(2);

    window.NAMCC.frames = frames;
    requestAnimationFrame(frame);
  }

  window.NAMCC = {
    stats: { stalls: stallCount, tables: tables.length, columns: columns.length, trees: trees.length, triangles: Math.round(triCount),
      rows: pieces.map(function (p) { return [p.name, p.n, +p.x.toFixed(1), +p.y.toFixed(1)]; }) },
    cam: cam, orbit: orbit, walkable: walkable, frames: 0,
    mode: function () { return mode + (trans ? '*' : '') + (attract ? ' attract' : ''); },
    goAerial: goAerial, goEntrance: goEntrance, goTo: goTo, navLimit: navLimit, inNewLot: inNewLot,
    goal: function () { return goal; }
  };
  requestAnimationFrame(frame);
})();
