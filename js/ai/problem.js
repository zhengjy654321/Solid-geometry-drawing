/*
 * 从题目新建：题目识别、生成作图与控制面板、最值核实、对齐示意图视角。
 * 本文件不依赖 DOM（界面在 js/ui/problem-ui.js），便于测试。
 */
(function (SG) {
  'use strict';
  const { V, G } = SG;

  // ================================================================ 提示词
  const RECOGNIZE_PROMPT = `你是数学题目识别助手。用户会给出一道立体几何（或平面几何）题目的文字和 / 或图片（题目截图、照片，可能带有示意图）。
请完整识别题目，整理成结构化信息，供后续画图使用。

只输出一个 JSON 对象，放在 \`\`\`json 代码块中，不要输出其他内容，格式如下：
\`\`\`json
{
  "title": "简短标题（12 字以内）",
  "text": "题目完整原文（从图片中逐字识别；数学式用普通文本表示，如 PA⊥平面ABCD、√2、∠PAB=60°；A₁ 写作 A1）",
  "solid": "几何体及已知数据，如：四棱锥 P-ABCD，底面 ABCD 是边长为 2 的正方形，PA⊥底面 ABCD，PA=2",
  "given": "其他已知条件，每行一条",
  "points": "题目中出现的点及其定义，每行一个，如：E：PC 的中点。动点在行首加 [动点]，并写明在哪里运动、范围，如：[动点] M：线段 BD 上的动点（含端点）",
  "asks": "题目要求，每问一行，如：(1) 求证：AE⊥平面PCD\\n(2) 求 ME 的最小值",
  "notes": "识别时不确定、看不清的地方，或需要提醒的事项（没有则为空字符串）",
  "figure": {
    "has": true,
    "image": 1,
    "points": { "A": [0.12, 0.85], "B": [0.48, 0.92] }
  }
}
\`\`\`
说明：
- figure.has：题目是否配有示意图。没有示意图时 has 为 false，points 为 {}。
- figure.points：示意图中每个带字母标注的点在图片中的位置，x、y 为相对坐标（0～1，原点在图片左上角，x 向右、y 向下）。给出的是点本身的位置（线条的交点 / 端点处），不是字母标签的位置。尽量标出所有能看清的点（至少 4 个）。
- figure.image：示意图在第几张图片中（从 1 开始）。
- 题目中的数据务必与原题一致，不要编造；看不清的地方写入 notes。
- 题目中出现"动点""在……上运动""是否存在点……使得""求……的最大值 / 最小值 / 取值范围"等，相应的点都要标为 [动点]。
- 只识别和整理，不要解题。`;

  const BUILD_EXTRA = `

# 六、本次任务：根据题目从零画图，并生成"题目控制面板"
用户会给出一道题目的结构化信息（已经人工确认），当前画布是空的。请：
1. 用作图指令把题目中的图形完整画出来（几何体、题目中出现的所有点和线、必要的面），并显示关键点的标签。
2. 生成"题目控制面板"：一组为这道题量身定做的按钮，用来演示题目（动点运动、跳到最值位置、显示辅助线、转视角等）。

## 动点要求（最重要）
- 题目中的动点必须用"动点"指令创建，不能用固定坐标：
  · 线段 / 直线上的动点：pointOnLine，并且 "locked": false（参数 t：M = A + t·(B−A)）
  · 圆上的动点：pointOnCircle（参数 ang，单位度）；球面上的动点：pointOnSphere（参数 th、ph）
  · 平面内的动点：pointOnPlane（参数 u、v）；到定点距离一定的动点：fixedLenPoint（参数 th、ph）
- 每个动点的参数都要在 panel.params 中列出，并根据题目条件算出参数的取值范围 min、max（如 M 在线段 BD 上：0～1；"M 在 BD 上且 BM ≤ 1"：按长度换算）。
- 依赖动点的点（如动点与某线的交点、中点）用构造指令作出，它们会随动点自动变化。

## 输出格式
只输出一个 JSON 对象（\`\`\`json 代码块），在原来的 thought、commands、message 之外增加 panel：
\`\`\`json
{
  "thought": "作图思路",
  "commands": [ ...作图指令... ],
  "message": "给用户的说明",
  "panel": {
    "title": "题目标题",
    "params": [ { "id": "P1", "target": "M", "key": "t", "min": 0, "max": 1, "label": "M 在线段 BD 上的位置 BM:BD" } ],
    "buttons": [ { "label": "按钮文字（简短）", "desc": "按钮作用说明", "actions": [ ...动作... ] } ],
    "extrema": [
      {
        "label": "ME 的最小值",
        "type": "min",
        "params": ["P1"],
        "target": { "op": "sum", "terms": [ { "coef": 1, "measure": { "type": "length", "items": ["M", "E"] } } ] },
        "ai": { "value": "√6/2", "valueNum": 1.2247448714, "at": [0.5], "atDesc": "M 为 BD 中点时" }
      }
    ],
    "answers": [ { "q": "(1)", "text": "简要答案或思路" } ]
  }
}
\`\`\`

## 按钮的动作（actions 按顺序执行）
- {"do":"set","param":"P1","value":0.5,"seconds":1} —— 把动点参数平滑地设为某值（seconds 为动画时长，可省略）
- {"do":"play","param":"P1","from":0,"to":1,"seconds":4,"loop":true,"trace":false} —— 动画：参数从 from 变到 to（loop 为 true 时来回循环），trace 为 true 时同时描出该动点的轨迹
- {"do":"stop"} —— 停止动画
- {"do":"extremum","index":0} —— 跳到 extrema[index] 的最值位置（由程序精确计算），并显示结果
- {"do":"show","targets":["AE","β"]} / {"do":"hide","targets":[...]} / {"do":"toggle","targets":[...]} —— 显示 / 隐藏 / 切换对象（用名称）
- {"do":"draw","commands":[ ...作图指令... ]} —— 执行作图指令（如作辅助线、截面、展开图）；第一次点击时作出，再次点击切换显示 / 隐藏
- {"do":"view","az":30,"el":20} —— 转到指定视角（az 水平角、el 俯仰角，单位度）；{"do":"view","preset":"figure"} 与题目示意图同视角；{"do":"view","preset":"default"} 默认视角
- {"do":"trace","param":"P1","mode":"full"} —— 扫描参数范围，画出动点的完整轨迹；"mode":"clear" 清除轨迹
- {"do":"text","text":"……"} —— 在面板上显示一段说明（如结论）
- {"do":"measure","measure":{"type":"length","items":["P","M"]}} —— 作出并显示一个度量（格式同 measure 指令）

## 按钮设计建议
- 根据题目的问题来设计 3～6 个按钮，例如："演示 M 的运动""跳到最小值位置""作出二面角的平面角""展开侧面看最短路径""回到示意图视角"。
- 按钮文字要短（10 字以内），desc 说明作用。
- 只使用上面列出的动作；作图请放在 draw 里，名称不要与已有对象重复。

## 最值 / 取值范围（extrema）
- 题目要求最值、取值范围，或"是否存在点使……"时，必须在 extrema 中列出要考察的量。
- target 为若干度量的组合：op 可为 "sum"（Σ coef·度量）、"product"（乘积）、"ratio"（第 1 项 / 第 2 项）；度量格式同 measure 指令的 type 和 items。角度类度量一律按"度"计算。
- params 列出影响该量的动点参数 id（1～2 个）。
- ai 中给出你自己算出的结果：value 为精确值（字符串），valueNum 为数值，at 为取得最值时各参数的值（与 params 一一对应），atDesc 用文字说明位置。程序会独立扫描验证，并与你的结果对比，请认真计算。
- 求取值范围时，分别列出 min 和 max 两项。`;

  const CHECK_PROMPT = `你是"立体几何绘图器"的检查员。程序根据题目让 AI 画了图并生成了控制面板，但"最值核实"发现 AI 给出的答案与程序扫描的结果不一致（或存在其他问题）。
你会收到：题目信息、当前图形（JSON）、控制面板（JSON）、核实结果（AI 声称的值与位置、程序扫描得到的值与位置、参数取若干值时目标量的数值表）。

请分析不一致最可能的原因，例如：
(a) AI 的答案算错了；(b) 图形画错了（数据、点的位置、动点定义不符合题意）；(c) 参数范围 min、max 算错了；(d) 最值目标（度量组合）写错了；(e) 其他。

只输出一个 JSON 对象（\`\`\`json 代码块）：
\`\`\`json
{
  "diagnosis": "中文说明：最可能的原因、依据，以及正确答案（如果能确定）",
  "cause": "answer | figure | range | target | other",
  "fix": {
    "commands": [ ...在当前图形上执行的修正指令（可用 delete、setParam、moveTo 等），不需要时为 []... ],
    "panel": { ...完整的新控制面板（格式同前），不需要修改时省略... }
  }
}
\`\`\`
如果无法确定原因，fix 为 null，并在 diagnosis 中说明需要人工检查的地方。作图指令与面板格式同系统说明。`;

  // ================================================================ 参数
  /** 解析面板参数 → { o, p(参数描述), min, max } */
  function resolveParam(app, prm) {
    const S = app.S;
    const o = S.get(prm.target);
    if (!o) throw new Error('找不到动点 "' + prm.target + '"');
    const ps = S.params(o);
    let p = null;
    if (prm.key != null) p = ps.find((x) => x.key.join('.') === String(prm.key) || x.key[x.key.length - 1] === String(prm.key));
    if (!p) p = ps.find((x) => typeof S.getParam(o, x) === 'number');
    if (!p) throw new Error(S.displayName(o) + ' 没有可调整的参数（不是动点）');
    let min = prm.min != null ? +prm.min : p.min, max = prm.max != null ? +prm.max : p.max;
    if (min == null || !isFinite(min)) min = S.getParam(o, p) - 2;
    if (max == null || !isFinite(max)) max = S.getParam(o, p) + 2;
    if (min > max) [min, max] = [max, min];
    return { o, p, min, max };
  }
  function getP(app, r) { return app.S.getParam(r.o, r.p); }
  function setP(app, r, v) { app.S.setParam(r.o, r.p, v); }

  /** 检查面板：动点是否真的是动点、参数范围是否合理。返回警告列表（会自动解锁被锁定的动点） */
  function validatePanel(app, panel) {
    const warn = [];
    const S = app.S;
    for (const prm of (panel && panel.params) || []) {
      let r;
      try { r = resolveParam(app, prm); } catch (e) { warn.push('参数 ' + (prm.label || prm.id) + '：' + e.message); continue; }
      const k = SG.Kinds[r.o.def.kind];
      if (!k || !k.draggable) warn.push(S.displayName(r.o) + ' 不是动点（' + (SG.Panels ? SG.Panels.describeDef(S, r.o.def) : r.o.def.kind) + '），无法拖动和演示');
      if (r.o.locked) r.o.locked = false;
      if (r.o.def.kind === 'onLine' && r.o.def.mode === 'seg' && (r.min < -1e-9 || r.max > 1 + 1e-9)) warn.push((prm.label || prm.id) + ' 的范围 [' + r.min + ', ' + r.max + '] 超出了线段（0～1）');
    }
    return warn;
  }

  // ================================================================ 目标量
  const ANGLE_TYPES = new Set(['angle', 'angleLines', 'angleLinePlane', 'dihedral']);
  /** 把 target 编译成可反复求值的函数 */
  function compileTarget(app, target) {
    if (!target) throw new Error('缺少目标量');
    const t = target.terms ? target : { op: 'sum', terms: [{ coef: 1, measure: target.measure || target }] };
    const defs = t.terms.map((term) => ({ coef: term.coef == null ? 1 : +term.coef, def: app.C.measureDef(SG.AIPrompt.normalizeCommand(term.measure)), angle: ANGLE_TYPES.has(term.measure.type) }));
    const op = t.op || 'sum';
    return () => {
      const vals = defs.map((d) => {
        let v = app.S.evalDef(d.def).value;
        if (d.angle) v = (v * 180) / Math.PI;
        return v;
      });
      if (vals.some((v) => !isFinite(v))) return NaN;
      if (op === 'product') return vals.reduce((s, v, i) => s * defs[i].coef * v, 1);
      if (op === 'ratio') return (defs[0].coef * vals[0]) / (defs[1].coef * vals[1]);
      return vals.reduce((s, v, i) => s + defs[i].coef * v, 0);
    };
  }

  /**
   * 扫描参数范围，求目标量的最值（程序独立计算）。
   * 返回 { ok, value, at:[...], samples:[[at...], value][] , message }
   */
  function scanExtremum(app, panel, ex) {
    const S = app.S;
    let rs, f;
    try {
      rs = (ex.params || []).map((id) => {
        const prm = (panel.params || []).find((x) => x.id === id) || (panel.params || []).find((x) => x.target === id);
        if (!prm) throw new Error('找不到参数 ' + id);
        return resolveParam(app, prm);
      });
      if (!rs.length) throw new Error('没有指定动点参数');
      if (rs.length > 2) throw new Error('暂只支持 1～2 个动点参数');
      f = compileTarget(app, ex.target);
    } catch (e) { return { ok: false, message: e.message }; }
    const saved = rs.map((r) => getP(app, r));
    const sign = ex.type === 'max' ? -1 : 1;
    const F = (xs) => {
      rs.forEach((r, i) => setP(app, r, Math.max(r.min, Math.min(r.max, xs[i]))));
      S.recompute();
      let v;
      try { v = f(); } catch (e) { v = NaN; }
      return v;
    };
    let best = null;
    const samples = [];
    try {
      if (rs.length === 1) {
        const r = rs[0], N = 600;
        for (let i = 0; i <= N; i++) {
          const x = r.min + ((r.max - r.min) * i) / N;
          const v = F([x]);
          if (i % 60 === 0) samples.push([[x], v]);
          if (isFinite(v) && (!best || sign * v < sign * best.v)) best = { x: [x], v };
        }
        if (best) {
          // 黄金分割细化
          const h = (r.max - r.min) / N;
          let a = Math.max(r.min, best.x[0] - h), b = Math.min(r.max, best.x[0] + h);
          const g = (Math.sqrt(5) - 1) / 2;
          let c = b - g * (b - a), d = a + g * (b - a), fc = sign * F([c]), fd = sign * F([d]);
          for (let k = 0; k < 80; k++) {
            if (!(fc < fd)) { a = c; c = d; fc = fd; d = a + g * (b - a); fd = sign * F([d]); }
            else { b = d; d = c; fd = fc; c = b - g * (b - a); fc = sign * F([c]); }
          }
          const xm = (a + b) / 2, vm = F([xm]);
          if (isFinite(vm) && sign * vm <= sign * best.v) best = { x: [xm], v: vm };
        }
      } else {
        const [r1, r2] = rs, N = 70;
        for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
          const x = [r1.min + ((r1.max - r1.min) * i) / N, r2.min + ((r2.max - r2.min) * j) / N];
          const v = F(x);
          if (i % 14 === 0 && j % 14 === 0) samples.push([x, v]);
          if (isFinite(v) && (!best || sign * v < sign * best.v)) best = { x, v };
        }
        if (best) {
          const obj = (x) => { const v = F(x); return isFinite(v) ? sign * v : Infinity; };
          const r = G.nelderMead(obj, best.x, ((r1.max - r1.min) + (r2.max - r2.min)) / 140, 400);
          const x = r.x.map((v, i) => Math.max(rs[i].min, Math.min(rs[i].max, v)));
          const v = F(x);
          if (isFinite(v) && sign * v <= sign * best.v) best = { x, v };
        }
      }
    } finally {
      rs.forEach((r, i) => setP(app, r, saved[i]));
      S.recompute();
    }
    if (!best) return { ok: false, message: '在给定范围内目标量都无法计算（图形可能无效）', samples };
    return { ok: true, value: best.v, at: best.x, samples, span: rs.map((r) => r.max - r.min) };
  }

  /** 对比 AI 与程序的结果 */
  function compare(ex, res) {
    if (!res.ok) return { status: 'error', text: res.message };
    const ai = ex.ai || {};
    let av = typeof ai.valueNum === 'number' ? ai.valueNum : NaN;
    if (!isFinite(av) && ai.value != null && SG.Panels) av = SG.Panels.evalExpr(String(ai.value));
    if (!isFinite(av)) return { status: 'noai', text: 'AI 没有给出数值，无法对比' };
    const tolV = Math.max(2e-3 * Math.abs(res.value), 1e-4);
    const valueOk = Math.abs(av - res.value) <= tolV;
    let atOk = null;
    if (Array.isArray(ai.at) && ai.at.length === res.at.length) {
      atOk = ai.at.every((x, i) => Math.abs(+x - res.at[i]) <= 0.02 * Math.max(1e-9, Math.abs((res.span && res.span[i]) || 1)));
    }
    if (valueOk && atOk !== false) return { status: 'ok', valueOk, atOk, aiValue: av };
    if (valueOk && atOk === false) return { status: 'multi', valueOk, atOk, aiValue: av, text: '最值一致，但取得最值的位置不同（可能有多个最值点）' };
    return { status: 'mismatch', valueOk, atOk, aiValue: av };
  }

  // ================================================================ 对齐示意图视角
  /**
   * 根据示意图中各点的位置反推视角。pts2：{名称: [x, y]}（相对坐标，y 向下），aspect = 图片高 / 宽。
   * 返回 { mode, az, el, yaw, err（相对误差）, n（参与拟合的点数） }
   */
  function fitView(app, pts2, aspect) {
    const S = app.S;
    S.recompute();
    const pairs = [];
    for (const [name, xy] of Object.entries(pts2 || {})) {
      const o = S.byName(name);
      if (!o || o.type !== 'point' || !o.v || !Array.isArray(xy)) continue;
      pairs.push({ p: o.v, f: [+xy[0], -(+xy[1]) * (aspect || 1)] });
    }
    if (pairs.length < 3) return null;
    const fc = [0, 0];
    for (const q of pairs) { fc[0] += q.f[0] / pairs.length; fc[1] += q.f[1] / pairs.length; }
    const fT = pairs.map((q) => [q.f[0] - fc[0], q.f[1] - fc[1]]);
    const fN = fT.reduce((s, q) => s + q[0] * q[0] + q[1] * q[1], 0) || 1;
    const cam = new SG.Camera();
    const err = (setup) => {
      setup(cam);
      cam.update();
      const pr = pairs.map((q) => [V.dot(cam.a1, q.p), V.dot(cam.a2, q.p)]);
      const pc = [0, 0];
      for (const q of pr) { pc[0] += q[0] / pr.length; pc[1] += q[1] / pr.length; }
      const pT = pr.map((q) => [q[0] - pc[0], q[1] - pc[1]]);
      const pN = pT.reduce((s, q) => s + q[0] * q[0] + q[1] * q[1], 0);
      if (pN < 1e-12) return 1e9;
      const s = pT.reduce((acc, q, i) => acc + q[0] * fT[i][0] + q[1] * fT[i][1], 0) / pN;
      if (s <= 0) return 1e9;
      return pT.reduce((acc, q, i) => acc + (s * q[0] - fT[i][0]) ** 2 + (s * q[1] - fT[i][1]) ** 2, 0) / fN;
    };
    // 正投影：网格搜索 + 细化
    const ortho = (az, el) => err((c) => { c.mode = 'ortho'; c.base = null; c.az = az; c.el = el; });
    const cands = [];
    for (let az = -180; az < 180; az += 6) for (let el = -84; el <= 84; el += 6) cands.push({ az, el, e: ortho(az, el) });
    cands.sort((a, b) => a.e - b.e);
    let bestO = null;
    for (const c0 of cands.slice(0, 4)) {
      const r = G.nelderMead((x) => ortho(x[0], Math.max(-89.9, Math.min(89.9, x[1]))), [c0.az, c0.el], 4, 300);
      if (!bestO || r.fx < bestO.e) bestO = { az: r.x[0], el: Math.max(-89.9, Math.min(89.9, r.x[1])), e: r.fx };
    }
    // 斜二测
    const obl = (yaw) => err((c) => { c.mode = 'oblique'; c.base = null; c.yaw = yaw; });
    let bestB = null;
    for (let y = -180; y < 180; y += 3) { const e = obl(y); if (!bestB || e < bestB.e) bestB = { yaw: y, e }; }
    const r = G.nelderMead((x) => obl(x[0]), [bestB.yaw], 1, 100);
    if (r.fx < bestB.e) bestB = { yaw: r.x[0], e: r.fx };
    const norm = (a) => ((a % 360) + 540) % 360 - 180;
    if (bestB.e < bestO.e * 0.6) return { mode: 'oblique', yaw: norm(bestB.yaw), err: Math.sqrt(bestB.e), n: pairs.length };
    return { mode: 'ortho', az: norm(bestO.az), el: bestO.el, err: Math.sqrt(bestO.e), n: pairs.length };
  }

  /** 应用视角 */
  function applyView(app, v) {
    const cam = app.cam;
    cam.base = null;
    if (v.mode === 'oblique') { cam.mode = 'oblique'; cam.yaw = v.yaw; }
    else { cam.mode = 'ortho'; cam.az = v.az; cam.el = v.el; }
    cam.update();
    app.emit('viewmode');
    app.emit('viewbase');
    app.fit();
  }

  // ================================================================ 消息
  function recognizeMessages(text, images) {
    const content = [];
    content.push({ type: 'text', text: (text ? '【题目文字】\n' + text + '\n\n' : '') + (images.length ? '【题目图片】共 ' + images.length + ' 张，见下。\n' : '') + '请识别这道题，按要求输出 JSON。' });
    for (const im of images) content.push({ type: 'image_url', image_url: { url: im.dataUrl } });
    return [{ role: 'system', content: RECOGNIZE_PROMPT }, { role: 'user', content: images.length ? content : content[0].text }];
  }
  function infoText(info) {
    const lines = [];
    const add = (k, v) => { if (v && String(v).trim()) lines.push('【' + k + '】\n' + String(v).trim()); };
    add('题目原文', info.text);
    add('几何体与已知数据', info.solid);
    add('其他已知条件', info.given);
    add('点（[动点] 表示动点）', info.points);
    add('题目要求', info.asks);
    add('补充说明 / 对画图的额外要求', info.extra);
    if (info.figure && info.figure.has) lines.push('【示意图】题目配有示意图' + (info.figure.points && Object.keys(info.figure.points).length ? '，图中标注的点：' + Object.keys(info.figure.points).join('、') + '（请使用这些名称）' : ''));
    return lines.join('\n\n');
  }
  function buildMessages(info) {
    return [
      { role: 'system', content: SG.AIPrompt.SYSTEM_PROMPT + BUILD_EXTRA },
      { role: 'user', content: '【当前图形】画布为空。\n\n' + infoText(info) + '\n\n请根据题目画图，并生成题目控制面板。' },
    ];
  }
  function checkMessages(app, problem, report) {
    const scene = SG.AIPrompt.describeScene(app);
    const body = [
      infoText(problem.info),
      '【当前图形】\n```json\n' + JSON.stringify(scene) + '\n```',
      '【控制面板】\n```json\n' + JSON.stringify(problem.panel) + '\n```',
      '【核实结果】\n```json\n' + JSON.stringify(report) + '\n```',
      '请检查不一致的原因，并按要求输出 JSON。',
    ].join('\n\n');
    return [{ role: 'system', content: SG.AIPrompt.SYSTEM_PROMPT + BUILD_EXTRA + '\n\n# 七、检查任务\n' + CHECK_PROMPT }, { role: 'user', content: body }];
  }

  SG.Problem = { RECOGNIZE_PROMPT, BUILD_EXTRA, CHECK_PROMPT, resolveParam, validatePanel, compileTarget, scanExtremum, compare, fitView, applyView, recognizeMessages, buildMessages, checkMessages, infoText, getP, setP };
})(globalThis.SG = globalThis.SG || {});
