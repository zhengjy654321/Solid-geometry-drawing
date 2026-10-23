/*
 * 场景模型：对象 + 构造定义（依赖图）+ 求值。
 *
 * 每个对象：
 *   { id, type, name, def: {kind, ...}, style: {...}, hidden, locked, parent, ... }
 * type ∈ point | segment | line | ray | polygon | plane | circle | sphere | solid | fold | measure | trace | mark
 * def.kind 决定如何由其他对象计算出该对象的值（o.v），所有 kind 注册在 SG.Kinds。
 * 求值时按依赖关系递归计算，因此修改任意自由参数后，所有相关对象自动更新。
 */
(function (SG) {
  'use strict';
  const { V, G } = SG;
  const D2R = Math.PI / 180;

  const Kinds = {};
  /** 注册一种构造方式 */
  function reg(kind, spec) { Kinds[kind] = Object.assign({ kind }, spec); }

  const refsOf = (r) => (r == null ? [] : Array.isArray(r) ? r.filter((x) => typeof x === 'string') : [r]);

  // ---------------------------------------------------------------- 点
  reg('free', {
    type: 'point',
    deps: () => [],
    eval: (d) => [d.x, d.y, d.z],
    params: () => [
      { key: 'x', label: 'x 坐标', step: 0.1 },
      { key: 'y', label: 'y 坐标', step: 0.1 },
      { key: 'z', label: 'z 坐标', step: 0.1 },
    ],
    draggable: true,
  });
  reg('onLine', {
    type: 'point',
    deps: (d) => [d.a, d.b],
    eval: (d, c) => V.lerp(c.pt(d.a), c.pt(d.b), d.t),
    params: (d) => [{ key: 't', label: '位置比例 t', min: d.mode === 'seg' ? 0 : -5, max: d.mode === 'seg' ? 1 : 6, step: 0.01 }],
    draggable: true,
  });
  reg('onPlane', {
    type: 'point',
    deps: (d) => refsOf(d.plane),
    eval: (d, c) => {
      const pl = c.plane(d.plane);
      return V.add(pl.o, V.add(V.scale(pl.u, d.u), V.scale(pl.v, d.v)));
    },
    params: () => [{ key: 'u', label: '面内坐标 u', step: 0.05 }, { key: 'v', label: '面内坐标 v', step: 0.05 }],
    draggable: true,
  });
  reg('onCircle', {
    type: 'point',
    deps: (d) => [d.circle],
    eval: (d, c) => {
      const C = c.val(d.circle);
      const a = d.ang * D2R;
      return V.add(C.c, V.add(V.scale(C.u, C.r * Math.cos(a)), V.scale(C.v, C.r * Math.sin(a))));
    },
    params: () => [{ key: 'ang', label: '圆上角度', min: 0, max: 360, step: 1, unit: '°' }],
    draggable: true,
  });
  reg('onSphere', {
    type: 'point',
    deps: (d) => [d.sphere],
    eval: (d, c) => {
      const S = c.val(d.sphere);
      return V.add(S.c, V.scale(dirSph(d.th, d.ph), S.r));
    },
    params: () => [
      { key: 'th', label: '方位角 θ', min: -180, max: 180, step: 1, unit: '°' },
      { key: 'ph', label: '仰角 φ', min: -90, max: 90, step: 1, unit: '°' },
    ],
    draggable: true,
  });
  function dirSph(th, ph) {
    th *= D2R; ph *= D2R;
    return [Math.cos(ph) * Math.cos(th), Math.cos(ph) * Math.sin(th), Math.sin(ph)];
  }
  /** 定长动点：到 anchor 距离为 len，可限制在某平面内（圆周）或空间（球面） */
  reg('fixedLen', {
    type: 'point',
    deps: (d) => [d.anchor].concat(refsOf(d.plane)),
    eval: (d, c) => {
      const A = c.pt(d.anchor);
      return V.add(A, V.scale(fixedLenDir(d, c), d.len));
    },
    params: (d) => {
      const ps = [{ key: 'len', label: '定长', min: 0, step: 0.1 }, { key: 'th', label: d.mode === 'plane' ? '面内角度 θ' : '方位角 θ', min: -180, max: 180, step: 1, unit: '°' }];
      if (d.mode !== 'plane') ps.push({ key: 'ph', label: '仰角 φ', min: -90, max: 90, step: 1, unit: '°' });
      return ps;
    },
    draggable: true,
  });
  function fixedLenBasis(d, c) {
    if (d.plane) { const pl = c.plane(d.plane); return { u: pl.u, v: pl.v, n: pl.n }; }
    return { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
  }
  function fixedLenDir(d, c) {
    if (d.mode === 'plane') {
      const b = fixedLenBasis(d, c);
      const t = d.th * D2R;
      return V.add(V.scale(b.u, Math.cos(t)), V.scale(b.v, Math.sin(t)));
    }
    return dirSph(d.th, d.ph || 0);
  }
  reg('offset', {
    type: 'point',
    deps: (d) => [d.base],
    eval: (d, c) => V.add(c.pt(d.base), d.vec),
    params: () => [
      { key: ['vec', 0], label: 'Δx', step: 0.1 }, { key: ['vec', 1], label: 'Δy', step: 0.1 }, { key: ['vec', 2], label: 'Δz', step: 0.1 },
    ],
    draggable: true,
  });
  /** 沿平面法向（或直线方向）移动距离 dist */
  reg('alongNormal', {
    type: 'point',
    deps: (d) => [d.base].concat(refsOf(d.plane)),
    eval: (d, c) => {
      const n = d.plane ? c.plane(d.plane).n : [0, 0, 1];
      return V.addScaled(c.pt(d.base), n, d.dist);
    },
    params: () => [{ key: 'dist', label: '距离（沿法向）', step: 0.1 }],
    draggable: true,
  });
  /** base + k·(to − from) */
  reg('byVector', {
    type: 'point',
    deps: (d) => [d.base, d.from, d.to],
    eval: (d, c) => V.addScaled(c.pt(d.base), V.sub(c.pt(d.to), c.pt(d.from)), d.k),
    params: () => [{ key: 'k', label: '倍数 k', step: 0.05 }],
  });
  reg('foot', {
    type: 'point',
    deps: (d) => [d.p].concat(refsOf(d.target)),
    eval: (d, c) => {
      const p = c.pt(d.p);
      if (d.ttype === 'plane') return G.projPointPlane(p, c.plane(d.target));
      const L = c.line(d.target);
      return G.projPointLine(p, L.a, L.b).q;
    },
  });
  reg('reflect', {
    type: 'point',
    deps: (d) => [d.p].concat(refsOf(d.target)),
    eval: (d, c) => {
      const p = c.pt(d.p);
      let q;
      if (d.ttype === 'point') q = c.pt(d.target);
      else if (d.ttype === 'plane') q = G.projPointPlane(p, c.plane(d.target));
      else { const L = c.line(d.target); q = G.projPointLine(p, L.a, L.b).q; }
      return V.sub(V.scale(q, 2), p);
    },
  });
  reg('intersect', {
    type: 'point',
    deps: (d) => refsOf(d.a).concat(refsOf(d.b)),
    eval: (d, c) => {
      const L1 = c.line(d.a);
      if (d.btype === 'plane') {
        const r = G.linePlane(L1.a, L1.b, c.plane(d.b));
        if (!r) throw new Error('直线与平面平行，无交点');
        return r.p;
      }
      const L2 = c.line(d.b);
      const r = G.lineLine(L1.a, L1.b, L2.a, L2.b);
      if (r.parallel) throw new Error('两直线平行，无交点');
      const sc = Math.max(V.dist(L1.a, L1.b), V.dist(L2.a, L2.b), 1);
      if (V.dist(r.p, r.q) > 1e-6 * sc) throw new Error('两直线异面，不相交');
      return V.mid(r.p, r.q);
    },
  });
  /** 直线、圆、球之间的交点（直线均视为无限长） */
  const Isect = {
    tol: (pts) => 1e-7 * Math.max(1, ...pts.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])))),
    quad(A, d, c, r) {
      const w = V.sub(A, c);
      const a = V.dot(d, d), b = 2 * V.dot(d, w), cc = V.dot(w, w) - r * r;
      let disc = b * b - 4 * a * cc;
      if (disc < -1e-9 * Math.max(1, b * b)) return [];
      disc = Math.max(0, disc);
      const q = Math.sqrt(disc);
      const ts = q < 1e-12 ? [-b / (2 * a)] : [(-b - q) / (2 * a), (-b + q) / (2 * a)];
      return ts.map((t) => V.addScaled(A, d, t));
    },
    lineLine(A, B, P, Q) {
      const r = G.lineLine(A, B, P, Q);
      if (r.parallel) return [];
      return V.dist(r.p, r.q) < Isect.tol([A, B, P, Q]) * 10 ? [V.mid(r.p, r.q)] : [];
    },
    lineCircle(A, B, C) {
      const d = V.sub(B, A);
      const tol = Isect.tol([A, B, C.c]) * 10;
      const den = V.dot(C.n, d);
      if (Math.abs(den) > 1e-9 * V.len(d)) {
        const t = V.dot(C.n, V.sub(C.c, A)) / den;
        const q = V.addScaled(A, d, t);
        return Math.abs(V.dist(q, C.c) - C.r) < tol ? [q] : [];
      }
      if (Math.abs(V.dot(C.n, V.sub(A, C.c))) > tol) return [];
      return Isect.quad(A, d, C.c, C.r);
    },
    lineSphere(A, B, Sp) { return Isect.quad(A, V.sub(B, A), Sp.c, Sp.r); },
    circleCircle(C1, C2) {
      const tol = Isect.tol([C1.c, C2.c]) * 10;
      if (Math.abs(Math.abs(V.dot(C1.n, C2.n)) - 1) > 1e-9 || Math.abs(V.dot(C1.n, V.sub(C2.c, C1.c))) > tol) return null;
      const dv = V.sub(C2.c, C1.c), dist = V.len(dv);
      if (dist < tol) return [];
      const u = V.scale(dv, 1 / dist);
      const a = (C1.r * C1.r - C2.r * C2.r + dist * dist) / (2 * dist);
      const h2 = C1.r * C1.r - a * a;
      if (h2 < -tol * Math.max(1, C1.r)) return [];
      const hh = Math.sqrt(Math.max(0, h2));
      const m = V.addScaled(C1.c, u, a);
      const perp = V.norm(V.cross(C1.n, u));
      return hh < 1e-12 ? [m] : [V.addScaled(m, perp, hh), V.addScaled(m, perp, -hh)];
    },
  };
  const pickRoot = (pts, which, msg) => {
    if (!pts || !pts.length) throw new Error(msg);
    return pts[Math.min(which || 0, pts.length - 1)];
  };
  reg('intersectLC', {
    type: 'point',
    deps: (d) => refsOf(d.line).concat([d.circle]),
    eval: (d, c) => { const L = c.line(d.line); return pickRoot(Isect.lineCircle(L.a, L.b, c.val(d.circle)), d.which, '直线与圆没有交点'); },
  });
  reg('intersectLS', {
    type: 'point',
    deps: (d) => refsOf(d.line).concat([d.sphere]),
    eval: (d, c) => { const L = c.line(d.line); return pickRoot(Isect.lineSphere(L.a, L.b, c.val(d.sphere)), d.which, '直线与球面没有交点'); },
  });
  reg('intersectCC', {
    type: 'point',
    deps: (d) => [d.c1, d.c2],
    eval: (d, c) => {
      const r = Isect.circleCircle(c.val(d.c1), c.val(d.c2));
      if (r === null) throw new Error('两圆不在同一平面内');
      return pickRoot(r, d.which, '两圆没有交点');
    },
  });

  reg('center', {
    type: 'point',
    deps: (d) => d.pts.slice(),
    eval: (d, c) => {
      const P = d.pts.map((id) => c.pt(id));
      if (d.ctype === 'centroid' || P.length !== 3) return V.centroid(P);
      const f = { circumcenter: G.circumcenter, incenter: G.incenter, orthocenter: G.orthocenter }[d.ctype];
      const r = f(P[0], P[1], P[2]);
      if (!r) throw new Error('三点共线');
      return r;
    },
  });
  reg('rotatePt', {
    type: 'point',
    deps: (d) => [d.p, d.a, d.b],
    eval: (d, c) => {
      const A = c.pt(d.a), k = V.norm(V.sub(c.pt(d.b), A));
      return V.rotate(c.pt(d.p), A, k, d.angle * D2R);
    },
    params: () => [{ key: 'angle', label: '旋转角', min: -360, max: 360, step: 1, unit: '°' }],
  });
  reg('sphereCenter', { type: 'point', deps: (d) => [d.sphere], eval: (d, c) => V.copy(c.val(d.sphere).c) });
  reg('circleCenter', { type: 'point', deps: (d) => [d.circle], eval: (d, c) => V.copy(c.val(d.circle).c) });
  /** 折叠：内部定义 inner 先求值，再绕折叠轴旋转 */
  reg('folded', {
    type: 'point',
    deps: (d) => [d.fold].concat(depsOfDef(d.inner)),
    eval: (d, c) => {
      const p = c.evalDef(d.inner);
      const F = c.val(d.fold);
      return V.rotate(p, F.o, F.k, F.ang);
    },
    params: (d) => paramsOfDef(d.inner).map((p) => Object.assign({}, p, { key: ['inner'].concat(p.key) })),
    draggable: false,
  });

  // ---------------------------------------------------------------- 线
  reg('twoPts', {
    type: 'segment',
    deps: (d) => [d.a, d.b],
    eval: (d, c) => ({ a: c.pt(d.a), b: c.pt(d.b) }),
  });

  // ---------------------------------------------------------------- 多边形
  reg('poly', {
    type: 'polygon',
    deps: (d) => d.pts.slice(),
    eval: (d, c) => {
      const pts = d.pts.map((id) => c.pt(id));
      const plane = G.planePoly(pts);
      if (!plane) throw new Error('多边形退化');
      return { pts, plane };
    },
  });

  // ---------------------------------------------------------------- 平面
  function mkPlane(o, n, anchors) {
    const pl = G.planePN(o, n);
    if (!pl) throw new Error('平面不确定');
    pl.anchors = anchors || [o];
    return pl;
  }
  reg('plane3', {
    type: 'plane',
    deps: (d) => [d.a, d.b, d.c],
    eval: (d, c) => {
      const A = c.pt(d.a), B = c.pt(d.b), C = c.pt(d.c);
      const pl = G.plane3(A, B, C);
      if (!pl) throw new Error('三点共线，不能确定平面');
      return mkPlane(A, pl.n, [A, B, C]);
    },
  });
  reg('planePN', {
    type: 'plane',
    deps: (d) => [d.p],
    eval: (d, c) => mkPlane(c.pt(d.p), d.n),
  });
  reg('planePerpLine', {
    type: 'plane',
    deps: (d) => [d.p].concat(refsOf(d.line)),
    eval: (d, c) => { const L = c.line(d.line); return mkPlane(c.pt(d.p), V.sub(L.b, L.a), [c.pt(d.p)]); },
  });
  reg('planeParallel', {
    type: 'plane',
    deps: (d) => [d.p].concat(refsOf(d.plane)),
    eval: (d, c) => {
      const ref = c.plane(d.plane);
      const p = c.pt(d.p);
      const anchors = (ref.anchors || [ref.o]).map((a) => V.add(G.projPointPlane(a, ref), V.scale(ref.n, V.dot(ref.n, p) - ref.d)));
      return mkPlane(p, ref.n, anchors);
    },
  });
  reg('planeLinePerp', {
    type: 'plane',
    deps: (d) => refsOf(d.line).concat(refsOf(d.plane)),
    eval: (d, c) => {
      const L = c.line(d.line), ref = c.plane(d.plane);
      const n = V.cross(V.sub(L.b, L.a), ref.n);
      if (V.len(n) < 1e-9) throw new Error('直线与平面垂直，过该直线垂直于该平面的平面不唯一');
      const len = Math.max(V.dist(L.a, L.b), 0.5);
      const m = ref.n[2] < 0 ? V.neg(ref.n) : ref.n;
      return mkPlane(L.a, n, [L.a, L.b, V.addScaled(L.a, m, len * 0.6), V.addScaled(L.b, m, len * 0.6)]);
    },
  });
  reg('planeLineAngle', {
    type: 'plane',
    deps: (d) => refsOf(d.line).concat(refsOf(d.plane)),
    eval: (d, c) => {
      const L = c.line(d.line), ref = c.plane(d.plane);
      const w = V.norm(V.sub(L.b, L.a));
      const m = ref.n;
      let mp = V.sub(m, V.scale(w, V.dot(m, w)));
      const k = V.len(mp);
      if (k < 1e-9) throw new Error('直线与参考平面垂直，任何过该直线的平面都与之垂直');
      const e1 = V.scale(mp, 1 / k), e2 = V.cross(w, e1);
      const cosT = Math.cos(d.angle * D2R);
      if (cosT > k + 1e-12) throw new Error('所给角度小于直线与平面所成的角，无法构造');
      const phi = Math.acos(Math.min(1, cosT / k)) * (d.side < 0 ? -1 : 1);
      const n = V.add(V.scale(e1, Math.cos(phi)), V.scale(e2, Math.sin(phi)));
      // 展示锚点：直线两端 + 朝"上方"延伸
      const len = V.dist(L.a, L.b);
      let up = V.norm(V.cross(n, w));
      // 展示平面的"上半部分"（在参考平面法向一侧）
      const mUp = m[2] < 0 ? V.neg(m) : m;
      if (V.dot(up, mUp) < 0) up = V.neg(up);
      return mkPlane(L.a, n, [L.a, L.b, V.addScaled(L.a, up, len * 0.6), V.addScaled(L.b, up, len * 0.6)]);
    },
    params: () => [{ key: 'angle', label: '与参考面所成角', min: 0, max: 180, step: 1, unit: '°' }],
  });
  reg('planeAxis', {
    type: 'plane',
    deps: () => [],
    eval: (d) => {
      const n = { xy: [0, 0, 1], yz: [1, 0, 0], xz: [0, 1, 0] }[d.axis];
      const o = V.scale(n, d.offset || 0);
      const s = d.size || 2;
      const t = { xy: [[s, s, 0], [-s, -s, 0]], yz: [[0, s, s], [0, -s, -s]], xz: [[s, 0, s], [-s, 0, -s]] }[d.axis];
      return mkPlane(o, n, t.map((a) => V.add(a, o)));
    },
    params: () => [{ key: 'offset', label: '偏移', step: 0.1 }, { key: 'size', label: '显示大小', min: 0.2, step: 0.1 }],
  });

  // ---------------------------------------------------------------- 圆
  function mkCircle(c, n, r, extra) {
    const pl = G.planePN(c, n);
    return Object.assign({ c, n: pl.n, r, u: pl.u, v: pl.v }, extra || {});
  }
  reg('sphereSection', {
    type: 'circle',
    deps: (d) => [d.sphere].concat(refsOf(d.plane)).concat(refsOf(d.clip)),
    eval: (d, c) => {
      const S = c.val(d.sphere), pl = c.plane(d.plane);
      const dist = V.dot(pl.n, S.c) - pl.d;
      if (Math.abs(dist) >= S.r - 1e-12) throw new Error('平面与球不相交');
      const cen = V.addScaled(S.c, pl.n, -dist);
      const r = Math.sqrt(S.r * S.r - dist * dist);
      let clip = null;
      if (d.clip) clip = c.val(d.clip).pts;
      return Object.assign({ c: cen, n: pl.n, r, u: pl.u, v: pl.v, clip, onSphere: d.sphere, dist: Math.abs(dist) });
    },
  });
  reg('circleCRN', {
    type: 'circle',
    deps: (d) => [d.center].concat(refsOf(d.plane)),
    eval: (d, c) => {
      const n = d.plane ? c.plane(d.plane).n : (d.n || [0, 0, 1]);
      return mkCircle(c.pt(d.center), n, d.r);
    },
    params: () => [{ key: 'r', label: '半径', min: 0, step: 0.1 }],
  });
  reg('circle3', {
    type: 'circle',
    deps: (d) => [d.a, d.b, d.c],
    eval: (d, c) => {
      const A = c.pt(d.a), B = c.pt(d.b), C = c.pt(d.c);
      const cc = G.circumcenter(A, B, C);
      if (!cc) throw new Error('三点共线');
      return mkCircle(cc, V.cross(V.sub(B, A), V.sub(C, A)), V.dist(cc, A));
    },
  });

  // ---------------------------------------------------------------- 球
  reg('sphereCR', {
    type: 'sphere',
    deps: (d) => [d.center],
    eval: (d, c) => ({ c: c.pt(d.center), r: d.r }),
    params: () => [{ key: 'r', label: '半径', min: 0, step: 0.1 }],
  });
  reg('sphereCP', {
    type: 'sphere',
    deps: (d) => [d.center, d.through],
    eval: (d, c) => { const C = c.pt(d.center); return { c: C, r: V.dist(C, c.pt(d.through)) }; },
  });
  reg('circumPts', {
    type: 'sphere',
    deps: (d) => d.pts.slice(),
    eval: (d, c) => SG.Spheres.circumOfPoints(d.pts.map((id) => c.pt(id))),
  });

  // ---------------------------------------------------------------- 折叠
  reg('fold', {
    type: 'fold',
    deps: (d) => [d.a, d.b],
    eval: (d, c) => {
      const A = c.pt(d.a), B = c.pt(d.b);
      const k = V.norm(V.sub(B, A));
      if (V.len(k) < 0.5) throw new Error('折痕两点重合');
      return { o: A, k, ang: d.angle * D2R * (d.dir || 1) };
    },
    params: () => [{ key: 'angle', label: '折叠角（旋转角）', min: 0, max: 180, step: 1, unit: '°' }],
  });

  // ---------------------------------------------------------------- 轨迹 / 标注
  reg('trace', {
    type: 'trace',
    deps: (d) => [d.p],
    eval: (d, c, o) => ({ pts: o.data || [] }),
  });
  reg('rightAngle', {
    type: 'mark',
    deps: (d) => [d.a, d.o, d.b],
    eval: (d, c) => ({ a: c.pt(d.a), o: c.pt(d.o), b: c.pt(d.b) }),
  });
  reg('angleArc', {
    type: 'mark',
    deps: (d) => [d.a, d.o, d.b],
    eval: (d, c) => ({ a: c.pt(d.a), o: c.pt(d.o), b: c.pt(d.b) }),
  });
  reg('text', {
    type: 'mark',
    deps: (d) => refsOf(d.at),
    eval: (d, c) => ({ p: d.at ? c.pt(d.at) : d.pos }),
  });

  function depsOfDef(def) {
    const k = Kinds[def.kind];
    if (!k) return [];
    return k.deps(def).filter((x) => typeof x === 'string');
  }
  function paramsOfDef(def) {
    const k = Kinds[def.kind];
    if (!k || !k.params) return [];
    return k.params(def).map((p) => Object.assign({}, p, { key: Array.isArray(p.key) ? p.key : [p.key] }));
  }

  // ================================================================ Scene
  const POINT_NAMES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const PLANE_NAMES = ['α', 'β', 'γ', 'δ', 'ε', 'η', 'θ', 'λ', 'μ', 'π'];
  const LINE_TYPES = new Set(['segment', 'line', 'ray']);

  class Scene {
    constructor() {
      this.objects = [];
      this.map = new Map();
      this.seq = 0;
      this.listeners = [];
    }

    clear() {
      this.objects = [];
      this.map = new Map();
      this.seq = 0;
    }

    add(o) {
      if (!o.id) o.id = 'o' + (++this.seq);
      else {
        const m = /^o(\d+)$/.exec(o.id);
        if (m) this.seq = Math.max(this.seq, +m[1]);
      }
      o.style = Object.assign({}, SG.Style.defaults(o), o.style && typeof o.style === 'object' ? o.style : {});
      if (o.name === undefined) o.name = this.autoName(o.type);
      this.objects.push(o);
      this.map.set(o.id, o);
      return o;
    }

    get(ref) {
      if (ref == null) return null;
      if (typeof ref === 'object') return ref;
      return this.map.get(ref) || this.byName(ref);
    }

    byName(name) {
      if (name == null) return null;
      const n = String(name).replace(/_/g, '').replace(/\s/g, '');
      for (const o of this.objects) if (o.name != null && String(o.name).replace(/_/g, '') === n) return o;
      // 线段、多边形用顶点名查找，如 "AB"、"ABCD"
      for (const o of this.objects) {
        if (!o.name && (LINE_TYPES.has(o.type) || o.type === 'polygon' || o.type === 'sphere')) {
          if (this.displayName(o).replace(/_/g, '') === n) return o;
        }
      }
      return null;
    }

    nameUsed(name, except) {
      const n = String(name).replace(/_/g, '');
      return this.objects.some((o) => o !== except && o.name != null && String(o.name).replace(/_/g, '') === n);
    }

    autoName(type) {
      if (type === 'point') {
        for (let k = 0; k < 20; k++) {
          for (const ch of POINT_NAMES) {
            const nm = k === 0 ? ch : ch + k;
            if (!this.nameUsed(nm)) return nm;
          }
        }
      }
      if (type === 'plane') {
        for (let k = 0; k < 20; k++) {
          for (const ch of PLANE_NAMES) {
            const nm = k === 0 ? ch : ch + k;
            if (!this.nameUsed(nm)) return nm;
          }
        }
      }
      return null;
    }

    /** 找一个连续的字母段，用于模板体命名，例如 4 个顶点 → A,B,C,D */
    freshLetters(count, avoid) {
      avoid = avoid || [];
      const letters = POINT_NAMES.filter((c) => !avoid.includes(c) && c !== 'O' && c !== 'P');
      for (let k = 0; k < 20; k++) {
        const suf = k === 0 ? '' : String(k);
        for (let s = 0; s + count <= letters.length; s++) {
          const names = letters.slice(s, s + count).map((c) => c + suf);
          if (names.every((n) => !this.nameUsed(n))) return names;
        }
      }
      return new Array(count).fill(null).map(() => this.autoName('point'));
    }

    freshName(pref) {
      if (!this.nameUsed(pref)) return pref;
      const m = /^(.*?)(\d*)$/.exec(pref);
      const base = m[1] || pref;
      for (let k = (+m[2] || 0) + 1; k < 200; k++) if (!this.nameUsed(base + k)) return base + k;
      return this.autoName('point');
    }

    displayName(o) {
      if (!o) return '';
      if (o.name) return o.name;
      const nm = (id) => { const x = this.map.get(id); return x ? x.name || '?' : '?'; };
      switch (o.type) {
        case 'segment': case 'line': case 'ray': return nm(o.def.a) + nm(o.def.b);
        case 'polygon': return o.def.pts.map(nm).join('');
        case 'sphere': {
          const c = this.objects.find((x) => x.type === 'point' && x.def.kind === 'sphereCenter' && x.def.sphere === o.id);
          const cn = o.def.center ? nm(o.def.center) : c ? c.name : '';
          return '球' + cn;
        }
        case 'circle': return o.def.kind === 'sphereSection' ? '截面圆' : '圆';
        case 'fold': return '折叠 ' + nm(o.def.a) + nm(o.def.b);
        case 'measure': return SG.Measure ? SG.Measure.label(this, o) : '度量';
        case 'trace': return '轨迹(' + nm(o.def.p) + ')';
        case 'mark': return o.def.kind === 'rightAngle' ? '直角标记' : o.def.kind === 'text' ? '文字' : '角标记';
        default: return o.type;
      }
    }

    deps(o) {
      const k = Kinds[o.def.kind];
      if (!k) return [];
      return k.deps(o.def).filter((x) => typeof x === 'string');
    }

    /** 所有（直接或间接）依赖于 ids 的对象 */
    dependents(ids) {
      const set = new Set(ids);
      let changed = true;
      while (changed) {
        changed = false;
        for (const o of this.objects) {
          if (set.has(o.id)) continue;
          if (this.deps(o).some((d) => set.has(d)) || (o.parent && set.has(o.parent) && o.type !== 'point')) {
            set.add(o.id); changed = true;
          }
        }
      }
      return set;
    }

    /** 上游依赖闭包 */
    ancestors(id) {
      const out = new Set();
      const st = [id];
      while (st.length) {
        const x = st.pop();
        const o = this.map.get(x);
        if (!o) continue;
        for (const d of this.deps(o)) if (!out.has(d)) { out.add(d); st.push(d); }
        if (o.type === 'solid' && o.parentBase) for (const d of o.parentBase) if (!out.has(d)) { out.add(d); st.push(d); }
      }
      return out;
    }

    remove(ids) {
      if (!Array.isArray(ids)) ids = [ids];
      // 删除折叠时先解除折叠，而不是删掉被折叠的点
      for (const id of ids) {
        const o = this.map.get(id);
        if (o && o.type === 'fold') this.unfold(o.id);
      }
      const set = this.dependents(ids.filter((id) => this.map.has(id)));
      // 删除立体时同时删除它生成的面、棱
      for (const id of Array.from(set)) {
        const o = this.map.get(id);
        if (o && o.type === 'solid') {
          for (const f of (o.faces || []).concat(o.edges || [])) {
            const x = this.map.get(f);
            if (x && x.parent === o.id) set.add(f);
          }
        }
      }
      const more = this.dependents(Array.from(set));
      for (const id of more) set.add(id);
      this.objects = this.objects.filter((o) => !set.has(o.id));
      for (const id of set) this.map.delete(id);
      for (const o of this.objects) {
        if (o.type === 'solid') {
          o.faces = (o.faces || []).filter((f) => this.map.has(f));
          o.edges = (o.edges || []).filter((f) => this.map.has(f));
        }
      }
      return set;
    }

    unfold(foldId) {
      for (const o of this.objects) {
        if (o.type === 'point' && o.def.kind === 'folded' && o.def.fold === foldId) o.def = o.def.inner;
      }
    }

    // ------------------------------------------------------------ 求值
    recompute() {
      this._memo = new Set();
      this._stack = new Set();
      for (const o of this.objects) this.evalObj(o);
      this._memo = null;
    }

    evalObj(o) {
      if (this._memo && this._memo.has(o.id)) return;
      if (this._stack.has(o.id)) { o.v = null; o.err = '循环依赖'; return; }
      this._stack.add(o.id);
      const k = Kinds[o.def.kind];
      try {
        if (!k) throw new Error('未知构造: ' + o.def.kind);
        o.v = k.eval(o.def, this.ctx, o);
        o.err = null;
      } catch (e) {
        o.v = null;
        o.err = e.message || String(e);
      }
      this._stack.delete(o.id);
      if (this._memo) this._memo.add(o.id);
    }

    get ctx() {
      if (this._ctx) return this._ctx;
      const S = this;
      const val = (id) => {
        const o = S.map.get(id);
        if (!o) throw new Error('引用的对象不存在');
        if (!S._memo) S._memo = new Set();
        if (!S._stack) S._stack = new Set();
        S.evalObj(o);
        if (o.err) throw new Error((S.displayName(o) || '依赖对象') + ' 无效');
        return o.v;
      };
      const pt = (id) => {
        const v = val(id);
        if (!Array.isArray(v)) throw new Error('需要点');
        return v;
      };
      this._ctx = {
        scene: S,
        val, pt,
        line(ref) {
          if (Array.isArray(ref)) return { a: pt(ref[0]), b: pt(ref[1]) };
          const o = S.map.get(ref);
          if (!o) throw new Error('引用的直线不存在');
          const v = val(ref);
          if (LINE_TYPES.has(o.type)) return v;
          throw new Error('需要直线');
        },
        plane(ref) {
          if (Array.isArray(ref)) {
            const A = pt(ref[0]), B = pt(ref[1]), C = pt(ref[2]);
            const pl = G.plane3(A, B, C);
            if (!pl) throw new Error('三点共线，不能确定平面');
            pl.anchors = [A, B, C];
            return pl;
          }
          const o = S.map.get(ref);
          if (!o) throw new Error('引用的平面不存在');
          const v = val(ref);
          if (o.type === 'plane') return v;
          if (o.type === 'polygon') return Object.assign({}, v.plane, { anchors: v.pts });
          if (o.type === 'circle') { const pl = G.planePN(v.c, v.n); pl.anchors = [v.c]; return pl; }
          throw new Error('需要平面');
        },
        evalDef(def) {
          const k = Kinds[def.kind];
          return k.eval(def, S.ctx, null);
        },
      };
      return this._ctx;
    }

    /** 计算一个临时 def 的值（不加入场景） */
    evalDef(def) {
      this._memo = this._memo || new Set();
      this._stack = this._stack || new Set();
      return Kinds[def.kind].eval(def, this.ctx, null);
    }

    // ------------------------------------------------------------ 参数
    params(o) {
      if (o.type === 'solid' && SG.Solids) return SG.Solids.params(o);
      return paramsOfDef(o.def).map((p) => Object.assign({ obj: o.id }, p));
    }
    getParam(o, p) {
      let x = o.type === 'solid' && p.solid ? o.def.params : o.def;
      for (const k of p.key) x = x[k];
      return x;
    }
    setParam(o, p, val) {
      let x = o.type === 'solid' && p.solid ? o.def.params : o.def;
      for (let i = 0; i < p.key.length - 1; i++) x = x[p.key[i]];
      x[p.key[p.key.length - 1]] = val;
    }

    // ------------------------------------------------------------ 序列化
    toJSON() {
      return {
        app: 'solid-geometry-drawing',
        version: 1,
        objects: this.objects.map((o) => {
          const r = {};
          for (const k of Object.keys(o)) if (k !== 'v' && k !== 'err' && k[0] !== '_') r[k] = o[k];
          return JSON.parse(JSON.stringify(r));
        }),
      };
    }
    load(json) {
      this.clear();
      for (const o of json.objects || []) this.add(o);
    }
  }

  SG.Kinds = Kinds;
  SG.Isect = Isect;
  SG.registerKind = reg;
  SG.Scene = Scene;
  SG.depsOfDef = depsOfDef;
  SG.paramsOfDef = paramsOfDef;
  SG.dirSph = dirSph;
  SG.fixedLenDir = fixedLenDir;
  SG.fixedLenBasis = fixedLenBasis;
  SG.LINE_TYPES = LINE_TYPES;
  SG.D2R = D2R;
})(globalThis.SG = globalThis.SG || {});
