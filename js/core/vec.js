/*
 * 向量与基础几何运算（无 DOM 依赖，可在 Node 中测试）
 * 所有向量均为长度为 3 的普通数组 [x, y, z]。
 * 平面表示：{ o: 平面上一点, n: 单位法向量, d: n·o, u, v: 平面内正交单位基 }
 */
(function (SG) {
  'use strict';

  const EPS = 1e-9;

  const V = {
    EPS,
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    addScaled: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len2: (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2],
    len: (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
    neg: (a) => [-a[0], -a[1], -a[2]],
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    mid: (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    copy: (a) => [a[0], a[1], a[2]],
    isFinite: (a) => Array.isArray(a) && isFinite(a[0]) && isFinite(a[1]) && isFinite(a[2]),
    norm(a) {
      const l = V.len(a);
      return l < 1e-14 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
    },
    centroid(pts) {
      const c = [0, 0, 0];
      if (!pts.length) return c;
      for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
      return V.scale(c, 1 / pts.length);
    },
    /** 绕过点 o、方向为单位向量 k 的轴旋转 ang（弧度），Rodrigues 公式 */
    rotate(p, o, k, ang) {
      const v = V.sub(p, o);
      const c = Math.cos(ang), s = Math.sin(ang);
      const kxv = V.cross(k, v);
      const kdv = V.dot(k, v);
      return [
        o[0] + v[0] * c + kxv[0] * s + k[0] * kdv * (1 - c),
        o[1] + v[1] * c + kxv[1] * s + k[1] * kdv * (1 - c),
        o[2] + v[2] * c + kxv[2] * s + k[2] * kdv * (1 - c),
      ];
    },
    /** 任取一个与 n 垂直的单位向量 */
    anyPerp(n) {
      const a = Math.abs(n[0]) < 0.6 ? [1, 0, 0] : [0, 1, 0];
      return V.norm(V.cross(n, a));
    },
    angle(a, b) {
      const la = V.len(a), lb = V.len(b);
      if (la < 1e-14 || lb < 1e-14) return NaN;
      let c = V.dot(a, b) / (la * lb);
      c = Math.max(-1, Math.min(1, c));
      return Math.acos(c);
    },
  };

  const G = {
    /** 由法向量和一点构造平面，并生成"教科书风格"的平面内基向量 */
    planePN(o, n) {
      n = V.norm(n);
      if (V.len2(n) < 0.5) return null;
      const { u, v } = G.niceBasis(n);
      return { o: V.copy(o), n, d: V.dot(n, o), u, v };
    },
    /** 平面内基：接近水平的平面以 x 轴方向为 u；竖直平面以水平线为 u */
    niceBasis(n) {
      let u;
      if (Math.abs(n[2]) > 0.7) {
        u = V.sub([1, 0, 0], V.scale(n, n[0]));
        if (V.len(u) < 1e-6) u = V.sub([0, 1, 0], V.scale(n, n[1]));
      } else {
        u = V.cross([0, 0, 1], n);
      }
      u = V.norm(u);
      const v = V.norm(V.cross(n, u));
      return { u, v };
    },
    /** 三点确定平面，基向量 u 沿 ab 方向（用于面上点的参数化） */
    plane3(a, b, c) {
      const n = V.cross(V.sub(b, a), V.sub(c, a));
      const l = V.len(n);
      const scaleRef = Math.max(V.dist(a, b), V.dist(a, c), 1e-12);
      if (l < 1e-10 * scaleRef * scaleRef) return null;
      const nn = V.scale(n, 1 / l);
      const u = V.norm(V.sub(b, a));
      const v = V.norm(V.cross(nn, u));
      return { o: V.copy(a), n: nn, d: V.dot(nn, a), u, v };
    },
    /** 多边形（可非凸）平面，Newell 法向 */
    planePoly(pts) {
      if (pts.length < 3) return null;
      const n = G.newell(pts);
      if (V.len(n) < 1e-12) return null;
      const nn = V.norm(n);
      let u = null;
      for (let i = 1; i < pts.length; i++) {
        const w = V.sub(pts[i], pts[0]);
        if (V.len(w) > 1e-9) { u = V.norm(V.sub(w, V.scale(nn, V.dot(w, nn)))); break; }
      }
      if (!u) return null;
      const v = V.norm(V.cross(nn, u));
      return { o: V.copy(pts[0]), n: nn, d: V.dot(nn, pts[0]), u, v };
    },
    newell(pts) {
      const n = [0, 0, 0];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        n[0] += (a[1] - b[1]) * (a[2] + b[2]);
        n[1] += (a[2] - b[2]) * (a[0] + b[0]);
        n[2] += (a[0] - b[0]) * (a[1] + b[1]);
      }
      return n;
    },
    polyArea(pts) {
      return V.len(G.newell(pts)) / 2;
    },
    distPointPlane(p, pl) {
      return V.dot(pl.n, p) - pl.d;
    },
    projPointPlane(p, pl) {
      return V.addScaled(p, pl.n, -(V.dot(pl.n, p) - pl.d));
    },
    projPointLine(p, a, b) {
      const d = V.sub(b, a);
      const l2 = V.len2(d);
      if (l2 < 1e-20) return { q: V.copy(a), t: 0 };
      const t = V.dot(V.sub(p, a), d) / l2;
      return { q: V.addScaled(a, d, t), t };
    },
    distPointLine(p, a, b) {
      return V.dist(p, G.projPointLine(p, a, b).q);
    },
    /** 两直线最近点：返回 {p, q, s, t, parallel}，p = a1 + s(b1-a1), q = a2 + t(b2-a2) */
    lineLine(a1, b1, a2, b2) {
      const d1 = V.sub(b1, a1), d2 = V.sub(b2, a2), r = V.sub(a1, a2);
      const a = V.dot(d1, d1), e = V.dot(d2, d2), b = V.dot(d1, d2);
      const c = V.dot(d1, r), f = V.dot(d2, r);
      const den = a * e - b * b;
      if (Math.abs(den) < 1e-12 * a * e) {
        const t = f / e;
        return { p: V.copy(a1), q: V.addScaled(a2, d2, t), s: 0, t, parallel: true };
      }
      const s = (b * f - c * e) / den;
      const t = (a * f - b * c) / den;
      return { p: V.addScaled(a1, d1, s), q: V.addScaled(a2, d2, t), s, t, parallel: false };
    },
    /** 直线 ab 与平面交点 */
    linePlane(a, b, pl) {
      const d = V.sub(b, a);
      const den = V.dot(pl.n, d);
      if (Math.abs(den) < 1e-12 * V.len(d)) return null;
      const t = (pl.d - V.dot(pl.n, a)) / den;
      return { p: V.addScaled(a, d, t), t };
    },
    /** 两平面交线：返回 {o, dir} */
    planePlane(p1, p2) {
      const dir = V.cross(p1.n, p2.n);
      const l = V.len(dir);
      if (l < 1e-10) return null;
      // 求交线上一点：解 n1·x=d1, n2·x=d2, dir·x=0
      const o = G.solve3([p1.n, p2.n, dir], [p1.d, p2.d, 0]);
      if (!o) return null;
      return { o, dir: V.scale(dir, 1 / l) };
    },
    det3(m) {
      return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    },
    solve3(m, r) {
      const D = G.det3(m);
      if (Math.abs(D) < 1e-14) return null;
      const rep = (col) => m.map((row, i) => row.map((x, j) => (j === col ? r[i] : x)));
      return [G.det3(rep(0)) / D, G.det3(rep(1)) / D, G.det3(rep(2)) / D];
    },
    /** 高斯消元（部分主元），A 为 n×n，返回解或 null */
    solve(A, b) {
      const n = A.length;
      const M = A.map((row, i) => row.slice().concat([b[i]]));
      for (let c = 0; c < n; c++) {
        let piv = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
        if (Math.abs(M[piv][c]) < 1e-13) return null;
        [M[c], M[piv]] = [M[piv], M[c]];
        for (let r = 0; r < n; r++) {
          if (r === c) continue;
          const f = M[r][c] / M[c][c];
          if (f === 0) continue;
          for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
        }
      }
      return M.map((row, i) => row[n] / row[i]);
    },
    /** 最小二乘：A 为 m×n（m≥n） */
    leastSquares(A, b) {
      const n = A[0].length;
      const AtA = [], Atb = [];
      for (let i = 0; i < n; i++) {
        AtA.push(new Array(n).fill(0));
        Atb.push(0);
        for (let k = 0; k < A.length; k++) {
          Atb[i] += A[k][i] * b[k];
          for (let j = 0; j < n; j++) AtA[i][j] += A[k][i] * A[k][j];
        }
      }
      return G.solve(AtA, Atb);
    },
    circumcenter(a, b, c) {
      const ab = V.sub(b, a), ac = V.sub(c, a);
      const n = V.cross(ab, ac);
      const n2 = V.len2(n);
      if (n2 < 1e-20) return null;
      const t1 = V.scale(V.cross(n, ab), V.len2(ac));
      const t2 = V.scale(V.cross(ac, n), V.len2(ab));
      return V.add(a, V.scale(V.add(t1, t2), 1 / (2 * n2)));
    },
    incenter(a, b, c) {
      const la = V.dist(b, c), lb = V.dist(a, c), lc = V.dist(a, b);
      const s = la + lb + lc;
      if (s < 1e-14) return null;
      return V.scale(V.add(V.add(V.scale(a, la), V.scale(b, lb)), V.scale(c, lc)), 1 / s);
    },
    orthocenter(a, b, c) {
      const cc = G.circumcenter(a, b, c);
      if (!cc) return null;
      // H = A + B + C - 2O
      return V.sub(V.add(V.add(a, b), c), V.scale(cc, 2));
    },
    /** 平面上点 p 是否在多边形内（多边形与 p 已在同一平面，用 2D 投影判断） */
    pointInPolygon3(p, pts, pl) {
      const q = pts.map((x) => [V.dot(V.sub(x, pl.o), pl.u), V.dot(V.sub(x, pl.o), pl.v)]);
      const s = [V.dot(V.sub(p, pl.o), pl.u), V.dot(V.sub(p, pl.o), pl.v)];
      return G.pointInPoly2(s, q);
    },
    pointInPoly2(s, q) {
      let inside = false;
      for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
        const xi = q[i][0], yi = q[i][1], xj = q[j][0], yj = q[j][1];
        if ((yi > s[1]) !== (yj > s[1]) && s[0] < ((xj - xi) * (s[1] - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    },
    /**
     * 三维凸包。返回 { faces: [[idx...]] } 面为外法向逆时针顶点序列，已合并共面三角形并去除共线点。
     */
    convexHull(points, eps) {
      const n = points.length;
      if (n < 4) return null;
      let scale = 0;
      for (const p of points) scale = Math.max(scale, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
      eps = eps || 1e-7 * Math.max(1, scale);
      // 初始四面体
      let i0 = 0, i1 = -1, i2 = -1, i3 = -1;
      let best = 0;
      for (let i = 1; i < n; i++) { const d = V.dist(points[i], points[i0]); if (d > best) { best = d; i1 = i; } }
      if (best < eps) return null;
      best = 0;
      for (let i = 0; i < n; i++) {
        const d = G.distPointLine(points[i], points[i0], points[i1]);
        if (d > best) { best = d; i2 = i; }
      }
      if (best < eps) return null;
      const pl0 = G.plane3(points[i0], points[i1], points[i2]);
      best = 0;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(G.distPointPlane(points[i], pl0));
        if (d > best) { best = d; i3 = i; }
      }
      if (best < eps) return null;
      let faces = [];
      const mk = (a, b, c) => {
        const pl = G.plane3(points[a], points[b], points[c]);
        return { v: [a, b, c], pl };
      };
      const cen = V.centroid([points[i0], points[i1], points[i2], points[i3]]);
      const addFace = (a, b, c) => {
        let f = mk(a, b, c);
        if (!f.pl) return;
        if (G.distPointPlane(cen, f.pl) > 0) f = mk(a, c, b);
        faces.push(f);
      };
      addFace(i0, i1, i2); addFace(i0, i1, i3); addFace(i0, i2, i3); addFace(i1, i2, i3);
      const used = new Set([i0, i1, i2, i3]);
      for (let i = 0; i < n; i++) {
        if (used.has(i)) continue;
        const p = points[i];
        const vis = faces.map((f) => G.distPointPlane(p, f.pl) > eps);
        if (!vis.some(Boolean)) continue;
        const edgeCount = new Map();
        faces.forEach((f, k) => {
          if (!vis[k]) return;
          for (let e = 0; e < 3; e++) {
            const a = f.v[e], b = f.v[(e + 1) % 3];
            edgeCount.set(a + ',' + b, [a, b]);
          }
        });
        const horizon = [];
        for (const [key, [a, b]] of edgeCount) {
          if (!edgeCount.has(b + ',' + a)) horizon.push([a, b]);
          void key;
        }
        faces = faces.filter((f, k) => !vis[k]);
        for (const [a, b] of horizon) {
          const f = mk(a, b, i);
          if (f.pl) faces.push(f);
        }
      }
      // 合并共面三角形
      const groups = [];
      for (const f of faces) {
        let g = groups.find((g) => V.dot(g.n, f.pl.n) > 1 - 1e-7 && Math.abs(g.d - f.pl.d) < eps * 10);
        if (!g) { g = { n: f.pl.n, d: f.pl.d, tris: [] }; groups.push(g); }
        g.tris.push(f.v);
      }
      const out = [];
      for (const g of groups) {
        const edges = new Map();
        for (const t of g.tris) for (let e = 0; e < 3; e++) edges.set(t[e] + ',' + t[(e + 1) % 3], [t[e], t[(e + 1) % 3]]);
        const next = new Map();
        for (const [, [a, b]] of edges) if (!edges.has(b + ',' + a)) next.set(a, b);
        if (!next.size) continue;
        const start = next.keys().next().value;
        const loop = [start];
        let cur = next.get(start), guard = 0;
        while (cur !== start && cur !== undefined && guard++ < 1000) { loop.push(cur); cur = next.get(cur); }
        // 去除共线点
        const clean = loop.filter((idx, k) => {
          const a = points[loop[(k - 1 + loop.length) % loop.length]], b = points[loop[(k + 1) % loop.length]];
          return G.distPointLine(points[idx], a, b) > eps * 10;
        });
        if (clean.length >= 3) out.push(clean);
      }
      return { faces: out };
    },
    /** 闭合多面体体积（面为外法向顶点序列） */
    polyhedronVolume(pts, faces) {
      const c = V.centroid(pts);
      let vol = 0;
      for (const f of faces) {
        for (let i = 1; i + 1 < f.length; i++) {
          const a = V.sub(pts[f[0]], c), b = V.sub(pts[f[i]], c), d = V.sub(pts[f[i + 1]], c);
          vol += V.dot(a, V.cross(b, d)) / 6;
        }
      }
      return Math.abs(vol);
    },
    /** Nelder-Mead 极小化 */
    nelderMead(f, x0, step, iters) {
      const n = x0.length;
      step = step || 0.5;
      iters = iters || 2000;
      let simplex = [x0.slice()];
      for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step; simplex.push(x); }
      let vals = simplex.map(f);
      for (let it = 0; it < iters; it++) {
        const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
        simplex = idx.map((i) => simplex[i]);
        vals = idx.map((i) => vals[i]);
        if (Math.abs(vals[n] - vals[0]) < 1e-16 && it > 50) break;
        const cen = new Array(n).fill(0);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cen[j] += simplex[i][j] / n;
        const xr = cen.map((c, j) => c + (c - simplex[n][j]));
        const fr = f(xr);
        if (fr < vals[0]) {
          const xe = cen.map((c, j) => c + 2 * (c - simplex[n][j]));
          const fe = f(xe);
          if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
        } else if (fr < vals[n - 1]) {
          simplex[n] = xr; vals[n] = fr;
        } else {
          const xc = cen.map((c, j) => c + 0.5 * (simplex[n][j] - c));
          const fc = f(xc);
          if (fc < vals[n]) { simplex[n] = xc; vals[n] = fc; } else {
            for (let i = 1; i <= n; i++) {
              simplex[i] = simplex[i].map((x, j) => simplex[0][j] + 0.5 * (x - simplex[0][j]));
              vals[i] = f(simplex[i]);
            }
          }
        }
      }
      let bi = 0;
      for (let i = 1; i <= n; i++) if (vals[i] < vals[bi]) bi = i;
      return { x: simplex[bi], fx: vals[bi] };
    },
  };

  SG.V = V;
  SG.G = G;
})(globalThis.SG = globalThis.SG || {});
