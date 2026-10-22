/*
 * 精确值识别：把浮点数识别为 整数 / 分数 / a√b/c / (a+b√c)/d / 含 π 的形式，
 * 便于在度量结果中直接给出题目常见的精确答案。
 */
(function (SG) {
  'use strict';

  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { [a, b] = [b, a % b]; }
    return a;
  }

  /** 连分数求最佳有理逼近 */
  function toFrac(x, maxDen, tol) {
    if (!isFinite(x)) return null;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    let h1 = 1, h0 = 0, k1 = 0, k0 = 1, b = x;
    for (let i = 0; i < 40; i++) {
      const a = Math.floor(b);
      const h2 = a * h1 + h0, k2 = a * k1 + k0;
      if (k2 > maxDen) break;
      h0 = h1; h1 = h2; k0 = k1; k1 = k2;
      if (Math.abs(x - h1 / k1) <= tol * Math.max(1, x)) return { p: sign * h1, q: k1 };
      const frac = b - a;
      if (frac < 1e-15) break;
      b = 1 / frac;
    }
    if (k1 > 0 && Math.abs(x - h1 / k1) <= tol * Math.max(1, x)) return { p: sign * h1, q: k1 };
    return null;
  }

  /** n = a² · b，b 无平方因子 */
  function squareFree(n) {
    let a = 1, b = n;
    for (let f = 2; f * f <= b; f++) {
      while (b % (f * f) === 0) { b /= f * f; a *= f; }
    }
    return { a, b };
  }

  /** 格式化 sign·a√b / c */
  function fmtSurd(sign, a, b, c) {
    const g = gcd(a, c);
    a /= g; c /= g;
    let s = '';
    if (b === 1) s = String(a);
    else s = (a === 1 ? '' : String(a)) + '√' + b;
    if (c !== 1) s += '/' + c;
    return (sign < 0 ? '-' : '') + s;
  }

  const SURDS = [2, 3, 5, 6, 7, 10, 11, 13, 14, 15, 17, 19, 21, 22, 30];

  function recognizeReal(x, tol) {
    tol = tol || 1e-9;
    if (!isFinite(x)) return null;
    if (Math.abs(x) < tol) return '0';
    const r = Math.round(x);
    if (Math.abs(x - r) < tol * Math.max(1, Math.abs(x))) return String(r);
    const f = toFrac(x, 48, tol);
    if (f) return f.p + '/' + f.q;
    // a√b/c：x² 为有理数
    const sq = toFrac(x * x, 600, tol);
    if (sq && Math.abs(sq.p) < 1e7) {
      const sign = x < 0 ? -1 : 1;
      // √(p/q) = √(p·q)/q
      const { a, b } = squareFree(sq.p * sq.q);
      const g = gcd(a, sq.q);
      if (b <= 300 && sq.q / g <= 60 && a / g <= 200) return fmtSurd(sign, a, b, sq.q);
    }
    // (a + b√c)/d
    for (let d = 1; d <= 12; d++) {
      for (const c of SURDS) {
        const sc = Math.sqrt(c);
        for (let b = -12; b <= 12; b++) {
          if (b === 0) continue;
          const a = x * d - b * sc;
          const ar = Math.round(a);
          if (Math.abs(a - ar) < tol * 10 * Math.max(1, Math.abs(x) * d) && Math.abs(ar) <= 60) {
            if (ar === 0) continue;
            const g = gcd(gcd(ar, b), d);
            const A = ar / g, B = b / g, D = d / g;
            const bs = (Math.abs(B) === 1 ? '' : Math.abs(B)) + '√' + c;
            let s = A + (B > 0 ? '+' : '-') + bs;
            if (D !== 1) s = '(' + s + ')/' + D;
            return s;
          }
        }
      }
    }
    return null;
  }

  /** 识别实数，必要时识别为 kπ */
  function recognize(x, opts) {
    opts = opts || {};
    const tol = opts.tol || 1e-8;
    const plain = recognizeReal(x, tol);
    if (plain && plain.length <= 6) return plain;
    if (opts.pi !== false) {
      const k = recognizeReal(x / Math.PI, tol);
      if (k && k !== '0') {
        if (k === '1') return 'π';
        if (k === '-1') return '-π';
        const m = k.match(/^(-?)([^/]*)\/(\d+)$/);
        if (m && !k.includes('(')) return m[1] + (m[2] === '1' ? '' : m[2]) + 'π/' + m[3];
        const kp = k.includes('(') || /[+]/.test(k) ? '(' + k + ')π' : k + 'π';
        if (!plain || kp.length < plain.length) return kp;
      }
    }
    return plain;
  }

  function fmtNum(x, digits) {
    if (!isFinite(x)) return '—';
    digits = digits == null ? 4 : digits;
    const s = x.toFixed(digits);
    return s.replace(/\.?0+$/, '').replace(/^-0$/, '0');
  }

  /** 角度（弧度）格式化 → { deg, text, exact } */
  function fmtAngle(rad, digits) {
    const deg = (rad * 180) / Math.PI;
    const degText = fmtNum(deg, digits == null ? 2 : digits) + '°';
    let exact = null;
    const dr = toFrac(deg, 12, 1e-7);
    if (dr && Math.abs(deg - Math.round(deg * 1000) / 1000) < 1e-7 && dr.q <= 4) {
      exact = null; // 已经是整齐角度，不需要三角形式
    } else {
      const c = recognizeReal(Math.cos(rad), 1e-8);
      const t = Math.abs(Math.cos(rad)) > 1e-9 ? recognizeReal(Math.tan(rad), 1e-8) : null;
      const s = recognizeReal(Math.sin(rad), 1e-8);
      const cands = [];
      if (c) cands.push('cos = ' + c);
      if (s) cands.push('sin = ' + s);
      if (t) cands.push('tan = ' + t);
      cands.sort((a, b) => a.length - b.length);
      exact = cands.length ? cands.slice(0, 2).join('，') : null;
    }
    return { deg, text: degText, exact };
  }

  SG.Exact = { gcd, toFrac, squareFree, recognize, recognizeReal, fmtNum, fmtAngle };
})(globalThis.SG = globalThis.SG || {});
