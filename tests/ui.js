// 界面交互测试：用鼠标操作工具完成一个完整的作图流程
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const out = process.argv[2] || '/tmp/claude-0/shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);
  const rect = await page.evaluate(() => { const r = document.getElementById('cv').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  const scr = async (p) => { const s = await page.evaluate((p) => SG.app.cam.project(p), p); return [s[0] + rect.x, s[1] + rect.y]; };
  const scrOf = async (name) => { const s = await page.evaluate((n) => SG.app.cam.project(SG.app.S.get(n).v), name); return [s[0] + rect.x, s[1] + rect.y]; };
  const click = async (xy) => { await page.mouse.click(xy[0], xy[1]); await page.waitForTimeout(60); };
  const count = (type) => page.evaluate((t) => SG.app.S.objects.filter((o) => o.type === t).length, type);
  const step = (s) => console.log('· ' + s);

  // 1. 多边形工具画底面
  step('多边形工具画底面');
  await page.click('#toolbar .cat[title="面"]');
  await page.click('#flyout .tool:has-text("多边形")');
  const base = [[1, -1, 0], [1, 1, 0], [-1, 1, 0], [-1, -1, 0]];
  for (const p of base) await click(await scr(p));
  await click(await scr(base[0])); // 单击第一个点闭合
  assert.strictEqual(await count('polygon'), 1, '应创建 1 个多边形');
  assert.strictEqual(await count('point'), 4);
  assert.strictEqual(await count('segment'), 4);
  await page.screenshot({ path: out + '/u1-polygon.png' });

  // 2. 选中多边形 → 快捷操作 收成锥
  step('快捷操作 收成锥');
  await page.keyboard.press('Escape');
  await click(await scr([0, 0, 0]));
  const sel = await page.evaluate(() => SG.app.selected().map((o) => o.type));
  assert.deepStrictEqual(sel, ['polygon']);
  await page.click('#quickbar button:has-text("收成锥")');
  await page.waitForTimeout(100);
  await page.click('#modal .foot button.primary');
  await page.waitForTimeout(150);
  assert.strictEqual(await count('solid'), 1);
  await page.evaluate(() => SG.app.fit());
  await page.waitForTimeout(100);
  await page.screenshot({ path: out + '/u2-pyramid.png' });

  // 3. 中点工具：单击线段
  step('中点工具');
  await page.keyboard.press('m');
  const P = await scrOf('P');
  const C = await scrOf('C');
  await click([(P[0] + C[0]) / 2, (P[1] + C[1]) / 2]);
  const mid = await page.evaluate(() => { const o = SG.app.S.objects.filter((x) => x.type === 'point').pop(); return { name: o.name, kind: o.def.kind, t: o.def.t }; });
  console.log('  midpoint', mid);
  assert.strictEqual(mid.kind, 'onLine'); assert.strictEqual(mid.t, 0.5);

  // 4. 线段工具：连接中点与 A
  step('线段工具');
  await page.keyboard.press('s');
  await click(await scrOf(mid.name));
  await click(await scrOf('A'));
  const segs = await count('segment');
  assert.ok(segs >= 9);

  // 5. 在线段上单击建点（非吸附位置）→ 动点
  step('线上动点 + 拖动');
  await page.keyboard.press('p');
  const A = await scrOf('A'), B = await scrOf('B');
  await click([A[0] + (B[0] - A[0]) * 0.2, A[1] + (B[1] - A[1]) * 0.2]);
  const dyn = await page.evaluate(() => { const o = SG.app.S.objects.filter((x) => x.type === 'point').pop(); return { name: o.name, kind: o.def.kind, t: o.def.t, locked: o.locked }; });
  console.log('  dyn', dyn);
  assert.strictEqual(dyn.kind, 'onLine'); assert.ok(!dyn.locked);
  await page.keyboard.press('v');
  const D0 = await scrOf(dyn.name);
  await page.mouse.move(D0[0], D0[1]);
  await page.mouse.down();
  await page.mouse.move(D0[0] + (B[0] - A[0]) * 0.3, D0[1] + (B[1] - A[1]) * 0.3, { steps: 5 });
  await page.mouse.up();
  const t2 = await page.evaluate((n) => SG.app.S.get(n).def.t, dyn.name);
  console.log('  dragged t', t2);
  assert.ok(t2 > 0.4);
  await page.screenshot({ path: out + '/u3-dyn.png' });

  // 6. 度量：二面角，选两个面
  step('二面角度量');
  await page.click('#toolbar .cat[title="度量"]');
  await page.click('#flyout .tool:has-text("二面角（两个面）")');
  // 侧面 EAB 与 底面
  const face1 = await page.evaluate(() => { const S = SG.app.S; const f = S.objects.find((o) => o.type === 'polygon' && o.def.pts.length === 3 && o.def.pts.includes(S.get('A').id) && o.def.pts.includes(S.get('B').id)); return SG.app.cam.project(SG.V.centroid(f.v.pts)); });
  await click([face1[0] + rect.x, face1[1] + rect.y]);
  // 底面通过三个点 A B C
  await click(await scrOf('A')); await click(await scrOf('B')); await click(await scrOf('C'));
  const ms = await page.evaluate(() => SG.app.S.objects.filter((o) => o.type === 'measure').map((o) => [SG.app.S.displayName(o), o.v && o.v.value * 180 / Math.PI]));
  console.log('  measures', ms);
  assert.strictEqual(ms.length, 1);
  await page.screenshot({ path: out + '/u4-measure.png' });

  // 7. 修改为 60°
  step('通过度量修改图形');
  const mid2 = await page.evaluate(() => SG.app.S.objects.find((o) => o.type === 'measure').id);
  await page.evaluate((id) => SG.app.select(id), mid2);
  await page.click('#side .tabs button[data-tab="props"]');
  await page.click('#pane-props button:has-text("修改为")');
  await page.fill('#modal input[type=text]', '60');
  await page.click('#modal .foot button.primary');
  await page.waitForTimeout(200);
  const v2 = await page.evaluate((id) => SG.app.S.map.get(id).v.value * 180 / Math.PI, mid2);
  console.log('  after solve', v2);
  assert.ok(Math.abs(v2 - 60) < 1e-4);

  // 8. 模板：正方体 → 截面 → 外接球
  step('模板正方体、截面、外接球、翻折');
  await page.click('#toolbar .cat[title="立体"]');
  await page.click('#flyout .tool:has-text("正方体")');
  await page.click('#modal .foot button.primary');
  await page.waitForTimeout(150);
  const cube = await page.evaluate(() => SG.app.S.objects.filter((o) => o.type === 'solid').pop().name);
  console.log('  cube', cube);
  await page.evaluate(() => SG.app.select([]));
  await page.click('#toolbar .cat[title="球与圆"]');
  await page.click('#flyout .tool:has-text("外接球")');
  const vtx = await page.evaluate((nm) => SG.app.S.get(nm).verts.map((id) => SG.app.S.map.get(id).name), cube);
  await click(await scrOf(vtx[0]));
  assert.strictEqual(await count('sphere'), 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: out + '/u5-cube.png' });

  // 9. 撤销、重做
  step('撤销重做');
  const n1 = await page.evaluate(() => SG.app.S.objects.length);
  await page.keyboard.press('Control+z');
  const n2 = await page.evaluate(() => SG.app.S.objects.length);
  await page.keyboard.press('Control+y');
  const n3 = await page.evaluate(() => SG.app.S.objects.length);
  assert.ok(n2 < n1 && n3 === n1);

  // 10. 旋转视角
  step('旋转视角');
  const az0 = await page.evaluate(() => SG.app.cam.az);
  await page.mouse.move(1000, 150); await page.mouse.down(); await page.mouse.move(900, 180, { steps: 4 }); await page.mouse.up();
  const az1 = await page.evaluate(() => SG.app.cam.az);
  assert.ok(az1 !== az0);

  // 11. 各标签页渲染
  for (const tab of ['objects', 'measures', 'ai', 'props']) await page.click(`#side .tabs button[data-tab="${tab}"]`);
  await page.click('#side .tabs button[data-tab="objects"]');
  await page.screenshot({ path: out + '/u6-objects.png' });
  // 12. 导出 SVG 字符串
  const svgLen = await page.evaluate(() => { const dl = SG.app.exportDL(); const b = SG.Backend.contentBox(dl); return SG.Backend.toSVG(dl, b, '#fff').length; });
  assert.ok(svgLen > 1000);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log('UI test passed');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
