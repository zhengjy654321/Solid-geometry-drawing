/*
 * 工具定义：左侧工具栏的分类、每个工具需要用户依次选择的对象（inputs）、选项（options）以及执行动作（run）。
 *
 * inputs 的 type：
 *   point   —— 点（create:true 时可单击空白处 / 线上 / 面上直接新建）
 *   line    —— 线段/直线/射线，或依次单击两个点
 *   plane   —— 多边形/平面，或依次单击三个点
 *   polygon —— 多边形面        solid —— 立体（点它的面、棱、顶点均可）
 *   sphere  —— 球              circle —— 圆
 *   pl      —— 点或直线
 * variadic:true 表示可以连续选任意多个点（按 Enter / 双击 / 单击首点 完成）。
 */
(function (SG) {
  'use strict';
  const { V, UI } = SG;
  const { h } = UI;

  const byId = {};
  function tool(spec) { byId[spec.id] = spec; return spec.id; }

  const P = (label, create) => ({ type: 'point', create: create !== false, label });
  const Pe = (label) => ({ type: 'point', create: false, label });
  const L = (label) => ({ type: 'line', label });
  const PL = (label) => ({ type: 'plane', label });

  /** 当前工作面的平面引用（用于"沿法向"等）：返回 id / [ids] / null(=水平面) */
  function workRef(app) {
    const w = app.work;
    if (w.kind === 'ref') return w.ref;
    if (w.kind === 'xy') return null;
    // 竖直坐标面：创建一个隐藏的辅助平面作为引用
    const axis = w.kind;
    return app.C.axisPlane(axis, w.h || 0);
  }

  function finishPerp(app, P0, foot, o) {
    if (o.connect) app.C.ensureSegment(P0, foot);
    return foot;
  }

  // ============================================================ 选择
  tool({ id: 'select', label: '选择 / 拖动', icon: 'select', desc: '单击选中对象（Shift 多选），拖动动点；拖动空白处旋转视角', inputs: [] });

  // ============================================================ 点
  tool({ id: 'point', label: '点', desc: '在工作面、线段、面、圆、球面上单击直接建点（自动吸附，靠近中点/三等分点会吸附）', inputs: [P('单击放置点')], run: (app, a) => a[0] });
  tool({
    id: 'pointCoord', label: '坐标点', desc: '输入坐标 (x, y, z) 创建点', action: true,
    async activate(app) {
      const r = await UI.form('按坐标创建点', [
        { key: 'name', label: '名称（可空）', value: '' },
        { key: 'x', label: 'x', type: 'number', value: 0 }, { key: 'y', label: 'y', type: 'number', value: 0 }, { key: 'z', label: 'z', type: 'number', value: 0 },
      ]);
      if (!r) return;
      const id = app.change('坐标点', () => app.C.exec({ op: 'point', coord: [r.x, r.y, r.z], name: r.name || undefined }).main);
      if (id) app.select(id);
    },
  });
  tool({ id: 'midpoint', label: '中点', desc: '选择线段（或两个点），作中点', inputs: [L('选择线段或两点')], run: (app, a) => app.C.exec({ op: 'midpoint', line: a[0] }).main });
  tool({
    id: 'divide', label: '等分点 / 比例点', desc: '在线段上按比例取点：AP : AB = t（可输入 1/3、2:1 等）',
    inputs: [L('选择线段（先点的端点为起点 A）')],
    options: [{ key: 'ratio', label: 'AP:AB =', type: 'ratio', def: '1/3' }, { key: 'locked', label: '定点', type: 'check', def: true }],
    run: (app, a, o) => app.C.exec({ op: 'pointOnLine', line: a[0], t: SG.parseRatio(o.ratio), locked: o.locked }).main,
  });
  tool({
    id: 'dynOnLine', label: '线上动点', desc: '在线段上放一个可拖动的动点，可用摇杆控制、可追踪轨迹',
    inputs: [L('选择线段')],
    run: (app, a) => app.C.exec({ op: 'pointOnLine', line: a[0], t: 0.5, locked: false }).main,
  });
  tool({ id: 'intersectLL', label: '两线交点', desc: '两条共面直线的交点（延长线也可）', inputs: [L('第一条直线'), L('第二条直线')], run: (app, a) => app.C.exec({ op: 'intersection', line: a[0], line2: a[1] }).main });
  tool({ id: 'intersectLP', label: '线面交点', desc: '直线与平面的交点', inputs: [L('选择直线'), PL('选择平面')], run: (app, a) => app.C.exec({ op: 'intersection', line: a[0], plane: a[1] }).main });
  tool({
    id: 'footLine', label: '垂线 / 垂足（点 → 直线）', desc: '过点作直线的垂线，得到垂足', inputs: [Pe('选择点'), L('选择直线')],
    options: [{ key: 'connect', label: '连线', type: 'check', def: true }, { key: 'mark', label: '直角标记', type: 'check', def: true }],
    run: (app, a, o) => {
      const f = app.C.exec({ op: 'foot', point: a[0], line: a[1] }).main;
      finishPerp(app, a[0], f, o);
      if (o.mark) { const ends = app.C.lineEnds(a[1]); app.C.exec({ op: 'rightAngle', points: [a[0], f, ends[0]] }); }
      return f;
    },
  });
  tool({
    id: 'footPlane', label: '垂线 / 投影（点 → 平面）', desc: '过点作平面的垂线，得到垂足（射影）', inputs: [Pe('选择点'), PL('选择平面')],
    options: [{ key: 'connect', label: '连线', type: 'check', def: true }, { key: 'mark', label: '直角标记', type: 'check', def: false }],
    run: (app, a, o) => {
      const f = app.C.exec({ op: 'foot', point: a[0], plane: a[1] }).main;
      finishPerp(app, a[0], f, o);
      if (o.mark) {
        const pl = app.S.ctx.plane(app.C.plane(a[1]));
        const anchor = (pl.anchors || []).find((p) => V.dist(p, app.S.ctx.pt(f)) > 1e-6);
        if (anchor) {
          const ids = Array.isArray(a[1]) ? a[1] : (app.S.map.get(a[1]).def.pts || []);
          const other = ids.find((id) => V.dist(app.S.ctx.pt(id), app.S.ctx.pt(f)) > 1e-6);
          if (other) app.C.exec({ op: 'rightAngle', points: [a[0], f, other] });
        }
      }
      return f;
    },
  });
  tool({
    id: 'reflect', label: '对称点（关于点 / 直线）', desc: '作点关于另一点或直线的对称点', inputs: [Pe('选择要对称的点'), { type: 'pl', label: '选择对称中心（点）或对称轴（直线）' }],
    run: (app, a) => {
      const o = app.S.map.get(Array.isArray(a[1]) ? null : a[1]);
      if (o && o.type === 'point') return app.C.exec({ op: 'reflect', point: a[0], center: a[1] }).main;
      return app.C.exec({ op: 'reflect', point: a[0], line: a[1] }).main;
    },
  });
  tool({ id: 'reflectPlane', label: '对称点（关于平面）', desc: '作点关于平面的对称点', inputs: [Pe('选择点'), PL('选择平面')], run: (app, a) => app.C.exec({ op: 'reflect', point: a[0], plane: a[1] }).main });
  tool({
    id: 'raise', label: '垂直拉起点', desc: '从一个点沿当前工作面的法向拉起（如作棱锥顶点 P，使 PA⊥底面）',
    inputs: [P('选择（或新建）底部的点')],
    options: [{ key: 'h', label: '高度', type: 'number', def: 2, step: 0.5 }, { key: 'connect', label: '连线', type: 'check', def: true }],
    run: (app, a, o) => {
      const ref = workRef(app);
      const id = app.C.exec({ op: 'pointAlongNormal', base: a[0], plane: ref, dist: o.h }).main;
      if (o.connect) app.C.ensureSegment(a[0], id);
      return id;
    },
  });
  tool({
    id: 'fixedLen', label: '定长动点', desc: '到定点距离为定长的动点。可限制在工作面内（圆周）或空间中（球面），用摇杆控制方向并描出轨迹',
    inputs: [P('选择定点（中心）')],
    options: [{ key: 'len', label: '定长', type: 'number', def: 2, step: 0.5 },
      { key: 'mode', label: '范围', type: 'select', def: 'plane', options: [{ value: 'plane', label: '平行于工作面' }, { value: 'yz', label: '平行于 yOz 面' }, { value: 'xz', label: '平行于 xOz 面' }, { value: 'xy', label: '平行于 xOy 面' }, { value: 'space', label: '在空间中' }] },
      { key: 'connect', label: '连线', type: 'check', def: true }, { key: 'trace', label: '记录轨迹', type: 'check', def: true }],
    run: (app, a, o) => {
      const axis = ['xy', 'yz', 'xz'].includes(o.mode);
      const plane = o.mode === 'plane' ? workRef(app) : axis ? app.C.axisPlane(o.mode) : null;
      const id = app.C.exec({ op: 'fixedLenPoint', anchor: a[0], len: o.len, mode: o.mode === 'space' ? 'space' : 'plane', plane, th: 0, ph: 0 }).main;
      if (o.connect) app.C.ensureSegment(a[0], id);
      if (o.trace) app.C.exec({ op: 'trace', point: id });
      return id;
    },
  });
  tool({
    id: 'centers', label: '三角形的心', desc: '重心 / 外心 / 内心 / 垂心', inputs: [Pe('第 1 个顶点'), Pe('第 2 个顶点'), Pe('第 3 个顶点')],
    options: [{ key: 'type', label: '类型', type: 'select', def: 'centroid', options: [{ value: 'centroid', label: '重心' }, { value: 'circumcenter', label: '外心' }, { value: 'incenter', label: '内心' }, { value: 'orthocenter', label: '垂心' }] }],
    run: (app, a, o) => app.C.exec({ op: 'center', type: o.type, points: a }).main,
  });

  // ============================================================ 线
  tool({ id: 'segment', label: '线段', desc: '依次单击两个点（空白处、线上、面上可直接新建点）', inputs: [P('起点'), P('终点')], run: (app, a) => app.C.exec({ op: 'segment', a: a[0], b: a[1] }).main });
  tool({ id: 'polyline', label: '连续线段', desc: '依次单击多个点，连成折线；Enter、双击或右键结束', variadic: 'open', inputs: [P('下一个点')] });
  tool({ id: 'lineInf', label: '直线', desc: '过两点的直线（两端延长）', inputs: [P('第一个点'), P('第二个点')], run: (app, a) => app.C.exec({ op: 'line', a: a[0], b: a[1] }).main });
  tool({ id: 'ray', label: '射线', desc: '从第一个点出发经过第二个点', inputs: [P('端点'), P('经过的点')], run: (app, a) => app.C.exec({ op: 'ray', a: a[0], b: a[1] }).main });
  tool({
    id: 'parallel', label: '过点作平行线', desc: '过点作已知直线的平行线段（长度为原线段的 k 倍）', inputs: [P('选择点'), L('选择直线')],
    options: [{ key: 'k', label: '长度倍数 k', type: 'number', def: 1, step: 0.5 }],
    run: (app, a, o) => {
      const [p1, p2] = app.C.lineEnds(a[1]);
      const q = app.C.exec({ op: 'pointByVector', base: a[0], from: p1, to: p2, k: o.k }).main;
      app.C.ensureSegment(a[0], q);
      return q;
    },
  });
  tool({
    id: 'extend', label: '延长线段', desc: '把线段 AB 沿 B 端延长 k·AB（先点的是 A）', inputs: [L('选择线段（或依次点 A、B）')],
    options: [{ key: 'k', label: '延长 k·AB, k =', type: 'number', def: 0.5, step: 0.25 }],
    run: (app, a, o) => {
      const [p1, p2] = app.C.lineEnds(a[0]);
      const q = app.C.exec({ op: 'pointOnLine', a: p1, b: p2, t: 1 + o.k, mode: 'line', locked: true }).main;
      app.C.ensureSegment(p2, q);
      return q;
    },
  });

  // ============================================================ 面
  tool({ id: 'polygon', label: '多边形', desc: '依次单击各顶点，单击第一个点闭合（或按 Enter）。常用于先画底面', variadic: 'closed', inputs: [P('下一个顶点')] });
  tool({ id: 'plane3', label: '平面（过三点）', desc: '过不共线三点作平面 α', inputs: [P('第 1 个点'), P('第 2 个点'), P('第 3 个点')], run: (app, a) => app.C.exec({ op: 'plane', points: a }).main });
  tool({
    id: 'planeAxis', label: '平行于坐标面的平面', desc: '快速添加与 xOy / xOz / yOz 平行的平面', action: true,
    async activate(app) {
      const r = await UI.form('平行于坐标面的平面', [
        { key: 'axis', label: '平行于', type: 'select', value: 'xy', options: [{ value: 'xy', label: 'xOy 面（水平面，z = 常数）' }, { value: 'xz', label: 'xOz 面（y = 常数）' }, { value: 'yz', label: 'yOz 面（x = 常数）' }] },
        { key: 'offset', label: '位置（常数）', type: 'number', value: 1 },
        { key: 'size', label: '显示大小', type: 'number', value: 2 },
      ]);
      if (!r) return;
      const id = app.change('平面', () => app.C.exec({ op: 'plane', mode: 'axis', axis: r.axis, offset: r.offset, size: r.size }).main);
      if (id) app.select(id);
    },
  });
  tool({ id: 'planePerpLine', label: '过点垂直于直线的平面', inputs: [P('选择点'), L('选择直线')], run: (app, a) => app.C.exec({ op: 'plane', mode: 'perpToLine', point: a[0], line: a[1] }).main });
  tool({ id: 'planeParallel', label: '过点平行于平面', inputs: [P('选择点'), PL('选择平面')], run: (app, a) => app.C.exec({ op: 'plane', mode: 'parallelToPlane', point: a[0], plane: a[1] }).main });
  tool({ id: 'planeLinePerp', label: '过直线垂直于平面', inputs: [L('选择直线'), PL('选择平面')], run: (app, a) => app.C.exec({ op: 'plane', mode: 'throughLinePerpToPlane', line: a[0], plane: a[1] }).main });
  tool({
    id: 'planeLineAngle', label: '过直线与平面成定角', desc: '过直线作与已知平面成指定二面角的平面', inputs: [L('选择直线'), PL('选择参考平面')],
    options: [{ key: 'angle', label: '角度', type: 'number', def: 30, step: 5 }, { key: 'side', label: '方向', type: 'select', def: 1, options: [{ value: 1, label: '一侧' }, { value: -1, label: '另一侧' }] }],
    run: (app, a, o) => app.C.exec({ op: 'plane', mode: 'throughLineAngleToPlane', line: a[0], plane: a[1], angle: o.angle, side: +o.side }).main,
  });
  tool({
    id: 'setWork', label: '设为工作面', desc: '选择一个面或三个点作为工作面，之后新建的点都落在这个面上',
    inputs: [PL('选择面或三个点')],
    run: (app, a) => { app.setWork({ kind: 'ref', ref: a[0] }); UI.toast('工作面已切换为：' + app.workPlaneLabel(), 'ok'); return null; },
  });

  // ============================================================ 由底面生成立体
  tool({ id: 'extrudePrism', label: '拉伸成柱（直棱柱）', desc: '选择底面多边形，沿法向拉伸成直棱柱', inputs: [{ type: 'polygon', label: '选择底面' }], options: [{ key: 'h', label: '高', type: 'number', def: 2, step: 0.5 }], run: (app, a, o) => app.C.exec({ op: 'extrude', base: a[0], mode: 'prism', height: o.h, sign: signFor(app, a[0]) }).main });
  tool({ id: 'extrudeOblique', label: '斜棱柱（指定 A₁）', desc: '选择底面，再选择第一个顶点对应的上底顶点', inputs: [{ type: 'polygon', label: '选择底面' }, P('选择 / 新建上底第一个顶点')], run: (app, a) => app.C.exec({ op: 'extrude', base: a[0], mode: 'prism', top: a[1] }).main });
  tool({ id: 'extrudePyramid', label: '收成锥（顶点在中心上方）', desc: '选择底面，生成顶点在底面中心正上方的棱锥', inputs: [{ type: 'polygon', label: '选择底面' }], options: [{ key: 'h', label: '高', type: 'number', def: 2, step: 0.5 }], run: (app, a, o) => app.C.exec({ op: 'extrude', base: a[0], mode: 'pyramid', height: o.h, sign: signFor(app, a[0]) }).main });
  tool({ id: 'pyramidApex', label: '收成锥（选择顶点）', desc: '选择底面，再选择（或新建）锥顶', inputs: [{ type: 'polygon', label: '选择底面' }, P('选择锥顶')], run: (app, a) => app.C.exec({ op: 'extrude', base: a[0], mode: 'pyramid', apex: a[1] }).main });
  tool({ id: 'extrudeFrustum', label: '生成棱台', desc: '选择底面，生成上底为底面缩小 k 倍的棱台', inputs: [{ type: 'polygon', label: '选择下底面' }], options: [{ key: 'h', label: '高', type: 'number', def: 2, step: 0.5 }, { key: 'k', label: '上底比例', type: 'number', def: 0.5, step: 0.1 }], run: (app, a, o) => app.C.exec({ op: 'extrude', base: a[0], mode: 'frustum', height: o.h, k: o.k, sign: signFor(app, a[0]) }).main });
  tool({ id: 'hull', label: '由点生成多面体', desc: '选择若干点（按 Enter 完成），自动生成凸多面体，被遮挡的棱自动变虚线', variadic: 'set', inputs: [Pe('选择顶点')] });

  function signFor(app, polyId) {
    const o = app.S.map.get(polyId);
    if (!o || !o.v) return 1;
    const n = o.v.plane.n;
    if (Math.abs(n[2]) > 1e-6) return n[2] > 0 ? 1 : -1;
    return V.dot(n, app.cam.F) >= 0 ? 1 : -1;
  }

  // ============================================================ 球与圆
  tool({ id: 'sphereCR', label: '球（球心 + 半径）', inputs: [P('选择 / 新建球心')], options: [{ key: 'r', label: '半径', type: 'number', def: 1.5, step: 0.5 }], run: (app, a, o) => app.C.exec({ op: 'sphere', center: a[0], radius: o.r }).main });
  tool({ id: 'sphereCP', label: '球（球心 + 球面上一点）', inputs: [P('球心'), P('球面上一点')], run: (app, a) => app.C.exec({ op: 'sphere', center: a[0], through: a[1] }).main });
  tool({ id: 'circumSphere', label: '外接球', desc: '选择一个立体，一键作出它的外接球', inputs: [{ type: 'solid', label: '选择立体' }], run: (app, a) => app.C.exec({ op: 'circumsphere', solid: a[0] }).main });
  tool({ id: 'inSphere', label: '内切球', desc: '与各面都相切的球（不存在时给出最大内含球并提示）', inputs: [{ type: 'solid', label: '选择立体' }], run: (app, a) => app.C.exec({ op: 'insphere', solid: a[0] }).main });
  tool({ id: 'midSphere', label: '棱切球', desc: '与各条棱都相切的球', inputs: [{ type: 'solid', label: '选择多面体' }], run: (app, a) => app.C.exec({ op: 'midsphere', solid: a[0] }).main });
  tool({ id: 'circum4', label: '过四点的球', desc: '如三棱锥的外接球：选择四个点', inputs: [Pe('第 1 点'), Pe('第 2 点'), Pe('第 3 点'), Pe('第 4 点')], run: (app, a) => app.C.exec({ op: 'circumsphere', points: a }).main });
  tool({ id: 'sphereSection', label: '球的截面圆', desc: '选择球和一个平面（或三个点），一键画出截面圆', inputs: [{ type: 'sphere', label: '选择球' }, PL('选择截面')], options: [{ key: 'center', label: '标出圆心', type: 'check', def: true }], run: (app, a, o) => app.C.exec({ op: 'sphereSection', sphere: a[0], plane: a[1], withCenter: o.center }).main });
  tool({ id: 'sphereSolid', label: '球面与多面体表面的交线', desc: '求球面与多面体各个面的交线（圆弧），并给出交线总长', inputs: [{ type: 'sphere', label: '选择球' }, { type: 'solid', label: '选择多面体' }], run: (app, a) => app.C.exec({ op: 'sphereSolidIntersect', sphere: a[0], solid: a[1] }).main });
  tool({
    id: 'circleCR', label: '圆（圆心 + 半径）', desc: '在当前工作面内作圆', inputs: [P('选择 / 新建圆心')], options: [{ key: 'r', label: '半径', type: 'number', def: 1.5, step: 0.5 }],
    run: (app, a, o) => { const wp = app.workPlane(); return app.C.exec({ op: 'circle', center: a[0], radius: o.r, normal: wp.n, plane: app.work.kind === 'ref' ? app.work.ref : null }).main; },
  });
  tool({ id: 'circle3', label: '圆（过三点）', inputs: [P('第 1 点'), P('第 2 点'), P('第 3 点')], run: (app, a) => app.C.exec({ op: 'circle', points: a }).main });

  // ============================================================ 截面 / 折叠 / 变换
  tool({ id: 'section', label: '截面', desc: '选择立体，再选择截面（或依次点三个点，如三条棱的中点），自动求出截面多边形', inputs: [{ type: 'solid', label: '选择立体' }, PL('选择截面或三个点')], run: (app, a) => app.C.exec({ op: 'section', solid: a[0], plane: a[1] }).main });
  tool({
    id: 'fold', label: '翻折', desc: '先单击要折起的那部分面（或三个点确定的区域），再选折痕（直线或两点）。折痕是对角线时，单击位置所在的一侧被折起',
    inputs: [PL('选择要折起的面（或三点）'), L('选择折痕')],
    options: [{ key: 'angle', label: '旋转角', type: 'number', def: 90, step: 15 }, { key: 'flip', label: '反向', type: 'check', def: false }],
    run: (app, a, o, x) => app.C.exec({ op: 'fold', face: a[0], axis: a[1], angle: o.angle, dir: o.flip ? -1 : 1, view: app.cam.F, side: x && x.pos && x.pos[0] ? x.pos[0] : undefined }).main,
  });
  tool({ id: 'rotatePoint', label: '绕轴旋转点', desc: '点绕直线旋转一定角度得到新点', inputs: [Pe('选择点'), L('选择旋转轴')], options: [{ key: 'angle', label: '角度', type: 'number', def: 90, step: 15 }], run: (app, a, o) => app.C.exec({ op: 'rotatePoint', point: a[0], axis: a[1], angle: o.angle }).main });

  // ============================================================ 度量
  const MT = [
    ['mLength', 'length', '长度', [L('选择线段或两点')]],
    ['mDistPL', 'distPointLine', '点到直线距离', [Pe('选择点'), L('选择直线')]],
    ['mDistPP', 'distPointPlane', '点到平面距离', [Pe('选择点'), PL('选择平面')]],
    ['mDistLL', 'distLineLine', '异面直线距离', [L('第一条直线'), L('第二条直线')]],
    ['mAngle3', 'angle', '平面角 ∠ABC', [Pe('点 A'), Pe('顶点 B'), Pe('点 C')]],
    ['mAngleLL', 'angleLines', '异面直线所成角', [L('第一条直线'), L('第二条直线')]],
    ['mAngleLP', 'angleLinePlane', '线面角', [L('选择直线'), PL('选择平面')]],
    ['mDihedral', 'dihedral', '二面角（两个面）', [PL('第一个面'), PL('第二个面')]],
    ['mDihedral4', 'dihedral', '二面角 A-BC-D（四点）', [Pe('半平面上的点 A'), Pe('棱的端点 B'), Pe('棱的端点 C'), Pe('另一半平面上的点 D')]],
    ['mArea', 'area', '面积', [{ type: 'polygon', label: '选择多边形' }]],
    ['mVolume', 'volume', '体积', [{ type: 'solid', label: '选择立体' }]],
    ['mSurface', 'surface', '表面积', [{ type: 'solid', label: '选择立体' }]],
    ['mCircle', 'circle', '圆的周长 / 交线长', [{ type: 'circle', label: '选择圆' }]],
    ['mSphereR', 'sphere', '球的半径', [{ type: 'sphere', label: '选择球' }]],
  ];
  const measureTools = MT.map(([id, type, label, inputs]) => tool({
    id: 'm_' + id, label, inputs, measure: true,
    run: (app, a) => {
      const m = app.C.exec({ op: 'measure', type, items: a }).main;
      app.emit('measureCreated', m);
      return m;
    },
  }));

  // ============================================================ 标注 / 轨迹
  tool({ id: 'rightAngle', label: '直角标记', desc: '依次选 A、直角顶点 O、B', inputs: [Pe('点 A'), Pe('直角顶点'), Pe('点 B')], run: (app, a) => app.C.exec({ op: 'rightAngle', points: a }).main });
  tool({ id: 'angleMark', label: '角标记（圆弧）', desc: '依次选 A、顶点 O、B', inputs: [Pe('点 A'), Pe('角的顶点'), Pe('点 B')], options: [{ key: 'count', label: '弧数', type: 'select', def: 1, options: [{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }] }], run: (app, a, o) => app.C.exec({ op: 'angleMark', points: a, count: +o.count }).main });
  tool({ id: 'textMark', label: '文字标注', desc: '在点旁边添加文字', inputs: [P('选择位置（点）')], options: [{ key: 'text', label: '文字', type: 'text', def: '' }], run: (app, a, o) => app.C.exec({ op: 'text', at: a[0], text: o.text || '文字' }).main });
  tool({ id: 'trace', label: '追踪轨迹', desc: '选择一个点，它移动时会留下轨迹线', inputs: [Pe('选择要追踪的点')], run: (app, a) => app.C.exec({ op: 'trace', point: a[0] }).main });

  // ============================================================ 模板
  const TPL3 = ['cube', 'cuboid', 'prism', 'pyramid', 'rectPyramid', 'frustum', 'tetra', 'corner', 'bienao', 'qiandu', 'cylinder', 'cone', 'coneFrustum'];
  const TPL2 = ['triEq', 'triRight', 'triIso', 'square', 'rect', 'regPoly', 'parallelogram', 'rhombus', 'trapezoid'];
  for (const k of TPL3.concat(TPL2)) {
    const t = SG.Solids.T[k];
    tool({ id: 'tpl_' + k, label: t.label, desc: t.desc || '', action: true, activate: (app) => openTemplate(app, k) });
  }
  tool({
    id: 'tpl_sphere', label: '球', action: true,
    async activate(app) {
      const r = await UI.form('球', [{ key: 'r', label: '半径', type: 'number', value: 2 }, { key: 'mode', label: '显示方式', type: 'select', value: 'shaded', options: [{ value: 'shaded', label: '立体（明暗）' }, { value: 'outline', label: '轮廓 + 赤道' }, { value: 'wire', label: '经纬线' }] }]);
      if (!r) return;
      const wp = app.workPlane();
      const id = app.change('球', () => {
        const c = app.C.addPoint({ kind: 'free', x: wp.center[0], y: wp.center[1], z: wp.center[2] + (app.work.kind === 'xy' ? r.r : 0) }, { name: app.S.freshName('O') });
        c.style.label = true;
        const s = app.C.exec({ op: 'sphere', center: c.id, radius: r.r }).main;
        app.S.map.get(s).style.mode = r.mode;
        return s;
      });
      if (id) { app.select(id); app.fit(); }
    },
  });
  tool({
    id: 'tpl_circle', label: '圆', action: true,
    async activate(app) {
      const r = await UI.form('圆（在当前工作面内）', [{ key: 'r', label: '半径', type: 'number', value: 1.5 }]);
      if (!r) return;
      const wp = app.workPlane();
      const id = app.change('圆', () => {
        const c = app.C.addPoint({ kind: 'free', x: wp.center[0], y: wp.center[1], z: wp.center[2] }, { name: app.S.freshName('O') });
        c.style.label = true;
        return app.C.exec({ op: 'circle', center: c.id, radius: r.r, normal: wp.n }).main;
      });
      if (id) { app.select(id); app.fit(); }
    },
  });

  /** 模板参数对话框 */
  async function openTemplate(app, key) {
    const t = SG.Solids.T[key];
    const fields = t.params.map((p) => ({
      key: p.key, label: p.label, value: p.def,
      type: p.options ? 'select' : 'number',
      options: p.options ? p.options({ n: 4 }) : null,
    }));
    // 正 n 棱锥的顶点位置选项随 n 变化，这里先给出常用的两项
    if (key === 'pyramid') fields.find((f) => f.key === 'apex').options = [{ value: 'center', label: '底面中心正上方（正棱锥）' }, { value: 'v0', label: '第 1 个底面顶点正上方' }];
    fields.push({ key: '_label', label: '显示顶点标签', type: 'check', value: true });
    const extra = t.desc ? h('div', { class: 'info' }, t.desc) : null;
    const r = await UI.form((t.dim === 2 ? '平面图形：' : '立体：') + t.label, fields, '创建', extra);
    if (!r) return;
    const params = {};
    for (const p of t.params) params[p.key] = r[p.key];
    const frame = placementFrame(app, t, params);
    const id = app.change(t.label, () => {
      const res = app.C.exec({ op: 'solid', shape: key, params, frame });
      if (r._label) for (const vid of app.S.map.get(res.main).verts) app.S.map.get(vid).style.label = true;
      return res.main;
    });
    if (id) { app.select(id); app.fit(); }
  }

  /** 新图形放在哪里：工作面上；若与已有图形重叠则向右平移 */
  function placementFrame(app, t, params) {
    const wp = app.workPlane();
    let f;
    if (app.work.kind === 'xy') {
      f = { o: [0, 0, app.work.h || 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
      if (t.dim === 2) {
        // 平面图形：局部 x 轴朝屏幕右方，y 轴朝屏幕"上"（纵深方向）
        f.u = [0, 1, 0]; f.v = [-1, 0, 0];
      }
    } else {
      // 使图形的 x 轴尽量朝向屏幕右侧
      let u = V.sub(app.cam.a1, V.scale(wp.n, V.dot(app.cam.a1, wp.n)));
      if (V.len(u) < 1e-6) u = wp.u;
      u = V.norm(u);
      let n = wp.n;
      if (t.dim === 3 && V.dot(n, app.cam.F) < 0 && app.work.kind === 'ref') n = V.neg(n);
      const v = V.cross(n, u);
      f = { o: wp.center.slice(), u, v, n };
    }
    // 避免重叠
    const pts = app.S.objects.filter((o) => o.type === 'point' && o.v).map((o) => o.v);
    if (pts.length && app.work.kind === 'xy') {
      const b = t.build(params);
      const local = b.pts.map((p) => SG.Solids.toWorld(f, p));
      const minNew = Math.min(...local.map((p) => p[1]));
      const maxOld = Math.max(...pts.map((p) => p[1]));
      const ovX = Math.max(...local.map((p) => p[0])) >= Math.min(...pts.map((p) => p[0])) && Math.min(...local.map((p) => p[0])) <= Math.max(...pts.map((p) => p[0]));
      if (ovX && minNew <= maxOld) f.o[1] += maxOld - minNew + 1.5;
    }
    return f;
  }

  // ============================================================ 分类
  const ICONS = {
    select: '<path d="M6 3l12 9-6 1 3 7-3 1-3-7-4 4z" fill="currentColor"/>',
    point: '<circle cx="12" cy="12" r="3.5" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-dasharray="2 2.5"/>',
    line: '<path d="M4 19L20 5" stroke="currentColor" stroke-width="2"/><circle cx="4" cy="19" r="2.2" fill="currentColor"/><circle cx="20" cy="5" r="2.2" fill="currentColor"/>',
    plane: '<path d="M3 16l6-9h12l-6 9z" fill="#cfe1f7" stroke="currentColor" stroke-width="1.6"/>',
    shape2d: '<path d="M4 19h16L12 5z" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    solid: '<path d="M5 8h10v10H5z M5 8l4-4h10l-4 4 M19 4v10l-4 4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 18l4-4h10M9 4v10" stroke="currentColor" stroke-dasharray="2 2"/>',
    sphere: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><ellipse cx="12" cy="12" rx="8.5" ry="3" fill="none" stroke="currentColor" stroke-dasharray="2 2"/>',
    section: '<path d="M4 9l8-5 8 5v8l-8 4-8-4z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 13l8-3 8 3-8 4z" fill="#f8c77a" stroke="#d07a00" stroke-width="1.2"/>',
    measure: '<path d="M3 17L17 3l4 4L7 21z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2" stroke="currentColor" stroke-width="1.4"/>',
    mark: '<path d="M5 19V5M5 19h14" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M5 13h6v6" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  };
  const CATS = [
    { id: 'select', label: '选择', tools: ['select'] },
    { id: 'point', label: '点', tools: ['point', 'pointCoord', 'midpoint', 'divide', 'dynOnLine', 'intersectLL', 'intersectLP', 'footLine', 'footPlane', 'raise', 'fixedLen', 'reflect', 'reflectPlane', 'centers'] },
    { id: 'line', label: '线', tools: ['segment', 'polyline', 'lineInf', 'ray', 'footLine', 'footPlane', 'parallel', 'extend'] },
    { id: 'plane', label: '面', tools: ['polygon', 'plane3', 'planeAxis', 'planePerpLine', 'planeParallel', 'planeLinePerp', 'planeLineAngle', 'setWork'] },
    { id: 'shape2d', label: '平面图形', tools: TPL2.map((k) => 'tpl_' + k).concat(['tpl_circle']) },
    { id: 'solid', label: '立体', tools: TPL3.map((k) => 'tpl_' + k).concat(['tpl_sphere']), sub: { title: '由底面生成（先用"多边形"画底面）', tools: ['extrudePrism', 'extrudeOblique', 'extrudePyramid', 'pyramidApex', 'extrudeFrustum', 'hull'] } },
    { id: 'sphere', label: '球与圆', tools: ['circumSphere', 'inSphere', 'midSphere', 'circum4', 'sphereSection', 'sphereSolid', 'sphereCR', 'sphereCP', 'circleCR', 'circle3'] },
    { id: 'section', label: '截面折叠', tools: ['section', 'fold', 'rotatePoint'] },
    { id: 'measure', label: '度量', tools: measureTools },
    { id: 'mark', label: '标注轨迹', tools: ['rightAngle', 'angleMark', 'textMark', 'trace'] },
  ];

  SG.Tools = { byId, CATS, ICONS, openTemplate, workRef };
})(globalThis.SG = globalThis.SG || {});
