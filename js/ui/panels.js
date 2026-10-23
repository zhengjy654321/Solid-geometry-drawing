/*
 * 右侧面板：属性、对象列表、度量列表。
 */
(function (SG) {
  'use strict';
  const { V, UI, Exact } = SG;
  const { h } = UI;

  // ------------------------------------------------------------ 描述
  function refName(S, r) {
    if (r == null) return '水平面';
    if (Array.isArray(r)) return r.map((id) => (S.map.get(id) || {}).name || '?').join('');
    const o = S.map.get(r);
    return o ? S.displayName(o) : '?';
  }
  function planeDesc(S, ref, center) {
    const o = ref != null && !Array.isArray(ref) && S.map.get(ref);
    if (o && o.desc) return o.desc;
    let p;
    if (ref == null) p = '水平面（xOy）';
    else if (o && o.def.kind === 'planeAxis' && o.hidden) p = { xy: 'xOy', yz: 'yOz', xz: 'xOz' }[o.def.axis] + ' 面';
    else p = '平面 ' + refName(S, ref);
    return '过 ' + center + ' 且平行于' + p + '的平面';
  }
  function describeDef(S, def) {
    const n = (r) => refName(S, r);
    switch (def.kind) {
      case 'free': return '自由点';
      case 'onLine': return n([def.a, def.b]) + (def.mode === 'seg' ? ' 上' : ' 所在直线上') + '的点，t = ' + (Exact.recognize(def.t, { pi: false }) || Exact.fmtNum(def.t, 3));
      case 'onPlane': return '面 ' + n(def.plane) + ' 上的点';
      case 'onCircle': return '圆上的点';
      case 'onSphere': return n(def.sphere) + ' 球面上的点';
      case 'fixedLen': return '绕 ' + n(def.anchor) + ' 转动，长度 ' + Exact.fmtNum(def.len) + '（' + (def.mode === 'plane' ? '在' + planeDesc(S, def.plane, n(def.anchor)) + '内' : '在空间中') + '）';
      case 'offset': return n(def.base) + ' 平移 (' + def.vec.map((x) => Exact.fmtNum(x, 2)).join(', ') + ')';
      case 'alongNormal': return '由 ' + n(def.base) + ' 沿' + (def.plane ? '面 ' + n(def.plane) + ' 的' : '竖直') + '法向移动 ' + Exact.fmtNum(def.dist);
      case 'byVector': return n(def.base) + ' + ' + Exact.fmtNum(def.k) + '·向量' + n([def.from, def.to]);
      case 'foot': return n(def.p) + ' 在 ' + n(def.target) + ' 上的垂足';
      case 'reflect': return n(def.p) + ' 关于 ' + n(def.target) + ' 的对称点';
      case 'intersect': return n(def.a) + ' 与 ' + n(def.b) + ' 的交点';
      case 'intersectLC': return n(def.line) + ' 与圆的交点（第 ' + ((def.which || 0) + 1) + ' 个）';
      case 'intersectLS': return n(def.line) + ' 与 ' + n(def.sphere) + ' 球面的交点（第 ' + ((def.which || 0) + 1) + ' 个）';
      case 'intersectCC': return '两圆的交点（第 ' + ((def.which || 0) + 1) + ' 个）';
      case 'center': return '△' + n(def.pts) + ' 的' + { centroid: '重心', circumcenter: '外心', incenter: '内心', orthocenter: '垂心' }[def.ctype];
      case 'rotatePt': return n(def.p) + ' 绕 ' + n([def.a, def.b]) + ' 旋转 ' + def.angle + '°';
      case 'solidVertex': return n(def.solid) + ' 的顶点';
      case 'sphereCenter': return n(def.sphere) + ' 的球心';
      case 'circleCenter': return '圆心';
      case 'folded': return '已翻折 · ' + describeDef(S, def.inner);
      case 'twoPts': return '端点 ' + n(def.a) + '、' + n(def.b);
      case 'poly': return '顶点 ' + n(def.pts);
      case 'plane3': return '过 ' + n([def.a, def.b, def.c]) + ' 的平面';
      case 'planePN': return '过 ' + n(def.p) + '，法向量 (' + def.n.map((x) => Exact.fmtNum(x, 2)).join(', ') + ')';
      case 'planePerpLine': return '过 ' + n(def.p) + ' 且垂直于 ' + n(def.line);
      case 'planeParallel': return '过 ' + n(def.p) + ' 且平行于 ' + n(def.plane);
      case 'planeLinePerp': return '过 ' + n(def.line) + ' 且垂直于 ' + n(def.plane);
      case 'planeLineAngle': return '过 ' + n(def.line) + '，与 ' + n(def.plane) + ' 成 ' + def.angle + '°';
      case 'planeAxis': return { xy: 'z', yz: 'x', xz: 'y' }[def.axis] + ' = ' + Exact.fmtNum(def.offset || 0);
      case 'sphereSection': return n(def.sphere) + ' 被 ' + n(def.plane) + ' 所截' + (def.clip ? '（限制在面内）' : '');
      case 'circleCRN': return '圆心 ' + n(def.center) + '，半径 ' + Exact.fmtNum(def.r);
      case 'circle3': return '过 ' + n([def.a, def.b, def.c]);
      case 'sphereCR': return '球心 ' + n(def.center) + '，半径 ' + Exact.fmtNum(def.r);
      case 'sphereCP': return '球心 ' + n(def.center) + '，过 ' + n(def.through);
      case 'circumPts': return '过 ' + n(def.pts) + ' 的球';
      case 'specialSphere': return n(def.solid) + ' 的' + { circum: '外接球', in: '内切球', mid: '棱切球' }[def.which];
      case 'tpl': return (SG.Solids.T[def.tpl] || {}).label || '模板';
      case 'extrude': return { prism: '棱柱', pyramid: '棱锥', frustum: '棱台' }[def.mode] + '（由底面 ' + n(def.base) + ' 生成）';
      case 'hull': return '凸多面体';
      case 'fold': return '沿 ' + n([def.a, def.b]) + ' 翻折 ' + def.angle + '°';
      case 'trace': return n(def.p) + ' 的轨迹';
      case 'curvedSection': return n(def.solid) + ' 的截面';
      default: return '';
    }
  }

  // ------------------------------------------------------------ 动画
  const Anim = {
    cur: null,
    toggle(app, o, p, lo, hi) {
      if (this.cur) { const same = this.cur.o === o && this.cur.key === p.key.join('.'); this.stop(app); if (same) return; }
      const snap = app.snapshot();
      const start = app.S.getParam(o, p);
      const t0 = performance.now();
      const per = 4000;
      const cur = { o, key: p.key.join('.'), snap, raf: 0 };
      const frame = (t) => {
        const ph = ((t - t0) % (2 * per)) / per;
        const s = ph < 1 ? ph : 2 - ph;
        // 从当前值开始
        const s0 = (start - lo) / (hi - lo || 1);
        let v = lo + (hi - lo) * ((s0 + s) % 2 > 1 ? 2 - ((s0 + s) % 2) : (s0 + s) % 2);
        app.S.setParam(o, p, v);
        app.live();
        cur.raf = requestAnimationFrame(frame);
      };
      cur.raf = requestAnimationFrame(frame);
      this.cur = cur;
      app.emit('anim');
    },
    stop(app) {
      if (!this.cur) return;
      cancelAnimationFrame(this.cur.raf);
      app.pushUndo(this.cur.snap);
      this.cur = null;
      app.afterChange();
      app.emit('anim');
    },
    running(o, p) { return this.cur && this.cur.o === o && this.cur.key === p.key.join('.'); },
  };

  // ------------------------------------------------------------ 控件
  function field(label, ...kids) { return h('div', { class: 'field' }, h('label', null, label), ...kids); }
  function sec(title, ...kids) { return h('div', { class: 'sec' }, h('h5', null, title), ...kids); }
  function check(label, value, onchange) {
    return h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', marginRight: '10px', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: !!value, onchange: (e) => onchange(e.target.checked) }), label);
  }
  function swatches(app, cur, onpick) {
    return h('div', { class: 'swatches' }, SG.Style.PALETTE.concat(['#ffffff']).map((c) => h('span', { style: { background: c, outline: c === cur ? '2px solid #1f6fd1' : '' }, title: c, onclick: () => onpick(c) })),
      h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(cur || '') ? cur : '#1a1a1a', onchange: (e) => onpick(e.target.value) }));
  }
  /** 数值参数：数字框 + 滑块 + 动画按钮 */
  function paramControl(app, o, p) {
    const S = app.S;
    const val = S.getParam(o, p);
    if (p.options) {
      return field(p.label, h('select', { onchange: (e) => { const v = p.options.find((x) => String(x.value) === e.target.value); app.change('修改参数', () => S.setParam(o, p, v ? v.value : e.target.value)); } },
        p.options.map((x) => h('option', { value: x.value, selected: String(x.value) === String(val) }, x.label))));
    }
    if (p.fixed) return field(p.label, h('span', null, String(val)));
    const num = h('input', { type: 'number', class: 'num', value: +(+val).toFixed(6), step: p.step || 'any' });
    num.addEventListener('change', () => {
      let v = parseFloat(num.value);
      if (!isFinite(v)) return;
      if (p.int) v = Math.round(v);
      app.change('修改参数', () => S.setParam(o, p, v));
    });
    const kids = [num];
    if (p.unit) kids.push(h('span', { class: 'unit' }, p.unit));
    let lo = p.min, hi = p.max;
    if (lo == null || hi == null) {
      const span = Math.max(2, Math.abs(val) * 2);
      if (lo == null) lo = p.min != null ? p.min : Math.min(val - span, -span / 2);
      if (hi == null) hi = Math.max(val + span, span / 2);
    }
    if (!p.noSlider) {
      const rng = h('input', { type: 'range', min: lo, max: hi, step: p.step || (hi - lo) / 400, value: val });
      let snap = null;
      rng.addEventListener('pointerdown', () => { snap = app.snapshot(); });
      rng.addEventListener('input', () => {
        if (!snap) snap = app.snapshot();
        const v = parseFloat(rng.value);
        S.setParam(o, p, v);
        num.value = +v.toFixed(4);
        app.live();
      });
      rng.addEventListener('change', () => { if (snap) { app.pushUndo(snap); snap = null; app.afterChange(); } });
      kids.push(rng);
      const playing = Anim.running(o, p);
      kids.push(h('button', { class: 'btn' + (playing ? ' primary' : ''), title: '动画：让该参数在范围内来回变化（配合"追踪轨迹"可画出轨迹）', style: { padding: '1px 6px' }, onclick: () => Anim.toggle(app, o, p, +rng.min, +rng.max) }, playing ? '■' : '▶'));
    }
    return field(p.label, ...kids);
  }

  function valueLine(label, x, unit) {
    const ex = unit === 'angle' ? Exact.fmtAngle(x) : null;
    const main = unit === 'angle' ? ex.text : Exact.fmtNum(x, 4);
    const exact = unit === 'angle' ? ex.exact : Exact.recognize(x);
    return field(label, h('span', null, main), exact && exact !== main ? h('span', { class: 'exact' }, '= ' + exact) : null);
  }

  // ------------------------------------------------------------ 属性面板
  function renderProps(app) {
    const pane = document.getElementById('pane-props');
    const S = app.S;
    const sel = app.selected();
    pane.innerHTML = '';
    if (!sel.length) {
      pane.appendChild(h('div', { class: 'empty', html: '未选择对象。<br>· 用左侧工具栏画图：<b>点、线、面、立体、球</b>……<br>· 单击对象查看并修改属性；双击立体的面可选中整个立体。<br>· 选中对象后，画布下方会出现<b>快捷操作</b>（如 中点、截面、外接球、度量）。' }));
      pane.appendChild(sec('当前工作面', h('div', { class: 'info' }, app.workPlaneLabel()), h('div', { class: 'btnrow' },
        h('button', { onclick: () => app.setWork({ kind: 'xy', h: 0 }) }, '底面 z=0'),
        h('button', { onclick: () => app.setWork({ kind: 'xz', h: 0 }) }, '正面 xOz'),
        h('button', { onclick: () => app.setWork({ kind: 'yz', h: 0 }) }, '侧面 yOz'),
        h('button', { onclick: () => app.ui.setTool('setWork') }, '选择已有面…'))));
      return;
    }
    if (sel.length > 1) return renderMulti(app, pane, sel);
    const o = sel[0];
    const typeName = { point: '点', segment: '线段', line: '直线', ray: '射线', polygon: '多边形 / 面', plane: '平面', circle: '圆', sphere: '球', solid: '立体', fold: '翻折', measure: '度量', trace: '轨迹', mark: '标注' }[o.type];
    // 名称
    const nameInp = h('input', { type: 'text', value: o.name || '', placeholder: S.displayName(o) });
    nameInp.addEventListener('change', () => {
      const v = nameInp.value.trim();
      app.change('重命名', () => { if (!v) { if (o.type === 'point') throw new Error('点必须有名称'); o.name = null; } else app.C.setName(o, v); });
    });
    pane.appendChild(sec(typeName + '　' + S.displayName(o), field('名称', nameInp)));
    const desc = describeDef(S, o.def);
    if (desc) pane.appendChild(h('div', { class: 'info' }, desc));
    if (o.err) pane.appendChild(h('div', { class: 'info err' }, '当前无效：' + o.err));
    if (o.v && o.v.note) pane.appendChild(h('div', { class: 'info warn' }, o.v.note));

    const S_ = (label, fn) => app.change(label, fn);
    const styleSec = [];
    const st = o.style;
    if (['point', 'plane', 'segment', 'line', 'ray', 'circle', 'sphere'].includes(o.type)) {
      styleSec.push(check('显示标签', st.label, (v) => S_('标签', () => { st.label = v; })));
    }
    styleSec.push(check('隐藏', o.hidden, (v) => S_('隐藏', () => { o.hidden = v; })));

    switch (o.type) {
      case 'point': pointProps(app, pane, o); break;
      case 'segment': case 'line': case 'ray': {
        if (o.v) pane.appendChild(valueLine('长度', V.dist(o.v.a, o.v.b)));
        pane.appendChild(field('线型', h('select', { onchange: (e) => S_('线型', () => { st.dash = e.target.value; }) },
          [['auto', '自动（被挡住的部分为虚线）'], ['solid', '实线'], ['dashed', '虚线']].map(([v, l]) => h('option', { value: v, selected: (st.dash || 'auto') === v }, l)))));
        pane.appendChild(field('线宽', h('input', { type: 'range', min: 0.5, max: 4, step: 0.1, value: st.width, onchange: (e) => S_('线宽', () => { st.width = +e.target.value; }) })));
        pane.appendChild(field('颜色', swatches(app, st.color, (c) => S_('颜色', () => { st.color = c; }))));
        if (o.type !== 'segment') pane.appendChild(field('延长量', h('input', { type: 'range', min: 0, max: 3, step: 0.05, value: st.ext, onchange: (e) => S_('延长', () => { st.ext = +e.target.value; }) })));
        pane.appendChild(h('div', { class: 'btnrow' },
          h('button', { onclick: () => S_('中点', () => app.select(app.C.exec({ op: 'midpoint', line: o.id }).main)) }, '中点'),
          h('button', { onclick: () => S_('动点', () => app.select(app.C.exec({ op: 'pointOnLine', line: o.id, t: 0.5, locked: false }).main)) }, '线上动点'),
          h('button', { onclick: () => S_('度量', () => app.C.exec({ op: 'measure', type: 'length', items: [o.id] })) }, '测长度')));
        break;
      }
      case 'polygon': {
        if (o.v) pane.appendChild(valueLine('面积', SG.G.polyArea(o.v.pts)));
        pane.appendChild(h('div', null, check('填充', st.fill, (v) => S_('填充', () => { st.fill = v; })), check('遮挡后面的线', st.occlude, (v) => S_('遮挡', () => { st.occlude = v; }))));
        pane.appendChild(field('填充色', h('div', { class: 'swatches' }, SG.Style.FILLS.map((c) => h('span', { style: { background: c, outline: c === st.fillColor ? '2px solid #1f6fd1' : '' }, onclick: () => S_('颜色', () => { st.fillColor = c; st.fill = true; }) })))));
        pane.appendChild(field('不透明度', h('input', { type: 'range', min: 0.03, max: 1, step: 0.01, value: st.fillOpacity, onchange: (e) => S_('不透明度', () => { st.fillOpacity = +e.target.value; st.fill = true; }) })));
        if (!o.v || !o.v.curve) pane.appendChild(h('div', { class: 'btnrow' },
          h('button', { onclick: () => { app.setWork({ kind: 'ref', ref: o.id }); UI.toast('工作面已设为 ' + S.displayName(o), 'ok'); } }, '设为工作面'),
          h('button', { onclick: () => S_('面积', () => app.C.exec({ op: 'measure', type: 'area', items: [o.id] })) }, '测面积')));
        break;
      }
      case 'plane': {
        for (const p of S.params(o)) pane.appendChild(paramControl(app, o, p));
        pane.appendChild(field('显示大小', h('input', { type: 'range', min: 0.3, max: 3, step: 0.05, value: st.size, onchange: (e) => S_('大小', () => { st.size = +e.target.value; }) })));
        pane.appendChild(field('不透明度', h('input', { type: 'range', min: 0, max: 0.8, step: 0.01, value: st.fillOpacity, onchange: (e) => S_('不透明度', () => { st.fillOpacity = +e.target.value; }) })));
        pane.appendChild(field('填充色', h('div', { class: 'swatches' }, SG.Style.FILLS.map((c) => h('span', { style: { background: c }, onclick: () => S_('颜色', () => { st.fillColor = c; }) })))));
        pane.appendChild(h('div', null, check('遮挡后面的线', st.occlude, (v) => S_('遮挡', () => { st.occlude = v; }))));
        pane.appendChild(h('div', { class: 'btnrow' }, h('button', { onclick: () => app.setWork({ kind: 'ref', ref: o.id }) }, '设为工作面')));
        break;
      }
      case 'circle': {
        if (o.v) {
          pane.appendChild(valueLine('半径', o.v.r));
          let len = 2 * Math.PI * o.v.r;
          if (o.v.clip) len = SG.Arcs.clip(o.v, o.v.clip).reduce((s, [a, b]) => s + b - a, 0) * o.v.r;
          pane.appendChild(valueLine(o.v.clip ? '面内弧长' : '周长', len));
          if (o.v.dist != null) pane.appendChild(valueLine('球心到截面距离', o.v.dist));
        }
        for (const p of S.params(o)) pane.appendChild(paramControl(app, o, p));
        pane.appendChild(field('颜色', swatches(app, st.color, (c) => S_('颜色', () => { st.color = c; }))));
        pane.appendChild(field('线型', h('select', { onchange: (e) => S_('线型', () => { st.dash = e.target.value; }) },
          [['auto', '自动'], ['solid', '实线'], ['dashed', '虚线']].map(([v, l]) => h('option', { value: v, selected: (st.dash || 'auto') === v }, l)))));
        pane.appendChild(h('div', { class: 'btnrow' }, h('button', { onclick: () => S_('圆心', () => app.C.addPoint({ kind: 'circleCenter', circle: o.id }, { name: S.freshName('O1') })) }, '标出圆心')));
        break;
      }
      case 'sphere': sphereProps(app, pane, o); break;
      case 'solid': solidProps(app, pane, o); break;
      case 'fold': {
        for (const p of S.params(o)) pane.appendChild(paramControl(app, o, p));
        pane.appendChild(h('div', { class: 'info' }, '旋转角 θ = 0° 时为展开（平面）状态；翻折后两部分所成二面角 = 180° − θ。拖动滑块或点 ▶ 观看翻折过程。'));
        pane.appendChild(h('div', { class: 'btnrow' },
          h('button', { onclick: () => S_('反向', () => { o.def.dir = -(o.def.dir || 1); }) }, '反向翻折'),
          h('button', { class: 'danger', onclick: () => S_('还原', () => S.remove(o.id)) }, '撤销翻折（展开）')));
        break;
      }
      case 'measure': measureProps(app, pane, o); break;
      case 'trace': traceProps(app, pane, o); break;
      case 'mark': {
        if (o.def.kind === 'text') {
          const ti = h('input', { type: 'text', value: o.def.text });
          ti.addEventListener('change', () => S_('文字', () => { o.def.text = ti.value; }));
          pane.appendChild(field('文字', ti));
        } else pane.appendChild(field('大小', h('input', { type: 'range', min: 0.05, max: 1, step: 0.01, value: st.size, onchange: (e) => S_('大小', () => { st.size = +e.target.value; }) })));
        pane.appendChild(field('颜色', swatches(app, st.color, (c) => S_('颜色', () => { st.color = c; }))));
        break;
      }
    }
    pane.appendChild(sec('显示', h('div', null, styleSec)));
    pane.appendChild(h('div', { class: 'btnrow' }, h('button', { class: 'danger', onclick: () => S_('删除', () => S.remove(o.id)) }, '删除')));
  }

  function pointProps(app, pane, o) {
    const S = app.S, st = o.style;
    const S_ = (label, fn) => app.change(label, fn);
    if (o.v) {
      const fmt = (x) => Exact.recognize(x, { pi: false }) || Exact.fmtNum(x, 4);
      pane.appendChild(field('坐标', h('span', { style: { fontFamily: 'Times New Roman, serif', fontSize: '14px' } }, '(' + o.v.map(fmt).join(', ') + ')')));
    }
    const k = SG.Kinds[o.def.kind];
    if (k && k.draggable && o.def.kind !== 'free') {
      pane.appendChild(h('div', null, check('锁定为定点（不可拖动）', o.locked, (v) => S_('锁定', () => { o.locked = v; }))));
    } else if (o.def.kind === 'free') {
      pane.appendChild(h('div', null, check('锁定（不可拖动）', o.locked, (v) => S_('锁定', () => { o.locked = v; }))));
    }
    if (!['free', 'offset', 'solidVertex', 'folded'].includes(o.def.kind)) {
      pane.appendChild(h('div', { class: 'btnrow' }, h('button', {
        title: '去掉"沿法向""垂足"等约束，之后可以任意拖动（如把竖直的线拉斜）；若有基点，仍与基点保持连接',
        onclick: () => S_('解除约束', () => { app.C.exec({ op: 'release', target: o.id }); UI.toast('已解除约束：直接拖动该点即可倾斜（按住 Shift 拖动可上下移动），也可以在下方精确修改 Δx、Δy、Δz', 'ok', 5000); }),
      }, '解除约束（可自由拖动 / 倾斜）')));
    }
    rotateSection(app, pane, o);
    if (o.def.kind === 'offset') pane.appendChild(h('div', { class: 'info' }, '该点 = ' + refName(S, o.def.base) + ' + (Δx, Δy, Δz)。拖动它会在与工作面平行的平面内移动（线段随之倾斜），按住 Shift 拖动沿法向上下移动；也可用左下角的摇杆。'));
    if (o.def.kind === 'onLine') {
      const fr = [['中点', 1 / 2], ['1/3', 1 / 3], ['2/3', 2 / 3], ['1/4', 1 / 4], ['3/4', 3 / 4], ['起点', 0], ['终点', 1]];
      pane.appendChild(sec('位置（' + refName(S, [o.def.a]) + 'P : ' + refName(S, [o.def.a, o.def.b]) + ' = t）',
        h('div', { class: 'btnrow' }, fr.map(([l, t]) => h('button', { onclick: () => S_('位置', () => { o.def.t = t; o.locked = true; }) }, l))),
        (() => {
          const inp = h('input', { type: 'text', value: Exact.recognize(o.def.t, { pi: false }) || Exact.fmtNum(o.def.t), style: { width: '80px' } });
          return field('t = p/q', inp, h('button', { class: 'btn', onclick: () => { const t = SG.parseRatio(inp.value); if (isFinite(t)) S_('位置', () => { o.def.t = t; o.locked = true; }); } }, '应用并锁定'));
        })()));
    }
    for (const p of S.params(o)) pane.appendChild(paramControl(app, o, p));
    pane.appendChild(field('颜色', swatches(app, st.color, (c) => S_('颜色', () => { st.color = c; }))));
    pane.appendChild(field('点的大小', h('input', { type: 'range', min: 0, max: 7, step: 0.5, value: st.size, onchange: (e) => S_('大小', () => { st.size = +e.target.value; }) })));
    if (st.labelOffset) pane.appendChild(h('div', { class: 'btnrow' }, h('button', { onclick: () => S_('标签位置', () => { delete st.labelOffset; }) }, '标签位置自动')));
    const tr = S.objects.find((x) => x.type === 'trace' && x.def.p === o.id);
    pane.appendChild(h('div', { class: 'btnrow' },
      tr ? h('button', { onclick: () => app.select(tr.id) }, '查看轨迹') : h('button', { onclick: () => S_('轨迹', () => app.C.exec({ op: 'trace', point: o.id })) }, '追踪轨迹'),
      h('button', { onclick: () => S_('拉起', () => { const id = app.C.exec({ op: 'pointAlongNormal', base: o.id, plane: SG.Tools.workRef(app), dist: 2 }).main; app.C.ensureSegment(o.id, id); app.select(id); }) }, '沿法向拉起')));
  }

  /** "绕某点转动"设置：锁定在指定平面内转动或在空间中转动 */
  function rotateSection(app, pane, o) {
    const S = app.S, d = o.def;
    if (['solidVertex', 'folded'].includes(d.kind)) return;
    let anchor = d.anchor || d.base || (['foot', 'reflect', 'rotatePt'].includes(d.kind) ? d.p : null);
    const nbrs = [];
    for (const x of S.objects) {
      if (!SG.LINE_TYPES.has(x.type)) continue;
      const other = x.def.a === o.id ? x.def.b : x.def.b === o.id ? x.def.a : null;
      if (other && !nbrs.includes(other) && !S.ancestors(other).has(o.id)) nbrs.push(other);
    }
    if (anchor && !nbrs.includes(anchor)) nbrs.unshift(anchor);
    if (!nbrs.length) return;
    if (!anchor) anchor = nbrs[0];
    const nm = (id) => (S.map.get(id) || {}).name || '?';
    const selA = h('select', null, nbrs.map((id) => h('option', { value: id, selected: id === anchor }, nm(id))));
    const opts = [['axis:yz', '平行于 yOz 面（与 y 轴、z 轴都平行）'], ['axis:xz', '平行于 xOz 面（与 x 轴、z 轴都平行）'], ['axis:xy', '平行于 xOy 面（水平面）'],
      ['contain:y', '包含当前线、且平行于 y 轴'], ['contain:x', '包含当前线、且平行于 x 轴'], ['contain:z', '包含当前线、且平行于 z 轴（竖直面）']];
    for (const x of S.objects) if ((x.type === 'polygon' && !(x.v && x.v.curve)) || (x.type === 'plane' && !x.hidden)) opts.push(['plane:' + x.id, '平行于平面 ' + S.displayName(x)]);
    opts.push(['space', '在空间中（不限平面，点在球面上）']);
    const selM = h('select', null, opts.map(([v, l]) => h('option', { value: v }, l)));
    pane.appendChild(sec('绕点转动（长度不变）',
      field('转动中心', selA),
      field('锁定在', selM),
      h('div', { class: 'btnrow' }, h('button', {
        class: 'primary',
        onclick: () => {
          const [kind, val] = selM.value.split(':');
          const cmd = { op: 'constrain', target: o.id, anchor: selA.value, mode: kind === 'space' ? 'space' : 'plane' };
          if (kind === 'axis') cmd.axisPlane = val;
          if (kind === 'contain') cmd.containAxis = val;
          if (kind === 'plane') cmd.plane = val;
          if (app.change('转动方式', () => app.C.exec(cmd))) UI.toast('设置好了：拖动 ' + o.name + '，或用左下角摇杆左右推，它就绕 ' + nm(selA.value) + ' 转动', 'ok', 4500);
        },
      }, '应用')),
      h('div', { class: 'note' }, '转动平面过转动中心，并与所选平面平行。设置后拖动该点或用摇杆即可转动，"面内角度 θ"可精确输入。')));
  }

  function sphereProps(app, pane, o) {
    const S = app.S, st = o.style;
    const S_ = (label, fn) => app.change(label, fn);
    if (o.v) {
      pane.appendChild(valueLine('半径 R', o.v.r));
      pane.appendChild(valueLine('表面积', 4 * Math.PI * o.v.r * o.v.r));
      pane.appendChild(valueLine('体积', (4 / 3) * Math.PI * o.v.r ** 3));
    }
    for (const p of S.params(o)) pane.appendChild(paramControl(app, o, p));
    pane.appendChild(field('显示方式', h('select', { onchange: (e) => S_('显示', () => { st.mode = e.target.value; }) },
      [['shaded', '立体（明暗渐变）'], ['outline', '轮廓 + 赤道（教材画法）'], ['wire', '经纬线']].map(([v, l]) => h('option', { value: v, selected: st.mode === v }, l)))));
    const live = (key) => (e) => { st[key] = +e.target.value; app.render(); };
    const commit = (key) => (e) => S_('样式', () => { st[key] = +e.target.value; });
    if (st.mode === 'shaded') {
      pane.appendChild(field('不透明度', h('input', { type: 'range', min: 0.02, max: 1, step: 0.01, value: st.opacity, oninput: live('opacity'), onchange: commit('opacity') })));
      pane.appendChild(field('颜色', h('div', { class: 'swatches' }, SG.Style.FILLS.map((c) => h('span', { style: { background: c }, onclick: () => S_('颜色', () => { st.color = c; }) })))));
    }
    if (st.mode === 'wire') pane.appendChild(field('线条疏密', h('input', { type: 'range', min: 2, max: 24, step: 1, value: st.density, oninput: live('density'), onchange: commit('density') })));
    if (st.mode !== 'wire') pane.appendChild(h('div', null, check('显示赤道', st.equator, (v) => S_('赤道', () => { st.equator = v; }))));
    pane.appendChild(field('背面线条', h('select', { onchange: (e) => S_('背面', () => { st.back = e.target.value; }) },
      [['dashed', '画成虚线'], ['hide', '不画']].map(([v, l]) => h('option', { value: v, selected: (st.back || 'dashed') === v }, l)))));
    pane.appendChild(h('div', null, check('实心（遮挡球后面的线）', st.occlude, (v) => S_('遮挡', () => { st.occlude = v; }))));
    pane.appendChild(h('div', { class: 'btnrow' },
      h('button', { onclick: () => { app.ui.setTool('sphereSection'); app.ui.toolClickPick(o.id); } }, '作截面圆…'),
      h('button', { onclick: () => S_('度量', () => app.C.exec({ op: 'measure', type: 'sphere', items: [o.id], what: 'V' })) }, '测体积'),
      h('button', { onclick: () => S_('度量', () => app.C.exec({ op: 'measure', type: 'sphere', items: [o.id], what: 'S' })) }, '测表面积')));
  }

  function solidProps(app, pane, o) {
    const S = app.S;
    const S_ = (label, fn) => app.change(label, fn);
    const ps = S.params(o);
    if (ps.length) {
      const box = sec('参数（修改后图形自动更新）');
      for (const p of ps) box.appendChild(paramControl(app, o, p));
      pane.appendChild(box);
    }
    // 即时计算体积、表面积
    try {
      const vol = SG.Kinds.mVolume.eval({ solid: o.id }, S.ctx);
      const sur = SG.Kinds.mSurface.eval({ solid: o.id }, S.ctx);
      if (o.dim !== 2) { pane.appendChild(valueLine('体积', vol.value)); pane.appendChild(valueLine('表面积', sur.value)); }
    } catch (e) { /* 忽略 */ }
    if (o.dim !== 2) pane.appendChild(sec('一键作球', h('div', { class: 'btnrow' },
      h('button', { onclick: () => S_('外接球', () => app.select(app.C.exec({ op: 'circumsphere', solid: o.id }).main)) }, '外接球'),
      h('button', { onclick: () => S_('内切球', () => app.select(app.C.exec({ op: 'insphere', solid: o.id }).main)) }, '内切球'),
      o.curved ? null : h('button', { onclick: () => S_('棱切球', () => app.select(app.C.exec({ op: 'midsphere', solid: o.id }).main)) }, '棱切球'))));
    const verts = (o.verts || []).map((id) => S.map.get(id)).filter(Boolean);
    if (verts.length) {
      const allOn = verts.every((v) => v.style.label);
      pane.appendChild(h('div', { class: 'btnrow' },
        h('button', { onclick: () => S_('标签', () => { for (const v of verts) v.style.label = !allOn; }) }, allOn ? '隐藏顶点标签' : '显示顶点标签'),
        o.curved ? null : h('button', { onclick: () => { app.ui.setTool('section'); app.ui.toolClickPick(o.id); } }, '作截面…'),
        h('button', { onclick: () => S_('锁定', () => { o.locked = !o.locked; }) }, o.locked ? '解锁拖动' : '锁定位置')));
    }
    if (o.curved) {
      const st = o.style;
      pane.appendChild(field('颜色', swatches(app, st.color, (c) => S_('颜色', () => { st.color = c; }))));
    }
    pane.appendChild(h('div', { class: 'info' }, '提示：拖动立体的顶点可以平移整个立体；修改参数可改变大小。立体的面被挡住的棱会自动画成虚线。'));
  }

  function solveDialog(app, m) {
    const S = app.S;
    const cands = SG.Measure.candidateParams(S, m.id);
    if (!cands.length) { UI.toast('这个度量没有可调整的上游参数（全部由定点确定）', 'err'); return; }
    const isAng = m.v && m.v.unit === 'angle';
    const cur = m.v ? (isAng ? (m.v.value * 180) / Math.PI : m.v.value) : 0;
    UI.form('通过度量修改图形：' + S.displayName(m), [
      { key: 'target', label: '目标值' + (isAng ? '（°）' : ''), type: 'text', value: SG.Exact.fmtNum(cur, 4), hint: '可输入表达式，如 sqrt(2)、2*sqrt(3)/3、60' },
      { key: 'param', label: '调整哪个参数', type: 'select', value: 0, options: cands.map((c, i) => ({ value: i, label: c.title })) },
    ], '修改').then((r) => {
      if (!r) return;
      let t = evalExpr(r.target);
      if (!isFinite(t)) return UI.toast('无法识别目标值', 'err');
      if (isAng) t = (t * Math.PI) / 180;
      const p = cands[+r.param];
      const snap = app.snapshot();
      const res = SG.Measure.solve(S, m.id, t, p);
      if (res.ok) { app.pushUndo(snap); app.afterChange(); UI.toast('已修改：' + p.title + ' = ' + SG.Exact.fmtNum(res.value, 4), 'ok'); }
      else { app.restore(snap); app.afterChange(); UI.toast(res.message + '，请换一个参数试试', 'err'); }
    });
  }
  function evalExpr(s) {
    s = String(s).trim().replace(/√\s*\(?([0-9.]+)\)?/g, 'sqrt($1)').replace(/π/g, 'pi').replace(/°/g, '');
    if (!/^[0-9+\-*/().\s,a-z]*$/i.test(s)) return NaN;
    try {
      // eslint-disable-next-line no-new-func
      return Function('sqrt', 'pi', 'sin', 'cos', 'tan', 'atan', 'acos', 'asin', '"use strict"; return (' + s + ');')(Math.sqrt, Math.PI, Math.sin, Math.cos, Math.tan, Math.atan, Math.acos, Math.asin);
    } catch (e) { return NaN; }
  }

  function measureProps(app, pane, o) {
    const S_ = (label, fn) => app.change(label, fn);
    const f = SG.Measure.format(o.v);
    pane.appendChild(h('div', { class: 'big' }, f.main));
    if (f.exact) pane.appendChild(h('div', { class: 'exact' }, '精确值：' + f.exact));
    pane.appendChild(h('div', null, check('在图中显示', o.style.show, (v) => S_('显示', () => { o.style.show = v; })), check('显示名称', o.style.showName !== false, (v) => S_('显示', () => { o.style.showName = v; }))));
    pane.appendChild(h('div', { class: 'btnrow' }, h('button', { class: 'primary', onclick: () => solveDialog(app, o) }, '修改为…（反向修改图形）')));
    pane.appendChild(h('div', { class: 'info' }, '"修改为"：输入希望的度量值（如把二面角改成 50°），程序会自动调整一个上游参数（如翻折角、点的位置、棱长）使度量等于目标值。'));
  }

  function traceProps(app, pane, o) {
    const S = app.S;
    const S_ = (label, fn) => app.change(label, fn);
    pane.appendChild(h('div', null, check('正在记录', o.recording, (v) => S_('记录', () => { o.recording = v; }))));
    pane.appendChild(field('已记录', h('span', null, (o.data || []).length + ' 个点')));
    pane.appendChild(field('颜色', swatches(app, o.style.color, (c) => S_('颜色', () => { o.style.color = c; }))));
    pane.appendChild(h('div', { class: 'btnrow' }, h('button', { onclick: () => S_('清除', () => { o.data = []; }) }, '清除轨迹')));
    const cands = SG.Measure.candidateParams(S, o.def.p).filter((c) => c.min != null && c.max != null);
    if (cands.length) {
      const selP = h('select', null, cands.map((c, i) => h('option', { value: i }, c.title)));
      const n = h('input', { type: 'number', value: 240, class: 'num' });
      pane.appendChild(sec('自动生成完整轨迹', field('驱动参数', selP), field('采样点数', n),
        h('div', { class: 'btnrow' }, h('button', {
          class: 'primary',
          onclick: () => {
            const p = cands[+selP.value];
            const obj = S.map.get(p.obj);
            const N = Math.max(10, Math.min(5000, +n.value || 240));
            app.change('生成轨迹', () => {
              const v0 = S.getParam(obj, p);
              const data = [];
              for (let i = 0; i <= N; i++) {
                S.setParam(obj, p, p.min + ((p.max - p.min) * i) / N);
                S.recompute();
                const q = S.map.get(o.def.p);
                if (q && q.v) data.push(q.v.slice());
              }
              S.setParam(obj, p, v0);
              o.data = data;
              o.recording = false;
            });
          },
        }, '扫描生成'))));
    }
  }

  function renderMulti(app, pane, sel) {
    const S_ = (label, fn) => app.change(label, fn);
    pane.appendChild(sec('已选择 ' + sel.length + ' 个对象', h('div', { class: 'info' }, sel.map((o) => app.S.displayName(o)).join('、'))));
    pane.appendChild(field('颜色', swatches(app, null, (c) => S_('颜色', () => { for (const o of sel) { if (o.type === 'polygon') { o.style.fillColor = c; o.style.fill = true; } else o.style.color = c; } }))));
    const lines = sel.filter((o) => SG.LINE_TYPES.has(o.type));
    if (lines.length) pane.appendChild(field('线型', h('select', { onchange: (e) => S_('线型', () => { for (const o of lines) o.style.dash = e.target.value; }) },
      [['', '—'], ['auto', '自动'], ['solid', '实线'], ['dashed', '虚线']].map(([v, l]) => h('option', { value: v }, l)))));
    pane.appendChild(h('div', { class: 'btnrow' },
      h('button', { onclick: () => S_('标签', () => { for (const o of sel) o.style.label = true; }) }, '显示标签'),
      h('button', { onclick: () => S_('标签', () => { for (const o of sel) o.style.label = false; }) }, '隐藏标签'),
      h('button', { onclick: () => S_('隐藏', () => { for (const o of sel) o.hidden = true; }) }, '隐藏'),
      h('button', { class: 'danger', onclick: () => S_('删除', () => app.S.remove(sel.map((o) => o.id))) }, '删除')));
  }

  // ------------------------------------------------------------ 对象列表
  const GROUPS = [
    ['点', (o) => o.type === 'point'],
    ['线', (o) => SG.LINE_TYPES.has(o.type)],
    ['面', (o) => o.type === 'polygon' || o.type === 'plane'],
    ['立体', (o) => o.type === 'solid'],
    ['球与圆', (o) => o.type === 'sphere' || o.type === 'circle'],
    ['其他', (o) => ['fold', 'trace', 'mark'].includes(o.type)],
  ];
  function renderObjects(app) {
    const pane = document.getElementById('pane-objects');
    const S = app.S;
    pane.innerHTML = '';
    if (!S.objects.length) { pane.appendChild(h('div', { class: 'empty' }, '画布是空的。')); return; }
    const hiddenCount = S.objects.filter((o) => o.hidden).length;
    pane.appendChild(h('div', { class: 'btnrow' },
      h('button', { onclick: () => app.emit('toggleLabels') }, '全部点标签'),
      hiddenCount ? h('button', { onclick: () => app.change('显示', () => { for (const o of S.objects) if (o.type !== 'plane' || o.name) o.hidden = false; }) }, '显示全部隐藏对象 (' + hiddenCount + ')') : null));
    const list = h('div', { class: 'olist' });
    for (const [title, pred] of GROUPS) {
      const items = S.objects.filter((o) => pred(o) && !(o.hidden && o.type === 'plane' && !o.name));
      if (!items.length) continue;
      list.appendChild(h('div', { class: 'grp' }, title + '（' + items.length + '）'));
      for (const o of items) {
        const row = h('div', { class: 'item' + (app.sel.includes(o.id) ? ' sel' : ''), onclick: (e) => app.select(o.id, e.shiftKey || e.ctrlKey) },
          h('button', { class: o.hidden ? 'off' : '', title: o.hidden ? '显示' : '隐藏', onclick: (e) => { e.stopPropagation(); app.change('隐藏', () => { o.hidden = !o.hidden; }); } }, '👁'),
          h('span', { class: 'nm', html: UI.nameHTML(S.displayName(o)) }),
          h('span', { class: 'ds' + (o.err ? ' err' : ''), title: o.err || describeDef(S, o.def) }, o.err ? '无效：' + o.err : describeDef(S, o.def)),
          'label' in o.style ? h('button', { class: o.style.label ? '' : 'off', title: '显示/隐藏标签', onclick: (e) => { e.stopPropagation(); app.change('标签', () => { o.style.label = !o.style.label; }); } }, 'A') : null,
          h('button', { title: '删除', onclick: (e) => { e.stopPropagation(); app.change('删除', () => S.remove(o.id)); } }, '✕'));
        list.appendChild(row);
      }
    }
    pane.appendChild(list);
  }

  // ------------------------------------------------------------ 度量列表
  function renderMeasures(app) {
    const pane = document.getElementById('pane-measures');
    const S = app.S;
    pane.innerHTML = '';
    pane.appendChild(sec('新建度量（点击后在图中选择对象）', h('div', { class: 'btnrow' },
      SG.Tools.CATS.find((c) => c.id === 'measure').tools.map((id) => h('button', { onclick: () => app.ui.setTool(id) }, SG.Tools.byId[id].label)))));
    const ms = S.objects.filter((o) => o.type === 'measure' && !(o.style.show === false && S.objects.some((x) => x.def.kind === 'mSum' && x.def.items.includes(o.id))));
    if (!ms.length) { pane.appendChild(h('div', { class: 'empty' }, '还没有度量。也可以先选中对象，再用画布下方的快捷操作度量。')); return; }
    for (const m of ms) {
      const f = SG.Measure.format(m.v);
      pane.appendChild(h('div', { class: 'mcard' + (app.sel.includes(m.id) ? ' sel' : ''), onclick: () => app.select(m.id) },
        h('div', { class: 't', html: UI.nameHTML(S.displayName(m)) }),
        m.err ? h('div', { class: 'info err' }, m.err) : h('div', null, h('span', { class: 'v' }, f.main), f.exact ? h('span', { class: 'e' }, '　= ' + f.exact) : null),
        h('div', { class: 'acts' },
          h('button', { onclick: (e) => { e.stopPropagation(); app.change('显示', () => { m.style.show = !m.style.show; }); } }, m.style.show ? '图中隐藏' : '图中显示'),
          h('button', { onclick: (e) => { e.stopPropagation(); solveDialog(app, m); } }, '修改为…'),
          h('button', { onclick: (e) => { e.stopPropagation(); app.change('删除', () => S.remove(m.id)); } }, '删除'))));
    }
  }

  SG.Panels = { renderProps, renderObjects, renderMeasures, describeDef, Anim, solveDialog, evalExpr };
})(globalThis.SG = globalThis.SG || {});
