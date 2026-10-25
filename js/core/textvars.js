/*
 * 文字中的变量：文字里用 {…} 插入会随图形实时变化的数值。
 *   {len:A,B}        线段 AB 的长度
 *   {ang:A,B,C}      ∠ABC（度，自动带 °）
 *   {x:A} {y:A} {z:A} 点的坐标分量；{坐标:A} 点的坐标 (x, y, z)
 *   {度量:∠ABC}      已有度量（按度量的名称）
 *   {参数:M.t}       对象参数的当前值（如动点 M 的位置 t、翻折角）
 *   {面积:ABC}       多边形 / 三点面积，也可写圆、截面圆的 id（圆面积）；{体积:ABCD-A1B1C1D1} 立体体积
 * 格式：在末尾加 |e 表示精确值（如 √6/3），|d3 表示保留 3 位小数；默认能识别为简洁精确值时显示精确值，否则保留 2 位小数。
 */
(function (SG) {
  'use strict';
  const { V } = SG;

  function fmtNum(x, f, deg) {
    if (!isFinite(x)) return '?';
    let s;
    if (f && /^d\d$/.test(f)) s = SG.Exact.fmtNum(x, +f[1]);
    else if (deg) s = SG.Exact.fmtNum(x, f === 'e' ? 6 : 2);
    else {
      const e = SG.Exact.recognize(x);
      const d = SG.Exact.fmtNum(x, 2);
      s = f === 'e' ? e || SG.Exact.fmtNum(x, 4) : e && e.length <= 8 ? e : d;
    }
    return s + (deg ? '°' : '');
  }

  function pt(S, name) {
    const o = S.byName(String(name).trim());
    if (!o || o.type !== 'point' || !o.v) throw new Error('无点 ' + name);
    return o.v;
  }

  function evalToken(S, tok) {
    let [body, f] = tok.split('|');
    const i = body.indexOf(':');
    if (i < 0) throw new Error('格式错误');
    const type = body.slice(0, i).trim(), arg = body.slice(i + 1).trim();
    const names = () => (arg.includes(',') || arg.includes('，') ? arg.split(/[,，]/) : SG.splitNames(arg)).map((s) => s.trim()).filter(Boolean);
    switch (type) {
      case 'len': case '长度': { const [a, b] = names(); return fmtNum(V.dist(pt(S, a), pt(S, b)), f); }
      case 'ang': case '角': {
        const [a, o, b] = names();
        const O = pt(S, o);
        return fmtNum((V.angle(V.sub(pt(S, a), O), V.sub(pt(S, b), O)) * 180) / Math.PI, f, true);
      }
      case 'x': return fmtNum(pt(S, arg)[0], f);
      case 'y': return fmtNum(pt(S, arg)[1], f);
      case 'z': return fmtNum(pt(S, arg)[2], f);
      case '坐标': return '(' + pt(S, arg).map((v) => fmtNum(v, f)).join(', ') + ')';
      case '度量': {
        // 按度量的名称、显示名或 id 查找
        const m = S.objects.find((o) => o.type === 'measure' && (o.id === arg || o.name === arg || S.displayName(o) === arg));
        if (!m || !m.v) throw new Error('无度量');
        if (m.v.unit === 'angle') return fmtNum((m.v.value * 180) / Math.PI, f, true);
        return fmtNum(m.v.value, f);
      }
      case '参数': {
        const k = arg.lastIndexOf('.');
        const o = S.get(arg.slice(0, k));
        if (!o) throw new Error('无对象');
        const p = S.params(o).find((x) => x.key.join('.') === arg.slice(k + 1) || x.key[x.key.length - 1] === arg.slice(k + 1));
        if (!p) throw new Error('无参数');
        return fmtNum(S.getParam(o, p), f, p.unit === '°');
      }
      case '面积': {
        const a = arg.replace(/^[S△⊙\s]+/, '');
        const o = S.get(a) || S.map.get(a);
        if (o && o.type === 'polygon' && o.v) return fmtNum(SG.G.polyArea(o.v.pts), f);
        if (o && o.type === 'circle' && o.v) return fmtNum(Math.PI * o.v.r * o.v.r, f);
        if (o && o.type === 'sphere' && o.v) return fmtNum(4 * Math.PI * o.v.r * o.v.r, f);
        if (o && o.type === 'measure' && o.v) return fmtNum(o.v.value, f);
        const ns = (a.includes(',') || a.includes('，') ? a.split(/[,，]/) : SG.splitNames(a)).map((x) => x.trim()).filter(Boolean);
        return fmtNum(SG.G.polyArea(ns.map((n) => pt(S, n))), f);
      }
      case '体积': {
        const o = S.get(arg);
        const sid = o && (o.type === 'solid' ? o.id : o.parent);
        return fmtNum(SG.Kinds.mVolume.eval({ solid: sid }, S.ctx).value, f);
      }
      default: throw new Error('未知变量');
    }
  }

  /** 替换文字中的全部变量 */
  function render(S, text) {
    return String(text == null ? '' : text).replace(/\{([^{}]+)\}/g, (m, tok) => {
      try { return evalToken(S, tok); } catch (e) { return '{?}'; }
    });
  }

  /** 可插入的变量列表（供"插入变量"对话框使用） */
  function catalog(S) {
    const out = [];
    for (const o of S.objects) {
      if (o.type === 'measure' && !o.err) out.push({ group: '度量', label: S.displayName(o), token: '{度量:' + S.displayName(o) + '}' });
      if (o.type === 'circle' && o.v) out.push({ group: '面积', label: S.displayName(o) + ' 的面积', token: '{面积:' + o.id + '}' });
    }
    for (const o of S.objects) {
      if (o.type === 'point' && o.name && !o.hidden) out.push({ group: '点的坐标', label: o.name + ' 的坐标', token: '{坐标:' + o.name + '}' });
    }
    for (const o of S.objects) {
      if (o.hidden || !o.name && o.type === 'point') continue;
      const k = SG.Kinds[o.def.kind];
      if (!k || !(k.draggable || o.type === 'fold' || o.type === 'solid')) continue;
      for (const p of S.params(o)) {
        if (typeof S.getParam(o, p) !== 'number' || p.options) continue;
        out.push({ group: '参数', label: S.displayName(o) + ' · ' + p.label, token: '{参数:' + (o.name || o.id) + '.' + p.key.join('.') + '}' });
      }
    }
    return out;
  }

  SG.TextVars = { render, evalToken, catalog, fmtNum };
})(globalThis.SG = globalThis.SG || {});
