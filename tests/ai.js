// AI 流程测试：用模拟的流式接口返回，检查请求内容、解析与执行
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('sg.settings', JSON.stringify({ ai: { apiKey: 'sk-test', think: true } })); });
  await page.reload();
  await page.evaluate(() => {
    SG.AIPrompt.execute(SG.app, [{ op: 'solid', shape: 'cube', a: 2 }]);
    const reply = { thought: '取 BD 中点 O', commands: [{ op: 'midpoint', name: 'O', a: 'B', b: 'D' }, { op: 'segment', a: 'A', b: 'O' }, { op: 'segment', a: 'A1', b: 'O' }, { op: 'segment', a: 'B', b: 'D' }, { op: 'measure', type: 'angle', items: ['A1', 'O', 'A'] }, { op: 'plane', name: 'β', mode: 'throughLineAngleToPlane', line: 'BD', plane: 'ABCD', angle: 'sqrt(3)*20' }, { op: 'labels', targets: ['O'], show: true }], message: '∠A1OA 为二面角的平面角' };
    const text = '```json\n' + JSON.stringify(reply) + '\n```';
    window.__reqs = [];
    window.fetch = async (url, init) => {
      window.__reqs.push({ url, body: JSON.parse(init.body), headers: init.headers });
      const enc = new TextEncoder();
      const chunks = ['data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: '思考一下……' } }] }) + '\n\n'];
      for (let i = 0; i < text.length; i += 40) chunks.push('data: ' + JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 40) } }] }) + '\n\n');
      chunks.push('data: [DONE]\n\n');
      const stream = new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
  });
  await page.click('#side .tabs button[data-tab="ai"]');
  await page.fill('#pane-ai textarea', '作出二面角 A1-BD-A 的平面角');
  await page.click('#pane-ai button:has-text("发送")');
  await page.waitForTimeout(600);
  const res = await page.evaluate(() => ({
    req: window.__reqs[0],
    names: SG.app.S.objects.filter((o) => o.type === 'point').map((o) => o.name),
    planes: SG.app.S.objects.filter((o) => o.type === 'plane').map((o) => [o.name, o.def.angle]),
    log: document.querySelector('.ai-log').innerText,
  }));
  assert.strictEqual(res.req.url, 'https://api.deepseek.com/chat/completions');
  assert.strictEqual(res.req.body.model, 'deepseek-reasoner');
  assert.strictEqual(res.req.headers.Authorization, 'Bearer sk-test');
  assert.ok(res.req.body.messages[0].content.includes('作图指令'));
  assert.ok(res.req.body.messages[1].content.includes('"C1"'), '用户消息应包含场景');
  assert.ok(res.names.includes('O'));
  assert.deepStrictEqual(res.planes[0][0], 'β');
  assert.ok(Math.abs(res.planes[0][1] - 34.641) < 0.01, '字符串表达式应被转换为数字');
  assert.ok(res.log.includes('已执行 7 条指令'), res.log);
  console.log(res.log.slice(-200));
  await page.screenshot({ path: '/tmp/claude-0/shots/ai.png' });
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log('AI test passed');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
