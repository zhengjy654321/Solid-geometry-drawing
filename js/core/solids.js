/*
 * 常用图形模板（立体 + 平面），以及外接球 / 内切球 / 棱切球的计算。
 * 模板立体是"参数化"的：顶点由参数（棱长、高等）实时计算，修改参数即可改变整个图形。
 */
(function (SG) {
  'use strict';
  const { V, G } = SG;
  const reg = SG.registerKind;
  const D2R = Math.PI / 180;

  function regPoly(n, a) {
    const R = a / (2 * Math.sin(Math.PI / n));
    const out = [];
    for (let k = 0; k < n; k++) {
      const t = -Math.PI / n + (2 * Math.PI * k) / n;
      out.push([R * Math.cos(t), R * Math.sin(t)]);
    }
    return out;
  }
  function prismTopo(n) {
    const edges = [], faces = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      edges.push([i, j], [n + i, n + j], [i, n + i]);
      faces.push([i, j, n + j, n + i]);
    }
    faces.push(Array.from({ length: n }, (_, i) => n - 1 - i));
    faces.push(Array.from({ length: n }, (_, i) => n + i));
    return { edges, faces };
  }
  function pyramidTopo(n) {
    const edges = [], faces = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      edges.push([i, j], [i, n]);
      faces.push([i, j, n]);
    }
    faces.push(Array.from({ length: n }, (_, i) => n - 1 - i));
    return { edges, faces };
  }
  const apexOptions = (n) => [{ value: 'center', label: '底面中心正上方' }].concat(
    Array.from({ length: n }, (_, i) => ({ value: 'v' + i, label: '第' + (i + 1) + '个底面顶点正上方（侧棱⊥底面）' })));
  function apexPos(base, mode, h) {
    if (typeof mode === 'string' && mode[0] === 'v') {
      const b = base[+mode.slice(1)] || base[0];
      return [b[0], b[1], h];
    }
    const c = V.centroid(base.map((p) => [p[0], p[1], 0]));
    return [c[0], c[1], h];
  }
  const polyNames = { prism: true };

  /**
   * 模板定义：params 为可编辑参数，build(p) 返回局部坐标顶点与拓扑。
   * names(scene) 返回顶点名称。局部坐标系 (x, y, z) 映射到 frame 的 (u, v, n)。
   */
  const T = {
    cube: {
      label: '正方体', dim: 3,
      params: [{ key: 'a', label: '棱长', def: 2, min: 0.1 }],
      build(p) {
        return T.cuboid.build({ a: p.a, b: p.a, c: p.a });
      },
      names: (S) => prismNames(S, 4),
    },
    cuboid: {
      label: '长方体', dim: 3,
      params: [{ key: 'a', label: '长 (DA, x向)', def: 2, min: 0.1 }, { key: 'b', label: '宽 (DC, y向)', def: 3, min: 0.1 }, { key: 'c', label: '高 (DD₁)', def: 2, min: 0.1 }],
      build(p) {
        const base = [[p.a, 0], [p.a, p.b], [0, p.b], [0, 0]];
        const pts = base.map((q) => [q[0], q[1], 0]).concat(base.map((q) => [q[0], q[1], p.c]));
        return Object.assign({ pts }, prismTopo(4));
      },
      names: (S) => prismNames(S, 4),
    },
    prism: {
      label: '正棱柱', dim: 3,
      params: [{ key: 'n', label: '边数 n', def: 3, min: 3, max: 12, int: true, fixed: true }, { key: 'a', label: '底面边长', def: 2, min: 0.1 }, { key: 'h', label: '高', def: 3, min: 0.1 }],
      build(p) {
        const base = regPoly(p.n, p.a);
        const pts = base.map((q) => [q[0], q[1], 0]).concat(base.map((q) => [q[0], q[1], p.h]));
        return Object.assign({ pts }, prismTopo(p.n));
      },
      names: (S, p) => prismNames(S, p.n),
    },
    pyramid: {
      label: '正棱锥', dim: 3,
      params: [{ key: 'n', label: '边数 n', def: 4, min: 3, max: 12, int: true, fixed: true }, { key: 'a', label: '底面边长', def: 2, min: 0.1 }, { key: 'h', label: '高', def: 3, min: 0.1 },
        { key: 'apex', label: '顶点位置', def: 'center', options: (p) => apexOptions(p.n) }],
      build(p) {
        const base = regPoly(p.n, p.a);
        const pts = base.map((q) => [q[0], q[1], 0]);
        pts.push(apexPos(base, p.apex, p.h));
        return Object.assign({ pts }, pyramidTopo(p.n));
      },
      names: (S, p) => pyramidNames(S, p.n),
    },
    rectPyramid: {
      label: '矩形底四棱锥', dim: 3,
      params: [{ key: 'a', label: '底面长 (x向)', def: 2, min: 0.1 }, { key: 'b', label: '底面宽 (y向)', def: 3, min: 0.1 }, { key: 'h', label: '高', def: 3, min: 0.1 },
        { key: 'apex', label: '顶点位置', def: 'v3', options: () => apexOptions(4) }],
      build(p) {
        const base = [[p.a, 0], [p.a, p.b], [0, p.b], [0, 0]];
        const pts = base.map((q) => [q[0], q[1], 0]);
        pts.push(apexPos(base, p.apex, p.h));
        return Object.assign({ pts }, pyramidTopo(4));
      },
      names: (S) => pyramidNames(S, 4),
    },
    frustum: {
      label: '正棱台', dim: 3,
      params: [{ key: 'n', label: '边数 n', def: 4, min: 3, max: 12, int: true, fixed: true }, { key: 'a', label: '下底边长', def: 3, min: 0.1 }, { key: 'a2', label: '上底边长', def: 1.6, min: 0.01 }, { key: 'h', label: '高', def: 2, min: 0.1 }],
      build(p) {
        const b = regPoly(p.n, p.a), t = regPoly(p.n, p.a2);
        const pts = b.map((q) => [q[0], q[1], 0]).concat(t.map((q) => [q[0], q[1], p.h]));
        return Object.assign({ pts }, prismTopo(p.n));
      },
      names: (S, p) => prismNames(S, p.n),
    },
    tetra: {
      label: '正四面体', dim: 3,
      params: [{ key: 'a', label: '棱长', def: 2.5, min: 0.1 }],
      build(p) {
        const base = regPoly(3, p.a);
        const h = p.a * Math.sqrt(2 / 3);
        const pts = [[0, 0, h]].concat(base.map((q) => [q[0], q[1], 0]));
        return { pts, edges: [[0, 1], [0, 2], [0, 3], [1, 2], [2, 3], [3, 1]], faces: [[1, 3, 2], [0, 1, 2], [0, 2, 3], [0, 3, 1]] };
      },
      names: (S) => S.freshLetters(4),
    },
    corner: {
      label: '墙角三棱锥', dim: 3,
      desc: 'P-ABC，PA、PB、PC 两两垂直',
      params: [{ key: 'a', label: 'PA', def: 2, min: 0.1 }, { key: 'b', label: 'PB', def: 2, min: 0.1 }, { key: 'c', label: 'PC', def: 2, min: 0.1 }],
      build(p) {
        const pts = [[0, 0, 0], [p.a, 0, 0], [0, p.b, 0], [0, 0, p.c]];
        return { pts, edges: [[0, 1], [0, 2], [0, 3], [1, 2], [2, 3], [3, 1]], faces: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]] };
      },
      names: (S) => apexFirstNames(S, 3),
    },
    bienao: {
      label: '鳖臑', dim: 3,
      desc: 'P-ABC，PA⊥平面ABC，AB⊥BC，四个面都是直角三角形',
      params: [{ key: 'a', label: 'AB', def: 2, min: 0.1 }, { key: 'b', label: 'BC', def: 2, min: 0.1 }, { key: 'h', label: 'PA', def: 2.5, min: 0.1 }],
      build(p) {
        const pts = [[0, 0, p.h], [0, 0, 0], [0, p.a, 0], [-p.b, p.a, 0]];
        return { pts, edges: [[0, 1], [0, 2], [0, 3], [1, 2], [2, 3], [3, 1]], faces: [[1, 3, 2], [0, 1, 2], [0, 2, 3], [0, 3, 1]] };
      },
      names: (S) => apexFirstNames(S, 3),
    },
    qiandu: {
      label: '堑堵', dim: 3,
      desc: '直三棱柱 ABC-A₁B₁C₁，底面为直角三角形，∠ABC=90°',
      params: [{ key: 'a', label: 'AB', def: 2, min: 0.1 }, { key: 'b', label: 'BC', def: 2.5, min: 0.1 }, { key: 'h', label: '高 AA₁', def: 2, min: 0.1 }],
      build(p) {
        const base = [[p.a, 0], [0, 0], [0, p.b]];
        const pts = base.map((q) => [q[0], q[1], 0]).concat(base.map((q) => [q[0], q[1], p.h]));
        const t = prismTopo(3);
        // 底面顶点顺序为顺时针，翻转面方向
        return { pts, edges: t.edges, faces: t.faces.map((f) => f.slice().reverse()) };
      },
      names: (S) => prismNames(S, 3),
    },
    cylinder: {
      label: '圆柱', dim: 3, curved: 'cylinder',
      params: [{ key: 'r', label: '底面半径', def: 1.2, min: 0.05 }, { key: 'h', label: '高', def: 3, min: 0.05 }],
      build: (p) => ({ pts: [[0, 0, 0], [0, 0, p.h]], edges: [], faces: [], curved: { type: 'cylinder', r1: p.r, r2: p.r, h: p.h } }),
      names: (S) => twoNames(S, 'O', 'O1'),
    },
    cone: {
      label: '圆锥', dim: 3, curved: 'cone',
      params: [{ key: 'r', label: '底面半径', def: 1.5, min: 0.05 }, { key: 'h', label: '高', def: 3, min: 0.05 }],
      build: (p) => ({ pts: [[0, 0, 0], [0, 0, p.h]], edges: [], faces: [], curved: { type: 'cone', r1: p.r, r2: 0, h: p.h } }),
      names: (S) => twoNames(S, 'O', 'P'),
    },
    coneFrustum: {
      label: '圆台', dim: 3, curved: 'cfrustum',
      params: [{ key: 'r1', label: '下底半径', def: 1.6, min: 0.05 }, { key: 'r2', label: '上底半径', def: 0.8, min: 0.01 }, { key: 'h', label: '高', def: 2, min: 0.05 }],
      build: (p) => ({ pts: [[0, 0, 0], [0, 0, p.h]], edges: [], faces: [], curved: { type: 'cfrustum', r1: p.r1, r2: p.r2, h: p.h } }),
      names: (S) => twoNames(S, 'O', 'O1'),
    },

    // -------------------------------------------- 平面图形（在工作面内）
    triEq: {
      label: '正三角形', dim: 2,
      params: [{ key: 'a', label: '边长', def: 2, min: 0.1 }],
      build: (p) => poly2([[-p.a / 2, 0], [p.a / 2, 0], [0, (p.a * Math.sqrt(3)) / 2]]),
      names: (S) => S.freshLetters(3),
    },
    triRight: {
      label: '直角三角形', dim: 2, desc: '∠C = 90°',
      params: [{ key: 'a', label: 'BC', def: 3, min: 0.1 }, { key: 'b', label: 'AC', def: 2, min: 0.1 }],
      build: (p) => poly2([[0, p.b], [p.a, 0], [0, 0]]),
      names: (S) => S.freshLetters(3),
    },
    triIso: {
      label: '等腰三角形', dim: 2, desc: 'AB 为底边',
      params: [{ key: 'b', label: '底边 AB', def: 2, min: 0.1 }, { key: 'h', label: '底边上的高', def: 2, min: 0.1 }],
      build: (p) => poly2([[-p.b / 2, 0], [p.b / 2, 0], [0, p.h]]),
      names: (S) => S.freshLetters(3),
    },
    square: {
      label: '正方形', dim: 2,
      params: [{ key: 'a', label: '边长', def: 2, min: 0.1 }],
      build: (p) => poly2([[0, 0], [p.a, 0], [p.a, p.a], [0, p.a]]),
      names: (S) => S.freshLetters(4),
    },
    rect: {
      label: '矩形', dim: 2,
      params: [{ key: 'a', label: '长 AB', def: 3, min: 0.1 }, { key: 'b', label: '宽 BC', def: 2, min: 0.1 }],
      build: (p) => poly2([[0, 0], [p.a, 0], [p.a, p.b], [0, p.b]]),
      names: (S) => S.freshLetters(4),
    },
    regPoly: {
      label: '正多边形', dim: 2,
      params: [{ key: 'n', label: '边数 n', def: 6, min: 3, max: 20, int: true, fixed: true }, { key: 'a', label: '边长', def: 1.5, min: 0.1 }],
      build: (p) => {
        const R = p.a / (2 * Math.sin(Math.PI / p.n));
        const out = [];
        for (let k = 0; k < p.n; k++) {
          const t = -Math.PI / 2 - Math.PI / p.n + (2 * Math.PI * k) / p.n;
          out.push([R * Math.cos(t), R * Math.sin(t)]);
        }
        return poly2(out);
      },
      names: (S, p) => S.freshLetters(p.n),
    },
    parallelogram: {
      label: '平行四边形', dim: 2,
      params: [{ key: 'a', label: 'AB', def: 3, min: 0.1 }, { key: 'b', label: 'AD', def: 2, min: 0.1 }, { key: 'ang', label: '∠DAB', def: 60, min: 1, max: 179, unit: '°' }],
      build: (p) => {
        const c = Math.cos(p.ang * D2R) * p.b, s = Math.sin(p.ang * D2R) * p.b;
        return poly2([[0, 0], [p.a, 0], [p.a + c, s], [c, s]]);
      },
      names: (S) => S.freshLetters(4),
    },
    rhombus: {
      label: '菱形', dim: 2,
      params: [{ key: 'a', label: '边长', def: 2, min: 0.1 }, { key: 'ang', label: '∠DAB', def: 60, min: 1, max: 179, unit: '°' }],
      build: (p) => {
        const c = Math.cos(p.ang * D2R) * p.a, s = Math.sin(p.ang * D2R) * p.a;
        return poly2([[0, 0], [p.a, 0], [p.a + c, s], [c, s]]);
      },
      names: (S) => S.freshLetters(4),
    },
    trapezoid: {
      label: '梯形', dim: 2,
      params: [{ key: 'a', label: '下底 AB', def: 4, min: 0.1 }, { key: 'b', label: '上底 DC', def: 2, min: 0.01 }, { key: 'h', label: '高', def: 2, min: 0.1 },
        { key: 'kind', label: '类型', def: 'iso', options: () => [{ value: 'iso', label: '等腰梯形' }, { value: 'right', label: '直角梯形（∠A=90°）' }] }],
      build: (p) => {
        if (p.kind === 'right') return poly2([[0, 0], [p.a, 0], [p.b, p.h], [0, p.h]]);
        return poly2([[-p.a / 2, 0], [p.a / 2, 0], [p.b / 2, p.h], [-p.b / 2, p.h]]);
      },
      names: (S) => S.freshLetters(4),
    },
  };
  void polyNames;

  function poly2(pts2) {
    // 居中
    const c = pts2.reduce((s, p) => [s[0] + p[0] / pts2.length, s[1] + p[1] / pts2.length], [0, 0]);
    const pts = pts2.map((p) => [p[0] - c[0], p[1] - c[1], 0]);
    const n = pts.length;
    const edges = pts.map((_, i) => [i, (i + 1) % n]);
    return { pts, edges, faces: [pts.map((_, i) => i)], planar: true };
  }

  function prismNames(S, n) {
    const letters = 'ABCDEFGHIJKLMNQRSTUVWXYZ'.split('');
    for (let k = 0; k < 10; k++) {
      const sfx = k === 0 ? '' : String(k * 2);
      for (let s = 0; s + n <= letters.length; s++) {
        const base = letters.slice(s, s + n).map((c) => c + sfx);
        const top = letters.slice(s, s + n).map((c) => c + (k === 0 ? '1' : String(k * 2 + 1)));
        if (base.concat(top).every((x) => !S.nameUsed(x))) return base.concat(top);
      }
    }
    return S.freshLetters(2 * n);
  }
  function pyramidNames(S, n) {
    const apex = ['P', 'S', 'V'].find((x) => !S.nameUsed(x)) || S.freshName('P');
    return S.freshLetters(n, [apex]).concat([apex]);
  }
  function apexFirstNames(S, n) {
    const apex = ['P', 'S', 'V'].find((x) => !S.nameUsed(x)) || S.freshName('P');
    return [apex].concat(S.freshLetters(n, [apex]));
  }

  function twoNames(S, a, b) {
    const x = S.freshName(a);
    let y = S.freshName(b);
    if (y === x) { const m = /^(.*?)(\d*)$/.exec(x); y = S.freshName(m[1] + ((+m[2] || 0) + 1)); }
    return [x, y];
  }

  function frameDefault() { return { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }; }
  function toWorld(f, p) {
    return [
      f.o[0] + p[0] * f.u[0] + p[1] * f.v[0] + p[2] * f.n[0],
      f.o[1] + p[0] * f.u[1] + p[1] * f.v[1] + p[2] * f.n[1],
      f.o[2] + p[0] * f.u[2] + p[1] * f.v[2] + p[2] * f.n[2],
    ];
  }

  // ------------------------------------------------------------ 立体的构造方式
  reg('tpl', {
    type: 'solid',
    deps: () => [],
    eval: (d) => {
      const t = T[d.tpl];
      if (!t) throw new Error('未知模板');
      const b = t.build(d.params);
      const f = d.frame || frameDefault();
      const out = { pts: b.pts.map((p) => toWorld(f, p)) };
      if (b.curved) {
        out.curved = Object.assign({}, b.curved, { c0: out.pts[0], c1: out.pts[1], u: f.u, v: f.v, n: f.n });
      }
      return out;
    },
  });
  /** 由底面多边形拉伸为柱、收缩为锥/台 */
  reg('extrude', {
    type: 'solid',
    deps: (d) => d.base.concat(d.apex ? [d.apex] : []).concat(d.top ? [d.top] : []),
    eval: (d, c) => {
      const base = d.base.map((id) => c.pt(id));
      const pl = G.planePoly(base);
      if (!pl) throw new Error('底面退化');
      const n = V.scale(pl.n, d.sign || 1);
      const cen = V.centroid(base);
      if (d.mode === 'prism') {
        const vec = d.top ? V.sub(c.pt(d.top), base[0]) : V.scale(n, d.h);
        return { pts: (d.top ? base.slice(1) : base).map((p) => V.add(p, vec)), n };
      }
      if (d.mode === 'pyramid') {
        if (d.apex) return { pts: [], n };
        return { pts: [V.addScaled(cen, n, d.h)], n };
      }
      // frustum
      return { pts: base.map((p) => V.addScaled(V.lerp(cen, p, d.k), n, d.h)), n };
    },
  });
  reg('hull', { type: 'solid', deps: (d) => d.pts.slice(), eval: (d, c) => ({ pts: [], src: d.pts.map((id) => c.pt(id)) }) });
  reg('solidVertex', {
    type: 'point',
    deps: (d) => [d.solid],
    eval: (d, c) => {
      const v = c.val(d.solid).pts[d.index];
      if (!v) throw new Error('顶点不存在');
      return V.copy(v);
    },
  });

  // ------------------------------------------------------------ 特殊球
  const Spheres = {
    circumOfPoints(P) {
      if (P.length < 4) throw new Error('至少需要 4 个不共面的点');
      const A = P.map((p) => [2 * p[0], 2 * p[1], 2 * p[2], 1]);
      const b = P.map((p) => V.len2(p));
      const x = G.leastSquares(A, b);
      if (!x) throw new Error('这些点共面，外接球不唯一');
      const c = [x[0], x[1], x[2]];
      const r2 = x[3] + V.len2(c);
      if (!(r2 > 0)) throw new Error('无法求出外接球');
      const r = Math.sqrt(r2);
      const dev = Math.max(...P.map((p) => Math.abs(V.dist(p, c) - r)));
      const exact = dev < 1e-6 * Math.max(1, r);
      return { c, r, exact, note: exact ? '' : '这些点不在同一个球面上，显示的是最小二乘近似球' };
    },
    /** planes: [{n(外法向), d}] */
    inOfPlanes(planes, start) {
      const A = planes.map((p) => [p.n[0], p.n[1], p.n[2], 1]);
      const b = planes.map((p) => p.d);
      const x = G.leastSquares(A, b);
      if (x && x[3] > 0) {
        const c = [x[0], x[1], x[2]];
        const dev = Math.max(...planes.map((p) => Math.abs(p.d - V.dot(p.n, c) - x[3])));
        if (dev < 1e-6 * Math.max(1, x[3])) return { c, r: x[3], exact: true, note: '' };
      }
      const f = (c) => -Math.min(...planes.map((p) => p.d - V.dot(p.n, c)));
      const r = G.nelderMead(f, start.slice(), 0.3, 4000);
      return { c: r.x, r: -r.fx, exact: false, note: '该几何体不存在与所有面都相切的内切球，显示的是最大内含球' };
    },
    midOfEdges(edges, start) {
      const dist = (c) => edges.map(([a, b]) => G.distPointLine(c, a, b));
      const f = (c) => {
        const ds = dist(c);
        const m = ds.reduce((s, x) => s + x, 0) / ds.length;
        return ds.reduce((s, x) => s + (x - m) * (x - m), 0);
      };
      let best = G.nelderMead(f, start.slice(), 0.3, 6000);
      best = G.nelderMead(f, best.x, 0.01, 6000);
      const ds = dist(best.x);
      const r = ds.reduce((s, x) => s + x, 0) / ds.length;
      const dev = Math.max(...ds.map((x) => Math.abs(x - r)));
      const exact = dev < 1e-5 * Math.max(1, r);
      let note = exact ? '' : '该多面体不存在与所有棱都相切的球，显示的是近似球';
      if (exact) {
        const outside = edges.some(([a, b]) => { const t = G.projPointLine(best.x, a, b).t; return t < -1e-6 || t > 1 + 1e-6; });
        if (outside) note = '注意：球与部分棱所在直线的切点在棱的延长线上';
      }
      return { c: best.x, r, exact, note };
    },
    curved(cv, which) {
      const { c0, n, r1, r2, h, type } = cv;
      const at = (z) => V.addScaled(c0, n, z);
      if (which === 'circum') {
        if (type === 'cone') { const z = (h * h - r1 * r1) / (2 * h); return { c: at(z), r: Math.hypot(r1, z), exact: true, note: '' }; }
        const z = (r2 * r2 + h * h - r1 * r1) / (2 * h);
        return { c: at(z), r: Math.hypot(r1, z), exact: true, note: '' };
      }
      if (which === 'in') {
        if (type === 'cylinder') {
          const r = Math.min(r1, h / 2);
          return { c: at(h / 2), r, exact: Math.abs(h - 2 * r1) < 1e-9, note: Math.abs(h - 2 * r1) < 1e-9 ? '' : '圆柱的高不等于底面直径，不存在内切球，显示的是最大内含球' };
        }
        if (type === 'cone') { const r = (r1 * h) / (r1 + Math.hypot(r1, h)); return { c: at(r), r, exact: true, note: '' }; }
        const l = Math.hypot(h, r1 - r2);
        const ok = Math.abs(r1 + r2 - l) < 1e-9;
        // 与侧面相切且与下底相切的最大球
        const tanHalf = (r1 - r2) / h; // 侧面倾斜
        void tanHalf;
        return { c: at(h / 2), r: h / 2, exact: ok, note: ok ? '' : '该圆台不存在内切球（需满足 上下底半径之和 = 母线长），显示的是与上下底相切的球' };
      }
      throw new Error('旋转体没有棱切球');
    },
  };

  reg('specialSphere', {
    type: 'sphere',
    deps: (d) => [d.solid].concat(d.verts || []).concat(d.faces || []).concat(d.edges || []),
    eval: (d, c) => {
      const sv = c.val(d.solid);
      if (sv.curved) return Spheres.curved(sv.curved, d.which);
      const pts = d.verts.map((id) => c.pt(id));
      const cen = V.centroid(pts);
      if (d.which === 'circum') return Spheres.circumOfPoints(pts);
      if (d.which === 'in') {
        const planes = d.faces.map((f) => {
          const pl = c.val(f).plane;
          const s = V.dot(pl.n, V.sub(cen, pl.o)) > 0 ? -1 : 1;
          return { n: V.scale(pl.n, s), d: pl.d * s };
        });
        return Spheres.inOfPlanes(planes, cen);
      }
      const edges = d.edges.map((e) => { const v = c.val(e); return [v.a, v.b]; });
      return Spheres.midOfEdges(edges, cen);
    },
  });

  // ------------------------------------------------------------ 参数接口
  function params(o) {
    const d = o.def;
    const out = [];
    if (d.kind === 'tpl') {
      const t = T[d.tpl];
      for (const p of t.params) {
        out.push(Object.assign({}, p, { obj: o.id, key: [p.key], solid: true, options: p.options ? p.options(d.params) : null }));
      }
      out.push({ obj: o.id, key: ['frame', 'o', 0], label: '位置 x', step: 0.1 });
      out.push({ obj: o.id, key: ['frame', 'o', 1], label: '位置 y', step: 0.1 });
      out.push({ obj: o.id, key: ['frame', 'o', 2], label: '位置 z', step: 0.1 });
    } else if (d.kind === 'extrude') {
      if (d.mode === 'prism' && !d.top) out.push({ obj: o.id, key: ['h'], label: '高', step: 0.1 });
      if (d.mode === 'pyramid' && !d.apex) out.push({ obj: o.id, key: ['h'], label: '高', step: 0.1 });
      if (d.mode === 'frustum') {
        out.push({ obj: o.id, key: ['h'], label: '高', step: 0.1 });
        out.push({ obj: o.id, key: ['k'], label: '上底缩放比', min: 0.01, max: 2, step: 0.05 });
      }
    }
    return out;
  }

  SG.Solids = { T, params, toWorld, frameDefault, regPoly };
  SG.Spheres = Spheres;
})(globalThis.SG = globalThis.SG || {});
