/*
 * 绘制后端：把显示列表画到 Canvas，或导出为 SVG 矢量图。
 */
(function (SG) {
  'use strict';

  const FONT_ITALIC = '"Times New Roman", "Cambria Math", "STIX Two Text", serif';
  const FONT_UI = '"Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

  function hexToRgb(h) {
    h = String(h || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(h, t, target) {
    const c = hexToRgb(h);
    const T = target === 'white' ? [255, 255, 255] : [0, 0, 0];
    return 'rgb(' + c.map((x, i) => Math.round(x + (T[i] - x) * t)).join(',') + ')';
  }
  function font(it, sub) {
    const size = it.size * (sub ? 0.66 : 1);
    return (it.italic ? 'italic ' : '') + (it.bold ? 'bold ' : '') + size.toFixed(1) + 'px ' + (it.italic ? FONT_ITALIC : FONT_UI);
  }

  function sphereStops(color) {
    return [[0, mix(color, 0.85, 'white')], [0.35, mix(color, 0.35, 'white')], [0.8, color], [1, mix(color, 0.35, 'black')]];
  }

  // ------------------------------------------------------------ Canvas
  function drawItem(ctx, it, hits) {
    switch (it.k) {
      case 'path': {
        if (it.pts.length < 2) return;
        ctx.save();
        ctx.globalAlpha = it.alpha == null ? 1 : it.alpha;
        ctx.strokeStyle = it.color;
        ctx.lineWidth = it.width;
        ctx.setLineDash(it.dash || []);
        ctx.beginPath();
        ctx.moveTo(it.pts[0][0], it.pts[0][1]);
        for (let i = 1; i < it.pts.length; i++) ctx.lineTo(it.pts[i][0], it.pts[i][1]);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'poly': {
        ctx.save();
        ctx.globalAlpha = it.alpha == null ? 1 : it.alpha;
        ctx.fillStyle = it.fill;
        ctx.beginPath();
        it.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'sphere': {
        ctx.save();
        ctx.globalAlpha = it.alpha;
        ctx.beginPath();
        it.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        const g = ctx.createRadialGradient(it.cx - it.r * 0.38, it.cy - it.r * 0.42, it.r * 0.04, it.cx, it.cy, it.r * 1.02);
        for (const [o, c] of sphereStops(it.color)) g.addColorStop(o, c);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'dot': {
        ctx.save();
        ctx.beginPath();
        ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2);
        if (it.fill) { ctx.fillStyle = it.fill; ctx.fill(); }
        if (it.stroke) { ctx.strokeStyle = it.stroke; ctx.lineWidth = it.sw || 1; ctx.stroke(); }
        ctx.restore();
        break;
      }
      case 'text': {
        ctx.save();
        ctx.textBaseline = 'middle';
        let w = 0;
        const ws = it.parts.map((p) => { ctx.font = font(it, p.sub); const m = ctx.measureText(p.t).width; w += m; return m; });
        let x = it.align === 'center' ? it.x - w / 2 : it.align === 'right' ? it.x - w : it.x;
        const y = it.y;
        if (it.bg) {
          ctx.fillStyle = it.bg;
          ctx.fillRect(x - 3, y - it.size * 0.62, w + 6, it.size * 1.3);
        }
        ctx.fillStyle = it.color;
        it.parts.forEach((p, i) => {
          ctx.font = font(it, p.sub);
          ctx.fillText(p.t, x, p.sub ? y + it.size * 0.3 : y);
          x += ws[i];
        });
        if (hits && it.id) hits.labels.push({ id: it.id, x: (it.align === 'center' ? it.x - w / 2 : it.x) - 3, y: y - it.size * 0.6, w: w + 6, h: it.size * 1.25, label: it.label });
        ctx.restore();
        break;
      }
    }
  }

  function draw(ctx, dl, opts) {
    opts = opts || {};
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (dl.hits) dl.hits.labels = [];
    for (const layer of ['bg', 'fills', 'lines', 'marks', 'points', 'labels', 'over']) {
      for (const it of dl[layer]) drawItem(ctx, it, layer === 'labels' ? dl.hits : null);
    }
  }

  /** 显示列表内容的包围盒 */
  function contentBox(dl) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    for (const layer of ['bg', 'fills', 'lines', 'marks', 'points', 'labels']) {
      for (const it of dl[layer]) {
        if (it.pts) it.pts.forEach((p) => add(p[0], p[1]));
        if (it.k === 'dot') { add(it.x - it.r, it.y - it.r); add(it.x + it.r, it.y + it.r); }
        if (it.k === 'text') {
          const w = it.parts.reduce((s, p) => s + p.t.length * it.size * 0.6, 0);
          const xs = it.align === 'center' ? it.x - w / 2 : it.x;
          add(xs, it.y - it.size); add(xs + w, it.y + it.size);
        }
      }
    }
    if (!isFinite(x0)) return { x: 0, y: 0, w: 100, h: 100 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // ------------------------------------------------------------ SVG
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const f2 = (x) => (Math.round(x * 100) / 100).toString();

  function toSVG(dl, box, bg) {
    const out = [];
    const defs = [];
    let gid = 0;
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f2(box.w)}" height="${f2(box.h)}" viewBox="${f2(box.x)} ${f2(box.y)} ${f2(box.w)} ${f2(box.h)}">`);
    if (bg) out.push(`<rect x="${f2(box.x)}" y="${f2(box.y)}" width="${f2(box.w)}" height="${f2(box.h)}" fill="${bg}"/>`);
    const ptsAttr = (pts) => pts.map((p) => f2(p[0]) + ',' + f2(p[1])).join(' ');
    for (const layer of ['bg', 'fills', 'lines', 'marks', 'points', 'labels']) {
      for (const it of dl[layer]) {
        const a = it.alpha == null ? 1 : it.alpha;
        if (it.k === 'path') {
          out.push(`<polyline points="${ptsAttr(it.pts)}" fill="none" stroke="${it.color}" stroke-width="${f2(it.width)}" stroke-linecap="round" stroke-linejoin="round"${it.dash ? ` stroke-dasharray="${it.dash.map(f2).join(' ')}"` : ''}${a < 1 ? ` stroke-opacity="${a}"` : ''}/>`);
        } else if (it.k === 'poly') {
          out.push(`<polygon points="${ptsAttr(it.pts)}" fill="${it.fill}" fill-opacity="${a}" stroke="none"/>`);
        } else if (it.k === 'sphere') {
          const id = 'sg' + gid++;
          defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f2(it.cx)}" cy="${f2(it.cy)}" r="${f2(it.r * 1.02)}" fx="${f2(it.cx - it.r * 0.38)}" fy="${f2(it.cy - it.r * 0.42)}">` +
            sphereStops(it.color).map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('') + '</radialGradient>');
          out.push(`<polygon points="${ptsAttr(it.pts)}" fill="url(#${id})" fill-opacity="${a}"/>`);
        } else if (it.k === 'dot') {
          out.push(`<circle cx="${f2(it.x)}" cy="${f2(it.y)}" r="${f2(it.r)}" fill="${it.fill || 'none'}"${it.stroke ? ` stroke="${it.stroke}" stroke-width="${it.sw || 1}"` : ''}/>`);
        } else if (it.k === 'text') {
          const anchor = it.align === 'center' ? 'middle' : it.align === 'right' ? 'end' : 'start';
          const fam = it.italic ? FONT_ITALIC : FONT_UI;
          const spans = it.parts.map((p) => (p.sub ? `<tspan font-size="${f2(it.size * 0.66)}" dy="${f2(it.size * 0.3)}">${esc(p.t)}</tspan><tspan dy="${f2(-it.size * 0.3)}"></tspan>` : `<tspan>${esc(p.t)}</tspan>`)).join('');
          out.push(`<text x="${f2(it.x)}" y="${f2(it.y)}" dominant-baseline="middle" text-anchor="${anchor}" font-family='${fam}' font-size="${f2(it.size)}"${it.italic ? ' font-style="italic"' : ''} fill="${it.color}">${spans}</text>`);
        }
      }
    }
    out.push('</svg>');
    if (defs.length) out.splice(1, 0, '<defs>' + defs.join('') + '</defs>');
    return out.join('\n');
  }

  SG.Backend = { draw, toSVG, contentBox, mix };
})(globalThis.SG = globalThis.SG || {});
