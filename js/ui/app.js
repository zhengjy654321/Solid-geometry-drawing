/*
 * 应用状态：场景、相机、选择、撤销/重做、工作面、自动保存、导出。
 */
(function (SG) {
  'use strict';
  const { V, UI } = SG;

  const DEFAULT_SETTINGS = {
    ai: {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      modelThink: 'deepseek-flash',
      modelFast: 'deepseek-flash',
      think: false,
      effort: 'high',
      history: 6,
    },
    view: {
      fontSize: 17, lineScale: 1, hiddenMode: 'dashed', gridStep: 1, gridExtent: 5,
      snapGrid: true, snapStep: 0.5, showDots: true, labelNew: false,
      axes: false, axisNumbers: false, ground: false, grid3d: false, coords: false, workGrid: true,
    },
  };
  const PROVIDERS = {
    // DeepSeek：同一个模型名，用 thinking 参数开关思考、reasoning_effort 控制思考强度
    deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', modelThink: 'deepseek-flash', modelFast: 'deepseek-flash', thinkingParam: true },
    openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelThink: 'gpt-5', modelFast: 'gpt-4.1' },
    custom: { label: '其他（OpenAI 兼容接口）', baseUrl: '', modelThink: '', modelFast: '' },
  };

  function deepMerge(a, b) {
    const out = JSON.parse(JSON.stringify(a));
    for (const k of Object.keys(b || {})) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && out[k] && typeof out[k] === 'object') out[k] = deepMerge(out[k], b[k]);
      else out[k] = b[k];
    }
    return out;
  }

  class App {
    constructor() {
      this.S = new SG.Scene();
      this.C = new SG.Commands(this.S);
      this.cam = new SG.Camera();
      this.settings = deepMerge(DEFAULT_SETTINGS, UI.LS.get('sg.settings', {}));
      // 旧版保存的 DeepSeek 模型名（deepseek-chat / deepseek-reasoner）已停用，自动换成 deepseek-flash
      const ai = this.settings.ai;
      if (ai.provider === 'deepseek') {
        let changed = false;
        for (const k of ['modelThink', 'modelFast']) if (['deepseek-chat', 'deepseek-reasoner'].includes(ai[k])) { ai[k] = 'deepseek-flash'; changed = true; }
        if (changed) UI.LS.set('sg.settings', this.settings);
      }
      this.view = this.settings.view;
      this.sel = [];
      this.hover = null;
      this.preview = [];
      this.pickHL = [];
      this.undoStack = [];
      this.redoStack = [];
      this.work = { kind: 'xy', h: 0 };
      this.ev = {};
      this.dl = null;
    }

    on(name, fn) { (this.ev[name] = this.ev[name] || []).push(fn); }
    emit(name, ...args) { for (const fn of this.ev[name] || []) { try { fn(...args); } catch (e) { console.error(e); } } }

    attach(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      new ResizeObserver(() => this.render()).observe(canvas);
    }

    saveSettings() { UI.LS.set('sg.settings', this.settings); }

    // ------------------------------------------------------------ 修改与撤销
    snapshot() { return JSON.stringify(this.S.toJSON()); }
    restore(snap) { this.S.load(JSON.parse(snap)); this.markSeen(); this.S.recompute(); }
    markSeen() { for (const o of this.S.objects) o._seen = true; }

    /** 在一个可撤销的步骤中执行 fn；出错则回滚 */
    change(label, fn) {
      const snap = this.snapshot();
      let res;
      try {
        res = fn();
        this.S.recompute();
      } catch (e) {
        console.warn(e);
        this.restore(snap);
        UI.toast(e.message || String(e), 'err');
        this.afterChange();
        return undefined;
      }
      this.pushUndo(snap);
      this.applyNewDefaults();
      this.afterChange();
      return res === undefined ? true : res;
    }
    pushUndo(snap) {
      this.undoStack.push(snap);
      if (this.undoStack.length > 300) this.undoStack.shift();
      this.redoStack = [];
    }
    undo() {
      if (!this.undoStack.length) return UI.toast('没有可撤销的操作');
      this.redoStack.push(this.snapshot());
      this.restore(this.undoStack.pop());
      this.afterChange();
    }
    redo() {
      if (!this.redoStack.length) return UI.toast('没有可重做的操作');
      this.undoStack.push(this.snapshot());
      this.restore(this.redoStack.pop());
      this.afterChange();
    }
    applyNewDefaults() {
      if (!this.view.labelNew) return;
      for (const o of this.S.objects) {
        if (o.type === 'point' && !o._seen) { o.style.label = true; }
        o._seen = true;
      }
    }
    afterChange() {
      this.sel = this.sel.filter((id) => this.S.map.has(id));
      if (this.hover && !this.S.map.has(this.hover)) this.hover = null;
      this.recordTraces();
      this.render();
      this.emit('change');
      this.emit('select');
      this.autosave();
    }
    /** 拖动等连续操作时的轻量更新（不进入撤销栈） */
    live() {
      this.S.recompute();
      this.recordTraces();
      this.render();
      this.emit('live');
    }

    recordTraces() {
      for (const o of this.S.objects) {
        if (o.type !== 'trace' || !o.recording) continue;
        const p = this.S.map.get(o.def.p);
        if (!p || !p.v) continue;
        o.data = o.data || [];
        const last = o.data[o.data.length - 1];
        if (!last || V.dist(last, p.v) > 1e-3) o.data.push(p.v.slice());
        if (o.data.length > 20000) o.data.shift();
        o.v = { pts: o.data };
      }
    }

    autosave() {
      clearTimeout(this._asT);
      this._asT = setTimeout(() => UI.LS.set('sg.autosave', { scene: this.S.toJSON(), cam: this.cam.toJSON(), work: this.work }), 400);
    }

    // ------------------------------------------------------------ 选择
    select(ids, add) {
      ids = (Array.isArray(ids) ? ids : [ids]).filter((x) => x != null);
      if (add) {
        for (const id of ids) {
          const i = this.sel.indexOf(id);
          if (i >= 0) this.sel.splice(i, 1); else this.sel.push(id);
        }
      } else this.sel = ids.slice();
      this.render();
      this.emit('select');
    }
    selected() { return this.sel.map((id) => this.S.map.get(id)).filter(Boolean); }

    // ------------------------------------------------------------ 工作面
    workPlane() {
      const w = this.work;
      const mk = (o, n, u, v) => ({ o, n, u, v, d: V.dot(n, o), center: o });
      if (w.kind === 'xy') return mk([0, 0, w.h || 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
      if (w.kind === 'xz') return mk([0, w.h || 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
      if (w.kind === 'yz') return mk([w.h || 0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
      try {
        const pl = this.S.ctx.plane(w.ref);
        return Object.assign({}, pl, { center: V.centroid(pl.anchors || [pl.o]) });
      } catch (e) {
        this.work = { kind: 'xy', h: 0 };
        return this.workPlane();
      }
    }
    workPlaneLabel() {
      const w = this.work;
      if (w.kind === 'xy') return w.h ? '水平面 z = ' + SG.Exact.fmtNum(w.h) : '底面（xOy 平面，z = 0）';
      if (w.kind === 'xz') return '竖直面 y = ' + SG.Exact.fmtNum(w.h || 0) + '（正面）';
      if (w.kind === 'yz') return '竖直面 x = ' + SG.Exact.fmtNum(w.h || 0) + '（侧面）';
      if (Array.isArray(w.ref)) return '平面 ' + w.ref.map((id) => (this.S.map.get(id) || {}).name || '?').join('');
      const o = this.S.map.get(w.ref);
      return o ? (o.type === 'polygon' ? '平面 ' : '') + this.S.displayName(o) : '底面';
    }
    setWork(w) {
      this.work = w;
      this.render();
      this.emit('work');
      this.autosave();
    }

    // ------------------------------------------------------------ 绘制
    render() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = null; this.draw(); });
    }
    viewOptions(exportMode) {
      const v = Object.assign({}, this.view, { exportMode });
      const isDefault = this.work.kind === 'xy' && !this.work.h;
      if (!exportMode && this.view.workGrid && !isDefault) v.workPlane = this.workPlane();
      return v;
    }
    highlightMap() {
      const hl = new Map();
      for (const id of this.pickHL) hl.set(id, 'pick');
      for (const id of this.sel) hl.set(id, 'sel');
      if (this.hover && !hl.has(this.hover)) hl.set(this.hover, 'hover');
      return hl;
    }
    draw() {
      const cv = this.canvas;
      if (!cv) return;
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      this.cam.setSize(w, h);
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      const dl = SG.Renderer.build(this.S, this.cam, this.viewOptions(false), { hl: this.highlightMap(), preview: this.preview });
      SG.Backend.draw(ctx, dl);
      this.dl = dl;
      this.emit('draw');
    }

    /** 根据场景内容调整视野 */
    fit() {
      this.S.recompute();
      let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      const add = (p, r) => { r = r || 0; for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i] - r); max[i] = Math.max(max[i], p[i] + r); } };
      for (const o of this.S.objects) {
        if (!o.v || o.hidden) continue;
        if (o.type === 'point') add(o.v);
        if (o.type === 'sphere') add(o.v.c, o.v.r);
        if (o.type === 'solid' && o.v.curved) { const c = o.v.curved; add(c.c0, c.r1); add(c.c1, Math.max(c.r2, 0.01)); }
        if (o.type === 'plane') for (const p of SG.Renderer.planeCorners(o.v, o.style.size)) add(p);
      }
      if (!isFinite(min[0])) { min = [-2, -2, 0]; max = [2, 2, 2]; }
      // 右下角的视角控制器展开时，让出它所占的宽度，避免图形被挡住
      const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
      const vc = document.getElementById('viewctl');
      const res = vc && !vc.classList.contains('closed') && vc.offsetWidth && W > 500 ? vc.offsetWidth + 16 : 0;
      this.cam.setSize(W - res, H);
      this.cam.fit(min, max);
      this.cam.setSize(W, H);
      this.cam.panX = -res / 2;
      this.render();
    }

    /** 拖动旋转时是否锁定方向（未设置时：触屏设备默认开启） */
    rotLockOn() {
      if (this.view.rotLock != null) return !!this.view.rotLock;
      return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    }
    /** 按角度旋转视角：dAz 绕竖直轴（正值 = 图形向左转），dEl 俯仰（正值 = 看到更多顶面） */
    rotateView(dAz, dEl) {
      const cam = this.cam;
      if (cam.mode === 'oblique') cam.yaw -= dAz;
      else {
        cam.az += dAz;
        cam.el = Math.max(-89.9, Math.min(89.9, cam.el + (dEl || 0)));
      }
      cam.az = ((cam.az % 360) + 540) % 360 - 180;
      cam.update();
      this.render();
      this.emit('camera');
      this.autosave();
    }
    /** 直接设置视角（不改变缩放与位置） */
    setAngles(az, el) {
      const cam = this.cam;
      if (cam.mode === 'oblique') { cam.mode = 'ortho'; this.emit('viewmode'); }
      if (az != null) cam.az = ((az % 360) + 540) % 360 - 180;
      if (el != null) cam.el = Math.max(-89.9, Math.min(89.9, el));
      cam.update();
      this.render();
      this.emit('camera');
      this.autosave();
    }

    setView(az, el) {
      this.cam.mode = 'ortho';
      this.cam.az = az; this.cam.el = el;
      this.cam.update();
      this.fit();
      this.emit('viewmode');
    }

    // ------------------------------------------------------------ 导出
    exportDL() {
      return SG.Renderer.build(this.S, this.cam, this.viewOptions(true), {});
    }
    exportCanvas(scale) {
      scale = scale || 3;
      const dl = this.exportDL();
      const tmp = document.createElement('canvas');
      // 先绘制一次以获得文字尺寸
      const box = SG.Backend.contentBox(dl);
      const m = 16;
      tmp.width = Math.ceil((box.w + 2 * m) * scale);
      tmp.height = Math.ceil((box.h + 2 * m) * scale);
      const ctx = tmp.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, (-box.x + m) * scale, (-box.y + m) * scale);
      ctx.fillStyle = '#fff';
      ctx.fillRect(box.x - m, box.y - m, box.w + 2 * m, box.h + 2 * m);
      SG.Backend.draw(ctx, dl);
      return tmp;
    }
    exportPNG() {
      this.exportCanvas(3).toBlob((b) => UI.download('立体几何.png', b));
    }
    exportSVG() {
      const dl = this.exportDL();
      const box = SG.Backend.contentBox(dl);
      const m = 16;
      const svg = SG.Backend.toSVG(dl, { x: box.x - m, y: box.y - m, w: box.w + 2 * m, h: box.h + 2 * m }, '#fff');
      UI.download('立体几何.svg', svg, 'image/svg+xml');
    }
    copyPNG() {
      this.exportCanvas(3).toBlob(async (b) => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
          UI.toast('图片已复制，可直接粘贴到 Word / PPT 中', 'ok');
        } catch (e) { UI.toast('复制失败：浏览器不允许访问剪贴板，请改用导出 PNG', 'err'); }
      });
    }
    saveFile() {
      const data = { scene: this.S.toJSON(), cam: this.cam.toJSON(), work: this.work };
      UI.download('立体几何.json', JSON.stringify(data, null, 1), 'application/json');
    }
    loadData(data, keepUndo) {
      const snap = this.snapshot();
      try {
        const sc = data.scene || data;
        if (!sc.objects) throw new Error('文件格式不正确');
        this.S.load(sc);
        this.markSeen();
        this.S.recompute();
        if (data.cam) this.cam.load(data.cam);
        this.work = data.work || { kind: 'xy', h: 0 };
        if (keepUndo !== false) this.pushUndo(snap);
        this.sel = [];
        this.afterChange();
        this.emit('viewmode');
        this.emit('work');
      } catch (e) {
        this.restore(snap);
        UI.toast('打开失败：' + e.message, 'err');
      }
    }
  }

  SG.App = App;
  SG.PROVIDERS = PROVIDERS;
  SG.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})(globalThis.SG = globalThis.SG || {});
