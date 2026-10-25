/*
 * OpenAI 兼容的 Chat Completions 客户端（DeepSeek / OpenAI / 其他兼容接口），支持流式输出与思考过程。
 */
(function (SG) {
  'use strict';

  function endpoint(baseUrl) {
    let u = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!u) throw new Error('未设置接口地址');
    if (/\/chat\/completions$/.test(u)) return u;
    return u + '/chat/completions';
  }

  function friendly(status, body) {
    let msg = '';
    try { const j = JSON.parse(body); msg = (j.error && (j.error.message || j.error)) || j.message || ''; } catch (e) { msg = body.slice(0, 300); }
    const hint = { 400: '请求格式错误（可能是模型名称不正确）', 401: 'API Key 无效或未填写', 402: '账户余额不足', 403: '没有权限', 404: '接口地址或模型不存在', 422: '参数错误', 429: '请求太频繁或额度用尽，请稍后再试', 500: '服务器错误', 503: '服务器繁忙，请稍后再试' }[status] || '';
    return 'HTTP ' + status + (hint ? '：' + hint : '') + (msg ? '（' + msg + '）' : '');
  }

  /**
   * opts: { baseUrl, apiKey, model, messages, provider, think, effort, signal, onDelta({content, reasoning}) }
   * DeepSeek：思考模式默认开启，用 "thinking": {"type": "enabled"/"disabled"} 开关，
   * "reasoning_effort": low/high/max 控制思考强度（见 https://api-docs.deepseek.com/zh-cn/guides/thinking_mode）。
   * 返回 { content, reasoning }
   */
  async function chat(opts) {
    const body = { model: opts.model, messages: opts.messages, stream: true };
    if (opts.provider === 'deepseek') {
      body.thinking = { type: opts.think ? 'enabled' : 'disabled' };
      if (opts.think) body.reasoning_effort = ['low', 'high', 'max'].includes(opts.effort) ? opts.effort : 'high';
    }
    // OpenAI 推理模型的 reasoning_effort 只有 low / medium / high
    else if (opts.provider === 'openai' && opts.think) body.reasoning_effort = opts.effort === 'low' ? 'low' : opts.effort === 'max' ? 'high' : 'medium';
    let res;
    try {
      res = await fetch(endpoint(opts.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + opts.apiKey },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('网络请求失败：' + e.message + '（请检查网络、接口地址，或该接口是否允许浏览器直接访问）');
    }
    if (!res.ok) throw new Error(friendly(res.status, await res.text()));
    const ctype = res.headers.get('content-type') || '';
    let content = '', reasoning = '';
    if (!res.body || ctype.includes('application/json')) {
      const j = await res.json();
      const m = (j.choices && j.choices[0] && j.choices[0].message) || {};
      content = m.content || '';
      reasoning = m.reasoning_content || m.reasoning || '';
      if (opts.onDelta) opts.onDelta({ content, reasoning });
      return { content, reasoning };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let j;
        try { j = JSON.parse(data); } catch (e) { continue; }
        if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
        const d = (j.choices && j.choices[0] && (j.choices[0].delta || j.choices[0].message)) || {};
        if (d.content) content += d.content;
        if (d.reasoning_content) reasoning += d.reasoning_content;
        else if (typeof d.reasoning === 'string') reasoning += d.reasoning;
        if (opts.onDelta) opts.onDelta({ content, reasoning });
      }
    }
    return { content, reasoning };
  }

  SG.AIClient = { chat, endpoint };
})(globalThis.SG = globalThis.SG || {});
