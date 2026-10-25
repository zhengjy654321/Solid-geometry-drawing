/*
 * 画布左上角的浮动面板：显示"上屏"的控件、题目按钮 / 动点滑块，以及添加进来的文字。
 * 面板是平面的，不随图形旋转；可折叠、可拖动；导出图片时可选择附带其中的文字内容。
 */
(function (SG) {
  'use strict';
  const { UI } = SG;
  const { h } = UI;
  const P = SG.Problem;

  class HUD {
    constructor(app) {
      this.app = app;
      this.el = document.getElementById('hud');
      this.parts = [];
      const pos = UI.LS.get('sg.hudPos', null);
      if (pos) { this.el.style.left = pos[0] + 'px'; this.el.style.top = pos[1] + 'px'; }
      for (const ev of ['hud', 'controls', 'problem', 'change']) app.on(ev, () => this.render());
      app.on('draw', () => this.update());
      this.render();
    }

    /** 面板中每一项 → { el, update, exportText } */
    items() {
      const app = this.app, S = app.S, out = [];
      for (const it of app.hud.items) {
        const remove = () => app.hudToggle(it.kind, it.id, false);
        let part = null;
        if (it.kind === 'obj') {
          const o = S.map.get(it.id);
          if (!o) continue;
          const t = h('div', { class: 'hud-text', title: '单击编辑', style: { color: o.type === 'mark' ? o.style.color : '' } });
          if (o.type === 'mark' && o.def.kind === 'text') t.addEventListener('click', () => SG.TextUI.editExisting(app, o));
          const upd = () => { const s = SG.TextUI.objText(app, o); if (t.textContent !== s) t.textContent = s; };
          upd();
          part = { el: t, update: upd, exportText: () => SG.TextUI.objText(app, o) };
        } else if (it.kind === 'ctl') {
          const c = app.controls.find((x) => x.id === it.id);
          if (!c || !app.runners || !app.runners.controls) continue;
          part = SG.Controls.widget(app, c, app.runners.controls, { compact: true });
        } else if (it.kind === 'pbtn' || it.kind === 'pprm') {
          const pb = app.problem;
          if (!pb || !app.runners || !app.runners.problem) continue;
          const runner = app.runners.problem;
          if (it.kind === 'pbtn') {
            const b = ((pb.panel && pb.panel.buttons) || [])[+it.id];
            if (!b) continue;
            part = { el: h('button', { class: 'cw cw-button', title: b.desc || '', onclick: () => runner.runSafe(b.actions || [], 'b' + it.id, b.label) }, h('b', null, b.label)), update() {} };
          } else {
            const prm = ((pb.panel && pb.panel.params) || []).find((x) => x.id === it.id);
            if (!prm) continue;
            part = SG.Controls.widget(app, Object.assign({ id: 'pp_' + prm.id, type: 'slider', label: prm.label || prm.target }, prm), runner, { compact: true });
          }
        }
        if (!part) continue;
        part.wrap = h('div', { class: 'hud-item' }, part.el, h('button', { class: 'hud-x', title: '从面板移除', onclick: remove }, '✕'));
        out.push(part);
      }
      return out;
    }

    render() {
      const app = this.app, el = this.el;
      this.parts = this.items();
      el.innerHTML = '';
      if (!this.parts.length) { el.classList.add('hidden'); return; }
      el.classList.remove('hidden');
      const open = app.hud.open !== false;
      const head = h('div', { class: 'hud-head', title: '拖动可移动面板' },
        h('span', null, '☰ 面板'),
        h('button', { title: open ? '折叠' : '展开', onclick: () => { app.hud.open = !open; app.autosave(); this.render(); } }, open ? '▾' : '▸'));
      el.appendChild(head);
      if (open) el.appendChild(h('div', { class: 'hud-body' }, this.parts.map((p) => p.wrap)));
      this.bindDrag(head);
    }
    update() { for (const p of this.parts) p.update(); }

    bindDrag(head) {
      const el = this.el;
      head.addEventListener('pointerdown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        e.preventDefault();
        head.setPointerCapture(e.pointerId);
        const sx = e.clientX, sy = e.clientY, x0 = el.offsetLeft, y0 = el.offsetTop;
        const stage = el.parentElement;
        const move = (ev) => {
          const x = Math.max(0, Math.min(stage.clientWidth - 60, x0 + ev.clientX - sx));
          const y = Math.max(0, Math.min(stage.clientHeight - 30, y0 + ev.clientY - sy));
          el.style.left = x + 'px'; el.style.top = y + 'px';
        };
        const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); UI.LS.set('sg.hudPos', [el.offsetLeft, el.offsetTop]); };
        head.addEventListener('pointermove', move);
        head.addEventListener('pointerup', up);
      });
    }

    /** 导出时附带的文字行 */
    exportLines() {
      return this.items().map((p) => (p.exportText ? p.exportText() : null)).filter((s) => s && s.trim());
    }
  }

  /**
   * 把面板文字加到导出的显示列表中（放在图形上方，左对齐）。返回新的包围盒。
   */
  function addToExport(app, dl, box) {
    if (!app.view.exportHud || !app.hudUI) return box;
    const lines = app.hudUI.exportLines();
    if (!lines.length) return box;
    const size = 14, lh = 21, pad = 10;
    const c = document.createElement('canvas').getContext('2d');
    c.font = size + 'px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    const w = Math.max(...lines.map((s) => c.measureText(s).width)) + 2 * pad;
    const hgt = lines.length * lh + 2 * pad - 4;
    const x0 = box.x, y0 = box.y - hgt - 14;
    dl.labels.push({ k: 'poly', pts: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + hgt], [x0, y0 + hgt]], fill: '#f4f7fb', alpha: 1 });
    dl.labels.push({ k: 'path', pts: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + hgt], [x0, y0 + hgt], [x0, y0]], color: '#c9d3df', width: 1, dash: null });
    lines.forEach((s, i) => dl.labels.push({ k: 'text', x: x0 + pad, y: y0 + pad + lh * i + lh / 2 - 2, parts: [{ t: s }], size, color: '#1f2a37', align: 'left' }));
    const nx = Math.min(box.x, x0), ny = y0;
    return { x: nx, y: ny, w: Math.max(box.x + box.w, x0 + w) - nx, h: box.y + box.h - ny };
  }

  SG.HUD = HUD;
  SG.HUD.addToExport = addToExport;
})(globalThis.SG = globalThis.SG || {});
