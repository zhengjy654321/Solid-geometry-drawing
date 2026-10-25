/*
 * 从题目新建（界面）：
 *   新建对话框 → 第 1 步 输入题目（文字 / 图片）并识别 → 第 2 步 确认并修改识别结果 → 生成图形
 *   右侧"题目"标签页：题目控制面板（AI 设计的按钮、动点滑块、最值核实、一键检查、与原图同视角）
 */
(function (SG) {
  'use strict';
  const { UI } = SG;
  const { h } = UI;
  const P = SG.Problem;

  // ================================================================ AI 调用与模型选择
  function stepDefaults(app, step) {
    const ai = app.settings.ai;
    // 旧版本保存的"画图用 Flash"改为新的默认值 Pro
    if (ai.problemV !== 2) {
      if (ai.problem && ai.problem.gen && ai.problem.gen.model === 'deepseek-flash') delete ai.problem.gen.model;
      ai.problemV = 2;
      app.saveSettings();
    }
    const d = (ai.problem && ai.problem[step]) || {};
    const ds = ai.provider === 'deepseek';
    return {
      model: d.model || (ds ? (step === 'rec' ? 'deepseek-flash' : 'deepseek-v4-pro') : step === 'rec' ? ai.modelFast : ai.modelThink),
      think: d.think != null ? d.think : step !== 'rec',
      effort: d.effort || 'high',
    };
  }
  function saveStep(app, step, v) {
    app.settings.ai.problem = app.settings.ai.problem || {};
    app.settings.ai.problem[step] = v;
    app.saveSettings();
  }
  /** 模型 / 思考 / 思考强度 选择行 */
  function modelRow(app, step, title, flashOnly) {
    const d = stepDefaults(app, step);
    const ds = app.settings.ai.provider === 'deepseek';
    const model = SG.ModelUI.select(d.model, { provider: () => app.settings.ai.provider, known: () => SG.ModelUI.known(app), flashOnly: flashOnly && ds });
    const think = h('select', null, h('option', { value: '0', selected: !d.think }, '关闭思考'), h('option', { value: '1', selected: !!d.think }, '开启思考'));
    const effort = SG.ModelUI.effortSelect(d.effort);
    const sync = () => { effort.disabled = think.value !== '1'; effort.title = effort.disabled ? '开启思考后才能选择思考强度' : '思考强度：越高想得越久、越仔细，也更慢、更贵'; };
    think.addEventListener('change', sync);
    sync();
    const el = h('div', { class: 'pb-model-row' }, h('span', { class: 'pb-lbl' }, title), model.el, think, effort);
    return { el, get: () => ({ model: model.get(), think: think.value === '1', effort: effort.value }), setFlashOnly: (b) => ds && model.setFlashOnly(b) };
  }
  async function callAI(app, messages, opt, onDelta, signal) {
    const ai = app.settings.ai;
    if (!ai.apiKey) throw new Error('请先在"设置"中填写 API Key');
    if (!opt.model) throw new Error('请填写模型名称');
    return SG.AIClient.chat({ baseUrl: ai.baseUrl, apiKey: ai.apiKey, provider: ai.provider, model: opt.model, think: opt.think, effort: opt.effort, messages, signal, onDelta });
  }
  /** 进度显示区：状态 + 可折叠的思考过程 */
  function progressBox() {
    const status = h('div', { class: 'pb-status' });
    const think = h('div', { class: 'pb-think' });
    const det = h('details', { class: 'pb-think-det' }, h('summary', null, 'AI 的思考过程'), think);
    det.style.display = 'none';
    const el = h('div', { class: 'pb-progress hidden' }, status, det);
    const t0 = { v: 0 };
    return {
      el,
      start(msg) { el.classList.remove('hidden'); status.className = 'pb-status'; status.textContent = msg; think.textContent = ''; det.style.display = 'none'; t0.v = Date.now(); },
      delta(msg, { content, reasoning }) {
        if (reasoning) { det.style.display = ''; think.textContent = reasoning; think.scrollTop = think.scrollHeight; }
        status.textContent = msg + '（' + Math.round((Date.now() - t0.v) / 1000) + ' 秒' + (content ? '，已生成 ' + content.length + ' 字' : reasoning ? '，思考中' : '') + '）';
      },
      error(msg) { el.classList.remove('hidden'); status.className = 'pb-status err'; status.textContent = msg; },
      ok(msg) { el.classList.remove('hidden'); status.className = 'pb-status ok'; status.textContent = msg; },
    };
  }

  // ================================================================ 图片
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const s = Math.min(1, 1600 / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve({ dataUrl: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height, name: file.name || '图片' });
        };
        img.onerror = () => reject(new Error('图片无法读取'));
        img.src = fr.result;
      };
      fr.onerror = () => reject(new Error('图片无法读取'));
      fr.readAsDataURL(file);
    });
  }

  // ================================================================ 向导
  class Wizard {
    constructor(app) {
      this.app = app;
      this.m = document.getElementById('modal');
      this.box = this.m.querySelector('.modal-box');
      this.text = '';
      this.images = [];
      this.ctrl = null;
      this.onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } };
      this.onPaste = (e) => {
        const items = Array.from((e.clipboardData && e.clipboardData.items) || []).filter((i) => i.type.startsWith('image/'));
        if (!items.length || !this.dropZone) return;
        e.preventDefault();
        this.addFiles(items.map((i) => i.getAsFile()).filter(Boolean));
      };
    }
    open() {
      this.m.classList.remove('hidden');
      this.m.onclick = null;
      document.addEventListener('keydown', this.onKey, true);
      document.addEventListener('paste', this.onPaste);
    }
    close() {
      if (this.ctrl) this.ctrl.abort();
      this.m.classList.add('hidden');
      this.box.className = 'modal-box';
      document.removeEventListener('keydown', this.onKey, true);
      document.removeEventListener('paste', this.onPaste);
      this.dropZone = null;
    }
    render(title, body, buttons) {
      this.box.className = 'modal-box wide';
      this.box.innerHTML = '';
      this.box.appendChild(h('h3', null, title));
      this.box.appendChild(body);
      this.foot = h('div', { class: 'foot' }, buttons.map((b) => h('button', { class: b.primary ? 'primary' : '', onclick: b.onClick }, b.label)));
      this.box.appendChild(this.foot);
    }
    /** 处理中：禁用按钮，防止重复提交 */
    busy(on) {
      this.running = on;
      for (const b of this.foot.querySelectorAll('button')) {
        if (b.dataset.keep) continue;
        b.disabled = on;
        if (b.classList.contains('primary')) {
          if (on) { b.dataset.label = b.textContent; b.textContent = '处理中…'; } else if (b.dataset.label) b.textContent = b.dataset.label;
        }
      }
    }

    // ---------------------------------------------- 第 1 步：输入题目
    step1() {
      this.open();
      const ta = h('textarea', { class: 'pb-text', rows: 7, placeholder: '在这里粘贴或输入题目文字（可以只上传图片）…' }, this.text);
      ta.addEventListener('input', () => { this.text = ta.value; });
      const file = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden' });
      file.addEventListener('change', () => { this.addFiles(Array.from(file.files)); file.value = ''; });
      this.thumbs = h('div', { class: 'pb-thumbs' });
      this.dropZone = h('div', { class: 'pb-drop', onclick: () => file.click() }, '📷 点击选择图片，或把图片拖到这里，或直接 Ctrl+V 粘贴截图', h('div', { class: 'note' }, '可以上传题目截图 / 照片（含示意图）。DeepSeek 只有 Flash 支持看图，所以带图片时识别固定使用 Flash；纯文字时也可选 Pro。'));
      this.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); this.dropZone.classList.add('over'); });
      this.dropZone.addEventListener('dragleave', () => this.dropZone.classList.remove('over'));
      this.dropZone.addEventListener('drop', (e) => { e.preventDefault(); this.dropZone.classList.remove('over'); this.addFiles(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))); });
      this.rec = modelRow(this.app, 'rec', '识别用的 AI', this.images.length > 0);
      this.prog = progressBox();
      this.renderThumbs();
      this.render('从题目新建 · 第 1 步：输入题目', h('div', null,
        h('div', { class: 'pb-steps' }, h('b', null, '① 输入题目'), ' → ② 确认识别结果 → ③ 生成图形与控制面板'),
        ta, this.dropZone, file, this.thumbs, this.rec.el, this.prog.el), [
        { label: '取消', onClick: () => this.close() },
        { label: '跳过识别，直接填写', onClick: () => this.step2({ title: '', text: this.text, solid: '', given: '', points: '', asks: '', notes: '', extra: '', figure: { has: this.images.length > 0, points: {} } }) },
        { label: '识别题目', primary: true, onClick: () => this.recognize() },
      ]);
      setTimeout(() => ta.focus(), 30);
    }
    async addFiles(files) {
      for (const f of files) {
        try { this.images.push(await loadImage(f)); } catch (e) { UI.toast(e.message, 'err'); }
      }
      this.renderThumbs();
    }
    renderThumbs() {
      if (this.rec) this.rec.setFlashOnly(this.images.length > 0);
      if (!this.thumbs) return;
      this.thumbs.innerHTML = '';
      this.images.forEach((im, i) => {
        this.thumbs.appendChild(h('div', { class: 'pb-thumb' }, h('img', { src: im.dataUrl, alt: im.name }), h('span', null, '图 ' + (i + 1)),
          h('button', { title: '移除', onclick: () => { this.images.splice(i, 1); this.renderThumbs(); } }, '✕')));
      });
    }
    async recognize() {
      if (this.running) return;
      if (!this.text.trim() && !this.images.length) { this.prog.error('请先输入题目文字或上传图片'); return; }
      const opt = this.rec.get();
      saveStep(this.app, 'rec', opt);
      this.busy(true);
      this.prog.start('正在识别题目…');
      this.ctrl = new AbortController();
      let res;
      try {
        res = await callAI(this.app, P.recognizeMessages(this.text.trim(), this.images), opt, (d) => this.prog.delta('正在识别题目', d), this.ctrl.signal);
      } catch (e) {
        this.busy(false);
        if (e.name !== 'AbortError') this.prog.error('识别失败：' + e.message + (this.images.length ? '（如果所选模型不支持图片，请换用 deepseek-flash 等支持图片的模型）' : ''));
        return;
      } finally { this.ctrl = null; }
      this.busy(false);
      let d;
      try { d = SG.AIPrompt.parseReply(res.content); } catch (e) { this.prog.error('无法解析识别结果：' + e.message + '。可以重试，或"跳过识别，直接填写"。'); return; }
      const fig = d.figure || {};
      const im = this.images[Math.max(0, (+fig.image || 1) - 1)];
      const info = {
        title: d.title || '', text: d.text || this.text, solid: d.solid || '', given: d.given || '', points: d.points || '', asks: d.asks || '', notes: d.notes || '', extra: '',
        figure: { has: !!fig.has, points: fig.points && typeof fig.points === 'object' ? fig.points : {}, image: +fig.image || 1, aspect: im ? im.h / im.w : 1 },
      };
      this.step2(info);
    }

    // ---------------------------------------------- 第 2 步：确认
    step2(info, regen) {
      this.open();
      this.info = info;
      const fld = (key, label, rows, hint) => {
        const el = rows ? h('textarea', { rows }, info[key] || '') : h('input', { type: 'text', value: info[key] || '' });
        el.addEventListener('input', () => { info[key] = el.value; });
        return h('div', { class: 'pb-field' + (rows >= 4 ? ' tall' : '') }, h('label', null, label, hint ? h('small', null, hint) : null), el);
      };
      const figPts = Object.keys((info.figure && info.figure.points) || {});
      this.useFig = h('input', { type: 'checkbox', checked: figPts.length >= 3 });
      let figBox = null;
      if (this.images.length || (info.figure && info.figure.has)) {
        figBox = h('div', { class: 'pb-fig' },
          this.images.length ? h('div', { class: 'pb-thumbs small' }, this.images.map((im, i) => h('div', { class: 'pb-thumb' }, h('img', { src: im.dataUrl }), h('span', null, '图 ' + (i + 1))))) : null,
          figPts.length >= 3
            ? h('label', { class: 'pb-check' }, this.useFig, '生成后提供"与原图同视角"按钮（示意图中识别出 ' + figPts.length + ' 个点：' + figPts.join('、') + '）')
            : h('div', { class: 'note' }, info.figure && info.figure.has ? '示意图中识别出的点太少，无法对齐视角。' : ''));
      }
      this.gen = modelRow(this.app, 'gen', '画图用的 AI');
      this.prog = progressBox();
      const body = h('div', null,
        h('div', { class: 'pb-steps' }, '① 输入题目 → ', h('b', null, '② 确认识别结果'), ' → ③ 生成图形与控制面板'),
        h('div', { class: 'note', style: { marginBottom: '6px' } }, '下面每一项都可以直接修改。请重点核对数据、动点（行首写 [动点]）和题目要求，确认无误后提交。'),
        info.notes ? h('div', { class: 'info warn' }, '识别提醒：' + info.notes) : null,
        h('div', { class: 'pb-grid' },
          fld('title', '标题', 0),
          fld('text', '题目原文', 5),
          fld('solid', '几何体与已知数据', 3),
          fld('given', '其他已知条件', 3, '每行一条'),
          fld('points', '点（含动点）', 4, '每行一个；动点行首写 [动点]，并写明在哪里运动'),
          fld('asks', '题目要求', 3, '每问一行'),
          fld('extra', '补充说明（可选）', 2, '给 AI 的额外要求，如"把 BC 画在正前方"')),
        figBox, this.gen.el, this.prog.el);
      this.render('从题目新建 · 第 2 步：确认题目信息', body, [
        { label: regen ? '取消' : '上一步', onClick: () => (regen ? this.close() : this.step1()) },
        { label: '提交并生成', primary: true, onClick: () => this.generate() },
      ]);
    }

    // ---------------------------------------------- 第 3 步：生成
    async generate() {
      if (this.running) return;
      const app = this.app;
      const info = this.info;
      if (!(info.text || '').trim() && !(info.solid || '').trim()) { this.prog.error('请至少填写题目原文或几何体信息'); return; }
      const opt = this.gen.get();
      saveStep(app, 'gen', opt);
      this.busy(true);
      const messages = P.buildMessages(info);
      let lastErr = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        this.prog.start(attempt ? '作图指令执行出错，正在让 AI 修正…' : '正在生成图形与控制面板…');
        this.ctrl = new AbortController();
        let res;
        try {
          res = await callAI(app, messages, opt, (d) => this.prog.delta(attempt ? '正在修正' : '正在生成', d), this.ctrl.signal);
        } catch (e) {
          this.ctrl = null; this.busy(false);
          if (e.name !== 'AbortError') this.prog.error('生成失败：' + e.message);
          return;
        }
        this.ctrl = null;
        messages.push({ role: 'assistant', content: res.content });
        try {
          const data = SG.AIPrompt.parseReply(res.content);
          buildFromData(app, info, data, this.images, this.useFig.checked);
          app.fileName = null;
          addHistory(app, info);
          this.close();
          UI.toast('已根据题目生成图形' + (data.message ? '：' + data.message : ''), 'ok', 5000);
          return;
        } catch (e) {
          lastErr = e;
          messages.push({ role: 'user', content: '执行出错：' + e.message + '\n画布仍然是空的。请修正后重新输出完整的 JSON（包括全部 commands 和 panel）。' });
        }
      }
      this.busy(false);
      this.prog.error('生成失败：' + (lastErr ? lastErr.message : '未知错误') + '。可以修改题目信息后再提交，或换一个模型 / 开启思考。');
    }
  }

  /** 清空画布，执行 AI 的作图指令，建立题目面板（任何一条指令失败则整体回滚并抛出错误） */
  function buildFromData(app, info, data, images, useFig) {
    const cmds = data.commands;
    if (!Array.isArray(cmds) || !cmds.length) throw new Error('AI 没有给出作图指令');
    const snap = app.snapshot();
    const S = app.S;
    try {
      S.clear();
      cmds.forEach((c, i) => {
        try {
          const r = app.C.exec(SG.AIPrompt.normalizeCommand(c));
          S.recompute();
          const bad = r.created.map((id) => S.map.get(id)).filter((o) => o && o.err);
          if (bad.length) throw new Error(bad.map((o) => S.displayName(o) + '：' + o.err).join('；'));
        } catch (e) { throw new Error('第 ' + (i + 1) + ' 条指令 ' + JSON.stringify(c) + ' 失败：' + e.message); }
      });
      for (const o of S.objects) if (o.type === 'point' && !o.hidden) o.style.label = true;
    } catch (e) {
      app.restore(snap);
      throw e;
    }
    app.pushUndo(snap);
    app.work = { kind: 'xy', h: 0 };
    app.cam.base = null;
    if (app.cam.mode !== 'ortho') { app.cam.mode = 'ortho'; app.cam.update(); }
    const panel = data.panel || {};
    const problem = { info: JSON.parse(JSON.stringify(info)), panel, message: data.message || '', thought: data.thought || '', createdAt: Date.now(), state: {} };
    problem.images = images;
    problem.warnings = P.validatePanel(app, panel);
    if (useFig && info.figure && Object.keys(info.figure.points || {}).length >= 3) problem.figureView = P.fitView(app, info.figure.points, info.figure.aspect);
    S.recompute();
    app.afterChange();
    app.emit('work');
    app.setProblem(problem);
    app.fit();
    app.emit('openProblemTab');
    return problem;
  }

  // ================================================================ 新建对话框
  // ================================================================ 题目历史记录（保存在本机浏览器）
  const HIST_KEY = 'sg.problemHistory', HIST_MAX = 15;
  function addHistory(app, info) {
    const list = UI.LS.get(HIST_KEY, []).filter((x) => x && x.data);
    const title = (info.title || '').trim() || (info.text || info.solid || '').replace(/\s+/g, ' ').slice(0, 40) || '未命名题目';
    list.unshift({ id: 'ph' + Date.now().toString(36), time: Date.now(), title, data: app.fileData() });
    // 存不下时逐条删掉最旧的记录
    for (let n = Math.min(list.length, HIST_MAX); n > 0; n--) {
      try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, n))); return; } catch (e) { /* 继续删减 */ }
    }
  }
  function openHistory(app) {
    const box = h('div', { class: 'ph-list' });
    const render = () => {
      const list = UI.LS.get(HIST_KEY, []);
      box.innerHTML = '';
      if (!list.length) { box.appendChild(h('div', { class: 'note', style: { padding: '20px 0', textAlign: 'center' } }, '还没有历史题目。用"从题目新建"生成过的题目会自动保存在这里（最多 ' + HIST_MAX + ' 道）。')); return; }
      const fmt = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
      for (const it of list) {
        box.appendChild(h('div', { class: 'ph-item' },
          h('div', { class: 'ph-main', onclick: () => { document.getElementById('modal').classList.add('hidden'); app.loadData(it.data); UI.toast('已打开：' + it.title, 'ok'); } },
            h('b', null, it.title), h('small', null, fmt(it.time))),
          h('button', { class: 'btn danger', title: '删除这条记录', onclick: () => { UI.LS.set(HIST_KEY, UI.LS.get(HIST_KEY, []).filter((x) => x.id !== it.id)); render(); } }, '✕')));
      }
    };
    render();
    UI.modal('历史题目', h('div', null, h('div', { class: 'note' }, '单击打开（当前画布会被替换，可以撤销）。'), box), [{ label: '关闭', value: null }]);
  }

  function openNew(app, wizardHolder) {
    const card = (icon, title, desc, fn) => h('button', { class: 'pb-card', onclick: fn }, h('div', { class: 'pb-card-ic' }, icon), h('div', null, h('b', null, title), h('small', null, desc)));
    const body = h('div', { class: 'pb-cards' },
      card('▭', '空白画板', '清空画布，从头开始画（可以撤销）', () => {
        document.getElementById('modal').classList.add('hidden');
        app.change('清空', () => app.S.clear());
        app.setWork({ kind: 'xy', h: 0 });
        app.hud.items = [];
        app.setControls([]);
        app.setProblem(null);
        app.fileName = null;
      }),
      card('✦', '从题目新建', '粘贴题目文字或上传题目图片，AI 识别后由你确认，再自动画图并生成题目控制面板', () => {
        const w = new Wizard(app);
        wizardHolder.current = w;
        w.step1();
      }),
      card('🕘', '历史题目', '打开以前从题目新建的题目（图形、控制面板一起恢复）', () => openHistory(app)));
    UI.modal('新建', body, [{ label: '取消', value: null }]);
  }

  // ================================================================ 题目控制面板
  class ProblemPanel {
    constructor(app, wizardHolder) {
      this.app = app;
      this.wh = wizardHolder;
      this.pane = document.getElementById('pane-problem');
      this.msg = '';
      this.check = null;
      this.runner = new SG.ActionRunner(app, {
        params: () => ((this.pb && this.pb.panel && this.pb.panel.params) || []),
        figureView: () => this.figureView(),
        extremum: (i) => this.jumpExtremum(i),
        onMsg: (t) => this.setMsg(t),
        state: () => (this.pb ? this.pb.state : {}),
        onChange: () => this.render(),
      });
      app.runners = app.runners || {};
      app.runners.problem = this.runner;
      app.on('problem', () => { this.stop(true); this.check = null; this.msg = ''; this.verifyAll(); this.render(); });
      app.on('live', () => this.refreshValues());
      app.on('change', () => this.refreshValues());
      this.render();
    }
    get pb() { return this.app.problem; }

    // ---------------------------------------------- 核实
    verifyAll() {
      const pb = this.pb;
      if (!pb) return;
      pb.runtime = pb.runtime || {};
      pb.runtime.verify = ((pb.panel && pb.panel.extrema) || []).map((ex) => {
        const res = P.scanExtremum(this.app, pb.panel, ex);
        return { res, cmp: P.compare(ex, res) };
      });
    }
    hasProblems() {
      const pb = this.pb;
      if (!pb) return false;
      return (pb.warnings && pb.warnings.length) || ((pb.runtime && pb.runtime.verify) || []).some((v) => v.cmp.status === 'mismatch' || v.cmp.status === 'error');
    }
    isAngleTarget(ex) {
      const t = ex.target || {};
      const terms = t.terms || [{ measure: t.measure || t }];
      return terms.length && terms.every((x) => x.measure && ['angle', 'angleLines', 'angleLinePlane', 'dihedral'].includes(x.measure.type));
    }
    fmtVal(ex, v) {
      if (!isFinite(v)) return '—';
      if (this.isAngleTarget(ex)) return SG.Exact.fmtNum(v, 3) + '°';
      const e = SG.Exact.recognize(v);
      const n = SG.Exact.fmtNum(v, 4);
      return e && e !== n ? n + '（= ' + e + '）' : n;
    }
    paramLabel(id) {
      const prm = ((this.pb.panel && this.pb.panel.params) || []).find((p) => p.id === id);
      return prm ? prm.label || prm.target : id;
    }

    // ---------------------------------------------- 动作执行
    findParam(id) { return this.runner.param(id); }
    tween(rs, targets, ms) { return this.runner.tween(rs, targets, ms); }
    play(a) { this.runner.play(a, 'p:' + a.param); }
    stop(silent) { this.runner.stop(silent); }
    get playing() { return this.runner.playing; }
    async jumpExtremum(i) {
      const pb = this.pb;
      const ex = pb.panel.extrema[i];
      if (!ex) throw new Error('没有第 ' + (i + 1) + ' 个最值');
      if (!pb.runtime || !pb.runtime.verify || !pb.runtime.verify[i]) this.verifyAll();
      const v = pb.runtime.verify[i];
      if (!v.res.ok) throw new Error(v.res.message);
      this.stop();
      await this.tween(ex.params.map((id) => this.findParam(id)), v.res.at);
      this.setMsg((ex.label || '最值') + '：程序计算结果为 ' + this.fmtVal(ex, v.res.value) + '，此时 ' + ex.params.map((id, k) => this.paramLabel(id) + ' = ' + SG.Exact.fmtNum(v.res.at[k], 4)).join('，'));
    }
    runButton(b, bi) { return this.runner.runSafe(b.actions || [], 'b' + bi, b.label); }
    figureView() {
      const pb = this.pb;
      if (!pb.figureView && pb.info && pb.info.figure && Object.keys(pb.info.figure.points || {}).length >= 3) pb.figureView = P.fitView(this.app, pb.info.figure.points, pb.info.figure.aspect);
      if (!pb.figureView) { UI.toast('没有可用的示意图信息', 'err'); return; }
      P.applyView(this.app, pb.figureView);
    }
    setMsg(t) { this.msg = t; if (this.msgEl) this.msgEl.textContent = t; if (this.msgEl) this.msgEl.style.display = t ? '' : 'none'; }

    // ---------------------------------------------- 一键检查
    async runCheck() {
      if (this.check && this.check.busy) return; // 防止重复提交
      const app = this.app, pb = this.pb;
      const report = {
        warnings: pb.warnings || [],
        params: (pb.panel.params || []).map((prm) => { try { const r = P.resolveParam(app, prm); return Object.assign({}, prm, { current: P.getP(app, r) }); } catch (e) { return Object.assign({}, prm, { error: e.message }); } }),
        extrema: (pb.panel.extrema || []).map((ex, i) => {
          const v = (pb.runtime.verify || [])[i] || {};
          const res = v.res || {};
          return { label: ex.label, type: ex.type, params: ex.params, target: ex.target, ai: ex.ai, program: res.ok ? { value: res.value, at: res.at, table: (res.samples || []).map(([x, y]) => ({ at: x, value: y })) } : { error: res.message }, status: v.cmp && v.cmp.status };
        }),
      };
      const opt = this.checkRow ? this.checkRow.get() : stepDefaults(app, 'check');
      saveStep(app, 'check', opt);
      this.check = { busy: true, status: '正在让 AI 检查…（' + opt.model + '）' };
      this.render();
      this.ctrl = new AbortController();
      try {
        const res = await callAI(app, P.checkMessages(app, pb, report), opt, (d) => { this.check.status = '正在让 AI 检查…' + (d.content ? '已生成 ' + d.content.length + ' 字' : d.reasoning ? '思考中' : ''); if (this.checkStatusEl) this.checkStatusEl.textContent = this.check.status; }, this.ctrl.signal);
        const d = SG.AIPrompt.parseReply(res.content);
        this.check = { diagnosis: d.diagnosis || '（AI 没有给出说明）', cause: d.cause, fix: d.fix || null };
      } catch (e) {
        this.check = { error: e.name === 'AbortError' ? '已停止' : '检查失败：' + e.message };
      }
      this.ctrl = null;
      this.render();
    }
    applyFix() {
      const app = this.app, pb = this.pb, fix = this.check && this.check.fix;
      if (!fix) return;
      try {
        if (fix.commands && fix.commands.length) SG.AIPrompt.execute(app, fix.commands);
        if (fix.panel && typeof fix.panel === 'object') pb.panel = fix.panel;
        pb.warnings = P.validatePanel(app, pb.panel);
        this.check = Object.assign({}, this.check, { applied: true });
        this.verifyAll();
        app.autosave();
        this.render();
        UI.toast('已应用修正并重新核实', 'ok');
      } catch (e) { UI.toast('应用修正失败：' + e.message, 'err', 6000); }
    }

    // ---------------------------------------------- 渲染
    render() {
      const pane = this.pane, app = this.app, pb = this.pb;
      pane.innerHTML = '';
      this.sliders = [];
      if (!pb) {
        pane.appendChild(h('div', { class: 'empty', html: '还没有题目。<br>点击顶栏"新建" → <b>从题目新建</b>：粘贴题目文字或上传题目图片，AI 识别后由你确认，再自动画出图形，并在这里生成本题专属的控制按钮（动点演示、跳到最值位置、与原图同视角……）。' }));
        pane.appendChild(h('div', { class: 'btnrow' }, h('button', { class: 'primary', onclick: () => { const w = new Wizard(app); this.wh.current = w; w.step1(); } }, '从题目新建')));
        return;
      }
      const panel = pb.panel || {};
      const info = pb.info || {};
      pane.appendChild(h('div', { class: 'pp-head' }, h('b', null, panel.title || info.title || '题目'),
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn', title: '修改题目信息后重新生成图形', onclick: () => { const w = new Wizard(app); w.images = pb.images || []; this.wh.current = w; w.step2(JSON.parse(JSON.stringify(info)), true); } }, '修改重做'),
        h('button', { class: 'btn', title: '关闭题目面板（图形保留）', onclick: () => app.setProblem(null) }, '关闭')));
      pane.appendChild(h('details', { class: 'pp-text' }, h('summary', null, '题目'), h('div', null, info.text || ''), info.asks ? h('div', { class: 'pp-asks' }, info.asks) : null));
      for (const w of pb.warnings || []) pane.appendChild(h('div', { class: 'info warn' }, '⚠ ' + w));

      // 视角
      const hasFig = pb.figureView || (info.figure && Object.keys(info.figure.points || {}).length >= 3);
      pane.appendChild(h('div', { class: 'btnrow' },
        hasFig ? h('button', { class: 'primary', title: pb.figureView ? '拟合误差约 ' + Math.round(pb.figureView.err * 100) + '%' : '', onclick: () => this.figureView() }, '与原图同视角') : null,
        h('button', { onclick: () => app.setView(32, 18) }, '默认视角')));

      // 动点参数
      const params = panel.params || [];
      if (params.length) {
        const box = h('div', { class: 'sec' }, h('h5', null, '动点'));
        for (const prm of params) {
          let r;
          try { r = P.resolveParam(app, prm); } catch (e) { box.appendChild(h('div', { class: 'info err' }, (prm.label || prm.id) + '：' + e.message)); continue; }
          const val = P.getP(app, r);
          const num = h('input', { type: 'number', class: 'num', step: 'any', value: +val.toFixed(4) });
          const rng = h('input', { type: 'range', min: r.min, max: r.max, step: (r.max - r.min) / 500 || 0.001, value: val });
          let snap = null;
          rng.addEventListener('pointerdown', () => { this.stop(); snap = app.snapshot(); });
          rng.addEventListener('input', () => { if (!snap) snap = app.snapshot(); P.setP(app, r, +rng.value); num.value = (+rng.value).toFixed(4); app.live(); });
          rng.addEventListener('change', () => { if (snap) { app.pushUndo(snap); snap = null; app.afterChange(); } });
          num.addEventListener('change', () => { const v = parseFloat(num.value); if (isFinite(v)) { this.stop(); app.change('参数', () => P.setP(app, r, Math.max(r.min, Math.min(r.max, v)))); } });
          const playing = this.runner.isPlaying('p:' + prm.id);
          box.appendChild(h('div', { class: 'pp-param' },
            h('div', { class: 'pp-plabel' }, prm.label || prm.target, h('small', null, '  范围 ' + SG.Exact.fmtNum(r.min, 3) + ' ～ ' + SG.Exact.fmtNum(r.max, 3)),
              h('button', { class: 'pp-pin small' + (app.hudHas('pprm', prm.id) ? ' on' : ''), title: '上屏：显示在画布左上角', onclick: () => { app.hudToggle('pprm', prm.id); this.render(); } }, '📌')),
            h('div', { class: 'field' }, num, rng, h('button', { class: 'btn' + (playing ? ' primary' : ''), title: '在范围内来回运动', onclick: () => (playing ? this.stop() : this.play({ param: prm.id, loop: true })) }, playing ? '■' : '▶'))));
          this.sliders.push({ r, num, rng });
        }
        pane.appendChild(box);
      }

      // AI 设计的按钮
      const btns = panel.buttons || [];
      if (btns.length) {
        const box = h('div', { class: 'sec' }, h('h5', null, '演示'));
        btns.forEach((b, bi) => {
          const pinned = app.hudHas('pbtn', String(bi));
          box.appendChild(h('div', { class: 'pp-btn-row' },
            h('button', { class: 'pp-btn', title: b.desc || '', onclick: () => this.runButton(b, bi) }, h('b', null, b.label || '按钮'), b.desc ? h('small', null, b.desc) : null),
            h('button', { class: 'pp-pin' + (pinned ? ' on' : ''), title: pinned ? '从左上角面板移除' : '上屏：显示在画布左上角', onclick: () => { app.hudToggle('pbtn', String(bi)); this.render(); } }, '📌')));
        });
        if (this.playing) box.appendChild(h('div', { class: 'btnrow' }, h('button', { onclick: () => this.stop() }, '■ 停止动画')));
        pane.appendChild(box);
      }
      this.msgEl = h('div', { class: 'info pp-msg' }, this.msg);
      this.msgEl.style.display = this.msg ? '' : 'none';
      pane.appendChild(this.msgEl);

      // 最值核实
      const exs = panel.extrema || [];
      if (exs.length) {
        const box = h('div', { class: 'sec' }, h('h5', null, '最值核实（AI 与程序各算一次）', h('button', { class: 'btn', style: { padding: '1px 8px' }, onclick: () => { this.verifyAll(); this.render(); } }, '重新核实')));
        const ver = (pb.runtime && pb.runtime.verify) || [];
        exs.forEach((ex, i) => {
          const v = ver[i] || { res: { ok: false, message: '尚未核实' }, cmp: { status: 'error' } };
          const st = v.cmp.status;
          const badge = { ok: ['✓ 一致', 'ok'], multi: ['⚠ 值一致，位置不同', 'warn'], mismatch: ['✗ 不一致', 'bad'], noai: ['· AI 未给数值', 'warn'], error: ['✗ 无法计算', 'bad'] }[st] || ['', ''];
          const ai = ex.ai || {};
          const at = (arr) => (Array.isArray(arr) ? ex.params.map((id, k) => this.paramLabel(id) + ' = ' + SG.Exact.fmtNum(+arr[k], 4)).join('，') : '');
          box.appendChild(h('div', { class: 'pp-card ' + badge[1] },
            h('div', { class: 'pp-card-h' }, h('b', null, (ex.label || '最值') + '（' + (ex.type === 'max' ? '最大' : '最小') + '）'), h('span', { class: 'pp-badge' }, badge[0])),
            h('div', null, 'AI：', h('b', null, (ai.value != null ? ai.value : '—') + (typeof ai.valueNum === 'number' ? ' ≈ ' + SG.Exact.fmtNum(ai.valueNum, 4) : '')), ai.atDesc ? '，' + ai.atDesc : '', Array.isArray(ai.at) ? '（' + at(ai.at) + '）' : ''),
            h('div', null, '程序：', v.res.ok ? h('b', null, this.fmtVal(ex, v.res.value)) : h('span', { class: 'res-err' }, v.res.message), v.res.ok ? '（' + at(v.res.at) + '）' : ''),
            v.cmp.text ? h('div', { class: 'note' }, v.cmp.text) : null,
            h('div', { class: 'btnrow' },
              v.res.ok ? h('button', { onclick: () => this.jumpExtremum(i).catch((e) => UI.toast(e.message, 'err')) }, '跳到程序算出的位置') : null,
              Array.isArray(ai.at) && ai.at.length === (ex.params || []).length ? h('button', { onclick: () => { try { this.tween(ex.params.map((id) => this.findParam(id)), ai.at.map(Number)); } catch (e) { UI.toast(e.message, 'err'); } } }, '跳到 AI 给出的位置') : null)));
        });
        pane.appendChild(box);
      }

      // 一键检查
      if (this.hasProblems() || this.check) {
        const box = h('div', { class: 'sec pp-check' });
        if (this.hasProblems() && !(this.check && this.check.busy)) {
          box.appendChild(h('button', { class: 'pp-btn danger', onclick: () => this.runCheck() }, h('b', null, '一键检查问题'), h('small', null, '把题目、图形、AI 答案和程序结果一起发给 AI，找出哪里出错')));
          this.checkRow = modelRow(app, 'check', '检查用的 AI');
          box.appendChild(this.checkRow.el);
        }
        const c = this.check;
        if (c && c.busy) {
          this.checkStatusEl = h('div', { class: 'info' }, c.status);
          box.appendChild(this.checkStatusEl);
          box.appendChild(h('div', { class: 'btnrow' }, h('button', { onclick: () => this.ctrl && this.ctrl.abort() }, '停止')));
        } else if (c && c.error) box.appendChild(h('div', { class: 'info err' }, c.error));
        else if (c && c.diagnosis) {
          const cause = { answer: 'AI 的答案算错', figure: '图形画错', range: '参数范围错误', target: '最值目标写错', other: '其他' }[c.cause] || '';
          box.appendChild(h('div', { class: 'info' }, h('b', null, '检查结果' + (cause ? '：' + cause : '')), h('div', { style: { whiteSpace: 'pre-wrap', marginTop: '4px' } }, c.diagnosis)));
          if (c.fix && !c.applied) box.appendChild(h('div', { class: 'btnrow' }, h('button', { class: 'primary', onclick: () => this.applyFix() }, '应用修正'), h('span', { class: 'note' }, (c.fix.commands || []).length + ' 条作图指令' + (c.fix.panel ? '，更新控制面板' : ''))));
          if (c.applied) box.appendChild(h('div', { class: 'note' }, '已应用修正（可用 Ctrl+Z 撤销图形上的修改）。'));
        }
        pane.appendChild(box);
      }

      // 参考答案
      const ans = panel.answers || [];
      if (ans.length || pb.message) {
        pane.appendChild(h('details', { class: 'pp-text' }, h('summary', null, 'AI 的说明与参考答案'),
          pb.message ? h('div', null, pb.message) : null,
          ans.map((a) => h('div', { class: 'pp-ans' }, h('b', null, (a.q || '') + ' '), a.text || ''))));
      }
    }
    refreshValues() {
      for (const s of this.sliders || []) {
        try {
          const v = P.getP(this.app, s.r);
          if (document.activeElement !== s.num) s.num.value = (+v).toFixed(4);
          if (document.activeElement !== s.rng) s.rng.value = v;
        } catch (e) { /* 忽略 */ }
      }
    }
  }

  SG.ProblemUI = { openNew, openHistory, Wizard, ProblemPanel, buildFromData, stepDefaults };
})(globalThis.SG = globalThis.SG || {});
