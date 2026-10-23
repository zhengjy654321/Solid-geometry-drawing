const assert = require('assert');
const SG = require('./load');
const { V } = SG;
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n    ')); }
}
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) < eps, (msg || '') + ` expected ${b}, got ${a}`);
function fresh() { const S = new SG.Scene(); const C = new SG.Commands(S); return { S, C, run: (cmd) => { const r = C.exec(cmd); S.recompute(); return r; } }; }
const mval = (S, id) => S.map.get(id).v.value;
const deg = (r) => r * 180 / Math.PI;

t('精确值识别', () => {
  assert.strictEqual(SG.Exact.recognize(Math.sqrt(2)), '√2');
  assert.strictEqual(SG.Exact.recognize(Math.sqrt(6) / 3), '√6/3');
  assert.strictEqual(SG.Exact.recognize(2 * Math.sqrt(3) / 3), '2√3/3');
  assert.strictEqual(SG.Exact.recognize(0.75), '3/4');
  assert.strictEqual(SG.Exact.recognize(4 * Math.PI), '4π');
  assert.strictEqual(SG.Exact.recognize(1 + Math.sqrt(2)), '1+√2');
  assert.strictEqual(SG.Exact.recognize(12 * Math.PI), '12π');
});

t('正方体与基本度量', () => {
  const { S, run } = fresh();
  run({ op: 'solid', shape: 'cube', a: 2 });
  assert.ok(S.byName('A') && S.byName('C1'));
  assert.ok(S.byName('ABCD-A1B1C1D1'));
  const m = run({ op: 'measure', type: 'length', items: ['A', 'C1'] });
  near(mval(S, m.main), 2 * Math.sqrt(3));
  const a = run({ op: 'measure', type: 'angleLinePlane', items: [['A', 'C1'], ['A', 'B', 'C']] });
  near(deg(mval(S, a.main)), deg(Math.atan(1 / Math.sqrt(2))));
  const dh = run({ op: 'measure', type: 'dihedral', items: ['A1', 'B', 'D', 'A'] });
  near(Math.tan(mval(S, dh.main)), Math.sqrt(2));
  const ll = run({ op: 'measure', type: 'angleLines', items: [['A', 'B1'], ['B', 'C1']] });
  near(deg(mval(S, ll.main)), 60);
  const d = run({ op: 'measure', type: 'distLineLine', items: [['A', 'C'], ['B', 'D1']] });
  near(mval(S, d.main), Math.sqrt(6) / 3 * 1);
  const v = run({ op: 'measure', type: 'volume', items: ['ABCD-A1B1C1D1'] });
  near(mval(S, v.main), 8);
  const pp = run({ op: 'measure', type: 'distPointPlane', items: ['A', ['A1', 'B', 'D']] });
  near(mval(S, pp.main), 2 / Math.sqrt(3));
});

t('外接球 / 内切球 / 棱切球', () => {
  const { S, run } = fresh();
  run({ op: 'solid', shape: 'cube', a: 2 });
  const o = run({ op: 'circumsphere', solid: 'ABCD-A1B1C1D1' });
  near(S.map.get(o.main).v.r, Math.sqrt(3));
  const i = run({ op: 'insphere', solid: 'A' });
  near(S.map.get(i.main).v.r, 1);
  const m = run({ op: 'midsphere', solid: 'A' });
  near(S.map.get(m.main).v.r, Math.sqrt(2), 1e-5);
  const { S: S2, run: run2 } = fresh();
  run2({ op: 'solid', shape: 'tetra', a: 2 });
  const sname = S2.objects.find((x) => x.type === 'solid').name;
  near(S2.map.get(run2({ op: 'circumsphere', solid: sname }).main).v.r, Math.sqrt(6) / 2);
  near(S2.map.get(run2({ op: 'insphere', solid: sname }).main).v.r, Math.sqrt(6) / 6);
  const { S: S3, run: run3 } = fresh();
  run3({ op: 'solid', shape: 'cone', r: 3, h: 4 });
  const cn = S3.objects.find((x) => x.type === 'solid').name;
  near(S3.map.get(run3({ op: 'insphere', solid: cn }).main).v.r, 1.5);
  near(S3.map.get(run3({ op: 'circumsphere', solid: cn }).main).v.r, 25 / 8);
});

t('截面：正方体过三条棱中点的截面为正六边形', () => {
  const { S, run } = fresh();
  run({ op: 'solid', shape: 'cube', a: 2 });
  run({ op: 'midpoint', a: 'A', b: 'B', name: 'E' });
  run({ op: 'midpoint', a: 'B', b: 'C', name: 'F' });
  run({ op: 'midpoint', a: 'C1', b: 'C', name: 'G' });
  const r = run({ op: 'section', solid: 'A', plane: ['E', 'F', 'G'] });
  const poly = S.map.get(r.main);
  assert.strictEqual(poly.def.pts.length, 6);
  const ar = run({ op: 'measure', type: 'area', items: [r.main] });
  near(mval(S, ar.main), 3 * Math.sqrt(3));
});

t('折叠：正方形沿对角线折成直二面角', () => {
  const { S, run } = fresh();
  run({ op: 'solid', shape: 'square', a: 2 });
  const f = run({ op: 'fold', face: ['A', 'B', 'D'], axis: ['B', 'D'], angle: 90 });
  const polys = S.objects.filter((o) => o.type === 'polygon');
  assert.strictEqual(polys.length, 2, '正方形被拆成两个三角形');
  const dh = run({ op: 'measure', type: 'dihedral', items: ['A', 'B', 'D', 'C'] });
  near(deg(mval(S, dh.main)), 90);
  near(mval(S, run({ op: 'measure', type: 'length', items: ['A', 'C'] }).main), 2);
  // 反向求解：二面角改为 60°
  const ps = SG.Measure.candidateParams(S, dh.main);
  assert.strictEqual(S.map.get(ps[0].obj).type, 'fold');
  const res = SG.Measure.solve(S, dh.main, Math.PI / 3, ps[0]);
  assert.ok(res.ok, res.message);
  near(deg(mval(S, dh.main)), 60, 1e-6);
  void f;
});

t('折叠：折痕为对角线时按 side 选择折起的一侧', () => {
  for (const [side, moved] of [[null, 'A'], [[1.5, 1.4, 0], 'C']]) {
    const { S, run } = fresh();
    run({ op: 'point', name: 'A', coord: [0, 0, 0] }); run({ op: 'point', name: 'B', coord: [2, 0, 0] });
    run({ op: 'point', name: 'C', coord: [2, 2, 0] }); run({ op: 'point', name: 'D', coord: [0, 2, 0] });
    run({ op: 'polygon', points: 'ABCD' });
    const before = Object.fromEntries('ABCD'.split('').map((n) => [n, S.byName(n).v.slice()]));
    run({ op: 'fold', face: 'ABCD', axis: ['B', 'D'], angle: 90, side: side || undefined });
    for (const n of 'ABCD') {
      const changed = SG.V.dist(before[n], S.byName(n).v) > 1e-9;
      assert.strictEqual(changed, n === moved, n + (changed ? ' 不应移动' : ' 应移动'));
    }
    assert.ok(S.byName(moved).v[2] > 0, '默认向上折起');
  }
});

t('拉伸底面、凸包、过线与面成角的平面', () => {
  const { S, run } = fresh();
  run({ op: 'point', name: 'A', coord: [0, 0, 0] });
  run({ op: 'point', name: 'B', coord: [2, 0, 0] });
  run({ op: 'point', name: 'C', coord: [0, 2, 0] });
  run({ op: 'polygon', points: ['A', 'B', 'C'] });
  const pr = run({ op: 'extrude', base: ['A', 'B', 'C'], mode: 'pyramid', height: 3 });
  const so = S.map.get(pr.main);
  assert.ok(so.name.startsWith('P-'));
  near(mval(S, run({ op: 'measure', type: 'volume', items: [so.id] }).main), 2);
  const pl = run({ op: 'plane', mode: 'throughLineAngleToPlane', line: ['A', 'B'], plane: ['A', 'B', 'C'], angle: 30 });
  const ang = run({ op: 'measure', type: 'dihedral', items: [pl.main, ['A', 'B', 'C']] });
  near(deg(mval(S, ang.main)), 30);
  const { S: S2, run: run2 } = fresh();
  [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.2, 0.2, 0.2]].forEach((c, i) => run2({ op: 'point', coord: c }));
  const h = run2({ op: 'hull', points: 'ABCDE' });
  assert.strictEqual(S2.map.get(h.main).faces.length, 4);
});

t('球的截面圆与交线', () => {
  const { S, run } = fresh();
  run({ op: 'solid', shape: 'cube', a: 2 });
  const sp = run({ op: 'sphere', center: 'A', radius: 2 * Math.sqrt(3) / 3 * 2 });
  run({ op: 'sphereSolidIntersect', sphere: sp.main, solid: 'A' });
  const sum = S.objects.find((o) => o.def.kind === 'mSum');
  assert.ok(sum && sum.v.value > 0);
  const c = run({ op: 'sphereSection', sphere: sp.main, plane: ['A1', 'B1', 'C1'] });
  assert.ok(S.map.get(c.main).v.r > 0);
});

t('解除约束：竖直拉起的点可以倾斜，度量随之变化', () => {
  const { S, run } = fresh();
  run({ op: 'point', name: 'A', coord: [0, 0, 0] }); run({ op: 'point', name: 'B', coord: [2, 0, 0] }); run({ op: 'point', name: 'D', coord: [0, 2, 0] });
  run({ op: 'pointAlongNormal', name: 'F', base: 'A', dist: 2 });
  const m = run({ op: 'measure', type: 'angle', items: ['F', 'A', 'B'] });
  near(deg(mval(S, m.main)), 90);
  run({ op: 'release', target: 'F' });
  assert.strictEqual(S.byName('F').def.kind, 'offset');
  run({ op: 'setParam', target: 'F', key: 'vec.0', value: -2 });
  near(deg(mval(S, m.main)), 135);
  run({ op: 'moveTo', target: 'F', coord: [2, 0, 2] });
  near(deg(mval(S, m.main)), 45);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
