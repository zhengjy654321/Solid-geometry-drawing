// AI 助手：作图 / 对话模式、附带题目、AI 设计控件、新对话与对话记录、模型下拉
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
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('sg.settings', JSON.stringify({ ai: { apiKey: 'sk-test', think: false } })); });
  await page.reload();
  const mock = () => page.evaluate(() => {
    window.__reqs = [];
    window.__replies = [];
    window.fetch = async (url, init) => {
      window.__reqs.push(JSON.parse(init.body));
      const text = window.__replies.shift() || '好的';
      const enc = new TextEncoder();
      const chunks = [];
      for (let i = 0; i < text.length; i += 30) chunks.push('data: ' + JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 30) } }] }) + '\n\n');
      chunks.push('data: [DONE]\n\n');
      const stream = new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
  });
  await mock();
  const reply = (obj) => page.evaluate((s) => window.__replies.push(s), typeof obj === 'string' ? obj : '```json\n' + JSON.stringify(obj) + '\n```');
  const send = async (text) => {
    await page.fill('#pane-ai textarea', text);
    await page.click('#pane-ai .ai-input button:has-text("发送")');
    await page.waitForFunction(() => document.querySelector('#pane-ai .ai-input .btn.primary').textContent === '发送');
    await page.waitForTimeout(100);
  };
  const lastReq = () => page.evaluate(() => window.__reqs[window.__reqs.length - 1]);

  await page.evaluate(() => SG.AIPrompt.execute(SG.app, [{ op: 'solid', shape: 'cube', a: 2 }]));
  await page.click('#side .tabs button[data-tab="ai"]');

  // 1. 没有题目时"附带当前题目"不可勾选
  assert.ok(await page.isDisabled('#pane-ai .ai-chk input'));

  // 2. 作图模式 + AI 设计控件（一个上屏）
  await reply({
    thought: '作动点', message: '已作动点 E 和控件',
    commands: [{ op: 'pointOnLine', name: 'E', a: 'C', b: 'C1', t: 0.5, locked: false }, { op: 'segment', a: 'B', b: 'E' }],
    controls: [
      { type: 'slider', label: 'E 的位置', target: 'E', key: 't', min: 0, max: 1, pin: true },
      { type: 'button', label: 'E 到中点', actions: [{ do: 'set', target: 'E', key: 't', value: 0.5 }] },
      { type: 'text', label: '长度', text: 'BE = {len:B,E}' },
      { type: 'bogus' },
    ],
  });
  await send('在 CC1 上作动点 E，并做一个滑动条控制它');
  let r = await lastReq();
  assert.ok(r.messages[0].content.includes('# 六、控件'), '作图模式的系统提示应包含控件说明');
  assert.strictEqual(r.model, 'deepseek-flash');
  let st = await page.evaluate(() => ({
    ctls: SG.app.controls.map((c) => [c.type, c.label, 'pin' in c]),
    hud: SG.app.hud.items.map((x) => x.kind),
    hudText: document.getElementById('hud').innerText,
    log: document.querySelector('.ai-log').innerText,
  }));
  assert.deepStrictEqual(st.ctls, [['slider', 'E 的位置', false], ['button', 'E 到中点', false], ['text', '长度', false]]);
  assert.deepStrictEqual(st.hud, ['ctl']);
  assert.ok(st.hudText.includes('E 的位置'), st.hudText);
  assert.ok(st.log.includes('已添加 3 个控件'), st.log);
  // "查看"链接打开控制分区
  await page.click('.ai-log a:has-text("查看")');
  assert.ok(await page.isVisible('#pane-controls'));
  // AI 做的按钮可以用：先把 E 移走，再点按钮
  await page.evaluate(() => SG.app.change('t', () => { SG.app.S.get('E').def.t = 0.9; }));
  await page.click('#pane-controls button.cw-button:has-text("E 到中点")');
  await page.waitForTimeout(900);
  assert.ok(Math.abs(await page.evaluate(() => SG.app.S.get('E').def.t) - 0.5) < 1e-6);
  await page.click('#side .tabs button[data-tab="ai"]');

  // 3. 对话模式：不执行指令，直接显示回答；系统提示为对话提示
  await page.click('#pane-ai .sw button:has-text("对话")');
  const nObj = await page.evaluate(() => SG.app.S.objects.length);
  await reply('AC1 ⊥ 平面 A1BD，因为 AC1 在底面的射影 AC ⊥ BD……\n所以结论成立。');
  await send('为什么 AC1 ⊥ 平面 A1BD？');
  r = await lastReq();
  assert.ok(r.messages[0].content.includes('对话模式'), '对话模式系统提示');
  assert.ok(!r.messages[0].content.includes('# 三、可用指令'));
  const um = r.messages[r.messages.length - 1].content;
  assert.ok(um.includes('【当前图形】') && um.includes('"C1"') && um.includes('【用户】'), 'AI 应能看到当前图形');
  assert.ok(r.messages.some((m) => m.role === 'assistant'), '同一对话中带上之前的记录');
  assert.strictEqual(await page.evaluate(() => SG.app.S.objects.length), nObj, '对话模式不作图');
  let log = await page.evaluate(() => document.querySelector('.ai-log').innerText);
  assert.ok(log.includes('所以结论成立。'), log);
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('sg.settings')).ai.mode === 'chat'));

  // 4. 附带当前题目
  await page.evaluate(() => SG.app.setProblem({ info: { text: '正方体 ABCD-A1B1C1D1 棱长为 2，E 为 CC1 上的动点，求 BE+ED1 的最小值。' }, panel: { title: '最短路径', params: [], buttons: [] } }));
  assert.ok(!(await page.isDisabled('#pane-ai .ai-chk input')));
  await reply('可以把侧面展开。');
  await send('这道题怎么做？');
  r = await lastReq();
  let last = r.messages[r.messages.length - 1].content;
  assert.ok(last.includes('【当前题目】') && last.includes('BE+ED1') && last.includes('最短路径'), last.slice(0, 300));
  await page.uncheck('#pane-ai .ai-chk input');
  await reply('好的。');
  await send('再说一遍');
  r = await lastReq();
  last = r.messages[r.messages.length - 1].content;
  assert.ok(!last.includes('【当前题目】'));

  // 5. 模型下拉：选 Pro
  await page.selectOption('#pane-ai .ai-model select', 'deepseek-v4-pro');
  await reply('嗯。');
  await send('用 Pro 回答');
  r = await lastReq();
  assert.strictEqual(r.model, 'deepseek-v4-pro');
  assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sg.settings')).ai.modelFast), 'deepseek-v4-pro');

  // 5b. 思考强度：关闭思考时不可选；开启后可选，并随请求发送
  assert.ok(await page.isDisabled('#pane-ai .ai-model .effort-sel'));
  await page.click('#pane-ai .sw button:has-text("开启思考")');
  assert.ok(!(await page.isDisabled('#pane-ai .ai-model .effort-sel')));
  await page.selectOption('#pane-ai .ai-model .effort-sel', 'max');
  await reply('嗯。');
  await send('想仔细点');
  r = await lastReq();
  assert.deepStrictEqual(r.thinking, { type: 'enabled' });
  assert.strictEqual(r.reasoning_effort, 'max');
  assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sg.settings')).ai.effort), 'max');
  await page.click('#pane-ai .sw button:has-text("关闭思考")');

  // 6. 新对话：记录清空，请求中不再带之前的消息
  await page.click('#pane-ai button:has-text("新对话")');
  log = await page.evaluate(() => document.querySelector('.ai-log').innerText);
  assert.ok(!log.includes('所以结论成立'), '新对话应清空显示');
  await reply('你好！');
  await send('你好');
  r = await lastReq();
  assert.strictEqual(r.messages.length, 2, '新对话不应带旧记录');

  // 7. 对话记录：列表、切换、删除、持久化
  await page.click('#pane-ai button:has-text("记录")');
  let items = await page.$$eval('#pane-ai .ai-chat .ai-chat-t', (els) => els.map((e) => e.textContent));
  assert.deepStrictEqual(items, ['你好', '在 CC1 上作动点 E，并做一个滑动条控制它']);
  await page.click('#pane-ai .ai-chat:has-text("在 CC1 上作动点 E")');
  log = await page.evaluate(() => document.querySelector('.ai-log').innerText);
  assert.ok(log.includes('所以结论成立') && log.includes('已添加 3 个控件'), '切换到旧对话后应显示旧记录');
  await reply('继续。');
  await send('接着说');
  r = await lastReq();
  assert.ok(r.messages.length > 4, '切换回旧对话后应带上它的记录');
  // 刷新后仍在
  await page.reload();
  await mock();
  await page.click('#side .tabs button[data-tab="ai"]');
  log = await page.evaluate(() => document.querySelector('.ai-log').innerText);
  assert.ok(log.includes('接着说'), '刷新后应恢复当前对话');
  assert.ok(await page.isVisible('#pane-ai .sw button.on:has-text("对话")'), '刷新后保持对话模式');
  await page.click('#pane-ai button:has-text("记录")');
  await page.click('#pane-ai .ai-chat:has-text("你好") .ai-chat-x');
  items = await page.$$eval('#pane-ai .ai-chat .ai-chat-t', (els) => els.map((e) => e.textContent));
  assert.deepStrictEqual(items, ['在 CC1 上作动点 E，并做一个滑动条控制它']);
  await page.screenshot({ path: '/tmp/claude-0/shots/ai2-list.png' });
  await page.click('#pane-ai button:has-text("清空全部")');
  await page.click('#modal button:has-text("全部删除")');
  items = await page.$$eval('#pane-ai .ai-chat', (els) => els.length);
  assert.strictEqual(items, 0);
  assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sg.chats')).list.length), 0);
  await page.click('#pane-ai button:has-text("返回")');
  log = await page.evaluate(() => document.querySelector('.ai-log').innerText);
  assert.ok(log.includes('作图模式：'), '清空后显示欢迎语');

  // 8. 作图模式下指令出错 → 回滚，控件不添加，可让 AI 修正
  await page.click('#pane-ai .sw button:has-text("作图")');
  const nCtl = await page.evaluate(() => SG.app.controls.length);
  await reply({ commands: [{ op: 'midpoint', name: 'M', a: 'B', b: 'Q' }], controls: [{ type: 'text', text: 'x' }], message: 'x' });
  await send('作 BQ 中点');
  log = await page.evaluate(() => document.querySelector('.ai-log').innerText);
  assert.ok(log.includes('已全部回滚'), log);
  assert.strictEqual(await page.evaluate(() => SG.app.controls.length), nCtl);
  await reply({ commands: [{ op: 'midpoint', name: 'M', a: 'B', b: 'C' }], message: '已作 M' });
  await page.click('.ai-log button:has-text("把错误发给 AI 修正")');
  await page.waitForFunction(() => document.querySelector('#pane-ai .ai-input .btn.primary').textContent === '发送');
  await page.waitForTimeout(100);
  r = await lastReq();
  assert.ok(r.messages[r.messages.length - 1].content.includes('原始要求：作 BQ 中点'));
  assert.ok(await page.evaluate(() => !!SG.app.S.get('M')));
  await page.screenshot({ path: '/tmp/claude-0/shots/ai2.png' });

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (errors.length) process.exit(1);
  console.log('AI assistant test passed');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
