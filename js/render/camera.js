/*
 * 相机：平行投影（正投影 / 斜二测）。
 * 屏幕坐标 = 中心 + scale · (a1·q, −a2·q)，q = p − target；深度方向 F 指向观察者。
 */
(function (SG) {
  'use strict';
  const { V, G } = SG;
  const D2R = Math.PI / 180;

  class Camera {
    constructor() {
      this.az = 32;       // 方位角（度）
      this.el = 18;       // 仰角（度）
      this.mode = 'ortho'; // 'ortho' | 'oblique'
      this.yaw = 0;       // 斜二测时绕 z 轴的旋转
      this.scale = 70;    // 像素 / 单位长度
      this.target = [0, 0, 0];
      this.w = 800; this.h = 600;
      this.panX = 0; this.panY = 0;
      // 视角基准面：水平角绕 base.n 转、俯仰角相对 base 平面；null 表示 xOy 底面
      this.base = null;
      this.update();
    }

    /** 当前基准坐标系 {e1, e2, n} */
    frame() {
      const b = this.base;
      return b ? b : { e1: [1, 0, 0], e2: [0, 1, 0], n: [0, 0, 1] };
    }
    /** 由视线方向（指向观察者）和屏幕右方向，求在当前基准下的水平角 / 俯仰角（度） */
    anglesFor(F, right) {
      const { e1, e2, n } = this.frame();
      const s = Math.max(-1, Math.min(1, V.dot(F, n)));
      let el = (Math.asin(s) * 180) / Math.PI;
      let az;
      if (Math.abs(s) < 0.9999) az = (Math.atan2(V.dot(F, e2), V.dot(F, e1)) * 180) / Math.PI;
      else az = right ? (Math.atan2(-V.dot(right, e1), V.dot(right, e2)) * 180) / Math.PI : this.az;
      // 若屏幕右方向与该角度给出的方向相反，说明视角已翻过头顶
      if (right) {
        const a = (az * Math.PI) / 180;
        const r = V.add(V.scale(e1, -Math.sin(a)), V.scale(e2, Math.cos(a)));
        if (V.dot(r, right) < 0) { az += 180; el = (el >= 0 ? 180 : -180) - el; }
      }
      az = ((az % 360) + 540) % 360 - 180;
      return { az, el };
    }

    setSize(w, h) { this.w = w; this.h = h; }

    update() {
      if (this.mode === 'oblique') {
        const k = 0.5 * Math.SQRT1_2;
        const c = Math.cos(this.yaw * D2R), s = Math.sin(this.yaw * D2R);
        // p' = Rz(yaw)·p，a·p' = (Rzᵀ a)·p
        const rt = (a) => [c * a[0] + s * a[1], -s * a[0] + c * a[1], a[2]];
        this.a1 = rt([-k, 1, 0]);
        this.a2 = rt([-k, 0, 1]);
        this.F = V.norm(rt([1, k, k]));
      } else {
        const az = this.az * D2R, el = this.el * D2R;
        const { e1, e2, n } = this.frame();
        const comb = (a, b, c) => [a * e1[0] + b * e2[0] + c * n[0], a * e1[1] + b * e2[1] + c * n[1], a * e1[2] + b * e2[2] + c * n[2]];
        const f = comb(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el));
        const r = comb(-Math.sin(az), Math.cos(az), 0);
        const u = V.cross(f, r);
        this.a1 = r; this.a2 = u; this.F = f;
      }
      this.M = [this.a1, this.a2, this.F];
    }

    get cx() { return this.w / 2 + this.panX; }
    get cy() { return this.h / 2 + this.panY; }

    project(p) {
      const q = V.sub(p, this.target);
      return [this.cx + this.scale * V.dot(this.a1, q), this.cy - this.scale * V.dot(this.a2, q)];
    }
    depth(p) { return V.dot(this.F, p); }

    /** 屏幕点对应的视线：p0 + s·F */
    ray(sx, sy) {
      const X = (sx - this.cx) / this.scale, Y = -(sy - this.cy) / this.scale;
      const q = G.solve3(this.M, [X, Y, 0]) || [0, 0, 0];
      return { o: V.add(this.target, q), d: this.F };
    }
    /** 视线与平面交点 */
    rayPlane(sx, sy, pl) {
      const r = this.ray(sx, sy);
      const den = V.dot(pl.n, r.d);
      if (Math.abs(den) < 1e-9) return null;
      const s = (pl.d - V.dot(pl.n, r.o)) / den;
      return V.addScaled(r.o, r.d, s);
    }
    /** 屏幕上的位移向量 → 世界中某平面内的位移（用于拖动） */
    screenDirToWorld(dx, dy, pl) {
      const p0 = this.rayPlane(this.cx, this.cy, pl), p1 = this.rayPlane(this.cx + dx, this.cy + dy, pl);
      if (!p0 || !p1) return [0, 0, 0];
      return V.sub(p1, p0);
    }
    /** 世界向量在屏幕上的方向（像素） */
    worldDirToScreen(v) {
      return [this.scale * V.dot(this.a1, v), -this.scale * V.dot(this.a2, v)];
    }

    /** 使给定包围盒适应窗口 */
    fit(min, max, margin) {
      margin = margin == null ? 0.72 : margin;
      const c = V.mid(min, max);
      this.target = c;
      this.panX = 0; this.panY = 0;
      const corners = [];
      for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) corners.push([x, y, z]);
      let w = 0, h = 0;
      for (const p of corners) {
        const q = V.sub(p, c);
        w = Math.max(w, Math.abs(V.dot(this.a1, q)));
        h = Math.max(h, Math.abs(V.dot(this.a2, q)));
      }
      w = Math.max(w, 0.5); h = Math.max(h, 0.5);
      this.scale = Math.min((this.w * margin) / (2 * w), (this.h * margin) / (2 * h));
      this.scale = Math.max(5, Math.min(this.scale, 400));
    }

    toJSON() { return { az: this.az, el: this.el, mode: this.mode, yaw: this.yaw, scale: this.scale, target: this.target, panX: this.panX, panY: this.panY, base: this.base }; }
    load(j) { this.base = null; Object.assign(this, j); this.update(); }
  }

  SG.Camera = Camera;
})(globalThis.SG = globalThis.SG || {});
