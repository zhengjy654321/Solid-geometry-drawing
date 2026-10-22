/*
 * 命令层：所有"创建 / 修改图形"的操作都通过这里完成。
 * 界面上的工具、快捷操作、AI 返回的指令都调用同一套命令，保证行为一致。
 *
 * 命令中对已有对象的引用可以是 id，也可以是名称（如 "A"、"AB"、"ABCD"、"α"），
 * 直线可写成 ["A","B"]，平面可写成 ["A","B","C"]。
 */
(function (SG) {
  'use strict';
  const { V, G } = SG;
  const D2R = Math.PI / 180;
  const LINE_TYPES = SG.LINE_TYPES;
  const PLANE_TYPES = new Set(['plane', 'polygon']);

  function err(msg) { throw new Error(msg); }

  /** 把 "A1B1C" 拆成 ["A1","B1","C"] */
  function splitNames(s) {
    return String(s).match(/[A-Za-z](?:_?\{?\d+\}?)?'*/g) || [];
  }

  class Commands {
    constructor(scene) { this.S = scene; }

    // ------------------------------------------------------------ 引用解析
    obj(ref) {
      const o = this.S.get(ref);
      if (!o) err('找不到对象 "' + ref + '"');
      return o;
    }
    point(ref) {
      if (Array.isArray(ref) && ref.length === 3 && typeof ref[0] === 'number') {
        return this.addPoint({ kind: 'free', x: ref[0], y: ref[1], z: ref[2] }, { style: { dot: true } }).id;
      }
      const o = this.S.get(ref);
      if (!o) err('找不到点 "' + ref + '"');
      if (o.type !== 'point') err('"' + ref + '" 不是点');
      return o.id;
    }
    points(list) {
      if (typeof list === 'string') {
        const o = this.S.get(list);
        if (o && o.type === 'polygon') return o.def.pts.slice();
        if (o && o.type === 'solid') return (o.verts || []).slice();
        list = splitNames(list);
      }
      return list.map((r) => this.point(r));
    }
    /** 直线引用 → 线对象 id 或 [pid, pid] */
    line(ref) {
      if (Array.isArray(ref)) {
        if (ref.length !== 2) err('直线需要两个点');
        return ref.map((r) => this.point(r));
      }
      const o = this.S.get(ref);
      if (o && LINE_TYPES.has(o.type)) return o.id;
      const ns = splitNames(ref);
      if (ns.length === 2) return ns.map((r) => this.point(r));
      err('找不到直线 "' + ref + '"');
    }
    lineEnds(ref) {
      const l = this.line(ref);
      if (Array.isArray(l)) return l;
      const o = this.S.map.get(l);
      return [o.def.a, o.def.b];
    }
    /** 平面引用 → 平面/多边形 id 或 [pid,pid,pid] */
    plane(ref) {
      if (Array.isArray(ref)) {
        if (ref.length < 3) err('平面需要三个点');
        const ids = ref.map((r) => this.point(r));
        const poly = this.findPolygon(ids);
        return poly ? poly.id : ids.slice(0, 3);
      }
      const o = this.S.get(ref);
      if (o && (PLANE_TYPES.has(o.type) || o.type === 'circle')) return o.id;
      let s = String(ref).replace(/^平面|^面/, '');
      const o2 = this.S.get(s);
      if (o2 && (PLANE_TYPES.has(o2.type) || o2.type === 'circle')) return o2.id;
      const ns = splitNames(s);
      if (ns.length >= 3) return this.plane(ns);
      err('找不到平面 "' + ref + '"');
    }
    solid(ref) {
      const o = this.S.get(ref);
      if (!o) err('找不到立体 "' + ref + '"');
      if (o.type === 'solid') return o.id;
      if (o.parent && this.S.map.get(o.parent) && this.S.map.get(o.parent).type === 'solid') return o.parent;
      if (o.type === 'point' && o.def.kind === 'solidVertex') return o.def.solid;
      err('"' + ref + '" 不是立体');
    }
    findPolygon(ids) {
      const set = new Set(ids);
      return this.S.objects.find((o) => o.type === 'polygon' && o.def.pts.length === ids.length && o.def.pts.every((p) => set.has(p)));
    }
    findSegment(a, b) {
      return this.S.objects.find((o) => LINE_TYPES.has(o.type) && ((o.def.a === a && o.def.b === b) || (o.def.a === b && o.def.b === a)));
    }

    // ------------------------------------------------------------ 基本创建
    setName(o, name) {
      if (name == null || name === '') return;
      name = String(name).trim();
      if (this.S.nameUsed(name, o)) err('名称 "' + name + '" 已被使用');
      o.name = name;
    }
    addPoint(def, opts) {
      opts = opts || {};
      if (opts.name && this.S.nameUsed(opts.name)) err('名称 "' + opts.name + '" 已被使用');
      return this.S.add({ type: 'point', def, name: opts.name ? String(opts.name) : undefined, style: opts.style, locked: !!opts.locked, parent: opts.parent });
    }
    ensureSegment(a, b, type, style) {
      type = type || 'segment';
      if (a === b) err('两点重合');
      const ex = this.findSegment(a, b);
      if (ex && ex.type === type) { if (style) Object.assign(ex.style, style); return ex; }
      return this.S.add({ type, name: null, def: { kind: 'twoPts', a, b }, style });
    }
    addPolygon(ids, opts) {
      opts = opts || {};
      const ex = this.findPolygon(ids);
      if (ex) { if (opts.style) Object.assign(ex.style, opts.style); return ex; }
      return this.S.add({ type: 'polygon', name: opts.name || null, def: { kind: 'poly', pts: ids.slice() }, style: opts.style, parent: opts.parent });
    }

    // ------------------------------------------------------------ 执行一条命令
    exec(cmd) {
      const op = cmd.op || cmd.cmd || cmd.type;
      const fn = this['op_' + op];
      if (!fn) err('未知的操作 "' + op + '"');
      const before = new Set(this.S.map.keys());
      const main = fn.call(this, cmd);
      const created = Array.from(this.S.map.keys()).filter((k) => !before.has(k));
      return { main: main && main.id ? main.id : main, created };
    }

    // ---------------------------- 点
    op_point(c) {
      const p = c.coord || c.at || c.xyz || [c.x || 0, c.y || 0, c.z || 0];
      return this.addPoint({ kind: 'free', x: +p[0], y: +p[1], z: +p[2] }, c);
    }
    op_pointOnLine(c) {
      const [a, b] = c.line ? this.lineEnds(c.line) : [this.point(c.a), this.point(c.b)];
      let t = c.t;
      if (t == null && c.ratio) t = parseRatio(c.ratio);
      if (t == null) t = 0.5;
      return this.addPoint({ kind: 'onLine', a, b, t: +t, mode: c.mode === 'line' ? 'line' : 'seg' }, Object.assign({}, c, { locked: c.locked != null ? !!c.locked : true }));
    }
    op_midpoint(c) {
      const [a, b] = c.line ? this.lineEnds(c.line) : [this.point(c.a), this.point(c.b)];
      return this.addPoint({ kind: 'onLine', a, b, t: 0.5, mode: 'seg' }, Object.assign({}, c, { locked: true }));
    }
    op_pointOnPlane(c) {
      const pl = this.plane(c.plane);
      const P = this.S.ctx.plane(pl);
      let u = c.u || 0, v = c.v || 0;
      if (c.coord) { const w = V.sub(c.coord, P.o); u = V.dot(w, P.u); v = V.dot(w, P.v); }
      return this.addPoint({ kind: 'onPlane', plane: pl, u, v }, c);
    }
    op_pointOffset(c) {
      return this.addPoint({ kind: 'offset', base: this.point(c.base), vec: (c.vector || c.vec).map(Number) }, c);
    }
    op_pointAlongNormal(c) {
      return this.addPoint({ kind: 'alongNormal', base: this.point(c.base), plane: c.plane ? this.plane(c.plane) : null, dist: +(c.dist != null ? c.dist : c.distance) }, c);
    }
    op_pointByVector(c) {
      return this.addPoint({ kind: 'byVector', base: this.point(c.base), from: this.point(c.from), to: this.point(c.to), k: c.k == null ? 1 : +c.k }, c);
    }
    op_foot(c) {
      const p = this.point(c.point);
      if (c.plane) return this.addPoint({ kind: 'foot', p, target: this.plane(c.plane), ttype: 'plane' }, c);
      return this.addPoint({ kind: 'foot', p, target: this.line(c.line), ttype: 'line' }, c);
    }
    op_reflect(c) {
      const p = this.point(c.point);
      if (c.plane) return this.addPoint({ kind: 'reflect', p, target: this.plane(c.plane), ttype: 'plane' }, c);
      if (c.line) return this.addPoint({ kind: 'reflect', p, target: this.line(c.line), ttype: 'line' }, c);
      return this.addPoint({ kind: 'reflect', p, target: this.point(c.center), ttype: 'point' }, c);
    }
    op_intersection(c) {
      const a = this.line(c.line || c.line1);
      if (c.plane) return this.addPoint({ kind: 'intersect', a, b: this.plane(c.plane), btype: 'plane' }, c);
      return this.addPoint({ kind: 'intersect', a, b: this.line(c.line2), btype: 'line' }, c);
    }
    op_center(c) {
      const ctype = { centroid: 'centroid', circumcenter: 'circumcenter', incenter: 'incenter', orthocenter: 'orthocenter', 重心: 'centroid', 外心: 'circumcenter', 内心: 'incenter', 垂心: 'orthocenter' }[c.type || c.ctype] || 'centroid';
      return this.addPoint({ kind: 'center', ctype, pts: this.points(c.points) }, c);
    }
    op_rotatePoint(c) {
      const [a, b] = this.lineEnds(c.axis);
      return this.addPoint({ kind: 'rotatePt', p: this.point(c.point), a, b, angle: +c.angle }, c);
    }
    op_fixedLenPoint(c) {
      const d = { kind: 'fixedLen', anchor: this.point(c.anchor), len: +(c.len || c.length || 1), mode: c.mode === 'plane' ? 'plane' : 'space', plane: c.plane ? this.plane(c.plane) : null, th: +(c.th || c.theta || 0), ph: +(c.ph || c.phi || 0) };
      return this.addPoint(d, c);
    }
    op_pointOnSphere(c) {
      return this.addPoint({ kind: 'onSphere', sphere: this.obj(c.sphere).id, th: +(c.th || 0), ph: +(c.ph || 0) }, c);
    }
    op_pointOnCircle(c) {
      return this.addPoint({ kind: 'onCircle', circle: this.obj(c.circle).id, ang: +(c.angle || c.ang || 0) }, c);
    }

    // ---------------------------- 线、面
    lineLike(c, type) {
      const [a, b] = c.points ? this.points(c.points) : [this.point(c.a), this.point(c.b)];
      const st = {};
      if (c.style || c.dash) st.dash = c.style || c.dash;
      if (c.color) st.color = c.color;
      const o = this.ensureSegment(a, b, type, st);
      if (c.name) this.setName(o, c.name);
      return o;
    }
    op_segment(c) { return this.lineLike(c, 'segment'); }
    op_line(c) { return this.lineLike(c, 'line'); }
    op_ray(c) { return this.lineLike(c, 'ray'); }
    op_polygon(c) {
      const ids = this.points(c.points);
      if (ids.length < 3) err('多边形至少需要 3 个点');
      const st = {};
      if (c.fill != null) st.fill = !!c.fill;
      if (c.color) { st.fillColor = c.color; st.fill = c.fill !== false; }
      if (c.opacity != null) st.fillOpacity = +c.opacity;
      if (c.occlude != null) st.occlude = !!c.occlude;
      const o = this.addPolygon(ids, { style: st });
      if (c.edges !== false) for (let i = 0; i < ids.length; i++) this.ensureSegment(ids[i], ids[(i + 1) % ids.length]);
      if (c.name) this.setName(o, c.name);
      return o;
    }
    op_plane(c) {
      const mode = c.mode || (c.points ? 'threePoints' : 'pointNormal');
      let def;
      if (mode === 'threePoints') { const [a, b, cc] = this.points(c.points); def = { kind: 'plane3', a, b, c: cc }; }
      else if (mode === 'pointNormal') def = { kind: 'planePN', p: this.point(c.point), n: c.normal.map(Number) };
      else if (mode === 'perpToLine') def = { kind: 'planePerpLine', p: this.point(c.point), line: this.line(c.line) };
      else if (mode === 'parallelToPlane') def = { kind: 'planeParallel', p: this.point(c.point), plane: this.plane(c.plane) };
      else if (mode === 'throughLinePerpToPlane') def = { kind: 'planeLinePerp', line: this.line(c.line), plane: this.plane(c.plane) };
      else if (mode === 'throughLineAngleToPlane') def = { kind: 'planeLineAngle', line: this.line(c.line), plane: this.plane(c.plane), angle: +c.angle, side: c.side < 0 ? -1 : 1 };
      else if (mode === 'axis') def = { kind: 'planeAxis', axis: c.axis || 'xy', offset: +(c.offset || 0), size: +(c.size || 2) };
      else err('未知的平面构造方式 ' + mode);
      const o = this.S.add({ type: 'plane', def, name: undefined });
      if (c.name) { o.name = null; this.setName(o, c.name); }
      if (c.size) o.style.size = +c.size;
      return o;
    }

    // ---------------------------- 模板立体 / 平面图形
    op_solid(c) {
      const tplKey = c.shape || c.solidType || c.kind || c.template;
      const t = SG.Solids.T[tplKey];
      if (!t) err('未知的图形模板 "' + tplKey + '"');
      const params = {};
      for (const p of t.params) {
        let v = c.params && c.params[p.key] != null ? c.params[p.key] : c[p.key];
        if (v == null && p.key === 'a' && c.size != null) v = c.size;
        params[p.key] = v != null ? (p.options ? v : +v) : p.def;
      }
      const frame = c.frame ? JSON.parse(JSON.stringify(c.frame)) : SG.Solids.frameDefault();
      if (c.origin) frame.o = c.origin.map(Number);
      const so = this.S.add({ type: 'solid', name: null, def: { kind: 'tpl', tpl: tplKey, params, frame } });
      const b = t.build(params);
      const names = c.names ? (typeof c.names === 'string' ? splitNames(c.names) : c.names.slice()) : t.names(this.S, params);
      const verts = b.pts.map((_, i) => {
        const nm = names[i] && !this.S.nameUsed(names[i]) ? names[i] : this.S.autoName('point');
        return this.S.add({ type: 'point', name: nm, def: { kind: 'solidVertex', solid: so.id, index: i }, parent: so.id }).id;
      });
      so.verts = verts;
      so.edges = b.edges.map(([i, j]) => { const e = this.ensureSegment(verts[i], verts[j]); e.parent = so.id; return e.id; });
      so.faces = b.faces.map((f) => this.addPolygon(f.map((i) => verts[i]), { parent: so.id, style: { occlude: t.dim === 3 } }).id);
      so.dim = t.dim;
      if (b.curved) so.curved = b.curved.type;
      const nm = (i) => this.S.map.get(verts[i]).name;
      let sname;
      if (b.curved) sname = t.label + nm(0) + nm(1);
      else if (['cube', 'cuboid', 'prism', 'frustum', 'qiandu'].includes(tplKey)) { const n = verts.length / 2; sname = verts.slice(0, n).map((_, i) => nm(i)).join('') + '-' + verts.slice(n).map((_, i) => nm(n + i)).join(''); }
      else if (['pyramid', 'rectPyramid'].includes(tplKey)) sname = nm(verts.length - 1) + '-' + verts.slice(0, -1).map((_, i) => nm(i)).join('');
      else if (['corner', 'bienao'].includes(tplKey)) sname = nm(0) + '-' + nm(1) + nm(2) + nm(3);
      else sname = verts.map((_, i) => nm(i)).join('');
      so.name = this.S.nameUsed(sname) ? this.S.freshName(sname) : sname;
      if (c.name) { so.name = null; this.setName(so, c.name); }
      return so;
    }
    op_figure(c) { return this.op_solid(c); }
    op_circle(c) {
      if (c.points) {
        const [a, b, cc] = this.points(c.points);
        return this.S.add({ type: 'circle', def: { kind: 'circle3', a, b, c: cc }, name: c.name || null });
      }
      const center = this.point(c.center);
      const def = { kind: 'circleCRN', center, r: +(c.radius || c.r || 1), plane: c.plane ? this.plane(c.plane) : null, n: c.normal ? c.normal.map(Number) : [0, 0, 1] };
      return this.S.add({ type: 'circle', def, name: c.name || null });
    }

    // ---------------------------- 由底面生成立体
    op_extrude(c) {
      let base;
      if (c.base && !Array.isArray(c.base)) {
        const o = this.S.get(c.base);
        base = o && o.type === 'polygon' ? o.def.pts.slice() : this.points(c.base);
      } else base = this.points(c.base);
      if (base.length < 3) err('底面至少需要 3 个点');
      const mode = c.mode || 'prism';
      const basePts = base.map((id) => this.S.ctx.pt(id));
      const pl = G.planePoly(basePts);
      if (!pl) err('底面退化');
      let sign = c.sign || (pl.n[2] < -1e-9 ? -1 : 1);
      const def = { kind: 'extrude', base, mode, h: +(c.height != null ? c.height : c.h != null ? c.h : 2), k: +(c.k != null ? c.k : 0.5), sign, apex: c.apex ? this.point(c.apex) : null, top: c.top ? this.point(c.top) : null };
      const so = this.S.add({ type: 'solid', name: null, def });
      const val = SG.Kinds.extrude.eval(def, this.S.ctx);
      const bn = base.map((id) => this.S.map.get(id).name || '');
      let newNames = c.names ? (typeof c.names === 'string' ? splitNames(c.names) : c.names) : null;
      const gen = val.pts.map((_, i) => {
        let nm = newNames && newNames[i];
        if (!nm) nm = mode === 'pyramid' ? (['P', 'S', 'V'].find((x) => !this.S.nameUsed(x)) || this.S.autoName('point')) : this.S.freshName((bn[def.top ? i + 1 : i] || 'A').replace(/\d+$/, '') + '1');
        if (this.S.nameUsed(nm)) nm = this.S.autoName('point');
        return this.S.add({ type: 'point', name: nm, def: { kind: 'solidVertex', solid: so.id, index: i }, parent: so.id }).id;
      });
      const n = base.length;
      let verts, edges = [], faces = [];
      if (mode === 'pyramid') {
        const apex = def.apex || gen[0];
        verts = base.concat([apex]);
        for (let i = 0; i < n; i++) { edges.push([base[i], base[(i + 1) % n]], [base[i], apex]); faces.push([base[i], base[(i + 1) % n], apex]); }
      } else {
        const top = def.top ? [def.top].concat(gen) : gen;
        verts = base.concat(top);
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          edges.push([base[i], base[j]], [top[i], top[j]], [base[i], top[i]]);
          faces.push([base[i], base[j], top[j], top[i]]);
        }
        faces.push(top.slice());
      }
      faces.push(base.slice());
      so.verts = verts;
      so.edges = edges.map(([a, b]) => { const e = this.ensureSegment(a, b); if (!e.parent) e.parent = so.id; return e.id; });
      so.faces = faces.map((f) => { const p = this.addPolygon(f, { parent: so.id }); p.style.occlude = true; return p.id; });
      so.dim = 3;
      const nm = (id) => this.S.map.get(id).name;
      so.name = mode === 'pyramid' ? nm(verts[n]) + '-' + base.map(nm).join('') : base.map(nm).join('') + '-' + verts.slice(n).map(nm).join('');
      if (this.S.nameUsed(so.name, so)) { const nm0 = so.name; so.name = null; so.name = this.S.freshName(nm0); }
      return so;
    }
    op_hull(c) {
      const ids = this.points(c.points);
      const pts = ids.map((id) => this.S.ctx.pt(id));
      const h = G.convexHull(pts);
      if (!h) err('这些点共面或太少，无法生成多面体');
      const so = this.S.add({ type: 'solid', name: null, def: { kind: 'hull', pts: ids } });
      const used = new Set();
      so.faces = h.faces.map((f) => { f.forEach((i) => used.add(ids[i])); const p = this.addPolygon(f.map((i) => ids[i]), { parent: so.id }); p.style.occlude = true; return p.id; });
      const edges = new Map();
      for (const f of h.faces) for (let i = 0; i < f.length; i++) {
        const a = ids[f[i]], b = ids[f[(i + 1) % f.length]];
        edges.set([a, b].sort().join('|'), [a, b]);
      }
      so.edges = Array.from(edges.values()).map(([a, b]) => { const e = this.ensureSegment(a, b); if (!e.parent) e.parent = so.id; return e.id; });
      so.verts = ids.filter((id) => used.has(id));
      so.dim = 3;
      so.name = this.S.freshName('多面体' + so.verts.map((id) => this.S.map.get(id).name).join(''));
      return so;
    }

    // ---------------------------- 球
    op_sphere(c) {
      let center;
      if (c.center) center = this.point(c.center);
      else center = this.addPoint({ kind: 'free', x: 0, y: 0, z: 0 }, { name: this.S.freshName('O') }).id;
      const def = c.through ? { kind: 'sphereCP', center, through: this.point(c.through) } : { kind: 'sphereCR', center, r: +(c.radius || c.r || 1) };
      const o = this.S.add({ type: 'sphere', def, name: null });
      if (c.name) this.setName(o, c.name);
      if (c.display) o.style.mode = c.display;
      return o;
    }
    op_circumsphere(c) {
      if (c.solid) return this.op_specialSphere(Object.assign({}, c, { which: 'circum' }));
      const pts = this.points(c.points);
      const o = this.S.add({ type: 'sphere', def: { kind: 'circumPts', pts }, name: null });
      this.addPoint({ kind: 'sphereCenter', sphere: o.id }, { name: c.centerName || this.S.freshName('O') });
      return o;
    }
    op_insphere(c) { return this.op_specialSphere(Object.assign({}, c, { which: 'in' })); }
    op_midsphere(c) { return this.op_specialSphere(Object.assign({}, c, { which: 'mid' })); }
    op_specialSphere(c) {
      const sid = this.solid(c.solid);
      const so = this.S.map.get(sid);
      const which = c.which || 'circum';
      if (so.curved && which === 'mid') err('旋转体没有棱切球');
      const def = { kind: 'specialSphere', solid: sid, which, verts: (so.verts || []).slice(), faces: (so.faces || []).slice(), edges: (so.edges || []).slice() };
      if (so.curved) { def.verts = []; def.faces = []; def.edges = []; }
      const o = this.S.add({ type: 'sphere', def, name: null });
      o.style.mode = which === 'circum' ? 'outline' : 'shaded';
      this.S.recompute();
      if (o.err) { this.S.remove(o.id); err(o.err); }
      const cn = c.centerName || this.S.freshName(which === 'circum' ? 'O' : which === 'in' ? 'I' : 'M');
      this.addPoint({ kind: 'sphereCenter', sphere: o.id }, { name: cn });
      return o;
    }
    op_sphereSection(c) {
      const sp = this.obj(c.sphere);
      if (sp.type !== 'sphere') err('"' + c.sphere + '" 不是球');
      const o = this.S.add({ type: 'circle', def: { kind: 'sphereSection', sphere: sp.id, plane: this.plane(c.plane), clip: c.clip ? this.plane(c.clip) : null }, name: null });
      o.style.color = '#d0451b';
      if (c.withCenter) this.addPoint({ kind: 'circleCenter', circle: o.id }, { name: this.S.freshName('O1') });
      return o;
    }
    /** 球面与多面体各个面的交线 */
    op_sphereSolidIntersect(c) {
      const sp = this.obj(c.sphere);
      const so = this.S.map.get(this.solid(c.solid));
      this.S.recompute();
      const S0 = sp.v;
      const made = [];
      for (const f of so.faces || []) {
        const fo = this.S.map.get(f);
        if (!fo || !fo.v) continue;
        const pl = fo.v.plane;
        const dd = Math.abs(V.dot(pl.n, S0.c) - pl.d);
        if (dd >= S0.r - 1e-9) continue;
        const cen = V.addScaled(S0.c, pl.n, -(V.dot(pl.n, S0.c) - pl.d));
        const C = { c: cen, r: Math.sqrt(S0.r * S0.r - dd * dd), u: pl.u, v: pl.v };
        if (!SG.Arcs.clip(C, fo.v.pts).length) continue;
        const o = this.S.add({ type: 'circle', def: { kind: 'sphereSection', sphere: sp.id, plane: f, clip: f }, name: null });
        o.style.color = '#d0451b';
        made.push(o.id);
      }
      if (!made.length) err('球面与该多面体的表面没有交线');
      this.S.add({ type: 'measure', def: { kind: 'mSum', items: made.map((id) => this.S.add({ type: 'measure', def: { kind: 'mCircle', circle: id, what: 'len' }, style: { show: false } }).id) }, name: null });
      return made[0];
    }

    // ---------------------------- 截面
    op_section(c) {
      const so = this.S.map.get(this.solid(c.solid));
      const plRef = this.plane(c.plane);
      this.S.recompute();
      if (so.curved) {
        const o = this.S.add({ type: 'polygon', name: null, def: { kind: 'curvedSection', solid: so.id, plane: plRef }, style: { fill: true, fillColor: '#f5a623', fillOpacity: 0.3 } });
        o.isSection = true;
        return o;
      }
      const pl = this.S.ctx.plane(plRef);
      const scale = Math.max(1, ...this.S.objects.filter((o) => o.type === 'point' && o.v).map((o) => V.len(o.v)));
      const eps = 1e-7 * scale;
      const found = [];
      const addPt = (pos, makeDef) => {
        if (found.some((f) => V.dist(f.pos, pos) < eps * 10)) return;
        let ex = this.S.objects.find((o) => o.type === 'point' && o.v && V.dist(o.v, pos) < eps * 10);
        if (!ex) {
          const def = makeDef();
          ex = this.addPoint(def, {});
          this.S.recompute();
        }
        found.push({ id: ex.id, pos });
      };
      for (const eid of so.edges || []) {
        const e = this.S.map.get(eid);
        if (!e || !e.v) continue;
        const A = e.v.a, B = e.v.b;
        const da = V.dot(pl.n, A) - pl.d, db = V.dot(pl.n, B) - pl.d;
        if (Math.abs(da) < eps) addPt(A, null);
        if (Math.abs(db) < eps) addPt(B, null);
        if ((da > eps && db < -eps) || (da < -eps && db > eps)) {
          const t = da / (da - db);
          addPt(V.lerp(A, B, t), () => ({ kind: 'intersect', a: [e.def.a, e.def.b], b: plRef, btype: 'plane' }));
        }
      }
      if (found.length < 3) err('平面与该立体的截面不是多边形（交点少于 3 个）');
      const cen = V.centroid(found.map((f) => f.pos));
      found.sort((p, q) => Math.atan2(V.dot(V.sub(p.pos, cen), pl.v), V.dot(V.sub(p.pos, cen), pl.u)) - Math.atan2(V.dot(V.sub(q.pos, cen), pl.v), V.dot(V.sub(q.pos, cen), pl.u)));
      const ids = found.map((f) => f.id);
      const poly = this.addPolygon(ids, { style: { fill: true, fillColor: '#f5a623', fillOpacity: 0.3 } });
      poly.isSection = true;
      for (let i = 0; i < ids.length; i++) this.ensureSegment(ids[i], ids[(i + 1) % ids.length]);
      return poly;
    }

    // ---------------------------- 折叠
    op_fold(c) {
      const S = this.S;
      const [a, b] = this.lineEnds(c.axis);
      let region;
      if (c.face) {
        const f = S.get(c.face);
        region = f && f.type === 'polygon' ? f.def.pts.slice() : this.points(c.face);
      } else region = this.points(c.moving || c.points);
      S.recompute();
      const A = S.ctx.pt(a), B = S.ctx.pt(b);
      // 折痕是多边形的对角线时，只折起其中一侧（含 side 点的一侧；默认含第一个顶点的一侧）
      {
        const ia = region.indexOf(a), ib = region.indexOf(b), n = region.length;
        if (ia >= 0 && ib >= 0 && n > 3 && Math.abs(ia - ib) !== 1 && Math.abs(ia - ib) !== n - 1) {
          const ch1 = [], ch2 = [];
          for (let i = ia; ; i = (i + 1) % n) { ch1.push(region[i]); if (i === ib) break; }
          for (let i = ib; ; i = (i + 1) % n) { ch2.push(region[i]); if (i === ia) break; }
          let pick = ch1.includes(region[0]) && region[0] !== a && region[0] !== b ? ch1 : ch2;
          if (c.side) {
            const pl = G.planePoly(region.map((id) => S.ctx.pt(id)));
            const k = V.sub(B, A);
            const sd = (p) => V.dot(V.cross(k, V.sub(p, A)), pl.n);
            const s0 = sd(c.side.map(Number));
            const v1 = ch1.find((id) => id !== a && id !== b);
            pick = sd(S.ctx.pt(v1)) * s0 > 0 ? ch1 : ch2;
          }
          region = pick;
        }
      }
      const scale = Math.max(1, V.dist(A, B));
      const onAxis = (id) => id === a || id === b || G.distPointLine(S.ctx.pt(id), A, B) < 1e-7 * scale;
      const cand = new Set(region.filter((id) => !onAxis(id)));
      if (!cand.size) err('没有需要折起的点（所选的点都在折痕上）');
      // 区域内部的自由点也一起折起
      if (region.length >= 3) {
        const pts = region.map((id) => S.ctx.pt(id));
        const pl = G.planePoly(pts);
        if (pl) {
          for (const o of S.objects) {
            if (o.type !== 'point' || cand.has(o.id) || onAxis(o.id) || !o.v) continue;
            if (!['free', 'onPlane'].includes(o.def.kind)) continue;
            if (o.def.kind === 'onPlane' && o.def.plane && !Array.isArray(o.def.plane)) continue;
            if (Math.abs(G.distPointPlane(o.v, pl)) < 1e-7 * scale && G.pointInPolygon3(o.v, pts, pl)) cand.add(o.id);
          }
        }
      }
      // 只包装"源头"点，依赖它们的点会自动随之移动
      const wrap = Array.from(cand).filter((id) => {
        const anc = S.ancestors(id);
        for (const x of cand) if (anc.has(x)) return false;
        return true;
      });
      const fold = S.add({ type: 'fold', name: null, def: { kind: 'fold', a, b, angle: c.angle != null ? +c.angle : 90, dir: 1 } });
      // 方向：默认向上（+z）折起
      const sample = S.ctx.pt(wrap[0]);
      const k = V.norm(V.sub(B, A));
      const up = c.up || [0, 0, 1];
      const t1 = V.rotate(sample, A, k, 0.2), t2 = V.rotate(sample, A, k, -0.2);
      let dir = V.dot(V.sub(t1, t2), up) >= -1e-12 ? 1 : -1;
      if (Math.abs(V.dot(V.sub(t1, t2), up)) < 1e-9 && c.view) dir = V.dot(V.sub(t1, t2), c.view) >= 0 ? 1 : -1;
      if (c.dir) dir *= c.dir < 0 ? -1 : 1;
      fold.def.dir = dir;
      for (const id of wrap) {
        const o = S.map.get(id);
        o.def = { kind: 'folded', fold: fold.id, inner: o.def };
      }
      // 拆分跨越折痕的多边形
      for (const o of S.objects.slice()) {
        if (o.type !== 'polygon') continue;
        const p = o.def.pts;
        const ia = p.indexOf(a), ib = p.indexOf(b);
        if (ia < 0 || ib < 0 || Math.abs(ia - ib) === 1 || Math.abs(ia - ib) === p.length - 1) continue;
        const moving = (id) => cand.has(id) || Array.from(cand).some((x) => S.ancestors(id).has(x));
        const p1 = [], p2 = [];
        for (let i = ia; ; i = (i + 1) % p.length) { p1.push(p[i]); if (i === ib) break; }
        for (let i = ib; ; i = (i + 1) % p.length) { p2.push(p[i]); if (i === ia) break; }
        const m1 = p1.some(moving), m2 = p2.some(moving);
        if (m1 === m2) continue;
        o.def.pts = p1;
        const o2 = S.add({ type: 'polygon', name: null, def: { kind: 'poly', pts: p2 }, style: JSON.parse(JSON.stringify(o.style)), parent: o.parent });
        if (o.parent) { const so = S.map.get(o.parent); if (so && so.faces) so.faces.push(o2.id); }
      }
      this.ensureSegment(a, b);
      return fold;
    }

    // ---------------------------- 度量
    op_measure(c) {
      const t = c.type || c.kind;
      const it = c.items || c.targets || [];
      const map = {
        length: () => (it.length === 1 ? (() => { const [a, b] = this.lineEnds(it[0]); return { kind: 'mLength', a, b }; })() : { kind: 'mLength', a: this.point(it[0]), b: this.point(it[1]) }),
        distPointLine: () => ({ kind: 'mDistPL', p: this.point(it[0]), line: this.line(it[1]) }),
        distPointPlane: () => ({ kind: 'mDistPP', p: this.point(it[0]), plane: this.plane(it[1]) }),
        distLineLine: () => ({ kind: 'mDistLL', l1: this.line(it[0]), l2: this.line(it[1]) }),
        angle: () => ({ kind: 'mAngle3', a: this.point(it[0]), o: this.point(it[1]), b: this.point(it[2]) }),
        angleLines: () => ({ kind: 'mAngleLL', l1: this.line(it[0]), l2: this.line(it[1]) }),
        angleLinePlane: () => ({ kind: 'mAngleLP', line: this.line(it[0]), plane: this.plane(it[1]) }),
        dihedral: () => (it.length === 4 ? { kind: 'mDihedral4', a: this.point(it[0]), b: this.point(it[1]), c: this.point(it[2]), d: this.point(it[3]) } : { kind: 'mDihedral', p1: this.plane(it[0]), p2: this.plane(it[1]) }),
        area: () => { const o = this.S.get(it[0]); return o && o.type === 'polygon' && it.length === 1 ? { kind: 'mArea', poly: o.id } : { kind: 'mArea', pts: this.points(it.length === 1 ? it[0] : it) }; },
        volume: () => ({ kind: 'mVolume', solid: this.solid(it[0]) }),
        surface: () => ({ kind: 'mSurface', solid: this.solid(it[0]) }),
        circle: () => ({ kind: 'mCircle', circle: this.obj(it[0]).id, what: c.what || 'len' }),
        sphere: () => ({ kind: 'mSphere', sphere: this.obj(it[0]).id, what: c.what || 'r' }),
      };
      if (!map[t]) err('未知的度量类型 "' + t + '"');
      return this.S.add({ type: 'measure', def: map[t](), name: null });
    }

    // ---------------------------- 标注
    op_rightAngle(c) {
      const [a, o, b] = this.points(c.points);
      return this.S.add({ type: 'mark', def: { kind: 'rightAngle', a, o, b }, name: null });
    }
    op_angleMark(c) {
      const [a, o, b] = this.points(c.points);
      return this.S.add({ type: 'mark', def: { kind: 'angleArc', a, o, b, count: c.count || 1 }, name: null });
    }
    op_text(c) {
      return this.S.add({ type: 'mark', def: { kind: 'text', at: c.at ? this.point(c.at) : null, pos: c.pos || [0, 0, 0], text: String(c.text || '') }, name: null });
    }
    op_trace(c) {
      const p = this.point(c.point);
      const ex = this.S.objects.find((o) => o.type === 'trace' && o.def.p === p);
      if (ex) return ex;
      const o = this.S.add({ type: 'trace', def: { kind: 'trace', p }, name: null });
      o.data = [];
      o.recording = true;
      return o;
    }

    // ---------------------------- 修改
    targets(c) {
      const t = c.targets || (c.target != null ? [c.target] : []);
      return t.map((r) => this.obj(r));
    }
    op_style(c) {
      const keys = ['color', 'dash', 'width', 'label', 'fill', 'fillColor', 'fillOpacity', 'occlude', 'mode', 'opacity', 'density', 'equator', 'size', 'show'];
      for (const o of this.targets(c)) {
        for (const k of keys) if (c[k] !== undefined) o.style[k] = c[k];
        if (c.style && typeof c.style === 'string') o.style.dash = c.style;
        if (c.hidden !== undefined) o.hidden = !!c.hidden;
        if (c.visible !== undefined) o.hidden = !c.visible;
      }
      return null;
    }
    op_rename(c) {
      const o = this.obj(c.target);
      this.setName(o, c.name);
      return o;
    }
    op_delete(c) {
      const ids = this.targets(c).map((o) => o.id);
      this.S.remove(ids);
      return null;
    }
    op_setParam(c) {
      const o = this.obj(c.target);
      const ps = this.S.params(o);
      const key = String(c.key || c.param);
      const p = ps.find((x) => x.key.join('.') === key || x.key[x.key.length - 1] === key || x.label === key);
      if (!p) err('对象 ' + this.S.displayName(o) + ' 没有参数 "' + key + '"，可用参数：' + ps.map((x) => x.key.join('.')).join(', '));
      this.S.setParam(o, p, typeof this.S.getParam(o, p) === 'number' ? +c.value : c.value);
      return o;
    }
    op_moveTo(c) {
      const o = this.obj(c.target);
      if (o.type !== 'point' || o.def.kind !== 'free') err('只有自由点可以直接设置坐标');
      const p = c.coord;
      o.def.x = +p[0]; o.def.y = +p[1]; o.def.z = +p[2];
      return o;
    }
    op_labels(c) {
      const list = c.targets ? this.targets(c) : this.S.objects.filter((o) => o.type === 'point' || o.type === 'plane');
      for (const o of list) o.style.label = c.show !== false;
      return null;
    }
    op_lock(c) {
      for (const o of this.targets(c)) o.locked = c.locked !== false;
      return null;
    }
  }

  function parseRatio(s) {
    if (typeof s === 'number') return s;
    const m = String(s).match(/^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
    if (m) return +m[1] / +m[2];
    const m2 = String(s).match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/);
    if (m2) return +m2[1] / (+m2[1] + +m2[2]);
    return parseFloat(s);
  }

  // 旋转体截面（曲线）
  SG.registerKind('curvedSection', {
    type: 'polygon',
    deps: (d) => [d.solid].concat(Array.isArray(d.plane) ? d.plane : [d.plane]),
    eval: (d, c) => {
      const cv = c.val(d.solid).curved;
      const pl = c.plane(d.plane);
      const N = 160;
      const ring = (z, r) => { const out = []; for (let i = 0; i < N; i++) { const t = (2 * Math.PI * i) / N; out.push(V.add(V.addScaled(cv.c0, cv.n, z), V.add(V.scale(cv.u, r * Math.cos(t)), V.scale(cv.v, r * Math.sin(t))))); } return out; };
      const bot = ring(0, cv.r1), top = cv.r2 > 1e-9 ? ring(cv.h, cv.r2) : null;
      const segs = [];
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        segs.push([bot[i], bot[j]]);
        if (top) segs.push([top[i], top[j]], [bot[i], top[i]]);
        else segs.push([bot[i], V.addScaled(cv.c0, cv.n, cv.h)]);
      }
      const pts = [];
      for (const [A, B] of segs) {
        const da = V.dot(pl.n, A) - pl.d, db = V.dot(pl.n, B) - pl.d;
        if ((da > 0) !== (db > 0)) pts.push(V.lerp(A, B, da / (da - db)));
      }
      if (pts.length < 3) throw new Error('截面为空');
      const cen = V.centroid(pts);
      pts.sort((p, q) => Math.atan2(V.dot(V.sub(p, cen), pl.v), V.dot(V.sub(p, cen), pl.u)) - Math.atan2(V.dot(V.sub(q, cen), pl.v), V.dot(V.sub(q, cen), pl.u)));
      return { pts, plane: G.planePN(cen, pl.n), curve: true };
    },
  });
  SG.registerKind('mSum', {
    type: 'measure',
    deps: (d) => d.items.slice(),
    eval: (d, c) => {
      let s = 0, at = null;
      for (const id of d.items) { const v = c.val(id); s += v.value; at = at || v.at; }
      return { value: s, unit: 'len', at };
    },
  });

  SG.Commands = Commands;
  SG.splitNames = splitNames;
  SG.parseRatio = parseRatio;
})(globalThis.SG = globalThis.SG || {});
