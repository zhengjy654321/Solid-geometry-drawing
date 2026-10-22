/*
 * 启动与界面装配：工具栏、顶栏、工具选项条、面板刷新、帮助。
 */
(function (SG) {
  'use strict';
  const { UI } = SG;
  const { h } = UI;

  const app = new SG.App();
  SG.app = app; // 便于调试
  app.attach(document.getElementById('cv'));
  const ui = new SG.Interact(app);
  app.ui = ui;
  new SG.Joystick(app);
  const aiPanel = new SG.AIPanel(app);

  // ------------------------------------------------------------ 工具栏与弹出菜单
  const toolbar = document.getElementById('toolbar');
  const flyout = document.getElementById('flyout');
  let flyCat = null;
  function buildToolbar() {
    toolbar.innerHTML = '';
    for (const c of SG.Tools.CATS) {
      const active = c.tools.includes(ui.toolId) || (c.sub && c.sub.tools.includes(ui.toolId));
      const b = h('button', { class: 'cat' + (active ? ' active' : '') + (c.tools.length === 1 && !c.sub ? ' single' : ''), title: c.label, html: '<svg viewBox="0 0 24 24">' + SG.Tools.ICONS[c.id] + '</svg><span>' + c.label + '</span>' });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (c.tools.length === 1 && !c.sub) { ui.setTool(c.tools[0]); closeFly(); return; }
        if (flyCat === c.id) { closeFly(); return; }
        openFly(c, b);
      });
      toolbar.appendChild(b);
    }
  }
  function toolBtn(id) {
    const t = SG.Tools.byId[id];
    return h('button', { class: 'tool' + (ui.toolId === id ? ' active' : ''), onclick: () => { closeFly(); ui.setTool(id); } }, h('div', null, h('b', null, t.label), t.desc ? h('small', null, t.desc) : null));
  }
  function openFly(c, btn) {
    flyCat = c.id;
    flyout.innerHTML = '';
    flyout.appendChild(h('h4', null, c.label));
    const compact = c.id === 'shape2d' || c.id === 'solid';
    const box = h('div', { class: compact ? 'grid2' : '' }, c.tools.map(toolBtn));
    flyout.appendChild(box);
    if (c.sub) {
      flyout.appendChild(h('div', { class: 'sub' }, c.sub.title));
      flyout.appendChild(h('div', null, c.sub.tools.map(toolBtn)));
    }
    if (c.id === 'plane') {
      flyout.appendChild(h('div', { class: 'sub' }, '快速切换工作面（新建的点落在工作面上）'));
      flyout.appendChild(workButtons());
    }
    flyout.classList.remove('hidden');
    const r = btn.getBoundingClientRect(), mr = document.getElementById('main').getBoundingClientRect();
    flyout.style.top = Math.max(6, Math.min(r.top - mr.top, mr.height - flyout.offsetHeight - 6)) + 'px';
  }
  function closeFly() { flyCat = null; flyout.classList.add('hidden'); }
  document.addEventListener('click', (e) => { if (!flyout.contains(e.target)) closeFly(); for (const d of document.querySelectorAll('.dropdown.open')) if (!d.contains(e.target)) d.classList.remove('open'); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFly(); });

  function workButtons() {
    return h('div', { class: 'btnrow' },
      h('button', { onclick: () => { app.setWork({ kind: 'xy', h: 0 }); closeFly(); } }, '底面 z=0'),
      h('button', {
        onclick: async () => {
          closeFly();
          const r = await UI.form('水平工作面', [{ key: 'h', label: '高度 z =', type: 'number', value: 2 }]);
          if (r) app.setWork({ kind: 'xy', h: r.h });
        },
      }, '水平面 z=h…'),
      h('button', { onclick: () => { app.setWork({ kind: 'xz', h: 0 }); closeFly(); } }, '正面 xOz'),
      h('button', { onclick: () => { app.setWork({ kind: 'yz', h: 0 }); closeFly(); } }, '侧面 yOz'),
      h('button', { onclick: () => { closeFly(); ui.setTool('setWork'); } }, '选择已有面 / 三点…'));
  }

  // ------------------------------------------------------------ 工具选项条
  const toolopts = document.getElementById('toolopts');
  function buildToolOpts() {
    toolopts.innerHTML = '';
    const t = ui.tool;
    if (t && ui.toolId !== 'select') {
      toolopts.appendChild(h('span', { class: 'tname' }, t.label));
      const o = ui.opts[ui.toolId] || {};
      for (const op of t.options || []) {
        let inp;
        if (op.type === 'check') inp = h('input', { type: 'checkbox', checked: !!o[op.key], onchange: (e) => { o[op.key] = e.target.checked; } });
        else if (op.type === 'select') inp = h('select', { onchange: (e) => { const v = op.options.find((x) => String(x.value) === e.target.value); o[op.key] = v ? v.value : e.target.value; } }, op.options.map((x) => h('option', { value: x.value, selected: String(x.value) === String(o[op.key]) }, x.label)));
        else if (op.type === 'number') inp = h('input', { type: 'number', value: o[op.key], step: op.step || 'any', onchange: (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) o[op.key] = v; } });
        else inp = h('input', { type: 'text', value: o[op.key], onchange: (e) => { o[op.key] = e.target.value; } });
        const kids = [h('span', null, op.label), inp];
        if (op.type === 'ratio') {
          for (const r of ['1/2', '1/3', '2/3', '1/4', '3/4']) kids.push(h('button', { class: o[op.key] === r ? 'on' : '', onclick: () => { o[op.key] = r; buildToolOpts(); } }, r));
        }
        toolopts.appendChild(h('div', { class: 'opt' }, kids));
      }
      if (t.variadic) toolopts.appendChild(h('div', { class: 'opt' }, h('button', { onclick: () => ui.finishVariadic() }, '完成 (Enter)')));
      toolopts.appendChild(h('div', { class: 'opt' }, h('button', { onclick: () => ui.setTool('select') }, '退出工具 (Esc)')));
    }
    const wp = h('div', { class: 'opt wp dropdown' },
      h('span', { style: { color: '#6b7785' } }, '工作面：'),
      h('button', { class: 'dd-toggle', style: { border: 'none' } }, app.workPlaneLabel() + ' ▾'),
      h('div', { class: 'dd-menu', style: { right: 0, left: 'auto' } }, workButtons()));
    toolopts.appendChild(wp);
  }

  // ------------------------------------------------------------ 顶栏
  const checks = document.getElementById('viewChecks');
  function buildChecks() {
    checks.innerHTML = '';
    const items = [['axes', '坐标轴'], ['axisNumbers', '坐标轴刻度数字'], ['ground', '底面网格'], ['grid3d', '立体网格（三个坐标面）'], ['coords', '显示点的坐标'], ['workGrid', '工作面网格'], ['showDots', '顶点圆点']];
    for (const [k, label] of items) {
      checks.appendChild(h('label', null, h('input', { type: 'checkbox', checked: app.view[k] !== false && !!app.view[k], onchange: (e) => { app.view[k] = e.target.checked; app.saveSettings(); app.render(); } }), label));
    }
    checks.appendChild(h('div', { class: 'sep' }));
    checks.appendChild(h('div', { class: 'row', style: { color: '#6b7785' } }, '被遮挡的线：'));
    for (const [k, label] of [['dashed', '虚线'], ['hide', '隐藏'], ['solid', '实线']]) {
      checks.appendChild(h('label', null, h('input', { type: 'radio', name: 'hidmode', checked: app.view.hiddenMode === k, onchange: () => { app.view.hiddenMode = k; app.saveSettings(); app.render(); } }), label));
    }
  }
  for (const dd of document.querySelectorAll('.dropdown')) {
    dd.addEventListener('click', (e) => {
      if (e.target.closest('.dd-toggle')) { e.stopPropagation(); const open = dd.classList.contains('open'); for (const d of document.querySelectorAll('.dropdown.open')) d.classList.remove('open'); if (!open) dd.classList.add('open'); }
    });
  }
  toolopts.addEventListener('click', (e) => {
    const dd = e.target.closest('.dropdown');
    if (dd && e.target.closest('.dd-toggle')) { e.stopPropagation(); dd.classList.toggle('open'); }
  });

  const actions = {
    new: () => { if (!app.S.objects.length) return; UI.modal('新建', h('div', null, '清空画布上的所有图形？（可以用 撤销 恢复）'), [{ label: '取消', value: null }, { label: '清空', primary: true, onClick: () => { app.change('清空', () => app.S.clear()); app.setWork({ kind: 'xy', h: 0 }); return true; } }]); },
    open: () => document.getElementById('fileInput').click(),
    save: () => app.saveFile(),
    exportPNG: () => app.exportPNG(),
    exportSVG: () => app.exportSVG(),
    copyPNG: () => app.copyPNG(),
    undo: () => app.undo(),
    redo: () => app.redo(),
    viewDefault: () => app.setView(32, 18),
    viewFront: () => app.setView(0, 0),
    viewSide: () => app.setView(90, 0),
    viewTop: () => app.setView(0, 89.9),
    viewOblique: () => {
      app.cam.mode = app.cam.mode === 'oblique' ? 'ortho' : 'oblique';
      app.cam.yaw = 0;
      app.cam.update();
      app.fit();
      app.emit('viewmode');
    },
    fit: () => app.fit(),
    toggleLabels: () => app.emit('toggleLabels'),
    ai: () => switchTab('ai'),
    settings: () => SG.openSettings(app),
    help: () => showHelp(),
    zoomIn: () => ui.zoomAt(app.cam.w / 2, app.cam.h / 2, 1.25),
    zoomOut: () => ui.zoomAt(app.cam.w / 2, app.cam.h / 2, 0.8),
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const f = actions[b.dataset.act];
    if (f) { f(); const dd = b.closest('.dropdown'); if (dd) dd.classList.remove('open'); }
  });
  document.getElementById('fileInput').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { try { app.loadData(JSON.parse(rd.result)); app.fit(); UI.toast('已打开 ' + f.name, 'ok'); } catch (err) { UI.toast('文件无法解析：' + err.message, 'err'); } };
    rd.readAsText(f);
    e.target.value = '';
  });
  app.on('toggleLabels', () => {
    const pts = app.S.objects.filter((o) => o.type === 'point' && !o.hidden);
    if (!pts.length) return;
    const show = pts.some((o) => !o.style.label);
    app.change('标签', () => { for (const o of pts) o.style.label = show; });
    UI.toast(show ? '已显示所有点的标签' : '已隐藏所有点的标签');
  });

  // ------------------------------------------------------------ 标签页
  function switchTab(name) {
    for (const b of document.querySelectorAll('#side .tabs button')) b.classList.toggle('active', b.dataset.tab === name);
    for (const p of document.querySelectorAll('#side .pane')) p.classList.toggle('active', p.id === 'pane-' + name);
    refreshPanels();
    if (name === 'ai') setTimeout(() => aiPanel.input.focus(), 30);
  }
  const curTab = () => (document.querySelector('#side .tabs button.active') || {}).dataset.tab;
  for (const b of document.querySelectorAll('#side .tabs button')) b.addEventListener('click', () => switchTab(b.dataset.tab));

  function refreshPanels() {
    const t = curTab();
    if (t === 'props') SG.Panels.renderProps(app);
    if (t === 'objects') SG.Panels.renderObjects(app);
    if (t === 'measures') SG.Panels.renderMeasures(app);
  }

  // ------------------------------------------------------------ 事件
  const status = document.getElementById('status');
  app.on('status', (s) => { status.innerHTML = s; });
  app.on('select', () => {
    if (app.sel.length && curTab() === 'objects' && document.activeElement && !document.activeElement.closest('#side')) switchTab('props');
    refreshPanels();
    SG.Quick.render(app);
    ui.updateStatus();
  });
  app.on('change', () => { refreshPanels(); SG.Quick.render(app); buildToolOpts(); welcome(); });
  let liveT = 0;
  app.on('live', () => {
    const now = performance.now();
    if (now - liveT < 120) return;
    liveT = now;
    if (curTab() === 'measures') SG.Panels.renderMeasures(app);
  });
  app.on('tool', () => { buildToolbar(); buildToolOpts(); SG.Quick.render(app); });
  app.on('work', () => buildToolOpts());
  app.on('viewmode', () => document.getElementById('btnOblique').classList.toggle('on', app.cam.mode === 'oblique'));
  app.on('measureCreated', (id) => { switchTab('measures'); app.select(id); });
  app.on('settings', () => { buildChecks(); aiPanel.updateModel(); });

  // 空画布提示
  const stage = document.getElementById('stage');
  const hello = h('div', { style: { position: 'absolute', left: '50%', top: '42%', transform: 'translate(-50%,-50%)', textAlign: 'center', color: '#8a96a3', pointerEvents: 'none', lineHeight: '2', fontSize: '14px' } },
    h('div', { style: { fontSize: '20px', color: '#5b6b7c', marginBottom: '6px' } }, '开始画图'),
    h('div', null, '① 左侧 "立体" / "平面图形" 中选择常用图形，一键生成'),
    h('div', null, '② 或用 "面 → 多边形" 在底面上画出底面，再 "拉伸成柱 / 收成锥"'),
    h('div', null, '③ 选中对象后，画布下方会出现快捷操作；右上角 "AI 辅助" 可用文字描述作图'));
  stage.appendChild(hello);
  function welcome() { hello.style.display = app.S.objects.length ? 'none' : ''; }

  // ------------------------------------------------------------ 帮助
  function showHelp() {
    const body = h('div', { class: 'help', html: `
      <h4>基本操作</h4>
      <ul>
        <li><b>旋转视角</b>：在空白处按住左键拖动，或按住右键拖动；<b>平移</b>：Shift + 拖动 或 中键拖动；<b>缩放</b>：滚轮。</li>
        <li><b>选择</b>：单击对象；Shift + 单击 多选；双击立体的面选中整个立体。选中后画布下方会出现<b>快捷操作</b>。</li>
        <li><b>拖动动点</b>：蓝色的点是动点（线上的点、面上的点、定长动点……），可直接拖动，也可以用左下角的<b>摇杆</b>控制；自由点按住 Shift 拖动可沿法向上下移动；按住 Alt 不吸附。</li>
        <li><b>撤销 / 重做</b>：Ctrl+Z / Ctrl+Y。<b>删除</b>：Delete。<b>标签</b>：L 键一键显示 / 隐藏所有点的名称。</li>
      </ul>
      <h4>画图的一般顺序</h4>
      <ol>
        <li>先画底面：用"平面图形"模板，或"面 → 多边形"在底面（工作面）上依次点出顶点（自动吸附网格）。</li>
        <li>再变成立体："立体 → 拉伸成柱 / 收成锥 / 生成棱台"，或用"点 → 垂直拉起点"作出锥顶再"收成锥（选择顶点）"。</li>
        <li>要在别的面上画图时，先切换<b>工作面</b>（工具选项条右侧，或"面 → 设为工作面"），新建的点都会落在工作面上；也可以直接在立体的面上单击建点。</li>
        <li>常用立体（正方体、棱柱、棱锥、棱台、鳖臑、堑堵、圆柱、圆锥……）可以一键生成，参数可随时修改。</li>
      </ol>
      <h4>常用功能</h4>
      <ul>
        <li><b>点</b>：线段上单击建点时，靠近中点 / 三等分点会自动吸附；"等分点"可输入任意比例如 2/5；动点可"锁定"为定点。</li>
        <li><b>截面</b>：选立体，再选三个点（如棱的中点），一键得到截面多边形。<b>球</b>：外接球、内切球、棱切球一键生成；球的截面圆、球面与多面体表面的交线一键求出。</li>
        <li><b>翻折</b>：选择要折起的部分（面或三个点）和折痕，设置角度，拖动滑块观看翻折过程。</li>
        <li><b>度量</b>：长度、距离、异面直线所成角、线面角、二面角、面积、体积，自动给出精确值（如 √6/3）。在度量上点"修改为…"可以反向修改图形（如把二面角改成 50°）。</li>
        <li><b>轨迹</b>：对点开启"追踪轨迹"，拖动或用摇杆移动它就会留下轨迹；也可以在轨迹属性中"扫描生成完整轨迹"。</li>
        <li><b>消隐</b>：立体的面会遮挡后面的线，被挡住的部分自动画成虚线；自己用点搭的立体可选中顶点后"生成多面体"获得虚实效果。</li>
        <li><b>导出</b>：PNG / SVG（矢量，适合插入 Word）/ 复制到剪贴板。"斜二测"按钮切换为教材的斜二测画法。</li>
      </ul>
      <h4>AI 辅助作图</h4>
      <p>在"设置"中填好 API Key（默认 DeepSeek），在右侧"AI 助手"中用文字描述作图要求，例如"过 BD 作与底面成 60° 的平面"。当前图形会自动一并发送，AI 返回的作图指令会被直接画出，不满意可撤销。</p>
      <h4>快捷键</h4>
      <p><kbd>V</kbd> 选择　<kbd>P</kbd> 点　<kbd>S</kbd> 线段　<kbd>G</kbd> 多边形　<kbd>M</kbd> 中点　<kbd>F</kbd> 适应窗口　<kbd>L</kbd> 标签　<kbd>Enter</kbd> 完成多边形　<kbd>Esc</kbd> 取消</p>` });
    UI.modal('使用说明', body, [{ label: '知道了', primary: true, value: null }]);
  }

  // ------------------------------------------------------------ 启动
  buildToolbar();
  buildToolOpts();
  buildChecks();
  const saved = UI.LS.get('sg.autosave', null);
  if (saved && saved.scene && saved.scene.objects && saved.scene.objects.length) {
    app.loadData(saved, false);
    if (!saved.cam) app.fit();
  } else {
    app.S.recompute();
    app.fit();
  }
  app.emit('viewmode');
  refreshPanels();
  welcome();
  ui.updateStatus();
  app.render();
})(globalThis.SG = globalThis.SG || {});
