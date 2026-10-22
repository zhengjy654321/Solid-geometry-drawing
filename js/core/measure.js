/*
 * 度量：长度、距离、各种角、面积、体积……
 * 度量本身也是场景对象（type = 'measure'），图形变化时自动更新；
 * 还可以"反向修改"：给定目标值，自动调整某个上游参数使度量等于目标值。
 */
(function (SG) {
  'use strict';
  const { V, G, Exact } = SG;
  const reg = SG.registerKind;
  const refs = (r) => (r == null ? [] : Array.isArray(r) ? r : [r]);

  function lenV(value, at) { return { value, unit: 'len', at }; }
  function angV(value, at) { return { value, unit: 'angle', at }; }

  /** 两直线所成角 [0, 90°] */
  function lineAngle(d1, d2) {
    const a = V.angle(d1, d2);
    return a > Math.PI / 2 ? Math.PI - a : a;
  }

  /** 二面角：棱 e1-e2，两个半平面分别过 p 和 q，范围 [0, 180°] */
  function dihedralHalf(e1, e2, p, q) {
    const pp = V.sub(p, G.projPointLine(p, e1, e2).q);
    const qq = V.sub(q, G.projPointLine(q, e1, e2).q);
    if (V.len(pp) < 1e-12 || V.len(qq) < 1e-12) throw new Error('点在棱上，二面角无意义');
    return V.angle(pp, qq);
  }

  const MEASURES = {
    mLength: { label: '长度 / 两点距离', inputs: ['point', 'point'], unit: 'len' },
    mDistPL: { label: '点到直线距离', inputs: ['point', 'line'], unit: 'len' },
    mDistPP: { label: '点到平面距离', inputs: ['point', 'plane'], unit: 'len' },
    mDistLL: { label: '异面直线距离', inputs: ['line', 'line'], unit: 'len' },
    mAngle3: { label: '平面角 ∠ABC', inputs: ['point', 'point', 'point'], unit: 'angle' },
    mAngleLL: { label: '两直线所成角（异面直线所成角）', inputs: ['line', 'line'], unit: 'angle' },
    mAngleLP: { label: '直线与平面所成角', inputs: ['line', 'plane'], unit: 'angle' },
    mDihedral: { label: '二面角（选两个面）', inputs: ['plane', 'plane'], unit: 'angle' },
    mDihedral4: { label: '二面角 A-BC-D（选四点）', inputs: ['point', 'point', 'point', 'point'], unit: 'angle' },
    mArea: { label: '面积', inputs: ['polygon'], unit: 'area' },
    mVolume: { label: '体积', inputs: ['solid'], unit: 'vol' },
    mSurface: { label: '表面积', inputs: ['solid'], unit: 'area' },
    mCircle: { label: '圆 / 截面圆 / 交线长', inputs: ['circle'], unit: 'len' },
    mSphere: { label: '球的半径 / 表面积 / 体积', inputs: ['sphere'], unit: 'len' },
  };

  reg('mLength', {
    type: 'measure', deps: (d) => [d.a, d.b],
    eval: (d, c) => { const A = c.pt(d.a), B = c.pt(d.b); return lenV(V.dist(A, B), V.mid(A, B)); },
  });
  reg('mDistPL', {
    type: 'measure', deps: (d) => [d.p].concat(refs(d.line)),
    eval: (d, c) => { const P = c.pt(d.p), L = c.line(d.line); const q = G.projPointLine(P, L.a, L.b).q; return lenV(V.dist(P, q), V.mid(P, q)); },
  });
  reg('mDistPP', {
    type: 'measure', deps: (d) => [d.p].concat(refs(d.plane)),
    eval: (d, c) => { const P = c.pt(d.p), pl = c.plane(d.plane); const q = G.projPointPlane(P, pl); return lenV(V.dist(P, q), V.mid(P, q)); },
  });
  reg('mDistLL', {
    type: 'measure', deps: (d) => refs(d.l1).concat(refs(d.l2)),
    eval: (d, c) => {
      const a = c.line(d.l1), b = c.line(d.l2);
      const r = G.lineLine(a.a, a.b, b.a, b.b);
      if (r.parallel) { const dd = G.distPointLine(a.a, b.a, b.b); return lenV(dd, a.a); }
      return lenV(V.dist(r.p, r.q), V.mid(r.p, r.q));
    },
  });
  reg('mAngle3', {
    type: 'measure', deps: (d) => [d.a, d.o, d.b],
    eval: (d, c) => { const O = c.pt(d.o); return angV(V.angle(V.sub(c.pt(d.a), O), V.sub(c.pt(d.b), O)), O); },
  });
  reg('mAngleLL', {
    type: 'measure', deps: (d) => refs(d.l1).concat(refs(d.l2)),
    eval: (d, c) => {
      const a = c.line(d.l1), b = c.line(d.l2);
      return angV(lineAngle(V.sub(a.b, a.a), V.sub(b.b, b.a)), V.mid(V.mid(a.a, a.b), V.mid(b.a, b.b)));
    },
  });
  reg('mAngleLP', {
    type: 'measure', deps: (d) => refs(d.line).concat(refs(d.plane)),
    eval: (d, c) => {
      const L = c.line(d.line), pl = c.plane(d.plane);
      const t = V.angle(V.sub(L.b, L.a), pl.n);
      return angV(Math.abs(Math.PI / 2 - t), V.mid(L.a, L.b));
    },
  });
  reg('mDihedral', {
    type: 'measure', deps: (d) => refs(d.p1).concat(refs(d.p2)),
    eval: (d, c) => {
      const S = c.scene;
      const ids = (r) => {
        if (Array.isArray(r)) return r;
        const o = S.map.get(r);
        return o && o.type === 'polygon' ? o.def.pts : null;
      };
      const i1 = ids(d.p1), i2 = ids(d.p2);
      if (i1 && i2) {
        const common = i1.filter((x) => i2.includes(x));
        if (common.length >= 2) {
          const E1 = c.pt(common[0]), E2 = c.pt(common[1]);
          const far = (list) => {
            let best = null, bd = 0;
            for (const id of list) {
              if (common.includes(id)) continue;
              const P = c.pt(id); const dd = G.distPointLine(P, E1, E2);
              if (dd > bd) { bd = dd; best = P; }
            }
            return best;
          };
          const p = far(i1), q = far(i2);
          if (p && q) return Object.assign(angV(dihedralHalf(E1, E2, p, q), V.mid(E1, E2)), { kind: 'dihedral' });
        }
      }
      const a = c.plane(d.p1), b = c.plane(d.p2);
      const t = V.angle(a.n, b.n);
      const at = G.planePlane(a, b);
      return Object.assign(angV(t > Math.PI / 2 ? Math.PI - t : t, at ? at.o : a.o), { kind: 'planes' });
    },
  });
  reg('mDihedral4', {
    type: 'measure', deps: (d) => [d.a, d.b, d.c, d.d],
    eval: (d, c) => { const B = c.pt(d.b), C = c.pt(d.c); return angV(dihedralHalf(B, C, c.pt(d.a), c.pt(d.d)), V.mid(B, C)); },
  });
  reg('mArea', {
    type: 'measure', deps: (d) => refs(d.poly).concat(d.pts || []),
    eval: (d, c) => {
      const pts = d.pts ? d.pts.map((id) => c.pt(id)) : c.val(d.poly).pts;
      return { value: G.polyArea(pts), unit: 'area', at: V.centroid(pts) };
    },
  });
  function solidFaces(S, c, solidId) {
    const o = S.map.get(solidId);
    return (o.faces || []).map((f) => c.val(f).pts);
  }
  function curvedOf(c, id) { const v = c.val(id); return v.curved || null; }
  reg('mVolume', {
    type: 'measure', deps: (d) => [d.solid],
    eval: (d, c) => {
      const cv = curvedOf(c, d.solid);
      if (cv) {
        const { r1, r2, h } = cv;
        const vol = cv.type === 'cylinder' ? Math.PI * r1 * r1 * h : cv.type === 'cone' ? (Math.PI * r1 * r1 * h) / 3 : (Math.PI * h * (r1 * r1 + r1 * r2 + r2 * r2)) / 3;
        return { value: vol, unit: 'vol', at: V.mid(cv.c0, cv.c1) };
      }
      const faces = solidFaces(c.scene, c, d.solid);
      if (!faces.length) throw new Error('该立体没有面');
      const all = [].concat(...faces);
      const cen = V.centroid(all);
      let vol = 0;
      for (const f of faces) for (let i = 1; i + 1 < f.length; i++) {
        vol += Math.abs(V.dot(V.sub(f[0], cen), V.cross(V.sub(f[i], cen), V.sub(f[i + 1], cen)))) / 6;
      }
      return { value: vol, unit: 'vol', at: cen };
    },
  });
  reg('mSurface', {
    type: 'measure', deps: (d) => [d.solid],
    eval: (d, c) => {
      const cv = curvedOf(c, d.solid);
      if (cv) {
        const { r1, r2, h } = cv;
        const l = Math.hypot(h, r1 - r2);
        const s = cv.type === 'cylinder' ? 2 * Math.PI * r1 * r1 + 2 * Math.PI * r1 * h : cv.type === 'cone' ? Math.PI * r1 * r1 + Math.PI * r1 * l : Math.PI * (r1 * r1 + r2 * r2 + (r1 + r2) * l);
        return { value: s, unit: 'area', at: V.mid(cv.c0, cv.c1) };
      }
      const faces = solidFaces(c.scene, c, d.solid);
      return { value: faces.reduce((s, f) => s + G.polyArea(f), 0), unit: 'area', at: V.centroid([].concat(...faces)) };
    },
  });
  reg('mCircle', {
    type: 'measure', deps: (d) => [d.circle],
    eval: (d, c) => {
      const C = c.val(d.circle);
      if (d.what === 'r') return lenV(C.r, C.c);
      if (d.what === 'area') return { value: Math.PI * C.r * C.r, unit: 'area', at: C.c };
      let total = 2 * Math.PI;
      if (C.clip) total = Arcs.clip(C, C.clip).reduce((s, [a, b]) => s + (b - a), 0);
      return lenV(total * C.r, V.add(C.c, V.scale(C.u, C.r)));
    },
  });
  reg('mSphere', {
    type: 'measure', deps: (d) => [d.sphere],
    eval: (d, c) => {
      const S = c.val(d.sphere);
      if (d.what === 'S') return { value: 4 * Math.PI * S.r * S.r, unit: 'area', at: S.c };
      if (d.what === 'V') return { value: (4 / 3) * Math.PI * S.r ** 3, unit: 'vol', at: S.c };
      return lenV(S.r, S.c);
    },
  });

  /** 圆被多边形裁剪后在多边形内部的角度区间 */
  const Arcs = {
    clip(C, poly) {
      const to2 = (p) => { const w = V.sub(p, C.c); return [V.dot(w, C.u), V.dot(w, C.v)]; };
      const q = poly.map(to2);
      const r = C.r;
      const angs = [];
      for (let i = 0; i < q.length; i++) {
        const p0 = q[i], p1 = q[(i + 1) % q.length];
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
        const A = dx * dx + dy * dy, B = 2 * (p0[0] * dx + p0[1] * dy), Cc = p0[0] * p0[0] + p0[1] * p0[1] - r * r;
        const disc = B * B - 4 * A * Cc;
        if (disc < 0 || A < 1e-20) continue;
        const sq = Math.sqrt(disc);
        for (const s of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
          if (s >= -1e-12 && s <= 1 + 1e-12) {
            let a = Math.atan2(p0[1] + s * dy, p0[0] + s * dx);
            if (a < 0) a += 2 * Math.PI;
            angs.push(a);
          }
        }
      }
      const inside = (a) => G.pointInPoly2([r * Math.cos(a), r * Math.sin(a)], q);
      if (!angs.length) return inside(0.123) ? [[0, 2 * Math.PI]] : [];
      angs.sort((a, b) => a - b);
      const out = [];
      for (let i = 0; i < angs.length; i++) {
        const a = angs[i];
        const b = i + 1 < angs.length ? angs[i + 1] : angs[0] + 2 * Math.PI;
        if (b - a < 1e-9) continue;
        if (inside((a + b) / 2)) out.push([a, b]);
      }
      return out;
    },
  };

  // ------------------------------------------------------------ 文本
  function nm(S, id) { const o = S.map.get(id); return o ? S.displayName(o) : '?'; }
  function refName(S, r, kind) {
    if (Array.isArray(r)) return (kind === 'plane' ? '平面' : '') + r.map((x) => nm(S, x)).join('');
    const o = S.map.get(r);
    if (!o) return '?';
    if (kind === 'plane' && o.type === 'polygon') return '平面' + S.displayName(o);
    if (kind === 'plane' && o.type === 'plane') return '平面' + S.displayName(o);
    return S.displayName(o);
  }
  function label(S, o) {
    const d = o.def;
    switch (d.kind) {
      case 'mLength': return '|' + nm(S, d.a) + nm(S, d.b) + '|';
      case 'mDistPL': return 'd(' + nm(S, d.p) + ', ' + refName(S, d.line) + ')';
      case 'mDistPP': return 'd(' + nm(S, d.p) + ', ' + refName(S, d.plane, 'plane') + ')';
      case 'mDistLL': return 'd(' + refName(S, d.l1) + ', ' + refName(S, d.l2) + ')';
      case 'mAngle3': return '∠' + nm(S, d.a) + nm(S, d.o) + nm(S, d.b);
      case 'mAngleLL': return refName(S, d.l1) + ' 与 ' + refName(S, d.l2) + ' 所成角';
      case 'mAngleLP': return refName(S, d.line) + ' 与 ' + refName(S, d.plane, 'plane') + ' 所成角';
      case 'mDihedral': return (o.v && o.v.kind === 'planes' ? '面面角 ' : '二面角 ') + refName(S, d.p1, 'plane') + ' / ' + refName(S, d.p2, 'plane');
      case 'mDihedral4': return '二面角 ' + nm(S, d.a) + '-' + nm(S, d.b) + nm(S, d.c) + '-' + nm(S, d.d);
      case 'mArea': return 'S(' + (d.pts ? d.pts.map((x) => nm(S, x)).join('') : refName(S, d.poly)) + ')';
      case 'mVolume': return 'V(' + nm(S, d.solid) + ')';
      case 'mSurface': return 'S表(' + nm(S, d.solid) + ')';
      case 'mCircle': return ({ r: '半径', area: '面积', len: '周长/交线长' }[d.what || 'len']) + '(' + nm(S, d.circle) + ')';
      case 'mSphere': return ({ r: '半径', S: '表面积', V: '体积' }[d.what || 'r']) + '(' + nm(S, d.sphere) + ')';
      case 'mSum': return '交线总长';
      default: return '度量';
    }
  }

  /** 把度量值格式化为 { main, exact } */
  function format(v) {
    if (!v) return { main: '—', exact: '' };
    if (v.unit === 'angle') {
      const f = Exact.fmtAngle(v.value);
      return { main: f.text, exact: f.exact || '' };
    }
    const ex = Exact.recognize(v.value);
    const main = Exact.fmtNum(v.value, 4);
    return { main, exact: ex && ex !== main ? ex : '' };
  }

  // ------------------------------------------------------------ 反向求解
  const PRIORITY = { fold: 0, planeLineAngle: 1, onLine: 2, fixedLen: 3, rotatePt: 3, tpl: 4, extrude: 4, alongNormal: 5, sphereCR: 5, onPlane: 6, onCircle: 6, onSphere: 6, offset: 7, free: 8 };

  /** 某度量的所有可调上游参数 */
  function candidateParams(S, measureId) {
    const anc = Array.from(S.ancestors(measureId));
    const out = [];
    for (const id of anc) {
      const o = S.map.get(id);
      if (!o) continue;
      for (const p of S.params(o)) {
        if (p.options || p.fixed) continue;
        const val = S.getParam(o, p);
        if (typeof val !== 'number') continue;
        out.push(Object.assign({}, p, { obj: o.id, title: S.displayName(o) + ' · ' + p.label, prio: PRIORITY[o.def.kind] != null ? PRIORITY[o.def.kind] : 9 }));
      }
    }
    out.sort((a, b) => a.prio - b.prio);
    return out;
  }

  /**
   * 调整参数 p 使度量 measureId 的值等于 target（角度以弧度给出）。
   * 返回 { ok, value, message }
   */
  function solve(S, measureId, target, p) {
    const o = S.map.get(p.obj);
    const m = S.map.get(measureId);
    const x0 = S.getParam(o, p);
    const F = (x) => {
      S.setParam(o, p, x);
      S.recompute();
      return m.v ? m.v.value - target : NaN;
    };
    const ok = (fx) => isFinite(fx) && Math.abs(fx) < 1e-10 * Math.max(1, Math.abs(target));
    const inRange = (x) => (p.min == null || x >= p.min - 1e-12) && (p.max == null || x <= p.max + 1e-12);
    // 1. 割线法
    let a = x0, fa = F(a);
    if (ok(fa)) return { ok: true, value: a };
    let b = x0 + (Math.abs(x0) > 1 ? x0 * 0.01 : 0.01), fb = F(b);
    for (let i = 0; i < 60 && isFinite(fa) && isFinite(fb); i++) {
      if (Math.abs(fb - fa) < 1e-300) break;
      const cx = b - (fb * (b - a)) / (fb - fa);
      if (!isFinite(cx) || !inRange(cx)) break;
      a = b; fa = fb; b = cx; fb = F(b);
      if (ok(fb)) return { ok: true, value: b };
    }
    // 2. 扫描 + 二分
    const span = Math.max(1, Math.abs(x0)) * 10;
    const lo = p.min != null ? p.min : x0 - span, hi = p.max != null ? p.max : x0 + span;
    const N = 600;
    let best = null;
    let px = lo, pf = F(lo);
    for (let i = 1; i <= N; i++) {
      const x = lo + ((hi - lo) * i) / N, fx = F(x);
      if (isFinite(pf) && isFinite(fx) && (pf === 0 || pf * fx < 0)) {
        let l = px, r = x, fl = pf;
        for (let k = 0; k < 100; k++) {
          const mm = (l + r) / 2, fm = F(mm);
          if (!isFinite(fm)) break;
          if (fl * fm <= 0) r = mm; else { l = mm; fl = fm; }
        }
        const root = (l + r) / 2;
        if (!best || Math.abs(root - x0) < Math.abs(best - x0)) best = root;
      }
      px = x; pf = fx;
    }
    if (best != null) { const fv = F(best); if (isFinite(fv) && Math.abs(fv) < 1e-6 * Math.max(1, Math.abs(target))) return { ok: true, value: best }; }
    F(x0);
    return { ok: false, message: '在该参数的可调范围内无法达到目标值' };
  }

  SG.Measure = { MEASURES, label, format, candidateParams, solve, lineAngle, dihedralHalf };
  SG.Arcs = Arcs;
})(globalThis.SG = globalThis.SG || {});
