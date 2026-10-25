/*
 * 动作执行器："积木"动作的统一实现，题目控制面板、"控制"分区、左上角浮动面板共用。
 *
 * 动作中的参数可写成：
 *   "param": "P1"                                  —— 题目面板中定义的参数 id
 *   "param": {"target":"M","key":"t","min":0,"max":1} 或 "target":"M","key":"t"  —— 直接指定对象与参数
 */
(function (SG) {
  'use strict';
  const { UI } = SG;
  const P = SG.Problem;

  class ActionRunner {
    /** ctx: { params: () => [面板参数], figureView(), onMsg(text), state: () => {}, onChange() } */
    constructor(app, ctx) {
      this.app = app;
      this.ctx = ctx || {};
      this.playing = null;
    }

    /** 解析参数说明 → { o, p, min, max } */
    param(spec, a) {
      if (spec == null && a && a.target) spec = { target: a.target, key: a.key, min: a.min, max: a.max };
      if (typeof spec === 'string') {
        const list = (this.ctx.params && this.ctx.params()) || [];
        const prm = list.find((p) => p.id === spec) || list.find((p) => p.target === spec);
        if (prm) return P.resolveParam(this.app, prm);
        return P.resolveParam(this.app, { target: spec });
      }
      if (spec && spec.target) return P.resolveParam(this.app, spec);
      throw new Error('没有指定参数');
    }

    tween(rs, targets, ms) {
      const app = this.app;
      ms = ms == null ? 600 : ms;
      const from = rs.map((r) => P.getP(app, r));
      const snap = app.snapshot();
      return new Promise((resolve) => {
        const t0 = performance.now();
        const step = (t) => {
          const k = Math.min(1, (t - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          rs.forEach((r, i) => P.setP(app, r, from[i] + (targets[i] - from[i]) * e));
          app.live();
          if (k < 1) requestAnimationFrame(step);
          else { app.pushUndo(snap); app.afterChange(); resolve(); }
        };
        requestAnimationFrame(step);
      });
    }

    play(a, key) {
      const app = this.app;
      this.stop();
      const r = this.param(a.param, a);
      const from = a.from != null ? +a.from : r.min, to = a.to != null ? +a.to : r.max;
      const per = Math.max(0.5, +a.seconds || 4) * 1000, loop = a.loop !== false;
      if (a.trace) {
        app.change('轨迹', () => {
          const tr = app.C.exec({ op: 'trace', point: a.tracePoint || r.o.id });
          const o = app.S.map.get(tr.main);
          if (o) { o.recording = true; o.data = []; }
        });
      }
      const snap = app.snapshot();
      const t0 = performance.now();
      const st = { key: key || JSON.stringify(a.param || a.target), snap, raf: 0 };
      const frame = (t) => {
        let k = (t - t0) / per;
        if (!loop && k >= 1) { P.setP(app, r, to); app.live(); this.stop(); return; }
        k = k % 2; if (k > 1) k = 2 - k;
        P.setP(app, r, from + (to - from) * k);
        app.live();
        st.raf = requestAnimationFrame(frame);
      };
      st.raf = requestAnimationFrame(frame);
      this.playing = st;
      if (this.ctx.onChange) this.ctx.onChange();
    }
    isPlaying(key) { return !!this.playing && (key == null || this.playing.key === key); }
    stop(silent) {
      const st = this.playing;
      if (!st) return;
      cancelAnimationFrame(st.raf);
      this.playing = null;
      if (!silent) { this.app.pushUndo(st.snap); this.app.afterChange(); if (this.ctx.onChange) this.ctx.onChange(); }
    }

    /** 不依赖题目面板的最值：{type, target, params:[{target,key,min,max}]} */
    async extremumInline(a) {
      const list = (this.ctx.params && this.ctx.params()) || [];
      const specs = (a.params || (a.param ? [a.param] : [])).map((p, i) => {
        if (typeof p === 'string') { const f = list.find((x) => x.id === p); return Object.assign({}, f || { target: p }, { id: 'q' + i }); }
        return Object.assign({}, p, { id: 'q' + i });
      });
      if (!specs.length) throw new Error('没有指定动点参数');
      const panel = { params: specs };
      const ex = { type: a.type || 'min', params: panel.params.map((p) => p.id), target: a.target };
      const res = P.scanExtremum(this.app, panel, ex);
      if (!res.ok) throw new Error(res.message);
      this.stop();
      await this.tween(panel.params.map((p) => P.resolveParam(this.app, p)), res.at);
      const v = SG.TextVars.fmtNum(res.value);
      this.msg((a.label || (ex.type === 'max' ? '最大值' : '最小值')) + '：' + v);
      return res;
    }

    msg(t) { if (this.ctx.onMsg) this.ctx.onMsg(t); }

    /** 依次执行一组动作；key 用于记住 draw 动作作出的对象 */
    async run(actions, key) {
      const app = this.app, S = app.S;
      for (let i = 0; i < (actions || []).length; i++) {
        const a = actions[i];
        switch (a.do) {
          case 'set': { const r = this.param(a.param, a); this.stop(); await this.tween([r], [+a.value], a.seconds != null ? a.seconds * 1000 : undefined); break; }
          case 'play': this.play(a, key + ':' + i); break;
          case 'stop': this.stop(); break;
          case 'extremum':
            if (a.index != null && this.ctx.extremum) await this.ctx.extremum(+a.index);
            else await this.extremumInline(a);
            break;
          case 'show': case 'hide': case 'toggle':
            app.change('显示', () => {
              for (const n of a.targets || []) {
                const o = S.get(n);
                if (!o) continue;
                o.hidden = a.do === 'hide' ? true : a.do === 'show' ? false : !o.hidden;
              }
            });
            break;
          case 'draw': {
            const st = (this.ctx.state && this.ctx.state()) || (this._state = this._state || {});
            st.drawn = st.drawn || {};
            const k = key + ':' + i;
            const ids = (st.drawn[k] || []).filter((id) => S.map.has(id));
            if (ids.length) {
              const show = ids.some((id) => S.map.get(id).hidden);
              app.change('显示', () => { for (const id of ids) S.map.get(id).hidden = !show; });
            } else {
              const r = SG.AIPrompt.execute(app, a.commands || []);
              st.drawn[k] = r.created;
              for (const id of r.created) { const o = S.map.get(id); if (o && o.type === 'point') o.style.label = true; }
              app.render();
              app.autosave();
            }
            break;
          }
          case 'view':
            if (a.preset === 'figure') { if (this.ctx.figureView) this.ctx.figureView(); else throw new Error('没有题目示意图'); }
            else if (a.preset === 'default' || a.az == null) app.setView(32, 18);
            else {
              if (a.mode === 'oblique') { app.cam.mode = 'oblique'; app.cam.yaw = +a.yaw || 0; app.cam.base = null; app.cam.update(); app.emit('viewmode'); app.render(); }
              else { if (app.cam.base) app.setViewBase(null); app.setAngles(+a.az, a.el != null ? +a.el : app.cam.el); }
            }
            break;
          case 'trace': {
            const r = this.param(a.param, a);
            const target = a.point ? S.get(a.point) : r.o;
            if (!target) throw new Error('找不到要追踪的点');
            if (a.mode === 'clear') { app.change('清除轨迹', () => { for (const o of S.objects) if (o.type === 'trace' && o.def.p === target.id) o.data = []; }); break; }
            app.change('生成轨迹', () => {
              const tr = S.map.get(app.C.exec({ op: 'trace', point: target.id }).main);
              const v0 = P.getP(app, r), N = 300, data = [];
              for (let k = 0; k <= N; k++) { P.setP(app, r, r.min + ((r.max - r.min) * k) / N); S.recompute(); if (target.v) data.push(target.v.slice()); }
              P.setP(app, r, v0);
              tr.data = data; tr.recording = false;
            });
            break;
          }
          case 'text': this.msg(SG.TextVars.render(S, a.text || '')); break;
          case 'measure': app.change('度量', () => app.C.exec(Object.assign({ op: 'measure' }, a.measure))); break;
          default: throw new Error('未知动作 ' + a.do);
        }
      }
    }

    /** 带错误提示地执行 */
    async runSafe(actions, key, label) {
      try { await this.run(actions, key); }
      catch (e) {
        UI.toast((label ? '"' + label + '"：' : '') + e.message, 'err', 5000);
        this.msg('⚠ ' + (label || '') + '：' + e.message);
      }
    }
  }

  SG.ActionRunner = ActionRunner;
})(globalThis.SG = globalThis.SG || {});
