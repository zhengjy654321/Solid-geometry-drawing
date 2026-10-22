/*
 * AI 助手面板 + 设置对话框。
 */
(function (SG) {
  'use strict';
  const { UI } = SG;
  const { h } = UI;

  const TIPS = [
    '取 PC 的中点 E，连接 BE、DE',
    '作出二面角 P-BC-A 的平面角',
    '过 AB 作一个与底面成 45° 的平面',
    '作出过 E、F、G 三点的截面',
  ];

  class AIPanel {
    constructor(app) {
      this.app = app;
      this.pane = document.getElementById('pane-ai');
      this.history = []; // {role, content}
      this.busy = null;
      this.build();
    }
    get cfg() { return this.app.settings.ai; }

    build() {
      const p = this.pane;
      p.innerHTML = '';
      const cfg = this.cfg;
      this.swThink = h('button', { class: cfg.think ? 'on' : '', onclick: () => this.setThink(true) }, '开启思考');
      this.swFast = h('button', { class: cfg.think ? '' : 'on', onclick: () => this.setThink(false) }, '关闭思考');
      this.modelLbl = h('span', { class: 'model' });
      p.appendChild(h('div', { class: 'ai-head' },
        h('div', { class: 'sw' }, this.swFast, this.swThink),
        this.modelLbl,
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn', title: '手动输入 / 粘贴作图指令', onclick: () => this.manual() }, '指令'),
        h('button', { class: 'btn', onclick: () => { this.history = []; this.log.innerHTML = ''; this.welcome(); } }, '清空')));
      this.log = h('div', { class: 'ai-log' });
      p.appendChild(this.log);
      p.appendChild(h('div', { class: 'ai-tips' }, TIPS.map((t) => h('button', { onclick: () => { this.input.value = t; this.input.focus(); } }, t))));
      this.input = h('textarea', { placeholder: '描述你想作的辅助线 / 辅助面 / 截面……\n例如：过 BD 作与底面 ABCD 成 60° 的平面（Ctrl+Enter 发送）' });
      this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.send(); } });
      this.sendBtn = h('button', { class: 'btn primary', onclick: () => this.send() }, '发送');
      p.appendChild(h('div', { class: 'ai-input' }, this.input, h('div', { class: 'row' },
        h('span', { class: 'grow' }, '会自动把当前图形（以及选中的对象）一并发送给 AI'), this.sendBtn)));
      this.updateModel();
      this.welcome();
    }
    welcome() {
      if (!this.cfg.apiKey) {
        this.sys(h('div', null, '使用 AI 辅助作图前，请先在 ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); openSettings(this.app, 'ai'); } }, '设置'), ' 中填写 API Key（默认使用 DeepSeek 接口）。API Key 只保存在你自己的浏览器里。'));
      } else this.sys('描述你需要的辅助作图，AI 会根据当前图形生成作图指令并自动画出来。不满意可以按 Ctrl+Z 撤销。');
    }
    setThink(v) {
      this.cfg.think = v;
      this.app.saveSettings();
      this.swThink.classList.toggle('on', v);
      this.swFast.classList.toggle('on', !v);
      this.updateModel();
    }
    updateModel() {
      const m = this.cfg.think ? this.cfg.modelThink : this.cfg.modelFast;
      this.modelLbl.textContent = '模型：' + (m || '未设置');
    }

    add(cls, ...kids) {
      const el = h('div', { class: 'msg ' + cls }, ...kids);
      this.log.appendChild(el);
      this.log.scrollTop = this.log.scrollHeight;
      return el;
    }
    sys(content) { return this.add('sys', content); }

    async send(text, isFix) {
      text = (text || this.input.value).trim();
      if (!text) return;
      if (this.busy) { this.busy.abort(); return; }
      const cfg = this.cfg;
      if (!cfg.apiKey) { this.welcome(); openSettings(this.app, 'ai'); return; }
      const model = cfg.think ? cfg.modelThink : cfg.modelFast;
      if (!model) { UI.toast('请先在设置中填写模型名称', 'err'); return; }
      if (!isFix) { this.input.value = ''; this.add('user', text); }
      const userMsg = SG.AIPrompt.buildUserMessage(this.app, text);
      const keep = Math.max(0, (cfg.history || 6) * 2);
      const messages = [{ role: 'system', content: SG.AIPrompt.SYSTEM_PROMPT }].concat(this.history.slice(-keep), [{ role: 'user', content: userMsg }]);
      const think = h('div', { class: 'think' });
      const det = h('details', { open: true }, h('summary', null, '思考过程'), think);
      const body = h('div', null, '…');
      const msg = this.add('ai', det, body);
      det.style.display = 'none';
      const ctrl = new AbortController();
      this.busy = ctrl;
      this.sendBtn.textContent = '停止';
      const t0 = Date.now();
      let res;
      try {
        res = await SG.AIClient.chat({
          baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model, provider: cfg.provider, think: cfg.think, messages, signal: ctrl.signal,
          onDelta: ({ content, reasoning }) => {
            if (reasoning) { det.style.display = ''; think.textContent = reasoning; think.scrollTop = think.scrollHeight; }
            body.textContent = content ? '正在生成作图指令…（' + content.length + ' 字）' : '思考中…（' + Math.round((Date.now() - t0) / 1000) + ' 秒）';
            this.log.scrollTop = this.log.scrollHeight;
          },
        });
      } catch (e) {
        this.busy = null;
        this.sendBtn.textContent = '发送';
        if (e.name === 'AbortError') { body.textContent = '已停止。'; return; }
        body.innerHTML = '';
        body.appendChild(h('span', { class: 'res-err' }, '请求失败：' + e.message));
        return;
      }
      this.busy = null;
      this.sendBtn.textContent = '发送';
      det.open = false;
      this.history.push({ role: 'user', content: isFix ? text : '（当时的图形已省略）\n' + text }, { role: 'assistant', content: res.content });
      this.handleReply(res.content, body, text);
      void msg;
    }

    handleReply(content, body, request) {
      body.innerHTML = '';
      let data;
      try { data = SG.AIPrompt.parseReply(content); }
      catch (e) {
        body.appendChild(h('div', { class: 'res-err' }, '无法解析 AI 的回复：' + e.message));
        body.appendChild(h('details', null, h('summary', null, '原始回复'), h('pre', null, content)));
        body.appendChild(h('div', { class: 'btnrow' }, h('button', { onclick: () => this.send('你上一次的回复不是合法的 JSON（' + e.message + '），请严格按照要求的 JSON 格式重新输出。原始要求：' + request, true) }, '让 AI 重新输出')));
        return;
      }
      if (data.message) body.appendChild(h('div', null, data.message));
      const cmds = data.commands || [];
      if (data.thought) body.appendChild(h('details', null, h('summary', null, '作图思路'), h('div', null, data.thought)));
      body.appendChild(h('details', null, h('summary', null, '作图指令（' + cmds.length + ' 条）'), h('pre', null, JSON.stringify(cmds, null, 1))));
      if (!cmds.length) return;
      try {
        const r = SG.AIPrompt.execute(this.app, cmds);
        body.appendChild(h('div', { class: 'res-ok' }, '✓ 已执行 ' + cmds.length + ' 条指令，新建 ' + r.created.length + ' 个对象。（Ctrl+Z 可撤销）'));
        const newPts = r.created.filter((id) => { const o = this.app.S.map.get(id); return o && (o.type === 'point' || o.type === 'plane' || o.type === 'sphere'); });
        if (newPts.length) this.app.select(newPts);
      } catch (e) {
        body.appendChild(h('div', { class: 'res-err' }, '✗ ' + e.message + '（已全部回滚）'));
        body.appendChild(h('div', { class: 'btnrow' }, h('button', {
          class: 'primary',
          onclick: () => this.send('你给出的指令执行出错：' + e.message + '\n请修正后重新给出完整的指令列表（当前图形见上方，之前的指令都没有执行）。原始要求：' + request, true),
        }, '把错误发给 AI 修正')));
      }
    }

    manual() {
      const ta = h('textarea', { rows: 12, style: { width: '100%', fontFamily: 'monospace', fontSize: '12px' }, placeholder: '[{"op":"midpoint","name":"M","a":"A","b":"B"}, {"op":"segment","a":"M","b":"C"}]' });
      const body = h('div', null, h('div', { class: 'note' }, '可以粘贴 AI 输出的 JSON（整个对象或 commands 数组）。指令格式见 docs/commands.md。'), ta);
      UI.modal('执行作图指令', body, [{ label: '取消', value: null }, {
        label: '执行', primary: true, onClick: () => {
          try {
            let d = JSON.parse(ta.value);
            if (!Array.isArray(d)) d = d.commands || [d];
            SG.AIPrompt.execute(this.app, d);
            UI.toast('已执行 ' + d.length + ' 条指令', 'ok');
            return true;
          } catch (e) { UI.toast(e.message, 'err', 6000); return false; }
        },
      }]);
    }
  }

  // ------------------------------------------------------------ 设置
  function openSettings(app, focus) {
    const s = app.settings;
    const ai = Object.assign({}, s.ai);
    const v = app.view;
    const prov = h('select', null, Object.entries(SG.PROVIDERS).map(([k, p]) => h('option', { value: k, selected: ai.provider === k }, p.label)));
    const base = h('input', { type: 'text', value: ai.baseUrl });
    const key = h('input', { type: 'password', value: ai.apiKey, placeholder: 'sk-...' });
    const mThink = h('input', { type: 'text', value: ai.modelThink });
    const mFast = h('input', { type: 'text', value: ai.modelFast });
    const hist = h('input', { type: 'number', value: ai.history, min: 0, max: 20 });
    prov.addEventListener('change', () => {
      const p = SG.PROVIDERS[prov.value];
      if (p.baseUrl) base.value = p.baseUrl;
      if (p.modelThink) mThink.value = p.modelThink;
      if (p.modelFast) mFast.value = p.modelFast;
    });
    const showKey = h('button', { class: 'btn', onclick: () => { key.type = key.type === 'password' ? 'text' : 'password'; } }, '👁');
    const testRes = h('span', { class: 'note' });
    const test = h('button', {
      class: 'btn', onclick: async () => {
        testRes.textContent = '测试中…';
        try {
          const r = await SG.AIClient.chat({ baseUrl: base.value, apiKey: key.value.trim(), model: mFast.value, provider: prov.value, messages: [{ role: 'user', content: '只回复两个字：成功' }] });
          testRes.textContent = '✓ 连接成功：' + r.content.slice(0, 20);
        } catch (e) { testRes.textContent = '✗ ' + e.message; }
      },
    }, '测试连接');
    const fsz = h('input', { type: 'number', value: v.fontSize, min: 10, max: 30 });
    const lsc = h('input', { type: 'number', value: v.lineScale, min: 0.5, max: 3, step: 0.1 });
    const hid = h('select', null, [['dashed', '画成虚线（教材画法）'], ['hide', '不画'], ['solid', '画成实线']].map(([k, l]) => h('option', { value: k, selected: v.hiddenMode === k }, l)));
    const snap = h('input', { type: 'checkbox', checked: v.snapGrid });
    const snapStep = h('input', { type: 'number', value: v.snapStep, min: 0.05, step: 0.05 });
    const gridStep = h('input', { type: 'number', value: v.gridStep, min: 0.1, step: 0.1 });
    const labelNew = h('input', { type: 'checkbox', checked: v.labelNew });
    const dots = h('input', { type: 'checkbox', checked: v.showDots !== false });
    const f = (label, ...kids) => h('div', { class: 'field' }, h('label', null, label), ...kids);
    const body = h('div', null,
      h('h4', { style: { margin: '6px 0' } }, 'AI 辅助作图'),
      f('接口', prov), f('接口地址', base), f('API Key', key, showKey),
      f('思考模型', mThink), f('非思考模型', mFast), f('记忆轮数', hist),
      h('div', { class: 'note' }, 'DeepSeek：思考模式默认 deepseek-reasoner，非思考模式默认 deepseek-chat。OpenAI 及其他兼容接口可自行修改地址与模型。API Key 仅保存在本机浏览器（localStorage）中，直接从浏览器发送到你选择的接口。'),
      h('div', { class: 'btnrow' }, test, testRes),
      h('h4', { style: { margin: '14px 0 6px' } }, '显示与绘图'),
      f('标签字号', fsz), f('线宽倍数', lsc), f('被遮挡的线', hid),
      f('吸附网格', snap, h('span', { class: 'note' }, '步长'), snapStep),
      f('网格间距', gridStep), f('新建点显示标签', labelNew), f('显示顶点圆点', dots));
    UI.modal('设置', body, [{ label: '取消', value: null }, {
      label: '保存', primary: true, onClick: () => {
        Object.assign(s.ai, { provider: prov.value, baseUrl: base.value.trim(), apiKey: key.value.trim(), modelThink: mThink.value.trim(), modelFast: mFast.value.trim(), history: +hist.value || 0 });
        Object.assign(v, { fontSize: +fsz.value || 17, lineScale: +lsc.value || 1, hiddenMode: hid.value, snapGrid: snap.checked, snapStep: +snapStep.value || 0.5, gridStep: +gridStep.value || 1, labelNew: labelNew.checked, showDots: dots.checked });
        app.saveSettings();
        app.render();
        app.emit('settings');
        UI.toast('设置已保存', 'ok');
        return true;
      },
    }]);
    if (focus === 'ai') setTimeout(() => key.focus(), 60);
  }

  SG.AIPanel = AIPanel;
  SG.openSettings = openSettings;
})(globalThis.SG = globalThis.SG || {});
