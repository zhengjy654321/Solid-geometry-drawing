// 点击图中文字：手抖几个像素也应弹出菜单而不是把文字拖走；真正拖动时文字跟着平移而不跳动
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.evaluate(() => {
    SG.AIPrompt.execute(SG.app, [{ op: 'solid', shape: 'cube', a: 3 }, { op: 'labels', show: true },
      { op: 'midpoint', name: 'M', a: 'A', b: 'B' },
      { op: 'measure', type: 'length', items: ['A', 'B'] },
      { op: 'text', at: 'C', text: '∠A1BD = {ang:A1,B,D}' }]);
    SG.app.fit();
  });
  await page.waitForTimeout(150);
  const rect = await page.evaluate(() => { const r = document.getElementById('cv').getBoundingClientRect(); return [r.left, r.top]; });
  const box = (pred) => page.evaluate((pred) => {
    const o = SG.app.S.objects.find(new Function('o', 'return ' + pred));
    const b = SG.app.dl.hits.labels.find((l) => l.id === o.id);
    return { id: o.id, b, off: o.style.labelOffset || null };
  }, pred);

  for (const [what, pred] of [['度量 AB = 3', "o.type === 'measure'"], ['文字', "o.def.kind === 'text'"], ['点的名称 C1', "o.name === 'C1'"]]) {
    const { id, b, off } = await box(pred);
    assert.ok(b, what + ' 应有命中框');
    const x = rect[0] + b.x + b.w * 0.5, y = rect[1] + b.y + b.h * 0.5;
    // 手抖 3 像素的单击
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 2, y + 1);
    await page.mouse.move(x + 3, y - 1);
    await page.mouse.up();
    await page.waitForTimeout(60);
    const r = await page.evaluate((id) => ({ menu: !!document.querySelector('.tx-menu'), off: SG.app.S.map.get(id).style.labelOffset || null, sel: SG.app.sel.slice() }), id);
    assert.ok(r.menu, what + '：单击应弹出菜单');
    assert.deepStrictEqual(r.off, off, what + '：单击不应移动文字');
    assert.deepStrictEqual(r.sel, [id]);
    await page.keyboard.press('Escape');
    // 拖动 40 像素：文字整体平移 40 像素
    const before = (await box(pred)).b;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 20, y + 10, { steps: 4 });
    await page.mouse.move(x + 40, y + 20, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(60);
    const after = (await box(pred)).b;
    assert.ok(Math.abs(after.x - before.x - 40) < 1.5 && Math.abs(after.y - before.y - 20) < 1.5, what + '：拖动应平移 (40,20)，实际 ' + (after.x - before.x) + ',' + (after.y - before.y));
    assert.ok(!(await page.$('.tx-menu')), what + '：拖动后不弹菜单');
    console.log('  ✓ ' + what);
  }

  // 触摸：手指抖动 6 像素仍算单击
  const cdp = await page.context().newCDPSession(page);
  const { b } = await box("o.type === 'measure'");
  const tx = rect[0] + b.x + b.w * 0.5, ty = rect[1] + b.y + b.h * 0.5;
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await tp('touchStart', tx, ty); await tp('touchMove', tx + 4, ty + 3); await tp('touchMove', tx + 6, ty + 2); await tp('touchEnd');
  await page.waitForTimeout(80);
  assert.ok(await page.$('.tx-menu'), '触摸单击应弹出菜单');
  console.log('  ✓ 触摸单击');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (errors.length) process.exit(1);
  console.log('label click test passed');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
