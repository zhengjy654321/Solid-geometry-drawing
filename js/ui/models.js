/*
 * 模型下拉选择：DeepSeek 时可直接选 Flash / Pro；其他接口列出设置中的模型；最后一项"自定义…"可手动输入。
 */
(function (SG) {
  'use strict';
  const { UI } = SG;
  const { h } = UI;

  const DS = [
    ['deepseek-flash', 'Flash（快、便宜，支持看图）'],
    ['deepseek-v4-pro', 'Pro（更强，更贵）'],
  ];

  /**
   * opts: { provider: () => 'deepseek'|..., known: () => [模型名], flashOnly: bool, onChange }
   * 返回 { el, get(), set(v), setFlashOnly(b) }
   */
  function select(value, opts) {
    opts = opts || {};
    const sel = h('select', { class: 'model-sel' });
    const inp = h('input', { type: 'text', class: 'model-custom', placeholder: '模型名称' });
    const el = h('span', { class: 'model-pick' }, sel, inp);
    let flashOnly = !!opts.flashOnly;
    let cur = value || '';
    const provider = () => (opts.provider ? opts.provider() : 'deepseek');
    const build = () => {
      const list = provider() === 'deepseek'
        ? DS.filter(([v]) => !flashOnly || v === 'deepseek-flash')
        : Array.from(new Set(((opts.known && opts.known()) || []).filter(Boolean))).map((m) => [m, m]);
      sel.innerHTML = '';
      for (const [v, l] of list) sel.appendChild(h('option', { value: v }, l));
      if (!(provider() === 'deepseek' && flashOnly)) sel.appendChild(h('option', { value: '__custom' }, '自定义…'));
      if (list.some(([v]) => v === cur)) { sel.value = cur; inp.style.display = 'none'; }
      else if (flashOnly && provider() === 'deepseek') { sel.value = 'deepseek-flash'; cur = 'deepseek-flash'; inp.style.display = 'none'; }
      else { sel.value = '__custom'; inp.value = cur; inp.style.display = ''; }
    };
    sel.addEventListener('change', () => {
      if (sel.value === '__custom') { inp.style.display = ''; inp.value = cur; inp.focus(); }
      else { inp.style.display = 'none'; cur = sel.value; }
      if (opts.onChange) opts.onChange();
    });
    inp.addEventListener('input', () => { cur = inp.value.trim(); if (opts.onChange) opts.onChange(); });
    build();
    return {
      el,
      get: () => (sel.value === '__custom' ? inp.value.trim() : sel.value),
      set: (v) => { cur = v || ''; build(); },
      setFlashOnly: (b) => { flashOnly = !!b; cur = flashOnly ? 'deepseek-flash' : cur; build(); },
      rebuild: build,
    };
  }

  const EFFORTS = [['low', '低'], ['high', '高'], ['max', '最高']];
  /** 思考强度下拉：返回 select 元素（value 为 low / high / max） */
  function effortSelect(value, onChange, prefix) {
    const sel = h('select', { class: 'effort-sel', title: '思考强度：越高想得越久、越仔细，也更慢、更贵' },
      EFFORTS.map(([v, l]) => h('option', { value: v, selected: (value || 'high') === v }, (prefix == null ? '思考强度：' : prefix) + l)));
    if (onChange) sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  /** 设置中的已知模型 */
  function known(app) {
    const ai = app.settings.ai;
    const p = ai.problem || {};
    return [ai.modelFast, ai.modelThink, p.rec && p.rec.model, p.gen && p.gen.model, p.check && p.check.model];
  }

  SG.ModelUI = { select, known, effortSelect, DS };
})(globalThis.SG = globalThis.SG || {});
