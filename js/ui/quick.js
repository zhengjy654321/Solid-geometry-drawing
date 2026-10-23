/*
 * 快捷操作栏：根据当前选中的对象，自动列出可以进行的操作。
 * 例如选中两个点 → 连线 / 中点 / 测距离；选中立体 → 外接球 / 内切球 / 体积……
 */
(function (SG) {
  'use strict';
  const { UI } = SG;
  const { h } = UI;

  function actions(app) {
    const S = app.S, C = app.C;
    const sel = app.selected();
    const n = sel.length;
    if (!n) return [];
    const is = (t) => sel.filter((o) => (typeof t === 'string' ? o.type === t : t.has(o.type)));
    const pts = is('point'), lines = is(SG.LINE_TYPES), polys = is('polygon'), planes = is('plane'), sph = is('sphere'), circles = is('circle'), solidsSel = is('solid');
    const planeLike = sel.filter((o) => o.type === 'polygon' || o.type === 'plane');
    const solidOf = (o) => {
      if (o.type === 'solid') return o;
      const p = o.parent && S.map.get(o.parent);
      return p && p.type === 'solid' ? p : null;
    };
    const solids = [];
    for (const o of sel) { const s = solidOf(o); if (s && !solids.includes(s)) solids.push(s); }
    const ids = (arr) => arr.map((o) => o.id);
    const A = [];
    const add = (label, fn, cls) => A.push({ label, fn, cls });
    const run = (label, fn, keepSel) => async () => {
      const r = await fn();
      if (r === null) return;
      const res = app.change(label, () => { let x = r; while (typeof x === 'function') x = x(); return x; });
      if (!keepSel && res && res !== true && S.map.has(res)) app.select(res);
    };
    const exec = (cmd) => () => () => C.exec(cmd).main;
    const measure = (type, items, extra) => run('度量', () => () => { const m = C.exec(Object.assign({ op: 'measure', type, items }, extra || {})).main; setTimeout(() => app.emit('measureCreated', m)); return m; });
    const ask = (title, fields) => UI.form(title, fields);
    const only = (k) => n === k;

    // ------------------------------------------------ 只选了点
    if (pts.length === n) {
      const P = ids(pts);
      if (n === 1) {
        const o = pts[0];
        add('沿法向拉起…', run('拉起点', async () => {
          const r = await ask('垂直拉起点', [{ key: 'h', label: '高度', type: 'number', value: 2 }, { key: 'c', label: '连线', type: 'check', value: true }]);
          if (!r) return null;
          return () => { const id = C.exec({ op: 'pointAlongNormal', base: o.id, plane: SG.Tools.workRef(app), dist: r.h }).main; if (r.c) C.ensureSegment(o.id, id); return id; };
        }));
        add('定长动点…', () => { app.ui.setTool('fixedLen'); app.ui.toolClickPick(o.id); });
        const k = SG.Kinds[o.def.kind];
        if (k && k.draggable && o.def.kind !== 'free') add(o.locked ? '解锁（变为动点）' : '锁定（变为定点）', run('锁定', () => () => { o.locked = !o.locked; }, true));
        if (!['free', 'offset', 'solidVertex', 'folded'].includes(o.def.kind)) add('解除约束（可倾斜）', run('解除约束', exec({ op: 'release', target: o.id }), true));
        add('追踪轨迹', run('轨迹', () => exec({ op: 'trace', point: o.id })));
        add('以此为球心作球…', run('球', async () => {
          const r = await ask('球', [{ key: 'r', label: '半径', type: 'number', value: 1.5 }]);
          return r && exec({ op: 'sphere', center: o.id, radius: r.r });
        }));
      }
      if (n === 2) {
        add('连线段', run('线段', exec({ op: 'segment', a: P[0], b: P[1] })));
        add('直线', run('直线', exec({ op: 'line', a: P[0], b: P[1] })));
        add('中点', run('中点', exec({ op: 'midpoint', a: P[0], b: P[1] })));
        add('比例点…', run('比例点', async () => {
          const r = await ask('在线段上取点 P，使 ' + pts[0].name + 'P : ' + pts[0].name + pts[1].name + ' = t', [{ key: 't', label: 't（如 1/3）', type: 'text', value: '1/3' }]);
          return r && exec({ op: 'pointOnLine', a: P[0], b: P[1], t: SG.parseRatio(r.t) });
        }));
        add('测距离', measure('length', P));
        add('球（心 ' + pts[0].name + '，过 ' + pts[1].name + '）', run('球', exec({ op: 'sphere', center: P[0], through: P[1] })));
      }
      if (n === 3) {
        add('三角形面', run('三角形', exec({ op: 'polygon', points: P })));
        add('过三点作平面', run('平面', exec({ op: 'plane', points: P })));
        add('∠' + pts[0].name + pts[1].name + pts[2].name, measure('angle', P));
        add('直角标记', run('直角标记', exec({ op: 'rightAngle', points: P })));
        add('设为工作面', () => { app.setWork({ kind: 'ref', ref: P }); UI.toast('工作面：' + app.workPlaneLabel(), 'ok'); });
        add('三角形的心…', run('心', async () => {
          const r = await ask('三角形的心', [{ key: 't', label: '类型', type: 'select', value: 'centroid', options: [{ value: 'centroid', label: '重心' }, { value: 'circumcenter', label: '外心' }, { value: 'incenter', label: '内心' }, { value: 'orthocenter', label: '垂心' }] }]);
          return r && exec({ op: 'center', type: r.t, points: P });
        }));
        add('过三点的圆', run('圆', exec({ op: 'circle', points: P })));
        const all = S.objects.filter((o) => o.type === 'solid' && !o.curved && o.dim === 3);
        if (all.length === 1) add('截 ' + all[0].name, run('截面', exec({ op: 'section', solid: all[0].id, plane: P })));
      }
      if (n === 4) {
        add('二面角 ' + pts.map((o) => o.name).join('-').replace(/^(\w+)-(\w+)-(\w+)-/, '$1-$2$3-'), measure('dihedral', P));
        add('过四点的球', run('外接球', exec({ op: 'circumsphere', points: P })));
      }
      if (n >= 4) {
        add('多边形面', run('多边形', exec({ op: 'polygon', points: P })));
        add('生成多面体（自动虚实）', run('多面体', exec({ op: 'hull', points: P })));
      }
    }

    // ------------------------------------------------ 线
    if (lines.length === n && n === 1) {
      const l = lines[0];
      add('中点', run('中点', exec({ op: 'midpoint', line: l.id })));
      add('三等分点', run('三等分点', () => () => { C.exec({ op: 'pointOnLine', line: l.id, t: 1 / 3 }); return C.exec({ op: 'pointOnLine', line: l.id, t: 2 / 3 }).main; }));
      add('线上动点', run('动点', exec({ op: 'pointOnLine', line: l.id, t: 0.5, locked: false })));
      add('测长度', measure('length', [l.id]));
      const next = { auto: 'dashed', dashed: 'solid', solid: 'auto' }[l.style.dash || 'auto'];
      add({ auto: '设为虚线', dashed: '设为实线', solid: '恢复自动虚实' }[l.style.dash || 'auto'], run('线型', () => () => { l.style.dash = next; }, true));
    }
    if (lines.length === n && n === 2) {
      add('所成角', measure('angleLines', ids(lines)));
      add('两线距离', measure('distLineLine', ids(lines)));
      add('交点', run('交点', exec({ op: 'intersection', line: lines[0].id, line2: lines[1].id })));
    }
    if (n === 2 && pts.length === 1 && lines.length === 1) {
      add('作垂线（垂足）', run('垂足', () => () => { const f = C.exec({ op: 'foot', point: pts[0].id, line: lines[0].id }).main; C.ensureSegment(pts[0].id, f); C.exec({ op: 'rightAngle', points: [pts[0].id, f, lines[0].def.a] }); return f; }));
      add('点到直线距离', measure('distPointLine', [pts[0].id, lines[0].id]));
      add('过点作平行线', run('平行线', () => () => { const q = C.exec({ op: 'pointByVector', base: pts[0].id, from: lines[0].def.a, to: lines[0].def.b, k: 1 }).main; C.ensureSegment(pts[0].id, q); return q; }));
      add('关于直线的对称点', run('对称点', exec({ op: 'reflect', point: pts[0].id, line: lines[0].id })));
      add('过点垂直于直线的平面', run('平面', exec({ op: 'plane', mode: 'perpToLine', point: pts[0].id, line: lines[0].id })));
    }
    if (n === 2 && pts.length === 1 && planeLike.length === 1) {
      const pl = planeLike[0].id;
      add('作垂线（投影）', run('投影', () => () => { const f = C.exec({ op: 'foot', point: pts[0].id, plane: pl }).main; C.ensureSegment(pts[0].id, f); return f; }));
      add('点到平面距离', measure('distPointPlane', [pts[0].id, pl]));
      add('过点作平行平面', run('平面', exec({ op: 'plane', mode: 'parallelToPlane', point: pts[0].id, plane: pl })));
      add('关于平面的对称点', run('对称点', exec({ op: 'reflect', point: pts[0].id, plane: pl })));
    }
    if (n === 2 && lines.length === 1 && planeLike.length === 1) {
      const pl = planeLike[0].id, l = lines[0].id;
      add('线面角', measure('angleLinePlane', [l, pl]));
      add('线面交点', run('交点', exec({ op: 'intersection', line: l, plane: pl })));
      add('过线作垂直平面', run('平面', exec({ op: 'plane', mode: 'throughLinePerpToPlane', line: l, plane: pl })));
      add('过线作成角平面…', run('平面', async () => {
        const r = await ask('过直线作与平面成定角的平面', [{ key: 'a', label: '角度（°）', type: 'number', value: 30 }, { key: 's', label: '方向', type: 'select', value: 1, options: [{ value: 1, label: '一侧' }, { value: -1, label: '另一侧' }] }]);
        return r && exec({ op: 'plane', mode: 'throughLineAngleToPlane', line: l, plane: pl, angle: r.a, side: +r.s });
      }));
      if (planeLike[0].type === 'polygon') add('沿此线翻折…', run('翻折', async () => {
        const r = await ask('翻折', [{ key: 'a', label: '旋转角（°）', type: 'number', value: 90 }, { key: 'f', label: '反向', type: 'check', value: false }]);
        return r && exec({ op: 'fold', face: pl, axis: l, angle: r.a, dir: r.f ? -1 : 1, view: app.cam.F });
      }));
    }
    if (planeLike.length === 2 && n === 2) add('二面角', measure('dihedral', ids(planeLike)));

    // ------------------------------------------------ 多边形
    if (only(1) && polys.length === 1) {
      const p = polys[0];
      const isFace = !!solidOf(p);
      if (!isFace) {
        add('拉伸成柱…', run('棱柱', async () => { const r = await ask('拉伸成直棱柱', [{ key: 'h', label: '高', type: 'number', value: 2 }]); return r && exec({ op: 'extrude', base: p.id, mode: 'prism', height: r.h }); }));
        add('收成锥…', run('棱锥', async () => { const r = await ask('生成棱锥（顶点在底面中心正上方）', [{ key: 'h', label: '高', type: 'number', value: 2 }]); return r && exec({ op: 'extrude', base: p.id, mode: 'pyramid', height: r.h }); }));
        add('生成棱台…', run('棱台', async () => { const r = await ask('生成棱台', [{ key: 'h', label: '高', type: 'number', value: 2 }, { key: 'k', label: '上底缩放比', type: 'number', value: 0.5 }]); return r && exec({ op: 'extrude', base: p.id, mode: 'frustum', height: r.h, k: r.k }); }));
      }
      add('面积', measure('area', [p.id]));
      add('设为工作面', () => { app.setWork({ kind: 'ref', ref: p.id }); UI.toast('工作面：' + app.workPlaneLabel(), 'ok'); });
      add(p.style.fill ? '取消填充' : '填充颜色', run('填充', () => () => { p.style.fill = !p.style.fill; }, true));
      if (!isFace) add(p.style.occlude ? '取消遮挡' : '设为实体面（遮挡后面的线）', run('遮挡', () => () => { p.style.occlude = !p.style.occlude; }, true));
    }
    if (only(1) && planes.length === 1) {
      add('设为工作面', () => { app.setWork({ kind: 'ref', ref: planes[0].id }); UI.toast('工作面：' + app.workPlaneLabel(), 'ok'); });
    }

    // ------------------------------------------------ 立体
    if (solids.length === 1 && (n === 1 || solidsSel.length === 1 && n === 1)) {
      const so = solids[0];
      if (sel[0] !== so) add('选中整个 ' + so.name, () => app.select(so.id));
      if (so.dim !== 2) {
        add('外接球', run('外接球', exec({ op: 'circumsphere', solid: so.id })));
        add('内切球', run('内切球', exec({ op: 'insphere', solid: so.id })));
        if (!so.curved) add('棱切球', run('棱切球', exec({ op: 'midsphere', solid: so.id })));
        add('体积', measure('volume', [so.id]));
        add('表面积', measure('surface', [so.id]));
      }
    }
    if (n === 2 && solids.length >= 1 && planeLike.length >= 1) {
      const so = solids.find((s) => !planeLike.some((p) => solidOf(p) === s)) || solids[0];
      const pl = planeLike.find((p) => solidOf(p) !== so);
      if (pl) add('求截面', run('截面', exec({ op: 'section', solid: so.id, plane: pl.id })));
    }

    // ------------------------------------------------ 球、圆
    if (only(1) && sph.length === 1) {
      const s = sph[0];
      const modes = ['shaded', 'outline', 'wire'];
      const nm = { shaded: '立体', outline: '轮廓', wire: '经纬线' };
      const next = modes[(modes.indexOf(s.style.mode) + 1) % 3];
      add('显示为：' + nm[next], run('球的显示', () => () => { s.style.mode = next; }, true));
      add('半径', measure('sphere', [s.id], { what: 'r' }));
      add('表面积', measure('sphere', [s.id], { what: 'S' }));
      add('体积', measure('sphere', [s.id], { what: 'V' }));
    }
    if (n === 2 && sph.length === 1 && planeLike.length === 1) {
      add('截面圆', run('截面圆', exec({ op: 'sphereSection', sphere: sph[0].id, plane: planeLike[0].id, withCenter: true })));
    }
    if (sph.length === 1 && solids.length === 1 && n === 2 && !solids[0].curved) {
      add('球面与表面的交线', run('交线', exec({ op: 'sphereSolidIntersect', sphere: sph[0].id, solid: solids[0].id })));
    }
    if (only(1) && circles.length === 1) {
      add(circles[0].v && circles[0].v.clip ? '交线长' : '周长', measure('circle', [circles[0].id], { what: 'len' }));
      add('半径', measure('circle', [circles[0].id], { what: 'r' }));
      add('标出圆心', run('圆心', () => () => C.addPoint({ kind: 'circleCenter', circle: circles[0].id }, { name: S.freshName('O1') }).id));
    }

    // ------------------------------------------------ 通用
    const labelable = sel.filter((o) => ['point', 'plane', 'segment', 'line', 'ray', 'circle', 'sphere'].includes(o.type) || o.type === 'solid');
    if (labelable.length) {
      const allOn = labelable.every((o) => (o.type === 'solid' ? (o.verts || []).every((v) => S.map.get(v) && S.map.get(v).style.label) : o.style.label));
      add(allOn ? '隐藏标签' : '显示标签', run('标签', () => () => {
        for (const o of labelable) {
          if (o.type === 'solid') for (const v of o.verts || []) { const p = S.map.get(v); if (p) p.style.label = !allOn; }
          else o.style.label = !allOn;
        }
      }, true));
    }
    add('隐藏', run('隐藏', () => () => { for (const o of sel) o.hidden = true; app.sel = []; }, true));
    add('删除', run('删除', () => () => { S.remove(ids(sel)); }, true), 'danger');
    return A;
  }

  function render(app) {
    const bar = document.getElementById('quickbar');
    const busy = app.ui && (app.ui.toolId !== 'select' || app.ui.picked.length || app.ui.partial.length || app.ui.drag);
    const acts = busy ? [] : actions(app);
    bar.innerHTML = '';
    if (!acts.length) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    bar.appendChild(h('span', { class: 'ttl' }, '快捷操作：'));
    for (const a of acts) bar.appendChild(h('button', { class: a.cls || '', onclick: () => a.fn() }, a.label));
  }

  SG.Quick = { actions, render };
})(globalThis.SG = globalThis.SG || {});
