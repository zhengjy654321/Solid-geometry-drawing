/*
 * 摇杆：选中一个动点时出现。按住摇杆，点就朝相应方向持续移动；可同时记录轨迹。
 */
(function (SG) {
  'use strict';
  const { V, UI } = SG;
  const { h } = UI;

  /** 每种动点的摇杆映射：返回 { dims: 1|2, apply(def, jx, jy, dt, speed) } */
  function mapping(app, o) {
    const S = app.S, cam = app.cam;
    const d = o.def;
    switch (d.kind) {
      case 'fixedLen':
        if (d.mode === 'plane') return { dims: 1, hint: '左右：沿圆周转动', apply: (jx, jy, dt, sp) => { d.th += jx * dt * 90 * sp; } };
        return { dims: 2, hint: '左右：方位角 θ；上下：仰角 φ（点在球面上运动）', apply: (jx, jy, dt, sp) => { d.th += jx * dt * 90 * sp; d.ph = Math.max(-90, Math.min(90, d.ph - jy * dt * 60 * sp)); } };
      case 'onCircle': return { dims: 1, hint: '左右：沿圆周转动', apply: (jx, jy, dt, sp) => { d.ang += jx * dt * 90 * sp; } };
      case 'onSphere': return { dims: 2, hint: '左右：经度；上下：纬度', apply: (jx, jy, dt, sp) => { d.th += jx * dt * 90 * sp; d.ph = Math.max(-90, Math.min(90, d.ph - jy * dt * 60 * sp)); } };
      case 'onLine': {
        const A = S.map.get(d.a), B = S.map.get(d.b);
        // 让摇杆"向右"对应屏幕上向右的方向
        let sgn = 1;
        if (A && B && A.v && B.v) { const a = cam.project(A.v), b = cam.project(B.v); sgn = b[0] - a[0] >= 0 ? 1 : -1; }
        const L = A && B && A.v && B.v ? Math.max(V.dist(A.v, B.v), 1e-6) : 1;
        return { dims: 1, hint: '左右：沿直线移动', apply: (jx, jy, dt, sp) => { let t = d.t + (sgn * jx * dt * 1.5 * sp) / L; if (d.mode === 'seg') t = Math.max(0, Math.min(1, t)); d.t = t; } };
      }
      case 'alongNormal': return { dims: 1, hint: '左右：沿法向移动', apply: (jx, jy, dt, sp) => { d.dist += jx * dt * 1.5 * sp; } };
      case 'onPlane': {
        const pl = S.ctx.plane(d.plane);
        return { dims: 2, hint: '在所在平面内移动', apply: (jx, jy, dt, sp) => {
          const w = screenToPlane(cam, pl, jx, jy);
          d.u += V.dot(w, pl.u) * dt * 1.5 * sp; d.v += V.dot(w, pl.v) * dt * 1.5 * sp;
        } };
      }
      case 'free': case 'offset': {
        const wp = app.workPlane();
        return { dims: 2, vertical: true, hint: '在工作面内移动；右侧按钮沿法向上下移动', apply: (jx, jy, dt, sp, vz) => {
          let w = V.scale(screenToPlane(cam, wp, jx, jy), dt * 1.5 * sp);
          if (vz) w = V.add(w, V.scale(wp.n, vz * dt * 1.5 * sp));
          if (d.kind === 'free') { d.x += w[0]; d.y += w[1]; d.z += w[2]; } else d.vec = V.add(d.vec, w);
        } };
      }
      default: return null;
    }
  }
  /** 屏幕方向 (jx 向右, jy 向下) 映射到平面内的单位方向 */
  function screenToPlane(cam, pl, jx, jy) {
    const proj = (v) => V.sub(v, V.scale(pl.n, V.dot(v, pl.n)));
    let r = proj(cam.a1), u = proj(cam.a2);
    if (V.len(r) < 1e-6) r = pl.u;
    if (V.len(u) < 1e-6) u = V.cross(pl.n, r);
    r = V.norm(r); u = V.norm(u);
    return V.add(V.scale(r, jx), V.scale(u, -jy));
  }

  class Joystick {
    constructor(app) {
      this.app = app;
      this.el = document.getElementById('joystick');
      this.speed = 1;
      this.target = null;
      this.closed = new Set();
      app.on('select', () => this.update());
      app.on('change', () => this.update());
    }
    update() {
      const app = this.app;
      const sel = app.selected();
      const o = sel.length === 1 && sel[0].type === 'point' ? sel[0] : null;
      const m = o && !o.locked && mapping(app, o);
      if (!m || this.closed.has(o.id)) { this.el.classList.add('hidden'); this.target = null; return; }
      if (this.target === o.id && !this.el.classList.contains('hidden') && this.active) return;
      this.target = o.id;
      this.build(o, m);
    }
    build(o, m) {
      const app = this.app, S = app.S;
      const el = this.el;
      el.innerHTML = '';
      el.classList.remove('hidden');
      el.appendChild(h('div', { class: 'jt' }, h('span', { html: '摇杆 · 动点 ' + UI.nameHTML(o.name) }), h('button', { title: '关闭', onclick: () => { this.closed.add(o.id); el.classList.add('hidden'); } }, '✕')));
      const pad = h('div', { class: 'pad' + (m.dims === 1 ? ' h1' : '') });
      const knob = h('div', { class: 'knob' });
      pad.appendChild(knob);
      const row = h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' } }, pad);
      let vz = 0;
      if (m.vertical) {
        const mk = (label, v) => {
          const b = h('button', { class: 'btn', style: { padding: '6px 8px' } }, label);
          b.addEventListener('pointerdown', (e) => { e.preventDefault(); vz = v; this.start(o, m, () => [0, 0, vz]); });
          const up = () => { vz = 0; this.stopLoop(); };
          b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up);
          return b;
        };
        row.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, mk('▲', 1), mk('▼', -1)));
      }
      el.appendChild(row);
      el.appendChild(h('div', { class: 'hint' }, m.hint));
      // 摇杆拖动
      let jx = 0, jy = 0;
      const R = m.dims === 1 ? 62 : 42;
      const setKnob = () => { knob.style.left = 'calc(50% + ' + jx * R + 'px)'; knob.style.top = 'calc(50% + ' + jy * (m.dims === 1 ? 0 : R) + 'px)'; };
      const onMove = (e) => {
        const r = pad.getBoundingClientRect();
        let x = (e.clientX - (r.left + r.width / 2)) / R, y = (e.clientY - (r.top + r.height / 2)) / R;
        if (m.dims === 1) y = 0;
        const l = Math.hypot(x, y);
        if (l > 1) { x /= l; y /= l; }
        jx = x; jy = y;
        setKnob();
      };
      pad.addEventListener('pointerdown', (e) => {
        pad.setPointerCapture(e.pointerId);
        onMove(e);
        this.start(o, m, () => [jx, jy, 0]);
      });
      pad.addEventListener('pointermove', (e) => { if (this.active) onMove(e); });
      const end = () => { jx = 0; jy = 0; setKnob(); this.stopLoop(); };
      pad.addEventListener('pointerup', end);
      pad.addEventListener('pointercancel', end);
      // 速度、轨迹
      const tr = S.objects.find((x) => x.type === 'trace' && x.def.p === o.id);
      el.appendChild(h('div', { class: 'row' }, '速度', h('input', { type: 'range', min: 0.1, max: 4, step: 0.1, value: this.speed, style: { flex: 1 }, oninput: (e) => { this.speed = +e.target.value; } })));
      el.appendChild(h('div', { class: 'row' },
        tr ? h('button', { class: tr.recording ? 'on' : '', onclick: () => app.change('轨迹', () => { tr.recording = !tr.recording; }) }, tr.recording ? '● 记录中' : '○ 记录轨迹')
          : h('button', { onclick: () => app.change('轨迹', () => app.C.exec({ op: 'trace', point: o.id })) }, '记录轨迹'),
        tr ? h('button', { onclick: () => app.change('清除', () => { tr.data = []; }) }, '清除轨迹') : null,
        h('button', { onclick: () => app.change('锁定', () => { o.locked = true; }) }, '锁定')));
    }
    start(o, m, getDir) {
      if (this.active) return;
      const app = this.app;
      this.active = { snap: app.snapshot(), t: performance.now() };
      const loop = (t) => {
        if (!this.active) return;
        const dt = Math.min(0.05, (t - this.active.t) / 1000);
        this.active.t = t;
        const [jx, jy, vz] = getDir();
        if (jx || jy || vz) {
          m.apply(jx, jy, dt, this.speed, vz);
          app.live();
        }
        this.active.raf = requestAnimationFrame(loop);
      };
      this.active.raf = requestAnimationFrame(loop);
    }
    stopLoop() {
      if (!this.active) return;
      cancelAnimationFrame(this.active.raf);
      const snap = this.active.snap;
      this.active = null;
      this.app.pushUndo(snap);
      this.app.afterChange();
    }
  }

  SG.Joystick = Joystick;
})(globalThis.SG = globalThis.SG || {});
