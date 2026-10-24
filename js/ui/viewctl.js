/*
 * 视角控制器（画布右下角）：
 *   · 坐标轴指示器：显示 x / y / z 轴当前朝向，单击轴端点转到从该方向看的视角（再点一次转到反面）
 *   · 旋转摇杆：往哪推，图形就往哪转（左右 = 绕竖直轴转，上下 = 前后翻）
 *   · 按钮：每次 15°（长按连续转）、转到背面、复位
 *   · 高级设置（折叠）：直接输入水平角 / 俯仰角，拖动时锁定方向
 */
(function (SG) {
  'use strict';
  const { V, UI } = SG;
  const { h } = UI;

  const AXES = [
    { name: 'x', dir: [1, 0, 0], color: '#c0392b' },
    { name: 'y', dir: [0, 1, 0], color: '#27ae60' },
    { name: 'z', dir: [0, 0, 1], color: '#2c6fbb' },
  ];
  const STEP = 15;      // 单击转动的角度
  const SPEED = 110;    // 摇杆推满 / 长按时的转速（度 / 秒）

  class ViewCtl {
    constructor(app) {
      this.app = app;
      this.el = document.getElementById('viewctl');
      const narrow = window.innerWidth < 760;
      this.open = UI.LS.get('sg.viewctlOpen', !narrow);
      this.build();
      app.on('draw', () => this.refresh());
      app.on('viewmode', () => this.refresh(true));
    }

    build() {
      const app = this.app;
      const el = this.el;
      el.innerHTML = '';
      this.body = h('div', { class: 'vc-body' });
      el.appendChild(h('button', { class: 'vc-head', title: '展开 / 收起视角控制器', onclick: () => this.toggle() },
        h('span', null, '⟳ 视角'), this.caret = h('span', { class: 'vc-caret' }, this.open ? '▾' : '▸')));
      el.appendChild(this.body);

      // 坐标轴指示器 + 摇杆
      this.gizmo = h('canvas', { class: 'vc-gizmo', title: '单击轴的端点：从该方向看；再点一次：转到反面' });
      this.gizmo.addEventListener('click', (e) => this.gizmoClick(e));
      const pad = h('div', { class: 'vc-pad', title: '往哪推，图形就往哪转' });
      const knob = h('div', { class: 'vc-knob' });
      pad.appendChild(knob);
      for (const [cls, t] of [['l', '◀'], ['r', '▶'], ['u', '▲'], ['d', '▼']]) pad.appendChild(h('span', { class: 'vc-arrow ' + cls }, t));
      this.bindPad(pad, knob);
      this.body.appendChild(h('div', { class: 'vc-row' }, this.gizmo, pad));
      this.hint = h('div', { class: 'vc-hint' }, '左右推：绕竖直轴转　上下推：前后翻');
      this.body.appendChild(this.hint);

      // 按钮
      const btn = (label, title, dAz, dEl) => {
        const b = h('button', { title }, label);
        this.bindHold(b, dAz, dEl);
        return b;
      };
      this.body.appendChild(h('div', { class: 'vc-btns' },
        btn('◀', '图形向左转 15°（长按连续转）', STEP, 0),
        btn('▶', '图形向右转 15°（长按连续转）', -STEP, 0),
        btn('▲', '图形向上翻 15°（看到更多底面）', 0, -STEP),
        btn('▼', '图形向下翻 15°（看到更多顶面）', 0, STEP)));
      this.body.appendChild(h('div', { class: 'vc-btns' },
        h('button', { title: '水平转 180°，看图形的背面', onclick: () => app.rotateView(180, 0) }, '转到背面'),
        h('button', { title: '回到默认的斜视角度（基准面恢复为底面 xOy）', onclick: () => { if (app.cam.base) app.setViewBase(null); app.setAngles(32, 18); app.fit(); } }, '复位')));

      // 视角基准面
      this.baseSel = h('select', { class: 'vc-base-sel', title: '旋转时以哪个面作为"地面"' });
      this.baseSel.addEventListener('change', () => {
        const v = this.baseSel.value;
        if (v === 'xy') app.setViewBase(null);
        else if (v === 'work') {
          if (app.work.kind === 'ref') app.setViewBase(app.work.ref);
          else if (app.work.kind === 'xy') app.setViewBase(null);
          else app.setViewBase(app.C.axisPlane(app.work.kind, app.work.h || 0));
        } else if (v === 'pick') { app.ui.setTool('setViewBase'); UI.toast('请在图中单击一个面，或依次单击三个点', '', 3000); }
        this.refresh(true);
      });
      this.baseBtns = h('div', { class: 'vc-btns' },
        h('button', { title: '把基准面摆成课本中底面的样子（正立的斜视角度）', onclick: () => { app.setAngles(app.cam.az, 18); app.fit(); } }, '放平'),
        h('button', { title: '垂直正对基准面看', onclick: () => app.setAngles(app.cam.az, 89.9) }, '正对'));
      this.body.appendChild(h('div', { class: 'vc-base' }, h('span', null, '基准面'), this.baseSel));
      this.body.appendChild(this.baseBtns);

      // 高级设置
      this.azIn = h('input', { type: 'number', step: 1, class: 'vc-num' });
      this.elIn = h('input', { type: 'number', step: 1, class: 'vc-num' });
      this.azRg = h('input', { type: 'range', min: -180, max: 180, step: 1 });
      this.elRg = h('input', { type: 'range', min: -180, max: 180, step: 1 });
      const setAz = (v) => { if (isFinite(v)) { if (app.cam.mode === 'oblique') { app.cam.yaw = v; app.cam.update(); app.render(); } else app.setAngles(v, null); } };
      const setEl = (v) => { if (isFinite(v)) app.setAngles(null, v); };
      this.azIn.addEventListener('change', () => setAz(parseFloat(this.azIn.value)));
      this.elIn.addEventListener('change', () => setEl(parseFloat(this.elIn.value)));
      this.azRg.addEventListener('input', () => setAz(parseFloat(this.azRg.value)));
      this.elRg.addEventListener('input', () => setEl(parseFloat(this.elRg.value)));
      this.upCb = h('input', {
        type: 'checkbox', checked: !!app.view.upright,
        onchange: (e) => { app.view.upright = e.target.checked; app.saveSettings(); app.setAngles(null, app.cam.el); this.refresh(true); },
      });
      this.lockCb = h('input', { type: 'checkbox', checked: app.rotLockOn(), onchange: (e) => { app.view.rotLock = e.target.checked; app.saveSettings(); } });
      this.adv = h('details', { class: 'vc-adv' },
        h('summary', null, '高级设置'),
        h('div', { class: 'vc-field' }, h('label', null, '水平角 θ'), this.azIn, h('span', null, '°')), this.azRg,
        h('div', { class: 'vc-field' }, h('label', null, '俯仰角 φ'), this.elIn, h('span', null, '°')), this.elRg,
        this.obliqueNote = h('div', { class: 'vc-hint' }, '斜二测画法只能水平转动，且总以底面 xOy 为基准；俯仰角、基准面需切换回普通视图'),
        h('label', { class: 'vc-check' }, this.upCb, '保持正立（z 轴或基准面法线朝上，俯仰不超过 90°，不能翻过头顶）'),
        h('label', { class: 'vc-check' }, this.lockCb, '用手指 / 鼠标拖动画布旋转时锁定方向（每次只横转或只竖转）'));
      this.body.appendChild(this.adv);
      this.applyOpen();
    }

    toggle() {
      this.open = !this.open;
      UI.LS.set('sg.viewctlOpen', this.open);
      this.applyOpen();
    }
    applyOpen() {
      this.body.style.display = this.open ? '' : 'none';
      this.caret.textContent = this.open ? '▾' : '▸';
      this.el.classList.toggle('closed', !this.open);
      if (this.open) this.refresh(true);
    }

    /** 摇杆：按住后按偏移量持续转动 */
    bindPad(pad, knob) {
      const app = this.app;
      let jx = 0, jy = 0, raf = 0, last = 0;
      const R = 26;
      const set = () => { knob.style.transform = 'translate(calc(-50% + ' + jx * R + 'px), calc(-50% + ' + jy * R + 'px))'; };
      const move = (e) => {
        const r = pad.getBoundingClientRect();
        let x = (e.clientX - (r.left + r.width / 2)) / R, y = (e.clientY - (r.top + r.height / 2)) / R;
        const l = Math.hypot(x, y);
        if (l > 1) { x /= l; y /= l; }
        jx = x; jy = y;
        set();
      };
      const loop = (t) => {
        const dt = Math.min(0.05, (t - last) / 1000);
        last = t;
        if (Math.abs(jx) > 0.08 || Math.abs(jy) > 0.08) app.rotateView(-jx * SPEED * dt, jy * SPEED * dt);
        raf = requestAnimationFrame(loop);
      };
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pad.setPointerCapture(e.pointerId);
        move(e);
        last = performance.now();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(loop);
      });
      pad.addEventListener('pointermove', (e) => { if (raf) move(e); });
      const end = () => { cancelAnimationFrame(raf); raf = 0; jx = 0; jy = 0; set(); };
      pad.addEventListener('pointerup', end);
      pad.addEventListener('pointercancel', end);
      set();
    }

    /** 按钮：单击转一步；长按连续转 */
    bindHold(b, dAz, dEl) {
      const app = this.app;
      let timer = 0, raf = 0, held = false, last = 0;
      const loop = (t) => {
        const dt = Math.min(0.05, (t - last) / 1000);
        last = t;
        app.rotateView(Math.sign(dAz) * SPEED * dt, Math.sign(dEl) * SPEED * dt);
        raf = requestAnimationFrame(loop);
      };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        held = false;
        timer = setTimeout(() => { held = true; last = performance.now(); raf = requestAnimationFrame(loop); }, 350);
      });
      const end = (fire) => {
        clearTimeout(timer);
        cancelAnimationFrame(raf);
        if (fire && !held) app.rotateView(dAz, dEl);
        held = false; raf = 0;
      };
      b.addEventListener('pointerup', () => end(true));
      b.addEventListener('pointercancel', () => end(false));
    }

    /** 坐标轴各端点在指示器上的位置 */
    gizmoPoints() {
      const cam = this.app.cam;
      const w = this.gizmo.clientWidth || 88;
      const c = w / 2, L = w * 0.34;
      const out = [];
      for (const a of AXES) {
        for (const sgn of [1, -1]) {
          const d = V.scale(a.dir, sgn);
          out.push({ axis: a, sgn, x: c + L * V.dot(cam.a1, d) / (cam.mode === 'oblique' ? 1.1 : 1), y: c - L * V.dot(cam.a2, d) / (cam.mode === 'oblique' ? 1.1 : 1), z: V.dot(cam.F, d) });
        }
      }
      return { c, pts: out };
    }

    refresh(force) {
      if (!this.open) return;
      const g = this.gizmo;
      const dpr = window.devicePixelRatio || 1;
      const w = g.clientWidth || 88;
      if (g.width !== Math.round(w * dpr)) { g.width = Math.round(w * dpr); g.height = Math.round(w * dpr); }
      const ctx = g.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, w);
      ctx.fillStyle = '#f4f7fb';
      ctx.beginPath(); ctx.arc(w / 2, w / 2, w / 2 - 1, 0, Math.PI * 2); ctx.fill();
      const { c, pts } = this.gizmoPoints();
      pts.sort((a, b) => a.z - b.z);
      for (const p of pts) {
        ctx.globalAlpha = p.z < -0.05 ? 0.55 : 1;
        ctx.strokeStyle = p.axis.color;
        ctx.lineWidth = p.sgn > 0 ? 2.2 : 1.2;
        ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.sgn > 0 ? 9 : 6, 0, Math.PI * 2);
        if (p.sgn > 0) { ctx.fillStyle = p.axis.color; ctx.fill(); }
        else { ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); }
        if (p.sgn > 0) {
          ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(p.axis.name, p.x, p.y + 0.5);
        }
      }
      ctx.globalAlpha = 1;
      this.pts = pts;
      // 高级设置中的数值
      const cam = this.app.cam;
      const ob = cam.mode === 'oblique';
      const az = Math.round(ob ? cam.yaw : cam.az), el = Math.round(cam.el);
      for (const [inp, v] of [[this.azIn, az], [this.azRg, az]]) if (document.activeElement !== inp || force) inp.value = v;
      for (const [inp, v] of [[this.elIn, el], [this.elRg, el]]) if (document.activeElement !== inp || force) inp.value = v;
      this.elIn.disabled = ob; this.elRg.disabled = ob;
      this.obliqueNote.style.display = ob ? '' : 'none';
      this.lockCb.checked = this.app.rotLockOn();
      const b = this.app.cam.base;
      const opts = [['xy', '底面 xOy（默认）']].concat(b ? [['cur', '● ' + this.app.viewBaseLabel()]] : []).concat([['work', '当前工作面'], ['pick', '选择一个面…']]);
      const key = opts.map((o) => o.join(':')).join('|');
      if (this._baseKey !== key) {
        this._baseKey = key;
        this.baseSel.innerHTML = '';
        for (const [v, l] of opts) this.baseSel.appendChild(h('option', { value: v }, l));
      }
      this.baseSel.value = b ? 'cur' : 'xy';
      this.baseSel.disabled = ob;
      this.hint.textContent = b && !ob ? '左右推：绕基准面的法线转　上下推：相对基准面前后翻' : '左右推：绕竖直轴转　上下推：前后翻';
      this.upCb.checked = !!this.app.view.upright;
      this.elRg.min = this.app.view.upright ? -89 : -180;
      this.elRg.max = this.app.view.upright ? 89 : 180;
    }

    gizmoClick(e) {
      const r = this.gizmo.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bd = 16;
      for (const p of this.pts || []) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd || (best && Math.abs(d - bd) < 1e-6 && p.z > best.z)) { bd = d; best = p; }
      }
      if (!best) return;
      const app = this.app, cam = app.cam;
      let dir = V.scale(best.axis.dir, best.sgn);
      // 已经是从这个方向看了 → 转到反面
      if (cam.mode !== 'oblique' && V.dot(cam.F, dir) > 0.999) dir = V.neg(dir);
      // 在当前基准下求对应的角度（正对基准面法向时取 ±89.9°，保持水平角不变）
      const ang = cam.anglesFor(dir, null);
      if (Math.abs(ang.el) > 89.8) app.setAngles(null, ang.el > 0 ? 89.9 : -89.9);
      else app.setAngles(ang.az, ang.el);
    }
  }

  SG.ViewCtl = ViewCtl;
})(globalThis.SG = globalThis.SG || {});
