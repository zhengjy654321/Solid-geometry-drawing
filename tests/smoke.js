// 浏览器冒烟测试：加载页面、执行一些操作、截图、收集控制台错误
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || '/tmp/claude-0/shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + '/01-empty.png' });
  // 通过命令创建正方体并截图
  await page.evaluate(() => {
    const app = SG.app;
    app.change('t', () => app.C.exec({ op: 'solid', shape: 'cube', a: 2 }));
    app.change('t', () => app.C.exec({ op: 'labels', show: true }));
    app.fit();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out + '/02-cube.png' });
  console.log(errors.join('\n') || 'no errors');
  await browser.close();
})();
