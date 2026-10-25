/*
 * 激活密码：API Key 用密码加密后以"激活码"的形式放在下面的 CODE 中；
 * 在任何设备上输入正确的密码即可在本地解出 Key（有效 7 天）。
 * 加密：PBKDF2-SHA256（31 万次）派生密钥 + AES-GCM；格式 v1.<base64(salt16 | iv12 | 密文)>
 */
(function (SG) {
  'use strict';

  // 激活码（用"设置 → 高级调试 → 生成激活码"生成后粘贴到这里）
  const CODE = 'v1.EosXUtF+DV33oXKGofZBt4u4pg8RDQPI1ntObL13DHAPxXEMY4CjTqG2BlgXVUk71dCXneS0PET11Tz3186mSeH+mGbdclKmCDGri+9U9A==';

  const ITER = 310000, DAYS = 7;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function deriveKey(password, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  /** 用密码加密 Key，返回激活码 */
  async function encrypt(secret, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(password, salt), enc.encode(secret)));
    const all = new Uint8Array(28 + ct.length);
    all.set(salt, 0); all.set(iv, 16); all.set(ct, 28);
    return 'v1.' + b64(all);
  }

  /** 用密码解开激活码；密码错误时抛出错误 */
  async function decrypt(code, password) {
    code = (code || '').trim();
    if (!code.startsWith('v1.')) throw new Error('激活码格式不正确');
    const all = unb64(code.slice(3));
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(16, 28) }, await deriveKey(password, all.slice(0, 16)), all.slice(28));
      return dec.decode(pt);
    } catch (e) { throw new Error('密码错误'); }
  }

  /** 输入密码激活：解出 Key 写入设置，7 天后过期。code 省略时使用内置激活码 */
  async function activate(app, password, code) {
    const c = code || CODE;
    if (!c) throw new Error('还没有设置激活码');
    const key = await decrypt(c, password);
    Object.assign(app.settings.ai, { apiKey: key, keyExpire: Date.now() + DAYS * 864e5 });
    app.saveSettings();
    return app.settings.ai.keyExpire;
  }
  function clear(app) {
    Object.assign(app.settings.ai, { apiKey: '', keyExpire: 0 });
    app.saveSettings();
  }
  /** 启动时检查：通过激活得到的 Key 到期后清除 */
  function checkExpire(app) {
    const ai = app.settings.ai;
    if (ai.keyExpire && Date.now() > ai.keyExpire) clear(app);
  }

  SG.Vault = { encrypt, decrypt, activate, clear, checkExpire, hasCode: () => !!CODE, DAYS };
})(globalThis.SG = globalThis.SG || {});
