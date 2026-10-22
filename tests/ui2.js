// 界面交互测试（二）：翻折工具、工作面、斜二测、导出、标签拖动、摇杆
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const out = process.argv[2] || '/tmp/claude-0/shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 }, acceptDownloads: true });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);
  const rect = await page.evaluate(() => { const r = document.getElementById('cv').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  const scr = async (p) => { const s = await page.evaluate((p) => SG.app.cam.project(p), p); return [s[0] + rect.x, s[1] + rect.y]; };
  const scrOf = async (name) => scr(await page.evaluate((n) => SG.app.S.get(n).v, name));
  const click = async (xy) => { await page.mouse.click(xy[0], xy[1]); await page.waitForTimeout(60); };
  const step = (s) => console.log('· ' + s);

  step('正方形模板 + 翻折工具（单击 C 所在的一侧）');
  await page.click('#toolbar .cat[title="平面图形"]');
  await page.click('#flyout .tool:has-text("正方形")');
  await page.click('#modal .foot button.primary');
  await page.waitForTimeout(150);
  await page.click('#toolbar .cat[title="截面折叠"]');
  await page.click('#flyout .tool:has-text("翻折")');
  const vs = await page.evaluate(() => Object.fromEntries('ABCD'.split('').map((n) => [n, SG.app.S.get(n).v])));
  const nearC = vs.C.map((c, i) => c * 0.7 + (vs.A[i] + vs.B[i] + vs.C[i] + vs.D[i]) / 4 * 0.3);
  await click(await scr(nearC));
  await click(await scrOf('B'));
  await click(await scrOf('D'));
  const after = await page.evaluate(() => Object.fromEntries('ABCD'.split('').map((n) => [n, SG.app.S.get(n).v])));
  assert.ok(after.C[2] > 0.5, 'C 应被折起');
  assert.ok(Math.abs(after.A[2]) < 1e-9, 'A 不动');
  const fold = await page.evaluate(() => SG.app.selected().map((o) => o.type));
  assert.deepStrictEqual(fold, ['fold']);
  await page.screenshot({ path: out + '/v1-fold.png' });
  // 翻折角滑块
  await page.click('#side .tabs button[data-tab="props"]');
  const slider = page.locator('#pane-props input[type=range]').first();
  await slider.fill('45');
  await page.waitForTimeout(100);
  const ang = await page.evaluate(() => SG.app.S.objects.find((o) => o.type === 'fold').def.angle);
  assert.strictEqual(ang, 45);

  step('工作面设为立体的面并在其上画多边形');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { SG.app.S.clear(); SG.AIPrompt.execute(SG.app, [{ op: 'solid', shape: 'cube', a: 2 }, { op: 'labels', show: true }]); SG.app.fit(); });
  await page.waitForTimeout(100);
  const top = await page.evaluate(() => SG.app.S.objects.find((o) => o.type === 'polygon' && o.v.pts.every((p) => Math.abs(p[2] - 2) < 1e-9)).id);
  await page.evaluate((id) => SG.app.setWork({ kind: 'ref', ref: id }), top);
  await page.keyboard.press('g');
  for (const p of [[1.5, 0.5, 2], [1.5, 1.5, 2], [0.5, 1, 2]]) await click(await scr(p));
  await page.keyboard.press('Enter');
  const tri = await page.evaluate(() => { const p = SG.app.S.objects.filter((o) => o.type === 'polygon').pop(); return p.v.pts.map((q) => q[2]); });
  assert.ok(tri.every((z) => Math.abs(z - 2) < 1e-9), '多边形应在顶面上');
  const kinds = await page.evaluate(() => SG.app.S.objects.filter((o) => o.type === 'point').slice(-3).map((o) => o.def.kind));
  assert.deepStrictEqual(kinds, ['onPlane', 'onPlane', 'onPlane']);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: out + '/v2-workplane.png' });

  step('斜二测');
  await page.click('[data-act="viewOblique"]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: out + '/v3-oblique.png' });
  await page.click('[data-act="viewOblique"]');
  await page.waitForTimeout(150);

  step('标签拖动');
  const A = await scrOf('A');
  const lab = await page.evaluate(() => SG.app.dl.hits.labels.find((l) => SG.app.S.map.get(l.id).name === 'A'));
  await page.mouse.move(lab.x + lab.w / 2 + rect.x, lab.y + lab.h / 2 + rect.y);
  await page.mouse.down();
  await page.mouse.move(A[0] - 30, A[1] + 20, { steps: 4 });
  await page.mouse.up();
  const off = await page.evaluate(() => SG.app.S.get('A').style.labelOffset);
  assert.ok(off && Math.abs(off[0] + 30) < 2, 'labelOffset ' + off);

  step('定长动点 + 摇杆 + 轨迹');
  await page.evaluate(() => { SG.app.S.clear(); SG.AIPrompt.execute(SG.app, [{ op: 'point', name: 'A', coord: [0, 0, 0] }]); SG.app.fit(); });
  await page.click('#toolbar .cat[title="点"]');
  await page.click('#flyout .tool:has-text("定长动点")');
  await click(await scrOf('A'));
  await page.waitForTimeout(100);
  const visible = await page.evaluate(() => !document.getElementById('joystick').classList.contains('hidden'));
  assert.ok(visible, '摇杆应出现');
  const pad = await page.locator('#joystick .pad').boundingBox();
  await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
  await page.mouse.down();
  await page.mouse.move(pad.x + pad.width - 5, pad.y + pad.height / 2, { steps: 3 });
  await page.waitForTimeout(700);
  await page.mouse.up();
  const tr = await page.evaluate(() => SG.app.S.objects.find((o) => o.type === 'trace').data.length);
  console.log('  trace points', tr);
  assert.ok(tr > 5);
  await page.evaluate(() => SG.app.fit());
  await page.screenshot({ path: out + '/v4-joystick.png' });

  step('导出');
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => SG.app.exportPNG())]);
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => SG.app.exportSVG())]);
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => SG.app.saveFile())]);
  console.log('  downloads', dl1.suggestedFilename(), dl2.suggestedFilename(), dl3.suggestedFilename());
  await dl1.saveAs(out + '/export.png');
  await dl2.saveAs(out + '/export.svg');

  step('保存后重新打开');
  const json = await (async () => { const p = await dl3.path(); return require('fs').readFileSync(p, 'utf8'); })();
  await page.evaluate((j) => { SG.app.S.clear(); SG.app.loadData(JSON.parse(j)); }, json);
  const n = await page.evaluate(() => SG.app.S.objects.length);
  assert.ok(n >= 3);

  step('刷新后自动恢复');
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForTimeout(300);
  const n2 = await page.evaluate(() => SG.app.S.objects.length);
  assert.strictEqual(n2, n);

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log('UI test 2 passed');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
