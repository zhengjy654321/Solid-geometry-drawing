/*
 * "控制"分区：不依赖题目的控件（滑动条 / 按钮 / 开关 / 文字），可自定义，也可由 AI 设计；可"上屏"到画布左上角面板。
 *
 * 控件格式：
 *   { id, type:'slider', label, target, key, min, max }
 *   { id, type:'button', label, desc, actions:[动作…] }      动作同题目控制面板（见 docs/problem-panel.md）
 *   { id, type:'toggle', label, targets:[对象名…] }            勾选 = 显示这些对象
 *   { id, type:'text', label, text }                           文字可含变量，如 {ang:A,B,C}
 */
(function (SG) {
  'use strict';
  const { UI } = SG;
  const { h } = UI;
  const P = SG.Problem;
  const TYPES = { slider: '滑动条', button: '按钮', toggle: '开关（显示 / 隐藏对象）', text: '文字（可含变量）' };
  let seq = 0;
  const newId = () => 'c' + Date.now().toString(36) + (seq++);

  /** 控件的可交互界面；返回 { el, update } */
  function widget(app, ctl, runner, opts) {
    opts = opts || {};
    const S = app.S;
    switch (ctl.type) {
      case 'slider': {
        let r = null, err = '';
        try { r = P.resolveParam(app, ctl); } catch (e) { err = e.message; }
        if (!r) return { el: h('div', { class: 'cw-err' }, (ctl.label || '滑动条') + '：' + err), update() {} };
        const val = P.getP(app, r);
        const num = h('input', { type: 'number', class: 'num cw-num', step: 'any', value: +val.toFixed(3) });
        const rng = h('input', { type: 'range', min: r.min, max: r.max, step: (r.max - r.min) / 500 || 0.001, value: val });
        let snap = null;
        rng.addEventListener('pointerdown', () => { runner.stop(); snap = app.snapshot(); });
        rng.addEventListener('input', () => { if (!snap) snap = app.snapshot(); P.setP(app, r, +rng.value); num.value = (+rng.value).toFixed(3); app.live(); });
        rng.addEventListener('change', () => { if (snap) { app.pushUndo(snap); snap = null; app.afterChange(); } });
        num.addEventListener('change', () => { const v = parseFloat(num.value); if (isFinite(v)) { runner.stop(); app.change('参数', () => P.setP(app, r, Math.max(r.min, Math.min(r.max, v)))); } });
        const key = 'c:' + ctl.id;
        const play = h('button', { class: 'btn cw-play', title: '来回播放' }, runner.isPlaying(key) ? '■' : '▶');
        play.addEventListener('click', () => { if (runner.isPlaying(key)) runner.stop(); else runner.play({ param: { target: ctl.target, key: ctl.key, min: ctl.min, max: ctl.max } }, key); });
        const el = h('div', { class: 'cw cw-slider' }, h('div', { class: 'cw-label' }, ctl.label || '滑动条'), h('div', { class: 'cw-row' }, rng, num, play));
        return {
          el,
          update() {
            try {
              const v = P.getP(app, r);
              if (document.activeElement !== rng) rng.value = v;
              if (document.activeElement !== num) num.value = (+v).toFixed(3);
              play.textContent = runner.isPlaying(key) ? '■' : '▶';
            } catch (e) { /* 忽略 */ }
          },
          exportText: () => (ctl.label || '') + '：' + SG.TextVars.fmtNum(P.getP(app, r)),
        };
      }
      case 'button': {
        const el = h('button', { class: 'cw cw-button', title: ctl.desc || '', onclick: () => runner.runSafe(ctl.actions || [], 'c' + ctl.id, ctl.label) }, h('b', null, ctl.label || '按钮'), ctl.desc && !opts.compact ? h('small', null, ctl.desc) : null);
        return { el, update() {} };
      }
      case 'toggle': {
        const objs = () => (ctl.targets || []).map((n) => S.get(n)).filter(Boolean);
        const cb = h('input', { type: 'checkbox' });
        const sync = () => { const os = objs(); cb.checked = os.length > 0 && os.every((o) => !o.hidden); };
        cb.addEventListener('change', () => app.change('显示', () => { for (const o of objs()) o.hidden = !cb.checked; }));
        sync();
        return { el: h('label', { class: 'cw cw-toggle' }, cb, ctl.label || '开关'), update: sync };
      }
      case 'text': {
        const t = h('div', { class: 'cw cw-text' });
        const upd = () => { const s = SG.TextVars.render(S, ctl.text || ''); if (t.textContent !== s) t.textContent = s; };
        upd();
        return { el: t, update: upd, exportText: () => SG.TextVars.render(S, ctl.text || '') };
      }
      default: return { el: h('div', null, '未知控件'), update() {} };
    }
  }

  // ================================================================ 编辑器
  /** 所有可调参数（对象 · 参数） */
  function paramOptions(app) {
    const S = app.S, out = [];
    for (const o of S.objects) {
      if (o.hidden && o.type === 'plane' && !o.name) continue;
      for (const p of S.params(o)) {
        if (p.options || p.fixed || typeof S.getParam(o, p) !== 'number') continue;
        out.push({ value: (o.name || o.id) + '|' + p.key.join('.'), label: S.displayName(o) + ' · ' + p.label, o, p });
      }
    }
    return out;
  }
  function paramPicker(app, init) {
    const opts = paramOptions(app);
    const sel = h('select', { class: 'ce-param' }, h('option', { value: '' }, '— 选择对象的参数 —'), opts.map((x) => h('option', { value: x.value }, x.label)));
    if (init && init.target) {
      const v = init.target + '|' + init.key;
      if (opts.some((x) => x.value === v)) sel.value = v;
    }
    const get = () => {
      if (!sel.value) return null;
      const k = sel.value.lastIndexOf('|');
      return { target: sel.value.slice(0, k), key: sel.value.slice(k + 1) };
    };
    return { el: sel, get, opts };
  }

  const ACTION_TYPES = [
    ['set', '设为某值'], ['play', '播放动画'], ['stop', '停止动画'], ['show', '显示对象'], ['hide', '隐藏对象'], ['toggle', '切换显示'],
    ['view', '转到视角'], ['view-default', '默认视角'], ['text', '显示说明文字'], ['trace', '生成完整轨迹'], ['json', '高级（JSON）'],
  ];
  /** 一行动作编辑器；返回 { el, get() } */
  function actionRow(app, a, onRemove) {
    a = a || { do: 'set' };
    const type = h('select', { class: 'ce-atype' }, ACTION_TYPES.map(([v, l]) => h('option', { value: v }, l)));
    const t0 = a.do === 'view' && a.preset === 'default' ? 'view-default' : ACTION_TYPES.some(([v]) => v === a.do) ? a.do : 'json';
    type.value = t0;
    const box = h('div', { class: 'ce-afields' });
    let get = () => ({});
    const inp = (v, ph, w) => h('input', { type: 'text', value: v == null ? '' : v, placeholder: ph, style: { width: (w || 70) + 'px' } });
    const build = () => {
      box.innerHTML = '';
      const t = type.value;
      const pp = () => { const p = paramPicker(app, a.param && typeof a.param === 'object' ? a.param : a.target ? { target: a.target, key: a.key } : null); box.appendChild(p.el); return p; };
      if (t === 'set') {
        const p = pp(); const v = inp(a.value, '值');
        box.appendChild(v);
        get = () => ({ do: 'set', param: p.get(), value: +v.value });
      } else if (t === 'play') {
        const p = pp(); const f = inp(a.from, '从'), to = inp(a.to, '到'), sec = inp(a.seconds || 4, '秒', 50);
        const loop = h('input', { type: 'checkbox', checked: a.loop !== false }), tr = h('input', { type: 'checkbox', checked: !!a.trace });
        box.append(f, to, sec, h('label', null, loop, '循环'), h('label', null, tr, '轨迹'));
        get = () => {
          const r = { do: 'play', param: p.get(), seconds: +sec.value || 4, loop: loop.checked, trace: tr.checked };
          if (f.value !== '') r.from = +f.value;
          if (to.value !== '') r.to = +to.value;
          return r;
        };
      } else if (t === 'stop' || t === 'view-default') {
        get = () => (t === 'stop' ? { do: 'stop' } : { do: 'view', preset: 'default' });
      } else if (t === 'show' || t === 'hide' || t === 'toggle') {
        const v = inp((a.targets || []).join(', '), '对象名称，用逗号分隔，如 AE, 平面β', 230);
        box.appendChild(v);
        get = () => ({ do: t, targets: v.value.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean) });
      } else if (t === 'view') {
        const cam = app.cam;
        let cur = a.az != null || a.mode ? a : { az: cam.az, el: cam.el, mode: cam.mode, yaw: cam.yaw };
        const lbl = h('span', { class: 'note' });
        const show = () => { lbl.textContent = cur.mode === 'oblique' ? '斜二测，水平角 ' + Math.round(cur.yaw || 0) + '°' : '水平角 ' + Math.round(cur.az) + '°，俯仰角 ' + Math.round(cur.el) + '°'; };
        show();
        box.append(lbl, h('button', { class: 'btn', onclick: () => { cur = { az: cam.az, el: cam.el, mode: cam.mode, yaw: cam.yaw }; show(); } }, '使用当前视角'));
        get = () => ({ do: 'view', az: +cur.az.toFixed(1), el: +cur.el.toFixed(1), mode: cur.mode, yaw: cur.yaw });
      } else if (t === 'text') {
        const v = inp(a.text, '说明文字，可含变量 {ang:A,B,C}', 260);
        box.appendChild(v);
        get = () => ({ do: 'text', text: v.value });
      } else if (t === 'trace') {
        const p = pp();
        get = () => ({ do: 'trace', param: p.get(), mode: 'full' });
      } else {
        const ta = h('textarea', { rows: 2, style: { width: '100%' } }, JSON.stringify(a.do && t0 === 'json' ? a : { do: 'draw', commands: [] }));
        box.appendChild(ta);
        get = () => JSON.parse(ta.value);
      }
    };
    type.addEventListener('change', () => { a = { do: type.value }; build(); });
    build();
    const el = h('div', { class: 'ce-arow' }, type, box, h('button', { class: 'btn', title: '删除这个动作', onclick: () => { el.remove(); onRemove(); } }, '✕'));
    return { el, get: () => get() };
  }

  /** 新建 / 编辑控件对话框；返回 Promise<控件 | null> */
  function editControl(app, init) {
    const c = JSON.parse(JSON.stringify(init || { type: 'slider' }));
    const type = h('select', null, Object.entries(TYPES).map(([v, l]) => h('option', { value: v, selected: v === c.type }, l)));
    const label = h('input', { type: 'text', value: c.label || '', placeholder: '显示的名称' });
    const pin = h('input', { type: 'checkbox', checked: init ? app.hudHas('ctl', c.id) : false });
    const area = h('div', { class: 'ce-area' });
    let collect = () => ({});
    const build = () => {
      area.innerHTML = '';
      const t = type.value;
      if (t === 'slider') {
        const p = paramPicker(app, c.target ? c : null);
        const min = h('input', { type: 'number', step: 'any', value: c.min != null ? c.min : '', class: 'num' });
        const max = h('input', { type: 'number', step: 'any', value: c.max != null ? c.max : '', class: 'num' });
        p.el.addEventListener('change', () => {
          const v = p.get();
          if (!v) return;
          try { const r = P.resolveParam(app, v); min.value = +r.min.toFixed(4); max.value = +r.max.toFixed(4); if (!label.value) label.value = p.opts.find((x) => x.value === p.el.value).label; } catch (e) { /* 忽略 */ }
        });
        area.append(h('div', { class: 'field' }, h('label', null, '控制的参数'), p.el), h('div', { class: 'field' }, h('label', null, '范围'), min, h('span', null, '～'), max));
        collect = () => {
          const v = p.get();
          if (!v) throw new Error('请选择要控制的参数');
          const r = { target: v.target, key: v.key };
          if (min.value !== '') r.min = +min.value;
          if (max.value !== '') r.max = +max.value;
          return r;
        };
      } else if (t === 'button') {
        const desc = h('input', { type: 'text', value: c.desc || '', placeholder: '按钮说明（可选）' });
        const list = h('div', { class: 'ce-actions' });
        const rows = [];
        const addRow = (a) => { const r = actionRow(app, a, () => rows.splice(rows.indexOf(r), 1)); rows.push(r); list.appendChild(r.el); };
        (c.actions && c.actions.length ? c.actions : [{ do: 'play' }]).forEach(addRow);
        area.append(h('div', { class: 'field' }, h('label', null, '说明'), desc),
          h('div', { class: 'note' }, '点击按钮时按顺序执行下面的动作：'), list,
          h('div', { class: 'btnrow' }, h('button', { onclick: () => addRow({ do: 'set' }) }, '＋ 添加动作')));
        collect = () => ({ desc: desc.value, actions: rows.map((r) => r.get()) });
      } else if (t === 'toggle') {
        const tg = h('input', { type: 'text', value: (c.targets || []).join(', '), placeholder: '对象名称，用逗号分隔，如 AE, OH, 球O' });
        const sel = app.selected();
        area.append(h('div', { class: 'field' }, h('label', null, '控制的对象'), tg),
          sel.length ? h('div', { class: 'btnrow' }, h('button', { onclick: () => { tg.value = sel.map((o) => o.name || app.S.displayName(o)).join(', '); } }, '使用当前选中的 ' + sel.length + ' 个对象')) : null);
        collect = () => ({ targets: tg.value.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean) });
      } else {
        const ta = h('textarea', { rows: 3, style: { width: '100%' } }, c.text || '');
        const vs = h('select', null, h('option', { value: '' }, '— 插入变量 —'), SG.TextVars.catalog(app.S).map((x) => h('option', { value: x.token }, x.group + '：' + x.label)));
        vs.addEventListener('change', () => { if (vs.value) { ta.value += vs.value; vs.value = ''; } });
        area.append(ta, h('div', { class: 'btnrow' }, vs), h('div', { class: 'note' }, '变量：{len:A,B} 长度、{ang:A,B,C} 角度、{度量:名称}、{面积:ABC}、{参数:M.t}；|e 精确值。'));
        collect = () => ({ text: ta.value });
      }
    };
    type.addEventListener('change', build);
    build();
    const body = h('div', { class: 'ce-dlg' },
      h('div', { class: 'field' }, h('label', null, '类型'), type),
      h('div', { class: 'field' }, h('label', null, '名称'), label),
      area,
      h('label', { class: 'tx-chk', style: { marginTop: '8px' } }, pin, '上屏（显示在画布左上角面板中）'));
    return UI.modal(init ? '编辑控件' : '新建控件', body, [{ label: '取消', value: null }, {
      label: '确定', primary: true,
      onClick: () => {
        try {
          const extra = collect();
          const out = Object.assign({ id: c.id || newId(), type: type.value, label: label.value.trim() || TYPES[type.value] }, extra);
          out._pin = pin.checked;
          return out;
        } catch (e) { UI.toast(e.message, 'err'); return false; }
      },
    }]);
  }

  // ================================================================ 分区
  class ControlsPanel {
    constructor(app) {
      this.app = app;
      this.pane = document.getElementById('pane-controls');
      this.msg = '';
      this.runner = new SG.ActionRunner(app, { onMsg: (t) => this.setMsg(t), onChange: () => this.render(), state: () => (this._state = this._state || {}) });
      app.runners = app.runners || {};
      app.runners.controls = this.runner;
      app.on('controls', () => this.render());
      app.on('hud', () => this.render());
      app.on('change', () => this.update());
      app.on('live', () => this.update());
      this.render();
    }
    setMsg(t) { this.msg = t; if (this.msgEl) { this.msgEl.textContent = t; this.msgEl.style.display = t ? '' : 'none'; } }
    async add(init) {
      const r = await editControl(this.app, init);
      if (!r) return;
      const pin = r._pin; delete r._pin;
      const list = this.app.controls.slice();
      const i = list.findIndex((x) => x.id === r.id);
      if (i >= 0) list[i] = r; else list.push(r);
      this.app.setControls(list);
      this.app.hudToggle('ctl', r.id, pin);
    }
    render() {
      const app = this.app, pane = this.pane;
      pane.innerHTML = '';
      this.widgets = [];
      pane.appendChild(h('div', { class: 'pp-head' }, h('b', null, '控制'), h('span', { style: { flex: 1 } }), h('button', { class: 'btn primary', onclick: () => this.add() }, '＋ 新建控件')));
      pane.appendChild(h('div', { class: 'note', style: { marginBottom: '8px' } }, '在这里放滑动条、按钮、开关和文字。可以自己新建，也可以在"AI 助手"（作图模式）中让 AI 设计，例如"做一个按钮演示 M 从 B 运动到 C"。点 📌 可以上屏到画布左上角。'));
      if (!app.controls.length) pane.appendChild(h('div', { class: 'empty' }, '还没有控件。'));
      app.controls.forEach((c, i) => {
        const w = widget(app, c, this.runner);
        this.widgets.push(w);
        const pinned = app.hudHas('ctl', c.id);
        pane.appendChild(h('div', { class: 'cc-card' },
          h('div', { class: 'cc-tools' },
            h('span', { class: 'cc-type' }, TYPES[c.type] || c.type),
            h('span', { style: { flex: 1 } }),
            h('button', { class: pinned ? 'on' : '', title: pinned ? '从左上角面板移除' : '上屏：显示在画布左上角', onclick: () => app.hudToggle('ctl', c.id) }, '📌'),
            h('button', { title: '上移', disabled: i === 0, onclick: () => { const l = app.controls.slice(); [l[i - 1], l[i]] = [l[i], l[i - 1]]; app.setControls(l); } }, '↑'),
            h('button', { title: '编辑', onclick: () => this.add(c) }, '✎'),
            h('button', { title: '删除', onclick: () => app.setControls(app.controls.filter((x) => x.id !== c.id)) }, '✕')),
          w.el));
      });
      if (this.runner.playing) pane.appendChild(h('div', { class: 'btnrow' }, h('button', { onclick: () => this.runner.stop() }, '■ 停止动画')));
      this.msgEl = h('div', { class: 'info pp-msg' }, this.msg);
      this.msgEl.style.display = this.msg ? '' : 'none';
      pane.appendChild(this.msgEl);
    }
    update() { for (const w of this.widgets || []) w.update(); }
  }

  /** 给 AI 生成的控件补上 id、校验格式 */
  function normalizeAI(list) {
    return (Array.isArray(list) ? list : []).filter((c) => c && TYPES[c.type]).map((c) => Object.assign({}, c, { id: newId() }));
  }

  SG.Controls = { widget, editControl, ControlsPanel, normalizeAI, TYPES };
})(globalThis.SG = globalThis.SG || {});
