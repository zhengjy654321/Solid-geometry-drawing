/*
 * 渲染器：把场景转换为二维"显示列表"，并做消隐（被遮挡的线自动画成虚线）。
 *
 * 消隐原理：所有"实体面"（立体的面、旋转体侧面的多边形近似）作为遮挡物。
 * 对每条线段，在屏幕上求出它落在某个遮挡面内的参数区间，再比较深度：
 *   λ(t) = (d − n·P(t)) / (n·F)，λ>0 表示该面在点 P(t) 与观察者之间。
 * 由于是平行投影，λ 关于 t 是线性的，因此可以精确求出被遮挡区间。
 */
(function (SG) {
  'use strict';
  const { V, G } = SG;
  const TAU = Math.PI * 2;

  const HL = { sel: '#1f6fd1', hover: '#ff7a00', pick: '#c2185b' };

  // ------------------------------------------------------------ 文本解析：A1 → A + 下标 1
  function parseText(s) {
    s = String(s);
    const parts = [];
    let i = 0;
    const isLetter = (ch) => /[A-Za-zα-ωΑ-Ω']/.test(ch);
    while (i < s.length) {
      const ch = s[i];
      if (ch === '_') {
        let j = i + 1, sub = '';
        if (s[j] === '{') { j++; while (j < s.length && s[j] !== '}') sub += s[j++]; j++; }
        else { while (j < s.length && /[0-9]/.test(s[j])) sub += s[j++]; if (!sub && j < s.length) sub = s[j++]; }
        parts.push({ t: sub, sub: true });
        i = j;
        continue;
      }
      if (/[0-9]/.test(ch) && i > 0 && isLetter(s[i - 1])) {
        let j = i, sub = '';
        while (j < s.length && /[0-9]/.test(s[j])) sub += s[j++];
        parts.push({ t: sub, sub: true });
        i = j;
        continue;
      }
      const last = parts[parts.length - 1];
      if (last && !last.sub) last.t += ch; else parts.push({ t: ch, sub: false });
      i++;
    }
    return parts;
  }

  function mergeIntervals(list) {
    if (!list.length) return list;
    list.sort((a, b) => a[0] - b[0]);
    const out = [list[0].slice()];
    for (let i = 1; i < list.length; i++) {
      const last = out[out.length - 1];
      if (list[i][0] <= last[1] + 1e-9) last[1] = Math.max(last[1], list[i][1]);
      else out.push(list[i].slice());
    }
    return out;
  }

  const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];

  /** 二维线段 sA→sB 位于多边形内部的参数区间 */
  function segInPoly2(sA, sB, poly) {
    const d = [sB[0] - sA[0], sB[1] - sA[1]];
    if (Math.abs(d[0]) + Math.abs(d[1]) < 1e-9) return G.pointInPoly2(sA, poly) ? [[0, 1]] : [];
    const ts = [0, 1];
    for (let i = 0; i < poly.length; i++) {
      const q0 = poly[i], q1 = poly[(i + 1) % poly.length];
      const e = [q1[0] - q0[0], q1[1] - q0[1]];
      const den = cross2(d, e);
      if (Math.abs(den) < 1e-12) continue;
      const w = [q0[0] - sA[0], q0[1] - sA[1]];
      const t = cross2(w, e) / den, s = cross2(w, d) / den;
      if (s >= -1e-9 && s <= 1 + 1e-9 && t > 0 && t < 1) ts.push(t);
    }
    ts.sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i + 1 < ts.length; i++) {
      const t0 = ts[i], t1 = ts[i + 1];
      if (t1 - t0 < 1e-9) continue;
      const tm = (t0 + t1) / 2;
      if (G.pointInPoly2([sA[0] + d[0] * tm, sA[1] + d[1] * tm], poly)) {
        if (out.length && Math.abs(out[out.length - 1][1] - t0) < 1e-12) out[out.length - 1][1] = t1;
        else out.push([t0, t1]);
      }
    }
    return out;
  }

  function bboxOf(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    return [x0, y0, x1, y1];
  }

  function circlePts(c, u, v, r, n, a0, a1) {
    a0 = a0 || 0; a1 = a1 == null ? TAU : a1;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = a0 + ((a1 - a0) * i) / n;
      out.push(V.add(c, V.add(V.scale(u, r * Math.cos(t)), V.scale(v, r * Math.sin(t)))));
    }
    return out;
  }

  /** 平面在屏幕上显示的平行四边形四个角（世界坐标） */
  function planeCorners(pl, size) {
    const anchors = pl.anchors && pl.anchors.length ? pl.anchors : [pl.o];
    const uv = anchors.map((a) => [V.dot(V.sub(a, pl.o), pl.u), V.dot(V.sub(a, pl.o), pl.v)]);
    let u0 = Math.min(...uv.map((p) => p[0])), u1 = Math.max(...uv.map((p) => p[0]));
    let v0 = Math.min(...uv.map((p) => p[1])), v1 = Math.max(...uv.map((p) => p[1]));
    const base = Math.max(u1 - u0, v1 - v0, 1.5);
    const minExt = base * 0.6;
    if (u1 - u0 < minExt) { const m = (u0 + u1) / 2; u0 = m - minExt / 2; u1 = m + minExt / 2; }
    if (v1 - v0 < minExt) { const m = (v0 + v1) / 2; v0 = m - minExt / 2; v1 = m + minExt / 2; }
    const mg = 0.18 * base;
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const hu = ((u1 - u0) / 2 + mg) * (size || 1), hv = ((v1 - v0) / 2 + mg) * (size || 1);
    const at = (a, b) => V.add(pl.o, V.add(V.scale(pl.u, a), V.scale(pl.v, b)));
    return [at(cu - hu, cv - hv), at(cu + hu, cv - hv), at(cu + hu, cv + hv), at(cu - hu, cv + hv)];
  }

  /** 旋转体的几何数据：圆周、侧面多边形（遮挡用）、轮廓母线 */
  function curvedGeom(cv, cam, N) {
    N = N || 72;
    const ring = (z, r) => circlePts(V.addScaled(cv.c0, cv.n, z), cv.u, cv.v, r, N).slice(0, N);
    const bot = ring(0, cv.r1);
    const hasTop = cv.r2 > 1e-9;
    const top = hasTop ? ring(cv.h, cv.r2) : null;
    const apex = V.addScaled(cv.c0, cv.n, cv.h);
    const faces = [bot.slice().reverse()];
    if (hasTop) faces.push(top.slice());
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      faces.push(hasTop ? [bot[i], bot[j], top[j], top[i]] : [bot[i], bot[j], apex]);
    }
    const F = cam.F;
    const A = V.dot(cv.u, F), B = V.dot(cv.v, F);
    const C = -((cv.r1 - cv.r2) * V.dot(cv.n, F)) / cv.h;
    const R = Math.hypot(A, B);
    const gens = [];
    if (R > 1e-9 && Math.abs(C) <= R) {
      const phi0 = Math.atan2(B, A), dphi = Math.acos(Math.max(-1, Math.min(1, C / R)));
      for (const phi of [phi0 + dphi, phi0 - dphi]) {
        const e = V.add(V.scale(cv.u, Math.cos(phi)), V.scale(cv.v, Math.sin(phi)));
        const p0 = V.addScaled(cv.c0, e, cv.r1);
        const p1 = hasTop ? V.addScaled(V.addScaled(cv.c0, cv.n, cv.h), e, cv.r2) : apex;
        gens.push([p0, p1]);
      }
    }
    return { bot, top, faces, gens, apex };
  }

  // ================================================================ build
  function build(S, cam, view, ui) {
    view = view || {};
    ui = ui || {};
    const hl = ui.hl || new Map();
    const exp = !!view.exportMode;
    const F = cam.F;
    const dl = { bg: [], fills: [], lines: [], marks: [], points: [], labels: [], over: [], hits: { points: [], lines: [], faces: [], spheres: [], labels: [] } };
    const P2 = (p) => cam.project(p);
    const lw = view.lineScale || 1;
    const hidMode = view.hiddenMode || 'dashed';
    const DASH = [5 * lw, 4 * lw];

    const isHidden = (o) => {
      if (o.hidden) return true;
      if (o.parent) { const p = S.map.get(o.parent); if (p && p.hidden) return true; }
      return false;
    };
    const vis = S.objects.filter((o) => o.v && !o.err && !isHidden(o));

    // 场景尺度
    let ext = 1;
    for (const o of vis) if (o.type === 'point') ext = Math.max(ext, Math.abs(o.v[0]), Math.abs(o.v[1]), Math.abs(o.v[2]));
    const EPS = 1e-6 * ext;

    // ---------------------------------------------- 遮挡物
    const occ = [];
    const addOcc = (pts, owner) => {
      const pl = G.planePoly(pts);
      if (!pl) return;
      const nF = V.dot(pl.n, F);
      if (Math.abs(nF) < 1e-9) return;
      const poly2 = pts.map(P2);
      occ.push({ n: pl.n, d: pl.d, nF, poly2, bb: bboxOf(poly2), owner });
    };
    const curvedCache = new Map();
    for (const o of vis) {
      if (o.type === 'polygon' && o.style.occlude && !o.v.curve) addOcc(o.v.pts, o.id);
      if (o.type === 'plane' && o.style.occlude) addOcc(planeCorners(o.v, o.style.size), o.id);
      if (o.type === 'solid' && o.v.curved) {
        const g = curvedGeom(o.v.curved, cam);
        curvedCache.set(o.id, g);
        for (const f of g.faces) addOcc(f, o.id);
      }
    }
    const occSpheres = vis.filter((o) => o.type === 'sphere' && o.style.occlude);

    function hiddenIntervals(A, B, it) {
      const out = [];
      const sA = P2(A), sB = P2(B);
      const bx0 = Math.min(sA[0], sB[0]), bx1 = Math.max(sA[0], sB[0]), by0 = Math.min(sA[1], sB[1]), by1 = Math.max(sA[1], sB[1]);
      if (it.occl !== false) {
        for (const oc of occ) {
          if (it.ignore && it.ignore === oc.owner) continue;
          if (oc.bb[0] > bx1 || oc.bb[2] < bx0 || oc.bb[1] > by1 || oc.bb[3] < by0) continue;
          const la = (oc.d - V.dot(oc.n, A)) / oc.nF, lb = (oc.d - V.dot(oc.n, B)) / oc.nF;
          if (la <= EPS && lb <= EPS) continue;
          for (const [t0, t1] of segInPoly2(sA, sB, oc.poly2)) {
            let a = t0, b = t1;
            const dl_ = lb - la;
            if (Math.abs(dl_) < 1e-15) { if (la <= EPS) continue; }
            else { const tc = (EPS - la) / dl_; if (dl_ > 0) a = Math.max(a, tc); else b = Math.min(b, tc); }
            if (b - a > 1e-7) out.push([a, b]);
          }
        }
      }
      if (it.sphere) {
        const S0 = it.sphere;
        const fa = V.dot(V.sub(A, S0.c), F), fb = V.dot(V.sub(B, S0.c), F);
        const e = -1e-6 * S0.r;
        if (fa < e && fb < e) out.push([0, 1]);
        else if (fa < e || fb < e) {
          const tc = (e - fa) / (fb - fa);
          out.push(fa < e ? [0, tc] : [tc, 1]);
        }
      }
      for (const so of occSpheres) {
        if (it.ignore === so.id) continue;
        const c = so.v.c, r = so.v.r;
        const hid = (t) => {
          const q = V.sub(V.lerp(A, B, t), c);
          const proj = V.dot(q, F);
          const perp2 = V.len2(q) - proj * proj;
          if (perp2 >= r * r) return false;
          return -proj + Math.sqrt(r * r - perp2) > EPS * 10;
        };
        const N = 32;
        let prev = hid(0), pt = 0;
        let start = prev ? 0 : null;
        for (let i = 1; i <= N; i++) {
          const t = i / N, h = hid(t);
          if (h !== prev) {
            let l = pt, rr = t;
            for (let k = 0; k < 18; k++) { const m = (l + rr) / 2; if (hid(m) === prev) l = m; else rr = m; }
            const tb = (l + rr) / 2;
            if (h) start = tb; else { out.push([start, tb]); start = null; }
            prev = h;
          }
          pt = t;
        }
        if (start != null) out.push([start, 1]);
      }
      return mergeIntervals(out);
    }

    /** 把三维折线按可见性拆分并加入显示列表 */
    function addPolyline(pts3, it) {
      if (pts3.length < 2) return;
      const runs = [];
      let cur = null;
      const emit = (a, b, visible) => {
        if (!cur || cur.vis !== visible) { cur = { vis: visible, pts: [a] }; runs.push(cur); }
        cur.pts.push(b);
      };
      const mode = it.mode || 'auto';
      const p2 = pts3.map(P2);
      for (let i = 0; i + 1 < pts3.length; i++) {
        const A = pts3[i], B = pts3[i + 1];
        if (mode !== 'auto') { emit(p2[i], p2[i + 1], mode !== 'dashed'); continue; }
        const H = hiddenIntervals(A, B, it);
        let t = 0;
        const at = (s) => [p2[i][0] + (p2[i + 1][0] - p2[i][0]) * s, p2[i][1] + (p2[i + 1][1] - p2[i][1]) * s];
        for (const [h0, h1] of H) {
          const a = Math.max(0, h0), b = Math.min(1, h1);
          if (a > t + 1e-9) emit(at(t), at(a), true);
          if (b > a) emit(at(a), at(b), false);
          t = Math.max(t, b);
        }
        if (t < 1 - 1e-9) emit(at(t), p2[i + 1], true);
      }
      const color = it.color || '#1a1a1a';
      const width = (it.width || 1.5) * lw;
      for (const r of runs) {
        if (r.vis || hidMode === 'solid' && mode === 'auto') dl.lines.push({ k: 'path', pts: r.pts, color, width, dash: null, alpha: it.alpha, z: 1 });
        else {
          if (hidMode === 'hide' && mode === 'auto') continue;
          if (it.backHide && mode === 'auto') continue;
          dl.lines.push({ k: 'path', pts: r.pts, color: it.hiddenColor || color, width: width * 0.9, dash: DASH, alpha: it.alpha, z: 0 });
        }
      }
      if (it.id && it.hit !== false) dl.hits.lines.push({ id: it.id, pts: p2 });
    }

    const styleOf = (o, base) => {
      const h = !exp && hl.get(o.id);
      return {
        color: h ? HL[h] : base.color || '#1a1a1a',
        width: (base.width || 1.5) + (h ? 1.2 : 0),
      };
    };

    // ---------------------------------------------- 背景：网格、坐标轴
    const gridStep = view.gridStep || 1;
    const gridN = view.gridExtent || 5;
    const gridLine = (a, b, color, w) => dl.bg.push({ k: 'path', pts: [P2(a), P2(b)], color, width: w || 1, dash: null });
    if (view.ground) {
      for (let i = -gridN; i <= gridN; i++) {
        const t = i * gridStep, m = gridN * gridStep;
        gridLine([t, -m, 0], [t, m, 0], i === 0 ? '#c9d3df' : '#e4e9ef');
        gridLine([-m, t, 0], [m, t, 0], i === 0 ? '#c9d3df' : '#e4e9ef');
      }
    }
    if (view.grid3d) {
      const m = gridN * gridStep;
      for (let i = 0; i <= gridN; i++) {
        const t = i * gridStep;
        gridLine([t, 0, 0], [t, m, 0], '#e1e6ec'); gridLine([0, t, 0], [m, t, 0], '#e1e6ec');
        gridLine([0, t, 0], [0, t, m], '#e1e6ec'); gridLine([0, 0, t], [0, m, t], '#e1e6ec');
        gridLine([t, 0, 0], [t, 0, m], '#e1e6ec'); gridLine([0, 0, t], [m, 0, t], '#e1e6ec');
      }
    }
    if (view.workPlane && !exp) {
      const pl = view.workPlane;
      const c0 = pl.center || pl.o;
      let m = 4;
      if (pl.anchors && pl.anchors.length > 1) {
        const r = Math.max(...pl.anchors.map((a) => V.dist(a, c0)));
        m = Math.max(2, Math.min(8, Math.ceil(r / gridStep) + 1));
      }
      const col = 'rgba(31,111,209,0.18)';
      for (let i = -m; i <= m; i++) {
        const a = V.add(c0, V.scale(pl.u, i * gridStep)), b = V.add(c0, V.scale(pl.v, i * gridStep));
        gridLine(V.addScaled(a, pl.v, -m * gridStep), V.addScaled(a, pl.v, m * gridStep), col);
        gridLine(V.addScaled(b, pl.u, -m * gridStep), V.addScaled(b, pl.u, m * gridStep), col);
      }
    }
    if (view.axes) {
      const L = Math.max(gridN * gridStep * 0.8, Math.ceil(ext) + 1);
      const axes = [['x', [1, 0, 0], '#c0392b'], ['y', [0, 1, 0], '#27ae60'], ['z', [0, 0, 1], '#2c6fbb']];
      for (const [name, dir, col] of axes) {
        const a = P2(V.scale(dir, -0.15 * L)), b = P2(V.scale(dir, L));
        dl.bg.push({ k: 'path', pts: [a, b], color: col, width: 1.3, dash: null });
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        const ux = dx / l, uy = dy / l;
        dl.bg.push({ k: 'poly', pts: [b, [b[0] - 10 * ux - 4 * uy, b[1] - 10 * uy + 4 * ux], [b[0] - 10 * ux + 4 * uy, b[1] - 10 * uy - 4 * ux]], fill: col, alpha: 1 });
        dl.labels.push({ k: 'text', x: b[0] + ux * 12, y: b[1] + uy * 12, parts: [{ t: name }], size: 15, color: col, italic: true, align: 'center' });
        if (view.axisNumbers) {
          for (let i = 1; i <= Math.floor(L / gridStep); i++) {
            const p = P2(V.scale(dir, i * gridStep));
            dl.bg.push({ k: 'path', pts: [[p[0] - uy * 3, p[1] + ux * 3], [p[0] + uy * 3, p[1] - ux * 3]], color: col, width: 1, dash: null });
            dl.labels.push({ k: 'text', x: p[0] - uy * 10 + 2, y: p[1] + ux * 10, parts: [{ t: SG.Exact.fmtNum(i * gridStep, 2) }], size: 10, color: col, align: 'center' });
          }
        }
      }
      const o2 = P2([0, 0, 0]);
      dl.labels.push({ k: 'text', x: o2[0] - 10, y: o2[1] + 10, parts: [{ t: 'O' }], size: 13, color: '#666', italic: true, align: 'center' });
    }

    // ---------------------------------------------- 面的填充
    for (const o of vis) {
      const h = !exp && hl.get(o.id);
      if (o.type === 'plane') {
        const cs = planeCorners(o.v, o.style.size);
        const p2 = cs.map(P2);
        dl.fills.push({ k: 'poly', pts: p2, fill: h ? HL[h] : o.style.fillColor, alpha: h ? 0.22 : o.style.fillOpacity, z: cam.depth(V.centroid(cs)) });
        dl.hits.faces.push({ id: o.id, poly: p2, z: cam.depth(V.centroid(cs)), plane: true });
        const st = styleOf(o, o.style);
        addPolyline(cs.concat([cs[0]]), { color: st.color, width: st.width, mode: o.style.dash || 'auto', id: o.id, ignore: o.id, hit: false });
        if (o.style.label && o.name) {
          const c = V.centroid(cs);
          const lp = P2(V.lerp(cs[3], c, 0.14));
          dl.labels.push({ k: 'text', x: lp[0], y: lp[1], parts: parseText(o.name), size: (view.fontSize || 17), color: st.color, italic: true, align: 'center', id: o.id });
        }
      } else if (o.type === 'polygon') {
        const p2 = o.v.pts.map(P2);
        const z = cam.depth(V.centroid(o.v.pts));
        if (o.style.fill || h) dl.fills.push({ k: 'poly', pts: p2, fill: h ? HL[h] : o.style.fillColor, alpha: h ? (o.style.fill ? 0.35 : 0.16) : o.style.fillOpacity, z });
        dl.hits.faces.push({ id: o.id, poly: p2, z });
        if (o.v.curve) {
          const st = styleOf(o, { color: '#1a1a1a', width: 1.5 });
          addPolyline(o.v.pts.concat([o.v.pts[0]]), { color: st.color, width: st.width, id: o.id });
        }
      }
    }

    // ---------------------------------------------- 球
    for (const o of vis) {
      if (o.type !== 'sphere') continue;
      const { c, r } = o.v;
      const st = styleOf(o, { color: o.style.lineColor, width: o.style.width });
      const e1 = V.anyPerp(F), e2 = V.cross(F, e1);
      const outline = circlePts(c, e1, e2, r, 120);
      const o2 = outline.map(P2);
      const c2 = P2(c);
      const rr = r * cam.scale;
      if (o.style.mode === 'shaded') {
        dl.fills.push({ k: 'sphere', pts: o2, cx: c2[0], cy: c2[1], r: rr, color: o.style.color, alpha: o.style.opacity, z: cam.depth(c) - r });
      }
      addPolyline(outline, { color: st.color, width: st.width, ignore: o.id, id: o.id });
      dl.hits.spheres.push({ id: o.id, cx: c2[0], cy: c2[1], r: rr });
      const S0 = { c, r };
      const back = o.style.back === 'hide';
      const thin = { color: o.style.mode === 'wire' ? '#5a6b80' : st.color, width: o.style.mode === 'wire' ? 0.9 : st.width * 0.85, sphere: S0, ignore: o.id, hit: false, backHide: back };
      if (o.style.mode === 'wire') {
        const n = Math.max(2, Math.round(o.style.density || 8));
        for (let k = 1; k < n; k++) {
          const ph = -Math.PI / 2 + (Math.PI * k) / n;
          addPolyline(circlePts(V.add(c, [0, 0, r * Math.sin(ph)]), [1, 0, 0], [0, 1, 0], r * Math.cos(ph), 72), thin);
        }
        for (let k = 0; k < n; k++) {
          const th = (Math.PI * k) / n;
          addPolyline(circlePts(c, [Math.cos(th), Math.sin(th), 0], [0, 0, 1], r, 96), thin);
        }
      } else if (o.style.equator) {
        addPolyline(circlePts(c, [1, 0, 0], [0, 1, 0], r, 96), thin);
      }
    }

    // ---------------------------------------------- 线段、直线、射线
    const nbrs = new Map(); // 点 → 相邻点（用于标签放置）
    const link = (a, b) => {
      if (!nbrs.has(a)) nbrs.set(a, []);
      nbrs.get(a).push(b);
    };
    for (const o of vis) {
      if (!SG.LINE_TYPES.has(o.type)) continue;
      let A = o.v.a, B = o.v.b;
      if (V.dist(A, B) < 1e-12) continue;
      link(o.def.a, o.def.b); link(o.def.b, o.def.a);
      const d = V.sub(B, A);
      if (o.type === 'line') { const e = o.style.ext == null ? 0.5 : o.style.ext; A = V.addScaled(A, d, -e); B = V.addScaled(B, d, e); }
      if (o.type === 'ray') { B = V.addScaled(B, d, o.style.ext == null ? 1 : o.style.ext); }
      const st = styleOf(o, o.style);
      addPolyline([A, B], { color: st.color, width: st.width, mode: o.style.dash || 'auto', id: o.id });
      if (o.style.label) {
        const m = P2(V.mid(o.v.a, o.v.b));
        dl.labels.push({ k: 'text', x: m[0] + 8, y: m[1] - 8, parts: parseText(S.displayName(o)), size: (view.fontSize || 17) - 2, color: st.color, italic: true, align: 'left', id: o.id });
      }
    }

    // ---------------------------------------------- 旋转体
    for (const o of vis) {
      if (o.type !== 'solid' || !o.v.curved) continue;
      const g = curvedCache.get(o.id);
      const st = styleOf(o, o.style);
      const base = { color: st.color, width: st.width, id: o.id };
      addPolyline(g.bot.concat([g.bot[0]]), base);
      if (g.top) addPolyline(g.top.concat([g.top[0]]), base);
      for (const [a, b] of g.gens) addPolyline([a, b], Object.assign({}, base, { hit: true }));
    }

    // ---------------------------------------------- 圆
    for (const o of vis) {
      if (o.type !== 'circle') continue;
      const C = o.v;
      const st = styleOf(o, o.style);
      const it = { color: st.color, width: st.width, mode: o.style.dash || 'auto', id: o.id };
      if (C.onSphere && !C.clip) { const sp = S.map.get(C.onSphere); if (sp && sp.v) { it.sphere = sp.v; it.ignore = sp.id; } }
      if (C.clip) {
        for (const [a0, a1] of SG.Arcs.clip(C, C.clip)) {
          const n = Math.max(8, Math.ceil(((a1 - a0) / TAU) * 120));
          addPolyline(circlePts(C.c, C.u, C.v, C.r, n, a0, a1), it);
        }
      } else addPolyline(circlePts(C.c, C.u, C.v, C.r, 120), it);
    }

    // ---------------------------------------------- 轨迹
    for (const o of vis) {
      if (o.type !== 'trace' || !o.data || o.data.length < 2) continue;
      const st = styleOf(o, o.style);
      addPolyline(o.data, { color: st.color, width: st.width, id: o.id, occl: true });
    }

    // ---------------------------------------------- 标注
    for (const o of vis) {
      if (o.type !== 'mark') continue;
      const st = styleOf(o, o.style);
      if (o.def.kind === 'text') {
        const p = P2(o.v.p);
        dl.labels.push({ k: 'text', x: p[0] + 6, y: p[1] - 10, parts: parseText(o.def.text), size: (view.fontSize || 17) - 2, color: st.color, align: 'left', id: o.id });
        continue;
      }
      const { a, o: O, b } = o.v;
      const ua = V.norm(V.sub(a, O)), ub = V.norm(V.sub(b, O));
      const s = Math.min((o.style.size || 0.25) * (ext > 3 ? ext / 3 : 1), 0.3 * V.dist(a, O), 0.3 * V.dist(b, O));
      if (o.def.kind === 'rightAngle') {
        const p1 = V.addScaled(O, ua, s), p3 = V.addScaled(O, ub, s), p2 = V.add(p1, V.scale(ub, s));
        addPolyline([p1, p2, p3], { color: st.color, width: st.width, mode: 'solid', id: o.id });
      } else {
        const n = V.cross(ua, ub);
        const ang = V.angle(ua, ub);
        const w = V.norm(V.cross(n, ua));
        for (let k = 0; k < (o.def.count || 1); k++) {
          const rr = s * (1 + k * 0.18);
          addPolyline(circlePts(O, ua, w, rr, 24, 0, ang), { color: st.color, width: st.width, mode: 'solid', id: o.id });
        }
      }
    }

    // ---------------------------------------------- 预览（工具绘制过程中）
    for (const pv of ui.preview || []) {
      if (pv.type === 'seg') dl.over.push({ k: 'path', pts: [P2(pv.a), P2(pv.b)], color: HL.pick, width: 1.4, dash: [4, 3] });
      if (pv.type === 'poly') dl.over.push({ k: 'poly', pts: pv.pts.map(P2), fill: HL.pick, alpha: 0.12 });
      if (pv.type === 'point') { const p = P2(pv.p); dl.over.push({ k: 'dot', x: p[0], y: p[1], r: 4.5, fill: '#fff', stroke: HL.pick, sw: 2 }); }
      if (pv.type === 'circle') dl.over.push({ k: 'path', pts: circlePts(pv.c, pv.u, pv.v, pv.r, 72).map(P2), color: HL.pick, width: 1.2, dash: [4, 3] });
    }

    // ---------------------------------------------- 点
    const ptVis = vis.filter((o) => o.type === 'point');
    let cen2 = [cam.cx, cam.cy];
    if (ptVis.length) { const cs = ptVis.map((o) => P2(o.v)); cen2 = [cs.reduce((s, p) => s + p[0], 0) / cs.length, cs.reduce((s, p) => s + p[1], 0) / cs.length]; }
    const fsz = view.fontSize || 17;
    for (const o of ptVis) {
      const p = P2(o.v);
      const h = !exp && hl.get(o.id);
      const k = SG.Kinds[o.def.kind];
      const dynamic = !exp && k && k.draggable && !o.locked && o.def.kind !== 'free';
      if (o.style.dot !== false && view.showDots !== false || h) {
        const r = (o.style.size || 3) * (h ? 1.4 : 1);
        dl.points.push({ k: 'dot', x: p[0], y: p[1], r, fill: h ? HL[h] : dynamic ? '#1f6fd1' : o.style.color, stroke: dynamic && !h ? '#fff' : null, sw: 1 });
        if (h) dl.points.push({ k: 'dot', x: p[0], y: p[1], r: r + 4, fill: null, stroke: HL[h], sw: 1.2 });
      }
      dl.hits.points.push({ id: o.id, x: p[0], y: p[1] });
      if (o.style.label || view.coords) {
        let text = o.style.label ? o.name || '' : '';
        if (view.coords) text += '(' + o.v.map((x) => SG.Exact.recognize(x, { pi: false }) || SG.Exact.fmtNum(x, 2)).join(', ') + ')';
        let dx, dy;
        if (o.style.labelOffset) [dx, dy] = o.style.labelOffset;
        else {
          let sx = 0, sy = 0;
          for (const nb of nbrs.get(o.id) || []) {
            const q = S.map.get(nb);
            if (!q || !q.v) continue;
            const p2 = P2(q.v);
            const l = Math.hypot(p2[0] - p[0], p2[1] - p[1]);
            if (l > 1e-6) { sx -= (p2[0] - p[0]) / l; sy -= (p2[1] - p[1]) / l; }
          }
          let l = Math.hypot(sx, sy);
          if (l < 0.35) { sx = p[0] - cen2[0]; sy = p[1] - cen2[1]; l = Math.hypot(sx, sy); }
          if (l < 1e-6) { sx = 0.7; sy = -0.7; l = 1; }
          const dist = fsz * 0.85;
          dx = (sx / l) * dist; dy = (sy / l) * dist;
        }
        const parts = parseText(text);
        dl.labels.push({ k: 'text', x: p[0] + dx, y: p[1] + dy, parts, size: fsz, color: h ? HL[h] : o.style.labelColor || '#1a1a1a', italic: true, align: 'center', id: o.id, label: true });
      }
    }

    // ---------------------------------------------- 度量标签
    for (const o of vis) {
      if (o.type !== 'measure' || !o.style.show || !o.v.at) continue;
      const p = P2(o.v.at);
      const f = SG.Measure.format(o.v);
      let val = f.main;
      if (o.v.unit !== 'angle' && f.exact) val = f.exact;
      const text = (o.style.showName === false ? '' : S.displayName(o) + ' = ') + val;
      const off = o.style.labelOffset || [10, -12];
      dl.labels.push({ k: 'text', x: p[0] + off[0], y: p[1] + off[1], parts: parseText(text), size: 13, color: hl.get(o.id) && !exp ? HL.sel : o.style.color, align: 'left', id: o.id, bg: 'rgba(255,255,255,0.75)', label: true });
    }

    dl.fills.sort((a, b) => a.z - b.z);
    dl.lines.sort((a, b) => a.z - b.z);
    return dl;
  }

  SG.Renderer = { build, parseText, planeCorners, curvedGeom, circlePts, segInPoly2, HL };
})(globalThis.SG = globalThis.SG || {});
