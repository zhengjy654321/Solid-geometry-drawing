// 题目功能的核心逻辑测试：最值扫描、结果对比、对齐示意图视角
const assert = require('assert');
const path = require('path');
const SG = require('./load');
for (const f of ['render/camera', 'ai/prompt', 'ai/problem']) require(path.join(__dirname, '..', 'js', f + '.js'));
const { V } = SG;
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n    ')); } }
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < (eps || 1e-6), (msg || '') + ` 期望 ${b}，实际 ${a}`);
function mkApp() {
  const S = new SG.Scene(); const C = new SG.Commands(S);
  const app = { S, C, cam: new SG.Camera(), emit() {}, fit() {} };
  return { app, run: (cmd) => { const r = C.exec(cmd); S.recompute(); return r; } };
}

t('最值扫描：正方体中 BD 上动点 M 到 C1 的距离最小值', () => {
  const { app, run } = mkApp();
  run({ op: 'solid', shape: 'cube', a: 2 });
  run({ op: 'pointOnLine', name: 'M', a: 'B', b: 'D', t: 0.2, locked: false });
  const panel = { params: [{ id: 'P1', target: 'M', key: 't', min: 0, max: 1 }] };
  assert.deepStrictEqual(SG.Problem.validatePanel(app, panel), []);
  const ex = { type: 'min', params: ['P1'], target: { op: 'sum', terms: [{ coef: 1, measure: { type: 'length', items: ['M', 'C1'] } }] }, ai: { valueNum: Math.sqrt(6), at: [0.5] } };
  const r = SG.Problem.scanExtremum(app, panel, ex);
  assert.ok(r.ok, r.message);
  near(r.value, Math.sqrt(6), 1e-9); near(r.at[0], 0.5, 1e-6);
  near(app.S.byName('M').def.t, 0.2, 1e-12, '扫描后应恢复原值');
  assert.strictEqual(SG.Problem.compare(ex, r).status, 'ok');
  const wrong = Object.assign({}, ex, { ai: { valueNum: 2, at: [0.5] } });
  assert.strictEqual(SG.Problem.compare(wrong, r).status, 'mismatch');
  // 最大值在端点
  const mx = SG.Problem.scanExtremum(app, panel, Object.assign({}, ex, { type: 'max' }));
  near(mx.value, Math.sqrt(8), 1e-9);
});

t('最值扫描：两个动点、角度目标、和的最小值', () => {
  const { app, run } = mkApp();
  run({ op: 'solid', shape: 'cube', a: 2 });
  run({ op: 'pointOnLine', name: 'M', a: 'A', b: 'C1', t: 0.3, locked: false });
  run({ op: 'pointOnLine', name: 'N', a: 'B', b: 'D1', t: 0.6, locked: false });
  const panel = { params: [{ id: 'P1', target: 'M', key: 't', min: 0, max: 1 }, { id: 'P2', target: 'N', key: 't', min: 0, max: 1 }] };
  const r = SG.Problem.scanExtremum(app, panel, { type: 'min', params: ['P1', 'P2'], target: { terms: [{ measure: { type: 'length', items: ['M', 'N'] } }] } });
  near(r.value, 0, 1e-4, '两条体对角线相交，距离最小为 0');
  const ang = SG.Problem.scanExtremum(app, panel, { type: 'max', params: ['P1'], target: { terms: [{ measure: { type: 'angle', items: ['A', 'M', 'B'] } }] } });
  assert.ok(ang.ok && ang.value > 89 && ang.value <= 180, '角度按度计算：' + ang.value);
});

t('面板检查：固定坐标的"动点"会被指出，被锁定的动点自动解锁', () => {
  const { app, run } = mkApp();
  run({ op: 'point', name: 'M', coord: [1, 1, 0] });
  run({ op: 'point', name: 'A', coord: [0, 0, 0] }); run({ op: 'point', name: 'B', coord: [2, 0, 0] });
  run({ op: 'pointOnLine', name: 'N', a: 'A', b: 'B', t: 0.5, locked: true });
  const w = SG.Problem.validatePanel(app, { params: [{ id: 'P1', target: 'M', key: 'x' }, { id: 'P2', target: 'N', key: 't', min: -1, max: 1 }] });
  assert.ok(w.some((x) => x.includes('超出')), w.join(';'));
  assert.strictEqual(app.S.byName('N').locked, false);
});

t('对齐示意图视角：正投影与斜二测', () => {
  const { app, run } = mkApp();
  run({ op: 'solid', shape: 'pyramid', n: 4, a: 2, h: 3 });
  for (const [mode, setup] of [['ortho', (c) => { c.az = 47; c.el = 23; }], ['oblique', (c) => { c.mode = 'oblique'; c.yaw = 20; }]]) {
    const cam = new SG.Camera(); setup(cam); cam.update();
    const pts = {}; const aspect = 0.8;
    for (const n of ['A', 'B', 'C', 'D', 'P']) {
      const p = app.S.byName(n).v;
      const X = V.dot(cam.a1, p), Y = V.dot(cam.a2, p);
      pts[n] = [0.4 + 0.12 * X, (0.5 - 0.12 * Y) / aspect];
    }
    const v = SG.Problem.fitView(app, pts, aspect);
    assert.strictEqual(v.mode, mode);
    if (mode === 'ortho') { near(v.az, 47, 0.2); near(v.el, 23, 0.2); } else near(v.yaw, 20, 0.5);
    assert.ok(v.err < 1e-3, '误差 ' + v.err);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
