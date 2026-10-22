// 渲染若干典型场景并截图，检查控制台错误
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || '/tmp/claude-0/shots';
const scenes = {
  pyramid_sphere: [
    { op: 'solid', shape: 'pyramid', n: 4, a: 2, h: 2.5 },
    { op: 'circumsphere', solid: 'P' },
    { op: 'labels', show: true },
  ],
  section_hex: [
    { op: 'solid', shape: 'cube', a: 2 },
    { op: 'midpoint', name: 'E', a: 'A', b: 'B' }, { op: 'midpoint', name: 'F', a: 'B', b: 'C' }, { op: 'midpoint', name: 'G', a: 'C', b: 'C1' },
    { op: 'section', solid: 'A', plane: ['E', 'F', 'G'] },
    { op: 'labels', show: true },
  ],
  cyl_cone: [
    { op: 'solid', shape: 'cylinder', r: 1.2, h: 3 },
    { op: 'solid', shape: 'cone', r: 1.5, h: 3, origin: [0, 4, 0] },
    { op: 'solid', shape: 'coneFrustum', r1: 1.6, r2: 0.8, h: 2, origin: [0, 8, 0] },
    { op: 'labels', show: true },
  ],
  fold: [
    { op: 'solid', shape: 'square', a: 2 },
    { op: 'fold', face: ['A', 'B', 'D'], axis: ['B', 'D'], angle: 90 },
    { op: 'segment', a: 'A', b: 'C' },
    { op: 'hull', points: ['A', 'B', 'C', 'D'] },
    { op: 'labels', show: true },
  ],
  sphere_wire: [
    { op: 'point', name: 'O', coord: [0, 0, 0] },
    { op: 'sphere', center: 'O', radius: 2, display: 'wire' },
    { op: 'plane', name: 'α', mode: 'axis', axis: 'xy', offset: 1, size: 1.5 },
    { op: 'sphereSection', sphere: '球O', plane: 'α', withCenter: true },
    { op: 'labels', show: true },
  ],
  sphere_cube: [
    { op: 'solid', shape: 'cube', a: 2 },
    { op: 'sphere', center: 'A', radius: 2.3 },
    { op: 'sphereSolidIntersect', sphere: '球A', solid: 'A' },
    { op: 'labels', show: true },
  ],
  measures: [
    { op: 'solid', shape: 'bienao', a: 2, b: 2, h: 2 },
    { op: 'measure', type: 'dihedral', items: ['P', 'B', 'C', 'A'] },
    { op: 'measure', type: 'angleLinePlane', items: [['P', 'C'], ['A', 'B', 'C']] },
    { op: 'rightAngle', points: ['P', 'A', 'B'] },
    { op: 'rightAngle', points: ['A', 'B', 'C'] },
    { op: 'plane', name: 'β', mode: 'throughLineAngleToPlane', line: ['B', 'C'], plane: ['A', 'B', 'C'], angle: 30 },
    { op: 'labels', show: true },
  ],
};
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const only = process.argv[3];
  for (const [name, cmds] of Object.entries(scenes)) {
    if (only && name !== only) continue;
    const r = await page.evaluate((cmds) => {
      const app = SG.app;
      app.S.clear(); app.S.recompute();
      try { SG.AIPrompt.execute(app, cmds); } catch (e) { return e.message; }
      app.select([]);
      app.fit();
      return 'ok';
    }, cmds);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/s-${name}.png` });
    console.log(name, r);
  }
  console.log(errors.join('\n') || 'no console errors');
  await browser.close();
})();
