/*
 * 小型 DOM 工具：创建元素、提示、对话框、下载。
 */
(function (SG) {
  'use strict';

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k in el && k !== 'list' && k !== 'type') { try { el[k] = v; } catch (e) { el.setAttribute(k, v); } }
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function toast(msg, type, ms) {
    const box = document.getElementById('toast');
    const t = h('div', { class: 't ' + (type || '') }, msg);
    box.appendChild(t);
    setTimeout(() => t.remove(), ms || (type === 'err' ? 4200 : 2200));
  }

  /** 打开模态框。buttons: [{label, primary, value, onClick(close)}]，返回 Promise<value> */
  function modal(title, body, buttons) {
    return new Promise((resolve) => {
      const m = document.getElementById('modal');
      const box = m.querySelector('.modal-box');
      box.innerHTML = '';
      box.className = 'modal-box';
      const close = (v) => { m.classList.add('hidden'); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(null); }
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
          const p = (buttons || []).find((b) => b.primary);
          if (p) { e.preventDefault(); e.stopPropagation(); fire(p); }
        }
      };
      const fire = (b) => {
        if (b.onClick) { const r = b.onClick(close); if (r === false) return; if (r !== undefined) { close(r); return; } }
        close(b.value);
      };
      box.appendChild(h('h3', null, title));
      box.appendChild(body);
      const foot = h('div', { class: 'foot' });
      for (const b of buttons || [{ label: '关闭', value: null }]) foot.appendChild(h('button', { class: b.primary ? 'primary' : '', onclick: () => fire(b) }, b.label));
      box.appendChild(foot);
      m.classList.remove('hidden');
      m.onclick = (e) => { if (e.target === m) close(null); };
      document.addEventListener('keydown', onKey, true);
      const first = box.querySelector('input, select, textarea');
      if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 30);
    });
  }

  /** 表单对话框：fields [{key,label,value,type:'number'|'text'|'select'|'check', options, step, hint}] */
  function form(title, fields, okLabel, extra) {
    const inputs = {};
    const body = h('div');
    if (extra) body.appendChild(extra);
    for (const f of fields) {
      let inp;
      if (f.type === 'select') {
        inp = h('select', null, (f.options || []).map((o) => h('option', { value: o.value, selected: String(o.value) === String(f.value) }, o.label)));
      } else if (f.type === 'check') {
        inp = h('input', { type: 'checkbox', checked: !!f.value });
      } else if (f.type === 'textarea') {
        inp = h('textarea', { rows: 4, style: { flex: 1 } }, f.value || '');
      } else {
        inp = h('input', { type: f.type === 'number' ? 'number' : 'text', value: f.value == null ? '' : f.value, step: f.step || 'any' });
      }
      inputs[f.key] = inp;
      body.appendChild(h('div', { class: 'field' }, h('label', null, f.label), inp, f.unit ? h('span', { class: 'unit' }, f.unit) : null));
      if (f.hint) body.appendChild(h('div', { class: 'note', style: { marginLeft: '146px', marginTop: '-2px' } }, f.hint));
    }
    return modal(title, body, [
      { label: '取消', value: null },
      {
        label: okLabel || '确定', primary: true,
        onClick: () => {
          const out = {};
          for (const f of fields) {
            const el = inputs[f.key];
            if (f.type === 'check') out[f.key] = el.checked;
            else if (f.type === 'number') { const v = parseFloat(el.value); out[f.key] = isFinite(v) ? v : f.value; }
            else if (f.type === 'select') { const o = (f.options || []).find((x) => String(x.value) === el.value); out[f.key] = o ? o.value : el.value; }
            else out[f.key] = el.value;
          }
          return out;
        },
      },
    ]);
  }

  /** 是否运行在安卓 APK（Capacitor）中 */
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  /** APK 中：把文件写入手机缓存目录，再弹出系统的"分享 / 保存到"菜单 */
  async function nativeSave(name, blob) {
    const C = window.Capacitor;
    // 直接调用原生桥（APK 内置，不依赖 JS 插件包）
    const call = (plugin, method, opts) => (C.Plugins && C.Plugins[plugin] && C.Plugins[plugin][method] ? C.Plugins[plugin][method](opts) : C.nativePromise(plugin, method, opts));
    const Filesystem = { writeFile: (o) => call('Filesystem', 'writeFile', o) };
    const Share = { share: (o) => call('Share', 'share', o) };
    const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
    const r = await Filesystem.writeFile({ path: name, data, directory: 'CACHE' });
    await Share.share({ title: name, dialogTitle: '保存或分享 ' + name, url: r.uri });
  }
  function download(name, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/octet-stream' });
    if (isNative()) { nativeSave(name, blob).catch((e) => { if (!/cancel/i.test(e && e.message)) toast('保存失败：' + (e && e.message), 'err'); }); return; }
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /** 名称的 HTML 显示：A1 → A<sub>1</sub> */
  function nameHTML(name) {
    const parts = SG.Renderer.parseText(name || '');
    return parts.map((p) => (p.sub ? '<sub>' + esc(p.t) + '</sub>' : esc(p.t))).join('');
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 忽略 */ } },
  };

  SG.UI = { h, toast, modal, form, download, isNative, nameHTML, esc, LS };
})(globalThis.SG = globalThis.SG || {});
