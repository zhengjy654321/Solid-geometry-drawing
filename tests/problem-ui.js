// 从题目新建 + 题目控制面板 的端到端测试（模拟 AI 接口）
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const out = process.argv[2] || '/tmp/claude-0/shots';
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < (eps || 1e-6), (msg || '') + ` 期望 ${b}，实际 ${a}`);
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('sg.settings', JSON.stringify({ ai: { apiKey: 'sk-test' } })); });
  await page.reload();
  // 模拟 AI：根据系统提示词判断是哪一步
  await page.evaluate(() => {
    // 示意图中的点：用已知视角（az=50, el=25）投影正方体得到
    const cam = new SG.Camera(); cam.az = 50; cam.el = 25; cam.update();
    const P3 = { A: [2, 0, 0], B: [2, 2, 0], C: [0, 2, 0], D: [0, 0, 0], A1: [2, 0, 2], B1: [2, 2, 2], C1: [0, 2, 2], D1: [0, 0, 2] };
    const fig = {};
    for (const [n, p] of Object.entries(P3)) fig[n] = [0.5 + 0.1 * SG.V.dot(cam.a1, p), (0.5 - 0.1 * SG.V.dot(cam.a2, p)) / 0.75];
    const recog = { title: '正方体中的最值', text: '在棱长为 2 的正方体 ABCD-A1B1C1D1 中，M 是线段 BD 上的动点，求 MC1 的最小值。', solid: '正方体 ABCD-A1B1C1D1，棱长为 2', given: '', points: '[动点] M：线段 BD 上的动点', asks: '求 MC1 的最小值', notes: '', figure: { has: true, image: 1, points: fig } };
    const panel = (aiVal) => ({
      title: '正方体中 MC1 的最小值',
      params: [{ id: 'P1', target: 'M', key: 't', min: 0, max: 1, label: 'M 在 BD 上的位置 BM:BD' }],
      buttons: [
        { label: '演示 M 的运动', desc: 'M 在 BD 上来回运动', actions: [{ do: 'play', param: 'P1', from: 0, to: 1, seconds: 2, loop: true }] },
        { label: '跳到最小值', desc: '', actions: [{ do: 'extremum', index: 0 }] },
        { label: '作 C1 到 BD 的垂线', desc: '', actions: [{ do: 'draw', commands: [{ op: 'foot', name: 'H', point: 'C1', line: 'BD' }, { op: 'segment', a: 'C1', b: 'H' }] }] },
        { label: '与原图同视角', desc: '', actions: [{ do: 'view', preset: 'figure' }] },
      ],
      extrema: [{ label: 'MC1 的最小值', type: 'min', params: ['P1'], target: { op: 'sum', terms: [{ coef: 1, measure: { type: 'length', items: ['M', 'C1'] } }] }, ai: aiVal }],
      answers: [{ q: '', text: 'M 为 BD 中点时最小，为 √6' }],
    });
    const gen = (aiVal) => ({ thought: '', message: '已作出正方体与动点 M', commands: [{ op: 'solid', shape: 'cube', a: 2 }, { op: 'pointOnLine', name: 'M', a: 'B', b: 'D', t: 0.25, locked: false }, { op: 'segment', a: 'M', b: 'C1' }, { op: 'labels', show: true }], panel: panel(aiVal) });
    window.__mode = 'wrong';
    window.__reqs = [];
    window.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      window.__reqs.push(body);
      const sys = body.messages[0].content;
      let reply;
      if (sys.includes('数学题目识别助手')) reply = recog;
      else if (sys.includes('检查员')) reply = { diagnosis: 'AI 把最小值算成了 2，实际 M 为 BD 中点时 MC1 = √6。', cause: 'answer', fix: { commands: [], panel: panel({ value: '√6', valueNum: Math.sqrt(6), at: [0.5], atDesc: 'M 为 BD 中点' }) } };
      else reply = gen(window.__mode === 'wrong' ? { value: '2', valueNum: 2, at: [0.5] } : { value: '√6', valueNum: Math.sqrt(6), at: [0.5] });
      const text = '```json\n' + JSON.stringify(reply) + '\n```';
      const enc = new TextEncoder();
      const chunks = ['data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: '思考…' } }] }) + '\n\n'];
      for (let i = 0; i < text.length; i += 200) chunks.push('data: ' + JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 200) } }] }) + '\n\n');
      chunks.push('data: [DONE]\n\n');
      return new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
  });
  console.log('· 新建 → 从题目新建');
  await page.click('[data-act="new"]');
  await page.click('.pb-card:has-text("从题目新建")');
  await page.fill('.pb-text', '在棱长为 2 的正方体中……');
  await page.setInputFiles('.modal-box input[type=file]', path.join(__dirname, 'fixtures-problem.png'));
  await page.waitForTimeout(300);
  assert.strictEqual(await page.locator('.pb-thumb').count(), 1);
  const recOpts = await page.evaluate(() => Array.from(document.querySelectorAll('.pb-model-row select.model-sel option')).map((o) => o.value));
  assert.deepStrictEqual(recOpts, ['deepseek-flash'], '有图片时识别只能选 Flash');
  await page.screenshot({ path: out + '/pb1.png' });
  await page.click('.modal-box .foot button:has-text("识别题目")');
  await page.waitForSelector('.pb-grid', { timeout: 5000 });
  const r0 = await page.evaluate(() => window.__reqs[0]);
  assert.strictEqual(r0.model, 'deepseek-flash');
  assert.deepStrictEqual(r0.thinking, { type: 'disabled' }, '识别默认关闭思考');
  assert.ok(Array.isArray(r0.messages[1].content) && r0.messages[1].content.some((c) => c.type === 'image_url' && c.image_url.url.startsWith('data:image/jpeg;base64,')), '应发送图片');
  console.log('· 确认面板（修改数据）');
  const vals = await page.evaluate(() => Array.from(document.querySelectorAll('.pb-field textarea, .pb-field input')).map((e) => e.value));
  assert.ok(vals.some((v) => v.includes('[动点] M')));
  await page.fill('.pb-field:has-text("补充说明") textarea', '把 M 画在 BD 上');
  await page.screenshot({ path: out + '/pb2.png' });
  await page.dblclick('.modal-box .foot button:has-text("提交并生成")');
  await page.waitForFunction(() => document.getElementById('modal').classList.contains('hidden'), null, { timeout: 5000 });
  assert.strictEqual(await page.evaluate(() => window.__reqs.length), 2, '连点两次只应提交一次');
  const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('sg.problemHistory')));
  assert.strictEqual(hist.length, 1, '生成后应记入历史题目');
  assert.ok(hist[0].data.problem && hist[0].data.scene.objects.length > 0);
  const r1 = await page.evaluate(() => window.__reqs[1]);
  assert.deepStrictEqual(r1.thinking, { type: 'enabled' }, '画图默认开启思考');
  assert.strictEqual(r1.model, 'deepseek-v4-pro', '画图默认使用 Pro');
  assert.ok(r1.messages[1].content.includes('把 M 画在 BD 上'), '确认面板的修改应发送给 AI');
  console.log('· 题目面板与最值核实');
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({ tab: document.querySelector('#side .tabs button.active').dataset.tab, M: SG.app.S.get('M').def, locked: SG.app.S.get('M').locked, badge: document.querySelector('.pp-card .pp-badge').textContent, check: !!document.querySelector('.pp-check .pp-btn') }));
  console.log('  ', JSON.stringify(st));
  assert.strictEqual(st.tab, 'problem');
  assert.strictEqual(st.M.kind, 'onLine'); assert.strictEqual(st.locked, false);
  assert.ok(st.badge.includes('不一致'), 'AI 给的 2 与程序的 √6 不一致');
  assert.ok(st.check, '不一致时应出现"一键检查问题"');
  await page.screenshot({ path: out + '/pb3.png' });
  console.log('· 一键检查 → 应用修正');
  assert.ok(await page.locator('.pp-check select.model-sel').count() >= 1, '检查步骤可单独选模型');
  await page.click('.pp-check .pp-btn');
  await page.waitForSelector('.pp-check button:has-text("应用修正")', { timeout: 5000 });
  assert.strictEqual((await page.evaluate(() => window.__reqs[window.__reqs.length - 1])).model, 'deepseek-v4-pro', '检查默认使用 Pro');
  await page.click('.pp-check button:has-text("应用修正")');
  await page.waitForTimeout(200);
  const badge2 = await page.evaluate(() => document.querySelector('.pp-card .pp-badge').textContent);
  assert.ok(badge2.includes('一致') && !badge2.includes('不'), badge2);
  console.log('· 演示按钮');
  await page.click('.pp-btn:has-text("跳到最小值")');
  await page.waitForTimeout(900);
  near(await page.evaluate(() => SG.app.S.get('M').def.t), 0.5, 1e-4, '跳到最小值位置');
  assert.ok((await page.evaluate(() => document.querySelector('.pp-msg').textContent)).includes('√6'));
  await page.click('.pp-btn:has-text("作 C1 到 BD 的垂线")');
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => !!SG.app.S.get('H') && !SG.app.S.get('H').hidden));
  await page.click('.pp-btn:has-text("作 C1 到 BD 的垂线")');
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => SG.app.S.get('H').hidden), '再点一次应隐藏');
  await page.click('.pp-btn:has-text("演示 M 的运动")');
  await page.waitForTimeout(500);
  const t1 = await page.evaluate(() => SG.app.S.get('M').def.t);
  await page.waitForTimeout(300);
  const t2 = await page.evaluate(() => SG.app.S.get('M').def.t);
  assert.ok(t1 !== t2, '动画应在播放');
  await page.click('button:has-text("■ 停止动画")');
  console.log('· 与原图同视角');
  await page.click('.pp-btn:has-text("与原图同视角")');
  await page.waitForTimeout(200);
  const cv = await page.evaluate(() => ({ az: SG.app.cam.az, el: SG.app.cam.el, mode: SG.app.cam.mode }));
  console.log('  ', JSON.stringify(cv));
  near(cv.az, 50, 0.5); near(cv.el, 25, 0.5);
  await page.screenshot({ path: out + '/pb4.png' });
  console.log('· 刷新后题目面板仍在');
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForTimeout(400);
  await page.click('#side .tabs button[data-tab="problem"]');
  assert.ok(await page.evaluate(() => !!SG.app.problem && document.querySelectorAll('.pp-btn').length >= 4));
  console.log('· 历史题目：清空后从历史中打开');
  await page.evaluate(() => { SG.app.S.clear(); SG.app.setProblem(null); SG.app.render(); });
  await page.evaluate(() => SG.ProblemUI.openHistory(SG.app));
  await page.click('.ph-main');
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(() => !!SG.app.problem && !!SG.app.S.get('M')), '应恢复题目与图形');
  console.log('· 变量：度量按 id、圆的面积、截面圆面积');
  const tv = await page.evaluate(() => {
    const S = SG.app.S;
    SG.AIPrompt.execute(SG.app, [{ op: 'circle', name: 'ω', center: 'A', radius: 1, plane: 'ABCD' }]);
    const m = S.map.get(SG.app.C.exec({ op: 'measure', type: 'length', items: ['A', 'C'] }).main);
    const c = S.objects.find((o) => o.type === 'circle');
    S.recompute();
    return [SG.TextVars.render(S, '{度量:' + m.id + '|d3}'), SG.TextVars.render(S, '{面积:' + c.id + '|d3}'), SG.TextVars.render(S, 'S△ABC = {面积:△ABC}')];
  });
  console.log('  ', JSON.stringify(tv));
  assert.ok(!tv.some((t) => t.includes('{?}')), JSON.stringify(tv));
  assert.strictEqual(tv[1], '3.142');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (errors.length) process.exit(1);
  console.log('problem UI test passed');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
