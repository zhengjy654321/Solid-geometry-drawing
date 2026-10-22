/*
 * 画布交互：命中检测、吸附建点、工具状态机、拖动点、旋转/平移/缩放视角、键盘快捷键。
 */
(function (SG) {
  'use strict';
  const { V, G, UI } = SG;
  const { h } = UI;
  const FRACS = [[1 / 2, '中点'], [1 / 3, '三等分点'], [2 / 3, '三等分点'], [1 / 4, '四等分点'], [3 / 4, '四等分点']];

  function distToSeg2(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 < 1e-9 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    const tc = Math.max(0, Math.min(1, t));
    return { d: Math.hypot(p[0] - a[0] - dx * tc, p[1] - a[1] - dy * tc), t, tc };
  }

  class Interact {
    constructor(app) {
      this.app = app;
      this.toolId = 'select';
      this.picked = [];      // 已完成的输入
      this.partial = [];     // 当前输入的部分点（如直线的两点、平面的三点）
      this.opts = {};        // 各工具选项
      this.drag = null;
      this.down = null;
      this.mouse = null;
      this.status = '';
      this.bind();
    }

    get tool() { return SG.Tools.byId[this.toolId]; }
    get S() { return this.app.S; }
    get cam() { return this.app.cam; }

    // ------------------------------------------------------------ 工具切换
    setTool(id) {
      const t = SG.Tools.byId[id];
      if (!t) return;
      if (t.action) { t.activate(this.app); return; }
      this.toolId = id;
      this.reset();
      if (id !== 'select' && this.app.sel.length) this.app.select([]);
      if (!this.opts[id]) {
        this.opts[id] = {};
        for (const o of t.options || []) this.opts[id][o.key] = o.def;
      }
      this.app.emit('tool', id);
      this.updateStatus();
    }
    reset() {
      this.picked = [];
      this.partial = [];
      this.app.pickHL = [];
      this.app.preview = [];
      this.app.render();
      this.updateStatus();
    }
    currentInput() {
      const t = this.tool;
      if (!t || !t.inputs || !t.inputs.length) return null;
      if (t.variadic) return t.inputs[0];
      return t.inputs[this.picked.length] || null;
    }

    // ------------------------------------------------------------ 命中检测
    hitAll(x, y) {
      const dl = this.app.dl;
      const out = { point: null, line: null, face: null, sphere: null, label: null };
      if (!dl) return out;
      let best = 10;
      for (const p of dl.hits.points) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < best) { best = d; out.point = p.id; }
      }
      for (const lb of dl.hits.labels || []) {
        if (x >= lb.x && x <= lb.x + lb.w && y >= lb.y && y <= lb.y + lb.h) { out.label = lb.id; out.labelIsText = !!lb.label; }
      }
      best = 6;
      for (const l of dl.hits.lines) {
        for (let i = 0; i + 1 < l.pts.length; i++) {
          const r = distToSeg2([x, y], l.pts[i], l.pts[i + 1]);
          if (r.d < best) { best = r.d; out.line = l.id; out.lineT = r.tc; out.lineSeg = i; out.linePts = l.pts; }
        }
      }
      let bz = -Infinity;
      for (const f of dl.hits.faces) {
        if (G.pointInPoly2([x, y], f.poly) && f.z > bz) { bz = f.z; out.face = f.id; }
      }
      let br = Infinity;
      for (const s of dl.hits.spheres) {
        const d = Math.hypot(s.cx - x, s.cy - y);
        if (d < s.r && s.r < br) { br = s.r; out.sphere = s.id; }
      }
      return out;
    }

    /** 选择工具下的命中优先级 */
    hitAny(x, y) {
      const h = this.hitAll(x, y);
      return h.point || h.line || h.face || h.sphere || null;
    }

    // ------------------------------------------------------------ 吸附
    snap(x, y, ev) {
      const S = this.S, cam = this.cam;
      const hits = this.hitAll(x, y);
      const noObj = ev && ev.altKey;
      if (hits.point && !noObj) {
        const o = S.map.get(hits.point);
        return { kind: 'point', id: o.id, pos: o.v, text: '点 ' + o.name };
      }
      if (hits.line && !noObj) {
        const o = S.map.get(hits.line);
        if (o && SG.LINE_TYPES.has(o.type)) {
          const a2 = cam.project(o.v.a), b2 = cam.project(o.v.b);
          const r = distToSeg2([x, y], a2, b2);
          let t = o.type === 'segment' ? r.tc : r.t;
          const len2 = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
          let text = '在 ' + S.displayName(o) + ' 上';
          let nice = false;
          for (const [f, nm] of FRACS) {
            if (Math.abs(t - f) * len2 < 7) { t = f; text = S.displayName(o) + ' 的' + nm + '（t = ' + SG.Exact.recognize(f) + '）'; nice = true; break; }
          }
          return { kind: 'onLine', a: o.def.a, b: o.def.b, t, mode: o.type === 'segment' ? 'seg' : 'line', nice, pos: V.lerp(o.v.a, o.v.b, t), text };
        }
        if (o && o.type === 'circle') {
          const C = o.v;
          const pl = G.planePN(C.c, C.n);
          const q = cam.rayPlane(x, y, pl) || C.c;
          const w = V.sub(q, C.c);
          let ang = (Math.atan2(V.dot(w, C.v), V.dot(w, C.u)) * 180) / Math.PI;
          return { kind: 'onCircle', circle: o.id, ang, pos: V.add(C.c, V.add(V.scale(C.u, C.r * Math.cos(ang * SG.D2R)), V.scale(C.v, C.r * Math.sin(ang * SG.D2R)))), text: '在圆上' };
        }
      }
      if (hits.face && !noObj) {
        const o = S.map.get(hits.face);
        const pl = o.type === 'polygon' ? o.v.plane : o.v;
        const q = cam.rayPlane(x, y, pl);
        if (q) return { kind: 'onFace', ref: o.id, pos: q, text: '在面 ' + S.displayName(o) + ' 上' };
      }
      if (hits.sphere && !noObj) {
        const o = S.map.get(hits.sphere);
        const r = cam.ray(x, y);
        const c = o.v.c, R = o.v.r;
        const oc = V.sub(r.o, c);
        const b = V.dot(oc, r.d), cc = V.len2(oc) - R * R;
        const disc = b * b - cc;
        if (disc >= 0) {
          const s = -b + Math.sqrt(disc);
          const q = V.addScaled(r.o, r.d, s);
          const w = V.norm(V.sub(q, c));
          return { kind: 'onSphere', sphere: o.id, th: (Math.atan2(w[1], w[0]) * 180) / Math.PI, ph: (Math.asin(Math.max(-1, Math.min(1, w[2]))) * 180) / Math.PI, pos: q, text: '在球面上' };
        }
      }
      // 工作面
      const wp = this.app.workPlane();
      let q = cam.rayPlane(x, y, wp);
      if (!q) return null;
      const view = this.app.view;
      if (view.snapGrid && !(ev && ev.altKey)) q = this.gridSnap(q, wp);
      const fmt = (v) => SG.Exact.fmtNum(v, 2);
      return { kind: 'work', pos: q, text: '工作面上 (' + q.map(fmt).join(', ') + ')' };
    }
    gridSnap(q, wp) {
      const st = this.app.view.snapStep || 0.5;
      const w = this.app.work;
      if (w.kind !== 'ref') {
        const ax = { xy: 2, xz: 1, yz: 0 }[w.kind];
        return q.map((v, i) => (i === ax ? v : Math.round(v / st) * st));
      }
      const c = wp.center || wp.o;
      const d = V.sub(q, c);
      const u = Math.round(V.dot(d, wp.u) / st) * st, v = Math.round(V.dot(d, wp.v) / st) * st;
      return V.add(c, V.add(V.scale(wp.u, u), V.scale(wp.v, v)));
    }
    /** 根据吸附结果创建点，返回点 id */
    materialize(sn) {
      if (!sn) return null;
      if (sn.kind === 'point') return sn.id;
      const S = this.S, C = this.app.C;
      return this.app.change('新建点', () => {
        let o;
        if (sn.kind === 'onLine') o = C.addPoint({ kind: 'onLine', a: sn.a, b: sn.b, t: sn.t, mode: sn.mode }, { locked: !!sn.nice });
        else if (sn.kind === 'onCircle') o = C.addPoint({ kind: 'onCircle', circle: sn.circle, ang: sn.ang });
        else if (sn.kind === 'onSphere') o = C.addPoint({ kind: 'onSphere', sphere: sn.sphere, th: sn.th, ph: sn.ph });
        else if (sn.kind === 'onFace') {
          const pl = S.ctx.plane(sn.ref);
          const w = V.sub(sn.pos, pl.o);
          o = C.addPoint({ kind: 'onPlane', plane: sn.ref, u: V.dot(w, pl.u), v: V.dot(w, pl.v) });
        } else {
          const wk = this.app.work;
          if (wk.kind === 'ref') {
            const pl = S.ctx.plane(wk.ref);
            const w = V.sub(sn.pos, pl.o);
            o = C.addPoint({ kind: 'onPlane', plane: wk.ref, u: V.dot(w, pl.u), v: V.dot(w, pl.v) });
          } else {
            const r = (v) => Math.round(v * 1e9) / 1e9;
            o = C.addPoint({ kind: 'free', x: r(sn.pos[0]), y: r(sn.pos[1]), z: r(sn.pos[2]) });
          }
        }
        return o.id;
      });
    }

    // ------------------------------------------------------------ 输入解析
    /** 当前输入能接受哪个对象；返回 {ok, value} / {partial: pointId} / null */
    accept(input, hits, x, y, ev) {
      const S = this.S;
      const obj = (id) => (id ? S.map.get(id) : null);
      const P = obj(hits.point), Lo = obj(hits.line), Fo = obj(hits.face), Sp = obj(hits.sphere);
      switch (input.type) {
        case 'point':
          if (P) return { value: P.id };
          if (input.create) return { create: true };
          return null;
        case 'line':
          if (P) return { partial: P.id, need: 2 };
          if (Lo && SG.LINE_TYPES.has(Lo.type)) return { value: Lo.id };
          if (input.create !== false && this.partial.length) return { create: true, partialCreate: true, need: 2 };
          return null;
        case 'pl':
          if (P) return { value: P.id };
          if (Lo && SG.LINE_TYPES.has(Lo.type)) return { value: Lo.id };
          return null;
        case 'plane':
          if (P) return { partial: P.id, need: 3 };
          if (this.partial.length) return null;
          if (Fo && (Fo.type === 'polygon' || Fo.type === 'plane')) return { value: Fo.id };
          if (Lo && Lo.type === 'circle') return { value: Lo.id };
          return null;
        case 'polygon':
          if (Fo && Fo.type === 'polygon') return { value: Fo.id };
          return null;
        case 'solid': {
          for (const o of [Lo, Fo, P]) {
            if (!o) continue;
            if (o.type === 'solid') return { value: o.id };
            if (o.parent && S.map.get(o.parent) && S.map.get(o.parent).type === 'solid') return { value: o.parent };
            if (o.type === 'point' && o.def.kind === 'solidVertex') return { value: o.def.solid };
          }
          return null;
        }
        case 'sphere':
          if (Lo && Lo.type === 'sphere') return { value: Lo.id };
          if (Sp) return { value: Sp.id };
          return null;
        case 'circle':
          if (Lo && Lo.type === 'circle') return { value: Lo.id };
          return null;
        default:
          return null;
      }
    }

    // ------------------------------------------------------------ 单击（工具）
    toolClick(x, y, ev) {
      const t = this.tool;
      const input = this.currentInput();
      if (!input) return;
      const hits = this.hitAll(x, y);
      // 多边形：单击第一个点闭合
      if (t.variadic === 'closed' && this.picked.length >= 3 && hits.point === this.picked[0]) return this.finishVariadic();
      if (t.variadic === 'open' && this.picked.length >= 2 && hits.point === this.picked[this.picked.length - 1]) return this.finishVariadic();
      const r = this.accept(input, hits, x, y, ev);
      if (!r) { this.flash('这里没有可选的对象：' + this.inputHint(input)); return; }
      let value = r.value;
      if (r.create) {
        const id = this.materialize(this.snap(x, y, ev));
        if (!id) return;
        if (r.partialCreate) { r.partial = id; } else value = id;
      }
      if (r.partial) {
        if (this.partial.includes(r.partial)) return;
        this.partial.push(r.partial);
        if (this.partial.length < r.need) { this.app.pickHL = this.picked.flat().concat(this.partial); this.updateStatus(); this.app.render(); return; }
        value = this.partial.slice();
        this.partial = [];
      }
      if (t.variadic === 'set' && this.picked.includes(value)) { this.picked = this.picked.filter((x) => x !== value); }
      else this.picked.push(value);
      this.app.pickHL = this.picked.flat();
      if (t.variadic) { this.updateStatus(); this.app.render(); return; }
      if (this.picked.length >= t.inputs.length) this.runTool();
      else { this.updateStatus(); this.app.render(); }
    }
    /** 以某个已有对象作为当前工具的下一个输入（快捷栏使用） */
    toolClickPick(id) {
      const t = this.tool;
      if (!t || !t.inputs) return;
      this.picked.push(id);
      this.app.pickHL = this.picked.flat();
      if (!t.variadic && this.picked.length >= t.inputs.length) this.runTool();
      else { this.updateStatus(); this.app.render(); }
    }
    runTool() {
      const t = this.tool;
      const args = this.picked.slice();
      const o = this.opts[this.toolId] || {};
      this.reset();
      const res = this.app.change(t.label, () => t.run(this.app, args, o));
      if (res && res !== true) {
        const id = Array.isArray(res) ? res[0] : res;
        if (this.S.map.has(id) && this.toolId !== 'point') this.app.select(id);
      }
      this.updateStatus();
    }
    finishVariadic() {
      const t = this.tool;
      const ids = this.picked.slice();
      this.reset();
      if (t.id === 'polygon') {
        if (ids.length < 3) return UI.toast('多边形至少需要 3 个顶点', 'err');
        const id = this.app.change('多边形', () => this.app.C.exec({ op: 'polygon', points: ids }).main);
        if (id) this.app.select(id);
      } else if (t.id === 'polyline') {
        if (ids.length < 2) return;
        this.app.change('折线', () => { for (let i = 0; i + 1 < ids.length; i++) this.app.C.ensureSegment(ids[i], ids[i + 1]); });
      } else if (t.id === 'hull') {
        if (ids.length < 4) return UI.toast('至少选择 4 个不共面的点', 'err');
        const id = this.app.change('多面体', () => this.app.C.exec({ op: 'hull', points: ids }).main);
        if (id) this.app.select(id);
      }
    }

    inputHint(input) {
      if (input.label) return input.label;
      return { point: '选择点', line: '选择直线', plane: '选择平面', polygon: '选择多边形', solid: '选择立体', sphere: '选择球', circle: '选择圆' }[input.type] || '';
    }
    typeHint(input) {
      switch (input.type) {
        case 'point': return input.create ? '（单击空白处、线上、面上可直接新建点；按住 Alt 不吸附）' : '';
        case 'line': return this.partial.length ? '（已选 ' + this.partial.length + ' 个点，再选 1 个点）' : '（单击线段，或依次单击两个点）';
        case 'plane': return this.partial.length ? '（已选 ' + this.partial.length + ' 个点，共需 3 个点）' : '（单击一个面，或依次单击三个点）';
        case 'solid': return '（单击立体的任意面、棱或顶点）';
        default: return '';
      }
    }
    updateStatus(extra) {
      const t = this.tool;
      let s;
      if (!t || this.toolId === 'select') {
        const n = this.app.sel.length;
        s = n ? '已选择 ' + n + ' 个对象。Shift+单击 多选；Delete 删除；Esc 取消选择' : '单击选择对象，拖动蓝色动点；拖动空白处旋转，右键拖动也可旋转，Shift+拖动平移，滚轮缩放';
      } else if (t.variadic) {
        const n = this.picked.length;
        s = '<b>' + t.label + '</b>：已选 ' + n + ' 个点。' + (t.variadic === 'closed' ? '单击第一个点闭合，或按 Enter 完成' : '按 Enter 或双击完成');
        s += '<span style="color:#888">' + this.typeHint(t.inputs[0]) + '</span>';
      } else {
        const input = this.currentInput();
        const k = this.picked.length + 1, n = t.inputs.length;
        s = '<b>' + t.label + '</b>' + (n > 1 ? '（第 ' + k + ' / ' + n + ' 步）' : '') + '：' + (input ? this.inputHint(input) : '') + '<span style="color:#888">' + (input ? this.typeHint(input) : '') + '</span>';
      }
      if (extra) s += '　<span style="color:#1f6fd1">' + UI.esc(extra) + '</span>';
      this.app.emit('status', s);
    }
    flash(msg) { this.app.emit('status', '<span class="err">' + UI.esc(msg) + '</span>'); clearTimeout(this._ft); this._ft = setTimeout(() => this.updateStatus(), 1800); }

    // ------------------------------------------------------------ 悬停
    hoverAt(x, y, ev) {
      const app = this.app;
      const t = this.tool;
      app.preview = [];
      let hoverId = null, extra = '';
      if (!t || this.toolId === 'select') {
        const hh = this.hitAll(x, y);
        hoverId = hh.point || hh.line || hh.face || hh.sphere || null;
        if (hoverId) {
          const o = this.S.map.get(hoverId);
          extra = this.describe(o);
        }
      } else {
        const input = this.currentInput();
        if (input) {
          const hits = this.hitAll(x, y);
          const r = this.accept(input, hits, x, y, ev);
          if (r && r.value && !Array.isArray(r.value)) hoverId = r.value;
          if (r && r.partial) hoverId = r.partial;
          if (r && r.create) {
            const sn = this.snap(x, y, ev);
            if (sn) {
              if (sn.kind === 'point') hoverId = sn.id;
              else app.preview.push({ type: 'point', p: sn.pos });
              extra = sn.text;
              const last = this.lastPointPos();
              if (last && (t.id === 'segment' || t.id === 'lineInf' || t.id === 'ray' || t.variadic)) app.preview.push({ type: 'seg', a: last, b: sn.pos });
              if (t.id === 'sphereCR' && sn.pos) extra += '　半径 ' + (this.opts[t.id] || {}).r;
            }
          }
          if (t.variadic === 'closed' && this.picked.length >= 2) {
            const pts = this.picked.map((id) => this.S.map.get(id).v);
            const sn = r && r.create ? this.snap(x, y, ev) : null;
            if (sn) pts.push(sn.pos); else if (hits.point) pts.push(this.S.map.get(hits.point).v);
            if (pts.length >= 3) app.preview.push({ type: 'poly', pts });
          }
        }
      }
      if (app.hover !== hoverId || app.preview.length || this._hadPreview) app.render();
      this._hadPreview = app.preview.length > 0;
      app.hover = hoverId;
      this.updateStatus(extra);
    }
    lastPointPos() {
      const t = this.tool;
      let id = null;
      if (t.variadic) id = this.picked[this.picked.length - 1];
      else if (this.partial.length) id = this.partial[this.partial.length - 1];
      else if (this.picked.length && t.inputs[this.picked.length - 1].type === 'point') id = this.picked[this.picked.length - 1];
      const o = id && this.S.map.get(id);
      return o && o.v;
    }
    describe(o) {
      if (!o) return '';
      const S = this.S;
      const nm = S.displayName(o);
      const typeName = { point: '点', segment: '线段', line: '直线', ray: '射线', polygon: '面', plane: '平面', circle: '圆', sphere: '球', solid: '立体', trace: '轨迹', mark: '标注' }[o.type] || '';
      let s = typeName + ' ' + nm;
      if (o.type === 'segment' && o.v) s += '，长 ' + SG.Exact.fmtNum(V.dist(o.v.a, o.v.b), 3);
      if (o.type === 'point' && o.v) s += ' (' + o.v.map((v) => SG.Exact.fmtNum(v, 2)).join(', ') + ')';
      if (o.parent && S.map.get(o.parent)) s += '（属于 ' + S.displayName(S.map.get(o.parent)) + '，双击选中整个立体）';
      return s;
    }

    // ------------------------------------------------------------ 拖动点
    canDrag(o) {
      if (!o || o.type !== 'point' || o.locked) return false;
      if (o.def.kind === 'solidVertex') {
        const so = this.S.map.get(o.def.solid);
        return so && so.def.kind === 'tpl' && !so.locked;
      }
      const k = SG.Kinds[o.def.kind];
      return !!(k && k.draggable);
    }
    startDrag(o, x, y) {
      this.drag = { kind: 'point', id: o.id, snap: this.app.snapshot(), moved: false, x0: x, y0: y };
      if (o.def.kind === 'solidVertex') {
        const so = this.S.map.get(o.def.solid);
        this.drag.solid = so.id;
        this.drag.o0 = so.def.frame.o.slice();
        this.drag.p0 = o.v.slice();
      } else if (o.def.kind === 'free' || o.def.kind === 'offset') {
        this.drag.p0 = o.v.slice();
      }
    }
    dragTo(x, y, ev) {
      const d = this.drag;
      const S = this.S, cam = this.cam;
      const o = S.map.get(d.id);
      if (!o) return;
      const def = o.def;
      const wp = this.app.workPlane();
      const vertical = ev.shiftKey;
      const planeThrough = (p, n) => ({ o: p, n, d: V.dot(n, p) });
      const moveFree = (p0) => {
        let q;
        if (vertical) {
          const n = wp.n;
          const sd = cam.worldDirToScreen(n);
          const l = Math.hypot(sd[0], sd[1]);
          if (l < 1e-6) return null;
          const s = ((x - d.x0) * sd[0] + (y - d.y0) * sd[1]) / (l * l);
          q = V.addScaled(p0, n, s);
          if (this.app.view.snapGrid && !ev.altKey) {
            const st = this.app.view.snapStep || 0.5;
            const ds = Math.round(s / st) * st;
            q = V.addScaled(p0, n, ds);
          }
        } else {
          q = cam.rayPlane(x, y, planeThrough(p0, wp.n));
          if (!q) return null;
          if (this.app.view.snapGrid && !ev.altKey) {
            const g = this.gridSnap(q, Object.assign({}, wp, { center: V.add(wp.center || wp.o, V.scale(wp.n, V.dot(V.sub(p0, wp.center || wp.o), wp.n))) }));
            q = g;
          }
        }
        return q;
      };
      switch (def.kind) {
        case 'free': {
          const q = moveFree(d.p0);
          if (q) { def.x = q[0]; def.y = q[1]; def.z = q[2]; }
          break;
        }
        case 'offset': {
          const q = moveFree(d.p0);
          if (q) { const b = S.map.get(def.base).v; def.vec = V.sub(q, b); }
          break;
        }
        case 'solidVertex': {
          const q = moveFree(d.p0);
          if (q) { const so = S.map.get(d.solid); so.def.frame.o = V.add(d.o0, V.sub(q, d.p0)); }
          break;
        }
        case 'onLine': {
          const A = S.map.get(def.a).v, B = S.map.get(def.b).v;
          const a2 = cam.project(A), b2 = cam.project(B);
          const r = distToSeg2([x, y], a2, b2);
          let t = def.mode === 'seg' ? r.tc : r.t;
          const len2 = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
          if (!ev.altKey) for (const [f] of FRACS.concat([[0], [1]])) if (Math.abs(t - f) * len2 < 6) t = f;
          def.t = t;
          break;
        }
        case 'onPlane': {
          const pl = S.ctx.plane(def.plane);
          const q = cam.rayPlane(x, y, pl);
          if (q) { const w = V.sub(q, pl.o); def.u = V.dot(w, pl.u); def.v = V.dot(w, pl.v); }
          break;
        }
        case 'onCircle': {
          const C = S.map.get(def.circle).v;
          const q = cam.rayPlane(x, y, G.planePN(C.c, C.n));
          if (q) { const w = V.sub(q, C.c); def.ang = (Math.atan2(V.dot(w, C.v), V.dot(w, C.u)) * 180) / Math.PI; }
          break;
        }
        case 'onSphere': {
          const Sv = S.map.get(def.sphere).v;
          const w = this.sphereDir(x, y, Sv.c, Sv.r);
          def.th = (Math.atan2(w[1], w[0]) * 180) / Math.PI;
          def.ph = (Math.asin(Math.max(-1, Math.min(1, w[2]))) * 180) / Math.PI;
          break;
        }
        case 'fixedLen': {
          const A = S.map.get(def.anchor).v;
          if (def.mode === 'plane') {
            const b = SG.fixedLenBasis(def, S.ctx);
            const q = cam.rayPlane(x, y, planeThrough(A, b.n));
            if (q) { const w = V.sub(q, A); def.th = (Math.atan2(V.dot(w, b.v), V.dot(w, b.u)) * 180) / Math.PI; }
          } else {
            const w = this.sphereDir(x, y, A, def.len);
            def.th = (Math.atan2(w[1], w[0]) * 180) / Math.PI;
            def.ph = (Math.asin(Math.max(-1, Math.min(1, w[2]))) * 180) / Math.PI;
          }
          break;
        }
        case 'alongNormal': {
          const base = S.map.get(def.base).v;
          const n = def.plane ? S.ctx.plane(def.plane).n : [0, 0, 1];
          const q = cam.rayPlane(x, y, planeThrough(base, V.norm(V.cross(n, V.cross(cam.F, n)))));
          if (q) { let s = V.dot(V.sub(q, base), n); if (this.app.view.snapGrid && !ev.altKey) s = Math.round(s / 0.5) * 0.5; def.dist = s; }
          break;
        }
        default: return;
      }
      d.moved = true;
      this.app.live();
      this.updateStatus(this.describe(o));
    }
    /** 鼠标处在球面上的方向（前半球；在球外则取轮廓上最近处） */
    sphereDir(x, y, c, R) {
      const r = this.cam.ray(x, y);
      const oc = V.sub(r.o, c);
      const b = V.dot(oc, r.d), cc = V.len2(oc) - R * R;
      const disc = b * b - cc;
      if (disc >= 0) return V.norm(V.sub(V.addScaled(r.o, r.d, -b + Math.sqrt(disc)), c));
      const q = V.addScaled(r.o, r.d, -b);
      return V.norm(V.sub(q, c));
    }
    endDrag() {
      const d = this.drag;
      this.drag = null;
      if (d && d.moved && d.snap) { this.app.pushUndo(d.snap); this.app.afterChange(); }
    }

    // ------------------------------------------------------------ 事件绑定
    bind() {
      const cv = this.app.canvas;
      const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      cv.addEventListener('pointerdown', (e) => {
        cv.setPointerCapture(e.pointerId);
        const [x, y] = pos(e);
        this.down = { x, y, button: e.button, shift: e.shiftKey, t: Date.now(), moved: false };
        if (e.button === 1 || (e.button === 0 && e.shiftKey && this.toolId !== 'select') || (e.button === 2 && e.shiftKey)) { this.drag = { kind: 'pan', x, y }; return; }
        if (e.button === 2) {
          if (this.tool && this.tool.variadic && this.picked.length) { this.finishVariadic(); this.down = null; return; }
          this.drag = { kind: 'rotate', x, y }; return;
        }
        if (this.toolId === 'select') {
          const hh = this.hitAll(x, y);
          if (hh.label && !hh.point) {
            const o = this.S.map.get(hh.label);
            if (o) { this.drag = { kind: 'label', id: o.id, x, y, snap: this.app.snapshot() }; return; }
          }
          const o = hh.point && this.S.map.get(hh.point);
          if (o && this.canDrag(o)) { this.startDrag(o, x, y); this.drag.pending = true; return; }
        }
        this.drag = { kind: 'rotate', x, y, pending: true };
      });
      cv.addEventListener('pointermove', (e) => {
        const [x, y] = pos(e);
        this.mouse = [x, y];
        const d = this.drag;
        if (this.down && Math.hypot(x - this.down.x, y - this.down.y) > 3) this.down.moved = true;
        if (!d) { this.hoverAt(x, y, e); return; }
        if (d.pending && !(this.down && this.down.moved)) return;
        d.pending = false;
        if (d.kind === 'rotate') {
          const dx = x - d.x, dy = y - d.y;
          const cam = this.cam;
          if (cam.mode === 'oblique') cam.yaw -= dx * 0.4;
          else { cam.az -= dx * 0.4; cam.el = Math.max(-89, Math.min(89, cam.el + dy * 0.4)); }
          cam.update();
          d.x = x; d.y = y;
          this.app.render();
          this.app.emit('camera');
        } else if (d.kind === 'pan') {
          this.cam.panX += x - d.x; this.cam.panY += y - d.y;
          d.x = x; d.y = y;
          this.app.render();
        } else if (d.kind === 'point') {
          this.dragTo(x, y, e);
        } else if (d.kind === 'label') {
          const o = this.S.map.get(d.id);
          const anchor = o.type === 'measure' ? o.v.at : o.v;
          if (anchor && Array.isArray(anchor)) {
            const p = this.cam.project(anchor);
            o.style.labelOffset = [x - p[0], y - p[1]];
            d.moved = true;
            this.app.render();
          }
        }
      });
      cv.addEventListener('pointerup', (e) => {
        const [x, y] = pos(e);
        const d = this.drag;
        const down = this.down;
        this.drag = null;
        this.down = null;
        if (d && d.kind === 'point' && !d.pending) { this.drag = d; this.endDrag(); return; }
        if (d && d.kind === 'label') { if (d.moved) { this.app.pushUndo(d.snap); this.app.afterChange(); } else this.clickSelect(x, y, e); return; }
        if (d && (d.kind === 'rotate' || d.kind === 'pan') && !d.pending) { this.app.autosave(); return; }
        if (!down || down.moved || down.button !== 0) return;
        if (this.toolId === 'select') this.clickSelect(x, y, e);
        else this.toolClick(x, y, e);
      });
      cv.addEventListener('dblclick', (e) => {
        const [x, y] = pos(e);
        if (this.tool && this.tool.variadic) { this.finishVariadic(); return; }
        if (this.toolId === 'select') {
          const hh = this.hitAll(x, y);
          const id = hh.line || hh.face || hh.point;
          const o = id && this.S.map.get(id);
          const pid = o && (o.parent || (o.def.kind === 'solidVertex' ? o.def.solid : null));
          if (pid && this.S.map.get(pid)) this.app.select(pid);
        }
      });
      cv.addEventListener('pointerleave', () => { this.app.hover = null; this.app.preview = []; this.app.render(); });
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const [x, y] = pos(e);
        this.zoomAt(x, y, Math.exp(-e.deltaY * 0.0015));
      }, { passive: false });

      window.addEventListener('keydown', (e) => this.onKey(e));
    }
    zoomAt(x, y, f) {
      const cam = this.cam;
      const ns = Math.max(3, Math.min(2000, cam.scale * f));
      f = ns / cam.scale;
      const cx = cam.cx, cy = cam.cy;
      cam.scale = ns;
      cam.panX += (x - cx) * (1 - f);
      cam.panY += (y - cy) * (1 - f);
      this.app.render();
    }
    clickSelect(x, y, e) {
      const id = this.hitAny(x, y);
      if (!id) { if (!e.shiftKey && !e.ctrlKey) this.app.select([]); }
      else this.app.select(id, e.shiftKey || e.ctrlKey || e.metaKey);
      this.updateStatus();
    }

    onKey(e) {
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (!document.getElementById('modal').classList.contains('hidden')) return;
      const app = this.app;
      const k = e.key;
      if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) app.redo(); else app.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || k === 'Y')) { e.preventDefault(); app.redo(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'S')) { e.preventDefault(); app.saveFile(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 'a' || k === 'A')) { e.preventDefault(); app.select(app.S.objects.filter((o) => o.type === 'point').map((o) => o.id)); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === 'Escape') {
        if (this.picked.length || this.partial.length) this.reset();
        else if (this.toolId !== 'select') this.setTool('select');
        else app.select([]);
        return;
      }
      if (k === 'Enter') { if (this.tool && this.tool.variadic) this.finishVariadic(); return; }
      if (k === 'Delete' || k === 'Backspace') {
        if (app.sel.length) { e.preventDefault(); const ids = app.sel.slice(); app.change('删除', () => app.S.remove(ids)); }
        return;
      }
      const map = { v: 'select', p: 'point', s: 'segment', g: 'polygon', m: 'midpoint' };
      if (map[k]) { this.setTool(map[k]); return; }
      if (k === 'f' || k === 'F') { app.fit(); return; }
      if (k === 'l' || k === 'L') { app.emit('toggleLabels'); return; }
    }
  }

  SG.Interact = Interact;
  void h;
})(globalThis.SG = globalThis.SG || {});
