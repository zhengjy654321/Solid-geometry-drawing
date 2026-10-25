// 激活密码：高级调试需连点 7 次；生成激活码、密码错误提示、正确解出 Key、7 天到期后清除
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await b.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.evaluate(() => SG.openSettings(SG.app));
  assert.ok(await page.isVisible('#modal input[placeholder="激活密码"]'), '激活密码输入框应直接可见');
  assert.ok(!(await page.isVisible('.adv-body')));
  for (let i = 0; i < 6; i++) await page.click('.adv-head');
  assert.ok(!(await page.isVisible('.adv-body')), '点 6 次不应展开');
  await page.click('.adv-head');
  assert.ok(await page.isVisible('.adv-body'), '点 7 次应展开');
  await page.fill('.adv-body input >> nth=0', 'sk-secret-123');
  await page.fill('.adv-body input >> nth=1', 'Pass-word-2026');
  await page.fill('.adv-body input >> nth=2', 'Pass-word-2026');
  await page.click('.adv-body button:has-text("生成激活码")');
  await page.waitForFunction(() => document.querySelector('.adv-body textarea').value.startsWith('v1.'));
  const code = await page.inputValue('.adv-body textarea');
  const r = await page.evaluate(async (code) => {
    let wrong;
    try { await SG.Vault.activate(SG.app, 'wrong', code); } catch (e) { wrong = e.message; }
    await SG.Vault.activate(SG.app, 'Pass-word-2026', code);
    const k = SG.app.settings.ai.apiKey, days = (SG.app.settings.ai.keyExpire - Date.now()) / 864e5;
    SG.app.settings.ai.keyExpire = Date.now() - 1;
    SG.app.saveSettings();
    return { wrong, k, days };
  }, code);
  assert.strictEqual(r.wrong, '密码错误');
  assert.strictEqual(r.k, 'sk-secret-123');
  assert.ok(Math.abs(r.days - 7) < 0.01);
  // 激活后设置中不显示 Key，保存设置也不会丢失
  await page.keyboard.press('Escape');
  await page.evaluate(async (code) => { SG.app.settings.ai.keyExpire = 0; await SG.Vault.activate(SG.app, 'Pass-word-2026', code); SG.openSettings(SG.app); }, code);
  const kv = await page.evaluate(() => [...document.querySelectorAll('#modal input')].map((i) => i.value).join('|'));
  assert.ok(!kv.includes('sk-secret'), '界面上不应出现 Key');
  await page.click('#modal .foot button.primary');
  assert.strictEqual(await page.evaluate(() => SG.app.settings.ai.apiKey), 'sk-secret-123');
  await page.evaluate(() => { SG.app.settings.ai.keyExpire = Date.now() - 1; SG.app.saveSettings(); });
  await page.reload();
  assert.strictEqual(await page.evaluate(() => SG.app.settings.ai.apiKey), '', '到期后应清除 Key');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (errors.length) process.exit(1);
  console.log('vault test passed');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
