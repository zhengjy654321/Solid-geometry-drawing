/*
 * 文字：编辑对话框（可插入变量）、点击图中文字弹出的菜单、"文字"工具。
 */
(function (SG) {
  'use strict';
  const { UI } = SG;
  const { h } = UI;

  /** 文字编辑对话框。init: {text, color, size, show, pin, title}；返回 Promise<结果 | null> */
  function editText(app, init) {
    init = init || {};
    const S = app.S;
    const ta = h('textarea', { rows: 3, class: 'tx-area', placeholder: '输入文字，可插入变量，如：∠ABC = {ang:A,B,C}' }, init.text || '');
    const preview = h('div', { class: 'tx-preview' });
    const upd = () => { preview.textContent = '预览：' + SG.TextVars.render(S, ta.value); };
    ta.addEventListener('input', upd);
    const insert = (tok) => {
      const a = ta.selectionStart == null ? ta.value.length : ta.selectionStart, b = ta.selectionEnd == null ? a : ta.selectionEnd;
      ta.value = ta.value.slice(0, a) + tok + ta.value.slice(b);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = a + tok.length;
      upd();
    };
    // 变量
    const cat = SG.TextVars.catalog(S);
    const groups = {};
    for (const c of cat) (groups[c.group] = groups[c.group] || []).push(c);
    const sel = h('select', { class: 'tx-sel' }, h('option', { value: '' }, '— 选择已有的度量、坐标、参数 —'),
      Object.entries(groups).map(([g, list]) => h('optgroup', { label: g }, list.map((c) => h('option', { value: c.token }, c.label)))));
    sel.addEventListener('change', () => { if (sel.value) insert(sel.value); sel.value = ''; });
    const ptsIn = h('input', { type: 'text', class: 'tx-pts', placeholder: '点名，如 A,B 或 ABC' });
    const exact = h('input', { type: 'checkbox', checked: false });
    const fmt = () => (exact.checked ? '|e' : '');
    const quick = (type, need) => () => {
      const ns = (ptsIn.value.includes(',') || ptsIn.value.includes('，') ? ptsIn.value.split(/[,，]/) : SG.splitNames(ptsIn.value)).map((s) => s.trim()).filter(Boolean);
      if (ns.length !== need) { UI.toast('请输入 ' + need + ' 个点的名称', 'err'); return; }
      insert('{' + type + ':' + ns.join(',') + fmt() + '}');
    };
    // 样式与位置
    const color = init.color || '#1a1a1a';
    let curColor = color;
    const sw = h('div', { class: 'swatches' }, SG.Style.PALETTE.map((c) => h('span', { style: { background: c, outline: c === color ? '2px solid #1f6fd1' : '' }, onclick: (e) => { curColor = c; for (const s of sw.children) s.style.outline = ''; e.target.style.outline = '2px solid #1f6fd1'; } })));
    const size = h('input', { type: 'number', value: init.size || 15, min: 8, max: 48, class: 'num' });
    const show = h('input', { type: 'checkbox', checked: init.show !== false });
    const pin = h('input', { type: 'checkbox', checked: !!init.pin });
    const body = h('div', { class: 'tx-dlg' },
      ta, preview,
      h('div', { class: 'tx-row' }, h('b', null, '插入变量'), sel),
      h('div', { class: 'tx-row' }, ptsIn,
        h('button', { class: 'btn', onclick: quick('len', 2) }, '插入长度'),
        h('button', { class: 'btn', onclick: quick('ang', 3) }, '插入角度'),
        h('label', { class: 'tx-chk' }, exact, '精确值')),
      h('div', { class: 'note' }, '变量写在 { } 中，会随图形实时变化：{len:A,B} 长度，{ang:A,B,C} ∠ABC，{坐标:A}，{度量:名称}，{面积:ABC}，{参数:M.t}。末尾加 |e 显示精确值（如 √6/3），|d3 保留 3 位小数。'),
      h('div', { class: 'tx-row' }, h('b', null, '颜色'), sw, h('b', null, '字号'), size),
      h('div', { class: 'tx-row' }, h('label', { class: 'tx-chk' }, show, '在图中显示'), h('label', { class: 'tx-chk' }, pin, '添加到左上角面板')));
    upd();
    return UI.modal(init.title || '文字', body, [{ label: '取消', value: null }, {
      label: '确定', primary: true,
      onClick: () => {
        if (!ta.value.trim()) { UI.toast('请输入文字', 'err'); return false; }
        return { text: ta.value, color: curColor, size: +size.value || 15, show: show.checked, pin: pin.checked };
      },
    }]);
  }

  /** 新建文字（文字工具调用）。anchor: {at} | {line} | {pos} */
  async function createText(app, anchor) {
    const r = await editText(app, { title: '新建文字' });
    if (!r) return;
    const id = app.change('文字', () => {
      const o = app.S.map.get(app.C.exec(Object.assign({ op: 'text', text: r.text, color: r.color, size: r.size }, anchor)).main);
      o.hidden = !r.show;
      return o.id;
    });
    if (id && r.pin) app.hudToggle('obj', id, true);
    if (id) app.select(id);
  }

  async function editExisting(app, o) {
    const r = await editText(app, { title: '编辑文字', text: o.def.text, color: o.style.color, size: o.style.fontSize, show: !o.hidden, pin: app.hudHas('obj', o.id) });
    if (!r) return;
    app.change('编辑文字', () => { o.def.text = r.text; o.style.color = r.color; o.style.fontSize = r.size; o.hidden = !r.show; });
    app.hudToggle('obj', o.id, r.pin);
  }

  /** 图中文字被点击时弹出的菜单 */
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function labelMenu(app, id, x, y) {
    closeMenu();
    const S = app.S;
    const o = S.map.get(id);
    if (!o) return;
    const items = [];
    const add = (label, fn) => items.push(h('button', { onclick: () => { closeMenu(); fn(); } }, label));
    const inHud = app.hudHas('obj', o.id);
    if (o.type === 'mark' && o.def.kind === 'text') {
      add('编辑文字…', () => editExisting(app, o));
      add('在图中隐藏', () => app.change('隐藏', () => { o.hidden = true; }));
    } else if (o.type === 'measure') {
      add('在图中隐藏', () => app.change('隐藏', () => { o.style.show = false; }));
      add(o.style.showName === false ? '显示名称' : '只显示数值', () => app.change('显示', () => { o.style.showName = o.style.showName === false; }));
    } else {
      add('修改名称…', async () => {
        const r = await UI.form('修改名称', [{ key: 'n', label: '名称', value: o.name || '' }]);
        if (r && r.n.trim()) app.change('重命名', () => app.C.setName(o, r.n.trim()));
      });
      add('隐藏标签', () => app.change('标签', () => { o.style.label = false; }));
    }
    add(inHud ? '从左上角面板移除' : '添加到左上角面板', () => app.hudToggle('obj', o.id));
    if (o.type === 'mark') add('删除', () => app.change('删除', () => S.remove(o.id)));
    menuEl = h('div', { class: 'tx-menu' }, h('div', { class: 'tx-menu-t' }, S.displayName(o)), items);
    document.body.appendChild(menuEl);
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.min(x + 6, window.innerWidth - r.width - 8) + 'px';
    menuEl.style.top = Math.min(y + 6, window.innerHeight - r.height - 8) + 'px';
    setTimeout(() => {
      const off = (e) => { if (menuEl && !menuEl.contains(e.target)) { closeMenu(); document.removeEventListener('pointerdown', off, true); } };
      document.addEventListener('pointerdown', off, true);
    });
  }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  /** 某个对象在面板中显示的文字 */
  function objText(app, o) {
    const S = app.S;
    if (!o) return '';
    if (o.type === 'mark' && o.def.kind === 'text') return SG.TextVars.render(S, o.def.text);
    if (o.type === 'measure') { const f = SG.Measure.format(o.v); return S.displayName(o) + ' = ' + (o.v && o.v.unit !== 'angle' && f.exact ? f.exact : f.main) + (o.v && o.v.unit === 'angle' && f.exact ? '（' + f.exact + '）' : ''); }
    if (o.type === 'point' && o.v) return o.name + '(' + o.v.map((v) => SG.TextVars.fmtNum(v)).join(', ') + ')';
    if (SG.LINE_TYPES.has(o.type) && o.v) return S.displayName(o) + ' = ' + SG.TextVars.fmtNum(SG.V.dist(o.v.a, o.v.b));
    return S.displayName(o);
  }

  SG.TextUI = { editText, createText, editExisting, labelMenu, closeMenu, objText };
})(globalThis.SG = globalThis.SG || {});
