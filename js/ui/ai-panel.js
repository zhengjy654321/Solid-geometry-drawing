/*
 * AI 助手面板（作图 / 对话模式、对话记录）+ 设置对话框。
 */
(function (SG) {
  'use strict';
  const { UI } = SG;
  const { h } = UI;

  const TIPS = {
    draw: [
      '取 PC 的中点 E，连接 BE、DE',
      '作出二面角 P-BC-A 的平面角',
      '作出过 E、F、G 三点的截面',
      '做一个滑动条，控制 E 在 PC 上的位置',
    ],
    chat: [
      '这道题的思路是什么？',
      '当前图中 AC1 与平面 A1BD 有什么关系？',
      '二面角的平面角一般怎么找？',
      '帮我检查一下这个截面画得对不对',
    ],
  };
  const MAX_CHATS = 40;
  let seq = 0;
  const newId = () => 'chat' + Date.now().toString(36) + (seq++);

  /**
   * AI 助手面板。
   * 作图模式：AI 输出作图指令（以及可选的控件），程序执行；对话模式：只交流，AI 能看到当前图形，但不作图。
   * 对话记录保存在本机浏览器（localStorage 的 sg.chats）。
   */
  class AIPanel {
    constructor(app) {
      this.app = app;
      this.pane = document.getElementById('pane-ai');
      this.busy = null;
      this.showList = false;
      const st = UI.LS.get('sg.chats', null) || {};
      this.chats = Array.isArray(st.list) ? st.list : [];
      this.curId = st.cur && this.chats.some((c) => c.id === st.cur) ? st.cur : null;
      this.build();
      app.on('problem', () => this.syncProblem());
    }
    get cfg() { return this.app.settings.ai; }
    get chat() { return this.chats.find((c) => c.id === this.curId) || null; }
    get mode() { return this.cfg.mode === 'chat' ? 'chat' : 'draw'; }

    saveChats() {
      // 只保留最近的记录，避免超出浏览器存储上限
      this.chats.sort((a, b) => b.time - a.time);
      this.chats = this.chats.slice(0, MAX_CHATS);
      for (const c of this.chats) { c.items = c.items.slice(-200); c.hist = c.hist.slice(-60); }
      UI.LS.set('sg.chats', { cur: this.curId, list: this.chats });
    }
    ensureChat() {
      let c = this.chat;
      if (!c) {
        c = { id: newId(), title: '', time: Date.now(), items: [], hist: [] };
        this.chats.unshift(c);
        this.curId = c.id;
      }
      return c;
    }

    // ---------------------------------------------------------- 界面
    build() {
      const p = this.pane;
      p.innerHTML = '';
      const cfg = this.cfg;
      const seg = (opts, cur, onPick) => {
        const btns = opts.map(([v, l, tip]) => { const b = h('button', { class: v === cur ? 'on' : '', title: tip || '', onclick: () => { for (const x of btns) x.classList.toggle('on', x === b); onPick(v); } }, l); b.dataset.v = v; return b; });
        return h('div', { class: 'sw' }, btns);
      };
      this.swMode = seg([['draw', '作图', 'AI 根据你的要求在图中作图'], ['chat', '对话', '只和 AI 交流，AI 能看到当前图形，但不会作图']], this.mode, (v) => this.setMode(v));
      this.swThink = seg([['0', '关闭思考'], ['1', '开启思考']], cfg.think ? '1' : '0', (v) => this.setThink(v === '1'));
      this.modelSel = SG.ModelUI.select(cfg.think ? cfg.modelThink : cfg.modelFast, {
        provider: () => this.cfg.provider,
        known: () => SG.ModelUI.known(this.app),
        onChange: () => {
          const m = this.modelSel.get();
          if (!m) return;
          if (this.cfg.think) this.cfg.modelThink = m; else this.cfg.modelFast = m;
          this.app.saveSettings();
        },
      });
      this.effSel = SG.ModelUI.effortSelect(cfg.effort, (v) => { this.cfg.effort = v; this.app.saveSettings(); });
      this.btnList = h('button', { class: 'btn', title: '对话记录', onclick: () => this.toggleList() }, '记录');
      this.btnCmd = h('button', { class: 'btn', title: '手动输入 / 粘贴作图指令', onclick: () => this.manual() }, '指令');
      p.appendChild(h('div', { class: 'ai-head' },
        this.swMode, this.swThink,
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn', title: '开启新对话（当前对话会保存在记录中）', onclick: () => this.newChat() }, '新对话'),
        this.btnList, this.btnCmd,
        h('div', { class: 'ai-model' }, h('span', null, '模型'), this.modelSel.el, this.effSel)));
      this.log = h('div', { class: 'ai-log' });
      this.list = h('div', { class: 'ai-list', style: { display: 'none' } });
      p.appendChild(this.log);
      p.appendChild(this.list);
      this.tips = h('div', { class: 'ai-tips' });
      p.appendChild(this.tips);
      this.input = h('textarea');
      this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.send(); } });
      this.sendBtn = h('button', { class: 'btn primary', onclick: () => this.send() }, '发送');
      this.chkProblem = h('input', { type: 'checkbox', checked: cfg.attachProblem !== false });
      this.chkProblem.addEventListener('change', () => { this.cfg.attachProblem = this.chkProblem.checked; this.app.saveSettings(); });
      this.problemLbl = h('label', { class: 'ai-chk', title: '把当前题目（题目信息与控制面板）一并发送给 AI' }, this.chkProblem, h('span', null, '附带当前题目'));
      this.hint = h('span', { class: 'grow' });
      p.appendChild(h('div', { class: 'ai-input' }, this.input, h('div', { class: 'row' }, this.problemLbl, this.hint, this.sendBtn)));
      this.updateModel();
      this.syncMode();
      this.syncProblem();
      this.renderLog();
    }
    syncMode() {
      const chat = this.mode === 'chat';
      this.input.placeholder = chat
        ? '和 AI 讨论这道题或当前图形……\n例如：为什么 AC1 ⊥ 平面 A1BD？（Ctrl+Enter 发送）'
        : '描述你想作的辅助线 / 辅助面 / 截面 / 控件……\n例如：过 BD 作与底面 ABCD 成 60° 的平面（Ctrl+Enter 发送）';
      this.hint.textContent = chat ? '对话模式：AI 能看到当前图形，但不会作图' : '会把当前图形（以及选中的对象）一并发送给 AI';
      this.btnCmd.style.display = chat ? 'none' : '';
      this.pane.classList.toggle('chat-mode', chat);
      this.tips.innerHTML = '';
      for (const t of TIPS[this.mode]) this.tips.appendChild(h('button', { onclick: () => { this.input.value = t; this.input.focus(); } }, t));
    }
    syncProblem() {
      const has = !!(this.app.problem && this.app.problem.info);
      this.chkProblem.disabled = !has;
      this.problemLbl.classList.toggle('off', !has);
      this.problemLbl.title = has ? '把当前题目（题目信息与控制面板）一并发送给 AI' : '当前没有题目（可在"新建 → 从题目新建"中创建）';
    }
    setMode(v) {
      this.cfg.mode = v;
      this.app.saveSettings();
      this.syncMode();
    }
    setThink(v) {
      this.cfg.think = v;
      this.app.saveSettings();
      this.updateModel();
    }
    /** 设置变化后刷新模型选择 */
    updateModel() {
      const cfg = this.cfg;
      this.modelSel.set(cfg.think ? cfg.modelThink : cfg.modelFast);
      for (const b of this.swThink.children) b.classList.toggle('on', b.dataset.v === (cfg.think ? '1' : '0'));
      this.effSel.value = cfg.effort || 'high';
      this.effSel.disabled = !cfg.think;
      this.effSel.title = cfg.think ? '思考强度：越高想得越久、越仔细，也更慢、更贵' : '开启思考后才能选择思考强度';
    }

    add(cls, ...kids) {
      const el = h('div', { class: 'msg ' + cls }, ...kids);
      this.log.appendChild(el);
      this.log.scrollTop = this.log.scrollHeight;
      return el;
    }
    sys(content) { return this.add('sys', content); }
    welcome() {
      if (!this.cfg.apiKey) {
        this.sys(h('div', null, '使用 AI 助手前，请先在 ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); openSettings(this.app, 'ai'); } }, '设置'), ' 中填写 API Key（默认使用 DeepSeek 接口）。API Key 只保存在你自己的浏览器里。'));
      } else {
        this.sys('作图模式：描述你需要的辅助作图或控件，AI 会生成指令并自动画出来（Ctrl+Z 可撤销）。\n对话模式：和 AI 讨论题目，AI 能看到当前图形，但不会作图。');
      }
    }

    /** 重新显示当前对话 */
    renderLog() {
      this.log.innerHTML = '';
      const c = this.chat;
      if (!c || !c.items.length) { this.welcome(); return; }
      for (const it of c.items) {
        if (it.k === 'user') this.add('user', it.text);
        else if (it.k === 'ai') { const body = h('div'); this.add('ai', body); this.renderAI(it, body); }
        else this.sys(it.text);
      }
    }
    /** AI 回复的显示（实时与重新打开记录时共用）；fix 为"让 AI 修正"的回调（仅实时） */
    renderAI(it, body, fix) {
      body.innerHTML = '';
      if (it.think) body.appendChild(h('details', null, h('summary', null, '思考过程'), h('div', { class: 'think' }, it.think)));
      if (it.mode === 'chat') { body.appendChild(h('div', { class: 'chat-text' }, it.text || '')); return; }
      if (it.parseErr) {
        body.appendChild(h('div', { class: 'res-err' }, '无法解析 AI 的回复：' + it.parseErr));
        body.appendChild(h('details', null, h('summary', null, '原始回复'), h('pre', null, it.raw || '')));
        if (fix) body.appendChild(h('div', { class: 'btnrow' }, h('button', { onclick: () => fix('你上一次的回复不是合法的 JSON（' + it.parseErr + '），请严格按照要求的 JSON 格式重新输出。') }, '让 AI 重新输出')));
        return;
      }
      if (it.text) body.appendChild(h('div', null, it.text));
      if (it.thought) body.appendChild(h('details', null, h('summary', null, '作图思路'), h('div', null, it.thought)));
      const cmds = it.cmds || [];
      if (cmds.length) body.appendChild(h('details', null, h('summary', null, '作图指令（' + cmds.length + ' 条）'), h('pre', null, JSON.stringify(cmds, null, 1))));
      if (it.ctls && it.ctls.length) body.appendChild(h('details', null, h('summary', null, '控件（' + it.ctls.length + ' 个）'), h('pre', null, JSON.stringify(it.ctls, null, 1))));
      if (it.ok) body.appendChild(h('div', { class: 'res-ok' }, it.ok));
      if (it.ctlOk) {
        body.appendChild(h('div', { class: 'res-ok' }, it.ctlOk, ' ',
          h('a', { href: '#', onclick: (e) => { e.preventDefault(); this.app.emit('openTab', 'controls'); } }, '查看')));
      }
      if (it.err) {
        body.appendChild(h('div', { class: 'res-err' }, '✗ ' + it.err + '（已全部回滚）'));
        if (fix) body.appendChild(h('div', { class: 'btnrow' }, h('button', { class: 'primary', onclick: () => fix('你给出的指令执行出错：' + it.err + '\n请修正后重新给出完整的指令列表（当前图形见上方，之前的指令都没有执行）。') }, '把错误发给 AI 修正')));
      }
    }

    // ---------------------------------------------------------- 对话记录
    newChat() {
      if (this.busy) this.busy.abort();
      const c = this.chat;
      if (c && !c.items.length) this.chats = this.chats.filter((x) => x !== c);
      this.curId = null;
      this.saveChats();
      this.closeList();
      this.renderLog();
      this.input.focus();
    }
    openChat(id) {
      if (this.busy) this.busy.abort();
      this.curId = id;
      this.saveChats();
      this.closeList();
      this.renderLog();
    }
    deleteChat(id) {
      this.chats = this.chats.filter((c) => c.id !== id);
      if (this.curId === id) { if (this.busy) this.busy.abort(); this.curId = null; this.renderLog(); }
      this.saveChats();
      this.renderList();
    }
    async clearChats() {
      const ok = await UI.modal('清空对话记录', h('div', null, '确定删除全部 ' + this.chats.length + ' 条对话记录吗？此操作不能撤销。'), [{ label: '取消', value: false }, { label: '全部删除', primary: true, value: true }]);
      if (!ok) return;
      if (this.busy) this.busy.abort();
      this.chats = [];
      this.curId = null;
      this.saveChats();
      this.renderList();
      this.renderLog();
    }
    toggleList() { if (this.showList) this.closeList(); else this.openList(); }
    openList() {
      this.showList = true;
      this.btnList.classList.add('on');
      this.log.style.display = 'none';
      this.list.style.display = '';
      this.renderList();
    }
    closeList() {
      this.showList = false;
      this.btnList.classList.remove('on');
      this.log.style.display = '';
      this.list.style.display = 'none';
    }
    renderList() {
      const L = this.list;
      L.innerHTML = '';
      const list = this.chats.filter((c) => c.items.length).sort((a, b) => b.time - a.time);
      L.appendChild(h('div', { class: 'ai-list-head' }, h('b', null, '对话记录（' + list.length + '）'), h('span', { style: { flex: 1 } }),
        list.length ? h('button', { class: 'btn danger', onclick: () => this.clearChats() }, '清空全部') : null,
        h('button', { class: 'btn', onclick: () => this.closeList() }, '返回')));
      if (!list.length) { L.appendChild(h('div', { class: 'empty' }, '还没有对话记录')); return; }
      const fmt = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
      for (const c of list) {
        const n = c.items.filter((x) => x.k === 'user').length;
        L.appendChild(h('div', { class: 'ai-chat' + (c.id === this.curId ? ' cur' : ''), onclick: () => this.openChat(c.id) },
          h('div', { class: 'ai-chat-t' }, c.title || '（无标题）'),
          h('div', { class: 'ai-chat-m' }, fmt(c.time) + ' · ' + n + ' 条提问'),
          h('button', { class: 'ai-chat-x', title: '删除这条记录', onclick: (e) => { e.stopPropagation(); this.deleteChat(c.id); } }, '✕')));
      }
    }

    // ---------------------------------------------------------- 发送
    async send(text, fixOf) {
      text = (text || this.input.value).trim();
      if (!text) return;
      if (this.busy) { this.busy.abort(); return; }
      const cfg = this.cfg, app = this.app;
      if (!cfg.apiKey) { this.welcome(); openSettings(app, 'ai'); return; }
      const model = this.modelSel.get() || (cfg.think ? cfg.modelThink : cfg.modelFast);
      if (!model) { UI.toast('请先选择模型', 'err'); return; }
      if (this.showList) this.closeList();
      const mode = this.mode;
      const c = this.ensureChat();
      if (!c.items.length) this.log.innerHTML = '';
      if (!fixOf) {
        this.input.value = '';
        this.add('user', text);
        c.items.push({ k: 'user', text });
        if (!c.title) c.title = text.replace(/\s+/g, ' ').slice(0, 30);
      }
      const request = fixOf ? text + '\n原始要求：' + fixOf : text;
      const withProblem = this.chkProblem.checked && !!(app.problem && app.problem.info);
      const userMsg = SG.AIPrompt.buildUserMessage(app, request, { problem: withProblem, chat: mode === 'chat' });
      const keep = Math.max(0, (cfg.history || 6) * 2);
      const system = mode === 'chat' ? SG.AIPrompt.CHAT_PROMPT : SG.AIPrompt.SYSTEM_PROMPT + SG.AIPrompt.CONTROLS_PROMPT;
      const messages = [{ role: 'system', content: system }].concat(c.hist.slice(-keep), [{ role: 'user', content: userMsg }]);
      const think = h('div', { class: 'think' });
      const det = h('details', { open: true }, h('summary', null, '思考过程'), think);
      const body = h('div', null, '…');
      this.add('ai', det, body);
      det.style.display = 'none';
      const ctrl = new AbortController();
      this.busy = ctrl;
      this.sendBtn.textContent = '停止';
      const t0 = Date.now();
      const chatId = c.id;
      let res;
      try {
        res = await SG.AIClient.chat({
          baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model, provider: cfg.provider, think: cfg.think, effort: cfg.effort, messages, signal: ctrl.signal,
          onDelta: ({ content, reasoning }) => {
            if (reasoning) { det.style.display = ''; think.textContent = reasoning; think.scrollTop = think.scrollHeight; }
            if (mode === 'chat' && content) body.textContent = content;
            else body.textContent = content ? '正在生成作图指令…（' + content.length + ' 字）' : '思考中…（' + Math.round((Date.now() - t0) / 1000) + ' 秒）';
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
      if (this.curId !== chatId) return; // 已切换到别的对话
      det.remove();
      const ctx = withProblem ? '（当时的题目与图形已省略）\n' : '（当时的图形已省略）\n';
      c.hist.push({ role: 'user', content: ctx + request }, { role: 'assistant', content: res.content });
      c.time = Date.now();
      const it = mode === 'chat'
        ? { k: 'ai', mode: 'chat', text: res.content, think: res.reasoning || '' }
        : this.handleReply(res.content, res.reasoning);
      c.items.push(it);
      this.saveChats();
      const base = fixOf || text;
      this.renderAI(it, body, (msg) => this.send(msg, base));
      this.log.scrollTop = this.log.scrollHeight;
    }

    /** 作图模式：解析并执行 AI 的回复，返回要保存的记录 */
    handleReply(content, reasoning) {
      const app = this.app;
      const it = { k: 'ai', mode: 'draw', think: reasoning || '' };
      let data;
      try { data = SG.AIPrompt.parseReply(content); }
      catch (e) { it.parseErr = e.message; it.raw = content; return it; }
      it.text = data.message || '';
      it.thought = data.thought || '';
      const cmds = (it.cmds = Array.isArray(data.commands) ? data.commands : []);
      const ctls = (it.ctls = Array.isArray(data.controls) ? data.controls : []);
      if (cmds.length) {
        try {
          const r = SG.AIPrompt.execute(app, cmds);
          it.ok = '✓ 已执行 ' + cmds.length + ' 条指令，新建 ' + r.created.length + ' 个对象。（Ctrl+Z 可撤销）';
          const sel = r.created.filter((id) => { const o = app.S.map.get(id); return o && (o.type === 'point' || o.type === 'plane' || o.type === 'sphere'); });
          if (sel.length) app.select(sel);
        } catch (e) { it.err = e.message; return it; }
      }
      if (ctls.length) {
        const list = SG.Controls.normalizeAI(ctls);
        if (list.length) {
          const pins = list.filter((x) => x.pin).map((x) => x.id);
          for (const x of list) delete x.pin;
          app.setControls(app.controls.concat(list));
          for (const id of pins) app.hudToggle('ctl', id, true);
          it.ctlOk = '✓ 已添加 ' + list.length + ' 个控件到"控制"分区' + (pins.length ? '，其中 ' + pins.length + ' 个已显示在画布左上角' : '') + '。';
        }
      }
      return it;
    }

    manual() {
      const ta = h('textarea', { rows: 12, style: { width: '100%', fontFamily: 'monospace', fontSize: '12px' }, placeholder: '[{"op":"midpoint","name":"M","a":"A","b":"B"}, {"op":"segment","a":"M","b":"C"}]' });
      const copy = h('button', { class: 'btn', onclick: () => { navigator.clipboard.writeText('【当前图形】\n```json\n' + JSON.stringify(SG.AIPrompt.describeScene(this.app)) + '\n```').then(() => UI.toast('已复制当前图形，可粘贴给 AI', 'ok'), () => UI.toast('复制失败', 'err')); } }, '复制当前图形');
      const body = h('div', null, h('div', { class: 'note' }, '可以粘贴 AI 输出的 JSON（整个对象或 commands 数组）。指令格式见“?”中下载的说明文件。'), h('div', { class: 'btnrow' }, copy), ta);
      UI.modal('执行作图指令', body, [{ label: '取消', value: null }, {
        label: '执行', primary: true, onClick: () => {
          try {
            const raw = ta.value.trim();
            let d = raw.startsWith('[') ? JSON.parse(raw) : SG.AIPrompt.parseReply(raw);
            const ctls = Array.isArray(d) ? [] : d.controls || [];
            if (!Array.isArray(d)) d = d.commands || (d.op ? [d] : []);
            if (d.length) SG.AIPrompt.execute(this.app, d);
            const list = SG.Controls.normalizeAI(ctls);
            if (list.length) {
              const pins = list.filter((x) => x.pin).map((x) => x.id);
              for (const x of list) delete x.pin;
              this.app.setControls(this.app.controls.concat(list));
              for (const id of pins) this.app.hudToggle('ctl', id, true);
            }
            UI.toast('已执行 ' + d.length + ' 条指令' + (list.length ? '，添加 ' + list.length + ' 个控件' : ''), 'ok');
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
    // 通过激活密码得到的 Key 不在界面上显示
    const viaAct = () => !!(s.ai.keyExpire && s.ai.apiKey);
    const key = h('input', { type: 'password', value: viaAct() ? '' : ai.apiKey, placeholder: 'sk-...' });
    const syncKey = () => { key.placeholder = viaAct() ? '已通过激活密码设置（已隐藏）' : 'sk-...'; };
    syncKey();
    const knownM = () => [ai.modelThink, ai.modelFast, SG.PROVIDERS[prov.value] && SG.PROVIDERS[prov.value].modelThink, SG.PROVIDERS[prov.value] && SG.PROVIDERS[prov.value].modelFast];
    const mThinkSel = SG.ModelUI.select(ai.modelThink, { provider: () => prov.value, known: knownM });
    const mFastSel = SG.ModelUI.select(ai.modelFast, { provider: () => prov.value, known: knownM });
    const mThink = { get value() { return mThinkSel.get(); }, set value(v) { mThinkSel.set(v); } };
    const mFast = { get value() { return mFastSel.get(); }, set value(v) { mFastSel.set(v); } };
    const hist = h('input', { type: 'number', value: ai.history, min: 0, max: 20 });
    const effort = h('select', null, [['low', '低（更快、更省）'], ['high', '高（默认）'], ['max', '最高（更复杂的题）']].map(([v, l]) => h('option', { value: v, selected: (ai.effort || 'high') === v }, l)));
    const effRow = h('div', { class: 'field' }, h('label', null, '思考强度'), effort);
    const syncEff = () => {};
    prov.addEventListener('change', () => {
      const p = SG.PROVIDERS[prov.value];
      if (p.baseUrl) base.value = p.baseUrl;
      if (p.modelThink) mThink.value = p.modelThink;
      if (p.modelFast) mFast.value = p.modelFast;
      mThinkSel.rebuild(); mFastSel.rebuild();
      syncEff();
    });
    const showKey = h('button', { class: 'btn', title: '显示 / 隐藏手动填写的 Key', onclick: () => { key.type = key.type === 'password' ? 'text' : 'password'; } }, '👁');
    const testRes = h('span', { class: 'note' });
    const test = h('button', {
      class: 'btn', onclick: async () => {
        testRes.textContent = '测试中…';
        try {
          const r = await SG.AIClient.chat({ baseUrl: base.value, apiKey: key.value.trim() || (viaAct() ? s.ai.apiKey : ''), model: mFast.value, provider: prov.value, think: false, messages: [{ role: 'user', content: '只回复两个字：成功' }] });
          testRes.textContent = '✓ 连接成功：' + r.content.slice(0, 20);
        } catch (e) { testRes.textContent = '✗ ' + e.message; }
      },
    }, '测试连接');
    // ---- 激活密码：输入正确的密码即可解出内置的 API Key（7 天有效）
    const actPw = h('input', { type: 'password', placeholder: '激活密码', autocomplete: 'off' });
    const actRes = h('span', { class: 'note' });
    const fmtDay = (t) => new Date(t).toLocaleDateString();
    const showAct = () => { actRes.textContent = s.ai.keyExpire && s.ai.apiKey ? '✓ 已激活，有效期至 ' + fmtDay(s.ai.keyExpire) : ''; };
    showAct();
    const doAct = async () => {
      if (!actPw.value) { actRes.textContent = '请输入激活密码'; return; }
      actRes.textContent = '验证中…';
      try { await SG.Vault.activate(app, actPw.value); key.value = ''; syncKey(); actPw.value = ''; showAct(); app.emit('settings'); }
      catch (e) { actRes.textContent = '✗ ' + e.message; }
    };
    actPw.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); doAct(); } });
    const actRow = h('div', { class: 'field' }, h('label', null, '激活密码'), actPw,
      h('button', { class: 'btn', onclick: doAct }, '激活'),
      h('button', { class: 'btn', title: '清除本机保存的 Key', onclick: () => { SG.Vault.clear(app); key.value = ''; syncKey(); actRes.textContent = '已清除'; } }, '清除'));
    // ---- 高级调试：连续点击 7 次才展开（生成激活码）
    const gKey = h('input', { type: 'password', placeholder: 'API Key（sk-…）' });
    const gPw = h('input', { type: 'password', placeholder: '激活密码（建议 12 位以上）' });
    const gPw2 = h('input', { type: 'password', placeholder: '再输入一次密码' });
    const gOut = h('textarea', { rows: 3, readonly: true, style: { width: '100%', fontFamily: 'monospace', fontSize: '12px' } });
    const gMsg = h('span', { class: 'note' });
    const gen = async () => {
      if (!gKey.value.trim() || !gPw.value) { gMsg.textContent = '请填写 Key 和密码'; return; }
      if (gPw.value !== gPw2.value) { gMsg.textContent = '两次密码不一致'; return; }
      gMsg.textContent = '生成中…';
      const code = await SG.Vault.encrypt(gKey.value.trim(), gPw.value);
      await SG.Vault.decrypt(code, gPw.value); // 自检
      gOut.value = code;
      gMsg.textContent = '✓ 已生成。把这串激活码发给开发者放进网站；Key 本身不要发。';
    };
    const advBody = h('div', { class: 'adv-body', style: { display: 'none' } },
      h('div', { class: 'note' }, '生成激活码：在本机用密码加密 API Key，Key 不会发送到任何地方。'),
      h('div', { class: 'field' }, h('label', null, 'API Key'), gKey),
      h('div', { class: 'field' }, h('label', null, '密码'), gPw),
      h('div', { class: 'field' }, h('label', null, '确认密码'), gPw2),
      h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', onclick: gen }, '生成激活码'),
        h('button', { class: 'btn', onclick: () => { if (gOut.value) navigator.clipboard.writeText(gOut.value).then(() => { gMsg.textContent = '✓ 已复制'; }); } }, '复制'), gMsg),
      gOut);
    let taps = 0, tapT = 0;
    const advHead = h('div', { class: 'adv-head', onclick: () => {
      const now = Date.now();
      taps = now - tapT < 1500 ? taps + 1 : 1;
      tapT = now;
      if (taps >= 7) advBody.style.display = '';
    } }, '▸ 高级调试');
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
      f('思考模型', mThinkSel.el), f('非思考模型', mFastSel.el), effRow, f('记忆轮数', hist),
      h('div', { class: 'note' }, 'DeepSeek：模型可填 deepseek-flash（默认，快且便宜）或 deepseek-v4-pro（更强、更贵），思考与非思考可以用同一个模型；"开启 / 关闭思考"通过 thinking 参数切换，思考强度对应 reasoning_effort。OpenAI 及其他兼容接口按"思考 / 非思考"切换模型名，可自行修改地址与模型。API Key 仅保存在本机浏览器（localStorage）中，直接从浏览器发送到你选择的接口。'),
      h('div', { class: 'btnrow' }, test, testRes),
      actRow, h('div', { style: { marginLeft: '96px' } }, actRes),
      advHead, advBody,
      h('h4', { style: { margin: '14px 0 6px' } }, '显示与绘图'),
      f('标签字号', fsz), f('线宽倍数', lsc), f('被遮挡的线', hid),
      f('吸附网格', snap, h('span', { class: 'note' }, '步长'), snapStep),
      f('网格间距', gridStep), f('新建点显示标签', labelNew), f('显示顶点圆点', dots));
    UI.modal('设置', body, [{ label: '取消', value: null }, {
      label: '保存', primary: true, onClick: () => {
        Object.assign(s.ai, { provider: prov.value, baseUrl: base.value.trim(), apiKey: key.value.trim() || (viaAct() ? s.ai.apiKey : ''), keyExpire: key.value.trim() ? 0 : s.ai.keyExpire || 0, modelThink: mThink.value.trim(), modelFast: mFast.value.trim(), effort: effort.value, history: +hist.value || 0 });
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
